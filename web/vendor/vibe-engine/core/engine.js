// The vibe engine core: a fixed-step, seeded game loop with the agent API built in.
//
//   import { createGame } from '../engine/core/engine.js';
//   createGame({
//     name: 'My Game',
//     canvas: document.querySelector('canvas'),
//     async load(ctx) {},            // fetch models, textures, sounds (not seeded, may run in any order)
//     init(ctx) {},                  // build the world: draw only from ctx.rand, in a fixed order
//     start(ctx) {},                 // the match begins (menu button, ?autostart, or an agent's start)
//     simulate(ctx, dt) {},          // ONE fixed tick (dt = 1/60). Read ctx.input. Only this changes the game state.
//     present(ctx, dt, alpha) {},    // draw a frame: cameras, animation, effects. Never changes game state.
//     observe(ctx, opts) { return {} },   // what an agent sees, as JSON
//     describe(ctx, obs) { return '' },   // the same as short text (optional)
//     act(ctx, cmd) { return {} },        // game-specific agent commands (moveTo, lookAt, …) (optional)
//     digest(ctx) { return {} },          // the state that must match across runs for determinism (optional)
//     view(ctx, opts) { return {} },      // camera/HUD overrides for screenshots (optional)
//   });
//
// URL options: ?agent (time only moves when an agent steps it; no pause, muted), ?seed=N, ?autostart, ?debug.
// Everything under window.vibe is what `vibe agent`, `vibe verify` and the reviewers use.
import { makeRng, hashValue, r2 } from './rng.js';
import { createInput } from './input.js';

export const TICK = 1 / 60;

