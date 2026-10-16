# Native local-volume sky visibility

Evidence `BF2-NATIVE-LOCAL-REFLECTION-VISIBILITY-001` is retained in
`exports/lighting/local-reflection-visibility.json`. Reproduce it with
`native-local-reflection-visibility.py`; run the matching test script.

The exact consumer is the original `DeferredTiledLightingCS`, lightType4,
materialPassType0, dynamicAO0, retained as `dfg-reflection-shaders/local-type4`.
Its DXBC SHA256 is
`37dcf31fe69ffa9afef92b320e9208b74049210d16d4a967f3bde425be5c33d5`.
This is local cubemap lighting, independently of the common/distant IBL shader.

Native floor atlas PS `f789fdaafa` writes t6.r to GBuffer2.w; the local consumer
loads GBuffer2 through t2.w into r5.x, then saturates it. Both original sphere
and box branches calculate exactly:

```
s = saturate(saturate(skyVisibility) * skyVisibilityScale + skyVisibilityOffset)
ao = min(screenDiffuseOcclusion, max(s, skipSkyVisibilityAsAO))
specOcc = saturate(pow(NdotV + ao, exp2(-16 * perceptualRoughness^2 - 1)) + ao - 1)
skyMask = max(1 - s, skipSkyVisibilityAsMask)
```

Here `screenDiffuseOcclusion` is the source t10 texture, not an interchangeable
material AO map. The source normal/view dot is saturated. Roughness is one minus
native GBuffer smoothness. The DFG response and cube RGB multiply specOcc.
The geometric influence fade multiplies skyMask; that combined mask multiplies
RGB and cube alpha coverage. Ordered accumulation remains:

```
RGB += remaining * geometricFade * skyMask * specOcc * DFGResponse * cubeRGB
       * inverseLRVExposure
remaining *= 1 - geometricFade * skyMask * cubeAlpha
```

Thus sky AO and sky coverage mask are independent controls with different
roles. The mask suppresses local volume influence in open-sky regions; sky AO
can suppress reflection brightness in closed regions. They cannot be replaced
by one general darkening multiplier.

The shader RDEF names these exact per-volume fields at cbuffer offsets860,
876,880,884. Native builder `140f86570` inverts runtime bytes+a5/+a6 to the two
skip flags, calculates scale=`1+10*runtimeFloat[a8]`, and
offset=`-(scale-1)*runtimeFloat[ac]`. That producer and all offsets are already
validated by `native-dfg-reflection-volumes.py`.

All88 selected, enabled and visible authored volumes have:

| Source EBX field | Every selected volume |
| --- | --- |
| UseSkyVisibilityAsAO | false |
| UseSkyVisibilityAsMask | false |
| SharpenSkyVisibility | 0 |
| BiasSkyVisibility | .5 |

**Conditional inference:** if these authored flags reach the corresponding
runtime record fields unchanged, both skips are1. Then skyMask is1 and
ao equals the source screenDiffuseOcclusion, independently of atlas sky. With
screenDiffuseOcclusion1, specOcc is also1. The source audit therefore gives no
support for introducing blanket atlas-sky darkening on the current local cubes.
The exact EBX-to-runtime record producer edge remains unproved; matching field
names alone are not promoted to that proof.

The validator independently interprets the original arithmetic slices of both
branches and compares1,200 cases per branch against the compact equations.
Maximum absolute double-algebra difference is4.440892098500626e-16. Tests also
check authored88-volume identity, independent control polarity, and invariance
to atlas sky when skips are enabled while preserving screen occlusion. No
native game or hardware GPU was run. This is algebra/asset evidence, not an
original live frame capture. Projection, volume order, geometric field linkage
and capture exposure remain separate reconstruction limits.
