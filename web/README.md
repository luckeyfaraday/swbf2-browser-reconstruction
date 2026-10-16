# Battlefront browser reconstruction

This local runtime loads the extracted Death Star II — Command Sector North geometry, source characters, E-11 weapon, rifle animations and close-shot audio. Actual-scene control testing completed a 100–82 TDM round and a restart. Lighting, material behavior and several mechanics remain provisional; this is not yet verified original-game visual or mechanical parity. Detailed evidence and limitations are in `test-results/actual-map-validation.json`.

## Commands

```powershell
npm ci
npm test
npm run build
npm run check:browser
npm run check:actual-map
```

`check:browser` owns a temporary loopback server on agent port 7746 and closes it and its browser when finished. `BF2_CHECK_PORT` can select another free agent port. `BF2_BROWSER_EXECUTABLE` can select an installed Chromium browser. Reports and screenshots are in `test-results/`. This is a new, explicit integration check, not the missing original `vibe verify` CLI. The only synthetic map exists inside that test process, and is labeled in its screenshots.

`check:actual-map` uses the real extracted manifest and GLBs without any fixture routes, on a separate temporary agent port 7747. It records source spawn grounding, real keyboard and Vibe input movement, camera switching, firing, screenshots, render performance, and errors. It does not claim original-game parity or replace the missing `vibe verify` gate. It closes only the browser and server it created. `BF2_ACTUAL_CHECK_PORT` overrides that agent port.

`npm run dev` uses agent port 7737. A user play server has not been assigned or started. Production output is in `dist/` after a build. Local assets must be present before building to be copied into that output.

## Extraction contract

Put the actual exports in `web/public/assets/`. Paths below are browser URLs. The required `/assets/map.scene.json` is:

```json
{
  "metadata": {
    "mapId": "deathstar-command-sector-north",
    "name": "Command Sector North",
    "source": { "artifact": "local installation", "evidence": [] },
    "units": "meters",
    "up": "Y"
  },
  "assets": [
    { "id": "mesh-id", "url": "meshes/mesh-id.glb", "collision": true }
  ],
  "instances": [
    { "assetId": "mesh-id", "matrix": [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] }
  ],
  "lights": [
    { "type": "point", "position": [0,3,0], "color": "#c4dfff", "intensity": 20, "range": 12 }
  ],
  "spawns": [
    { "position": [0,0,0], "team": 0, "yaw": 0 },
    { "position": [0,0,-20], "team": 1, "yaw": 3.141592653589793 }
  ],
  "bounds": { "min": [-50,-5,-50], "max": [50,30,50] }
}
```

The numbers above illustrate the schema; they are not a map or source-derived spawn coordinates. Transforms are column-major. Positions are meters, Y up; spawn positions are feet positions. Yaw is radians: zero faces -Z and positive yaw turns left. GLB node transforms are composed after each instance matrix. Export genuine textures in materials; GLTFLoader preserves PBR material interpretation, sRGB base color/emissive, normal maps, and alpha modes. Repeated positive-parity static meshes are instanced. Mirrored transforms use ordinary meshes. Collision-marked mesh triangles are merged into a static BVH. Separate invisible collision GLBs can use `visible:false` when the extractor supplies them; otherwise render and collision share geometry.

Repeated meshes are partitioned into 32m spatial cells, preserving every source transform while allowing distant cells to be culled. Per-instance `collision:false` excludes source members whose physics count is known to be zero. Optional `collision-overrides.json` adds recovered native movement hulls through a separate composite collider. The recovered catwalk root0 supports the original grating spawn. Movement/navigation query that composite; camera and weapon rays retain their own render-triangle approximation because the distinct native raycast root1 is not decoded. The movement union still contains approximate render collision elsewhere.

Lights support `point`, `spot`, `directional`, `ambient`, and `hemisphere`; spots and directionals can include a `target`, hemisphere can include a `groundColor`. Local lights are selected by distance and attenuation range around the moving player, with a fixed pool of eight point lights and six spots. Lights beyond the first 24 manifest entries are therefore usable in their own rooms. Pool sizes remain constant to avoid shader recompilation on every selection change. Source positions are preserved; this renderer budget is an approximation.

When manifest lights are empty, optional `source-lights.json` supplies original `matrix` and `properties` descriptors. Sphere/spot positions and RGB ratios are retained. Source linear RGB scale 1/32, spot negative-Z direction, full-cone interpretation, and the treatment of `LuminousPower` as lumens are explicit renderer mapping assumptions in provenance. Rectangular lights temporarily use point approximations. Specular-only sources are omitted; IES/projection textures, dynamic shadows, volumetrics and baked indirect illumination remain missing. A low provisional hemisphere fill is recorded. `metadata.background` and `metadata.exposure` are optional renderer overrides. If all source lights are absent, provenance identifies the stronger fallback lighting.

