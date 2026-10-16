"""Vader material post-step: provenance + explicit source shader constants.

Runs after tools/materials/apply-materials.py (unchanged trooper pipeline). It never
touches geometry/skin buffers; it only edits glTF JSON and copies converted textures.

* Records every source vector parameter of each material (mesh EBX MeshMaterial
  Shader.VectorParameters, cross-checked against the exact LOD split shader block).
* Emissive presets (SS_UnpackedObjectsPreset_Emissive, SS_Hero_Jedi_DarthVader_BlinkingLights):
  emissiveFactor = source colour normalised to max channel 1 (INFERENCE: the
  absolute HDR intensity/exposure mapping is not reproduced; raw values kept in extras).
* SS_CharactersPreset_WalrusNonMetallic_DoubleSided -> doubleSided (preset name observation).
* Rewrites image URIs to a Vader-only texture folder next to the published GLBs.

Usage (workspace root, Python 3.11):
  python tools/characters/vader-materials-post.py
"""
import json, pathlib, struct, shutil, sys, hashlib
root = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'tools/materials/python-libs'))
from cityhash import CityHash64

SRC = root / 'exports/characters/vader-materials/glb'
TEX = root / 'exports/characters/vader-materials/textures'
OUT = root / 'web/public/assets/characters'
SABER_OUT = root / 'exports/characters/vader-saber'
TEXDIR = 'vader-textures'
blocks_doc = json.loads((root / 'exports/characters/vader-shader-blocks/shader-blocks.json').read_text())
blocks = {b['source']['rid']: b for b in blocks_doc['blocks']}
meshinfo = {m['guid']: m for m in json.loads((root / 'exports/characters/vader-mesh-info/mesh-info.json').read_text())['results']}
EMISSIVE_PRESETS = {'Shaders/PresetsUnpacked/SS_UnpackedObjectsPreset_Emissive': ('EmissiveColor', 'EmissiveIntensity'),
                    'Characters/Imperial/Hero_Jedi_DarthVader/SS_Hero_Jedi_DarthVader_BlinkingLights': ('Color', 'Amplitude')}


def read_glb(path):
    data = path.read_bytes(); n = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + n]), data[20 + n:]


def write_glb(path, doc, rest):
    enc = json.dumps(doc, separators=(',', ':')).encode(); enc += b' ' * ((-len(enc)) % 4)
    path.write_bytes(struct.pack('<IIIII', 0x46546C67, 2, 20 + len(enc) + len(rest), len(enc), 0x4E4F534A) + enc + rest)


def vec(v):
    return [v.get('x', 0), v.get('y', 0), v.get('z', 0), v.get('w', 0)] if isinstance(v, dict) else v


def ebx_materials(ebx_file):
    j = json.loads(ebx_file.read_text()); objs = {o.get('$id'): o for o in j['asset']['objects']}
    out = []
    for ref in j['asset']['objects'][0]['Materials']:
        m = objs[ref['$ref']]; sh = m.get('Shader', {})
        out.append({'materialGuid': ref['$ref'], 'surfaceShader': (sh.get('Shader') or {}).get('name'),
                    'surfaceShaderGuid': (sh.get('Shader') or {}).get('$external'),
                    'vectorParameters': {p['ParameterName']: vec(p['Value']) for p in sh.get('VectorParameters', [])}})
    return out


def section_block_constants(guid, lod, section):
    m = meshinfo[guid]; expected = str(CityHash64(struct.pack('<IIi', m['meshSetNameHash'], 0, lod)))
    roots = [r for r in blocks_doc['roots'] if r['name'].split('_entry_')[0].lower() == m['name'].lower() and blocks[r['resourceId']]['hash'] == expected]
    if len(roots) != 1: return None
    sec = blocks[blocks[roots[0]['resourceId']]['children'][section]]
    out = []; seen = set(); stack = [sec['children'][1]]
    while stack:
        rid = stack.pop()
        if rid in seen: continue
        seen.add(rid); b = blocks[rid]
        for p in b.get('parameters', []):
            if 'value' in p and not p.get('textureGuid'): out.append({'nameHash': p['nameHash'], 'name': p.get('name'), 'value': p['value'], 'sourceBlock': rid})
        stack.extend(b.get('children', []))
    return {'entryResourceId': roots[0]['resourceId'], 'cityHash64': expected, 'constants': out}


