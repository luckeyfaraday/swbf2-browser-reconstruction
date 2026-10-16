# Native reflection volume records: BF2-NATIVE-REFLECTION-VOLUME-001

The original CPU packing of reflection volumes into `LocalIBLLightInfo` is recovered. This resolves the transform operation, shader-field construction and a CPU volume-size sort. The connection from the map's EBX entities to the intermediate native runtime records remains unresolved, so this evidence does **not** authorize treating entity matrix scale as the native extent or enabling projection in the current browser.

## Exact source chain

The original executable SHA256 is `d350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4`. `native-dfg-reflection-volumes.py` checks that identity, exact calls, leaf comparator bytes, source float constants and all21 RDEF member offsets. It writes function-range digests and the complete field mapping to `exports/lighting/dfg-reflection-volumes.json`. Retained bounded Ghidra instruction listings and decompilation are in `exports/lighting/dfg-native-functions/`.

`0x140f7f120` allocates `count*0xc0` bytes at output-context offset `0x1c0`, then calls `0x140f86570`. The latter consumes8-byte selected-volume records. Each record's uint16 at offset4 selects a224-byte runtime record from render-context pointer `+0x570`. It builds exactly192 bytes per selected volume. The main path `0x140f8fb00` independently calls the same builder after sorting.

Deferred dispatch `0x140f45b90` copies the192-byte records from `context+0x1c0` into the local-light constants. The pinned cube shader `local-type4.dxbc`, SHA256 `37dcf31fe69ffa9afef92b320e9208b74049210d16d4a967f3bde425be5c33d5`, names this exact layout `LocalIBLLightInfo`, beginning at cbuffer byte704. The structure's offsets and array stride agree with the CPU writes.

## Transform and field construction

Runtime bytes0..63 are a four-column transform. Call `0x140f86693` invokes helper `0x14024a620`: normalize each of the right, up and forward columns separately; if `dot(cross(right,up),forward)<0`, negate the normalized right column. Translation is retained. This removes scale, including a mirrored right axis, but does not orthogonalize sheared columns.

The builder replaces translation with `runtimePosition-cameraOrigin`. Call `0x140f866f0` invokes `0x140249460`, a rigid inverse. The three shader rows are therefore:

```text
[normalizedRight.xyz,   -dot(normalizedRight,relativePosition)]
[normalizedUp.xyz,      -dot(normalizedUp,relativePosition)]
[normalizedForward.xyz, -dot(normalizedForward,relativePosition)]
```

Extent is **separate** runtime data at `+0x40`, local offset at `+0x50`, side fades at `+0x60` and `+0x70`, and an influence anchor at `+0x80`. Runtime type at `+0x98` is0 for a sphere and otherwise follows the box branch. Expand and fade scalars come from `+0xbc` and `+0xb8`.

The GPU fields are:

| Field | Original producer |
| --- | --- |
| `pos` | runtime translation minus camera origin |
| `sqrAttenuationRadius` | `(radius+.01)^2`; radius is `extent.x+expand` for sphere, `length(extent+expand)` for box |
| `extend` | runtime extent unchanged |
| `textureIndex` | uint16 at runtime `+0x90`, converted to float |
| `extendPlusExpandDistance` | extent plus expand |
| `invInfluenceFadeDistance` | `1/max(fade,float32(.0001))` |
| `sideFadePositive`, `sideFadeNegative`, `localOffset` | their runtime vec3 values unchanged |
| `influenceFadeExtend` | anchor minus extent for sphere; anchor minus expanded extent for box |
| `extendMinusFadeDistance` | expanded extent minus fade |
| `skipSkyVisibilityAsAO`, `skipSkyVisibilityAsMask` | invert runtime bytes `+0xa5`, `+0xa6` into0/1 floats |
| `skyVisibilityScale` | `1+10*runtime.float[+0xa8]` |
| `skyVisibilityOffset` | `-(scale-1)*runtime.float[+0xac]` |
| `skipProxyReprojection` | invert runtime byte `+0xa4` into0/1 float |

The raw runtime inputs at `+0xa8/+0xac` are called `skySharpenInput/skyBiasInput` in the helper to describe their arithmetic role. Their assignment from similarly named EBX properties is not yet proven. The same qualification applies to the use flags and distance fields: the GPU meaning is established; the source entity conversion remains a missing producer edge.

## CPU ordering

Cull function `0x140f7f7d0` stores a float32 volume-size key at the start of each8-byte selected-volume record. For a sphere it evaluates `r*float32(4*pi)*r*r*float32(1/3)`; for a box it evaluates `ex*2*2*ey*2*ez`. These use the unexpanded runtime extent. The exact float constants are retained in the evidence JSON. The helper reproduces this multiplication order with float32 rounding.

The main path `0x140f8fb00` sorts the local-volume list at `param2[5]`, guarded by the count at `(*param2)+0x38`. Its comparator at `0x140f8cfc0` is the eight original bytes `8b1239110f92c0c3`, equivalent to unsigned32 ascending. Positive finite float-bit keys consequently sort by increasing volume. That same list reaches `0x140f86570` at its input `+0x50`.

This proves a CPU ordering operation. It does not yet prove GPU tile-list construction preserves that order, a stable tie policy, or that every runtime path applies it: `0x140f7f120` also reaches the builder without that main sorter. A separate special-volume branch tests camera containment and keeps a smallest containing candidate using its diagonal length; its runtime `+0x9f` flag has not been tied to the active level entities. It must not be conflated with the ordinary local-volume list.

## Exposure boundary

Render-pass wrapper `0x140fe87d0` copies a vec4 from its second input object at `+0x660`. The fourth float reaches deferred dispatch input byte `+0x68`, whose reciprocal is assigned to `g_invLrvExposureMultiplier`. The producer/type and selected value of that render-pass field remain unknown. An unrelated world-state structure also writes an offset `+0x66c`; offset equality alone does not establish an association, and that path was not used as evidence.

## Standalone helper and checks

`web/src/source-reflection-volume-data.js` exports:

- `decodeNativeReflectionRuntimeRecord(buffer,byteOffset)` for an actual224-byte native record.
- `sourceReflectionInverseRows(transform,cameraOrigin)` for the scale-removal/handedness/relative-inverse operation.
- `sourceReflectionVolumeSortKey(record)` returning the float32 volume and unsigned bit key.
- `buildSourceReflectionLightInfo(record,cameraOrigin)` returning a48-float/192-byte GPU record.

These are CPU helpers with no renderer or scene side effects. Required extent, offset and influence fields are explicit. There is no adapter from the existing public reflection manifest, and missing extents cause an error instead of an implicit scale interpretation. Matrix/packing equations use JavaScript arithmetic then float32 output; full native instruction/FMA identity is not claimed.

Seven Node tests pass, including1,000 independently generated rotated/scaled/mirrored/translated cases checked against Three's rigid matrix inverse, exact byte-offset decoding, every packed shader field, shape-specific expansion behavior, epsilon clamping, flags and positive size ordering. No browser or native game was launched for this pass.

```powershell
python tools/materials/native-dfg-reflection-volumes.py
cd web
node --test test/source-reflection-volume-data.test.js
```

The bounded upstream search retained native runtime update functions `0x140daf810` and `0x140dafb30`, which copy complete runtime records or transforms while preserving texture/state bits. A direct E8/E9 call, RIP-relative LEA and absolute pointer search found no references to those two entries in this executable; this is a narrow negative result, not proof they are unused. Their association with the map's EBX entity producers was not resolved. No projection, orientation, exposure or overlap runtime policy was changed.
