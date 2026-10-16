# Darth Vader gameplay evidence (EV-HERO-VADER-20261016-01)

Output: `web/public/assets/gameplay/hero-vader.json` (built by `tools/gameplay-recovery/build-hero-vader.py`).
Every value with a `source` was read by the builder from a decoded installed EBX export. The
`path` is a JSON pointer into that export file (`/asset/objects/<index>/...`); `guid` is the
EBX file GUID; the `assets` table at the end of the JSON gives each export's file, EBX SHA1 and
JSON SHA256. A post-build check re-resolved all 170 sourced pointers against the exports: 170/170
match. Values with `inferred: true` are interpretations, each with a `reason`. The game was not run;
nothing here is runtime-observed. The default loadout is used; star cards are listed separately.

## Reproduction

From `<repo>\tools\bf2-extract` (reads the install read-only):

```powershell
$g='C:\Games\Star Wars - Battlefront 2'; $o='<repo>\exports\gameplay-vader'
.\bf2-extract.exe export --game $g --out "$o\root"   --names "$o\seeds-root.txt"   --depth 0 --max-assets 200
.\bf2-extract.exe export --game $g --out "$o\batch2" --names "$o\seeds-batch2.txt" --depth 0 --max-assets 100
.\bf2-extract.exe export --game $g --out "$o\batch3" --names "$o\seeds-batch3.txt" --depth 0 --max-assets 20
.\bf2-extract.exe export --game $g --out "$o\all-affectors" --all --type AffectorAsset --depth 0 --max-assets 1000
.\bf2-extract.exe export --game $g --out "$o\battlepoint-costs" --name Online/BattlepointCostData --depth 0 --max-assets 1
```

The state machine `Gameplay/SoldierStateMachine/DefaultSoldierStateMachine` (c2db59aa-...) is the
existing export in `tools/gameplay-recovery/state/ebx` (same install; see README.md for its command).
Then, from the repo root: `python tools/gameplay-recovery/build-hero-vader.py`.

`root` exits with code 3 because two SoldierBlueprints fail to deserialize
(`Hero_Lightsaber_DarthVader`: ArgumentNullException in Frosty's dynamic type builder;
`heroes/Hero_Lightsaber`: duplicate type after that failure). A solo retry
(`exports/gameplay-vader/soldier`) fails the same way. Everything else exported with zero
serialization errors. Their dependency lists come from the inventory instead
(`DefaultHeroPhysics_Tall`, `DefaultSoldierStateMachine`, `PublicChannels`, ...).

Analysis helpers and text dumps (scratch, not used by the builder) are in
`exports/gameplay-vader/analysis/`: `graph.py` (prefab dump with name-hash resolution),
`trace.py` (data-flow up/down from one entity, decodes MathEntity assemblies), `sm.py`/`node.py`/
`flow.py`/`who.py` (state-machine exploration), `channels.json` (public channel GUID -> name),
`affector-ids.json` (affector Identifier -> asset), `descriptor-ids.json`, `hash-names.json`.
Frostbite field/event names are hashed with `h = h*33 ^ c` (seed 5381); the dictionary was built
from SDK strings, asset path words and state-machine channel names.

## Selection chain (observed)

`Kit_Hero_DarthVader` writes public channel `HeroCharacter = 2` and `IsSaberHero = true`. Every
`CharacterStateIndexChooser` on `HeroCharacter` in `DefaultSoldierStateMachine` is evaluated at
`Subjects[2]`: ground drive `DriveWithInput.Vader`, jump `Network_Physics_Jump_Vader`, high jump
`Network_Physics_JumpHigh_Vader`, fall `Network_Physics_Fall_LowGrav`, dodge `DefensiveMoveVader`,
light attack `A.Vader.Attack.SeqFLOW`; `StandOrCrouch[2]` is null (no pose controller, so no MaxSpeed
override; the Vader drive has no SpeedInput). `GP_Hero_DarthVader` applies `Affector_Health_DarthVader`,
`Affector_Hero_DarkSide`, `Affector_Hero_Sith`, `Affector_DarthVaderHealthRegen` on spawn. Ability
`Category` gives slots; `SoldierInputMapping` maps AbilityLeft/Middle/Right to EIASelectWeapon2/3/4 and
`SoldierInputConcepts` (Win32 Root1 map) binds them to Q / E / F.

## Observed values (default loadout)

