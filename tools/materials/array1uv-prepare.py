"""Publish unchanged native mip samples and original one-UV array material."""
import hashlib,json,pathlib,struct,subprocess
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/array1uv-bounded-textures';PUBLIC=ROOT/'web/public/assets/textures/array1uv'
OUT.mkdir(exist_ok=True);PUBLIC.mkdir(parents=True,exist_ok=True)
report=json.loads((ROOT/'exports/materials/array1uv-shader/material-analysis.json').read_text());sources={};sha=lambda b:hashlib.sha256(b).hexdigest()
for manifest in sorted((ROOT/'exports/materials').glob('*/texture.manifest.json')):
 for row in json.loads(manifest.read_text()).get('results',[]):
  if row.get('guid')in report['sourceTextures'] and (manifest.parent/row['file']).exists():sources[row['guid']]=(manifest.parent/row['file'],row)
assert set(sources)==set(report['sourceTextures'])
shared=json.loads((ROOT/'web/public/assets/recovered-array2uv-materials.json').read_text())['sourceTextures']
provenance={}
for source,row in sources.values():
 if row['guid']in shared:
  provenance[row['guid']]=shared[row['guid']];assert sha(source.read_bytes())==provenance[row['guid']]['sourceDdsSha256'];continue
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
 provenance[row['guid']]={'source':report['sourceTextures'][row['guid']],'sourceMetadata':row['metadata'],'sourceDdsPath':source.relative_to(ROOT).as_posix(),'sourceDdsSha256':sha(raw),'sourceMip':skip,'width':width,'height':height,'layers':layers,'dxgiFormat':dxgi,'colorSpace':'srgb'if dxgi in(29,78,99)else'linear','url':'/assets/textures/array1uv/'+target.name,'sha256':sha(target.read_bytes()),'bytes':target.stat().st_size,'format':'rgba8-array'if layers>1 else'png','slices':slices,'operation':'Select existing native DDS mip and preserve compressed source bytes; historical native DDS-to-PNG decode; array concatenates decoded RGBA8 layers without resize/channel edits. Browser lower mipmaps regenerate.'}
materials=[{**m,'textures':{role:provenance[b['texture']['fileGuid']]['url']for role,b in m['bindings'].items()}}for m in report['materials']]
document={k:report[k]for k in ['evidenceId','shaderName','shaderNameHash','shaderGuid','pixelShader','pixelShaderSha256','pairedVertexShader','pairedVertexShaderSha256','sourceRvmSha256','textureMapping','constantMapping','samplerMapping','limitations','placedSectionCount','visibleCoverage','nativeMaterialModel','nativeLightingInputs','uvRouting']}
document.update({'materials':materials,'sourceTextures':provenance,'runtimeMapping':{'color':'2*CS(UV0).rgb*detail.b; detail weight does not modify color. Original DDS transfer functions.','roughness':'1-clamp(2*CS(UV0).a*detail.b,0,1); browser smoothness complement.','metalness':'NAM(UV0).a; native ordinaryID0/reflectance.5 has dielectricF0=.04.','normal':'Exact source normalized sum; normal-only unsaturated detail weight. Exact native interpolated frame for12 source-bound rigid28/32 records (8 base sections/246 instances plus4 native LODs); other layouts retain derivative TBN.','emissive':'None.','ao':'No separate AO.','samplers':'Native t2 uses s1 packed U1/V3/W1 interpreted wrapU/clampV; t3/t4 use s0 U1/V1/W1 repeat. Packed filter0x55 matches anisotropic but native descriptor conversion and anisotropy amount remain unobserved; browser keeps its common linear mip filter.','mipSelection':'Reuse exact recovered ten-layer array nativeMip1 (512x512); select largest existing native mip<=1024 for 2D textures. Original selected compressed slices retained; browser lower mips regenerate.'}})
(ROOT/'web/public/assets/recovered-array1uv-materials.json').write_text(json.dumps(document,indent=2));(OUT/'provenance.json').write_text(json.dumps(provenance,indent=2))
template=(ROOT/'tools/materials/array1uv-adapter.template.js').read_text();glsl=(ROOT/'tools/materials/array1uv-equations.glsl').read_text();(ROOT/'web/src/array1uv-material.js').write_text(template.replace('__ARRAY1UV_GLSL__',json.dumps(glsl)))
print(json.dumps({'materials':len(materials),'textures':len(provenance),'reusedTextures':sum(g in shared for g in provenance),'newTextureBytes':sum(p.stat().st_size for p in PUBLIC.glob('*'))}))
