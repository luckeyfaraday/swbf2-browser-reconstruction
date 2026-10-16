# Material recovery checkpoint

Actual source textures are bound to 377 map meshes and seven character/weapon components. The exact shader entry is selected by CityHash64 of little-endian MeshSet.NameHash, variation hash zero, and LOD. Its original section index selects the section branch. Mesh primary GUID and LOD are independently checked. Texture ITexture GUIDs identify EBX primary instances, not file GUIDs. `mesh-info/mesh-info.json` supplies all original section indices, including omitted depth/shadow sections.

`final-map-material-plan.json` resolves 258 base-color and 250 normal bindings across 701 material slots; eleven of thirteen character component slots have base color. Unknown packed masks remain unresolved rather than being displayed as color. Default-variation PBR conversion is partial: per-instance variations, packed mask equations, exact tangent frames and native lighting remain open. Textures retain provenance, are capped to 1024 pixels for browser memory, and BC5 normal Z is reconstructed from RG following the Frosty SWBF2 preview shader. Source pixels, hashes and conversion records remain local.

Run commands from the workspace root using Python 3.11 (`%USERPROFILE%/AppData/Local/Programs/Python/Python311/python.exe`). Pillow/numpy are installed; cityhash is scoped to `tools/materials/python-libs`. Prerequisites are the retained map graph/mesh extraction, texture identity indices and pinned historical SDK, documented in `tools/bf2-extract/USAGE.txt`.

```powershell
python tools/materials/prepare-materials.py map
# If missing block names changed, run bf2-materials.exe shaderblocks with
# --game installed-path --out exports/materials/final-map-extra-blocks
# --names exports/materials/final-map-missing-block-names.txt, then prepare again.
python tools/materials/plan-materials.py --mesh-manifest exports/materials/final-map-meshes.json --blocks exports/materials/final-map-blocks.json --mesh-info exports/materials/mesh-info/mesh-info.json --source . --out exports/materials/final-map-material-plan.json
# Export only names in final-map-material-plan.texture-names.txt that are absent
# from map-textures; existing supplemental conversion is map-textures-extra.
python tools/materials/prepare-materials.py textures
python tools/materials/apply-materials.py --plan exports/materials/final-map-material-plan.json --textures exports/materials/final-map-textures --source . --target web/public/assets/meshes
python tools/materials/prepare-floor-material.py
node tools/materials/refresh-manifest.mjs
```

Character conversion uses the same planner with `--mesh-manifest exports/characters/converted/mesh.manifest.json --blocks exports/characters/materials/shader-blocks.json --extra-graph exports/characters/converted --source exports/characters/material-inputs --mesh-info exports/materials/mesh-info/mesh-info.json --out exports/materials/character-material-plan.json`. Apply with `--textures exports/materials/character-textures --source exports/characters/material-inputs --target web/public/assets/characters --filenames`, then merge and attach animations as documented in `tools/characters/PROGRESS.md`. Never overwrite final animated actors with old bind-pose outputs.

RVM research is independent of this partial material implementation. `inspect-rvm.py` now covers all 100,656 blocks and 31,613,043 payload bytes with zero hash collisions. Five known modern layouts differ from this installed profile, and six types are absent from the reference. Their widths are validated by source hash references and complete byte/count coverage in `recovered-layout-widths.json`; their fields remain explicitly opaque. Earlier partial indices were superseded and must not be used.

`extract-rvm-shader.py` traces the exact floor shader (name hash 1716682052, runtime GUID 30255752-71af-3b78-5208-0ef48c10a8ea) and disassembles its actual DXBC without execution. `exports/materials/floor-shader/graph.json` records 2,267 reachable blocks and 31 shader binaries (19 vertex, 12 pixel). `floor-shader-analysis.md` documents source register/parameter mappings and color, smoothness and world-normal equations. The source scalar is smoothness; Three receives roughness = 1 minus smoothness. `prepare-floor-material.py` preserves packed channels for 23 sections. Actual GPU compilation and controls pass. Original probes, selected exposure fields and all 88 source HDR captures are integrated, with sampling/filtering and BRDF interpretations documented separately. The pinned Glacier reference is in `reference/`. Shader recovery does not establish native renderer parity.

`master1uv-notes.md` documents 114 exact wall sections, 52 source textures and 1,140 independent DXBC arithmetic comparisons. `ceiling-notes.md` documents 20 sections across 493 placements, three original textures, exact emissive overrides and 2,000 arithmetic comparisons. Their generated browser adapters follow the same preparation/application contract as the floor adapter. `native-probes-analysis.md` and `native-dfg-analysis.md` retain original lighting payloads, source associations, explicit interpretations and outstanding native DFG/reflection projection work.


`master2uv-notes.md` covers8sections/680placements,14originalUV1sidecars and15native textures. `master1uv-emissive-nonmetal-notes.md` covers the original nonmetal emissive wall across202placements, ten retained textures, thirteen constants and source zero metalness. Both are integrated into the material/LOD/probe/direct-light paths. First GPU integration exposed the16sampler limit; source IES and nativeDFG are being packed losslessly into oneRGBA16Ftexture, with validation recorded separately.

`native-bloom-analysis.md` documents the original GaussianSimple bloom: settings, level layout, weight generator (CRT `powf`), `GaussianPyramidCs` kernel, `Tex2d`/`Tex2dDouble` upsample with `R11G11B10_FLOAT` truncation and the Tonemap combine. `native-bloom-shaders.py`, `native-bloom-evidence.py` and `native-bloom-warp.ps1` regenerate the witnesses; `web/test/source-bloom-gpu-check.mjs` compares the browser GPU against WARP.

## Native local spot shadows

`native-shadow-analysis.md` retains the static native producer, sampler and bias analysis. `native-shadow-activation.md` documents the browser activation (`BF2-NATIVE-LOCAL-SHADOW-ACTIVATION-001`): shadow-category caster publication (`native-shadow-caster-publish.py`), the cached static/live depth atlases, receiver injection, validation and measured costs. `native-shadow-activation-evidence.py` regenerates `evidence/native-shadow-activation.json`.
