"""Publish only the separately validated exact-layout tangent expansion."""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/native-tangent-coverage'
PUBLIC = ROOT / 'web/public/assets'
candidate = (OUT / 'native-tangent-witness.json').read_bytes()
document = json.loads(candidate)
payload = (OUT / 'native-tangent-witness.bin').read_bytes()
assert hashlib.sha256(payload).hexdigest() == document['sha256']
assert len(payload) == document['byteLength']
assert len(document['records']) == 19
document['limitations'] = [text for text in document['limitations'] if not text.startswith('This expanded candidate')]
document['limitations'].append('Runtime activation is restricted to these nineteen exact routed base/native-LOD sections. Other geometries retain derivative frames.')
document['publication'] = dict(candidateDocumentSha256=hashlib.sha256(candidate).hexdigest(),
                               coverageEvidencePath='exports/materials/native-tangent-coverage/evidence.json',
                               coverageEvidenceSha256=hashlib.sha256((OUT / 'evidence.json').read_bytes()).hexdigest(),
                               preparedSections=19, baseSectionInstances=801,
                               sampledWarpVertices=1225,
                               warpScope='Four unchanged original vertex shaders, 1225 sampled original vertices spanning all19sections, 12transforms; raw source/GLB correspondence checks include all26621vertices.')
(PUBLIC / 'native-tangent-witness.bin').write_bytes(payload)
(PUBLIC / 'native-tangent-witness.json').write_text(json.dumps(document, indent=2) + '\n')
print(json.dumps(dict(records=len(document['records']), bytes=len(payload), sha256=document['sha256'])))
