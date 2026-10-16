# Character extraction checkpoint

## Observations

- **CHAR-GEO-001**: `exports/characters/converted/*.ebx.json` retain source EBX names, SHA-1, GUID and MeshSet resource IDs. Actual stormtrooper body 9,890 vertices, helmet 2,254 vertices; Death Star rebel body 8,408 vertices, Hakan head 2,840, headgear 1,433, hands 1,244. All are source LOD1. Actual E11 first-person mesh is LOD0, 7,885 vertices.
- **CHAR-SKIN-001**: `*.skin.json` retains source LocalPose / ModelPose / hierarchy / procedural bones and all eight skin influences. SWBF2 direct bone indices and bit15 procedural-index mapping follows Frosty MeshSetPlugin exporter source. All weighted joints are in range. Global local poses agree with source ModelPose within 0.000003. A duplicate-source-joint issue was corrected by merging equal joint influences; the resulting three assembled GLBs have zero Khronos errors and warnings.
- **CHAR-VARIANT-001**: `exports/characters/rebel-unlock` and `rebel-variant` demonstrate Death Star rebel `MPVUR_L_Assault_Orig_DS_01` DefaultSkin 727287318 refers to skin1_hakan and actual Hands_01 / Headgear_05 / Heads_Hakan_01. No invented soldier or helmet geometry is used.
- **CHAR-ANT-001**: `exports/characters/ant-skirmish/0.res` is the selected 29,891,249-byte skirmish ANT resource, not a whole-game dump. SHA-256 and every parsed section recorded in `bank-inventory.json`. `inspect-ant.py` validates self-relative tagged pointers and bounds for all 346 DAT2 objects: 102 frame, 238 raw, 6 VBR. Array ranges and base AnimationAsset metadata are recovered; names are hashed `.chan` identifiers.

## Inferences and limitations

- Walrus_HumanMale and WeaponSke01 selected from source skeleton inventory. Their model/local pose agreement and all valid weighted bone indices corroborate association; weapon blueprint association and camera offsets still need runtime comparison.
- Source actors face +Z in bind space; manifest rotates pi about Y to match runtime -Z forward. This needs visual comparison.
- 54 rebel hand vertices have over four skin influences. Browser GLB retains strongest four, normalized; maximum discarded source weight 0.14902. All original influences remain in `.skin.json`.
- Exact shaderblock MeshSetNameHash/LOD/section texture mapping now covers eleven of thirteen component materials. Eye/E11 lens remain unresolved. Packed tangent normals currently reconstructed from actual triangles; Khronos reports three generated tangent warnings per actor, two for E11, zero errors.
- **CHAR-ANIM-002**: Actual rifle standing and running raw ANT clips are now bound in both final actors. `ant-common-bank/0.res` (305,752,448 bytes) contains 94,751 DAT2 objects and 357 REF2 classes. `decode-animation.py` resolves modern UInt32 DOF IDs through Walrus_HM_Rig RigDofSets / DofSetIdIndices / DofIds into exact LayoutAsset slot names, then reverses source channel permutation. Variable and constant Vec3 records occupy four floats. All run channels mapped, quaternion norm errors below 0.000001. Four standing pose non-body channels unresolved. Duplicate Spine DOFs contain identical data and are deduplicated.
- Source standing and run local transforms pass CPU anatomical position sanity checks. Source AITrajectory translation is removed for runtime in-place control; original values remain in raw-clips.json. Clip time uses KeyTimes/FPS; controller TimeScale semantics and the complete native graph remain unverified. Additive idle was decoded but not bound. Procedural rig/IK and firing/death clips remain unimplemented. Do not claim complete native animation parity.

## Reproduction

1. Build `tools/characters/build.ps1` (pinned historical adapter and SDK).
2. Run `character-extract.exe` with explicit `--runtime`, `--work`, `--game`, `--out`, `--id`, `--name`, optional `--skeleton`, `--lod`. Existing cache: `tools/bf2-extract/work`.
3. `tools/characters/assemble.ps1` binds source skin and assembles geometry. It rewrites component GLBs, so apply materials after this step.
4. After material injection, rerun only `merge-character.mjs` to combine component GLBs. It preserves per-component source/material provenance and rigs.
5. `python tools/characters/decode-animation.py` decodes selected raw clips from retained common bank.
6. `node tools/characters/attach-animations.mjs MODEL exports/characters/animation-selected/raw-clips.json` appends clips to the freshly merged actor. It deliberately rejects already animated inputs; do not rebuild components during material/animation work.
7. `node tools/bf2-extract/validate-glb.cjs MODEL REPORT web/public/assets` runs Khronos validation including shared texture files. Both final actors and E11 pass zero errors.

`web/public/assets/characters.json` is ready for the runtime; material and animation limitations are explicit. Complete merged actor files are stormtrooper.glb and rebel.glb. Components remain alongside them for material injection.

## Next

- Perform browser/native visual checks, verify source forward/weapon camera placement, and attach actual source weapons to actor hand sockets.
- Complete native timing/blending evidence, source additive-idle composition, DCT firing/death/procedural rig recovery.
- Narrow E11 firing sound recovery requested by root; actor GLBs are checkpointed and must be preserved.

Research reference: [AssetBankPlugin](https://github.com/marv7000/AssetBankPlugin) identifies raw/frame/DCT codecs but its current SectionRef2 is empty and it does not list BF2 support. It was inspected as a format reference, not installed as a working BF2 exporter. The small source checkout is retained under `tools/characters/assetbank-reference` with its GPL-3.0 license.
