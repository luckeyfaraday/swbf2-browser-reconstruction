# SWBF2 Browser Reconstruction

Tools for rebuilding **Star Wars Battlefront II (2017)** maps in a web browser from **your own installed copy of the game**. The pipeline reads the installed data (read-only), converts meshes, textures, collision, lighting, animations, sounds and gameplay values into browser formats, and a [three.js](https://threejs.org/) runtime plays them back.

The reference target is **Death Star II — Command Sector North** with Blast (team deathmatch) and Free for All, original trooper models, first-person arms, E-11 / A280 rifles, bots, and a playable **Darth Vader** (saber combos, block/deflect, Force choke, saber throw, Focused Rage) built from the game's own animation and kit data.

> **No game content is included in this repository.** You need a legitimately owned, installed copy of Star Wars Battlefront II. Everything the tools extract stays on your machine under ignored folders (`exports/`, `web/public/assets/`). Do not redistribute extracted files.

This is research-grade software: the reconstruction is checked against the original data wherever possible (decoders are cross-checked against independent implementations, native shader math against the original bytecode run on WARP), and every remaining guess is labelled in the code and docs. It is not a finished game and not a port of the original engine.

## What the pipeline does

| Stage | Tools | Docs |
| --- | --- | --- |
| Archive index, selective EBX/RES/chunk export, meshes, textures, map placement, collision | `tools/bf2-extract` (C# adapter on Frosty Editor 1.0.5.2) | [`tools/bf2-extract/USAGE.txt`](tools/bf2-extract/USAGE.txt) |
| Exact shader-section material binding; hand-written reimplementations of the map's material math; static lighting atlases, probes, reflections, exposure, bloom, shadows | `tools/materials` | [`tools/materials/README.md`](tools/materials/README.md) |
| Native render LODs | `tools/lod-recovery` | [`tools/lod-recovery/README.md`](tools/lod-recovery/README.md) |
| Characters: skinned meshes on the source skeleton, ANT animation decoding (raw and DCT codecs), first-person rigs | `tools/characters` | [`PROGRESS.md`](tools/characters/PROGRESS.md), [`VADER.md`](tools/characters/VADER.md), [`VADER-ANIMATION.md`](tools/characters/VADER-ANIMATION.md) |
| Audio: EA XAS and EALayer3 decoding | `tools/audio` | [`PROGRESS.md`](tools/audio/PROGRESS.md), [`VADER.md`](tools/audio/VADER.md) |
| Gameplay values from EBX (weapons, heat, recoil, round rules, hero kits) | `tools/gameplay-recovery` | [`README.md`](tools/gameplay-recovery/README.md), [`vader-evidence.md`](tools/gameplay-recovery/vader-evidence.md) |
| Browser runtime, tests and GPU checks | `web/` | [`web/README.md`](web/README.md) |

The order in which to run them is in **[docs/PIPELINE.md](docs/PIPELINE.md)**. There is no single "build everything" command yet; each stage documents its own commands and checks.

## Requirements

- Windows 10/11 (the extractor and several reference checks are Windows-only).
- Star Wars Battlefront II (2017) installed. The tools were developed against the final PC patch; the extractor's schema is pinned to Frosty's `StarWarsBattlefrontII` profile (DataVersion 20171117). Set `BF2_GAME_DIR` if your install is not at `C:\Games\Star Wars - Battlefront 2`.
- [Frosty Editor **1.0.5.2**](https://github.com/FrostyToolsuite/FrostyToolsuite/releases) unpacked to `tools/frosty-1.0.5.2/` (download it yourself; it is not bundled). The adapter checks the runtime and SDK hashes and does not work with other Frosty versions.
- .NET Framework 4.x (`csc.exe`, ships with Windows) to build the adapter; .NET 8 SDK only for the optional C# cross-check tools.
- Python 3.11 with `numpy`, `Pillow`; `av` (PyAV) for EALayer3 audio; `cityhash` for material binding.
- Node.js 20+ and Google Chrome (other Chromium browsers work for checks via `BF2_BROWSER_EXECUTABLE`).
- Optional: [AssetBankPlugin](https://github.com/marv7000/AssetBankPlugin) checked out at `tools/characters/assetbank-reference/` for the independent C# DCT cross-check.

## Quick start

```powershell
git clone <this repo> swbf2-browser-reconstruction
cd swbf2-browser-reconstruction
$env:BF2_GAME_DIR = 'D:\Games\STAR WARS Battlefront II'   # your install
# 1. put Frosty Editor 1.0.5.2 in tools/frosty-1.0.5.2, then:
./tools/bf2-extract/build.ps1
./tools/bf2-extract/bf2-extract.exe selftest
# 2. run the stages in docs/PIPELINE.md (they write exports/ and web/public/assets/)
# 3. play
cd web; npm ci; cd ..
./tools/play.ps1                 # or: ./tools/play.ps1 -Hero darthvader
```

`tools/play.ps1` starts a loopback dev server on port 7737 and opens the game in a dedicated Chrome window with `--force_high_performance_gpu` (on hybrid laptops Chrome otherwise renders WebGL on the integrated GPU). `?hero=darthvader` preselects Vader; `?shadows=0` disables native spot shadows; `?res=0.75` pins the render scale.

**Controls:** WASD move, Shift sprint, Space jump, C crouch, Alt roll/dodge, mouse fire/aim, R vent heat, V camera, Esc pause. As Vader: left mouse strikes, hold right mouse to block and deflect, Q saber throw, E Focused Rage, F Force choke.

## Tests

```powershell
cd web
npm test                                  # CPU tests (need your extracted assets)
node test/actual-map-check.mjs            # real map in headless Chrome (BF2_GPU=dgpu for the discrete GPU)
node test/hero-map-check.mjs --gpu=dgpu   # Vader on the real map
node test/map-tour-check.mjs --gpu=dgpu   # no shader compiles or long frames after load
```

Concurrent GPU checks can be serialized with `tools/gpu-lock.sh <command>`.

## Status and known gaps

Working: the map with original geometry, materials, static lighting atlases, probes, reflections, exposure, bloom and spot shadows; Blast/FFA rounds with bots; original trooper rigs, rifles, firing audio and recoil; Darth Vader with 128 source clips, recovered kit values and sounds; source death animations.

Not reproduced (see the stage docs for details): ragdoll physics, cloth (Vader's cape follows its skin weights), procedural bones/IK, the native animation graph's blending and warping, the full sound graph and mixing, several packed shaders, and native frame scheduling. Values that are interpretations rather than recovered fields are listed as such at runtime (`window.vibe.observe().hero.provisional` in agent mode).

## Repository layout

```
tools/            extraction, decoding and recovery tools (+ per-stage docs)
web/              browser runtime (src/), tests and GPU checks (test/), vendored vibe-engine (vendor/)
web/public/assets/heroes.json   hero descriptor (the only tracked file in the assets folder)
docs/             pipeline order and notes
exports/          (ignored) intermediate extraction output
web/public/assets (ignored) runtime assets produced from your install
```

## Legal

This project is not affiliated with, endorsed by, or sponsored by Electronic Arts, DICE, Lucasfilm or The Walt Disney Company. *Star Wars* and *Battlefront* are trademarks of their respective owners. The repository contains original code and documentation only: no game files, extracted assets, original shader bytecode, or translations of it. Use the tools only with a copy of the game you own and in accordance with its license terms; they read the installation and never modify it.

Source code is licensed under the **GNU General Public License v3.0** ([LICENSE](LICENSE)). Third-party components and credits are listed in [NOTICE.md](NOTICE.md).
