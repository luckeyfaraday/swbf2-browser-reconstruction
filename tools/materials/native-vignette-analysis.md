# Original global vignette

The browser applies the map's authored global vignette after exposure and before PQ/color grading. It uses scale `[2,2]`, exponent 1, black color and opacity 0.46. `recover-environment.py` publishes these settings with the native evidence hash; `source-vignette.js` implements the independently checked operation and `source-colorgrading-renderer.js` consumes it.

## Selection and native bindings

The selected level's object `internal:26` references `Levels/Lighting/Global/VE_Gamewide_01` at priority 8000. The enabled global environment includes vignette component `internal:10`, which overrides Enable, Scale, Exponent and Opacity. Black is the serialized default color. The selected Death Star interior environment has no vignette component. None of the 96 decoded installed initfs files contains a vignette override. Local environment/gameplay changes and user overrides are not captured.

Native type descriptor `144be8680` and field table `144dfb890` identify the state offsets: color 0, scale 0x10, exponent 0x18, opacity 0x1c and enable 0x20. `140d984b0` points the postprocess context at environment+0xd10. `14155c680` transfers context+8 into task input+0xe8; `141551030` copies the input at task+0x270 and installs the virtual callback `141568de0`. That callback reads the vignette at task+0x358 and requires both its enable byte and global vignette enable at settings+0x221. Native force-scale/exponent/color defaults use inactive -1 sentinels.

`14158b6b0` uploads the scale and **inverse** authored exponent to shader cb0+224, and RGB color plus opacity to cb0+240. `141595090` binds those parameters to the original vignette shader names. The selected HDR Tonemap shader executes:

```
d = (uv - 0.5) * scale
w = pow(clamp(1 - dot(d,d) * opacity, 0, 1), 1 / exponent)
color = (exposedRGB - vignetteRGB) * w + vignetteRGB
```

This operates on the exposed HDR color before PQ encoding and the authored LUT. There is no added screen aspect correction in the original prefix. The later RGB10A2 render plane and SDR merge remain unchanged.

## Independent execution

`native-vignette-warp.ps1` executes the unchanged original non-HDR linear Tonemap shader, SHA256 `b2fa39fcd1a70f7a0a45820ad72bb28fc267d0d8efc57549016d7971a7ac84e0`. Its vignette instruction prefix is identical to the selected HDR shader. Eight parameter cases cover the authored settings, inverse exponents, asymmetric scales, nonblack colors, zero/negative/high opacity and clamp boundaries: 6,144 pixels / 24,576 scalar outputs. Both CPU equations and the actual browser GLSL pass; AMD ANGLE versus native WARP maximum absolute residual is 0.0000061988831. All values are finite and there are no browser errors.

Separate `native-colorgrading-warp*-vignette` fixtures execute the complete unchanged HDR Tonemap and SDR MergeRenderPlanes shaders with the authored vignette. The browser's composed output passes the original RGB10A2-code ±1 envelope; only two channel codes differ by one, with final maximum residual 0.0034167171. This is an explicitly bounded cross-device arithmetic result, not a captured native-frame parity claim.

The combined real-map check at 19:28 UTC passes all 41 checks, 429 CPU tests and the 157-module build. Native bloom and local environment transitions remain separate work.
