# Darth Vader and lightsaber audio checkpoint

Source: installed Star Wars Battlefront II (2017), patchHead 1930263, read through `bf2-extract.exe`
(Frosty 1.0.5.2 runtime, read-only). Outputs are new files only:

- `web/public/assets/audio/vader/*.wav`: 121 WAV files, 34.2 MB total. 16-bit PCM at the source rate (48 kHz) and source channel count.
- `web/public/assets/audio/vader.json`: runtime manifest. Maps each id to `{url, variations, loop, gain, gainBasis, pitch, selection, historyCount, channels, sampleRate, durations, source{asset, guid, chunk[], sha256[] (chunk hashes), patch, node, configuration}, note}`. URLs are relative to the manifest.
- `web/public/assets/audio/vader.source.json`: per-file provenance. Includes the source variation and segment indices, chunk offsets, WAV SHA-256, peak and RMS dBFS, the decoder report, the cross-check result, the full sampler and SPC parameter record, and loop-seam measurements.
- `exports/audio/vader-graph/`: the EBX JSON and raw chunks used. `ealayer3-validation.json` holds the decoder validation report.
- `tools/audio/decode-vader.py` is the decoder and manifest builder. `tools/audio/verify-ealayer3.py` validates the EALayer3 decoder. `tools/audio/vader-roots.txt` lists the export seeds.

## Ids

| id | source wave asset | files | channels | loop | gain |
|---|---|---|---|---|---|
| saber-ignite | Weapons/LightSaber/Start/SW02_..._Start_DarkSide_Red_VAR_01 | 4/4 | 2 | | 0.8 |
| saber-retract | Weapons/LightSaber/Stop/SW02_..._Stop_DarkSide_Red_VAR_01 | 4/4 | 2 | | 0.8 |
| saber-hum | Weapons/LightSaber/Idle/SW02_..._Idle_DarkSide_Red_01 (20.03 s) | 1/1 | 2 | yes | 0.465 |
| saber-hum-intense | Weapons/LightSaber/Idle/SW02_..._Idle_Intense_DarkSide_Red_02 (9 s) | 1/1 | 2 | yes | 0.64 |
| saber-swing | Weapons/LightSaber/Swing/SW02_..._Swing_Small_VAR_02 | 6/43 | 2 | | 0.92 |
| saber-swing-fast | Weapons/LightSaber/Swing/SW02_..._Swing_Fast_VAR_02 (pitch 0.92) | 6/56 | 2 | | 0.92 |
| deflect | Weapons/LightSaber/Deflect/SW02_..._Deflection_Blasters_VAR_02 | 6/52 | 2 | | 0.55 |
| saber-hit, saber-hit-tonal | Weapons/LightSaber/Impacts/..._Generic_VAR_01, ..._Tonal_VAR_01 | 6/103, 4/98 | 2 | | 0.38, 0.246 |
| saber-clash (+ saber-clash-tonal alias) | Weapons/LightSaber/Impacts/..._Block_VAR_03 | 6/43 | 2 | | 0.8 (0.32) |
| breath-slow/normal/fast/lowhealth | Characters/Heroes/DarthVader/..._Breathing_{Slow,Normal,Fast,LowHealth}_VAR_01 | 2/10, 3/18, 3/33, 3/20 | 1 | | 0.110 |
| foley-jog, foley-sprint | Characters/Heroes/DarthVader/..._Foley_Clothes_{Jog,Sprint}_VAR_01 | 4/38, 4/51 | 1 | | null |
| effort-attack/saberhit/hit/landing | Characters/Shared/HeroEfforts/DarthVader/..._{SaberBreath,SaberHit,Hit,Landing}_Vader_01 | 6/16, 4/13, 4/9, 3/6 | 1 | | null |
| death (+ death-grunt alias of effort-hit) | S1/Sound/Characters/Death/Hero/SW02_Characters_Death_Hero_SFX_DarthVader (4.57 s) | 1/1 | 2 | | 0.14 |
| choke-start | Powers/DarthVader/..._ForceChoke_Close_VAR_01 | 4/10 | 2 | | 1 |
| choke-loop | Powers/DarthVader/SW01_..._ForceChoke_Loop_04 (30 s) | 1/1 | 2 | yes | 0.35 |
| choke-bonecrack | Powers/DarthVader/..._ForceChoke_BoneCrack_Loop_Mono_01 (10 s) | 1/1 | 1 | yes | 0.75 |
| choke-end (+ rage-end alias, gain 0.65) | Powers/DarthVader/..._ForceChoke_Close_Deactivation_VAR_01 | 4/9 | 2 | | 0.75 |
| rage-start | Powers/DarthVader/..._ForceChoke_Affected_Start_VAR_01 | 3/5 | 2 | | 0.65 |
| rage-loop | Powers/DarthVader/..._ForceChoke_ForceDrone_Loop_01 (10 s) | 1/1 | 2 | yes | 1 |
| throw, catch | Powers/DarthVader/..._SaberThrow_{Throw,Catch}_VAR_01 | 4/6, 4/8 | 2 | | 0.9, 0.75 |
| throw-spin | Weapons/LightSaber/SaberThrow/SW01_..._SaberThrow_Projectile_01 (3.70 s) | 1/1 | 2 | yes | 1 |
| throw-return | Weapons/LightSaber/SaberThrow/SW01_..._SaberThrow_Returning_VAR_01.wav | 3/5 | 2 | | null |
| vo-intro, vo-ability1..3, vo-emote1..2, vo-alert-luke, vo-battle-intense | VO/MP/Hero/Vader/Core/SW02_VO_MP_Hero_Vader_Core_* (English) | 2/5, 2/9, 2/10, 2/10, 1/1, 1/1, 1/5, 2/20 | 1 | | null |
| music-intro | Music/Hero/DarthVader/SW01_Music_Hero_DarthVader_IntroShort_01 (13.05 s) | 1/1 | 2 | | null |

