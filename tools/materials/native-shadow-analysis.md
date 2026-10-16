# Native local shadow producer

Evidence ID: `BF2-NATIVE-LOCAL-SHADOW-PRODUCER-001`.
Original executable SHA256:
`d350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4`.
This is bounded static analysis, not an original frame capture or game execution.
The standalone helper does not activate browser shadows.

## Source records and eligibility

The selected map export has 52 enabled punctual PbrSpotLightEntityData records
with CastShadowsEnable true and CastShadows Low (enum 0). All have DiscRadius 0,
ShadowResolution Medium (1), ShadowNearRadius .2, ShadowFarRadius 0,
ShadowDimmer 1 and ShadowFadeOutRange 10. Five enable their shadow cache.
Stable identity is fileGuid, classGuid and route together; internal class IDs
alone are not globally unique. The evidence JSON retains each identity.

The already recovered EBX/staging/runtime chain is retained in
`direct-producer-evidence.json`. Function `140dac920` combines the source enable
bit, CastShadows != Disabled (5), and CastShadows <= WorldRenderSettings
PunctualLightShadowLevel (+368). Source ShadowResolution selects the four
settings at +32c/+330/+334/+338. Source enable is not sufficient to prove that
a light receives an atlas tile in a particular frame.

WorldRenderSettings type descriptor `144b7d310`, exact field metadata and
constructor `142d72180` prove native defaults:

| Setting | Offset | Native default |
| --- | --- | --- |
| LocalLightShadowFilterQuality | 328 | 1 |
| LocalLightShadowResolutionLow/Medium/High/Ultra | 32c..338 | 256/512/1024/2048 |
| LocalLightShadowAtlasSlotCount | 33c | 32 |
| LocalLightShadowAtlasSlotResolution | 340 | 512 |
| MaxShadowCount | 348 | 32 |
| PunctualLightShadowLevel | 368 | 0 |
| LocalLightShadowEnable | 485 | true |
| LocalLightShadow16BitEnable | 486 | true |
| LocalLightShadowCacheEnable | 487 | false |

The retained desktop Graphics.lua changes PunctualLightShadowLevel by the
selected quality. Game.cfg enables the global local-light cache. Native defaults
are an explicit possible baseline; user/device/local overrides and actual frame
selection have not been captured. Legacy SpotLightShadowmapQuality is a different
field from LocalLightShadowFilterQuality.

## Atlas format, size and tile border

`140db0fb0` reads WorldRenderSettings +485/+486/+487 and +33c/+340. Its
configuration goes to `140f74fb0`, then `140f74b00` and allocator `1414c7170`.
Let N be slot count and R be slot resolution. The square atlas side is
max(ceil(sqrt(N)), ceil(N/ceil(sqrt(N)))) * (R+8). With native constructor
defaults this is 3120 pixels, not a power of two. This is capacity construction,
not proof that all 52 source lights render together.

`140f51310` chooses the first supported native format from
[123,125,120,124,122], starting at index 1 when 16-bit preference is false.
Exact RenderFormat metadata identifies these as D16_UNORM, D32_FLOAT,
D24_UNORM_S8_UINT, D24_UNORM and D32_FLOAT_S8_UINT. The test is capability mask
0x21 through `141458210`; the fallback return is 120. DX11 capability producer
`1415ae210` maps native 123 to DXGI 55 and native 125 to DXGI 40. A captured
native device capability table is unavailable, so D16 is a preference, not an
observed runtime format. `140f76e20` creates LocalShadowAtlasTexture with the
selected format and computed dimensions, or imports its cached texture.

Allocation `140f90b80` connects each resolution request to its exact GPU
ShadowLightInfo and shadow render view. For allocator rectangle (x,y,w,h), it
writes atlasParam = [(x+4)/size,(y+4)/size,(w-8)/size,(h-8)/size]. The native
four-pixel border is therefore explicit. It enlarges the caster view FOV to
2*atan((R+8)/R*tan(originalFov/2)); the receiver lighting matrix still uses the
original FOV. Changing one without the other changes shadow alignment.

## Spot view and quality consumer

