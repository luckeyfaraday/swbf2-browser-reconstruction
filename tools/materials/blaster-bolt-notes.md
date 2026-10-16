# Original Walrus bolt rendering recovery

The selected rifle FX uses `FX/Shaders/Weapon/SS_BlasterBolt_Walrus`, name hash4035194024, compiled shader GUID72e4d8a1-9027-8e2d-0463-1cbf718fcfdf. Its source ShaderGraph belongs to the retained shared-weapons bundle. The map RVM does not contain this shader. The exact material variation0 routing is recorded in `exports/rifle-trail/render-shaders/render-material-analysis.json`.

`web/src/blaster-bolt-material.js` exports `prepareRecoveredBlasterBoltPixel(document,manager)` and `BLASTER_BOLT_GLSL`. The loader returns four original textures, explicit uniforms, source mesh provenance, and the source pixel equations. It does not choose blending, exposure constants, or a compositor. The public document is `/assets/recovered-blaster-bolt-material.json`. The four original mip0 BC7 SRGB textures total602,401 PNG bytes, with unchanged compressed mip payload evidence. Side/top samples use alpha; iris/screen flare samples use SRGB-decoded red.

The source mesh `/assets/meshes/blaster-bolt-source.glb` preserves363 original vertices and1350 indices. Position and UV0 are copied from the original half-format streams. The dedicated real GLTFLoader test compares every exported position/UV float and the entire index hash. The mesh includes separate ordinary-body and flare geometry; replacing it with a cylinder loses source behavior.

`web/src/blaster-bolt-vertex.js` exports `BLASTER_BOLT_VERTEX_GLSL` and `evaluateBlasterBoltVertex`. The production GLSL3 function `evaluateBlasterBoltVertex(sourcePosition,sourceUv,instanceId,cb1,cb2)` returns `BlasterBoltVertex(clip,v1,...,v8)`. The caller implements these bit-preserving source-load functions:

```glsl
uvec4 bf2BoltEmitter(uint element, uint byteOffset);   // native t26, stride912
uvec4 bf2BoltParticle(uint byteOffset);                // native t27, raw88-byte records
uvec4 bf2BoltDrawIndex(uint element, uint byteOffset); // native t28, stride4
```

Each hook returns four consecutive32-bit words beginning at the requested byte address; component swizzles occur in the translated shader. Unaligned vec4 boundaries must be handled. CB1 contains3vec4 and CB2 contains38vec4. Exact binding and stream-output layouts are in `/assets/recovered-blaster-bolt-vertex.json`. Native ring and sorted-index routing are retained and tested. A renderer assigning one emitter per browser instance can supply native instanceId0, set the local CB1 emitter index from the browser instance, and patch each emitter header to capacity1 with its raw particle address. This is an explicit browser resource arrangement, not a captured native batching policy.

All raw shader registers use `uvec4`. Float arithmetic reads through `uintBitsToFloat` and stores through `floatBitsToUint`. Storing shifted half words in float registers produces subnormal values that ANGLE/hardware can flush. The original bit patterns must survive until `unpackHalf2x16`. D3D disassembly uses PRINT_HEX_LITERALS; otherwise the source noise multiplier2^-32 prints as0.000000.

Native output associations are preserved: v1 contains side/segment parameters, v2 andv3 forward emitter bytes288/304, v4/v5 contain source colors and flare selector, v6.xyz is world position, v7 contains shape/amplitude terms, andv8.xy is original UV0. The pixel helper takes these values with `worldPosition=v6.xyz` and `uv=v8.xy`. The ordinary path sets v5.w=-.25; the active flare path uses source emitter byte464.w.

The pixel shader writes target0=`vec4(premultiplied radiance,0)` and target2=`vec4(native depth,1,0,coverage)`. `SV_Position.xy` follows D3D's top-left origin; a WebGL renderer must explicitly reconcile gl_FragCoord.y and its camera/depth convention. The pixel helper retains GLSL texture2D syntax for the existing material adapter convention; a raw GLSL3 wrapper may replace it with texture. Global CB2[40] is consumed as final multiplier.z and `.25+.75*.w`; the native producer values remain unresolved. Native graph ZBufferEnable=false and DrawPassForeground were recovered separately by the parent. They do not establish the later MRT2 composite/depth consumer.

The CPU comparison executes the unchanged original VS through D3D11 WARP and compares205 cases×363 vertices, or2,678,940 scalar outputs. Body geometry differs by at most1.52587890625e-5. Native sincos uses a different approximation from JavaScript's mathematical sine. The shader amplifies that difference through sin*262144 followed by fract. Default JavaScript therefore differs on three flare visibility thresholds while ordinary geometry remains within tolerance.

A separately compiled, explicitly labeled arithmetic probe captures410 sincos input pairs. Substituting only those native trigonometric results in the independent CPU evaluator makes every original VS output agree within1.52587890625e-5, flare geometry within1.1920928955078125e-7, and flare amplitude within8.940696716308594e-8; no visibility branches differ. The production GLSL retains sin/cos and does not contain a lookup replacement. The parent's independent hardware transform-feedback test also passed geometry and all visibility branches; its remaining flare amplitude difference was isolated by the same test-only trig substitution.

The independent pixel interpreter compares8,000 evaluations of the two original PS variants with maximum arithmetic error2.71e-16 under its documented double-precision model. This does not claim GPU FMA parity. Eight dedicated Node tests verify source hashes, selection routing, DDS payloads, real mesh loading, original VS outputs, raw half-word handling, and ring/sorted addressing.

Reproduce the bounded work:

```powershell
python tools/materials/blaster-bolt-analyze.py
python tools/materials/blaster-bolt-test.py
python tools/materials/blaster-bolt-prepare.py
python tools/materials/blaster-bolt-build-vertex.py
python tools/materials/blaster-bolt-trig-fixtures.py
powershell -NoProfile -File tools/materials/blaster-bolt-trig-warp.ps1
node web/tools/check-blaster-bolt-vertex.mjs
node web/tools/check-blaster-bolt-vertex.mjs --native-trig
node --test web/test/blaster-bolt-material.test.js web/test/blaster-bolt-vertex.test.js
python tools/materials/blaster-bolt-render-state.py
python tools/materials/blaster-bolt-native-state.py
```

The original VS capture is reproduced by the parent's `tools/gameplay-recovery/rifle-vertex-{fixtures.py,warp.cs,warp.ps1}`. The trig probe is separately compiled HLSL and remains clearly distinguished from that unchanged original shader execution.

The bounded native render-state investigation retains all512 table entries and285 unique128-byte serialized states, source BaseShaderState000000030501, and exact builder slot routing. Native RTTI resolves the original `Dx11RvmLegacyDrawStateBuilderInstructionFactory`; its retained abstract constructor installs a purecall vtable. The concrete runtime factory registration and live table selector remain unresolved. The six-byte source state size is corroborated by the native initializer. These records do not establish an additive blend policy or a foreground depth resolve; browser choices remain explicitly inferred until the consumer is recovered. All native executable work was read only, with bounded Ghidra analysis and discarded project changes.
