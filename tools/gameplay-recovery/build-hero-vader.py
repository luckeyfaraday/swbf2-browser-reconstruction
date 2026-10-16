"""Build web/public/assets/gameplay/hero-vader.json from decoded installed EBX.

Every scalar marked as observed is read here from an exported EBX JSON file and
recorded with its asset name, file GUID and a JSON pointer into that export
("/asset/objects/<index>/..."). Inferred values carry inferred=true and a
reason. Nothing here reads the game install; run the exporter first (see
tools/gameplay-recovery/vader-evidence.md).

usage (from the repository root):
    python tools/gameplay-recovery/build-hero-vader.py
"""
import hashlib
import json
import os
import struct
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
EXPORT_DIRS = [
    'exports/gameplay-vader/root/ebx',
    'exports/gameplay-vader/batch2/ebx',
    'exports/gameplay-vader/batch3/ebx',
    'exports/gameplay-vader/all-affectors/ebx',
    'exports/gameplay-vader/battlepoint-costs/ebx',
    'tools/gameplay-recovery/state/ebx',  # DefaultSoldierStateMachine (existing export, same install)
]
OUT = os.path.join(ROOT, 'web/public/assets/gameplay/hero-vader.json')

_files = {}
for d in EXPORT_DIRS:
    p = os.path.join(ROOT, d)
    if not os.path.isdir(p):
        continue
    for f in os.listdir(p):
        if f.endswith('.json') and '__' in f:
            g = f[:-5].rsplit('__', 1)[1]
            _files.setdefault(g, os.path.join(p, f))

_docs, _index, _assets = {}, {}, {}


def doc(guid):
    if guid not in _docs:
        path = _files.get(guid)
        if not path:
            raise SystemExit(f'missing export for {guid}; run the exporter (see vader-evidence.md)')
        raw = open(path, 'rb').read()
        d = json.loads(raw)
        _docs[guid] = d
        _index[guid] = {o.get('$id'): i for i, o in enumerate(d['asset']['objects'])}
        e = d['entry']
        _assets[guid] = {'name': e['name'], 'type': e['type'], 'ebxSha1': e.get('sha1'),
                         'file': os.path.relpath(path, ROOT).replace('\\', '/'),
                         'jsonSha256': hashlib.sha256(raw).hexdigest()}
    return _docs[guid]


def obj_index(guid, oid):
    doc(guid)
    if isinstance(oid, int):
        return oid
    if oid not in _index[guid]:
        raise KeyError(f'{oid} not in {guid}')
    return _index[guid][oid]


def read(guid, oid, *path):
    d = doc(guid)
    i = obj_index(guid, oid)
    v = d['asset']['objects'][i]
    for k in path:
        v = v[k]
    ptr = '/asset/objects/' + '/'.join(str(x) for x in (i,) + path)
    return v, {'asset': _assets[guid]['name'], 'guid': guid, 'path': ptr,
               'objectId': d['asset']['objects'][i].get('$id')}


def obs(guid, oid, *path, unit=None, expect=None, note=None, transform=None):
    v, src = read(guid, oid, *path)
    if isinstance(v, dict) and '$enum' in v:
        v = v['name']
    if expect is not None and v != expect:
        raise SystemExit(f'value drift at {src}: {v!r} != {expect!r}')
    out = {'value': transform(v) if transform else v}
    if unit:
        out['unit'] = unit
    if transform:
        out['raw'] = v
    out['source'] = src
    if note:
        out['note'] = note
    return out


def inferred(value, reason, unit=None, basis=None):
    out = {'value': value, 'inferred': True}
    if unit:
        out['unit'] = unit
    out['reason'] = reason
    if basis:
        out['basis'] = basis
    return out


def f32(i):
    return struct.unpack('<f', struct.pack('<I', i & 0xffffffff))[0]


def math_const(guid, oid, instr_index, unit=None, expect=None, note=None):
    v, src = read(guid, oid, 'Assembly', 'Instructions', instr_index, 'Param1')
    val = round(f32(v), 6)
    if expect is not None and abs(val - expect) > 1e-6:
        raise SystemExit(f'math const drift {src}: {val} != {expect}')
    src['path'] += ' (MathEntity ConstF bits, decoded as float32)'
    out = {'value': val}
    if unit:
        out['unit'] = unit
    out['source'] = src
    if note:
        out['note'] = note
    return out


# ---- asset GUIDs (file GUIDs) ---------------------------------------------
G = dict(
    kit='e9ed2832-bb6b-4faf-8e89-1080bdfa2e9c', gp='dd9c2bbb-cb81-47bc-a2e4-4d0a8ebbbeb7',
    health='70c5c353-ac09-41d3-a87d-9699747fc2bb', regen='02b63620-9e39-4fbd-83e7-8e94df558f19',
    sm='c2db59aa-7a78-11e6-8a92-99973984d771', physics='c0707dbf-b91d-4e5d-b95c-05a9091ccd45',
    evade='360b3c63-b8b0-48b6-995a-24f2cf61bce4', jumpAbility='7ddcad84-a058-4fce-9fd8-dad5393e54ee',
    dmgSaber='1adc8e32-cf85-4cb9-b48b-2836f3070095', dmgBehind='02bce374-c101-4672-abd5-8d516728bd81',
    dmgRage='f93435b0-e8f2-4ff8-b37b-abf7266dd75c', pfSaberVader='cdafdd0c-28ba-40a4-b33c-bb17859bb20e',
    pfSaberPhys='e5ed76b8-e3b4-44c4-8909-61835524e543', requests='0002ffda-9910-476b-b630-e279a32fed69',
    deflectAbility='cb00e662-2324-45f2-9b2b-959ef7415cfe', pfDeflect='efb49c48-7858-4a33-9449-519a36a1b6c7',
    bpCost='f850a36c-0f30-4eee-bbba-5868cb4de4bb', fuel='14dd6c72-4c83-4956-b35e-455e62ebfc80',
    shield='5bde62a6-69b6-406b-90b8-987d4a6070ea', deflectBolt='2cea990f-8964-492a-a55c-7a25d20d0e62',
    pfDeflectTransform='0e45976c-adce-11e7-928d-c78a06901166',
    choke='bdb1f337-2a1f-4840-8555-5b1458a3c6f5', pfChoke='c06419e9-b09d-11e6-879e-8bf3fd9b97d5',
    dmgChoke='2ad4e3e3-82ba-4b5c-94c5-261f413a7405', dmgChokeExtra='a770bf3b-d0f8-428c-b1b9-a9703e726b4f',
    chokeArmor='8c3ef4c5-6879-4d99-b968-bdbca16314dc', chokeHold='6fc166e7-3dfc-4a68-a209-d4be91b9469d',
    throw='4d36aa9f-4550-41da-bf8e-852fe776ae43', pfThrow='9353ef49-aa7b-11e6-a364-eeac505745f4',
    throwProj='fb3b13d4-7519-4827-808f-db5862c3f7c3', dmgThrow='a5eb26cd-121a-4a9a-ae14-373b98cc989a',
    dmgThrowExtra='5eea68e1-6c7a-4c50-b505-6ef8466510a1',
    rage='a26f7ea0-f455-4975-af69-0ae64676a781', pfRage='60d591e9-acb8-11e6-bc3b-b15921c8adee',
    rageShield='968fad0b-aa8c-4fd0-9211-c31c867119cf', rageDR='3ee4a5ec-5534-49a1-afc5-41b11a7f81eb',
    cam='650451d0-1b43-47c8-8394-a7a3d3ee99f3', camDefault='64c728ba-c558-4816-abc6-7d6de1cc66df',
    aimer='220ac484-a884-431f-a0cd-4e8f818f8d61', aimCtl='8a011071-e4b4-4db7-9c83-7409f20ddae7',
    inputMap='18a9880d-ffb4-456a-80b2-56b4edbe02e0', inputConcepts='41eba837-6162-48ee-8469-a78669f5db3b',
    card5='c09315c9-5b2f-4988-b95d-1b731e30fd4f', card6='730e7431-5ec3-4e67-b9b2-4aac95df0f81',
    card8='b107b1e5-6054-4fa3-9c4c-ff82fde96c6a', armor1='d71d47a3-a2b0-42fb-b849-156a8b081348',
    armor2='83968de2-e49c-4bc1-b9de-7da0b76f5f96', armor3='65192ff3-af3f-4f65-bcf3-6a128d834061',
    armor4='caba18e6-8901-4073-8b39-af90a686f4d2', killHeal='228707d7-92ee-4d3a-9772-b32a8f54e08a',
)
SM = G['sm']


