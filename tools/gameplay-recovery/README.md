# Installed gameplay evidence

These scripts read local decoded EBX exports. They preserve original asset names,
GUIDs, archive SHA1s, JSON SHA256s, object IDs, and field pointers. They do not
change the game installation or bypass its startup failure. The parent REA
investigation retains provider evidence separately.

From `<repo>`:

```powershell
node tools/gameplay-recovery/build-gameplay.mjs
node tools/gameplay-recovery/build-map-region.mjs
```

`build-gameplay.mjs` validates the Imperial Assault default selection chain from
kit to E-11 unlock, weapon blueprint, firing configuration, and projectile. It
writes `web/public/assets/gameplay.json` with nine observed scalar values and
explicit inference/unknown lists. `gameplay-evidence.json` additionally preserves
unmapped heat and conflicting speed fields. No default speed, camera angle,
headshot multiplier, movement, or heat-state guess is promoted to evidence.

`build-map-region.mjs` writes all 38 source alternate spawn transforms and the
65-point combat polygon. The Online and Skirmish CombatArea connections are
checked using the EBX field hash. Coordinates remain in the source basis; the
scene converter must apply its own documented origin and handedness transform.
The combat polygon's Y coordinate is not a spawn height.

Evidence IDs: `EV-GAMEPLAY-20261015-01` and `EV-MAP-REGION-20261015-01`.
The original game has not been observed running. Decoded field values establish
configuration, not identical native execution.

The retained exports can be reproduced narrowly with the existing extractor:

```powershell
.\tools\bf2-extract\bf2-extract.exe export --game 'C:\Games\Star Wars - Battlefront 2' --out '<repo>\tools\gameplay-recovery\core' --names '<repo>\tools\gameplay-recovery\core-seeds.txt' --depth 0 --max-assets 10
```

Repeat for `detail-seeds.txt` to `detail` (`--max-assets 20`),
`final-seeds.txt` to `state` (`--max-assets 10`), and `map-seeds.txt`
to `map` (`--max-assets 10`). The single `e11-root` export uses
`--name Gameplay/Equipment/Rifles/E11/W_BlasterRifle_E11 --depth 0 --max-assets 1`.
Depth zero exports preserve the explicitly requested roots, not an entire
dependency closure. `schema-core.json` contains tool schema defaults and is
never a source of installed gameplay values.

Validation: `cd web; npm test` verifies source pointers and hashes, source damage
endpoint application, and provisional status of unresolved fields. `npm run
check:browser` is the explicitly labeled synthetic fallback integration check;
it cannot replace the missing authentic Vibe CLI gate or prove BF2 fidelity.
