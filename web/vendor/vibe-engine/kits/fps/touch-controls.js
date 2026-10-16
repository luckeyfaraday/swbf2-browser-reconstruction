/**
 * touch-controls.js — mobile dual-stick + buttons for first-person games.
 *
 * Produces the same input object the kit PlayerController reads, so a game
 * can merge it with keyboard/mouse input and pass it straight to update():
 *
 *   {
 *     move: { x, y },     left stick: x = strafe right, y = forward, -1..1
 *     look: { x, y },     right-side drag since the last read(), in
 *                         mouse-movement units (+x turns right, +y looks down)
 *     sprint,             stick pushed to the rim (auto sprint, optional)
 *     <id>, <id>Pressed   per button: held/toggled state, and a one-read edge
 *   }                     e.g. jump + jumpPressed, crouch (toggle), fire...
 *
 * Two layers:
 *   TouchInput      pointer ownership, stick, look and button logic; no DOM,
 *                   so it runs (and is tested) in Node.
 *   TouchControls   builds its own DOM (no ids, class prefix `vk-touch`) under
 *                   `container`, injects its stylesheet once, wires pointer
 *                   events to a TouchInput.
 *
 * Buttons are configured with descriptors:
 *   { id, label, mode: 'hold' | 'tap' | 'toggle', look?: bool,
 *     cancelsSprint?: bool, right|left: px, bottom|top: px, size?: px, icon?: svg }
 *   hold    <id> true while a finger is down (and for one read after a tap)
 *   tap     same state, meant for one-shot actions (jump, reload)
 *   toggle  each press flips <id> (aim, crouch)
 *   look    dragging the button also turns the camera (fire-and-aim); while
 *           it is held the look zone is ignored so turns are not doubled
 *   cancelsSprint  auto sprint is suppressed while the button is active
 * `onAction(id)` fires on every button press, for actions the game handles
 * directly (reload, use, weapon switch...).
 *
 * Every finger keeps its job until released, even when it slides across
 * another control.  Rotation / viewport resizes reset all state, so no
 * movement or held trigger leaks into a new layout.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const svg = (content) => `<svg viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;

export const DEFAULT_BUTTONS = Object.freeze([
  { id: 'fire', label: 'FIRE', mode: 'hold', look: true, cancelsSprint: true, size: 82, right: 69, bottom: 76,
    icon: svg('<circle cx="12" cy="12" r="7"/><path d="M12 1v6m0 10v6M1 12h6m10 0h6"/>') },
  { id: 'aim', label: 'AIM', mode: 'toggle', cancelsSprint: true, right: 167, bottom: 62,
    icon: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>') },
  { id: 'jump', label: 'JUMP', mode: 'tap', right: 0, bottom: 92, icon: svg('<path d="m5 12 7-7 7 7M12 5v15"/>') },
  { id: 'crouch', label: 'CROUCH', mode: 'toggle', cancelsSprint: true, right: 14, bottom: 20,
    icon: svg('<path d="m5 12 7 7 7-7M12 19V4"/>') },
  { id: 'reload', label: 'RELOAD', mode: 'tap', right: 94, bottom: 0,
    icon: svg('<path d="M19 8a8 8 0 1 0 0 9M19 3v6h-6"/>') },
]);

function normalizeButton(button) {
  if (!button?.id || button.id === 'move' || button.id === 'look') {
    throw new TypeError(`touch button needs an id other than move/look: ${JSON.stringify(button)}`);
  }
  return { mode: 'hold', label: button.id.toUpperCase(), ...button };
}

export class TouchInput {
  /**
   * @param {{ buttons?: object[], onLook?: (dx: number, dy: number) => void,
   *           onAction?: (id: string) => void, deadZone?: number,
   *           autoSprint?: boolean, lookScale?: number, sensitivity?: number }} options
   */
  constructor({
    buttons = DEFAULT_BUTTONS,
    onLook = null,
    onAction = null,
    deadZone = 0.12,
    autoSprint = true,
    lookScale = 2.5,
    sensitivity = 1,
  } = {}) {
    this.buttons = new Map(buttons.map((button) => {
      const normalized = normalizeButton(button);
      return [normalized.id, normalized];
    }));
    this.onLook = onLook;
    this.onAction = onAction;
    this.deadZone = clamp(deadZone, 0, 0.9);
    this.autoSprint = autoSprint;
    // Touch drags are shorter than mouse sweeps; scale them into the
    // mouse-movement units the controller's lookSensitivity expects.
    this.lookScale = lookScale;
    this.sensitivity = sensitivity;
    this.pointers = new Map();
    this.toggles = new Map();
    this.queued = new Set();
    this.reset();
  }

  reset() {
    this.pointers.clear();
    this.toggles.clear();
    this.queued.clear();
    this.strafe = this.forward = this.stickX = this.stickY = 0;
    this.lookX = this.lookY = 0;
    this.sprint = false;
  }

  /** Start tracking a finger that landed on `kind` ('move', 'look' or a button id). */
  begin(id, kind, x, y, radius = 50) {
    if (this.pointers.has(id) || this.held(kind)) return false;
    const button = this.buttons.get(kind);
    if (kind !== 'move' && kind !== 'look' && !button) return false;
    this.pointers.set(id, { kind, x, y, originX: x, originY: y, radius: Math.max(1, radius) });
    if (button) {
      this.queued.add(kind);
      if (button.mode === 'toggle') this.toggles.set(kind, !this.toggles.get(kind));
      this.onAction?.(kind);
    }
    return true;
  }

  move(id, x, y) {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    if (pointer.kind === 'move') {
      const dx = (x - pointer.originX) / pointer.radius;
      const dy = (y - pointer.originY) / pointer.radius;
      const length = Math.hypot(dx, dy);
      const magnitude = clamp((length - this.deadZone) / (1 - this.deadZone), 0, 1);
      this.strafe = length ? (dx / length) * magnitude : 0;
      this.forward = length ? (-dy / length) * magnitude : 0;
      this.stickX = (dx / Math.max(1, length)) * pointer.radius;
      this.stickY = (dy / Math.max(1, length)) * pointer.radius;
      // Hysteresis keeps sprint from chattering around the rim; sideways
      // and backwards movement stay a walk.
      this.sprint = this.forward > (this.sprint ? 0.72 : 0.92);
    } else if (this._isLookSource(pointer.kind)) {
      // With a look button (fire) held, it owns the camera so two right-hand
      // fingers do not double the turn.
      const lookButtonHeld = [...this.pointers.values()].some((p) => p.kind !== 'look' && this._isLookSource(p.kind));
      if (pointer.kind !== 'look' || !lookButtonHeld) {
        const dx = (x - pointer.x) * this.lookScale * this.sensitivity;
        const dy = (y - pointer.y) * this.lookScale * this.sensitivity;
        this.lookX += dx;
        this.lookY += dy;
        this.onLook?.(dx, dy);
      }
    }
    pointer.x = x;
    pointer.y = y;
  }

  end(id, cancelled = false) {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    this.pointers.delete(id);
    if (pointer.kind === 'move') {
      this.strafe = this.forward = this.stickX = this.stickY = 0;
      this.sprint = false;
    }
    // A cancelled touch (system gesture, palm rejection) never fires.
    if (cancelled && this.buttons.get(pointer.kind)?.mode !== 'toggle') this.queued.delete(pointer.kind);
  }

  held(kind) {
    for (const pointer of this.pointers.values()) if (pointer.kind === kind) return true;
    return false;
  }

  /** Button state as reported by read(): toggled, held, or tapped since the last read. */
  active(id) {
    const button = this.buttons.get(id);
    if (!button) return false;
    if (button.mode === 'toggle') return Boolean(this.toggles.get(id));
    return this.held(id) || this.queued.has(id);
  }

  _isLookSource(kind) {
    return kind === 'look' || Boolean(this.buttons.get(kind)?.look);
  }

  _sprinting() {
    if (!this.autoSprint || !this.sprint) return false;
    for (const button of this.buttons.values()) {
      if (button.cancelsSprint && this.active(button.id)) return false;
    }
    return true;
  }

  /**
   * One frame of input in the controller's shape.  Consumes accumulated look
   * and one-shot presses, so call it exactly once per frame.
   */
  read() {
    const input = {
      move: { x: this.strafe, y: this.forward },
      look: { x: this.lookX, y: this.lookY },
      sprint: this._sprinting(),
    };
    for (const id of this.buttons.keys()) {
      input[id] = this.active(id);
      input[`${id}Pressed`] = this.queued.has(id);
    }
    this.queued.clear();
    this.lookX = this.lookY = 0;
    return input;
  }

  /** Non-consuming snapshot for UI and debugging. */
  getState() {
    const state = { pointers: this.pointers.size, forward: this.forward, strafe: this.strafe, sprint: this._sprinting() };
    for (const id of this.buttons.keys()) state[id] = this.active(id);
    return state;
  }
}

