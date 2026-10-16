import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../vendor/vibe-engine/kits/fps/collision-world.js';
import { BattleRuntime } from '../src/game.js';
import { resolveGameplay } from '../src/rules.js';

// Synthetic arrangements test browser-runtime behavior only, never BF2 fidelity.
function runtimeForTest({ height = 0, parameters = {} } = {}) {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 40));
  floor.position.y = -.5;
  const collision = CollisionWorld.fromObject3D(floor);
  const assets = {
    collision, characters: new Map(), weapons: new Map(), stats: {},
    gameplay: resolveGameplay({ parameters: { ...parameters, round: { botCount: 1, ...parameters.round } } }),
    manifest: {
      metadata: { name: 'Synthetic runtime test' }, bounds: { min: [-20, -1, -20], max: [20, 20, 20] },
      spawns: [{ position: [0, height, 5], team: 0 }, { position: [0, height, -5], team: 1 }],
    },
  };
  const ctx = {
    phase: 'play', time: 0, rand: () => .5, log() {}, inputDevice: { agentApply() {} },
    input: { pressed: {}, moveX: 0, moveY: 0, lookX: 0, lookY: 0 },
    setPaused() {}, endMatch(result) { this.phase = 'over'; this.result = result; },
  };
  const runtime = new BattleRuntime({ assets, scene, camera: new THREE.PerspectiveCamera(), renderer: {}, ui: { end() {} } });
  runtime.init(ctx);
  runtime.botInput = () => ({ move: [0, 0] });
  return { runtime, ctx, collision };
}

test('initial deployment and respawn preserve manifest feet coordinates above ground', () => {
  const { runtime, collision } = runtimeForTest({ height: 6 });
  for (const actor of runtime.actors) assert.equal(actor.controller.getFeetPosition().y, 6);
  runtime.player.controller.setPosition([3, 8, 2]);
  runtime.spawn(runtime.player);
  assert.deepEqual(runtime.player.controller.getFeetPosition().toArray(), [0, 6, 5]);
  collision.dispose();
});

test('a decisive kill freezes combat before a later projectile can kill the winning player', () => {
  const { runtime, ctx, collision } = runtimeForTest({ parameters: { round: { scoreLimit: 1 }, weapon: { damage: 200 } } });
  const [player, enemy] = runtime.actors;
  player.controller.setPosition([0, 0, 5]);
  enemy.controller.setPosition([0, 0, -5]);
  for (const actor of runtime.actors) actor.spawnProtection = 0;
  const bolt = (owner, target, direction) => {
    const position = target.controller.getFeetPosition().add(new THREE.Vector3(0, 1.1, -direction * .5));
    const mesh = new THREE.Object3D();
    runtime.scene.add(mesh);
    return { owner, position, direction: new THREE.Vector3(0, 0, direction), travel: 0, mesh };
  };
  // Projectiles are visited backwards, so the player wins before the return bolt.
  runtime.projectiles = [bolt(enemy, player, 1), bolt(player, enemy, -1)];
  runtime.simulate(ctx, 1 / 60);
  assert.equal(runtime.round.phase, 'ended');
  assert.equal(runtime.round.winner, 0);
  assert.equal(player.alive, true);
  assert.equal(player.health, runtime.config.player.health);
  assert.equal(enemy.alive, false);
  assert.deepEqual(runtime.round.scores, [1, 0]);
  collision.dispose();
});

test('a projectile expiring during a tick cannot travel the full tick and hit a target beyond its lifetime',()=>{
  const {runtime,ctx,collision}=runtimeForTest({parameters:{weapon:{projectileLifetime:.001}}});
  const [player,enemy]=runtime.actors;
  player.controller.setPosition([0,0,5]);enemy.controller.setPosition([0,0,-5]);
  for(const actor of runtime.actors)actor.spawnProtection=0;
  const mesh=new THREE.Object3D();runtime.scene.add(mesh);
  runtime.projectiles=[{owner:player,position:new THREE.Vector3(0,1.1,-4),direction:new THREE.Vector3(0,0,-1),travel:0,age:0,mesh}];
  const projectile=runtime.projectiles[0];
  runtime.simulate(ctx,1/60);
  assert.equal(enemy.health,runtime.config.player.health);
  assert.equal(runtime.projectiles.length,0);
  assert.ok(Math.abs(projectile.position.z-(-4.15))<1e-6);
  assert.ok(Math.abs(mesh.position.z-.45*mesh.scale.z-projectile.position.z)<1e-6);
  collision.dispose();
});
