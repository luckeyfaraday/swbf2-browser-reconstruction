# Catwalk2 original static-atlas variant

This bounded recovery uses retained RVM/DXBC only. No new extraction, browser, GPU run, or native-game runtime capture is involved.

Atlas deferred PS `b1dedf865d`, SHA256 `c7c725880ea94ee6bf14c7d462c49129364bacd32c227d90f11c3d42a7a7876d`, belongs to `Objects/Props/ObjectSets/_Generic/CatwalkSystem_01/SS_CatwalkSystem_Preset_02`. Retained function instances `01b4b66b2f` and `85c932809a` pair it with VS `13f25cb3dd` and `6fee6b97a3`. Exact selection chains, texture conversion/apply slots, parameter keys and sampler defaults are in `exports/materials/catwalk2-static-atlas/binding-evidence.json`.

Both instances bind `t2..t6` to native selectors 18–22: irradiance, direction R/G/B, sky visibility. The three material texture keys remain in order with a +5 register shift: ordinary `t2 base`, `t3 detail`, `t4 grunge` become atlas `t7`, `t8`, `t9`. Material sampler `s1` resolves to the same `5993a514cd` default as ordinary `s0`; atlas `s0` is floor sampler `9216198462`.

The single UV-scale constant retains key `03271e4aab` at `cb1[0]`. This family assembles the pixel constant table before its vertex table. The atlas table descriptor matches the ordinary descriptor byte-for-byte except for relocated output slots: pixel 34→37, vertex 35→38. Explicit apply records bind slot37 to PS CB1 and slot38 to VS CB0. The recovery therefore does not infer the constant table from write ordering alone.

Material expressions match ordinary PS `2b6d233517` for arbitrary UV, source world position, UV-scale vector and TBN rows. The comparison separately verifies normalized tangent normal and normalized final world normal, plus albedo, raw smoothness, zero metalness and reflectance0.5. No algebraic canonicalization is needed. The atlas lighting kernel is also an identical symbolic expression graph to validated floor `f789fdaafa`, with exact float32 source literal words. The whole comparison interns 422 nodes.

The source first normalizes its reconstructed tangent vector, applies the TBN rows, then normalizes again. Atlas prelighting uses the final world value `r2.xyw`, not the tangent vector. Raw smoothness is `r1.w`, written unchanged to `o0.z`; the atlas kernel performs `mov_sat r3.w, r1.w`.

There is no material AO multiply and no emissive addition. After the kernel, the complete source tail is:

```
```

The first line writes base blue multiplied by grunge RGB as material color. The second writes complete atlas RGB times frame exposure. The kernel preserves those material color registers. Sky visibility `t6.r` is copied directly to `o2.w`; no AO or additional clamp affects it. The material writes ID0, metalness0 and reflectance0.5. Atlas RGB has no final nonnegative clamp.

Both vertex permutations forward material UV to PS `v6.xy`, instance offset to `v6.zw`, and radiosity UV to `v2.w/v3.w`. VS `13f25cb3dd` receives radiosity as converted `v3.zw`; VS `6fee6b97a3` uses separate `v4.xy`. The shared pixel lookup is `(v1.x*v2.w+v6.z, v1.w*v3.w+v6.w)`. These converted-layout differences do not change the original-UV atlas adapter. Preserve source affine transforms and original-sized compressed textures.

Runtime recipe: `exports/materials/catwalk2-static-atlas/integration-recipe.json`. Use final world `inverseTransformDirection(geometryNormal, viewMatrix)` and raw `bf2_catwalk2_surface.smoothness`. Its `materialAO` explicitly has `value:1`, `applications:0`, `existingHook:null`; do not add a packed-AO hook for this family. Emissive is zero.

Five CPU tests cover arbitrary material expressions and both normal stages, common kernel parity, negative controls for missing final-normal normalization and smoothness saturation, full output composition, both binding/constant-table routes, and both VS UV layouts. Reproduce with:

```
python tools/materials/catwalk2-static-atlas-analyze.py
python tools/materials/catwalk2-static-atlas-parity.py
python tools/materials/test-catwalk2-static-atlas.py
```

Native runtime pass activation, native tangent parity, framebuffer quantization and hardware scheduling remain outside the proof. The browser derivative tangent frame remains the existing adapter limit. Original compressed filtering and LightMapPreExposure are established separately by floor/original-atlas work.
