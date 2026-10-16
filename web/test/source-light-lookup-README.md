# Lossless DFG / IES channel packing validation

Run from `web` after the runtime packing implementation is present:

```powershell
node --test test/source-light-lookup.test.js
node test/source-light-lookup-gpu-check.mjs
```

The GPU fixture is isolated from the map. It owns temporary Vite port 7747 and a headless Chrome process only for its duration, closes both in `finally`, and writes `test-results/source-light-lookup-gpu-check.json`. Coordinate GPU ownership with the root worker before running it.

The CPU tests verify both payload SHA256 values, all 49,152 original DFG RGB half words, all 16,384 IES half words, original-buffer immutability, the copied output array, repeat-U/clamp-V texture state, 1,073 pre/post-packing CPU DFG samples and shared sampler declarations. Both an existing DFG shader declaration and its insertion by the direct-light adapter are tested. A conflicting shared texture is rejected.

The hardware fixture uses the original separate DFG texture with its original clamp sampler and original separate IES texture with repeat-U/clamp-V as the comparison. This reference does not call the modified DFG sampling helper. A second shader uses the actual packed helper. There are 21,316 input cases:

- All 16,384 source texel centers.
- 324 boundary combinations, including coordinates outside 0–1 and either side of half-texel edges.
- 4,096 deterministic randomized cases, including perceptual roughness outside its clamped range and multiple IES U wraps.
- 512 samples forming 256 exact binary-fraction pairs separated by three IES U wraps.

The initial hardware run and corrected fixture are retained. The first run incorrectly assumed an eight-bit texture-weight error bound for ideal CPU bilinear filtering. Both packed and original GPU results were already identical, but some identical residuals exceeded that unsupported bound. The report is retained as `source-light-lookup-gpu-ideal-filter-assumption.json`. No runtime code or data was changed to address it. The final fixture retains ideal CPU residuals as diagnostics and separately validates the actual GLSL UV calculations through a test-only replacement of the final texture fetch. That check proves squared perceptual roughness and the half-texel clamp without asserting an unobserved driver interpolation precision.

Validated on ANGLE/D3D11, AMD Radeon integrated GPU 0x1636, maximum 16 fragment texture units:

- **85,264/85,264 scalars bit-identical** between packed and separate texture outputs; max difference zero in every channel.
- Original IES texel-center values exact and Repeat-U pairs exact.
- Actual helper coordinate calculations agree exactly with the independent CPU domain calculation.
- Lookup shader active samplers drop from two source samplers to one; the fixture's input sampler is counted separately.
- All 432 packed direct-light cases pass the unchanged independent punctual equations; maximum error **2.89797096678264e-7**. The actual decorated direct material has only `bf2_sourceDFG` as its source lookup sampler, no `bf2_sourceIes`.

This establishes preservation of the current original-data sampling behavior on this GPU. It does not claim original-game framebuffer parity or resolve native IES V-addressing provenance.
