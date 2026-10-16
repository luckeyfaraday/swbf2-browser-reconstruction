# Original GaussianSimple bloom

The selected Death Star II interior tonemap uses `BloomMethod_GaussianSimple`, `BloomDirection_None`, `BloomSoftClip 0`, `GaussianSharpness 0.5` and `BloomScale (0.075, 0.11, 0.115)`. The runtime is `web/src/source-bloom.js`; `source-exposure.js` builds it from the composited HDR scene each frame and `source-colorgrading-renderer.js` adds it inside the native Tonemap step. Evidence: `exports/lighting/native-bloom/evidence.json` (`BF2-NATIVE-BLOOM-001`), shader witnesses `exports/lighting/native-bloom-shaders` (`BF2-NATIVE-BLOOM-SHADERS-001`), WARP execution `exports/lighting/native-bloom-warp` (`BF2-NATIVE-BLOOM-WARP-001`) and the browser comparison `web/test/source-bloom-gpu-check.mjs` (`BF2-NATIVE-BLOOM-GPU-001`).

## Observed

- **Settings.** The interior `TonemapComponentData` (`internal:26`) serializes the values above; the gamewide component also uses GaussianSimple with sharpness 0.5. PostProcess constructor `142deb960` stores `BloomEnable 1`, `BloomTestEnable 0`, `QuarterDownsamplingEnable 0`, `BlurPyramidEnable 1`, `BlurPyramidHdrEnable 1`, `BlurPyramidFastHdrEnable 1` (instruction bytes at `142debe11..25`; offsets from the field descriptors at `144df1fe8..`). `ForceBloomScale` defaults to `(-1,-1,-1)` (not forced).
- **Blackboard.** `140d984b0` fills `BloomBlackboardData` (`140d67c80`): method = tonemap `BloomMethod` (clamped to 0..2), direction, clamp, soft clip, scale = tonemap `BloomScale` unless forced, enable = `BloomEnable` and a non-zero scale; the Gaussian path additionally requires `BlurPyramidEnable`. The source handle is the current scene colour.
- **Selection.** `14155a9a0`: direction 0 → Gaussian builder `14155d910`; 1/2 → directional `14155d2c0` (passes `DirectionalDownsample`, `DirectionalBlur`); FFT is method 2 (`14155c280`).
- **Levels.** `141569670`: level 0 is `(W>>1, H>>1)`, halved to 1×1; the number used is `min(levelCount, floor(log2 H) - 1, 15)` (8 levels at 1280×720, 9 at 1080p). Format `0x1a` (fast HDR) maps to DXGI 26 `R11G11B10_FLOAT` through `1415ae210`.
- **Weights.** `141561810(L, GaussianSharpness)`: for level `i`, `a = 2^i/2^L`, `b = 2^(i+1)/2^L`, `w_i = 0.1·Σ_{k<10} powf(1−t,2)·powf(2·max(1−sharpness,0.01), 20t)` with `t = a + k(b−a)·0.1`, normalized; entries ≥ L are zero. Constants at `14301a310/143012f68/14301a308/143032f58/14302cd24`; `powf` is the original CRT import (same thunk as the PQ lookup).
- **Upsample.** `14155d910`: the smallest level is a `Texture2dBlend` (`Tex2d`, texture·colour): `up[L−1] = w[L−1]·mip(L)`. Every larger level is a `GaussianBloom` pass (`1415563a0` → `drawTwoTexture2dBlend` `14158c070` → `Tex2dDouble`): `up[i] = w[i]·mip(i+1) + up[i+1]` with linear/clamp samplers (the pyramid LOD clamped to `i+1`). The bloom output is `up[0]`.
- **Pyramid kernel.** `GaussianPyramidCs` builds each mip from the previous one at half size: a separable Gaussian with `exp2(−d²·0.180337) = exp(−d²/8)` (σ = 2 source texels), 12 taps from `2·dst−5`, centred at `(dst+0.5)·src/dst`, normalized. Horizontal taps are six bilinear pairs, vertical taps are discrete groupshared rows. The permutation key (`141444d10`) is srcArray, dstArray, robustEdge, horizontallyAligned (source width even), verticallyAligned (source height even), convolveAlpha.
- **Tonemap.** The unchanged Tonemap PS computes `color = main + bloomScale·tonemapBloomTexture` before `colorScale` (exposure) and the vignette, then PQ and the cube. `BloomSoftClip 0` selects `bloomSoftClipping=0`, the same bytecode as the grading witness (`81cd1d7f…`).

## Witness results

D3D11 WARP runs the unchanged bytecode on a synthetic 160×90 HDR image (5 levels, aligned and unaligned sizes). The pyramid model reproduces native mips to ≤2.2e-6 relative once the horizontal pairs use 8-bit bilinear fractions (exact weights leave ≤1.6e-3, which is the hardware filtering, not the kernel). Native `R11G11B10_FLOAT` writes **truncate** toward zero; with truncation the browser chain is bit-exact on the AMD GPU (14,280/14,280 codes) and within one code on the RTX 3050 (bilinear rounding differences). The production configuration (half-float mips) stays within two codes. The Tonemap combine agrees within 1.7e-5 (AMD) / 9e-4 (NVIDIA) in PQ.

## Inferred / not reproduced

- The scene-colour mips are taken from the composited HDR scene used for metering; the blur-pyramid producer ordering relative to transparency is untraced. Their native storage format is untraced (the browser uses half float).
- The `tonemapBloomTexture` sampler descriptor is untraced; bilinear/clamp is used like the other postprocess inputs.
- The `robustEdge` permutation, selected for levels at or beyond the threshold at pyramid data `+0xc8` (untraced), treats borders differently; none of clamp, mirror, zero or renormalized edges reproduce it. The browser uses the non-robust kernel everywhere, so screen-edge texels of small levels may differ.
- Directional and FFT bloom are not reconstructed (not selected by this map).

## Cost

24 small passes per frame at 1280×720 (two pyramid passes and one upsample per level). In a same-session A/B at spawn: RTX 3050 63.4 → 62.3 FPS (+0.3 ms main thread), integrated Radeon 22.0 → 21.5 FPS. Runtime toggle: `window.battlefront.renderOptions({bloom:false})`.
