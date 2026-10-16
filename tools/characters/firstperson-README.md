# Selected Death Star first-person weapons

`BF2-FIRSTPERSON-ASSETS-001` traces the selected faction unlocks to their actual `WeaponStateData1p.WeaponMesh1p` and appearance `FirstPersonBundles`. The browser assets are described by `web/public/assets/firstperson-weapons.json`; existing third-person/faction manifests are preserved.

| Team / weapon | Actual first-person components | LOD0 vertices |
| --- | --- | ---: |
| Imperial / E11 | `d_assault_orig_01_1p_upperbody_mesh` and `e11_1p_mesh` | 6,125 + 7,885 |
| Rebel / A280 | `l_assault_orig_ds_01_1p_upperbody_mesh`, `hands_01_1p_mesh`, `a280_mesh1p_mesh` | 2,659 + 2,412 + 16,585 |

The first-person bodies use the distinct 141-bone `Characters/Rigs/Humanoids/Walrus_HumanMale_1p`. This is neither the full-body mesh nor the full-body rig. Source upperbody parts have `RenderIn1p=true`; lowerbody is retained as a reference but is not included in these foreground viewmodels.

`BF2-FIRSTPERSON-POSE-001` decodes the existing retained common ANT bank's `FrameAnimationAsset` poses `P_1p_E11_IdlePose`, `P_1p_E11_SprintPose`, `P_1p_A280_IdlePose`, and `P_1p_A280_SprintPose`. Their 142 source channels are 85 quaternion and 57 padded Vec3 records. All 140 named channels map through `Walrus_1p_HM_Rig`; two unnamed Vec3 records are `[1,1,1]`. Quaternion norm error stays below 0.00000021. Source byte ranges and full channel values are retained in `exports/firstperson-animation/poses.json`.

The assembled models already carry the source idle pose and source camera-relative placement. Load their manifest URLs and attach each GLTF scene to the camera with identity translation/rotation and scale 1. The animations are named `idle` and `sprint`. They are single-frame source poses represented as constant one-second tracks for mixer compatibility, not recovered one-second movements. Blending between them is a browser presentation choice. No grip offsets should be added.

Assembly attaches the weapon `Wep_Root` beneath the same `SpineX` parent observed in the first-person human rig. Both the weapon and arms receive identical named source DOFs; their `Wep_Root` and `Wep_Muzzle` world transforms coincide numerically. A wrapper converts the inverse source idle `CameraJoint` into the renderer's -Z camera convention. This attachment and convention are corroborated static reconstruction inferences, not observed native execution. The observed shared `DefaultFirstPersonCamera.Offset=(0,-1.70043,-0.7718)` remains separately recorded; its native composition is unresolved and is not added speculatively.

Both final GLBs pass the Khronos validator with zero errors. Remaining warnings concern generated tangent space (E11: 4; A280: 2). Materials use source textures selected by exact MeshSet hash/LOD/section bindings; full Frostbite shader parity and scope lenses remain unresolved. Some hands retain the strongest four of eight source weights (maximum discarded total 0.0901961). DCT firing/deploy/zoom, procedural IK, moving sprint, native camera motion and blend graph execution remain unsupported.

Reproduce from the retained extraction:

```powershell
python tools/characters/firstperson-decode-poses.py
node tools/characters/firstperson-assemble.mjs E11
node tools/characters/firstperson-assemble.mjs A280
node tools/bf2-extract/validate-glb.cjs web/public/assets/firstperson/firstperson-e11.glb exports/firstperson-e11-validation.json web/public/assets
node tools/bf2-extract/validate-glb.cjs web/public/assets/firstperson/firstperson-a280.glb exports/firstperson-a280-validation.json web/public/assets
python tools/characters/firstperson-provenance.py
node --test web/test/firstperson-assets.test.js
```

The four tests verify retained source hashes and references, compare every decoded sample directly with original ANT byte ranges, validate pose/texture/GLB artifacts, and independently evaluate assembled hierarchy/socket positions. Source geometry, skeletons and all original eight-weight arrays are in `exports/firstperson-geometry`; materials and conversion inputs are in the matching `exports/firstperson-*` folders. The E11 geometry/texture exports are reused from earlier recovery without modification.
