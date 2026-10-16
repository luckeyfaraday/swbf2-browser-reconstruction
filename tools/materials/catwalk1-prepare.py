"""Publish selected original Catwalk1 texture mips and exact source constants."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/catwalk1-bounded-textures'
PUBLIC = ROOT / 'web/public/assets/textures/catwalk1'
ROLES = {5861109: 'base', 5861212: 'normal', 5861208: 'detail', 2990320127: 'grunge'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    report = json.loads((ROOT / 'exports/materials/catwalk1-shader/material-analysis.json').read_text())
    identities = {binding['texture']['fileGuid']: binding['texture'] for row in report['materials'] for binding in row['textureBindings']}
    existing = json.loads((ROOT / 'web/public/assets/recovered-catwalk2-materials.json').read_text())['sourceTextures']
    provenance, sources = {}, {}
    for manifest in sorted((ROOT / 'exports/materials').glob('*/texture.manifest.json')):
        for row in json.loads(manifest.read_text()).get('results', []):
            if row.get('guid') in identities and (manifest.parent / row['file']).exists():
                sources[row['guid']] = manifest.parent / row['file'], row
    OUT.mkdir(exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for guid, identity in identities.items():
        sampler = '83d4c1d84a' if guid == '033e766d-adf0-4825-9525-eee84f5b038c' else '5993a514cd'
        if guid in existing:
            row = existing[guid]
            assert row['source']['rootInstanceGuid'] == identity['rootInstanceGuid']
            assert sha((ROOT / row['sourceDdsPath']).read_bytes()) == row['sourceDdsSha256']
            assert sha((ROOT / 'web/public' / row['url'].lstrip('/')).read_bytes()) == row['sha256']
            provenance[guid] = {**row, 'sampler': sampler, 'reusedSourceDocument': 'recovered-catwalk2-materials.json'}
            continue
        source, entry = sources[guid]
        raw = source.read_bytes()
        assert raw[:4] == b'DDS ' and raw[84:88] == b'DX10'
        height, width = struct.unpack_from('<II', raw, 12)
        mip_count, dxgi = struct.unpack_from('<I', raw, 28)[0], struct.unpack_from('<I', raw, 128)[0]
        assert dxgi in [28, 29, 77, 78, 83, 98, 99]
        compressed = dxgi not in [28, 29]
        def size(w, h):
            return max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * 16 if compressed else w * h * 4
        offset, skip = 148, 0
        while max(width, height) > 1024:
            offset += size(width, height)
            width, height, skip = max(1, width // 2), max(1, height // 2), skip + 1
        assert skip < mip_count
        w, h, expected = width, height, 0
        for _ in range(mip_count - skip):
            expected += size(w, h)
            w, h = max(1, w // 2), max(1, h // 2)
        assert len(raw) - offset == expected
        header = bytearray(raw[:148])
        struct.pack_into('<II', header, 12, height, width)
        struct.pack_into('<I', header, 20, size(width, height) if compressed else width * 4)
        struct.pack_into('<I', header, 28, mip_count - skip)
        selected = bytes(header) + raw[offset:]
        dds, png = OUT / (guid + '.dds'), OUT / (guid + '.png')
        changed = not dds.exists() or dds.read_bytes() != selected
        if changed:
            dds.write_bytes(selected)
        if changed or not png.exists():
            subprocess.run([str(ROOT / 'tools/bf2-extract/bf2-extract.exe'), 'dds-png', '--input', str(dds), '--out', str(png)], cwd=ROOT, check=True, capture_output=True)
        pixels = png.read_bytes()
        assert struct.unpack_from('>II', pixels, 16) == (width, height)
        target = PUBLIC / png.name
        target.write_bytes(pixels)
        provenance[guid] = {'source': identity, 'sourceMetadata': entry['metadata'], 'sourceDdsPath': source.relative_to(ROOT).as_posix(),
            'sourceDdsSha256': sha(raw), 'selectedDdsPath': dds.relative_to(ROOT).as_posix(), 'selectedDdsSha256': sha(selected), 'sourceMip': skip,
            'sourceDataOffset': offset, 'retainedDataBytes': len(raw) - offset, 'width': width, 'height': height, 'dxgiFormat': dxgi,
            'colorSpace': 'srgb' if dxgi in [29, 78, 99] else 'linear', 'url': '/assets/textures/catwalk1/' + target.name, 'sha256': sha(pixels), 'sampler': sampler,
            'operation': 'Select existing native mip, preserve compressed suffix bytes, historical native DDS-to-PNG decode; no resize or channel mutation.'}
    materials = []
    for row in report['materials']:
        bindings = {ROLES[binding['parameterHash']]: binding for binding in row['textureBindings']}
        materials.append({**row, 'bindings': bindings, 'textures': {role: provenance[binding['texture']['fileGuid']]['url'] for role, binding in bindings.items()},
            'constants': [row['constant']['value']], 'sourceShader': report['shaderName']})
    document = {'schemaVersion': 1, 'evidenceId': 'BF2-CATWALK1-MATERIAL-001', 'shaderName': report['shaderName'], 'sourceRvmSha256': report['sourceRvmSha256'],
        'routingEvidence': 'exports/materials/catwalk1-shader/material-analysis.json', 'routingSha256': sha((ROOT / 'exports/materials/catwalk1-shader/material-analysis.json').read_bytes()),
        'pixelShader': 'd260c7f82c', 'pixelShaderSha256': report['pixelShaders']['d260c7f82c']['sha256'], 'materials': materials, 'sourceTextures': provenance, 'placedSectionCount': 312,
        'activeAlternativeLods': report['activeAlternativeLods'],
        'nativeLightingInputs': {'materialId': 0, 'reflectance': .5, 'metalness': 0, 'shNormal': 'normalized-final-world-normal', 'smoothnessExpression': 'bf2_catwalk1_surface.smoothness', 'ao': 1},
        'runtimeMapping': {'color': 'Original CS.rgb * worldGrunge.rgb, original DDS transfer functions.', 'normal': 'Original normalized NW + NS tangent equation, then exact native interpolated T/B/N and final normalization for28 source-bound rigid28/32 records covering all312 base instances and5 native LODs. Unbound geometry retains derivative fallback.',
            'smoothness': 'Original CS.a * worldGrunge.a * NS.b retained raw for native lighting; Three uses 1-clamp(smoothness,0,1).',
            'sampling': 'Native NW clamp U/V and all other material samplers wrap U/V. Source absolute world XZ *0.1 grunge; original UV0 elsewhere.',
            'lighting': 'Ordinary native ID0, metalness0, reflectance0.5; no material AO, emission or alpha rejection.'},
        'limitations': ['Original live pass activation and runtime material overrides are not captured.', 'Current derivative TBN mapping is distinct from original native vertex-frame recovery.',
            'Native mip selected without resampling; browser lower PNG mips and anisotropic filtering remain renderer boundaries.', 'One source section has no selected atlas route; use exact recipe eligibility.']}
    (ROOT / 'web/public/assets/recovered-catwalk1-materials.json').write_text(json.dumps(document, indent=2) + '\n')
    (OUT / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    template = (ROOT / 'tools/materials/catwalk1-adapter.template.js').read_text()
    equations = (ROOT / 'tools/materials/catwalk1-equations.glsl').read_text()
    (ROOT / 'web/src/catwalk1-material.js').write_text(template.replace('__CATWALK1_GLSL__', json.dumps(equations)))
    print(json.dumps({'materials': len(materials), 'textures': len(provenance), 'reusedTextures': sum('reusedSourceDocument' in row for row in provenance.values()), 'newPngBytes': sum(path.stat().st_size for path in PUBLIC.glob('*.png'))}))


if __name__ == '__main__':
    main()
