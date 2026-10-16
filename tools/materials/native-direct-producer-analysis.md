# Native direct-light producer and conservative integration subset

Evidence **BF2-NATIVE-DIRECT-PRODUCER-002**, independently byte-checked by `native-direct-producer-evidence.py`. The original executable is read only. This recovery used bounded static Ghidra disassembly/decompilation; it did not execute the game or a browser GPU test. The report is `exports/lighting/direct-producer-evidence.json` and contains 19 original function byte hashes, native field metadata, scalar constants and every eligible source identity.

## Complete field linkage

The type-checked factory `0x14103ea30:0x14103f054` compares the input EntityData type with the native sphere TypeInfo `0x144b8cb70`, initializes a SphereDynamicState through `0x142d2d220`, then populates it through `0x142d928f0`. The adjacent spot branch initializes `0x142d2dce0` and populates through `0x142d933a0`. Native class metadata names the source fields independently of the decompiler. Entity metadata: sphere `0x144b884b0`, spot `0x144b86eb0`; dynamic struct metadata: sphere `0x144b765b0`, spot `0x144b76850`.

| Field | Sphere EntityData → DynamicState | Spot EntityData → DynamicState | Staging → runtime record → BaseLightInfo |
|---|---|---|---|
| Color | `70 → 00` | `70 → 00` | `50 → 40 → 10`, intensity/Dimmer and per-view color conversion described below |
| Intensity | `b0 → 40` | `c0 → 50` | `80`, multiplied by dynamic IntensityMultiplier first |
| Dimmer | `e0 → 70` | `f0 → 80` | `8c`, multiplies final runtime RGB |
| AttenuationRadius | `b8 → 48` | `c8 → 58` | `88 → 70 → 0c`; final GPU value is `1/radius²` |
| AttenuationOffset | `bc → 4c` | `cc → 5c` | `90 → 74 → 1c`, unchanged |
| SphereRadius / DiscRadius | `a8 → 38` | `a8 → 38` | `f8 → ac4 / ab8`, classification and minimum area radius below |
| InnerAngle | — | `ac → 3c` | `fc → abc`, then GPU cosine scale/offset |
| OuterAngle | — | `b0 → 40` | `100 → ac0`, then GPU cosine scale/offset |

All table offsets are hex. Gathering functions `0x140df6870` (sphere) and `0x140df6b20` (spot) copy DynamicState into staging. Wrappers `0x140f34180` and `0x140f34250` add source shape/IES fields and call the canonical runtime producer `0x140d879e0:0x140d88823`. `0x140f86150` later builds the shared GPU structure. The source axes are copied unchanged throughout: matrix column0 becomes `matrixLeft`, column1 `matrixUp`, column2 `matrixForward`. The name “Left” does not authorize negating the source first column.

The dynamic constructors independently set IntensityMultiplier to1 (`sphere+94`, `spot+a4`) and IsEnabled to true (`sphere+b0`, `spot+bf`). Their initial gather condition is enabled and `(Color.r+Color.g+Color.b)*Intensity*IntensityMultiplier*Dimmer >= float32(.00001)`. The three executable coefficients at `0x14301eea0/a4/a8` are each1; this gate is an RGB sum, not perceptual luminance. It precedes IES intensity replacement.

## Property overrides and the subset boundary

The generated initializers directly copy AttenuationOffset, LightUnit and several static fields. They resolve Color, Intensity, Dimmer, source radius, angles and other connectable properties through `0x14019deb0`, then `0x140196360`. The resolver saves the EBX field address as its fallback. It can replace that address through an active global/context property or an entity property lookup. The latter is gated by `((EntityData.Flags >> 27) & contextMask & 3) != 0`. Native `DataBusPeer` metadata `0x144a2fa00` proves Flags lives at offset18; the exported SDK property is inherited from that same named base type.

This establishes the field-to-field mapping; it does not establish the value of every connected property in a running native frame. The conservative helper excludes descriptors with Flags bits27/28. Absence of these bits also does not prove that later activation events or global/context overrides never occur. It means the supplied export is used as an explicit initial static baseline.

The selected map contains340 descriptors. The independently computed, nonoverlapping partition is:

| Category | Count |
|---|---:|
| Supported static, unshadowed punctual candidates | 217 |
| Punctual with property-override flags | 49 |
| Shadow-quality-dependent punctual spots | 52 |
| Finite discs | 4 |
| Rectangular / unsupported shape | 18 |

The supported set is177 sphere lights and40 spots, including all53 IES lights. Four finite discs also have override flags: subtracting all55 flagged descriptors from266 otherwise eligible lights would double-count those four and the two rectangular descriptors. If callers explicitly allow exported fallback values for connectable properties, the supported baseline expands to266. The default remains217. **Rejected records must remain on the caller's existing approximation path; do not delete them from the scene.**

## Punctual versus finite area

Leaf `0x140f8ce10` returns exactly `radius == 0 && LightUnit != 1`. Native enum metadata `0x144df9958/0x144df9970` proves unit0 is LuminousPower and unit1 is Luminance. The canonical producer calls this leaf with SphereRadius or DiscRadius, writes the result to runtime byte`b6`, then clamps an area emitter's radius to at least float32(.01). This classification happens **before** an IES profile forces effective unit1. Thus a zero-radius LuminousPower sphere with a valid IES profile remains punctual; a zero-radius Luminance sphere is a finite area emitter with radius.01.

