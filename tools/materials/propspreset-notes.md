# PropsPreset selected map recovery

The selected DeathStar02_01 TeamDeathmatch subset contains 27 material sections, accounting for 474 placed section instances. Four material routes are proven from the original compiled parameter blocks, authored shader defaults, serialized permutation tree, and original DXBC. This is a bounded subset; older whole-map material inventories have different scope.

The source shader is `Shaders/Presets/Walrus/SS_PropsPreset`, EBX file `17e09795-b2b6-4e3f-8ee7-9b037adf0986`, root `c41f9635-b2e1-49d7-8b22-e72a0feb628f`, RVM surface `e0952160-df00-4a45-a594-4f4309ee0e6d`. `exports/materials/propspreset-routing/routing-evidence.json` records the exact section-to-permutation selection, constants, texture bindings, and source hashes.

## Predicate and shader evidence

The retained native deserializer at `0x1414ff520`, called by `0x1415045b0`, defines the compressed tree structure. The decoder consumes all 2,471 words, resolves 371 backward references, and enumerates 172 permutation leaves. Six material conditions are associated with authored names and branch ordinals. Serialized value hashes agree exactly with `CityHash64WithSeed(rawParameterBytes, fullSerializedParamDbKeyHash)`; native execution of that hash function is not claimed. Unknown pass inputs remain free.

| Material route | Ordinary PS | Atlas PS | Sections | Placed section instances |
| --- | --- | --- | ---: | ---: |
| Clamp both normal coordinates | c13680b516 | b5b53e93ab where eligible | 20 | 298 |
| Clamp normal V only | 93681d7ffd | 2561af268e | 5 | 127 |
| Emissive two-UV alarm | 3352783e34 | d390b460db | 1 | 48 |
| Simple LOD route | 34120bd05e | None | 1 | 1 |

The atlas integration recipe has **22 eligible sections and five explicit exclusions**. Shader-family identity alone is insufficient to enable the atlas. Each of the three eligible original atlas pixel shaders binds native selectors 18–22 to t2–t6 and has the same symbolic common lighting kernel as floor shader `f789fdaafa`. Material textures move to t7–t9. `parity-evidence.json` preserves material expressions, literal bits, sampler identities, and kernel expression hashes. The original-size compressed atlases and source RadiosityTexCoord remain required.

## Material and geometry behavior

The native two-dimensional sampler is `5993a514cd` with wrap U/V. The source shader separately clamps normal-map coordinates. Other material samples remain wrapped. Detail array layer selection is the packed texture B channel multiplied by 10. The existing ten-layer `A_Generic_01` source texture is reused after source identity and byte-hash checks.

Non-LOD color is `4 * CS.rgb * detail.b * tint`; smoothness is `2 * CS.a * detail.b`. LOD color is `2 * CS.rgb * tint`, with smoothness `CS.a`. Raw source smoothness is retained for native lighting. The tangent normal adds detail RG to the base XY without prior normalization; normalization occurs after multiplication by the tangent frame. Material ID is zero, reflectance is 0.5, and there is no material AO multiplier.

The alarm uses original UV0 for normal/detail and original UV1 for color/smoothness, array slice, and emissive mask. Its 36-byte input layout stores TexCoord0 at byte 24, TexCoord1 at byte 28, and RadiosityTexCoord at byte 32. Original VS `9d03671509` and atlas VS `18d0bd9bee` prove the associations. The 5,152-byte UV1 payload contains 644 pairs and is attached only after the actual GLTF primitive, vertex/index counts, material ID, and UV0/index fingerprints match. `geometry-evidence.json` also proves that the black box's currently active LOD1 and LOD2 alternatives use identical material parameter blocks and the same ordinary PS as LOD0.

Source emission is added to SH or atlas prelighting before frame exposure and deferred DFG/albedo/nonmetal response. The ordinary SH route applies its final zero clamp before emission; the atlas route has no equivalent final clamp. Three's separate `totalEmissiveRadiance` is zero. The selected alarm's authored emission constants are zero; no blinking or runtime override is invented. Nonzero synthetic constants exercise the emission equation in tests.

## Browser integration and remaining boundary

`prepareRecoveredPropsPresetMaterials` in `web/src/propspreset-material.js` supplies exact per-section routing, original texture mips, constants, UV1 attachment, and four program variants. `assets.js` loads it only for the selected original map. `source-probes.js` receives raw source smoothness and normalized final world normal, applies source emission once, and supplies the ordinary material classification to the native lighting response. `source-direct-adapter.js` recognizes the same material marker. Atlas selection and publication remain in the shared atlas pipeline.

The material adapter now selects exact original tangent frames for19 proven sections/376 instances, documented in `native-tangent-propspreset.md`. Eight sections/98 instances and their selected lower LODs retain derivative TBN. Browser mip generation/filtering, exact array layer tie behavior, native live pass activation, and dynamic material overrides remain explicitly unresolved. CPU double-precision instruction replay is not a native float32/FMA execution claim.

## Reproduction and verification

Run from the repository root, with the retained original inputs present:

```powershell
python tools/materials/propspreset-routing.py
python tools/materials/propspreset-parity.py
python tools/materials/propspreset-equations.py
./tools/materials/propspreset-extract-uv.ps1
python tools/materials/propspreset-geometry-proof.py
python tools/materials/propspreset-prepare.py
python tools/materials/test-propspreset-routing.py
```

Run from `web`:

```powershell
node --test test/propspreset-material.test.js
npm test
npm run build
```

The routing suite passed 8 tests. The new browser CPU suite passed 7 tests, including all 27 real GLTF sections, UV/fingerprint rejection, distinct shader caches, and DFG/no-DFG emission placement. Original instruction replay passed 4,000 cases with maximum absolute residual `3.774758283725532e-15`; 895 incorrect clamp mutations and 1,000 collapsed-UV mutations were detected. The full suite passed 381 tests, and the build completed with 152 modules. These results precede the root's final Props atlas publication fixture and live GPU checkpoint.

Handoff SHA-256:

- `exports/materials/propspreset-routing/integration-recipe.json`: `9de19fb5970651b03d3083c2e201c653c82dd8d7237f60b6a3107f059b4a546b`
- `web/public/assets/recovered-propspreset-materials.json`: `8405c650bf94428967e8d9636313a7f7e57ae456c4adc0b6c230b3c715fbbb22`

The local Vibe wrapper cannot run because its `C:/Games/vibe-engine/bin/vibe.mjs` target is missing. No Vibe or live scene success is claimed by this CPU handoff; the root coordinates the existing actual-map verification.
