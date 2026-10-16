// Input: keyboard, mouse + pointer lock, gamepad, touch (via an optional kit), and the agent's virtual input.
// Every tick the engine turns all of it into one snapshot (ctx.input), so game code reads a single shape and an
// agent plays under exactly the same rules as a person:
//   { moveX, moveY,            strafe right +, forward +, each -1..1
//     lookX, lookY,            radians turned this tick (right +, up +)
//     jump, sprint, crouch, fire, aim, reload, interact, use1..use4,   held buttons (true while held)
//     pressed: { jump, fire, reload, interact, ..., KeyE, Digit1, ... }  went down this tick
//     keys: { KeyW: true, ... } }
// Bindings are data (DEFAULT_BINDINGS, PAD_LAYOUT), so a game can rebind without touching this file. The controller
// is read by core/gamepad.js (deadzones, look curve, glyphs, rumble), available to the game as input.gamepad.
import { createGamepad } from './gamepad.js';

export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC', 'ControlLeft'], reload: ['KeyR'], interact: ['KeyE', 'KeyF'],
  fire: ['Mouse0'], aim: ['Mouse2'], use1: ['Digit1'], use2: ['Digit2'], use3: ['Digit3'], use4: ['Digit4'], menu: ['Escape'], map: ['KeyM'],
};
const BUTTONS = ['jump', 'sprint', 'crouch', 'fire', 'aim', 'reload', 'interact', 'use1', 'use2', 'use3', 'use4', 'map'];
/** Controller buttons for the snapshot's actions (standard mapping names, see gamepad.js BUTTONS). */
export const PAD_LAYOUT = { jump: 'a', crouch: 'b', reload: 'x', interact: 'y', aim: 'lt', fire: 'rt', sprint: 'l3', map: 'back', use1: 'up', use2: 'right', use3: 'down', use4: 'left', menu: 'start' };