`140d879e0` clamps near=max(ShadowNearRadius,float32(.005)); chooses source far
only when 0 < ShadowFarRadius <= AttenuationRadius, otherwise radius; and then
far=max(near+float32(.01),chosenFar). All 52 map records therefore use near .2
and the source radius as far. Punctual DiscRadius 0 introduces no area-emitter
translation in `140d9d100`; original source axes and position are copied.

Outer angle is clamped to [1,179], maximum to at most 150 and fade range to at
least float32(.001). Start=min(outer,maximum-fade); end=min(maximum,
max(outer,start+.001)). End is the original shadow projection FOV in degrees.
`140f873a0` supplies angleScale=1/(cos(start/2)-cos(end/2)) and
angleOffset=-cos(end/2)*angleScale. The source has no epsilon on this division.
The consumer squares saturate(facingCosine*angleScale+angleOffset).

**The quality producer is `140d8cc00`: WorldRenderSettings +328 copies into the
light-view descriptor +54c. `140f85240` passes that descriptor to `140f873a0`,
which converts it to GPU float quality.** An earlier candidate, renderer
context +cf0 via `140da1bd0`, uses an unrelated structure at the same offset;
it is not evidence for this local-light binding.

The unchanged type3 shader has SHA256
`a61cab9738c12e1b993c32ff96dddc0f96c7942a6b4716aa4ef83e491c8c25b9`.
Spot shadowType 1 uses four dp4 rows, divides xyz by w, converts x/y with
(.5,-.5)+(.5,.5), then applies atlas offset/scale. It checks the original
projection bounds before shadow dimming. Quality 1 executes nine comparison
gathers over offsets {-2,0,2}² and combines the results with fractional-texel
weights and normalization 1/61. Other qualities use a single comparison sample
with a depth>=1 bypass. This is not equivalent to arbitrary Three PCF settings.
The final term is 1+shadowDimmer*shadowAngleAttenuation*(sample-1).

`140f873a0` also writes depth factors A=-near*far/(far-near),
B=far/(far-near), swapping near/far when the stored view reverse-depth flag is
set. Its matrix is the original unexpanded view/projection at record+700,
transposed into GPU rows and adjusted for camera-relative coordinates.
The exact light-record constructor `140f75d50` initializes six RenderViews at
record+e0 with stride f0, clears the ae0-byte record, then copies freshly
constructed views back through leaf `140d79df0`. That copier preserves every
projection flag. `1414c6d50` establishes perspective mode 0, right-handed +ea=1,
finite-far +ec=0, and reverse-depth +ed=1; the spot producer retains these flags.
The backend depth convention at +eb comes from rendererCaps+60 (base constructor
zero); device overrides have not been captured. The selected bias binding is
closed below; the complete caster pipeline still needs the comparison sampler.
The source bias tables and format selection are recovered below.

## Depth-bias groups and the concrete DX11 raster-state binding

The second 32-bit word assembled by `140db0fb0` is **ShaderDepthBiasGroup**,
not a second texture format. Original enum metadata at 144df6e38/50/68 names
groups 11/12/13 Shadow16Bit/Shadow24Bit/Shadow32Bit. Formats 120/121/124 select
group 12, formats 122/125 select 13, and 123 selects 11. Constructor `140f74fb0`
stores it at wrapper+64; `140f714a0` copies it into the shadow mesh draw
descriptor. This establishes which group the local-shadow producer requests.

Original integer table 14409a530 and float table 14409a580 contain 17 entries
each. Their concatenated 136 bytes exactly match floor-reachable RVM block
`e77a8d9646` (DepthBiasGroupData), offset 5240864 in the unchanged 0.res.
Groups 11/12/13 have integer bias -10/-1000/-1000 and slope-scaled bias -4
for all three. This is independently checked by the evidence generator and
the focused test, including all format-to-group associations.

There are two distinct native consumers. Shader constant selector 144 calls
`1415d39d0` -> `1415d1dc0`; assembly shuffles its output to
[integerBiasAsFloat,slopeBias,depthFormatBits,0]. The decompiler incorrectly
models part of this SSE return, so the retained assembly is authoritative.
No selector-144 instruction was found in the retained floor graph; do not
claim that its floor vertex shader applies this constant.

