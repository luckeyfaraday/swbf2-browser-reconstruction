# Original Corvette rigid40 candidate

`BF2-NATIVE-TANGENT-CORVETTE40-001` currently remains outside public assets. It covers eight exact records from four rigid assets:45 base instances, four selected lower LODs and35,476 vertices. Two composite52 sections are excluded. The candidate payload contains567,616 original tangent/sign bytes.

The complete original tree `edf2c9fdc0` and exact compiled section predicates select leaves2 and10 for these rigid assets. The ordinary PS `d92fda6613` is uniquely paired with original VS `c39d69a0b6`. The selected leaves do not reach five-atlas PS `cf1ffd68fd`; no atlas eligibility is inferred from the material family. Every original pointer edge is verified against the retained RVM bytes.

The exact input layout is `d184972227`:

| Offset | Source field | Original input format |
| --- | --- | --- |
| 0,6 | position and BinormalSign | Half4 |
| 8 | Color0 | RGBA8 UNORM |
| 12 | Normal | Half4 |
| 20 | Tangent | Half4 |
| 28,32 | UV0 and UV1 | Half4 |
| 36 | SubMaterialIndex | RGBA8 UINT |

Every source position, normal, UV0 and index agrees exactly with its current GLB. Both selected lower LOD pairs have equal original material parameter roots and this same direct input layout. The native VS forwards Color0 to TEXCOORD0, sends the UV pair through the original frame-row W components, and forwards SubMaterialIndex as unsigned integers to TEXCOORD5.

The unchanged original VS executed on CPU WARP over520 distributed source vertices and12 transforms. Results are56,160 frame scalar comparisons with maximum absolute error `1.2578388208783764e-7`, plus24,960 exact scalar comparisons each for UVs, normalized Color0 and unsigned SubMaterialIndex. This closes the earlier inferred input association for these eight records only. It does not establish the composite52 converter route, runtime-generated layer-table overrides or live native pass dispatch.

The eventual runtime hook can use the existing signed-cross frame formula with the original GLB normal. It needs one tangent/sign attribute, no extra source-normal attribute. Existing `bf2CorvetteDamage` UV1/damage/index bytes must remain unchanged. The material normal composition already has the ordinary single normalized TBN product, so the standard native mapped-normal helper applies. Expected instance/probe attribute budget is ten; these particular rigid sections have no selected static-atlas route. Runtime publication and material activation await the root checkpoint release.

Source reproducers are `native-tangent-corvette-select.py`, `native-tangent-corvette.ps1`, `native-tangent-corvette-prepare.py` and `native-tangent-corvette-warp.ps1`. The extractor uses its separate exact40-byte `native-tangent-corvette40.cs` reader. Tests reside in `web/test/source-tangent-corvette.test.js`; three source proof tests pass. Native source bytes, shader objects and outputs are retained under `exports/materials/native-tangent-corvette40`.
