"""Publish original Master2UV texture mips/UV1 and its independently checked equations."""
import hashlib,json,pathlib,struct,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/master2uv-bounded-textures';PUBLIC=ROOT/'web/public/assets/textures/master2uv'
OUT.mkdir(exist_ok=True);PUBLIC.mkdir(parents=True,exist_ok=True);sha=lambda b:hashlib.sha256(b).hexdigest()
report=json.loads((ROOT/'exports/materials/master2uv-shader/material-analysis.json').read_text());provenance={};sources={}
for file in (ROOT/'web/public/assets').glob('recovered-*-materials.json'):
 if file.name=='recovered-master2uv-materials.json':continue
 for guid,row in json.loads(file.read_text()).get('sourceTextures',{}).items():
  if guid in report['sourceTextures']and row.get('selectedDdsPath')and row.get('url','').endswith('.png'):provenance[guid]={**row,'source':report['sourceTextures'][guid],'reusedFrom':file.relative_to(ROOT).as_posix()}
for file in (ROOT/'exports/materials').glob('*/texture.manifest.json'):
 for row in json.loads(file.read_text()).get('results',[]):
  if row.get('guid')in report['sourceTextures']and(file.parent/row['file']).exists():sources[row['guid']]=(file.parent/row['file'],row)
assert set(sources)==set(report['sourceTextures'])
for guid,(source,row)in sources.items():
 if guid in provenance:
  retained=provenance[guid];assert sha((ROOT/retained['sourceDdsPath']).read_bytes())==retained['sourceDdsSha256'];assert sha((ROOT/'web/public'/retained['url'].lstrip('/')).read_bytes())==retained['sha256'];continue
 raw=source.read_bytes();assert raw[:4]==b'DDS 'and raw[84:88]==b'DX10'
 height,width=struct.unpack_from('<II',raw,12);mips=struct.unpack_from('<I',raw,28)[0];dxgi,dimension,misc,layers=struct.unpack_from('<IIII',raw,128);assert dimension==3 and misc==0 and layers==1 and dxgi in(28,29,71,72,77,78,83,98,99)
 compressed=dxgi not in(28,29);block=8 if dxgi in(71,72)else 16
 def size(w,h):return max(1,(w+3)//4)*max(1,(h+3)//4)*block if compressed else w*h*4
 offset,skip=148,0
 while max(width,height)>1024:offset+=size(width,height);width,height,skip=max(1,width//2),max(1,height//2),skip+1
 assert skip<mips;expected=0;w,h=width,height
 for _ in range(mips-skip):expected+=size(w,h);w,h=max(1,w//2),max(1,h//2)
 assert len(raw)-offset==expected
 header=bytearray(raw[:148]);struct.pack_into('<II',header,12,height,width);struct.pack_into('<I',header,20,size(width,height)if compressed else width*4);struct.pack_into('<I',header,28,mips-skip)
 selected=bytes(header)+raw[offset:];dds,png=OUT/(guid+'.dds'),OUT/(guid+'.png');changed=not dds.exists()or dds.read_bytes()!=selected
 if changed:dds.write_bytes(selected)
 if changed or not png.exists():subprocess.run([str(ROOT/'tools/bf2-extract/bf2-extract.exe'),'dds-png','--input',str(dds),'--out',str(png)],check=True,cwd=ROOT,capture_output=True)
 pixels=png.read_bytes();assert struct.unpack_from('>II',pixels,16)==(width,height);target=PUBLIC/png.name;target.write_bytes(pixels)
 provenance[guid]={'source':report['sourceTextures'][guid],'sourceMetadata':row['metadata'],'sourceDdsPath':source.relative_to(ROOT).as_posix(),'sourceDdsSha256':sha(raw),'selectedDdsPath':dds.relative_to(ROOT).as_posix(),'selectedDdsSha256':sha(selected),'sourceMip':skip,'sourceDataOffset':offset,'retainedDataBytes':len(raw)-offset,'width':width,'height':height,'dxgiFormat':dxgi,'colorSpace':'srgb'if dxgi in(29,72,78,99)else'linear','url':'/assets/textures/master2uv/'+target.name,'sha256':sha(pixels),'operation':'Select existing native DDS mip, retain compressed bytes, decode through pinned historical exporter, copy unchanged PNG. Lower browser mipmaps regenerate.'}

def glb_attributes(path,primitive):
 b=path.read_bytes();length=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+length]);binary=b[28+length:];p=j['meshes'][0]['primitives'][primitive]
 def attr(i):
  a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];at=v.get('byteOffset',0)+a.get('byteOffset',0);components={'VEC2':2,'SCALAR':1}[a['type']];assert a['componentType']in(5125,5126)and'byteStride'not in v
  return binary[at:at+a['count']*components*4]
 return attr(p['attributes']['TEXCOORD_0']),attr(p['indices'])
