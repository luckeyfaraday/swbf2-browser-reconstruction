"""Bounded original PE seeds for the exact RVM draw-state factory identity."""
import hashlib,json,pathlib,re,struct
ROOT=pathlib.Path(__file__).resolve().parents[2]
ns={'__file__':str(ROOT/'tools/materials/native-dfg-pe.py')}
exec(pathlib.Path(ns['__file__']).read_text().split('names =')[0],ns)
data,base,to_rva,to_offset,function=map(ns.__getitem__,['data','image_base','to_rva','to_offset','function'])
assert hashlib.sha256(data).hexdigest()=='d350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4'
names=[b'Dx11RvmLegacyDrawStateBuilderInstructionFactory',b'Dx11RvmApplyStateInstructionFactory',b'RvmSerializedDb_ns_BaseShaderState',b'RvmSerializedDb_ns_Dx11BlendStateData']
seeds=[]
for name in names:
 for hit in re.finditer(re.escape(name),data):
  start=data.rfind(b'\0',0,hit.start())+1;end=data.index(0,hit.start());value=data[start:end].decode('ascii');va=base+to_rva(start)
  seeds.append({'string':value,'address':hex(va),'fileOffset':start,'ripLeaCandidates':[],'absoluteReferences':[]})
by_va={int(s['address'],16):s for s in seeds}
for section in ns['sections']:
 if not section['characteristics']&0x20000000:continue
 chunk=data[section['offset']:section['offset']+section['size']]
 for hit in re.finditer(rb'[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]',chunk):
  at=section['offset']+hit.start();rva=section['rva']+hit.start();target=base+rva+7+struct.unpack_from('<i',data,at+3)[0]
  if target in by_va:by_va[target]['ripLeaCandidates'].append({'address':hex(base+rva),'bytes':data[at:at+7].hex(),'function':function(rva)})
for seed in seeds:
 for hit in re.finditer(re.escape(struct.pack('<Q',int(seed['address'],16))),data):
  seed['absoluteReferences'].append({'address':hex(base+to_rva(hit.start())),'fileOffset':hit.start(),'nearbyHex':data[hit.start()-16:hit.start()+64].hex()})
def read(va,n):at=to_offset(va-base);return data[at:at+n]
def q(va):return struct.unpack('<Q',read(va,8))[0]
assert q(0x144bf3570)==0x143451708
assert q(0x144bf35b8)==0x140ae9cb0
constructor=read(0x140ae9cb0,11);assert constructor[:3]==b'\x48\x8d\x05'and constructor[7:]==b'\x48\x89\x01\xc3'
assert 0x140ae9cb0+7+struct.unpack_from('<i',constructor,3)[0]==0x143246698
assert q(0x143246698)==0x141e72f1e
thunk=read(0x141e72f1e,6);assert thunk[:2]==b'\xff\x25'
assert 0x141e72f1e+6+struct.unpack_from('<i',thunk,2)[0]==0x142fbfd38
import_name_rva=q(0x142fbfd38);name_offset=to_offset(import_name_rva)+2
assert data[name_offset:data.index(0,name_offset)]==b'_purecall'
native_chain={'typeInfoAddress':'0x144bf3570','nameAddress':'0x143451708',
 'constructorPointerAddress':'0x144bf35b8','constructorAddress':'0x140ae9cb0','constructorBytes':constructor.hex(),
 'abstractVtableAddress':'0x143246698','methodThunkAddress':'0x141e72f1e','methodThunkBytes':thunk.hex(),
 'importPointerAddress':'0x142fbfd38','unboundImportName':'_purecall',
 'interpretation':'The retained reflected constructor installs an abstract purecall method. A concrete runtime registration/implementation is still required; this path does not reveal blend-state selection.'}
ranges=[(0x140ae9cb0,11),(0x141e72f1e,6),(0x145088110,222)]
functions=[{'start':hex(va),'byteLength':n,'sha256':hashlib.sha256(read(va,n)).hexdigest(),'decompilation':f'exports/rifle-trail/render-native-state/{va:x}.c'}for va,n in ranges]
report={'evidenceId':'LOCAL-BLASTER-BOLT-NATIVE-STATE-SEEDS-001','target':str(ns['TARGET']),'sha256':hashlib.sha256(data).hexdigest(),'seeds':seeds,'abstractFactoryChain':native_chain,'functions':functions,'limitations':['LEA matches require instruction-boundary corroboration. The byte-checked constructor and thunk chain is corroborated by retained Ghidra instructions.', 'String identity and abstract RTTI alone do not establish native blend-state selector semantics.']}
(ROOT/'exports/rifle-trail/render-shaders/render-material-native-state-seeds.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
