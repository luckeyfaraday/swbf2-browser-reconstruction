"""Original 32-byte Master1UV permutation routing and bounded source selection."""
import collections
import hashlib
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/native-tangent32'
read = lambda path: json.loads((ROOT / path).read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
pattern = [('Pos', 'Half3'), ('BinormalSign', 'Half'), ('Normal', 'Half4'), ('Tangent', 'Half4'),
           ('TexCoord0', 'Half2'), ('RadiosityTexCoord', 'Half2')]


def main():
    selection = read('exports/materials/native-tangent-coverage/selection.json')
    prior = {(r['assetId'], r['sourceLod'], r['sourceMaterialId']): r
             for r in read('exports/materials/native-tangent-coverage/manifest.json')['records']}
    targets = []
    names = collections.defaultdict(list)
    for row in selection['targets']:
        direct = prior.get((row['assetId'], row['sourceLod'], row['sourceMaterialId']))
        fields = direct['fields'] if direct else row['retainedLayout']['elements']
        if [(f['usage'], f['format']) for f in fields] != pattern:
            continue
        assert row['family'] == 'master1uv'
        targets.append(row)
        names[(row['name'], row['sourceLod'])].append(row['sourceMaterialId'])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'names.txt').write_text('\n'.join(f'{name}|{lod}|' + ','.join(map(str, sorted(ids)))
                                           for (name, lod), ids in sorted(names.items())) + '\n')
    (OUT / 'selection.json').write_text(json.dumps(dict(evidenceId='BF2-NATIVE-TANGENT32-001', targets=targets,
                    sourceSelectionSha256=sha((ROOT / 'exports/materials/native-tangent-coverage/selection.json').read_bytes())), indent=2) + '\n')

    index = read('exports/materials/rvm/block-index.json')['blocks']
    raw = (ROOT / 'exports/materials/rvm/0.res').read_bytes()
    graph = read('exports/materials/master1uv-shader/graph.json')
    links = collections.defaultdict(list)
    for edge in graph['edges']:
        links[edge['from']].append(edge)

    def block(key):
        row = index[key]
        return raw[row['offset']:row['offset'] + row['size']]

    def route(start, target, depth=4):
        if start == target:
            return []
        if depth == 0:
            return None
        for edge in links[start]:
            rest = route(edge['to'], target, depth - 1)
            if rest is not None:
                assert struct.unpack_from('<Q', block(start), edge['offset'])[0] == int(edge['encoded'])
                assert int(edge['encoded']) & 0xffffffffff == int(edge['to'], 16)
                return [edge] + rest
        return None

    layout = 'ad2dd1141c'
    decoded = []
    for string, semantic, fmt, slot, offset, kind, step in struct.iter_unpack('<Q6I', block(layout)):
        assert block(f'{string & 0xffffffffff:010x}') == b'TEXCOORD\0'
        decoded.append(dict(semantic='TEXCOORD', index=semantic, dxgiFormat=fmt, inputSlot=slot,
                            offset=offset, classification=kind, step=step))
    assert [(r['index'], r['dxgiFormat'], r['offset']) for r in decoded] == [(0, 10, 0), (1, 10, 8), (2, 10, 16), (3, 10, 24)]
    assert all(r['inputSlot'] == r['classification'] == r['step'] == 0 for r in decoded)
    shaders = []
    for vertex, pixel, parameter, atlas in [('282854795b', '6d0dd89b35', '5801d6e1eb', False),
                                           ('69a5d07239', '965fbe264b', 'fcb3b64cb2', True)]:
        vs = next(key for key, row in graph['blocks'].items()
                  if row['type'].endswith('Dx11VsShader') and any(edge['to'] == vertex for edge in links[key]))
        paths = dict(vertex=route(parameter, vertex), pixel=route(parameter, pixel), layout=route(vs, layout))
        assert all(paths.values())
        bytecode = (ROOT / f'exports/materials/master1uv-shader/{vertex}.dxbc').read_bytes()
        encoded = block(vertex)
        start = encoded.index(b'DXBC')
        length = struct.unpack_from('<I', encoded, start + 24)[0]
        assert bytecode == encoded[start:start + length]
        shaders.append(dict(family='master1uv', vertex=vertex, pixel=pixel, atlas=atlas,
                            vertexObject=vs, parameterBlock=parameter, paths=paths,
                            vertexSha256=sha(bytecode), inputLayoutBlock=layout,
                            inputLayoutOffset=index[layout]['offset'], inputLayoutSha256=sha(block(layout)), inputLayout=decoded,
                            normalOutputRegister=3 if atlas else 2, frameOutputRegisters=[4, 5, 6] if atlas else [3, 4, 5]))
    document = dict(evidenceId='BF2-NATIVE-TANGENT32-001', sourceRvmSha256=sha(raw), sourceStride=32,
                    shaders=shaders, shaderInputBindings=dict(position='input0.xyz, raw Half3 bytes0..5',
                        handedness='input0.w, separate raw Half at6', normal='input1.xyz, original Half4 at8',
                        tangent='input2.xyz, original Half4 at16', uv0='input3.xy, original Half2 at24',
                        radiosity='input3.zw, original Half2 at28; read by atlas VS69a5d07239'),
                    equation='normalize(M*N), normalize(M*(-T)), normalize(M*(-cross(N,T)*sourceBinormalSign))',
                    limits=['Original parameter blocks directly pair each VS with the already recovered ordinary or atlas Master1UV PS.',
                            'This is the retained four-Half4 input layout, not a guessed modification of the36-byte layout.',
                            'Native runtime dispatch and a live original frame are not captured.'])
    (OUT / 'shader-routing.json').write_text(json.dumps(document, indent=2) + '\n')
    print(json.dumps(dict(targetSections=len(targets), assetLods=len(names), sourceStride=32, shaders=len(shaders))))


if __name__ == '__main__':
    main()
