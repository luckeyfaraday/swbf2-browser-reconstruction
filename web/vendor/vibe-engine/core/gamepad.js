// Controller support every game shares. One reader for the browser's standard gamepad mapping:
//   - radial deadzones and a response curve, look speed in radians/second with a turn boost at full deflection
//   - named actions from a layout (data), with held / pressed / released edges per poll
//   - which controller family is in hand (Xbox, PlayStation, Nintendo) for prompt glyphs, and rumble
//   - which device the player is using right now (gamepad vs keyboard/mouse), for prompts and pointer lock
// No DOM or three.js: pass `getGamepads` to test it in Node. HTML menus: core/menu-nav.js. Engine games get it
// through core/input.js; other games call poll() once per frame and map the state onto their own input.

/** Standard Gamepad mapping (https://w3c.github.io/gamepad/#remapping): button names by position. */
export const BUTTONS = Object.freeze({ a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, home: 16 });

/** Call of Duty's "Default" controller layout (Black Ops III included): what the shooters here expect. */
export const FPS_LAYOUT = Object.freeze({
  fire: 'rt', aim: 'lt', jump: 'a', crouch: 'b', reload: 'x', use: 'x', switchWeapon: 'y', sprint: 'l3', melee: 'r3',
  lethal: 'rb', tactical: 'lb', pause: 'start', scoreboard: 'back', up: 'up', down: 'down', left: 'left', right: 'right',
});

const GLYPHS = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', back: 'View', start: 'Menu', l3: 'LS', r3: 'RS', up: '↑', down: '↓', left: '←', right: '→', home: 'Xbox' },
  playstation: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', back: 'Create', start: 'Options', l3: 'L3', r3: 'R3', up: '↑', down: '↓', left: '←', right: '→', home: 'PS' },
  // Nintendo labels sit on the other positions (standard "a" is the bottom button, labelled B).
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', back: '−', start: '+', l3: 'LS', r3: 'RS', up: '↑', down: '↓', left: '←', right: '→', home: 'Home' },
};

/** Which controller family a Gamepad.id names (USB vendor ids or product names). */
export function controllerType(id = '') {
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  if (/054c|playstation|dualsense|dualshock|^wireless controller/i.test(id)) return 'playstation';
  if (/057e|nintendo|switch|pro controller|joy-con/i.test(id)) return 'nintendo';
  return 'xbox';
}

/** Radial deadzone with rescaling: the stick's direction is kept, its length mapped from [inner, outer] to [0, 1]. */
export function radial(x, y, inner = 0.14, outer = 0.96) {
  const length = Math.hypot(x, y);
  if (length <= inner) return { x: 0, y: 0, length: 0 };
  const scaled = Math.min(1, (length - inner) / (outer - inner));
  return { x: x / length * scaled, y: y / length * scaled, length: scaled };
}

