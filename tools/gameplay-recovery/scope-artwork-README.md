# Original rifle scope HUD artwork

`BF2-SCOPE-ARTWORK-001` recovers the selected rifle scope's five original vector assets, nine vector/repeat elements, exact screen/main-logic/weapon-prefab/interval-trigger graphs, and the shipped palette. It changes no shared browser UI, first-person visibility, or game state.

Reproduce from the repository root:

```powershell
python tools/gameplay-recovery/scope-artwork-recover.py
node tools/gameplay-recovery/scope-artwork-export.mjs
node --test web/test/scope-artwork.test.js
```

The original 26-asset scope closure is in `exports/firstperson-scope-overlay/ebx`. Two bounded supplementary exports retain `UI/Styles/Colors/UIColorPalette` in `exports/scope-artwork-palette` and `UI/InGame/Prefabs/PF_TriggerAtInterval` in `exports/scope-artwork-trigger`. The builder verifies and embeds their SHA256, file GUID, archive SHA1, names and exact numerical values. `/assets/scope-artwork.json` is the browser manifest. `exports/scope-artwork/*.svg` are CPU-generated portable artwork previews; their manifest states the explicit example state and limitations.

## Integration contract

`web/src/scope-artwork.js` is a pure adapter with no DOM, Three.js or shared-runtime dependency:

```js
const controls = evaluateScopeArtworkControls(document, {
  fraction,             // already-interpolated original UI scope fraction [0,1]
  outlineRandom,        // explicit sample in the source range [.18,.25]
  scannerRandom,        // explicit sample in the source range [.73,1]
  dispersionAngle,      // WSWeaponState.DispersionAngle
  smoothedDispersionAngle,
});
const result = buildScopeArtworkSvg(document, {
  // Native competing property writers are not silently prioritized here.
  elementValues: {
    ScopeOutline: {alpha: controls.outlineAlpha, paletteIndex: 22,
      glowWidth: controls.outlineGlowWidth.timeline},
    ScopeGlow: {alpha: controls.backgroundAlpha.timeline},
  },
  containerScale: interpolatedScaleXY,
  colorEncoding: 'linear-to-srgb',
  allowInferredCircularArcs: true,
});
// result.svg, result.omittedNativeFeatures, result.inferred
```

Element defaults remain at source `Alpha=0`. No model-hiding decision occurs in this helper. The caller owns weapon visibility, source UI fraction integration and native graph property priority. The exact source default state and complete connections remain accessible in `document.graphs`. `sourceScopeAssetSvg` exports one asset independently of screen state, and `scopePaletteRgb` returns unchanged source RGB.

## Authored geometry and placement

The screen and affected-by-dispersion container are 1920×1080 with center transform pivot `(0.5,0.5,0)`. ScopeOutline and ScopeGlow occupy that entire space, at zero offset and identity default transform. Their original point coordinates already center the aperture at `(960,540)`. There is no invented circle, replacement reticle or weapon offset.

- ScopeOutline: GUID `a8479841-f228-46ab-8370-7073d67f3051`, 12 corners, source width `0.3`, additive blend, default glow `1`.
- ScopeGlow: GUID `225627d6-2a7e-4689-a3e5-5a4120eaa87e`, outer rectangle and curved inner hole, 30 serialized triangulated points and 84 indices, alpha blend, default glow `48`, palette index `27`.
- Notch: GUID `ea175907-8e06-419d-b3e7-b12c326d7c13`, four original points and six indices. Five radial-repeat elements retain their original copies, spacing, angles and control links. Their native repetition algorithm is not replaced with a guessed layout.
- DualZoomOn/Off: GUIDs `daf8d555-3cd4-4028-aec1-d10702a1b636` and `21f4c5b2-7d79-49fb-8c11-01af80066473`; five shapes each, native 96×24, center anchor and `(0,410)` offset. Both default alpha zero. Their line's changing endpoint alpha is preserved as an SVG gradient.

All source path radii, corner types, colors, widths, triangulated colors/expansions/indices and element defaults remain copied unchanged. The optional SVG path adapter interprets **destination-corner radius as an incoming minor circular arc**, with sweep from path winding. Authored four-point dual-zoom circles and the outline's straight joins support this interpretation, but a native tessellator has not been executed. Opt-in is required. The serialized BG triangle mesh is retained independently and tested to preserve the center hole; it is not falsely described as the complete curved shader output.

## Graph controls

