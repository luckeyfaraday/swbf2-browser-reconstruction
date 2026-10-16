import * as THREE from 'three';
import { createGame } from '../vendor/vibe-engine/core/engine.js';
import { loadAssets } from './assets.js';
import { BattleRuntime } from './game.js';
import { createLighting } from './lighting.js';
import {packSourceIesIntoDfg,packThreeDfgIntoSourceLookup} from './source-dfg.js';
import { loadWeaponAudio } from './audio.js';
import { createSourceExposure } from './source-exposure.js';
import { prepareNativeGrading } from './source-colorgrading-renderer.js';
import {prepareSourceReflections} from './source-reflections.js';
import {prepareSourceReflectionSampling} from './source-reflection-sampling.js';
import {prepareVisibleShaders,prepareAllShaders,prepareAllTextures} from './prepare-shaders.js';
import {loadSourceIes} from './source-ies.js';
import {createScopeHudView} from './scope-hud.js';
import {installProgramSort} from './program-sort.js';
import {loadShadowCasterCatalog,createSourceShadowAtlas} from './source-shadow-atlas.js';
import {createAdaptiveResolution} from './adaptive-resolution.js';
import './style.css';

const $=id=>document.getElementById(id),canvas=$('game'),screen=$('screen');
let runtime,engine,gameAudio,scopeView,resumeOnly=false;
const params=new URLSearchParams(location.search);
// The actual map renders through a multisampled HDR target and only a full-screen
// quad reaches the canvas, so canvas MSAA is pure cost. Fixture scenes draw directly.
const renderer=new THREE.WebGLRenderer({canvas,antialias:params.get('fixture')==='1',powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const programSort=params.get('programSort')==='0'?null:installProgramSort(renderer);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x080b12);
// The scene root never moves; leaving it on auto-update forces every world matrix
// in the tree to be recomputed each frame.
scene.matrixAutoUpdate=false;
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.06,1500);scene.add(camera);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();$('screen-message').textContent='Graphics context lost. Reload to restore the map.';screen.hidden=false;$('retry').hidden=false;});

const ui={
  update(game) {
    const p=game.player,r=game.round,seconds=Math.max(0,Math.ceil(r.duration-r.elapsed));
    scopeView?.update(game.scopeHud?.snapshot(),{enabled:p.alive&&!game.viewThirdPerson&&r.phase==='playing'});
    $('score-blue').textContent=r.mode==='tdm'?r.scores[0]:(r.kills.player??0);
    $('score-red').textContent=r.mode==='tdm'?r.scores[1]:Math.max(0,...Object.entries(r.kills).filter(([id])=>id!=='player').map(([,n])=>n));
    $('mode-name').textContent=r.mode==='tdm'?'BLAST':'FREE FOR ALL';$('timer').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    $('health-fill').style.width=`${p.health/game.config.player.health*100}%`;$('health-label').textContent=Math.ceil(p.health);
    const heat=p.weaponHeat,cooling=heat&&['venting','overheated'].includes(heat.phase),boost=heat?.boostRemaining>0;
    $('heat-fill').style.width=`${p.heat*100}%`;$('heat-fill').style.background=boost?'#66caff':p.overheat>0?'#ff624c':'#e4d09b';
    $('heat-label').textContent=heat?(boost?`SUPER COOLING · ${heat.boostRemaining.toFixed(1)}s`:cooling?(heat.activeAttempted?'COOLING':`${heat.phase==='overheated'?'OVERHEATED':'COOLING'} · R IN THE MARKED ZONE`):heat.phase==='exiting'?'RECOVERING':'BLASTER HEAT · R VENT'):(p.overheat>0?'OVERHEATED':'BLASTER HEAT');
    $('cooling-zones').hidden=!cooling||heat.activeAttempted;
    if(cooling)for(const [id,window]of [['cooling-success',p.weapon.sourceHeat.successWindow],['cooling-super',p.weapon.sourceHeat.superWindow]]){const zone=$(id);zone.style.left=`${Math.min(...window)*100}%`;zone.style.width=`${Math.abs(window[0]-window[1])*100}%`;}
    $('weapon-name').textContent=p.weapon.name;
    $('damage-vignette').style.opacity=game.damageFlash*.6;$('hitmarker').hidden=game.hitFlash<=0;
    $('notice').textContent=!p.alive&&r.phase==='playing'?`ELIMINATED\nRedeploying in ${Math.ceil(p.respawnIn)}…`:'';
    $('feed').replaceChildren(...game.feed.filter(item=>game.ctx.time-item.time<7).map(item=>{const row=document.createElement('div');row.textContent=item.text;return row;}));
  },
  end(round,player) {
    const won=round.mode==='tdm'?round.winner===player.team:round.winner===player.id;
    $('mode').value=round.mode;
    $('screen-message').textContent=round.winner===null?'DRAW':won?'VICTORY':'DEFEAT';
    $('loading-detail').textContent=round.mode==='tdm'?`${round.scores[0]} — ${round.scores[1]}`:`${round.kills.player??0} eliminations · ${round.deaths.player??0} deaths`;
    $('start').textContent='PLAY AGAIN';$('menu-controls').hidden=false;screen.hidden=false;resumeOnly=false;
  },
};

