# Native direct lighting and IES

Evidence **BF2-NATIVE-DIRECT-LIGHT-001**. This is a bounded static recovery from the original executable and shipped shader database. No native game execution or browser GPU test was performed for these additions. Existing shared runtime files were not changed. Follow-up **BF2-NATIVE-DIRECT-PRODUCER-002** in `native-direct-producer-analysis.md` closes EntityData field linkage, native intensity/IES conversion and punctual classification, and provides a conservative217-light configuration subset.

## Retained source and helpers

- `exports/lighting/direct-light-evidence.json` records original executable function hashes, four exact DXBC permutations, selected-map counts and IES provenance.
- `tools/materials/native-direct-shaders.py` reproduces the four shader extractions from the retained original `systems/shaderprogramdb` (SHA256 `110d7169cb6f70559f8ecea0819e26b1df4fb66e0649f95bdeea033ef44ef898`).
- `tools/materials/native-direct-evidence.py` checks executable/asset bytes, native format metadata and resource references, then publishes only the original 32 KiB IES texel payload and manifest.
- `web/src/source-direct-light.js` contains isolated CPU/GLSL equations. Inputs are **native GPU light/material fields**, not a claim that all exported entity fields already have those units. It has no material hooks or scene mutations.
- `web/src/source-ies.js` creates a half-float texture for the one recovered map profile. It applies no header-derived gain, `IESMultiplier`, luminous-unit conversion or BRDF.

The shader names share `Dx11/DeferredTiledLightingCS_splitLight=0,gbLayout=0,lightType=N,reference=0,materialPassType=0,volumetricShadowMaps=0,dynamicAO=0,translucency=0,cbv=1`:

| N | RDEF light structure | Resource | DXBC SHA256 |
|---|---|---|---|
| 0 | AreaLightInfo, 144 bytes | structured t15 | `541540519a3d72bdb52e44c0ed6c8591a84ecea71a5edae43aea7ca58efd5119` |
| 1 | AreaShadowLightInfo, 336 bytes | structured t16, IES t9, shadow t21 | `add4e7a51638387aff0c37461a7abccdc8dfb4ae7ed75f8b159468bbbe6ba5b6` |
| 2 | PunctualLightInfo, 112 bytes | cbuffer byte704 onward | `c924f450f0e9384a5df6617d404b304dac4ffc0b0fd72ff47cbed3f2815f69b8` |
| 3 | PunctualShadowLightInfo, 304 bytes | cbuffer byte704 onward, IES t9, shadow t21 | `a61cab9738c12e1b993c32ff96dddc0f96c7942a6b4716aa4ef83e491c8c25b9` |

Presence of these permutations is not a captured native frame selection. In particular, entity names Sphere/Spot do not prove dispatch to the punctual path: finite sphere/disc/rectangular shapes have separate area equations. The browser currently approximates all of them with Three point/spot lights.

## Runtime light fields and attenuation

Native builder `0x140f86150:0x140f8630d` consumes a light runtime record and writes the 96-byte `BaseLightInfo` shared by all four structures. Its parent `0x140f85240:0x140f85f9e` selects light records at `renderContext+0x560`, stride `0xae0`. Category values used by this CPU list differ from shader lightType values: category0 writes punctual112-byte records,1 writes punctual-shadow304,2 writes area144,3 writes area-shadow336. Do not equate those enumerations.

| GPU offset | Meaning | Builder source |
|---|---|---|
| 0 | camera-relative position | record+0x30 minus camera origin |
| 12 | inverse squared radius | `1 / record[0x70]^2` |
| 16 | RGB light color | caller-prepared RGB; raw record+0x40 is adjusted for fades and exposure compensation in parent |
| 28 | attenuationOffset | record float+0x74, copied unchanged |
| 32 | matrixForward | record basis+0x20, unchanged |
| 44 | diffuseScale | record float+0xa4 |
| 48 | matrixUp | record basis+0x10 |
| 60 | specularScale | record float+0xa8 if renderer flag+0x542; otherwise0 |
| 64 | matrixLeft | record basis+0x00 |
| 76 | shadowDimmer | caller parameter, including source fade |
| 80/84 | angleScale/angleOffset | equation below for runtime light type1; otherwise1/2 |

For punctual shading, `L=normalize(lightPosition-surfacePosition)`, `d2=dot(delta,delta)`, `q=d2*invSqrAttenuationRadius`:

```text
distanceAttenuation = max(1-q*q,0)^2 / max(d2+attenuationOffset,float32(.0001))
coneAttenuation = saturate(dot(matrixForward,L)*angleScale+angleOffset)^2
lightWeight = distanceAttenuation * coneAttenuation * saturate(dot(N,L))
```

