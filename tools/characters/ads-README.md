# Recovered first-person rifle aim poses

`BF2-FIRSTPERSON-ADS-001` recovers six selected source clips from the retained common ANT bank. It does not add offsets to make the rifles appear centered.

Build and validate from the repository root:

```powershell
python tools/characters/ads-recover.py
node tools/characters/ads-pose-check.mjs
python tools/characters/ads-phases.py
node --test web/test/firstperson-ads.test.js
```

New deliverables:

- `web/public/assets/firstperson-ads.json`: source poses, source sample times, local quaternion/translation channels, source timing fields, mask, provenance and limitations.
- `web/src/firstperson-ads.js`: pure clip adapter; no shared runtime imports or modifications.
- `exports/firstperson-ads/evidence.json`: exact retained graph records, selected enum routes and hashed original bank ranges.
- `exports/firstperson-ads/*.source.json`, `*.python.f32`, `*.reference.f32`: all four DCT transition inputs and byte-identical independent decoder results.
- `exports/firstperson-ads/cpu-pose-check.json`: CPU results using the actual recovered GLBs, source rig hierarchy and GLTFLoader metadata.

## Selection evidence

`SpecificWeapon.EnumGS` (`a4126ad0a5adbce4`) refers to `SpecificWeapon.Enum` (`ae246dda461c1791`). The latter is zero-based sequential; its values explicitly label E11 as 17 and A280 as 28. These positions in each `Wep.ZoomPose.Index`, `Wep.ZoomIn.Index`, and `Wep.ZoomOut.Index` choose:

| Weapon | Steady pose | Enter | Exit |
|---|---|---|---|
| E11 | P_1p_E11_ZoomPose_02 | A_1p_E11_zoomIn_02 | A_1p_E11_zoomOut_02 |
| A280 | P_1p_A280_ZoomPose | A_1p_A280_ZoomIn | A_1p_A280_ZoomOut |

`1P.Actions.SF` (`fe03b295e4783abc`) contains source ZoomIn, IronSight and ZoomOut nodes. Their subjects are the corresponding `1P.MasterZoom*.Layer`. IronSight requires `Game.Character.Zoom.Bool` true; ZoomOut requires it false. The first layer entry is the selected zoom clip (through a speed-scale controller for transitions). The second entry preserves the selected idle pose through `IdlePose.NonAttachments.WeaponParts.BML`. Its only nonzero mask channels are the rotation and translation of Wep_Bipod1, Wep_Bipod2 and Wep_Bipod3, each with weight 1. The adapter uses those exact six idle channels.

Both shipped SoldierWeaponData records have `AnimBaseSet=wabsRif`. Their actual `WeaponStates[0].Weapon` AntRef identities are retained. Those weapon-specific assembler objects are absent from this common bank, so their runtime write to SpecificWeapon.EnumGS is not claimed as observed. Selection within the shared graph is exact; executing the entire native graph remains outside this recovery.

## Integration contract

```js
import {createFirstPersonAimClips} from './firstperson-ads.js';
const aim = createFirstPersonAimClips(clonedViewmodelRoot, adsDocument, weaponId);
// weaponId is 'primary' or 'rebel-a280'.
const action = existingSharedMixer.clipAction(aim.pose.clip);
```

The adapter returns `{pose, enter, exit, policy, weaponId, specificWeaponEnum}`. Each role contains `{clip, sourceName, sourceAnimationKey, sourceTrim, sourceTiming, constant, boundTracks, missing}`. All clips are non-additive and have duration **1 phase unit**, including the constant pose. A mixer advancing them in seconds is an application policy, not a recovered native time equation. `sourceTiming` retains FPS and TimeScale; `sourceTrim` retains the source trim start and span. E11 exit begins at source key time 3.5, so its boundary is sampled between source frames 3 and 4. All other transitions begin at 0. No channel is resampled to a fabricated fixed frame rate.

Use the existing shared AnimationMixer. The generated track paths match GLTFLoader's unique node names, so they share bindings with idle, sprint and additive firing. All duplicate source joints are bound through `userData.sourceBoneIndex` and canonical `userData.name`. E11 yields 200 bound tracks per clip; A280 yields 340; none are missing. Do not make a separate mixer or use the canonical duplicate bone name as a binding path.

For the smallest source-backed integration, select the steady pose while aiming and blend between the existing idle and recovered aim poses under an explicitly reconstructed timing policy. Keep firing additive on top of the selected base. Exit sprint before entering aim. The adapter does not implement the action state machine, death behavior, input reversal, crossfades or playback seconds; these remain the caller's responsibility. In particular, an action paused at a phase cannot advance a fade in Three, so transition policy must account for that lifecycle.