All221 selected spheres have radius0/unit0;97 of101 spots have disc radius0/unit0. The remaining four discs have source radius2.379. They cannot use the recovered punctual BRDF. Helpers `0x140f7b6a0` and `0x140f7b6c0` return:

```text
sphere areaFactor = punctual ? 4 : float32(4*pi)*radius*radius
disc   areaFactor = punctual ? 1 : float32(pi)*radius*radius
```

The CPU GPU-record builder uses list category0/1 for punctual112/304-byte records and2/3 for area144/336. Those differ from DXBC lightType2/3 (punctual) and0/1 (area). The producer's punctual flag and shape restrictions are source-proven; the exact view-list insertion and selected native frame permutation were not observed. Do not infer shadow activation or shader list membership merely from an IES profile name. The isolated browser adapter uses the proven unshadowed equations and IES term without claiming a captured native dispatch.

## Radiometric conversion and IES

`0x140f7b640` computes source runtime color from effective intensity and unit:

```text
scalar = Intensity * dynamicIntensityMultiplier
if validIESResource:
    scalar = UseIESProfileAsMask
        ? scalar * IESHeaderFloatAt4 / IESHeaderFloatAt8
        : IESHeaderFloatAt4 * IESMultiplier
    effectiveUnit = Luminance(1)
else:
    effectiveUnit = sourceLightUnit
if effectiveUnit != Luminance:
    scalar /= areaFactor * float32(pi)
runtimeColor = Color * scalar * Dimmer
```

IES branch arithmetic is independently contained in `0x140f7b620`. The canonical producer reads the two floats from the exact resolved IES resource's data pointer at resourceObject+18; texture layer validity is resourceObject+20. The same resource/load association and raw texels are documented in `native-direct-light-analysis.md`.

For the one selected map profile the original header values are6.749266147613525 and19.0513916015625. All53 source uses have UseIESProfileAsMask=false;37 have IESMultiplier50 and16 have25. Their scalar is therefore337.4633… or168.73165… before Color/Dimmer, independent of ordinary Intensity after the initial gather gate. **Do not apply sphere4π/spotπ conversion, IESMultiplier, or header gain again in the shader.** The original raw texture supplies only the directional factor. Physical names of the two header scalars remain unknown; their arithmetic role is proven.

Non-IES punctual sphere color is `Color*Intensity*Dimmer/(4π)`; punctual spot color uses `/π`. Area radiometry is included in the standalone math helper for evidence/tests, but area shading is deliberately excluded. The native per-view parent `0x140f85240` additionally applies screen/distance fades and exposure compensation. All340 exported ExposureCompensation values are0 and Dimmer values1. Screen fades, renderer light selection and global specular-enable remain separate runtime limits.

## Spot cone and integration API

The canonical producer sets `outer=clamp(sourceOuter,1,179)` and `inner=min(sourceInner,sourceOuter-float32(.001))`. Inner uses the original outer value before the independent outer clamp. `0x140f86150` subsequently computes full-angle cosine limits:

```text
scale = 1/max(cos(inner*pi/360)-cos(outer*pi/360),float32(.001))
offset = -cos(outer*pi/360)*scale
cone = saturate(dot(matrixForward, normalize(lightPosition-surfacePosition))*scale+offset)^2
```

`sourceDirectCone` retains source float32 constants and intermediate rounding around the host cosine. Host `Math.cos` rounded to float32 is a reconstruction of source `cosf`, not a bitwise native execution guarantee. The source non-spot coefficients are scale1/offset2. IES takes the opposite normalized vector: light→surface, projected onto the unmodified source left/up/forward axes. Transform those axes and positions into the same browser/view space without applying translation to directions.

`prepareSourcePunctualLights(sourceDocument, iesDocument)` returns `{lights, excluded, policy}`. Each supported light contains stable `id` matching the existing adapter's `fileGuid/classGuid/route`, raw axes, source position, native pre-view RGB, intensity1, inverseRadiusSquared, attenuationOffset, cone coefficients, source channel switches, validated IES resource association, and source fade fields. `sourcePunctualLightConfig` supports one descriptor; `sourceDirectEmitter`, `sourceDirectRadiometry`, `sourceDirectCone` are standalone math helpers. None changes materials, geometry or scene objects.

The existing fixed pool ordering, selection budget, fallback material BRDF and source channel gates stay the runtime owner's responsibility. For a supported ordinary material/light pair, use native direct BRDF once, channel switches once, the raw native light RGB once, and shared scene exposure once. Source roughness precedes Three's roughness modifications. The BRDF evidence here is the ordinary deferred consumer; material-specific forward normal representation still needs its already recovered convention.

## Validation

`python tools/materials/native-direct-producer-evidence.py` validates original bytes, both EntityData/DynamicState schemas, inherited Flags offset, LightUnit enum, constructor defaults and independent map classification. The config tests compare all217 colors with the actual original IES RES header/source equations, all source axes/offsets/channels, exact eligibility identities, area/unit boundary cases, mask/non-mask intensity behavior, wrong-profile rejection and source-angle clamp ordering. Run fromweb:

```text
node --test test/source-direct-light-config.test.js test/source-direct-light.test.js test/source-ies.test.js
```

18 tests pass. These tests are CPU/data checks; the parent owns separate runtime shader/GPU verification. Previous mid-function artifacts `140d87b30.c` and `140fcb090.c` are superseded and not used by this evidence report.
