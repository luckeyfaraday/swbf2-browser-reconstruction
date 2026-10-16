"""Validate source mesh category bytes and compare exact oriented triangle multisets.

This does not infer native caster flags from names or from geometry similarity.
"""
from pathlib import Path
import collections, hashlib, json, struct, sys
ROOT=Path(__file__).resolve().parents[2]
folder=ROOT/(sys.argv[1] if len(sys.argv)>1 else 'exports/lighting/native-shadow-caster-geometry')
doc=json.loads((folder/'metadata.json').read_text())
assert doc['evidenceId']=='BF2-NATIVE-SHADOW-CASTER-METADATA-001'
summary=collections.Counter(); rows=[]
def triangles(section):
 g=section['geometry'];positions=(folder/g['positionsFile']).read_bytes();indices=(folder/g['indicesFile']).read_bytes()
 assert hashlib.sha256(positions).hexdigest()==g['positionsSha256']
 assert hashlib.sha256(indices).hexdigest()==g['indicesSha256']
 assert len(positions)==section['vertexCount']*12 and len(indices)==section['indexCount']*4
 values=struct.unpack('<'+'I'*(len(indices)//4),indices);out=collections.Counter()
 for at in range(0,len(values),3):
  vertices=[positions[index*12:index*12+12] for index in values[at:at+3]]
  assert all(len(v)==12 for v in vertices)
  # Cyclic permutations preserve winding; reversed triangles remain distinct.
  out[min(b''.join(vertices[i:]+vertices[:i]) for i in range(3))]+=1
 return out
for record in doc['records']:
 summary['resources']+=1
 ranges=[(r['offset'],bytes.fromhex(r['hex'])) for r in record['sourceByteRanges']]
 def read(offset,count):
  for start,data in ranges:
   if start<=offset and offset+count<=start+len(data):return data[offset-start:offset-start+count]
  raise AssertionError(('range not retained',offset,count))
 assert int(record['decoderFlags']['value'])==struct.unpack('<I',read(112,4))[0]
 assert record['rawHeaderWord']==struct.unpack('<I',read(136,4))[0]
 assert len(record['lods'])==struct.unpack('<H',read(144,2))[0]
 for lod in record['lods']:
  summary['sourceLods']+=1;off=lod['resourceOffset']
  assert off==struct.unpack('<Q',read(32+lod['sourceLod']*8,8))[0]
  assert len(lod['sections'])==struct.unpack('<I',read(off+8,4))[0]
  expected=[0]*len(lod['sections'])
  for category in lod['categories']:
   count,ptr=struct.unpack('<IQ',read(off+20+category['index']*12,12))
   assert count==category['count'] and ptr==category['pointer']
   assert list(read(ptr,count))==category['sections'] if count else not category['sections']
   for i in category['sections']:expected[i]|=1<<category['index']
  for section in lod['sections']:
   summary['sections']+=1
   assert section['categoryMask']==expected[section['sourceSectionIndex']]
   if section['categoryMask']&16:
    summary['shadowSections']+=1
    summary['shadowSectionsOmittedFromVisibleGlb']+=section['browserPrimitiveIndex'] is None
  if lod['sourceLod']!=0:continue
  visible=collections.Counter();shadow=collections.Counter()
  for section in lod['sections']:
   if not section.get('geometry'):continue
   tri=triangles(section)
   if section['categoryMask']&1:visible.update(tri)
   if section['categoryMask']&16:shadow.update(tri)
  if not visible and not shadow:continue
  common=sum((visible&shadow).values());only_visible=sum((visible-shadow).values());only_shadow=sum((shadow-visible).values())
  summary['comparedRigidLod0']+=1;summary['exactTriangleMultisetMatches']+=visible==shadow
  summary['sourceShadowOnlyTriangles']+=only_shadow;summary['sourceVisibleOnlyTriangles']+=only_visible
  rows.append({'assetId':record['assetId'],'meshName':record['meshName'],'sharedOrientedTriangles':common,'visibleOnlyTriangles':only_visible,'shadowOnlyTriangles':only_shadow,'exactMatch':visible==shadow,'sourceShadowSections':lod['categories'][4]['sections']})
report={'evidenceId':'BF2-NATIVE-SHADOW-CASTER-GEOMETRY-VALIDATION-001','metadataSha256':hashlib.sha256((folder/'metadata.json').read_bytes()).hexdigest(),'metadataFile':str((folder/'metadata.json').relative_to(ROOT)).replace('\\','/'),'summary':dict(summary),'comparisons':rows,'limitations':['All comparisons preserve exact source float32 position bits and triangle orientation.','Only rigid source LOD0 geometry is compared; composite and skinned transforms are excluded.','Resource category membership does not by itself establish native runtime quality, LOD selection, caster overrides, culling or alpha-test shaders.','Visible/shadow equivalence is asset-specific; separate native shadow sections must be used when geometry differs.']}
out=folder/'validation.json';out.write_text(json.dumps(report,indent=2));print(json.dumps(report['summary']))
