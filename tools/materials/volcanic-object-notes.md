# Volcanic ObjectPreset material and prelighting

The selected shader is `Objects/Nature/Volcanic/_VolcanicQuarry/_CommonTextures/SS_ObjectPreset_01`, shader file `8f7833e2-7077-4885-bb44-692d6808bcc3`, root `a370192c-04d6-434b-b74e-2c9ad0e54dd2`, RVM surface `1ab0a022-21d5-7aad-aabb-b11482af1706`. The complete retained RVM tree has 54 words and four permutations. Exact compiled parameters for all ten active sections reach ordinary SH PS `750135c350` and forward SH PS `c190a27b27`; the other two PS are depth routes. There is no five-texture static-atlas route in this tree. The ordinary PS SHA256 is `a20f4ce4b0bb75ca494bccdab902c62458de29af4fbe4d2f84f7ef0ad086e5c9`.

`exports/materials/volcanic-object-shader/material-analysis.json` retains every selected parameter hash, byte payload, offset, compiled tree predicate and texture identity. Ten active sections account for 164 placed section instances. Both active lower LODs of MachineCeiling (levels 1 and 2) have identical material parameter roots and the same selected PS routes. This is static source evidence, not a capture of the original game's live pass.

## Material equations and normal stages

The ordinary shader binds four textures at t2–t5: base color, base normal, metal detail NA, fabric detail NA. All use native wrap U/V sampler `5993a514cd`. The original UV0 samples base/normal, while cb1[0].xy and cb1[1].xy scale metal/fabric coordinates. Let `a = mix(fabric.a, metal.a, base.a)`. Native albedo is `2 * base.rgb * cb1[2].x * a`, raw smoothness is `2 * normal.a * a`, and raw metalness is `2 * base.a * a`. No extra material AO or emission is present; the ordinary G-buffer material ID is zero and reflectance is .5.

Each sampled normal decodes all three RGB components with `2*x-1`. Each is individually normalized **after** multiplication by the original TBN. Prelighting consumes the raw sum `baseWorld + mix(fabricWorld, metalWorld, base.a)`. The final G-buffer normal normalizes that sum afterward. Normalizing before SH materially changes the original result.

The raw sum drives the nine-term SH polynomial. cb1[3].x greater than zero additionally enables and scales the original broadened SH specular term before the final RGB zero clamp. Eight hose sections disable this term; MachineCeiling and LightGroundFactory enable it. Exact source float32 constants are retained in the compact GLSL. Raw smoothness is saturated only at the native broadening stage. No artificial epsilon was added around native undefined positive-scale zero dominant-direction or opposing half-vector normalization. Zero or negative scale bypasses that path exactly.

Source sky visibility uses the raw normal and coefficient W channels. Its arithmetic is recovered and tested, but the renderer's general environment sky-composition remains a separate boundary. Source frame exposure is not folded into material prelighting; the existing renderer exposure path applies later.

## Independent validation

- `volcanic-object-equations.py`: 2,000 exact-instruction replay cases, maximum absolute residual 6.59383658785373e-12. Premature normal normalization is detected in 1,997 cases; ignoring the source specular gate is detected in 308 cases.
- `volcanic-object-warp.cs` executes the unchanged original PS on CPU D3D11 WARP. The fixture supplies original PS varyings, four point-sampled float textures, source-shaped constant buffers and nine float4 SH coefficients. All four MRTs are read back, including packed normal face/XY, albedo, smoothness, metalness, reflectance, sky and prelighting. The fixture fixes source exposure to one explicitly; this is not a claimed live state.
- `warp-validation.json`: 96 cases / 1,536 scalar outputs, with gate values 0, 1, -1, 2. Maximum absolute residual 3.555557856316227e-5; maximum relative residual with unit floor 1.568351478156583e-6. Input/output and original shader hashes are recorded by the actual execution driver and verified by the comparison.
- `web/test/volcanic-object-material.test.js` compares the browser helpers directly with the retained original WARP outputs, rejects early normalization/ignored gating, checks all ten actual GLTF sections and both source lower LODs, verifies twelve exact texture payloads and checks scoped native DFG/direct integration. All 78 actual positive-gate placements have covered, nonzero source probe directions and finite evaluated test normals/views.

## Browser publication and boundaries

`volcanic-object-prepare.py` publishes twelve exact native texture identities to `/assets/textures/volcanic-object/` and `/assets/recovered-volcanic-object-materials.json`. It selects an existing native mip no larger than 1024, preserving all retained DDS payload bytes; it does not resample or recolor. Native DXGI transfer functions are preserved. PNG totals 6,879,747 bytes. Browser-generated lower mips and anisotropic sampling remain renderer differences.

`volcanic-object-material.js` preserves all original geometry/UV0 and replaces only exact asset/material pairs. At this checkpoint it uses the documented derivative tangent frame. Original vertex-frame publication is separate work; the three mapped normals and raw-sum composition must survive a later frame-only replacement.

`source-volcanic-prelighting.js` contains the independently checked GLSL/CPU equations. `source-probes.js` invokes it only for the Volcanic marker, reads all nine float4 coefficients, preserves the raw normal, supplies source-oriented surface-to-camera direction, then applies the existing probe scale once. Ordinary native DFG/albedo/nonmetal composition and native direct lighting are enabled for this proven material class. Other material families and the static-atlas family map are untouched. General probe volume selection/sample centers remain reconstruction choices.

No browser GPU check was run by this worker. Root owns the combined actual-map validation and full suite/build checkpoint after this handoff.