def sm_obj(name):
    d = doc(SM)
    for i, o in enumerate(d['asset']['objects']):
        if o.get('__Id') == name:
            return i, o
    raise KeyError(name)


def sm_chooser_subject(chooser_name, index):
    i, o = sm_obj(chooser_name)
    ref = o['Subjects'][index]['$ref']
    j = obj_index(SM, ref)
    return {'chooser': chooser_name, 'index': index, 'selected': doc(SM)['asset']['objects'][j].get('__Id'),
            'source': {'asset': _assets[SM]['name'], 'guid': SM, 'path': f'/asset/objects/{i}/Subjects/{index}',
                       'objectId': o.get('$id')}}


def combo_graph():
    """Vader light-attack flow: per node keyframed gameplay channels and transitions (graph ticks)."""
    d = doc(SM)
    objs = d['asset']['objects']
    _, flow = sm_obj('A.Vader.Attack.SeqFLOW (Actor0)')
    name_of = lambda ref: objs[obj_index(SM, ref)].get('__Id')

    def targets(t, acc, cond):
        c = dict(cond)
        ct = t.get('ConditionType', {}).get('name', '')
        if ct.endswith('Int') and t.get('IntChannel'):
            c[name_of(t['IntChannel']['$ref'])] = t.get('IntValue')
        if ct.endswith('Bool') and t.get('BoolChannel1'):
            c[name_of(t['BoolChannel1']['$ref'])] = (not t.get('Invert'))
        if t.get('Target'):
            acc.append((t['Target']['$ref'], c, t.get('StartTick'), t.get('Length')))
        for ch in t.get('ChildConditions') or []:
            targets(ch, acc, c)

    nodes, queue, seen = [], [s['$ref'] for s in flow['Subjects']], set()
    keep_bool = ['ExecuteKill', 'MoveWithInputEnable', 'Unstaggerable', 'CharacterState.Evade.Branch',
                 'CharacterState.Ability.Branch', 'CharacterState.Movement.Branch', 'CharacterState.IntoAir.Branch',
                 'End.3P.Branch']
    keep_int = ['HeroMelee_Attack_StrikeIndex', 'CurrentAbility', 'CharacterState.LightSaberDmg.Given.Dir.EnumGS']
    while queue:
        ref = queue.pop(0)
        if ref in seen:
            continue
        seen.add(ref)
        ni = obj_index(SM, ref)
        node = objs[ni]
        entry = {'node': node.get('__Id'), 'source': {'asset': _assets[SM]['name'], 'guid': SM,
                                                      'path': f'/asset/objects/{ni}', 'objectId': ref},
                 'channels': {}, 'transitions': []}
        for cc in node.get('ChannelControllers') or []:
            kc = objs[obj_index(SM, cc['$ref'])]
            for key, keep in (('BoolChannelController', keep_bool), ('IntChannelController', keep_int)):
                if not kc.get(key):
                    continue
                ci = obj_index(SM, kc[key]['$ref'])
                ctl = objs[ci]
                for k, (ch, tr) in enumerate(zip(ctl.get('Channels', []), ctl.get('Tracks', []))):
                    cname = name_of(ch['$ref'])
                    if cname in keep and tr.get('Keyframes'):
                        kf = tr['Keyframes'][0]
                        entry['channels'][cname] = {
                            'startTick': kf['Time'], 'lengthTicks': kf['Length'], 'value': kf['Value'],
                            'path': f'/asset/objects/{ci}/Tracks/{k}/Keyframes/0'}
        for ti, t in enumerate(node.get('Transitions') or []):
            acc = []
            targets(t, acc, {})
            for tref, cond, st, ln in acc:
                entry['transitions'].append({'to': name_of(tref), 'when': cond, 'startTick': st, 'lengthTicks': ln,
                                             'path': f'/asset/objects/{ni}/Transitions/{ti}'})
                queue.append(tref)
        nodes.append(entry)
    return nodes


def key_bindings():
    d = doc(G['inputConcepts'])
    objs = d['asset']['objects']
    idx = _index[G['inputConcepts']]
    root1 = objs[idx['internal:3']]
    assert root1['PlatformSpecific']['name'] == 'IAMPWin32' and root1['Slot']['name'] == 'InputActionMapSlot_Root1'
    concepts = {-1814468420: 'ConceptAbilityLeft', -554183926: 'ConceptAbilityMiddle', 259493959: 'ConceptAbilityRight',
                1653187997: 'ConceptFire', 1654166258: 'ConceptZoom', 1653623079: 'ConceptJump',
                1520399719: 'ConceptSprint'}
    out = {}
    for a in root1['Actions']:
        ai = idx[a['$ref']]
        o = objs[ai]
        c = o.get('ConceptIdentifier')
        if c in concepts:
            binds = []
            for k, ia in enumerate(o.get('InputActions') or []):
                x = objs[idx[ia['$ref']]]
                t = x['$type'].split('.')[-1]
                if t == 'KeyboardInputActionData':
                    binds.append({'keyboard': x['Key']['name'], 'path': f"/asset/objects/{idx[ia['$ref']]}/Key"})
                elif t == 'MouseInputActionData':
                    binds.append({'mouse': x['Button']['name'], 'path': f"/asset/objects/{idx[ia['$ref']]}/Button"})
            out[concepts[c]] = {'actionsDataPath': f'/asset/objects/{ai}', 'bindings': binds}
    return {'asset': _assets[G['inputConcepts']]['name'], 'guid': G['inputConcepts'],
            'map': {'path': f"/asset/objects/{idx['internal:3']}", 'platform': 'IAMPWin32', 'slot': 'InputActionMapSlot_Root1'},
            'concepts': out}


def modifier_levels(guid, values_ids, field='Value'):
    out = []
    for oid in values_ids:
        v, src = read(guid, oid, field)
        lv, _ = read(guid, oid, 'MinAbilityLevel')
        lv = int(lv['name'].rsplit('_', 1)[1]) if isinstance(lv, dict) else lv
        out.append({'level': lv, 'value': v, 'source': src})
    return sorted(out, key=lambda x: x['level'])


def rank_values(guid, oid, field):
    v, src = read(guid, oid, 'RankData')
    return [{'rank': i, 'value': r[field], 'source': {**src, 'path': src['path'] + f'/{i}/{field}'}} for i, r in enumerate(v)]