const STYLE = `
.vk-touch { --vk-size: 56px; --vk-left: max(18px, env(safe-area-inset-left)); --vk-right: max(18px, env(safe-area-inset-right));
  --vk-bottom: max(18px, env(safe-area-inset-bottom)); --vk-accent: #e1c399;
  position: fixed; inset: 0; z-index: 6; pointer-events: none; color: #eaf9f2;
  font: 600 10px/1 system-ui, sans-serif; letter-spacing: .08em; -webkit-touch-callout: none; user-select: none; }
.vk-touch[hidden] { display: none; }
.vk-touch [data-touch] { touch-action: none; pointer-events: auto; }
.vk-touch.vk-touch-disabled [data-touch] { pointer-events: none; opacity: .35; }
.vk-touch-look { position: absolute; inset: 0 0 0 44%; }
.vk-touch-move { position: absolute; left: var(--vk-left); bottom: var(--vk-bottom); width: 40%; height: 55%; }
.vk-touch-stick { position: absolute; left: 92px; bottom: 12px; width: 136px; height: 136px; margin-left: -68px;
  border: 1px solid #d9f8ec55; border-radius: 50%; box-shadow: inset 0 0 18px #0003; pointer-events: none;
  background: radial-gradient(circle, #b7f9d909 46%, #b7f9d915 47%, #b7f9d903 69%); }
.vk-touch-stick.vk-floating { margin-top: -68px; bottom: auto; }
.vk-touch-stick span { position: absolute; bottom: -17px; width: 100%; text-align: center; color: #d6ebe5ad; font-size: 9px; }
.vk-touch-knob { position: absolute; left: 44px; top: 44px; width: 46px; height: 46px; border-radius: 50%;
  border: 1px solid #e0fff599; background: #ccf7e426; box-shadow: 0 3px 12px #0004; }
.vk-touch-stick.vk-engaged { border-color: #e0fff5a6; }
.vk-touch-stick.vk-sprinting { border-color: var(--vk-accent); }
.vk-touch-stick.vk-sprinting span { color: var(--vk-accent); }
.vk-touch-button { position: absolute; width: var(--vk-size); height: var(--vk-size); padding: 0;
  display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 5px;
  border-radius: 50%; border: 1px solid #dbf5ec66; background: #06131b70; color: #edf9f5;
  font: inherit; text-shadow: 0 1px 4px #000; -webkit-tap-highlight-color: transparent; }
.vk-touch-button svg { width: 42%; height: 42%; fill: none; stroke: currentColor; stroke-width: 1.6;
  stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.vk-touch-button span { pointer-events: none; font-size: 9px; }
.vk-touch-button.vk-pressed { border-color: var(--vk-accent); color: var(--vk-accent); background: #24533cd9; }
@media (orientation: portrait) {
  .vk-touch { --vk-size: 50px; --vk-left: max(8px, env(safe-area-inset-left)); --vk-right: max(10px, env(safe-area-inset-right)); }
  .vk-touch-move { width: 38%; height: 38%; }
}`;

