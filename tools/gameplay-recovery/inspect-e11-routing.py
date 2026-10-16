"""Trace the installed E-11 configuration without choosing undocumented native precedence.

Reproduce from the project root: python tools/gameplay-recovery/inspect-e11-routing.py
Only reads bounded EBX exports and writes e11-routing-evidence.json beside this script.
"""
import datetime
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent.parent


def load(pattern):
    paths = list(BASE.glob(pattern))
    assert len(paths) == 1, (pattern, len(paths))
    p = paths[0]
    d = json.loads(p.read_text(encoding="utf-8-sig"))
    assert not d["asset"].get("errors"), p
    return p, d


def obj(d, object_id):
    matches = [(i, o) for i, o in enumerate(d["asset"]["objects"]) if o["$id"] == object_id]
    assert len(matches) == 1, object_id
    return matches[0]


def source(p, d):
    return {"file": p.relative_to(ROOT).as_posix(), "name": d["entry"]["name"],
            "guid": d["entry"]["guid"], "sha1": d["entry"]["sha1"],
            "jsonSha256": hashlib.sha256(p.read_bytes()).hexdigest()}


def field(document, object_id, path):
    p, d = document
    i, o = obj(d, object_id)
    value = o
    for part in path.split("/"):
        value = value[int(part)] if isinstance(value, list) else value[part]
    return {"source": source(p, d), "objectId": object_id, "objectType": o["$type"],
            "jsonPointer": f"/asset/objects/{i}/{path}", "value": value}


def ebx_hash(s):
    value = 5381
    for ch in s:
        value = ((value * 33) ^ ord(ch)) & 0xFFFFFFFF
    return value


unlock = load("state/ebx/*U_BlasterRifle_E11__*.json")
weapon = load("e11-root/ebx/*W_BlasterRifle_E11__*.json")
firing = load("core/ebx/*WeaponFiring_Default_BlasterRifle__*.json")
projectile = load("detail/ebx/*BlasterProjectile_Default_Rifle__*.json")
heat = load("core/ebx/*OverheatConfig_Default_Rifle__*.json")
logic = load("heat-logic/ebx/*PF_Weapon_HeatLogic__*.json")

wid = "internal:9"
fid = "71795a6f-6aec-4157-87bc-577447b58d46"
function_id = "77ceaa01-7a80-4ec5-9dd6-15fdc5b0f0d6"
bullet_id = "1835f15a-3cf1-4f4e-8f91-0aab72659170"
heat_id = "3d65ad3e-d4b5-4ac4-899a-0caecfca0f85"
heat_component_id = "internal:8"
logic_ref = "9371b8f0-832a-4d38-b33c-7568d9493677"

weapon_obj = obj(weapon[1], wid)[1]
function = obj(firing[1], function_id)[1]
component = obj(weapon[1], heat_component_id)[1]
heat_config = obj(heat[1], heat_id)[1]
assert weapon_obj["WeaponFiring"]["classGuid"] == fid
assert obj(firing[1], fid)[1]["PrimaryFire"]["$ref"] == function_id
assert function["Shot"]["ProjectileData"]["classGuid"] == bullet_id
assert function["Shot"]["ProjectileData"]["$external"] == projectile[1]["entry"]["guid"]
assert component["OverheatConfig"]["classGuid"] == heat_id
assert component["OverheatConfig"]["$external"] == heat[1]["entry"]["guid"]
assert {"$ref": heat_component_id} in weapon_obj["Components"]
assert {"$ref": logic_ref} in weapon_obj["Components"]
assert obj(weapon[1], logic_ref)[1]["Blueprint"]["$external"] == logic[1]["entry"]["guid"]
assert not component["Excluded"] and component["OverheatOverrideConfigIndex"] == -1

default_modifiers = next(m for m in weapon_obj["WeaponModifierData"]
                         if m["UnlockAssetGuid"] == "00000000-0000-0000-0000-000000000000")
default_modifier_types = [obj(weapon[1], r["$ref"])[1]["$type"] for r in default_modifiers["Modifiers"]]
assert default_modifier_types == ["FrostySdk.Ebx.WeaponFiringEffectsModifier"]

