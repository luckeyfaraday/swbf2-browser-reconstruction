"""Read source-described RVM blocks without executing shader programs.

Usage: Python311/python.exe tools/materials/inspect-rvm.py
Layout reference pinned to Glacier 5ff0ddb; RES metadata precedes logical bytes.
"""
import pathlib, json, re, struct, sys, uuid, hashlib, collections, argparse
base = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(base / 'python-libs'))
from cityhash import CityHash64WithSeed
root = base.parents[1]
ap=argparse.ArgumentParser();ap.add_argument('--directory',default='exports/materials/rvm');args=ap.parse_args()
out=root/args.directory
meta_path = out/'0.json'
res_path = out/'0.res'
meta = json.loads(meta_path.read_text())
data = bytes.fromhex(meta['resourceMetaHex']) + res_path.read_bytes()
source = (base / 'reference/rvm-types.rs').read_text()
scalar = {'u8':('B',1,1),'u16':('H',2,2),'u32':('I',4,4),'u64':('Q',8,8),'i32':('i',4,4),'i64':('q',8,8),'f32':('f',4,4),'bool':('?',1,1),'Guid':('16s',16,4)}
layouts = {}
for match in re.finditer(r'#\[hash\(0x([0-9A-Fa-f]+)\)\]\s*pub struct (\w+)\s*\{(.*?)\n\}',source,re.S):
    h, name, body = match.groups(); fields=[]; offset=0; alignment=1
    for field, typ in re.findall(r'pub (\w+): ([^,\n]+)',body):
        array=re.fullmatch(r'\[(\w+); (0x[\da-fA-F]+|\d+)\]',typ)
        count=1
        if array: typ,count=array.group(1),int(array.group(2),0)
        fmt,size,align=scalar[typ];offset=(offset+align-1)//align*align
        fields.append((field,typ,count,offset));offset+=size*count;alignment=max(alignment,align)
    size=(offset+alignment-1)//alignment*alignment
    layouts[int(h,16)]={'name':name,'size':size,'fields':fields}
for h,name,typ in re.findall(r'#\[hash\(0x([0-9A-Fa-f]+)\)\]\s*pub struct (\w+)\((?:pub )?(\w+)\);',source):
    fmt,size,align=scalar[typ];layouts[int(h,16)]={'name':name,'size':size,'fields':[('value',typ,1,0)]}
# Primitive UInt64 name hash independently matches the historical SDK hash.
layouts[0xb0bc3c81]={'name':'Uint64','size':8,'fields':[('value','u64',1,0)]}
width_path=root/'exports/materials/rvm/recovered-layout-widths.json'
if width_path.exists():
    widths=json.loads(width_path.read_text());assert widths['completeByteCoverage']
    for name,size in widths.get('validatedOverrides',{}).items():
        for layout in layouts.values():
            if layout['name']==name:
                layout.update(size=size,fields=[('opaqueProfileBytes','u8',size,0)],fieldSemantics='Opaque: modern reference layout differs from installed profile; width is hash-validated.')
    for row in widths['types']:
        key=row['typeHash'];name=layouts.get(key,{}).get('name',row.get('name','Opaque_'+hex(key)))
        layouts[key]={'name':name,'size':row['size'],'fields':[('opaqueProfileBytes','u8',row['size'],0)],'fieldSemantics':'Opaque: width validated by source hash references and full resource byte coverage.'}
header=16+struct.unpack_from('<I',data,4)[0]
count_len=struct.unpack_from('<I',data,header+28)[0]
type_count=struct.unpack_from('<H',data,header+38)[0]
types=list(struct.iter_unpack('<IIQ',data[header+40:header+40+16*type_count]))
counts_at=header+40+16*type_count+8
assert counts_at+count_len*2==len(data),(counts_at,count_len,len(data))
counts=struct.unpack_from('<'+'H'*count_len,data,counts_at)
missing=[hex(h) for h,n,i in types if h not in layouts]
offset=16;ci=0;blocks={};stats=[];collisions=[]
for type_hash,number,index in types:
    if type_hash not in layouts: break  # retain a bounded prefix; never guess struct sizes
    layout=layouts[type_hash];start=offset;total=0
    for _ in range(number):
        count=counts[ci];ci+=1;size=count*layout['size'];chunk=data[offset:offset+size]
        assert len(chunk)==size and offset+size<=header
        key=f'{CityHash64WithSeed(chunk,type_hash)&0xffffffffff:010x}'
        record={'typeHash':type_hash,'type':layout['name'],'offset':offset-16,'count':count,'size':size}
        if key in blocks:
            old=blocks[key]
            if old['typeHash']!=type_hash or data[16+old['offset']:16+old['offset']+old['size']]!=chunk:collisions.append(key)
        blocks[key]=record;offset+=size;total+=count
    stats.append({'type':layout['name'],'typeHash':type_hash,'blocks':number,'elements':total,'bytes':offset-start})
complete=ci==count_len
if complete: assert offset==header,(ci,count_len,offset,header)
def decode(block):
    layout=layouts[block['typeHash']];out=[]
    for i in range(block['count']):
        row={};at=16+block['offset']+layout['size']*i
        for name,typ,count,off in layout['fields']:
            fmt,size,align=scalar[typ]
            if typ=='Guid': value=str(uuid.UUID(bytes_le=data[at+off:at+off+16]))
            elif count>16: value={'bytes':count*size,'sha256':hashlib.sha256(data[at+off:at+off+count*size]).hexdigest()}
            else:
                values=struct.unpack_from('<'+fmt*count,data,at+off);value=values[0] if count==1 else list(values)
                if typ=='u64':value=str(value) if count==1 else [str(x) for x in value]
            row[name]=value
        out.append(row)
    return out
summary={'evidenceId':'LOCAL-RVM-001','source':meta,'sourceSha256':hashlib.sha256(data[16:]).hexdigest(),
         'reference':'https://github.com/ArmchairDevelopers/Glacier/tree/5ff0ddb0215eaf9d31b79b458fbb08cdfca2f090',
         'metadataPrepended':True,'headerOffsetInResource':header-16,'blockCount':ci,'types':stats,
         'complete':complete,'unrecognizedTypeHashes':missing,'totalDeclaredBlocks':count_len,
         'layoutCoverage':'complete byte coverage; profile-specific opaque layouts retained without assigning field semantics' if complete else 'known-type prefix only; stopped before first unrecognized type, no guessed sizes',
         'hashCollisions':collisions,'limitations':['Shader execution and semantic translation remain unverified.','Hash references are encoded values, not native pointers.']}
(out/'summary.json').write_text(json.dumps(summary,indent=2))
(out/'block-index.json').write_text(json.dumps({'blocks':blocks,'layouts':layouts}))
selected={k:{**v,'values':decode(v)} for k,v in blocks.items() if v['type'].endswith(('SurfaceShader','ShaderStreamableTexture','ShaderStreamableExternalTexture','ShaderStreamableTextureRef','ShaderStreamableExternalTextureRef','ParamDbKeyRef','SerializedParamDbKey','DefaultValueRef','ValueRef','Vec','Float'))}
(out/'material-blocks.json').write_text(json.dumps(selected))
print(json.dumps({'types':len(stats),'blocks':ci,'bytes':offset-16,'selectedBlocks':len(selected),'collisions':len(collisions)}))
