"""Resolve source material/texture identities; keep shader-semantic inferences explicit."""
import json, pathlib, collections, re, argparse, struct, sys
root=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'tools/materials/python-libs'))
from cityhash import CityHash64
ap=argparse.ArgumentParser();ap.add_argument('--mesh-manifest',default='exports/map-initial/meshes/mesh.manifest.json');ap.add_argument('--blocks',default='exports/materials/map-blocks/shader-blocks.json');ap.add_argument('--extra-graph',action='append',default=[]);ap.add_argument('--source',default='exports/map-initial/meshes');ap.add_argument('--mesh-info');ap.add_argument('--out',default='exports/materials/map-material-plan.json');a=ap.parse_args()
def load(p):return json.loads((root/p).read_text())
meshinfo={m['guid']:m for m in load(a.mesh_info)['results']} if a.mesh_info else {}
textures=load('exports/materials/texture-identities.json')['textures']+load('exports/materials/remaining-identities/texture-identities.json')['textures']
byroot={t['rootInstanceGuid']:t for t in textures};byfile={t['fileGuid']:t for t in textures}
db=load('exports/materials/'+next((root/'exports/materials/ebx').glob('*.json')).relative_to(root/'exports/materials').as_posix())['asset']['objects'][0]['Entries']
byMesh=collections.defaultdict(list)
for x in db:byMesh[x['Mesh']['$external']].append(x)
docs={}
for d in ['root','spatial-extra','spatial-extra2','spatial-extra3','spatial-extra4','spatial-extra5']:
 for f in (root/'exports/map-initial'/d/'ebx').glob('*.json'):
  j=json.loads(f.read_text());docs[j['entry']['guid']]=j
for d in a.extra_graph:
 for f in list((root/d).glob('*.ebx.json'))+list((root/d/'ebx').glob('*.json')):
  j=json.loads(f.read_text());docs[j['entry']['guid']]=j
blockdoc=load(a.blocks);blocks={b['source']['rid']:b for b in blockdoc['blocks']};blockroots=collections.defaultdict(list)
for r in blockdoc['roots']:blockroots[r['name'].split('_entry_')[0].lower()].append(r['resourceId'])
def walk(rid,seen=None):
 seen=set() if seen is None else seen
 if rid in seen:return []
 seen.add(rid);b=blocks[rid];out=[]
 for p in b.get('parameters',[]):
  if p.get('textureGuid'):
   t=byroot.get(p['textureGuid']) or byfile.get(p['textureGuid'])
   out.append({'parameter':p.get('name'),'parameterHash':p['nameHash'],'texture':t,'sourceBlock':rid,'sourceOffset':p['offset'],'identityBasis':'shader block ITexture GUID matched to EBX primary instance GUID'})
 for child in b.get('children',[]):out.extend(walk(child,seen))
 return out
def texparam(t,basis):
 ref=t['Value'] or {};return {'parameter':t['ParameterName'],'texture':byfile.get(ref.get('$external')),'identityBasis':basis,'reference':ref}
def role(param):
 name=(param or '').lower().strip('_')
 if name in {'basecolor','basecolor_texcoord0','cs','cs_textcoord0','diffuse','colourSmoothness'.lower(),'color','rgb','ca','base_cs_input','tiling_cs_input'}:return 'baseColor'
 if name in {'normal','normals','normal_texcoord0','ns','nw','tiling_cs_nm','nm'}:return 'normal'
 if name in {'emissive','emission'}:return 'emissive'
 if name in {'ao','aotexture'}:return 'occlusion'
 return None
def section_defaults(mesh,index,lod,primary_guid):
 # Frosty ShaderBlockEntry.GetSection/GetTextureParams preserves section order.
 # Each split root carries its LOD in child[section].child[0] MeshParamDbBlock.
 # Exact default-variation hash matching is added when MeshSet metadata exists.
 out=[]
 info=meshinfo.get(mesh['guid']);expected=str(CityHash64(struct.pack('<IIi',info['meshSetNameHash'],0,lod))) if info else None
 for rid in blockroots[mesh['name'].lower()]:
  if expected and blocks[rid]['hash']!=expected:continue
  children=blocks[rid].get('children',[])
  if index>=len(children):continue
  section=blocks[children[index]];children2=section.get('children',[])
  if len(children2)<2:continue
  geometry=blocks[children2[0]]
  if geometry.get('kind')!=3 or geometry.get('lod')!=lod or geometry.get('meshGuid')!=primary_guid:continue
  for p in walk(children2[1]):
   p=dict(p,identityBasis='source split shader entry matched mesh primary GUID, LOD, section index'+(' and exact CityHash64(MeshSet.NameHash, variation=0, LOD)' if expected else ''),sourceEntry=rid,sourceSection=index,variationHash=0 if expected else None)
   out.append(p)
 return out
