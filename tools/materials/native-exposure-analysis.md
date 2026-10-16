# Native exposure and presentation recovery

Evidence **BF2-NATIVE-EXPOSURE-001**. Reproduce the bounded source checks with
`python tools/materials/native-exposure-evidence.py` and the source pixel/vertex
shader extractions with `python tools/materials/native-exposure-shaders.py`.
The installed executable is read statically. It is never launched. Separately,
unchanged extracted metering VS/PS execute on CPU WARP in a bounded fixture.

## Proven CPU equations

`14155ac40` creates the named `CalculateExposure` task. Its callback `146c14fb0`
invokes `141561260`; `140d984b0` supplies the actual TonemapComponentState pointer,
frame exposure object and ViewLuminanceData readback record.

`141561710` converts a valid automatic reduced luminance to EV:

```
rawEV = logf(L * 100 * float32(.08)) * float32(log2(e))
```

This confirms the browser's calibration `log2(L*8)` to float precision. It does
not establish that the browser and native renderer measure the same luminance.
When automatic readback is invalid, current EV is retained. Manual mode uses
TonemapComponentState.EV (+a0), or the applicable camera override. Automatic
targets clamp to the supplied EV bounds. A target in
`[currentEV-LowerThreshold, currentEV+HigherThreshold]` retains current EV.
ForceEV applies after this selection. The native function also returns a raw
secondary EV and a clamped diagnostic EV; these are distinct quantities.

`141561260` uses a **capped linear step**, not exponential smoothing:

```
time = target <= current ? DarkAdaptationTime : LightAdaptationTime
weight = min(deltaTime / time, 1)
adapted = (1-weight)*current + weight*target
```

Adaptation requires GlobalPostProcessSettings.AdaptationTimeEnable (+20e), at
least one time greater than float32(.01), and no frame reset flag. Automatic EV
targets outside the deadband are shifted inward by the corresponding threshold
before interpolation. Exposure compensation adapts separately, choosing its own
directional time. A reset bypasses interpolation.

The stored exposure is exactly:

```
exposure = 1 / (float32(1.2) * powf(2, adaptedEV-adaptedCompensation))
```

`141e72fc6` and `141e73026` resolve through the executable's import table to
`logf` and `powf`. `140db2f60` reads this same frame object's +50 exposure into
render-context slot 0. `140d853b0` builds the common +90 vector; original RVM
selector 8 / `1415d7550` copies that vector. This closes the CPU scale-to-shader
chain; the physical exposure equation is no longer a reconstruction assumption.

## Metering branch and remaining selection boundary

The selected environment serializes `AutoExposureMethod_UseGlobalSetting`.
`140ffb7c0` resolves it through GlobalPostProcessSettings.AutoExposureMethod
(+ac); remaining value4 falls back to1. Method2 falls back to1 when the blur
pyramid is disabled. Native constructor `142deb960` sets method1, log averaging,
EV clamp and adaptation enabled. These are native defaults, not a captured user
configuration. Parent-owned `native-exposure-initfs.py` parses all96 startup
payloads; the only exposure-setting text is logAverage=false in Voyager.cfg,
whose ordinary desktop inclusion is unproven. User/device/local/command-line
overrides remain a boundary.
`140ff28b0` dispatches the proven method-1 / MipAverage branch to `141560a70`.
Method 2 selects an existing pyramid's final level (`140ff2430`); method 3
dispatches the histogram path (`140ff25e0`). These branches must not be conflated.

The MipAverage branch clamps spot scale to [.02,1] and constructs a centered
square crop in pixel coordinates, with optional bounded X/Y offsets. The caller
takes the **minimum** of the Tonemap spot scale and render-context +3228. For
source widths other than one, the allocated sequence starts at 256x128 and
halves down to 1x1, followed by a final 1x1 pass. The rectangle is stored in each
builder but consumed only by the first logarithmic branch; ordinary passes use
full0..1 UV. `141587900` writes those quad UVs and the original VS copies them
unchanged. `14157dd30` reads the current destination target dimensions and binds
their inverse to VS and fallback PS.

The optional first log pass is the retained original `DownsampleHalfGrayscaleLog`
PS. Its fallback averages four point samples at half-destination-pixel offsets, clamps the RGB, and
stores `ln(dot(rgb,luminanceVector)+1e-5)` in alpha. The native wrapper sets
`luminanceVector = firstPassScalar * [.30,.59,.11]`. This differs from both the
browser's Rec709 weights and its per-sample Gaussian weighted log operation.
GlobalPostProcessSettings.DownsampleLogAverageEnable is native byte +21f.
`140ffb7c0` sets firstPassScalar to the reciprocal of frame exposure slot1
(render-context +3214), removing native pre-exposure. Browser raw HDR needs1.
`140ffc890` returns readback-map validity; `140ff8fd0` decodes format0x28 as four
half-floats. `140ffa260` computes imported expf(alpha) for log averaging, or the
RGB dot product for nonlog method1. Method2 removes exposure on CPU readback.
No Gaussian approximation is called native in this evidence.