The complete source enter/exit clips are also available. Their endpoints do **not** all match the static poses exactly. With the actual assembled GLBs, muzzle differences are:

| Boundary | E11 | A280 |
|---|---:|---:|
| Idle → enter first sample | 0.000342 m | 0.010660 m |
| Enter last sample → steady aim | 0.000059 m | 0.057584 m |
| Steady aim → trimmed exit first sample | 0.075262 m | 0.073376 m |
| Exit last sample → idle | 0.000130 m | 0.000179 m |

These are observed source/data-to-browser results, not reasons to alter source transforms. Native state blends, tag windows and procedural evaluation may resolve them, but that complete composition has not been executed. A browser transition that handles them must identify its blend as reconstructed.

## CPU observations

The steady aim pose moves the source muzzle from X=0.111293 m (E11) / 0.079659 m (A280) to within one micrometer of the camera centerline. No translation correction is added. CameraJoint position remains the same within 1e-12 m; the E11 rotation is unchanged and A280 differs by 1.38e-6 radians due to its actual source pose quaternion. The existing idle-derived camera conversion is therefore sufficient for these steady source poses. This does not establish native procedural camera composition during transitions.

Five focused tests verify the full bank hash and retained ranges, actual graph routes, every published DCT sample against the independent decoder output, actual GLTF duplicate bindings and static camera behavior, trim-phase sampling, source idle mask preservation and complete phase tag ancestry. These are CPU tests; no hardware GPU or original-game execution is claimed.

The source DCT decoder reference is the retained AssetBankPlugin implementation under GPL-3.0; license and source remain in `tools/characters/assetbank-reference`. The Python decoder reuse is GPL-3.0-or-later as declared in its own source. Independent decoder agreement corroborates the codec, not native runtime blending or timing.

## Bounded blend and phase follow-up

`ads-phases.py` additionally writes `exports/firstperson-ads/phases.json`, containing 106 source records, 17 outgoing transitions and 13 incoming transitions in the same `1P.Actions.SF`. It re-reads the original REF2 layouts to follow **all** inherited bases: the earlier bank inventory stopped after one level and therefore omitted TimelineTag/TimelinePointTag fields below Branch and GameStateTagAsset. All retained records have independently checked original byte ranges. Public clips and runtime policy are unchanged by this follow-up.

Observed normal path:

| Transition | Source blend | Source branch selector |
|---|---|---|
| Movement → ZoomIn | AccelBlend, BlendTime=8 | None |
| ZoomIn → IronSight | BezierBlend, BlendTime=4, 20 exact sample floats | Extra.1P.Branch |
| IronSight → ZoomOut | AccelBlend, **BlendTime=0** | None |
| ZoomOut → Movement | BezierBlend, BlendTime=20, 20 exact sample floats | Extra.1P.Branch |

Both weapon enter clips have an Extra.1P.Branch tag with StartLinkOffset=28 and EndLinkOffset=2, and an End.1P.Branch tag with StartLinkOffset=0/EndLinkOffset=30. Their animation TrimmedDuration/TimeScale is also 30. The corresponding exit Extra tag fields are 50/3 for E11 and 63/3 for A280; End tag fields are 0/54 and 0/66. E11's TrimmedDuration/TimeScale=53 differs from its End-tag field 54; no single equality or seconds equation is generalized from these values. All these tags carry LinkFlags=32, StartLinkUpdates=0, and serialized Active=false. Their native runtime activation and link-flag evaluation are still unobserved.

ZoomOut has two ordered transitions back to ZoomIn. Both use a BezierBlend with BlendTime=4 and BranchInPhase=2. The first requires zoom and ZoomTimer.Bool, with DestinationPhase≈0.9; the second requires zoom alone, with DestinationPhase≈0.2. ZoomOut's BoolGameStateTag sets ZoomTimer=true with StartLinkOffset=0, EndLinkOffset=10, ResetOnLeave=1. These source records establish distinct reversal choices; they do not establish the numeric phase enum's execution semantics.

ZoomIn's EnableSpineX.Float tag retains eleven exact samples from 0 through 1, StartLinkOffset=0/EndLinkOffset=10. IronSight retains a constant [1] sample. ZoomIn also retains WeaponLagWeight.Float=[1] and a descending 16-byte SP.WindPoseStrength curve; ZoomOut has its ascending counterpart. Their full procedural consumers are not recovered here. In particular, the static-pose-to-exit discrepancy cannot honestly be attributed to a nonzero transition blend: the selected IronSight→ZoomOut override explicitly has BlendTime=0.

BlendTime, link offsets and samples remain source data. Converting them to seconds, interpreting BranchInPhase/LinkFlags, executing the sampled Bezier curves, or folding the procedural tags into a pose requires further evaluator evidence. The steady-pose integration remains the bounded supported change.
