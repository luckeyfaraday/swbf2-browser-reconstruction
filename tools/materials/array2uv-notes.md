# Original two-UV texture-array props

`LOCAL-ARRAY2UV-SHADER-001` recovers `Shaders/Presets/SS_PropsMetallicPreset_2UV_TextureArray_01`, name hash2612997987, shader GUID9ad10bd5-93e8-45a3-770a-c6de8cfac5d8, deferred PS52d055444c and its paired VS91e68dabef. This family covers14 material sections and395 placements. The retained frozen-frustum audit includes13 sections,323 section instances and1,044,180 original LOD0 triangles; these are frustum counts, not occlusion-tested pixels. It previously had only a base-color approximation.

The missing resource was an omitted asset class in the earlier texture identity index. The source split binding GUIDd72f699d-b7ad-f0da-de8e-7f2741b3ef4c exactly matches the root instance of `TextureArrayAsset Objects/Props/_CommonTextures/A_Generic_01`, fileGUID15a8c654-a0e2-11e6-9bec-d439480edcea. Its texture resource4455661931807515919 contains ten1024x1024 BC7_UNORM layers and eleven native mip levels. The binding is now exact, not name similarity.

The recovered RVM conversion/apply chain binds NAM at t2 (parameter3694953547), detail array at t3 (26739661), and CS at t4 (193470474). Source conversion slots[0,19,8] become[40,41,42], then apply in register order[41,42,40]. The pixel constant buffer uses table38, distinct from vertex table37. Its vectors are source inputs12 and29: detail tiling and detail weight. Eleven selected vectors are exact per-section overrides; seventeen are exact shader defaults. Some wreckage uses normal detail weight3 or5, which must remain unsaturated.

For the native register-level UV pairs `A=v5.xy`, `B=v5.zw`:

```text
NAM = t2(B)
detail = t3(A * detailTiling.xy, NAM.b * 10)
CS = t4(B)
w = clamp(detailWeight.x, 0, 1)
color = CS.rgb * (1 + w * (2*detail.b - 1))
smoothness = CS.a * (1 + w * (2*detail.b - 1))
normalXY = 2*t2(clamp(A,0,1)).rg - 1
normalZ = sqrt(max(1-dot(normalXY,normalXY),0))
tangentNormal = normalize(normalXY + (2*detail.rg-1)*detailWeight.x, normalZ)
metalness = NAM.a
```

The native PS normalizes the transformed world normal before SH/broad-specular prelighting. It writes ordinary materialID0 and reflectance0.5. The two independently recovered deferred consumers in `BF2-NATIVE-GBUFFER-001` therefore apply diffuse=(1-metalness)*baseColor and F0=mix(0.04,baseColor,metalness). No separate AO or emissive is present. The browser uses the same normalized SH convention as recovered Master/MetalOnly/Catwalk2 materials.

The shader register routing is exact. The association `A=original UV0`, `B=original UV1` remains an explicit inference from the contiguous native Half2 TexCoord0/1 order and the paired converted Half4 shader input. The native vertex-buffer-conversion implementation has not been decoded or observed. The browser uses that association and retains this limitation in its manifest, adapter marker and tests. In particular, base color samples original UV1; NAM normal samples clamped original UV0. Neither coordinate set is synthesized or substituted.

`array2uv-extract-uv.cs` reads only the14 original meshes and their currently active native alternatives. It exports28 primitive UV1 streams without changing any existing GLB. The publisher checks each original/native LOD GLB's exact UV0 and uint32 index hashes against the recovered source, records the GLB hash and publishes one1,148,096-byte float32 sidecar. Runtime correspondence checks cover vertex/index counts and complete UV0/index byte fingerprints before adding the new attribute. Position, indices, normals, original UV0, instance transforms, material IDs, collision geometry and source probe offsets remain unchanged.

Texture publication contains22 original 2D PNGs and one ten-layer RGBA8 binary,28,067,582bytes total. Each2D texture selects the largest existing native mip at most1024; the array uses existing native mip1 at512x512 per layer (10MiB decoded GPU data). Every selected compressed DDS slice is retained and hash-checked against the original payload. The native DDS decoder produces pixels; the array concatenates decoded RGBA8 slices without resizing or channel edits. Browser-generated lower mips and native sampler/resource-view parity remain limitations.

Integration API:

```js
const recovered = await prepareRecoveredArray2UvMaterials(document, manager);
recovered.apply(gltf, asset); // Base source LOD0: add original UV1 and material hooks.
// In native LOD loading, immediately after loader.loadAsync(lod.url):
recovered.applyGeometry(gltf, asset, lod.level);
```

The geometry hook accepts either `asset.id` or `asset.assetId`. Call it before native primitive traversal/controller creation. The material marker is `recoveredArray2UvShader`; include it in the proven ordinary native DFG scope. It needs no special SH normal exception. The shader uses a WebGL2 sampler2DArray with the original ten-layer order; do not replace it with an atlas that mixes layers at mip boundaries.

Validation: `python tools/materials/array2uv-test.py` passes4,200 independent text-DXBC arithmetic fixtures, covering all ten layers, distinct UV pairs, normal-coordinate clamp and raw versus saturated detail weights; maximum absolute error3.33e-16. `node --test test/array2uv-material.test.js` in web passes six tests, including actual GLTFLoader routing for all14 sections, all28 original/native-LOD primitive streams, texture/source hashes, corrupt-coordinate rejection and instanced source-probe shader composition. These are CPU/static checks; the root integration owns real GPU compilation and browser controls.

Reproduction uses the existing pinned extractor/runtime. The new helper compiles alongside `tools/bf2-extract/{Historical,Json,ConvertAssets}.cs` against the pinned FrostySdk.dll, with System.Web.Extensions and Microsoft.CSharp references. Its input `exports/materials/array2uv-uv-names.txt` is the bounded mesh/LOD list. Run `array2uv-analyze.py`, `array2uv-test.py` and `array2uv-prepare.py` after narrow extraction. Shared material builders and existing GLBs are never rewritten.

Native-frame update: `native-tangent-arrays.md` records the exact rigid36 subset now active:10 section/LOD records,132 base instances. Original VS WARP also proves UV0/UV1 routing for this subset; the broader converted/composite association remains unresolved. Other layouts retain derivative frames.

The later section-specific proof in `native-tangent-composite44.md` adds five identity-composite44 records/243 base instances. Their exact compiled predicates select the uncolored44-byte VS pair, whose unchanged WARP execution proves source UV0/UV1 and raw normal/tangent/sign routing. The separate raw-normal attribute preserves original GLB normals. Array2UV now has fifteen proven records/nine base sections/375 instances; five remaining base sections retain derivative frames. Native destruction visibility remains outside this static-rest-pose reconstruction.