The CPU builder reads runtime angles+0xabc/+0xac0, multiplies each by `.5*pi*(1/180)` and calls the imported `cosf` (`0x141e72ff0`, IAT `0x142fc01e8`). It computes:

```text
angleScale = 1 / max(cos(inner/2)-cos(outer/2),float32(.001))
angleOffset = -cos(outer/2)*angleScale
```

The follow-up producer proves `outer=clamp(sourceOuter,1,179)` and `inner=min(sourceInner,sourceOuter-float32(.001))` before this builder. For non-spot runtime lights `(scale,offset)=(1,2)` makes cone attenuation1 for normalized directions. Source spot emission is opposite matrixForward because L points from surface to light.

Three0.186 uses the same finite radial window at decay2, but clamps its denominator to `.01`, omits attenuationOffset and uses smoothstep between cosine limits. The adapter's linear ratio of InnerAngle/OuterAngle cannot reproduce the source squared cosine ramp. Four map spot descriptors have InnerAngle greater than OuterAngle; the native producer clamps inner before the runtime builder's additional `.001` cosine-difference floor.

Selected export contains340 enabled positive-intensity PBR light descriptors:221sphere,101spot,18rectangular. All use LuminousPower.20 have nonzero AttenuationOffset:1,5,10,40,150,160. At d=1 with no finite cutoff, offset160 divides irradiance by161 relative to offset0. The follow-up producer proves this field reaches runtime+0x74 and GPU+28 unchanged.

## Ordinary punctual BRDF

The helper targets ordinary native materialID0. Decode matches existing GBuffer evidence:

```text
diffuseColor=(1-metalness)*baseColor
F0=mix(.16*reflectance^2,baseColor,metalness)
F90=saturate(50*dot(F0,vec3(.33)))
nv=abs(dot(N,V))+float32(.00001)
nl=saturate(dot(N,L)); nh=saturate(dot(N,H)); lh=saturate(dot(L,H))
alpha=max(perceptualRoughness^2,float32(.002)); a2=alpha^2
D=a2 / (1+nh^2*(a2-1))^2
Vis=.5 / (nv*sqrt(a2+nl^2*(1-a2))+nl*sqrt(a2+nv^2*(1-a2)))
F=F0+(F90-F0)*(1-lh)^5
specularBRDF=D*Vis*F/pi
fd90=roughness*(.5+2*lh^2)
fd=(1-.33774834871292114*roughness)
   *(1+(fd90-1)*(1-nl)^5)*(1+(fd90-1)*(1-nv)^5)
diffuseBRDF=diffuseColor*fd/pi
```

Original DXBC float constants were checked in the bytecode: inverse pi is `0.31830987334251404`, diffuse energy coefficient `-0.33774834871292114`. The helper keeps original source roughness; Three may add its own geometric roughness or minimum. This direct diffuse term is Burley/Disney, not Lambert. There is no DFG lookup in this punctual consumer.

Each BRDF channel receives RGB color, the lightWeight and its own diffuseScale/specularScale. Type3 multiplies both by IES and shadow terms. The final sum receives `g_exposureMultipliers.z` and a65504 upper clamp. Browser exposure must be applied once by the shared HDR pipeline; no additional exposure is added by these helpers.

The recovered shadow consumer uses projected atlas coordinates, comparison sampling and multiple quality branches. The fully sampled shadow value `s` is blended as `1+shadowDimmer*shadowAngleAttenuation*(s-1)` when its facing/enable conditions pass, then multiplied by IES. Follow-up `native-shadow-analysis.md` closes source settings, requested resolution, atlas size/format preference, four-pixel border, spot projection parameters and filter-quality binding. Caster raster state, comparison sampler and per-view/cache selection remain unresolved; browser shadows are not activated.

## IES resource and exact upload chain

53 selected-map lights reference the same **IesProfileAsset**, not TextureAsset:

```text
Lighting/Textures/T_Lamp_01
file GUID 6ebdd766-34cc-11e7-ae3d-ae12865b6fab
class GUID a0573a2a-e928-fed7-45df-68775c56324e
SourceResource12614494969977180257
IesResource SHA1 ea7354cb1a9d5527d7083d33070b0c272b7d7c9a
decompressed RES SHA256 9bc7c5e110883ae386307917222666023482daf9a537c0063415d2f8b334a45b
```

