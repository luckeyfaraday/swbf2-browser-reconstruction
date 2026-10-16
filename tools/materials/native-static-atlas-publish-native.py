"""Publish original BC6H and an unchanged-dimension BC7 array, no UV repacking."""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'web/public/assets/lighting'
sha = lambda value: hashlib.sha256(value).hexdigest()
read = lambda path: json.loads((ROOT / path).read_text(encoding='utf-8'))


def publish_bytes(path, payload):
    """Preserve unchanged native files and avoid redundant dev-server reloads."""
    if path.is_file() and path.stat().st_size == len(payload):
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() == sha(payload):
            return
    path.write_bytes(payload)


def select_geometry(families, section_filters=None):
    """Select proven material families; retain original atlas rows and UV bytes."""
    matches = read('exports/lighting/static-atlas-instance-matches.json')
    source_uv = read('web/public/assets/lighting/static-atlas-uv.json')
    doors = read('web/public/assets/source-doors.json')
    moving_indices = {leaf['sceneMatch']['index'] for door in doors['doors'] for leaf in door['leaves']}
    material_rows = []
    section_filters = section_filters or {}
    for family, recipe_path, evidence_id in families:
        recipe = read(recipe_path)
        allowed = section_filters.get(family)
        material_rows.extend({'assetId': row['assetId'], 'materialId': row['materialId'],
                              'family': family, 'atlasEvidenceId': evidence_id}
                             for row in recipe['materials']
                             if allowed is None or (row['assetId'], row['materialId']) in allowed)
    keys = {(row['assetId'], row['materialId']) for row in material_rows}
    eligible_uv = [row for row in source_uv['records'] if (row['assetId'], row['sourceMaterialId']) in keys]
    assets = {row['assetId'] for row in eligible_uv}
    instances = []
    for row in matches['matched']:
        if row['assetId'] not in assets or row['instanceIndex'] in moving_indices:
            continue
        sx, z0, z1, sy, ox, oy, z2, z3 = row['values']
        if not sx or not sy:
            continue
        assert z0 == z1 == z2 == z3 == 0 and sx > 0 and sy > 0
        instances.append({key: row[key] for key in ('instanceIndex', 'assetId', 'key', 'atlasRecordOffset', 'values')})
    # Door-only assets retain dynamic probes; their static charts are not attached.
    static_assets = {row['assetId'] for row in instances}
    eligible_uv = [row for row in eligible_uv if row['assetId'] in static_assets]
    active_keys = {(row['assetId'], row['sourceMaterialId']) for row in eligible_uv}
    material_rows = [row for row in material_rows if (row['assetId'], row['materialId']) in active_keys]
    payload, uv_records = bytearray(), []
    for row in eligible_uv:
        original = (ROOT / row['sourceFile']).read_bytes()
        assert len(original) == row['byteLength'] and sha(original) == row['sourceSha256']
        uv_records.append({**row, 'byteOffset': len(payload)})
        payload.extend(original)
    publish_bytes(PUBLIC / 'static-atlas-runtime-uv.bin', payload)
    uv = {'url': '/assets/lighting/static-atlas-runtime-uv.bin', 'sha256': sha(payload),
          'byteLength': len(payload), 'records': uv_records}
    counts = {}
    for family, _, _ in families:
        family_keys = {(row['assetId'], row['materialId']) for row in material_rows if row['family'] == family}
        family_records = [row for row in uv_records if (row['assetId'], row['sourceMaterialId']) in family_keys]
        family_assets = {row['assetId'] for row in family_records}
        family_instances = [row for row in instances if row['assetId'] in family_assets]
        counts[family] = {'materials': len(family_keys), 'sourceGeometries': len(family_records),
                          'placements': len(family_instances),
                          'sectionPlacements': sum(sum(uv['assetId'] == row['assetId'] and uv['sourceLod'] == 0
                                                       for uv in family_records) for row in family_instances)}
    return matches['sceneSha256'], uv, material_rows, instances, counts


