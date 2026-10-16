# Original map render LODs

The expanded batch now contains **48 assets and86 original GLBs** (48 LOD1,
38 LOD2),15,098,624bytes. The original24 remain byte-identical, including all
material bindings. The next24 were selected from the retained enabled-LOD
camera profile's highest remaining triangle contributors:1,633,294 visible
LOD0 triangles. This is frustum/batch cost, not pixel coverage or occlusion.
Native LOD1/2 eligibility still requires exact source parameter-root identity;
eight new assets have only an eligible LOD1. Ten selected assets have non-unit
LodScale, retained without guessing its arithmetic. Expanded GPU measurement
is pending; the prior24-asset profile remains unchanged.

Reproduce expansion after the baseline steps below:

```powershell
python tools/lod-recovery/lod-audit.py --extra-visible-profile web/test-results/actual-map-native-lods.json --extra-visible-count 24
python tools/lod-recovery/lod-expand.py names
tools/lod-recovery/bf2-lod.exe mesh --game 'C:\Games\Star Wars - Battlefront 2' --work tools/bf2-extract/work --names exports/lod-recovery/lod1-extra-names.txt --lod 1 --out exports/lod-recovery/lod1-extra
tools/lod-recovery/bf2-lod.exe mesh --game 'C:\Games\Star Wars - Battlefront 2' --work tools/bf2-extract/work --names exports/lod-recovery/lod2-extra-names.txt --lod 2 --out exports/lod-recovery/lod2-extra
python tools/lod-recovery/lod-expand.py merge
python tools/lod-recovery/lod-prepare.py
```

All required group records already exist. `render-lods-first24.json` and the
two `mesh.manifest-first24.json` files preserve the baseline. Delta files stay
in separate owned directories; the merge never overwrites original GLBs.

The following describes the retained first-batch investigation.

Evidence `BF2-NATIVE-LOD-AUDIT-001` checks all 377 current map assets against retained original MeshSet metadata. 317 have native lower LODs. The audit ranks all-placement triangle cost, not camera-visible cost, and compares the exact variation=0 split-shader graph using CityHash64(MeshSet.NameHash,0,LOD), source primary mesh GUID and original section index.

The selected 24 assets account for 6,373,490 placed LOD0 triangles. Their native LOD1 geometry would total 2,185,036 triangles if all selected placements used LOD1; actual distance-based savings are lower and require runtime measurement. Every selected LOD1 and LOD2 visible section shares the exact original material-parameter-root resource identity with its corresponding LOD0 material. Selection never assumes that primitive indices are stable between LODs.

`BF2-NATIVE-LOD-EXPORT-001` packages 24 LOD1 and 22 LOD2 GLBs (46 total, 7,350,744 bytes). Source positions, direct normals, UV0, triangle indices, source material IDs and Y-up metre coordinates remain unchanged. GLB nodes have identity transforms. Composite rest transforms are baked by the existing converter, and all selected levels retain the exact LOD0 part-transform arrays. No generated simplification or unbound composite fallback is used.

The older `bf2-extract.exe` predates composite conversion and initially rejected six composite objects. The completed exports use `tools/lod-recovery/bf2-lod.exe`, compiled from the existing current source through `tools/bf2-extract/build.ps1 -Output ../lod-recovery/bf2-lod.exe`. No shared extractor executable was changed. The manifest hashes the compiled helper and relevant converter sources.

Browser manifest: `/assets/source-lods.json`. Each `assets[]` entry contains:

- `assetId`, `lodScale`, exact `sourceLodGroup` (raw distances for LOD1..6), and original LOD0 identity/bounds.
- `lods[]`: `level`, `url`, SHA256, source chunk/resource identity, triangle count, bounds and coordinate evidence.
- `lods[].sections[]`: GLB `primitiveIndex`, native `sourceSectionIndex`, `sourceMaterialId`, mapped `lod0SectionIndex`/`lod0MaterialId`, and proven `sharedParameterRoot`.

Use `sourceMaterialId` from each original loaded material to reuse the material object, including reconstructed shader hooks. GLB primitive section names may change (`M_Box_M_06` versus `M_Box_M_06_LOD`); they are evidence, not a mapping key. GLTFLoader parser associations can map each mesh to its GLB primitive index if needed.

Native LodGroup values are available. All selected groups have `AutoLod=false`:

| Group | LOD1 | LOD2 | LOD3 | LOD4 |
|---|---:|---:|---:|---:|
| GenericMicro | 3 | 6 | 12 | 18 |
| GenericSmall | 6 | 12 | 18 | 25 |
| GenericMedium | 15 | 30 | 52 | 75 |
| GenericLarge | 13 | 35 | 60 | 90 |
| GenericHuge | 10 | 60 | 90 | 120 |
| Deathstar_GenericObjects | 10 | 20 | 42 | 65 |
| NoCulling | 500 | 1000 | 1001 | 1002 |

Four selected meshes have non-unit `LodScale`: long panel pipes .65, TIE maintenance .86, breakable computer panel .45, debris panel .6. Raw values are retained. Native scale arithmetic, group/directional-distance precedence, quality/FOV scaling, distance origin and hysteresis are not established; do not invent reciprocal scaling. A browser selector using raw group distances and nearest-instance bounds must identify the latter as an implementation policy.

Keep the original LOD0 CollisionWorld/BVH immutable. Render LOD changes must also retain original per-instance probe identities/atlas offsets and sampling centers. Do not let altered lower-LOD bounds move probe samples or overwrite collision geometry. Lower LOD geometries can preserve the established probe-offset attribute when swapped into an already instrumented batch. Section disappearance/merging must use the manifest mapping explicitly; this selected set only exposes material reuse where original parameter roots prove it.

Reproduce:

1. `python tools/lod-recovery/lod-audit.py`
2. Compile the owned helper as above. Run its `mesh` command with `--work tools/bf2-extract/work`, the original game path, `--names exports/lod-recovery/lod1-names.txt --lod 1 --out exports/lod-recovery/lod1`, then the corresponding LOD2 arguments. No `--allow-unbound`.
3. Export only `exports/lod-recovery/group-names.txt` at depth0 to `exports/lod-recovery/groups`.
4. `python tools/lod-recovery/lod-prepare.py`
5. From `web`: `node --test test/native-lod-assets.test.js`.

No runtime source files or collision data are changed by these helpers. The runtime integration step covers render selection, integration and actual GPU measurement.
