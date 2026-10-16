"""Decode selected Darth Vader / lightsaber SoundWaveAssets to PCM WAV plus manifests.

Inputs are the read-only bf2-extract exports (typed EBX JSON plus raw chunks) of the
installed game; nothing is read from or written to the game install.

Codecs (EA SPS header byte 4 = version<<4 | codec):
  0x14  EA XAS1            -> tools/audio/decode-xas.py decode() (validated against Frosty, AUDIO-E11-002)
  0x16  EALayer3 v2 "PCM"  -> implemented here: EA-frame bit parser + MPEG-1 Layer III frame rebuild,
                              decoded by FFmpeg's mp3float decoder through PyAV. The first two granules of
                              every segment carry raw big-endian PCM that replaces the decoded granules.
Optional cross-checks: --frosty-ealayer3 (Frosty 1.0.5.2 ThirdParty/ealayer3.dll, libmpg123 based) and
--verify-xas (tools/audio/verify-xas.exe, unmodified Frosty XAS core).

Requires numpy and PyAV (av). Run: python tools/audio/decode-vader.py --help
"""
import argparse, collections, ctypes, hashlib, importlib.util, json, pathlib, subprocess, sys, tempfile, wave
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('decode_xas', HERE / 'decode-xas.py')
_xas = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_xas)

# ---------------------------------------------------------------- EA SPS container

def sps_blocks(seg):
    if len(seg) < 12 or seg[0] != 0x48 or int.from_bytes(seg[1:4], 'big') != 12:
        raise ValueError('Invalid EA SPS header (expected 0x48 block of 12 bytes, no loop fields)')
    h = dict(codec=seg[4], channels=(seg[5] >> 2) + 1, rate=int.from_bytes(seg[6:8], 'big'),
             count=int.from_bytes(seg[8:12], 'big') & 0xffffff, typeFlags=seg[8] >> 5, blocks=[])
    at = 12
    while at + 4 <= len(seg):
        kind, size = seg[at], int.from_bytes(seg[at + 1:at + 4], 'big')
        if size < 4 or at + size > len(seg): raise ValueError('EA block exceeds segment')
        if kind == 0x45: at += size; break
        if kind != 0x44: raise ValueError('Unexpected EA block %02x' % kind)
        h['blocks'].append((at, size, int.from_bytes(seg[at + 4:at + 8], 'big'))); at += size
    else:
        raise ValueError('Missing EA end block')
    h['end'] = at
    return h

# ---------------------------------------------------------------- EALayer3 v2

class Bits:
    """MSB-first bit reader over a bytes object."""
    def __init__(self, data, byte_pos=0): self.d = data; self.p = byte_pos * 8
    def read(self, n):
        if n == 0: return 0
        a, b = self.p >> 3, (self.p + n + 7) >> 3
        v = int.from_bytes(self.d[a:b], 'big'); v >>= (b * 8 - self.p - n); self.p += n
        return v & ((1 << n) - 1)

MPEG_VERSION = {0: 3, 1: None, 2: 2, 3: 1}            # 2-bit index -> 1 (MPEG1), 2 (MPEG2), 3 (MPEG2.5)
MPEG_RATES = {1: (44100, 48000, 32000), 2: (22050, 24000, 16000), 3: (11025, 12000, 8000)}

def eal3_frame(seg, pos, channels_hint):
    """Parse one EALayer3 v2 EA-frame starting at byte pos."""
    br = Bits(seg, pos); f = dict(pos=pos)
    f['ext'], f['stereo'], f['reserved'], f['size'] = br.read(1), br.read(1), br.read(2), br.read(12)
    pre = 2; f['offsetMode'] = f['offsetSamples'] = f['pcmSamples'] = 0; f['commonSizeField'] = None
    if f['ext']:
        f['offsetMode'], f['offsetSamples'], f['pcmSamples'], f['commonSizeField'] = br.read(2), br.read(10), br.read(10), br.read(10); pre += 4
    f['pre'] = pre; f['common'] = 0; f['granule'] = None
    if not f['ext'] or f['commonSizeField']:
        start = br.p
        vi, si, cm, me = br.read(2), br.read(2), br.read(2), br.read(2)
        ver = MPEG_VERSION[vi]
        if ver is None or si == 3 or (vi, si, cm, me) == (0, 0, 0, 0): raise ValueError('Invalid EALayer3 common header')
        ch = 1 if cm == 3 else 2
        f.update(vi=vi, si=si, cm=cm, me=me, version=ver, channels=ch, rate=MPEG_RATES[ver][si])
        f['granule'] = br.read(1); f['scfsi'] = [0] * ch
        if ver == 1 and f['granule'] == 1: f['scfsi'] = [br.read(4) for _ in range(ch)]
        rest = 47 if ver == 1 else 51                 # side info per channel = 12-bit part2_3_length + rest
        f['side'] = [(br.read(12), br.read(rest)) for _ in range(ch)]
        f['dataBit'] = br.p
        bits = (br.p - start) + sum(s[0] for s in f['side'])
        f['common'] = (bits + 7) // 8
        if f['commonSizeField'] is not None and f['commonSizeField'] != f['common']:
            raise ValueError('EALayer3 common size field disagrees with parsed side info')
    ch = f.get('channels', channels_hint)
    if f['pre'] + f['common'] + f['pcmSamples'] * ch * 2 != f['size']: raise ValueError('EALayer3 frame size mismatch')
    f['pcmPos'] = pos + f['pre'] + f['common']
    return f

