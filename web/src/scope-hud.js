import {buildScopeArtworkSvg, evaluateScopeArtworkControls} from './scope-artwork.js';

export const SCOPE_HUD_RUNTIME_POLICY = Object.freeze({
  evidenceId: 'BF2-SCOPE-HUD-RUNTIME-001',
  source: 'Original rifle scope paths, palette, linear rise6/fall8 velocity, alpha expressions and timeline curve.',
  bridge: 'Accepted browser aim drives the source UI fraction on simulation ticks; native event scheduling remains unresolved.',
  random: 'Source fraction > float32(.95) opens a gate feeding a .01 world-time Delay loop; delay output samples both original ranges. Browser uses a deterministic generator and continuous simulation-time event schedule; native PRNG, default random output, scheduler rounding and duplicate-delay priority remain unresolved. Initial samples use authored lower bounds.',
  properties: 'Timeline background alpha selected; original palette22 selected. External alpha and color-state precedence remain unresolved.',
  scale: 'Source dispersionDegrees drives the authored target scale directly; native .015s transform interpolation remains unresolved.',
  rendering: 'Source radii interpreted as incoming circular arcs, palette converted linear-to-sRGB, centered1920x1080 SVG. Native glow, additive UI composition, scanner and radial notches remain incomplete.',
});

export function createScopeHudState(document) {
  if (document?.evidenceId !== 'BF2-SCOPE-ARTWORK-001') throw new Error('Original scope artwork is required');
  const initialSeed = 0x51c0a280;
  let fraction = 0, aiming = false, alive = true, dispersionAngle = 0, seed = initialSeed;
  let clock = 0, gateOpen = false, nextTrigger = null, randomTriggers = 0;
  const controls = document.controlEvidence;
  const interval = controls.randomTrigger.delay;
  if (!(interval > 0 && Number.isFinite(interval))) throw new Error('Original scope random interval is required');
  // evaluateScopeArtworkControls compares a float32 signal strictly to float32(.95).
  // This midpoint is where a monotonically changing JS fraction rounds to the next
  // float above the source threshold (tie rounds to its even mantissa).
  const threshold = Math.fround(.95);
  const thresholdBits = new Uint32Array(new Float32Array([threshold]).buffer)[0];
  const nextFloat = new Float32Array(new Uint32Array([thresholdBits + 1]).buffer)[0];
  const gateBoundary = (threshold + nextFloat) / 2;
  let outlineRandom = controls.outlineAlpha.randomRange[0], scannerRandom = controls.scannerAlpha.randomRange[0];
  const sample = range => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return range[0] + (range[1] - range[0]) * seed / 2 ** 32;
  };
  const advanceClock = end => {
    while (nextTrigger !== null && nextTrigger <= end + 1e-12) {
      const eventTime = nextTrigger;
      outlineRandom = sample(controls.outlineAlpha.randomRange);
      scannerRandom = sample(controls.scannerAlpha.randomRange);
      randomTriggers++;
      // Native Delay.Out reaches RandomFloat.In independently of EventGate. A
      // pending output can therefore sample once after the gate closes; it only
      // schedules another delay while the gate remains open.
      nextTrigger = gateOpen ? eventTime + interval : null;
    }
    clock = end;
  };
  const snapshot = () => ({...evaluateScopeArtworkControls(document, {fraction, outlineRandom, scannerRandom, dispersionAngle}),
    alive, aiming, dispersionAngle, random: {outline: outlineRandom, scanner: scannerRandom,
      triggers: randomTriggers, gateOpen, nextTrigger, clock, interval}, policy: SCOPE_HUD_RUNTIME_POLICY});
  return {
    update(dt, {aiming: requested = false, alive: nextAlive = true, dispersionDegrees = 0} = {}) {
      if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(dispersionDegrees) || dispersionDegrees < 0) throw new RangeError('Invalid scope HUD timing or dispersion');
      alive = Boolean(nextAlive);
      const next = alive && Boolean(requested);
      aiming = next; dispersionAngle = dispersionDegrees;
      if (!alive) {
        fraction = 0; gateOpen = false; nextTrigger = null; clock += dt;
        return snapshot();
      }
      const velocity = aiming ? controls.mainLogicFraction.riseVelocity : -controls.mainLogicFraction.fallVelocity;
      const end = clock + dt;
      const nextFraction = Math.max(0, Math.min(1, fraction + dt * velocity));
      const nextGate = Math.fround(nextFraction) > threshold;
      if (nextGate !== gateOpen) {
        const crossing = Math.max(clock, Math.min(end, clock + (gateBoundary - fraction) / velocity));
        advanceClock(crossing);
        gateOpen = nextGate;
        // Source RemoveDuplicateEvents=true. Keep an existing pending delay on
        // rapid reversal; exact native replacement/retention priority is unknown.
        if (gateOpen && nextTrigger === null) nextTrigger = clock + interval;
      }
      advanceClock(end);
      fraction = nextFraction;
      return snapshot();
    },
    reset() {
      fraction = 0; aiming = false; alive = true; dispersionAngle = 0; seed = initialSeed;
      clock = 0; gateOpen = false; nextTrigger = null; randomTriggers = 0;
      outlineRandom = controls.outlineAlpha.randomRange[0]; scannerRandom = controls.scannerAlpha.randomRange[0];
      return snapshot();
    },
    snapshot,
  };
}

/** Build source paths once. Presentation changes only authored group properties. */
export function createScopeHudView(element, document) {
  const artwork = buildScopeArtworkSvg(document, {names: ['ScopeGlow', 'ScopeOutline'],
    elementValues: {ScopeGlow: {alpha: 0}, ScopeOutline: {alpha: 0, paletteIndex: 22}},
    containerScale: [1, 1], colorEncoding: 'linear-to-srgb', allowInferredCircularArcs: true});
  element.innerHTML = artwork.svg;
  const svg = element.querySelector('svg'), container = svg.firstElementChild;
  const background = svg.querySelector('[data-source-element="ScopeGlow"]');
  const outline = svg.querySelector('[data-source-element="ScopeOutline"]');
  const [width, height] = document.layout.size;
  let visible = false;
  return {
    update(state, {enabled = true} = {}) {
      visible = Boolean(enabled && state?.visible && state.alive);
      element.hidden = !visible;
      if (!state) return;
      background.setAttribute('opacity', state.backgroundAlpha.timeline);
      outline.setAttribute('opacity', state.outlineAlpha);
      outline.setAttribute('data-source-glow-width', state.outlineGlowWidth.timeline);
      const scale = state.targetContainerScale;
      container.setAttribute('transform', `translate(${width / 2} ${height / 2}) scale(${scale[0]} ${scale[1]}) translate(${-width / 2} ${-height / 2})`);
    },
    snapshot: () => ({visible, evidenceId: document.evidenceId, policy: SCOPE_HUD_RUNTIME_POLICY,
      omittedNativeFeatures: artwork.omittedNativeFeatures, inferred: artwork.inferred}),
  };
}
