"""Package exact source DDS mip levels and source material equations for browser use.

No PNG resampling/channel mutation: strip larger source DDS mip levels, then use
the existing historical DDS decoder. Every byte range and output is hashed.
"""
import hashlib, json, pathlib, struct, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'exports/materials/master1uv-emissive-textures'
OUT = ROOT / 'exports/materials/master1uv-emissive-bounded-textures'
PUBLIC = ROOT / 'web/public/assets/textures/master1uv-emissive'
OUT.mkdir(exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
report = json.loads((ROOT / 'exports/materials/master1uv-emissive-shader/material-analysis.json').read_text())
manifest = json.loads((SOURCE / 'texture.manifest.json').read_text())
assert manifest['complete'] and not manifest['errors'] and len(manifest['results']) == 2
master = json.loads((ROOT/'web/public/assets/recovered-master1uv-materials.json').read_text())
provenance = {guid:master['sourceTextures'][guid] for guid in report['sourceTextures'] if guid in master['sourceTextures']}
assert len(provenance) == 14

def sha(data): return hashlib.sha256(data).hexdigest()

for row in manifest['results']:
    source = SOURCE / row['file']
    raw = source.read_bytes()
    assert raw[:4] == b'DDS ' and raw[84:88] == b'DX10'
    height, width = struct.unpack_from('<II', raw, 12)
    mip_count = struct.unpack_from('<I', raw, 28)[0]
    dxgi_format = struct.unpack_from('<I', raw, 128)[0]
    # Formats seen in this bounded exact selection: RGBA8, BC3, BC5, BC7.
    assert dxgi_format in (28, 29, 77, 78, 83, 98, 99), dxgi_format
    compressed = dxgi_format not in (28, 29)
    def size(w, h): return max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * 16 if compressed else w * h * 4
    offset, skip = 148, 0
    while max(width, height) > 1024:
        offset += size(width, height)
        width, height, skip = max(1, width // 2), max(1, height // 2), skip + 1
    assert skip < mip_count
    expected = 0
    w, h = width, height
    for _ in range(mip_count - skip):
        expected += size(w, h)
        w, h = max(1, w // 2), max(1, h // 2)
    assert len(raw) - offset == expected, (source, len(raw), offset, expected)
    header = bytearray(raw[:148])
    struct.pack_into('<II', header, 12, height, width)
    struct.pack_into('<I', header, 20, size(width, height) if compressed else width * 4)
    struct.pack_into('<I', header, 28, mip_count - skip)
    selected = bytes(header) + raw[offset:]
    dds = OUT / (row['guid'] + '.dds')
    png = OUT / (row['guid'] + '.png')
    changed = not dds.exists() or dds.read_bytes() != selected
    if changed: dds.write_bytes(selected)
    if changed or not png.exists():
        subprocess.run([str(ROOT / 'tools/bf2-extract/bf2-extract.exe'), 'dds-png', '--input', str(dds), '--out', str(png)], cwd=ROOT, check=True, capture_output=True)
    pixels = png.read_bytes()
    assert struct.unpack_from('>II', pixels, 16) == (width, height)
    public = PUBLIC / (row['guid'] + '.png')
    public.write_bytes(pixels)
    provenance[row['guid']] = {
        'source': report['sourceTextures'][row['guid']], 'sourceMetadata': row['metadata'],
        'sourceDdsPath': str(source.relative_to(ROOT)).replace('\\', '/'), 'sourceDdsSha256': sha(raw),
        'selectedDdsPath': str(dds.relative_to(ROOT)).replace('\\', '/'), 'selectedDdsSha256': sha(selected),
        'sourceMip': skip, 'sourceDataOffset': offset, 'retainedDataBytes': len(raw) - offset,
        'width': width, 'height': height, 'dxgiFormat': dxgi_format,
        'colorSpace': 'srgb' if dxgi_format in (29, 78, 99) else 'linear',
        'url': '/assets/textures/master1uv-emissive/' + public.name, 'sha256': sha(pixels),
        'operation': 'Select existing native DDS mip; preserve remaining compressed mip bytes; historical native DDS-to-PNG decode; unchanged PNG copied to browser. No resampling or channel mutation.'}

assert len(provenance)==16
for texture in provenance.values():
 original=(ROOT/texture['sourceDdsPath']).read_bytes();selected=(ROOT/texture['selectedDdsPath']).read_bytes();png=(ROOT/'web/public'/texture['url'].lstrip('/')).read_bytes()
 assert sha(original)==texture['sourceDdsSha256'] and sha(selected)==texture['selectedDdsSha256'] and sha(png)==texture['sha256']
 assert selected[148:]==original[texture['sourceDataOffset']:]
materials=[{**m,'textures':{role:provenance[b['texture']['fileGuid']]['url']for role,b in m['bindings'].items()}}for m in report['materials']]
document={k:report[k]for k in ['evidenceId','shaderName','shaderNameHash','shaderGuid','pixelShader','pixelShaderSha256','pairedVertexShader','pairedVertexShaderSha256','sourceRvmSha256','textureMapping','constantMapping','limitations','placedSectionCount','visibleCoverage','nativeMaterialModel','nativeLightingInputs','sourceEmissionLiterals']}
atlas_path=ROOT/'exports/materials/master1uv-emissive-static-atlas/integration-recipe.json'
atlas=json.loads(atlas_path.read_text())
assert atlas['family']=='master1uv-emissive' and atlas['gbuffer']['materialID']==0
assert atlas['emissive']['separateThreeEmission'] is False
document['nativeLightingInputs']={**document['nativeLightingInputs'],
 'rawSmoothness':'bf2_master1uv_emissive_surface.smoothness',
 'emissiveExpression':'bf2_master1uv_emissive_surface.emissive',
 'emissiveStage':'add-to-atlas-or-SH-before-DFG-albedo-metalness', 'separateThreeEmission':False,
 'sourceAtlasRecipe':atlas_path.relative_to(ROOT).as_posix(), 'sourceAtlasRecipeSha256':sha(atlas_path.read_bytes()),
 'diffuse':'(atlasOrSH + sourceEmission) * baseColor * (1-sourceMetalness) * native DFG.b'}
document['limitations']=[*[s for s in document['limitations'] if s != 'Native derivative/packed tangent parity remains unresolved.'],
 'Exact frames are scoped to13 rigid32-byte metallic records and3 independently proven rigid44-byte explicit-binormal sections. The48-byte and36-byte color/sign records remain excluded.',
 'Both original producers add source emission to atlas or SH prelighting before ordinary DFG/albedo/nonmetal response. Browser SH fallback retains its existing diffuse-only approximation.',
 'Without native DFG resources the fallback Lambert response remains reconstructed; emission is still added before the same response and is not a separate Three contribution.']
document.update({'materials':materials,'sourceTextures':provenance,'runtimeMapping':{
 'color':'Original layered Master1UV color blended to source emissiveBaseColor by thresholded normalEmission blue.',
 'emissive':'Original linear mask*emissiveColor*emissiveIntensity joins atlas or SH prelighting before frame exposure and native DFG.b*baseColor*(1-metalness). Separate Three emission is zero; section intensities15000,3000,100 retain source scale.',
 'roughness':'Browser1-clamp(native smoothness,0,1); native deferred GBuffer preserves unclamped smoothness. Full native forward pass selection remains unobserved.',
 'metalness':'Two native gbLayout=0 consumers prove ordinary ID0 o2.y metalness and o2.z=.5 dielectric reflectance: F0=mix(.04,baseColor,metalness),diffuse=(1-metalness)*baseColor. Browser clamps source metalness to0..1.',
 'normal':'Original forward-transform tangent frames cover13 rigid32-byte metallic records (BF2-NATIVE-TANGENT-METALLIC-001) plus3 rigid44-byte sections with independently stored Binormal (BF2-NATIVE-TANGENT44-001). The48-byte and color/sign layouts retain their derivative frame. Geometric normal for grunge remains interpolated without fragment renormalization.',
 'ao':'None in selected source producer. NormalEmission alpha is unused; do not inherit nonemissive Master alpha AO.',
 'colorSpace':'Preserves original DDS SRGB/UNORM format distinction; native resource view overrides remain unresolved.',
 'mipSelection':'14 verified textures reused unchanged from Master1UV,2 newly decoded existing native mips at most1024; browser regenerates lower PNG mips.'}})
glsl=(ROOT/'tools/materials/master1uv-emissive-equations.glsl').read_text();document['sourceEquationSha256']=sha(glsl.encode())
(ROOT/'web/public/assets/recovered-master1uv-emissive-materials.json').write_text(json.dumps(document,indent=2))
template=(ROOT/'tools/materials/master1uv-emissive-adapter.template.js').read_text()
(ROOT/'web/src/master1uv-emissive-material.js').write_text(template.replace('__MASTER1UV_EMISSIVE_GLSL__',json.dumps(glsl)))
(OUT/'provenance.json').write_text(json.dumps(provenance,indent=2))
print(json.dumps({'sections':len(materials),'placements':126,'reusedTextures':14,'newTextures':2,'newPngBytes':sum(p.stat().st_size for p in PUBLIC.glob('*.png'))}))