def eal3_rebuild(seg, g0, g1):
    """Standard MPEG-1 Layer III frame (no CRC, main_data_begin 0, 320 kbps slot) from a granule pair."""
    if g0['version'] != 1: raise ValueError('Only MPEG-1 EALayer3 is implemented/validated')
    ch = g0['channels']; acc = 0; nbits = 0
    def put(n, v):
        nonlocal acc, nbits; acc = (acc << n) | (v & ((1 << n) - 1)); nbits += n
    for n, v in ((11, 0x7ff), (2, g0['vi']), (2, 1), (1, 1), (4, 14), (2, g0['si']), (1, 0), (1, 0),
                 (2, g0['cm']), (2, g0['me']), (1, 1), (1, 1), (2, 0)): put(n, v)
    put(9, 0); put(5 if ch == 1 else 3, 0)
    for c in range(ch): put(4, g1['scfsi'][c] if g1 else 0)
    for g in (g0, g1):
        for c in range(ch): a, b = g['side'][c] if g else (0, 0); put(12, a); put(47, b)
    for g in (g0, g1):
        if g is None: continue
        n = sum(s[0] for s in g['side']); br = Bits(seg); br.p = g['dataBit']; put(n, br.read(n))
    size = 144 * 320000 // g0['rate']
    total = (nbits + 7) // 8
    if total > size: raise ValueError('Rebuilt MPEG frame exceeds 320 kbps slot (%d > %d)' % (total, size))
    return (acc << (total * 8 - nbits)).to_bytes(total, 'big') + b'\0' * (size - total)

