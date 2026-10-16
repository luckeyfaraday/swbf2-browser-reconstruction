"""Decode the source Rebel-default A280's nine close variations across four chunks."""
import hashlib
import importlib.util
import json
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "exports/faction-a280-audio"
CHUNKS = ROOT / "exports/faction-a280-audio-chunks"
OUT = ROOT / "web/public/assets/faction-a280/audio"
OUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("ea_xas", ROOT / "tools/audio/decode-xas.py")
codec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(codec)
path = next((BASE / "ebx").glob("*Laser_Close_VAR_01__*.json"))
document = json.loads(path.read_text(encoding="utf-8-sig"))
root = document["asset"]["objects"][0]
patch_path = next((BASE / "ebx").glob("*_SPC__*.json"))
patch = json.loads(patch_path.read_text(encoding="utf-8-sig"))
samplers = [o for o in patch["asset"]["objects"]
            if (o.get("Wave") or {}).get("$external") == document["entry"]["guid"]]
assert len(samplers) == 1
sampler = samplers[0]
chunks = []
chunk_sources = []
for chunk in root["Chunks"]:
    file = CHUNKS / (chunk["ChunkId"] + ".chunk")
    data = file.read_bytes()
    assert len(data) == chunk["ChunkSize"]
    chunks.append(data)
    chunk_sources.append({"guid": chunk["ChunkId"], "file": file.relative_to(ROOT).as_posix(),
                          "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

reports = []
for index, variation in enumerate(root["RuntimeVariations"]):
    assert variation["SegmentCount"] == 1
    segment_index = variation["FirstSegmentIndex"]
    segment = root["Segments"][segment_index]
    chunk_index = variation["ChunkIndex"]
    data = chunks[chunk_index]
    start = segment["SamplesOffset"]
    later_offsets = [root["Segments"][v["FirstSegmentIndex"]]["SamplesOffset"]
                     for v in root["RuntimeVariations"] if v["ChunkIndex"] == chunk_index
                     and root["Segments"][v["FirstSegmentIndex"]]["SamplesOffset"] > start]
    end = min(later_offsets, default=len(data))
    assert 0 <= start < end <= len(data)
    pcm, info = codec.decode(data[start:end])
    assert abs(info["duration"] - segment["SegmentLength"]) < .000002
    name = f"faction-a280-close-{index + 1:02d}.wav"
    file = OUT / name
    with wave.open(str(file), "wb") as output:
        output.setnchannels(info["channels"])
        output.setsampwidth(2)
        output.setframerate(info["sampleRate"])
        output.writeframes(pcm)
    # Independent retained Frosty C# core: compare exactly the declared samples,
    # leaving only original decoder block padding outside the comparison.
    segment_file = CHUNKS / f"faction-segment-{index + 1:02d}.ea"
    reference_file = CHUNKS / f"faction-reference-{index + 1:02d}.pcm"
    segment_file.write_bytes(data[start:end])
    subprocess.run([str(ROOT / "tools/audio/verify-xas.exe"), str(segment_file), str(reference_file)], check=True)
    reference = reference_file.read_bytes()
    assert len(reference) >= len(pcm) and reference[:len(pcm)] == pcm
    reports.append({"file": name, "sourceVariation": index, "sourceSegmentIndex": segment_index,
                    "chunkIndex": chunk_index, "offset": start, "end": end,
                    "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
                    "independentPcmMatches": True, "comparedPcmBytes": len(pcm), **info})

evidence = {
    "evidenceId": "BF2-FACTION-A280-AUDIO-001", "sourceAsset": document["entry"],
    "sourceEbx": path.relative_to(ROOT).as_posix(), "sourceEbxSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    "sourcePatch": patch["entry"], "sampler": sampler,
    "chunks": chunk_sources, "variations": reports,
    "selection": root["Selection"], "historyCount": root["VariationHistoryCount"],
    "validation": "All nine variants agree byte-for-byte with independent retained Frosty C# XAS decoder, trimmed to declared sample count.",
    "limitations": ["Only original dry close-shot layer. Native shared layers, distance blend, reflections and final gain remain unresolved."],
}
(OUT / "faction-a280.source.json").write_text(json.dumps(evidence, indent=2) + "\n")
runtime = {
    "schemaVersion": 1,
    "primaryShot": {"variants": ["audio/" + r["file"] for r in reports], "selection": "random",
                    "historyCount": root["VariationHistoryCount"],
                    "sourceAmplitude": sampler["Amplitude"], "sourcePitch": sampler["Pitch"],
                    "source": document["entry"]["name"]},
    "provenance": {"evidenceIds": [evidence["evidenceId"]],
                   "sourcePatch": patch["entry"]["name"], "sourceAssetGuid": document["entry"]["guid"],
                   "manifest": "audio/faction-a280.source.json", "validation": evidence["validation"],
                   "limitations": evidence["limitations"]},
}
(OUT.parent / "faction-a280-audio.json").write_text(json.dumps(runtime, indent=2) + "\n")
print(json.dumps({"variations": len(reports), "wavBytes": sum((OUT / r["file"]).stat().st_size for r in reports),
                  "allIndependentPcmMatches": True, "output": str(OUT.parent / "faction-a280-audio.json")}, indent=2))