The sampler structure was initially mislabeled: its first3 integers are
address modes, not filters. Native converter `1415a41c0` maps [2,2,2] to D3D
CLAMP [3,3,3], then `1415affc0` maps the following filter tuple[1,1,1] to
MIN_MAG_MIP_POINT0. The resulting descriptor reaches CreateSamplerState through
`1415b9e80` and `1415b17b0`. The original packed RVM sampler path separately
copies bytes directly to the D3D descriptor in `1415df660` / `1415ecbc0`.

There is also a source fast PIXEL path (not compute): initially enabled bytes
14409b268/269 and renderer format-capability **bit1** select Tex2d and
Tex2dGrayscaleLog. This path uses one bilinear/clamp sample at interpolated UV.
Its sampler[2,2,2,2,2,2] converts to D3D CLAMP and MIN_MAG_MIP_LINEAR0x15.
The capability producer is now closed: `1414581e0` has `SHR EAX,1; AND AL,1`.
An earlier checkpoint incorrectly called this bit5; the assembly is decisive.
DX11 caps live at renderer+e38, returned by vtable+80 getter `1415af680`.
`1415ae210` calls ID3D11Device::CheckFormatSupport (vtable+e8), maps native
format28 to DXGI10 / R16G16B16A16_FLOAT, and maps returned SHADER_SAMPLE bit9
(0x200) into native bit1 at caps+64+format*4. Thus sampleable RGBA16F with the
enabled defaults selects the fast path. The fallback remains a distinct kernel.

Tonemap state constructor `142df9fa0` initializes higher/lower thresholds to0;
selected interior/gamewide exports also serialize both0 without overriding
them. This supports a zero-deadband baseline, while local blends remain open.

## Presentation

The retained baseline linear tonemap PS adds sampled bloom times bloomScale,
multiplies by colorScale, blends a source vignette, and applies the standard
piecewise linear-to-sRGB transfer. It has no hidden filmic compression curve.
The separate retained ColorGrade PS samples a 32-cubed LUT at
`rgb*(31/32)+1/64`. Active grading payload, optional permutation, bloom graph and
vignette parameter selection remain separate recovery tasks.

## Integration and checks

`web/src/source-exposure-native.js` is a pure helper. Its first three exports
`nativeExposureAtEV`, `nativeMeterEV`, and `adaptNativeExposureEV` can be used
independently. The adaptation helper accepts an already resolved/clamped target
and does not invent bounds or a time floor. The more complete target/frame
helpers require explicit thresholds and enable/reset controls; do not activate
these from guessed defaults.

`node --test web/test/source-exposure-native.test.js` checks calibration across
EV -10..25, directional/capped adaptation, a discriminating comparison with the
old exponential rule, readback hold, target clamps/deadband/override ordering,
secondary EV, independent compensation, and reset/time gates. These are
mathematical/branch tests against retained source equations, not claims of
original executable execution. JavaScript uses double arithmetic
around source float32 constants, so bit identity to native libm is not claimed.

`native-exposure-warp.ps1` executes unchanged original metering VS and both
PS paths with their source samplers. `native-exposure-validate.py` and the JS
meter test independently compare all402 output pixels across16 fixtures. Maximum
normalized residual1.1583920694e-7; ordinary RGBA averages match exactly. Tests
cover crop, negative/HDR clamp, exposure scale, destination sizes and1x1 edges.
Float32 fixture targets isolate shader math. Two additional original-shader
ten-pass graphs retain every RGBA16F intermediate; only their controlled input
is float32. `source-exposure-meter.js` exports pure crop/pass-plan,
sample/readback and GLSL helpers. Use half-float intermediates, first-pass-only
crop and the final extra1x1 pass when integrating the corresponding source path.

`web/test/source-exposure-gpu-check.mjs` validates both paths on real AMD/ANGLE
hardware: 402 pixels, maximum normalized arithmetic residual1.6560877164e-7.
The fast graph checks all43,692 RGBA16F pixels. Only9 scalars across the first3
passes differ by one adjacent half value; passes3..9 and finalEV are exact.
The report retains these rounding residuals separately from shader arithmetic.
The production `createNativeExposureMeter` helper additionally passes async
half-float readback, changed source dimensions/crop, width1, target restoration,
and dispose-while-read-pending checks. It allocates349,536 bytes in fixed targets.

`source-exposure.js` now uses that validated fast native meter. Its first-pass
scale is1 because scene HDR is unexposed. The baseline selects native method1,
log averaging, enabled fast sampling, zero deadband and zero spot offset. The
native constructors plus retained default startup route support this explicit
baseline; unknown original user/device/local overrides remain unclaimed.
Initial midpointEV/snap,200ms cadence and view spot-scale limit1 remain browser
reconstruction choices. The original four-slot readback scheduling is not
implemented. All source EV bounds, compensation and adaptation remain unchanged.

Parent actual-map verification at17:51UTC passed all36 checks with this meter:
`web/test-results/actual-map-native-meter-metallic-expanded-tangents.json`.
The frame reported10 RGBA16F passes,349,536 bytes,19 completed readbacks and no
meter error; luminance42.2726635, EV8.401606, targetEV8.401653 and exposure
.001742482. These are browser measurements, not an original native frame.
The combined checkpoint passed339 CPU tests and a151-module production build.
