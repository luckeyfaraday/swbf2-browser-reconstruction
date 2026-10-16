"""Retain exact native local-reflection and cubemap-filter shader permutations."""
import hashlib
import importlib.util
import json
import pathlib
import re
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('gbuffer', ROOT/'tools/materials/native-dfg-gbuffer.py')
gbuffer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gbuffer)
data = gbuffer.SOURCE.read_bytes()
assert hashlib.sha256(data).hexdigest() == '110d7169cb6f70559f8ecea0819e26b1df4fb66e0649f95bdeea033ef44ef898'
out = ROOT/'exports/lighting/dfg-reflection-shaders'
out.mkdir(exist_ok=True)
names = {
    'local-type4': 'Dx11/DeferredTiledLightingCS_splitLight=0,gbLayout=0,lightType=4,reference=0,materialPassType=0,volumetricShadowMaps=0,dynamicAO=0,translucency=0,cbv=1',
    'local-type5': 'Dx11/DeferredTiledLightingCS_splitLight=0,gbLayout=0,lightType=5,reference=0,materialPassType=0,volumetricShadowMaps=0,dynamicAO=0,translucency=0,cbv=1',
    'convolve-specular': 'Dx11/PBRConvolveSpecularCubeMapCompute_precomputedSample=0',
    'convolve-specular-precomputed': 'Dx11/PBRConvolveSpecularCubeMapCompute_precomputedSample=1',
}
records = []
for short, name in names.items():
    matches = list(re.finditer(re.escape(name.encode()) + b'\0', data))
    assert len(matches) == 1
    at = matches[0].end()
    length = struct.unpack_from('<I', data, at)[0]
    bytecode = data[at+4:at+4+length]
    assert bytecode[:4] == b'DXBC' and struct.unpack_from('<I', bytecode, 24)[0] == length
    (out/(short+'.dxbc')).write_bytes(bytecode)
    (out/(short+'.asm')).write_text(gbuffer.assembly(bytecode))
    records.append({'file': short, 'sourceName': name, 'nameOffset': matches[0].start(),
                    'bytecodeOffset': at+4, 'bytecodeBytes': length,
                    'sha256': hashlib.sha256(bytecode).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'evidenceId': 'BF2-NATIVE-REFLECTION-SAMPLING-001',
    'sourceSha256': hashlib.sha256(data).hexdigest(), 'stages': records,
    'limitations': ['Named shipped permutations, not a native frame capture or selected runtime light-type association.']}, indent=2))
print(json.dumps(records, indent=2))
