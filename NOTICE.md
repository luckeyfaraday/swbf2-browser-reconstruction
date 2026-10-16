# Notices and credits

## License

Copyright (C) 2026 the SWBF2 Browser Reconstruction contributors.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).

The vendored engine in `web/vendor/vibe-engine/` is distributed under the same license as part of this repository.

## Third-party software used by the tools (not bundled)

- **Frosty Toolsuite / Frosty Editor 1.0.5.2** — GPL-3.0, <https://github.com/FrostyToolsuite/FrostyToolsuite>. `tools/bf2-extract` is an adapter that loads the official Frosty Editor 1.0.5.2 runtime (`FrostySdk.dll` and its generated `StarWarsIISDK.dll`) from `tools/frosty-1.0.5.2/`, which you download yourself. Its XAS and EALayer3 decoders were used as independent references for the audio decoders here.
- **AssetBankPlugin** — GPL-3.0, <https://github.com/marv7000/AssetBankPlugin>. Reference for the ANT animation codecs; `tools/characters/firstperson-decode-dct.py` and `vader-decode.py` implement the DCT codec following it, and `tools/characters/firstperson-dct-reference` compiles its unmodified `DctDecompressor.cs`, `BitReader.cs` and `DofTable.cs` from a local checkout (`tools/characters/assetbank-reference/`) as a byte-for-byte cross-check.
- **three.js** (MIT), **three-mesh-bvh** (MIT), **Vite** (MIT), **Playwright** (Apache-2.0) — installed through `web/package.json`.
- **Khronos glTF Validator** (Apache-2.0) — `tools/bf2-extract/validation`.
- **Ghidra** (Apache-2.0) — the `*-ghidra/*.java` files are Ghidra scripts for bounded static analysis of your own installed executable; they contain no decompiled output.
- **Mono.Cecil** (MIT) — optional, used by `CecilInspect` to inspect the Frosty runtime's API.
- **PyAV** (BSD) with **FFmpeg** (LGPL) — EALayer3 frames are decoded through FFmpeg's MP3 decoder.

## Game data

Star Wars Battlefront II is © Electronic Arts Inc. and its licensors. *Star Wars* and associated marks are trademarks of Lucasfilm Ltd. / The Walt Disney Company. No game data, extracted assets, original shader bytecode or mechanical translations of it are included here; asset names, GUIDs, hashes and numeric values quoted in docs and tests are identifiers and facts used to locate and verify data in your own installation.
