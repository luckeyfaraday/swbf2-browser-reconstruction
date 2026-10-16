# Darth Vader third-person animation recovery

`BF2-VADER-ANIM-001` decodes Darth Vader's shipped third-person clips and the human-male (trooper) hero-reaction clips from the already retained common ANT bank (`exports/characters/ant-common-bank/0.res`, SHA-256 recorded in every output). Gameplay timing comes from the already retained decoded EBX `Gameplay/SoldierStateMachine/DefaultSoldierStateMachine`. No new game extraction was needed and no existing file was modified.

## Outputs

| File | Contents |
|---|---|
| `exports/characters/vader-animation/clips.json` (~67 MB) | 128 Vader + 40 victim clips: source controller/animation keys, codec, FPS/TimeScale/trim fields, source key frames, every decoded channel (`bone`, `property`, source DOF id/slot, exact float32 `values`), unmapped DOF samples, root-motion curve, graph events, ANT clip tags, gameplay-window summary, regression results. |
| `exports/characters/vader-animation/graph.json` | Every state-graph usage of a selected clip: ClipInfos schedule, keyframed Bool/Int/Float tags, transitions, per-tick AITrajectory transform tracks, Vader movement/warp/jump controller parameters. |
| `web/public/assets/characters/vader-animations.glb` (10.4 MB) | Skeleton-only GLB (248 Walrus_HumanMale joints copied from `stormtrooper.glb` skin 0) + 128 animations named by short id, extras per animation. |
| `web/public/assets/characters/hm-hero-reactions.glb` (3.1 MB) | Same skeleton + 40 victim animations. |
| `exports/characters/vader-animation/dct-crosscheck/report.json` | Python vs unmodified C# DCT decoder comparison (76 clips); `*.source.json` inputs retained. |
| `exports/characters/vader-animation/sanity-report.json` | Structural, anatomical and three.js loader check results. |
| `exports/characters/vader-animation/*.validation.json` | Khronos glTF validator reports (0 errors, 0 warnings, 0 infos). |

Tools (all new, in `tools/characters/`): `vader-graph.py`, `vader-decode.py`, `vader-verify-dct.py`, `vader-build-glb.py`, `vader-animation-check.mjs`.

## Reproduce

```powershell
python tools/characters/vader-graph.py          # EBX graph evidence -> graph.json (~10 s)
python tools/characters/vader-decode.py         # ANT decode -> clips.json (~15 s, runs regression checks first)
python tools/characters/vader-verify-dct.py     # C# cross-check of every decoded DCT clip (uses the built firstperson-dct-reference)
python tools/characters/vader-build-glb.py      # -> vader-animations.glb, hm-hero-reactions.glb
node tools/characters/vader-animation-check.mjs # sanity + three.js binding check (exit code 1 on failure)
node tools/bf2-extract/validate-glb.cjs web/public/assets/characters/vader-animations.glb exports/characters/vader-animation/vader-animations.validation.json web/public/assets
```

## Observations (verified from data)

