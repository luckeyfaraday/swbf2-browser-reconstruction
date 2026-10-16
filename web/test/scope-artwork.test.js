import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {scopePathData, scopePaletteRgb, sourceScopeAssetSvg, evaluateScopeArtworkControls, buildScopeArtworkSvg} from '../src/scope-artwork.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = JSON.parse(readFileSync(resolve(root, 'web/public/assets/scope-artwork.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => Array.isArray(value) ? value.map(plain) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([k]) => !['$type','__InstanceGuid','__Id'].includes(k)).map(([k,v]) => [k,plain(v)])) : value;
const assetNamed = suffix => Object.values(doc.assets).find(a => a.name.endsWith(suffix));
const hash = name => [...name].reduce((v,c) => (Math.imul(v,33) ^ c.charCodeAt(0)) >>> 0,5381);
const floatBits = bits => new Float32Array(new Uint32Array([bits >>> 0]).buffer)[0];

test('scope vectors, complete graph records and palettes retain their original hashes and numerical data', () => {
  assert.equal(Object.keys(doc.assets).length,5);
  assert.equal(Object.values(doc.assets).reduce((n,a) => n+a.shapes.length,0),13);
  for (const asset of Object.values(doc.assets)) {
    const bytes = readFileSync(resolve(root,asset.source.path));
    assert.equal(sha(bytes),asset.source.sha256);
    const source = JSON.parse(bytes).asset.objects[0];
    assert.deepEqual(asset.shapes,plain(source.Shapes));
    assert.deepEqual(asset.layoutRect,plain(source.LayoutRect));
  }
  for (const graph of Object.values(doc.graphs)) {
    const bytes = readFileSync(resolve(root,graph.source.path));
    assert.equal(sha(bytes),graph.source.sha256);
    for (const o of JSON.parse(bytes).asset.objects)
      assert.deepEqual(graph.objects[o.$id],{sourceType:o.$type.split('.').at(-1),...plain(o)});
  }
  const bytes = readFileSync(resolve(root,doc.palette.source.path));
  assert.equal(sha(bytes),doc.palette.source.sha256);
  const sourcePalette = JSON.parse(bytes).asset.objects.find(o => o.$type.endsWith('.UIColorPalette'));
  assert.deepEqual(doc.palette.rows,sourcePalette.Colors.map(row => row.Colors.map(plain)));
  for(let row=0;row<4;row++) for(const index of [0,22,24,27])
    assert.deepEqual(scopePaletteRgb(doc,index,row),scopePaletteRgb(doc,index,0));
  assert.deepEqual(scopePaletteRgb(doc,27),[.009134059,.009134059,.009134059]);
});