def fingerprint(b):
 h=2166136261
 for n in b:h=((h^n)*16777619)&0xffffffff
 return h
scene=json.loads((ROOT/'web/public/assets/map.scene.json').read_text());lods=json.loads((ROOT/'web/public/assets/source-lods.json').read_text());paths={(a['id'],0):ROOT/'web/public/assets'/a['url']for a in scene['assets']}
for a in lods['assets']:
 for level in a['lods']:paths[a['assetId'],level['level']]=ROOT/'web/public'/level['url'].lstrip('/')
uv=json.loads((ROOT/'exports/materials/master2uv-uv/manifest.json').read_text());uv_bytes=bytearray();records=[];selected={(m['assetId'],m['materialId'])for m in report['materials']}
for r in uv['records']:
 if(r['assetId'],r['sourceMaterialId'])not in selected:continue
 path=paths[r['assetId'],r['sourceLod']];uv0,indices=glb_attributes(path,r['primitiveIndex']);assert sha(uv0)==r['uv0Sha256']and sha(indices)==r['indexSha256'],(path,r['primitiveIndex'])
 original=(ROOT/'exports/materials/master2uv-uv'/r['uv1File']).read_bytes();assert sha(original)==r['uv1Sha256']and len(original)==r['vertexCount']*8
 records.append({**r,'glbPath':path.relative_to(ROOT).as_posix(),'glbSha256':sha(path.read_bytes()),'byteOffset':len(uv_bytes),'byteLength':len(original),'uv0Fingerprint':fingerprint(uv0),'indexFingerprint':fingerprint(indices)});uv_bytes.extend(original)
assert len(records)==14
(ROOT/'web/public/assets/master2uv-uv1.bin').write_bytes(uv_bytes)
materials=[{**m,'textures':{role:provenance[b['texture']['fileGuid']]['url']for role,b in m['bindings'].items()}}for m in report['materials']]
document={k:report[k]for k in ['evidenceId','shaderName','shaderNameHash','shaderGuid','rvmSurfaceGuid','pixelShader','pixelShaderSha256','pairedVertexShader','pairedVertexShaderSha256','pairedVertexSelection','sourceRvmSha256','textureMapping','samplerMapping','constantMapping','sourceLiterals','limitations','placedSectionCount','visibleCoverage','nativeMaterialModel','nativeLightingInputs','uvRouting']}
document.update({'materials':materials,'sourceTextures':provenance,'uv1':{'evidenceId':uv['evidenceId'],'url':'/assets/master2uv-uv1.bin','sha256':sha(uv_bytes),'byteLength':len(uv_bytes),'records':records},'runtimeMapping':{'equations':'Exact selected PS material algebra checked independently across2400 cases; source constants retain float32 values.','roughness':'1-clamp(source smoothness,0,1); native deferred smoothness is unsaturated.','metalness':'BF2-NATIVE-GBUFFER-001 ordinaryID0: o2.y is metalness, o2.z reflectance0.5 yields dielectricF0=.04. Browser metalness clamp; native GBuffer quantization unresolved.','normal':'Normalized source sum of baseNormal(UV0).rg + normalAO(UV1).rg + detail(UV1), Z reconstructed from baseNormal only. Derivative UV0 frame; original packed tangent parity unresolved.','ao':'normalAO(UV1).a applies to indirect diffuse.','emissive':'None; normalAO blue is unused.','uvRouting':report['uvRouting']['sourceAttributeAssociation'],'colorSpace':'Exact DDS SRGB/UNORM metadata preserved; native resource-view overrides unresolved.','mipSelection':'Largest existing native mip<=1024, shared source texture payloads reused; lower browser PNG mipmaps regenerate.'}})
(ROOT/'web/public/assets/recovered-master2uv-materials.json').write_text(json.dumps(document,indent=2));(OUT/'provenance.json').write_text(json.dumps(provenance,indent=2))
template=(ROOT/'tools/materials/master2uv-adapter.template.js').read_text();glsl=(ROOT/'tools/materials/master2uv-equations.glsl').read_text();(ROOT/'web/src/master2uv-material.js').write_text(template.replace('__MASTER2UV_GLSL__',json.dumps(glsl)))
print(json.dumps({'materials':len(materials),'textures':len(provenance),'reusedTextures':sum('reusedFrom'in r for r in provenance.values()),'uvRecords':len(records),'uvBytes':len(uv_bytes),'newPngBytes':sum(p.stat().st_size for p in PUBLIC.glob('*.png'))}))
