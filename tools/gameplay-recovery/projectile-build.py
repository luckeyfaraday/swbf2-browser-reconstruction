"""Selected E11/A280 projectile configuration, verified against native consumers."""
from pathlib import Path
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if not k.startswith('__') and k != '$type'}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def build():
    native_path = HERE / 'projectile-native-evidence.json'
    native_raw = native_path.read_bytes()
    native = json.loads(native_raw)
    assert native['evidenceId'] == 'BF2-PROJECTILE-NATIVE-001'
    sources, observations, links = {}, [], []

    def load(pattern):
        paths = list(ROOT.glob(pattern))
        assert len(paths) == 1, (pattern, paths)
        raw = paths[0].read_bytes()
        doc = json.loads(raw)
        assert not doc['asset'].get('errors')
        source = dict(file=paths[0].relative_to(ROOT).as_posix(), name=doc['entry']['name'],
                      guid=doc['entry']['guid'], sha1=doc['entry']['sha1'],
                      jsonSha256=hashlib.sha256(raw).hexdigest())
        sources[source['guid']] = source
        doc['_source'] = source
        return doc

    def object_type(doc, name):
        rows = [o for o in doc['asset']['objects'] if o['$type'] == 'FrostySdk.Ebx.'+name]
        assert len(rows) == 1, (name, len(rows))
        return rows[0]

    def observe(doc, obj, field):
        index = doc['asset']['objects'].index(obj)
        observations.append(dict(sourceGuid=doc['_source']['guid'], objectId=obj['$id'],
            jsonPointer=f'/asset/objects/{index}/{field}', value=obj[field], runtimeObserved=False))
        return obj[field]

    def connect(doc, obj, field, target_doc, target):
        value = observe(doc, obj, field)
        if doc is target_doc:
            assert value == {'$ref': target['$id']}
        else:
            assert value['$external'] == target_doc['_source']['guid']
            assert value['classGuid'] == target['$id']
        links.append(dict(fromSource=doc['_source']['guid'], fromObject=obj['$id'], field=field,
                          toSource=target_doc['_source']['guid'], toObject=target['$id']))

    projectile_doc = load('tools/gameplay-recovery/detail/ebx/*BlasterProjectile_Default_Rifle__*.json')
    projectile = object_type(projectile_doc, 'WSBulletEntityData')
    weapons = []
    for weapon_id, name, weapon_pattern, unlock_pattern, firing_pattern in [
        ('primary','E-11', 'tools/gameplay-recovery/e11-root/ebx/*W_BlasterRifle_E11__*.json',
         'tools/gameplay-recovery/state/ebx/*U_BlasterRifle_E11__*.json',
         'tools/gameplay-recovery/core/ebx/*WeaponFiring_Default_BlasterRifle__*.json'),
        ('rebel-a280','A280', 'exports/faction-rebel-weapon/ebx/*W_BlasterRifle_A280__*.json',
         'exports/faction-rebel-weapon/ebx/*U_BlasterRifle_A280__*.json',
         'exports/faction-rebel-detail/ebx/*WeaponFiring_Default_BlasterRifle_A280__*.json'),
    ]:
        weapon_doc, unlock_doc, firing_doc = map(load, [weapon_pattern, unlock_pattern, firing_pattern])
        blueprint = object_type(weapon_doc, 'SoldierWeaponBlueprint')
        weapon = object_type(weapon_doc, 'SoldierWeaponData')
        custom = object_type(weapon_doc, 'BlasterWeaponData')
        firing = object_type(firing_doc, 'WeaponFiringData')
        primary = object_type(firing_doc, 'FiringFunctionData')
        unlock = next(o for o in unlock_doc['asset']['objects'] if 'NonStreamedBlueprint' in o)
        connect(unlock_doc, unlock, 'NonStreamedBlueprint', weapon_doc, blueprint)
        connect(weapon_doc, blueprint, 'Object', weapon_doc, weapon)
        connect(weapon_doc, weapon, 'CustomWeaponType', weapon_doc, custom)
        connect(weapon_doc, weapon, 'WeaponFiring', firing_doc, firing)
        connect(firing_doc, firing, 'PrimaryFire', firing_doc, primary)
        shot = observe(firing_doc, primary, 'Shot')
        assert shot['ProjectileData']['$external'] == projectile_doc['_source']['guid']
        assert shot['ProjectileData']['classGuid'] == projectile['$id']
        links.append(dict(fromSource=firing_doc['_source']['guid'], fromObject=primary['$id'],
                          field='Shot/ProjectileData', toSource=projectile_doc['_source']['guid'], toObject=projectile['$id']))
        apply_power = observe(weapon_doc, custom, 'ApplyPowerToSpeed')
        modifiers = observe(weapon_doc, weapon, 'WeaponModifierData')
        default_modifiers = []
        for group in modifiers:
            for ref in group['Modifiers']:
                mod = next(o for o in weapon_doc['asset']['objects'] if o['$id'] == ref['$ref'])
                observe(weapon_doc, mod, '$type')
                assert not mod['$type'].endswith('.WeaponShotModifier')
                if group['UnlockAssetGuid'] == '00000000-0000-0000-0000-000000000000':
                    default_modifiers.append(mod['$type'])
        assert default_modifiers == ['FrostySdk.Ebx.WeaponFiringEffectsModifier']
        vector = [shot['InitialSpeed'][axis] for axis in ['x','y','z']]
        assert vector == [0, 0, 700]
        assert shot['InitialSpeedScaleByPitch'] == [] and shot['InitialDirectionScaleByPitch'] == []
        assert shot['InheritWeaponSpeedAmount'] == 0 and apply_power is False
        assert shot['Projectile'] is None and shot['SecondaryProjectileData'] is None
        projectile_values = {key: observe(projectile_doc, projectile, key) for key in [
            'InitialSpeed','TimeToLive','Gravity','InstantHit','FirstFrameTravelDistance',
            'DetonateOnTimeout','DetonationTimeVariation','ServerProjectileDisabled']}
        assert projectile_values == dict(InitialSpeed=350, TimeToLive=3, Gravity=0,
            InstantHit=False, FirstFrameTravelDistance=0, DetonateOnTimeout=False,
            DetonationTimeVariation=0, ServerProjectileDisabled=False)
        speed = math.sqrt(sum(v*v for v in vector))
        weapons.append(dict(weaponId=weapon_id, name=name, source=weapon_doc['_source'],
            unlockSource=unlock_doc['_source'], firingSource=firing_doc['_source'],
            projectileSource=projectile_doc['_source'], sourceShot=clean(shot),
            applyPowerToSpeed=apply_power, baselineModifierTypes=default_modifiers,
            sourceProjectile=projectile_values,
            parameters=dict(projectileSpeed=speed, projectileLifetime=projectile_values['TimeToLive'],
                            range=speed*projectile_values['TimeToLive']),
            derivation=dict(projectileSpeed='Magnitude of supplied Shot.InitialSpeed after native precedence; rotation preserves its magnitude, power disabled and inheritance zero.',
                projectileLifetime='WSBulletEntityData.TimeToLive read by native segment update.',
                range='Derived unobstructed lifetime travel bound speed*TTL; not a source range field.')))
    provenance = dict(evidenceId='BF2-PROJECTILE-LAUNCH-001', nativeEvidenceId=native['evidenceId'],
        nativeEvidenceFile=native_path.relative_to(ROOT).as_posix(),
        nativeEvidenceSha256=hashlib.sha256(native_raw).hexdigest(), runtimeObserved=False,
        sourceDerived=['weapon.projectileSpeed','weapon.projectileLifetime'],
        derived=['weapon.range'], scope='Selected base E11 and A280 primary shots without conditional unlock or external live modifiers.',
        sources=list(sources.values()),
        limitations=native['limits'],
        reconstructed=['Browser ray orientation, projectile visual origin and timing schedule; these are not established by velocity precedence.'])
    config = dict(schemaVersion=1, weapons=weapons, provenance=provenance)
    evidence = dict(evidenceId=provenance['evidenceId'], runtimeObserved=False,
                    observations=observations, links=links, provenance=provenance)
    (HERE/'projectile-evidence.json').write_text(json.dumps(evidence, indent=2)+'\n')
    output = ROOT/'web/public/assets/projectile-launch.json'
    output.write_text(json.dumps(config, indent=2)+'\n')
    print(json.dumps(dict(output=output.relative_to(ROOT).as_posix(), observations=len(observations),
                         links=len(links), weapons=[dict(id=w['weaponId'], **w['parameters']) for w in weapons])))


if __name__ == '__main__':
    build()
