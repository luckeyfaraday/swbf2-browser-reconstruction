"""Validate the EALayer3 v2 (codec 0x16) decoder in decode-vader.py over every 0x16 segment of an export.

Checks per segment (all variations, all languages):
  structure   block sample sums == header count, granules == ceil(count/576), PCM-frame layout
  reference   Frosty 1.0.5.2 ealayer3.dll (libmpg123): PCM prefix identical; decoded MP3 samples agree
              after Frosty's one-frame (1152-sample) drop; records Frosty's output shortfall
  alignment   16th-order LPC fitted to the last 512 PCM-block samples predicts the next 8 samples;
              prediction error (relative to local step size) for candidate decoded-stream offsets.
              The offset with seamless continuation is the granule alignment the decoder uses (0).
Run: python tools/audio/verify-ealayer3.py EXPORT_DIR FROSTY_EALAYER3_DLL OUT.json
"""
import collections, importlib.util, json, pathlib, sys
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('decode_vader', HERE / 'decode-vader.py')
dv = importlib.util.module_from_spec(spec); spec.loader.exec_module(dv)

def continuation_error(pcm_prefix, decoded, start):
    x = pcm_prefix.astype(float); n = 16; seg = x[-512:]
    A = np.array([seg[i:i + n][::-1] for i in range(len(seg) - n)]); coef = np.linalg.lstsq(A, seg[n:], rcond=None)[0]
    hist = list(x[-n:]); err = []
    for k in range(8):
        p = float(np.dot(coef, hist[::-1][:n])); err.append(abs(p - decoded[start + k])); hist.append(decoded[start + k])
    return float(np.mean(err)) / (float(np.std(np.diff(x[-256:]))) + 1e-9)

def main(export, dll, out):
    export = pathlib.Path(export); ref = dv.FrostyEaLayer3(dll); stats = collections.Counter()
    worst = 0; compared = 0; shortfall = []; align = collections.defaultdict(list)
    for f in sorted((export / 'ebx').glob('*.json')):
        d = json.loads(f.read_text())
        if d['entry']['type'] != 'SoundWaveAsset': continue
        w = d['asset']['objects'][0]
        for v in w['RuntimeVariations']:
            ck = w['Chunks'][v['ChunkIndex']]; chunk = (export / 'raw' / 'chunk' / (ck['ChunkId'] + '.chunk')).read_bytes()
            s, e = dv.segment_slice(w, chunk, v['FirstSegmentIndex'], v['ChunkIndex']); seg = chunk[s:e]
            if seg[4] != 0x16: continue
            pcm, info = dv.decode_eal3(seg); stats['segments'] += 1
            layout = tuple(tuple(r) for r in info['pcmReplacedRanges']); stats['pcmLayout ' + json.dumps(layout)] += 1
            c = dv.check_eal3(ref, seg, pcm)
            stats['pcmPrefixIdentical' if c['pcmPrefixIdentical'] else 'pcmPrefixDIFF'] += 1
            worst = max(worst, c['maxAbsDiff']); compared += c['alignedSamplesCompared']; shortfall.append(c['referenceShortBy'])
            # alignment evidence: raw decoded stream without PCM replacement
            import av
            # re-decode MPEG frames only (decode_eal3 internals reproduced to obtain the unreplaced stream)
            h = dv.sps_blocks(seg); grans = []
            for at, size, _ in h['blocks']:
                p = at + 8
                while p < at + size:
                    fr = dv.eal3_frame(seg, p, 1); p += fr['size']
                    if fr['common']: grans.append(fr)
            cc = av.CodecContext.create('mp3float', 'r'); parts = []
            for i in range(0, len(grans), 2):
                for fr in cc.decode(av.Packet(dv.eal3_rebuild(seg, grans[i], grans[i + 1] if i + 1 < len(grans) else None))): parts.append(fr.to_ndarray().reshape(-1))
            for fr in cc.decode(None): parts.append(fr.to_ndarray().reshape(-1))
            dec = np.concatenate(parts) * 32768
            for lag in (0, 529, 576, 1152):
                if 1152 + lag + 8 <= len(dec): align[lag].append(continuation_error(pcm[0, :1152], dec, 1152 + lag))
    report = dict(evidenceId='AUDIO-VADER-002', export=str(export), segments=stats['segments'], counters=dict(stats),
                  frostyMaxAbsDiffAfterOneFrameOffset=worst, frostyAlignedSamplesCompared=compared,
                  frostyShortBySamples=dict(min=min(shortfall), max=max(shortfall)),
                  alignmentMedianRelativeError={str(k): round(float(np.median(v)), 3) for k, v in align.items()},
                  alignmentSegmentsWhereZeroIsBest=int(sum(1 for i in range(len(align[0])) if align[0][i] <= min(align[k][i] for k in align if i < len(align[k])))))
    pathlib.Path(out).write_text(json.dumps(report, indent=1) + '\n'); print(json.dumps(report, indent=1))

if __name__ == '__main__':
    main(*sys.argv[1:4])
