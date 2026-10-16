# Rejected cropped atlas candidate and decode provenance

The cropped RGBA32F floor atlas is retained as a diagnostic candidate, not a
runtime asset selection. Its published manifest explicitly records
`runtimeEligible: false` and `status: rejected-filtered-candidate`.

The source BC blocks were copied without changing their bytes, and the CPU
WARP decoder preserved each sampled decoded texel. The 13 published scalar
lanes were also copied bit-for-bit. Those facts did **not** establish equivalent
filtered samples after cropping, UV rebasing and conversion to RGBA32F.

The original-size comparison retained in
`web/test-results/source-static-atlas-packing-gpu-check.json` observed a maximum
HDR absolute difference of **43.625** for the cropped float candidate, despite
exact point samples. Adding original-source padding fixed the previously found
rounding guard issue but did not remove the filtered difference. Therefore this
candidate must remain disabled. No arbitrary exposure adjustment can validate
this change in sampling.

The selected replacement is the original-size BC6H irradiance texture plus an
original-size four-layer BC7 array, retaining source UVs and filtering. That
comparison reports exact equality for all **134,096 filtered scalar samples**
and its exact-texel samples. The separate replacement publisher and runtime
adapter are handled by the runtime integration step; this document does not activate
them or claim an original-game runtime capture.

## Reproducible CPU decode

`native-static-atlas-decode.cs` writes schema version 2 of
`decode-execution.json`. It records:

- Exact manifest byte length and SHA-256.
- Decoder source, executable and diagnostic HLSL hashes.
- Each field's compressed input filename, byte length, SHA-256, dimensions and
  DXGI format. Before decoding, the input hash must match the manifest.
- Each field's float32 output filename, byte length and SHA-256.
- The actual D3D11 CPU WARP backend and adapter name.

The decode is a `Texture2D.Load` diagnostic, not the original material shader.
It explicitly rejects unsupported formats, duplicate fields and incomplete
dispatch dimensions. The scoped current floor input is 1024×520, with five
BC6H/BC7 inputs and five RGBA32F outputs.

`native-static-atlas-publish-floor.py` verifies the exact manifest and all
compressed/decoded hashes before writing candidate outputs. It also verifies
shader identity, field uniqueness, dimensions, format and byte lengths. Fields
are selected by their source names rather than relying on manifest list order.
The verified execution record is copied into the candidate manifest.

The CPU floor decode and candidate publication were regenerated with this
record. Six corruption checks reject a changed same-sized manifest, changed
same-sized compressed input, changed same-sized decoded output, stale decode
manifest, duplicate field and old hashless provenance. Published texture and UV
payload hashes were independently checked afterward. No browser or hardware
GPU run was performed during this provenance repair.
