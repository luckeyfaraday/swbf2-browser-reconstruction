# Native static illumination and shadow checkpoint

Evidence: `BF2-NATIVE-STATIC-ATLAS-001`, reproducible with
`python tools/materials/native-static-atlas-evidence.py` and
`python tools/materials/test-native-static-atlas.py`. Companion hash, binding,
UV, WARP-validation and pre-exposure evidence now connects original atlas data
to placed meshes. The original game executable was not run. Parent owns browser
integration; the recovered original pixel shader was executed unchanged on
D3D11 WARP for independent equation validation.

## Direct-light integration review

Reviewed `source-direct-adapter.js`, `source-light-channels.js`, `lighting.js`,
`main.js` and `test/native-direct-check.mjs` against the native producer and
consumer in `native-direct-producer-analysis.md` and `native-direct-light-analysis.md`.
No concrete integration mismatch was found within the supported 217-light scope.

The shader receives prepared native RGB with Three intensity 1, uses the original
point/spot color rather than Three's already-attenuated `directLight.color`, and
recomputes source distance/cone/IES factors. The raw source basis is compared
with a world-space surface-to-light vector; IES uses the opposite vector. The
source diffuse/specular gates each apply once. The light pools have no shadows
or maps, and appended effect lights retain the fallback. Floor's native forward
PS normalizes its normal before direct lighting; its unnormalized SH evaluation
does not justify an unnormalized direct-light normal.

Parent's retained `web/test-results/actual-map-native-punctual.json` reports 217
promoted source lights, 53 IES lights and the expected exclusions. The independent
144-case GPU fixture reports maximum RGB error 2.9e-7. Its fixed camera and plane
do not exercise arbitrary camera rotations, model transforms or all original
source records. A rotated-camera case would strengthen world-axis coverage;
this is a test limitation, not an observed runtime defect.

## Actual selected-map textures

The selected `StaticEnlightenData` file
`53c17a19-c90a-11e6-bf1d-a6092bb9b8be`, class
`ed535c72-5527-cb51-c9e3-bf95c901e0c7`, references five exact TextureAssets.
Their EBX file/class identities, RES headers and chunk GUIDs are preserved in
`exports/lighting/static-atlas-evidence.json`.

All five are 5232×4908, one mip, one slice. The source irradiance format is
`RenderFormat_BC6U_FLOAT` (enum 64); directionR/G/B and sky visibility use
`RenderFormat_BC7_UNORM` (enum 66). Values were obtained from the pinned installed
profile SDK enum, not inferred from byte count. Each payload is 25,678,656 bytes;
the total is 128,393,280 bytes (122.45MiB). All five complete chunks are now
retained in `static-atlas-chunks`, with unchanged BC blocks and hashes.
Bounded exact block crops were decoded to float32 on D3D11 WARP, preserving HDR.

The paired dynamic Enlighten database 8785653264462149711 has 17,703 sorted,
unique uint32 keys. Every 32-byte instance record stores one entry, an exact
contiguous pointer to a 32-byte transform record, then zero reserved words.
The transform records occupy 566608..1133104, ending exactly at the previously
validated probe-volume array. All values are finite; off-diagonal and final
two lanes are zero. Scale terms multiply by source texture dimensions to
integer pixels within 3.35e-5; offsets land on half pixels within 0.000966.
There are 1,048 zero-scale records and some negative half-pixel offsets. These
must be preserved rather than clamped into guessed texture rectangles.

`static-atlas-bindings.json` preserves all native keys and floats. Their
interpretation as UV transforms is independently supported by those pixel
units and the reachable native shader below. Mapping them to particular
rendered instances is proven by the native hash producer and lookup below.

## Native atlas shader witness

Exact floor shader permutation `f789fdaafa` is already retained in
`exports/materials/floor-shader`. It contains:

```
atlasUv = v1.xw * v3.zw + v3.xy
I = sample(t2, atlasUv).rgb * cb2[41].y
D[r/g/b] = 2 * sample(t3/t4/t5, atlasUv).rgb - 1
```

