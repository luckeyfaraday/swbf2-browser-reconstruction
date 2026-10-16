# Metallic emissive Master atlas

The original five-atlas deferred PS is `d1092739db`; the ordinary SH PS is `5ffbbd02c2`. Four retained RVM instances select the atlas shader, paired with VS `0ce0841d22`, `5a2ec69557`, `69a5d07239` and `fd70d6fb08`. Full selection paths, original bytecode hashes, tables and source records are in `exports/materials/master1uv-emissive-static-atlas/binding-evidence.json`.

All four bind atlas `t2..t6` to native selectors 18–22 and preserve all ten material texture keys at `t7..t16`. Twelve `cb1` vectors retain their parameter keys and offsets. Table `defa0879b8` assembles pixel slot 55 before vertex slot 56; exact apply records bind pixel `cb1` and vertex `cb0`. Material sampler `5993a514cd` relocates from ordinary `s0` to atlas `s1`; atlas `s0` is native `9216198462`.

Symbolic original text-DXBC proves identical raw smoothness, tangent input, final normalized world normal, layered albedo, layered metalness and exposed prelighting-plus-emission for ordinary and atlas shaders. Samples include exact source sampler identities. The only material canonicalization exchanges the operands of `sat(n)+sat(-n)`; there is no reassociation. Geometric normal remains the raw interpolated input to grunge, while final world shading normal `r3.xyz` is normalized after TBN mapping. Raw smoothness `r1.w` is unchanged in the GBuffer and saturated inside atlas lighting. Every atlas kernel expression equals validated floor `f789fdaafa` with exact original float32 literal bits and no kernel rewrite. The proof interns 758 nodes.

This producer has no material AO. NormalEmission alpha is unused. Sky `t6.r` goes directly to `o2.w`; the atlas RGB has no final nonnegative clamp. Material ID is zero, reflectance is 0.5, and `o2.y` is the original layered metalness scalar, unlike the nonmetal variant's constant zero.

Both original producers independently perform:

```
E = saturate(normalEmission.b * 1.1111111640930176 - 0.111111119389534)
    * cb1[1].rgb * cb1[0].x
o3.rgb = (prelighting + E) * frameExposure
```

The ordinary deferred consumer multiplies the complete prelighting, including E, by `baseColor*(1-metalness)*DFG.b`. Thus the correct integration input is `(atlasOrSH + bf2_master1uv_emissive_surface.emissive)` before that response. A separate Three emission addition afterward is not equivalent. This conclusion is proven from this family's original material producer and common ID0 consumer, independently of the ceiling/nonmetal results. It applies to SH fallback geometry as well as atlas geometry, without claiming full parity for the browser's diffuse-only SH approximation.

All four VS variants forward material UV separately from original radiosity components. PS affine atlas lookup is `(v1.x*v2.w+v7.z, v1.w*v3.w+v7.w)`. Preserve original compressed atlas dimensions and source affine UVs.

Recipe: `exports/materials/master1uv-emissive-static-atlas/integration-recipe.json`. It specifies final world `geometryNormal`, raw `bf2_master1uv_emissive_surface.smoothness`, emission `bf2_master1uv_emissive_surface.emissive`, zero AO applications and zero separate Three emission.

Seven source CPU tests cover exact material parity, removed intensity, wrong emission channel, extra geometric-normal normalization, missing smoothness saturation, kernel preservation of all layered-color/metalness/emission inputs, complete pre-exposure emission addition, all four RVM/VS routes and source deferred-combine edge cases. Edge fixtures exercise zero atlas light, dark/bright mask, zero intensity and metalness 0/0.5/1. Fully metallic cases suppress this diffuse response, and every positive-emission fixture detects an erroneous separate emission addition.

```
python tools/materials/master1uv-emissive-static-atlas-analyze.py
python tools/materials/master1uv-emissive-static-atlas-parity.py
python tools/materials/test-master1uv-emissive-static-atlas.py
```

The material template/generator and generated module now zero separate Three emission and publish the source recipe hash plus prelighting-emission stage. Five material CPU tests pass, covering all 15 actual GLB sections and emission exactly once in the instanced SH fallback without atlas coverage. The parent integration adds E before the same DFG/albedo/metalness response for both atlas and SH.

This recovery uses retained source only and performs no GPU/browser work. Native live pass activation, hardware filtering/view overrides, GBuffer quantization and browser tangent parity remain outside this proof.
