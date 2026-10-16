# Native Command Sector North probe recovery

`BF2-NATIVE-PROBES-001` recovers all 29,632 native probe records and their spatial grouping from the installed map. This materially replaces the missing-data assumption behind uniform hemisphere fill. Native runtime selection, coefficient upload and exposure have not been captured, so using the recovered data does not establish renderer parity.

## Sources and reproduction

The existing root graph `exports/map-initial/root/ebx/Levels_MP_DeathStar02_01_DeathStar02_01__7a85dea0-9a44-4e0d-8986-b08ae8d31dd8.json` directly references both lighting assets:

- `StaticEnlightenEntityData` references `Levels/MP/DeathStar02_01/Lighting/FL_DeathStar_02_01_Static`, file GUID `53c17a19-c90a-11e6-bf1d-a6092bb9b8be`.
- Its paired dynamic data is `Levels/MP/DeathStar02_01/Lighting/EN_DeathStar02_01_Dynamic`, file GUID `30c1b7a9-c90a-11e6-bf1d-a6092bb9b8be`.

The narrow typed export is retained under `exports/lighting/graph`. Their `DatabaseResource` fields identify static resource `2761799507903659695` and dynamic resource `8785653264462149711`. Both belong to installed map bundle 1877 and profile head 1930263. Logical decompressed resource SHA-256 and source inventory SHA-1 are retained in `exports/lighting/probe-recovery.json` and the raw sidecars. Only about 6 MB of raw resource data was extracted; no large lightmap textures were extracted.

Reproduce from retained inputs:

```powershell
%USERPROFILE%/AppData/Local/Programs/Python/Python311/python.exe tools/materials/recover-light-probes.py
node --test web/test/source-probes.test.js
```

The script emits `web/public/assets/source-probes.json` and `source-probes.bin`. Binary output copies every native coefficient byte without gamma, exposure, quantization, resizing or conversion. It contains nine RGBA float32 vectors per probe. The fourth channel is retained, although the browser currently uses RGB only.

## Verified resource layout

Static RES size is 4,267,048 bytes. Header offsets 8 and 12 contain count 29,632 and data pointer 32; offset 24 contains payload end 4,267,040. The intervening 4,267,008 bytes are exactly 29,632 × 9 × 16. The last eight bytes are pointer fixup locations `[12,24]`. All 1,066,752 floats are finite. Alpha channels of bands 4–8 are all zero. Band 0 alpha is in `[0,0.9998604059]`.

The dynamic RES has 17,703 records at offset 112 and matching 32-byte atlas records at offset 566,608. Those preceding sections' full semantics remain undecoded. A count of 194 at header offset 76 and pointer 1,133,104 at offset 80 identify the volume table. Each volume is 240 bytes:

| Offset within record | Recovered content |
|---:|---|
| 0 | 16-byte volume identity; duplicates exist among instanced prefabs |
| 16 | Forward transform: four padded float4 rows/columns as serialized LinearTransform |
| 80 | Inverse transform in matching layout |
| 144,160 | Local minimum/maximum bounds |
| 176 | Blend distance; 1 on regular grids, 0 on irregular groups |
| 180,184,188 | X/Y/Z probe resolutions |
| 192 | Priority + 1; independently matched to typed EBX |
| 196 | Probe count |
| 200 | Starting index into static SH array |
| 204 | `0xffff0000` for regular grids; `0xffff0001` for the seven irregular sets |
| 208 | Pointer to direct float4 world-space probe positions |

All 194 probe index ranges and direct position arrays are contiguous and their counts sum to 29,632. Position arrays begin at 1,179,664 and end at 1,653,776. Forward/inverse transform products agree with identity within 0.0005. The exporter checks every record.

