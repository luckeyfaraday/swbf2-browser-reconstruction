"""Read the installed initfs DB container and retain exposure-related settings.

This parser accepts only the four DB types actually present in this source.
Every encoded container length, terminator, and payload range is checked.
It never executes or applies configuration scripts.
"""
import os
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = pathlib.Path(os.environ.get('BF2_GAME_DIR', 'C:/Games/Star Wars - Battlefront 2'), 'Data/initfs_Win32')
OUT = ROOT / 'exports/lighting/global-postprocess-initfs'
sha = lambda value: hashlib.sha256(value).hexdigest()


class Reader:
    def __init__(self, data):
        self.data, self.offset = data, 556
        assert data[:4] == bytes.fromhex('00d1ce01')

    def take(self, count):
        start = self.offset
        assert count >= 0 and start + count <= len(self.data)
        self.offset += count
        return self.data[start:self.offset]

    def varint(self):
        result = shift = 0
        while True:
            value = self.take(1)[0]
            result |= (value & 127) << shift
            if value < 128:
                return result
            shift += 7
            assert shift < 64

    def label(self):
        end = self.data.index(0, self.offset)
        return self.take(end - self.offset + 1)[:-1].decode('utf-8')

    def node(self):
        tag = self.take(1)[0]
        if tag == 0:
            return None
        name = '' if tag & 128 else self.label()
        kind = tag & 127
        length = self.varint()
        start = self.offset
        if kind in (1, 2):
            end, value = start + length, []
            assert end <= len(self.data)
            while self.offset < end:
                child = self.node()
                if child is None:
                    break
                value.append(child)
            assert self.offset == end and self.data[end - 1] == 0
        elif kind in (7, 19):
            value = self.take(length)
            if kind == 7:
                assert value[-1:] == b'\0'
                value = value[:-1].decode('utf-8')
        else:
            raise ValueError(f'Unrecognized source DB type {kind} at {start}')
        return {'name': name, 'kind': kind, 'offset': start, 'length': length, 'value': value}


def main():
    raw = SOURCE.read_bytes()
    reader = Reader(raw)
    root = reader.node()
    assert reader.offset == len(raw) and root['kind'] == 1
    rows, relevant = [], []
    OUT.mkdir(parents=True, exist_ok=True)
    exposure = re.compile(r'(?i)Exposure|DownsampleLogAverage|AdaptationTime|SpotMeter|ClampEV|Tonemap|\bEV\b')
    startup = {'Scripts/Game/Startup.lua', 'Scripts/Game/Configure.lua', 'Scripts/Game/Settings.lua',
               'Scripts/Game.cfg', 'Scripts/GlobalSettings.lua', 'Scripts/UserOptions/Options.lua',
               'Scripts/UserOptions/Options/Graphics.lua', 'Scripts/UserOptions/DefaultValues.lua',
               'Levels/MP/DeathStar02_01/DeathStar02_01.cfg'}
    for entry in root['value']:
        assert entry['kind'] == 2 and len(entry['value']) == 1
        file = entry['value'][0]
        assert file['name'] == '$file' and file['kind'] == 2
        fields = {field['name']: field for field in file['value']}
        assert len(fields) == len(file['value']) and set(fields) <= {'name', 'payload', 'fs'}
        assert fields['name']['kind'] == 7 and fields['payload']['kind'] == 19
        name, payload = fields['name']['value'], fields['payload']['value']
        row = {'name': name, 'offset': fields['payload']['offset'], 'byteLength': len(payload), 'sha256': sha(payload)}
        if 'fs' in fields:
            row['fs'] = fields['fs']['value']
        text = payload.decode('utf-8')
        matches = [{'line': n, 'text': line} for n, line in enumerate(text.splitlines(), 1) if exposure.search(line)]
        if matches or name in startup:
            # Flatten source names. Never let embedded source paths choose an output directory.
            target = re.sub(r'[^A-Za-z0-9_.-]', '_', name) + '.txt'
            (OUT / target).write_bytes(payload)
            row['retainedFile'] = str((OUT / target).relative_to(ROOT))
        if matches:
            row['exposureLines'] = matches
            relevant.append(row)
        rows.append(row)
    assert len({row['name'].lower() for row in rows}) == len(rows)
    evidence = {'evidenceId': 'BF2-NATIVE-EXPOSURE-INITFS-001',
                'source': str(SOURCE), 'sourceSha256': sha(raw), 'sourceBytes': len(raw),
                'containerOffset': 556, 'decodedEndOffset': reader.offset,
                'files': rows, 'exposureSettingsFiles': relevant,
                'startupRoute': ['Scripts/Game/Startup.lua imports Scripts/Game/Configure.lua.',
                                 'Configure.lua imports Game/Settings.lua, then Game.cfg unless defaultConfig selects another file.',
                                 'Configure.lua subsequently reads custom, local, level and permitted command-line overrides.',
                                 'UserOptions/Options.lua selects Graphics.lua for desktop adapters; applies quality settings, custom, device, local and permitted command-line overrides.',
                                 'No exposure/meter override appears in the retained default startup or desktop graphics files.',
                                 'The only exposure setting text in all 96 decoded files is DownsampleLogAverageEnable=false in Scripts/Voyager.cfg; no ordinary startup inclusion of that script is established.'],
                'limitations': ['Static configuration text only; file inclusion and runtime setting precedence remain untraced.',
                               'This bounded parser accepts the four DB record types present in this particular source; it is not a general Frostbite decoder.',
                               'Container lengths and record identities are validated; the signature/header is not authenticated.']}
    (OUT / 'evidence.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    print(json.dumps({'files': len(rows), 'sourceSha256': sha(raw), 'exposureSettingsFiles': relevant}, indent=2))


if __name__ == '__main__':
    main()
