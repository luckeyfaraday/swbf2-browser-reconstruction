"""Convert installed texture channels and bind them without altering GLB geometry.

Use Python 3.11 (Pillow/numpy). No install files are written. Source shader parity
is explicitly incomplete; output is a reviewable first material pass.
"""
import argparse,pathlib,json,struct,hashlib,math
from PIL import Image
import numpy as np
root=pathlib.Path(__file__).resolve().parents[2]
ap=argparse.ArgumentParser();ap.add_argument('--plan',default='exports/materials/map-material-plan.json');ap.add_argument('--textures',default='exports/materials/map-textures');ap.add_argument('--source',default='exports/map-initial/meshes');ap.add_argument('--target',default='web/public/assets/meshes');ap.add_argument('--filenames',action='store_true');ap.add_argument('--max-size',type=int,default=1024);args=ap.parse_args()
plan=json.loads((root/args.plan).read_text());texroot=root/args.textures
textureManifest=json.loads((texroot/'texture.manifest.json').read_text());sources={t['guid']:t for t in textureManifest['results']}
target=root/args.target;target.mkdir(parents=True,exist_ok=True);textureTarget=target.parent/'textures';textureTarget.mkdir(exist_ok=True)
converted={};records=[];errors=[]
def texture(binding,role):
 guid=binding['texture']['fileGuid'];key=(guid,role)
 if key in converted:return converted[key]
 source=sources.get(guid)
 if source is None:raise ValueError('Texture not exported: '+binding['texture']['name'])
 path=(texroot/source['file']).with_suffix('.png');im=Image.open(path).convert('RGBA');size=im.size
 if max(size)>args.max_size:im.thumbnail((args.max_size,args.max_size),Image.Resampling.LANCZOS)
 array=np.asarray(im).copy();notes=[]
 if role=='normal':
  xy=array[:,:,:2].astype(np.float32)/127.5-1.0;z=np.sqrt(np.maximum(0,1-np.sum(xy*xy,axis=2)));array[:,:,2]=np.clip((z*.5+.5)*255,0,255).astype(np.uint8);array[:,:,3]=255
  notes.append('Reconstruct positive normal Z from source RG, following Frosty MeshFallback SWBF2 branch; tangent orientation still unverified.')
 elif role=='roughness':
  smooth=array[:,:,3].copy();array[:,:,:]=255;array[:,:,1]=255-smooth;array[:,:,2]=0
  notes.append('CS alpha interpreted as smoothness using Frosty SWBF2 preview semantics; roughness=1-smoothness, metallic=0 provisional.')
 elif role=='baseColor' and binding['parameter'].lower().strip('_')!='ca':array[:,:,3]=255
 name=f'{guid}-{role}.png';output=textureTarget/name;Image.fromarray(array).save(output,optimize=True)
 records.append({'source':binding['texture'],'sourcePngSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'pixelFormat':source['metadata']['pixelFormat'],'originalSize':size,'outputSize':im.size,'role':role,'file':str(output.relative_to(root)),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'notes':notes})
 converted[key]='../textures/'+name;return converted[key]
written=[]
for mesh in plan['meshes']:
 try:
  path=root/args.source/mesh['sourceFile'];data=path.read_bytes();magic,version,total=struct.unpack_from('<III',data);assert magic==0x46546c67 and version==2 and total==len(data)
  length,kind=struct.unpack_from('<II',data,12);assert kind==0x4e4f534a;doc=json.loads(data[20:20+length]);rest=data[20+length:]
  materialPlan={m['index']:m for m in mesh['materials']};doc['images']=[];doc['textures']=[];doc['samplers']=[{'wrapS':10497,'wrapT':10497,'magFilter':9729,'minFilter':9987}];imageMap={}
  def addtex(binding,role):
   uri=texture(binding,role)
   if uri not in imageMap:
    imageMap[uri]=len(doc['images']);doc['images'].append({'uri':uri});doc['textures'].append({'sampler':0,'source':imageMap[uri]})
   return {'index':imageMap[uri],'texCoord':0}
  for mat in doc.get('materials',[]):
   index=mat.get('extras',{}).get('sourceMaterialId',0);p=materialPlan.get(index);chosen=p['chosen'] if p else {};pbr=mat.setdefault('pbrMetallicRoughness',{})
   pbr.update(baseColorFactor=[.28,.29,.31,1],metallicFactor=0,roughnessFactor=.75)
   if 'baseColor' in chosen:
    pbr['baseColorTexture']=addtex(chosen['baseColor'],'baseColor');pbr['baseColorFactor']=[1,1,1,1]
    param=chosen['baseColor']['parameter'].lower().strip('_')
    if param in {'cs','cs_textcoord0','coloursmoothness','base_cs_input','tiling_cs_input'}:pbr['metallicRoughnessTexture']=addtex(chosen['baseColor'],'roughness');pbr['roughnessFactor']=1
    if param=='ca':mat.update(alphaMode='MASK',alphaCutoff=.5)
   if 'normal' in chosen:mat['normalTexture']=addtex(chosen['normal'],'normal')
   if 'emissive' in chosen:mat['emissiveTexture']=addtex(chosen['emissive'],'emissive');mat['emissiveFactor']=[1,1,1]
   if 'occlusion' in chosen:mat['occlusionTexture']=addtex(chosen['occlusion'],'occlusion')
   mat.setdefault('extras',{}).update(placeholder=not bool(chosen.get('baseColor')),sourceBindings=chosen,neutralColorApproximation=not bool(chosen.get('baseColor')),shaderTranslation='partial PBR mapping; packed masks/variation overrides unresolved')
  doc.setdefault('extras',{})['materialConversion']={'evidence':'LOCAL-MATERIAL-PLAN-001','sourceGeometrySha256':hashlib.sha256(data).hexdigest(),'completeShaderParity':False,'textureSizeCap':args.max_size}
  if not doc['textures']:
   for key in ['images','textures','samplers']:doc.pop(key)
  encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
  out=target/(mesh['sourceFile'] if args.filenames else mesh['guid']+'.glb')
  out.write_bytes(struct.pack('<IIIII',magic,2,20+len(encoded)+len(rest),len(encoded),0x4e4f534a)+encoded+rest)
  written.append({'guid':mesh['guid'],'name':mesh['name'],'file':str(out.relative_to(root)),'materials':len(doc.get('materials',[])),'textures':len(doc.get('textures',[])),'geometryBufferUnchanged':rest==data[20+length:]})
 except Exception as ex:errors.append({'name':mesh['name'],'error':str(ex)})
report={'evidenceId':'LOCAL-MATERIAL-CONVERSION-001','meshes':written,'textures':records,'errors':errors,'completeRequestedConversion':not errors,'shaderFidelityComplete':False,'limitations':plan['limitations']}
(target/'material-conversion.json').write_text(json.dumps(report,indent=2));print(json.dumps({'meshes':len(written),'textures':len(records),'errors':errors[:8],'shaderFidelityComplete':False}))
if errors:raise SystemExit(1)
