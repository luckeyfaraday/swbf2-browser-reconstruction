// Controller navigation for HTML menus. Feed it the state from core/gamepad.js every frame while a menu is open:
//   D-pad or left stick   move focus to the nearest item in that direction (held: repeats)
//   left / right          on a slider or select, change its value (fires 'input' and 'change' like a mouse would)
//   A                     click the focused item          B   back() (close a submenu, resume...)
// Items are whatever can be focused inside `root` and is visible, so a game's existing menu works unchanged;
// mark extra targets with [data-nav] and keep an item out with [data-nav-skip]. Style focus with :focus.
//
//   const nav = createMenuNav({ root: document.querySelector('#menu'), back: () => menu.back() });
//   nav.update(pad.poll(dt), dt);   // returns true while the menu is visible and handled the controller

const ITEMS = 'button, input, select, textarea, a[href], [tabindex], [data-nav]';

export function createMenuNav({ root, items = ITEMS, back = null, onMove = null, repeatDelay = 0.38, repeatRate = 0.09, stick = 0.5 } = {}) {
  let held = '', heldFor = 0, nextRepeat = 0, previous = {};

  const visible = el => !el.closest('[hidden], [inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const list = () => [...root.querySelectorAll(items)].filter(el => !el.disabled && !el.matches('[data-nav-skip], [tabindex="-1"]') && visible(el));
  const isOpen = () => !!root && !root.hidden && root.isConnected && visible(root);
  const adjustable = el => el && (el.matches('input[type=range]') || el.tagName === 'SELECT');

  function focus(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    onMove?.(el);
  }

  /** The nearest item whose centre lies in direction (dx, dy) from the focused one; off the edge, wrap around. */
  function neighbour(from, all, dx, dy) {
    const centre = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const c = centre(from);
    let best = null, bestScore = Infinity;
    for (const el of all) {
      if (el === from) continue;
      const p = centre(el), along = (p.x - c.x) * dx + (p.y - c.y) * dy, across = Math.abs((p.x - c.x) * dy) + Math.abs((p.y - c.y) * dx);
      if (along <= 1) continue;
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) return best;
    // Wrap: the item furthest the other way that lines up best.
    for (const el of all) {
      if (el === from) continue;
      const p = centre(el), along = -((p.x - c.x) * dx + (p.y - c.y) * dy), across = Math.abs((p.x - c.x) * dy) + Math.abs((p.y - c.y) * dx);
      const score = -along + across * 2;
      if (along > 1 && score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function adjust(el, sign) {
    if (el.tagName === 'SELECT') el.selectedIndex = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + sign));
    else {
      const min = Number(el.min || 0), max = Number(el.max || 100), step = el.step === 'any' ? (max - min) / 100 : Number(el.step) || 1;
      const amount = Math.max(step, Math.round((max - min) / 20 / step) * step);
      el.value = String(Math.max(min, Math.min(max, Number(el.value) + sign * amount)));
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function move(direction) {
    const all = list();
    if (!all.length) return;
    const current = all.includes(document.activeElement) ? document.activeElement : null;
    if (!current) return focus(all.find(el => el.matches('[autofocus], [data-nav-default]')) ?? all[0]);
    if ((direction === 'left' || direction === 'right') && adjustable(current)) return adjust(current, direction === 'right' ? 1 : -1);
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
    focus(neighbour(current, all, dx, dy));
  }

  /** Call every frame with the gamepad state. Returns true when the menu is open (the game should ignore the pad). */
  function update(pad, dt = 1 / 60) {
    if (!isOpen() || !pad?.connected) { held = ''; previous = pad?.buttons ?? {}; return isOpen(); }
    const b = pad.buttons, s = pad.sticks.left, edge = name => b[name] && !previous[name];
    const direction = b.up || s.y > stick ? 'up' : b.down || s.y < -stick ? 'down' : b.left || s.x < -stick ? 'left' : b.right || s.x > stick ? 'right' : '';
    if (direction !== held) { held = direction; heldFor = 0; nextRepeat = repeatDelay; if (direction) move(direction); }
    else if (direction && (heldFor += dt) >= nextRepeat) { nextRepeat += repeatRate; move(direction); }
    const current = document.activeElement;
    if (edge('a')) {
      if (current && root.contains(current) && current !== root) {
        if (current.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea')) current.select?.();
        else current.click();
      } else move('down');
    }
    if (edge('b')) back?.();
    previous = b;
    return true;
  }

  return { update, move, focus, items: list, get open() { return isOpen(); } };
}