It normalizes the floor material normal before atlas evaluation. Each color's
direction coefficient follows this source arithmetic, where the displayed
decimal constants are DXBC disassembly approximations:

```
l = length(0.488603 * D)
if l == 0: weight = 0.282095
else:
    t = (1 + dot(N, normalize(D))) / 2
    weight = 0.282095 + (2*l/(l+0.282095))*0.282095
             * ((2*t^3 - t^4)*3.333333 - 1)
```

The shader also builds a dominant-direction specular term from the average of
the three decoded direction vectors. Thus these textures cannot be installed
as a plain Three lightmap or as a generic ambient-occlusion multiply. It writes
the directional diffuse plus that baked specular contribution to `o3.rgb`,
multiplied by `cb2[40].x`, and writes the scalar sampled from `t6.r` to `o2.w`.
The latter is source sky visibility, not a direct-light shadow atlas.

`native-static-atlas-binding.py` proves all40 texture bindings across eight
original floor function instances: t2..t6 are native named selectors18..22,
irradiance, RGB direction and sky visibility. All eight s0 samplers resolve to
`9216198462`, bytes16..19 `15 03 03 01`: standard DX11 min/mag/mip linear,
clamp U/V and wrap W. Native packed-descriptor conversion is not decompiled.

Original wall mesh declaration44bytes places RadiosityTexCoord Half2 at40,
following TexCoord0 at36. Input layout `21d0b76a8c` maps TEXCOORD4 Half4 at36;
VS `7a0e7a0699` copies v4.zw to atlas UV. Thus the exact source equation is
`nativeRadiosityUV * transform[0,3] + transform[4,5]`, without a V flip.
Parent's broader extractor retains668 sections,279 assets and347 asset/LOD
pairs with vertex counts, ordinary UVs and indices matching existing GLBs.

The unchanged original PS was run against an exact16×16 source-block crop in
nine normal/smoothness cases. Independent `native-static-atlas-validate.py`
matches all2,304 retained samples with maximum normalized residual5.8138e-5;
the residual comes from float32 lobe cancellation near dark directions.
Sky outputs match t6.r exactly in all cases. Original center irradiance is
[125.375,178.625,242.5]; crop maxima are[4420,5164,6652]. The lobe parameter is
native **smoothness**, not browser perceptual roughness. Parent's JS/GPU helper
matches all2,304 original WARP samples with maximum normalized residual9.0868e-6.

## Native identity and loader seeds

The executable's `ModelStaticState` descriptor at 0x144b77990 has field table
0x144dcbfe0. `LightmapHash` is explicitly named at field entry 0x144dcc0b8,
with byte offset 0x30 and uint32 type. Writer `14092b8a0` calls native hash
`140933db0:1409341c1`, then marks change bit0x200. The hash uses original
MeshAsset primary class GUID plus the original absolute transform: translation,
quaternion, positive basis lengths and determinant sign. Its60-byte payload
uses float32 quantization `trunc(value*scale + .4999000132083893)` with scales
100,10000,100, then FNV-1 multiply-before-XOR. Negative values truncate toward
zero. `native-lightmap-hash.py` reproduces5,516 exact source instance matches.
Browser origin offsets must not be used in this hash.

Native lookup `140fcb7e0` matches the runtime database identifier and performs
binary search in the same uint32 table. First witness: instance0 key2660280470,
atlas record915184. This proves association independently of visual appearance.
Zero-scale records and atlas-edge sampling remain original data, not errors to
repair with guessed UV bounds. Detailed match evidence is retained in
`static-atlas-instance-matches.json`.

The bounded original resource chain is retained in
`exports/lighting/dfg-native-functions`:

- `140da52b0` registers Enlighten resource factories when renderer enable gates
  allow them; the disabled branch names `EnlightenDatabase` and
  `EnlightenStaticDatabase` explicitly.
- Factory `140fa3420` installs vtable 0x1433335f8. Its loader `1464b5a30`
  resolves the resource bytes and constructs `140fa27c0`.
- `140fa27c0` retains that dynamic database at runtime offset 0x18 and reads
  the already-validated volume count at resource+0x4c and pointer at+0x50.
  Its optional dynamic atlas creation is gated by resource flags; it does not
  establish the static-key lookup.