export function createGamepad({
  getGamepads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []),
  layout = FPS_LAYOUT, deadzone = 0.14, outerDeadzone = 0.96, triggerThreshold = 0.3,
  lookSpeed = 3.0, lookCurve = 1.8, turnBoost = 0.6, boostDelay = 0.25, verticalScale = 0.7, invertY = false,
} = {}) {
  const options = { layout, deadzone, outerDeadzone, triggerThreshold, lookSpeed, lookCurve, turnBoost, boostDelay, verticalScale, invertY };
  let index = -1, previous = {}, fullTime = 0, device = 'keyboard', listeners = [];
  const blank = () => ({ connected: false, active: false, id: '', type: 'xbox', move: { x: 0, y: 0 }, look: { x: 0, y: 0 },
    sticks: { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } }, triggers: { lt: 0, rt: 0 }, buttons: {}, held: {}, pressed: {}, released: {} });
  let state = blank();

  const pads = () => [...(getGamepads() || [])].filter(p => p && p.connected !== false);
  const anyInput = p => p.buttons.some(b => b && (b.pressed || b.value > 0.5)) || p.axes.some(a => Math.abs(a) > 0.5);

  /** Read the controllers. `dt` (seconds since the last poll) scales look and times the turn boost. */
  function poll(dt = 1 / 60) {
    const list = pads();
    // The pad the player last touched stays in charge until another one is used.
    const touched = list.find(p => p.index !== index && anyInput(p));
    if (touched) index = touched.index;
    const pad = list.find(p => p.index === index) ?? list[0];
    const next = blank();
    if (!pad) { previous = {}; state = next; return state; }
    index = pad.index;
    next.connected = true; next.id = pad.id; next.type = controllerType(pad.id);
    for (const [name, i] of Object.entries(BUTTONS)) {
      const b = pad.buttons[i];
      next.buttons[name] = !!b && (name === 'lt' || name === 'rt' ? b.value > options.triggerThreshold || (b.pressed && b.value === undefined) : b.pressed);
    }
    next.triggers.lt = pad.buttons[BUTTONS.lt]?.value ?? 0; next.triggers.rt = pad.buttons[BUTTONS.rt]?.value ?? 0;
    const left = radial(pad.axes[0] || 0, pad.axes[1] || 0, options.deadzone, options.outerDeadzone);
    const right = radial(pad.axes[2] || 0, pad.axes[3] || 0, options.deadzone, options.outerDeadzone);
    next.sticks.left = { x: left.x, y: -left.y }; next.sticks.right = { x: right.x, y: -right.y };
    next.move = { x: left.x, y: -left.y };
    // Look: a response curve on the stick's length, then a turn boost once it has been held at the edge.
    fullTime = right.length > 0.95 ? fullTime + dt : 0;
    const boost = 1 + (fullTime > options.boostDelay ? options.turnBoost * Math.min(1, (fullTime - options.boostDelay) / 0.35) : 0);
    const curved = right.length ? Math.pow(right.length, options.lookCurve) / right.length : 0;
    next.look = { x: right.x * curved * options.lookSpeed * boost * dt, y: -right.y * curved * options.lookSpeed * options.verticalScale * dt * (options.invertY ? -1 : 1) };
    for (const [action, button] of Object.entries(options.layout)) {
      const held = !!next.buttons[button];
      next.held[action] = held;
      if (held && !previous[action]) next.pressed[action] = true;
      if (!held && previous[action]) next.released[action] = true;
    }
    next.active = anyInput(pad) || left.length > 0 || right.length > 0;
    if (next.active && device !== 'gamepad') setDevice('gamepad');
    previous = next.held; state = next;
    return state;
  }

  function setDevice(value) { device = value; for (const f of listeners) f(value); }
  /** Keyboard or mouse use hands prompts back to keyboard glyphs. Returns a function that stops listening. */
  function trackDevice(target = typeof window !== 'undefined' ? window : null) {
    if (!target) return () => {};
    const toKeyboard = e => { if (device !== 'keyboard' && !(e.type === 'mousemove' && Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) < 3)) setDevice('keyboard'); };
    for (const type of ['keydown', 'mousedown', 'mousemove', 'wheel']) target.addEventListener(type, toKeyboard, { passive: true });
    return () => { for (const type of ['keydown', 'mousedown', 'mousemove', 'wheel']) target.removeEventListener(type, toKeyboard); };
  }

  return {
    poll,
    get state() { return state; },
    get device() { return device; },
    get connected() { return state.connected; },
    onDevice(f) { listeners.push(f); return () => { listeners = listeners.filter(x => x !== f); }; },
    trackDevice,
    /** Button label for an action (or a button name) on the controller in hand: 'X', '□', 'RT', 'R2'… */
    glyph(action) { const button = options.layout[action] ?? action; return GLYPHS[state.type]?.[button] ?? button.toUpperCase(); },
    /** Dual-motor rumble where the browser supports it: strong / weak 0..1, duration in ms. */
    rumble(strong = 0.5, weak = 0.5, duration = 120) {
      const pad = pads().find(p => p.index === index);
      pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration, strongMagnitude: strong, weakMagnitude: weak })?.catch?.(() => {});
    },
    set(changes) { Object.assign(options, changes); },
    options,
  };
}
