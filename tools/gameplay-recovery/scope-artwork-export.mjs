// CPU-only portable artwork exports; no browser, GPU, or shared runtime edits.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceScopeAssetSvg,buildScopeArtworkSvg,scopePaletteRgb} from '../../web/src/scope-artwork.js';
const document=JSON.parse(readFileSync('web/public/assets/scope-artwork.json'));
const out='exports/scope-artwork';
mkdirSync(out,{recursive:true});
const outputs=[];
function write(name,svg){
  const path=`${out}/${name}.svg`;
  writeFileSync(path,svg+'\n');
  outputs.push({path,bytes:Buffer.byteLength(svg+'\n'),sha256:createHash('sha256').update(svg+'\n').digest('hex')});
}
for(const asset of Object.values(document.assets))write(asset.name.split('/').at(-1),sourceScopeAssetSvg(asset,{
  colorEncoding:'linear-to-srgb',allowInferredCircularArcs:true,idPrefix:asset.source.fileGuid}));
const example=buildScopeArtworkSvg(document,{
  colorEncoding:'linear-to-srgb',allowInferredCircularArcs:true,
  elementValues:{ScopeOutline:{alpha:.18,paletteIndex:22},ScopeGlow:{alpha:.85}},
});
write('screen-endpoint-example',example.svg);
const report={evidenceId:document.evidenceId,outputs,
  example:{description:'Steady timeline endpoint and minimum authored outline random sample; a portable preview, not captured native execution',
    outlineAlpha:.18,backgroundAlpha:.85,palette22:scopePaletteRgb(document,22),palette27:scopePaletteRgb(document,27)},
  omissions:example.omittedNativeFeatures,inferred:example.inferred};
writeFileSync(`${out}/manifest.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