Property hashes here are **case-sensitive** DJB2-XOR (5381): `Alpha=0x0c426471`, `Color=0x0ca8c5f8`, `GlowWidth=0x58627190`, `DispersionAngle=0x29c841c6`. Shader-name hashing elsewhere being lowercase does not change these UI identifiers.

`PF_Hud_CrosshairScope_MainLogic` internal:5 is Linear/EaseOut, `UseVelocity=true`, with source velocity `6` when its condition is true and `8` when false; `UseRealTimeClock=false`. Its already-interpolated output is the scope fraction. The helper does not claim to execute the native interpolator clock or frame scheduling.

- Outline alpha = fraction × RandomFloat internal:13, range `[.18,.25]`.
- Scanner alpha = fraction × RandomFloat internal:14, range `[.73,1]`.
- The scope container becomes visible at fraction `>0`; the separate scope-state/trigger condition is strict `>float32(.95)`.
- The random nodes are triggered through `PF_TriggerAtInterval`: a `.01` `TimeDeltaType_World` DelayEntity loops through an EventGate. Its gate condition is fraction `>float32(.95)`. Native PRNG, seed, pending event behavior and scheduler quantization remain unresolved; this is an authored delay, not proof of an observed 100 Hz native update.
- Screen timeline external time is that same fraction. Curve internal:26 is linear `[0,1]→[0,.85]` and targets ScopeGlow Alpha through EntityTrack internal:32 and FloatTrack internal:35.
- Curve internal:27 is linear `[0,1]→[10,1]` and targets ScopeOutline GlowWidth through EntityTrack internal:31 and FloatTrack internal:36.
- Screen internal:48 computes `scale(1+DispersionAngle/10, 1+DispersionAngle/10, 1)`, then passes it through TransformInterpolator internal:16 (Expo/EaseOut, duration `.015`, not real-time clock) to the scope container. The source default/target scale differs from the interpolated output; callers supply the latter to render.
- A concurrent direct math connection drives outline GlowWidth with `lerpf(1,4,smoothedDispersionAngle)`. An external interface pin `0x3cf915c1` also drives ScopeGlow Alpha. Native priority between these direct writers and timeline animation remains unresolved. The helper returns competing outputs separately.

## Source palette and browser limits

The sole asset with “Palette” in its shipped name is `UI/Styles/Colors/UIColorPalette`, GUID `721d4169-9b94-11e6-8123-db097fe09c86`, in `win32/default_settings`. It has four runtime rows of 57 colors. All four rows agree for the scope's relevant indices:

| Index | Original RGB |
|---|---|
| 0 | `(1,1,1)` |
| 22 | `(.18447499,1,1)` |
| 24 | `(1,.658374846,.141263291)` |
| 27 | `(.009134059,.009134059,.009134059)` |

The screen PropertySelect internal:54 chooses color inputs from palette22 and24; its selected index comes from interface pin `0x54d0e8b2`. ScopeGlow directly uses palette27. The adapter requires an explicit browser color-encoding choice; `linear-to-srgb` is an adaptation, not a captured native UI shader result.

Native glow kernel, additive blending, viewport expansion, radial repetition, UI postprocessing and competing-writer precedence are reported as omissions. SVG opacity and rasterization are browser behavior. Do not describe these standalone previews as pixel-identical native screenshots. Model visibility recovery belongs to the separate native scope-switch investigation; artwork should be integrated only with that source-backed state.

Validation: four CPU tests verify original file hashes and every recovered numerical array/graph record; original filled-mesh aperture coverage; source arc endpoints/radii; shader-independent property-hash matches, source constants and curve links; strict `.95` boundary; palette identity across all four rows; preserved zero-alpha defaults; and explicit unsupported-feature reporting. No GPU/browser was started for this recovery.

The root's `web/src/scope-hud.js` integration was independently reviewed and its trigger scheduling corrected to the recovered graph. Five additional tests in `web/test/scope-hud.test.js` cover rise/fall, delayed threshold activation, source event-loop edges, reversal, pending-event behavior, tick partition determinism, death/reset cancellation, and DOM presentation. Its continuous simulation-time delay schedule and deterministic PRNG remain browser policy. Native closing the EventGate does not send a cancellation to the already-pending Delay, whose output still reaches RandomFloat; the adapter permits that final sample, while explicit death/reset cancels the browser loop. Rapid reopening keeps an existing delay under an explicitly inferred duplicate-event policy.
