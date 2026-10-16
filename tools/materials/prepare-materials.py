"""Assemble narrowly scoped material inputs from existing provenance manifests."""
import pathlib,json,argparse
root=pathlib.Path(__file__).resolve().parents[2];p=root/'exports/materials'
ap=argparse.ArgumentParser();ap.add_argument('stage',choices=['map','textures']);args=ap.parse_args()
def load(file):return json.loads((root/file).read_text())
if args.stage=='map':
 scene=load('web/public/assets/map.scene.json')
 rows=[{'guid':x['id'],'name':x['name'],'file':x['source']['convertedFile'],'metadata':{'lod':x['source']['lod']}} for x in scene['assets']]
 (p/'final-map-meshes.json').write_text(json.dumps({'results':rows},indent=2))
 reports=[load('exports/materials/map-blocks/shader-blocks.json')]
 missing=sorted(set(x['name'].lower() for x in scene['assets'])-set(n.lower() for n in reports[0]['requestedNames']))
 (p/'final-map-missing-block-names.txt').write_text('\n'.join(missing))
 if (p/'final-map-extra-blocks/shader-blocks.json').exists():reports.append(load('exports/materials/final-map-extra-blocks/shader-blocks.json'))
 result=dict(reports[0]);result['roots']=list({x['resourceId']:x for j in reports for x in j['roots']}.values());result['blocks']=list({x['source']['rid']:x for j in reports for x in j['blocks']}.values());result['errors']=[e for j in reports for e in j['errors']]
 result['requestedNames']=sorted(set(n for j in reports for n in j['requestedNames']));result['complete']=not result['errors']
 (p/'final-map-blocks.json').write_text(json.dumps(result))
 print(json.dumps({'meshes':len(rows),'additionalShaderMeshNames':len(missing)}))
else:
 rows=[];errors=[];inputs=[]
 for directory in ['map-textures','map-textures-extra']:
  manifest=p/directory/'texture.manifest.json'
  if not manifest.exists():continue
  report=json.loads(manifest.read_text());inputs.append(str(manifest.relative_to(root)))
  for row in report['results']:row['file']='../'+directory+'/'+row['file'];rows.append(row)
  errors+=report['errors']
 target=p/'final-map-textures';target.mkdir(exist_ok=True)
 (target/'texture.manifest.json').write_text(json.dumps({'results':list({x['guid']:x for x in rows}.values()),'errors':errors,'inputs':inputs},indent=2))
 print(json.dumps({'textures':len(rows),'errors':len(errors)}))