function injectStyle(documentRef) {
  if (documentRef.querySelector('style[data-vk-touch]')) return;
  const style = documentRef.createElement('style');
  style.dataset.vkTouch = '';
  style.textContent = STYLE;
  documentRef.head.append(style);
}

/** Offset from a safe-area-aware edge variable. */
function edge(value, inset) {
  return `calc(var(${inset}) + ${Number(value) || 0}px)`;
}

export class TouchControls {
  /**
   * @param {object} options
   * @param {HTMLElement} [options.container=document.body] parent for the overlay
   * @param {object[]} [options.buttons=DEFAULT_BUTTONS]
   * @param {number} [options.sensitivity=1] look multiplier (0.4..2)
   * @param {string|null} [options.storageKey=null] localStorage key for sensitivity
   * @param {string[]} [options.pointerTypes=['touch']] pointer types handled
   * @param {boolean} [options.forceTouchMode=false] treat the device as touch
   * Also: onLook, onAction, onModeChange(mode), deadZone, autoSprint, lookScale.
   */
  constructor({
    container = globalThis.document?.body,
    buttons = DEFAULT_BUTTONS,
    sensitivity = 1,
    storageKey = null,
    pointerTypes = ['touch'],
    forceTouchMode = false,
    onLook = null,
    onAction = null,
    onModeChange = null,
    deadZone,
    autoSprint,
    lookScale,
  } = {}) {
    if (!container?.ownerDocument) throw new TypeError('TouchControls requires a DOM container');
    const documentRef = container.ownerDocument;
    const view = documentRef.defaultView ?? globalThis;
    this.container = container;
    this.storageKey = storageKey;
    this.pointerTypes = new Set(pointerTypes);
    this.onModeChange = onModeChange;
    this.enabled = false;
    this.visible = false;
    this.mode = Boolean(forceTouchMode || view.matchMedia?.('(pointer: coarse)').matches);
    this.sensitivity = clamp(Number(sensitivity) || 1, 0.4, 2);
    if (storageKey) {
      try {
        const saved = Number(view.localStorage.getItem(storageKey));
        if (saved > 0) this.sensitivity = clamp(saved, 0.4, 2);
      } catch { /* Storage is optional in private browsing and embeds. */ }
    }
    this.input = new TouchInput({
      buttons, onLook, onAction, deadZone, autoSprint, lookScale, sensitivity: this.sensitivity,
    });

    injectStyle(documentRef);
    const root = documentRef.createElement('div');
    root.className = 'vk-touch vk-touch-disabled';
    root.hidden = true;
    root.setAttribute('aria-label', 'Touch game controls');
    root.innerHTML = `<div class="vk-touch-look" data-touch="look"></div>
      <div class="vk-touch-move" data-touch="move"><div class="vk-touch-stick"><div class="vk-touch-knob"></div><span>MOVE</span></div></div>`;
    for (const button of this.input.buttons.values()) {
      const element = documentRef.createElement('button');
      element.type = 'button';
      element.className = `vk-touch-button vk-touch-${button.id}`;
      element.dataset.touch = button.id;
      element.setAttribute('aria-label', button.label);
      if (button.mode === 'toggle') element.setAttribute('aria-pressed', 'false');
      element.innerHTML = `${button.icon ?? ''}<span>${button.label}</span>`;
      if (button.size) Object.assign(element.style, { width: `${button.size}px`, height: `${button.size}px` });
      if (button.left !== undefined) element.style.left = edge(button.left, '--vk-left');
      else element.style.right = edge(button.right, '--vk-right');
      if (button.top !== undefined) element.style.top = `${Number(button.top) || 0}px`;
      else element.style.bottom = edge(button.bottom, '--vk-bottom');
      root.append(element);
    }
    container.append(root);
    this.element = root;
    this.stick = root.querySelector('.vk-touch-stick');
    this.knob = root.querySelector('.vk-touch-knob');
    this.stickLabel = this.stick.querySelector('span');
    this.moveZone = root.querySelector('.vk-touch-move');
    this.captures = new Map();
    root.dataset.touchMode = String(this.mode);

    this._listeners = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this._listeners.push(() => target.removeEventListener(type, handler, options));
    };
    listen(documentRef, 'pointerdown', (event) => {
      if (event.pointerType !== 'touch' || this.mode) return;
      this.mode = true;
      root.dataset.touchMode = 'true';
      this.onModeChange?.(true);
    }, { capture: true, passive: true });
    listen(root, 'pointerdown', (event) => {
      const target = event.target.closest?.('[data-touch]');
      if (!this.enabled || !this.pointerTypes.has(event.pointerType) || !target) return;
      event.preventDefault();
      const kind = target.dataset.touch;
      const radius = this.stick.offsetWidth * 0.36 || 50;
      if (!this.input.begin(event.pointerId, kind, event.clientX, event.clientY, radius)) return;
      // Capture can throw if the pointer already ended; ownership is tracked
      // by TouchInput either way.
      try { target.setPointerCapture?.(event.pointerId); } catch { /* ignore */ }
      this.captures.set(event.pointerId, target);
      if (kind === 'move') {
        // Floating stick: it recentres under the thumb.
        const bounds = this.moveZone.getBoundingClientRect();
        this.stick.style.left = `${event.clientX - bounds.left}px`;
        this.stick.style.top = `${event.clientY - bounds.top}px`;
        this.stick.classList.add('vk-floating');
      }
      this.render();
    });
    listen(root, 'pointermove', (event) => {
      if (!this.input.pointers.has(event.pointerId)) return;
      event.preventDefault();
      this.input.move(event.pointerId, event.clientX, event.clientY);
      this.render();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      listen(root, type, (event) => {
        this.input.end(event.pointerId, type !== 'pointerup');
        this.captures.delete(event.pointerId);
        this.render();
      });
    }
    listen(root, 'contextmenu', (event) => event.preventDefault());
    // Rotation / browser chrome changes invalidate stick origins.
    const onResize = () => this.reset();
    listen(view, 'resize', onResize);
    if (view.visualViewport) listen(view.visualViewport, 'resize', onResize);
  }

