# TextureArray1UV original static-atlas variant

This recovery uses retained RVM records, original shader bytecode and the existing original texture-array DDS. No new extraction, GPU or browser execution is involved.

The selected atlas deferred pixel shader is `15826ff02a`, SHA256 `12f1e3331cd66b9a2d05880b614c739b6debfdf430e42c1db089415cc739cefb`, for `Shaders/Presets/SS_PropsMetallicPreset_1UV_TextureArray_01`. Five retained RVM function instances select it. Their complete selection paths, paired vertex shaders, texture roles, constant keys and sampler records are in `exports/materials/array1uv-static-atlas/binding-evidence.json`.

All five bind `t2..t6` to native selectors 18–22: irradiance, direction R/G/B and sky visibility. Material NAM, detail array and color/smoothness retain their ordinary texture keys with register shift `t2/t3/t4` to `t7/t8/t9`. Detail UV scale and detail weight retain their original `cb1` offsets. The material samplers are distinct: NAM uses ordinary `s1` / atlas `s2`, source `0a829c84fa`, packed filter/address bytes `[85,1,3,1]`; array and color/smoothness use ordinary `s0` / atlas `s1`, source `5993a514cd`, bytes `[85,1,1,1]`. Atlas `s0` independently resolves to original atlas sampler `9216198462`. The parity checker includes resolved sampler identities in each symbolic texture sample and detects substituting the wrong NAM sampler. Native packed-descriptor conversion to the graphics API remains outside this proof.

The detail texture is a true `texture2darray`. Its exact source root `d72f699d-b7ad-f0da-de8e-7f2741b3ef4c`, file `15a8c654-a0e2-11e6-9bec-d439480edcea`, and resource `4455661931807515919` match the retained original ten-layer, 1024×1024, eleven-mip BC7_UNORM DDS already used by TextureArray2UV. The analyzer verifies its full hash, DDS header and original EBX identity. No payload is duplicated.

All material samples use the single original UV pair, PS `v6.xy`. NAM provides base normal RG, array selector B and metalness A. The exact array coordinate is `vec3(v6.xy * cb1[0].xy, NAM(v6.xy).b * 10)`. There is no explicit shader UV clamp, layer rounding or layer clamp. Color and raw smoothness are always twice the corresponding color/smoothness channel times array blue. Raw `cb1[1].x` affects only normal detail; source weights above one remain valid. Tangent normal is normalized before TBN mapping, and the final world normal is normalized again.

Ordinary `dfa7a16109` and atlas `15826ff02a` produce identical symbolic material albedo, raw smoothness, normalized tangent normal, final world normal and metalness for arbitrary UV, constants, TBN rows and typed array samples. Sampler identities are included. The atlas kernel is identical to floor `f789fdaafa`, including exact original float32 literal bits. The comparison interns 426 nodes and requires no algebraic canonicalization.

Final world normal is `r3.xyw`; raw smoothness is `r1.w`, written unchanged to `o0.z` and saturated inside the kernel. Metalness is NAM alpha in `r4.w`. Material ID is zero and reflectance is 0.5. There is no material AO multiplier or emissive addition: complete kernel RGB is multiplied directly by frame exposure for `o3.rgb`. Sky visibility `t6.r` goes directly to `o2.w`. Material color/detail registers survive the lighting kernel. No final nonnegative RGB clamp is added.

All five paired vertex variants forward material UV and a distinct radiosity pair. Two layouts pack radiosity in the unused ZW of the material input; others use a separate input. One variant has a separate zero-output branch; recorded routing describes its authored-output branch. Atlas PS lookup is `(v1.x*v2.w+v6.z, v1.w*v3.w+v6.w)`. Preserve original compressed atlas dimensions and the original affine UV transform.

The runtime recipe is `exports/materials/array1uv-static-atlas/integration-recipe.json`. It specifies final world `inverseTransformDirection(geometryNormal, viewMatrix)`, raw `bf2_array1uv_surface.smoothness`, AO `applications:0` / `value:1` / `existingHook:null`, and zero emissive.

Seven focused tests cover exact material and sampler parity; wrong layer factor, sampler, detail-weight saturation and world-normal normalization mutations; common-kernel smoothness saturation; full output composition; all five RVM routes; the original ten-layer array; and every VS UV layout. Reproduce with:

```
python tools/materials/array1uv-static-atlas-analyze.py
python tools/materials/array1uv-static-atlas-parity.py
python tools/materials/test-array1uv-static-atlas.py
```

This is static source proof, not an original-game runtime capture. Native pass activation, texture-view construction, hardware array-layer tie behavior, framebuffer quantization and browser derivative tangent parity remain unobserved. Original compressed atlas filtering and LightMapPreExposure are established separately by the floor/original-atlas recovery.