export function createInput({ canvas, bindings = DEFAULT_BINDINGS, sensitivity = 0.0022, invertY = false, agentMode = false, onLockChange = null, padLayout = PAD_LAYOUT, gamepad = null } = {}) {
  const pad = gamepad || createGamepad({ layout: padLayout, invertY });
  if (typeof window !== 'undefined' && !agentMode) pad.trackDevice(window);
  const keys = {}, downQueue = new Set();
  let mdx = 0, mdy = 0, locked = false, everLocked = false, enabled = true;
  // agent virtual input: held state plus one-shot presses and look deltas, applied on the next tick
  const agent = { moveX: 0, moveY: 0, held: {}, presses: new Set(), lookX: 0, lookY: 0 };
  // extra sources (touch kit, gamepad) push axis/button values here every frame
  const external = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: {}, presses: new Set() };

  const onKeyDown = e => {
    if (!enabled) return;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && (locked || agentMode)) e.preventDefault();
    if (!e.repeat) downQueue.add(e.code);
    keys[e.code] = true;
  };
  const onKeyUp = e => { keys[e.code] = false; };
  const onBlur = () => { for (const k in keys) keys[k] = false; };
  const onMouseDown = e => {
    if (!enabled) return;
    if (!locked && !agentMode && canvas && e.target === canvas) requestLock();
    const code = 'Mouse' + e.button; keys[code] = true; downQueue.add(code);
  };
  const onMouseUp = e => { keys['Mouse' + e.button] = false; };
  const onMouseMove = e => { if (locked) { mdx += e.movementX || 0; mdy += e.movementY || 0; } };
  const onLock = () => {
    locked = !!canvas && document.pointerLockElement === canvas;
    if (locked) everLocked = true;
    if (onLockChange) onLockChange(locked, everLocked);
  };
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);
  addEventListener('mousedown', onMouseDown);
  addEventListener('mouseup', onMouseUp);
  addEventListener('mousemove', onMouseMove);
  addEventListener('contextmenu', e => { if (canvas && e.target === canvas) e.preventDefault(); });
  document.addEventListener('pointerlockchange', onLock);

  function requestLock() { if (!canvas) return; try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* not allowed yet */ } }
  const down = name => (bindings[name] || []).some(c => keys[c]);
  const went = name => (bindings[name] || []).some(c => downQueue.has(c));

  // Called once per simulation tick by the engine. Consumes this tick's presses and mouse movement.
  function sample() {
    const gp = agentMode ? { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, held: {}, pressed: {} } : pad.poll(1 / 60);
    let moveX = (down('right') ? 1 : 0) - (down('left') ? 1 : 0) + agent.moveX + external.moveX + gp.move.x;
    let moveY = (down('forward') ? 1 : 0) - (down('back') ? 1 : 0) + agent.moveY + external.moveY + gp.move.y;
    const len = Math.hypot(moveX, moveY);
    if (len > 1) { moveX /= len; moveY /= len; }
    const snap = {
      moveX, moveY,
      lookX: mdx * sensitivity + agent.lookX + external.lookX + gp.look.x,
      lookY: (invertY ? mdy : -mdy) * sensitivity + agent.lookY + external.lookY + gp.look.y,
      pressed: {}, keys: { ...keys },
    };
    for (const b of BUTTONS) {
      snap[b] = down(b) || !!agent.held[b] || !!external.held[b] || !!gp.held[b];
      if (went(b) || agent.presses.has(b) || external.presses.has(b) || gp.pressed[b]) { snap.pressed[b] = true; snap[b] = true; }
    }
    if (gp.pressed.menu) snap.pressed.menu = true;
    for (const c of downQueue) snap.pressed[c] = true;
    for (const c of agent.presses) if (!BUTTONS.includes(c)) { snap.pressed[c] = true; snap.keys[c] = true; }
    downQueue.clear(); agent.presses.clear(); external.presses.clear();
    mdx = mdy = 0; agent.lookX = agent.lookY = 0; external.lookX = external.lookY = 0;
    return snap;
  }

  // Agent commands (see engine.js act): held move/buttons persist until changed; presses and look happen once.
  function agentApply(cmd) {
    if (cmd.stop) { agent.moveX = agent.moveY = 0; agent.held = {}; }
    if (cmd.move !== undefined) {
      const m = cmd.move;
      const named = { forward: [0, 1], back: [0, -1], backward: [0, -1], left: [-1, 0], right: [1, 0], none: [0, 0] };
      const v = m == null || m === false ? [0, 0] : typeof m === 'string' ? named[m] || [0, 0] : Array.isArray(m) ? m : [m.x || 0, m.y || 0];
      agent.moveX = Math.max(-1, Math.min(1, +v[0] || 0)); agent.moveY = Math.max(-1, Math.min(1, +v[1] || 0));
    }
    if (cmd.look) { const [dx, dy] = Array.isArray(cmd.look) ? cmd.look : [cmd.look.x || 0, cmd.look.y || 0]; agent.lookX += (+dx || 0) * Math.PI / 180; agent.lookY += (+dy || 0) * Math.PI / 180; }
    if (cmd.turn) agent.lookX += (+cmd.turn || 0) * Math.PI / 180;
    for (const b of BUTTONS) {
      if (cmd[b] === undefined) continue;
      if (b === 'jump' || b === 'reload' || b === 'interact' || b.startsWith('use')) { if (cmd[b]) agent.presses.add(b); if (cmd[b] === 'hold') agent.held[b] = true; else if (cmd[b] === false) delete agent.held[b]; }
      else if (cmd[b]) agent.held[b] = true; else delete agent.held[b];
    }
    if (cmd.press) for (const c of [].concat(cmd.press)) agent.presses.add(c);
    return { move: [agent.moveX, agent.moveY], held: Object.keys(agent.held) };
  }

  return {
    sample, agentApply, external, requestLock, bindings, gamepad: pad,
    get locked() { return locked; }, get everLocked() { return everLocked; },
    setEnabled(v) { enabled = !!v; if (!v) onBlur(); },
    exitLock() { if (document.pointerLockElement) document.exitPointerLock(); },
  };
}
