"""Focused source/codec verification. Run from any working directory."""
import copy
import hashlib
import json
from pathlib import Path
from importlib.machinery import SourceFileLoader
import unittest
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
codec = SourceFileLoader('firstperson_test_dct', str(ROOT / 'tools/characters/firstperson-decode-dct.py')).load_module()
FOLDER = ROOT / 'exports/characters/firstperson-dct'


class FirstPersonDctTests(unittest.TestCase):
    def test_signed_bitreader_crosses_byte_and_64bit_boundaries(self):
        reader = codec.Bits(bytes([0b11110101, 0b01100000]))
        self.assertEqual(reader.signed(0), 0)
        self.assertEqual(reader.signed(4), -1)
        self.assertEqual(reader.signed(7), 43)
        reader = codec.Bits(bytes([0] * 7 + [0b00000011, 0b11111111]))
        for _ in range(4):
            reader.signed(15)
        self.assertEqual(reader.signed(12), 1023)
        with self.assertRaises(ValueError):
            reader.signed(1)

    def test_decoded_samples_byte_match_independent_upstream_implementation(self):
        report = json.loads((FOLDER / 'reference-comparison.json').read_text())
        self.assertEqual(len(report['comparisons']), 3)
        for source in FOLDER.glob('*.source.json'):
            values = json.loads(source.read_text())['arrayValues']
            samples, details = codec.decompress(values)
            reference = source.with_name(source.name.replace('.source.json', '.reference.f32')).read_bytes()
            self.assertEqual(samples.tobytes(), reference)
            self.assertEqual(samples.shape, (27, 142, 4))
            self.assertEqual(details['trailingSetBits'], 0)
            self.assertLess(details['coefficientBitsRead'], details['dataBits'])
            norms = np.linalg.norm(samples[:, :85].astype(np.float64), axis=2)
            self.assertLess(float(np.max(np.abs(norms - 1))), .001)

    def test_selected_array_bytes_match_original_bank_ranges(self):
        formats = {'UInt8': '<u1', 'UInt16': '<u2', 'Int16': '<i2'}
        with (ROOT / 'exports/characters/ant-common-bank/0.res').open('rb') as bank:
            for source in FOLDER.glob('*.source.json'):
                doc = json.loads(source.read_text())
                for name, desc in doc['animation']['values'].items():
                    if not isinstance(desc, dict) or 'arrayOffset' not in desc:
                        continue
                    bank.seek(desc['arrayOffset'])
                    data = bank.read(desc['byteLength'])
                    self.assertEqual(len(data), desc['byteLength'])
                    self.assertEqual(np.frombuffer(data, formats[desc['elementType']]).tolist(), doc['arrayValues'][name])

    def test_firing_channels_are_additive_and_camera_samples_are_identity(self):
        output = json.loads((FOLDER / 'decoded-clips.json').read_text())
        for clip in output['clips']:
            self.assertTrue(clip['additive'])
            self.assertEqual(clip['controller']['FPS'], 30)
            self.assertEqual(clip['controller']['TimeScale'], .5)
            self.assertEqual(clip['sourceKeyTimes'][0], 0)
            self.assertEqual(clip['sourceKeyTimes'][-1], 30)
            self.assertEqual(len(clip['tracks']), 140)
            self.assertEqual(len(clip['unmapped']), 2)
            for track in clip['tracks']:
                if track['bone'] in ('CameraBase', 'CameraJoint', 'SpineX'):
                    identity = [0, 0, 0, 1 if track['property'] == 'rotation' else 0]
                    values = np.array(track['rawVec4'])
                    if track['property'] == 'rotation':
                        values /= np.linalg.norm(values, axis=1)[:, None]
                    self.assertTrue(all(value == identity for value in values.tolist()))
            root = next(t for t in clip['tracks'] if t['bone'] == 'Wep_Root' and t['property'] == 'translation')
            peak = max(max(abs(v) for v in sample[:3]) for sample in root['rawVec4'])
            self.assertGreater(peak, .01)
            self.assertLess(peak, .05)

    def test_decoder_rejects_truncation_and_unrecovered_formats(self):
        values = json.loads(next(FOLDER.glob('*.source.json')).read_text())['arrayValues']
        broken = copy.deepcopy(values)
        broken['Data'] = broken['Data'][:8]
        with self.assertRaises(ValueError):
            codec.decompress(broken)
        broken = copy.deepcopy(values)
        broken['NumFloatVec'] = 1
        with self.assertRaises(ValueError):
            codec.decompress(broken)
        broken = copy.deepcopy(values)
        broken['DofTableDescBytes'][0] |= 1
        with self.assertRaises(ValueError):
            codec.decompress(broken)


if __name__ == '__main__':
    unittest.main(verbosity=2)
