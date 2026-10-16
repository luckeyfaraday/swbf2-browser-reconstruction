"""Publish unchanged native mip samples and independently checked UV1 sidecars."""
import hashlib,json,pathlib,struct,subprocess
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/array2uv-bounded-textures';PUBLIC=ROOT/'web/public/assets/textures/array2uv'
OUT.mkdir(exist_ok=True);PUBLIC.mkdir(parents=True,exist_ok=True)
report=json.loads((ROOT/'exports/materials/array2uv-shader/material-analysis.json').read_text());sources={};sha=lambda b:hashlib.sha256(b).hexdigest()
for manifest in sorted((ROOT/'exports/materials').glob('*/texture.manifest.json')):
 for row in json.loads(manifest.read_text()).get('results',[]):
  if row.get('guid')in report['sourceTextures'] and (manifest.parent/row['file']).exists():sources[row['guid']]=(manifest.parent/row['file'],row)
assert set(sources)==set(report['sourceTextures'])
provenance={}
for source,row in sources.values():
 raw=source.read_bytes();assert raw[:4]==b'DDS 'and raw[84:88]==b'DX10'
 height,width=struct.unpack_from('<II',raw,12);mips=struct.unpack_from('<I',raw,28)[0];dxgi,dimension,misc,layers=struct.unpack_from('<IIII',raw,128)
 assert dimension==3 and misc==0 and dxgi in(28,29,77,78,83,98,99)
 compressed=dxgi not in(28,29)
 def size(w,h):return max(1,(w+3)//4)*max(1,(h+3)//4)*16 if compressed else w*h*4
 dimensions=[];w,h=width,height
 for _ in range(mips):dimensions.append((w,h,size(w,h)));w,h=max(1,w//2),max(1,h//2)
 slice_size=sum(n for _,_,n in dimensions);assert len(raw)==148+slice_size*layers
 # Ten layers use existing native mip1 (512 squared): 10MiB decoded GPU data.
 limit=512 if layers>1 else 1024;skip=next(i for i,(w,h,_)in enumerate(dimensions)if max(w,h)<=limit)
 width,height,_=dimensions[skip];prefix=sum(n for _,_,n in dimensions[:skip]);count=sum(n for _,_,n in dimensions[skip:]);slices=[];array_bytes=bytearray()
 for layer in range(layers):
  offset=148+slice_size*layer+prefix;header=bytearray(raw[:148]);struct.pack_into('<II',header,12,height,width);struct.pack_into('<I',header,20,size(width,height)if compressed else width*4);struct.pack_into('<I',header,28,mips-skip);struct.pack_into('<I',header,140,1)
  selected=bytes(header)+raw[offset:offset+count];stem=row['guid']+(f'-layer{layer}'if layers>1 else'');dds,png=OUT/(stem+'.dds'),OUT/(stem+'.png');changed=not dds.exists()or dds.read_bytes()!=selected
  if changed:dds.write_bytes(selected)
  if changed or not png.exists():subprocess.run([str(ROOT/'tools/bf2-extract/bf2-extract.exe'),'dds-png','--input',str(dds),'--out',str(png)],cwd=ROOT,check=True,capture_output=True)
  pixels=png.read_bytes();assert struct.unpack_from('>II',pixels,16)==(width,height)
  slices.append({'layer':layer,'selectedDdsPath':dds.relative_to(ROOT).as_posix(),'selectedDdsSha256':sha(selected),'sourceDataOffset':offset,'retainedDataBytes':count,'pngPath':png.relative_to(ROOT).as_posix(),'pngSha256':sha(pixels)})
  if layers>1:
   with Image.open(png)as image:rgba=image.convert('RGBA').tobytes()
   slices[-1].update({'decodedRgbaSha256':sha(rgba),'decodedByteOffset':len(array_bytes),'decodedBytes':len(rgba)})
   array_bytes.extend(rgba)
  else:target=PUBLIC/(stem+'.png');target.write_bytes(pixels)
 if layers>1:
  assert layers==10 and dxgi==98 and len(array_bytes)==width*height*layers*4
  target=PUBLIC/(row['guid']+'.rgba8.bin');target.write_bytes(array_bytes)
 provenance[row['guid']]={'source':report['sourceTextures'][row['guid']],'sourceMetadata':row['metadata'],'sourceDdsPath':source.relative_to(ROOT).as_posix(),'sourceDdsSha256':sha(raw),'sourceMip':skip,'width':width,'height':height,'layers':layers,'dxgiFormat':dxgi,'colorSpace':'srgb'if dxgi in(29,78,99)else'linear','url':'/assets/textures/array2uv/'+target.name,'sha256':sha(target.read_bytes()),'bytes':target.stat().st_size,'format':'rgba8-array'if layers>1 else'png','slices':slices,'operation':'Select existing native DDS mip and preserve compressed source bytes; historical native DDS-to-PNG decode; array concatenates decoded RGBA8 layers without resize/channel edits. Browser lower mipmaps regenerate.'}
def glb_accessors(path,primitive):
 b=path.read_bytes();length=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+length]);binary=b[28+length:];p=j['meshes'][0]['primitives'][primitive]
 def attr(i):
  a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];at=v.get('byteOffset',0)+a.get('byteOffset',0);components={'VEC2':2,'SCALAR':1}[a['type']];assert a['componentType']in(5125,5126)and'byteStride'not in v
  return binary[at:at+a['count']*components*4]
 return attr(p['attributes']['TEXCOORD_0']),attr(p['indices'])
