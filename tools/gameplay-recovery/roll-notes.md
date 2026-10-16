# Recovered rifle roll assets

`EV-ROLL-GRAPH-20261015-01` binds the installed Assault kit, its default combat-roll ability, character slot 47, the rifle branch, four directional clips, trajectory tracks, channel tags and transition conditions. `EV-ROLL-ANIM-20261015-01` decodes the four selected RawAnimationAsset records against Walrus_HM_Rig. Neither evidence record claims native runtime observation.

Rebuild:

```powershell
node tools/gameplay-recovery/roll-recover.mjs
python tools/characters/roll-decode.py
cd web
node --test test/roll-assets.test.js
```

The generated files are `web/public/assets/roll-graph.json` and `web/public/assets/roll-clips.json`. The latter is approximately 2.1 MB and contains complete body bone samples, raw sample clocks, source-local trajectory curves, source channel tags, source hashes and selected bank byte ranges. Existing character GLBs remain unchanged.

| Direction | ANT source controller | Raw keys | Graph sequence length | Trajectory at tick 52 | Final trajectory |
| --- | --- | ---: | ---: | --- | --- |
| Front | A_HM_Rifle_Dodge_Front_01 | 42 | 88 | z=4.20816135 | z=4.66916227 |
| Left | A_HM_Rifle_Dodge_Left_01 | 48 | 80 | x=4.74111366 | x=4.77587271 |
| Right | A_HM_Rifle_Dodge_Right_01 | 98 | 168 | x=-4.68657064 | x=-4.759153 |
| Back | A_HM_Rifle_Dodge_Back_01 | 75 | 106 | z=-4.046323 | z=-4.695894 |

Coordinates and distances are source-local world units. The browser must transform directions and pass incremental displacement through its collision controller. The source controller also has ProjectedDistance=4, AdjustDirection=true, SteerAnimatableFactor=0.2, Weights=[1,0,1] and DriveAcceleration=true. These fields do not establish the native steering or compensation formulas. Applying the authored trajectory directly is an adaptation.

All four directions use the same gameplay timing tags, despite different sequence tails:

- Unstaggerable is true from tick 0 through a 40-tick interval. This does not establish damage invulnerability.
- IntoAir.Branch starts at tick 40, Evade.Branch at 50 and Ability.Branch at 51.
- Movement.Branch starts at tick 52. The transition back to locomotion additionally requires CloseToGround2 and InputFwdOrSide.
- End.3P.Branch starts at tick 78. Its locomotion transition additionally requires CloseToGround2.
- CurrentAbility is set to 17 for 78 ticks. The ability asset requires this channel value to remain active.
- The defensive-move node enables BlockZoom, disables foot planting and temporarily enables OverridePoseToStand. Full tag reset modes are retained.

Consequently, the entire sequence length is not a grounded gameplay lockout duration. The relevant unmodified return point is tick 78; grounded movement can return at tick 52. Other death, stagger, ability, air and defensive-move transition conditions are preserved in `roll-graph.json`.

The seconds conversion is unresolved. Each raw ANT controller has FPS=30, but no recovered evaluator establishes that this is the EBX graph tick rate. All four satisfy `TrimmedDuration / TimeScale = EBX Length` within floating-point tolerance. This supports the inferred pose sampling relation `sampleFrame = TrimOffset + graphTick * TimeScale`. It does not establish graph ticks per second. The source AITrajectory translation and exported physics trajectory are not identical; the adapter removes the former so they cannot be applied twice. Native motion compensation remains unresolved.

`web/src/roll-clip-adapter.js` exports:

```js
createRollAnimationClip(model, sourceClip, { graphTicksPerSecond });
// Returns { clip: THREE.AnimationClip, report }.
sampleRollTrajectory(sourceClip, graphTick);
// Returns [x,y,z] in source-local coordinates.
```

The animation adapter requires an explicit positive clock. It interpolates trim boundaries, normalizes quaternion interpolation, verifies duplicate bone DOFs, binds every matching source bone in merged actor components and removes AITrajectory translation. No native seconds default is provided. If a provisional browser roll duration is needed, choose it explicitly and label it as an adaptation; map its full grounded interval to ticks 0..78, instead of stretching every direction's complete sequence to that duration. For a chosen `durationSeconds`, `graphTicksPerSecond = 78 / durationSeconds`. Stop or blend out the animation at the gameplay exit tick, even though the returned clip contains the remaining source tail.

SoldierRigType enum values are 1P=0, 3P=1, AI=2, Mount=3 and LivingWorld=4. The base body clip is 3P. Every AI override selects the same underlying body animation. The 1P overrides select other clips; first-person arm animations are not emitted here.

The installed ability has RechargeTime=4, TriggerCost=0.5, RechargeOnRetriggerCountZero=true, RetriggerCount=0, ActiveTime=0.1 and CharacterStateDrivesActiveTime=true. Its activation writes DefensiveMove=true; RequiredForActive checks CurrentAbility=17. The time field 0.1 is therefore not a justified roll duration. Neither a normalized maximum charge of 1 nor a particular continuous/per-charge regeneration formula is established by these fields. Treat two charges or a 2-second recharge per charge as an inference until native ability evaluation is recovered.

Validation passes four tests: every EBX observation resolves against its hashed source; the bank and selected object slices hash correctly; decoded bone samples match source byte positions through DOF permutations; and all four clips bind and advance on both installed actor skeleton hierarchies without applying root translation. This validates the converter and binding, not native timing, gameplay behavior or visual parity.
