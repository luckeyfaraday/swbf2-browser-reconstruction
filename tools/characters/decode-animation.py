"""Recover scoped raw ANT clips using shipped REF2 layouts and RigAsset DOF tables.

All bytes remain unchanged. This converts only RawAnimationAsset, rejects unknown
channel layouts, verifies counts/norms, and preserves source root movement separately.
"""
import json, math, pathlib
from importlib.machinery import SourceFileLoader
base=pathlib.Path(__file__).resolve().parent
select=SourceFileLoader('select_animation',str(base/'select-animation.py')).load_module()
bank=select.AnimationBank('exports/characters/ant-common-bank')
rig=bank.objects['4df8f37fade10ee2']['values']
ids=bank.array(rig['DofIds']);dofs={}
for key,offset in zip(bank.array(rig['RigDofSets']),bank.array(rig['DofSetIdIndices'])):
 layout=bank.objects[key]['values']
 if 'Slots' not in layout:continue
 for n,slot in enumerate(bank.array(layout['Slots'])):
  dofs[ids[offset+n]]={**slot,'layout':layout['__name'],'layoutKey':key}

def decode(key,alias):
 anim=bank.objects[key];v=anim['values']
 if anim['type']!='RawAnimationAsset':raise ValueError('Only raw codec is supported')
 controller=next(o['values'] for o in bank.objects.values() if o['type']=='ClipControllerAsset' and o['values']['Anim']==key)
 mapping,_,_=bank.channels(anim);indices=bank.array(v['MappingIndices']);reverse=bank.array(v['ChannelIndices'])
 if sorted(indices)!=list(range(len(mapping))) or any(reverse[indices[i]]!=i for i in range(len(indices))):raise ValueError('Unexpected channel permutation')
 counts=[v[k] for k in ['QuatCount','Vec3Count','FloatCount','ConstQuatCount','ConstVec3Count','ConstFloatCount']]
 q,t,f,cq,ct,cf=counts;stride=q*4+t*4+f;cstride=cq*4+ct*4+cf
 raw=bank.array(v['Data']);constant=bank.array(v['ConstData']);frames=bank.array(v['KeyTimes']);times=[x/controller['FPS'] for x in frames]
 if len(raw)!=stride*v['NumKeys'] or len(constant)!=cstride or sum(counts)!=len(mapping):raise ValueError('Sample dimensions disagree')
 if len(times)!=v['NumKeys'] or any(a>=b for a,b in zip(times,times[1:])):raise ValueError('Key times are not strictly increasing')
 tracks=[];unmapped=[];normerrors=[]
 for sourceindex,dofid in enumerate(mapping):
  slot=dofs.get(dofid);index=reverse[sourceindex];const=index>=q+t+f
  if const:index-=q+t+f;qs,ts,fs=cq,ct,cf;data=constant
  else:qs,ts,fs=q,t,f;data=raw
  if index<qs:offset=index*4;size=4;prop='rotation'
  elif index<qs+ts:offset=qs*4+(index-qs)*4;size=3;prop='translation'
  else:offset=qs*4+ts*4+(index-qs-ts);size=1;prop='scalar'
  values=[data[offset+k*stride:offset+k*stride+size] for k in range(1 if const else len(frames))]
  if any(not math.isfinite(x) for row in values for x in row):raise ValueError('Nonfinite motion sample')
  if prop=='rotation':normerrors.extend(abs(sum(x*x for x in row)-1) for row in values)
  if not slot:unmapped.append({'dofId':dofid,'property':prop});continue
  expected=14 if prop=='rotation' else 2049856663 if prop=='translation' else 10
  if slot['type']!=expected:raise ValueError(f'Unexpected channel type {slot}')
  name=slot['name'];bone=name.rsplit('.',1)[0]
  tracks.append({'bone':bone,'property':prop,'sourceDofId':dofid,'sourceSlot':slot,'constant':const,'values':values})
 if max(normerrors,default=0)>0.0001:raise ValueError(f'Invalid decoded quaternion norm {max(normerrors)}')
 return {'name':alias,'sourceName':controller['__name'],'sourceAnimationKey':key,'controller':controller,'additive':anim['base']['values']['Additive'],'cycle':v['Cycle'],'duration':times[-1],'times':times,'tracks':tracks,'unmapped':unmapped,'maxQuaternionNormError':max(normerrors,default=0),'rawCounts':counts}

if __name__=='__main__':
 clips=[decode('93cd7e2421fcf133','rifle-stand'),decode('7c023e6986eba231','rifle-run'),decode('a78ea32a5c4959c5','rifle-idle-additive')]
 out={'evidenceId':'CHAR-ANIM-002','sourceBank':bank.metadata['source'],'sourceSha256':bank.metadata['sha256'],'sourceRig':rig['__name'],'clips':clips,'limitations':['Raw ANT samples and channel names decoded and dimension/norm checked. Controller TimeScale semantics and complete animation graph blending are unverified.','Runtime root motion removal, duplicate Spine DOF selection, and materialized clip timing must be validated visually.','Non-bone scalar channels, procedural rig features, IK, DCT/VBR clips, firing and death clips remain unimplemented.']}
 path=select.ROOT/'exports/characters/animation-selected/raw-clips.json';path.write_text(json.dumps(out,separators=(',',':')))
 print(json.dumps({'output':str(path),'bytes':path.stat().st_size,'clips':[{k:c[k] for k in ['name','duration','rawCounts','unmapped','maxQuaternionNormError']} for c in clips]},indent=2))
