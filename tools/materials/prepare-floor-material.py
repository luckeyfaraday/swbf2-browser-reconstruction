"""Bind the proven default SS_DSI_Floor_01 shader inputs, preserving packed RGBA."""
import pathlib,json,hashlib
root=pathlib.Path(__file__).resolve().parents[2]
plan=json.loads((root/'exports/materials/final-map-material-plan.json').read_text())
textures={}
for directory in ['floor-textures','map-textures','map-textures-extra']:
 base=root/'exports/materials'/directory
 for row in json.loads((base/'texture.manifest.json').read_text())['results']:
  textures[row['guid']]={'path':(base/row['file']).with_suffix('.png'),'metadata':row['metadata']}
target=root/'web/public/assets/textures';target.mkdir(exist_ok=True)
output=[];provenance={}
hashes={'floor':2680602575,'grunge':3886408699,'primaryNormal':1648243766,'detailNormal':438789842}
for mesh in plan['meshes']:
 for material in mesh['materials']:
  if (material.get('shader')or{}).get('name','').lower()!='objects/architecture/_galacticempire/_shaders/ss_dsi_floor_01':continue
  bindings={p['parameterHash']:p for p in material['fallbackTextureBindings']}
  row={'assetId':mesh['guid'],'materialId':material['index'],'sourceShader':material['shader'],'textures':{},'bindings':{}}
  for role,parameterHash in hashes.items():
   binding=bindings[parameterHash];tex=binding['texture'];source=textures[tex['fileGuid']];filename=tex['fileGuid']+'-packed.png';raw=source['path'].read_bytes();(target/filename).write_bytes(raw)
   row['textures'][role]='/assets/textures/'+filename;row['bindings'][role]=binding
   provenance[tex['fileGuid']]={'source':tex,'sourcePath':str(source['path'].relative_to(root)),'pixelFormat':source['metadata']['pixelFormat'],'sha256':hashlib.sha256(raw).hexdigest(),'operation':'unchanged source PNG RGBA; no resizing, gamma conversion or channel mutation'}
  output.append(row)
report={'evidenceId':'LOCAL-FLOOR-SHADER-001','materials':output,'sourceTextures':provenance,'shaderEvidence':'exports/materials/floor-shader/graph.json','pixelShader':'13ddb144d2','vertexShader':'606a379e52','limitations':['Source default material equations and absolute world-space UVs recovered from DXBC.','Three lighting, GI, reflection, exposure and LOD/filter choices do not match the native renderer yet.','Other material shaders and non-default variations are outside this mapping.']}
(root/'web/public/assets/recovered-floor-materials.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'materials':len(output),'textures':len(provenance)}))
