"""Read-only BF2 CAT bounds/header check; does not decompress or extract CAS data."""
import argparse
import datetime
import hashlib
import json
import pathlib
import struct


def validate(game):
    rows = []
    for path in sorted(game.glob("*/Win32/installation/*/cas.cat")):
        raw = path.read_bytes()
        start = 556 if struct.unpack_from("<I", raw)[0] in (0x01CED100, 0x03CED100) else 0
        row = {"path": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "headerOffset": start, "errors": []}
        if raw[start:start+16].rstrip(b"\0") != b"NyanNyanNyanNyan":
            row["errors"].append("Unexpected CAT magic")
            rows.append(row)
            continue
        resources, patches, encrypted = struct.unpack_from("<III", raw, start+16)
        expected = start + 40 + resources*36 + patches*60
        row.update(resourceCount=resources, patchCount=patches, encryptedHeaderValue=encrypted, expectedBytes=expected)
        if expected != len(raw):
            row["errors"].append("CAT table length differs from count-derived length")
        lengths = {}
        for i in range(min(resources, (len(raw)-start-40)//36)):
            offset, size, logical, packed_archive = struct.unpack_from("<IIII", raw, start+40+i*36+20)
            archive = packed_archive & 255
            cas = path.parent / ("cas_%02d.cas" % archive)
            if archive not in lengths:
                lengths[archive] = cas.stat().st_size if cas.is_file() else None
            if lengths[archive] is None or offset + size > lengths[archive]:
                if len(row["errors"]) < 20:
                    row["errors"].append({"record": i, "archive": str(cas), "archiveBytes": lengths[archive], "offset": offset, "size": size})
        row["referencedArchives"] = {str(k): v for k, v in lengths.items()}
        row["valid"] = not row["errors"]
        rows.append(row)
    layouts = []
    for path in sorted(game.glob("*/layout.toc")):
        with path.open("rb") as stream:
            header = stream.read(560)
        magic = struct.unpack_from("<I", header)[0]
        start = 556 if magic in (0x01CED100, 0x03CED100) else 0
        layouts.append({"path": str(path), "bytes": path.stat().st_size, "magic": hex(magic), "dbType": header[start] & 31, "valid": path.stat().st_size > start and (header[start] & 31) in (1, 2)})
    return {"evidenceId": "BF2-INDEX-001", "createdUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "gamePath": str(game), "readOnly": True,
            "method": "Frosty 1.0.6.3 CatReader/NullDeobfuscator source format; historical BF2 CAT header, count-derived table length, every CAT resource CAS existence/offset/size bounds, layout TOC DB root tag",
            "limitations": "Index structural checks only; CAS payload decompression and hashes not verified. Layout TOC contents not decoded here. SWBFII ignores encrypted count header field as Frosty source does.",
            "catalogs": rows, "layouts": layouts, "passed": bool(rows) and bool(layouts) and all(r.get("valid", False) for r in rows+layouts)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if args.out.resolve().is_relative_to(args.game.resolve()):
        raise ValueError("Report must be outside installation")
    result = validate(args.game)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "catalogs": len(result["catalogs"]), "layouts": len(result["layouts"]), "report": str(args.out)}))
    raise SystemExit(0 if result["passed"] else 1)
