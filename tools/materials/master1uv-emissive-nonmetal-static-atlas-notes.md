# Nonmetal emissive Master atlas and emission stage

The original five-atlas PS is `90de297532`; ordinary PS is `17069bc692`. Retained instance `d1d664b1f3` selects the atlas variant and VS `69a5d07239`. `exports/materials/master1uv-emissive-nonmetal-static-atlas/binding-evidence.json` records the complete source selection path, bytecode hashes and exact RVM tables.

Atlas `t2..t6` are native selectors 18–22 (irradiance, direction R/G/B, sky). The ten ordinary material texture keys retain their order at `t7..t16`, a +5 register shift. All thirteen `cb1` vectors retain their keys and byte offsets. Table `29e1747c00` assembles vertex slot 56 and pixel slot 57; explicit stage/register apply records bind them to vertex `cb0` and pixel `cb1`. Original material sampler `5993a514cd` relocates from ordinary `s0` to atlas `s1`; atlas sampler `s0` is `9216198462`.

Lane-level symbolic evaluation of both original shaders proves the same raw smoothness, unnormalized tangent input, final normalized world normal, albedo, zero metalness and exposed prelighting-plus-emission expressions. The original source sampler identities are part of each texture-sample expression. Only `sat(n)+sat(-n)` operand exchange is canonicalized, as already required by Master1UV. Raw interpolated geometric normals remain unnormalized for grunge. All atlas kernel expressions equal the validated floor `f789fdaafa` kernel with exact original float32 literal bits and no kernel rewrite; the proof interns 751 nodes.

Final world normal is `r3.xyz`. Raw smoothness is `r1.w`, unchanged in `o0.z` and saturated inside the kernel. This material emits ID0, metalness zero and reflectance 0.5. There is no AO term: normalEmission alpha is unused. Sky visibility goes directly from `t6.r` to `o2.w`, and no final nonnegative clamp is introduced.

Both ordinary SH and atlas source variants perform:

```
E = saturate(normalEmission.b * 1.1111111640930176 - 0.111111119389534)
    * cb1[1].rgb * (cb1[0].x * cb1[3].x)
o3.rgb = (prelighting + E) * frameExposure
```

The same mask blends the material base color toward source emissiveBaseColor. The native ordinary combine consumes all GBuffer3 RGB, so both prelighting and E pass through `baseColor * DFG.b`; source metalness is zero. Adding E afterward as separate Three emission changes this result. The generated material now sets separate Three emission to zero, while source-probes adds the recovered surface emission to atlas or SH prelighting before the common response. E remains present when geometric atlas light is zero or atlas coverage is absent. The existing SH fallback omits native broad specular; the proven emission ordering does not claim full SH-render parity.

The adapter has its own `master1uv-emissive-nonmetal-adapter.template.js` so this correction does not alter the separate metallic MasterEmissive family. The generator records recipe/hash and emission stage in the prepared material metadata. No textures were extracted, duplicated or modified.

VS `69a5d07239` routes its original material pair to PS `v7.xy` and independent radiosity components to `v2.w/v3.w`. Atlas lookup remains `(v1.x*v2.w+v7.z, v1.w*v3.w+v7.w)`. Keep original compressed dimensions and affine UVs.

Seven CPU tests cover material/typed-sample parity, missing emission multiplier and wrong blue-channel mutations, wrong geometric-normal renormalization, kernel smoothness saturation mutation, preservation of every color/emission input across the actual kernel, all RVM bindings/constants/samplers, vertex UVs, and source combine edge cases. The latter include zero atlas light, zero multiplier, dark mask thresholds and bright emission, and detect the separate-emission error. Existing 3,000 arithmetic cases, 21 channel edges, 128 nonunit interpolated normal cases, and two actual-GLB CPU tests pass. The GLB test confirms source emission occurs once in the SH+DFG path without geometric atlas data.

```
python tools/materials/master1uv-emissive-nonmetal-static-atlas-analyze.py
python tools/materials/master1uv-emissive-nonmetal-static-atlas-parity.py
python tools/materials/test-master1uv-emissive-nonmetal-static-atlas.py
python tools/materials/master1uv-emissive-nonmetal-prepare.py
```

Recipe: `exports/materials/master1uv-emissive-nonmetal-static-atlas/integration-recipe.json`. Runtime values: final world `geometryNormal`, raw `bf2_master1uv_emissive_nonmetal_surface.smoothness`, emission `bf2_master1uv_emissive_nonmetal_surface.emissive`, zero AO applications, zero separate Three emission. Original live pass selection, hardware sampling/view overrides, framebuffer quantization and browser tangent parity remain outside this static proof.
