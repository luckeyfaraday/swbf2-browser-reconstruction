"""Publish unchanged native mip samples and independently checked UV1 sidecars."""
import hashlib,json,pathlib,struct,subprocess
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/corvette-damage-bounded-textures';PUBLIC=ROOT/'web/public/assets/textures/corvette-damage'
OUT.mkdir(exist_ok=True);PUBLIC.mkdir(parents=True,exist_ok=True)
report=json.loads((ROOT/'exports/materials/corvette-damage-shader/material-analysis.json').read_text());sources={};sha=lambda b:hashlib.sha256(b).hexdigest()
for manifest in sorted((ROOT/'exports/materials').glob('*/texture.manifest.json')):
 for row in json.loads(manifest.read_text()).get('results',[]):
  if row.get('guid')in report['sourceTextures'] and (manifest.parent/row['file']).exists():sources[row['guid']]=(manifest.parent/row['file'],row)
assert set(sources)==set(report['sourceTextures'])
provenance={}
for source,row in sources.values():
 raw=source.read_bytes();assert raw[:4]==b'DDS 'and raw[84:88]==b'DX10'
 height,width=struct.unpack_from('<II',raw,12);mips=struct.unpack_from('<I',raw,28)[0];dxgi,dimension,misc,layers=struct.unpack_from('<IIII',raw,128)
 assert dimension==3 and misc==0 and dxgi in(28,29,71,72,77,78,83,98,99)
 compressed=dxgi not in(28,29)
 def size(w,h):return max(1,(w+3)//4)*max(1,(h+3)//4)*(8 if dxgi in(71,72)else 16) if compressed else w*h*4
 dimensions=[];w,h=width,height
 for _ in range(mips):dimensions.append((w,h,size(w,h)));w,h=max(1,w//2),max(1,h//2)
 slice_size=sum(n for _,_,n in dimensions);assert len(raw)==148+slice_size*layers
 # Ten layers use existing native mip1 (512 squared): 10MiB decoded GPU data.
 limit=512 if layers>1 else 1024;skip=next(i for i,(w,h,_)in enumerate(dimensions)if max(w,h)<=limit)
 width,height,_=dimensions[skip];prefix=sum(n for _,_,n in dimensions[:skip]);count=sum(n for _,_,n in dimensions[skip:]);slices=[];array_bytes=bytearray()
 for layer in range(layers):
  offset=148+slice_size*layer+prefix;header=bytearray(raw[:148]);struct.pack_into('<II',header,12,height,width);struct.pack_into('<I',header,20,size(width,height)if compressed else width*4);struct.pack_into('<I',header,28,mips-skip);struct.pack_into('<I',header,140,1)
  selected=bytes(header)+raw[offset:offset+count];stem=row['guid']+(f'-layer{layer}'if layers>1 else'');dds,png=OUT/(stem+'.dds'),OUT/(stem+'.png');changed=not dds.exists()or dds.read_bytes()!=selected
  if changed:dds.write_bytes(selected)
  if changed or not png.exists():subprocess.run([str(ROOT/'tools/bf2-extract/bf2-extract.exe'),'dds-png','--input',str(dds),'--out',str(png)],cwd=ROOT,check=True,capture_output=True)
  pixels=png.read_bytes();assert struct.unpack_from('>II',pixels,16)==(width,height)
  slices.append({'layer':layer,'selectedDdsPath':dds.relative_to(ROOT).as_posix(),'selectedDdsSha256':sha(selected),'sourceDataOffset':offset,'retainedDataBytes':count,'pngPath':png.relative_to(ROOT).as_posix(),'pngSha256':sha(pixels)})
  if layers>1:
   with Image.open(png)as image:rgba=image.convert('RGBA').tobytes()
   slices[-1].update({'decodedRgbaSha256':sha(rgba),'decodedByteOffset':len(array_bytes),'decodedBytes':len(rgba)})
   array_bytes.extend(rgba)
  else:target=PUBLIC/(stem+'.png');target.write_bytes(pixels)
 if layers>1:
  assert layers==2 and dxgi==98 and len(array_bytes)==width*height*layers*4
  target=PUBLIC/(row['guid']+'.rgba8.bin');target.write_bytes(array_bytes)
 provenance[row['guid']]={'source':report['sourceTextures'][row['guid']],'sourceMetadata':row['metadata'],'sourceDdsPath':source.relative_to(ROOT).as_posix(),'sourceDdsSha256':sha(raw),'sourceMip':skip,'width':width,'height':height,'layers':layers,'dxgiFormat':dxgi,'colorSpace':'srgb'if dxgi in(29,72,78,99)else'linear','url':'/assets/textures/corvette-damage/'+target.name,'sha256':sha(target.read_bytes()),'bytes':target.stat().st_size,'format':'rgba8-array'if layers>1 else'png','slices':slices,'operation':'Select existing native DDS mip and preserve compressed source bytes; historical native DDS-to-PNG decode; array concatenates decoded RGBA8 layers without resize/channel edits. Browser lower mipmaps regenerate.'}
def glb_accessors(path,primitive):
 b=path.read_bytes();length=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+length]);binary=b[28+length:];p=j['meshes'][0]['primitives'][primitive]
 def attr(i):
  a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];at=v.get('byteOffset',0)+a.get('byteOffset',0);components={'VEC2':2,'SCALAR':1}[a['type']];assert a['componentType']in(5125,5126)and'byteStride'not in v
  return binary[at:at+a['count']*components*4]
 return attr(p['attributes']['TEXCOORD_0']),attr(p['indices'])
