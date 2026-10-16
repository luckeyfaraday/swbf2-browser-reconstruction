# Selected rifle spread, recoil and camera configuration

Evidence: **BF2-WEAPON-HANDLING-001**. Build with
`python tools/gameplay-recovery/weapon-handling-build.py`; validate with
`cd web; node --test test/weapon-handling.test.js test/source-combat.test.js`.

The generator follows both selected original-era Assault weapon blueprints
(E-11 and Rebel A280) into the exact shared GunSway, aiming and first-person
camera object GUIDs. The faction selection chain is retained separately in
`faction-weapons-evidence.json`. All 148 observed fields retain JSON pointers,
asset GUID/SHA-1 and decoded-file SHA-256. Twenty-three internal/external links
are asserted. Only three additional small support assets were extracted into
`exports/weapon-handling-support`; no game files were modified.

Both rifles reference `WeaponSway_Default_Rifle` asset
`959d8b88-5a31-434a-aab8-30b7047024a0`, object
`06baedb9-ddea-408a-a4ca-6f41773d9beb`. Stand hip dispersion has minimum .05,
maximum .7 and increment .08; moving raises the minimum to .1. Stand zoom
dispersion has minimum 0, maximum .5 and increment .05. Hip recoil increment
is .7 with horizontal range [-.5,.5]; zoom uses .55 and [-.3,.3]. These are
source numbers. The subsequent bounded native investigation now establishes
degree conversion and the spread equations; see `weapon-handling-native-README.md`. The older
FiringFunction WeaponDispersion angles are all zero; those fields cannot alone
establish that the selected rifles have zero spread.

The retained SDK getters establish that named stance structures and flattened
arrays are separate fields, not computed aliases. The report verifies 22
equal named/array records without claiming which native code reads. Named
Crouch and Prone structures omit jumping/sprinting records that occur in the
raw arrays; the selector returns null for those missing named states.

Camera layers remain separate:

| Source layer | Hip | Zoom |
| --- | --- | --- |
| Shared gameplay ZoomLevelData.FieldOfView | 55 | 23.9 |
| E-11 WeaponZoomLevelData.RenderFov | 55 | 55 |
| A280 WeaponZoomLevelData.RenderFov | 55 | 55 |
| E-11 animation KickbackFactor | 1 | 1 |
| A280 animation KickbackFactor | .8 | .5 |

A280 ordered weapon zoom index0 points to internal18, whose animation offset
is (.207,.33,-.189); index1 points to internal17, whose offset is zero. Numeric
object order must not replace the actual ZoomLevels reference order. E-11
uses internal19/internal20 and both offsets are zero. Shared FOV transition
type is Smooth, Shape2, zero delay/jump/end-early, non-inverted. Aiming stores
.2 FOV/zoom transition times. The source ZoomedSensitivity profile default is
1, min .1, max2; actual user settings are not read.

`web/public/assets/weapon-handling.json` carries the source configuration and
limitations. `web/src/weapon-handling.js` provides
`selectWeaponHandling(document,weaponId,{pose,aiming,movement})`. Supported
weapon IDs are `primary` and `rebel-a280`; states are explicitly selected by the
caller. It returns copied raw dispersion/recoil fields and separate camera
layers, with provenance. It does not alter shots, select random spread,
integrate springs, apply conditional modifiers or compose camera transforms.
The shared runtime files were not changed by this investigation.

The selected native spread path reads the flattened arrays, uses degrees,
samples a polar power distribution and applies the recovered increment/recovery
equations. Spring equations and user/aspect FOV scaling remain unresolved.
The first-person camera offset, animation weapon offset/kickback, CameraJoint
and recovered additive firing clips must not all be applied blindly: native
composition order is unresolved. The separately retained Splice sway modifier
is conditional on unlock `6acdd7f7-ed2f-4887-a1a8-db5ba8eec151`; its reduced
recoil values are not unconditional default rifle behavior.

The independent CPU combat regression uses actual source character rigs,
idle/run clips, original eleven bone capsules, E-11/A280 configurations and
production bot targeting/simulation/fire. On a synthetic navigable floor it
requires shots from both actors, animated movement, capsule damage, an
elimination, and a complete overheat/recovery cycle. It establishes browser
combat behavior under that arrangement, not native engine parity or actual
map navigation correctness.
