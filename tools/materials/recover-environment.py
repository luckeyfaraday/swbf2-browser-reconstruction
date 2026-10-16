"""Preserve the selected map's source visual environment chain and overrides."""
import hashlib
import json
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[2]


def read(pattern):
    paths=list((ROOT/'exports/map-initial').glob(pattern));assert len(paths)==1
    path=paths[0];raw=path.read_bytes();document=json.loads(raw)
    return document,{'path':str(path.relative_to(ROOT)),'sha256':hashlib.sha256(raw).hexdigest(),'fileGuid':document['entry']['guid']}


level,level_source=read('root/ebx/*DeathStar02_01__7a85dea0-9a44-4e0d-8986-b08ae8d31dd8.json')
interior,interior_source=read('spatial-extra/ebx/*VE_DeathStar_02_Interior_01__5944175c-c90c-11e6-bf1d-a6092bb9b8be.json')
global_doc,global_source=read('spatial-extra/ebx/*VE_Gamewide_01__4a4965f8-52e3-11e4-a6bc-af304338998d.json')
objects={o['$id']:o for o in level['asset']['objects']}
level_data=next(o for o in objects.values() if o['$type']=='FrostySdk.Ebx.LevelData')
reference=objects['internal:27']
assert {'$ref':'internal:27'} in level_data['Objects']
assert reference['Blueprint']['$external']==interior_source['fileGuid'] and not reference['Excluded']
by_id={o['$id']:o for o in interior['asset']['objects']}
blueprint=by_id[interior['asset']['root']];entity=by_id[blueprint['Object']['$ref']]
tonemap=next(o for o in by_id.values() if o['$type']=='FrostySdk.Ebx.TonemapComponentData')
assert {'$ref':tonemap['$id']} in entity['Components'] and entity['Enabled'] and entity['Visibility']==1
global_tonemap=next(o for o in global_doc['asset']['objects'] if o['$type']=='FrostySdk.Ebx.TonemapComponentData')
fields=['TonemapMethod','MinEV','MaxEV','ExposureCompensation','SpotMeterScale','DarkAdaptationTime','LightAdaptationTime']
assert all(k in tonemap['PropertyOverrides'] for k in fields)
assert not any(k in global_tonemap['PropertyOverrides'] for k in fields)
assert tonemap['MinEV']==7 and tonemap['MaxEV']==9
vignette_path=ROOT/'exports/lighting/native-vignette/evidence.json'
vignette=json.loads(vignette_path.read_text(encoding='utf-8'))
assert vignette['evidenceId']=='BF2-NATIVE-VIGNETTE-001'
assert vignette['baseline']['scale']==[2,2] and vignette['baseline']['opacity']==.46
result={
    'evidenceId':'BF2-MAP-EXPOSURE-001',
    'scope':'Statically selected global interior baseline; runtime local environment blends are not captured.',
    'source':{'level':level_source,'interior':interior_source,'gamewide':global_source},
    'selection':{'levelObject':level_data['$id'],'referenceObject':reference['$id'],'referencePriority':reference['Priority'],'referenceExcluded':reference['Excluded'],'blueprint':blueprint['$id'],'entity':entity['$id'],'entityEnabled':entity['Enabled'],'visibility':entity['Visibility'],'blendMode':entity['BlendMode'],'tonemapComponent':tonemap['$id']},
    'tonemap':{'method':tonemap['TonemapMethod']['name'],'minEV':tonemap['MinEV'],'maxEV':tonemap['MaxEV'],'exposureCompensation':tonemap['ExposureCompensation'],'spotMeterScale':tonemap['SpotMeterScale'],'darkAdaptationTime':tonemap['DarkAdaptationTime'],'lightAdaptationTime':tonemap['LightAdaptationTime']},
    'vignette':{**vignette['baseline'],'nativeEvidenceSha256':hashlib.sha256(vignette_path.read_bytes()).hexdigest()},
    'rawTonemapOverrides':{k:tonemap[k] for k in tonemap['PropertyOverrides']},
    'gamewideTonemapOverrides':{k:global_tonemap[k] for k in global_tonemap['PropertyOverrides']},
    'nonOverriddenDefaults':{k:tonemap[k] for k in ['AutomaticExposure','ClampEV','EV','AutoExposureMethod']},
    'nativeExposure':{
        'evidence':'exports/lighting/native-exposure.json',
        'runtime':'web/src/source-exposure.js',
        'meter':'web/src/source-exposure-meter-renderer.js',
        'recovered':'Native EV conversion, directional linear adaptation, fast logarithmic half-float reduction and selected global defaults.',
    },
    'limitations':[
        'AutomaticExposure=true, ClampEV=true, EV=10 and AutoExposureMethod_UseGlobalSetting are serialized defaults, not overrides in this interior environment.',
        'Local Interior_02 and CorvetteTransition_01 references exist in PF_CrashedCorvetteCR90_01; their activation and blending remain untraced.',
        'Browser initial EV midpoint/snap, 200ms readback cadence and limiting the spot-meter crop to the available view remain reconstruction choices.',
        'Native exposure, original indoor SDR grading, RGB10A2 render-plane quantization and the authored global vignette are integrated; local grading/vignette blends and bloom remain under recovery.',
    ],
}
(ROOT/'web/public/assets/source-environment.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
(ROOT/'exports/lighting/environment-recovery.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({'evidenceId':result['evidenceId'],'tonemap':result['tonemap'],'selectedEntity':result['selection']},indent=2))
