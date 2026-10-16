# Rigid28 and Catwalk1 frame checkpoint

The original 28-byte layout `8271cd66a9` binds Half4 position/sign at0, Half4 normal at8, Half4 tangent at16 and Half2 UV0 at24. It has no radiosity input. Its original ordinary VS is `c36ce7f6e3`; no atlas path is inferred from the family name.

`BF2-NATIVE-TANGENT-ARRAY1UV28-001` retains five records, three base sections/168 instances and two native lower LODs. All7,605 vertices match the source GLBs. CPU WARP checks34,992 frame scalars with maximum absolute error1.3754205363536443e-7.

Catwalk1 uses twenty-seven exact32-byte records (22base/309instances plus5lowerLODs) and one exact28-byte record (3instances). The latter cluster, asset `598ff0ed-cbdc-ad63-5f92-6cd963816bba`, is MeshType_Rigid in the pinned SDK. Its atlas exclusion remains correct because the selected ordinary route lacks radiosity. Original ordinary PSd260c7f82c pairs c36ce7f6e3 or dfb8f760fb as appropriate; atlasPS3b42a4bca7 pairs13f25cb3dd. The28 Catwalk1 records retain1,819 vertices and29,104 tangent bytes. Three unchanged VS WARP programs check182,520 frame scalars with maximum absolute error1.1483738049378189e-7.

The historical merged checkpoint263records/5,233instances passed the 39 actual-map checks at19:10:34UTC, with zero browser errors and zero LOD frame mismatches. It contained5,190 signed-cross and43 explicit-binormal base section instances. Source Catwalk1 textures, worldXZ grunge, no-AO/no-emission behavior and atlas eligibility remained unchanged. See `native-tangent-composite44.md` for the later composite extension.

Reproducers are `native-tangent-array1uv28-{select.py,prepare.py,warp.ps1}`, `native-tangent-array1uv28.ps1`, and equivalent `native-tangent-catwalk1*` helpers. Both28-byte extractions use the narrow `native-tangent28.cs` reader. The27record32-byte and1record28-byte Catwalk1 proofs remain independently retained under `exports/materials/native-tangent-catwalk132` and `native-tangent-catwalk128`.