There are 187 regular grids. Index order is `x + nx*(y + ny*z)`; probe positions use local coordinates `(index+0.5)/resolution - 0.5`. This reproduces every direct source position within 1.367 mm, including transformed prefab volumes. There are 63 independent exact matches to retained typed `LightProbeVolumeData` matrices and resolutions, all with priority equal to the encoded value minus one. The seven irregular sets contain 14 preserved explicit probe positions and are currently excluded from browser volume selection.

## Recovered shader polynomial

Installed floor PS `13ddb144d2.asm`, lines 67–95, fetches nine per-instance float4 vectors and evaluates RGB with this polynomial, using a Y-up world normal `N=(x,y,z)`:

```glsl
S = C0 + C1*x + C2*y + C3*z
  + C4*(3*y*y-1) + C5*x*y + C6*y*z
  + C7*x*z + C8*(x*x-z*z);
```

The source clamps its combined diffuse-plus-indirect-specular result to nonnegative values later. The browser currently clamps the diffuse polynomial separately and does not reproduce that indirect specular term. The same shader reads the first four `.w` values as `C0.w + x*C1.w + y*C2.w + z*C3.w`, clamped to nonnegative, for its sky-visibility output. This strongly corroborates the stored nine-float4 structure, ordered coefficients and already weighted polynomial convention. The intervening native CPU upload has not been decompiled; direct upload without rearrangement remains an explicitly identified inference.

The native floor evaluates this polynomial with the unnormalized intermediate floor normal. The new instrumentation preserves that behavior for `recoveredFloorShader` materials, while generic materials use their final normalized world normal. No standard Three SH constants are multiplied into these coefficients a second time.

## Browser module and integration

`web/src/source-probes.js` exports a pure sampler/evaluator plus `createSourceProbeLighting(document, arrayBuffer, options)`. Call `.add(mapGroup)` after map batches have world matrices, and `.add(actorRoot,{moving:true})` after placing moving actors. `.update()` resamples moving meshes after they travel 0.25 m. `.snapshot()` exposes source evidence, assignments, missed volumes, scale and atlas size.

The default `worldToSource` is identity, matching the current source-coordinate manifest, `assets.js` and `static-batches.js`. Pass an explicit transform if the browser starts rebasing or reflecting coordinates. The module preserves and invokes any prior material `onBeforeCompile`, including the recovered floor implementation. A WeakMap shares one decorated clone per source material. Lightweight geometry wrappers share all original attributes, indices and morph buffers and add one probe-offset attribute: one value per instance for batches, or a constant value per vertex for ordinary meshes. There are nine cached float4 texture fetches per fragment, one interpolated index rounded to its nearest integer, and 144 atlas bytes per rendered instance plus padding. Every vertex of an instance carries the same index. The module verifies estimated attributes do not exceed the WebGL2 minimum of 16. It retains native per-instance constant lighting across mesh surfaces. A costly flat-interpolation path was removed after controlled actual-map profiling, documented below.

`irradianceScale` defaults to **1**, preserving raw source units. There is no artistic brightness correction. The source forward shader subsequently established that the indirect polynomial must be multiplied by **PI** when injected into Three's `irradiance`, canceling Three's Lambert `1/pi` factor. The native indirect branch does not contain that factor. This correction is documented below; it is a unit conversion, not exposure compensation. The remaining Three multiscattering factor differs from the source diffuse DFG LUT. Direct-light color scale and exposure are controlled separately and are not encoded into probe assets.

The browser samples at each geometry's world bounds center. It selects the highest source priority containing regular volume, then the smallest volume for ties, and trilinearly interpolates its cell-centered coefficients with edge clamping. This preserves real spatial lighting variation, but these policies are reconstruction choices. Native overlap blending, sample offsets, normal-dependent weighting, irregular-group selection, static atlas UV lighting, dynamic Enlighten contribution and sky terms remain unknown.