rows=[];selected={};coverage=collections.Counter()
for m in load(a.mesh_manifest)['results']:
 guid=m['guid'];doc=docs.get(guid);materials=[]
 source_path=root/a.source/m['file'];glb=None
 if source_path.exists():
  raw=source_path.read_bytes();glb=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
 if doc:
  nodes={n['$id']:n for n in doc['asset']['objects']};r=nodes[doc['asset']['root']]
  defaults=[v for v in byMesh[guid] if v['VariationAssetNameHash']==0]
  for index,ref in enumerate(r.get('Materials',[])):
   mat=nodes.get(ref.get('$ref'),{});candidates=[]
   for v in defaults:
    for vm in v['Materials']:
     if vm['Material'].get('classGuid')==mat.get('$id'):candidates.extend(texparam(t,'variation database default material reference') for t in vm['TextureParameters'])
   candidates.extend(texparam(t,'mesh material shader parameter') for t in mat.get('Shader',{}).get('TextureParameters',[]))
   # A unique matching shader role across all root branches can supply defaults.
   section_indices=[]
   info=meshinfo.get(guid);lod=glb.get('extras',{}).get('lod',0) if glb else m.get('metadata',{}).get('lod',0)
   if info:
    section_indices=[s['index'] for l in info['lods'] if l['index']==lod for s in l['sections'] if s['materialId']==index and s['exportedByStaticConverter']]
   elif glb:
    # Exporters retain visible source sections in order. Hidden depth/shadow
    # sections are appended in these profiles; metadata export verifies indices.
    section_indices=[i for i,p in enumerate(p for gm in glb['meshes'] for p in gm['primitives']) if p.get('extras',{}).get('sourceMaterialId')==index]
   fallback=[p for si in section_indices for p in section_defaults(m,si,lod,r.get('$id'))]
   if not fallback and not info:fallback=[p for rid in blockroots[m['name'].lower()] for p in walk(rid)]
   chosen={};unresolved=[]
   for ro in ['baseColor','normal','emissive','occlusion']:
    direct=[p for p in candidates if role(p['parameter'])==ro and p['texture']]
    options=direct or [p for p in fallback if role(p['parameter'])==ro and p['texture']]
    unique={p['texture']['fileGuid']:p for p in options}
    if len(unique)==1:
     pick=next(iter(unique.values()));chosen[ro]=pick;selected[pick['texture']['name']]=pick['texture'];coverage[ro]+=1
    elif len(unique)>1:unresolved.append({'role':ro,'reason':'multiple texture candidates; variation/section scope requires resolution','textures':list(unique)})
   materials.append({'index':index,'classGuid':mat.get('$id'),'shader':mat.get('Shader',{}).get('Shader'),'chosen':chosen,'declaredParameters':candidates,'unresolved':unresolved,'fallbackTextureBindings':list({(p.get('parameter'),(p.get('texture') or {}).get('fileGuid')):p for p in fallback}.values()),'limitations':['PBR roles inferred from exact source parameter names; full Frostbite shader translation remains incomplete.','Only default variation bindings; per-instance variation overrides not yet applied.']})
 rows.append({'name':m['name'],'guid':guid,'sourceFile':m['file'],'materials':materials});coverage['materials']+=len(materials);coverage['meshes']+=1
out={'evidenceId':'LOCAL-MATERIAL-PLAN-001','coverage':coverage,'meshes':rows,'textures':list(selected.values()),'limitations':['Unknown packed RGBA textures are retained as evidence and not silently treated as base color.','Materials lacking a resolved base color retain a labeled neutral PBR approximation.']}
dest=root/a.out;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(out,indent=2));dest.with_suffix('.texture-names.txt').write_text('\n'.join(sorted(selected)))
print(json.dumps({'coverage':coverage,'texturesToExport':len(selected),'out':str(dest)}))
