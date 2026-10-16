# Native DFG binding and map reflection payloads

The installed floor forward shader's DFG input is traced to its legacy selector, original generator VS/PS, and a 128×128 half-float LUT produced by running that unchanged DXBC on Microsoft's CPU WARP renderer. All 88 actual HDR reflection cubemaps are also recovered through explicit references from the active map lighting layer. These are separate findings; no cubemap is claimed to be the DFG texture.

## DFG binding: BF2-NATIVE-DFG-BINDING-001

`exports/lighting/dfg-binding.json` records all **nine** retained function instances using pixel shader `d825be064c`. Each maps `t2` to legacy selector **122 / 0x7a**, source input slot **37 / 0x25**. Representative chain:

```text
RvmFunctionInstance d64afac0b2
  -> RvmFunction 98b22b3e6d
  -> apply block 6a8a4910aa, record 2, header 01 01 02 00 09 00 00 00
  -> register-slot array f3899b42e3: t2 reads converted slot 63
  -> texture conversion 94218d39bd
     source slot array a144edcf78 -> destination array 91a85b2b68
     source slot 49 -> converted slot 63
  -> legacy block d651a4a89a, record 8, source RES offset 5614464
     00 00 25 00 ff ff ff ff 00 00 00 00 00 00 31 00 7a 00 ff ff
     source input slot 0x25; destination slot 49; selector 0x7a
```

The same function's t7–t10 map to the previously recovered floor material parameter hashes. The t2 input instead comes from the `RvmLegacyInstructionFactory` path. The report verifies the same selector and instruction kind in all nine variants, whose slot numbers vary.

DXBC line 230 samples t2 at LOD zero, UV `(saturate(dot(normalize(N),V)), (1-smoothness)^2)`, reading its **z** channel through the `.xzyw` resource swizzle and `.y` destination mask. That scalar multiplies the combined SH/broad-specular indirect branch as documented by BF2-PROBE-SHADING-002.

The next pass recovered the missing generator, as detailed below. `dfg-native-enums.json` identifies selector122 as `ShaderConstantFunction_ForwardShadingPreIntegratedFG`; the separate `ShaderConstantSystemTexture_PreIntegratedFGTexture` value is11. They must not be conflated. Native executor `1415d7710` now proves selector122 dispatches to `1415d7310`, which copies the resource pointer at source input+0x58. Earlier "kind0x25" was the high ushort of an input slot handle, not an opcode. The full texture index's earlier negative filename search did not prove absence or generation; native code and the actual program database establish the generator route. Frosty's incomplete preview generator was not substituted.

The report also traces **all nine s1 bindings** through apply block → input slot → serialized parameter key → instance default value → identical native sampler `e639db23cb`. Its bytes16–19 are `14 03 03 01`, matching D3D min/mag linear, mip point and clamp U/V (wrap W). The packed-to-D3D descriptor conversion routine is not decompiled; the runtime's linear/clamp policy is supported by those exact enum-compatible bytes and one-mip source allocation.

Reproduce the complete binding checks:

```powershell
python tools/materials/native-dfg-trace.py --report
```

## Original generator and derived LUT: BF2-NATIVE-FG-GENERATOR-001 / BF2-NATIVE-FG-WARP-001

The executable's literal `preIntegratedFG`/`preintegrateFG` references lead to native draw function `0x141567e60`. Bounded Ghidra disassembly observes its program-binding call with **0xc416e8c3**, independently reproduced by DJB-XOR over `ShaderProgram_PBRComputePreIntegratedFG`. A native creation region referencing `deferred/preIntegratedFG` writes dimensions128×128 and format40; the pinned SDK maps40 to `RenderFormat_R16G16B16A16_FLOAT`. `computePreIntegratedFG` has a separate render-graph scheduling region at `0x1464bc800`. Function evidence and exact original instruction addresses are under `exports/lighting/dfg-native-functions`; PE source identity and literal/reference offsets are in `dfg-native-pe-seeds.json`.

These are ordinary local Ghidra 12.1.4 results, not connected REA provider results. The connected provider had stale environment variables; installed Ghidra/JDK21 were used with `-noanalysis` and just the selected native regions. No game process was launched. Chained PE unwind ranges are not necessarily whole functions; the creation fragment is retained as such, and the FG draw function has a complete245-byte instruction listing.

