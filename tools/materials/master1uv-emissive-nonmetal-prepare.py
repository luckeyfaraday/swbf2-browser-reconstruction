"""Package the original nonmetal emissive shader using verified retained textures."""
import hashlib,json,pathlib,re
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'exports/materials/master1uv-emissive-nonmetal-shader'
report=json.loads((OUT/'material-analysis.json').read_text())
atlas_path=ROOT/'exports/materials/master1uv-emissive-nonmetal-static-atlas/integration-recipe.json'
atlas=json.loads(atlas_path.read_text())
assert atlas['gbuffer']['metalness']==0 and atlas['gbuffer']['materialID']==0
assert atlas['emissive']['separateThreeEmission'] is False
retained={}
for name in ['master1uv','master1uv-emissive']:
    retained.update(json.loads((ROOT/f'web/public/assets/recovered-{name}-materials.json').read_text())['sourceTextures'])
textures={k:retained[k] for k in report['sourceTextures']}
def sha(b):return hashlib.sha256(b).hexdigest()
for texture in textures.values():
    original=(ROOT/texture['sourceDdsPath']).read_bytes()
    selected=(ROOT/texture['selectedDdsPath']).read_bytes()
    png=(ROOT/'web/public'/texture['url'].lstrip('/')).read_bytes()
    assert sha(original)==texture['sourceDdsSha256'] and sha(selected)==texture['selectedDdsSha256'] and sha(png)==texture['sha256']
    assert selected[148:]==original[texture['sourceDataOffset']:]
# The selected native PS shares the layered color/normal/smoothness equations
# with the emissive Master, but inserts cb1[3] and emits constant metalness0.
# Keep the generated result readable and validate it against its own original PS.
glsl=(ROOT/'tools/materials/master1uv-emissive-equations.glsl').read_text()
glsl=glsl.replace('LOCAL-MASTER1UV-EMISSIVE-SHADER-001','LOCAL-MASTER1UV-EMISSIVE-NONMETAL-SHADER-001').replace('5ffbbd02c2','17069bc692')
glsl=glsl.replace('cb[0..11]','cb[0..12]')
glsl=re.sub(r'cb\[(\d+)\]',lambda m:f'cb[{int(m[1])+1 if int(m[1])>=3 else int(m[1])}]',glsl)
start=glsl.index('  float scalar =')
end=glsl.index('  Master1UVEmissiveSurface result;',start)
glsl=glsl[:start]+glsl[end:]
glsl=glsl.replace('result.materialScalar = scalar; // Native deferred o2.y is ordinary material metalness.','result.materialScalar = 0.0; // Native deferred o2.y is constant zero.')
glsl=glsl.replace('emissionMask * cb[1].rgb * cb[0].x;','emissionMask * cb[1].rgb * cb[0].x * cb[3].x;')
glsl=glsl.replace('Master1UVEmissive','Master1UVEmissiveNonmetal')
assert 'vec4 cb[13]' in glsl and 'float scalar' not in glsl and 'cb[12].rgb' in glsl
(ROOT/'tools/materials/master1uv-emissive-nonmetal-equations.glsl').write_text(glsl,encoding='utf-8',newline='\n')
template=(ROOT/'tools/materials/master1uv-emissive-nonmetal-adapter.template.js').read_text()
(ROOT/'web/src/master1uv-emissive-nonmetal-material.js').write_text(template.replace('__MASTER1UV_EMISSIVE_NONMETAL_GLSL__',json.dumps(glsl)),encoding='utf-8')
document={k:report[k] for k in ['evidenceId','shaderName','shaderNameHash','shaderGuid','rvmSurfaceGuid','pixelShader','pixelShaderSha256','pairedVertexShader','pairedVertexShaderSha256','sourceRvmSha256','textureMapping','constantMapping','limitations','placedSectionCount','visibleCoverage','nativeMaterialModel','nativeLightingInputs','sourceEmissionLiterals']}
document['nativeLightingInputs']={**document['nativeLightingInputs'],
    'rawSmoothness':'bf2_master1uv_emissive_nonmetal_surface.smoothness',
    'emissiveExpression':'bf2_master1uv_emissive_nonmetal_surface.emissive',
    'emissiveStage':'add-to-atlas-or-SH-before-DFG-albedo', 'separateThreeEmission':False,
    'sourceAtlasRecipe':atlas_path.relative_to(ROOT).as_posix(), 'sourceAtlasRecipeSha256':sha(atlas_path.read_bytes()),
    'diffuse':'(atlasOrSH + sourceEmission) * baseColor * native DFG.b; source metalness is zero.'}
document['limitations']=[text for text in document['limitations'] if not text.startswith('Native packed tangent parity')]+[
    'Exact source tangent frames for this wall LOD0/LOD1 are proven by BF2-NATIVE-TANGENT-NONMETAL-001. Native live-frame pass selection remains unobserved; geometries without the verified sidecar retain the derivative path.',
    'Source emission is added to atlas or SH prelighting before ordinary DFG/albedo combine, including geometry without atlas coverage. Browser SH fallback retains its existing diffuse-only approximation.',
    'Without native DFG resources the fallback Lambert response remains a reconstructed approximation.']
document.update({'materials':[{**m,'textures':{role:textures[b['texture']['fileGuid']]['url'] for role,b in m['bindings'].items()}} for m in report['materials']],'sourceTextures':textures,'sourceEquationSha256':sha(glsl.encode()),'runtimeMapping':{
    'color':'Original layered color and thresholded normalEmission.b blend to source emissiveBaseColor.',
    'emissive':'Original mask*emissiveColor*emissiveIntensity*emissiveMultiplier joins atlas or SH prelighting before frame exposure and native DFG.b*baseColor. Separate Three emission is zero; source intensity15000 and multiplier1, no normalization.',
    'metalness':'Original ordinary GBuffer ID0, constant o2.y=0 and reflectance.5, dielectric F0=.04.',
    'roughness':'1-clamp(source smoothness,0,1); native GBuffer smoothness is unclamped.',
    'normal':'Original two normal layers with exact source tangent frames on proven wall LOD0/LOD1 (BF2-NATIVE-TANGENT-NONMETAL-001); derivative fallback only without a verified sidecar. Final shading normal is normalized for SH.',
    'ao':'None in selected producer; normalEmission alpha unused.',
    'colorSpace':'Original DDS SRGB/UNORM distinction retained; runtime resource-view overrides unresolved.',
    'mips':'All ten verified native mip decodes reused unchanged; browser regenerates lower PNG mips.'}})
(ROOT/'web/public/assets/recovered-master1uv-emissive-nonmetal-materials.json').write_text(json.dumps(document,indent=2),encoding='utf-8')
print(json.dumps({'sections':len(document['materials']),'placements':202,'reusedTextures':len(textures),'newTextureBytes':0}))
