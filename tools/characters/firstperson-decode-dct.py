# SPDX-License-Identifier: GPL-3.0-or-later
# DCT algorithm adapted from marv7000/AssetBankPlugin, Ant/DCT (GPL-3.0).
# The retained upstream source and full license are in assetbank-reference/.
"""Narrow, bounds-checked BF2 DCT sample decoder; no native timing/blend claim."""
import hashlib
import json
import math
from pathlib import Path
from importlib.machinery import SourceFileLoader
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
select = SourceFileLoader('firstperson_dct_select', str(ROOT / 'tools/characters/select-animation.py')).load_module()

# Upstream uses a rounded float32 table. Preserve it for independent byte/sample
# comparison instead of silently changing quantization by recomputing cosines.
COEFFICIENTS = np.array([
    [.25,.490393,.461940,.415735,.353553,.277785,.191342,.097545],
    [.25,.415735,.191342,-.097545,-.353553,-.490393,-.461940,-.277785],
    [.25,.277785,-.191342,-.490393,-.353553,.097545,.461940,.415735],
    [.25,.097545,-.461940,-.277785,.353553,.415735,-.191342,-.490393],
    [.25,-.097545,-.461940,.277785,.353553,-.415735,-.191342,.490393],
    [.25,-.277785,-.191342,.490393,-.353553,-.097545,.461940,-.415735],
    [.25,-.415735,.191342,.097545,-.353553,.490393,-.461940,.277785],
    [.25,-.490393,.461940,-.415735,.353554,-.277785,.191342,-.097545],
], dtype=np.float32)


