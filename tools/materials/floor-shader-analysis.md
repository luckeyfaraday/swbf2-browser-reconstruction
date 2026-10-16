# Installed Death Star floor shader analysis

The installed `SS_DSI_Floor_01` shader supplies recoverable base color, smoothness and world-space normal equations. It does **not** treat the packed RGBA texture as ordinary RGB albedo. Forward-pass analysis `BF2-PROBE-SHADING-002` corrected the earlier interpretation of the scalar as roughness: Three perceptual roughness is **1 minus source smoothness**. See `native-probes-analysis.md` and `exports/lighting/probe-shading-analysis.json`. Full Frostbite lighting remains incomplete.

## Evidence and scope

- **LOCAL-RVM-SHADER-001**: `exports/materials/floor-shader/graph.json` links source shader name hash `1716682052`, GUID `30255752-71af-3b78-5208-0ef48c10a8ea`, to installed RVM bytecode. Disassembly only; no shader execution was performed.
- **LOCAL-FLOOR-SHADER-002**: `exports/materials/floor-shader/material-analysis.json` records the texture register/parameter chain, full-precision tint constants, matching source material sections and variant check. Reproduce with `python tools/materials/analyze-floor-shader.py`.
- Selected deferred PS `13ddb144d2.dxbc`, SHA-256 `61d1a55e59a352e3d5d044f8aaf2ee7261c7ea787263d456bf0d07fffb52859f`. Its paired VS for function instance `6a604aa2c7` is `606a379e52`.
- Ten nontrivial recovered pixel variants contain the same material sampling scales, roughness arithmetic and tint. Their texture registers differ because their lighting inputs differ. The two trivial pixel shaders are excluded from this material-equation comparison.
- The current final map material plan contains **23 sections** whose shader name exactly equals `Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Floor_01`. All 23 bind the same Floor RGBA and Grunge RGBA and the same secondary default normal. Nine use the default primary normal; fourteen hangar sections use `T_Hangar_Floor_01_NW`. This analysis does not automatically cover `_Dark_01`, `_VertexColor_01`, instance overrides or similarly named shaders.

## Exact texture association

For PS `13ddb144d2`:

| Register | Source parameter hash | Installed texture |
|---|---:|---|
| `t2` | `2680602575` | `Objects/Architecture/_GalacticEmpire/_Textures/T_DSI_Floor_01_RGBA` |
| `t3` | `3886408699` | `Objects/Architecture/_GalacticEmpire/_Textures/T_DSI_Grunge_01_RGBA` |
| `t4` | `1648243766` (`normal`) | Per-material primary normal; `T_DefaultNormal_N` on `dsi_floor_01_128_a_mesh` |
| `t5` | `438789842` | `shaders/T_DefaultNormal_N` on all 23 checked sections |

This is a source reference association, not a filename guess:

1. Function instance `6a604aa2c7` references function `004085b0e5` and its parameter block. The block defaults reference PS `13ddb144d2` and VS `606a379e52`.
2. Direct-input read view `5781d06840` references key table `a3ab1ceb3e`.
3. Texture conversion instruction `bd53a144b8` maps source virtual slots `[11,27,10,9]` to converted slots `[34,35,36,37]`.
4. Apply instruction `3e2599cc3d`, block `e06a525d5b`, contains header bytes `01 01 02 00 04 00 00 00` and slot array `[35,37,36,34]`. The interpretation PS/textures/first-register-2/count-4 is corroborated by the PS's four texture declarations and all four source hash associations.
5. Thus `t2..t5` read original input slots `[27,9,10,11]`. Their `SerializedParamDbKey.hash` lower 48 bits exactly match the split shader-block `packedFlags` values for the four parameters above. The machine report retains every intermediate hash and slot.

Both packed texture source descriptors report **BC7_UNORM**, not SRGB. Keep packed channels in data/linear texture space. The explicit blue-channel power below performs the shader's own color conversion; adding an automatic sRGB decode would apply a second transform.

## Position and sample coordinates

The paired VS reads instance transform rows `t0[instanceIndex+9]`, `+10`, `+11`, applies them to the local position, and writes the resulting position directly to `TEXCOORD0.xyz`. It then subtracts `cb2[37].xyz` only for the camera-relative projection calculation. The PS receives the **absolute transformed world position**, not the camera-relative vector.

Let `P` be that world position in the source meter units. The shader uses world XZ, independent of mesh UVs:

