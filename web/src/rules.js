import {createHeatState,advanceHeat,applyShotHeat,heatBlocksFire} from './weapon-heat.js';
// These are explicit reconstruction defaults, not claims about extracted BF2 values.
export const PROVISIONAL = Object.freeze({
  player: { health: 150, radius: .35, height: 1.8, crouchHeight: 1.2, eyeHeight: 1.62, crouchEyeHeight: 1.05, moveSpeed: 5.5, sprintSpeed: 8, crouchSpeed: 2.7, groundAcceleration: 60, airAcceleration: 20, gravity: 20, jumpHeight: 1, maxFallSpeed: 50, stepHeight: .45, maxSlopeAngle: 50, coyoteTime: .1, jumpBufferTime: .12, regenDelay: 5, regenRate: 25 },
  weapon: { name: 'BLASTER', damage: 25, endDamage: 25, damageFalloffStart: 0, damageFalloffEnd: 0, projectileLifetime: 0, headMultiplier: 1.5, roundsPerMinute: 400, projectileSpeed: 150, range: 150, heatPerShot: .12, coolingPerSecond: .22, coolingDelay: .6, overheatSeconds: 2.5, spread: .007, aimSpread: .002, color: '#ff563b' },
  round: { mode: 'tdm', scoreLimit: 100, duration: 600, respawnSeconds: 3, botCount: 9, friendlyFire: false },
  camera: { fov: 75, aimFov: 50, thirdPerson: true, distance: 3.1, shoulder: .6, height: .25, sensitivity: .0022 },
  bots: { reactionTime: .35, aimError: .024, aimSpeed: 2.8, fireDistance: 65, moveSpeed: 4.8 },
});

export function resolveGameplay(document = {}) {
  const supplied = document.parameters ?? document.sourceDerived?.parameters ?? {};
  const parameters = {};
  const provisional = [];
  const sourceDerived = [];
  for (const [section, defaults] of Object.entries(PROVISIONAL)) {
    parameters[section] = {};
    for (const [key, fallback] of Object.entries(defaults)) {
      const value = supplied[section]?.[key];
      const valid = value !== undefined && typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value));
      parameters[section][key] = valid ? value : fallback;
      (valid ? sourceDerived : provisional).push(`${section}.${key}`);
    }
  }
  const p = parameters;
  for(const key of ['endDamage','damageFalloffStart','damageFalloffEnd','projectileLifetime'])if(p.weapon[key]<0)throw new Error(`gameplay parameter weapon.${key} must be nonnegative`);
  if(p.weapon.damageFalloffEnd>0&&p.weapon.damageFalloffEnd<p.weapon.damageFalloffStart)throw new Error('weapon damage falloff distances are reversed');
  for (const [section, keys] of Object.entries({player:['health','radius','height','eyeHeight','moveSpeed','sprintSpeed','crouchSpeed','gravity','jumpHeight','regenRate'],weapon:['damage','roundsPerMinute','projectileSpeed','range','heatPerShot','coolingPerSecond'],round:['scoreLimit','duration','respawnSeconds'],camera:['fov','aimFov','distance'],bots:['reactionTime','aimSpeed','fireDistance','moveSpeed']})) {
    for (const key of keys) if (p[section][key] <= 0) throw new Error(`gameplay parameter ${section}.${key} must be positive`);
  }
  p.round.botCount = Math.max(0, Math.min(31, Math.floor(p.round.botCount)));
  p.camera.fov = Math.max(35, Math.min(120, p.camera.fov));
  p.camera.aimFov = Math.max(20, Math.min(p.camera.fov, p.camera.aimFov));
  if (!['tdm','ffa'].includes(p.round.mode)) throw new Error('round.mode must be tdm or ffa');
  return { parameters, provenance: { supplied: document.provenance ?? null, sourceDerived, provisional, note: 'Supplied parameter status depends on the attached provenance; defaults remain provisional.' } };
}

export function createRound(config, mode = config.mode) {
  return { mode, phase: 'playing', elapsed: 0, scores: [0, 0], kills: {}, deaths: {}, scoreLimit: config.scoreLimit, duration: config.duration, winner: null, reason: null };
}