class Bits:
    def __init__(self, data):
        self.data = data
        self.cursor = 0

    def signed(self, count):
        if not 0 <= count <= 16:
            raise ValueError(f'Unsupported coefficient bit width {count}')
        if self.cursor + count > len(self.data) * 8:
            raise ValueError('DCT coefficient exceeds retained Data range')
        value = 0
        for _ in range(count):
            value = (value << 1) | ((self.data[self.cursor // 8] >> (7 - self.cursor % 8)) & 1)
            self.cursor += 1
        return value - (1 << count) if count and value & (1 << (count - 1)) else value


def decompress(values):
    q, t, f = (values[k] for k in ('NumQuats', 'NumVec3', 'NumFloatVec'))
    if f or values['NumFloat']:
        raise ValueError('Selected decoder intentionally excludes packed scalar channels')
    count = q + t + f
    desc = values['DofTableDescBytes']
    bases = list(zip(*(values['DeltaBase' + axis] for axis in 'XYZW')))
    assert len(desc) == len(bases) == count
    assert values['QuantizeMultBlock'] > 0
    assert values['NumKeys'] > 0
    if any(d & 15 for d in desc):
        raise ValueError('Selected BF2 clips have zero descriptor low nibble; other flags are unsupported')
    table, cursor = [], 0
    for d in desc:
        bands = d >> 4
        assert 0 <= bands <= 8
        packed = values['BitsPerSubblock'][cursor:cursor + bands]
        assert len(packed) == bands
        widths = [[values['CatchAllBitCount'] if ((p >> shift) & 15) == 15 else ((p >> shift) & 15)
                   for shift in (12, 8, 4, 0)] for p in packed]
        table.append(widths)
        cursor += bands
    assert cursor == len(values['BitsPerSubblock'])
    reader = Bits(values['Data'])
    block_count = (values['NumKeys'] + 7) // 8
    blocks = np.zeros((block_count, count, 8, 4), dtype=np.int16)
    for block in range(block_count):
        for channel, widths in enumerate(table):
            for band in range(1 if block == 0 else 0, len(widths)):
                blocks[block, channel, band] = [reader.signed(w) for w in widths[band]]
            blocks[block, channel, 0] = [((int(v) + base + 32768) % 65536) - 32768
                                        for v, base in zip(blocks[block, channel, 0], bases[channel])]
    expected = sum(sum(w) for widths in table for w in widths[1:])
    expected += (block_count - 1) * sum(sum(w) for widths in table for w in widths)
    assert reader.cursor == expected
    factors = []
    for band in range(8):
        mult = np.float32(np.float32(np.float32(values['QuantizeMultSubblock']) * np.float32(.1)) * np.float32(band))
        factors.append(np.float32(np.float32(mult + np.float32(1)) / np.float32(values['QuantizeMultBlock'])))
    output = np.zeros((values['NumKeys'], count, 4), dtype=np.float32)
    for frame in range(values['NumKeys']):
        for band in range(8):
            coefficient = np.float32(COEFFICIENTS[frame % 8, band] * factors[band])
            output[frame] += blocks[frame // 8, :, band].astype(np.float32) * coefficient
    trailing_set_bits = sum((reader.data[n // 8] >> (7 - n % 8)) & 1
                            for n in range(reader.cursor, len(reader.data) * 8))
    # Retain the exact trailing range rather than consuming it as coefficients
    # or treating DataSize as compressed length. All three selected clips pad
    # their coefficient stream with zero bits; do not generalize that to others.
    return output, {'coefficientBitsRead': reader.cursor, 'dataBits': len(reader.data) * 8,
                    'trailingBits': len(reader.data) * 8 - reader.cursor,
                    'trailingSetBits': trailing_set_bits,
                    'descriptorLowNibbles': sorted({d & 15 for d in desc}),
                    'subblockCounts': sorted({d >> 4 for d in desc}),
                    'blockCount': block_count, 'blocksSha256': hashlib.sha256(blocks.tobytes()).hexdigest()}


def main():
    bank = select.AnimationBank('exports/characters/ant-common-bank')
    rig = bank.objects['ce0e5ba5ab202d65']['values']
    ids = bank.array(rig['DofIds'])
    dofs = {}
    for key, offset in zip(bank.array(rig['RigDofSets']), bank.array(rig['DofSetIdIndices'])):
        layout = bank.objects[key]['values']
        if 'Slots' in layout:
            for index, slot in enumerate(bank.array(layout['Slots'])):
                dofs[ids[offset + index]] = {**slot, 'layout': layout['__name'], 'layoutKey': key}
    names = ['Add_1p_E11_SingleFire01', 'Add_1p_A280_SingleFire_02', 'Add_1p_A280_SingleFire_03']
    folder = ROOT / 'exports/characters/firstperson-dct'
    folder.mkdir(exist_ok=True)
    clips = []
    for name in names:
        candidates = [o for o in bank.objects.values() if o['type'] == 'ClipControllerAsset' and o['values']['__name'] == name]
        assert len(candidates) == 1
        controller = candidates[0]
        animation = bank.objects[controller['values']['Anim']]
        assert animation['type'] == 'DctAnimationAsset'
        assert animation['base']['values']['Additive']
        values = {k: bank.array(v) if isinstance(v, dict) and 'arrayOffset' in v else v
                  for k, v in animation['values'].items()}
        assert len(values['KeyTimes']) == values['NumKeys']
        assert all(a < b for a, b in zip(values['KeyTimes'], values['KeyTimes'][1:]))
        samples, details = decompress(values)
        mapping, _, _ = bank.channels(animation)
        assert len(mapping) == values['NumQuats'] + values['NumVec3']
        tracks, unmapped = [], []
        norms = np.linalg.norm(samples[:, :values['NumQuats']].astype(np.float64), axis=2)
        if not np.isfinite(samples).all() or np.any(norms < .5) or np.any(norms > 1.5):
            raise ValueError('Decoded source samples fail finite/quaternion plausibility bounds')
        for channel, dofid in enumerate(mapping):
            prop = 'rotation' if channel < values['NumQuats'] else 'translation'
            slot = dofs.get(dofid)
            if slot is None:
                unmapped.append({'channel': channel, 'dofId': dofid, 'property': prop,
                                 'rawVec4': samples[:, channel].tolist()})
                continue
            assert slot['type'] == (14 if prop == 'rotation' else 2049856663)
            tracks.append({'bone': slot['name'].rsplit('.', 1)[0], 'property': prop,
                           'sourceChannelIndex': channel, 'sourceDofId': dofid, 'sourceSlot': slot,
                           'rawVec4': samples[:, channel].tolist()})
        source = {'controller': controller, 'animation': animation, 'arrayValues': values}
        (folder / f'{name}.source.json').write_text(json.dumps(source, indent=2))
        samples.tofile(folder / f'{name}.python.f32')
        details.update(rawQuaternionNormMin=float(norms.min()), rawQuaternionNormMax=float(norms.max()),
                       rawSamplesSha256=hashlib.sha256(samples.tobytes()).hexdigest())
        clips.append({'sourceName': name, 'sourceAnimationKey': animation['values']['__key'],
                      'controller': controller['values'], 'animationBase': animation['base']['values'],
                      'sourceKeyTimes': values['KeyTimes'], 'sourceCounts': [values['NumQuats'], values['NumVec3'], values['NumFloatVec']],
                      'additive': True, 'rawSamplesShape': list(samples.shape), 'tracks': tracks,
                      'unmapped': unmapped, 'validation': details})
    out = {'evidenceId': 'BF2-FIRSTPERSON-DCT-001', 'sourceBank': bank.metadata['source'],
           'sourceBankSha256': bank.metadata['sha256'], 'sourceRig': rig['__name'], 'clips': clips,
           'reference': {'path': 'tools/characters/assetbank-reference/Ant/DCT',
                         'project': 'https://github.com/marv7000/AssetBankPlugin', 'license': 'GPL-3.0',
                         'licenseFile': 'tools/characters/assetbank-reference/LICENSE'},
           'limitations': ['Decoded additive local samples only; native engine execution has not been observed.',
                           'Source key ticks, FPS=30 and TimeScale=.5 are retained separately. No real-time duration, controller scaling order or playback selection is claimed.',
                           'Source quaternions are retained unnormalized for independent codec comparison; browser materialization requires normalization and verified additive composition.',
                           'Two unmapped Vec3 DOFs and complete blend/IK/camera evaluation remain unresolved.']}
    out['limitations'].append('The selected controller names identify the weapon firing clips; the native weapon-state graph selection and A280 variation policy have not been traced.')
    reference_files = ['DctDecompressor.cs', 'DofTable.cs', 'BitReader.cs']
    out['reference']['sourceFiles'] = [
        {'file': 'tools/characters/assetbank-reference/Ant/DCT/' + name,
         'sha256': hashlib.sha256((ROOT / 'tools/characters/assetbank-reference/Ant/DCT' / name).read_bytes()).hexdigest()}
        for name in reference_files]
    (folder / 'decoded-clips.json').write_text(json.dumps(out, separators=(',', ':')))
    print(json.dumps({'evidenceId': out['evidenceId'], 'clips': [
        {'name': c['sourceName'], 'shape': c['rawSamplesShape'], 'keyTimes': c['sourceKeyTimes'], 'validation': c['validation']}
        for c in clips]}, indent=2))


if __name__ == '__main__':
    main()