- **Rig.** Every DOF of every Vader clip resolves through `Walrus_HM_Rig` (`4df8f37fade10ee2`), the 3P human rig shared with the troopers, except 4 DOFs in the strike/choke/dodge family and 2 in the intro. The 8 unresolved DOF ids (for example rotations 2833356786, 2853835882 and translations 3206872217, 3185540865) exist in none of the 15 RigAssets in the bank; their samples are retained under `unmapped`.
- **Raw codec.** 92 raw clips decode. 10 of them (idle, fidgets, block idle, strike-to-idle helper, several emotes) pad each per-key record to a multiple of four floats (`codecDetails.stridePadding`); constant records are unpadded. The generalized raw path reproduces `decode-animation.py` exactly (max difference 0.0) on Strike1, Run_Fwd_03, Dodge_Left and `C_HM_Rifle_Run_Fwd_01`.
- **DCT codec with packed scalars.** 3P DCT clips carry `NumFloat=8` scalars in `NumFloatVec=2` Vec4 channels (foot `vel`/`height`). The verified 1P decoder (`firstperson-decode-dct.decompress`) is called unmodified with the float vectors relabelled as extra Vec4 channels; the ChannelToDof mapping has `NumQuats+NumVec3+NumFloat` entries and scalar j is component `j%4` of float vector `j//4`. The relabelling reproduces the retained 1P outputs byte-for-byte, and the existing `firstperson-dct-test.py` still passes. Decoded foot `height`/`vel` ranges match the raw-codec equivalents (heights 0.10-0.31 m foot / 0.03-0.18 m toe, velocities >= 0).
- **DCT cross-check** (`BF2-VADER-DCT-CROSSCHECK-001`). All 76 DCT clips (39 Vader, 37 victim; 1,933,248 floats) are byte-identical between Python and the unmodified upstream C# `DctDecompressor.cs` host, which decodes float vectors natively (`DofCount = NumQuats+NumVec3+NumFloatVec`). Trailing coefficient bits are always zero (129-255 bits). Rotation steps across 8-key DCT block edges look like interior steps (median ratio 1.02).
- **Quaternion norms** before normalization: raw <= 2.6e-7; DCT <= 1.7e-3 (push deaths highest).
- **Graph tick to clip frame.** For every lead clip the EBX `ClipInfos[].Length` equals `TrimmedDuration / TimeScale`, and the EBX per-tick AITrajectory transform track equals the decoded ANT AITrajectory translation sampled at `frame = TrimOffset + tick * TimeScale` within 1e-6 m (strikes, closers, staggers, choke, throw, air attack; dodges outside their blends).
- **Root motion.** AITrajectory translation is the root path; controller `Distance` equals its horizontal end displacement (Strike1 1.8036 m). AITrajectory rotation is a constant -90 deg yaw in every decoded clip (yaw delta 0) with Hips counter-rotated, so the body faces +Z. Dodge_Left moves +X and Dodge_Right -X: +X is the character's left.
- **Hit windows exist.** Every Vader strike state-flow node (`Vader_Strike_1..6`, `Vader_StrikeN_V2`, `Vader_Closer_1..3`) and the in-air attack sequence set Int tag `CharacterState.LightSaberDmg.Given.Dir.EnumGS` (value 0) and Bool tag `ExecuteKill` over the same window: strikes ticks 15-25, closers 25-35, air attack 10-40 (with `TriggerAffectorEnum`=2). Combo transitions are Int conditions on `AttackType` (2 -> next strike, 1 -> closer) with authored StartTick/Length. Force choke sets `TriggerAffectorEnum`=5 at ticks 8-40; the saber throw sets `TriggerAffectorEnum`=6 at ticks 10-12. Tags also give Unstaggerable, CurrentAbility, branch windows (IntoAir/Evade/Ability/Movement/End.3P), DodgeDirection, camera offsets and IK reach curves.
- **ANT clip tags.** 100 of the 223 Vader ClipControllerAssets carry a TagCollectionSet. Their timing lives in base classes the retained inventory does not expand (`TimelinePointTag.StartLinkOffset`, `TimelineTag.EndLinkOffset` = length, both in ticks; for example `E_Vader_01` Early.3P 338+22 = 360 = clip length). They hold branch-out windows, foot-plant resets, `HideWeapon3P` (catch: ticks 9-11), `3P.EnableSteering`, and for victim deaths `Physics.Active`, `Game.Character.Ragdoll.FullRagdoll` and `DisableForcedRagdoll`. No damage tags are stored at ANT level.
- **Victim choke.** The graph's `ChokeEnter`/`ChokeLoop` nodes use the `*_PhysCtrl_*` clips. Their lift is in AITrajectory Y: enter rises 0 -> 0.63 m (`_01_new`) or 0.80 m (02-04), loops hold 0.80 m. The non-PhysCtrl variants keep AITrajectory at 0 and bake about 1 m into the Hips track (`*-hipslift`, `choke-exit-alive`). `ChokeDeath_Still_*` raise AITrajectory 0.92-1.33 m while the body falls to the floor.
- **Vader movement parameters (EBX).** `DriveWithInput.Vader` Velocity 4.25 m/s (slowed variant 2.5), input scaling back 0.89 / sides 0.935; `DefensiveMoveVader` ProjectedDistance 4, SteerAnimatableFactor 0.2; force jump UpThrust 25, AccelerateTime 0.5 s. All in `graph.json` `vaderNamedObjects`.

## Inferences (not observed natively)

- **60 graph ticks per second.** Seconds = `(frame - TrimOffset) / TimeScale / 60`. Support: almost every clip pairs FPS=30 with TimeScale=0.5, while FPS=60 clips use TimeScale=1.0; the decoded run-fwd root speed is then 3.97 m/s against the authored `DriveWithInput.Vader` Velocity 4.25 m/s, walk 2.68 m/s against the slowed 2.5 m/s, sprint 6.58 m/s. A 30 Hz clock would halve all of these. Clips with TimeScale other than 0.5 (block swings 0.686, side/back walks 0.54-0.6, blocked attacks 0.46-0.58, air attack 0.6) play faster or slower than 30 source frames per second, as authored.
- **Hit window = span of the `LightSaberDmg.Given` tag**, mapped onto the clip as `(tick - ClipInfo.StartTime) / 60`. Damage application, hit shapes, damage values and ExecuteKill semantics were not traced.
- **Tag timeline.** For a sequence's lead clip, windows are relative to that clip's start and may extend past its end into the follow-up clip (strike `End.3P` at 1.667 s while the strike clip lasts 1.467 s; natively `*_BackToIdle` starts at 0.733 s with a 0.18 s blend). For follow-up clips only tags inside their scheduled segment are mapped. `extras.timeline` says which applies.
- **ANT tag ticks** are clip-local graph ticks (`start = StartLinkOffset`, `end = start + EndLinkOffset`, `LinkFlags` retained); `EndLinkOffset=0` appears to mean "until the clip end".

## Limitations

- `L_Vader_Stand_Idle_Block_Right_01` is a `VbrAnimationAsset`; VBR is not decoded (the retained VBR fork is incomplete). It is listed under `unsupported`; `block-idle` and `block-idle-left` exist.
- Native blend trees, sync groups, warping (`Connect`/`TargetConnect` alignment, `StaticBlendWeight` 0.3), IK, procedural rig ops, foot planting and additive composition are not reproduced. Additive clips (`add-*`: JumpLanding x3, Stand_HitReact x4, StandIdle loop) keep source local deltas; their composition order is unverified.
- `Battle_Hero_Intro_Vader_MP` uses the `3P_Cutscene` layout; its Spine translation moves up to 5.2 cm (reported as a warning). Strike V2, closer and dodge clips animate Spine1/Spine2 offsets by about 1 cm (source data).
- Some victim death clips put a toe up to 23 cm below the source ground plane (they hand over to ragdoll; see the ANT `Physics.Active`/`FullRagdoll` tags).
- Gameplay windows come from the first graph usage of each clip; clips reused by several sequences (for example `strike-to-idle`) keep all usages in `clips.json` `graph[]`.
- Vader clips not requested were not exported: GetUp (40 directional variants), Blinded/Electrocuted/Gas/Pain status loops, Sprint_HitReact (12), Run_Fidget additives, HeadAim/Look/BlockTorsoAdjust additive poses.

