"""Native source identity and float-quantization regression witnesses."""
import importlib.util
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('native_hash', Path(__file__).with_name('native-lightmap-hash.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeHashTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scene = json.loads((ROOT / 'web/public/assets/map.scene.json').read_text())
        cls.bindings = {r['key']: r for r in json.loads((ROOT / 'exports/lighting/static-atlas-bindings.json').read_text())['records']}

    def test_exact_source_wall_keys(self):
        # Independent sorted native atlas-table keys, NOT hash-helper output.
        witnesses = [(0, 2660280470, 915184), (1, 3803635906, 1065776), (2, 2288265810, 868112)]
        for index, key, pointer in witnesses:
            source = self.scene['instances'][index]
            self.assertEqual(native.lightmap_hash(source['source']['classGuid'], source['matrix']), key)
            self.assertEqual(self.bindings[key]['atlasRecordOffset'], pointer)

    def test_source_class_guid_is_required(self):
        source = self.scene['instances'][0]
        key = native.lightmap_hash(source['assetId'], source['matrix'])
        self.assertNotEqual(key, 2660280470)
        self.assertNotIn(key, self.bindings)

    def test_absolute_translation_is_required(self):
        source = self.scene['instances'][0]
        matrix = source['matrix'].copy()
        matrix[12:15] = [0, 0, 0]
        self.assertNotEqual(native.lightmap_hash(source['source']['classGuid'], matrix), 2660280470)

    def test_native_negative_quantization_truncates_toward_zero(self):
        source = self.scene['instances'][0]
        payload = native.key_payload(source['source']['classGuid'], source['matrix'])
        self.assertEqual(len(payload), 60)
        self.assertEqual(struct.unpack_from('<3i', payload, 16), (-90751, 58368, -28815))

    def test_native_reflection_sign_and_first_column_normalization(self):
        matrix = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        payload = native.key_payload('00112233-4455-6677-8899-aabbccddeeff', matrix)
        self.assertEqual(payload[:16].hex(), '33221100554477668899aabbccddeeff')
        self.assertEqual(struct.unpack_from('<8i', payload, 28), (0, 0, 0, 10000, 100, 100, 100, -1))

    def test_complete_selected_scene_matches_native_database(self):
        matches = [native.lightmap_hash(s['source']['classGuid'], s['matrix']) in self.bindings for s in self.scene['instances']]
        self.assertEqual(len(matches), 6542)
        self.assertEqual(sum(matches), 5516)
        self.assertEqual(len(matches) - sum(matches), 1026)


if __name__ == '__main__':
    unittest.main()