weapon_root = weapon[1]["asset"]["objects"][0]
logic_root = logic[1]["asset"]["objects"][0]
heat_connections = []
for kind in ["PropertyConnections", "EventConnections", "LinkConnections"]:
    for i, connection in enumerate(weapon_root.get(kind, [])):
        if heat_component_id in [connection.get("Source", {}).get("$ref"), connection.get("Target", {}).get("$ref")]:
            heat_connections.append({"pointer": f"/asset/objects/0/{kind}/{i}", "connection": connection})
heat_multiplier_hash = ebx_hash("HeatMultiplier")
assert heat_multiplier_hash == 0xFC804116
assert any(c["connection"].get("Source", {}).get("$ref") == logic_ref
           and c["connection"].get("Target", {}).get("$ref") == heat_component_id
           and (c["connection"].get("TargetFieldId", 0) & 0xFFFFFFFF) == heat_multiplier_hash
           for c in heat_connections)

logic_branch_ids = ["internal:51", "internal:48", "internal:35", "internal:86", "internal:84", "internal:71"]
branch_connections = [dict(pointer=f"/asset/objects/0/PropertyConnections/{i}", connection=c)
                      for i, c in enumerate(logic_root["PropertyConnections"])
                      if c["Target"].get("$ref") in ["internal:51", "internal:48", "internal:71"]
                      or (c["Source"].get("$ref") == "internal:51" and c["Target"].get("$ref") == "internal:67")]

observed_fields = {
    "unlockBlueprint": field(unlock, "ce09917b-edab-4e8e-8925-cc811daef27b", "NonStreamedBlueprint"),
    "weaponFiring": field(weapon, wid, "WeaponFiring"),
    "primaryFire": field(firing, fid, "PrimaryFire"),
    "shot": field(firing, function_id, "Shot"),
    "bulletInitialSpeed": field(projectile, bullet_id, "InitialSpeed"),
    "bulletInstantHit": field(projectile, bullet_id, "InstantHit"),
    "bulletTimeToLive": field(projectile, bullet_id, "TimeToLive"),
    "bulletGravity": field(projectile, bullet_id, "Gravity"),
    "weaponModifierData": field(weapon, wid, "WeaponModifierData"),
    "heatConfigReference": field(weapon, heat_component_id, "OverheatConfig"),
    "heatOverrideConfigIndex": field(weapon, heat_component_id, "OverheatOverrideConfigIndex"),
    "legacyOverHeat": field(firing, function_id, "OverHeat"),
}
for key in ["OverrideSettings", "AllowOverheating", "EnableCooldown", "HeatPerBullet", "HeatDropPerSecond",
            "HeatIncreasePerSecond", "HeatMultiplier", "DefaultHeatMultiplier", "HeatDropMultiplier",
            "HeatWarningThreshold", "OverHeatThreshold", "OverheatDropDelay", "OverHeatPenaltyTime",
            "OverheatedDropMultiplier", "ExitOverheatDelay", "PreventHeatDropWhileFiring",
            "VentingSettings", "ActiveCooldownSettings"]:
    observed_fields["componentConfig." + key] = field(heat, heat_id, key)