async function boot() {
  try {
    const bootStart=performance.now(),loadTimings=[];
    let lastStage=bootStart;
    const loaded=stage=>{const now=performance.now();loadTimings.push({stage,milliseconds:Math.round(now-lastStage),elapsed:Math.round(now-bootStart)});lastStage=now;};
    $('retry').hidden=true;
    // Alternate manifests exist for explicit test fixtures only. Production
    // always requests the extracted /assets/map.scene.json contract.
    const manifestUrl=params.get('fixture')==='1'?'/test-fixture/map.scene.json':'/assets/map.scene.json';
    const assets=await loadAssets(progress=>{$('progress').value=progress.fraction*.9;$('loading-detail').textContent=progress.message;},{manifestUrl,batchCellSize:params.has('batchCell')?Number(params.get('batchCell')):undefined});
    loaded('original-assets-and-collision');loadTimings.push(...assets.loadTimings.map(row=>({...row,stage:`assets/${row.stage}`})));
    $('loading-detail').textContent='Loading weapon audio';
    gameAudio=await loadWeaponAudio(assets.audioDocument,assets.weapons,{muted:params.has('agent'),primaryId:assets.teamWeapons?.get(0)??'primary'});
    loaded('weapon-audio');$('progress').value=.93;$('loading-detail').textContent='Preparing original map lighting';
    scene.add(assets.group);
    const sourceIes=assets.sourceProbes?await loadSourceIes():null;
    if(sourceIes&&assets.sourceDfg) {
      const sourceLookup=packSourceIesIntoDfg(assets.sourceDfg.texture,sourceIes.texture);
      const sharedLookup=packThreeDfgIntoSourceLookup(sourceLookup);
      assets.sourceDfg.replaceLookupTexture(sharedLookup);
      sourceIes.combinedDfgTexture=sharedLookup;
    }
    // Native local spot shadows (?shadows=0 disables). Built before the first LOD
    // update so composite fallback casters capture their LOD0 geometry.
    let shadows=null,shadowDoors=[];
    if(assets.sourceProbes&&params.get('shadows')!=='0') {
      const casters=await loadShadowCasterCatalog();
      if(casters) {
        const fallbackIds=new Set(casters.catalog.visibleFallbackAssets.map(row=>row.assetId));
        shadows=createSourceShadowAtlas(renderer,{...casters,manifest:assets.manifest,doorInstances:assets.sourceDoors.instances,
          fallbackBatches:assets.group.children.filter(batch=>batch.isMesh&&fallbackIds.has(batch.userData.assetId)),diagnostic:params.get('shadowDiagnostic')});
        shadowDoors=assets.sourceDoors.group.children.map(root=>{const draw=root.children.find(child=>child.isMesh);
          return draw?{key:root.uuid,root,instance:{assetId:draw.userData.assetId},instanceMatrix:draw.matrix.clone(),source:new THREE.Object3D()}:null;}).filter(Boolean);
      }
    }
    const lighting=createLighting(scene,assets.manifest,assets.sourceLights,{indirectProbes:!!assets.sourceProbes,sourceIes,nativeShadows:shadows});
    let exposure=null;
    if(assets.sourceProbes){
      const [response,gradingResponse]=await Promise.all([fetch('/assets/source-environment.json'),fetch('/assets/lighting/indoor-colorgrading.json')]);
      if(!response.ok||!gradingResponse.ok)throw new Error('Source environment or grading configuration is unavailable');
      const grading=await prepareNativeGrading(await gradingResponse.json());
      exposure=createSourceExposure(renderer,await response.json(),{grading});
    }
    let reflections=null,nativeReflections=null,reflectionVolume,reflectionLoad=Promise.resolve();
    if(assets.sourceProbes){const response=await fetch('/assets/source-reflections.json');if(!response.ok)throw new Error('Source reflections are unavailable');const document=await response.json();reflections=await prepareSourceReflections(renderer,document);nativeReflections=await prepareSourceReflectionSampling(document);assets.sourceProbes.setReflectionSampling(nativeReflections);}
    loaded('map-lighting');$('progress').value=.97;$('loading-detail').textContent='Preparing deployment';
    function updateReflections(position) {
      const volume=reflections?.update(position,scene)??null;
      if(nativeReflections&&volume!==reflectionVolume) {
        reflectionVolume=volume;
        // Serialize downloads and skip stale queued selections. This avoids
        // aborting local asset requests during rapid movement across volumes.
        reflectionLoad=reflectionLoad.then(()=>reflectionVolume===volume?nativeReflections.select(volume):null).catch(error=>console.error('Source reflection selection failed',error));
      }
      return reflectionLoad;
    }
    if(assets.manifest.metadata.background)scene.background=new THREE.Color(assets.manifest.metadata.background);
    if(!exposure&&assets.manifest.metadata.exposure)renderer.toneMappingExposure=assets.manifest.metadata.exposure;
    const bounds=assets.manifest.bounds;camera.far=Math.max(500,new THREE.Vector3(...bounds.max).distanceTo(new THREE.Vector3(...bounds.min))*3);camera.updateProjectionMatrix();
    $('map-name').textContent=assets.manifest.metadata.name.toUpperCase();
    $('mode').value=assets.gameplay.parameters.round.mode;
    $('provenance').textContent=JSON.stringify({map:assets.manifest.metadata,gameplay:assets.gameplay.provenance,characters:assets.characterProvenance,lighting:lighting.provenance},null,2);
    const caveats=[];
    if(!assets.characters.size)caveats.push('Character assets pending · temporary silhouettes.');
    if(params.get('fixture')==='1')caveats.unshift('SYNTHETIC TEST FIXTURE — NOT THE BF2 MAP.');
    // Hybrid laptops: Chrome ignores powerPreference and often renders on the
    // integrated GPU. Name the adapter so a slow session is easy to diagnose.
    const gl=renderer.getContext(),debugInfo=gl.getExtension('WEBGL_debug_renderer_info');
    const rawAdapter=String(gl.getParameter(debugInfo?debugInfo.UNMASKED_RENDERER_WEBGL:gl.RENDERER));
    const adapter=/^ANGLE \([^,]+, (.+?)(?: \(0x[0-9a-f]+\))?(?: Direct3D[^,]*)?(?:, [^,]+)?\)$/i.exec(rawAdapter)?.[1]??rawAdapter;
    // Privacy-hardened browsers (Brave Shields) report a placeholder instead.
    if(/^ANGLE/.test(rawAdapter))caveats.push(`Rendering on ${adapter}.`);
    else caveats.push('GPU name hidden by the browser. If the game is slow, set this browser to High performance in Windows Settings › Display › Graphics, or start it with tools/play.ps1.');
    if(/Radeon\(TM\) Graphics|Intel|UHD|Iris/i.test(adapter))caveats.push('Integrated GPU: start with tools/play.ps1 to use the discrete GPU.');
    $('development-note').textContent=caveats.join(' ');
    if(assets.scopeArtworkDocument)scopeView=createScopeHudView($('source-scope'),assets.scopeArtworkDocument);
    runtime=new BattleRuntime({assets,scene,camera,renderer,ui,audio:gameAudio,exposure});
    // ?res=0.75 pins the HDR render scale; otherwise it adapts to GPU load in normal
    // play. Agent/test runs keep full resolution unless ?adaptive=1.
    const fixedScale=params.has('res')?Number(params.get('res')):null;
    const adaptive=exposure&&fixedScale===null&&(!params.has('agent')||params.get('adaptive')==='1')?createAdaptiveResolution(resolutionScale=>exposure.configure({resolutionScale})):null;
    if(exposure&&fixedScale!==null)exposure.configure({resolutionScale:fixedScale});
    engine=createGame({
      name:`Battlefront II · ${assets.manifest.metadata.name}`,canvas,sensitivity:assets.gameplay.parameters.camera.sensitivity,pauseScreen:false,
      init:async ctx=>{
        runtime.init(ctx);lighting.decorate(scene);
        if(assets.sourceProbes&&params.get('precompile')!=='0') {
          const position=runtime.eye(runtime.player);lighting.update(position);
          await updateReflections(position);assets.lods.update(position);runtime.updateView(0);
          const result=await prepareVisibleShaders(renderer,scene,camera,exposure);
          loadTimings.push({stage:'spawn-shader-preparation',...result});
          await runtime.rifleTrails?.prepare(camera);
          // Then every other program the map can use (all areas, LOD alternatives).
          // A first-use compile blocks the page for seconds on ANGLE/D3D11 and froze
          // the game when players reached areas the spawn view never showed.
          $('loading-detail').textContent='Preparing map shaders';
          const variants=()=>assets.lods.variants?.()??[];
          let full=await prepareAllShaders(renderer,scene,camera,exposure,{variants:variants()});
          const failed=full.failed.map(row=>row.name);
          if(full.failed.length) {
            // A program over the fragment sampler limit draws nothing. Recompile
            // those materials without the shadow atlas rather than lose the surface.
            for(const {material} of full.failed){material.userData.bf2NoShadowReceiver=true;material.needsUpdate=true;}
            full=await prepareAllShaders(renderer,scene,camera,exposure,{variants:variants()});
          }
          await shadows?.prepare?.(runtime.shadowRoots());
          loadTimings.push({stage:'map-shader-preparation',meshes:full.meshes,milliseconds:full.milliseconds,programs:full.programs,failedBeforeRepair:failed,failed:full.failed.map(row=>row.name)});
          loadTimings.push({stage:'map-texture-upload',...prepareAllTextures(renderer,scene,{variants:variants()})});
        }
      },
      start:()=>{screen.hidden=true;$('hud').hidden=false;},
      simulate:(ctx,dt)=>{const started=adaptive?performance.now():0;runtime.simulate(ctx,dt);if(adaptive)adaptive.addWork(performance.now()-started);},
      present:(ctx,dt)=>{const started=performance.now(),position=runtime.eye(runtime.player);lighting.update(position);updateReflections(position);assets.lods.update(position);programSort?.tick();shadows?.update(lighting.spotSlots(),{actors:runtime.actors.map(actor=>({id:actor.id,root:actor.body.root,alive:actor.alive})),doors:shadowDoors,camera});runtime.present(ctx,dt);adaptive?.frame(performance.now()-started);},
      observe:()=>runtime.observe(),digest:()=>runtime.digest(),
      act:(ctx,command)=>{
        const result={};
        if(command.hero!==undefined)result.hero=runtime.setHero(command.hero);
        if(command.restart){runtime.resetRound(command.mode??runtime.round.mode);screen.hidden=true;$('hud').hidden=false;result.restarted=true;}
        if(command.camera){runtime.viewThirdPerson=command.camera==='third-person';result.camera=command.camera;}
        return result;
      },
      view:(_ctx,options)=>{if(options.camera)runtime.viewThirdPerson=options.camera==='third-person';if(options.hud!==undefined)$('hud').hidden=!options.hud;return {camera:runtime.viewThirdPerson?'third-person':'first-person',hud:!$('hud').hidden};},
    });
    await engine.ready;
    await updateReflections(runtime.eye(runtime.player));
    loaded('deployment');
    window.battlefront={
      version:1,status:'ready',assetManifest:assets.manifest,provenance:assets.gameplay.provenance,loadTimings,
      lighting:()=>({...lighting.snapshot(),probes:assets.sourceProbes?.snapshot()??null,exposure:exposure?.snapshot()??null,reflections:reflections?.snapshot()??null,nativeReflections:nativeReflections?.snapshot()??null}),audio:()=>gameAudio?.snapshot()??null,probeSpawn:position=>runtime.probeSpawn(position),
      hitVolumes:()=>runtime.actors.map(actor=>({actor:actor.id,feet:actor.controller.getFeetPosition().toArray(),capsules:actor.body.hitboxes?.capsules.map(c=>({bone:c.source.bone,start:c.start.toArray(),end:c.end.toArray(),radius:c.radius}))??[]})),
      renderOptions:options=>{exposure?.configure(options);return exposure?.snapshot();},
      adaptiveResolution:()=>adaptive?.snapshot()??{enabled:false,fixedScale},
      lodOptions:options=>{assets.lods.configure(options);assets.lods.update(runtime.eye(runtime.player),true);return assets.lods.snapshot();},
      lods:()=>assets.lods.snapshot(),
      doors:()=>assets.sourceDoors.snapshot(),
      firstPerson:()=>runtime.firstPerson?{...runtime.firstPerson.snapshot(),renderedModelVisible:runtime.weaponRoot.visible,visibility:runtime.firstPersonVisibility?.snapshot()??null,scopeHud:runtime.scopeHud?.snapshot()??null,scopeView:scopeView?.snapshot()??null}:null,
      probeRoute:(from,to,options)=>runtime.probeRoute(from,to,options),
      visibleGeometry:()=>{
        camera.updateMatrixWorld();scene.updateMatrixWorld();
        const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)),byAsset=new Map();
        assets.group.traverseVisible(mesh=>{
          if(!mesh.isMesh||(mesh.frustumCulled&&!frustum.intersectsObject(mesh)))return;
          const count=Math.min(mesh.geometry.drawRange.count,(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)-mesh.geometry.drawRange.start),instances=mesh.isInstancedMesh?mesh.count:1;
          const id=mesh.userData.assetId,row=byAsset.get(id)??{id,batches:0,instances:0,triangles:0};
          row.batches++;row.instances+=instances;row.triangles+=count/3*instances;byAsset.set(id,row);
        });
        return {camera:{position:camera.position.toArray(),world:camera.matrixWorld.toArray(),projection:camera.projectionMatrix.toArray()},assets:[...byAsset.values()].sort((a,b)=>b.triangles-a.triangles)};
      },
      rendererDiagnostics:()=>{const gl=renderer.getContext(),programs=(marker,stage='fragmentShader')=>renderer.info.programs.filter(program=>gl.getShaderSource(program[stage])?.includes(marker)).map(program=>{const samplers=[];for(let index=0;index<gl.getProgramParameter(program.program,gl.ACTIVE_UNIFORMS);index++){const uniform=gl.getActiveUniform(program.program,index);if([gl.SAMPLER_2D,gl.SAMPLER_CUBE,gl.SAMPLER_2D_ARRAY,gl.SAMPLER_3D].includes(uniform.type))samplers.push({name:uniform.name,count:uniform.size});}return {name:program.name,usedTimes:program.usedTimes,linked:gl.getProgramParameter(program.program,gl.LINK_STATUS),samplerCount:samplers.reduce((sum,row)=>sum+row.count,0),samplers};});return {programs:renderer.info.programs.length,firstPersonProjectionPrograms:programs('bf2FirstPersonProjectionScale','vertexShader'),recoveredFloorPrograms:programs('bf2_world'),nativeStaticAtlasPrograms:programs('bf2_staticAtlasOrProbe'),nativeTangentPrograms:programs('BF2_SOURCE_TANGENT_FRAME','vertexShader'),recoveredMasterPrograms:programs('bf2_master_surface'),recoveredMaster2UvPrograms:programs('bf2_master2uv_surface'),recoveredCeilingPrograms:programs('bf2_ceiling_surface'),recoveredMetalOnlyPrograms:programs('bf2_metalonly_surface'),originalBlasterPrograms:programs('LOCAL-BLASTER-BOLT-PIXEL-001'),nativePunctualPrograms:programs('bf2_nativePunctual'),nativeEnvironmentPrograms:programs('bf2_sourceEnvironmentResponse'),recoveredCatwalk1Programs:programs('bf2_catwalk1_surface'),recoveredVolcanicObjectPrograms:programs('bf2_volcanic_object_surface'),recoveredPropsNonmetalPrograms:programs('bf2_propsnonmetal_surface'),recoveredCatwalk2Programs:programs('bf2_catwalk2_surface'),recoveredExteriorPrograms:programs('bf2_exterior_surface'),nativeReflectionPrograms:programs('bf2_sampleNativeReflection'),recoveredCorvetteDamagePrograms:programs('bf2_corvette_damage_surface'),recoveredMasterEmissivePrograms:programs('bf2_master1uv_emissive_surface'),recoveredMasterEmissiveNonmetalPrograms:programs('bf2_master1uv_emissive_nonmetal_surface'),recoveredPropsPresetPrograms:programs('bf2_props_surface'),recoveredArray1UvPrograms:programs('bf2_array1uv_surface'),recoveredArray2UvPrograms:programs('bf2_array2uv_surface')};},
      navigationPath:(from,to)=>runtime.navigation?.findPath(new THREE.Vector3(...from),new THREE.Vector3(...to)).map(point=>point.toArray())??[],
      collisionRay:(origin,direction,maxDistance=20)=>{const hit=assets.collision.rayIntersect(new THREE.Ray(new THREE.Vector3(...origin),new THREE.Vector3(...direction).normalize()),0,maxDistance);return hit?{distance:hit.distance,position:hit.position?.toArray()??hit.point?.toArray()??null}:null;},
    };
    // Diagnostic handles for test/profiling scripts only; never exposed in normal play.
    if(params.has('agent'))Object.defineProperty(window.battlefront,'debug',{value:{THREE,renderer,scene,camera,assets,runtime,lighting,shadows,exposure}});
    $('screen-message').textContent='Ready to deploy';$('progress').hidden=true;$('menu-controls').hidden=false;
    if(!params.has('agent')&&!params.has('autostart'))runtime.present(engine.ctx,0);
  } catch(error) {
    console.error(error);window.battlefront={version:1,status:'unavailable',error:String(error.message??error)};
    $('screen-message').textContent='Extracted map assets are not available';$('loading-detail').textContent=String(error.message??error);
    $('progress').hidden=true;$('retry').hidden=false;$('menu-controls').hidden=true;screen.hidden=false;
    $('provenance').textContent='No substitute map is loaded. The browser runtime waits for the actual exported map, its placement manifest, collision geometry, and spawn locations.';
  }
}

$('start').addEventListener('click',()=>{
  if(!engine)return;
  gameAudio?.resume().catch(error=>console.warn('Audio resume failed',error));
  if(resumeOnly){engine.ctx.setPaused(false);resumeOnly=false;}
  else if(engine.ctx.phase==='over')runtime.resetRound($('mode').value);
  else {runtime.resetRound($('mode').value,false);engine.ctx.startMatch();}
  screen.hidden=true;$('hud').hidden=false;engine.ctx.inputDevice.requestLock();
});
canvas.addEventListener('pointerdown',()=>gameAudio?.resume().catch(error=>console.warn('Audio resume failed',error)));
$('retry').addEventListener('click',()=>location.reload());
document.addEventListener('pointerlockchange',()=>{
  if(!engine||engine.ctx.agentMode||engine.ctx.phase!=='play')return;
  if(document.pointerLockElement!==canvas&&engine.ctx.inputDevice.everLocked){engine.ctx.setPaused(true);screen.hidden=false;resumeOnly=true;$('screen-message').textContent='PAUSED';$('start').textContent='RESUME';$('menu-controls').hidden=false;}
});
boot();
