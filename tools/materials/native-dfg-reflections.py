"""Validate directly referenced native HDR cubemaps and retain layer volumes.

No native volume selection, cube orientation or roughness-to-mip policy is inferred.
"""
import hashlib,json,pathlib,struct
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'exports/lighting'
LEVEL='exports/map-initial/root/ebx/Levels_MP_DeathStar02_01_DeathStar02_01__7a85dea0-9a44-4e0d-8986-b08ae8d31dd8.json'
LAYER='exports/map-initial/root/ebx/Levels_MP_DeathStar02_01_Default_Lighting__e4b584f5-0adf-4966-9e19-34d50dfba087.json'
def load(path):return json.loads((ROOT/path).read_text())
def matrix(transform):
    return [transform[column][axis] for column in ['right','up','forward','trans'] for axis in 'xyz']
level=load(LEVEL)['asset'];layer=load(LAYER)['asset']
root=next(x for x in level['objects'] if x['$id']==level['rootInstanceGuid'])
link=next(x for x in level['objects'] if x['$id']=='internal:18')
assert {'$ref':link['$id']} in root['Objects'] and not link['Excluded']
assert link['Blueprint']['$external']==layer['fileGuid']
assert link['Blueprint']['classGuid']==layer['rootInstanceGuid']
layer_root=next(x for x in layer['objects'] if x['$id']==layer['rootInstanceGuid'])
assert layer_root['Enabled']
volume_ids={reference['$ref'] for reference in layer_root['Objects'] if '$ref' in reference}
volumes=[volume for volume in layer['objects'] if 'ReflectionVolumeEntityData' in volume['$type'] and volume['$id'] in volume_ids]
assert len(volumes)==88
assert all(v['Enabled'] and v['IsVisible'] and v['Mode']['name']=='LocalIBLMode_Baked' for v in volumes)
dds_manifest=load('exports/lighting/dfg-reflection-dds/texture.manifest.json')
assert dds_manifest['complete'] and not dds_manifest['errors']
ebx_by_guid={x['asset']['fileGuid']:x for p in (OUT/'dfg-reflection-raw/ebx').glob('*.json') for x in [json.loads(p.read_text())]}
payloads=[]
for texture in dds_manifest['results']:
    meta=texture['metadata'];volume=next(v for v in volumes if v['BakedTexture']['$external']==texture['guid'])
    ebx=ebx_by_guid[texture['guid']]['asset']
    assert volume['BakedTexture']['classGuid']==ebx['rootInstanceGuid']
    texture_root=next(x for x in ebx['objects'] if x['$id']==ebx['rootInstanceGuid'])
    assert texture_root['Resource']['$resource']==meta['resourceId']
    resource=load(f"exports/lighting/dfg-reflection-raw/raw/res/{meta['resourceId']}.json")
    assert resource['knownReferencedChunks']==[meta['chunkGuid']]
    assert meta['type']=='TT_Cube' and meta['pixelFormat']=='R16G16B16A16_FLOAT'
    assert (meta['width'],meta['height'],meta['depth'],meta['firstMip'])==(128,128,6,0)
    assert meta['mipCount'] in (1,6)
    chunk_path=OUT/f"dfg-reflection-raw/raw/chunk/{meta['chunkGuid']}.chunk";chunk=chunk_path.read_bytes()
    dds_path=OUT/'dfg-reflection-dds'/texture['file'];dds=dds_path.read_bytes()
    assert dds[:4]==b'DDS ' and struct.unpack_from('<I',dds,128)[0]==10
    assert struct.unpack_from('<I',dds,136)[0]==4
    assert len(chunk)==sum(6*(128>>mip)**2*8 for mip in range(meta['mipCount'])) and len(dds)==len(chunk)+148
    source_offset=0;subresources=[];lookup={}
    for mip in range(meta['mipCount']):
        size=128>>mip;length=size*size*8
        for face in range(6):
            payload=chunk[source_offset:source_offset+length];values=np.frombuffer(payload,dtype='<f2').astype(np.float32).reshape(-1,4)
            assert np.isfinite(values).all()
            subresources.append({'mip':mip,'face':face,'width':size,'height':size,'offset':source_offset,'bytes':length,'channelMin':values.min(axis=0).tolist(),'channelMax':values.max(axis=0).tolist(),'channelMean':values.mean(axis=0).tolist()})
            lookup[mip,face]=payload;source_offset+=length
    assert source_offset==len(chunk)
    dds_payload=b''.join(lookup[mip,face] for face in range(6) for mip in range(meta['mipCount']))
    assert dds_payload==dds[148:]
    payloads.append({'volumeId':volume['$id'],'textureFileGuid':texture['guid'],'textureInstanceGuid':ebx['rootInstanceGuid'],'metadata':meta,'sourceChunkPath':str(chunk_path.relative_to(ROOT)).replace('\\','/'),'sourceChunkSha256':hashlib.sha256(chunk).hexdigest(),'ddsPath':str(dds_path.relative_to(ROOT)).replace('\\','/'),'ddsSha256':hashlib.sha256(dds).hexdigest(),'sourceLayout':'mip-major, then six face-index slices, tightly packed row-major RGBA binary16 little-endian','ddsLayout':'face-major, then source mip levels; all payload bytes exactly match source after reorder','subresources':subresources})
assert {v['BakedTexture']['$external'] for v in volumes}=={p['textureFileGuid'] for p in payloads}
actual_bytes=sum((ROOT/p['sourceChunkPath']).stat().st_size for p in payloads)
assert actual_bytes<100*1024**2
budget=load('exports/lighting/dfg-reflection-export-budget.json')
budget.update({'actualPayloadBytes':actual_bytes,'validatedTextureCount':len(payloads),'uniqueChunks':len({p['metadata']['chunkGuid'] for p in payloads})})
(OUT/'dfg-reflection-export-budget.json').write_text(json.dumps(budget,indent=2))
report={'evidenceId':'BF2-NATIVE-REFLECTION-001','sourceLevel':LEVEL,'sourceLayer':LAYER,'levelReference':link,'layerRoot':{'fileGuid':layer['fileGuid'],'instanceGuid':layer['rootInstanceGuid'],'enabled':layer_root['Enabled']},'volumes':volumes,'extractedPayloads':payloads,'extractionScope':'All 88 explicit BakedTexture references from active Default_Lighting volumes; no native nearest-volume selection is claimed.','limitations':['Presence, enabled/baked state and exact texture references are recovered; actual camera-dependent native blend selection is unobserved.','Box/sphere extent convention, face orientation versus browser convention, proxy reprojection, overlap weights and roughness-to-mip mapping are not established here.','Source alpha is preserved without assigning sky-visibility semantics from capture options alone.','Prefiltered native mips are retained; rerunning a browser PMREM filter would be an additional reconstruction choice.','This is a native reflection payload recovery, not recovery of DFG legacy selector122.']}
(OUT/'dfg-reflection-recovery.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'evidenceId':report['evidenceId'],'activeVolumes':len(volumes),'validatedPayloads':len(payloads),'actualPayloadBytes':actual_bytes},indent=2))
