# Original CatwalkSystem Preset02 material

`LOCAL-CATWALK2-SHADER-001` recovers `Objects/Props/ObjectSets/_Generic/CatwalkSystem_01/SS_CatwalkSystem_Preset_02`, name hash `2105226254`, runtime shader GUID `002f9f3e-5dd8-6f66-ca93-79261893d880`, deferred PS `2b6d233517`, paired VS `ea0522bd70`, and companion forward PS `798255efd6`.

Selection follows measured source visibility. `visible-material-audit.mjs` loads the actual source GLBs with GLTFLoader, recreates original spatial batches, applies native LOD union culling bounds and replays the retained frozen camera/frustum entirely on CPU. All330 asset counts match the disabled-LOD view in `web/test-results/actual-map-native-lods.json` exactly. Catwalk2 is the largest remaining family without recovered base color:30 sections,384 placed section instances;29 sections,335 section instances and636,677 original LOD0 triangles are selected by the retained frustum. These are frustum counts, not occlusion-tested visible pixels. Higher-ranked TextureArray2UV already has basic base color and remains separately unresolved.

The exact RVM chain and source offsets/hashes are retained in `exports/materials/catwalk2-shader/material-analysis.json`. Three texture registers map through conversion/apply slots to base RGBA (`t2`, source parameter378117618), detail NS (`t3`,5861208), and world grunge CS (`t4`,2990320127). Four distinct original textures cover all30 sections. The two previously missing base/grunge textures were exported by exact name only; the detail and default-normal DDS files were already retained.

The constant-table order differs from the earlier material families. Pixel CB1 uses output slot34, written from input slot24; vertex CB0 uses output slot35/input25. Both apply-slot arrays are checked explicitly. Treating the first write as a vertex table would incorrectly interpret packed instance-table integers as tiny UV-scale floats. The real UV-scale parameter is source key `03271e4aab`, whose shader default is `[1,1,0,0]`. Twenty-seven exact section overrides supply `[3,3,0,1]`, and three sections retain that default. Values are decoded from their original float32 bytes.

For `U=UV0`, `P=source absolute world position`, and `k=cb1[0].xy`, the shader samples:

```text
base = BaseRGBA(U)
detail = DetailNS(U*k)
grunge = GrungeCS(0.1*P.xz)
color = base.b * grunge.rgb
smoothness = base.a * grunge.a * detail.b
detailXY = 2*detail.rg - 1
tangentNormal = normalize((detailXY + 2*base.rg - 1,
                           sqrt(max(1-dot(detailXY,detailXY),0))))
```

The source reconstructs normal Z from the detail normal, then adds authored base RG to XY. No normal-X R*A packing, separate AO, emissive or opacity term is present. The final TBN-transformed world normal is normalized before SH prelighting, unlike the separately recovered floor's intermediate normal. Exact instructions are retained in `nativeLightingInputs` and on the adapter's `recoveredCatwalk2Shader` marker.

The shader writes ordinary materialID0, metalness0 and reflectance0.5. Two native G-buffer consumers from `BF2-NATIVE-GBUFFER-001` establish dielectric F0=.04 and ordinary diffuse/specular interpretation. This is a source dielectric material even where mesh or texture names sound metallic. The forward companion clamps smoothness, complements it and samples native DFG B at `(NdotV,(1-smoothness)^2)`, multiplying prelighting by color and that B value. Root can include `recoveredCatwalk2Shader` in its existing normalized-normal native DFG scope. Full native BRDF, baked broad specular and reflection projection still have their separately recorded limits.

`catwalk2-test.py` compares compact algebra against an independent generic disassembly interpreter for3,000 fixtures and all30 section constants. UV-dependent channel-distinct samples and varying source-world positions exercise channel/swizzle/frequency errors. Maximum error is3.33e-16. This is static arithmetic equivalence, not native execution or float32/FMA bit identity.

All four public PNGs preserve packed source channels. Three original mip0 images are1024×1024 and the source default normal is16×16. The grunge DDS is BC7 SRGB; the three normal/data DDS resources are BC7 UNORM. Those transfer functions remain separate. No channel processing or image resampling occurs. Original DDS hashes, byte ranges, selected DDS hashes and PNG hashes are retained. The four PNGs total2,821,784bytes. Browser-generated lower PNG mips, source resource-view overrides and native sampler behavior remain explicit limits.

Integration: import `prepareRecoveredCatwalk2Materials` from `web/src/catwalk2-material.js`, load `/assets/recovered-catwalk2-materials.json`, prepare with the shared loading manager, and invoke `apply(gltf,asset)` before batching/probe decoration. The API exposes `applied` and `provenance`; shader marker is `bf2_catwalk2_surface`. It preserves original geometry, source material IDs, UV0 and source world transforms. The runtime integration step covers shared runtime integration and GPU validation.

Five Node tests check source shader hashes/chains/constants, exact packed texture bytes/transfer functions, the independent math record and normalized SH evidence, real GLTFLoader association for all30 sections, and source-world/probe hook composition on instanced batches. Geometry attribute buffers and probe offsets remain intact. Native packed tangents are still unavailable, so the browser's derivative tangent basis remains an approximation.

Reproduce:

```powershell
python tools/materials/catwalk2-analyze.py
python tools/materials/catwalk2-test.py
python tools/materials/catwalk2-prepare.py
cd web
node --test test/catwalk2-material.test.js
```

The visibility audit was captured before the runtime next LOD expansion. Its source report is retained; rerunning with a different LOD candidate set may legitimately change conservative union bounds and requires a matching retained profile. No browser or GPU was started for this step.
