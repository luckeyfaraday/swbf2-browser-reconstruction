# E11 firing audio checkpoint

- **AUDIO-E11-001 (observation)**: Installed `SW02_Weapons_Blasters_E11_SPC` refers to close wave `de3f0950-6dc8-11e6-a949-c85266d18219`, root `6cfd8f5a-58f3-7890-9723-03e291f828c3`, via its close StepLogicSampler. Source amplitude 0.9 and pitch 1. Runtime variations select randomly with history length 3. Nine one-segment variants share chunk `2b4576dc-b70d-3ab9-a377-7fb26f18b836`, 329,344 bytes.
- **AUDIO-E11-001 (observation)**: `decode-xas.py` validates 0x48/0x44/0x45 EA block structure, predictors, sample counts and segment bounds. All nine 48 kHz stereo PCM WAV durations match the EBX `SegmentLength` within 0.000002 seconds. Output totals 1,106,196 bytes. Original chunk, source EBX, offsets and SHA-256 retained.
- **AUDIO-E11-002 (observation)**: Unmodified Frosty source XAS decoder core compiled in `VerifyXas.cs`, with a minimal binary-reader shim. First variant PCM matches Python output byte for byte (61,634 interleaved samples). Original Frosty emits block padding; conversion trims only to the authoritative EA header count. Report: `exports/audio/e11-close/decoder-validation.json`.
- **Limitations**: This is the actual dry E11 close-shot component. Full native master-blaster graph, shared noise/HiFi layers, indoor reflections, distance crossfade and mixer gain processing remain open. No claim of complete native audio mixing parity. Runtime integration and audible playtest belong to runtime agent.

Reproduce the narrow extraction with `bf2-extract export --name Sound/Weapons/Blasters/E11/SW02_Weapons_Blasters_E11_SPC --depth 2 --max-assets 60`, then `raw --kind chunk --id 2b4576dc-b70d-3ab9-a377-7fb26f18b836`; specify the game and workspace output paths. Run:

```
python tools/audio/decode-xas.py exports/audio/e11-chain/ebx/Sound_Weapons_Blasters_E11_SW02_Weapons_Blasters_E11_Laser_Close_VAR_08__de3f0950-6dc8-11e6-a949-c85266d18219.json exports/audio/e11-close/2b4576dc-b70d-3ab9-a377-7fb26f18b836.chunk web/public/assets/audio
```

Runtime manifest: `web/public/assets/audio.json`. Conversion source manifest: `web/public/assets/audio/e11-close.source.json`.
