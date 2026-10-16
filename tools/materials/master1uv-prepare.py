"""Package exact source DDS mip levels and source material equations for browser use.

No PNG resampling/channel mutation: strip larger source DDS mip levels, then use
the existing historical DDS decoder. Every byte range and output is hashed.
"""
import hashlib, json, pathlib, struct, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'exports/materials/master1uv-textures'
OUT = ROOT / 'exports/materials/master1uv-bounded-textures'
PUBLIC = ROOT / 'web/public/assets/textures/master1uv'
OUT.mkdir(exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
report = json.loads((ROOT / 'exports/materials/master1uv-shader/material-analysis.json').read_text())
manifest = json.loads((SOURCE / 'texture.manifest.json').read_text())
assert manifest['complete'] and not manifest['errors'] and len(manifest['results']) == 52
provenance = {}

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
        'url': '/assets/textures/master1uv/' + public.name, 'sha256': sha(pixels),
        'operation': 'Select existing native DDS mip; preserve remaining compressed mip bytes; historical native DDS-to-PNG decode; unchanged PNG copied to browser. No resampling or channel mutation.'}

materials = []
for row in report['materials']:
    materials.append({**row, 'textures': {role: provenance[binding['texture']['fileGuid']]['url'] for role, binding in row['bindings'].items()}})
document = {key: report[key] for key in ['evidenceId', 'shaderName', 'shaderNameHash', 'shaderGuid', 'pixelShader', 'pixelShaderSha256', 'pairedVertexShader', 'sourceRvmSha256', 'textureMapping', 'constantMapping', 'sourceLiterals', 'limitations']}
document.update({'materials': materials, 'sourceTextures': provenance,
                 'runtimeMapping': {
                     'equations': 'Exact selected deferred DXBC material inputs, including unclamped blend weights; numerically checked by independent disassembly interpreter.',
                     'roughness': '1-clamp(source smoothness,0,1); the companion forward shader explicitly complements its clamped source smoothness.',
                     'metalness': 'BF2-NATIVE-GBUFFER-001: ordinary materialID0 uses o2.y as metalness and o2.z=0.5 as reflectance, yielding dielectric F0=0.04. Browser clamps o2.y to [0,1]; native GBuffer quantization remains unresolved.',
                     'normal': 'Derivative UV tangent frame when native tangents are unavailable. Native vertex tangent signs are documented, but decoded mesh source tangent parity remains unproven.',
                     'grungeGeometricNormal': 'Normalized at vertices, then interpolated without pixel-stage renormalization, matching ordinary PS v2.xy and atlas PS v3.xy. Final material TBN normal is normalized separately.',
                     'ambientOcclusion': 'Source packed alpha applied to indirect diffuse, matching source prelighting location.',
                     'colorSpace': 'Use source DDS SRGB versus UNORM format. Native resource-view overrides, if any, are unresolved.',
                     'mipSelection': 'Largest existing native mip no larger than 1024; browser generates lower PNG mip levels. Native streaming and sampler states remain separate.'}})
(ROOT / 'web/public/assets/recovered-master1uv-materials.json').write_text(json.dumps(document, indent=2))
template = (ROOT / 'tools/materials/master1uv-adapter.template.js').read_text()
glsl = (ROOT / 'tools/materials/master1uv-equations.glsl').read_text()
(ROOT / 'web/src/master1uv-material.js').write_text(template.replace('__MASTER1UV_GLSL__', json.dumps(glsl)))
(OUT / 'provenance.json').write_text(json.dumps(provenance, indent=2))
print(json.dumps({'materials': len(materials), 'textures': len(provenance), 'pngBytes': sum((PUBLIC / (guid + '.png')).stat().st_size for guid in provenance), 'maxTextureDimension': max(max(p['width'], p['height']) for p in provenance.values())}))