The retained interior visual environment has source overrides `MinEV=7`, `MaxEV=9`, `ExposureCompensation=-0.5`, `DarkAdaptationTime=0.8`, `LightAdaptationTime≈0.8`, and `TonemapMethod_Linear`. These values are observed in `Levels_Lighting_DeathStar_02_VE_DeathStar_02_Interior_01__5944175c-c90c-11e6-bf1d-a6092bb9b8be.json`; active environment blending and conversion to renderer exposure were not recovered here. Do not apply `EV=10` as a fixed scene exposure: automatic exposure is enabled and this field is not among that asset's overrides.

## Validation and limits

Seven focused tests pass: full actual payload/range accounting, source polynomial axes/signs, correspondence between actual native lattice positions and coefficient records, coverage at all 21 original team spawns, shader-hook/instancing-offset composition, actual shared material/buffer identity with distinct draw offsets, and shader identity across the smooth/flat diagnostic switch with retained source geometry. The Python recovery verifies every paired resource range, matrix, lattice and independent typed match. GPU compilation/rendering is covered by actual-map browser validation and the controlled profile below. These tests prove the decoded data and browser plumbing at their stated scope; they do not prove a native frame match.

## Correction from the native forward BRDF

**BF2-PROBE-SHADING-002** supersedes the earlier inference that the floor equation outputs roughness. `d825be064c` is the retained forward PS that reads the same nine per-instance SH vectors. It computes `s=clamp(source floor equation)` and then `r=1-s` at line 147. Line 167 uses `r*r` for the vertical coordinate of a DFG lookup, and line 241 uses `1-0.337748*r` as the direct diffuse energy factor. Thus **s is smoothness**, and the browser material must use perceptual roughness `1-s`. Source material arithmetic is unchanged; its previously inferred meaning was incorrect.

Lines 265–268 establish the forward output:

```text
output = (directLighting * albedo / pi
        + max(SH + broadSpecular, 0) * albedo * DFG.z) * exposure
```

`DFG.z` is sampled from source register `t2` at `(saturate(dot(normalize(N),V)), r*r)`. The source LUT's identity and payload remain unresolved after a bounded retained-resource name search. The public Frosty preview also has a DFG implementation, but it is a reconstruction and is not used as proof of the installed LUT. Exposure in this forward variant is `cb2[40].z`, whereas the selected deferred PS uses `.x` on the prelighting output. The active pass and relationship between these buffers are not established by this analysis.

Three's current `RE_IndirectDiffuse_Physical` computes `irradiance * albedo/pi * (1-singleScattering-multiScattering)`. Multiplying injected source prelighting by PI corrects the proven normalization difference. The source DFG factor and omitted broad specular remain real differences. No LUT values or specular gains are invented to hide them.

The source broad specular term itself is now recovered. Define `C0..C8` as the native RGB coefficients, `s` as clamped smoothness, `N` as the unnormalized floor prelighting normal, and `V` as normalized surface-to-camera direction:

```text
D = 0.7 * (sum(C1),sum(C2),sum(C3)) / max(sum(C0),0.00003)
strength = length(D)
L = normalize(D)
H = normalize(V+L)
NV = abs(dot(N,V)) + 0.00001
NL = saturate(dot(N,L)); NH = saturate(dot(N,H)); LH = saturate(dot(L,H))
a2 = max((1-sqrt(s)*strength)^2,0.002)^2
visibility = 0.5 / (NL*sqrt(NV^2*(1-a2)+a2) + NV*sqrt(NL^2*(1-a2)+a2))
distribution = a2 / (1+NH^2*(a2-1))^2
fresnel = 0.25 + 0.75*(1-LH)^5
t = max((0.9375-s)*(16/15),0)
fade = t*t*(3-2*t) * min(4*NL,1)
broadSpecular = 2.2*C0 * visibility * distribution * fresnel * fade
```

The exact disassembly multiplies numerator sums by `0.233333` and denominator by `0.333333`, so the simplified 0.7 form above omits the final float rounding. `tools/materials/analyze-probe-shading.py` numerically validates the unsimplified expression against an independent interpreter of the retained source instruction slice, 1,000 random coefficient/normal/view/smoothness cases; maximum absolute error is `6.82e-13` using the disassembler's rounded literals. This is offline arithmetic validation, not native GPU execution. Source zero-vector normalization is unguarded; a browser translation would need an explicit finite fallback. The term is deliberately not integrated while the DFG combination remains unresolved.

