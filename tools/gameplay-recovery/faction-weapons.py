"""Resolve Death Star Assault faction modifiers and bind the recovered Rebel assets."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "tools/gameplay-recovery"


def load(pattern):
    files = list(ROOT.glob(pattern))
    assert len(files) == 1, (pattern, len(files))
    file = files[0]
    document = json.loads(file.read_text(encoding="utf-8-sig"))
    assert not document["asset"]["errors"]
    return file, document


documents = {
    "rebelKit": load("exports/faction-rebel-kit/ebx/*.json"),
    "imperialKit": load("tools/gameplay-recovery/detail/ebx/*Kit_D_Assault_Orig_DS__*.json"),
    "gameplay": load("tools/gameplay-recovery/detail/ebx/*GP_Assault__*.json"),
    "modifier": load("exports/faction-default-modifiers/ebx/*.json"),
    "ability": load("exports/faction-default-ability/ebx/*.json"),
    "rebelUnlock": load("exports/faction-rebel-weapon/ebx/*U_BlasterRifle_A280__*.json"),
    "rebelWeapon": load("exports/faction-rebel-weapon/ebx/*W_BlasterRifle_A280__*.json"),
    "rebelFiring": load("exports/faction-rebel-detail/ebx/*WeaponFiring_Default_BlasterRifle_A280__*.json"),
    "imperialUnlock": load("tools/gameplay-recovery/state/ebx/*U_BlasterRifle_E11__*.json"),
    "imperialWeapon": load("tools/gameplay-recovery/e11-root/ebx/*W_BlasterRifle_E11__*.json"),
    "imperialFiring": load("tools/gameplay-recovery/core/ebx/*WeaponFiring_Default_BlasterRifle__*.json"),
    "projectile": load("tools/gameplay-recovery/detail/ebx/*BlasterProjectile_Default_Rifle__*.json"),
    "heat": load("tools/gameplay-recovery/core/ebx/*OverheatConfig_Default_Rifle__*.json"),
    "mesh": load("exports/faction-a280-geometry/faction-a280.ebx.json"),
}


def objects(name):
    return documents[name][1]["asset"]["objects"]


def index_of_type(name, suffix):
    matches = [i for i, o in enumerate(objects(name)) if o["$type"].endswith("." + suffix)]
    assert len(matches) == 1, (name, suffix)
    return matches[0]


observations = []


def field(name, index, suffix):
    path, doc = documents[name]
    pointer = f"/asset/objects/{index}/{suffix}"
    value = doc
    for part in pointer.split("/")[1:]:
        value = value[int(part)] if isinstance(value, list) else value[part]
    observations.append({"file": path.relative_to(ROOT).as_posix(), "jsonPointer": pointer, "value": value})
    return value


def external(name, index, suffix, target, target_id=None):
    value = field(name, index, suffix)
    target_doc = documents[target][1]
    assert value["$external"] == target_doc["entry"]["guid"]
    assert value["classGuid"] == (target_id or target_doc["asset"]["root"])
    return value


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if k not in ["__Id", "__InstanceGuid", "$id", "Sound"]}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


external("rebelKit", 0, "Gameplay", "gameplay")
external("imperialKit", 0, "Gameplay", "gameplay")
external("rebelKit", 0, "PlayerAbilityModifiers/0", "modifier")
assert field("imperialKit", 0, "PlayerAbilityModifiers") == []
assert field("gameplay", 0, "Abilities")["$ref"] == objects("gameplay")[1]["$id"]
external("gameplay", 1, "DefaultAbilities/0", "ability")
assert field("modifier", 0, "PlayerAbilityIdentifier") == field("ability", 0, "Identifier") == 2676124552
external("ability", 0, "Unlock", "imperialUnlock")
external("modifier", 0, "UnlockToCreate", "rebelUnlock")
external("rebelUnlock", 0, "NonStreamedBlueprint", "rebelWeapon")
external("imperialUnlock", 0, "NonStreamedBlueprint", "imperialWeapon")
rw = index_of_type("rebelWeapon", "SoldierWeaponData")
rf = index_of_type("rebelFiring", "WeaponFiringData")
rff = index_of_type("rebelFiring", "FiringFunctionData")
iff = index_of_type("imperialFiring", "FiringFunctionData")
projectile_index = index_of_type("projectile", "WSBulletEntityData")
heat_index = index_of_type("heat", "OverheatConfig")
external("rebelWeapon", rw, "WeaponFiring", "rebelFiring", objects("rebelFiring")[rf]["$id"])
assert field("rebelFiring", rf, "PrimaryFire")["$ref"] == objects("rebelFiring")[rff]["$id"]
external("rebelFiring", rff, "Shot/ProjectileData", "projectile", objects("projectile")[projectile_index]["$id"])
external("rebelWeapon", index_of_type("rebelWeapon", "OverheatComponentData"), "OverheatConfig", "heat", objects("heat")[heat_index]["$id"])
external("rebelWeapon", rw, "WeaponStates/0/Mesh3p", "mesh")
assert clean(objects("rebelFiring")[rff]) == clean(objects("imperialFiring")[iff])
assert field("rebelFiring", rff, "FireLogic/FireLogicType")["name"] == "fltAutomaticFire"
field("rebelFiring", rff, "Sound")
field("rebelFiring", rff, "Shot/InitialSpeed")
field("projectile", projectile_index, "InitialSpeed")

parameters = {"roundsPerMinute": field("rebelFiring", rff, "FireLogic/RateOfFire")}
for source_name, key in {"StartDamage": "damage", "EndDamage": "endDamage",
                         "DamageFalloffStartDistance": "damageFalloffStart", "DamageFalloffEndDistance": "damageFalloffEnd",
                         "TimeToLive": "projectileLifetime"}.items():
    parameters[key] = field("projectile", projectile_index, source_name)
heat_runtime = json.loads((ROOT / "web/public/assets/weapon-heat.json").read_text())
sources = [{"file": path.relative_to(ROOT).as_posix(), "name": doc["entry"]["name"],
            "guid": doc["entry"]["guid"], "sha1": doc["entry"]["sha1"],
            "jsonSha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path, doc in documents.values()]
asset_dir = ROOT / "web/public/assets/faction-a280"
asset_files = [p for p in asset_dir.rglob("*") if p.is_file()]
artifact_records = [{"file": p.relative_to(ROOT).as_posix(), "bytes": p.stat().st_size,
                     "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in asset_files]
limitations = [
    "Native execution not observed. Reference/identifier matches establish configured faction substitution, not native event ordering.",
    "Weapon display name A280 follows the internal source asset; localized retail display text has not been recovered.",
    "Actual source third-person Mesh3p is used; first-person camera placement is reused provisional positioning, not a recovered camera transform.",
    "Main body source color/normal bound; lens shader remains unresolved, tangents are generated, and source packed material equations remain partial.",
    "Both rifles share numerically identical FiringFunction configuration except the Sound reference. Projectile speed precedence and heat transitions remain unresolved as documented by the shared heat evidence.",
    "Audio is the original close-shot component; full native sound graph and gain/attenuation remain incomplete.",
]
evidence = {
    "evidenceId": "BF2-FACTION-WEAPONS-001", "runtimeObserved": False,
    "sources": sources, "observations": observations,
    "conclusions": [
        "Both kits use GP_Assault and its default primary ability 2676124552, whose base unlock is E11.",
        "Rebel Death Star kit installs SoldierWeaponCustomizationModifier targeting the same identifier 2676124552; UnlockToCreate is U_BlasterRifle_A280.",
        "Imperial Death Star kit has no PlayerAbilityModifiers, preserving the ability's base E11 unlock.",
        "The A280 blueprint selects the recovered source Mesh3p and same Default_Rifle projectile/OverheatConfig as E11.",
        "A280 and E11 FiringFunction objects match recursively after excluding serialization identities and Sound reference. Both are automatic at 300 RPM.",
    ],
    "parameters": parameters, "runtimeAssets": artifact_records,
    "geometry": {"vertices": 9649, "bones": 44, "discardedSkinWeights": 0,
                 "validationFile": "exports/faction-a280-validation.json"},
    "limitations": limitations,
    "assertions": {"abilityIdentifierMatchesModifier": True, "rebelUnlockSubstitution": True,
                   "imperialHasNoAbilityModifiers": True, "weaponMeshDirectReference": True,
                   "firingFunctionsEqualExceptSoundAndIdentities": True},
}
(BASE / "faction-weapons-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
runtime = {
    "schemaVersion": 1,
    "teams": [{"team": 0, "weaponId": "rebel-a280"}, {"team": 1, "weaponId": "primary"}],
    "weapons": [{"id": "rebel-a280", "name": "A280", "team": 0,
                 "url": "faction-a280/meshes/faction-a280.glb", "scale": 1,
                 "source": documents["mesh"][1]["entry"]["name"],
                 "sourceWeaponGuid": documents["rebelWeapon"][1]["entry"]["guid"],
                 "sourceUnlockGuid": documents["rebelUnlock"][1]["entry"]["guid"],
                 "parameters": parameters, "heatConfig": heat_runtime["config"],
                 "audioUrl": "faction-a280/faction-a280-audio.json",
                 "firstPerson": {"position": [.18, -.23, -.36], "rotation": [0, 3.141592653589793, 0]}}],
    "provenance": {"evidenceId": evidence["evidenceId"], "runtimeObserved": False,
                   "sourceKits": {"0": sources[0], "1": sources[1]},
                   "heatEvidenceId": heat_runtime["provenance"]["evidenceId"],
                   "heatInterpretation": heat_runtime["provenance"]["interpretation"],
                   "limitations": limitations},
}
runtime_path = ROOT / "web/public/assets/faction-weapons.json"
runtime_path.write_text(json.dumps(runtime, indent=2) + "\n")
print(json.dumps({"evidenceId": evidence["evidenceId"], "sourceCount": len(sources),
                  "fieldCount": len(observations), "parameters": parameters,
                  "output": runtime_path.relative_to(ROOT).as_posix()}, indent=2))