## GLB conventions (for the runtime)

- Node names are exactly the `stormtrooper.glb` skin-0 joint names (248 nodes, same parents and rest TRS); every animated node also exists in `vader.glb`. Tracks bind by name (`clipForModel`); a three.js AnimationMixer moves the bones on both models.
- Removed from tracks: AITrajectory translation (root motion), scalar foot channels, unmapped DOFs, `Left/RightAnkleEffectorAux` (not in the skeleton). Duplicate Spine DOFs are deduplicated (identical for raw; within 2e-3 for DCT). Quaternions are normalized and hemisphere-continuous. The AITrajectory rotation is retained (constant -90 deg yaw, as in the existing rifle clips). Storage is lossless: constant tracks use two keys and byte-identical accessors are shared.
- `extras` per animation: `source`, `sourceControllerKey`, `sourceAnimationKey`, `codec`, `fps`, `timeScale`, `trimOffset`, `trimmedDuration`, `duration`, `ticksPerSecondAssumed`, `additive` (+`additiveNote`), `loop` (name heuristic), `rootMotion` {`space`, `origin` (absolute AITrajectory translation at t=0, for example the 0.8 m choke lift), `end`, `pathLength`, `sourceDistance`, and when moving `t`/`p` (relative xyz) and `yaw`}, `hitWindow` [start, end] seconds plus `hitWindows`/`hitWindowTicks`/`hitWindowSource`, `branchWindows`, `transitions` (combo windows with `AttackType` value and target node), `unstaggerable`, `currentAbility`, `triggerAffectorEnum`, `dodgeDirection`, `sequence` (native follow-up clip schedule), `antTags`, `graphController`/`graphNodes`/`timeline`, `skippedChannels`, `deduplicatedChannels`.
- Root-motion space: source model space, +Y up, +Z character forward, +X character left. Apply the model's own rotation (the runtime uses rotationY = PI). Victim lift clips need `origin + p` (or the runtime lift), otherwise they play at ground level.

## Gameplay windows (strikes)

Seconds on the strike clip timeline (60 ticks/s inferred). Combo windows are the authored transition windows on the sequence timeline.

| id | graph node | hit window s (ticks) | combo window s: AttackType=2 -> / =1 -> | Evade / Ability / Movement from (s) | follow-up clip starts at (blend) | root end z (m) |
|---|---|---|---|---|---|---:|
| `strike1` | Vader_Strike_1 | 0.250-0.417 (15-25) | 0.483-1.667 Vader_Strike_2 ; 0.483-1.667 Vader_Closer_2 | 0.433 / 0.483 / 0.600 | 0.733 (0.183) | 1.80 |
| `strike1-v2` | Vader_Strike1_V2 | 0.250-0.417 (15-25) | 0.533-1.667 Vader_Strike_2_V2 ; 0.533-1.667 Vader_Closer_2 | 0.467 / 0.533 / 0.633 | 0.733 (0.767) | 2.07 |
| `strike2` | Vader_Strike_2 | 0.250-0.417 (15-25) | 0.550-1.667 Vader_Strike_3 ; 0.550-1.667 Vader_Closer_3 | 0.483 / 0.550 / 0.617 | 0.733 (0.167) | 1.87 |
| `strike2-v2` | Vader_Strike_2_V2 | 0.250-0.417 (15-25) | 0.517-1.667 Vader_Strike_3_V2 ; 0.517-1.667 Vader_Closer_3 | 0.483 / 0.517 / 0.633 | 0.733 (0.683) | 1.89 |
| `strike3` | Vader_Strike_3 | 0.250-0.417 (15-25) | 0.517-1.667 Vader_Strike_4 ; 0.517-1.667 Vader_Closer_1 | 0.450 / 0.517 / 0.617 | 0.733 (0.767) | 1.86 |
| `strike3-v2` | Vader_Strike_3_V2 | 0.250-0.417 (15-25) | 0.500-1.667 Vader_Strike_4_V2 ; 0.500-1.667 Vader_Closer_2 | 0.450 / 0.500 / 0.617 | 0.733 (0.767) | 1.88 |
| `strike4` | Vader_Strike_4 | 0.250-0.417 (15-25) | 0.517-1.667 Vader_Strike_5 ; 0.517-1.667 Vader_Closer_3 | 0.483 / 0.517 / 0.617 | 0.733 (0.683) | 1.81 |
| `strike4-v2` | Vader_Strike_4_V2 | 0.250-0.417 (15-25) | 0.667-1.667 Vader_Strike_5_V2 ; 0.667-1.667 Vader_Closer_1 | 0.600 / 0.667 / 0.733 | 0.733 (0.683) | 2.01 |
| `strike5` | Vader_Strike_5 | 0.250-0.417 (15-25) | 0.517-1.667 Vader_Strike_6 ; 0.517-1.667 Vader_Closer_2 | 0.467 / 0.517 / 0.617 | 0.733 (0.683) | 1.66 |
| `strike5-v2` | Vader_Strike_5_V2 | 0.250-0.417 (15-25) | 0.517-1.667 Vader_Strike_6_V2 ; 0.517-1.667 Vader_Closer_2 | 0.467 / 0.517 / 0.617 | 0.733 (0.683) | 2.08 |
| `strike6` | Vader_Strike_6 | 0.250-0.417 (15-25) | 0.583-1.667 Vader_Strike1_V2 ; 0.583-1.667 Vader_Closer_1 | 0.533 / 0.583 / 0.667 | 0.733 (0.767) | 1.89 |
| `strike6-v2` | Vader_Strike_6_V2 | 0.250-0.417 (15-25) | 0.800-1.667 Vader_Strike_1 ; 0.800-1.667 Vader_Closer_3 | 0.750 / 0.800 / 0.833 | 0.733 (0.683) | 1.96 |
| `closer1` | Vader_Closer_1 | 0.433-0.600 (25-35) | 0.667-1.233 Vader_Strike1_V2, Vader_Strike_1, Vader_Strike_4, Vader_Strike_6_V2 ; 0.667-1.217 Vader_Closer_2, Vader_Closer_3 | 0.600 / 0.667 / 0.700 | - | 5.50 |
| `closer2` | Vader_Closer_2 | 0.450-0.617 (25-35) | 0.950-1.700 Vader_Strike1_V2, Vader_Strike_1 ; 0.950-1.700 Vader_Closer_3 | 0.867 / 0.950 / 0.983 | - | 5.51 |
| `closer3` | Vader_Closer_3 | 0.417-0.583 (25-35) | 0.800-1.667 Vader_Strike1_V2, Vader_Strike_1 ; 0.800-1.667 Vader_Closer_1 | 0.783 / 0.800 / 0.833 | - | 5.39 |
| `air-attack` | A.Vader.InAirSaberAttack.SEQ.Player0 | 0.167-0.667 (10-40) | - ; - | 0.667 / 0.883 / 0.067 | - | 0.00 |

