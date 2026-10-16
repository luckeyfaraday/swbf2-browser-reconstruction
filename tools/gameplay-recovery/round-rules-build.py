"""Derive selected Blast rules from retained installed EBX; never execute the game."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
DIRECTORIES = [
    'tools/gameplay-recovery/core/ebx', 'tools/gameplay-recovery/detail/ebx',
    'tools/gameplay-recovery/map/ebx', 'exports/round-rules-support/ebx',
    'exports/round-rules-more/ebx', 'exports/round-rules-settings/ebx',
    'exports/map-initial/root/ebx', 'exports/map-initial/spatial-extra/ebx',
]


def field_hash(name):
    h = 5381
    for c in name:
        h = ((h * 33) ^ ord(c)) & 0xffffffff
    return f'0x{h:08x}'


def build():
    docs = {}
    for directory in DIRECTORIES:
        for path in (ROOT / directory).glob('*.json'):
            # Only metadata/logic documents are relevant; avoid loading all mesh graphs.
            if not any(s in path.name for s in ['GameMode', 'GameSettingsContainer', 'SpawnManager_Shared_MP', 'TeamDeathmatch', 'default_settings',
                       'CommandSectorNorth', 'DeathStar02_01_DeathStar02_01__']):
                continue
            raw = path.read_bytes()
            j = json.loads(raw)
            if 'entry' not in j or 'asset' not in j:
                continue
            j['_source'] = dict(file=path.relative_to(ROOT).as_posix(), name=j['entry']['name'],
                                guid=j['entry']['guid'], sha1=j['entry']['sha1'],
                                jsonSha256=hashlib.sha256(raw).hexdigest())
            docs.setdefault(j['entry']['name'], j)
    observations, relationships, source_names = [], [], set()

    def doc(name):
        assert name in docs, name
        assert not docs[name]['asset'].get('errors'), name
        source_names.add(name)
        return docs[name]

    def obj(name, index):
        return doc(name)['asset']['objects'][index]

    def observe(name, index, *parts):
        value = obj(name, index)
        for p in parts:
            value = value[p]
        pointer = '/asset/objects/' + str(index) + ''.join('/' + str(p) for p in parts)
        label = 'o' + str(len(observations))
        observations.append(dict(id=label, source=doc(name)['_source'], objectId=obj(name, index)['$id'],
                                 jsonPointer=pointer, value=value, runtimeObserved=False))
        return value

    def internal(name, index, key, target):
        value = observe(name, index, key)
        assert value == {'$ref': obj(name, target)['$id']}
        relationships.append(dict(kind='internal-reference', source=name, object=index,
                                  field=key, targetObject=target))

    def external(name, index, target, target_index=0):
        value = observe(name, index, 'Blueprint')
        assert value['$external'] == doc(target)['entry']['guid']
        assert value['classGuid'] == obj(target, target_index)['$id']
        relationships.append(dict(kind='external-reference', source=name, object=index, target=target))

    def bundle(name, index, target):
        assert observe(name, index, 'BundleName') == target
        assert observe(name, index, 'Excluded') is False
        assert any(b['name'].lower() == ('win32/' + target).lower() for b in doc(target)['entry']['bundles'])
        relationships.append(dict(kind='bundle-name-to-installed-bundle', source=name, object=index, target=target))

    def connection(name, kind, source, sf, target, tf):
        so, to = obj(name, source)['$id'], obj(name, target)['$id']
        edges = obj(name, 0)[kind + 'Connections']
        def key(e, side):
            return e[side + 'Field'] if kind == 'Property' else e[side + 'Event']['Name']
        matches = [i for i, e in enumerate(edges) if e['Source'] == {'$ref': so}
                   and e['Target'] == {'$ref': to} and key(e, 'Source') == sf and key(e, 'Target') == tf]
        assert len(matches) == 1, (name, kind, source, sf, target, tf)
        observe(name, 0, kind + 'Connections', matches[0])
        relationships.append(dict(kind=kind.lower() + '-connection', source=name, index=matches[0]))

    def interface_value(name, index, field):
        fields = obj(name, index)['Fields']
        matches = [i for i, f in enumerate(fields) if f['Name'] == field]
        assert len(matches) == 1
        return observe(name, index, 'Fields', matches[0], 'Value')

    level = 'Levels/MP/DeathStar02_01/DeathStar02_01'
    modes = 'Levels/MP/DeathStar02_01/GameModes'
    tdm = 'Levels/MP/DeathStar02_01/TeamDeathmatch'
    online, online_logic = tdm + '_Online', tdm + '_Online_Logic'
    mp = 'Gameplay/GameModes/TeamDeathmatch/PF_TeamDeathmatch_MP'
    logic = 'Gameplay/GameModes/TeamDeathmatch/PF_TeamDeathmatch_Logic'
    state = 'Gameplay/GameModes/TeamDeathmatch/TeamDeathmatchStateManager'
    spawn = 'Gameplay/GameModes/Shared/SpawnManager_Shared_MP'
    inclusion = 'Gameplay/GameModes/GameModeInclusionSettings'
    ui = 'UI/Data/GameModes/Levels/CommandSectorNorth'
    assert observe(ui, 0, 'LevelId') == level
    observe(ui, 0, 'LevelDescriptionOverrides')
    bundle(level, 3, modes)
    bundle(modes, 6, tdm)
    internal(modes, 6, 'InclusionSettings', 25)
    assert observe(modes, 25, 'Settings') == [{'$ref': 'internal:19'}]
    assert 'Blast' in observe(modes, 19, 'EnabledOptions')
    criterion = observe(modes, 19, 'Criterion')
    assert criterion['$external'] == doc(inclusion)['entry']['guid']
    assert criterion['classGuid'] == obj(inclusion, 1)['$id']
    assert observe(inclusion, 1, 'Name') == 'GameMode'
    bundle(tdm, 1, online)
    internal(tdm, 1, 'InclusionSettings', 18)
    assert observe(tdm, 18, 'Settings') == [{'$ref': 'internal:16'}]
    assert observe(tdm, 16, 'EnabledOptions') == ['Blast']
    skirmish_options = observe(tdm, 15, 'EnabledOptions')
    assert 'Blast' not in skirmish_options
    internal(tdm, 2, 'InclusionSettings', 17)
    external(online, 1, online_logic)
    external(online_logic, 2, mp)
    assert observe(online_logic, 0, 'PropertyConnections') == []
    external(mp, 5, logic)
    external(logic, 1, state)
    external(mp, 9, spawn)

    # Two independent paths agree: supplied MP thresholds and state counter limits.
    assert interface_value(mp, 34, '0xf79143d6') == 'Int32 100'
    for dest, target in [('0x2ca2a67a', 65), ('0xb9897879', 66)]:
        connection(mp, 'Property', 34, '0xf79143d6', 5, dest)
        connection(logic, 'Property', 45, dest, target, field_hash('InValue'))
        connection(logic, 'Property', target, field_hash('Value'), 29 if target == 65 else 30, field_hash('B'))
    limit = observe(state, 21, 'DefaultValue')
    assert limit == 100
    raw_limits = []
    for counter in [1, 2]:
        raw_limits.append(observe(state, counter, 'MaxKillCount'))
        connection(state, 'Property', 21, field_hash('Value'), counter, field_hash('MaxKillCount'))
        assert not any(e['Target'] == {'$ref': obj(state, 21)['$id']}
                       for e in obj(state, 0)['PropertyConnections'])
        for key in ['TeamId', 'CountOOBKills', 'CountSuicide', 'IgnoreAI', 'IgnoreAIVictims', 'EnemyWeight', 'SuicideWeight']:
            observe(state, counter, key)
    # Exact equality gates in the state manager feed the one-shot end/winner splitters.
    for counter, compare, winner in [(1, 4, 16), (2, 6, 19)]:
        connection(state, 'Property', counter, field_hash('Kills'), compare, field_hash('A'))
        connection(state, 'Property', counter, field_hash('KillLimit'), compare, field_hash('B'))
        connection(state, 'Event', compare, field_hash('A=B'), 17, '0x66b8ed9e')
        connection(state, 'Event', compare, field_hash('A=B'), winner, '0x66b8ed9e')
        assert observe(state, compare, 'TriggerOnPropertyChange') is True

    killed_delay = observe(spawn, 33, 'PlayerKilledDelay')
    tactical = {key: observe(spawn, 4, key) for key in ['MaxWaitTime', 'MaxSpawnWaitTime', 'MaxPlayersPerSquad']}
    waits = {key: interface_value(spawn, 36, key) for key in ['0xf79143d7', '0xf79143d0', '0xf79143d1', '0xf79143dc']}
    for target, field, source_field in [(32, 'In0', '0xf79143d7'), (32, 'In1', '0xf79143d0'),
                                       (32, 'In2', '0xf79143d1'), (31, 'In1', '0xf79143dc')]:
        connection(spawn, 'Property', 36, source_field, target, field_hash(field))
    connection(spawn, 'Property', 31, field_hash('Out'), 4, field_hash('MaxWaitTime'))
    observe(spawn, 34, 'Settings')
    observe(spawn, 37, 'Assembly')
    # Retain the complete small selector graph, without claiming total respawn semantics.
    observe(spawn, 0, 'PropertyConnections')
    observe(spawn, 0, 'EventConnections')
    for i in [6, 8]:
        observe(spawn, i, 'SpawnDelay')
        observe(spawn, i, 'AutoSpawn')
    settings = 'default/settings'
    respawn_modifier = observe(settings, 24, 'RespawnTimeModifier')
    friendly_fire = observe(settings, 12, 'EnableFriendlyFire')
    counts = []
    for index in [2, 16]:
        config = obj(settings, index)['Config']
        ci = next(i for i, c in enumerate(config) if c['Name'] == 'Blast')
        counts.append(observe(settings, index, 'Config', ci, 'PlayerCount'))
    assert counts == [16, 16]
    timeout = observe(settings, 38, 'PrivateMatchNoInteractivityTimeoutTime')
    observe(settings, 38, 'NoInteractivityTimeoutTime')
    online_settings = 'Online/GameSettingsContainer'
    assert observe(online_settings, 20, 'SettingName') == 'GameMode_Blast_MinPlayersToStart'
    minimum = int(observe(online_settings, 20, 'DefaultValue'))

    audit_names = [online_logic, mp, logic, state, spawn, settings, online_settings,
                   'Gameplay/GameModes/Shared/PF_GameMode_Controller',
                   'Levels/MP/DeathStar02_01/GameModes_Flow']
    timer_audit = []
    for name in audit_names:
        timer_audit.append(dict(source=doc(name)['_source'], objects=len(doc(name)['asset']['objects']),
                               timerTypes=[o['$type'] for o in doc(name)['asset']['objects']
                                           if any(t in o['$type'] for t in ['TimerEntityData', 'RoundTimer', 'TimeLimit'])]))
    unknowns = [
        'No selected Blast round-duration input or active countdown-to-end wiring was established. Absence in this bounded graph does not prove unlimited time.',
        'The 600 value in WSGameSettings is PrivateMatchNoInteractivityTimeoutTime, not a demonstrated round duration.',
        'PlayerKilledDelay=4 is an event delay, not an established death-to-controllable-spawn duration. Tactical waits are selected and can be bypassed by other spawn modes.',
        'Native HumanPlayer/TacticalSpawnManager scheduling, UI selection time, external server overrides and live BattlepointUnitCost spawn-wave/squad flags have not been observed.',
        'SkirmishBlast/SkirmishOnslaught/SkirmishDuel select a separate PF_TeamDeathmatch_Skirmish path; these online Blast rules must not be applied to Arcade modes.',
    ]
    config = dict(schemaVersion=1, evidenceId='BF2-ROUND-RULES-001', runtimeObserved=False,
                  selection=dict(levelId=level, levelInformation=ui, inclusion='Blast', prefab=mp),
                  runtimeOverrides=dict(scoreLimit=limit),
                  derived=dict(scoreLimit=dict(value=limit, status='installed-selected-static-wiring',
                                               storedUnboundCounterLimits=raw_limits)),
                  unresolved=dict(duration=dict(value=None, reconstructionFallback=600),
                                  respawnSeconds=dict(value=None, reconstructionFallback=3)),
                  observedSpawnComponents=dict(playerKilledDelay=killed_delay, tactical=tactical,
                                               tacticalWaitInterfaceValues=waits, respawnTimeModifier=respawn_modifier),
                  installedDefaults=dict(blastPlayerCount=counts[0], blastMinPlayersToStart=minimum,
                                         friendlyFire=friendly_fire, privateMatchNoInteractivityTimeout=timeout),
                  unknowns=unknowns,
                  provenance=dict(evidence='tools/gameplay-recovery/round-rules-evidence.json',
                                  sources=[docs[n]['_source'] for n in sorted(source_names)]))
    evidence = dict(schemaVersion=1, evidenceId=config['evidenceId'], evidenceClass='installed EBX configuration and reference wiring; no game execution',
                    selection=config['selection'], result=config, observations=observations,
                    relationships=relationships, timerAudit=timer_audit,
                    hashNames={n: field_hash(n) for n in ['Value', 'InValue', 'DefaultValue', 'MaxKillCount',
                               'Kills', 'KillLimit', 'A', 'B', 'A=B', 'A>=B', 'Out', 'MaxWaitTime', 'In0', 'In1', 'In2']})
    return config, evidence


if __name__ == '__main__':
    config, evidence = build()
    (OUT / 'round-rules-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    (ROOT / 'web/public/assets/round-rules.json').write_text(json.dumps(config, indent=2) + '\n')
    print(f"Verified selected Blast score limit {config['runtimeOverrides']['scoreLimit']}; "
          f"{len(evidence['observations'])} source observations, {len(evidence['relationships'])} checked links. "
          'Round duration and total respawn delay remain unresolved.')
