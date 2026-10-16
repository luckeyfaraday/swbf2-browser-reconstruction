# First-person firing DCT recovery

`BF2-FIRSTPERSON-DCT-001` decodes three narrowly selected additive firing clips from the already retained common ANT bank. No new game extraction was required, and no browser files were changed for this investigation.

| Controller source name | Animation key | Keys | Named channels |
| --- | --- | ---: | ---: |
| `Add_1p_E11_SingleFire01` | `3b2ac052c09b443c` | 27 | 140 |
| `Add_1p_A280_SingleFire_02` | `abe82e7f987496cf` | 27 | 140 |
| `Add_1p_A280_SingleFire_03` | `c0fadfcf3cbf2e4e` | 27 | 140 |

Each source contains 85 quaternion and 57 Vec3 channels with zero packed scalar channels. The decoder resolves source DOF IDs through `Walrus_1p_HM_Rig`, reusing the exact first-person channel mapping recovered for the static poses. Two Vec3 DOFs remain unnamed. Their complete values are retained, not discarded.

The coefficient stream is read as signed, most-significant-bit-first values. Descriptor high nibbles give up to eight DCT bands; all selected low nibbles are zero. Each packed band contains four component widths with `0xF` replaced by the source catch-all width. The first block omits the baseline DC band; later blocks read DC deltas. Source `DeltaBaseX/Y/Z/W` values and the source quantization parameters complete the vectors. The retained reference uses rounded float32 inverse-DCT coefficients, so the Python implementation preserves those exact coefficients and arithmetic order.

`BF2-FIRSTPERSON-DCT-CROSSCHECK-001` compares the Python decoder with the **unmodified** retained upstream `DctDecompressor.cs`, `BitReader.cs` and `DofTable.cs`, compiled in a minimal test host. All **46,008 float32 values are byte-identical** across the three clips. Independent implementation agreement supports the codec interpretation; native game execution has not been observed.

Measured raw quaternion norms range from 0.99962865 to 1.00033048 before normalization. All remaining coefficient-stream bits are zero (219, 198 and 250 bits respectively). The source camera/SpineX rotations normalize to identity and their translations are zero. Weapon-root translation components peak around 3.66 cm for E11 and 2.28 cm for the A280 variants. These are local additive sample values, not measured world recoil or camera shake.

The output is `exports/characters/firstperson-dct/decoded-clips.json`. Each track retains `bone`, `property`, `sourceChannelIndex`, `sourceDofId`, `sourceSlot`, and all 27 `rawVec4` samples. Controller records, source key ticks, raw array offsets, original array values and independent binary sample outputs are retained beside it. Do not treat quaternion W as a Vec3 translation component; translation uses XYZ only. Normalize source quaternion samples before quaternion interpolation.

Native timing and composition remain unresolved. The observed controllers contain `FPS=30`, `TimeScale=0.5`; key ticks run from 0 to 30 with irregular gaps. These values are preserved separately. This recovery does **not** establish real-time clip duration, timescale application order, whether a clip completes before the next shot, quaternion multiplication order, additive weighting, procedural IK, or the native weapon-state graph's firing-variant selection policy. Nothing is automatically attached to browser models by this decoder.

Reproduce:

```powershell
python tools/characters/firstperson-decode-dct.py
dotnet build tools/characters/firstperson-dct-reference/firstperson-dct-reference.csproj -c Release --nologo
python tools/characters/firstperson-verify-dct.py
python tools/characters/firstperson-dct-test.py
```

Five focused tests pass: signed-bit boundaries, independent byte-for-byte sample agreement, original bank-array byte verification, additive/camera/sample checks, and rejection of truncated or unrecovered formats. The decoder intentionally rejects packed float channels and nonzero descriptor low flags. The test host and adapted codec retain upstream GPL-3.0 licensing; upstream source hashes and the full retained license path are recorded in the evidence output.
