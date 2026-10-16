"""Preserve selected E-11 heat fields and bounded shared-graph evidence.

Run from any directory: python tools/gameplay-recovery/inspect-e11-heat-state.py
This reads retained exports; no game execution or native-state observation.
"""
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent.parent


def load(pattern):
    paths = list(BASE.glob(pattern))
    assert len(paths) == 1, pattern
    path = paths[0]
    document = json.loads(path.read_text(encoding="utf-8-sig"))
    assert not document["asset"]["errors"]
    return path, document


heat_path, heat = load("core/ebx/*OverheatConfig_Default_Rifle__*.json")
logic_path, logic = load("heat-logic/ebx/*PF_Weapon_HeatLogic__*.json")
affector_path, affector = load("heat-state/ebx/*Affector_CoolingPowerMultiplier_SuperSuccess__*.json")
schematics_path, schematics = load("heat-state/ebx/*class_schematics__*.json")
weapon_path, weapon = load("e11-root/ebx/*W_BlasterRifle_E11__*.json")


def source(path, document):
    return {"file": path.relative_to(ROOT).as_posix(), "guid": document["entry"]["guid"],
            "sha1": document["entry"]["sha1"], "jsonSha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def field(path, document, pointer, value=None):
    observed = document
    for part in pointer.split("/")[1:]:
        observed = observed[int(part)] if isinstance(observed, list) else observed[part]
    return {"file": path.relative_to(ROOT).as_posix(), "jsonPointer": pointer,
            "sourceValue": observed, "value": observed if value is None else value}


runtime_parameters = {}
scalar_map = {
    "heatPerShot": "HeatPerBullet", "coolingPerSecond": "HeatDropPerSecond",
    "heatIncreasePerSecond": "HeatIncreasePerSecond", "heatMultiplier": "HeatMultiplier",
    "heatDropMultiplier": "HeatDropMultiplier", "warningThreshold": "HeatWarningThreshold",
    "coolingDelay": "OverheatDropDelay", "overheatPenalty": "OverHeatPenaltyTime",
    "overheatedDropMultiplier": "OverheatedDropMultiplier", "resetThreshold": "OverHeatThreshold",
    "exitOverheatDelay": "ExitOverheatDelay", "preventHeatDropWhileFiring": "PreventHeatDropWhileFiring",
    "ventDuration": "VentingSettings/Duration", "exitVentingDelay": "VentingSettings/ExitVentingDelay",
    "activeCooldownEnabled": "ActiveCooldownSettings/EnableActiveCooldown",
    "minimumTriggerHeat": "ActiveCooldownSettings/MinimumTriggerHeat",
    "minimumTriggerHeatTime": "ActiveCooldownSettings/MinimumTriggerHeatTime",
    "successPenalty": "ActiveCooldownSettings/SuccessPenaltyTime",
    "failurePenalty": "ActiveCooldownSettings/FailurePenaltyTime",
    "successExitDelay": "ActiveCooldownSettings/OnSuccessExitOverheatDelay",
    "failureExitDelay": "ActiveCooldownSettings/OnFailureExitOverheatDelay",
}
for key, name in scalar_map.items():
    runtime_parameters[key] = field(heat_path, heat, "/asset/objects/1/" + name)
interval = heat["asset"]["objects"][1]["ActiveCooldownSettings"]["DifficultyInterval"][0]
super_interval = heat["asset"]["objects"][2]
assert interval["SuperZoneInterval"]["$ref"] == super_interval["$id"]
runtime_parameters["successWindow"] = field(heat_path, heat,
    "/asset/objects/1/ActiveCooldownSettings/DifficultyInterval/0", [interval["Start"], interval["End"]])
runtime_parameters["superWindow"] = field(heat_path, heat,
    "/asset/objects/2", [super_interval["Start"], super_interval["End"]])
runtime_parameters["superSuccessDuration"] = field(logic_path, logic, "/asset/objects/65/DefaultValue")


def hash_name(name):
    value = 5381
    for character in name:
        value = ((value * 33) ^ ord(character)) & 0xFFFFFFFF
    return value


names = ["Heat", "HeatMultiplier", "IsActive", "Condition", "Output", "Out", "Value",
         "ValueIfFalse", "ValueIfTrue", "Duration", "OnApplied", "OnRemoved", "ResetHeat", "Bool",
         "SetFalse", "SetTrue", "OnTrue", "OnFalse", "In", "Data", "Input", "OnOverheated"]
dictionary = {hash_name(name): name for name in names}
objects = logic["asset"]["objects"]
graph = objects[0]
super_id = affector["asset"]["objects"][0]["Identifier"]
assert super_id == 3998562258
assert objects[22]["AffectorListenToId"] == super_id
assert objects[24]["AffectorListenToId"] == super_id
assert objects[2]["Affector"]["$external"] == affector["entry"]["guid"]
assert objects[65]["DefaultValue"] == 6
assert objects[51]["ValueIfTrue"] == 0


def property_connection(source_id, source_field, target_id, target_field):
    for index, c in enumerate(graph["PropertyConnections"]):
        if (c["Source"].get("$ref") == source_id and c["Target"].get("$ref") == target_id
                and c["SourceFieldId"] & 0xFFFFFFFF == hash_name(source_field)
                and c["TargetFieldId"] & 0xFFFFFFFF == hash_name(target_field)):
            return {"jsonPointer": f"/asset/objects/0/PropertyConnections/{index}", "value": c}
    raise AssertionError((source_id, source_field, target_id, target_field))


verified_connections = [
    property_connection("internal:71", "Out", "internal:51", "Condition"),
    property_connection("internal:51", "Output", "internal:67", "HeatMultiplier"),
    property_connection("internal:48", "Output", "internal:51", "ValueIfFalse"),
    property_connection("internal:35", "Value", "internal:48", "Condition"),
    property_connection("internal:65", "Value", "internal:49", "ValueIfFalse"),
    property_connection("internal:68", "Out", "internal:2", "Duration"),
]
assert any(c["Source"].get("$ref") == "internal:22" and c["Target"].get("$ref") == "internal:71"
           and c["SourceFieldId"] & 0xFFFFFFFF == hash_name("IsActive") for c in graph["PropertyConnections"])
assert any(c["Source"].get("$ref") == "internal:22" and c["Target"].get("$ref") == "internal:67"
           and c["SourceEvent"]["Id"] & 0xFFFFFFFF == hash_name("OnApplied")
           and c["TargetEvent"]["Id"] & 0xFFFFFFFF == hash_name("ResetHeat") for c in graph["EventConnections"])

graph_ids = [2, 22, 24, 35, 47, 48, 49, 51, 65, 68, 71, 82, 84, 85, 86]
report = {
    "evidenceId": "BF2-E11-HEAT-002", "runtimeObserved": False,
    "scope": "Selected source E-11 heat fields and bounded shared-graph dependencies; executable state machine not recovered.",
    "routingEvidence": "BF2-E11-ROUTING-001",
    "sources": [source(p, d) for p, d in [(heat_path, heat), (logic_path, logic),
                  (affector_path, affector), (schematics_path, schematics), (weapon_path, weapon)]],
    "runtimeParameters": runtime_parameters,
    "observations": [
        "Selected OverheatConfig enables cooling, overheating, venting and active cooldown. The override config is selected by the E-11 owned OverheatComponent; see BF2-E11-ROUTING-001.",
        "The source value named OverHeatThreshold is .001, not the normalized full-heat boundary. Shared logic compares live Heat against .999 in internal:47.",
        "Venting is configured for TertiaryFire and active cooldown for SecondaryFire. These are engine input enum labels, not verified browser key mappings.",
        "Active cooldown exposes one DifficultyInterval, Start=.8 End=.65, with a referenced SuperZoneInterval Start=.4 End=.3. Source records no explanatory semantic comments.",
        "Source difficulty increments are success +1, failure -100, no-trigger 0. The browser does not claim native difficulty-index behavior.",
        "Super-success affector Identifier=3998562258 matches internal:22/24 receivers. IsActive feeds the zero-heat OR branch; OnApplied also sends ResetHeat to the weapon component.",
        "Super-success duration comes through internal:68 to affector Apply.Duration. Its default unmodified duration input is internal:65 Value=6; optional input/state modifiers are wired to the math node.",
        "The retained class_schematics asset contains empty fields/observers and no recovered executable component body; it cannot establish native state transitions.",
    ],
    "browserInterpretation": [
        "Heat fills at 1; the .001 threshold is interpreted as the overheat exit threshold.",
        "Each shot restarts the five-second ordinary cooling delay. Overheating instead waits the one-second penalty, cools at .3*1.5, then waits the .3 exit delay.",
        "Venting linearly drains the starting heat over one second. Negative ExitVentingDelay=-1 is interpreted as fallback to ExitOverheatDelay=.3.",
        "Active windows are evaluated against descending heat, after minimum heat/time gating. Success clears heat and imposes .2 seconds; a miss pauses cooling .3 seconds and consumes the attempt.",
        "Super success clears heat and enables zero-heat shots for the source default six seconds. The optional duration modifiers are not modeled.",
        "All these transitions are explicit reconstruction choices, not observed native execution. Pure module tests prove internal consistency and source-value preservation only.",
    ],
    "unknowns": [
        "Native overlap/order of OverheatDropDelay, OverHeatPenaltyTime and ExitOverheatDelay.",
        "Whether SuperZoneInterval is absolute heat or relative to DifficultyInterval; exact min-trigger time origin and press handling.",
        "Negative vent-exit sentinel behavior, interruption/weapon swap behavior, boost modifier and spawn initialization order.",
        "Native difficulty-index progression/clamping and full affector/card effects.",
    ],
    "verifiedConnections": verified_connections,
    "graphObjects": [{"jsonPointer": f"/asset/objects/{i}", "value": objects[i]} for i in graph_ids],
    "hashNames": {f"{key:08x}": value for key, value in dictionary.items()},
    "assertions": {"sourceSuperAffectorMatchesReceivers": True, "zeroHeatBranchConnected": True,
                   "superSuccessResetsHeat": True, "baselineDuration6RoutedIntoAffector": True},
}
out = BASE / "e11-heat-state-evidence.json"
out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
runtime_path = ROOT / "web/public/assets/weapon-heat.json"
runtime_document = {
    "schemaVersion": 1,
    "weapon": {"name": weapon["entry"]["name"], "guid": weapon["entry"]["guid"],
               "sha1": weapon["entry"]["sha1"], "unlockGuid": "c0bc1484-4a00-43a6-a823-1d78547cfb6a"},
    "config": {key: entry["value"] for key, entry in runtime_parameters.items()},
    "provenance": {
        "evidenceId": report["evidenceId"], "routingEvidenceId": report["routingEvidence"],
        "runtimeObserved": False,
        "parameterEvidence": "Selected installed EBX field values and shared heat graph defaults.",
        "stateMachineEvidence": "Reconstructed interpretation; native execution not measured.",
        "interpretation": report["browserInterpretation"], "unknowns": report["unknowns"],
        "sources": report["sources"],
    },
}
runtime_path.write_text(json.dumps(runtime_document, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"output": out.relative_to(ROOT).as_posix(), "evidenceId": report["evidenceId"],
                  "runtimeOutput": runtime_path.relative_to(ROOT).as_posix(),
                  "runtimeParameterCount": len(runtime_parameters), "runtimeObserved": False}, indent=2))
