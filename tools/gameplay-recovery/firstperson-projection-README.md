# Selected first-person render FOV

The selected E11 and A280 both serialize `WeaponZoomLevelData.RenderFov=55` at both ordered zoom indices. These are separate from gameplay `ZoomLevelData.FieldOfView=55/23.9`. The native render-FOV getter and model-state submission are now traced. The final renderer matrix consumer is not established.

`0x14167d3d0` reads the selected weapon zoom entry at +0x44. `0x14169af70` calls it for the active local first-person soldier, with a separate optional user-scale blend. User scale 1 preserves 55. `0x141697450` gets this result through Soldier virtual +0x3c8 and passes it to `0x140d4f6b0`. That setter constructs `ModelDynamicState`, writes `RenderFovDeg` at +0x30 and change bit 0x8000 at +0x38, and submits it through renderer-manager virtual +0x18. Reflection metadata identifies the packet type and also its independent `IsFirstPerson` field at +0x3f.

The active manager constructor installs vtable 0x14331f0a8; its +0x18 slot is the adjusting thunk `0x140e9a320`, which reaches `0x140f2c790`. This chooses the model's current buffered state and applies changed fields through `0x142d4db40`, including the +0x30 value when bit 0x8000 is present. This supports independent per-model FOV metadata. It does not establish a separate native camera, render pass, first-person clipping plane, depth bias, or FOV axis. The source-array initial copy into the weapon instance is also outside the retained trace; its native getter, source references, and matching field layout are retained separately.

The browser helper applies a per-material clip-space XY correction inside the existing render pass. It computes a 55-degree perspective matrix and divides its X/Y projection coefficients by the world camera's coefficients, then multiplies only `gl_Position.xy` after Three's normal skinning/project chunk. World projection, camera transform, Z/W, lighting, exposure, and recovered source rig transforms are preserved. This avoids an additional exposure render pass. The internal camera is a CPU matrix calculator, not an assertion about native renderer architecture.

Vertical weapon projection is explicitly **inferred from the recovered world-camera convention**; the selected RenderFov numeric values and model-state bridge are observed configuration/static native evidence. World near/far and existing depth behavior are reconstruction choices. The helper supports user scale 1 and symmetric perspective; native off-axis/jitter and user-scale composition are unresolved. It adds no camera or animation recoil.

Integration:

```js
import {createFirstPersonProjection} from './firstperson-projection.js';
const projection=createFirstPersonProjection(document,weaponId,{sourceGuid});
projection.bind(viewmodel.root);
// After updating the existing world camera FOV/projection:
projection.update(camera,{aiming});
// Before replacing the viewmodel:
projection.dispose();
```

Load `/assets/firstperson-projection.json` with actual faction assets. `resolveFirstPersonProjection` returns null for an unknown ID or supplied mismatched source GUID. Fixture assets retain their existing projection. `bind()` clones only the selected viewmodel materials, preserves earlier shader hooks, and disables their world-frustum culling; world ADS23.9 culling would otherwise discard geometry visible under RenderFov55. `dispose()` restores original materials and culling flags. No scene, runtime, loader, or shared manifest was edited by this package.

Reproduce evidence/config with `python tools/gameplay-recovery/firstperson-projection-build.py`. Run `node --test test/firstperson-projection.test.js` from `web`: five CPU tests verify retained source/native bytes, source guards, actual E11/A280 skinned vertex projection through ADS and moving camera parents, viewport resizing, shader-hook/material isolation, culling and disposal. GPU shader compilation and native runtime rendering were not observed in this bounded task.