- `140fa5850` gathers a static database and up to five texture resource handles
  from the static state. Upstream entity-state linkage is not yet decoded.

The map's `EnlightenShaderDatabaseResource` 12714270954211472099 was narrowly
extracted (71,232 bytes). Its role in instance-key/UV selection is unproven.
No broad level extraction or global disassembly was performed.

## Direct shadow gate

`140dac920` is called by the proven canonical direct-light producer
`140d879e0`. It starts with shadow/secondary flag false and resolution 0.
Shadow capability must be enabled; staged CastShadowsEnable byte+0xd5 must be
true, and the staged CastShadows quality at+0 must differ from Disabled 5.
The renderer context quality at+0x368 (punctual) or+0x36c (finite area) must
meet the requested quality. A separate staged quality at+4 is compared with
context+0x3d0/+0x3d4 for the secondary flag; its field name remains unresolved.
When shadows are enabled, staged resolution class+0xb4 selects context values
at+0x32c,+0x330,+0x334,+0x338 for classes 0..3.

These are original gate equations, not source shadow-map projection or bias.
Native depth rendering, cache population, filter kernel, quality values and
the selected shadow resource bindings remain missing. Preserve the current
explicit shadow fallback. The spatial irradiance atlas is a concrete route to
recover surface variation. Parent's floor integration now reports493 matched
placements and26 compiled atlas programs, without shader errors.

## Native bake pre-exposure

`native-static-atlas-preexposure.py` publishes the runtime document
`web/public/assets/lighting/static-atlas-preexposure.json`: schemaVersion1,
value1.0, evidence `BF2-NATIVE-STATIC-ATLAS-PREEXPOSURE-001`.

The original CPU route is database payload+0x0c → getter `140fc2380` →
`140db2f60` / setter `140da9450` → render context+0x3218 → `140ff0180` →
view+0x2d98 → `140d8af90` / `140daa4c0` → builder `140d853b0` argument7.
The builder stores `[argument7,1/argument7,1,1]` at common block+0xa0.
Original RVM executor `1415d7710` dispatches selector28 to `1415d44c0`, which
copies exactly this16-byte vector. The pinned SDK names selector28
`ShaderConstantFunction_LightMapPreExposure`.

Selected database bytes are `00 00 80 3f`; the complete native vector is
[1,1,1,1]. The original PS multiplies irradiance by cb2[41].y, so the selected
map factor is exactly1.0. Generic device constant-buffer packing is not
reproduced here; all four source lanes are identical for this map. Current
frame exposure cb2[40].x is separate and should not be applied twice in the
browser HDR/presentation pipeline. Do not reuse1.0 for another database without
reading its header and selection.

The executor also corrects an earlier metadata label: each LegacyInstructionData
first uint32 is an input handle (low ushort scope, high ushort slot). Former
"kind5" and "kind0x25" are input slots, not opcodes. The actual dispatch selector
is uint16 at+0x10. Selector122 calls `1415d7310` and copies the DFG resource
pointer from source input+0x58. The DFG evidence is corrected accordingly.

## Sky visibility consumer boundary

Ordinary deferred combine consumes GBuffer3 through DFG.b, nonmetal diffuse
color and screen diffuse AO. Atlas lighting replaces the probe value in this
role; adding both would double indirect light.

In `dfg-gbuffer/combine-ibl.asm`, the common/distant cube path uses GBuffer2.w:
`a = min(screenDiffuseOcclusion, max(skyVisibility, g_skipSkyVisibilityAsAO))`;
`specOcc = saturate(a + pow(a + NdotV, exp2(-16*roughness^2 - 1)) - 1)`.
It multiplies common/distant IBL and participates in an optional interior-IBL
fade. Atlas diffuse separately uses screen diffuse AO; sky visibility is not
a general diffuse or punctual-light shadow factor. `combine-basic` ignores
GBuffer2.w. The separate local reflection-volume consumer remains under
investigation; this common/distant witness must not be generalized to it.
