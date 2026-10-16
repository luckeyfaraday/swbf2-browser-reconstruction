# Master2UV original static-atlas variant

This is retained-source static analysis, not an original-game frame capture. It uses the existing `exports/materials/master2uv-shader` graph and original RVM bytes, without new extraction or GPU execution.

The deferred atlas PS is `cae11f0532`, SHA256 `07c68d05030e56614d9219f3aaeb304a34db4dccb778dfcfa3d2f4911021887a`. The retained function instance is `b1fa8a7b23`, paired VS `15a512d31f`. Its exact pixel selection chain is:

```
b1fa8a7b23 -> ae9a86ef79 -> 9a8daf2271 -> 8f0e85d41e
 -> 73b335387f -> b2db09ab52 -> ee13788d86 -> cae11f0532
```

`master2uv-static-atlas-analyze.py` follows original input keys, conversion slots, apply blocks, constant writes and default sampler references. Atlas registers `t2..t6` resolve to native selectors 18–22: irradiance, direction R/G/B, sky visibility. All eleven ordinary material texture keys move from `t2..t12` to `t7..t17`, with all nine `cb1` vector keys and byte offsets unchanged. Atlas sampler `s0` is `9216198462`, the floor's source sampler; material sampler `s1` is `5993a514cd`, identical to ordinary `s0` including bytes `[85,1,1,1]` at 16–19.

`master2uv-static-atlas-parity.py` reuses the tested lane-level symbolic interpreter from Master1UV. For arbitrary independent base UV, surface UV, position, interpolated geometric normal, TBN and constants, atlas and ordinary `2304f89b0d` produce identical albedo, raw smoothness, final normalized world normal, metalness and material AO expressions. The only material canonicalization commutes the scalar addition `sat(n)+sat(-n)`; it performs no reassociation. Every noninteger float literal is resolved to its unique original DXBC float32 word. The atlas kernel equals the validated floor `f789fdaafa` kernel exactly, without algebraic canonicalization. The complete comparison interns 723 nodes.

The material's final normalized world normal is `r3.xyz`. The grunge normal remains the unrenormalized interpolated `v3.xy`, a separate input. Raw source smoothness is `r1.w`, written unmodified to `o0.z`; the atlas kernel performs `mov_sat r5.w, r1.w`. Material AO is `r9.z`, from `normalAO` alpha at surface UV (`t11.a`, ordinary `t6.a`). It multiplies the complete atlas RGB once, including broadened baked specular, before frame exposure. Sky visibility `t6.r` goes directly to `o2.w`. Material ID is zero and reflectance is 0.5. There is no final nonnegative clamp on atlas prelighting.

The paired VS forwards converted material input `v3.zwxy` into `o7.xyzw`: PS surface UV is `v7.xy`, base-normal UV is `v7.zw`. Original radiosity input `v4.xy` travels through `o2.w/o3.w`. The atlas lookup is `(v1.x*v2.w+v4.w, v1.w*v3.w+v5.w)`, preserving the source instance affine transform and original-sized compressed textures. The existing original UV0/UV1-to-converted-input association and derivative tangent frame remain explicitly unresolved adapter boundaries.

Runtime recipe: `exports/materials/master2uv-static-atlas/integration-recipe.json`. Use `inverseTransformDirection(geometryNormal, viewMatrix)` after source material normal evaluation, and raw `bf2_master2uv_surface.smoothness`. Keep the existing `reflectedLight.indirectDiffuse *= bf2_master2uv_surface.ao` hook once after the complete baked contribution; do not add AO inside the shared atlas helper.

Five focused tests check symbolic material and kernel parity, negative controls for accidentally sharing the two UVs and omitting smoothness saturation, AO scope, both sampler routes, constant keys, and VS/PS UV routing. Run:

```
python tools/materials/master2uv-static-atlas-analyze.py
python tools/materials/master2uv-static-atlas-parity.py
python tools/materials/test-master2uv-static-atlas.py
```

The proof does not establish live native pass activation, browser tangent parity, framebuffer quantization, or hardware scheduling. Compressed filtering and exposure are established separately by the floor/original-atlas work; no new WARP execution is needed to distinguish an instruction-identical kernel.
