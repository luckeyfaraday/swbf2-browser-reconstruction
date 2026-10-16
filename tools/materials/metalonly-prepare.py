"""Package exact MetalOnly bindings using ten already verified native textures."""
import hashlib, json, pathlib, struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
report = json.loads((ROOT/'exports/materials/metalonly-shader/material-analysis.json').read_text())
master = json.loads((ROOT/'web/public/assets/recovered-master1uv-materials.json').read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
provenance = {}
for guid,source in report['sourceTextures'].items():
    texture = master['sourceTextures'][guid]
    assert texture['source']['fileGuid'] == guid
    original = (ROOT/texture['sourceDdsPath']).read_bytes()
    selected = (ROOT/texture['selectedDdsPath']).read_bytes()
    png = (ROOT/'web/public'/texture['url'].lstrip('/')).read_bytes()
    assert sha(original) == texture['sourceDdsSha256']
    assert sha(selected) == texture['selectedDdsSha256']
    assert selected[148:] == original[texture['sourceDataOffset']:]
    assert sha(png) == texture['sha256']
    assert struct.unpack_from('>II',png,16) == (texture['width'],texture['height'])
    assert max(texture['width'],texture['height']) <= 1024
    provenance[guid] = texture
assert len(provenance) == 10
materials = [{**m,'textures':{role:provenance[b['texture']['fileGuid']]['url'] for role,b in m['bindings'].items()}} for m in report['materials']]
document = {k:report[k] for k in ['evidenceId','shaderName','shaderNameHash','shaderGuid','pixelShader','pixelShaderSha256','pairedVertexShader','pairedVertexShaderSha256','sourceRvmSha256','textureMapping','constantMapping','sourceLiterals','limitations','placedSectionCount','nativeMaterialModel']}
document.update({'materials':materials,'sourceTextures':provenance,'runtimeMapping':{
    'color':'Exact source packed masks and stored linear float32 constants; no visual color guesses.',
    'emissive':'None in the selected source shader; normalAO.b is unused.',
    'roughness':'1-clamp(source smoothness,0,1), consistent with companion forward PS a5440e5203 complement. Native BRDF still differs from Three.',
    'metalness':'Native ordinary materialID0 o2.y metalness; o2.z reflectance=.5 gives dielectric F0=.04. Two native gbLayout=0 consumers establish diffuse=(1-metalness)*baseColor and F0=mix(.04,baseColor,metalness), matching Three parameter conversion. Browser clamps the source scalar to0..1; full native BRDF remains separate.',
    'normal':'Exact native frames for26 matched rigid32/36/44-byte section/LOD records (901 instances). Original independent Binormal is preserved for44-byte sections; unsupported48-byte records retain derivative frames. Geometric N remains interpolated without fragment renormalization for world grunge.',
    'ao':'Source normalAO.a multiplies prelighting; adapter multiplies indirect diffuse. Exact native indirect-specular interaction remains unresolved.',
    'colorSpace':'Original DDS UNORM/SRGB distinction; native resource-view overrides remain unresolved.',
    'mipSelection':'Reuses ten existing native mip textures from Master1UV; no new PNGs, resampling or channel mutation. Browser regenerates lower PNG mips.'}})
document['limitations']=[v for v in document['limitations'] if not v.startswith('Source packed tangent decoding is unavailable')]
document['limitations'].append('Native frame support is scoped to the26 records of BF2-NATIVE-TANGENT-METALONLY32/36/44-001; two48-byte base sections remain derivative.')
glsl = (ROOT/'tools/materials/metalonly-equations.glsl').read_text()
template = (ROOT/'tools/materials/metalonly-adapter.template.js').read_text()
document['sourceEquationSha256'] = sha(glsl.encode())
(ROOT/'web/public/assets/recovered-metalonly-materials.json').write_text(json.dumps(document,indent=2))
(ROOT/'web/src/metalonly-material.js').write_text(template.replace('__METALONLY_GLSL__',json.dumps(glsl)))
print(json.dumps({'materials':len(materials),'placedSections':report['placedSectionCount'],'reusedTextures':len(provenance),'newTextureBytes':0}))
