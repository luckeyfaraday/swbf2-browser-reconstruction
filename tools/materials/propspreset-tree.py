"""Decode retained tree words using native deserializer FUN_1414ff520.

This decodes storage, not native pass selection. Unknown parameters remain free.
"""
import collections
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/materials/python-libs'))
from cityhash import CityHash64WithSeed

RVM = ROOT / 'exports/materials/rvm'
DATA = (RVM / '0.res').read_bytes()
INDEX = json.loads((RVM / 'block-index.json').read_text())['blocks']
META = json.loads((RVM / 'material-blocks.json').read_text())
GRAPH = json.loads((ROOT / 'exports/materials/propspreset-shader/graph.json').read_text())


def raw(key):
    row = INDEX[key]
    return DATA[row['offset']:row['offset'] + row['size']]


def refs(key):
    return [f'{v[0] & 0xffffffffff:010x}' for v in struct.iter_unpack('<Q', raw(key))]


KEYS = refs('e85f797aa2')
VALUES = [v[0] for v in struct.iter_unpack('<Q', raw('744bbfe37a'))]
PERMUTATIONS = refs('1b5a52bdb1')
WORDS = [v[0] for v in struct.iter_unpack('<H', raw('1e5b378a94'))]


def decode(words=WORDS):
    nodes, backrefs, consumed = {}, {}, set()
    active = set()

    def read(at):
        assert 0 <= at < len(words), ('word outside source', at)
        consumed.add(at)
        return words[at]

    def node(at):
        if at in nodes:
            return at, nodes[at]['endWord']
        assert at not in active, ('cyclic source reference', at)
        active.add(at)
        begin = at
        header = read(at)
        at += 1
        tag = header & 0xc000
        if tag == 0:
            target = begin - (header & 0x3fff)
            assert target < begin, ('source backreference must point backward', begin, target)
            actual, _ = node(target)
            backrefs[begin] = actual
            active.remove(begin)
            return actual, at
        key, children, leaves = (header >> 8) & 0x3f, (header >> 4) & 15, header & 15
        if key == 63:
            key = read(at)
            at += 1
        if children == 15:
            children = read(at)
            at += 1
        if leaves == 15:
            leaves = read(at)
            at += 1
        assert key < len(KEYS), ('key index', key)
        branches = []
        for _ in range(children):
            value = read(at)
            at += 1
            assert value < len(VALUES)
            child, at = node(at)
            branches.append({'valueIndex': value, 'node': child})
        default = None
        if tag == 0x8000:
            child, at = node(at)
            default = {'node': child}
        for _ in range(leaves):
            value, permutation = read(at), read(at + 1)
            at += 2
            assert value < len(VALUES) and permutation < len(PERMUTATIONS)
            branches.append({'valueIndex': value, 'permutationIndex': permutation})
        if tag == 0x4000:
            permutation = read(at)
            at += 1
            assert permutation < len(PERMUTATIONS)
            default = {'permutationIndex': permutation}
        assert len({b['valueIndex'] for b in branches}) == len(branches), ('duplicate branch', begin)
        nodes[begin] = {'word': begin, 'endWord': at, 'header': hex(header), 'keyIndex': key,
                        'keyBlock': KEYS[key], 'branches': branches, 'default': default}
        active.remove(begin)
        return begin, at

    root, end = node(0)
    assert end == len(words), ('unconsumed tail', end, len(words))
    assert consumed == set(range(len(words))), 'source word coverage gap'
    return {'root': root, 'nodes': nodes, 'backreferences': backrefs, 'wordCount': len(words)}


def source_defaults():
    result = {}
    for key, value in zip(refs('0b36b6f663'), refs('4db5b41712')):
        payload = refs(value)[0]
        result[key] = {'rawHex': raw(payload).hex(), 'valueRef': value, 'payloadBlock': payload}
    return result


def candidates(tree, hashes):
    result, visited = set(), set()
    pending = [tree['root']]
    while pending:
        index = pending.pop()
        if index in visited:
            continue
        visited.add(index)
        node = tree['nodes'][index]
        if node['keyBlock'] in hashes:
            selected = next((b for b in node['branches'] if VALUES[b['valueIndex']] == hashes[node['keyBlock']]), node['default'])
            branches = [selected] if selected is not None else []
        else:
            branches = node['branches'] + ([node['default']] if node['default'] else [])
        for branch in branches:
            if 'node' in branch:
                pending.append(branch['node'])
            else:
                result.add(branch['permutationIndex'])
    return result


def hash_value(key, data):
    return CityHash64WithSeed(data, int(META[key]['values'][0]['hash']))


if __name__ == '__main__':
    tree = decode()
    defaults = source_defaults()
    hashes = {key: hash_value(key, bytes.fromhex(value['rawHex'])) for key, value in defaults.items()}
    print(json.dumps({'nodes': len(tree['nodes']), 'backreferences': len(tree['backreferences']),
        'words': tree['wordCount'], 'allPermutationLeaves': len(candidates(tree, {})),
        'defaultCandidates': sorted(candidates(tree, hashes)),
        'defaultHashMatches': sum(value in VALUES for value in hashes.values()),
        'defaultCount': len(defaults)}))