def decode_eal3(seg):
    import av
    h = sps_blocks(seg); ch = h['channels']; frames = []
    for at, size, declared in h['blocks']:
        p = at + 8; inside = []
        while p < at + size:
            f = eal3_frame(seg, p, ch); f['block'] = at; inside.append(f); p += f['size']
        if p != at + size: raise ValueError('EALayer3 frames overrun block')
        frames.append((declared, inside))
    if sum(d for d, _ in frames) != h['count']: raise ValueError('Block sample counts disagree with header')
    grans = [f for _, fs in frames for f in fs if f['common']]
    if len(grans) != -(-h['count'] // 576): raise ValueError('Granule count disagrees with header sample count')
    packets = []
    for i in range(0, len(grans), 2):
        g0, g1 = grans[i], grans[i + 1] if i + 1 < len(grans) else None
        if g0['granule'] != 0 or (g1 is not None and g1['granule'] != 1) or g0['channels'] != ch: raise ValueError('Granule pairing')
        packets.append(eal3_rebuild(seg, g0, g1))   # a trailing lone granule gets an empty granule 1
    cc = av.CodecContext.create('mp3float', 'r'); parts = []
    for p in packets + [None]:
        for fr in cc.decode(av.Packet(p) if p is not None else None):
            a = fr.to_ndarray(); parts.append(a.reshape(ch, -1) if fr.format.is_planar else a.reshape(-1, ch).T)
    dec = np.concatenate(parts, axis=1)
    if dec.shape[1] != 1152 * len(packets): raise ValueError('Unexpected MPEG decoder output length')
    out = np.clip(np.round(dec.astype(np.float64) * 32768), -32768, 32767).astype(np.int16)
    gpos = 0; replaced = []
    for _, fs in frames:
        for f in fs:
            if f['pcmSamples']:
                if f['offsetMode'] != 0 or ch != 1: raise ValueError('Unvalidated EALayer3 PCM mode (offsetMode/stereo)')
                start = gpos * 576 + f['offsetSamples']
                raw = np.frombuffer(seg[f['pcmPos']:f['pcmPos'] + f['pcmSamples'] * 2 * ch], dtype='>i2').reshape(-1, ch).T
                out[:, start:start + f['pcmSamples']] = raw; replaced.append([start, int(f['pcmSamples'])])
            if f['common']: gpos += 1
    out = out[:, :h['count']]
    info = dict(codec='EALayer3 v2 PCM (0x16)', channels=ch, sampleRate=h['rate'], samplesPerChannel=h['count'],
                duration=h['count'] / h['rate'], blocks=len(frames), granules=len(grans), mpegFrames=len(packets),
                pcmReplacedRanges=replaced, sourceSegmentBytes=h['end'])
    return out, info

def decode_xas(seg):
    pcm, info = _xas.decode(seg)
    a = np.frombuffer(pcm, dtype='<i2').reshape(-1, info['channels']).T.copy()
    return a, info

def decode_segment(seg):
    if seg[4] == 0x14: return decode_xas(seg)
    if seg[4] == 0x16: return decode_eal3(seg)
    raise ValueError('Unsupported EA codec byte %02x' % seg[4])

# ---------------------------------------------------------------- optional reference decoders

class FrostyEaLayer3:
    """Frosty 1.0.5.2 ThirdParty/ealayer3.dll (same call signature as FrostySoundWaveEditor)."""
    class SI(ctypes.Structure): _fields_ = [('streamIndex', ctypes.c_int), ('numChannels', ctypes.c_int), ('sampleRate', ctypes.c_int)]
    def __init__(self, path):
        self.CB = ctypes.CFUNCTYPE(None, ctypes.POINTER(ctypes.c_short), ctypes.c_int, self.SI)
        self.dll = ctypes.CDLL(str(path)); self.dll.Decode.argtypes = [ctypes.c_char_p, ctypes.c_int, self.CB]; self.dll.Decode.restype = None
    def decode(self, seg):
        out = []
        def cb(p, n, si):
            if si.streamIndex != -1: out.extend(p[:n])
        c = self.CB(cb); self.dll.Decode(seg, len(seg), c); return np.array(out, dtype=np.int32)

def check_eal3(ref, seg, mine):
    """PCM prefix must be identical; afterwards Frosty's output omits one MPEG frame (1152 samples)."""
    r = ref.decode(seg); m = mine[0].astype(np.int32)
    prefix = bool(np.array_equal(r[:1152], m[:1152]))
    a, b = m[2304:], r[1152:]; n = min(len(a), len(b))
    return dict(reference='Frosty ealayer3.dll', pcmPrefixIdentical=prefix, alignedSamplesCompared=int(n),
                maxAbsDiff=int(np.abs(a[:n] - b[:n]).max()) if n else 0, referenceShortBy=int(m.shape[0] - len(r)))

def check_xas(exe, seg, mine):
    with tempfile.TemporaryDirectory() as t:
        src, dst = pathlib.Path(t) / 's.sps', pathlib.Path(t) / 'o.pcm'; src.write_bytes(seg)
        subprocess.run([str(exe), str(src), str(dst)], check=True, capture_output=True)
        r = np.frombuffer(dst.read_bytes(), dtype='<i2')
    flat = mine.T.reshape(-1); n = flat.shape[0]
    return dict(reference='Frosty XAS core (verify-xas.exe)', interleavedSamplesCompared=int(n),
                identical=bool(len(r) >= n and np.array_equal(r[:n], flat)), referencePaddingSamples=int(len(r) - n))

# ---------------------------------------------------------------- EBX helpers

class Graph:
    def __init__(self, roots):
        self.by_name = {}
        for root in roots:
            for r in json.loads((root / 'export.manifest.json').read_text())['results']:
                self.by_name.setdefault(r['name'], (root, r))
    def doc(self, name):
        root, r = self.by_name[name]; return json.loads((root / r['file']).read_text()), root
    def obj(self, name, guid):
        d, _ = self.doc(name)
        for o in d['asset']['objects']:
            if o['__InstanceGuid']['ExportedGuid'].startswith(guid): return o
        raise KeyError(guid)

def port(v):
    if isinstance(v, dict) and 'UnconnectedValue' in v: return v['UnconnectedValue'], v['IsConnected']
    return v, False

# Bit layouts inferred from the installed configs (see VADER.md): SamplerNodeConfigData amplitude=1,
# pitch=8, wave=16; StepLogicSamplerNodeConfigData amplitude=1, pitch=2, wave=8.
FLAG_BITS = {'SamplerNodeData': (1, 8, 16), 'StepLogicSamplerNodeData': (1, 2, 8)}

def sampler_params(g, patch, node, spc=None):
    o = g.obj(patch, node); t = o['$type'].split('.')[-1]
    amp, amp_c = port(o['Amplitude']); pitch, pitch_c = port(o['Pitch'])
    r = dict(patch=patch, node=o['__InstanceGuid']['ExportedGuid'], nodeType=t, looping=bool(o.get('Looping', False)),
             patchAmplitude=amp, patchAmplitudeConnected=amp_c, patchPitch=pitch, patchPitchConnected=pitch_c,
             configuredAmplitude=None, configuredPitch=None, configuredWave=None)
    if spc:
        d, _ = g.doc(spc); conf = None; r['configuration'] = spc
        root = d['asset']['objects'][0]
        r['configurationLoudness'] = dict(value=root['Loudness'], configured=root['IsLoudnessConfigured'], masterPitch=root['MasterPitch'],
                                          masterPitchConfigured=root['IsMasterPitchConfigured'], radius=root['Radius'])
        for c in d['asset']['objects']:
            n = c.get('Node')
            if isinstance(n, dict) and n.get('classGuid') == r['node']: conf = c
        if conf is not None:
            flags = int(conf['ConfiguredPropertyFlags']['value']); a, p, w = FLAG_BITS[t]
            r['configFlags'] = flags; r['configObject'] = conf['__InstanceGuid']['ExportedGuid']
            if flags & a: r['configuredAmplitude'] = conf['Amplitude']
            if flags & p: r['configuredPitch'] = conf['Pitch']
            if flags & w and conf.get('Wave'): r['configuredWave'] = conf['Wave']['name']
    r['gain'] = r['configuredAmplitude'] if r['configuredAmplitude'] is not None else amp
    r['pitch'] = r['configuredPitch'] if r['configuredPitch'] is not None else pitch
    return r

# ---------------------------------------------------------------- selection

SABER_SPC = 'Sound/Weapons/LightSaber/SW02_Weapons_Lightsaber_Vader_SPC'
SABER_PATCH = 'Sound/Weapons/LightSaber/SW02_Weapons_LightSaber_SourcePatch'
IMPACT_PATCH = 'Sound/Weapons/SourcePatches/SW02_Weapons_SourcePatches_LightSaber_Impacts'
POWERS_PATCH = 'Sound/Characters/Powers/SourcePatch/SW02_Characters_Powers_SourcePatch_01'
CHOKE_SPC = 'Sound/Characters/Powers/DarthVader/SW02_Characters_Powers_DarthVader_ForceChoke_SPC'
THROW_SPC = 'Sound/Characters/Powers/DarthVader/SW02_Characters_Powers_DarthVader_SaberThrow_SPC'
RAGE_PATCH = 'Sound/Characters/Powers/DarthVader/SW02_Characters_Powers_DarthVader_FocusRage_SPC'
BREATH_PATCH = 'Sound/Characters/Heroes/DarthVader/SW02_Characters_Heroes_DarthVader_Breathing'
MOVE_SPC = 'Sound/Characters/Movement/Hero/SW02_Characters_Movement_Hero_DarthVader'
DEATH_SPC = 'Sound/Characters/Death/Hero/SW02_Characters_Hero_DarthVader_Death_3P_SPC'
DEATH_PATCH = 'Sound/Characters/Shared/Hero/SW02_Characters_Hero_Death_3P'
VO = 'Sound/VO/MP/Hero/Vader/Core/SW02_VO_MP_Hero_Vader_Core_'
W = 'Sound/Weapons/LightSaber/'; P = 'Sound/Characters/Powers/DarthVader/SW02_Characters_Powers_DarthVader_'
E = 'Sound/Characters/Shared/HeroEfforts/DarthVader/SW02_Characters_Shared_Efforts_'
H = 'Sound/Characters/Heroes/DarthVader/'

# id, wave asset, variations to export, sampler (patch, node, spc) or None, extra notes
SELECTION = [
    ('saber-ignite', W + 'Start/SW02_Weapons_LightSaber_Start_DarkSide_Red_VAR_01', 4, (SABER_PATCH, 'b3356576', SABER_SPC), 'WaveSwitcher e595f6d8 index 0 (start) feeds this sampler; Vader SPC replaces the switcher waves with DarkSide_Red start/stop.'),
    ('saber-retract', W + 'Stop/SW02_Weapons_LightSaber_Stop_DarkSide_Red_VAR_01', 4, (SABER_PATCH, 'b3356576', SABER_SPC), 'WaveSwitcher e595f6d8 index 1 (stop).'),
    ('saber-hum', W + 'Idle/SW02_Weapons_LightSaber_Idle_DarkSide_Red_01', 1, (SABER_PATCH, '6ecbe8ad', SABER_SPC), 'Base idle loop.'),
    ('saber-hum-intense', W + 'Idle/SW02_Weapons_LightSaber_Idle_Intense_DarkSide_Red_02', 1, (SABER_PATCH, '2e144555', SABER_SPC), 'Second idle loop layer; its graph amplitude is driven by saber motion (graph not reconstructed).'),
    ('saber-swing', W + 'Swing/SW02_Weapons_LightSaber_Swing_Small_VAR_02', 6, (SABER_PATCH, 'b270229f', SABER_SPC), 'StepLogicSampler (small swing).'),
    ('saber-swing-fast', W + 'Swing/SW02_Weapons_LightSaber_Swing_Fast_VAR_02', 6, (SABER_PATCH, '1bc76482', SABER_SPC), 'StepLogicSampler (fast swing).'),
    ('deflect', W + 'Deflect/SW02_Weapons_LightSaber_Deflection_Blasters_VAR_02', 6, (SABER_PATCH, '17ae1f50', SABER_SPC), 'Blaster-bolt deflection; not overridden by the Vader SPC.'),
    ('saber-hit', W + 'Impacts/SW02_Weapons_LightSaber_Impacts_Generic_VAR_01', 6, (IMPACT_PATCH, 'a807d23f', 'Sound/Weapons/LightSaber/Impacts/SW02_Weapons_LightSaber_Impacts_Character_SPC'), 'Saber-on-character impact, generic layer.'),
    ('saber-hit-tonal', W + 'Impacts/SW02_Weapons_LightSaber_Impacts_Tonal_VAR_01', 4, (IMPACT_PATCH, '99069b6d', 'Sound/Weapons/LightSaber/Impacts/SW02_Weapons_LightSaber_Impacts_Character_SPC'), 'Saber-on-character impact, tonal layer (played with saber-hit).'),
    ('saber-clash', W + 'Impacts/SW02_Weapons_LightSaber_Impacts_Block_VAR_03', 6, (IMPACT_PATCH, 'a807d23f', 'Sound/Weapons/LightSaber/Impacts/SW02_Weapons_LightSaber_Impacts_Block_SPC'), 'Saber block/clash; Block SPC swaps the generic sampler wave to Block_VAR_03.'),
    ('breath-slow', H + 'SW01_Characters_Heroes_DarthVader_Breathing_Slow_VAR_01', 2, (BREATH_PATCH, '48000514', None), 'WaveSwitcher 1878d27f index 0.'),
    ('breath-normal', H + 'SW01_Characters_Heroes_DarthVader_Breathing_Normal_VAR_01', 3, (BREATH_PATCH, '48000514', None), 'WaveSwitcher 1878d27f index 1.'),
    ('breath-fast', H + 'SW01_Characters_Heroes_DarthVader_Breathing_Fast_VAR_01', 3, (BREATH_PATCH, '48000514', None), 'WaveSwitcher 1878d27f index 2.'),
    ('breath-lowhealth', H + 'SW02_Characters_Heroes_DarthVader_Breathing_LowHealth_VAR_01', 3, (BREATH_PATCH, '48000514', None), 'WaveSwitcher 1878d27f index 3; source selection is Sequential.'),
    ('foley-jog', H + 'SW02_Characters_Heroes_DarthVader_Foley_Clothes_Jog_VAR_01', 4, None, 'Movement SPC WaveSwitcher 7a835d99 indices 0 and 1; sampler gain not resolved.'),
    ('foley-sprint', H + 'SW02_Characters_Heroes_DarthVader_Foley_Clothes_Sprint_VAR_01', 4, None, 'Movement SPC WaveSwitcher 7a835d99 index 2; sampler gain not resolved.'),
    ('effort-attack', E + 'SaberBreath_Vader_01', 6, None, 'VO-system effort (InWorld_Hero_Effort patch has no sampler amplitude).'),
    ('effort-saberhit', E + 'SaberHit_Vader_01', 4, None, 'VO-system effort.'),
    ('effort-hit', E + 'Hit_Vader_01', 4, None, 'VO-system pain effort; the Vader death SPC also uses this wave (see death-grunt).'),
    ('effort-landing', E + 'Landing_Vader_01', 3, None, 'VO-system effort.'),
    ('death', 'S1/Sound/Characters/Death/Hero/SW02_Characters_Death_Hero_SFX_DarthVader', 1, (DEATH_PATCH, '5091a05a', DEATH_SPC), 'Death SFX layer.'),
    ('choke-start', P + 'ForceChoke_Close_VAR_01', 4, (POWERS_PATCH, 'cd1e4016', CHOKE_SPC), 'Activation one-shot.'),
    ('choke-loop', 'Sound/Characters/Powers/DarthVader/SW01_Characters_Powers_DarthVader_ForceChoke_Loop_04', 1, (POWERS_PATCH, 'fa3808c2', CHOKE_SPC), 'Sustain loop layer.'),
    ('choke-bonecrack', P + 'ForceChoke_BoneCrack_Loop_Mono_01', 1, (POWERS_PATCH, 'c85fb483', CHOKE_SPC), 'Bone-crack loop layer.'),
    ('choke-end', P + 'ForceChoke_Close_Deactivation_VAR_01', 4, (POWERS_PATCH, 'b2d2cb05', CHOKE_SPC), 'Release one-shot.'),
    ('rage-start', P + 'ForceChoke_Affected_Start_VAR_01', 3, (RAGE_PATCH, '96b348a1', None), 'FocusRage WaveSwitcher ba1b9eef index 0; source selection is Sequential.'),
    ('rage-loop', P + 'ForceChoke_ForceDrone_Loop_01', 1, (RAGE_PATCH, 'a2491f14', None), 'FocusRage drone loop (also the choke-victim drone).'),
    ('throw', P + 'SaberThrow_Throw_VAR_01', 4, (POWERS_PATCH, 'cd1e4016', THROW_SPC), 'Saber throw launch.'),
    ('catch', P + 'SaberThrow_Catch_VAR_01', 4, (POWERS_PATCH, 'b2d2cb05', THROW_SPC), 'Saber catch.'),
    ('throw-spin', W + 'SaberThrow/SW01_Weapons_LightSaber_SaberThrow_Projectile_01', 1, ('Sound/Characters/Powers/DarthVader/SW02_Characters_Powers_DarthVader_SaberThrow_Projectile', '8abc1674', None), 'Spinning projectile loop.'),
    ('throw-return', W + 'SaberThrow/SW01_Weapons_LightSaber_SaberThrow_Returning_VAR_01.wav', 3, None, 'SaberThrow SPC WaveSwitcher 96c94577; sampler gain not resolved.'),
    ('vo-intro', VO + 'Intro', 2, None, 'English VO.'),
    ('vo-ability1', VO + 'Ability1', 2, None, 'English VO.'),
    ('vo-ability2', VO + 'Ability2', 2, None, 'English VO.'),
    ('vo-ability3', VO + 'Ability3', 2, None, 'English VO.'),
    ('vo-emote1', VO + 'Emote1', 1, None, 'English VO.'),
    ('vo-emote2', VO + 'Emote2', 1, None, 'English VO.'),
    ('vo-alert-luke', VO + 'AlertHeroIncomingLuke', 1, None, 'English VO.'),
    ('vo-battle-intense', VO + 'GeneralIntenseBattleEnemy', 2, None, 'English VO.'),
    ('music-intro', 'Sound/Music/Hero/DarthVader/SW01_Music_Hero_DarthVader_IntroShort_01', 1, None, 'Hero intro music sting (short).'),
]
# ids that reuse another id's files with different source parameters
ALIASES = [
    ('saber-clash-tonal', 'saber-hit-tonal', (IMPACT_PATCH, '99069b6d', 'Sound/Weapons/LightSaber/Impacts/SW02_Weapons_LightSaber_Impacts_Block_SPC'), 'Block SPC tonal layer.'),
    ('rage-end', 'choke-end', (RAGE_PATCH, '96b348a1', None), 'FocusRage WaveSwitcher ba1b9eef index 1 uses the choke deactivation wave.'),
    ('death-grunt', 'effort-hit', (DEATH_PATCH, '0d50c238', DEATH_SPC), 'Death SPC grunt layer (wave override only). Patch amplitude 8 is a graph-connected default, so gain is left null.'),
]
GAIN_UNRESOLVED = {'death-grunt'}
ENGLISH = '9bf0a6bc-c55a-458d-bdff-f7e9891f7133'

def variation_indices(wave):
    loc = wave.get('Localization') or []
    if not loc: return list(range(len(wave['RuntimeVariations']))), None
    for l in loc:
        if l['Language']['classGuid'] == ENGLISH:
            return list(range(l['FirstVariationIndex'], l['FirstVariationIndex'] + l['VariationCount'])), 'English'
    raise ValueError('No English localization')

def segment_slice(wave, chunk, seg_index, chunk_index):
    start = wave['Segments'][seg_index]['SamplesOffset']; ends = [len(chunk)]
    for v in wave['RuntimeVariations']:
        if v['ChunkIndex'] != chunk_index: continue
        for k in range(v['FirstSegmentIndex'], v['FirstSegmentIndex'] + v['SegmentCount']):
            o = wave['Segments'][k]['SamplesOffset']
            if o > start: ends.append(o)
    return start, min(ends)

def write_wav(path, pcm, rate):
    data = np.ascontiguousarray(pcm.T).astype('<i2').tobytes()
    with wave.open(str(path), 'wb') as w: w.setnchannels(pcm.shape[0]); w.setsampwidth(2); w.setframerate(rate); w.writeframes(data)

def sha256(b): return hashlib.sha256(b).hexdigest()

def gain_basis(p):
    if p is None: return None
    if p['configuredAmplitude'] is not None: return 'spc-configured'
    return 'patch-default-connected' if p['patchAmplitudeConnected'] else 'patch-default'

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--exports', type=pathlib.Path, nargs='+', required=True, help='bf2-extract export dirs (export.manifest.json + ebx/ + raw/chunk/)')
    ap.add_argument('--out', type=pathlib.Path, required=True, help='web/public/assets/audio')
    ap.add_argument('--frosty-ealayer3', type=pathlib.Path, help='Frosty ThirdParty/ealayer3.dll for cross-checking codec 0x16')
    ap.add_argument('--verify-xas', type=pathlib.Path, help='tools/audio/verify-xas.exe for cross-checking codec 0x14')
    a = ap.parse_args()
    g = Graph(a.exports); wav_dir = a.out / 'vader'; wav_dir.mkdir(parents=True, exist_ok=True)
    eal3_ref = FrostyEaLayer3(a.frosty_ealayer3) if a.frosty_ealayer3 else None
    manifest = collections.OrderedDict(); source = collections.OrderedDict(); codecs = collections.Counter(); total = 0
    for ident, asset, count, sampler, note in SELECTION:
        d, root = g.doc(asset); wave_obj = d['asset']['objects'][0]
        if not wave_obj['$type'].endswith('.SoundWaveAsset'): raise ValueError(asset)
        indices, language = variation_indices(wave_obj); chosen = indices[:count]
        files = []; chunks = collections.OrderedDict()
        for n, vi in enumerate(chosen):
            v = wave_obj['RuntimeVariations'][vi]
            if v['SegmentCount'] != 1: raise ValueError('Multi-segment variation not selected: ' + asset)
            ck = wave_obj['Chunks'][v['ChunkIndex']]; chunk = (root / 'raw' / 'chunk' / (ck['ChunkId'] + '.chunk')).read_bytes()
            if len(chunk) != ck['ChunkSize']: raise ValueError('Chunk size mismatch ' + ck['ChunkId'])
            chunks.setdefault(ck['ChunkId'], sha256(chunk))
            s, e = segment_slice(wave_obj, chunk, v['FirstSegmentIndex'], v['ChunkIndex']); seg = chunk[s:e]
            pcm, info = decode_segment(seg)
            length = wave_obj['Segments'][v['FirstSegmentIndex']]['SegmentLength']
            if abs(info['duration'] - length) > 1e-5: raise ValueError('Duration disagrees with EBX SegmentLength: %s %s' % (asset, vi))
            if info['channels'] != wave_obj['ChannelCount']: raise ValueError('Channel count disagrees with EBX')
            name = '%s-%02d.wav' % (ident, n + 1) if count > 1 else ident + '.wav'
            out = wav_dir / name; write_wav(out, pcm, info['sampleRate']); body = out.read_bytes(); total += len(body)
            codecs[info['codec']] += 1
            peak = int(np.abs(pcm.astype(np.int32)).max()); rms = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2)))
            rec = dict(file='vader/' + name, sourceVariation=vi, sourceSegmentIndex=v['FirstSegmentIndex'], chunk=ck['ChunkId'],
                       sourceOffset=s, sourceEnd=e, sourceSegmentLength=length, wavBytes=len(body), sha256=sha256(body),
                       peak=peak, peakDbfs=round(20 * np.log10(max(peak, 1) / 32768), 2), rmsDbfs=round(20 * np.log10(max(rms, 1e-9) / 32768), 2),
                       **{k: v2 for k, v2 in info.items() if k not in ('pcmReplacedRanges', 'peak')})
            if 'pcmReplacedRanges' in info: rec['pcmReplacedRanges'] = info['pcmReplacedRanges']
            if pcm.shape[0] == 2: rec['stereoMaxChannelDiff'] = int(np.abs(pcm[0].astype(np.int32) - pcm[1]).max())
            if sampler and sampler_params(g, *sampler)['looping'] or False:
                step = np.median(np.abs(np.diff(pcm[0].astype(np.int32)))) + 1
                rec['loopSeamJumpOverMedianStep'] = round(float(abs(int(pcm[0, 0]) - int(pcm[0, -1])) / step), 2)
            if seg[4] == 0x16 and eal3_ref: rec['crossCheck'] = check_eal3(eal3_ref, seg, pcm)
            if seg[4] == 0x14 and a.verify_xas: rec['crossCheck'] = check_xas(a.verify_xas, seg, pcm)
            files.append(rec)
        params = sampler_params(g, *sampler) if sampler else None
        if params and params['configuredWave'] and params['configuredWave'] != asset and ident not in ('saber-ignite', 'saber-retract'):
            raise ValueError('Configured wave %s does not match %s' % (params['configuredWave'], asset))
        entry = collections.OrderedDict(
            url=files[0]['file'], variations=[f['file'] for f in files], loop=bool(params and params['looping']),
            gain=params['gain'] if params else None, gainBasis=gain_basis(params), pitch=params['pitch'] if params else 1,
            selection=wave_obj['Selection']['name'].split('_')[-1].lower(), historyCount=wave_obj['VariationHistoryCount'],
            channels=files[0]['channels'], sampleRate=files[0]['sampleRate'], durations=[round(f['duration'], 6) for f in files],
            source=collections.OrderedDict(asset=asset, guid=d['entry']['guid'], chunk=list(chunks), sha256=list(chunks.values()),
                                           patch=params['patch'] if params else None, node=params['node'] if params else None,
                                           configuration=params.get('configuration') if params else None))
        entry['note'] = note
        manifest[ident] = entry
        source[ident] = dict(asset=asset, guid=d['entry']['guid'], ebxSha1=d['entry']['sha1'], language=language,
                             sourceVariationCount=len(indices), exportedVariations=len(files), selection=wave_obj['Selection']['name'],
                             variationHistoryCount=wave_obj['VariationHistoryCount'], sampler=params, note=note, files=files)
        print('%-18s %d var  %s  %s' % (ident, len(files), files[0]['codec'], asset), flush=True)
    for ident, base, sampler, note in ALIASES:
        params = sampler_params(g, *sampler); e = json.loads(json.dumps(manifest[base]))
        e['gain'] = None if ident in GAIN_UNRESOLVED else params['gain']; e['gainBasis'] = None if ident in GAIN_UNRESOLVED else gain_basis(params)
        e['pitch'] = params['pitch']; e['loop'] = params['looping']; e['note'] = note
        e['source'].update(patch=params['patch'], node=params['node'], configuration=params.get('configuration')); e['aliasOf'] = base
        manifest[ident] = e; source[ident] = dict(aliasOf=base, sampler=params, note=note)
    doc = collections.OrderedDict(schemaVersion=1, urlBase='relative to this manifest', sounds=manifest, provenance=dict(
        evidenceIds=['AUDIO-VADER-001', 'AUDIO-VADER-002'], sourceManifest='vader.source.json', tool='tools/audio/decode-vader.py',
        gainMeaning='Sampler Amplitude configured by the SoundPatchConfiguration (else the patch node default). Most ports are graph-connected, so runtime gain is further modulated by the unreconstructed sound graph and mixers.',
        limitations=['Dry source waves only: sound-graph modulation (swing-speed hum crossfade, LFOs, filters, ducking mixers), HDR loudness, attenuation and reverb are not reconstructed.',
                     'Only a subset of source variations is exported per id (see vader.source.json sourceVariationCount).']))
    (a.out / 'vader.json').write_text(json.dumps(doc, indent=1) + '\n')
    (a.out / 'vader.source.json').write_text(json.dumps(collections.OrderedDict(
        evidenceIds=['AUDIO-VADER-001', 'AUDIO-VADER-002'], codecs=dict(codecs), wavBytes=total, sounds=source), indent=1) + '\n')
    print(json.dumps(dict(codecs=codecs, wavBytes=total, ids=len(manifest))))

if __name__ == '__main__':
    main()
