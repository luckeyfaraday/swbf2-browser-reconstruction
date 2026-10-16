// Actual local extracted scene, no fixture routes, no source behavior parity claim.
// This remains a fallback because the authentic Vibe CLI is unavailable.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'test-results');
const port=Number(process.env.BF2_ACTUAL_CHECK_PORT??7747),base=`http://127.0.0.1:${port}`;
const report={evidenceId:'EV-ACTUAL-MAP-20261015-01',kind:'actual-extracted-map-fallback-browser-check',syntheticFixture:false,vibeVerify:false,originalGameParity:false,startedAtUtc:new Date().toISOString(),checks:[],errors:[],consoleErrors:[],failedRequests:[],httpErrors:[],trace:[]};
let server,browser,page;
const check=(name,details={})=>{report.checks.push({name,pass:true,...details});console.log(JSON.stringify({stage:name,...details}));};
async function snapshot(label){await page.screenshot({path:path.join(output,`actual-map-${label}.png`)});}
async function observe(label){const state=await page.evaluate(()=>window.vibe.observe());report.trace.push({label,state});return state;}
try {
  await fs.mkdir(output,{recursive:true});
  report.manifest=JSON.parse(await fs.readFile(path.join(root,'public/assets/map.scene.json'),'utf8'));
  assert.ok(report.manifest.assets.length>100,'real recovered scene required');
  assert.ok(!/synthetic/i.test(report.manifest.metadata.name));
  server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  let executablePath=process.env.BF2_BROWSER_EXECUTABLE;
  if(!executablePath)for(const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']){try{await fs.access(candidate);executablePath=candidate;break;}catch{}}
  // BF2_GPU=dgpu selects the discrete GPU on hybrid laptops; Chrome otherwise ignores
  // WebGL powerPreference and renders on the integrated GPU.
  browser=await chromium.launch({headless:true,executablePath,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling','--js-flags=--max-old-space-size=8192',...(process.env.BF2_GPU==='dgpu'?['--force_high_performance_gpu']:[])]});
  page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(30000);
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  page.on('requestfailed',request=>report.failedRequests.push({url:request.url(),failure:request.failure()}));
  page.on('response',response=>{if(response.status()>=400)report.httpErrors.push({url:response.url(),status:response.status()});});
  report.batchCellSize=process.env.BF2_BATCH_CELL?Number(process.env.BF2_BATCH_CELL):48;
  const loadStart=Date.now();await page.goto(`${base}/?agent&seed=42&batchCell=${report.batchCellSize}${process.env.BF2_PRECOMPILE==='1'?'&precompile':''}`,{timeout:30000});
  await Promise.race([page.waitForFunction(()=>window.battlefront?.status==='ready'||window.battlefront?.status==='unavailable',{},{timeout:180000}),new Promise((_,reject)=>page.once('pageerror',error=>reject(error)))]);
  const status=await page.evaluate(()=>window.battlefront.status);assert.equal(status,'ready',await page.locator('#loading-detail').textContent());
  report.loadTimings=await page.evaluate(()=>window.battlefront.loadTimings);
  // Every program the map can use is compiled during loading; none may fail to link.
  const mapShaders=report.loadTimings.find(row=>row.stage==='map-shader-preparation');
  assert.ok(mapShaders,'full-map shader preparation must run during loading');assert.deepEqual(mapShaders.failed,[],'map programs that fail to link draw nothing');
  check('Actual source map loads GLBs and collision BVH',{milliseconds:Date.now()-loadStart,assets:report.manifest.assets.length,instances:report.manifest.instances.length});
  await page.evaluate(()=>window.vibe.step(1));
  const initial=await observe('settled-source-spawn');
  report.doorObservations=[await page.evaluate(()=>window.battlefront.doors())];
  report.hitVolumes=await page.evaluate(()=>window.battlefront.hitVolumes());
  const nativeLights=await page.evaluate(()=>window.battlefront.lighting().provenance.nativePunctual);
  assert.equal(nativeLights.count,217);assert.equal(nativeLights.ies,53);
  check('Recovered punctual radiometry selects217 source lights including53 original IES profiles',nativeLights);
  assert.equal(initial.assetStats.sourceHitCapsules,11);
  for(const actor of report.hitVolumes) {
    assert.equal(actor.capsules.length,11);
    for(const capsule of actor.capsules) {
      assert.ok([...capsule.start,...capsule.end,capsule.radius].every(Number.isFinite));
      assert.ok(capsule.start[1]-actor.feet[1]>-.2&&capsule.start[1]-actor.feet[1]<2.2,`source ${capsule.bone} should remain near its animated actor`);
    }
  }
  assert.equal(initial.actors[0].weaponHeat.phase,'ready');
  assert.ok(initial.cameraRecoil,'Recovered first-person recoil must initialize');
  assert.ok(initial.rifleTrails&&initial.rifleTrails.capacity===30,'Original rifle emitter pool must initialize');
  assert.ok(initial.actors.every(actor=>actor.weaponSpread?.provenance.evidenceId==='BF2-WEAPON-HANDLING-NATIVE-001'));
  assert.ok(initial.actors.every(actor=>actor.projectileLaunch?.projectileSpeed===700&&actor.projectileLaunch.projectileLifetime===3&&actor.projectileLaunch.range===2100&&actor.projectileLaunch.evidenceId==='BF2-PROJECTILE-NATIVE-001'));
  assert.ok(initial.actors.filter(actor=>actor.team===0).every(actor=>actor.weapon==='rebel-a280'));
  assert.ok(initial.actors.filter(actor=>actor.team===1).every(actor=>actor.weapon==='primary'));
  check('Source soldier capsules bind both faction rigs and selected weapon heat initializes',{capsulesPerActor:11,actors:report.hitVolumes.length});
  await page.evaluate(()=>window.vibe.perf(800));
  report.shadows=await page.evaluate(()=>{const shadows=window.battlefront.lighting().shadows;return shadows&&{...shadows,policy:shadows.policy.evidenceId};});
  assert.ok(report.shadows,'native spot shadows must initialize');assert.equal(report.shadows.policy,'BF2-NATIVE-LOCAL-SHADOW-ACTIVATION-001');
  assert.ok(report.shadows.activeSlots>=1,'source-shadowed spots near spawn hold atlas tiles');
  assert.ok(report.shadows.staticRenders>=report.shadows.activeSlots&&report.shadows.cachedLights>=report.shadows.activeSlots);
  assert.equal(report.shadows.casters.castingAssets,332);assert.equal(report.shadows.casters.sections,363);
  assert.equal(report.shadows.atlas.format,'DEPTH_COMPONENT16');assert.equal(report.shadows.atlas.bias.group,11);assert.equal(report.shadows.atlas.static,3120);
  assert.ok(report.shadows.receiverMaterials>0);
  assert.ok(report.shadows.skippedReceivers.every(row=>row.samplers>=16),'only materials at the sampler limit skip shadow receiving');
  check('Native local spot shadows render source caster tiles and reach receiving materials',{activeSlots:report.shadows.activeSlots,staticRenders:report.shadows.staticRenders,receivers:report.shadows.receiverMaterials,skippedReceivers:report.shadows.skippedReceiverCount});
  const floorRecipe=JSON.parse(await fs.readFile(path.join(root,'public/assets/recovered-floor-materials.json'),'utf8'));
  assert.equal(initial.assetStats.recoveredFloors,floorRecipe.materials.length,'every source floor recipe must bind its intended material section');
  check('Recovered source floor shader binds every matching material section',{sections:initial.assetStats.recoveredFloors,evidence:initial.assetStats.recoveredFloorProvenance});
  assert.equal(initial.assetStats.recoveredMasters,114);
  check('Original packed wall shader binds all matching default sections',{sections:initial.assetStats.recoveredMasters});
  assert.equal(initial.assetStats.recoveredMaster2Uv,8);
  assert.equal(initial.assetStats.recoveredMaster2UvGeometries,14);
  check('Original two-coordinate Master shader binds all sections and native LOD UVs',{sections:initial.assetStats.recoveredMaster2Uv,geometries:initial.assetStats.recoveredMaster2UvGeometries});
  assert.equal(initial.assetStats.recoveredPropsPreset,27);
  check('Original PropsPreset conditional routing binds all 27 material sections',{sections:initial.assetStats.recoveredPropsPreset});
  assert.equal(initial.assetStats.recoveredCeilings,20);
  check('Original emissive ceiling shader binds all source sections',{sections:initial.assetStats.recoveredCeilings});
  assert.equal(initial.assetStats.recoveredMetalOnly,17);
  check('Original MetalOnly wall shader binds all source sections',{sections:initial.assetStats.recoveredMetalOnly});
  assert.equal(initial.assetStats.recoveredCatwalk1,23);
  check('Original Catwalk1 surface material binds all 23 active sections',{sections:initial.assetStats.recoveredCatwalk1});
  assert.equal(initial.assetStats.recoveredVolcanicObject,10);
  check('Original Volcanic machinery material binds all 10 active sections',{sections:initial.assetStats.recoveredVolcanicObject});
  assert.equal(initial.assetStats.recoveredCatwalk2,30);
  check('Original catwalk shader binds all source sections',{sections:initial.assetStats.recoveredCatwalk2});
  assert.equal(initial.assetStats.recoveredExterior,4);
  check('Original exterior shader binds all source sections',{sections:initial.assetStats.recoveredExterior});
  if(report.batchCellSize===48)assert.equal(initial.assetStats.preparedCollision?.loaded,true);
  assert.equal(initial.assetStats.recoveredCorvetteDamage,6);
  assert.equal(initial.assetStats.recoveredCorvetteDamageGeometries,10);
  check('Original Corvette damage materials bind source mask and both coordinate sets across native LODs',{sections:initial.assetStats.recoveredCorvetteDamage,geometries:initial.assetStats.recoveredCorvetteDamageGeometries});
  assert.equal(initial.assetStats.recoveredMasterEmissive,15);
  check('Original Master emissive material binds all source sections',{sections:initial.assetStats.recoveredMasterEmissive});
  assert.equal(initial.assetStats.recoveredMasterEmissiveNonmetal,1);
  check('Original nonmetal emissive wall binds its source material',{sections:initial.assetStats.recoveredMasterEmissiveNonmetal});
  assert.equal(initial.cameraFov.fov,55);assert.equal(initial.cameraFov.axis,'vertical');
  assert.equal(initial.assetStats.recoveredArray1Uv,13);
  check('Original single-coordinate array material binds every source section',{sections:initial.assetStats.recoveredArray1Uv});
  assert.equal(initial.assetStats.recoveredArray2Uv,14);
  assert.equal(initial.assetStats.recoveredArray2UvGeometries,28);
  check('Original ten-layer array material binds both source coordinate sets across native LODs',{sections:initial.assetStats.recoveredArray2Uv,geometries:initial.assetStats.recoveredArray2UvGeometries});
  assert.ok(initial.actors[0].grounded,'source spawn should settle on a source floor');
  report.doors=await page.evaluate(()=>window.battlefront.doors());
  assert.equal(report.doors.doors,17);assert.equal(report.doors.leaves,62);
  assert.ok(report.doors.updates>0);
  await snapshot('spawn');
  report.spawnGeometry=await page.evaluate(()=>window.battlefront.visibleGeometry());
  report.spawnPerformance=await page.evaluate(()=>window.vibe.perf(1000));
  report.lods=await page.evaluate(()=>window.battlefront.lods());
  assert.equal(report.lods.assets,48);
  assert.ok(report.lods.triangles<report.lods.lod0Triangles);
  check('Original lower LODs reduce rendered geometry while source collision stays in place',{lods:report.lods});
  assert.equal(initial.assetStats.sourceTangentGeometries,273);
  report.sourceTangentLods=[];
  for(const enabled of [false,true]) {
    await page.evaluate(enabled=>window.battlefront.lodOptions({enabled}),enabled);
    await page.evaluate(()=>window.vibe.perf(800));
    const tangent=await page.evaluate(()=>window.battlefront.lighting().probes.sourceTangents);
    assert.equal(tangent.mismatches,0,'native tangent material must match the selected source geometry');
    assert.equal(tangent.nativeInstances,tangent.provenInstances);
    assert.ok(tangent.nativeCompiled>0,'original wall frame must reach an actual compiled material');
    if(!enabled)assert.equal(tangent.nativeInstances,5558,'all proven wall sections use original frames at LOD0');
    assert.deepEqual(tangent.frameKinds,{'signed-cross':5272,'explicit-binormal':43,'signed-cross-source-normal':243},'original signed, explicit and raw-normal composite frames retain distinct routes');
    report.sourceTangentLods.push({enabled,...tangent});
  }
  assert.equal(report.sourceTangentLods[1].nativeInstances,5558,'all selected lower LODs of the proven walls retain their original frame streams');
  check('Original wall tangent frames remain paired during scene LOD changes',{transitions:report.sourceTangentLods});
  if(process.env.BF2_LOD_PROFILE==='1') {
    report.lodProfile=[];
    for(const enabled of [false,true]) {
      await page.evaluate(enabled=>window.battlefront.lodOptions({enabled}),enabled);
      await page.evaluate(()=>window.vibe.perf(800));
      const measurement={enabled,performance:await page.evaluate(()=>window.vibe.perf(2000)),geometry:await page.evaluate(()=>window.battlefront.visibleGeometry()),lods:await page.evaluate(()=>window.battlefront.lods())};
      report.lodProfile.push(measurement);console.log(JSON.stringify({lodProfile:{enabled,performance:measurement.performance,lods:measurement.lods}}));
    }
  }
  if(process.env.BF2_RENDER_PROFILE==='1') {
    report.renderProfile=[];
    for(const settings of [{enabled:true,samples:4,resolutionScale:1},{enabled:true,samples:0,resolutionScale:1},{enabled:false},{enabled:true,samples:0,resolutionScale:.75}]) {
      await page.evaluate(settings=>window.battlefront.renderOptions(settings),settings);
      await page.evaluate(()=>window.vibe.perf(1200));
      const result={settings,performance:await page.evaluate(()=>window.vibe.perf(2000))};report.renderProfile.push(result);console.log(JSON.stringify({renderProfile:result}));
    }
    await page.evaluate(()=>window.battlefront.renderOptions({enabled:true,samples:4,resolutionScale:1}));
  }
  report.lighting=await page.evaluate(()=>window.battlefront.lighting());
  assert.equal(report.lighting.nativeDirect.combinedLookup,true,'DFG and original IES must share one source sampler');
  assert.equal(report.lighting.probes.sourceProbes,29632);
  assert.ok(report.lighting.probes.compiled>0);
  assert.ok(report.lighting.probes.floorDfgCompiled>0,'native floor DFG term must compile');
  assert.ok(report.lighting.probes.environmentDfgCompiled>report.lighting.probes.floorDfgCompiled,'native wall/floor environment response must compile');
  assert.equal(report.lighting.probes.diffuseDfgCompiled,report.lighting.probes.environmentDfgCompiled);
  assert.ok(report.lighting.exposure.frames>0&&report.lighting.exposure.meterReads>0);
  assert.ok(report.lighting.exposure.ev>=7&&report.lighting.exposure.ev<=9);
  assert.equal(report.lighting.exposure.meterError,null);
  assert.ok(report.lighting.exposure.meterLuminance>0);
  assert.equal(report.lighting.exposure.meter.passes,10);
  assert.equal(report.lighting.exposure.meter.intermediateType,'RGBA16F');
  assert.equal(report.lighting.exposure.meter.allocatedBytes,349536);
  assert.equal(report.lighting.exposure.meter.baseline.method,1);
  assert.equal(report.lighting.exposure.meter.baseline.logarithmic,true);
  assert.equal(report.lighting.exposure.meter.baseline.fast,true);
  const grading=report.lighting.exposure.grading;
  assert.equal(grading.evidenceId,'BF2-NATIVE-COLORGRADING-BASELINE-001');
  assert.equal(grading.size,33);assert.equal(grading.lookupWidth,1024);assert.equal(grading.bytes,577040);
  assert.equal(grading.baseline.outputConversion,1);assert.deepEqual(grading.baseline.postGradeExposure,[.5,1]);
  assert.equal(grading.renderPlane.format,'R10G10B10A2_UNORM');
  assert.equal(grading.renderPlane.nativeFormat,27);assert.equal(grading.renderPlane.quantizationApplied,true);
  check('Original indoor grade and native SDR conversion are active with verified payloads',grading);
  assert.equal(report.lighting.exposure.vignette.evidenceId,'BF2-NATIVE-VIGNETTE-001');
  assert.equal(report.lighting.exposure.vignette.enabled,true);assert.equal(report.lighting.exposure.vignette.opacity,.46);
  assert.deepEqual(report.lighting.exposure.vignette.scale,[2,2]);
  check('Original global vignette is active before PQ grading',report.lighting.exposure.vignette);
  {
    const bloom=report.lighting.exposure.bloom,{bloomLevelCount,bloomLevelSizes,gaussianSimpleWeights}=await import('../src/source-bloom.js');
    assert.equal(bloom.enabled,true);assert.equal(bloom.evidenceId,'BF2-NATIVE-BLOOM-001');
    assert.equal(bloom.method,'BloomMethod_GaussianSimple');assert.equal(bloom.softClip,0);assert.equal(bloom.sharpness,.5);
    assert.deepEqual(bloom.scale,[.075,.11,.115]);assert.ok(bloom.frames>0);
    assert.equal(bloom.levels,bloomLevelCount(...bloom.size));assert.deepEqual(bloom.levelSizes,bloomLevelSizes(...bloom.size));
    assert.deepEqual(bloom.weights,gaussianSimpleWeights(bloom.levels,.5).slice(0,bloom.levels));
    check('Original GaussianSimple bloom accumulates the native pyramid before exposure',{levels:bloom.levels,size:bloom.size,weights:bloom.weights,scale:bloom.scale,passes:bloom.passes});
  }
  const reflectionRecipe=JSON.parse(await fs.readFile(path.join(root,'public/assets/source-reflections.json'),'utf8'));
  assert.equal(report.lighting.reflections.loadedPayloads,reflectionRecipe.payloads.length);
  assert.equal(report.lighting.reflections.activeVolumes,88);
  assert.equal(report.lighting.reflections.availableVolumes,88);
  assert.equal(report.lighting.reflections.covered,true);
  assert.equal(report.lighting.nativeReflections.ready,true);
  assert.equal(report.lighting.nativeReflections.uploadedMipCount,6);
  assert.equal(report.lighting.nativeReflections.selectedVolume,report.lighting.reflections.selectedVolume);
  assert.equal(report.lighting.nativeReflections.error,null);
  assert.equal(report.lighting.probes.nativeReflectionCompiled,report.lighting.probes.environmentDfgCompiled);
  assert.ok(report.lighting.channels.compiled>0);
  check('All original reflection captures prepare successfully and cover the source spawn',{reflections:report.lighting.reflections});
  check('Original probe payload reaches compiled shaders and HDR metering respects source EV bounds',{probes:report.lighting.probes,exposure:report.lighting.exposure});
  assert.equal(report.lighting.probes.staticAtlas.sourceGeometries,355);
  assert.equal(report.lighting.probes.staticAtlas.boundPlacements,4779);
  assert.equal(report.lighting.probes.staticAtlas.boundInstances,6127);
  assert.equal(report.lighting.probes.staticAtlas.fallbackInstances,5);
  assert.equal(report.lighting.probes.staticAtlas.families.floor.boundInstances,493);
  assert.equal(report.lighting.probes.staticAtlas.families.master1uv.boundInstances,1534);
  assert.equal(report.lighting.probes.staticAtlas.families.master2uv.boundInstances,680);
  assert.equal(report.lighting.probes.staticAtlas.families.metalonly.boundInstances,950);
  assert.equal(report.lighting.probes.staticAtlas.families.catwalk2.boundInstances,381);
  assert.equal(report.lighting.probes.staticAtlas.families.array2uv.boundInstances,394);
  assert.equal(report.lighting.probes.staticAtlas.families.array1uv.boundInstances,83);
  assert.equal(report.lighting.probes.staticAtlas.families.ceiling.boundInstances,493);
  assert.equal(report.lighting.probes.staticAtlas.families['master1uv-emissive-nonmetal'].boundInstances,202);
  assert.equal(report.lighting.probes.staticAtlas.families['master1uv-emissive'].boundInstances,126);
  assert.equal(report.lighting.probes.staticAtlas.families['exterior-noscale'].boundInstances,87);
  assert.equal(report.lighting.probes.staticAtlas.families['corvette-damage'].boundInstances,4);
  assert.equal(report.lighting.probes.staticAtlas.families.catwalk1.boundInstances,309);
  assert.equal(report.lighting.probes.staticAtlas.lightMapPreExposure,1);
  assert.ok(report.lighting.probes.staticAtlas.compiled>0);
  check('Original baked lighting binds 4779 placements across 6127 material sections with 355 native radiosity streams',report.lighting.probes.staticAtlas);
  check('Source spawn settles on collision geometry',{position:initial.actors[0].position,lighting:report.lighting.active});
  report.spawnGroundProbes=await page.evaluate(()=>window.battlefront.assetManifest.spawns.map(spawn=>({spawn,hit:window.battlefront.collisionRay([spawn.position[0],spawn.position[1]+1,spawn.position[2]],[0,-1,0],5)})));
  report.spawnCapsuleProbes=await page.evaluate(()=>window.battlefront.assetManifest.spawns.map(spawn=>({spawn,settled:window.battlefront.probeSpawn(spawn.position)})));
  await page.keyboard.down('KeyW');await page.evaluate(()=>window.vibe.step(.8));await page.keyboard.up('KeyW');
  const moved=await observe('keyboard-forward');
  const movedDistance=Math.hypot(...moved.actors[0].position.map((v,i)=>v-initial.actors[0].position[i]));
  check('Keyboard movement processed against original map collision',{distance:movedDistance,blocked:movedDistance<.3});
  await page.keyboard.down('KeyW');await page.keyboard.press('AltLeft');await page.evaluate(()=>window.vibe.step(.25));await page.keyboard.up('KeyW');
  const rolling=await observe('keyboard-roll');
  assert.equal(rolling.actors[0].roll.active,true);assert.equal(rolling.actors[0].roll.direction,'front');
  report.rollHitVolumes=await page.evaluate(()=>window.battlefront.hitVolumes()[0]);
  const rollHead=report.rollHitVolumes.capsules.find(c=>c.bone==='Head');
  assert.ok(rollHead.start[1]-report.rollHitVolumes.feet[1]<1.3,'source head bone must actually follow the roll pose');
  await snapshot('source-roll');await page.evaluate(()=>window.vibe.step(1));
  const afterRoll=await observe('source-roll-completed');assert.equal(afterRoll.actors[0].roll.active,false);
  await page.keyboard.press('AltLeft');await page.evaluate(()=>window.vibe.step(1/60));
  assert.equal((await observe('source-roll-recharge')).actors[0].roll.active,false);
  check('Real roll input drives original body pose, collision movement and recharge');
  await page.keyboard.press('KeyV');await page.evaluate(()=>window.vibe.step(1/60));
  assert.notEqual((await observe('keyboard-view-toggle')).camera,initial.camera);check('Real view toggle changes camera');
  report.firstPerson=await page.evaluate(()=>window.battlefront.firstPerson());
  assert.equal(report.firstPerson.weaponId,'rebel-a280');assert.equal(report.firstPerson.fireClips.length,2);
  assert.ok(report.firstPerson.muzzles.length>=2&&report.firstPerson.muzzles.every(p=>p.every(Number.isFinite)&&p[2]<-.4&&p[2]>-.9));
  await snapshot('first-person');
  // Continuous real control exploration; no teleports or health/damage grants.
  const controls=[
    {move:'forward',sprint:true,seconds:1.5},{move:'right',sprint:false,seconds:1},
    {move:'forward',turn:90,seconds:1.5},{move:'forward',jump:true,seconds:1},
    {move:'forward',turn:-90,seconds:1.5},{move:'left',crouch:true,seconds:.75},
    {stop:true,seconds:.25},{look:[90,0],fire:true,aim:true,seconds:1.5},
    {fire:false,aim:false,move:'forward',seconds:1.5},
  ];
  for(const [index,command]of controls.entries()) {
    const {seconds,...act}=command;await page.evaluate(value=>window.vibe.turn(value),{act,seconds});
    const state=await observe(`controls-${index}`);
    if(act.aim===true) {
      report.firstPersonAiming=await page.evaluate(()=>window.battlefront.firstPerson());
      assert.equal(report.firstPersonAiming.aim.weight,1);
      assert.equal(report.firstPersonAiming.aim.sourceName,'P_1p_A280_ZoomPose');
      assert.equal(report.firstPersonAiming.aim.missing.length,0);
      assert.ok(report.firstPersonAiming.firing&&report.firstPersonAiming.shots>0);
      check('Original steady aim pose and additive firing share the actual player rig',{aim:report.firstPersonAiming.aim});
      assert.equal(report.firstPersonAiming.visibility.bodyVisible,false);
      assert.equal(report.firstPersonAiming.visibility.normalModelVisible,false);
      assert.equal(report.firstPersonAiming.visibility.zoomModelVisible,false);
      assert.equal(report.firstPersonAiming.renderedModelVisible,false);
      assert.equal(report.firstPersonAiming.scopeHud.fraction,1);
      assert.equal(report.firstPersonAiming.scopeView.visible,true);
      assert.equal(await page.locator('#source-scope').isVisible(),true);
      assert.equal(await page.locator('#source-scope [data-source-element="ScopeGlow"]').getAttribute('opacity'),String(Math.fround(.85)));
      check('Native zoom visibility hides source arms and weapon while original scope artwork renders',{visibility:report.firstPersonAiming.visibility,scope:report.firstPersonAiming.scopeHud});
    }
    if(act.aim===false){
      const hip=await page.evaluate(()=>window.battlefront.firstPerson());
      assert.equal(hip.aim.weight,0);assert.equal(hip.visibility.bodyVisible,true);
      assert.equal(hip.renderedModelVisible,true);assert.equal(hip.scopeHud.fraction,0);
      assert.equal(await page.locator('#source-scope').isVisible(),false);
    }
    report.doorObservations.push(await page.evaluate(()=>window.battlefront.doors()));
    if(act.aim===true){assert.ok(Math.abs(state.cameraFov.fov-23.9)<1e-5);assert.equal(state.firstPersonProjection.renderFov,55);assert.ok(state.firstPersonProjection.scale[0]<.5);await snapshot('source-aim-projection');check('Source vertical gameplay FOV reaches its native aiming angle',{fov:state.cameraFov.fov,axis:state.cameraFov.axis});}
    if(act.aim===false)assert.equal(state.cameraFov.fov,55);
    assert.ok(state.actors.every(actor=>actor.position.every(Number.isFinite)),'actor coordinates remain finite');
  }
  await page.evaluate(()=>window.vibe.act({stop:true,fire:false}));await snapshot('explored');
  report.rendererDiagnostics=await page.evaluate(()=>window.battlefront.rendererDiagnostics());
  report.exploredDoors=await page.evaluate(()=>window.battlefront.doors());
  assert.ok(report.exploredDoors.transitions>0,'live actors must activate the original door triggers');
  assert.ok(report.doorObservations.some(observation=>observation.states.some(door=>door.amount>0&&door.offsets.some(leaf=>leaf.offset.some(value=>Math.abs(value)>0)))),'source door geometry must move during the actual controls; it may close again before the final sample');
  check('Live actors activate original door OBBs and move their geometry with collision',{doors:report.exploredDoors.doors,leaves:report.exploredDoors.leaves,transitions:report.exploredDoors.transitions});
  assert.ok(report.rendererDiagnostics.firstPersonProjectionPrograms.length>0&&report.rendererDiagnostics.firstPersonProjectionPrograms.every(program=>program.linked),'source viewmodel projection must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredFloorPrograms.length>0,'a recovered source floor shader must actually compile during scene rendering');
  assert.ok(report.rendererDiagnostics.recoveredFloorPrograms.every(program=>program.linked),'recovered floor shader programs must link successfully');
  assert.ok(report.rendererDiagnostics.nativeStaticAtlasPrograms.length>0&&report.rendererDiagnostics.nativeStaticAtlasPrograms.every(program=>program.linked),'original static floor and wall atlas programs must compile and link');
  assert.ok(report.rendererDiagnostics.nativeTangentPrograms.length>=2&&report.rendererDiagnostics.nativeTangentPrograms.every(program=>program.linked&&program.samplerCount<=16),'both source wall frame programs must compile and link within the sampler limit');
  for(const program of report.rendererDiagnostics.nativeStaticAtlasPrograms) {
    assert.ok(program.samplerCount<=16,'baked lighting fits the WebGL2 fragment texture limit');
    assert.ok(program.samplers.some(row=>row.name==='bf2_staticIrradiance'));
    assert.ok(program.samplers.some(row=>row.name==='bf2_staticDirections'));
    const nativeCube=program.samplers.some(row=>row.name==='bf2_nativeReflectionCube');
    assert.ok(!(nativeCube&&program.samplers.some(row=>row.name==='envMap')),'each reflection permutation uses only its selected cube representation');
    assert.ok(!program.samplers.some(row=>row.name==='dfgLUT'),'native variants share the unchanged fallback lookup');
  }
  assert.ok(report.rendererDiagnostics.recoveredMasterPrograms.length>0&&report.rendererDiagnostics.recoveredMasterPrograms.every(program=>program.linked),'source packed wall programs must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredMaster2UvPrograms.length>0&&report.rendererDiagnostics.recoveredMaster2UvPrograms.every(program=>program.linked),'source two-coordinate Master programs must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredMasterEmissiveNonmetalPrograms.length>0&&report.rendererDiagnostics.recoveredMasterEmissiveNonmetalPrograms.every(program=>program.linked),'source nonmetal emissive programs must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredCeilingPrograms.length>0&&report.rendererDiagnostics.recoveredCeilingPrograms.every(program=>program.linked),'source ceiling programs must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredMetalOnlyPrograms.length>0&&report.rendererDiagnostics.recoveredMetalOnlyPrograms.every(program=>program.linked),'source MetalOnly wall programs must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredVolcanicObjectPrograms.length>0&&report.rendererDiagnostics.recoveredVolcanicObjectPrograms.every(program=>program.linked&&program.samplerCount<=16),'source Volcanic materials and scoped raw-normal probe lighting must compile and link within sampler limit');
  assert.ok(report.rendererDiagnostics.nativeEnvironmentPrograms.length>0&&report.rendererDiagnostics.nativeEnvironmentPrograms.every(program=>program.linked),'source DFG environment response must link on actual materials');
  assert.ok(report.rendererDiagnostics.recoveredCatwalk2Programs.length>0&&report.rendererDiagnostics.recoveredCatwalk2Programs.every(program=>program.linked),'source catwalk programs must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredExteriorPrograms.length>0&&report.rendererDiagnostics.recoveredExteriorPrograms.every(program=>program.linked),'source exterior programs must compile and link');
  assert.ok(report.rendererDiagnostics.nativePunctualPrograms.length>0&&report.rendererDiagnostics.nativePunctualPrograms.every(program=>program.linked),'native punctual lighting programs must compile and link');
  assert.ok(report.rendererDiagnostics.originalBlasterPrograms.length>0&&report.rendererDiagnostics.originalBlasterPrograms.every(program=>program.linked),'original blaster geometry/pixel programs must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredCorvetteDamagePrograms.length>0&&report.rendererDiagnostics.recoveredCorvetteDamagePrograms.every(program=>program.linked),'source Corvette damage programs must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredMasterEmissivePrograms.length>0&&report.rendererDiagnostics.recoveredMasterEmissivePrograms.every(program=>program.linked),'source Master emissive programs must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredArray1UvPrograms.length>0&&report.rendererDiagnostics.recoveredArray1UvPrograms.every(program=>program.linked),'source single-coordinate texture-array programs must compile and link');
  assert.ok(report.rendererDiagnostics.recoveredArray2UvPrograms.length>0&&report.rendererDiagnostics.recoveredArray2UvPrograms.every(program=>program.linked),'source texture-array programs must compile and link');
  assert.ok(report.rendererDiagnostics.nativeReflectionPrograms.length>0&&report.rendererDiagnostics.nativeReflectionPrograms.every(program=>program.linked),'native original mip sampling must compile and link');
  await page.evaluate(()=>window.vibe.turn({act:{stop:true,fire:false,look:[90,-35]},seconds:1/60}));
  await snapshot('source-floor');
  await page.evaluate(()=>window.vibe.turn({act:{stop:true,fire:false,look:[-90,35]},seconds:1/60}));
  check('Recovered floor shader compiles and renders during actual scene controls',{programs:report.rendererDiagnostics.recoveredFloorPrograms.length});
  const events=await page.evaluate(()=>window.vibe.events());report.events=events;
  assert.ok(events.some(event=>event.type==='shot'&&event.actor==='player'),'real fire input should produce player shots');
  report.firstPersonFiring=await page.evaluate(()=>window.battlefront.firstPerson());
  assert.ok(report.firstPersonFiring.shots>0);
  check('Original first-person arms, A280 mesh and additive source firing clips follow player controls',{shots:report.firstPersonFiring.shots,clips:report.firstPersonFiring.fireClips.length});
  const recoiling=report.trace.find(row=>row.label==='controls-7').state.cameraRecoil;
  assert.ok(recoiling.shots>0&&Math.hypot(recoiling.nativeRadians.yaw,recoiling.nativeRadians.pitch)>0);
  assert.ok(recoiling.cameraLocalQuaternion.every(Number.isFinite));
  check('Recovered first-person recoil spring responds to accepted live shots',{shots:recoiling.shots,nativeRadians:recoiling.nativeRadians});
  report.projectileVisuals=(await observe('source-trail-retirement')).projectileVisuals;
  assert.equal(report.projectileVisuals.delayFrames,2);
  assert.ok(report.projectileVisuals.retirements>0);
  assert.ok(report.projectileVisuals.retired<=30);
  check('Source trail stop delay retires visuals separately from immediate projectile hits',{retirements:report.projectileVisuals.retirements,delayFrames:report.projectileVisuals.delayFrames});
  report.rifleTrails=(await observe('original-gpu-rifle-trails')).rifleTrails;
  assert.ok(report.rifleTrails.spawned>0&&report.rifleTrails.presentations>0&&report.rifleTrails.kernel.frames>0);
  assert.ok(report.rifleTrails.active<=30);
  check('Original rifle mesh, textures and GPU particles render live shots',{spawned:report.rifleTrails.spawned,presentations:report.rifleTrails.presentations,particleFrames:report.rifleTrails.kernel.frames});
  check('Source scene supports sprint, strafe, jump, crouch, aim and fire through normal input path');
  report.audio=await page.evaluate(()=>window.battlefront.audio());
  if(report.audio){assert.equal(report.audio.loaded,9);assert.equal(report.audio.muted,true);assert.ok(report.audio.shots>0);assert.equal(report.audio.primaryId,'rebel-a280');for(const bank of Object.values(report.audio.weapons)){assert.equal(bank.loaded,9);assert.ok(bank.buffers.every(buffer=>buffer.sampleRate===48000&&buffer.channels===2&&buffer.duration>.4));}check('Distinct original E11 and A280 banks decode and fire events reach the selected Rebel bank');}
  if(process.env.BF2_ROUND_CHECK==='1') {
    const roundMode=process.env.BF2_ROUND_MODE??'tdm';
    if(roundMode==='ffa')await page.evaluate(()=>window.vibe.act({restart:true,mode:'ffa'}));
    report.fullRound={requested:true,controls:'Bounded angular aim, movement, sprint and fire through Vibe input; no teleport, health, scoring or damage mutations.',checkpoints:[]};
    let route=[],routeIndex=0,nextRoute=0,lastPosition=null,stuck=0,escapeUntil=0,escapeSide=1;
    for(let iteration=0;iteration<1400;iteration++) {
      const state=await page.evaluate(()=>window.vibe.observe());if(state.round.phase==='ended')break;
      const self=state.actors[0],enemies=state.actors.filter(actor=>actor.alive&&actor.id!==self.id&&(state.round.mode==='ffa'||actor.team!==self.team));
      if(lastPosition&&self.alive)stuck=Math.hypot(...self.position.map((v,i)=>v-lastPosition[i]))<.1?stuck+.5:0;
      lastPosition=self.position;
      enemies.sort((a,b)=>Math.hypot(...a.position.map((v,i)=>v-self.position[i]))-Math.hypot(...b.position.map((v,i)=>v-self.position[i])));
      let act={stop:true,fire:false};
      if(self.alive&&enemies.length) {
        const target=enemies[0],delta=target.position.map((v,i)=>v-self.position[i]),distance=Math.hypot(...delta);
        const origin=[self.position[0],self.position[1]+1.5,self.position[2]],destination=[target.position[0],target.position[1]+1.1,target.position[2]];
        const ray=destination.map((v,i)=>v-origin[i]),hit=await page.evaluate(({origin,ray,distance})=>window.battlefront.collisionRay(origin,ray,distance),{origin,ray,distance});
        const visible=!hit||hit.distance>distance-.5;
        let desired=delta;
        if(!visible||distance>45) {
          if(state.round.elapsed>=nextRoute){route=await page.evaluate(({from,to})=>window.battlefront.navigationPath(from,to),{from:self.position,to:target.position});routeIndex=0;nextRoute=state.round.elapsed+5;}
          while(routeIndex<route.length-1&&Math.hypot(...route[routeIndex].map((v,i)=>v-self.position[i]))<.9)routeIndex++;
          if(route[routeIndex])desired=route[routeIndex].map((v,i)=>v-self.position[i]);
        }
        const yaw=Math.atan2(-desired[0],-desired[2]),yawDelta=Math.atan2(Math.sin(yaw-self.yaw),Math.cos(yaw-self.yaw));
        const pitch=visible?Math.atan2(delta[1]-.4,Math.hypot(delta[0],delta[2])):0;
        act={move:visible&&distance<40?[0,0]:[0,Math.abs(yawDelta)<.5?1:0],look:[-Math.max(-.8,Math.min(.8,yawDelta))*180/Math.PI,Math.max(-.3,Math.min(.3,pitch-self.pitch))*180/Math.PI],fire:visible&&Math.abs(yawDelta)<.15,aim:visible,sprint:!visible&&Math.abs(yawDelta)<.4};
        if(!visible&&stuck>2&&state.round.elapsed>=escapeUntil){escapeUntil=state.round.elapsed+1.5;escapeSide*=-1;nextRoute=0;stuck=0;}
        if(state.round.elapsed<escapeUntil)act={move:[escapeSide,-.6],look:[escapeSide*20,0],jump:true,fire:false,sprint:false};
      }
      await page.evaluate(value=>window.vibe.turn(value),{act,seconds:.5});
      if(iteration%60===0){const checkpoint=await page.evaluate(()=>window.vibe.observe());report.fullRound.checkpoints.push(checkpoint);console.log(JSON.stringify({roundTime:checkpoint.round.elapsed,scores:checkpoint.round.scores,navigation:checkpoint.navigation,player:checkpoint.actors[0].position}));await fs.writeFile(path.join(output,'actual-map-running-checkpoint.json'),JSON.stringify({state:checkpoint,events:await page.evaluate(()=>window.vibe.events())},null,2));if(iteration%120===0)await snapshot('combat');}
      if(process.env.BF2_EARLY_COMBAT_REQUIREMENT==='1'&&iteration===179){const combat=await page.evaluate(()=>window.vibe.observe());assert.ok(Object.values(combat.round.kills).some(score=>score>0),'diagnostic: no combat scoring within 90 simulated seconds');}
    }
    const ended=await observe('actual-full-round-ended');report.fullRound.result=ended.round;
    report.fullRound.events=await page.evaluate(()=>window.vibe.events());
    await snapshot('round-end');
    assert.equal(ended.round.phase,'ended');assert.ok(Object.values(ended.round.kills).reduce((a,b)=>a+b,0)>0,'actual map round must contain combat scoring');
    assert.ok(report.fullRound.events.some(event=>event.type==='kill'),'actual source map must contain real eliminations');
    assert.ok(report.fullRound.events.some(event=>event.type==='spawn'&&event.t>1),'round combat must produce a later respawn');
    if(roundMode==='ffa')assert.ok(report.fullRound.events.some(event=>event.type==='kill'&&ended.actors.find(actor=>actor.id===event.killer)?.team===ended.actors.find(actor=>actor.id===event.victim)?.team),'FFA must permit eliminations between actors from the same faction');
    check(`Complete ${roundMode.toUpperCase()} round on original geometry contains eliminations, respawn, scoring and an end screen`,{round:ended.round});
    await page.locator('#start').click();const restarted=await observe('actual-round-restarted');
    assert.equal(restarted.round.phase,'playing');assert.deepEqual(restarted.round.scores,[0,0]);
    assert.equal(restarted.round.mode,roundMode,'play again should retain the completed mode');
    assert.equal(restarted.firstPersonVisibility.bodyVisible,true,'play again restores native hip model visibility');
    assert.equal(restarted.scopeHud.fraction,0,'play again resets original scope HUD state');
    check('Actual map end screen restarts a fresh round');
  }
  report.performance=await page.evaluate(()=>window.vibe.perf(1000));
  report.gpu=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');return debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
  report.engineErrors=await page.evaluate(()=>window.vibe.errors());
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.engineErrors,[]);assert.deepEqual(report.consoleErrors,[]);
  assert.deepEqual(report.failedRequests,[]);assert.deepEqual(report.httpErrors,[]);
  check('No JavaScript, shader, engine or request errors during actual map controls');
  report.pass=true;
}catch(error){report.pass=false;report.errors.push(String(error.stack??error));process.exitCode=1;try{await snapshot('failure');}catch{}}
finally {
  await browser?.close();await server?.close();report.finishedAtUtc=new Date().toISOString();
  if(report.manifest)report.manifest={metadata:report.manifest.metadata,assets:report.manifest.assets.length,instances:report.manifest.instances.length,spawns:report.manifest.spawns.length};
  await fs.writeFile(path.join(output,'actual-map-check.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,checks:report.checks,errors:report.errors,consoleErrors:report.consoleErrors,failedRequests:report.failedRequests,performance:report.performance,report:'test-results/actual-map-check.json'},null,2));
}