## Clip table

Vader clips in vader-animations.glb. Root end is the AITrajectory displacement at clip end (x = character left, z = forward).

| id | source controller | codec | keys | seconds | root end x,y,z (m) | hit window (s) | notes |
|---|---|---|---:|---:|---|---|---|
| `idle` | L_Vader_Stand_IdleLoop_01 | raw | 389 | 12.933 | 0 |  |  |
| `idle-fidget-1` | L_Vader_Stand_Idle_Fidget_01 | raw | 36 | 1.167 | 0 |  |  |
| `idle-fidget-2` | L_Vader_Stand_Idle_Fidget_02 | raw | 31 | 1.000 | 0 |  |  |
| `idle-fidget-3` | L_Vader_Stand_Idle_Fidget_03 | raw | 36 | 1.167 | 0 |  |  |
| `walk-fwd` | C_Vader_Stand_Walk_Fwd_01 | raw | 58 | 1.900 | 0.00, 0.00, 5.09 |  |  |
| `walk-fwdleft` | C_Vader_Stand_Walk_FwdLeft_01 | raw | 58 | 1.900 | 3.27, 0.00, 3.27 |  |  |
| `walk-fwdright` | C_Vader_Stand_Walk_FwdRight_01 | raw | 58 | 1.900 | -3.27, 0.00, 3.27 |  |  |
| `walk-bwd` | C_Vader_Stand_Walk_Bwd_01 | raw | 58 | 1.583 | 0.00, 0.00, -3.80 |  | TS=0.6 |
| `walk-bwdleft` | C_Vader_Stand_Walk_BwdLeft_01 | raw | 58 | 1.600 | 2.69, 0.00, -2.69 |  | TS=0.5938 |
| `walk-bwdright` | C_Vader_Stand_Walk_BwdRight_01 | raw | 58 | 1.600 | -2.69, 0.00, -2.69 |  | TS=0.5938 |
| `walk-left1` | C_Vader_Stand_Walk_Left1_01 | raw | 58 | 1.767 | 4.28, 0.00, 0.00 |  | TS=0.5377 |
| `walk-left2` | C_Vader_Stand_Walk_Left2_01 | raw | 58 | 1.767 | 4.28, 0.00, 0.00 |  | TS=0.5377 |
| `walk-right1` | C_Vader_Stand_Walk_Right1_01 | raw | 58 | 1.767 | -4.28, 0.00, 0.00 |  | TS=0.5377 |
| `walk-right2` | C_Vader_Stand_Walk_Right2_01 | raw | 58 | 1.783 | -4.27, 0.00, 0.00 |  | TS=0.5325 |
| `run-fwd` | C_Vader_Stand_Run_Fwd_03 | raw | 48 | 1.567 | 0.00, 0.00, 6.22 |  |  |
| `run-fwdleft` | C_Vader_Stand_Run_FwdLeft_01 | raw | 48 | 1.567 | 4.40, 0.00, 4.40 |  |  |
| `run-fwdright` | C_Vader_Stand_Run_FwdRight_01 | raw | 48 | 1.567 | -4.40, 0.00, 4.40 |  |  |
| `run-bwd` | C_Vader_Stand_Run_Bwd_01 | dct | 42 | 1.567 | 0.00, 0.00, -5.01 |  |  |
| `run-bwdleft` | C_Vader_Stand_Run_BwdLeft_01 | raw | 48 | 1.567 | 3.54, 0.00, -3.54 |  |  |
| `run-bwdright` | C_Vader_Stand_Run_BwdRight_01 | raw | 48 | 1.567 | -3.54, 0.00, -3.54 |  |  |
| `run-left1` | C_Vader_Stand_Run_Left1_01 | dct | 42 | 1.567 | 4.70, 0.00, 0.00 |  |  |
| `run-left2` | C_Vader_Stand_Run_Left2_01 | dct | 42 | 1.567 | 4.70, 0.00, 0.00 |  |  |
| `run-right1` | C_Vader_Stand_Run_Right1_01 | dct | 42 | 1.567 | -4.70, 0.00, 0.00 |  |  |
| `run-right2` | C_Vader_Stand_Run_Right2_01 | dct | 42 | 1.567 | -4.70, 0.00, 0.00 |  |  |
| `sprint` | C_Vader_Stand_Sprint_Fwd_03 | raw | 41 | 1.333 | 0.00, 0.00, 8.77 |  |  |
| `turn-left` | C_Vader_StandTurn_Left_01 | raw | 40 | 1.300 | 0 |  |  |
| `turn-right` | C_Vader_StandTurn_Right_01 | raw | 31 | 1.000 | 0 |  |  |
| `run-stop` | T_Vader_RunFwdToStop_01 | raw | 16 | 0.500 | 0 |  |  |
| `tiny-steps` | C_Vader_Stand_TinySteps_01 | dct | 51 | 1.900 | 0 |  |  |
| `block-idle` | L_Vader_Stand_Idle_Block_01 | raw | 91 | 3.000 | 0 |  |  |
| `block-idle-left` | L_Vader_Stand_Idle_Block_Left_01 | raw | 40 | 1.300 | 0 |  |  |
| `block-walk-fwd` | C_Vader_Stand_Walk_Blocking_Fwd_01 | raw | 58 | 1.900 | 0.00, 0.00, 4.75 |  |  |
| `block-walk-fwdleft` | C_Vader_Stand_Walk_Blocking_FwdLeft_01 | raw | 58 | 1.900 | 3.36, 0.00, 3.36 |  |  |
| `block-walk-fwdright` | C_Vader_Stand_Walk_Blocking_FwdRight_01 | raw | 58 | 1.900 | -3.36, 0.00, 3.36 |  |  |
| `block-walk-bwd` | C_Vader_Stand_Walk_Blocking_Bwd_01 | raw | 58 | 1.600 | 0.00, 0.00, -3.80 |  | TS=0.5938 |
| `block-walk-bwdleft` | C_Vader_Stand_Walk_Blocking_BwdLeft_01 | raw | 58 | 1.583 | 2.69, 0.00, -2.69 |  | TS=0.6 |
| `block-walk-bwdright` | C_Vader_Stand_Walk_Blocking_BwdRight_01 | raw | 58 | 1.583 | -2.69, 0.00, -2.69 |  | TS=0.6 |
| `block-walk-left1` | C_Vader_Stand_Walk_Blocking_Left1_01 | raw | 58 | 1.767 | 4.28, 0.00, 0.00 |  | TS=0.5377 |
| `block-walk-left2` | C_Vader_Stand_Walk_Blocking_Left2_01 | raw | 58 | 1.767 | 4.28, 0.00, 0.00 |  | TS=0.5377 |
| `block-walk-right1` | C_Vader_Stand_Walk_Blocking_Right1_01 | raw | 58 | 1.767 | -4.28, 0.00, 0.00 |  | TS=0.5377 |
| `block-walk-right2` | C_Vader_Stand_Walk_Blocking_Right2_01 | raw | 58 | 1.767 | -4.28, 0.00, 0.00 |  | TS=0.5377 |
| `block-tiny-steps` | C_Vader_Stand_TinySteps_Blocking_01 | raw | 58 | 1.900 | 0 |  |  |
| `block-run-stop` | T_Vader_RunFwdToStop_Blocking_01 | raw | 21 | 0.550 | 0 |  | TS=0.6 |
| `block-stagger-1` | A_Vader_Block_Stagger_01 | raw | 21 | 0.667 | 0.00, 0.00, -1.83 |  |  |
| `block-stagger-2` | A_Vader_Block_Stagger_02 | raw | 21 | 0.667 | 0.00, 0.00, -1.83 |  |  |
| `block-stagger-3` | A_Vader_Block_Stagger_03 | raw | 21 | 0.667 | 0.00, 0.00, -1.83 |  |  |
| `block-swing-left-1` | A_Vader_Stand_Block_SwingLeft_01 | dct | 45 | 1.217 | 0 |  | TS=0.6857 |
| `block-swing-left-2` | A_Vader_Stand_Block_SwingLeft_02 | dct | 45 | 1.217 | 0 |  | TS=0.6857 |
| `block-swing-left-3` | A_Vader_Stand_Block_SwingLeft_03 | dct | 45 | 1.217 | 0 |  | TS=0.6857 |
| `block-swing-left-4` | A_Vader_Stand_Block_SwingLeft_04 | dct | 45 | 1.217 | 0 |  | TS=0.6857 |
| `block-swing-right-1` | A_Vader_Stand_Block_SwingRight_01 | dct | 45 | 1.217 | 0 |  | TS=0.6857 |
| `block-swing-right-2` | A_Vader_Stand_Block_SwingRight_02 | dct | 45 | 1.217 | 0 |  | TS=0.6857 |
| `block-swing-right-4` | A_Vader_Stand_Block_SwingRight_04 | dct | 45 | 1.217 | 0 |  | TS=0.6857 |
| `antispam-loop` | C_Vader_AntispamLoop_01 | dct | 54 | 2.000 | 0 |  |  |
| `antispam-loop-block` | C_Vader_AntispamLoop_Blocking_01 | dct | 54 | 2.000 | 0 |  |  |
| `strike1` | A_Vader_AttackLoop_Strike1 | raw | 45 | 1.467 | 0.00, 0.00, 1.80 | 0.250-0.417 |  |
| `strike1-v2` | A_Vader_AttackLoop_Strike1_V2 | raw | 46 | 1.500 | 0.00, 0.00, 2.07 | 0.250-0.417 |  |
| `strike1-end` | A_Vader_AttackLoop_Strike1_BackToIdle | raw | 66 | 2.167 | 0.00, 0.00, -0.17 |  |  |
| `strike1-v2-end` | A_Vader_AttackLoop_Strike1_V2_BackToIdle | raw | 61 | 2.000 | 0 |  |  |
| `strike2` | A_Vader_AttackLoop_Strike2 | raw | 45 | 1.467 | 0.00, 0.00, 1.87 | 0.250-0.417 |  |
| `strike2-v2` | A_Vader_AttackLoop_Strike2_V2 | raw | 46 | 1.500 | 0.00, 0.00, 1.89 | 0.250-0.417 |  |
| `strike2-end` | A_Vader_AttackLoop_Strike2_BackToIdle | raw | 61 | 2.000 | 0 |  |  |
| `strike2-v2-end` | A_Vader_AttackLoop_Strike2_V2_BackToIdle | raw | 66 | 2.167 | 0 |  |  |
| `strike3` | A_Vader_AttackLoop_Strike3 | raw | 46 | 1.500 | 0.00, 0.00, 1.86 | 0.250-0.417 |  |
| `strike3-v2` | A_Vader_AttackLoop_Strike3_V2 | raw | 46 | 1.500 | 0.00, 0.00, 1.88 | 0.250-0.417 |  |
| `strike3-end` | A_Vader_AttackLoop_Strike3_BackToIdle | raw | 61 | 2.000 | 0 |  |  |
| `strike3-v2-end` | A_Vader_AttackLoop_Strike3_V2_BackToIdle | raw | 66 | 2.167 | 0 |  |  |
| `strike4` | A_Vader_AttackLoop_Strike4 | raw | 51 | 1.667 | 0.00, 0.00, 1.81 | 0.250-0.417 |  |
| `strike4-v2` | A_Vader_AttackLoop_Strike4_V2 | raw | 46 | 1.500 | 0.00, 0.00, 2.01 | 0.250-0.417 |  |
| `strike4-end` | A_Vader_AttackLoop_Strike4_BackToIdle | raw | 66 | 2.167 | 0 |  |  |
| `strike4-v2-end` | A_Vader_AttackLoop_Strike4_V2_BackToIdle | raw | 61 | 2.000 | 0 |  |  |
| `strike5` | A_Vader_AttackLoop_Strike5 | raw | 46 | 1.500 | 0.00, 0.00, 1.66 | 0.250-0.417 |  |
| `strike5-v2` | A_Vader_AttackLoop_Strike5_V2 | raw | 46 | 1.500 | 0.00, 0.00, 2.08 | 0.250-0.417 |  |
| `strike5-end` | A_Vader_AttackLoop_Strike5_BackToIdle | raw | 66 | 2.167 | 0 |  |  |
| `strike5-v2-end` | A_Vader_AttackLoop_Strike5_V2_BackToIdle | raw | 61 | 2.000 | 0 |  |  |
| `strike6` | A_Vader_AttackLoop_Strike6 | raw | 46 | 1.500 | 0.00, 0.00, 1.89 | 0.250-0.417 |  |
| `strike6-v2` | A_Vader_AttackLoop_Strike6_V2 | raw | 46 | 1.500 | 0.00, 0.00, 1.96 | 0.250-0.417 |  |
| `strike6-end` | A_Vader_AttackLoop_Strike6_BackToIdle | raw | 66 | 2.167 | 0 |  |  |
| `strike6-v2-end` | A_Vader_AttackLoop_Strike6_V2_BackToIdle | raw | 51 | 1.667 | 0 |  |  |
| `closer1` | A_Vader_Idle_Closer_To_AttackPose1_To_Idle | raw | 71 | 2.333 | 0.00, 0.00, 5.50 | 0.433-0.600 |  |
| `closer2` | A_Vader_AttackPose1_Closer_To_AttackPose2_To_Idle | raw | 86 | 2.833 | 0.00, 0.00, 5.51 | 0.450-0.617 |  |
| `closer3` | A_Vader_AttackPose2_Closer_To_AttackPose3_To_Idle | raw | 71 | 2.333 | 0.00, 0.00, 5.39 | 0.417-0.583 |  |
| `strike-to-idle` | Vader_Strike_To_IdleHelper | raw | 39 | 1.250 | 0 |  |  |
| `air-attack` | A_Vader_Jump_SaberAttack_Light_FH_01 | dct | 37 | 1.017 | 0 | 0.167-0.667 | TS=0.6 |
| `attack-blocked-1` | A_Vader_LightAttack_Blocked_01 | dct | 27 | 0.750 | 0 |  | TS=0.53 |
| `attack-blocked-2` | A_Vader_LightAttack_Blocked_02 | dct | 27 | 0.750 | 0 |  |  |
| `attack-blocked-3` | A_Vader_LightAttack_Blocked_03 | dct | 27 | 0.767 | 0 |  | TS=0.53 |
| `attack-blocked-4` | A_Vader_LightAttack_Blocked_04 | dct | 27 | 0.750 | 0 |  | TS=0.5816 |
| `attack-blocked-5` | A_Vader_LightAttack_Blocked_05 | dct | 28 | 0.750 | 0 |  | TS=0.5392 |
| `attack-blocked-6` | A_Vader_LightAttack_Blocked_06 | dct | 28 | 0.767 | 0 |  | TS=0.4576 |
| `choke-enter` | A_Vader_ForceChoke_Enter_01 | raw | 31 | 1.000 | 0.00, 0.00, 0.33 |  |  |
| `choke-loop` | A_Vader_ForceChoke_Loop_01 | raw | 101 | 3.333 | 0 |  |  |
| `throw-fwd` | A_Vader_Stand_ThrowSaber_FwdFacing_02 | dct | 46 | 1.650 | 0 |  |  |
| `throw-up` | A_Vader_Stand_ThrowSaber_UpFacing_02 | dct | 46 | 1.650 | 0 |  |  |
| `throw-down` | A_Vader_Stand_ThrowSaber_DwnFacing_02 | dct | 46 | 1.650 | 0 |  |  |
| `catch` | A_Vader_Stand_CatchSaber_02 | dct | 72 | 2.317 | 0 |  |  |
| `rage` | A_Vader_RagePowerUp_01 | raw | 91 | 3.000 | 0.00, 0.00, 0.46 |  |  |
| `dodge-front` | A_Vader_Dodge_Front_01 | raw | 51 | 1.667 | 0.00, 0.00, 3.80 |  |  |
| `dodge-back` | A_Vader_Dodge_Back_01 | raw | 51 | 1.667 | 0.00, 0.00, -3.85 |  |  |
| `dodge-left` | A_Vader_Dodge_Left_01 | raw | 51 | 1.667 | 3.98, 0.00, 0.10 |  |  |
| `dodge-right` | A_Vader_Dodge_Right_01 | raw | 51 | 1.667 | -3.85, 0.00, 0.00 |  |  |
| `jump-fwd` | A_Vader_Jump_Fwd_01 | dct | 32 | 0.950 | -0.00, 1.39, 1.08 |  |  |
| `jump-loop` | L_Vader_Jump_Fwd_02 | dct | 153 | 5.767 | 0 |  |  |
| `in-air` | L_Vader_InAir_Low_01 | dct | 36 | 0.667 | 0 |  | TS=1 |
| `add-land-run` | Add_Vader_JumpLanding_Run_01 | dct | 18 | 0.667 | 0 |  | additive |
| `add-land-stand-1` | Add_Vader_JumpLanding_Stand_01 | dct | 23 | 0.700 | 0 |  | additive TS=0.5455 |
| `add-land-stand-2` | Add_Vader_JumpLanding_Stand_02 | dct | 23 | 0.767 | 0 |  | additive TS=0.5455 |
| `add-hit-front` | A_Vader_Stand_HitReact_Front1 | dct | 24 | 0.750 | 0 |  | additive |
| `add-hit-back` | A_Vader_Stand_HitReact_Back1 | dct | 27 | 0.850 | 0 |  | additive |
| `add-hit-left` | A_Vader_Stand_HitReact_Left1 | dct | 24 | 0.683 | 0 |  | additive |
| `add-hit-right` | A_Vader_Stand_HitReact_Right1 | dct | 31 | 0.750 | 0 |  | additive |
| `stagger-fwd` | A_Vader_Stagger_Fwd_01 | raw | 52 | 1.683 | 0.00, 0.00, -1.94 |  |  |
| `stagger-fwd-2` | A_Vader_Stagger_Fwd_02 | raw | 53 | 1.733 | 0.00, 0.00, -2.13 |  |  |
| `stagger-fwd-3` | A_Vader_Stagger_Fwd_03 | raw | 53 | 1.733 | 0.06, 0.00, -2.01 |  |  |
| `stagger-bwd` | A_Vader_Stagger_Bwd_01 | raw | 63 | 2.067 | 0.00, 0.00, 2.11 |  |  |
| `stagger-bwd-2` | A_Vader_Stagger_Bwd_02 | raw | 67 | 2.200 | 0.00, 0.00, 2.17 |  |  |
| `stagger-bwd-3` | A_Vader_Stagger_Bwd_03 | raw | 56 | 1.833 | 0.00, 0.00, 1.87 |  |  |
| `death` | A_Vader_Defeated_01 | dct | 212 | 7.517 | 0 |  |  |
| `death-in-air` | L_Vader_DefeatedInAir_Low_01 | dct | 36 | 0.667 | 0 |  | TS=1 |
| `intro` | Battle_Hero_Intro_Vader_MP | raw | 93 | 6.167 | -0.05, 0.00, 0.38 |  |  |
| `emote-1` | E_Vader_01 | raw | 91 | 6.000 | 0 |  |  |
| `emote-1-apology` | E_Vader_01_Apology | raw | 83 | 3.667 | 0 |  |  |
| `emote-2` | E_Vader_02 | raw | 38 | 2.500 | 0 |  |  |
| `emote-2-hide` | E_Vader_02_Hide | raw | 136 | 6.000 | 0 |  |  |
| `emote-3` | E_Vader_03 | raw | 86 | 5.667 | 0 |  |  |
| `emote-3-clumsy` | E_Vader_03_Clumsy | raw | 113 | 5.000 | 0 |  |  |
| `emote-4-disturbing` | E_Vader_04_Disturbing | raw | 110 | 4.833 | 0 |  |  |
| `add-idle` | Add_Vader_StandIdle_Loop_01 | dct | 242 | 9.133 | 0 |  | additive |