scene=json.loads((ROOT/'web/public/assets/map.scene.json').read_text());lods=json.loads((ROOT/'web/public/assets/source-lods.json').read_text());paths={(a['id'],0):ROOT/'web/public/assets'/a['url']for a in scene['assets']}
for a in lods['assets']:
 for level in a['lods']:paths[a['assetId'],level['level']]=ROOT/'web/public'/level['url'].lstrip('/')
def fingerprint(b):
 h=2166136261
 for n in b:h=((h^n)*16777619)&0xffffffff
 return h
uv=json.loads((ROOT/'exports/materials/array2uv-uv/manifest.json').read_text());uv_bytes=bytearray();records=[]
for r in uv['records']:
 path=paths[r['assetId'],r['sourceLod']];uv0,indices=glb_accessors(path,r['primitiveIndex']);assert sha(uv0)==r['uv0Sha256']and sha(indices)==r['indexSha256'],(path,r['primitiveIndex'])
 original=(ROOT/'exports/materials/array2uv-uv'/r['uv1File']).read_bytes();assert sha(original)==r['uv1Sha256']and len(original)==r['vertexCount']*8
 records.append({**r,'glbPath':path.relative_to(ROOT).as_posix(),'glbSha256':sha(path.read_bytes()),'byteOffset':len(uv_bytes),'byteLength':len(original),'uv0Fingerprint':fingerprint(uv0),'indexFingerprint':fingerprint(indices)})
 uv_bytes.extend(original)
uv_path=ROOT/'web/public/assets/array2uv-uv1.bin';uv_path.write_bytes(uv_bytes)
materials=[{**m,'textures':{role:provenance[b['texture']['fileGuid']]['url']for role,b in m['bindings'].items()}}for m in report['materials']]
document={k:report[k]for k in ['evidenceId','shaderName','shaderNameHash','shaderGuid','pixelShader','pixelShaderSha256','pairedVertexShader','pairedVertexShaderSha256','sourceRvmSha256','textureMapping','constantMapping','limitations','placedSectionCount','visibleCoverage','nativeMaterialModel','nativeLightingInputs','uvRouting']}
document.update({'materials':materials,'sourceTextures':provenance,'uv1':{'evidenceId':uv['evidenceId'],'url':'/assets/array2uv-uv1.bin','sha256':sha(uv_bytes),'byteLength':len(uv_bytes),'records':records},'runtimeMapping':{'color':'CS(UV1).rgb * mix(1,2*detail.b,clamp(weight,0,1)); original DDS transfer function.','roughness':'1-clamp(native smoothness,0,1); common browser smoothness complement.','metalness':'NAM(UV1).a; native ordinaryID0/reflectance.5 has dielectricF0=.04.','normal':'Original packed equation; raw weight3/5 remains unsaturated for wreckage. Exact native interpolated frame for15 source-bound records:10 rigid36 (6 base sections/132 instances plus4 native LODs) and5 identity-composite44 (3 base sections/243 instances plus2 native LODs). Composite rawN is separate from unchanged normalized GLB normals; other layouts retain derivative TBN.','uvRouting':report['uvRouting']['sourceAttributeAssociation'],'emissive':'None.','ao':'No separate AO.','mipSelection':'Existing native mip1 for ten-layer array (512x512), largest existing <=1024 for 2D textures. Original source compressed slices retained; browser generates lower mips.'}})
document['uvRouting']={**document['uvRouting'],'provenRigidSubset':{'evidenceId':'BF2-NATIVE-TANGENT-ARRAY2UV36-001','records':10,'baseSections':6,'baseInstances':132,'association':'Exact original UV0/UV1 fields at24/28 in36-byte rigid streams and original VS WARP outputs prove normal/detail=UV0, surface=UV1 for these records only.','originalVs':['2c2902aa87','60f0891496'],'warpUvComparisons':62400}}
document['uvRouting']['provenCompositeSubset']={'evidenceId':'BF2-NATIVE-TANGENT-ARRAY2UV-COMPOSITE44-001','records':5,'baseSections':3,'baseInstances':243,'association':'Exact original UV0/UV1 fields at32/36 and original VS WARP outputs prove normal/detail=UV0, surface=UV1 for these identity composite records.','originalVs':['5da46730cb','cbfdbad68f'],'warpUvComparisons':81216,'visibilityBoundary':'Static positive rest-pose part visibility only; native destruction remains outside this reconstruction.'}
(ROOT/'web/public/assets/recovered-array2uv-materials.json').write_text(json.dumps(document,indent=2));(OUT/'provenance.json').write_text(json.dumps(provenance,indent=2))
template=(ROOT/'tools/materials/array2uv-adapter.template.js').read_text();glsl=(ROOT/'tools/materials/array2uv-equations.glsl').read_text();(ROOT/'web/src/array2uv-material.js').write_text(template.replace('__ARRAY2UV_GLSL__',json.dumps(glsl)))
print(json.dumps({'materials':len(materials),'textures':len(provenance),'sourceUvRecords':len(records),'uvBytes':len(uv_bytes),'textureBytes':sum(p['bytes']for p in provenance.values())}))
