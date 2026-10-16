# Death Star Assault faction weapons

`BF2-FACTION-WEAPONS-001` resolves the faction substitution missing from the
original table-only selection. Both Death Star Assault kits use GP_Assault.
Its default primary ability has Identifier 2676124552 and creates the E11 unlock.
The Imperial kit has no ability modifiers. The Rebel kit selects
`DefaultWeapon_L_Assault_Orig`, a SoldierWeaponCustomizationModifier with that
same identifier and `UnlockToCreate=U_BlasterRifle_A280`.

The resulting A280 blueprint points directly to the recovered third-person
mesh, the same Default_Rifle projectile and heat configuration, and its own
firing asset. Its FiringFunction matches the E11 recursively except for the
Sound reference and serialization identities. Both fire automatically at 300 RPM with
damage 36→19 over 20→40 m and lifetime 3 seconds. Projectile speed precedence and heat
transition interpretation remain unresolved.

Outputs ready for runtime integration:

- `web/public/assets/faction-weapons.json`: team 0 Rebel A280, team 1 existing primary E11.
- `web/public/assets/faction-a280/meshes/faction-a280.glb`: actual third-person LOD0,
  9,649 vertices, 44 source bones, no discarded weights, source body CS/normal.
- `web/public/assets/faction-a280/faction-a280-audio.json`: nine original dry close
  shots, random history 3, source amplitude .9 and pitch 1.
- `faction-weapons-evidence.json`: 14 source hashes, 27 field observations,
  exact identifier/reference assertions and artifact hashes.

Skin bind matrices agree within 6.6e-9. Khronos validation has zero errors and
one generated-tangent warning. Lens shader is still unresolved. The first-person
camera offset is reused provisional placement of the recovered third-person mesh.
The display label follows the source A280 asset, not recovered localized UI text.

Audio uses four source chunks totaling 361,120 bytes. `tools/audio/faction-decode-a280.py`
extends the retained XAS decoder's narrow selection to multi-chunk variations,
validates chunk/segment boundaries and source durations, and compares all nine
PCM outputs against the independent retained Frosty C# core. It preserves source
segments, reference PCM, chunk hashes and output hashes. Full distance/environment
layers and native gain are not recovered.

Rebuild reports/runtime manifest with:

```powershell
python tools/audio/faction-decode-a280.py
python tools/gameplay-recovery/faction-weapons.py
cd web
node --test test/faction-weapons.test.js
```

Narrow source exports are retained in `exports/faction-*`, each with source
session metadata. Use `bf2-extract.exe` for EBX/texture/raw commands,
`bf2-materials.exe shaderblocks`, and `bf2-info.exe mesh-info`; their checked-in
versions expose different command sets. The mesh seed is
`tools/gameplay-recovery/faction-mesh-seeds.txt`. Reuse the existing extraction
work/cache and do not rebuild unrelated animated actors.

Character conversion uses `character-extract.exe` with explicit
`--name gameplay/equipment/rifles/a280/a280_mesh3p_mesh`,
`--skeleton Characters/Rigs/Weapon/WeaponSke01`, `--lod 0`, and the new faction
output directory. Bind with `bind-skin.mjs`; retained material plan and shader
blocks resolve the exact MeshSet.NameHash/default-variation/LOD/section branch.
`apply-materials.py` writes only `web/public/assets/faction-a280/meshes` and its
sibling textures folder. Existing E11 assets are untouched.