Optional `recovered-floor-materials.json` supplies exact source section bindings and packed textures for the recovered `SS_DSI_Floor_01` equations. The runtime applies them before static batching, preserves absolute world-space UVs including instance transforms, and records 23 matched sections in `assetStats`. The actual-map check verifies that the custom programs compile and link. Native lighting and other material shaders remain incomplete.

Optional `/assets/gameplay.json`:

```json
{
  "parameters": {
    "player": { "health": 150, "moveSpeed": 5.5 },
    "weapon": { "name": "E-11", "damage": 25, "roundsPerMinute": 400 },
    "round": { "mode": "tdm", "scoreLimit": 100, "botCount": 9 },
    "camera": { "thirdPerson": true, "fov": 75 },
    "bots": { "reactionTime": 0.35 }
  },
  "provenance": { "evidence": [], "limitations": [] }
}
```

Those example numbers are provisional, not findings. `src/rules.js` contains the full available schema in `PROVISIONAL`. Missing fields retain explicit provisional defaults. The resolved provenance records supplied and defaulted parameter paths separately; evidence supplied by extraction remains attached verbatim. `sourceDerived.parameters` is also accepted if `parameters` is absent. Engine health regeneration, heat cooling, projectile speed/range/spread/damage, movement dimensions/acceleration defaults, camera offset/FOV, round timers, and bot settings should be replaced or expanded as evidence becomes available.

Optional `/assets/characters.json`:

```json
{
  "characters": [
    {
      "id": "imperial-assault",
      "team": 0,
      "url": "characters/imperial-assault.glb",
      "scale": 1,
      "rotationY": 0,
      "animations": { "idle": "Idle", "run": "Run", "fire": "Fire", "death": "Death" }
    }
  ],
  "weapons": [
    {
      "id": "primary",
      "url": "weapons/e11.glb",
      "firstPerson": { "position": [0.22,-0.22,-0.4], "rotation": [0,0,0], "scale": 1 }
    }
  ],
  "provenance": { "evidence": [] }
}
```

Character GLBs can contain skins and named animation clips. The listed pose numbers only document the schema; actual weapon transforms must come from extraction or observation. Source characters and the E-11 use independent cloned skeletons. Animation fidelity remains incomplete until source motion clips and poses are bound.

Bots use explicitly provisional collision-derived multilayer grid A* routes inside the recovered source combat polygon. Nodes sample the real collision triangles; edges check standing capsule clearance, ground continuity, slope and step heights. Bots follow routes through the normal collision controller, then aim and fire when an opponent is visible. This is a reconstruction of navigation capability, not recovered BF2 AI or navmesh behavior. Cached grids/routes avoid rebuilding the same static geometry queries every frame.

Set `BF2_ROUND_CHECK=1` before `npm run check:actual-map` to extend actual-scene validation through a complete TDM round. The automated player uses bounded aim changes and the same movement/fire input path as normal controls. It must observe eliminations, later respawns, score changes, a round end, and restart. Diagnostic capsule arrangements at source spawns are separately labeled and never presented as real-control play evidence.

`audio.json` binds nine recovered E-11 close-shot variations. They preload as decoded 48kHz stereo buffers and resume playback on Deploy or a canvas click. Selection preserves the recovered last-three history, source amplitude 0.9 and pitch 1. Agent mode stays muted. Three-dimensional HRTF attenuation and master gain 0.35 are provisional; native reflections, distant layers and mixer processing are still missing. The fallback browser check verifies gesture-enabled voice scheduling with Chrome output muted for unattended execution.

## Controls and automation

WASD moves, Shift sprints, Space jumps, C/Ctrl crouches, left mouse fires, right mouse aims, R initiates provisional cooling, V switches first/third person, Escape pauses. TDM/Blast and FFA include scoring, elimination, respawn, timeout, win/draw, and restart. Shoulder-camera aiming raycasts against cover before spawning projectiles at the actor, preventing camera offsets from shooting through a nearby wall.

The authentic Vibe engine copy is under `vendor/vibe-engine` with its original VERSION and recovery note. It exports `createGame`, `PlayerController`, and `CollisionWorld`. The original source is unchanged; the application layers new logic on it. No original CLI, pilot, watchdog, or scenario loader was recovered.

`?agent&seed=42` uses the actual Vibe manual clock and virtual input path. Useful APIs:

```js
window.vibe.observe();
window.vibe.turn({ act: { move: 'forward', look: [10, 0], fire: true }, seconds: 0.1 });
window.vibe.act({ stop: true, camera: 'third-person' });
window.vibe.act({ restart: true, mode: 'ffa' });
window.vibe.step(1 / 60);
window.vibe.events();
window.vibe.errors();
window.vibe.digest();
await window.vibe.perf(1000);
```

`window.battlefront` contains load status, map provenance, and the applied mechanics provenance. Input commands use the same sampled controls as keyboard/mouse. Production automation should use those controls, not teleport or damage mutation. Fixtures are arrangements for scaffold tests only, and cannot establish completion of the BF2 port.