Full typed resource metadata identifies a single `Dx11ShaderProgramDatabase` resource, **`systems/shaderprogramdb`**, source SHA1 `3b240f5344df7efbe60ee2e1b69421957e43a918`,254,318,586bytes, in `win32/systems/frostbitestartupdata`. This resource was outside the earlier map bundle inventory. Only this exact resource was extracted. Its SHA256 is `110d7169cb6f70559f8ecea0819e26b1df4fb66e0649f95bdeea033ef44ef898`.

It contains length-delimited exact program names `Dx11/PBRComputePreIntegratedFG` and `Dx12/PBRComputePreIntegratedFG`. The DX11 VS is736bytes at offset76018, SHA256 `1d8e3c847624f5bb2fbf4a1c4443084309a1c283c2555a78e6c3c8e6ecb546fc`; the DX11 PS is4496bytes at offset13526272, SHA256 `c9f775220c17c4719fa43cbf440c75711b594b1c3fc28e72d41db3666435fe0c`. Both program-hash table occurrences map0xc416e8c3 to value122. Full table-loader semantics remain unproven, but native draw hash and exact stage names independently agree. DX11 and DX12 `SHEX` instruction streams are byte-identical for both stages despite compiler metadata/checksum differences. `dfg-generator/manifest.json` preserves all four ranges and hashes.

The original PS integrates **4096 samples per pixel** and has no texture/constant-buffer inputs. Its VS generates a fullscreen triangle from `SV_VertexID`, with UV0 at the source top-left. The standalone C# helper creates a headless **D3D11 WARP** software device (Microsoft Basic Render Driver, vendor0x1414/device0x8c), uploads the original compiled bytecode unchanged, draws3vertices into128×128RGBA16F, and copies staging rows without conversion. No hardware GPU, browser, native game, shader recompilation or preview replacement is involved.

The resulting131,072bytes are `exports/lighting/dfg-generator/native-fg-128.rgba16f.bin` and the identical public `source-dfg.rgba16f.bin`, SHA256 **`52211351c87d57ea80e198e8740c821686b0758b32661f7156dd41b744a994cb`**. This is original-generator output on WARP, **not a native-game texture capture**; original hardware floating-point results can differ slightly. Every texel is finite, alpha is zero, and RGB ranges are `[0.05130005,0,0.10449219]` to `[1,0.873046875,1.0244140625]`.

Independent validation implements the recovered GGX visibility and native diffuse integral algebra in NumPy float32. It preserves exact immediate constants from DXBC tokens, the integer jitter hash, Hammersley rotation and4096samples, rather than copying rendered pixels or using a fitted curve.81pixel checks spanning edges, corners and interior differ from WARP by at most **0.000817657** absolute. Half-float quantization, fused operations and transcendental rounding account for the comparison's finite precision; the WARP output remains the published artifact. `dfg-generator/validation.json` records every comparison. The printed DXBC disassembly rounds2^-32 to`0.000000`; reconstructing from that text alone would destroy the jitter. The validator uses the actual0x2f800000 literal.

## DFG coordinates, channels and runtime handoff

For the proven floor forward consumer:

```text
perceptualRoughness = 1 - saturate(sourceSmoothness)
u = saturate(dot(normalize(surfaceNormal), normalize(surfaceToCamera)))
v = perceptualRoughness²
lut = texture(t2, (u,v), LOD0)
indirect = max(SH + broadSpecular,0) * albedo * lut.b
```

The generator receives `(NdotV, alpha)` where `alpha=perceptualRoughness²`. R is the average of `(1-Fc)*GVis`, G is the average of `Fc*GVis`, and B is the integrated native diffuse BRDF, including its `1-0.33774834871292114*perceptualRoughness` energy factor. `Fc=(1-saturate(V·H))^5`. The subsequent **BF2-NATIVE-GBUFFER-001** recovery below establishes the ordinary native deferred reflection consumer and F90 policy directly; it uses the R/G split sum without Three's additional multiscattering term.

