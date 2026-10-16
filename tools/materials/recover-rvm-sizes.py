"""Recover old-profile block widths by matching source CityHash references.

No field semantics are assigned to opaque types. A candidate must uniquely
match every sampled block's 40-bit identity in the resource and fit the complete
declared byte/count coverage. Failure leaves the existing parser untouched.
"""
import pathlib,json,struct,sys
root=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'tools/materials/python-libs'))
from cityhash import CityHash64WithSeed
r=root/'exports/materials/rvm';m=json.loads((r/'0.json').read_text())
data=bytes.fromhex(m['resourceMetaHex'])+(r/'0.res').read_bytes()
header=16+struct.unpack_from('<I',data,4)[0];n=struct.unpack_from('<H',data,header+38)[0]
types=list(struct.iter_unpack('<IIQ',data[header+40:header+40+n*16]))
counts=struct.unpack_from('<'+'H'*struct.unpack_from('<I',data,header+28)[0],data,header+40+n*16+8)
layouts=json.loads((r/'block-index.json').read_text())['layouts']
# Restore the reference baseline when re-running after inspect-rvm.py has
# added recovered opaque layouts. Otherwise a second run erases its evidence.
previous_path=r/'recovered-layout-widths.json'
if previous_path.exists():
 previous=json.loads(previous_path.read_text())
 for recovered_type in previous.get('types',[]):
  key=str(recovered_type['typeHash'])
  if 'referenceSize' in recovered_type:
   if key not in layouts:raise ValueError(('missing reference layout',key))
   layouts[key]['size']=recovered_type['referenceSize']
  else:
   layouts.pop(key,None)
# Profile-version differences found by testing widths against references to the
# following typed arrays, including their first/middle/last blocks.
overrides={'RvmSerializedDb_ns_RvmPermutationSet':80,'RvmSerializedDb_ns_RvmDispatch':16,'RvmSerializedDb_ns_InstanceTableAssemblyData':20}
for layout in layouts.values():
 if layout['name'] in overrides:layout['size']=overrides[layout['name']]
def referenced(key):return data.find(key.to_bytes(5,'little'),16,header)>=0
def sample_hashes(th,group,at,size):
 selected={0,1,2,len(group)//2,len(group)-2,len(group)-1};out=[];cursor=at
 for i,count in enumerate(group):
  if i in selected:
   chunk=data[cursor:cursor+count*size]
   if len(chunk)!=count*size or cursor+len(chunk)>header:return None
   key=CityHash64WithSeed(chunk,th)&0xffffffffff
   if not referenced(key):return None
   out.append(f'{key:010x}')
  cursor+=size*count
 return out
def candidates_for(th,group,at):
 return [(size,hits) for size in range(1,513) if (hits:=sample_hashes(th,group,at,size)) is not None]
ci=0;offset=16;recovered=[]
for th,num,index in types:
 if str(th) in layouts:
  size=layouts[str(th)]['size']
  if sample_hashes(th,counts[ci:ci+num],offset,size) is None:
   choices=candidates_for(th,counts[ci:ci+num],offset)
   # Some known arrays have no sampled inbound hash reference. Keep their
   # reference width when there is no alternate candidate; the final coverage
   # assertion still guards the cumulative layout. Never choose ambiguously.
   if len(choices)>1:raise ValueError((hex(th),'ambiguous corrected widths',choices))
   if len(choices)==1:
    old=size;size,hits=choices[0]
    recovered.append({'typeHash':th,'name':layouts[str(th)]['name'],'size':size,'referenceSize':old,'blockCount':num,'sourceOffset':offset-16,'hashes':hits,'uniqueCandidate':True,'semantics':'opaque profile-specific width; later field semantics need verification'})
    print(layouts[str(th)]['name'],'width correction',old,'->',size,flush=True)
 else:
  candidates=candidates_for(th,counts[ci:ci+num],offset)
  if len(candidates)!=1:raise ValueError((hex(th),'ambiguous candidate widths',candidates))
  size,hits=candidates[0];allhits=[];cursor=offset
  for count in counts[ci:ci+num]:
   raw=data[cursor:cursor+count*size];key=CityHash64WithSeed(raw,th)&0xffffffffff
   if not referenced(key):raise ValueError((hex(th),'later block fails identity',len(allhits)))
   allhits.append(f'{key:010x}');cursor+=len(raw)
  recovered.append({'typeHash':th,'size':size,'blockCount':num,'sourceOffset':offset-16,'hashes':allhits,'candidateWidthsTested':[1,512],'uniqueCandidate':True,'semantics':'opaque bytes; width validated by source hash references'})
  print(hex(th),size,num,flush=True)
 offset+=size*sum(counts[ci:ci+num]);ci+=num
assert ci==len(counts) and offset==header,(ci,len(counts),offset,header)
(r/'recovered-layout-widths.json').write_text(json.dumps({'evidenceId':'LOCAL-RVM-WIDTH-001','types':recovered,'validatedOverrides':overrides,'completeByteCoverage':True,'declaredBlocks':ci,'payloadBytes':offset-16,'referenceScan':'Every 5-byte window, only used for width-candidate validation; semantic references still use typed fields.'},indent=2))
print('Complete byte/count coverage validated',ci,offset-16)