The files column is exported/source variations. The first N runtime variations are exported, in source order. VO uses only the English localization block.

## AUDIO-VADER-001: selection and playback parameters

**Observation:**
- Vader's saber uses `Sound/Weapons/LightSaber/SW02_Weapons_Lightsaber_Vader_SPC`, which is in bundle `characters/hero/darthvader/darthvader_01/vur_darthvader_01_bpb`. It configures the shared `SW02_Weapons_LightSaber_SourcePatch`:
  - WaveSwitcher `e595f6d8`: start and stop become `..._DarkSide_Red_VAR_01`. Index 0 is ignite and index 1 is retract. Both play through sampler `b3356576`, with amplitude 0.8.
  - Idle sampler `6ecbe8ad`: `Idle_DarkSide_Red_01`, amplitude 0.465, `Looping=true`.
  - Intense idle sampler `2e144555`: `Idle_Intense_DarkSide_Red_02`, amplitude 0.64, `Looping=true`.
  - Small-swing StepLogicSampler `b270229f`: amplitude 0.92.
  - Fast-swing StepLogicSampler `1bc76482`: amplitude 0.92, pitch 0.92.
  - Both swing config objects also list RateOfFire and MaximumRateOfFire 300. The flag bits do not appear to mark those fields as configured.
  - The deflect StepLogicSampler `17ae1f50` (`Deflection_Blasters_VAR_02`, default amplitude 0.55) is not overridden.
  - ScaleClamp `d2a33ea2` is reconfigured to OutMin 1.5 and OutMax 1. Its target in the graph is not traced.
- Impacts use `SW02_Weapons_SourcePatches_LightSaber_Impacts`, which has Generic sampler `a807d23f`, Tonal sampler `99069b6d`, and an explosion-ambience sampler `6fc27058`:
  - Character SPC: Generic 0.38, Tonal 0.246, ambience 0.17. Loudness 104 (configured).
  - Block SPC: Generic switched to `Impacts_Block_VAR_03` at 0.8, Tonal 0.32, ambience pitch 1. Loudness 104.
  - Both SPCs also randomize NumberGenerators (for example Block uses Min 0.95 and Max 1.2).
