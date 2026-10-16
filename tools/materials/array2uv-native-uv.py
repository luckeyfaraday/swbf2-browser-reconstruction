"""Bounded PE name-reference seeds for the unresolved native UV register mapping."""
import pathlib,re,struct,json,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
# Reuse only file-backed PE header/pdata helpers, not the DFG output writer.
exec((ROOT/'tools/materials/native-dfg-pe.py').read_text().split('names = [')[0])
names=[b'Dx11RvmLegacyVertexBufferConversionInstructionFactory',b'RvmSerializedDb_ns_Dx11LegacyVertexBufferConversionInstructionData',b'RvmSerializedDb_ns_PreparedVertexStream']
seeds=[]
for name in names:
 for match in re.finditer(rb'(?<=\x00)'+re.escape(name)+rb'(?=\x00)',data):
  at=match.start();seeds.append({'name':name.decode(),'fileOffset':at,'address':hex(image_base+to_rva(at)),'ripLeaCandidates':[]})
addresses={int(s['address'],16):s for s in seeds}
for section in sections:
 if not section['characteristics']&0x20000000:continue
 part=data[section['offset']:section['offset']+section['size']]
 for m in re.finditer(rb'[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]',part):
  at=section['offset']+m.start();rva=section['rva']+m.start();target=image_base+rva+7+struct.unpack_from('<i',data,at+3)[0]
  if target in addresses:addresses[target]['ripLeaCandidates'].append({'address':hex(image_base+rva),'fileOffset':at,'bytes':data[at:at+7].hex(),'function':function(rva)})
for s in seeds:
 s['pointerFileOffsets']=[m.start()for m in re.finditer(re.escape(struct.pack('<Q',int(s['address'],16))),data)]
report={'evidenceId':'LOCAL-ARRAY2UV-NATIVE-UV-SEEDS-001','target':str(TARGET),'targetSha256':hashlib.sha256(data).hexdigest(),'seeds':seeds,'status':'Candidates only; names and pointer references do not establish source UV association.'}
(ROOT/'exports/materials/array2uv-shader/native-uv-seeds.json').write_text(json.dumps(report,indent=2));print(json.dumps(seeds,indent=2))
