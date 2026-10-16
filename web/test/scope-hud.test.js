import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createScopeHudState,createScopeHudView} from '../src/scope-hud.js';
const document=JSON.parse(readFileSync(new URL('../public/assets/scope-artwork.json',import.meta.url)));
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

test('source rise/fall and strict threshold start flicker only after its original delay',()=>{
  const hud=createScopeHudState(document);
  let state=hud.update(.1,{aiming:true});
  near(state.fraction,.6);assert.equal(state.visible,true);assert.equal(state.scopeState,false);
  assert.equal(state.random.triggers,0);
  state=hud.update(.06,{aiming:true});
  near(state.fraction,.96);assert.equal(state.random.gateOpen,true);
  assert.equal(state.random.triggers,0);assert.ok(state.random.nextTrigger>.168 && state.random.nextTrigger<.169);
  state=hud.update(.01,{aiming:true});
  assert.equal(state.fraction,1);assert.equal(state.random.triggers,1);
  assert.ok(state.random.outline>=.18 && state.random.outline<=.25);
  assert.ok(state.random.scanner>=.73 && state.random.scanner<=1);
  state=hud.update(.03,{aiming:true});assert.equal(state.random.triggers,4);
  state=hud.update(.02,{aiming:false});near(state.fraction,.84);
  // Gate closure doesn't cancel the original Delay.Out -> RandomFloat.In edge.
  assert.equal(state.random.gateOpen,false);assert.equal(state.random.triggers,5);
  assert.equal(state.random.nextTrigger,null);
  state=hud.update(.2,{aiming:false});assert.equal(state.fraction,0);assert.equal(state.visible,false);
  assert.equal(state.random.triggers,5);
});

test('source trigger graph confirms loop, delay and independent random-sample outputs',()=>{
  const graph=document.graphs.triggerInterval.objects;
  assert.equal(graph['internal:2'].Delay,.01);
  assert.equal(graph['internal:2'].TimeDeltaType.name,'TimeDeltaType_World');
  assert.equal(graph['internal:2'].RemoveDuplicateEvents,true);
  const bp=Object.values(graph).find(o=>o.sourceType==='LogicPrefabBlueprint');
  const edges=bp.EventConnections.map(c=>`${c.Source.$ref}->${c.Target.$ref}`);
  assert.ok(edges.includes('internal:2->internal:4'));
  assert.ok(edges.includes('internal:2->internal:3'));
  assert.ok(edges.includes('internal:3->internal:2'));
  // No authored closing event is sent to Delay; EventGate is closed instead.
  const main=document.graphs.mainLogic.objects;
  const mainBp=Object.values(main).find(o=>o.sourceType==='LogicPrefabBlueprint');
  assert.equal(mainBp.EventConnections.filter(c=>c.Source.$ref==='internal:1' && ['internal:13','internal:14'].includes(c.Target.$ref)).length,2);
});

test('reversal preserves source fraction and pending delay without sampling on each aim activation',()=>{
  const hud=createScopeHudState(document);
  let state=hud.update(.1,{aiming:true});
  state=hud.update(.025,{aiming:false});near(state.fraction,.4);assert.equal(state.random.triggers,0);
  state=hud.update(.1,{aiming:true});near(state.fraction,1);
  const before=state.random.triggers;
  state=hud.update(.002,{aiming:false});near(state.fraction,.984);assert.equal(state.random.gateOpen,true);
  state=hud.update(.002,{aiming:true});near(state.fraction,.996);
  assert.ok(state.random.triggers-before<=1);
  // Crossing below and back above the gate retains one existing pending event.
  state=hud.update(.006,{aiming:false});assert.equal(state.random.gateOpen,false);
  const pending=state.random.nextTrigger;
  state=hud.update(.001,{aiming:true});assert.equal(state.random.gateOpen,true);
  if(pending!==null)assert.equal(state.random.nextTrigger,pending);
});

test('browser scheduling policy is deterministic across tick sizes; death/reset cancel pending flicker',()=>{
  const one=createScopeHudState(document),many=createScopeHudState(document);
  const expected=one.update(1,{aiming:true});
  let actual;
  for(let i=0;i<100;i++)actual=many.update(.01,{aiming:true});
  assert.equal(actual.random.triggers,expected.random.triggers);
  assert.equal(actual.random.outline,expected.random.outline);
  assert.equal(actual.random.scanner,expected.random.scanner);
  assert.equal(actual.random.triggers,84);
  const dead=many.update(.02,{aiming:true,alive:false});
  assert.equal(dead.fraction,0);assert.equal(dead.visible,false);assert.equal(dead.aiming,false);
  assert.equal(dead.random.nextTrigger,null);assert.equal(dead.random.gateOpen,false);
  const deadLater=many.update(1,{aiming:true,alive:false});
  assert.equal(deadLater.random.triggers,dead.random.triggers);
  const reset=many.reset();assert.equal(reset.random.triggers,0);assert.equal(reset.random.outline,.18);
  const restarted=many.update(1,{aiming:true});assert.equal(restarted.random.outline,expected.random.outline);
  assert.throws(()=>many.update(-1),/Invalid/);
  assert.throws(()=>many.update(0,{dispersionDegrees:NaN}),/Invalid/);
});

test('view hides immediately on death/disable and applies recovered alpha and center scale',()=>{
  // DOM-independent fixture: checks presentation values rather than a screenshot.
  const node=()=>({attributes:{},setAttribute(k,v){this.attributes[k]=v;}});
  const background=node(),outline=node(),container=node();
  const svg={firstElementChild:container,querySelector(s){return s.includes('ScopeGlow')?background:outline;}};
  const element={innerHTML:'',hidden:false,querySelector(){return svg;}};
  const view=createScopeHudView(element,document),hud=createScopeHudState(document);
  const state=hud.update(.2,{aiming:true,dispersionDegrees:2});
  view.update(state);assert.equal(element.hidden,false);
  near(background.attributes.opacity,.85);assert.equal(outline.attributes.opacity,state.outlineAlpha);
  assert.match(container.attributes.transform,/translate\(960 540\) scale\(1.2000000476837158 1.2000000476837158\)/);
  view.update(state,{enabled:false});assert.equal(element.hidden,true);
  view.update(hud.update(0,{alive:false}));assert.equal(element.hidden,true);
});
