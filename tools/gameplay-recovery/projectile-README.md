# Selected rifle projectile launch

The base E11 and A280 shots launch at **700 world units per simulation-time unit**. Their shared projectile entity's serialized speed of 350 is only the initializer's fallback when no launch record exists. This is static native evidence, not a measurement of native execution.

Both selected weapon blueprints reference their own firing asset, whose primary shot has `InitialSpeed=(0,0,700)`, empty pitch tables and zero velocity inheritance. Both `BlasterWeaponData` objects disable `ApplyPowerToSpeed`. Their default embedded modifier is a firing-effect modifier, not a shot-speed modifier. Conditional unlocks and external live modifiers are outside this baseline selection.

The bounded native chain is:

1. `0x1417e5780` reads the primary shot velocity. Reflection records establish `FiringFunctionData.Shot=+0xe0` and `ShotConfigData.InitialSpeed=+0x20`, hence the observed `+0x100` read. `0x141818e60` preserves it when no shot modifier is supplied.
2. Server velocity builder `0x1417d51d0` forces power to one when `ApplyPowerToSpeed` is false, rotates the vector into the firing basis, and adds inherited weapon velocity. The latter is zero for these shots.
3. Server launch `0x1417d4210` passes each generated velocity pointer in launch-record field `+0xd0`. `0x1417dbea0` and its generic tail-call bridge (`0x140b35730` / `0x140bbf530`) pass that record to virtual initializer `+0x160`.
4. WSBullet registration `0x1400c3c40`, factory `0x14717d990` and constructor `0x1419627d0` establish the actual server vtable. Its initializer is `0x1417e97e0`, which uses the supplied velocity pointer. Only a null record reads the projectile scalar at `+0xa8`. Its setter `0x1417dbc00` copies the vector to entity `+0x1f0`.
5. Its update `0x1417e5a70` advances by velocity times elapsed time, clips travel time at TTL, and submits the whole segment for collision. Selected gravity and first-frame travel distance are zero, `InstantHit=false`, TTL is three and detonation variation is zero.

Therefore `700*3=2100` is the **derived unobstructed lifetime travel bound**, not a serialized maximum range. Setting the browser range cap to that value removes its unsupported 150-unit early cutoff while retaining the existing lifetime and swept collision checks. No change to damage falloff is implied.

Reproduce with `python tools/gameplay-recovery/projectile-native-evidence.py`, then `python tools/gameplay-recovery/projectile-build.py`. The first checks exact installed PE metadata/vtable bytes and hashes the retained bounded Ghidra outputs; the second validates each source reference and emits `web/public/assets/projectile-launch.json`. Tests: `node --test test/projectile-launch.test.js` from `web`.

Integration: load the document only with the real faction weapon assets. Call `resolveProjectileLaunch(document, descriptor.id, {sourceGuid: sourceWeaponGuid})` when the caller has the source GUID, and merge its `parameters` into that weapon descriptor. The document has `primary` and `rebel-a280` entries and exact source GUIDs. Unknown fixture identities return null. Add `projectileSpeed` and `projectileLifetime` to source-derived provenance; record `range` separately as derived lifetime travel. Do not change generic fixture defaults. `selectedProjectileVelocity` exposes the magnitude-preserving direction adapter; the existing production scalar-speed segment update already implements the recovered zero-gravity stepping.

Camera/muzzle convergence, tracer appearance, native frame scheduling and prediction remain separate. The ray supplied to the helper is a browser composition choice. No claim about horizontal/vertical FOV follows from this recovery.
