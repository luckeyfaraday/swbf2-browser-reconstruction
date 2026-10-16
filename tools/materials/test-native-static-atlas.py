"""Corruption and full retained-data checks for the bounded atlas decoder."""
import importlib.util
import pathlib
import struct
import unittest

PATH = pathlib.Path(__file__).with_name('native-static-atlas-evidence.py')
SPEC = importlib.util.spec_from_file_location('native_static_atlas', PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NativeStaticAtlasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (MODULE.OUT / 'raw-dynamic/8785653264462149711.res').read_bytes()

    def test_every_pointer_and_full_table_boundary(self):
        rows, checks = MODULE.atlas_table(self.raw)
        self.assertEqual(len(rows), 17703)
        self.assertEqual(rows[0]['key'], 108130)
        self.assertEqual(rows[-1]['key'], 4294808895)
        self.assertEqual(rows[-1]['atlasRecordOffset'] + 32, checks['volumeOffset'])
        self.assertEqual(checks['zeroScaleRecordCount'], 1048)
        # Independent spatial-unit witness: first chart is20×20 source pixels.
        self.assertAlmostEqual(rows[0]['values'][0] * 5232, 20, places=4)
        self.assertAlmostEqual(rows[0]['values'][3] * 4908, 20, places=4)

    def test_reject_noncontiguous_pointer(self):
        raw = bytearray(self.raw)
        struct.pack_into('<Q', raw, 120, 566640)
        with self.assertRaises(AssertionError):
            MODULE.atlas_table(raw)

    def test_reject_duplicate_key(self):
        raw = bytearray(self.raw)
        raw[144:148] = raw[112:116]
        with self.assertRaises(AssertionError):
            MODULE.atlas_table(raw)

    def test_reject_nonfinite_transform(self):
        raw = bytearray(self.raw)
        struct.pack_into('<f', raw, 566608, float('nan'))
        with self.assertRaises(AssertionError):
            MODULE.atlas_table(raw)

    def test_headers_have_exact_block_payload_sizes(self):
        headers = [MODULE.texture_header(path.read_bytes()) for path in
                   (MODULE.OUT / 'static-atlas-headers').glob('*.res')]
        self.assertEqual(len(headers), 5)
        self.assertEqual(sum(h['format'] == 'BC6U_FLOAT' for h in headers), 1)
        self.assertEqual(sum(h['format'] == 'BC7_UNORM' for h in headers), 4)
        self.assertEqual(len({h['chunkGuid'] for h in headers}), 5)
        self.assertEqual(sum(h['payloadBytes'] for h in headers), 128393280)

    def test_reject_header_size_and_payload_mismatch(self):
        path = next((MODULE.OUT / 'static-atlas-headers').glob('*.res'))
        raw = bytearray(path.read_bytes())
        with self.assertRaises(ValueError):
            MODULE.texture_header(raw[:-1])
        struct.pack_into('<I', raw, 108, 1)
        with self.assertRaises(AssertionError):
            MODULE.texture_header(raw)

    def test_named_native_runtime_field_is_uint32_at_48(self):
        field = MODULE.model_lightmap_field()
        self.assertEqual((field['type'], field['fieldName'], field['fieldType'], field['fieldOffset']),
                         ('ModelStaticState', 'LightmapHash', 'Uint32', 48))


if __name__ == '__main__':
    unittest.main()
