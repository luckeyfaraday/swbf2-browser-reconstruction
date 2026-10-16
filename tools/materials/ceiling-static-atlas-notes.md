# Ceiling atlas and emission composition

The original five-atlas deferred variant is PS `96644c0f9e` for `Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Ceiling_01`. Two retained RVM function instances select it, paired with VS `13f25cb3dd` and `6d142296f0`. Exact selection paths and source hashes are recorded in `exports/materials/ceiling-static-atlas/binding-evidence.json`. Other retained variants use a different six-lightmap composition; they are not substituted into this five-role path.

Both selected routes bind `t2..t6` to native selectors 18–22: irradiance, RGB directions and sky visibility. Ceiling mask, metal CS and metal normal retain their ordinary keys, shifted from `t2..t4` to `t7..t9`. All five material vectors retain their `cb1` offsets. Atlas sampler `s0` is original `9216198462`; material sampler `s1` resolves to the identical `5993a514cd` record as ordinary `s0`. The actual table and apply records establish pixel `cb1` output slot 41 and vertex `cb0` slot 42.

All material texture operations, coordinates, samplers, raw smoothness, tangent input, normalized final world normal, albedo, metalness and exposed prelighting-plus-emission expressions match ordinary PS `1fb4d25b38`. The tangent vector is not separately normalized; only the TBN result is. Atlas final world normal is `r2.xyw`. Raw smoothness `r1.w` is twice `exp2(log2(metalCS.g)*1.5)` and is written unchanged to the GBuffer.

The common atlas kernel differs syntactically from floor `f789fdaafa` in one operation: ceiling uses `min(S,1)`, while floor uses `saturate(S)`. The selected original metal CS DDS is BC7_UNORM, verified by its full payload hash and DXGI header, and all 20 selected sections bind that same resource. Thus its sampled green is in [0,1] and the source producer yields S in [0,2]. The zero endpoint is `log2(0)=-infinity`, then `exp2(-infinity)=0`. Under this explicit source-domain restriction the two clamp forms agree and all kernel expressions become identical, including exact original float32 literal bits. Unrestricted symbolic equality deliberately fails; arbitrary negative or NaN smoothness is not claimed equivalent. The comparison interns 512 symbolic nodes.

Material AO is absent. Sky `t6.r` passes directly to `o2.w`. There is no final nonnegative RGB clamp. Material emission is:

```
E = saturate(mask.r * 1.1111111640930176 - 0.111111119389534)
    * emissiveColor * (emissiveStrength * emissiveMultiplier)
o3.rgb = (atlasPrelighting + E) * frameExposure
```

The ordinary SH variant has the same emission addition before frame exposure. Its source SH and broad-specular evaluation remains distinct from the browser's existing SH fallback approximation, but the emission placement is proven for both source paths. Emission is present even with zero geometric atlas light; missing geometric atlas coverage must not disable it.

Ceiling emits material ID 0, reflectance 0.5, and `o2.y=0.5*metalCS.r`. Both retained ordinary deferred consumers, point-specular and combine-IBL, decode this as metalness. This resolves the older ceiling recovery's explicitly unknown scalar meaning. The ordinary combine consumes the entire GBuffer3 prelighting, including E, with `DFG.b * baseColor * (1-metalness)`. Therefore a separate Three emission addition after that response is not equivalent. Browser material generation now sets fragment metalness from the original scalar, preserves raw smoothness, and zeros separate Three emission. Root's lighting adapter owns adding source E to either atlas or SH before the common response. Without DFG, its Lambert fallback remains explicitly approximate.

Both VS variants pack material UV in XY and radiosity in ZW of one converted input register (`v3` or `v4`). They forward these separately to PS `v6.xy` and `v2.w/v3.w`. PS lookup remains `(v1.x*v2.w+v6.z, v1.w*v3.w+v6.w)`. Original compressed atlas dimensions and affine UVs remain unchanged.

Recipe: `exports/materials/ceiling-static-atlas/integration-recipe.json`. Integration inputs are final world `inverseTransformDirection(geometryNormal, viewMatrix)`, raw `bf2_ceiling_surface.smoothness`, and `bf2_ceiling_surface.emissive` added inside prelighting. AO applications are zero. Metalness is `bf2_ceiling_surface.nativeScalar`.

Six focused CPU tests verify material parity with normal/channel mutations, source-domain clamp equivalence across 4,097 samples and a negative-domain counterexample, kernel mutation rejection, full source composition and preserved material registers, 1,000 native GBuffer decoder fixtures, 512 source combine fixtures (128 with zero atlas light), both RVM routes, constants, samplers, and vertex UV layouts. Every fixture detects the wrong separate-emission composition. Existing 2,000 arithmetic fixtures and four browser CPU material tests also pass.

```
python tools/materials/ceiling-static-atlas-analyze.py
python tools/materials/ceiling-static-atlas-parity.py
python tools/materials/test-ceiling-static-atlas.py
python tools/materials/ceiling-prepare.py
```

This is retained-source static proof. No original-game live pass selection, texture-view override, GPU execution, GBuffer quantization or derivative tangent parity is claimed by this recovery.
