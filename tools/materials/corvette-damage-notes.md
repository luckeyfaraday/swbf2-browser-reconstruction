# Corvette damage source recovery

`LOCAL-CORVETTE-DAMAGE-SHADER-001` traces the six original sections of
`Objects/Architecture/CorvetteCR90_Interior_01/SS_CovetteCR90_Interior_01_Damage_01`
to PS `d92fda6613` and VS `246f1ef674`. Coverage is 49 placed sections and
273,239 original LOD0 triangles in the retained frozen-view audit. All six
MeshMaterial declarations have empty conditional/vector-array overrides.

The executable input read-view is `15a2163e05`. The function's differently
ordered hash/filter table `6832e4f272` must not be used as the input slot map.
PS t2..t6 map to original dirt, normal/metal, color, detail array, wreck textures.
The missing texture is exactly TextureArrayAsset `A_CorevetteCR90_01`, file GUID
`6945af84-700e-4b81-ae19-924f6266c322`, root GUID
`b9948b43-0b9b-4f16-9f63-77c67ca4b164` matching the split binding.

Damage weight is original `Color0.r * (1 + wreck.a)`, unsaturated. The shader
blends source color, normal and smoothness using that weight. Normal texture
blue supplies metalness. There is no separate AO or emission. Native world
normal is normalized before SH; ID0 and reflectance0.5 qualify the marker
`recoveredCorvetteDamageShader` for ordinary native DFG/raw reflection.

Original UV1, Color0.r and SubMaterialIndex.x are preserved for ten matching
primitives: six LOD0 assets plus LOD1/2 of the two currently exported native-LOD
assets. The sidecar is 1,437,312 bytes; original geometry, positions, indices,
UV0, normals and collision remain untouched. The eight-entry source layer table
has x=0 in every entry, with no retained mesh override. Preserve it as observed;
do not invent layer mappings. All original SubMaterialIndex.x values are kept.
The complete two-layer native array is retained for future source discoveries.

Integration API: import `prepareRecoveredCorvetteDamageMaterials` from
`web/src/corvette-damage-material.js`, load
`/assets/recovered-corvette-damage-materials.json`, call `apply(gltf,asset)` for
base assets before probe decoration. For native LOD loads, call
`applyGeometry(gltf,asset,sourceLod)` immediately after GLTFLoader and before
primitive traversal/batching, as with Array2UV. Return object exposes `applied`,
`geometries`, `provenance`, `apply` and `applyGeometry`. Material marker is
`recoveredCorvetteDamageShader`; source-probe adaptation preserves custom vertex
attributes. Runtime rejects mismatched original UV0/index fingerprints.

Build:

```text
python tools/materials/corvette-damage-analyze.py
python tools/materials/corvette-damage-test.py
python tools/materials/corvette-damage-prepare.py
node --test web/test/corvette-damage-material.test.js
```

The bounded helper `corvette-damage-extract-vertex.cs` reads only the six names
and selected source levels in `exports/materials/corvette-damage-vertex-names.txt`.
It uses the pinned historical decoder and writes separate source attributes.
No GLBs are modified. Five native textures total 6,706,514 published bytes,
including an unchanged native mip1 array at512²×2 and four2D textures at<=1024.
Original BC1/BC7 payload ranges and output hashes are retained.

Verification: 3,600 independent text-DXBC arithmetic fixtures, maximum error
7.61e-15, 1,043 cases with damage weight>1; all six Node tests pass. Tests cover
source hashes/routing/defaults, original mip payloads, every sidecar vertex,
real GLTFLoader base/native LOD routing, mismatch rejection, immutable geometry
and flat array-index/source-probe shader composition. No GPU test was run for this step.

Limits: paired VS register routing is exact, while original UV0/1 and
Color0/SubMaterialIndex association to converted inputs remains inference from
matching native declaration formats/order. Native converter implementation and
packed tangent parity remain undecoded. Runtime-generated material table
overrides remain unobserved. Native pass/sampler behavior and lower browser mip
generation remain separate fidelity limits; text arithmetic checks do not claim
bit-exact native execution.
