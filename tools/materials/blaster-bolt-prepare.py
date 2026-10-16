"""Package exact source DDS mip levels and source material equations for browser use.

No PNG resampling/channel mutation: strip larger source DDS mip levels, then use
the existing historical DDS decoder. Every byte range and output is hashed.
"""
import hashlib, json, pathlib, struct, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'exports/rifle-trail/render-material-textures'
OUT = ROOT / 'exports/rifle-trail/render-material-bounded-textures'
PUBLIC = ROOT / 'web/public/assets/textures/blaster-bolt'
OUT.mkdir(exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
report = json.loads((ROOT / 'exports/rifle-trail/render-shaders/render-material-analysis.json').read_text())
manifest = json.loads((SOURCE / 'texture.manifest.json').read_text())
assert manifest['complete'] and not manifest['errors'] and len(manifest['results']) == 4
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
        'url': '/assets/textures/blaster-bolt/' + public.name, 'sha256': sha(pixels),
        'operation': 'Select existing native DDS mip; preserve remaining compressed mip bytes; historical native DDS-to-PNG decode; unchanged PNG copied to browser. No resampling or channel mutation.'}

mesh_target=ROOT/'web/public/assets/meshes/blaster-bolt-source.glb';mesh_target.parent.mkdir(exist_ok=True);mesh_target.write_bytes((ROOT/report['sourceMesh']['glbPath']).read_bytes())
document={**report,'sourceTextures':provenance,'textures':{b['role']:provenance[b['texture']['fileGuid']]['url']for b in report['textureMapping']},'sourceMesh':{**report['sourceMesh'],'url':'/assets/meshes/blaster-bolt-source.glb'}}
glsl=(ROOT/'tools/materials/blaster-bolt-equations.glsl').read_text();document['sourceEquationSha256']=sha(glsl.encode())
(ROOT/'web/public/assets/recovered-blaster-bolt-material.json').write_text(json.dumps(document,indent=2))
template=(ROOT/'tools/materials/blaster-bolt-adapter.template.js').read_text();(ROOT/'web/src/blaster-bolt-material.js').write_text(template.replace('__BLASTER_BOLT_GLSL__',json.dumps(glsl)))
print(json.dumps({'textures':len(provenance),'pngBytes':sum((ROOT/'web/public'/t['url'].lstrip('/')).stat().st_size for t in provenance.values()),'meshBytes':mesh_target.stat().st_size}))