Separately, `1415f6de0` builds a compact raster descriptor from its input+68
group: +0 integer bias, +4 float clamp 0, +8 float slope bias, plus fill/cull
and flags. It inserts the descriptor using global key 144601b28. Registration
`1415f2c50` identifies the key as `$RasterizerState` and its compact type as
Dx12RvmRasterizerDesc. The exact DX11 backend is also retained:
`1415e6ca0` assembles its separate named property list into the expanded raster
descriptor, then `1415ec7f0` calls CreateRasterizerState/CreateRasterizerState2.
The original assertion strings explicitly name those API methods. The compact
Dx12 descriptor is a separate path. The concrete DX11 binding below establishes
the selected shadow-pass override without equating these descriptor types.

Evidence **BF2-NATIVE-SHADOW-DX11-BIAS-001** is reproducible with
`python tools/materials/native-shadow-rvm.py`, publishing
`exports/lighting/native-shadow-rvm-bias.json`. It checks the original executable
hash, seven exact instruction windows, concrete factory pointers, typed parameter
hashes, all23 floor draw-state builders and their76 function input bindings.

`140f714a0` copies wrapper+64 to mesh descriptor+538. Layout constructor
`140d8e210` places named `!dispatchListDepthBiasGroup` at entry21; `140d89c10`
copies descriptor+538 into that exact entry. Native typed key construction
`14136db60` independently reproduces hashes362f737f43153b50 for
`!depthBiasGroup` and7c3d16efa38ffb1e for `!dispatchListDepthBiasGroup`:
low48 of CityHash64 over LE32(count and three string lengths), then exact name,
type `ShaderDepthBiasGroup`, module `Render`; high16 is low16 of the original
case-insensitive DJB2-XOR name hash. This closes the named-key association.

The retained floor graph contains23 distinct92-byte Dx11LegacyDrawStateBuilderData
blocks. All76 ancestor function bindings resolve serialized handle+20 to the
base group, +24 to the dispatch override, and +0 to DepthBiasGroupData. Use the
DirectInput instruction's **ordered ParamDbSerializedReadView**; the function's
separate hash view has a different order. Witness9388b39f7a in functione7c9f223d1
uses slots7,23,24 respectively. The evidence retains each actual block, slot,
read view and original byte hash.

Factory metadata144bf3570 points at its **concrete constructor in field+38**,
146c525d0, which installs vtable143451e50. Its +18 factory146c52d80 creates
implementation vtable1434531e0; execution146c5aca0 calls1415efd20. Following the
metadata+28 abstract constructor instead reaches purecall and misses this path.
`1415efd20` selects the dispatch group when it is nonzero, otherwise the base;
it indexes the original integer table and table+44 slope array and writes named
DX11 properties1445fd080 `$depthBias` and1445fd0a0 `$slopeScaledDepthBias`.
Registration1415e5a70 assigns their property indices10 and12. Expanded descriptor
builder1415e6ca0 reads those exact indices before1415ec7f0 creates the DX11 state.
Thus the floor material's base group0 does not erase the shadow-pass group11/12/13.

The DX11 descriptor starts zeroed; an optional property supplies DepthBiasClamp.
The proven group helper returns its native zero baseline, but an arbitrary
unexamined RVM/property overlay must not be assumed absent. No native frame's
selected caster shader/LOD or final merged descriptor has been captured.

`nativeShadowBiasForFormat` returns only original native group/bias values.
It deliberately makes no claim that D3D integer bias equals WebGL polygon
offset units. Cross-API depth bias and selected material/culling state still
require proof before renderer activation. The comparison sampler is closed below.

## Exact comparison sampler and unchanged shader validation

Evidence **BF2-NATIVE-SHADOW-SAMPLER-001**, generated by
`native-shadow-sampler.py`, closes the sampler producer. The retained native
function140f45b90 selects program hashf5f3bbba; original name lookup142de7636
resolves it to ShaderProgram_DeferredTiledLightingCS. The same function binds
s3 from native sampler words[2,2,2,2,2,0,0,16,1,1,0]. Context constructor
14159b3f0 installs vtable143443e60, whose+318 method is1415b9e80. It calls
converter1415a41c0 then1415b17b0/CreateSamplerState. Comparison-enabled+24 forces
D3D filter0x94 COMPARISON_MIN_MAG_LINEAR_MIP_POINT and comparison5 GREATER;
addressUVW becomes CLAMP, minLOD0 and maxLOD16. Equality fails. This is consistent
with, but independently proves more than, the reversed projection depth flag.