test('source background triangulation preserves its hole; optional arcs retain all authored endpoint/radius values', () => {
  const bg = assetNamed('_ScopeRifle_BG').shapes[0];
  assert.equal(bg.TriangulatedPoints.length,30);
  assert.equal(bg.TriangulatedIndices.length,84);
  const cross = (a,b,p) => (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
  const inside = p => {
    for(let i=0;i<bg.TriangulatedIndices.length;i+=3){
      const t=bg.TriangulatedIndices.slice(i,i+3).map(j=>bg.TriangulatedPoints[j]);
      const signs=t.map((a,j)=>cross(a,t[(j+1)%3],p));
      if(signs.every(x=>x>=0)||signs.every(x=>x<=0))return true;
    }return false;
  };
  assert.equal(inside({x:960,y:540}),false);
  assert.equal(inside({x:20,y:20}),true);
  const outline = assetNamed('_ScopeRifle_Outline').shapes[0];
  assert.equal(outline.LineWidth,.3);
  assert.throws(()=>scopePathData(outline.Path),/explicit opt-in/);
  const path=scopePathData(outline.Path,{allowInferredCircularArcs:true});
  assert.equal((path.match(/A /g)||[]).length,8);
  assert.equal((path.match(/L /g)||[]).length,4);
  for(const c of outline.Path.Corners)assert.ok(path.includes(`${c.Position.x} ${c.Position.y}`));
  const icon=assetNamed('_ScopeDetailsDualZoomOn');
  const svg=sourceScopeAssetSvg(icon,{colorEncoding:'linear-to-srgb',allowInferredCircularArcs:true});
  assert.match(svg,/<linearGradient/);
  assert.match(svg,/stop-opacity="0.25"/);
  assert.match(svg,/viewBox="0 0 96 24"/);
});

test('scope controls follow source graph arithmetic, timeline links and separate concurrent property writers', () => {
  const main=doc.graphs.mainLogic.objects,screen=doc.graphs.screen.objects;
  assert.equal(main['internal:5'].UseVelocity,true);
  assert.equal(main['internal:3'].ValueIfTrue,6);
  assert.equal(main['internal:3'].ValueIfFalse,8);
  assert.equal(hash('DispersionAngle'),0x29c841c6);
  assert.equal(hash('lerpf'),173628008);
  assert.equal(hash('scale'),195776893);
  const constants=id=>screen[id].Assembly.Instructions.filter(x=>x.Code.name==='MathOpCode_ConstF').map(x=>floatBits(x.Param1));
  assert.deepEqual(constants('internal:41'),[1,4]);
  assert.deepEqual(constants('internal:48'),[1,10,1,10,1]);
  const bp=Object.values(screen).find(o=>o.sourceType==='UIWidgetBlueprint');
  const link=bp.LinkConnections.find(c=>c.Source.$ref==='internal:32');
  assert.equal(link.Target.$ref,'internal:13');
  assert.equal(screen['internal:35'].TargetPinId,hash('Alpha'));
  assert.deepEqual(screen['internal:26'].Value,[0,.85]);
  assert.equal(bp.PropertyConnections.filter(c=>c.Target.$ref==='internal:13' && c.TargetFieldId===hash('Alpha')).length,1);
  for(const fraction of [0,.5,.95,Math.fround(.95),.951,1]) {
    const c=evaluateScopeArtworkControls(doc,{fraction,outlineRandom:.2,scannerRandom:.8,dispersionAngle:2});
    assert.equal(c.visible,Math.fround(fraction)>0);
    assert.equal(c.scopeState,Math.fround(fraction)>Math.fround(.95));
    assert.equal(c.outlineAlpha,Math.fround(Math.fround(fraction)*Math.fround(.2)));
    assert.equal(c.backgroundAlpha.timeline,Math.fround(Math.fround(fraction)*Math.fround(.85)));
    assert.equal(c.backgroundAlpha.external,undefined);
    assert.equal(c.outlineGlowWidth.dispersion,7);
    assert.deepEqual(c.targetContainerScale,[Math.fround(1.2),Math.fround(1.2),1]);
  }
  assert.throws(()=>evaluateScopeArtworkControls(doc,{fraction:1,outlineRandom:1,scannerRandom:.8}),/original sample/);
});

test('portable screen helper preserves default alpha and reports unsupported native features', () => {
  const options={colorEncoding:'linear-to-srgb',allowInferredCircularArcs:true};
  const defaults=buildScopeArtworkSvg(doc,options);
  assert.equal((defaults.svg.match(/data-source-element=/g)||[]).length,4);
  assert.equal((defaults.svg.match(/data-source-blend="[^"]+" opacity="0"/g)||[]).length,4);
  const actual=buildScopeArtworkSvg(doc,{...options,containerScale:[1.1,1.1],elementValues:{
    ScopeOutline:{alpha:.2,paletteIndex:22,glowWidth:1},ScopeGlow:{alpha:.85}}});
  assert.match(actual.svg,/scale\(1.1 1.1\)/);
  assert.match(actual.svg,/data-source-element="ScopeOutline"[^>]+opacity="0.2"/);
  assert.ok(actual.omittedNativeFeatures.some(s=>s.includes('native GlowWidth=48')));
  assert.equal(doc.elements.ScopeOutline.data.Alpha,0);
  assert.equal(doc.elements.ScopeGlow.data.PaletteIndex,27);
  assert.equal(doc.elements.ScopeOutline.data.Shape.$external,'a8479841-f228-46ab-8370-7073d67f3051');
});