export function advanceRound(round, dt) {
  if (round.phase !== 'playing') return;
  round.elapsed = Math.min(round.duration, round.elapsed + dt);
  if (round.elapsed >= round.duration) {
    round.phase = 'ended'; round.reason = 'time';
    if (round.mode === 'tdm') round.winner = round.scores[0] === round.scores[1] ? null : round.scores[0] > round.scores[1] ? 0 : 1;
    else {
      const ranked = Object.entries(round.kills).sort((a,b) => b[1]-a[1]);
      round.winner = ranked.length && (ranked.length < 2 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
    }
  }
}

export function recordKill(round, killer, victim) {
  if (round.phase !== 'playing' || !victim || victim.scoredDeath) return false;
  victim.scoredDeath = true;
  round.deaths[victim.id] = (round.deaths[victim.id] ?? 0) + 1;
  if (!killer || killer.id === victim.id || (round.mode === 'tdm' && killer.team === victim.team)) return true;
  round.kills[killer.id] = (round.kills[killer.id] ?? 0) + 1;
  if (round.mode === 'tdm') round.scores[killer.team]++;
  const score = round.mode === 'tdm' ? round.scores[killer.team] : round.kills[killer.id];
  if (score >= round.scoreLimit) { round.phase = 'ended'; round.winner = round.mode === 'tdm' ? killer.team : killer.id; round.reason = 'score'; }
  return true;
}

export function resetLife(actor, maxHealth) {
  actor.health = maxHealth; actor.alive = true; actor.respawnIn = 0; actor.scoredDeath = false;
  actor.heat = 0; actor.overheat = 0; actor.shotCooldown = 0; actor.lastShot = -1e9; actor.lastDamage = -1e9;
  if(actor.weaponHeat)actor.weaponHeat=createHeatState();
}

export function damageActor(actor, amount, time) {
  if (!actor.alive || amount <= 0) return false;
  actor.health = Math.max(0, actor.health - amount); actor.lastDamage = time;
  if (actor.health === 0) { actor.alive = false; return true; }
  return false;
}

export function damageAtDistance(weapon, distance) {
  // Endpoints are decoded asset values when supplied. Linear interpolation is
  // the reconstruction's explicit inference until original execution is measured.
  if(!(weapon.damageFalloffEnd>weapon.damageFalloffStart))return weapon.damage;
  const t=Math.max(0,Math.min(1,(distance-weapon.damageFalloffStart)/(weapon.damageFalloffEnd-weapon.damageFalloffStart)));
  return weapon.damage+(weapon.endDamage-weapon.damage)*t;
}

export function tickWeapon(actor, weapon, dt, time) {
  // Keep the sub-tick remainder on the tick a shot becomes ready. Discard
  // it on a following idle tick so time spent idle cannot accumulate shots.
  actor.shotCooldown = actor.shotCooldown > 0 ? actor.shotCooldown - dt : 0;
  if(actor.weaponHeat&&weapon.sourceHeat) {
    advanceHeat(actor.weaponHeat,dt,weapon.sourceHeat);
    actor.heat=actor.weaponHeat.heat;actor.overheat=heatBlocksFire(actor.weaponHeat)?1:0;
    return;
  }
  actor.overheat = Math.max(0, actor.overheat - dt);
  if (time - actor.lastShot >= weapon.coolingDelay) actor.heat = Math.max(0, actor.heat - weapon.coolingPerSecond * dt);
}

export function tryFire(actor, weapon, time) {
  if(actor.weaponHeat&&weapon.sourceHeat) {
    if(!actor.alive||actor.shotCooldown>1e-8||heatBlocksFire(actor.weaponHeat))return false;
    if(!applyShotHeat(actor.weaponHeat,weapon.sourceHeat))return false;
    actor.shotCooldown=Math.max(1e-7,actor.shotCooldown+60/weapon.roundsPerMinute);actor.lastShot=time;
    actor.heat=actor.weaponHeat.heat;actor.overheat=heatBlocksFire(actor.weaponHeat)?1:0;
    return true;
  }
  if (!actor.alive || actor.shotCooldown > 1e-8 || actor.overheat > 0 || actor.heat >= 1) return false;
  actor.shotCooldown = Math.max(1e-7, actor.shotCooldown + 60 / weapon.roundsPerMinute); actor.lastShot = time;
  actor.heat = Math.min(1, actor.heat + weapon.heatPerShot);
  if (actor.heat >= 1) actor.overheat = weapon.overheatSeconds;
  return true;
}
