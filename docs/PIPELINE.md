# Pipeline order

Run everything from the repository root. Each stage reads your installation (`BF2_GAME_DIR`) or earlier stages' output in `exports/`, and writes runtime files to `web/public/assets/`. Every stage's own document lists exact commands, inputs, outputs, checks and known limitations; this page is the order to run them in.

> The reconstruction was developed incrementally and is reproducible stage by stage, but there is no single top-level build script yet. Contributions that chain these stages are welcome.

## 0. Prepare

1. Install the requirements in the [README](../README.md#requirements) and unpack Frosty Editor 1.0.5.2 to `tools/frosty-1.0.5.2/`.
2. Build and self-test the adapter (the self-test does not touch the game):
   ```powershell
   ./tools/bf2-extract/build.ps1
   ./tools/bf2-extract/bf2-extract.exe selftest
   ```
3. Make sure the game is fully installed and updated through your store client (its own "repair/verify files" function is the integrity check).
4. The first game access builds Frosty's index (`tools/bf2-extract/work/starwarsii.cache`, ~250 MB). Later runs reuse it and allow concurrent readers.

## 1. Map geometry, placement and collision — `tools/bf2-extract`

Follow [`tools/bf2-extract/USAGE.txt`](../tools/bf2-extract/USAGE.txt): inventory and export the `DeathStar02_01` level graph, export its rigid meshes and textures, recover group transforms and convex collision (`recover-group-transforms.py`, `recover-convex-collision.py`), door configuration (`build-door-config.py`), then assemble and finalize the scene:

```powershell
./tools/bf2-extract/rebuild-map-scene.ps1      # assemble-scene.mjs + finalize-scene.mjs -> web/public/assets/map.scene.json
```

## 2. Materials, lighting and post-processing — `tools/materials`

[`tools/materials/README.md`](../tools/materials/README.md) covers the exact shader-section binding (`prepare-materials.py`, `plan-materials.py`, `apply-materials.py`), texture conversion, and one note per recovered material family (`*-notes.md`), plus static atlases, probes, reflections, DFG/IES lookups, exposure, color grading, vignette, bloom and spot shadows. Material equations are hand-written reimplementations checked against the original pixel shaders on WARP.

The rifle-trail vertex shader is the one place where a **mechanical translation of original bytecode** is used. It is generated locally and must never be committed:

```powershell
python tools/materials/blaster-bolt-build-vertex.py   # -> web/src/blaster-bolt-vertex.js (gitignored)
```

## 3. Render LODs — `tools/lod-recovery`

See [`tools/lod-recovery/README.md`](../tools/lod-recovery/README.md).

## 4. Characters and animation — `tools/characters`

- Troopers, rifles and first-person rigs: [`PROGRESS.md`](../tools/characters/PROGRESS.md) (reproduction section), `firstperson-README.md`, `firstperson-dct-README.md`, `ads-README.md`.
- Darth Vader model and saber: [`VADER.md`](../tools/characters/VADER.md).
- Vader and trooper reaction/death animations: [`VADER-ANIMATION.md`](../tools/characters/VADER-ANIMATION.md):
  ```powershell
  python tools/characters/vader-graph.py
  python tools/characters/vader-decode.py
  python tools/characters/vader-verify-dct.py      # optional C# cross-check (needs AssetBankPlugin checkout)
  python tools/characters/vader-build-glb.py
  node   tools/characters/vader-animation-check.mjs
  ```

## 5. Audio — `tools/audio`

[`PROGRESS.md`](../tools/audio/PROGRESS.md) (E-11 / A280 shots) and [`VADER.md`](../tools/audio/VADER.md) (saber, Vader, powers; EA XAS and EALayer3).

## 6. Gameplay values — `tools/gameplay-recovery`

First export the EBX those scripts read: `./tools/gameplay-recovery/export-sources.ps1` (replays the recorded selections from the seed lists). Then see [`README.md`](../tools/gameplay-recovery/README.md) for weapons, heat, spread, recoil, camera, projectile and round rules (`build-gameplay.mjs`, `build-map-region.mjs`, …) and [`vader-evidence.md`](../tools/gameplay-recovery/vader-evidence.md) for the hero kit (`build-hero-vader.py`).

## 7. Run and check — `web/`

```powershell
cd web; npm ci; npm test; cd ..
./tools/play.ps1 -Hero darthvader
```

See [`web/README.md`](../web/README.md) for the asset contract the runtime expects and the browser checks.

## Adding another hero

Human-skeleton heroes (Luke, Palpatine, Maul, Kylo Ren, Rey, Obi-Wan, Anakin, Dooku) follow the Vader path: their meshes use `Characters/Rigs/Humanoids/Walrus_HumanMale` and their clips sit in the same common animation bank. Add an entry to `web/public/assets/heroes.json`, decode the hero's clips with a new list in `vader-decode.py`, and recover the kit with a script modelled on `build-hero-vader.py`. Yoda and Grievous use their own skeletons.