Three0.186 samples its own DFG at **(perceptualRoughness,NdotV)** and uses it in its multiscattering/diffuse-energy model. This native LUT uses swapped axes **and squared roughness**, plus a native diffuse B channel. **Do not assign it to Three's `dfgLUT` uniform.** The source floor indirect term has neither an extra1/pi nor Three's `(1-singleScattering-multiScattering)` attenuation. Multiplying the existing `PI*SH` irradiance injection by B would retain that extra Three attenuation. For the proven floor, remove that SH irradiance injection and add the source term separately to `reflectedLight.indirectDiffuse` after `lights_fragment_end`; use the source albedo, unnormalized source normal for SH, normalized normal for NdotV and original source roughness before Three's minimum/derivative roughness changes. BroadSpecular may only be added using its separately recovered equation. Applying the floor's consumer to generic material families remains a reconstruction decision.

`web/src/source-dfg.js` exports `prepareSourceDfg(document)`, `createSourceDfgTexture(document,buffer)`, `sampleSourceDfg(texture,NdotV,perceptualRoughness)` and `SOURCE_DFG_GLSL`. The loader exposes a texture and diagnostics/disposal without changing any material. It uses `Uint16Array`, HalfFloatType, NoColorSpace, linear/clamp sampling, no mips and`flipY=false`; source row0 represents LUTv near0. Shader helper uniform is`bf2_sourceDFG`; returned RGB is unchanged. The CPU sampler mirrors normalized bilinear lookup and squared-roughness addressing for diagnostics.

```js
import {prepareSourceDfg, SOURCE_DFG_GLSL} from './source-dfg.js';
const document = await fetch('/assets/source-dfg.json').then(response => response.json());
const dfg = await prepareSourceDfg(document);
// In a separately reviewed source material hook:
shader.uniforms.bf2_sourceDFG = {value: dfg.texture};
shader.fragmentShader = SOURCE_DFG_GLSL + shader.fragmentShader;
// vec3 factors = bf2_sampleSourceDFG(NdotV, originalSourceRoughness);
// Use factors.b only where the native diffuse consumer has been established.
```

Reproduce without executing the game or using a hardware GPU:

```powershell
python tools/materials/native-dfg-generator.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-dfg-warp.ps1
python tools/materials/native-dfg-validate.py
python tools/materials/native-dfg-publish.py
cd web
node --test test/source-dfg.test.js
```

Seven focused loader/data tests pass: source-output byte identity, original shader/software-device provenance,81independent numeric comparisons, native domains/channels/row orientation, bilinear boundary behavior, float16 settings, lifecycle and malformed-data rejection. Root owns live integration and GPU validation; this worker did not run a browser.

## Ordinary GBuffer and native specular: BF2-NATIVE-GBUFFER-001

The same retained `systems/shaderprogramdb` contains exact length-delimited named deferred lighting programs, including permutation names with commas and equals signs. A prior restricted alphanumeric name scan omitted these records. `native-dfg-gbuffer.py` selects five exact names, validates the database digest and DXBC lengths, and retains bytecode/disassembly/ranges in `exports/lighting/dfg-gbuffer/`. It does not infer names from shader arithmetic. The relevant consumers are:

- `Dx11/DeferredPointLight_specular=1,skin=0,trans=0,splitLight=0,gbLayout=0`, DXBC offset6100670,6728bytes, SHA256 `de3d9773244e2457c97c34647b9b611ac3a21e834a85745818c992a810430041`.
- `Dx11/DeferredLightTileCombine_splitLight=0,gbLayout=0,distantSpecularIBL=1,reference=0,ssr=0,outdoorLight=0,localReflectionBehavior=0,indirectClear=0,secondaryCloud=0`, offset8193327,8680bytes, SHA256 `f6d46545dbcf8a4f76dd1e264b5accaba29715d737d8314b431f220793cf2569`.
- A separate tiled compute light permutation corroborates the same `.16*reflectance²`/metalness/F90 arithmetic; its full identity is retained in the manifest. The two shorter consumers above are independently interpreted for the numeric check.

RDEF names bind `g_gbufferTexture0/1/2` to the load instructions. The point shader loads them into `r2/r3/r4`, respectively. MaterialID is `round(GBuffer0.w*3)`. For ordinary materialID0 the selected component equations are:

```text
baseColor = GBuffer1.rgb
metalness = GBuffer2.y
reflectance = GBuffer2.z
diffuseColor = (1-metalness)*baseColor
F0 = mix(vec3(0.16*reflectance²),baseColor,metalness)
F90 = saturate(50*dot(F0,vec3(0.33)))
roughness = 1-GBuffer0.z
DFG = sample(g_preIntegratedFG, (saturate(NdotV),roughness²), LOD0)
specularResponse = F0*DFG.r + F90*DFG.g
indirectSpecular = sourcePrefilteredRadiance * specularResponse
```

The point shader's `movc r1.w, r0.w, l(0), r4.y` sets metalness to0 only for materialID1. Its `r4.z` reflectance is squared and multiplied by0.16, then interpolated toward baseColor using `r1.w`. The IBL consumer independently performs the same decode and samples `g_preIntegratedFG=t9` at `(NdotV,roughness²)`. Its `mul r0.y,r2.z,r3.y` and `mad r3.xyw,r4.xyxz,r3.xxxx,r0.yyyy` form F90*G + F0*R. The0.33 coefficient is an actual source literal, not1/3. There is no extra ordinary IBL multiscattering term in this permutation. Native specular occlusion, distant/interior cube selection and filtering occur separately.

Skin materialID1 forces metalness0 and has an optional special diffuse path. MaterialID2 uses GBuffer2.x as a coat parameter, scales underlying reflectance by `(1-coat)`, and adds a separate coat lobe. These special modes are excluded from the browser helper. The static evidence establishes shipped equations; actual selected game frame/permutation and GBuffer view quantization were not captured.

The floor producer `13ddb144d2` writes `o0.w=0`, `o2.xyz=(0,0,.5)`: ordinary dielectric, metalness0, reflectance.5, F0.04. Master1UV `6d0dd89b35` writes `o0.w=0`, computed `o2.y`, and `o2.xz=(0,.5)`: its computed scalar is metalness. This replaces the prior provisional interpretation; source scalar storage precision remains a browser adapter. MetalOnly can use this decoder only after independently confirming its producer's ordinary ID and reflectance outputs.

The common IBL consumer also proves ordinary diffuse `GBuffer3.rgb*DFG.b*(1-metalness)*baseColor`, with separate exposure and dynamic diffuse-occlusion factors. It loads GBuffer3=t3 into `r5.xyz`; near output it multiplies that by exposure.y, then `r3.z` (the sampled DFG.b), then decoded diffuseColor and dynamic AO/exposure.z. Master1UV `6d0dd89b35` and MetalOnly `85476b5805` both transform the tangent normal into world `r2.xyz`, then explicitly execute `dp3 r2.w,r2.xyz,r2.xyz; rsq r2.w; mul r2.xyz,r2.w,r2.xyz` **before** the probe buffer loads. Their SH normal is normalized, unlike the recovered floor forward prelighting path. Both producer outputs are `max(SH+broadSpecular,0)*packedTextureAO*cb2[40].x`. The independent producer hashes and normalization/output assertions are retained in the manifest. In the current browser adapters the source packed AO already multiplies indirect diffuse at `aomap_fragment`, so a native DFG diffuse extension must not apply that AO twice. Native tangent parity, omitted broad-specular term and GBuffer normal quantization remain distinct limitations.

An independent small vector interpreter reads the two retained original instruction slices, including destination masks, source swizzles, materialID integer comparisons and masked-float selection.1000cases spanning ordinary, skin and coat materialIDs agree with compact F0/F90 equations within2.22e-16 in double-precision algebra. This is not an assertion of float32/FMA identity or original shader execution. The manifest records selected inputs/results, algorithm boundary, hashes and ranges.

`web/src/source-environment-specular.js` exports CPU `decodeSourceOrdinaryMaterial`/`sourceEnvironmentResponse`, GLSL helpers, policy and `injectSourceEnvironmentSpecular(shader,{texture,reflectance:.5,materialId:0})`. Invoke it **after** the existing recovered-material/probe/floor `onBeforeCompile` hook and incorporate the policy version into the caller's program cache key. It expands Three's `lights_fragment_end`, replaces only the `RE_IndirectSpecular` invocation, and retains its `RE_IndirectDiffuse` invocation and any appended native floor diffuse term. The caller should keep duplicate environment diffuse disabled when native probes own diffuse illumination. It uses original `diffuseColor.rgb`, `metalnessFactor`, `roughnessFactor`, normalized geometry normal/view direction and the shared `bf2_sourceDFG` texture. It leaves direct lighting and Three's `dfgLUT` untouched.

