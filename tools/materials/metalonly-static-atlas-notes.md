# MetalOnly original static-atlas variant

This recovery follows retained original RVM and DXBC, without new extraction, a browser run, or GPU execution. Native live pass activation remains unobserved.

The atlas deferred pixel shader is `2db6de846b`, SHA256 `cafebb1efa7d5b55f1a6069152d219961ba6a8fb780c590d52d7e350c54b9356`, for `Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_1UV_MetalOnly_01`. Four retained function instances select it: `51e89b985b`, `6223061469`, `643a3d8bc5`, `a975dfb30b`. Paired vertex shaders are `007bb70865`, `5a2ec69557`, `69a5d07239`, `fd70d6fb08`. The complete per-instance selection chains and slot evidence are in `exports/materials/metalonly-static-atlas/binding-evidence.json`.

Each instance binds atlas `t2..t6` to native selectors 18–22, in order: irradiance, direction R/G/B, sky visibility. All seven ordinary material texture parameter keys retain their order with a +5 register shift, `t2..t8` to `t7..t13`. All five constant parameter keys retain their `cb1` offsets. Atlas `s0` resolves to source sampler `9216198462`, shared with the floor. Material `s1` and ordinary `85476b5805` sampler `s0` both resolve through their own defaults to `5993a514cd`, with identical stored sampler bytes.

The scoped material comparison uses arbitrary UVs, source world positions, interpolated geometric normals, TBN values and five constant vectors. Albedo, raw smoothness, final normalized world normal, metalness and material AO match the ordinary shader. The compiler exchanges the operands in one grunge subtraction: ordinary `a + (-b)` versus atlas `(-b) + a`. The comparison explicitly records this finite-input addition commutation, with no reassociation. Original float32 literal words are verified against each original DXBC. The atlas kernel is symbolically identical to floor `f789fdaafa` without any kernel canonicalization; the full comparison interns 595 nodes.

Native material details are retained: the detail-normal blend saturates `wear.r + wear.g`; geometric grunge uses interpolated `v3.xy` without fragment renormalization. The final normalized TBN world normal is a different value, `r3.xyz`, used by atlas lighting. Raw smoothness is `r1.w`, written unmodified to `o0.z`; the atlas kernel saturates it explicitly with `mov_sat r4.x, r1.w`.

Material AO is `r4.w`, from `t9.a` (`normalAO`, ordinary `t4.a`). The kernel preserves that register and then multiplies the complete baked RGB by AO once, including its broadened specular contribution. Frame exposure `cb2[40].x` is applied afterward. Sky visibility `t6.r` is copied directly to `o2.w`, without AO or an added clamp. The atlas path does not apply a final nonnegative RGB clamp. Material ID remains zero, metalness remains the ordinary material equation and reflectance remains 0.5.

The atlas lookup is `(v1.x*v2.w+v7.z, v1.w*v3.w+v7.w)`. Paired VS `007bb70865` forwards source radiosity coordinates from `v4.xy`, material UV from `v3.xy`, and instance scale/offset separately. Preserve original atlas dimensions, compressed payloads and source UV coordinates. The browser's derivative tangent frame remains an existing reconstruction boundary, not a result of this equivalence proof.

The machine-readable recipe is `exports/materials/metalonly-static-atlas/integration-recipe.json`. It specifies final world `inverseTransformDirection(geometryNormal, viewMatrix)`, raw `bf2_metalonly_surface.smoothness`, and the existing single `reflectedLight.indirectDiffuse *= bf2_metalonly_surface.ao` hook. No AO belongs inside the common atlas helper.

Five focused CPU tests compare material and kernel expressions, detect removal of detail-blend and smoothness saturation, verify AO preservation/scope/exposure order, verify all four binding routes and both sampler defaults, and check VS/PS UV/normal routing. Run:

```
python tools/materials/metalonly-static-atlas-analyze.py
python tools/materials/metalonly-static-atlas-parity.py
python tools/materials/test-metalonly-static-atlas.py
```

This work does not claim native runtime pass activation, original tangent parity, framebuffer quantization or native sampler descriptor execution. Original compressed filtering and lightmap pre-exposure are established by the separate floor/original-atlas work. An instruction-identical kernel does not require another WARP fixture to distinguish its arithmetic.