  /** Per-frame input (see file header).  Returns neutral input when disabled. */
  read() {
    return this.input.read();
  }

  setSensitivity(value) {
    if (!Number.isFinite(Number(value))) return;
    this.sensitivity = clamp(Number(value), 0.4, 2);
    this.input.sensitivity = this.sensitivity;
    if (!this.storageKey) return;
    try {
      this.container.ownerDocument.defaultView.localStorage.setItem(this.storageKey, String(this.sensitivity));
    } catch { /* optional */ }
  }

  /** Show/enable the overlay (only in touch mode). */
  setEnabled(enabled, visible = enabled) {
    const nextEnabled = Boolean(enabled && this.mode);
    const nextVisible = Boolean(visible && this.mode);
    if (this.enabled && !nextEnabled) this.reset();
    this.enabled = nextEnabled;
    this.visible = nextVisible;
    this.element.hidden = !nextVisible;
    this.element.classList.toggle('vk-touch-disabled', !nextEnabled);
  }

  reset() {
    this.input.reset();
    for (const [id, target] of this.captures) {
      if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id);
    }
    this.captures.clear();
    this.render();
  }

  render() {
    const state = this.input.getState();
    this.knob.style.transform = `translate(${this.input.stickX}px, ${this.input.stickY}px)`;
    const moving = this.input.held('move');
    if (!moving) {
      this.stick.style.left = this.stick.style.top = '';
      this.stick.classList.remove('vk-floating');
    }
    this.stick.classList.toggle('vk-engaged', moving);
    this.stick.classList.toggle('vk-sprinting', state.sprint);
    this.stickLabel.textContent = state.sprint ? 'SPRINT' : 'MOVE';
    for (const element of this.element.querySelectorAll('button[data-touch]')) {
      const id = element.dataset.touch;
      const button = this.input.buttons.get(id);
      const pressed = button.mode === 'toggle' ? state[id] : this.input.held(id);
      element.classList.toggle('vk-pressed', pressed);
      if (button.mode === 'toggle') element.setAttribute('aria-pressed', String(pressed));
    }
  }

  getState() {
    return { mode: this.mode, enabled: this.enabled, visible: this.visible, sensitivity: this.sensitivity, ...this.input.getState() };
  }

  dispose() {
    for (const remove of this._listeners) remove();
    this._listeners = [];
    this.element.remove();
  }
}

export default TouchControls;