report = {
    "evidenceId": "BF2-E11-ROUTING-001",
    "createdAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "scope": "Installed default E-11 reference route and selected heat configuration; bounded EBX evidence, no native execution measurement.",
    "runtimeObserved": False,
    "sources": [source(*d) for d in [unlock, weapon, firing, projectile, heat, logic]],
    "observations": [
        "E-11 unlock explicitly selects the E-11 weapon blueprint. The weapon selects Default_BlasterRifle WeaponFiring, whose PrimaryFire selects this FiringFunction.",
        "The same FiringFunction Shot has vector InitialSpeed=(0,0,700) and references WSBulletEntityData with scalar InitialSpeed=350. Shot.Projectile and both secondary projectile fields are null. InheritWeaponSpeedAmount is zero; neither pitch scaling array contains values.",
        "The unconditional weapon modifier only changes firing effects. A separate nonzero unlock selects an Ion projectile modifier; it is not an unconditional numeric firing-speed override.",
        "The weapon Components list includes an enabled OverheatComponentData selecting OverheatConfig_Default_Rifle. OverheatOverrideConfigIndex is -1 and the selected configuration has OverrideSettings=true.",
        "The selected component config supplies HeatPerBullet=.04, HeatDropPerSecond=.3, HeatIncreasePerSecond=0 and multiplier fields 1. The FiringFunction OverHeat struct instead has HeatPerBullet=0 and HeatIncreasePerSecond=0; its .2 cooling and other timer fields are separate observed data.",
        "The weapon connects PF_Weapon_HeatLogic.HeatMultiplier into OverheatComponentData.HeatMultiplier using independently checked EBX hash fc804116. The component also sends overheat-related events to heat logic, sound and other weapon components.",
        "HeatLogic's multiplier output is a ConditionalFloat: its true branch is zero; its false branch selects 1 or a SimpleFloatState initially .8. Its top condition is an OR fed by affector results. This is dynamic state wiring, not a constant multiplier guarantee.",
        "The selected config enables venting with Duration=1 and active cooldown with interval Start=.8/End=.65. Exact native interpretation of descending intervals, reset threshold .001, delay 5 and firing-state cooling gating has not been measured."
    ],
    "inferences": [
        {"statement": "The component configuration is the appropriate source for a browser heat implementation of this E-11, rather than interpreting the legacy FiringFunction.OverHeat struct as the only active system.",
         "basis": "Explicit component ownership, selected config, OverrideSettings=true, and incoming/outgoing live logic wiring.",
         "confidence": "strong configuration-route evidence; not native precedence proof"},
        {"statement": "A baseline multiplier of 1 follows the visible false/default branches when no affecting state changes or affector inputs are active.",
         "basis": "ConditionalFloat defaults and BoolEntityData false initial state.",
         "confidence": "conditional inference; original spawn/ability event order is unobserved"}
    ],
    "unknowns": [
        "Native precedence of Shot.InitialSpeed versus WSBulletEntityData.InitialSpeed remains unresolved. Neither 350 nor 700 is promoted to a proven effective velocity.",
        "Exact native overheat threshold, delay/cooling transitions, active cooldown and venting behavior remain unresolved; field labels alone do not establish the state machine.",
        "Affector-triggered heat multiplier changes, including initialization order, have not been fully traced or observed.",
        "Native implementation of OverrideSettings and whether any legacy heat fields participate in another path has not been decompiled."
    ],
    "integrationAdvice": {
        "projectileSpeed": "Keep explicitly provisional; do not average 350 and 700 or claim either is source-proven effective speed.",
        "heatParameters": {"sourceSelectedHeatPerBullet": .04, "sourceSelectedHeatDropPerSecond": .3,
                           "baselineHeatMultiplierConditional": 1},
        "heatStateMachine": "May use these selected-config values, but label the browser timing/state interpretation provisional until native/runtime evidence resolves it.",
        "filesModified": "Evidence only. gameplay.json and browser runtime are deliberately not written by this script."
    },
    "observedFields": observed_fields,
    "heatComponentConnections": heat_connections,
    "heatMultiplierBranchObjects": [{"pointer": f"/asset/objects/{obj(logic[1], i)[0]}", "object": obj(logic[1], i)[1]} for i in logic_branch_ids],
    "heatMultiplierBranchConnections": branch_connections,
    "assertions": {"exactReferenceChain": True, "unconditionalModifierOnlyFiringEffects": True,
                   "componentInWeaponComponents": True, "heatLogicInWeaponComponents": True,
                   "heatMultiplierHashAndConnection": True},
}
out = BASE / "e11-routing-evidence.json"
out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"output": out.relative_to(ROOT).as_posix(), "evidenceId": report["evidenceId"],
                  "sourceCount": len(report["sources"]), "fieldCount": len(observed_fields),
                  "effectiveProjectileSpeedResolved": False,
                  "heatComponentRouteVerified": True}, indent=2))