Victim clips in hm-hero-reactions.glb.

| id | source controller | codec | keys | seconds | root end x,y,z (m) | hit window (s) | notes |
|---|---|---|---:|---:|---|---|---|
| `choke-enter` | A_HM_Rifle_Stunned_ForceChoke_Enter_PhysCtrl_01_new | dct | 36 | 1.333 | 0.00, 0.63, 0.00 |  |  |
| `choke-enter-2` | A_HM_Rifle_Stunned_ForceChoke_Enter_PhysCtrl_02 | dct | 36 | 1.333 | 0.00, 0.80, 0.00 |  |  |
| `choke-enter-3` | A_HM_Rifle_Stunned_ForceChoke_Enter_PhysCtrl_03 | dct | 36 | 1.333 | 0.00, 0.80, 0.00 |  |  |
| `choke-enter-4` | A_HM_Rifle_Stunned_ForceChoke_Enter_PhysCtrl_04 | dct | 36 | 1.333 | 0.00, 0.80, 0.00 |  |  |
| `choke-loop` | A_HM_Rifle_Stunned_ForceChoke_Loop_PhysCtrl_01 | dct | 86 | 3.233 | 0 |  |  |
| `choke-loop-2` | A_HM_Rifle_Stunned_ForceChoke_Loop_PhysCtrl_02 | dct | 86 | 3.233 | 0 |  |  |
| `choke-loop-3` | A_HM_Rifle_Stunned_ForceChoke_Loop_PhysCtrl_03 | dct | 99 | 3.733 | 0 |  |  |
| `choke-loop-4` | A_HM_Rifle_Stunned_ForceChoke_Loop_PhysCtrl_04 | dct | 94 | 3.533 | 0 |  |  |
| `choke-enter-hipslift` | A_HM_Rifle_Stunned_ForceChoke_Enter_01 | raw | 26 | 1.667 | 0 |  |  |
| `choke-loop-hipslift` | A_HM_Rifle_Stunned_ForceChoke_Loop_01 | raw | 49 | 3.233 | 0 |  |  |
| `choke-exit-alive` | A_HM_Rifle_Stunned_ForceChoke_ExitAlive_01 | raw | 33 | 2.167 | 0 |  |  |
| `choke-death` | A_HM_Rifle_Stand_ChokeDeath_Still_01 | dct | 150 | 5.667 | 0.00, 0.92, 0.00 |  |  |
| `choke-death-2` | A_HM_Rifle_Stand_ChokeDeath_Still_02 | dct | 142 | 5.333 | 0.00, 1.33, 0.00 |  |  |
| `choke-death-3` | A_HM_Rifle_Stand_ChokeDeath_Still_03 | dct | 133 | 5.000 | 0.00, 0.97, 0.00 |  |  |
| `choke-death-4` | A_HM_Rifle_Stand_ChokeDeath_Still_04 | dct | 133 | 5.000 | 0.00, 1.11, 0.00 |  |  |
| `saber-death-fwd` | A_HM_Death_Stand_LightSaber_Fwd_01 | dct | 40 | 1.133 | 0 |  | TS=0.45 |
| `saber-death-fwd-2` | A_HM_Death_Stand_LightSaber_Fwd_02 | dct | 48 | 1.200 | 0 |  |  |
| `saber-death-fwd-3` | A_HM_Death_Stand_LightSaber_Fwd_03 | dct | 32 | 0.933 | 0 |  |  |
| `saber-death-fwd-4` | A_HM_Death_Stand_LightSaber_Fwd_04 | dct | 40 | 1.117 | 0 |  |  |
| `saber-death-fwd-5` | A_HM_Death_Stand_LightSaber_Fwd_05 | dct | 40 | 0.983 | 0 |  |  |
| `saber-death-bwd` | A_HM_Death_Stand_LightSaber_Bwd_01 | dct | 48 | 1.300 | 0 |  |  |
| `saber-death-bwd-2` | A_HM_Death_Stand_LightSaber_Bwd_02 | dct | 48 | 1.200 | 0 |  | TS=0.55 |
| `saber-death-left` | A_HM_Death_Stand_LightSaber_Left_01 | dct | 56 | 1.533 | 0 |  |  |
| `saber-death-left-2` | A_HM_Death_Stand_LightSaber_Left_02 | dct | 40 | 1.167 | 0 |  |  |
| `saber-death-right` | A_HM_Death_Stand_LightSaber_Right_01 | dct | 40 | 1.083 | 0 |  |  |
| `saber-death-right-2` | A_HM_Death_Stand_LightSaber_Right_02 | dct | 40 | 0.967 | 0 |  |  |
| `push-death-fwd` | A_HM_Death_Stand_ForcePush_Fwd_01 | dct | 56 | 1.433 | 0 |  | TS=0.5588 |
| `push-death-fwd-2` | A_HM_Death_Stand_ForcePush_Fwd_02 | dct | 40 | 1.100 | 0 |  |  |
| `push-death-fwd-3` | A_HM_Death_Stand_ForcePush_Fwd_03 | dct | 42 | 1.267 | 0 |  |  |
| `push-death-fwd-4` | A_HM_Death_Stand_ForcePush_Fwd_04 | dct | 48 | 1.267 | 0 |  |  |
| `push-death-fwd-5` | A_HM_Death_Stand_ForcePush_Fwd_05 | dct | 42 | 1.250 | 0 |  |  |
| `push-death-fwd-6` | A_HM_Death_Stand_ForcePush_Fwd_06 | dct | 40 | 1.167 | 0 |  |  |
| `push-death-fwd-7` | A_HM_Death_Stand_ForcePush_Fwd_07 | dct | 39 | 1.133 | 0 |  |  |
| `push-death-bwd` | A_HM_Death_Stand_ForcePush_Bwd_01 | dct | 42 | 1.167 | 0 |  |  |
| `push-death-bwd-2` | A_HM_Death_Stand_ForcePush_Bwd_02 | dct | 40 | 1.083 | 0 |  |  |
| `push-death-bwd-3` | A_HM_Death_Stand_ForcePush_Bwd_03 | dct | 31 | 0.867 | 0 |  | TS=0.4904 |
| `push-death-left` | A_HM_Death_Stand_ForcePush_Left_01 | dct | 34 | 1.100 | 0 |  |  |
| `push-death-left-2` | A_HM_Death_Stand_ForcePush_Left_02 | dct | 39 | 0.983 | 0 |  |  |
| `push-death-right` | A_HM_Death_Stand_ForcePush_Right_01 | dct | 36 | 1.067 | 0 |  |  |
| `push-death-right-2` | A_HM_Death_Stand_ForcePush_Right_02 | dct | 33 | 1.067 | 0 |  |  |
