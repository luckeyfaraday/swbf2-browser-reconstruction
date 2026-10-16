# Changelog

## 0.1.0 — 2026-10-16

First public release of the pipeline and runtime.

- Extraction adapter on Frosty Editor 1.0.5.2: archive index, selective EBX/RES/chunk export, meshes, textures, map placement, convex collision, doors.
- Exact shader-section material binding and reimplemented material math for the Death Star II map families; static lighting atlases, probes, reflections, DFG/IES, exposure, color grading, vignette, bloom and native spot shadows.
- Native render LODs.
- Characters on the source skeleton; ANT raw and DCT animation decoding (DCT byte-identical to AssetBankPlugin's decoder); first-person arms, ADS and firing.
- EA XAS and EALayer3 audio decoding (cross-checked against Frosty's decoders).
- Gameplay values from EBX: weapons, heat, spread, recoil, camera, projectiles, round rules, combat roll.
- Browser runtime: Blast and Free for All with bots on Command Sector North; playable Darth Vader (source clips, saber combos with recovered hit windows and root motion, block/deflect, Force choke, saber throw, Focused Rage, dodge); trooper death and reaction animations.
