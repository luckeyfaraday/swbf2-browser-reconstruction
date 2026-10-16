# ExteriorNoScale original atlas variant

The original five-atlas deferred PS is `b584a44bc0`; ordinary SH PS is `87f18d3646`. Retained RVM instances `29ce25847d` and `2e466df406` select the atlas variant, paired with VS `3e5f2f5398` and `13f25cb3dd`. Complete source paths, bytecode hashes and slot records are in `exports/materials/exterior-noscale-static-atlas/binding-evidence.json`.

Both routes bind `t2..t6` to original selectors 18–22: irradiance, RGB directions and sky. Base RGBA and detail normal/alpha retain their ordinary parameter keys at `t7/t8`, shifted from `t2/t3`. All five material vectors retain their `cb1` offsets. The two function variants use different table output slots: pixel/vertex 47/48 and 40/41, independently verified through exact stage/register apply records. Both retain material sampler `5993a514cd` at atlas `s1` versus ordinary `s0`; atlas `s0` is `9216198462`.

The source blend is unusual: transform base and detail normals independently by the TBN, normalize each, then form `baseWorld + detailWorld*(1,1,0)` in source world axes. The ordinary SH path uses this sum without normalization and only normalizes it after prelighting output, for GBuffer packing. The atlas shader instead explicitly executes:

```
```

This occurs after atlas texture sampling and before any directional or broad-specular atlas evaluation. Thus **atlas uses final normalized world normal; SH fallback uses the unnormalized world blend**. Do not pass the same normal expression to both paths.

Symbolic source comparison proves the same base/detail component normals, unnormalized blend, final world normal, raw smoothness, AO, layered albedo, metalness and exposed prelighting-with-AO expressions for the material portions. The only material canonicalization commutes the three final normalization products: ordinary `invLength*sum` versus atlas `sum*invLength`. The complete atlas lighting kernel exactly equals validated floor `f789fdaafa` after seeding its normalized world normal; no kernel rewrite or clamp-domain assumption is required. The comparison interns 488 symbolic nodes, including original sampler identities and exact float32 literal bits.

Raw smoothness is `r4.x`, written unchanged to GBuffer and saturated inside the atlas kernel. AO is BaseRGBA blue in `r3.z`; it multiplies all atlas RGB, including broadened baked specular, once before frame exposure. Sky visibility from `t6.r` is written directly to `o2.w`, without material AO. There is no material emission and no final nonnegative RGB clamp in the atlas producer. Material ID is zero, reflectance is 0.5, and metalness is `2*(1-base.a)*detail.a*cb1[4].x`.

Both VS layouts keep material UV and radiosity components separate. One retained VS also has a zero-output branch; the recorded UV mapping describes only its authored-output path and does not claim a captured runtime branch decision. Atlas lookup remains `(v1.x*v2.w+v6.z, v1.w*v3.w+v6.w)`. Preserve original compressed dimensions and original affine UVs.

Recipe: `exports/materials/exterior-noscale-static-atlas/integration-recipe.json`. Atlas input is `inverseTransformDirection(geometryNormal, viewMatrix)`; fallback SH is `bf2_exterior_prelightingNormal`, without normalization. Use raw `bf2_exterior_surface.smoothness` and preserve the existing single `bf2_exterior_surface.ao` hook after complete prelighting. Do not add AO within the atlas helper.

Six focused tests verify arbitrary material/TBN parity, actual world-mask and component-normalization mutations, distinct SH/atlas normalization order, missing atlas normalization, raw-smoothness clamp mutation, source kernel preservation of packed material inputs, AO applied once to RGB and not sky, both RVM/constant/sampler routes and UV layouts. Existing 3,200 arithmetic fixtures pass; 3,177 have nonunit prelighting normals. Five actual-material CPU tests pass. No runtime files or GPU work were changed for this recovery.

```
python tools/materials/exterior-noscale-static-atlas-analyze.py
python tools/materials/exterior-noscale-static-atlas-parity.py
python tools/materials/test-exterior-noscale-static-atlas.py
```

This is retained-source static proof. Native live pass selection, texture-view overrides, hardware filtering, framebuffer quantization and browser tangent parity remain separate boundaries.
