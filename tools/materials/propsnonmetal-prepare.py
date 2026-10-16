"""Publish exact source PropsNonMetallicPreset texture mips and material inputs."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/propsnonmetal-bounded-textures'
PUBLIC = ROOT / 'web/public/assets/textures/propsnonmetal'
ROLES = {5861109: 'base', 5861212: 'normal'}
sha = lambda data: hashlib.sha256(data).hexdigest()


def main():
    report = json.loads((ROOT / 'exports/materials/propsnonmetal-shader/material-analysis.json').read_text())
    identities = {binding['texture']['fileGuid']: binding['texture'] for row in report['materials'] for binding in row['bindings'] if binding['parameterHash'] in ROLES}
    sources, provenance = {}, {}
    for manifest in sorted((ROOT / 'exports/materials').glob('*/texture.manifest.json')):
        for row in json.loads(manifest.read_text()).get('results', []):
            if row.get('guid') in identities and (manifest.parent / row['file']).exists():
                sources[row['guid']] = manifest.parent / row['file'], row
    assert sources.keys() == identities.keys()
    OUT.mkdir(exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for guid, identity in identities.items():
        source, entry = sources[guid]
        raw = source.read_bytes()
        assert raw[:4] == b'DDS ' and raw[84:88] == b'DX10'
        height, width = struct.unpack_from('<II', raw, 12)
        mip_count, dxgi = struct.unpack_from('<I', raw, 28)[0], struct.unpack_from('<I', raw, 128)[0]
        assert dxgi in [28, 29, 71, 72, 77, 78, 83, 98, 99]
        compressed = dxgi not in [28, 29]
        block_bytes = 8 if dxgi in [71, 72] else 16
        def size(w, h):
            return max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * block_bytes if compressed else w * h * 4
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
            'colorSpace': 'srgb' if dxgi in [29, 72, 78, 99] else 'linear', 'url': '/assets/textures/propsnonmetal/' + target.name, 'sha256': sha(pixels),
            'operation': 'Select original native mip and preserve compressed suffix bytes; historical native DDS-to-PNG decode. No resize or channel mutation.'}
    materials = []
    for row in report['materials']:
        bindings = {ROLES[binding['parameterHash']]: binding for binding in row['bindings'] if binding['parameterHash'] in ROLES}
        assert set(bindings) == {'base','normal'}
        materials.append({**row, 'bindings': bindings, 'unboundSourceTextures':[binding for binding in row['bindings'] if binding['parameterHash'] not in ROLES], 'textures': {role: provenance[binding['texture']['fileGuid']]['url'] for role, binding in bindings.items()},
            'sourceShader': report['shaderName']})
    document = {'schemaVersion':1,'evidenceId':'BF2-PROPSNONMETAL-MATERIAL-001','shaderName':report['shaderName'],'sourceRvmSha256':report['sourceRvmSha256'],
        'routingEvidence':'exports/materials/propsnonmetal-shader/material-analysis.json','routingSha256':sha((ROOT/'exports/materials/propsnonmetal-shader/material-analysis.json').read_bytes()),
        'pixelShader':'1e3d99cec3','pixelShaderSha256':report['pixelShaders']['1e3d99cec3']['sha256'],'materials':materials,'sourceTextures':provenance,'placedSectionCount':122,
        'activeAlternativeLods':report['activeAlternativeLods'],
        'nativeLightingInputs':{'materialId':0,'reflectance':.5,'metalness':0,'ao':1,'smoothnessExpression':'bf2_propsnonmetal_surface.smoothness',
            'ordinarySH':'Normalized final world normal, source CS alpha, original broadened specular scale1 before final maxRGB0.',
            'atlas':'Exact19 eligible/3 excluded sections from separate integration recipe.'},
        'runtimeMapping':{'color':'OriginalCS.rgb','normal':'Original NW.rg decoded2*x-1; source reconstructed positiveZ, final normalize(TBN*normal). Derivative frame remains separate.',
            'smoothness':'RawCS.a; source prelighting saturates internally, Three roughness=1-clamp(smoothness,0,1).','metalness':0,'sampling':'OriginalUV0; native wrapU/V for both packed source textures.',
            'lighting':'OrdinaryID0/reflectance.5, normalized-normal SH plus always-on broadened SH term or exact selected original atlas; no extra AO or emission.'},
        'limitations':['Original live dispatch and runtime overrides are not captured.','Derivative frame remains distinct from separately validated native vertex frames.',
            'Original always-on broadened SH retains native undefined zero dominant direction/opposing half-vector normalization.',
            'Native mip selection preserves source bytes; browser lowerPNG mips and anisotropic filtering remain renderer boundaries.',
            'Source sky visibility arithmetic is recovered; general environment sky composition remains a separate renderer boundary.']}
    (ROOT / 'web/public/assets/recovered-propsnonmetal-materials.json').write_text(json.dumps(document, indent=2) + '\n')
    (OUT / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    template = (ROOT / 'tools/materials/propsnonmetal-adapter.template.js').read_text()
    equations = (ROOT / 'tools/materials/propsnonmetal-equations.glsl').read_text()
    (ROOT / 'web/src/propsnonmetal-material.js').write_text(template.replace('__PROPSNONMETAL_GLSL__', json.dumps(equations)))
    print(json.dumps({'materials':len(materials),'textures':len(provenance),'newPngBytes':sum(path.stat().st_size for path in PUBLIC.glob('*.png'))}))


if __name__ == '__main__':
    main()