## Actual-map performance isolation

**BF2-PROBE-PERF-003**, 2026-10-15 13:00–13:01 UTC, uses the original extracted map at seed 42 after one second of simulation, then frozen manual simulation time. The actors are identical before and after every mode. The GPU identifies as `ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001636) Direct3D11 vs_5_0 ps_5_0, D3D11)`, with 16 vertex attribute slots and 30 varying vectors. HDR remains enabled at native 1280×720 resolution and zero MSAA samples for every comparison. No source triangles, instances, materials or draw groups are hidden. Each final sample has 2,021 draw calls and 9,028,953 triangles, including exposure passes.

| Same-view transport | Measured FPS |
| --- | ---: |
| All nine coefficients, ordinary index interpolation | 35.3 |
| Probe shader bypass; decorated materials and geometry wrappers retained | 36.1 |
| All nine coefficients, flat index interpolation | 9.1 |
| Ordinary index interpolation, repeated | 35.8 |

Earlier controlled samples isolated material/geometry overhead: shader bypass 35.3 FPS versus original materials/geometries 36.3 FPS. A single C0 fetch with a flat varying still ran at 10.8 FPS. Moving all nine coefficients into flat vertex outputs via texture fetch measured 2.7–3.1 FPS; using nine divisor-one coefficient attributes with the same flat outputs measured 2.3–2.9 FPS. Those unsuccessful transport experiments were removed from production. CPU vertex irradiance interpolation would also lose recovered per-fragment normal-map behavior and is unnecessary.

The isolated cause is the flat interpolation qualifier. The likely native driver mechanism is ANGLE's Direct3D provoking-vertex emulation: [Khronos documents the cost of the default last-vertex convention on Direct3D and Metal](https://www.khronos.org/assets/uploads/developers/presentations/WebGL_Advances_and_Updates.pdf), and [ANGLE's D3D program implementation selects geometry executables when required](https://chromium.googlesource.com/angle/angle/+/ad013650bbf34e59d72452b7a4075352ac55d870/src/libANGLE/renderer/d3d/ProgramD3D.cpp). The browser profile proves the qualifier's cost here; it does not directly capture the driver's generated geometry shader.

The production change removes `flat` from the single index varying and retains nearest-integer rounding before the atlas lookup. The input index is constant over all vertices of each instance, so lighting selection remains constant. All nine original coefficient vectors, source normal-map inputs, polynomial, clamping and PI normalization remain identical. The current map's largest texel offset is 82,908, comfortably inside float integer precision. The seven tests include exact generated-shader equivalence between smooth and flat variants after removing just that qualifier.

Production memory in this view: 9,213 assignments; 77 moving assignments; 663 decorated materials; 2,973 geometry wrappers; maximum 8 estimated vertex attribute slots; 10,443,056 offset-buffer bytes; 1,327,104 atlas bytes. Base geometry/index buffers remain shared. There is no per-frame coefficient upload while actor positions remain stationary. Profiling temporarily retains additional program variants; the normal fresh page starts with 23 linked programs in this scene.

The reproducible diagnostic is `web/test/probe-profile.mjs`, which starts an isolated Vite server on 7748 with HMR disabled, loads the real map, asserts the requested mode in the actual lighting module, samples performance and saves CPU profiles and screenshots. It leaves the normal 7737 server running. `exports/lighting/probe-performance-profile.json` retains the final valid control run with no JavaScript or shader errors. The older run's `full` mode name denotes the original flat-index implementation; the final diagnostic API calls that mode `flat`, while `smooth` is the production default. All timing comparisons are local browser evidence, not native-game frame parity or a cross-device benchmark.