def relink_images(doc, used):
    for im in doc.get('images', []):
        name = im['uri'].split('/')[-1]; im['uri'] = f'{TEXDIR}/{name}'; used.add(name)


def main():
    OUT.mkdir(parents=True, exist_ok=True); SABER_OUT.mkdir(parents=True, exist_ok=True); (OUT / TEXDIR).mkdir(exist_ok=True)
    used = set(); report = {'evidenceId': 'VADER-MATERIAL-POST-001', 'components': []}
    for comp, guid, lod, ebx, target in [
        ('vader-body', '862681fd-919a-9bf8-415c-cdf09866a6e6', 1, 'exports/characters/vader-converted/vader-body.ebx.json', OUT),
        ('vader-cape', 'a86c541e-bceb-5b1a-450e-61e4bd19aaff', 1, 'exports/characters/vader-converted/vader-cape.ebx.json', OUT),
        ('vader-saber-hilt', '4ed6d209-ab46-f134-2355-d549fc5275b4', 0, None, SABER_OUT),
        ('vader-saber-blade', '453ebc19-3bab-54ef-209e-f8074c73622d', 0, None, SABER_OUT)]:
        doc, rest = read_glb(SRC / f'{comp}.glb')
        mats = ebx_materials(root / ebx) if ebx else None
        info = meshinfo[guid]; lodinfo = next(l for l in info['lods'] if l['index'] == lod)
        notes = []
        for mat in doc.get('materials', []):
            idx = mat.get('extras', {}).get('sourceMaterialId', 0)
            section = next(s['index'] for s in lodinfo['sections'] if s['materialId'] == idx and s['exportedByStaticConverter'])
            consts = section_block_constants(guid, lod, section)
            ex = mat.setdefault('extras', {}); ex['sourceSection'] = {'lod': lod, 'index': section}
            if consts: ex['sourceShaderBlockConstants'] = consts
            if mats:
                src = mats[idx]; ex['sourceMaterial'] = src
                preset = src['surfaceShader']
                if preset in EMISSIVE_PRESETS:
                    ckey, ikey = EMISSIVE_PRESETS[preset]; color = src['vectorParameters'][ckey][:3]; peak = max(color)
                    # Cross-check that the split shader block carries the same constants.
                    block_values = [c['value'] for c in (consts or {}).get('constants', [])]
                    agree = any(isinstance(v, list) and all(abs(a - b) < 1e-6 for a, b in zip(v[:3], color)) for v in block_values)
                    mat['emissiveFactor'] = [round(c / peak, 6) for c in color]
                    ex['emissive'] = {'surfaceShader': preset, 'sourceColorLinear': color, 'sourceIntensityParameter': ikey,
                                      'sourceIntensity': src['vectorParameters'][ikey][0], 'shaderBlockAgrees': agree,
                                      'blinkWavelength': src['vectorParameters'].get('Wavelength', [None])[0],
                                      'basis': 'INFERENCE: emissiveFactor is source colour normalised to max channel 1; absolute HDR intensity, exposure and blinking are not reproduced.'}
                    notes.append(f'material {idx} emissive approximation')
                if preset and preset.endswith('_DoubleSided'):
                    mat['doubleSided'] = True; ex['doubleSidedBasis'] = 'surface shader preset name ' + preset
                    notes.append(f'material {idx} doubleSided from preset name')
        relink_images(doc, used)
        doc.setdefault('extras', {})['vaderMaterialPost'] = {'evidence': 'VADER-MATERIAL-POST-001', 'notes': notes, 'textureFolder': TEXDIR}
        out = target / f'{comp}.glb'; write_glb(out, doc, rest)
        report['components'].append({'component': comp, 'file': str(out.relative_to(root)), 'notes': notes, 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()})
    for name in sorted(used):
        shutil.copyfile(TEX / name, OUT / TEXDIR / name)
        if SABER_OUT != OUT:
            (SABER_OUT / TEXDIR).mkdir(exist_ok=True); shutil.copyfile(TEX / name, SABER_OUT / TEXDIR / name)
    report['textures'] = [{'file': f'{TEXDIR}/{n}', 'sha256': hashlib.sha256((TEX / n).read_bytes()).hexdigest()} for n in sorted(used)]
    (root / 'exports/characters/vader-materials/material-post.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'components': [c['component'] for c in report['components']], 'textures': len(used)}))


main()
