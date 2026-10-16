# Original ExteriorNoScale frames

`BF2-NATIVE-TANGENT-EXTERIOR32-001` covers the three rigid pipe assets: five section/LOD records, 82 base instances and 18,513 source vertices. Evidence and unchanged source streams are retained in `exports/materials/native-tangent-exterior32`. The five-placement silo uses a different composite40 route and remains outside this proof.

The complete original permutation tree at `3f3868dbc7` is decoded using the retained native compressed-tree format. Each selected compiled section supplies two exact predicate values, narrowing the tree to leaves2,6,7,8,9,14,15,16,17,23 while unknown pass inputs remain free. These leaves uniquely pair ordinary PS `87f18d3646` with VS `dfb8f760fb`, and atlas PS `b584a44bc0` with VS `13f25cb3dd`. Their direct original layout `ad2dd1141c` reads Half4 position/sign, normal, tangent and UV/radiosity at offsets0,8,16,24 in a32-byte stream. This distinguishes the rigid pipe route from the older family exemplar VS `971c1855d6`, which belongs to the silo.

All retained positions, normals, UV0 and indices match their actual GLBs byte-for-byte. Each independent BinormalSign is retained alongside original tangent XYZ. Both selected lower LODs have proven equal material parameter roots and exact matching source layouts. The original ordinary and atlas vertex shaders were executed unchanged on CPU WARP over325 sampled source vertices and12 source/synthetic transforms. The70,200 frame scalar comparisons have maximum absolute error `1.3761411821189284e-7`; no tolerance was broadened.

The material hook replaces only its tangent frame. It preserves separate base/detail normal mapping and normalization, then the existing source-world XY detail addition and unnormalized prelighting normal. Source AO, constants, textures, UVs, emission state and native lighting equations remain unchanged. Three source world-frame columns are interpolated without per-fragment column normalization. Nine instance/probe attribute slots are used before the two static-atlas attributes, for eleven total; samplers are unchanged.

The merged publication has273 records,5,558 base section instances,437,667 source vertices and7,500,940 payload bytes. SHA-256: `154a8419298e340e72e85c19423b72725b32fc54acc7eb065156bb6f846c3f6d`. Expected diagnostic frame kinds in both native LOD modes are signed-cross5,272, explicit-binormal43 and signed-cross-source-normal243. Eighty-seven focused tangent, array, Exterior material and LOD tests pass. Actual-map GPU validation belongs to the root integration task; live native game dispatch and the native vertex-conversion factory are not captured.

Reproduce in the repository root:

```powershell
python tools/materials/native-tangent-exterior-select.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-exterior.ps1
python tools/materials/native-tangent-exterior-prepare.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-exterior-warp.ps1
python tools/materials/native-tangent-merge.py --publish
python tools/materials/exterior-noscale-prepare.py
```

Source extraction and candidate preparation remain bounded to the separate evidence directory. The merger publishes only with `--publish`. Current collision and original mesh attributes remain immutable through the tested native LOD transitions.
