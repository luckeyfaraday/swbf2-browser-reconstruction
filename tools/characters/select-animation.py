import json, pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[2]
class AnimationBank:
 def __init__(self,folder):
  self.folder=ROOT/folder;self.metadata=json.loads((self.folder/'bank-inventory.json').read_text());self.data=(self.folder/'0.res').read_bytes()
  self.objects={s['object']['values'].get('__key'):s['object'] for s in self.metadata['sections'] if 'object'in s}
  self.classes={c['name']:c for c in self.metadata['classes']}
 def array(self,desc):
  typ=desc['elementType'];count=desc['count'];at=desc['arrayOffset'];b=self.data
  if typ=='Key':return [f'{x:016x}' for x in struct.unpack_from('<'+'Q'*count,b,at)]
  if typ=='LayoutEntry':
   result=[];cl=self.classes[typ];size=(cl['size']+cl['alignment']-1)//cl['alignment']*cl['alignment']
   for n in range(count):
    offset=at+n*size;chars=struct.unpack_from('<I',b,offset+4)[0];textoff=offset+8+struct.unpack_from('<i',b,offset+8)[0]
    result.append({'name':b[textoff:textoff+chars].rstrip(b'\0').decode(),'type':struct.unpack_from('<I',b,offset+16)[0]})
   return result
  formats={'UInt32':'I','UInt16':'H','Int16':'h','Float':'f','UInt8':'B'}
  return list(struct.unpack_from('<'+formats[typ]*count,b,at))
 def channels(self,animation):
  base=animation['base']['values'];mapping=self.array(self.objects[base['ChannelToDofAsset']]['values']['DofIds']);hierarchy=self.objects[base['DofSetList']]['values'];layouts=self.array(hierarchy['LayoutAssets']);slots=[]
  for key in layouts:
   layout=self.objects[key]
   if layout['type']=='LayoutAsset':slots.extend(self.array(layout['values']['Slots']))
  return mapping,slots,layouts
if __name__=='__main__':
 bank=AnimationBank('exports/characters/ant-common-bank')
 for name in ['C_HM_Rifle_Run_Fwd_01','HM_AI_Rifle_Aim_Stand_Fwd','P_HM_AI_Rifle_Aim_Stand_Fwd','Add_HM_Rifle_Stand_FireLoop_03','Add_HM_Rifle_StandIdleLoop_01']:
  for c in bank.objects.values():
   if c['type']!='ClipControllerAsset' or c['values']['__name']!=name:continue
   anim=bank.objects[c['values']['Anim']];m,slots,layouts=bank.channels(anim);v=anim['values'];out={'controller':c,'animation':anim,'mappings':m,'slots':slots,'indices':{key:bank.array(v[key]) for key in ['MappingIndices','ChannelIndices','KeyTimes'] if key in v}}
   dest=ROOT/'exports/characters/animation-selected';dest.mkdir(exist_ok=True);(dest/(name+'-'+v['__key']+'.json')).write_text(json.dumps(out,indent=2));print(name,anim['type'],'additive',anim['base']['values']['Additive'],'keys',v.get('NumKeys'),'counts',[v.get(k) for k in ['QuatCount','Vec3Count','FloatCount','ConstQuatCount','ConstVec3Count','ConstFloatCount']],'channels',len(m),'slots',len(slots),'maxdof',max(m),'sample',[slots[i] if i<len(slots) else i for i in m[:8]])