The helper recovers the **specular response factor**, not the complete native reflection renderer: radiance still comes from the browser's Three PMREM/filtering, selected cube, normal frame and AO paths. It does not emulate skin, coat, sheen, anisotropy or iridescence. Apply it only to independently proven ordinary source material families. Six tests validate original consumer hashes, independent instruction checks, ordinary metal/dielectric endpoints, low-F0 F90 behavior, actual LUT response, existing floor-hook composition and rejected conflicts. Together with the seven LUT tests,13/13 pass; root owns live GPU validation.

```powershell
python tools/materials/native-dfg-gbuffer.py
cd web
node --test test/source-environment-specular.test.js test/source-dfg.test.js
```

## Reflection payloads: BF2-NATIVE-REFLECTION-001

The source map's `LevelData.Objects` includes non-excluded `internal:18`, referencing `Default_Lighting`, file GUID `e4b584f5-0adf-4966-9e19-34d50dfba087`, root instance `b8ef5008-1995-4c03-a5db-272fca6407a4`. That layer is enabled and its `Objects` list directly references **88 enabled, visible, baked reflection volumes**. Their exact transforms, BakedTexture pointers, influence distances and proxy flags are retained in `exports/lighting/dfg-reflection-recovery.json`.

The first two volume references near the browser's source spawn established the extraction chain below. The same verified chain was then applied to all 88 active layer volumes. Neither extraction order nor proximity establishes the native renderer's volume selection policy.

| Volume ID | Texture file GUID | Texture instance GUID | Resource ID | Source chunk GUID |
| --- | --- | --- | --- | --- |
| `14339d41-d798-4568-a4a9-2eeb15dc8730` | `e8fcc01a-8ca7-11e7-82ae-b76b4686a605` | `95726fa4-debe-0fae-86de-b1530fb7a8a0` | `7967864812206368847` | `064896ce-3db5-f6ce-3698-f8bd564786fb` |
| `f5feeb41-7a4a-45e5-a2cf-f840aaee24ae` | `9823d6a4-8ca7-11e7-82ae-b76b4686a605` | `e467b4c5-9005-ba3e-33fb-c3bec78df773` | `1638326721937072177` | `2007fcf6-8489-56eb-50a3-c5755d382273` |

The association is checked as level reference → layer root/Object membership → reflection volume.BakedTexture file and instance GUID → decoded TextureAsset.Resource → source texture RES chunk pointer. It does not depend on matching filenames.

All 88 source descriptors report `TT_Cube`, **128×128**, depth6, **R16G16B16A16_FLOAT** and firstMip0. 87 have **six mip levels** (128,64,32,16,8,4), each **1,048,320 bytes**; volume `f7ea4e16-c9a0-413f-99ba-a90c272a2c28` has only mip0, **786,432 bytes**. Every half float is finite. The first two source RGB peaks are `[13736,13864,14296]` and `[7964,8880,12216]`; these are HDR values and retain source scale. Alpha is exactly1 throughout the first two payloads, but varies in others; every alpha bit is preserved without assigning unproven AO or sky-mask semantics.

Native chunk data is mip-major, then face index0..5, with tightly packed little-endian RGBA binary16 pixels. The report supplies every face/mip byte offset and range. DDS files in `exports/lighting/dfg-reflection-dds` reorder to face-major then mip-major. Validation compares every DDS payload byte to its source slice and verifies the DX10 DDS format10 / cube flag. No resizing, compression, gamma conversion, brightness scaling, pixel filtering or mip regeneration is performed.

The raw chunks are in `exports/lighting/dfg-reflection-raw/raw/chunk/`; raw TextureAsset EBX and texture RES bytes plus metadata are preserved alongside them. The pre-export budget in `dfg-reflection-export-budget.json` estimated 92,252,160 bytes from 88 exact references and reserved 350 MiB for three retained copies plus evidence. Actual native payloads total **91,990,272 bytes** (87.73 MiB), below the 100 MiB payload cap. All 88 chunk GUIDs and SHA-256 hashes are distinct; the browser publisher deduplicates identical hashes if encountered. DDS and public binary copies plus raw payloads total approximately 263.2 MiB before small descriptors/evidence.

