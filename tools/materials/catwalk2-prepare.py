"""Package original Catwalk2 packed textures without processing channels."""
import hashlib, json, pathlib, struct, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/catwalk2-bounded-textures'
PUBLIC = ROOT / 'web/public/assets/textures/catwalk2'
OUT.mkdir(exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
report = json.loads((ROOT / 'exports/materials/catwalk2-shader/material-analysis.json').read_text())
sources = {}
for folder in ['catwalk2-textures','map-textures']:
    manifest = json.loads((ROOT/'exports/materials'/folder/'texture.manifest.json').read_text())
    assert manifest['complete'] and not manifest['errors']
    for row in manifest['results']:
        if row['guid'] in report['sourceTextures']:
            sources[row['guid']] = (ROOT/'exports/materials'/folder/row['file'], row)
assert len(sources)==4
provenance={}
sha = lambda data: hashlib.sha256(data).hexdigest()
for source,row in sources.values():
    raw = source.read_bytes()
    assert raw[:4] == b'DDS ' and raw[84:88] == b'DX10'
    height, width = struct.unpack_from('<II', raw, 12)
    mip_count = struct.unpack_from('<I', raw, 28)[0]
    dxgi = struct.unpack_from('<I', raw, 128)[0]
    assert dxgi in (28,29,77,78,83,98,99)
    compressed = dxgi not in (28,29)
    def size(w,h): return max(1,(w+3)//4)*max(1,(h+3)//4)*16 if compressed else w*h*4
    offset, skip = 148, 0
    while max(width,height)>1024:
        offset += size(width,height)
        width,height,skip = max(1,width//2),max(1,height//2),skip+1
    assert skip<mip_count
    w,h,expected = width,height,0
    for _ in range(mip_count-skip):
        expected += size(w,h)
        w,h = max(1,w//2),max(1,h//2)
    assert len(raw)-offset == expected
    header = bytearray(raw[:148])
    struct.pack_into('<II',header,12,height,width)
    struct.pack_into('<I',header,20,size(width,height) if compressed else width*4)
    struct.pack_into('<I',header,28,mip_count-skip)
    selected = bytes(header)+raw[offset:]
    dds,png = OUT/(row['guid']+'.dds'),OUT/(row['guid']+'.png')
    changed = not dds.exists() or dds.read_bytes()!=selected
    if changed: dds.write_bytes(selected)
    if changed or not png.exists():
        subprocess.run([str(ROOT/'tools/bf2-extract/bf2-extract.exe'),'dds-png','--input',str(dds),'--out',str(png)],cwd=ROOT,check=True,capture_output=True)
    pixels = png.read_bytes()
    assert struct.unpack_from('>II',pixels,16)==(width,height)
    target = PUBLIC/(row['guid']+'.png')
    target.write_bytes(pixels)
    provenance[row['guid']] = {'source': report['sourceTextures'][row['guid']], 'sourceMetadata': row['metadata'],
        'sourceDdsPath': source.relative_to(ROOT).as_posix(), 'sourceDdsSha256':sha(raw),
        'selectedDdsPath':dds.relative_to(ROOT).as_posix(), 'selectedDdsSha256':sha(selected),
        'sourceMip':skip,'sourceDataOffset':offset,'retainedDataBytes':len(raw)-offset,
        'width':width,'height':height,'dxgiFormat':dxgi,'colorSpace':'srgb' if dxgi in (29,78,99) else 'linear',
        'url':'/assets/textures/catwalk2/'+target.name,'sha256':sha(pixels),
        'operation':'Select existing native DDS mip; preserve compressed source bytes; historical native DDS-to-PNG decode; unchanged PNG copied to browser. No resampling or channel mutation.'}
assert set(provenance)==set(report['sourceTextures'])
materials = [{**m,'textures':{role:provenance[b['texture']['fileGuid']]['url'] for role,b in m['bindings'].items()}} for m in report['materials']]
document = {k:report[k] for k in ['evidenceId','shaderName','shaderNameHash','shaderGuid','pixelShader','pixelShaderSha256','pairedVertexShader','pairedVertexShaderSha256','sourceRvmSha256','textureMapping','constantMapping','limitations','placedSectionCount','visibleCoverage','nativeMaterialModel','forwardShader','forwardShaderSha256','nativeLightingInputs']}
document['limitations']=[v for v in document['limitations'] if 'tangent' not in v.lower()]
document['limitations'].append('Source frames are scoped to BF2-NATIVE-TANGENT-CATWALK232/36-001; the28-byte cluster remains excluded and native live dispatch is not captured.')
document.update({'materials':materials,'sourceTextures':provenance,'runtimeMapping':{
    'color':'Original base.b multiplied by world-space grunge.rgb, using native DDS transfer functions.',
    'roughness':'1-clamp(base.a*grunge.a*detail.b,0,1); source forward PS 798255efd6 confirms the complement.',
    'metalness':'Native ordinary materialID0 metalness0, reflectance0.5 gives dielectric F0=.04; confirmed in two source deferred consumers.',
    'normal':'Exact packed normal sum/detail Z and original signed32/36 vertex frames for35 section/LOD records and381 instances. Original tangent-space normal and final mapped world normal are each normalized at their source stages. The remaining28-byte cluster retains the derivative frame.',
    'emissive':'None in the selected source shader.',
    'ao':'No separate AO multiplication in the selected source shader.',
    'colorSpace':'Original DDS UNORM/SRGB distinction; native resource-view overrides remain unresolved.',
    'mipSelection':'Existing native mip0 for all4 textures (three1024x1024, one16x16), original compressed payload retained; browser regenerates lower PNG mips.'}})
(ROOT/'web/public/assets/recovered-catwalk2-materials.json').write_text(json.dumps(document,indent=2))
glsl = (ROOT/'tools/materials/catwalk2-equations.glsl').read_text()
template = (ROOT/'tools/materials/catwalk2-adapter.template.js').read_text()
(ROOT/'web/src/catwalk2-material.js').write_text(template.replace('__CATWALK2_GLSL__',json.dumps(glsl)))
(OUT/'provenance.json').write_text(json.dumps(provenance,indent=2))
print(json.dumps({'materials':len(materials),'textures':len(provenance),'newPngBytes':sum(p.stat().st_size for p in PUBLIC.glob('*.png'))}))