- Breathing patch: WaveSwitcher `1878d27f` selects among [Slow, Normal, Fast, LowHealth] into sampler `48000514` (amplitude 0.110249996, graph-connected). LowHealth uses Sequential variation selection.
- ForceChoke SPC on `SW02_Characters_Powers_SourcePatch_01`:
  - `cd1e4016` is the activation one-shot (`ForceChoke_Close_VAR_01`).
  - `b2d2cb05` is the release one-shot (`Close_Deactivation`, 0.75).
  - `fa3808c2` is a loop (`SW01 ForceChoke_Loop_04`, 0.35).
  - `c85fb483` is a loop (`BoneCrack_Loop_Mono_01`, 0.75).
  - `ee282a3f` is the distant layer (`ForceChoke_Distant_VAR_01`, 0.25; not exported).
  - The victim patch `ForceChoke_Affected` uses Affected_Start, the ForceDrone loop, the BoneCrack_Loop_01 loop, and mixer `SW02_Mixers_ForceChoke_Ducker`.
- Focus Rage is the SoundPatchAsset `..._FocusRage_SPC`. It has the ForceDrone loop on sampler `a2491f14`, and WaveSwitcher `ba1b9eef` with [Affected_Start, Close_Deactivation] on sampler `96b348a1` (0.65). There is also a MixerAsset `SW02_Mixers_DarthVader_FocusRage_IncreasedBreathing`; its preset values were not decoded.
- SaberThrow SPC (Loudness 100, configured): the Throw one-shot is 0.9 and the Catch one-shot is 0.75. WaveSwitcher `96c94577` gets the Returning wave. The spin loop is in patch `..._SaberThrow_Projectile`, sampler `8abc1674`, with Looping.
- Death SPC (`..._DarthVader_Death_3P_SPC`) only overrides waves (flags 16): `Efforts_Hit_Vader_01` on sampler `0d50c238` (default amplitude 8, connected) and `Death_Hero_SFX_DarthVader` on `5091a05a` (0.14).
- VO and effort patches (`Sound/VO/SoundPatches/*InWorld_Hero*`, exported to `exports/audio/vader-vo-patches`) contain only mixer sends and no sampler amplitudes. Their gain is null.
- Wave selection modes and history counts are copied from each SoundWaveAsset (`Random`/`Sequential`, history 3).

**Inference:**
- Config `ConfiguredPropertyFlags` bit layouts are inferred from the installed data:
  - SamplerNodeConfigData: Amplitude=1, Pitch=8, Wave=16. For example, flag 8 sets pitch 1 over the patch default of 1.2, and flag 9 carries pitch 1.4.
  - StepLogicSamplerNodeConfigData: Amplitude=1, Pitch=2, Wave=8. Flag 11 carries pitch 0.92, while flag 9 leaves pitch at 1 and sets a wave on a patch node whose wave is null.
- `gain` is the configured amplitude, or else the patch default. `gainBasis` records which. Most Amplitude ports are graph-connected, so the in-game value is further shaped by the graph. Examples are the hum-intense crossfade by saber motion, LFOs, and the ducking mixers.
- Treat gain as relative source level, not final loudness.

## AUDIO-VADER-002: codecs and decoder validation

**Observation, codecs encountered:** every SPS segment header is 12 bytes with no loop fields, type flag "stream", and 48 kHz.
- `0x14` EA XAS1: all SFX and music (91 exported files).
- `0x16` EALayer3 v2 "PCM": all efforts and VO (30 exported files; 579 segments in the export).

No other codecs were present.

**XAS:** decoded with the existing `decode-xas.py` `decode()`.
- All 91 outputs are byte-identical to the unmodified Frosty XAS core (`verify-xas.exe`) after trimming Frosty's block padding to the header sample count.
- Every duration matches the EBX `SegmentLength` within 1e-5 s.

**EALayer3 v2:** implemented in `decode-vader.py`.
- *Parse:* EA-frame header (ext, stereo, reserved, 12-bit frame size). Extended frames add offset mode, offset samples, PCM samples and common size. The common part is the MPEG version, rate, mode and mode extension, the granule index, scfsi, and per-channel side info of 12+47 bits followed by main data.
- *Rebuild:* each granule pair becomes a standard MPEG-1 Layer III frame: no CRC, 320 kbps slot, `main_data_begin=0`. A trailing lone granule gets an empty granule 1.
- *Decode:* FFmpeg `mp3float` through PyAV.
- *Validation over all 579 segments in the export* (`exports/audio/vader-graph/ealayer3-validation.json`):
  - Block sample sums equal the header count.
  - The granule count equals ceil(count/576).
  - The largest rebuilt frame is 761 bytes, which fits the 960-byte slot.
  - Every segment's only PCM frames are the first two granules: 576 samples each, offset mode 0, offset 0, mono.
  - The PCM replaces the decoded output of granules 0 and 1. Those 1,152 samples are identical to Frosty's `ealayer3.dll` output in 579/579 segments.
  - After that, the MPEG-decoded samples agree with Frosty's libmpg123 output within ±4 LSB over 58,952,815 compared samples, once a one-frame shift is applied (see AUDIO-VADER-003).

