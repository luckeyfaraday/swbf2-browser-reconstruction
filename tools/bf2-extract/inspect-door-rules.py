"""Preserve narrow source wiring evidence for the exported Death Star doors."""
import hashlib,json,pathlib

ROOT=pathlib.Path(__file__).resolve().parents[2]
def load(relative):
    file=ROOT/relative;raw=file.read_bytes();doc=json.loads(raw)
    return doc,{'file':relative,'name':doc['entry']['name'],'sha1':doc['entry']['sha1'],'jsonSha256':hashlib.sha256(raw).hexdigest()}
def field_hash(name):
    value=5381
    for char in name:value=((value*33)^ord(char))&0xffffffff
    return value if value<0x80000000 else value-0x100000000

controller,controller_source=load('exports/map-initial/spatial-extra4/ebx/Gameplay_GameModes_Shared_Doors_PF_AutomaticDoor_Controller__a258e9ed-d25b-11e6-a6a2-c567486b3d89.json')
core,core_source=load('exports/map-initial/spatial-extra3/ebx/Gameplay_GameModes_Shared_Doors_PF_AutomaticDoor_Core__06eaae9c-d67e-11e6-b8bc-848e15ca1eca.json')
interpolator=next(o for o in controller['asset']['objects'] if o['$type'].endswith('FloatInterpolatorEntityData'))
duration_connections=[{'index':i,'value':c} for i,c in enumerate(controller['asset']['objects'][0]['PropertyConnections']) if c['Target'].get('$ref')==interpolator['$id'] and c['TargetFieldId']==field_hash('Duration')]
assert len(duration_connections)==1
duration_input=duration_connections[0]['value']['SourceFieldId']
core_connections=[{'index':i,'value':c} for i,c in enumerate(core['asset']['objects'][0]['PropertyConnections']) if c['TargetFieldId']==duration_input and c['SourceFieldId']==duration_input]
assert len(core_connections)==1
rows=[]
for pattern in ['*AutomaticSingleDoor*','*AutomaticDoubleDoor_Large*','*automaticdoubledoor_small*']:
    file=next((ROOT/'exports/map-initial/spatial-extra2/ebx').glob(pattern));doc,source=load(str(file.relative_to(ROOT)))
    nodes={o['$id']:o for o in doc['asset']['objects']};connections=doc['asset']['objects'][0]['PropertyConnections'];duration=[];initial=[]
    for index,c in enumerate(connections):
        if c['TargetFieldId'] not in [duration_input,field_hash('StartOpen')]:continue
        src=nodes[c['Source']['$ref']];definition=next(f for f in src['Fields'] if f['Id']==c['SourceFieldId'])
        row={'connectionIndex':index,'connection':c,'sourceField':definition}
        (duration if c['TargetFieldId']==duration_input else initial).append(row)
    assert duration and all(c['sourceField']['Value']=='Float32 0.75' for c in duration)
    rows.append({'source':source,'durationOverrides':duration,'startOpenBindings':initial})
report={'evidenceId':'BF2-DOOR-RULES-001','runtimeObserved':False,'controllerSource':controller_source,'coreSource':core_source,
    'interpolator':{k:v for k,v in interpolator.items() if not k.startswith('__')},'controllerDurationConnection':duration_connections,'coreDurationConnection':core_connections,'prefabs':rows,
    'fieldHashEvidence':{name:{'algorithm':'EBX DJB2 XOR','signed32':field_hash(name),'hex':hex(field_hash(name)&0xffffffff)} for name in ['Duration','StartOpen','In','Out','IsOpen']},
    'observations':['Installed controller interpolator has default0, native Duration1.5, PropertyInterpolationType_Sine and PropertyInterpolationMode_EaseOut.','All three installed DeathStar door wrappers explicitly wire Float32 0.75 into Duration through Core and Controller interfaces.','StartOpen is wired from wrapper field0x6fdb4685; wrapper field has empty serialized default.'],
    'unknowns':['Map-specific StartOpen, lock/trigger activation, output translation axis and opening-direction parameters require further instance wiring analysis.','Native duration and interpolation enum meanings are source fields; no runtime timing measurement completed.'],
    'inferences':['0.75 is the effective door transition duration when no more specific map override changes the wrapper field.']}
out=ROOT/'exports/map-initial/door-rules-evidence.json';out.write_text(json.dumps(report,indent=2));print(json.dumps({'output':str(out),'evidenceId':report['evidenceId'],'prefabs':len(rows),'wrapperDuration':0.75,'initialState':'unresolved'}))
