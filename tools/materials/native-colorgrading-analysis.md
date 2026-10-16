# Original indoor grading and SDR conversion

The renderer uses the selected Death Star II interior LUT, baked by the unchanged original `ColorCubeInterpolateCS`, followed by the recovered HDR Tonemap and SDR MergeRenderPlanes equations. The runtime is `web/src/source-colorgrading-renderer.js`; `source-exposure.js` applies recovered exposure before grading. This is a static native-default SDR baseline, not a captured native frame.

## Source and selection

- Authored asset: `Levels/Lighting/DeathStar_02/T_CC_DeathStar_02_Indoor_01`, GUID `5080cf22-8f30-11e7-b378-a1eadebcd540`. Its 33³ RGB10A2 payload is 143,748 bytes, SHA256 `ef8c87b2bc53aa040088c3b65fdd6baef2e488ec72e3072602fcc98b2281d19b`. The selected interior color-correction component enables this LUT.
- Installed `Scripts/Game.cfg` enables HDR grading and display mapping. Native GameRenderSettings defaults select SDR peak 200, neutral shoulder 1 and brightness 1. `1414872a0` produces output conversion 1 and post-grade exposure `[0.5,1]` for this SDR baseline. `141488500` keeps render planes enabled with the default AutoDisable setting.
- `140f5b9a0` → `140f42080` → `140f41480` selects size 33 and native format 27 for default quality 1 when supported. `1415ae210` maps format 27 to DXGI RGB10A2. Unsupported-format fallback is RGBA8; this reconstruction uses the supported RGB10A2 baseline.
- Original compute shader SHA256 `286967855442cb65da0732eb0b8df995f54f041e41258090e39c04a70e36f918` runs on D3D11 WARP with the hash-bound 400-byte constant buffer. It preserves source Y inversion, matrix/gamma/brightness processing, the native shoulder and PQ encoding. No JavaScript replacement of the shoulder is used.
- Grading sampling uses the native linear/clamp descriptor at `144099788`, selected through `141457130`. Merge selects linear/clamp for the PQ lookup through `141480d70`/`141451cf0`. The optional 32³ display cube is a separate resource and is not enabled by the recovered default merge flags.

`native-colorgrading-evidence.py` binds native functions, installed defaults, shader and source bytes to `exports/lighting/native-colorgrading/evidence.json`. The per-view bulk-copy link from source offsets `1024/1028/102c` to world offsets `3154/3158/315c` remains untraced; the baseline is not presented as a runtime observation.

## Payloads and runtime

`native-colorgrading-publish.py` publishes a 574,992-byte RGBA32F cube and a 2,048-byte R16F PQ-to-linear lookup. Every RGB10 source value is decoded directly into float32. This avoids requiring an unsupported packed-type enum in the installed Three.js version. The browser checks each payload length and SHA256 before creating textures. Both textures use linear/clamp sampling and no color-space transform or mipmaps.

The 1,024-entry PQ lookup reproduces `141476d80` using separately rounded float32 operations, the same named Windows CRT `powf` API, and native half conversion. The original import descriptor/thunk/name are checked; the game executable is read but never loaded or executed. All 1,024 half values also match an independent IEEE half conversion.

The output shader applies exposure and the authored global vignette, PQ encoding and the 33³ cube, quantizes to the original RGB10A2 render-plane precision, then samples the native PQ-to-linear table, clamps to SDR and encodes sRGB. Bloom remains unreconstructed. Vignette selection, parameters and its native producer/shader witness are documented in `native-vignette-analysis.md`.

The main render plane is now traced independently of the optional rescale target. `14147e120` builds `GameRenderer/MainTexture/FrameGraph` with format 27 when HDR grading and render planes are enabled in SDR display mode 0. `141486f30` allocates it through the frame graph and stores the handle at `RenderPlaneData+18`. `141470ad0` places that handle in the merge graph dependency at offset 8; `141466310` installs the execution vtable, whose callback `141479d20` enters `141470030`. This resolves the main texture into argument 6 of `141480d70`, which binds pixel texture t0. Format conversion `1415ae210` maps native 27 to DXGI 24, `R10G10B10A2_UNORM`. The evidence generator checks the executable strings, virtual callback, and retained native instructions for this chain. Special display mode 2 selects format 41 and is outside this SDR baseline.

