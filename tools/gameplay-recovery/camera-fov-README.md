# Selected camera FOV

The selected base E11/A280 gameplay zoom angles are **vertical degrees**, 55 unzoomed and 23.9 zoomed with explicit user scale 1. `WeaponZoomLevelData.RenderFov` is a separate source layer, 55 at both indices; its renderer composition is still being traced and is not applied by this helper.

This conclusion follows native consumers, not field names alone. The aiming path reads `ZoomLevelData.FieldOfView` at +0x28 and sends its selected source FOV transition to camera manager virtual +0x38. That dispatches through the selected camera's virtual +0x30 setter to its FOV transition state. The camera getter at virtual +0x38 supplies the effective angle to the frustum writer, which converts degrees by π/180. `0x14024ada0` calls the imported `tanf` on half that angle and uses the result alone in the Y planes and times aspect in the X planes. The same getter reaches renderer preparation: `0x140960d00` adds a separate camera FOV offset and stores radians at camera+0x1f18; `0x1409678e0` submits it with separate aspect through the renderer view update.

The original transition is also recovered. `0x1409f83a0` evaluates `(Shape+1)*t^Shape-Shape*t^(Shape+1)` in the selected non-inverted Smooth branch. Shape 2 gives `3*t²-2*t³`. Source start delay, start jump, end-early and FOV delay are zero; FOV and zoom transition times are both 0.2 seconds. `0x1409faec0` samples elapsed/duration before adding dt and blends start/target degrees with that weight. Native timing frequency is not established.

User scale is clamped to 0.8–2 by `0x140b96e20`. The gameplay source allows scaling. Hip FOV scales regardless of the `FieldOfViewScaleADS` profile toggle; aiming scaling requires it. The zoom-entry request uses at least a factor of 1. Actual user settings are not read by this reconstruction; the helper explicitly defaults scale to 1.

`web/src/camera-fov.js` exports:

- `resolveSourceCameraFov(document, weaponId, {sourceGuid})` for guarded source values/provenance.
- `createSourceCameraFov(document, weaponId, options)` with `update(dt,{aiming})`, `reset({aiming})` and `snapshot()`. Options support `initialAiming`, `userScale`, `scaleADS` and optional source identity. Snapshot `.fov` is vertical degrees.
- `nativeFovTransitionWeight` and `sourceFovTarget` for independently checked source equations.

Integration: load `/assets/camera-fov.json` with the real faction assets, create one helper for the local player's selected weapon, and replace the provisional `lerp(...,dt*15)` with the helper's returned FOV. Use its snapshot value directly in `THREE.PerspectiveCamera.fov`; aspect remains the viewport aspect. Reset on round/life reset as desired. The helper restarts an interrupted transition from the displayed value using the source duration; this policy is explicit reconstruction because native reversal adjusts remaining timers. Do not apply its gameplay aiming value to a future separately recovered weapon render projection.

Reproduce: `python tools/gameplay-recovery/camera-fov-build.py`. It verifies 27 EBX observations, exact native metadata/vtable/import bytes and 19 retained consumer functions. Tests: `node --test test/camera-fov.test.js` from `web`. No native game execution or GPU browser profiling is performed.