def main():
    source = read('exports/lighting/static-atlas-sample/manifest.json')
    families = [('floor', 'web/public/assets/recovered-floor-materials.json', 'BF2-NATIVE-STATIC-ATLAS-MATH-001')]
    # Each additional family requires its independent native PS/binding evidence.
    family_evidence = {}
    for family, shader_sha in [
        ('master1uv', '1208fb56068293cdf09b3a42342f31a5b4372d51da1c3fd2202b4b9d02792f3f'),
        ('master2uv', '07c68d05030e56614d9219f3aaeb304a34db4dccb778dfcfa3d2f4911021887a'),
        ('metalonly', 'cafebb1efa7d5b55f1a6069152d219961ba6a8fb780c590d52d7e350c54b9356'),
        ('catwalk2', 'c7c725880ea94ee6bf14c7d462c49129364bacd32c227d90f11c3d42a7a7876d'),
        ('array2uv', 'f98220d078930fb93d0064fd60110dba4d32d7c5f9707d5ff01c36f1dd4bc399'),
        ('array1uv', '12f1e3331cd66b9a2d05880b614c739b6debfdf430e42c1db089415cc739cefb'),
        ('ceiling', 'a6a6076dde1a666b0a8c758431285bf26677d339fda0f66b0d540aeeb64586e1'),
        ('master1uv-emissive-nonmetal', 'de292f97cf4c51cade12a64570bde77add496c39243bf5aac4c0c6fc971a91ce'),
        ('master1uv-emissive', 'd2ae0b60ec6522838af780e21400898df3d8b52b80d637dbdb931030da9a9639'),
        ('exterior-noscale', '5c21e56591999e8aa836f2c81d604b887e5ac9973e4bb20025d0187ac7cd003a'),
        ('corvette-damage', '3601962b8f738b1888a345755506aeac27fb35857534a1e90166cc51e4554e77'),
    ]:
        recipe_path = ROOT / f'exports/materials/{family}-static-atlas/integration-recipe.json'
        recipe = json.loads(recipe_path.read_text(encoding='utf-8'))
        assert recipe['schemaVersion'] == 1 and recipe['family'] == family
        assert recipe['pixelShaderSha256'] == shader_sha
        assert recipe['commonAtlasKernel']['shader'] == 'f789fdaafa'
        has_ao = family in ('master1uv', 'master2uv', 'metalonly', 'exterior-noscale')
        assert recipe['materialAO']['applications'] == int(has_ao)
        assert recipe['materialAO']['doNotMultiplyInsideAtlasHelper']
        if not has_ao:
            assert recipe['materialAO']['value'] == 1 and recipe['materialAO']['existingHook'] is None
        if family == 'ceiling':
            domain = recipe['commonAtlasKernel']['domainRestriction']
            assert domain['outputDomain'] == '[0,2]' and domain['textureDomainEvidence']['dxgiFormat'] == 98
            assert recipe['emissive']['separateThreeEmission'] is False
            assert recipe['emissive']['indirectPrelightingExpression'] == 'commonAtlasKernel + bf2_ceiling_surface.emissive'
        if family == 'master1uv-emissive-nonmetal':
            assert recipe['emissive']['separateThreeEmission'] is False
            assert recipe['emissive']['indirectPrelightingExpression'] == 'commonAtlasKernel + bf2_master1uv_emissive_nonmetal_surface.emissive'
        if family == 'master1uv-emissive':
            assert recipe['emissive']['separateThreeEmission'] is False
            assert recipe['emissive']['indirectPrelightingExpression'] == 'commonAtlasKernel + bf2_master1uv_emissive_surface.emissive'
        if family == 'exterior-noscale':
            assert recipe['normal']['normalized'] is True
            assert recipe['normal']['fallbackSHNormalized'] is False
            assert recipe['normal']['fallbackSHExpression'] == 'bf2_exterior_prelightingNormal'
            assert recipe['materialAO']['existingHook'] == 'bf2_exterior_surface.ao'
        if family == 'corvette-damage':
            assert recipe['normal']['normalized'] is True
            assert recipe['arrayLayer']['mustPreserveDynamicSelection'] is True
            assert recipe['damage']['saturate'] is False
            assert recipe['gbuffer']['prelightingFinalMaxZero'] is False
        families.append((family, f'web/public/assets/recovered-{family}-materials.json', recipe['evidenceId']))
        family_evidence[family] = {'recipe': recipe, 'sha256': sha(recipe_path.read_bytes())}
    props_path = ROOT / 'exports/materials/propspreset-routing/integration-recipe.json'
    props = json.loads(props_path.read_text(encoding='utf-8'))
    assert props['schemaVersion'] == 1 and props['family'] == 'propspreset'
    assert props['commonAtlasKernel']['shader'] == 'f789fdaafa'
    assert props['materialAO'] == {'value': 1, 'applications': 0, 'existingHook': None,
                                   'doNotMultiplyInsideAtlasHelper': True}
    assert props['normal']['normalized'] and not props['gbuffer']['prelightingFinalMaxZero']
    assert props['emissive']['browserExpression'] == 'bf2_props_surface.emissive'
    assert {row['pixelShader']: row['pixelShaderSha256'] for row in props['variants']} == {
        'b5b53e93ab': '42eeaba52f1caf6f2de991d0613444290b0014913321910337a013e12a4749d0',
        '2561af268e': '2cd812bbe306def8e32a36f64b9de67694cc293dffad9860626ef232dcf094e2',
        'd390b460db': '3fa0304ec415a19cfa01c46f8b08b972430fbba0fabd7fc77700c591da36075a',
    }
    allowed = {(row['assetId'], row['materialId']): row['pixelShader'] for row in props['eligibleSections']}
    excluded = {(row['assetId'], row['materialId']) for row in props['excludedSections']}
    assert len(allowed) == 22 and len(excluded) == 5 and not set(allowed) & excluded
    for row in read('web/public/assets/recovered-propspreset-materials.json')['materials']:
        key = (row['assetId'], row['materialId'])
        if key in allowed:
            assert row['atlasPixelShader'] == allowed[key]
        else:
            assert key in excluded and row['atlasPixelShader'] is None
    families.append(('propspreset', 'web/public/assets/recovered-propspreset-materials.json', props['evidenceId']))
    family_evidence['propspreset'] = {'recipe': props, 'sha256': sha(props_path.read_bytes())}
    catwalk_path = ROOT / 'exports/materials/catwalk1-shader/integration-recipe.json'
    catwalk = json.loads(catwalk_path.read_text(encoding='utf-8'))
    assert catwalk['schemaVersion'] == 1 and catwalk['family'] == 'catwalk1'
    assert catwalk['pixelShader'] == '3b42a4bca7'
    assert catwalk['pixelShaderSha256'] == 'a32635c2ba0b7935f30aa73c6702c4184b0ce7def37ba4aa0e1933aa0d3a65e8'
    assert catwalk['commonAtlasKernel']['shader'] == 'f789fdaafa'
    assert catwalk['normal']['normalized'] and catwalk['emissive']['value'] == [0, 0, 0]
    assert catwalk['materialAO'] == {'value': 1, 'applications': 0, 'existingHook': None,
                                     'doNotMultiplyInsideAtlasHelper': True}
    assert catwalk['gbuffer']['metalness'] == 0 and not catwalk['gbuffer']['prelightingFinalMaxZero']
    catwalk_allowed = {(row['assetId'], row['materialId']) for row in catwalk['eligibleSections']}
    catwalk_excluded = {(row['assetId'], row['materialId']) for row in catwalk['excludedSections']}
    assert len(catwalk_allowed) == 22 and len(catwalk_excluded) == 1 and not catwalk_allowed & catwalk_excluded
    for row in read('web/public/assets/recovered-catwalk1-materials.json')['materials']:
        key = (row['assetId'], row['materialId'])
        if key in catwalk_allowed:
            assert row['atlasPixelShader'] == catwalk['pixelShader']
        else:
            assert key in catwalk_excluded and row['atlasPixelShader'] is None
    families.append(('catwalk1', 'web/public/assets/recovered-catwalk1-materials.json', catwalk['evidenceId']))
    family_evidence['catwalk1'] = {'recipe': catwalk, 'sha256': sha(catwalk_path.read_bytes())}
    scene_hash, uv, materials, instances, counts = select_geometry(families,
        {'propspreset': set(allowed), 'catwalk1': catwalk_allowed})
    payloads = []
    for texture in source['textures']:
        data = (ROOT / 'exports/lighting/static-atlas-chunks' / (texture['chunkGuid'] + '.chunk')).read_bytes()
        assert len(data) == 5232 * 4908 and sha(data) == texture['sourceChunkSha256']
        payloads.append(data)
    irradiance, directions = payloads[0], b''.join(payloads[1:])
    publish_bytes(PUBLIC / 'static-irradiance.bc6h.bin', irradiance)
    publish_bytes(PUBLIC / 'static-directions-sky.bc7.bin', directions)
    document = {'version': 1, 'evidenceId': 'BF2-NATIVE-STATIC-ATLAS-TEXTURES-001',
                'sourceSceneSha256': scene_hash, 'width': 5232, 'height': 4908, 'mipCount': 1,
                'irradiance': {'url': '/assets/lighting/static-irradiance.bc6h.bin', 'sha256': sha(irradiance),
                               'byteLength': len(irradiance), 'format': 'BC6U_FLOAT'},
                'directions': {'url': '/assets/lighting/static-directions-sky.bc7.bin', 'sha256': sha(directions),
                               'byteLength': len(directions), 'format': 'BC7_UNORM', 'layers': 4,
                               'layerOrder': ['directionR', 'directionG', 'directionB', 'skyVisibility']},
                'sourceTextures': [{key: row[key] for key in ('sourceField', 'chunkGuid', 'sourceChunkSha256', 'format', 'dxgiFormat')} for row in source['textures']],
                'uv': uv, 'materials': materials, 'instances': instances, 'families': counts,
                'familyEvidence': family_evidence,
                'sampler': {'minFilter': 'Linear', 'magFilter': 'Linear', 'wrapS': 'ClampToEdge', 'wrapT': 'ClampToEdge',
                            'sourceSampler': '9216198462', 'packedBytes16to19': [21, 3, 3, 1]},
                'packingPolicy': 'All five original compressed payloads and dimensions unchanged. Four BC7 textures become separate array layers; native UV coordinates and hardware filtering preserved.',
                'validation': 'web/test-results/source-static-atlas-packing-gpu-check.json: original compressed array bit-identical to separate native-format textures for 134096 filtered scalars and 134096 exact-texel scalars.',
                'limitations': ['Scene integration is limited to independently proven material families; moving doors retain dynamic probes.',
                               'Requires original BC6H/BC7 texture support. Reflection-volume selection, blending and native final composition remain separately scoped.']}
    (PUBLIC / 'static-atlas-native.json').write_text(json.dumps(document, indent=2), encoding='utf-8')
    print(json.dumps({'sourceBytes': len(irradiance) + len(directions), 'samplers': 2, 'instances': len(instances), 'uvBytes': uv['byteLength'], 'families': counts}))


if __name__ == '__main__':
    main()
