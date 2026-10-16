# Master1UV original static-atlas variant

The recovered atlas PS is `965fbe264b`, SHA-256
`1208fb56068293cdf09b3a42342f31a5b4372d51da1c3fd2202b4b9d02792f3f`.
Its shader family is `Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_1UV`.
This is static shipped-artifact evidence, not an original-game frame capture.

Machine-readable output is retained in
`exports/materials/master1uv-static-atlas/integration-recipe.json`, with separate
`binding-evidence.json` and `parity-evidence.json`. No shared runtime file was
edited for this recovery.

## Binding

All eight retained function instances reach the original PS through their exact
default-value/parameter-block chains. The report records each chain, paired VS,
direct input table, texture conversion and apply operation.

| Register | Original selector / material role |
| --- | --- |
| t2 | 18: lightmap irradiance |
| t3 | 19: red direction |
| t4 | 20: green direction |
| t5 | 21: blue direction |
| t6 | 22: sky visibility |
| t7..t16 | Ordinary Master1UV t2..t11, unchanged parameter keys and order |

The ten material roles remain global wear, wear, ID, normal/AO, grunge,
anodized, rubber, metal color/smoothness, metal normal, aluminium. All nine
cb1 parameter keys and byte offsets match the already recovered ordinary
Master1UV shader. Atlas s0 resolves to the same packed sampler
`9216198462` as the validated floor atlas variant.

The PS atlas coordinate is
`(v1.x*v2.w+v7.z, v1.w*v3.w+v7.w)`. For example paired VS `007bb70865`
passes source v4 radio UV to o2.w/o3.w and source material v3 UV to o7.xy,
while the instance record supplies the affine scale/offset. Use the existing
original radiosity UV extraction and original-size compressed atlas path.

## Material and lighting parity

The lane-level symbolic interpreter compares arbitrary source input symbols,
not a finite set of numeric material samples. It verifies the same albedo,
raw smoothness, normalized final TBN world normal, metalness and material AO
expressions as ordinary PS `6d0dd89b35`. The only material canonicalization is
commuting `sat(n)+sat(-n)` operands for geometric-normal components. It does
not reassociate sums or modify shader arithmetic.

The entire directional irradiance and broadened baked-specular kernel has
identical symbolic expressions to floor PS `f789fdaafa`. Exact unique float32
literal words are verified against both original DXBC files. The kernel
requires no canonicalization. This closes kernel reuse using the floor's
existing unchanged-original-shader WARP validation; no additional WARP or
browser GPU execution was necessary.

Master1UV feeds the **final normalized TBN world normal** (`r3.xyz`) to that
kernel, and raw material smoothness (`r1.w`, also o0.z). The kernel saturates
smoothness internally. The interpolated geometric normal used for grunge is
not the lighting normal, and Three roughness is not the source smoothness.

After atlas evaluation, `mul r0.xyz,r4.wwww,r0.xyzx` multiplies the **entire**
prelighting RGB by the normal/AO texture alpha. This includes directional
diffuse and broadened baked specular. The next multiply applies frame
exposure. Keep the existing single `bf2_master_surface.ao` indirect-diffuse
hook; do not multiply AO inside the common atlas helper as well.

Material ID remains 0, reflectance remains .5, and metalness retains the
ordinary material equation. Sky visibility is directly t6.r → o2.w, separate
from material AO. Unlike the ordinary SH prelighting path, this atlas variant
has no final `max(prelighting,0)` operation.

## Validation and limits

Run, in order:

```
python tools/materials/master1uv-static-atlas-analyze.py
python tools/materials/master1uv-static-atlas-parity.py
python tools/materials/test-master1uv-static-atlas.py
```

Four regression tests pass. They check arbitrary symbolic material outputs,
floor kernel parity, rejection of a mutated smoothness-saturation operation,
the original single AO multiply, and all eight source binding instances.
Every compared output is checked for uninitialized symbolic inputs.

These proofs do not establish original runtime pass selection, GBuffer view
quantization, browser TBN changes or native frame scheduling. Original-size
compressed filtering, source LightMapPreExposure and browser source-coordinate
mapping retain their separately established evidence and limitations. Moving
actors/doors must retain their appropriate nonstatic lighting path.