| Area | Value | Source asset |
| --- | --- | --- |
| Max health | 800 | Affector_Health_DarthVader |
| Regen | delay 5 s, 50 hp/s, MaxRegenerationAmount 250 | Affector_DarthVaderHealthRegen |
| Run / sprint | 4.25 m/s, sprint x1.7; back 0.89, strafe 0.935; gain 0.4, stop 0.4, sprint gain 0.5 | DefaultSoldierStateMachine `DriveWithInput.Vader` |
| Blocking move | 2.4 m/s, no sprint (AlternativeMovmentEnum=2 set by deflect ability) | `DriveWithInput.Blocking`, Ability_Deflect_CharacterState_Vader |
| Choke move | 2.5 m/s, no sprint | `DriveWithInput.Trooper.Slowed` in `L.Vader.ForceChoke.Loop.Layer` |
| Jump | ConstantVelocity target y 7 m/s, weight 0.3 (high: 9, 0.23); fall gravity -20, drag 3 | state machine Vader jump/fall controllers |
| Dodge | RechargeTime 2.2 s, RetriggerCount 2, TriggerCost 0.5 (charge model not proven), projected distance 4 m | Ability_Evade_CharacterState, `DefensiveMoveVader` |
| Body | radius 0.3, stand height 1.95, eye (-0.15,1.55,0), step 0.4 | DefaultHeroPhysics_Tall |
| Saber hit | 130 hp (+0.09 s delay); behind +30; Focused Rage +15 | Affector_Damage_Lightsaber_Vader (+_FromBehind, _HulkModeBonus) |
| Combo | 16 flow nodes; strikes damage ticks 15-25, closers 25-35; next input from tick 29-55 to 100; looping chain | `A.Vader.Attack.SeqFLOW` node tracks |
| Attack choice | target > 4 m or sprinting with no target -> closer (AttackType 1), else strike (2) | PF_Lightsaber_Gameplay_Physical, AllRequests |
| Hit volume | server sphere r 3 m at +1 m up, 1.5 m ahead; 35 deg cone from centre; 45 deg probe from 5 m behind | PF_Lightsaber_Gameplay_Physical |
| Lock-on | 8 m (2 m when restricted), 60 deg then 40 deg, 1 target | PF_Lightsaber_Gameplay_Physical |
| Stamina | pool 100; drain rates: own swing 60/s, blocked saber hit 15/s, deflected bolt 8/s; regen 30/s after 2.25 s; rage x0.5 | Online/BattlepointCostData (GLOBAL), PF_DeflectAbility_Gameplay_Vader |
| Shield | radius 1.2 m, 0.45 m forward, arc 90, bullets only | PF_DeflectAbility_Gameplay_Vader, HeroShieldDarthVader |
| Deflected bolt | 150 m/s, 36 -> 30 hp over 20-40 m, TTL 3 s, spread 0.2 | BlasterProjectile_SaberDeflect, cost table SPREAD 20 |
| Force Choke | slot Right (F); cooldown 25 s; activation 0.5 s; hold 1.5 s; radius 12 m; angle 35; 86 hp/s + 1 initial, 0.5 s interval | Ability_DarthVader_ForceChokes, Affector_Damage_DarthVader_ForceChoke |
| Vader while choking | damage multiplier 0.2, force immunity, other abilities blocked | Affector_DarthVader_ForceChoke_ArmorReduction, PF_ForceChoke_DarthVader |
| Saber Throw | slot Left (Q); cooldown 8 s; activation 0.7 s; return beyond 20 m; caught within 3.5 m; 150 hp per hit; hit sphere 0.5 m; MaxSpeed 35 | Ability_DarthVader_SaberThrowCharacterState, Projectile_DarthVader_SaberThrow, Affector_Damage_Vader_SaberThrow |
| Focused Rage | slot Middle (E); 10 s; cooldown 15 s; +15 saber dmg; stamina costs x0.5; 200 hp damage shield, depletes after 8 s at 1 hp/0.01 s; power-up clip 108 ticks | Ability_Vader_FocusRage, PF_FocusedRage_DarthVader, Affector_Phasma_SelfHealss |
| Camera | ANT distance 2.25 (alt 3.25), other slots 0.17 / 0.45 / -0.6; FOV 55; pitch 85/-70; aim follow offset (-0.5,0.2,0) | Hero_Lightsaber_Vader_Camera_3P, AimingController_HeroAimAssist_Default, PF_Hero_CameraAimer_NoWeapon |

## Inferences (marked in the JSON)

- Sprint speed 7.225 m/s = Velocity x sprint TopSpeedModification; native combination order not decompiled.
- From-behind total 160 assumes the separate 30 hp affector stacks with the normal hit.
- Hit-volume orientation: on the character-state Position channel, local -Z is taken as forward
  (the 180-degree-yawed probe at +5 m only makes sense as a "behind me" exclusion if -Z is front).
- Block rule: blocking targets are still hit when their facing is within 70 deg of the attacker's
  (from behind); otherwise they receive BlockedLightSaber and no damage. Blocking heroes also get no
  Force Choke damage.
- Deflected bolts follow Vader's aim (camera) transform plus random spread; they are not returned to
  the shooter.
- Stamina costs are rates applied while a condition holds; per-event estimates (bolt ~2, blocked saber
  hit ~7.5, own swing ~20 at 30 ticks/s) are derived, not authored.
- Force Choke total ~130 hp (1 + 86 x 1.5) and multi-target cone (no MaxResults on the damage path).
- Saber Throw pierces and can hit a target outbound and again on return (hit cache reset on return).
- Block input = ConceptZoom (right mouse) is inferred; the IsBlocking writer is outside decodable data.
- Graph ticks -> seconds: `browserDefault` 30 ticks/s (ANT controllers record FPS 30).

## Unresolved

See `unresolved` in the JSON. Main items: graph tick rate; undecodable hero soldier blueprint;
native query-filter semantics (half vs full angles, LessThan distance); MaxRegenerationAmount meaning;
exact stamina accounting; material-grid damage scaling; camera game-state names and the 3.25 switch
event; block input binding; choke lift/victim pose; saber-throw effective launch speed.

Not used: `Affector_Vader_AbilitySlowed` and `AlternativeMovementSlowedVader.EC` are applied by
Han Solo's Sharpshooter, not by Vader. `PF_FuelResource_Stamina` is the generic pool driven by the
deflect prefab. `class_schematics` assets decode to empty TypeRefs and hold no values.
