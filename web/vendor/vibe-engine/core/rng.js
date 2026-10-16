// Seeded randomness, math helpers and value noise (from opus-br's util.js).
// Rule: everything that shapes the game draws from ctx.rand (the match stream). Cosmetics that must never change
// how a match plays (particles, camera shake, sound pitch) use ctx.lookRand or Math.random. Same seed + same
// commands => same match, which is what `vibe verify` checks.

export function makeRng(seed) {
  let s = seed | 0;
  const next = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  next.state = () => s;
  next.range = (a, b) => a + next() * (b - a);
  next.int = (a, b) => Math.floor(a + next() * (b - a + 1));
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  next.chance = p => next() < p;
  next.weighted = obj => { let sum = 0; for (const k in obj) sum += obj[k]; let r = next() * sum; for (const k in obj) { r -= obj[k]; if (r <= 0) return k; } return Object.keys(obj)[0]; };
  next.shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return next;
}

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt)); // frame-rate independent easing
export function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
export const r1 = v => Math.round(v * 10) / 10;
export const r2 = v => Math.round(v * 100) / 100;

// Value noise and fBm. The permutation table comes from the rng you pass, so terrain follows the seed.
export function makeNoise(rng) {
  const PERM = new Uint8Array(512);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  function noise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const h = (a, b) => PERM[(PERM[a & 255] + b) & 255] / 255;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    return lerp(lerp(h(xi, zi), h(xi + 1, zi), u), lerp(h(xi, zi + 1), h(xi + 1, zi + 1), u), v) * 2 - 1;
  }
  noise.fbm = (x, z, octaves = 4) => { let s = 0, a = .5, f = 1; for (let i = 0; i < octaves; i++) { s += a * noise(x * f, z * f); f *= 2; a *= .5; } return s; };
  return noise;
}

// FNV-1a over a JSON-able value: the determinism fingerprint.
export function hashValue(v) {
  let h = 0x811c9dc5 >>> 0;
  const s = JSON.stringify(v, (k, x) => typeof x === 'number' ? (Object.is(x, -0) ? 0 : Math.round(x * 1e6) / 1e6) : x);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, '0');
}
