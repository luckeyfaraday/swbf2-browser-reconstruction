// Plays Darth Vader on the actual map: boots with ?hero=darthvader, checks that
// hero programs were prepared with the map (no compile after load), then runs a
// saber combo, Force choke, block and saber throw against the live bots and
// records screenshots, frame rate and errors. Teleports only arrange encounters;
// strikes, damage and abilities run through the production runtime.
// Usage: node test/hero-map-check.mjs [--gpu=dgpu|igpu]   (wrap in tools/gpu-lock.sh)
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'test-results'),port=7761;
const arg=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const gpu=arg('gpu','dgpu');
const report={kind:'hero-map-check',hero:'darthvader',gpu,startedAtUtc:new Date().toISOString(),checks:[],consoleErrors:[],pageErrors:[],httpErrors:[]};
const check=(name,details={})=>{report.checks.push({name,...details});console.log(JSON.stringify({check:name,...details}));};
let server,browser,page;
const shot=label=>page.screenshot({path:path.join(output,`hero-vader-${label}.png`)});
const frames=n=>page.evaluate(n=>new Promise(resolve=>{let left=n;const tick=()=>--left<=0?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);}),n);
const turn=(act,seconds)=>page.evaluate(({act,seconds})=>window.vibe.turn({act,seconds,full:false}),{act,seconds});
try {
  await fs.mkdir(output,{recursive:true});
  server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'error'});await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling','--js-flags=--max-old-space-size=8192',...(gpu==='dgpu'?['--force_high_performance_gpu']:[])]});
  page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(120000);
  page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text().slice(0,400));});
  page.on('pageerror',e=>report.pageErrors.push(String(e).slice(0,400)));
  page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
  const started=Date.now();
  await page.goto(`http://127.0.0.1:${port}/?agent&seed=42&batchCell=48&hero=darthvader`);
  await page.waitForFunction(()=>window.battlefront?.status==='ready'||window.battlefront?.status==='unavailable',{},{timeout:300000});
  assert.equal(await page.evaluate(()=>window.battlefront.status),'ready');
  report.loadTimings=await page.evaluate(()=>window.battlefront.loadTimings);
  const mapShaders=report.loadTimings.find(r=>r.stage==='map-shader-preparation');
  assert.ok(mapShaders,'map shader preparation must run');assert.deepEqual(mapShaders.failed,[],'no program may fail to link');
  check('loads with hero assets',{seconds:(Date.now()-started)/1000,heroFailures:await page.evaluate(()=>window.battlefront.debug.assets.heroes?.failures??null)});

  await page.evaluate(()=>window.vibe.act({hero:'darthvader',restart:true,mode:'tdm'}));
  await page.evaluate(()=>window.vibe.step(1));await frames(4);
  const programsAfterLoad=await page.evaluate(()=>window.battlefront.debug.renderer.info.programs.map(p=>p.id));
  let state=await page.evaluate(()=>window.vibe.observe());
  assert.equal(state.hero?.id,'darthvader','player must be Vader');
  assert.equal(state.hero.team,1,'Vader plays for the Empire');
  check('spawned as Vader',{health:state.hero.health,team:state.hero.team,camera:state.camera,provisional:state.hero.provisional.length,audio:state.hero.audio});
  await shot('spawn');

  // Arrange an encounter: put Vader 3 m from the nearest live enemy, facing it.
  // Arrangement only: wait out a respawn and restore Vader's health between encounters,
  // because five rebels firing point-blank can drop him while a test swing plays.
  const arrange=async distance=>{
    await page.evaluate(()=>{for(let i=0;i<900&&!window.battlefront.debug.runtime.player.alive;i++)window.vibe.step(1/60);const me=window.battlefront.debug.runtime.player;me.health=me.hero.parameters.health;me.spawnProtection=0;});
    return arrangeAt(distance);
  };
  const arrangeAt=distance=>page.evaluate(distance=>{
    const {runtime,THREE}=window.battlefront.debug,me=runtime.player;
    const enemies=runtime.actors.filter(a=>a.alive&&runtime.enemy(me,a));
    const feet=me.controller.getFeetPosition();enemies.sort((a,b)=>a.controller.getFeetPosition().distanceTo(feet)-b.controller.getFeetPosition().distanceTo(feet));
    const target=enemies[0];if(!target)return null;
    const at=target.controller.getFeetPosition(),dir=feet.clone().sub(at).setY(0);
    if(dir.lengthSq()<1e-6)dir.set(0,0,1);dir.normalize();
    me.controller.setPosition(at.clone().addScaledVector(dir,distance).add(new THREE.Vector3(0,.05,0)));
    const d=at.clone().sub(me.controller.getFeetPosition());me.controller.setLook(Math.atan2(-d.x,-d.z),-.12);
    return {target:target.id,distance};
  },distance);

  report.encounters=[];
  let encounter=await arrange(2.6);report.encounters.push({kind:'strike',...encounter});
  await turn({fire:true},.3);await frames(3);await shot('strike');
  await turn({fire:true},.45);await frames(3);await shot('strike-death');
  await turn({fire:true},2.2);
  report.afterCombo=await page.evaluate(()=>({time:window.vibe.observe().time,hero:window.vibe.observe().hero,input:window.battlefront.debug.runtime.ctx.input}));
  await turn({fire:false,stop:true},1.2);
  report.vaderDeaths=await page.evaluate(()=>window.vibe.events().filter(e=>e.type==='kill'&&e.victim==='player').length);
  state=await page.evaluate(()=>window.vibe.observe());
  check('saber combo',{strikes:state.hero.strikes,hits:state.hero.hits,vaderDeaths:report.vaderDeaths,afterCombo:report.afterCombo.hero});
  assert.ok(state.hero.strikes>=3,'combo must chain');

  encounter=await arrange(4.5);report.encounters.push({kind:'choke',...encounter});
  await turn({press:'KeyF'},1.1);await frames(3);await shot('choke');
  await turn({stop:true},.6);await frames(3);await shot('choke-hold');
  await turn({stop:true},1.4);
  state=await page.evaluate(()=>window.vibe.observe());
  check('force choke',{chokes:state.hero.chokes,choked:state.hero.choked,cooldown:state.hero.cooldowns.choke});
  assert.equal(state.hero.chokes,1,'choke must start');assert.ok(state.hero.choked>=1,'choke must grab the arranged target');

  await arrange(9);
  await turn({aim:true},4);await frames(3);await shot('block');
  report.corpses=await page.evaluate(()=>window.battlefront.debug.runtime.actors.filter(a=>!a.alive&&a.body.root.visible).map(a=>({id:a.id,cause:a.deathCause,clip:a.body.reaction?.()??null})));
  check('corpses on the floor',{corpses:report.corpses});
  state=await page.evaluate(()=>window.vibe.observe());
  check('block',{deflects:state.hero.deflects,stamina:state.hero.stamina});
  await turn({aim:false,stop:true},.5);

  encounter=await arrange(8);report.encounters.push({kind:'throw',...encounter});
  await turn({press:'KeyQ'},.45);await frames(3);await shot('throw');
  await turn({stop:true},3);
  state=await page.evaluate(()=>window.vibe.observe());
  check('saber throw',{throws:state.hero.throws,saberInHand:state.hero.saberInHand});
  assert.ok(state.hero.throws===1&&state.hero.saberInHand,'saber must return');

  report.beforeRage=await page.evaluate(()=>{const o=window.vibe.observe();return {alive:o.actors[0].alive,action:o.hero.action,cooldowns:o.hero.cooldowns};});
  await arrange(10);
  await turn({press:'KeyE'},1.2);await frames(3);await shot('rage');
  state=await page.evaluate(()=>window.vibe.observe());
  check('focused rage',{rage:state.hero.rage,shield:state.hero.rageShield,before:report.beforeRage});
  // Arrangement for a visual: three troopers in front of Vader die to blaster hits
  // from different sides through the production damage path; their source death
  // clips must end with intact bodies on the floor.
  await arrange(5);
  report.deaths=await page.evaluate(()=>{
    const {runtime,THREE,assets}=window.battlefront.debug,me=runtime.player;
    // An open floor: the Imperial spawn the round itself uses, looking into the room.
    const spawn=assets.manifest.spawns.find(s=>s.team===me.team)??assets.manifest.spawns[0];
    me.controller.setPosition(new THREE.Vector3(...spawn.position).add(new THREE.Vector3(0,.05,0)));me.controller.setLook(spawn.yaw??0,-.35);
    const feet=me.controller.getFeetPosition(),yaw=me.controller.yaw;
    const fwd=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const victims=runtime.actors.filter(a=>a.alive&&runtime.enemy(me,a)).slice(0,3),rows=[];
    victims.forEach((v,i)=>{v.controller.setPosition(feet.clone().addScaledVector(fwd,3.2+i*.6).addScaledVector(right,(i-1)*1.4).add(new THREE.Vector3(0,.05,0)));v.spawnProtection=0;});
    window.vibe.step(1/60);
    victims.forEach((v,i)=>{const dir=[fwd.clone(),right.clone(),right.clone().negate()][i];runtime.applyDamage(v,5000,null,{cause:'blaster',direction:dir});rows.push({id:v.id,clip:v.body.reaction()});});
    return rows;
  });
  await turn({stop:true},2.2);await frames(3);await shot('blaster-deaths');
  report.deathsAfter=await page.evaluate(()=>window.battlefront.debug.runtime.actors.filter(a=>!a.alive).map(a=>{const head=a.body.model.getObjectByName('Head').getWorldPosition(new window.battlefront.debug.THREE.Vector3());return {id:a.id,visible:a.body.root.visible,clip:a.body.reaction?.(),headAboveFeet:+(head.y-a.controller.getFeetPosition().y).toFixed(2)};}));
  check('blaster deaths',{deaths:report.deaths,after:report.deathsAfter});
  report.events=await page.evaluate(()=>window.vibe.events().filter(e=>/^hero|deflect|kill/.test(e.type)).slice(-80));
  const kills=report.events.filter(e=>e.type==='kill'&&e.killer==='player').length;
  check('kills by Vader',{kills});

  await page.evaluate(()=>window.vibe.setTimeMode('realtime'));
  report.perf=await page.evaluate(()=>window.vibe.perf(2000));
  check('frame rate',{fps:report.perf.fps??report.perf});
  const programsAfter=await page.evaluate(()=>window.battlefront.debug.renderer.info.programs.map(p=>({id:p.id,name:p.name,key:String(p.cacheKey).slice(0,400)})));
  report.newPrograms=programsAfter.filter(p=>!programsAfterLoad.includes(p.id));
  check('programs compiled after load',{count:report.newPrograms.length,programs:report.newPrograms});
  report.errors=await page.evaluate(()=>window.vibe.errors?.()??null);
  report.pass=!report.pageErrors.length&&!report.newPrograms.length;
} catch(error) {
  report.failure=String(error?.stack??error);console.error(error);process.exitCode=1;
  try{await shot('failure');}catch{}
} finally {
  report.finishedAtUtc=new Date().toISOString();
  await fs.writeFile(path.join(output,'hero-vader-map-check.json'),JSON.stringify(report,null,2));
  await browser?.close();await server?.close();
  console.log(JSON.stringify({pass:report.pass??false,pageErrors:report.pageErrors.length,consoleErrors:report.consoleErrors.length,httpErrors:report.httpErrors.length,newPrograms:report.newPrograms?.length}));
}