scene=json.loads((ROOT/'web/public/assets/map.scene.json').read_text());lods=json.loads((ROOT/'web/public/assets/source-lods.json').read_text());paths={(a['id'],0):ROOT/'web/public/assets'/a['url']for a in scene['assets']}
for a in lods['assets']:
 for level in a['lods']:paths[a['assetId'],level['level']]=ROOT/'web/public'/level['url'].lstrip('/')
def fingerprint(b):
 h=2166136261
 for n in b:h=((h^n)*16777619)&0xffffffff
 return h

vertex=json.loads((ROOT/'exports/materials/corvette-damage-vertex/manifest.json').read_text());vertex_bytes=bytearray();records=[]
recipes={(m['assetId'],m['materialId'])for m in report['materials']}
for r in vertex['records']:
 if (r['assetId'],r['sourceMaterialId'])not in recipes:continue
 path=paths[r['assetId'],r['sourceLod']];uv0,indices=glb_accessors(path,r['primitiveIndex']);assert sha(uv0)==r['uv0Sha256']and sha(indices)==r['indexSha256'],(path,r['primitiveIndex'])
 selected={a['usage']:a for a in r['extraAttributes']};values={}
 for name in ['TexCoord1','Color0','SubMaterialIndex']:
  a=selected[name];raw=(ROOT/'exports/materials/corvette-damage-vertex'/a['file']).read_bytes();assert sha(raw)==a['sha256'];values[name]=list(struct.iter_unpack('<'+str(a['components'])+'f',raw))
 packed=bytearray()
 for uv,color,sub in zip(values['TexCoord1'],values['Color0'],values['SubMaterialIndex']):
  assert int(sub[0])==sub[0]and 0<=sub[0]<8
  packed.extend(struct.pack('<4f',uv[0],uv[1],color[0],sub[0]))
 assert len(packed)==r['vertexCount']*16
 # D3D and GL provoking-vertex conventions agree when each triangle carries
 # one submaterial index, as all selected original/source LOD primitives do.
 ids=[v[0]for v in struct.iter_unpack('<I',indices)]
 for start in range(0,len(ids),3):
  assert len({values['SubMaterialIndex'][n][0]for n in ids[start:start+3]})==1
 records.append({**r,'glbPath':path.relative_to(ROOT).as_posix(),'glbSha256':sha(path.read_bytes()),'byteOffset':len(vertex_bytes),'byteLength':len(packed),'packedSha256':sha(packed),'uv0Fingerprint':fingerprint(uv0),'indexFingerprint':fingerprint(indices)})
 vertex_bytes.extend(packed)
assert len(records)==10
vertex_path=ROOT/'web/public/assets/corvette-damage-vertex.bin';vertex_path.write_bytes(vertex_bytes)
materials=[{**m,'textures':{role:provenance[b['texture']['fileGuid']]['url']for role,b in m['bindings'].items()}}for m in report['materials']]
document={k:report[k]for k in ['evidenceId','shaderName','shaderNameHash','shaderGuid','pixelShader','pixelShaderSha256','pairedVertexShader','pairedVertexShaderSha256','sourceRvmSha256','textureMapping','constantMapping','sourceLiterals','limitations','placedSectionCount','visibleCoverage','nativeMaterialModel','nativeLightingInputs','uvRouting','samplerMapping']}
document.update({'materials':materials,'sourceTextures':provenance,'vertexInputs':{'evidenceId':vertex['evidenceId'],'url':'/assets/corvette-damage-vertex.bin','sha256':sha(vertex_bytes),'byteLength':len(vertex_bytes),'components':['original UV1.x','original UV1.y','original Color0.r','original SubMaterialIndex.x'],'records':records},'runtimeMapping':{'color':'Original source damage color equation, unsaturated damage=Color0.r*(1+wreck.a).','roughness':'1-clamp(native smoothness,0,1); explicit browser conversion.','metalness':'Original normal texture blue; ordinaryID0/reflectance.5 means dielectricF0=.04.','normal':'Source normal/detail mixture with unsaturated damage; normalize world normal beforeSH; derivative frame of UV0 remains approximation.','uvRouting':report['uvRouting']['browserAssociation'],'arrayLayer':'Eight-entry source table selected by original flat SubMaterialIndex.x. All retained source table defaults x=0; no invented layer remapping.','emissive':'None.','ao':'None in selected producer.','mipSelection':'Existing native mip1 for two-layer array512x512; largest existing native mip<=1024 for four2D textures. Lower browser mips regenerate.'}})
glsl=(ROOT/'tools/materials/corvette-damage-equations.glsl').read_text();document['sourceEquationSha256']=sha(glsl.encode())
(ROOT/'web/public/assets/recovered-corvette-damage-materials.json').write_text(json.dumps(document,indent=2));(OUT/'provenance.json').write_text(json.dumps(provenance,indent=2))
template=(ROOT/'tools/materials/corvette-damage-adapter.template.js').read_text();(ROOT/'web/src/corvette-damage-material.js').write_text(template.replace('__CORVETTE_DAMAGE_GLSL__',json.dumps(glsl)))
print(json.dumps({'materials':len(materials),'textures':len(provenance),'sourceVertexRecords':len(records),'vertexBytes':len(vertex_bytes),'textureBytes':sum(p['bytes']for p in provenance.values())}))