Reproduce validation:

```powershell
python tools/materials/native-dfg-reflections.py
```

The native map uses source absolute coordinates, with no origin/Z conversion currently. The retained source volumes enable proxy reprojection and use influence fade distance0.5. Subsequent [native sampling recovery](native-dfg-reflection-sampling.md) establishes the local cube binding, ray/LOD equations, filter roughness table, face orientation and ordered overlap arithmetic. CPU construction of GPU volume fields, their ordering, runtime capture exposure and selected proxy behavior remain unresolved. The floor forward PS itself does not sample a cube.

## Browser module and handoff

`web/src/source-reflections.js` exposes `prepareSourceReflections(renderer, document)`, returning `{update(position, scene), snapshot(), dispose()}`. It changes only `scene.environment`. It never changes scene background, intensity, meshes, geometry or materials. Preparation fetches native payloads and filters original mip0 through Three PMREM; native prefiltered mips are retained in public files for later sampler recovery, not filtered a second time. GPU preparation has not been exercised by this worker because the root agent owns the active browser validation window.

```js
import {prepareSourceReflections} from './source-reflections.js';
const document = await fetch('/assets/source-reflections.json').then(response => response.json());
const reflections = await prepareSourceReflections(renderer, document);
// Each frame, after camera movement; position must be source absolute XYZ.
reflections.update(camera.position, scene);
// Expose reflections.snapshot() in diagnostics; call dispose() on map teardown.
```

Payloads use `Uint16Array` with `THREE.HalfFloatType`, `RGBAFormat`, `LinearSRGBColorSpace`, `flipY=false`, no generated mipmaps and no gain. They preserve source row order and infer the conventional face order +X,-X,+Y,-Y,+Z,-Z. Local Three 0.186.1 `PMREMGenerator._textureToCubeUV` normally negates X for externally loaded cube textures. The documented `WebGLCubeRenderTarget.texture.isRenderTargetTexture` convention bypasses that negation; this module sets the convention flag on the data cube without claiming it was allocated as a render target. `WebGLTextures.setTextureCube` and `uploadCubeTexture` still upload its six DataTexture images. Native capture orientation remains an explicit inference, rather than silently reflecting global source X.

The selector uses only enabled, visible, baked volumes in the non-excluded active lighting layer. It composes source layer and volume transforms, infers local box extents [-1,+1] or unit-radius sphere, and selects the smallest containing volume. It restores the previous environment outside coverage and on disposal; it never substitutes a distant nearest cube. All 38 retained team/neutral spawn coordinates fall within available volumes. This is one camera-selected environment for the scene, not native per-object overlap blending or proxy reprojection.

**Integration requirement with native SH:** Three's standard environment path contributes diffuse IBL as well as specular. Existing native probe materials add source SH after `lights_fragment_maps`. At that integration point, clear `iblIrradiance` when a source environment is active to avoid duplicate environment diffuse; leave `radiance` intact. The reflection module deliberately does not alter materials. The separate native DFG/specular helper above can replace Three's response factor on proven ordinary source materials; other families retain Three's DFG/multiscattering adapter.

Memory budget: raw downloads total 87.73 MiB; 88 PMREM atlases at face size128 are 384×512 RGBA16F, approximately 132 MiB GPU storage. Preparation also uses one temporary 128-face cube (~0.75 MiB) plus shared PMREM scratch targets. CPU source buffers are released after preparation; original files retain all mips. Switching volumes changes only the scene texture and does not regenerate PMREM or clone materials. At present all 88 are prepared eagerly; no second GPU/browser run was launched during this worker's implementation.

Rebuild and verify:

```powershell
python tools/materials/native-dfg-reflections.py
python tools/materials/native-dfg-browser-reflections.py
cd web
node --test test/source-reflections.test.js
```

The eight tests check original GUID/matrix association, SHA-256 and every byte of all 88 payloads/all native mips, binary16 HDR peaks and orientation flags, the real single-mip exception, all 38 spawn positions, transformed unit box/sphere selection, disabled/unavailable volumes, malformed payload rejection, scene-only updates, restoration and cleanup after partial preprocessing failure. Native game rendering was not executed during this investigation.