IES sampler s2 is also closed by that exact producer: source words
[0,2,2,2,2,1,0,16,1,0,0] become MIN_MAG_LINEAR_MIP_POINT, WRAP U and CLAMP V/W.
The browser's existing IES V clamp no longer requires an inference.

`native-shadow-kernel.py` independently interprets the original DXBC arithmetic
with1728 one-hot input cases. Its nine GatherCmp operations equal a bilinearly
shifted5x5 kernel on a6x6 raw comparison footprint:

```
1 2 2 2 1
2 3 4 3 2
2 4 5 4 2
2 3 4 3 2
1 2 2 2 1
```

The kernel sums to61. Original DXBC immediate0x3c864b8a is
float32(1/61)=0.016393441706895828. The maximum interpreted coefficient residual
is8.88e-16. Quality is converted to unsigned integer before comparison with1.
Other qualities use the hardware comparison sampler and bypass it when depth>=1;
quality1 does not use that bypass. Projection accepts
max(abs(x/w),abs(y/w),1-z/w)<=1 and the final atlasU>=0; it does not add a positiveW
or depth<=1 gate.

`native-shadow-warp.ps1` executes the **entire unchanged** type3 compute shader on
CPU WARP with controlled GBuffer, light, atlas and matrix inputs:400 cases,
25,600 pixels. No shader replacement or original game process is used. The
fixture covers constant/checker/random/ramp depth textures, qualities0/1/1.75/2,
negative/near/interior depth, perspectiveW, outside projection and dimmer0.7.
`native-shadow-validate.py` checks the recovered equations against those outputs.
The detailed filter residual is1.637e-7. Ideal bilinear simple-filter residual is
0.005013; a separate diagnostic establishes WARP floor-to-eight-bit fractional
coordinates, reducing the full fixture residual to1.637e-7. That diagnostic is
not implemented in browser runtime arithmetic.

Standalone `web/src/source-shadow-sampling.js` exposes CPU and GLSL projection,
quality1 filtering, simple comparison and final dimmer. The quality1 GLSL uses
36 raw texel comparisons because WebGL2 does not expose the source comparison
gather operation. The simple GLSL delegates to a GREATER/LINEAR depth sampler.
The real-Three hardware fixture `web/test/source-shadow-sampling-gpu-check.mjs`
passes12,800 detailed-filter pixels within3.122e-7 against unchanged native WARP
output. Its12,800 simple-filter pixels match direct hardware comparison sampling
exactly. WARP-versus-AMD sampler residual0.007264 remains recorded separately;
no gain, offset or filtering approximation was added. Both programs link with
zero GL/page errors. The report is
`web/test-results/source-shadow-sampling-gpu-check.json`.

## Bounded handoff

`web/src/source-shadow-native.js` exposes only the proven arithmetic: atlas
size and UV parameters, border FOV, explicit-direction depth factors, source
bias tables and punctual spot parameters. Five tests verify source identities and settings, atlas
coverage/alignment invariants, projection-border cancellation and native depth
endpoints. They do not claim original shader execution or a rendered shadow.

Next source boundary: `140f714a0` submits allocated views through the mesh draw
processor, using the selected depth format and render view. `140f73c20`, named
drawLocalLightShadowmaps, binds the selected atlas and invokes that processor's
virtual +30 draw method for each allocated view. The processor is created through
the frame renderer's +5a8 object in `140f714a0`. Bias state binding is established
above; its complete culling/material submission remains necessary before a
faithful caster pass can be wired. The current map manifest's castShadow=true
is hard-coded in finalize-scene.mjs; it is not native caster eligibility proof.
Do not reuse the nearby `140f819e0` as a local-light caster: retained native
strings identify it as DirectionalShadowModule::drawShadowBufferSlice.
Atlas packing priorities, caching, per-view culling/fade and native caster LOD
selection remain unwired. No generic shadow parameters or runtime gains were
introduced.