def build():
    S = SM
    vader_drive = 'b850a654-de77-4a24-9dbf-fc7cb262e16f'
    o = {}
    o['schemaVersion'] = 1
    o['hero'] = 'darthvader'
    o['evidenceId'] = 'EV-HERO-VADER-20261016-01'
    o['createdAtUtc'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    o['installedProfile'] = 'starwarsbattlefrontii; patched head 1930263 (Frosty 1.0.5.2 historical SDK)'
    o['runtimeObserved'] = False
    o['units'] = {
        'distance': 'm (Frostbite world units, 1 unit = 1 m as used by existing gameplay.json)',
        'time': 's unless unit says graphTicks',
        'graphTicks': 'CharacterState state-machine keyframe ticks; tick rate is NOT recorded in data (see unresolved)',
        'angle': 'deg', 'health': 'hp', 'stamina': 'points on a 0..100 pool',
        'axes': 'source local axes. Offsets on the character-state Position channel are interpreted as local -Z = in front (see lightsaber.hitVolume.sphereCenterLocalZ); entity-space offsets (shield) use +Z forward.'}
    o['loadout'] = 'default (no star cards). starCards section lists modifiers separately.'

    # ---------- selection ----------
    o['selection'] = {
        'kit': {'asset': 'Gameplay/Kits/Hero/DarthVader/Kit_Hero_DarthVader', 'guid': G['kit']},
        'heroCharacterChannelValue': obs(G['kit'], '113fe822-3947-40ce-aabc-6b53395870b0', 'Value', expect=2,
                                         note='Kit writes public channel HeroCharacter=2; every HeroCharacter IndexChooser in DefaultSoldierStateMachine is evaluated at Subjects[2] below.'),
        'isSaberHero': obs(G['kit'], '7ca9fe15-309d-4758-880c-2bec473bd27f', 'Value', expect=True),
        'soldierBlueprint': {'asset': 'Gameplay/Characters/Heroes/Specializations/Hero_Lightsaber_DarthVader',
                             'guid': '1b1dee6b-dc60-4a0d-afad-b41e67fa2960',
                             'note': 'Not decodable with the pinned Frosty 1.0.5.2 runtime (ArgumentNullException in dynamic type builder). Its dependency list (inventory) names DefaultHeroPhysics_Tall and DefaultSoldierStateMachine, used below.'},
    }

    # ---------- health ----------
    o['health'] = {
        'max': obs(G['health'], '959d3e17-4b2d-457c-929d-aafbae01c938', 'MaxHealth', unit='hp', expect=800),
        'appliedOnSpawn': obs(G['gp'], 'c5f33b8f-f938-4d6d-84f1-ac6c4f651647', 'AffectorsAppliedOnSpawn',
                              transform=lambda v: [x['name'] for x in v]),
        'regen': {
            'delay': obs(G['regen'], '649a49ea-faa0-4838-b07f-8e78980d7a06', 'RankData', 0, 'RegenerationDelay', unit='s', expect=5),
            'rate': obs(G['regen'], '649a49ea-faa0-4838-b07f-8e78980d7a06', 'RankData', 0, 'RegenerationRate', unit='hp/s', expect=50),
            'maxRegenerationAmount': obs(G['regen'], '649a49ea-faa0-4838-b07f-8e78980d7a06', 'RankData', 0, 'MaxRegenerationAmount', unit='hp', expect=250,
                                         note='Assault trooper authors 0 here (unlimited). Native meaning (cap per regen episode vs absolute ceiling) unresolved.'),
            'browserDefault': {'capMode': 'perEpisode', 'note': 'Suggestion only: after 5 s without damage, heal 50 hp/s until 250 hp have been restored or max is reached.'},
        },
        'damageReceivedModifiers': {
            'whileForceChoking': {
                'damageMultiplier': obs(G['chokeArmor'], '0a62f66b-c822-4676-8556-b7d73b9fed8a', 'RankData', 0, 'DamageMultiplier', expect=0.2),
                'appliedTo': inferred('self (Vader)', 'PF_ForceChoke_DarthVader applies Affector_DarthVader_ForceChoke_ArmorReduction with Giver and TargetList both = interface Player on the ability start event; Affector_DarthVader_ForceChoke_RemoveArmor (removes descriptor 2057682960 = ArmorReduction) fires on the ability end event.',
                                      basis=[read(G['pfChoke'], 'internal:6', 'Duration')[1], read(G['pfChoke'], 'internal:10', 'Affector')[1]]),
            },
            'focusedRageShield': 'see focusedRage.damageShield',
            'dodge': inferred('saber/affector damage blocked while dodging', 'Affector_Damage_Lightsaber_Vader BlockingChannels require CurrentAbility==17 AND IsUnstaggerable==true on the victim; CurrentAbility=17 is the evade state. Server hit query also excludes targets with Affector_Evading.',
                              basis=[read(G['dmgSaber'], 'c83e5ef6-8bba-40dd-aaaf-8ec0a8d39cab', 'BlockingChannels')[1], read(G['pfSaberPhys'], 'internal:25', 'DescriptorIds')[1]]),
        },
    }

    # ---------- movement ----------
    o['movement'] = {
        'controllerSelection': [sm_chooser_subject('CharacterState.OnGroundMoveWithInput.EC', 2),
                                sm_chooser_subject('CharacterState.JumpSelector.EC', 2),
                                sm_chooser_subject('CharacterState.JumpHighSelector.EC', 2),
                                sm_chooser_subject('CharacterState.FallSelector.EC', 2),
                                sm_chooser_subject('CharacterState.Dodge.EC', 2),
                                {'chooser': 'CharacterState.StandOrCrouch.EC', 'index': 2, 'selected': None,
                                 'note': 'Subjects[2] is null: no pose controller writes MaxSpeed for Vader; DriveWithInput.Vader also has no SpeedInput, so its own Velocity is the top speed.'}],
        'runSpeed': obs(S, vader_drive, 'Velocity', unit='m/s', expect=4.25),
        'sprintMultiplier': obs(S, vader_drive, 'TopSpeedModifications', 0, 'ConstantMultiplier', expect=1.7,
                                note='Enabled by private channel Sprint.'),
        'sprintSpeed': inferred(round(4.25 * 1.7, 4), 'Velocity x TopSpeedModifications[0].ConstantMultiplier while Sprint; native combination order not decompiled.', unit='m/s'),
        'directionScaling': {
            'forward': obs(S, vader_drive, 'InputScaling', 'ForwardConstant'),
            'backward': obs(S, vader_drive, 'InputScaling', 'BackwardConstant'),
            'left': obs(S, vader_drive, 'InputScaling', 'LeftConstant'),
            'right': obs(S, vader_drive, 'InputScaling', 'RightConstant'),
            'strafeScaleWhileSprinting': obs(S, vader_drive, 'StrafeInputScaleModifications', 0, 'ConstantMultiplier'),
        },
        'acceleration': {
            'gain': obs(S, vader_drive, 'Gain'), 'stopGain': obs(S, vader_drive, 'StopGain'),
            'sprintGain': obs(S, vader_drive, 'SprintGain'),
            'note': 'Dimensionless controller gains (trooper Assault: 0.3/0.4/0.25). Native discretisation unknown; do not treat as m/s^2.'},
        'whileBlocking': {
            'speed': obs(S, 'a66d435c-6b3b-4cf5-8ce6-7fd33257f09a', 'Velocity', unit='m/s', expect=2.4),
            'gain': obs(S, 'a66d435c-6b3b-4cf5-8ce6-7fd33257f09a', 'Gain'),
            'sprintTopSpeedMultiplier': obs(S, 'a66d435c-6b3b-4cf5-8ce6-7fd33257f09a', 'SprintTopSpeedMultiplier', note='0 = no sprint while blocking'),
            'routing': [obs(G['deflectAbility'], '3249faf4-d090-54ac-29d1-55ed561b6479', 'Value', expect=2,
                            note='Deflect ability SetChannelsWhenActive AlternativeMovmentEnum=2'),
                        sm_chooser_subject('AlternativeMovementNoAffector.EC', 2)],
        },
        'whileForceChoking': {
            'speed': obs(S, '1329fc62-9aee-49be-b607-5eefea205467', 'Velocity', unit='m/s', expect=2.5),
            'routing': sm_chooser_subject('L.Vader.ForceChoke.Loop.Layer', 1),
            'note': 'Choke ability sets AttackType=13; CharacterState.Attack.EC[13] -> Physics_WarpAttackHitForceChokeVader -> HeroMelee.Vader.Choke.SF whose loop layer contains this DriveWithInput.Trooper.Slowed controller (no sprint).'},
        'whileAttacking': inferred('animation-driven (root motion + attack align)', 'Every Vader strike node enables MoveWithInputEnable only for ticks 0..8 and opens CharacterState.Movement.Branch at ticks ~36-57 (see lightsaber.comboGraph). AttackAlignSpeed float tag drives alignment toward the AttackAlignTransform chosen by the target-acquisition query.'),
        'jump': {
            'targetVerticalVelocity': obs(S, '97ff66fe-c641-4b1d-bfcd-a16a6b34a70c', 'TargetVelocity', 'y', unit='m/s', expect=7),
            'velocityBlendWeight': obs(S, '97ff66fe-c641-4b1d-bfcd-a16a6b34a70c', 'Weights', 'y', expect=0.3,
                                       note='Trooper JumpPhysics uses TargetVelocity.y=5 with weight 1. Per-tick blend semantics unresolved.'),
            'highJumpTargetVerticalVelocity': obs(S, '15ff4ed0-a4bd-4f9b-88b0-3135043242a0', 'TargetVelocity', 'y', unit='m/s', expect=9),
            'highJumpBlendWeight': obs(S, '15ff4ed0-a4bd-4f9b-88b0-3135043242a0', 'Weights', 'y'),
            'jumpAbilityActivationTime': obs(G['jumpAbility'], '90bf65ff-80fe-444a-9e1a-1c6b80fd78dd', 'ActivationTime', unit='s',
                                             note='Hero jump is a CharacterState ability (Category Extra1) that sets HeroJump=true.'),
            'fallGravity': obs(S, '74291a3a-67ec-4c3a-94cc-dcf0f6fe2d78', 'Gravity', unit='m/s^2', expect=-20),
            'fallDrag': obs(S, '74291a3a-67ec-4c3a-94cc-dcf0f6fe2d78', 'Drag', note='FallSelector[2] is Network_Physics_Fall_LowGrav (drag 3 vs 0.1 for trooper Network_Physics_Fall).'),
        },
        'dodge': {
            'rechargeTime': obs(G['evade'], '4d542ece-8368-4c70-af76-5efbaa062b54', 'RechargeTime', unit='s'),
            'retriggerCount': obs(G['evade'], '4d542ece-8368-4c70-af76-5efbaa062b54', 'RetriggerCount'),
            'triggerCost': obs(G['evade'], '4d542ece-8368-4c70-af76-5efbaa062b54', 'TriggerCost'),
            'activeTime': obs(G['evade'], '4d542ece-8368-4c70-af76-5efbaa062b54', 'ActiveTime', unit='s', note='CharacterStateDrivesActiveTime=true; animation decides real length.'),
            'projectedDistance': obs(S, 'ed35d234-1ad3-430f-bfb6-e24bcfa5405a', 'ProjectedDistance', unit='m'),
        },
        'collision': {
            'radius': obs(G['physics'], 'fbad8ef9-1167-dd38-3c9e-942ce42252fc', 'PhysicalRadius', unit='m'),
            'standHeight': obs(G['physics'], '14ec2a9c-6036-4bef-126d-0fa20bd7022f', 'Height', unit='m', expect=1.95),
            'eyePosition': obs(G['physics'], '14ec2a9c-6036-4bef-126d-0fa20bd7022f', 'EyePosition', transform=lambda v: [v['x'], v['y'], v['z']], unit='m'),
            'stepHeight': obs(G['physics'], '14ec2a9c-6036-4bef-126d-0fa20bd7022f', 'StepHeight', unit='m'),
            'maxAscendAngle': obs(G['physics'], 'fbad8ef9-1167-dd38-3c9e-942ce42252fc', 'MaxAscendAngle', unit='deg'),
            'mass': obs(G['physics'], 'fbad8ef9-1167-dd38-3c9e-942ce42252fc', 'Mass', unit='kg'),
        },
        'physicsDataPoseSpeed': {
            'velocity': obs(G['physics'], 'f18fc10e-81bd-6bcf-3cf9-4d218780d672', 'Velocity', unit='m/s'),
            'sprintMultiplier': obs(G['physics'], 'f18fc10e-81bd-6bcf-3cf9-4d218780d672', 'SprintMultiplier'),
            'note': 'DefaultHeroPhysics_Tall OnGround pose info. The game-defined state machine drive above is the selected controller; this value is retained for comparison only.'},
    }

    # ---------- lightsaber ----------
    nodes = combo_graph()
    strike_nodes = [n for n in nodes if 'ExecuteKill' in n['channels']]
    o['lightsaber'] = {
        'damagePerHit': obs(G['dmgSaber'], 'c83e5ef6-8bba-40dd-aaaf-8ec0a8d39cab', 'RankData', 0, 'InitialDamage', unit='hp', expect=130,
                            note='Same affector for every strike and closer (no per-stage damage in data).'),
        'damageDelayAfterHit': obs(G['dmgSaber'], 'c83e5ef6-8bba-40dd-aaaf-8ec0a8d39cab', 'RankData', 0, 'DelayInitialDamageTime', unit='s'),
        'fromBehindBonus': obs(G['dmgBehind'], '377a87c2-06c2-4f06-acf3-3efbbd7a6a72', 'RankData', 0, 'InitialDamage', unit='hp', expect=30),
        'fromBehindTotal': inferred(160, 'Separate FromBehind affector applied by PF_Lightsaber_DarthVader to the 0x873216e6 (behind) target set in addition to the normal hit set; additive total assumed.', unit='hp'),
        'focusedRageBonus': obs(G['dmgRage'], '99e14fc1-d6c4-4c4d-887c-b709bd058ff1', 'RankData', 0, 'InitialDamage', unit='hp', expect=15,
                                note='Applied only while Vader has Affector_Vader_FocusedRage (AffectorReceive id 1439459426 -> CompareBool -> apply).'),
        'rageGate': obs(G['pfSaberVader'], 'internal:25', 'AffectorListenToId', expect=1439459426),
        'heroesVsTroopers': inferred('same damage', 'No hero/trooper split in the saber damage affectors. MaterialPair (packed 39856000) with IgnoreMaterial=false may still scale damage by material grid, which is not decoded.'),
        'tickRate': {'value': None, 'unit': 'graphTicks/s', 'unresolved': True,
                     'browserDefault': 30, 'reason': 'ANT animation controllers record FPS=30 and graph Length matches TrimmedDuration/TimeScale for the rifle roll (roll-notes.md); graph tick rate itself is not in data.'},
        'comboGraph': {
            'flow': {'asset': _assets[SM]['name'], 'guid': SM, 'path': f"/asset/objects/{sm_obj('A.Vader.Attack.SeqFLOW (Actor0)')[0]}",
                     'routing': sm_chooser_subject('A.HeroMelee.LightAttack.EC', 2)},
            'attackTypeMeaning': {
                '2': 'regular strike (AttackType=2)', '1': 'closer/lunge strike (AttackType=1)',
                'requests': [obs(G['requests'], '733a5832-2160-4fcc-90ab-30297494214f', 'VariationValue', expect=2),
                             obs(G['requests'], '93a89cfe-eac3-4a16-a4f7-05e98fb7b235', 'VariationValue', expect=1)],
                'selection': 'On Fire: if a target is acquired and its distance > lungeThreshold -> AttackType 1, else AttackType 2; with no target, sprinting -> AttackType 1, else 2 (PF_Lightsaber_Gameplay_Physical CompareBool i53/i55/i56).'},
            'lungeThreshold': math_const(G['pfSaberPhys'], 'internal:79', 3, unit='m', expect=4.0, note='distancev3(target, self) > 4'),
            'nodes': nodes,
            'summary': inferred({
                'damageWindowTicks': sorted({(n['channels']['ExecuteKill']['startTick'], n['channels']['ExecuteKill']['lengthTicks']) for n in strike_nodes}),
                'nodeEndTick': sorted({n['channels'].get('End.3P.Branch', {}).get('startTick') for n in strike_nodes}),
                'strikeCount': len([n for n in strike_nodes if 'Strike' in n['node']]),
                'closerCount': len([n for n in strike_nodes if 'Closer' in n['node']]),
            }, 'Aggregated from nodes[]: strikes hit during ticks 15..25, closers during 25..35; next input accepted from ~tick 29-55 until tick 100; the chain loops (no fixed combo length).'),
        },
        'hitVolume': {
            'serverSphereRadius': obs(G['pfSaberPhys'], 'internal:13', 'Radius', unit='m', expect=3),
            'sphereCenterUp': obs(G['pfSaberPhys'], 'internal:15', 'In1', 'trans', 'y', unit='m', expect=1),
            'sphereCenterLocalZ': obs(G['pfSaberPhys'], 'internal:17', 'In1', 'trans', 'z', unit='m', expect=-1.5,
                                      note='Local -Z; the 180-degree-yawed probe at +5 z (below) faces back through the character, so -Z is in front: centre is 1.5 m ahead, 1 m up.'),
            'hitConeHalfAngleFromCentre': obs(G['pfSaberPhys'], 'internal:5', 'InputData', 'FilterOutAngle', unit='deg', expect=35),
            'hitConeMinDistance': obs(G['pfSaberPhys'], 'internal:5', 'InputData', 'FilterOutDistance', unit='m',
                                      note='FilterOutDistanceType=LessThan; native meaning (angle test skipped vs target rejected inside 1 m) unresolved.'),
            'rearProbeOffsetZ': obs(G['pfSaberPhys'], 'internal:16', 'In1', 'trans', 'z', unit='m', expect=5),
            'rearProbeConeHalfAngle': obs(G['pfSaberPhys'], 'internal:7', 'InputData', 'FilterOutAngle', unit='deg', expect=45),
            'activeWhile': 'server channel Melee_ExecuteKill (private ExecuteKill) is true; RemoteState filter prevents re-hitting the same target in one window',
            'browserDefault': {'reach': 4.5, 'halfAngle': 35, 'note': 'Suggestion: hit enemies whose torso is within 4.5 m and 35 deg of facing during the damage window.'},
        },
        'targetAcquisition': {
            'radius': obs(G['pfSaberPhys'], 'internal:60', 'ValueIfTrue', unit='m', expect=8),
            'radiusWhenRestricted': obs(G['pfSaberPhys'], 'internal:60', 'ValueIfFalse', unit='m', expect=2,
                                        note='PF_Lightsaber_DarthVader drives the condition false when OutOfStamina or under certain affectors.'),
            'coneHalfAngle': obs(G['pfSaberPhys'], 'internal:3', 'InputData', 'FilterOutAngle', unit='deg', expect=60),
            'minDistance': obs(G['pfSaberPhys'], 'internal:3', 'InputData', 'FilterOutDistance', unit='m'),
            'finalConeHalfAngle': obs(G['pfSaberPhys'], 'internal:11', 'InputData', 'FilterOutAngle', unit='deg', expect=40),
            'maxTargets': obs(G['pfSaberPhys'], 'internal:11', 'InputData', 'MaxResults', expect=1),
        },
        'staminaPerSwing': inferred('60 stamina/s while ExecuteKill (10 ticks) -> 20 per swing at 30 ticks/s', 'LIGHTSABER_COSTS_MELEE_VADER=60 feeds the stamina drain rate selected while Melee_ExecuteKill is true (PF_DeflectAbility_Gameplay_Vader i411 -> i180 -> i349).', unit='stamina'),
    }

    # ---------- block / deflect ----------
    bp = lambda e, unit=None: obs(G['bpCost'], 'eb7b8ca3-b2d9-4ab4-9d8b-7266371ffd4d', 'UnitCostConfig', 28, 'BattlepointUnitCostEntries', e, 'Cost', unit=unit)
    for e, name in ((9, 'LIGHTSABER_COSTS_MELEE_VADER'), (19, 'LIGHTSABER_COSTS_BLASTER_DEFLECT_VADER'),
                    (29, 'LIGHTSABER_COSTS_MELEE_DEFLECT_VADER'), (39, 'LIGHTSABER_COSTS_REGEN_SPEED_VADER'),
                    (49, 'LIGHTSABER_COSTS_REGEN_DELAY_VADER'), (59, 'LIGHTSABER_COSTS_SPREAD_VADER')):
        got, _ = read(G['bpCost'], 'eb7b8ca3-b2d9-4ab4-9d8b-7266371ffd4d', 'UnitCostConfig', 28, 'BattlepointUnitCostEntries', e, 'Character')
        assert got == name, (got, name)
    o['block'] = {
        'ability': {
            'category': obs(G['deflectAbility'], 'd34730a5-09cb-d72e-a612-79b73abd0c22', 'Category'),
            'infiniteActiveTime': obs(G['deflectAbility'], 'd34730a5-09cb-d72e-a612-79b73abd0c22', 'InfiniteActiveTime'),
            'requireHold': obs(G['deflectAbility'], 'd34730a5-09cb-d72e-a612-79b73abd0c22', 'RequireHoldDuringActivationTime'),
        },
        'stamina': {
            'max': obs(G['pfDeflect'], 'internal:265', 'DefaultValue', unit='stamina', expect=100),
            'costTable': {'asset': 'Online/BattlepointCostData', 'guid': G['bpCost'], 'note': 'UnitCostConfig[28] (GameMode GLOBAL, Map GLOBAL); costs are drain RATES (stamina/s) applied while the matching condition holds (PF_FuelResource_Stamina StopWatch multiplier).'},
            'meleeSwingRate': bp(9, unit='stamina/s'),
            'blasterDeflectRate': bp(19, unit='stamina/s'),
            'meleeBlockRate': bp(29, unit='stamina/s'),
            'regenRate': bp(39, unit='stamina/s'),
            'regenDelayCentiseconds': bp(49, unit='cs'),
            'regenDelay': inferred(2.25, 'REGEN_DELAY 225 / 100 (Math i355). A second gate uses RegenDelay + 0.25 s (Math i334).', unit='s'),
            'blasterDeflectPulse': obs(G['pfDeflect'], 'internal:207', 'Delay', unit='s', expect=0.25, note='Each shield intercept sets the deflect bool for 0.25 s'),
            'perEventCostEstimate': inferred({'blasterBolt': 2.0, 'blockedSaberHit': 7.5, 'ownSwing': 20.0},
                                             'rate x active time: 8/s x 0.25 s; 15/s x BlockedLightSaber duration 0.5 s; 60/s x 10 ticks at 30 ticks/s. StopWatch output is rounded; exact native accounting unresolved.', unit='stamina'),
            'focusedRageCostMultiplier': math_const(G['pfDeflect'], 'internal:349', 4, expect=0.5, note='Math select(rage, cost*0.5, cost); condition fed by AffectorReceive Affector_Vader_FocusedRage'),
            'holdingBlockPausesRegen': inferred(True, 'Throttle (drain) is asserted while the deflect ability is active and not OutOfStamina; regen requires Throttle=false and the RegenDelay gates.'),
            'outOfStaminaBelow': inferred(1, 'Math i327 (Fuel > 1) drives the OutOfStamina requests.', unit='stamina'),
        },
        'shield': {
            'radius': obs(G['pfDeflect'], '989cf58b-c176-4dc8-ec99-a46bb6a85975', 'ShieldRadius', unit='m', expect=1.2),
            'forwardOffset': obs(G['pfDeflect'], '989cf58b-c176-4dc8-ec99-a46bb6a85975', 'OffsetTransform', 'trans', 'z', unit='m', expect=0.45),
            'arcAngle': obs(G['shield'], 'internal:6', 'ArcAngle', unit='deg', expect=90, note='ShieldComponentData; whether this is full or half arc is unresolved.'),
            'ignores': {k: obs(G['shield'], 'internal:6', k) for k in ('IgnoreExplosions', 'IgnoreGrenades', 'IgnoreMissiles', 'IgnoreBullets')},
        },
        'meleeBlock': {
            'facingRule': obs(G['pfSaberPhys'], 'internal:10', 'InputData', 'MaxTargetAngleFromForwardDirection', unit='deg', expect=70,
                              note='Blocking targets (Affector_IsDeflecting) whose facing is within 70 deg of the attacker facing (i.e. attacked from behind) are still hit; otherwise they receive BlockedLightSaber and no damage.'),
            'blocksAllFrontalSaberDamage': inferred(True, 'Blocked targets go to DeflectTarget -> BlockedLightSaber (CharacterState stagger) with no damage affector.'),
            'forceChokeImmunityWhileBlocking': inferred(True, 'Choke damage targets are filtered by AffectorQueryFilter(Affector_IsDeflecting, Affector_IsDeflecting_Yoda) and only the "without" output receives damage.',
                                                        basis=[read(G['pfChoke'], 'internal:36', 'DescriptorIds')[1]]),
        },
        'deflectedBolt': {
            'direction': inferred('Vader aim (camera) direction with random spread, not back at the shooter',
                                  'PF_DeflectTransform: rotationAndTranslation(AimTransform, impact position) multiplied by a random rotation built from cross(impact vector * 10, (rand(-spread,spread),0,rand(-spread,spread))).',
                                  basis=[read(G['pfDeflectTransform'], 'internal:9', 'Max')[1]]),
            'spread': inferred(0.2, 'LIGHTSABER_COSTS_SPREAD_VADER 20 / 100 (Math i335) -> PF_DeflectTransform Spread', basis=[bp(59)['source']]),
            'speed': obs(G['pfDeflect'], 'internal:17', 'FireProjectileDataList', 0, 'Speed', unit='m/s', expect=150),
            'startDamage': obs(G['deflectBolt'], '4a420334-43be-4493-9b6e-5cda436e4679', 'StartDamage', unit='hp', expect=36),
            'endDamage': obs(G['deflectBolt'], '4a420334-43be-4493-9b6e-5cda436e4679', 'EndDamage', unit='hp', expect=30),
            'falloffStart': obs(G['deflectBolt'], '4a420334-43be-4493-9b6e-5cda436e4679', 'DamageFalloffStartDistance', unit='m'),
            'falloffEnd': obs(G['deflectBolt'], '4a420334-43be-4493-9b6e-5cda436e4679', 'DamageFalloffEndDistance', unit='m'),
            'timeToLive': obs(G['deflectBolt'], '4a420334-43be-4493-9b6e-5cda436e4679', 'TimeToLive', unit='s'),
        },
    }

    # ---------- force choke ----------
    C = 'a621dcd9-ef14-4e7d-bf88-94e4ed517ec5'
    o['forceChoke'] = {
        'slot': obs(G['choke'], C, 'Category', expect='PlayerAbilityCategory_Right'),
        'cooldown': obs(G['choke'], C, 'RechargeTime', unit='s', expect=25),
        'activationTime': obs(G['choke'], C, 'ActivationTime', unit='s'),
        'holdDuration': obs(G['choke'], '20ab975a-5cc6-41e7-8ab7-d8725dafab98', 'Value', unit='s', expect=1.5,
                            note='PlayerAbilityPropertyOutput ActiveTime -> AffectorApply.Duration of the choke damage affector'),
        'abilityActiveTime': obs(G['choke'], C, 'ActiveTime', unit='s'),
        'retriggerCount': obs(G['choke'], C, 'RetriggerCount', note='Retrigger event closes the gates, removes ChokeHold and plays the ForceChoke_Push sound (early release/push).'),
        'range': obs(G['choke'], 'be55ebfb-ad80-4d5a-85c9-0fd6a3b6d7ac', 'Value', unit='m', expect=12, note='BaseRadius -> SphereQuery.Radius'),
        'coneAngle': obs(G['choke'], '8359aa8b-5252-4f1e-9063-870884061d57', 'Value', unit='deg', expect=35,
                         note='BaseAngle -> DynamicQueryFilter angle and PF_AOE_PieSlice.Angle; half vs full angle unresolved.'),
        'targets': inferred('all enemies in the cone with line of sight', 'Union of two LOS-filtered DynamicQueryFilters with MaxResults=-1; no single-target selection on the damage path.'),
        'damage': {
            'perSecond': obs(G['dmgChoke'], '8fdce5f4-f54a-4ff7-883a-901f5d2572a5', 'RankData', 0, 'DamageToDealPerSecond', unit='hp/s', expect=86),
            'initial': obs(G['dmgChoke'], '8fdce5f4-f54a-4ff7-883a-901f5d2572a5', 'RankData', 0, 'InitialDamage', unit='hp'),
            'interval': obs(G['dmgChoke'], '8fdce5f4-f54a-4ff7-883a-901f5d2572a5', 'RankData', 0, 'DamageInterval', unit='s'),
            'total': inferred(130, '1 + 86 hp/s x 1.5 s (three 0.5 s ticks of 43). AdjustDamageIntervalToDamageThreshold=true may change tick spacing natively.', unit='hp'),
        },
        'applicationTiming': inferred('when the animation writes TriggerAffectorEnum == 5', 'SphereQuery TriggerOnce fires from CompareBool(TriggerAffectorEnum == 5) while the ability is active; ActivationTime 0.5 s approximates it.'),
        'effectOnTarget': inferred('lifted/held, cannot act, camera looks at Vader', 'Pf_Affector_ForceChokeHold_Vader applies Affector_Vader_ForceChoked (CharacterState request) and PlayerLookAt; lift height is animation data (not decoded).'),
        'excludes': inferred(['blocking lightsaber heroes (IsDeflecting) take no choke damage', 'targets with Affector_ForceImmunity are not held'], 'AffectorQueryFilter descriptors on the damage and hold paths.'),
        'vaderDuringChoke': {
            'moveSpeed': 'see movement.whileForceChoking (2.5 m/s, no sprint)',
            'damageTakenMultiplier': 'see health.damageReceivedModifiers.whileForceChoking (0.2)',
            'forceImmunity': inferred(True, 'Affector_ForceImmunity applied to self on ability start, removed on end.'),
            'blocksOtherAbilities': obs(G['choke'], C, 'BlockedPlayerAbilityIds', note='Saber Throw and Focused Rage identifiers'),
        },
    }

    # ---------- saber throw ----------
    T = '4e996221-7bc6-4325-ab44-f6b345075921'
    P = 'ed281b02-172f-4481-8e46-f23adc3b27df'
    o['saberThrow'] = {
        'slot': obs(G['throw'], T, 'Category', expect='PlayerAbilityCategory_Left'),
        'cooldown': obs(G['throw'], T, 'RechargeTime', unit='s', expect=8),
        'activationTime': obs(G['throw'], T, 'ActivationTime', unit='s'),
        'activeTime': obs(G['throw'], T, 'ActiveTime', unit='s'),
        'outboundDistance': obs(G['throw'], 'efc59beb-ec65-4c42-9770-eebdab73df5b', 'Value', unit='m', expect=20,
                                note='Ability output 0x3a2a0fa7 -> projectile Math BaseDistance; CompareFloat(distance from launch > 20) triggers return.'),
        'returnCatchDistance': math_const(G['throwProj'], 'internal:54', 1, unit='m', expect=3.5),
        'projectile': {
            'maxSpeed': obs(G['throwProj'], P, 'MaxSpeed', unit='m/s', expect=35),
            'initialSpeed': obs(G['throwProj'], P, 'InitialSpeed', unit='m/s', note='Fire speed parameter in PF_SaberThrow_DarthVader is 1; effective launch speed vs MaxSpeed cap unresolved.'),
            'engineStrength': obs(G['throwProj'], P, 'EngineStrength'),
            'homing': obs(G['throwProj'], 'internal:51', 'LockingWeaponData', 'IsHoming'),
            'gravity': obs(G['throwProj'], P, 'Gravity'),
            'hitSphereRadius': obs(G['throwProj'], 'internal:22', 'Radius', unit='m', expect=0.5),
            'detonatesOnCollision': obs(G['throwProj'], P, 'ShouldDetonateOnCollision'),
        },
        'damage': obs(G['dmgThrow'], 'cc7b95fb-1e62-4800-9131-54dfb22a8e2f', 'RankData', 0, 'InitialDamage', unit='hp', expect=150),
        'pierce': inferred(True, 'Continuous 0.5 m sphere query along the flight, no detonation on collision; every non-blocking target in the path is hit.'),
        'hitsOnReturn': inferred(True, 'The per-throw hit cache (QueryCache i30) is reset on the return event, so a target can be hit outbound and again on the way back; the ThrowDamage star card adds damage only to targets already marked Affector_Vader_FirstHitSaberThrow.'),
        'blocked': inferred('blocking heroes receive BlockedLightSaber instead of damage', 'AffectorQueryFilter(IsDeflecting, Evading) splits targets; deflecting set -> BlockedLightSaber apply.'),
    }

    # ---------- focused rage ----------
    R = 'da2f90ad-eab4-4ff0-8fd3-27893973b811'
    o['focusedRage'] = {
        'slot': obs(G['rage'], R, 'Category', expect='PlayerAbilityCategory_Middle'),
        'duration': obs(G['rage'], R, 'ActiveTime', unit='s', expect=10),
        'cooldown': obs(G['rage'], R, 'RechargeTime', unit='s', expect=15),
        'activationTime': obs(G['rage'], R, 'ActivationTime', unit='s'),
        'saberDamageBonus': 'see lightsaber.focusedRageBonus (+15 hp per hit)',
        'staminaCostMultiplier': 'see block.stamina.focusedRageCostMultiplier (0.5)',
        'damageShield': {
            'value': obs(G['rageShield'], 'c62c6116-fde3-4a2a-a5fe-34e3f4e338cb', 'RankData', 0, 'FullValue', unit='hp', expect=200,
                         note='Affector_Phasma_SelfHealss (DamageShieldAffectorAsset) applied passively on activation at Rank 0.'),
            'depletionStartsAfter': obs(G['rageShield'], 'c62c6116-fde3-4a2a-a5fe-34e3f4e338cb', 'RankData', 0, 'DelayUntilDepletionStart', unit='s'),
            'depleteStep': obs(G['rageShield'], 'c62c6116-fde3-4a2a-a5fe-34e3f4e338cb', 'RankData', 0, 'DepleteStepValue', unit='hp'),
            'depleteStepDelay': obs(G['rageShield'], 'c62c6116-fde3-4a2a-a5fe-34e3f4e338cb', 'RankData', 0, 'DepleteStepDelay', unit='s'),
            'applyRank': obs(G['pfRage'], 'internal:6', 'Rank', expect=0),
        },
        'damageReduction': inferred('none by default', 'Affector_Vader_FocusedRage_DamgeReduction is applied only when the FuryResilience star card is active (CompareBool on its PlayerAbilityState); see starCards.'),
        'powerUpAnimationTicks': obs(S, '87c55f3d-d67a-6ce1-6243-cb3b00a2d569', 'Length', unit='graphTicks',
                                     note='AttackType=34 -> CharacterState.Attack.EC[34] Network_Physics_Vader_Rage warp clip; Vader is animation-driven during the power-up.'),
        'movementChange': inferred('none recorded', 'No speed modifier is applied by PF_FocusedRage_DarthVader; only the power-up warp clip.'),
    }

    # ---------- camera ----------
    o['camera'] = {
        'thirdPerson': {
            'asset': 'Gameplay/Kits/Hero/Hero_Lightsaber_Vader_Camera_3P',
            'antGameStateDistance': obs(G['cam'], 'internal:6', 'DefaultValue', unit='m', expect=2.25,
                                        note='WriteFloatGameState hash 0x0c7f73d5 (trooper 1.75, generic hero 2.25). Interpolates (0.5 s) to the second interface value on an external event.'),
            'antGameStateDistanceAlt': obs(G['cam'], 'internal:7', 'Fields', 1, 'Value', transform=lambda v: float(v.split()[1]), unit='m'),
            'antGameState_0x4b69dbd6': obs(G['cam'], 'internal:3', 'DefaultValue', unit='m', note='Trooper 0.1, generic hero -0.1; axis unresolved'),
            'antGameState_0x9ba1eb3c': obs(G['cam'], 'internal:4', 'DefaultValue', unit='m', note='0.45 for trooper/hero/Vader; axis unresolved (likely lateral shoulder offset)'),
            'antGameState_0x928ed1c7': obs(G['cam'], 'internal:2', 'DefaultValue', note='Trooper -0.3, hero -0.6; meaning unresolved'),
            'aimFollowOffset': obs(G['aimer'], 'internal:1', 'FollowOffset', transform=lambda v: [v['x'], v['y'], v['z']], unit='m'),
            'browserDefault': {'distance': 2.25, 'shoulder': 0.45, 'height': 0.17, 'note': 'Suggestion mapping the unresolved ANT game-state slots onto camera.distance/shoulder/height.'},
        },
        'fov': obs(G['aimCtl'], '5bdcbd2d-62ee-40b1-8ebd-ce0d404d5e48', 'FieldOfView', unit='deg', expect=55),
        'zoomFov': obs(G['aimCtl'], '75f24627-ecd8-4eaf-95ae-5312b2fd0537', 'FieldOfView', unit='deg', expect=55),
        'zoomMoveSpeedMultiplier': obs(G['aimCtl'], '75f24627-ecd8-4eaf-95ae-5312b2fd0537', 'MoveSpeedMultiplier'),
        'fovTransitionTime': obs(G['aimCtl'], '70b81893-1fb3-4637-bc60-351bfe250dcf', 'FovTransitionTime', unit='s'),
        'pitchMax': obs(G['aimCtl'], '70b81893-1fb3-4637-bc60-351bfe250dcf', 'StandPose', 'MaximumPitch', unit='deg'),
        'pitchMin': obs(G['aimCtl'], '70b81893-1fb3-4637-bc60-351bfe250dcf', 'StandPose', 'MinimumPitch', unit='deg'),
    }

    # ---------- ability slots ----------
    o['abilitySlots'] = {
        'conceptMapping': {
            'ConceptAbilityLeft': obs(G['inputMap'], '115d78b4-d4ce-46e5-84dc-73f5c092b882', 'Mappings', 13, 'ActionIdentifier', expect=871087120, note='EIASelectWeapon2'),
            'ConceptAbilityMiddle': obs(G['inputMap'], '115d78b4-d4ce-46e5-84dc-73f5c092b882', 'Mappings', 14, 'ActionIdentifier', expect=871087121, note='EIASelectWeapon3'),
            'ConceptAbilityRight': obs(G['inputMap'], '115d78b4-d4ce-46e5-84dc-73f5c092b882', 'Mappings', 15, 'ActionIdentifier', expect=871087126, note='EIASelectWeapon4'),
        },
        'pcDefaultKeys': key_bindings(),
        'ability1': {'category': 'Left', 'ability': 'Saber Throw', 'pcKey': 'Q'},
        'ability2': {'category': 'Middle', 'ability': 'Focused Rage', 'pcKey': 'E'},
        'ability3': {'category': 'Right', 'ability': 'Force Choke', 'pcKey': 'F'},
        'block': inferred({'category': 'Extra2', 'pcInput': 'mouse Button_1 (ConceptZoom)'}, 'Deflect ability category Extra2 requires public IsBlocking, which is written outside the decoded assets (soldier blueprint not decodable). Hero aiming controller zoom level 1 halves move speed. Binding to Zoom/right mouse is an inference.'),
        'ordering': inferred('ability 1/2/3 = Left/Middle/Right', 'Concept order EIASelectWeapon2/3/4 and PC keys Q/E/F.'),
    }

    # ---------- star cards (separate, not applied above) ----------
    o['starCards'] = {
        'note': 'Not part of the default loadout. Level n uses modifier value with MinAbilityLevel=n.',
        'ChokeGrip_durationMultiplierAdd': modifier_levels(G['card8'], ['1daa5605-daa7-4fd7-a6c3-3c927366e106', 'a1fc5354-8ce9-42e6-83d3-a1421205881a', '2f3ea4fe-0648-4a80-b32d-25882e112fcd', '872ae05d-3f40-41c5-8af3-bed9e799a8ec']),
        'ChokeGrip_formula': 'duration = ActiveTime + ActiveTime * Multiplier (PF_ForceChoke Math i88)',
        'ChokeDamage_extraDps': rank_values(G['dmgChokeExtra'], 'a7bcd700-d495-4a33-ba93-a02875badae8', 'DamageToDealPerSecond'),
        'ThrowDamage_secondHitExtra': rank_values(G['dmgThrowExtra'], 'c218b1e9-af55-4c90-bce5-dcc655bc3cd6', 'InitialDamage'),
        'SaberThrowSniping_distanceMultiplier': modifier_levels(G['card6'], ['52dcdfe1-a2f2-4c6d-a7ea-0b9379ad2f16', 'ccba04f8-fd5c-4ae0-b056-a855c3fb468c', '84925dbc-df27-4939-b838-5df996949fdd', 'c259fedd-4ee0-4b49-a86d-999346c21d36']),
        'DeflectStamina_blasterCostMultiplier': modifier_levels(G['card5'], ['f8271f06-31ff-4392-bd8e-ddbc7c4208db', 'effbb83c-d7d4-4875-a3d4-d16d63a72a20', '14f1cdb5-322f-4602-9a6f-f0e2ae9ad1c1', '4170d9a1-c029-4833-afd4-87a7e13285f5']),
        'FuryResilience_rageDamageMultiplier': rank_values(G['rageDR'], '57a8f3fb-2fb4-4936-89c4-dee49840d4d0', 'DamageMultiplier'),
        'BonusHealth_maxHealth': [obs(G[k], oid, 'MaxHealth', unit='hp') for k, oid in (
            ('armor1', 'afd391ad-b656-4839-a48a-e9902dec6680'), ('armor2', '1df3d257-a4aa-41a3-822a-ec9ff9fc6155'),
            ('armor3', '7bf57d8d-0415-46c4-91a1-bef06d549b5e'), ('armor4', '39de3e0e-0b7f-4a37-a3d0-adc4b4e9fd47'))],
        'KillsHeal_heal': rank_values(G['killHeal'], '05b35c49-4900-46d7-895b-ffdeed73d94f', 'InitialHeal'),
    }

    o['unresolved'] = [
        'CharacterState graph tick rate (combo/attack timings are in graph ticks; browserDefault 30/s).',
        'Hero soldier blueprint Gameplay/Characters/Heroes/Specializations/Hero_Lightsaber_DarthVader cannot be decoded by the pinned Frosty runtime; any component-level overrides (health component, block input wiring, camera hookup, soldier-level speed scaling) are unknown.',
        'Native semantics of QueryFilter fields (FilterOutAngle half/full angle, FilterOutDistance with LessThan, MaxTargetAngleFromForwardDirection) - lightsaber reach/arc and block facing rule are interpretations.',
        'Whether the from-behind 30 hp affector stacks with the normal 130 hp hit (assumed additive -> 160).',
        'MaxRegenerationAmount (250) semantics for hero regen.',
        'Exact stamina accounting: costs are drain rates gated by pulse durations; StopWatch output is rounded; per-event costs are estimates.',
        'Material-grid damage scaling (MaterialPair packed 39856000, IgnoreMaterial=false) for heroes vs troopers vs vehicles.',
        'Third-person camera ANT game-state names (hashes 0x0c7f73d5, 0x4b69dbd6, 0x9ba1eb3c, 0x928ed1c7) and the external event that switches distance 2.25 -> 3.25.',
        'Block input binding (Extra2 / IsBlocking writer) - inferred right mouse / ConceptZoom.',
        'Choke lift height and victim pose (animation data), choke cone half/full angle, choke retrigger push strength.',
        'Saber-throw effective launch speed (InitialSpeed 350 vs MaxSpeed 35 vs fire Speed 1) and homing return path.',
        'Jump ConstantVelocity weight semantics (Vader target 7 m/s at weight 0.3 vs trooper 5 m/s at weight 1) and Fall_LowGrav drag 3.',
        'Combo strike direction enum (LightSaberDmg.Given.Dir) and hit-reaction mapping.',
    ]
    o['assets'] = _assets
    return o


if __name__ == '__main__':
    out = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print('wrote', os.path.relpath(OUT, ROOT), 'assets:', len(out['assets']), 'comboNodes:', len(out['lightsaber']['comboGraph']['nodes']))
