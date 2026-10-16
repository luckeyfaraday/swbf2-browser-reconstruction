"""Bounded, read-only GD.REF2/GD.DAT2 inventory for the selected BF2 animation bank.

REFL layout research reference: marv7000/AssetBankPlugin (GPL-3.0),
GenericData/SectionRefl.cs and Extensions/NativeReaderExtensions.cs.
This parser adapts the observed REF2 header and tagged relative offsets. It does
not claim to decode animation samples until DAT2/channel semantics are verified.
"""
import argparse, collections, hashlib, json, pathlib, struct

def inspect(file):
    b=file.read_bytes()
    u32=lambda p:struct.unpack_from('<I',b,p)[0]
    i32=lambda p:struct.unpack_from('<i',b,p)[0]
    ptr=lambda p:struct.unpack_from('<i',b,p)[0]
    def text(p):
        end=b.index(0,p)
        return b[p:end].decode('utf-8',errors='replace')
    start=4+struct.unpack_from('>I',b,4)[0]
    if b[start:start+8]!=b'GD.STRMl':raise ValueError('Unexpected outer stream')
    pos=start+16; sections=[];classes={}
    while pos<len(b):
        kind=b[pos:pos+8].decode('ascii');size=u32(pos+8)
        if not kind.startswith('GD.') or size<16 or pos+size>len(b):raise ValueError(f'Invalid section {pos} {kind} {size}')
        row={'offset':pos,'type':kind,'bytes':size}
        if kind=='GD.REF2l':
            count=u32(pos+12);base=pos+20
            if count>10000:raise ValueError('Excessive class count')
            for n in range(count):
                at=base+n*8+ptr(base+n*8)
                lo,hi=i32(at),i32(at+4);fields=hi-lo+1
                if fields<0 or fields>10000:raise ValueError('Invalid field count')
                table=at+u32(at+16)
                name=text(table+1)
                data={'name':name,'offset':at,'size':u32(at+8),'alignment':u32(at+12),'hash':u32(at+28),'fields':[]}
                for j in range(fields):
                    f=at+32+j*32
                    data['fields'].append({'typeHash':u32(f),'size':u32(f+4),'offset':u32(f+8),'name':text(table+u32(f+12)),'count':struct.unpack_from('<H',b,f+16)[0],'flags':struct.unpack_from('<H',b,f+18)[0],'layoutOffset':f+24+ptr(f+24)})
                classes[data['hash']]=data
            row['classes']=count
        elif kind=='GD.DAT2l':
            row['headerWords']=[u32(pos+n) for n in range(12,48,4)]
        sections.append(row);pos+=size
    for c in classes.values():
        for f in c['fields']:f['type']=classes.get(f['typeHash'],{}).get('name')
    def value(at,field,begin,end):
        typ=field['type']
        if field['flags']==1 or typ=='String':
            cap,count=u32(at),u32(at+4);offset=at+8+ptr(at+8)
            cl=classes[field['typeHash']]
            byte_size=1 if typ=='String' else ((cl['size']+cl['alignment']-1)//cl['alignment']*cl['alignment'])
            if count>cap or count>10000000 or (count and not begin<=offset<=offset+count*byte_size<=end):raise ValueError(f'Out of bounds {typ} array: {offset}, count={count}')
            if typ=='String':return b[offset:offset+count].rstrip(b'\0').decode('utf-8',errors='replace')
            return {'arrayOffset':offset,'count':count,'byteLength':count*byte_size,'elementType':typ}
        if typ=='DataRef':return {'referenceOffset':at+ptr(at) if ptr(at) else None}
        if typ in ('Key','Int64'):return f'{struct.unpack_from("<Q",b,at)[0]:016x}'
        formats={'Bool':'?','Int8':'b','UInt8':'B','Int16':'h','UInt16':'H','Int32':'i','UInt32':'I','Float':'f','Double':'d'}
        if typ not in formats:return {'unknownType':typ,'offset':at,'size':field['size']}
        return struct.unpack_from('<'+formats[typ],b,at)[0]
    def object_at(header,begin,end):
        typ=u32(header+16);cl=classes[typ];base=header+struct.unpack_from('<H',b,header+28)[0]
        if not begin<=base<=base+cl['size']<=end:raise ValueError('Object extends outside data section')
        values={f['name']:value(base+f['offset'],f,begin,end) for f in cl['fields']}
        return {'type':cl['name'],'headerOffset':header,'dataOffset':base,'values':values}
    for row in sections:
        if row['type']!='GD.DAT2l':continue
        root=object_at(row['offset']+12,row['offset'],row['offset']+row['bytes']);row['object']=root
        parent=root['values'].get('__base',{}).get('referenceOffset')
        if parent:root['base']=object_at(parent,row['offset'],row['offset']+row['bytes'])
    counts=collections.Counter(r['object']['type'] for r in sections if 'object' in r)
    return {'evidenceId':'CHAR-ANT-001','source':str(file),'sha256':hashlib.sha256(b).hexdigest(),'size':len(b),'packagingType':struct.unpack_from('>I',b,0)[0],'streamOffset':start,'sectionCounts':dict(collections.Counter(s['type'] for s in sections)),'objectCounts':dict(counts),'classes':list(classes.values()),'sections':sections,'limitations':['DAT2 object values and bounded array ranges decoded. Motion codec samples and channel-to-skeleton association remain unverified; no animation clips exported.']}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('input',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);p.add_argument('--compact',action='store_true');a=p.parse_args();r=inspect(a.input);a.output.write_text(json.dumps(r,indent=None if a.compact else 2,separators=(',',':') if a.compact else None));print(json.dumps({'sections':r['sectionCounts'],'objects':r['objectCounts'],'classes':len(r['classes'])}))