export function createGame(spec) {
  const params = new URLSearchParams(location.search);
  const agentMode = params.has('agent');
  const seedParam = params.get('seed');
  const seed = seedParam != null && seedParam !== '' && !isNaN(+seedParam) ? (+seedParam | 0) : (Math.random() * 1e9) | 0;

  const errors = [];
  addEventListener('error', e => errors.push(String(e.message || e)));
  addEventListener('unhandledrejection', e => errors.push(String(e.reason && e.reason.message || e.reason)));

  const events = [];
  let eventId = 0;
  let timeMode = agentMode ? 'manual' : 'realtime';
  let paused = false, started = false, acc = 0, last = performance.now(), fpsN = 0, fpsT = 0;

  const ctx = {
    name: spec.name || document.title,
    params, agentMode, seed, debug: params.has('debug'),
    rand: makeRng(seed),                       // the match stream
    lookRand: makeRng(seed ^ 0x2545F491),      // cosmetics only: never changes how a match plays
    time: 0, tick: 0, dt: TICK,
    timeScale: 1,                              // realtime only: < 1 = slow motion (fewer fixed ticks per second); agents step exact ticks
    phase: 'loading',                          // loading, menu, play, over (games may add their own)
    input: null,
    canvas: spec.canvas || null,
    renderer: null,                            // set this to your THREE.WebGLRenderer so perf() can read draw calls
    frames: 0, fps: 60,
    state: {},                                 // your game's state lives here (or anywhere you like)
    log(type, data = {}) { events.push({ id: ++eventId, t: r2(ctx.time), type, ...data }); if (events.length > 1000) events.shift(); },
    startMatch() { if (started) return false; started = true; ctx.phase = 'play'; if (spec.start) spec.start(ctx); ctx.log('start', { seed }); return true; },
    endMatch(result = {}) { if (ctx.phase === 'over') return; ctx.phase = 'over'; ctx.result = result; ctx.log('over', result); input.exitLock(); if (spec.over) spec.over(ctx, result); },
    setPaused(p) { paused = !!p && !agentMode; if (pauseEl) pauseEl.hidden = !paused; },
    get paused() { return paused; },
  };

  // pause overlay when the pointer lock is lost mid-game (people press Esc) or Start is pressed on a controller
  let pauseEl = null;
  if (spec.pauseScreen !== false && !agentMode) {
    pauseEl = document.createElement('div');
    pauseEl.hidden = true;
    pauseEl.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:rgba(5,8,16,.55);color:#fff;font:600 22px system-ui,sans-serif;z-index:50;cursor:pointer;letter-spacing:.04em';
    pauseEl.textContent = 'Paused — click or press Start to play';
    pauseEl.addEventListener('click', () => { input.requestLock(); ctx.setPaused(false); });
    document.body.appendChild(pauseEl);
  }
  const input = createInput({
    canvas: ctx.canvas, agentMode, bindings: spec.bindings, sensitivity: spec.sensitivity,
    onLockChange: (locked, ever) => { if (!locked && ever && ctx.phase === 'play' && spec.pauseOnUnlock !== false) ctx.setPaused(true); if (locked) ctx.setPaused(false); },
  });
  ctx.inputDevice = input;

  function simulateTick() {
    ctx.input = input.sample();
    if (ctx.input.pressed.menu && pauseEl && spec.pauseOnUnlock !== false) { ctx.setPaused(true); input.exitLock(); return; }
    spec.simulate(ctx, TICK);
    ctx.time += TICK; ctx.tick++;
  }
  function presentFrame(dt, alpha = 1) {
    if (spec.present) spec.present(ctx, dt, alpha);
    ctx.frames++;
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const rdt = Math.min(0.1, (now - last) / 1000); last = now;
    fpsN++; fpsT += rdt; if (fpsT >= .5) { ctx.fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
    if (paused && ctx.phase === 'play' && input.gamepad.poll(rdt).pressed.menu) ctx.setPaused(false);
    else if (ctx.phase === 'play' && !paused && timeMode === 'realtime') {
      acc += rdt * Math.max(0, Math.min(4, ctx.timeScale ?? 1));
      let n = 0;
      while (acc >= TICK && n < 6) { simulateTick(); acc -= TICK; n++; }
      if (n === 6) acc = 0; // too far behind (tab was hidden): drop the backlog instead of fast-forwarding
    }
    presentFrame(rdt, acc / TICK);
  }

  /* ---- the agent API ---- */
  function step(seconds = .5) {
    if (ctx.phase === 'loading') return { ok: false, reason: 'still loading' };
    if (ctx.phase === 'menu' || !started) ctx.startMatch();
    const from = eventId;
    const n = Math.max(1, Math.round(Math.min(60, Math.max(TICK, +seconds || .5)) / TICK));
    for (let i = 0; i < n && ctx.phase !== 'over'; i++) simulateTick();
    presentFrame(0);
    return { ok: true, ticks: n, time: r2(ctx.time), events: events.filter(e => e.id > from) };
  }
  function act(cmd = {}) {
    if (typeof cmd === 'string') cmd = { [cmd]: true };
    const out = {};
    if (cmd.start) out.start = ctx.startMatch() ? 'started' : 'already started';
    if (spec.act) Object.assign(out, spec.act(ctx, cmd) || {});
    out.input = input.agentApply(cmd);
    return out;
  }
  function observe(opts = {}) {
    const base = { name: ctx.name, seed, phase: ctx.phase, time: r2(ctx.time), tick: ctx.tick, timeMode, paused };
    return spec.observe ? { ...base, ...spec.observe(ctx, opts) } : base;
  }
  function describe(opts = {}) {
    const obs = observe(opts);
    if (spec.describe) return spec.describe(ctx, obs);
    return JSON.stringify(obs);
  }
  function turn(o = {}) {
    const from = eventId;
    const a = o.act ? act(o.act) : null;
    const s = o.seconds === 0 ? null : step(o.seconds ?? .5);
    const obs = observe(o);
    return { act: a, stepped: s ? s.ticks : 0, events: events.filter(e => e.id > from), summary: spec.describe ? spec.describe(ctx, obs) : undefined, state: o.full === false ? undefined : obs };
  }
  function perf(ms = 1000) {
    ms = Math.min(10000, Math.max(100, +ms || 1000));
    return new Promise(resolve => {
      const f0 = ctx.frames, t0 = performance.now();
      setTimeout(() => {
        const frames = ctx.frames - f0, dt = performance.now() - t0;
        const r = ctx.renderer && ctx.renderer.info ? ctx.renderer.info.render : null;
        resolve({ fps: Math.round(frames / dt * 10000) / 10, frames, ms: Math.round(dt), calls: r ? r.calls : null, triangles: r ? r.triangles : null, memory: ctx.renderer && ctx.renderer.info ? ctx.renderer.info.memory : null });
      }, ms);
    });
  }
  function digest() {
    const d = spec.digest ? spec.digest(ctx) : observe({ radius: 1e9 });
    return { digest: hashValue({ tick: ctx.tick, rng: ctx.rand.state(), d }), tick: ctx.tick, time: r2(ctx.time), events: eventId };
  }
  const HELP = `window.vibe (${ctx.name})
  observe(opts)        full JSON state          describe(opts)   the same as short text
  act(cmd)             apply a command now      step(seconds)    advance fixed ticks (manual time)
  turn({act, seconds}) act, step, observe       events(since)    event log
  perf(ms)             fps + draw calls         digest()         determinism fingerprint
  setTimeMode('manual'|'realtime')              view(opts)       camera/HUD overrides (if the game has them)
Commands: {start}, {move:[x,y]|'forward'|null}, {look:[dxDeg,dyDeg]}, {turn:deg}, {jump:true}, {sprint:true},
  {crouch}, {fire:true|false}, {aim}, {reload:true}, {interact:true}, {use1..use4}, {press:'KeyE'}, {stop:true}${spec.actHelp ? '\n' + spec.actHelp : ''}`;

  async function boot() {
    try {
      if (spec.load) await spec.load(ctx);
      if (spec.init) await spec.init(ctx);
    } catch (e) { errors.push(String(e && e.stack || e)); console.error(e); throw e; }
    ctx.phase = 'menu';
    window.vibe = {
      ready: true, version: 1, name: ctx.name, seed, agentMode,
      get timeMode() { return timeMode; },
      observe, describe, act, step, turn, perf, digest,
      events: (since = 0) => events.filter(e => e.id > +since),
      setTimeMode: m => { if (m === 'manual' || m === 'realtime') timeMode = m; return timeMode; },
      start: () => ctx.startMatch() ? 'started' : 'already started',
      view: o => spec.view ? spec.view(ctx, o || {}) : { ok: false, reason: 'this game has no view overrides' },
      errors: () => errors.slice(-50),
      help: () => HELP,
      ctx, // for debugging in the console; tools must not depend on it
    };
    if (agentMode || params.has('autostart') || spec.autostart) ctx.startMatch();
    ctx.log('ready', { seed, agentMode });
    requestAnimationFrame(t => { last = t; frame(t); });
  }
  const ready = boot();
  return { ctx, ready };
}