The bounded graph and raw extraction are under `exports/lighting/direct-ies`. RES metadata is `20800000040000000000000000000000`:32800 main bytes and4 relocation bytes. Main header: u32dimension128 at0, floats6.749266147613525 and19.0513916015625 at4/8, relocatable pointer32 at12, payload starts32. Trailer contains pointer-field offset12. Payload is16384 original half-float words; every128-texel row is longitude invariant, range0.000017642974853515625..0.994140625. Physical header scalar labels remain unknown, but their exact light-color arithmetic is now recovered in the producer follow-up.

The source association is independently supported by the native resource path:

1. `IesResource` type metadata points to resource factory vtable `0x14332b840`; its load method is `0x1464afe30:0x1464aff08`.
2. Loader fixes up the resource and queues the pointer at resource+0xc through `0x14144f1c0:0x14144f2f0`, storing it unchanged in a40-byte array-manager queue record at+0x10. It returns an array layer index in the resource object+0x20.
3. `0x140a87360:0x140a873dc` initializes the same manager (`global0x1445e3510`, array0 at+8) through `0x141453c30`, explicitly passing RenderFormat30 and settings fields+0x18/+0x1c.
4. Native enum metadata `0x144dee0f0` associates value30 with `RenderFormat_R16_FLOAT`. Metadata `0x144df0e40/+0x18` names the settings `IesTextureSize` and `IesTextureArraySize`; constructor `0x142de2b00:0x142de2b2f` defaults them to128 and64.
5. `0x14144b3d0:0x14144b5ec` creates a square128 texture array,64layers, one mip, format30 and records dimensions/format in the manager. These defaults are not claimed as a captured runtime settings value; the original resource itself is128square.
6. Update `0x14145e550:0x14145e69f` passes the queued original pointer directly to the renderer update method, subresource selected by layer index, mip0, row pitch `bitsPerElement/8*width` (256 forR16F). It applies no normalization, conversion or gain to texels.

Type3 RDEF binds `g_iesTextureArray` at t9 and `g_linearLongitudeWrapSampler` at s2. The scalar texture channel is R, level0. Let D=-L be normalized light-to-surface direction, x=dot(matrixLeft,D), y=dot(matrixUp,D), z=dot(matrixForward,D):

```text
u=atan2(y,x)/(2*pi)    // native polynomial atan2 approximation retained by helper
v=z*.5+.5             // equal-area latitude, NOT acos(z)/pi
profile=Texture2DArray.SampleLevel(s2,vec3(u,v,iesTextureIndex),0).r
```

The native approximation is undefined for x=y=0; standalone helper selects u0 at poles. The actual selected profile is longitude invariant, so this convention cannot change its value. Native sampler descriptor is not yet recovered. Linear filtering/U repeat follow the source sampler name; browser V clamp is explicit inference. No vertical flip or sRGB conversion is applied.

## Browser handoff and validation

Run `python tools/materials/native-direct-evidence.py`, then fromweb `node --test test/source-direct-light.test.js test/source-ies.test.js` (10pass). Tests include2000 independent native-register BRDF algebra comparisons,1000 angular coordinate comparisons, exact all16384 uploaded texture words, content hash and selected-map reference closure. These are CPU/descriptor checks, not native float32 GPU execution or a GLSL compile test.

`await loadSourceIes()` returns `{texture,document,dispose}`. `source-direct-light-config.js` now supplies validated source axes and pre-view radiometric color.37selected lights have IESMultiplier50,16have25; none use UseIESProfileAsMask. Native color uses `Color*header4*IESMultiplier*Dimmer` for these lights, with no power/area division. Sample the unchanged raw profile once through `bf2_iesUv(...)`; do not multiply header or multiplier gains again.

Do not replace Three's direct light model for arbitrary area/skin/coat materials. For a proven punctual ordinary material, replace its direct BRDF once and retain channel switches once; pass source roughness before Three's alterations. Geometry/world transforms, renderer light ordering, effect lights, finite area paths, atlas shadows and native light selection remain the caller's responsibility. No shared runtime was modified here.

## Strict-positive punctual weight branch — 2026-10-15

The retained original type2 instructions at disassembly lines248–249 and type3 lines275–276 test `0 < distanceAttenuation * coneAttenuation * saturate(NdotL)` before half-vector normalization and BRDF evaluation. The else branch explicitly supplies zero diffuse and specular. The browser adapter now retains this boundary before IES evaluation (the selected finite source profile cannot change a zero contribution). This prevents evaluating an undefined opposing half-vector for a back-facing light and skips unused BRDF work. No epsilon or additional distance threshold is introduced. Shader source hashes remain those listed above; no new native execution claim. `native-direct-check.mjs` includes radial cutoff/outside, cone-outside, grazing normal and exact opposing-half-vector cases, with and without the original IES profile.
