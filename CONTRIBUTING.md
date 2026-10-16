# Contributing

Thanks for helping rebuild Battlefront II in the browser. Contributions of decoders, recovered mechanics, new maps and heroes, performance work, docs and tests are all welcome.

## The one hard rule: no game data

This repository holds **original code and documentation only**. Never commit, attach to issues, or paste:

- files from the game installation, or anything extracted or converted from it (meshes, textures, audio, animation banks, exported EBX/RES/chunks, archive inventories, `exports/`, `web/public/assets/` except `heroes.json`);
- original shader bytecode or disassembly, or mechanical translations of it (such files are generated locally from your own install, e.g. `tools/materials/blaster-bolt-build-vertex.py`, and are gitignored);
- screenshots or captures of the original game's art beyond what is needed to describe a bug.

Asset names, GUIDs, hashes, field paths and individual numeric values are fine: they are how docs and tests locate and verify data in each user's own installation. CI runs `node tools/ci/check-no-game-data.mjs` on every push; run it before opening a PR.

You must own the game and use your own installed copy.

## How the project works

- Each stage lives in `tools/<stage>/` with its own document of commands, inputs, outputs and checks; [docs/PIPELINE.md](docs/PIPELINE.md) gives the order.
- Recovered values carry **provenance**: source asset, GUID and field path (or the decoded binary location). Anything that is an interpretation or a browser choice is labelled as such in code comments, data documents and docs (see `resolveHeroParameters` in `web/src/hero-combat.js` for the pattern). Please keep that distinction; "looks right" is not evidence.
- Decoders are cross-checked against independent implementations where one exists (Frosty, AssetBankPlugin), and native shader math against the original bytecode executed on WARP. New decoders should come with a comparable check.

## Development

```powershell
cd web
npm ci
npm run check:syntax      # parses every tracked JS module
npm run test:ci           # tests that need no game data (what CI runs)
npm test                  # full suite; needs your extracted assets
node test/actual-map-check.mjs   # real-map browser check (BF2_GPU=dgpu on hybrid laptops)
```

GPU-heavy checks can be serialized with `tools/gpu-lock.sh <command>` when several run on one machine.

Code style: match the surrounding file (the runtime is compact ES modules without a bundler-specific setup; Python tools are standalone scripts). Keep comments for the *why*, especially where behaviour is reconstructed rather than recovered.

## Pull requests

- Keep each PR to one stage or feature, with a short description and the checks you ran (the template lists them).
- Update the touched stage's document when behaviour, inputs or outputs change.
- By contributing you agree that your contribution is licensed under the GPL-3.0-or-later, the project's license.

## Ideas to start with

- A top-level script that chains the stages in [docs/PIPELINE.md](docs/PIPELINE.md).
- More heroes: the human-skeleton saber heroes follow the Vader path (see "Adding another hero" in the pipeline doc).
- Ragdoll and cloth, the native animation graph's blending, the sound graph, more maps and modes.
