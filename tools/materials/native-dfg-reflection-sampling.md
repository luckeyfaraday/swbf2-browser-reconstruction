# Native reflection sampling: BF2-NATIVE-REFLECTION-SAMPLING-001

The local cube sampler, native filter roughness table and cube face orientation are recovered from the original shader database and executable. These establish sampling equations, not a captured native frame. Volume field construction, tile ordering, capture exposure and the selected runtime permutation remain separate gaps.

## Source identity

`native-dfg-reflection-shaders.py` extracts four exact named, length-delimited DXBC programs from the already pinned `systems/shaderprogramdb` resource (SHA256 `110d7169cb6f70559f8ecea0819e26b1df4fb66e0649f95bdeea033ef44ef898`). RDEF and disassembly are preserved beside every original bytecode file in `exports/lighting/dfg-reflection-shaders/`.

- Local cube consumer: `Dx11/DeferredTiledLightingCS_splitLight=0,gbLayout=0,lightType=4,reference=0,materialPassType=0,volumetricShadowMaps=0,dynamicAO=0,translucency=0,cbv=1`, DXBC offset104261619,13828bytes, SHA256 `37dcf31fe69ffa9afef92b320e9208b74049210d16d4a967f3bde425be5c33d5`.
- Its RDEF explicitly binds `g_specularLocalIBLsTexture=t7` as a cube array and `g_preIntegratedFGTexture=t8`. Sampler s1 is named `g_linearMipmapSampler`. Its packed constant structure is `LocalIBLLightInfo`: `pos`, `invTransform`, `extend`, `textureIndex`, fade distances, positive/negative side fades, `IBLType`, `localOffset`, sky visibility controls and `skipProxyReprojection`. `IBLType==0` takes sphere intersection; the other branch takes a box slab intersection.
- Filter: `Dx11/PBRConvolveSpecularCubeMapCompute_precomputedSample=0`, offset110247060,5336bytes, SHA256 `4cb04e580543b87f8a2f2a1afed8332049cd0e7a8df2a46adf0a8ef7957fcbd9`. The separately retained `precomputedSample=1` permutation consumes prepared sample vectors. The filter uses GGX importance sampling, cosine-weighted radiance accumulation and PDF/solid-angle source mip selection.
- LightType5 was retained as a bounded comparison and is a planar reflection consumer, not another cube-volume branch. It is not used to derive the cube helper.

## Filter table and LOD

Executable dispatch `0x141564d50` binds hash `0x455c9474`, independently equal to DJB-XOR(`ShaderProgram_PBRConvolveSpecularCubeMapCompute`), and uploads the per-mip arrays as shader constants. Configuration `0x141562bb0` obtains perceptual roughness from `0x14148ee10(mip,mipCount)`, then squares it using leaf `0x141490960` for `g_IBLRoughness`. The original instructions call the exact `powf` IAT thunk at0x141e73026, use source literal2.0 at0x14301a310, subtract the two powers and take a square root:

```text
filterRoughness(m,M) = sqrt((2^m-1)/2^(M-1))
filterAlpha(m,M) = filterRoughness²
```

For the six original levels of a128-pixel cube, alpha is `[0,1,3,7,15,31]/32`. Perceptual roughness is approximately `[0,.176777,.306186,.467707,.684653,.984251]`. These are original filter parameters, not a fit to texture content.

Deferred upload `0x140f45b90` writes `localIblMipmapBias` at cbuffer byte80. It obtains the runtime cube-array resolution through the same texture interface used by the filter, passes it through leaf0x140f8c460 (`floor(log2(resolution))-1`), then leaf0x140f7b600 (`2^(argument-1)`). Thus128-pixel resolution gives bias32. The selected runtime array resolution is not captured; the browser uses each retained source payload's resolution.

For normalized N and V and source perceptual roughness r, the native cube shader computes:

```text
a = r²
nv = saturate(dot(N,V))
R = reflect(-V,N)
D = mix(N,R,(1-a)*(a+sqrt(max(1-a,0))))
c = a * mix(min(2*nv,1),1,r)
LOD = log2(1 + localIblMipmapBias*c)     // with proxy correction disabled
```

At normal incidence the native LOD exactly inverts the filter's roughness table. Sampling must use the original native mips. Applying this LOD to a Three PMREM atlas would address a different filter distribution.

`native-dfg-reflection-native.py` validates exact executable ranges/instructions, the powf thunk and constants. `native-executable.json` retains the original executable digest, eight complete function-range digests, addresses, file offsets and the six-level table. Decompilation files under `exports/lighting/dfg-native-functions/` retain instruction listings; no global native analysis or native game execution was performed.

## Proxy correction and overlap

For a box, the shader transforms the camera-relative surface position P and dominant ray D through native `invTransform`. It computes slab entry/exit distances against local `±extend`. When `skipProxyReprojection>0`, it substitutes entry0 and exit1. Otherwise entry must be less than exit. Then:

```text
H = localP + exitDistance*localD - localOffset
w = smoothstep(0,1,saturate(max(r²,skipProxyReprojection)))
correctedDirection = mix(H,localD,w)
correctedCone = mix(c*exitDistance/length(H),c,w)
LOD = log2(1 + localIblMipmapBias*correctedCone)
```

The sphere branch solves the positive sphere-ray intersection and performs an analogous roughness/distance correction. The box formula is independently checked and exposed as a CPU helper accepting explicit native local fields. The browser does not silently reinterpret an entity's scaled transform as the native GPU structure.

The shader computes geometric fade, optional normal fade, side-direction fade and a sky-visibility mask for each volume. It applies specular occlusion using `saturate(pow(nv+occlusion,exp2(-16*r²-1))+occlusion-1)`, independently of the material's DFG response. RGB also multiplies `g_invLrvExposureMultiplier`; the CPU upload sets this to1 divided by another runtime input. That selected capture exposure value has not been recovered.

Overlap is an **ordered** list from `g_lightIndexInput`, with remaining transmittance initially1. For each volume, after native masking/specular response/occlusion:

```text
RGB += remaining * mask * response * cubeRGB * inverseLRVExposure
remaining *= 1 - mask*cubeAlpha
```

The loop stops when no transmittance remains. Cube alpha therefore affects overlap coverage; it must not be discarded or treated as universally1. RGB is not multiplied by cube alpha a second time in this loop. CPU volume order, native GPU transforms/extents and all mask construction inputs remain unresolved. The existing browser's single camera-selected volume is explicitly a reconstruction choice.

## Face orientation

The original convolution compute shader derives the following direction for destination face0..5, where `x=2*(pixelX+.5)/resolution-1` and similarly y. UAV slice is face index plus the cube-array offset:

| Face | Source direction |
| --- | --- |
| 0 / +X | `(1,-y,-x)` |
| 1 / -X | `(-1,-y,x)` |
| 2 / +Y | `(x,1,y)` |
| 3 / -Y | `(x,-1,-y)` |
| 4 / +Z | `(x,-y,1)` |
| 5 / -Z | `(-x,-y,-1)` |

All96 tested face/pixel cases agree exactly with an independent interpreter of these original instructions. This resolves the face-index/row orientation that was previously inferred. It does not resolve the CPU construction of a volume's capture-direction basis: native box samples use `invTransform`'s rotation, while the default browser helper retains its prior world-axis convention unless the caller provides an explicit direction matrix.

## Browser helper

`web/src/source-reflection-sampling.js` adds no shared renderer edits. It exports:

