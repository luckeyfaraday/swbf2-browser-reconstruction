# Selected rifle scope visibility

Evidence: `BF2-FIRSTPERSON-SCOPE-VISIBILITY-NATIVE-001` in
`exports/firstperson-scope-native/visibility-evidence.json`. These are static
executable/serialized-asset observations, not a capture of the original game.

The original A280 firstperson lens is an opaque physical material. In the
assembled original GLB, `scope_mat` has 17 vertices and 72 indices. The selected
source material is `fd844fe5-6161-4934-82b8-1946cea8b0e8`; its shader asset is
`Shaders/Presets/Walrus/SS_WeaponPreset_Lens_Parallax`, GUID
`f9c8f151-1549-48d3-b4fa-2e20a154390a`, name hash 782193471. The recovered RVM
programs are in `exports/materials/firstperson-lens-shader`: deferred pixel
program `1db8d08d9c` writes opaque GBuffer data, while forward program
`c6ba0ba6f3` outputs alpha 1. Cosmetic parallax does not make the lens a window
onto the scene. The lens shader has not been ported here.

## The native switch

Both selected E11 and A280 reference the same physical mesh for `Mesh` and
`MeshZoom`. That does not require the zoom model to remain visible.

`0x141683340` reads the selected `WeaponZoomLevelData` transition override
array at +0x20, falling back to `WeaponStateData.ZoomMeshTransitionFactor`
at +0x68. A one-element array selects element 0. With multiple elements,
the element is `(cameraZoomIndex == 0)`.

For a local actor, the zoom mesh selection is:

```
(fraction >= threshold && currentWeaponLevel.UseWeaponMeshZoom1p)
|| (fraction < threshold && cameraZoomIndex != 0
    && cameraWeaponZoomEntryExists && cameraLevel.UseWeaponMeshZoom1p)
```

A zoom model handle must also exist. The key instructions at
`1416834ed..1416834f9` compute
`firstpersonMask = !(zoomMeshSelected && transitionOverridePresent)`.
The mask gates **both** normal and zoom weapon model handles, at
`141683548` and `14168357a`, before the renderer calls. It also ANDs the
output body visibility byte. The caller `0x141697450` submits that byte as
a ModelDynamicState change with bit 0x200. This is the original mechanism
which removes the opaque lens and arms while the scope HUD is active.

Both selected shared aiming levels, including hip level 0, have
`UseWeaponMeshZoom1p=true`. E11 has transition arrays `[.5]` / `[.5]`, and
A280 `[.1]` / `[.2]`. Therefore selected local ADS hides immediately;
zoom-out restores the model only when the fraction is **less than** .5
(E11) or .1 (A280). With both flags true, the native camera/weapon index
scheduling distinction cannot change this selected result.

The source zoom timer is separate from the FOV curve. `0x1416a38b0` uses
the selected `ZoomTransitionTime=.2`, reverses the remaining time while
preserving the fraction for 0↔1 changes, and then decrements it by dt.
`0x1416a4500` returns `1-remaining/duration` when zooming and
`remaining/duration` when returning to hip. Zero remaining returns exactly
1 or 0. The standalone driver implements this selected two-level path.

`SocketData.HideByZoomTransition` is an independent attachment predicate.
It is not part of `Animated1pOnlyWeaponBinding`, whose separate ANT
`HideWeapon1p` channel has not been followed through its entire graph.

## Integration

Load `/assets/firstperson-scope-visibility.json` and use
`createSourceFirstpersonVisibility(document, weaponId, {sourceGuid})` from
`web/src/firstperson-scope-visibility.js`. Each simulation step calls
`update(dt,{aiming,alive})`. The assembled weapon+arms root can use
`bodyVisible` for these two selected rifles. Call `reset()` on spawn/reset.
The helper does not change material transparency, animation clips, renderer
state, scope HUD state, or any shared runtime file.

The lower-level `evaluateSourceFirstpersonVisibility` retains distinct native
camera and weapon aiming indices. The browser driver supplies its accepted
aim state to both. This is an explicit reconstruction of inter-system input
delivery; the selected flags make its visibility result invariant to the
unresolved index ordering. Native frame scheduling is not claimed.

Scope HUD vector geometry, palette, fraction animation, glow and visual
effects are independent evidence owned by the scope-artwork recovery. A
scope state threshold or HUD alpha must not replace this mesh predicate.

## Validation

`python tools/characters/firstperson-scope-build.py` recreates the source
configuration and hashes the retained native function evidence.
`node --test test/firstperson-scope-visibility.test.js` from `web/` passes
five tests. They check exact source chain values, original machine-code
mask instructions, both directional thresholds and index invariance,
timer reversal/death/reset, and the actual original opaque GLB lens section.