**Alignment evidence:** the decoded granule 2 must directly follow the PCM block.
1. Only this alignment yields exactly the header and block sample counts.
2. An LPC predictor fitted to the end of the PCM block predicts the decoded stream at offset 0 with a median relative error of 0.41. The errors are 8.8, 10.4 and 20.3 for offsets 529, 576 and 1152.
3. Offset 0 is the best fit in 573 of 579 segments. The remaining segments are near-silent starts.

## AUDIO-VADER-003: Frosty ealayer3.dll output is short

**Observation:** Frosty 1.0.5.2 `ThirdParty/ealayer3.dll` (SHA-256 a80fa429…3f33) returns the 1,152 PCM samples and then skips the first decoded MPEG frame (granules 2 and 3). Its output is 579 to 1,723 samples shorter than the EA header count. That is why it serves as a cross-check reference here and not as the decoder.

## Loops

**Observation:** loop-seam jump compared with the per-sample step distribution (`loopSeamJumpOverMedianStep` in source.json):
- The hum, hum-intense, bonecrack, drone and spin loops wrap within normal step sizes (at or below the 61st percentile).
- `choke-loop` (`SW01_..._ForceChoke_Loop_04`, 1,439,999 samples) has a right-channel jump of 2,517 LSB at the wrap, about 5x the 99th-percentile step. A short crossfade in the runtime would hide it.

No sample-level loop points exist: `FirstLoopSegmentIndex` and `LastLoopSegmentIndex` are 0, there is one segment, and the header has no loop flag. Looping comes from the sampler `Looping` flag.

## Unresolved / not done

- Full sound-graph evaluation, which covers connected amplitude and pitch drivers, the hum-intense motion crossfade, ScaleClamp `d2a33ea2`, LFOs and filters. Also not done: mixer presets (ForceChoke ducker, FocusRage breathing), HDR loudness, attenuation curves and reverb sends.
- Gains for foley, efforts, VO, throw-return and music were not resolved. The death-grunt value of 8 is a connected default, so it is left null.
- The VoiceLineAsset emotes (`gameplay/equipment/voicelines/hero/voiceline_hero_darthvader_1..4`) fail to deserialize in the Frosty 1.0.5.2 SDK with a type-builder error. Emote VO was taken directly from `SW02_VO_MP_Hero_Vader_Core_Emote1/2`, so the mapping from emote slot to line is unverified.
- These were not exported: the ForceChoke distant layer, reflection layers, the UX hit-confirm (`SW02_UX_Damage_Caused_LightSaber`), and the remaining source variations.

## Reproduce

```
cd tools/bf2-extract
.\bf2-extract.exe export --game "C:\Games\Star Wars - Battlefront 2" --out ..\..\exports\audio\vader-graph --names ..\audio\vader-roots.txt --depth 1 --max-assets 400 --raw
.\bf2-extract.exe export --game "C:\Games\Star Wars - Battlefront 2" --out ..\..\exports\audio\vader-vo-patches --names ..\audio\vader-vo-patches.txt --depth 0
cd ..\..
python tools/audio/decode-vader.py --exports exports/audio/vader-graph --out web/public/assets/audio --frosty-ealayer3 tools/frosty-1.0.5.2/ThirdParty/ealayer3.dll --verify-xas tools/audio/verify-xas.exe
python tools/audio/verify-ealayer3.py exports/audio/vader-graph tools/frosty-1.0.5.2/ThirdParty/ealayer3.dll exports/audio/vader-graph/ealayer3-validation.json
```

Requirements: Python 3 with numpy and PyAV (`av`, tested with 17.0.1, which bundles FFmpeg's `mp3float`). The two cross-check flags are optional.

The original export run also listed the four VoiceLineAssets, which failed to deserialize as noted above. They were removed from `vader-roots.txt`.
