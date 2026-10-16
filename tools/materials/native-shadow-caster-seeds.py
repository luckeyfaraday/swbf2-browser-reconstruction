"""Bounded static PE cross references for exact MeshSet/caster type metadata."""
from pathlib import Path
import json, re, struct, hashlib
ROOT=Path(__file__).resolve().parents[2]
p=ROOT/'tools/materials/native-dfg-pe.py'
n={'__file__':str(p)};exec(p.read_text().split('names =')[0],n)
data,base,to_offset=n['data'],n['image_base'],n['to_offset']
targets={a:[] for a in [0x144be1900,0x144be1980,0x144bdf9c0,0x14341c880,0x1434151b0]}
for section in n['sections']:
 if not section['characteristics']&0x20000000:continue
 blob=data[section['offset']:section['offset']+section['size']]
 for m in re.finditer(rb'[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]',blob):
  at=section['offset']+m.start();rva=section['rva']+m.start();target=base+rva+7+struct.unpack_from('<i',data,at+3)[0]
  if target in targets:targets[target].append({'address':hex(base+rva),'function':n['function'](rva),'bytes':data[at:at+7].hex()})
report={'evidenceId':'BF2-NATIVE-SHADOW-CASTER-SEEDS-001','sourceSha256':hashlib.sha256(data).hexdigest(),'ripLeaCandidates':{hex(k):v for k,v in targets.items()},'limitation':'Byte matches require instruction-boundary validation before semantic use.'}
(ROOT/'exports/lighting/native-shadow-casters/native-pe-seeds.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
