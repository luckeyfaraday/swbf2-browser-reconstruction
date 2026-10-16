"""Package ceiling assets, reusing two already verified packed metal textures."""
import hashlib, json, pathlib, struct, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/ceiling-bounded-textures'
PUBLIC = ROOT / 'web/public/assets/textures/ceiling'
OUT.mkdir(exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
report = json.loads((ROOT / 'exports/materials/ceiling-shader/material-analysis.json').read_text())
atlas_recipe_path = ROOT / 'exports/materials/ceiling-static-atlas/integration-recipe.json'
atlas_recipe = json.loads(atlas_recipe_path.read_text())
assert atlas_recipe['family'] == 'ceiling' and atlas_recipe['gbuffer']['materialID'] == 0
assert atlas_recipe['gbuffer']['metalness'] == '0.5*metalCS.r'
assert atlas_recipe['emissive']['separateThreeEmission'] is False
master = json.loads((ROOT / 'web/public/assets/recovered-master1uv-materials.json').read_text())
manifest = json.loads((ROOT / 'exports/materials/ceiling-textures/texture.manifest.json').read_text())
assert manifest['complete'] and not manifest['errors'] and len(manifest['results']) == 1
provenance = {guid: master['sourceTextures'][guid] for guid in report['sourceTextures'] if guid in master['sourceTextures']}
assert len(provenance) == 2
sha = lambda data: hashlib.sha256(data).hexdigest()
for row in manifest['results']:
    source = ROOT / 'exports/materials/ceiling-textures' / row['file']
    raw = source.read_bytes()
    assert raw[:4] == b'DDS ' and raw[84:88] == b'DX10'
    height, width = struct.unpack_from('<II', raw, 12)
    mip_count = struct.unpack_from('<I', raw, 28)[0]
    dxgi = struct.unpack_from('<I', raw, 128)[0]
    assert dxgi in (28,29,77,78,83,98,99)
    compressed = dxgi not in (28,29)
    def size(w,h): return max(1,(w+3)//4)*max(1,(h+3)//4)*16 if compressed else w*h*4
    offset, skip = 148, 0
    while max(width,height)>1024:
        offset += size(width,height)
        width,height,skip = max(1,width//2),max(1,height//2),skip+1
    assert skip<mip_count
    w,h,expected = width,height,0
    for _ in range(mip_count-skip):
        expected += size(w,h)
        w,h = max(1,w//2),max(1,h//2)
    assert len(raw)-offset == expected
    header = bytearray(raw[:148])
    struct.pack_into('<II',header,12,height,width)
    struct.pack_into('<I',header,20,size(width,height) if compressed else width*4)
    struct.pack_into('<I',header,28,mip_count-skip)
    selected = bytes(header)+raw[offset:]
    dds,png = OUT/(row['guid']+'.dds'),OUT/(row['guid']+'.png')
    changed = not dds.exists() or dds.read_bytes()!=selected
    if changed: dds.write_bytes(selected)
    if changed or not png.exists():
        subprocess.run([str(ROOT/'tools/bf2-extract/bf2-extract.exe'),'dds-png','--input',str(dds),'--out',str(png)],cwd=ROOT,check=True,capture_output=True)
    pixels = png.read_bytes()
    assert struct.unpack_from('>II',pixels,16)==(width,height)
    target = PUBLIC/(row['guid']+'.png')
    target.write_bytes(pixels)
    provenance[row['guid']] = {'source': report['sourceTextures'][row['guid']], 'sourceMetadata': row['metadata'],
        'sourceDdsPath': source.relative_to(ROOT).as_posix(), 'sourceDdsSha256':sha(raw),
        'selectedDdsPath':dds.relative_to(ROOT).as_posix(), 'selectedDdsSha256':sha(selected),
        'sourceMip':skip,'sourceDataOffset':offset,'retainedDataBytes':len(raw)-offset,
        'width':width,'height':height,'dxgiFormat':dxgi,'colorSpace':'srgb' if dxgi in (29,78,99) else 'linear',
        'url':'/assets/textures/ceiling/'+target.name,'sha256':sha(pixels),
        'operation':'Select existing native DDS mip; preserve compressed source bytes; historical native DDS-to-PNG decode; unchanged PNG copied to browser. No resampling or channel mutation.'}
assert set(provenance)==set(report['sourceTextures'])
materials = [{**m,'textures':{role:provenance[b['texture']['fileGuid']]['url'] for role,b in m['bindings'].items()}} for m in report['materials']]
document = {k:report[k] for k in ['evidenceId','shaderName','shaderNameHash','shaderGuid','pixelShader','pixelShaderSha256','pairedVertexShader','sourceRvmSha256','textureMapping','constantMapping','sourceLiterals','limitations','emissiveStrengthCounts']}
document['limitations'] = [line for line in report['limitations']
    if 'tangent' not in line.lower() and not line.startswith('Native o2.y equals') and not line.startswith('Source emissive is added')]
document['limitations'].extend([
    'Source tangent frames are scoped to BF2-NATIVE-TANGENT-CEILING32/44-001; live native dispatch remains uncaptured.',
    'Original ordinary GBuffer consumers establish ceiling metalness=.5*metalCS.r and emission inside prelighting. Actual native frame/pass activation remains uncaptured.',
    'Browser SH fallback retains its existing diffuse-only probe approximation; material emission is added before the same DFG/albedo/nonmetal response even without geometric atlas coverage.',
    'Without native DFG resources the source-probe fallback uses reconstructed Lambert response for both SH and material emission; this is not native DFG parity.'])
document['nativeMaterialModel'] = {
    'evidenceId':'BF2-NATIVE-GBUFFER-001', 'sourceManifest':'exports/lighting/dfg-gbuffer/manifest.json',
    'materialId':0, 'reflectance':.5, 'dielectricF0':.04, 'metalness':'0.5*metalCS.r',
    'consumers':atlas_recipe['gbuffer']['classificationEvidence']['consumerShaders'],
    'consumerEquations':'diffuse=(1-metalness)*baseColor; F0=mix(0.16*reflectance^2,baseColor,metalness)',
    'sourceAtlasRecipe':atlas_recipe_path.relative_to(ROOT).as_posix(),
    'sourceAtlasRecipeSha256':sha(atlas_recipe_path.read_bytes())}
document['nativeLightingInputs'] = {
    'shNormal':'normalized-final-world-normal', 'materialId':0,
    'metalness':'bf2_ceiling_surface.nativeScalar', 'reflectance':.5, 'ao':1,
    'rawSmoothness':'bf2_ceiling_surface.smoothness',
    'emissive':'bf2_ceiling_surface.emissive', 'emissiveStage':'add-to-atlas-or-SH-before-DFG-albedo-metalness',
    'separateThreeEmission':False, 'deferredConsumerEvidence':'BF2-NATIVE-GBUFFER-001',
    'diffuse':'(atlasOrSH + sourceEmission) * baseColor * (1-metalness) * native DFG.b'}
document.update({'materials':materials,'sourceTextures':provenance,'runtimeMapping':{
    'color':'Exact source mask remap and stored linear tint; no visual color guesses.',
    'emissive':'Exact mask*emissiveColor*strength*multiplier; add to atlas or SH prelighting before frame exposure and the ordinary DFG.b*baseColor*(1-metalness) combine. Separate Three emission is zero. Shared native map exposure; no per-material normalization.',
    'roughness':'1-clamp(source smoothness,0,1), matching the source forward shader complement; native BRDF still differs from Three.',
    'metalness':'Source o2.y=0.5*metalCS.r; both retained ordinary materialID0 deferred consumers read GBuffer2.y as metalness. Fragment metalnessFactor uses the original scalar.',
    'normal':'Exact source frames cover all21 selected section/LOD records and493 ceiling section instances: signed32 uses original BinormalSign; explicit44 uses independent source Binormal. Three original T/B/N columns interpolate before the final mapped normal normalization; unbound geometry retains the derivative fallback.',
    'colorSpace':'Source DDS UNORM/SRGB distinction; native resource-view overrides remain unresolved.',
    'mipSelection':'Largest existing native mip no larger than1024; browser regenerates lower PNG mips.'}})
(ROOT/'web/public/assets/recovered-ceiling-materials.json').write_text(json.dumps(document,indent=2))
glsl = (ROOT/'tools/materials/ceiling-equations.glsl').read_text()
template = (ROOT/'tools/materials/ceiling-adapter.template.js').read_text()
(ROOT/'web/src/ceiling-material.js').write_text(template.replace('__CEILING_GLSL__',json.dumps(glsl)))
(OUT/'provenance.json').write_text(json.dumps(provenance,indent=2))
print(json.dumps({'materials':len(materials),'textures':len(provenance),'newTextures':len(manifest['results']),'newPngBytes':sum(p.stat().st_size for p in PUBLIC.glob('*.png'))}))
