"""Hash-bound original vignette selection, native state/bindings and shader witness."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lighting/native-vignette'
sha = lambda b: hashlib.sha256(b).hexdigest()


def main():
    p = ROOT / 'tools/materials/native-dfg-pe.py'
    pe = {'__file__': str(p)}
    exec(p.read_text(encoding='utf-8').split('names =')[0], pe)
    data, base, to = pe['data'], pe['image_base'], pe['to_offset']
    assert sha(data) == 'd350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4'
    def string_at(va):
        at = to(va - base)
        return data[at:data.index(b'\0', at)].decode('ascii')
    assert string_at(struct.unpack_from('<Q', data, to(0x144be8680 - base))[0]) == 'VignetteComponentState'
    assert struct.unpack_from('<Q', data, to(0x144be8680 + 0x50 - base))[0] == 0x144dfb890
    fields = []
    for i, (name, offset) in enumerate([('Enable', 0x20), ('Scale', 0x10), ('Exponent', 0x18),
                                       ('Color', 0), ('Opacity', 0x1c)]):
        address = 0x144dfb890 + i * 24
        raw = data[to(address - base):to(address - base) + 24]
        assert string_at(struct.unpack_from('<Q', raw)[0]) == name
        assert struct.unpack_from('<H', raw, 10)[0] == offset
        fields.append(dict(name=name, offset=offset, descriptor=hex(address), bytes=raw.hex()))
    assert struct.unpack_from('<Q', data, to(0x14343dad0 + 0x10 - base))[0] == 0x141568de0
    assert struct.unpack_from('<4f', data, to(0x143092990 - base))[0] == -1
    functions = []
    sources = {
        '140d984b0': ('dfg-native-functions', ['plVar19[1] = lStack_1f0 + 0xd10;']),
        '140d68310': ('dfg-native-functions', ['14408aab4']),
        '140d6cc80': ('dfg-native-functions', ['14408aab4']),
        '14155c680': ('native-postprocess-functions', ['uStack_50 = puVar6[1];', 'FUN_14154fd50(param_2,&uStack_138,param_3)']),
        '14154fd50': ('native-postprocess-functions', ['FUN_141551030(lStack_28,&uStack_40,param_2,param_3)']),
        '141551030': ('dfg-native-functions', ['&UNK_14343dad0', 'LEA R8,[RDI + 0x270]']),
        '141568de0': ('dfg-native-functions', ['*(undefined8 **)(param_1 + 0x358)', '+ 0x221)',
            'fStack_23c = *(float *)(puVar3 + 3);', 'CONCAT44(*(undefined4 *)((longlong)puVar3 + 0x1c)',
            'FUN_14158b6b0(auStack_118,&uStack_278)']),
        '141008870': ('native-postprocess-functions', ['+ 0x34) = 0x40000000', '+ 0x3c) = 0x3f800000', 'param_1[8] = 0;']),
        '14158b6b0': ('dfg-native-functions', ['fVar3 / *(float *)((longlong)param_2 + 0x3c)',
            '*(undefined8 *)((longlong)param_2 + 0x34)', '_DAT_1445f5410', '_DAT_1445f5420']),
        '141595090': ('native-postprocess-functions', ['LEA RDX,[0x1434400e8]', 'LEA RDX,[0x1434400f8]',
            'MOVAPS xmmword ptr [0x1445f5410],XMM0', 'MOVAPS xmmword ptr [0x1445f5420],XMM0']),
        '142deb960': ('dfg-native-functions', ['+ 0x18)', '+ 0xfc) = 0xbf800000', '(param_1 + 0x44) = 0x1000101']),
    }
    for address, (folder, required) in sources.items():
        p = ROOT / 'exports/lighting' / folder / (address + '.c')
        body = p.read_text(encoding='utf-8')
        for fragment in required:
            assert fragment in body, (address, fragment)
        functions.append(dict(address='0x' + address, path=p.relative_to(ROOT).as_posix(), sha256=sha(p.read_bytes())))
    paths = [next((ROOT / 'exports/map-initial/root/ebx').glob('*DeathStar02_01__7a85dea0*.json')),
             next((ROOT / 'exports/map-initial/spatial-extra/ebx').glob('*VE_Gamewide_01__*.json')),
             next((ROOT / 'exports/map-initial/spatial-extra/ebx').glob('*VE_DeathStar_02_Interior_01__*.json'))]
    level, global_ve, interior = [json.loads(p.read_text(encoding='utf-8')) for p in paths]
    objects = {o['$id']: o for o in level['asset']['objects']}
    ref = objects['internal:26']
    assert ref['Blueprint']['$external'] == global_ve['entry']['guid'] and not ref['Excluded']
    level_data = next(o for o in objects.values() if o['$type'] == 'FrostySdk.Ebx.LevelData')
    assert {'$ref': ref['$id']} in level_data['Objects']
    objects = {o['$id']: o for o in global_ve['asset']['objects']}
    entity = objects[objects[global_ve['asset']['root']]['Object']['$ref']]
    vignette = next(o for o in objects.values() if o['$type'] == 'FrostySdk.Ebx.VignetteComponentData')
    assert entity['Enabled'] and entity['Visibility'] == 1 and {'$ref': vignette['$id']} in entity['Components']
    assert not vignette['Excluded'] and vignette['Enable']
    assert set(vignette['PropertyOverrides']) == {'Enable', 'Opacity', 'Exponent', 'Scale'}
    assert not any(o['$type'] == 'FrostySdk.Ebx.VignetteComponentData' for o in interior['asset']['objects'])
    baseline = dict(evidenceId='BF2-NATIVE-VIGNETTE-001', enabled=True,
        scale=[vignette['Scale'][axis] for axis in 'xy'], exponent=vignette['Exponent'],
        color=[vignette['Color'][axis] for axis in 'xyz'], opacity=vignette['Opacity'])
    assert baseline['scale'] == [2, 2] and baseline['exponent'] == 1 and baseline['color'] == [0, 0, 0] and baseline['opacity'] == .46
    # No startup-script vignette override is silently mistaken for the defaults.
    spec = importlib.util.spec_from_file_location('initfs', ROOT / 'tools/materials/native-exposure-initfs.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    initfs = module.SOURCE.read_bytes()
    reader = module.Reader(initfs)
    container = reader.node()
    matches = []
    for entry in container['value']:
        row = {v['name']: v['value'] for v in entry['value'][0]['value']}
        for i, line in enumerate(row['payload'].decode('utf-8').splitlines(), 1):
            if re.search(r'(?i)vignette', line):
                matches.append(dict(file=row['name'], line=i, text=line))
    assert len(container['value']) == 96 and not matches
    # This identical prefix isolates the effect in unchanged non-HDR DXBC;
    # the selected HDR grading shader uses the same operation before PQ.
    prefix = []
    for folder, file in [('native-exposure-shaders', 'linear-baseline'), ('native-postprocess-shaders', 'linear-hdr-grading-lut')]:
        body = (ROOT / 'exports/lighting' / folder / (file + '.asm')).read_text(encoding='utf-8')
        prefix.append(body[body.index('add r0.xy,'):body.index('sample_indexable')])
    assert prefix[0] == prefix[1]
    gpu_path = ROOT / 'web/test-results/source-vignette-gpu-check.json'
    gpu = json.loads(gpu_path.read_text(encoding='utf-8'))
    assert gpu['pass'] and not gpu['errors']
    warp_path = ROOT / 'exports/lighting/native-vignette-warp/execution.json'
    warp = json.loads(warp_path.read_text(encoding='utf-8'))
    report = dict(evidenceId=baseline['evidenceId'], sourceExecutableSha256=sha(data), baseline=baseline,
        stateTypeDescriptor='0x144be8680', fields=fields, functions=functions,
        sourceAssets=[dict(path=p.relative_to(ROOT).as_posix(), sha256=sha(p.read_bytes())) for p in paths],
        selection=dict(reference=ref['$id'], priority=ref['Priority'], globalEntity=entity['$id'],
            globalVignette=vignette['$id'], authoredOverrides=vignette['PropertyOverrides'],
            color='Serialized black default; not a gamewide property override.', interiorVignetteComponent=False),
        initfs=dict(sourceSha256=sha(initfs), files=96, vignetteOverrides=matches),
        bindings=dict(statePointer='Environment+0xd10 -> postprocess context+8 -> task input+e8 -> task+358',
            scale='state+10/+14 -> shader cb0+224/+228', exponent='1/state+18 -> shader cb0+232',
            color='state+0/+4/+8 -> shader cb0+240/+244/+248', opacity='state+1c -> shader cb0+252',
            enabled='state+20 and GlobalPostProcessSettings+221; default enabled',
            overrides='ForceVignetteScale/Exponent/Color use -1 sentinels; all default inactive.'),
        equation='weight=pow(saturate(1-dot((uv-.5)*scale,(uv-.5)*scale)*opacity),1/exponent); output=(exposedRGB-color)*weight+color; before PQ/grade.',
        validation=dict(warpSha256=sha(warp_path.read_bytes()), browserSha256=sha(gpu_path.read_bytes()),
            pixels=warp['width']*warp['height']*len(warp['cases']), browser=gpu['result'], policy=gpu['policy']),
        limitations=['Static level/global environment baseline, not a captured native frame.',
            'Local environment and gameplay vignette overrides are not captured.',
            'Bloom reconstruction remains separate; vignette is applied to the current exposed HDR image before the original grade.'])
    OUT.mkdir(exist_ok=True)
    (OUT / 'evidence.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(dict(baseline=baseline, nativeFunctions=len(functions), pixels=report['validation']['pixels'])))


if __name__ == '__main__':
    main()