- `nativeReflectionMipmapBias`, `nativeReflectionMipRoughness`, `sourceReflectionDirection`, `sourceReflectionLod`, and `sourceBoxReflectionProjection` for CPU diagnostics/explicit native fields.
- `createSourceReflectionMipCube(payload,buffer)` for exact RGBA16F upload. It reuses the existing payload/range/finite-float validator, uploads original mip0, and sets five additional mip records for normal six-level payloads. Three0.186's `WebGLTextures.uploadCubeTexture` explicitly expects uncompressed cube `mipmaps[j].image[face].image` at GPU level j+1; the helper preserves that layout. No original level is regenerated, resized, tone mapped or gamma transformed. Every view shares the original half-float buffer.
- `prepareSourceReflectionSampling(document,{cacheSize:2,fetch,allowSingleMip:false})`, returning shared `uniforms`, async `select(volumeId,directionMatrix?)`, `snapshot` and `dispose`. Only active enabled/visible baked volumes are accepted. Selection is supplied by the caller. Stale fetches abort, cannot overwrite newer choices and cannot recreate resources after disposal. The LRU retains two payloads by default.
- `injectSourceReflectionSampling(shader,sampling)`, composing at `lights_fragment_maps`. When raw sampling is ready, it replaces `radiance` using source roughness/dominant direction/native LOD. It uses a separate samplerCube and never routes native LOD through Three's PMREM. Existing PMREM radiance remains the fallback while loading, outside coverage, after errors and for the single-mip exception. It composes with the separate native DFG/specular helper.

The shader adapter deliberately uses the **skip-proxy** path and leaves overlap/masks/capture exposure unresolved. It defaults the caller-supplied direction matrix to identity. These are explicit reconstruction choices, not recovered native selections. Its raw radiance is scale1, preserving the existing browser radiometry while the capture exposure input remains unknown.

The single-mip source asset is not extended with invented levels. Native function0x140d85750 copies baked mips when texture dimensions and mip counts match the runtime array; otherwise it invokes source convolution. The helper keeps that asset's mip0 and defaults to the existing PMREM fallback. `allowSingleMip:true` deliberately enables unfiltered mip0 at every roughness, with LOD clamped0, for diagnostics only.

Two ordinary cubes retain2,096,640bytes of CPU source buffers and approximately the same GPU payload bytes, roughly4MiB combined plus small objects. A transition can temporarily hold one extra downloaded buffer. This is additional to the existing PMREM fallback allocation; it does not eagerly upload all88 raw cubes. The helper does not need a WebGL renderer until ordinary rendering uploads a selected texture.

```js
const sampling = await prepareSourceReflectionSampling(reflectionDocument);
// In the caller's existing recovered-material hook, after its previous hook:
injectSourceReflectionSampling(shader, sampling);
// Whenever the existing source selector returns a different volume ID:
await sampling.select(volumeId); // null disables raw sampling and restores fallback
// Caller owns program-cache versioning and map teardown:
sampling.dispose();
```

## Validation and unresolved boundaries

`native-dfg-reflection-math.py` interprets original shader instruction slices independently of the compact formulas.1000randomized dominant-direction/box-projection/LOD cases agree within1.11e-16 in double algebra;96face cases match exactly. It does not claim native float32/FMA execution identity.

Ten focused Node tests pass: exact source mip bytes and layout, the six-level filter/LOD inverse relation, one-mip fallback, sharp/rough and view-angle endpoints, explicit box-ray cases, two-entry LRU/disposal, stale-fetch races, DFG shader composition and rejected missing/bad payloads. No browser run was part of this step; GPU validation is separate.

```powershell
python tools/materials/native-dfg-reflection-shaders.py
python tools/materials/native-dfg-reflection-native.py
python tools/materials/native-dfg-reflection-math.py
cd web
node --test test/source-reflection-sampling.test.js
```

The unresolved boundaries are native runtime cube-array resolution/exposure, volume field construction/capture basis, ordered tile-list construction, proxy-enabled runtime selection and influence blending. Source face orientation, ordinary specular DFG response, filter roughness table and the shown local sampling equations are independently recovered.