The fused browser shader clamps and rounds each intermediate channel to nearest, ties even, at RGB10/A2 precision before merge. This preserves the source storage precision without a second framebuffer allocation. The published manifest explicitly identifies the original resource and format; runtime rejects an unsupported plane declaration.

## Independent measurements

`native-colorgrading-warp.ps1` executes unchanged original Tonemap and MergeRenderPlanes shaders on 4,096 deterministic HDR pixels. Packed RGB10A2 and decoded RGBA32F cube paths produce bit-identical graded and final float outputs. Synthetic fullscreen geometry, zero bloom, inactive vignette and a float32 intermediate isolate the recovered equations.

`web/test/source-colorgrading-gpu-check.mjs` compares the browser shader on AMD ANGLE against those retained native outputs:

| Stage | Maximum absolute residual |
| --- | ---: |
| PQ encoding | 0.00002092123 |
| Cube lookup using native PQ coordinates | 0.000000059605 |
| Full grading | 0.00019022822 |
| SDR merge using native graded input | 0.00001966953 |
| Composed browser output | 0.00035583973 |

All outputs are finite. These measurements isolate the equations using a float32 intermediate; they are not the active quantized output measurement. The diagnostic isolates the dominant discrepancy to GPU transcendental arithmetic, not a cube payload conversion error. The initial tighter arbitrary threshold and its failure remain archived; final output is not claimed bit-identical.

`native-colorgrading-warp.ps1 -RenderPlane` separately executes the same unchanged original shaders with the recovered RGB10A2 intermediate. Both packed-cube and decoded-float-cube paths produce identical packed plane bytes and identical final pixels. The 16,384 stored channel codes independently match float32 clamp/multiply/ties-even rounding. Retained plane SHA256 is `b7eb18a7e89526f6894a387d7eb2f38830e165facab08f9493806f61cf0c1f3f`; final float output SHA256 is `96823bda140faf970b1f5d82cb1ab1281b982630a9aaaebebfcbd5b1bc2ac01c`.

`web/test/source-colorgrading-plane-gpu-check.mjs` then measures the active precision on AMD ANGLE:

| Stage | Result |
| --- | --- |
| Native graded input → browser quantization | All 16,384 original channel codes exact; decoded float residual ≤2.981e−8 |
| Native quantized input → browser merge | Maximum absolute residual 0.00001883507 |
| Native graded input → browser quantization and merge | Maximum absolute residual 0.00001883507 |
| Full browser grading → quantized plane | 14 channel codes differ, each by exactly one code |
| Full quantized browser output | Maximum absolute residual 0.00366604328, about 0.935 of an 8-bit step |

The complete output remains within the original quantized RGB codes ±1, followed by the measured merge arithmetic allowance of 1/32768. There are no nonfinite values, browser errors or envelope violations. Quantization exposes a small number of cross-device transcendental rounding boundaries; the old float-intermediate residual must not be used as the active output bound.

Two payload/runtime tests check all expanded source channels, the original PQ bytes, texture policy, active render-plane quantization/vignette and malformed/hash-mismatched input rejection. Actual-map validation separately checks that this baseline is active in the running scene. Native local-environment blending, user overrides, per-view bulk-copy linkage and bloom remain separate work.

The selected global vignette is also checked through the entire HDR pipeline: `native-colorgrading-warp.ps1 -Vignette` and `-RenderPlane -Vignette` retain separate unchanged-original outputs. `BF2_VIGNETTE=1 node test/source-colorgrading-plane-gpu-check.mjs` passes all 4,096 pixels. Isolated rounding retains all 16,384 original channel codes; the complete vignette/grading path differs at only two one-code boundaries, with final maximum residual 0.0034167171 and zero native-code-envelope violations. Earlier zero-vignette witness files are preserved.