```glsl
vec4 F = sample(FloorRGBA, 0.3 * P.xz);
vec4 G = sample(GrungeRGBA, 0.2 * P.xz);
vec2 D = sample(FloorRGBA, 0.5 * P.xz).rg;
vec4 N0 = sample(PrimaryNormal, 0.3 * P.xz);
vec4 N1 = sample(SecondaryNormal, 0.3 * P.xz);
```

The corresponding nominal repeat periods are 3.3333 m, 5 m and 2 m. Sampling uses the source sampler; its packed descriptor contains filter/address-looking bytes `55 01 01 01` and anisotropy-looking values 8. Wrap/aniso interpretation is plausible but the complete packed sampler layout remains unverified. Browser repeat sampling is a reconstruction choice pending that decoder. The world coordinate scales and channel choices themselves are direct bytecode observations.

## Base color

PS lines 165–169 compute:

```glsl
float c = pow(F.b, 2.2);
vec3 tint = vec3(
    0.06480330228805542,
    0.05360649898648262,
    0.04294449836015701
);
vec3 baseColorLinear = mix(vec3(c), tint, G.a);
```

The exact tint floats are present at DXBC byte offset 4608, bits `3d84b798 3d5b927d 3d2fe692`. The disassembler rounds them to `0.064803, 0.053606, 0.042944`. The shader writes this value to `o1.rgb`. The base-color interpretation is supported by its use in the companion lit pixel variants; output channel names alone were not available. No RGB color is taken from Floor R/G or Grunge RGB. There is no additional saturation on the selected deferred output; a forward variant uses saturation, immaterial for UNORM samples and these tint values.

## Smoothness (corrected by forward-pass BRDF analysis)

PS lines 44–50 and 209 compute:

```glsl
float m = G.g + 0.1;
float a = 1.6 * F.a;
float h = 1.0 + 0.307 * (a - 1.0);
float smoothnessRaw = mix(h, a, m);
```

Equivalently, `smoothnessRaw = a*(0.307 + 0.693*m) + 0.693*(1-m)`. Preserve the fact that `m` is **not clamped**: it may reach 1.1. The selected shader writes this raw scalar to `o0.z`. Forward shader `d825be064c` clamps it, then computes `r=1-s` and `r*r` for the DFG lookup. The browser therefore passes `1-clamp(smoothnessRaw,0,1)` to Three roughness. The earlier advice against inversion was incorrect and is superseded by this direct forward-pass evidence. No native frame capture has been performed.

## Normal

PS lines 51–67 and 170–173 compute:

```glsl
vec2 baseXY = 2.0 * vec2(N0.r * N0.a, N0.g) - 1.0;
float baseZ = sqrt(max(1.0 - dot(baseXY, baseXY), 0.0));
vec2 secondaryXY = 2.0 * vec2(N1.r * N1.a, N1.g) - 1.0;
vec2 packedDetailXY = 2.0 * D - 1.0;
vec2 detailXY = mix(secondaryXY, packedDetailXY, m);
vec2 combinedXY = baseXY + detailXY;
vec3 normalWorld = normalize(vec3(combinedXY.x, baseZ, -combinedXY.y));
```

The multiplication `R*A` is explicit and accommodates packed normal encodings. The square root derives from the primary normal **before** adding detail. Recomputing it from combined XY would differ from the source shader. The final Y-up normal is a world-space floor normal; it is not an ordinary tangent-space normal-map assignment. Preserve the per-section primary normal for the fourteen hangar sections. The paired VS passes no normal or tangent basis to this PS; the PS reads no per-instance normal transform when assembling this normal.

The shader's local prelighting uses the unnormalized intermediate normal, then normalizes it for G-buffer encoding. Porting only a normal into Three.js will not reproduce those prelighting details. Source face/sign G-buffer encoding is an engine storage detail, not required for a forward browser renderer.

## Remaining unknowns

- Complete sampler descriptor interpretation, native selected mip levels, texture streaming state, tone mapping and runtime lighting buffers.
- Full `t0` prelighting/probe buffer and `cb2[40].x` output exposure/pre-exposure multiplier; `o3.rgb` is computed lighting, not another albedo map.
- Exact engine semantics of the constant `o2.xyz=(0,0,0.5)` and alpha outputs. Do not claim a recovered metalness/specular mapping from these constants alone.
- Native pass choice and actual scene state. This is shipped-artifact evidence, not a native render capture.
- Shader/material variants and per-instance overrides beyond the exact default shader association checked above.

No runtime files were edited by this analysis.
