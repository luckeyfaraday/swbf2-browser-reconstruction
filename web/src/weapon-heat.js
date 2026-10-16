// Selected E-11 component values, not the legacy FiringFunction.OverHeat block.
// BF2-E11-HEAT-002: tools/gameplay-recovery/e11-heat-state-evidence.json.
// The values and graph connections are observed. Timing/state interpretation
// below is a reconstruction until the native component can be measured.
export const RECOVERED_E11_HEAT = Object.freeze({
  heatPerShot: .04, coolingPerSecond: .3, heatIncreasePerSecond: 0,
  heatMultiplier: 1, heatDropMultiplier: 1, warningThreshold: .7,
  coolingDelay: 5, overheatPenalty: 1, overheatedDropMultiplier: 1.5,
  resetThreshold: .001, exitOverheatDelay: .3, preventHeatDropWhileFiring: false,
  ventDuration: 1, exitVentingDelay: -1, activeCooldownEnabled: true,
  minimumTriggerHeat: .1, minimumTriggerHeatTime: .1,
  successWindow: Object.freeze([.8, .65]), superWindow: Object.freeze([.4, .3]),
  successPenalty: .2, failurePenalty: .3,
  successExitDelay: 0, failureExitDelay: 0, superSuccessDuration: 6,
});

export const HEAT_FIDELITY = Object.freeze({
  evidenceId: 'BF2-E11-HEAT-002', runtimeObserved: false,
  observed: 'Selected component scalars and shared heat graph baseline/super-success branches.',
  inferred: 'Normalized full heat is 1; delay 5 starts after the last shot; overheat penalty precedes cooling; .001 is the reset threshold; negative vent exit uses the normal exit delay; active zones use descending heat.',
  unknown: 'Native event ordering, timer overlap, difficulty changes, active-input mapping, affector initialization and override precedence.',
});

const EPS = 1e-10;
const within = (value, [start, end]) => value <= Math.max(start, end) + EPS && value >= Math.min(start, end) - EPS;

export function createHeatState() {
  return {
    heat: 0, phase: 'ready', delayRemaining: 0, penaltyRemaining: 0,
    exitRemaining: 0, ventRemaining: 0, ventStartHeat: 0,
    boostRemaining: 0, coolingElapsed: 0, activeAttempted: false,
    lastCooldownResult: null,
  };
}

export function heatBlocksFire(state) { return state.phase !== 'ready' || state.heat >= 1 - EPS; }

export function applyShotHeat(state, config = RECOVERED_E11_HEAT, multiplier = 1) {
  if (heatBlocksFire(state)) return false;
  if (!Number.isFinite(multiplier) || multiplier < 0) throw new RangeError('heat multiplier must be finite and nonnegative');
  const amount = state.boostRemaining > EPS ? 0 : config.heatPerShot * config.heatMultiplier * multiplier;
  state.heat = Math.min(1, state.heat + amount);
  state.delayRemaining = config.coolingDelay;
  state.lastCooldownResult = null;
  if (state.heat >= 1 - EPS) {
    state.heat = 1; state.phase = 'overheated';
    state.penaltyRemaining = config.overheatPenalty;
    state.coolingElapsed = 0; state.activeAttempted = false;
  }
  return true;
}

export function startVenting(state, config = RECOVERED_E11_HEAT) {
  if (state.phase !== 'ready' || state.heat <= EPS || !(config.ventDuration > 0)) return false;
  state.phase = 'venting'; state.ventStartHeat = state.heat;
  state.ventRemaining = config.ventDuration; state.penaltyRemaining = 0;
  state.coolingElapsed = 0; state.activeAttempted = false;
  state.lastCooldownResult = null;
  return true;
}

export function activeCooldownWindow(state, config = RECOVERED_E11_HEAT) {
  if (!config.activeCooldownEnabled || !['overheated', 'venting'].includes(state.phase)
      || state.activeAttempted || state.penaltyRemaining > EPS
      || state.heat + EPS < config.minimumTriggerHeat
      || state.coolingElapsed + EPS < config.minimumTriggerHeatTime) return null;
  if (within(state.heat, config.superWindow)) return 'super-success';
  if (within(state.heat, config.successWindow)) return 'success';
  return 'failure';
}

function beginExit(state, delay) {
  state.heat = 0; state.delayRemaining = 0; state.penaltyRemaining = 0;
  state.ventRemaining = 0; state.exitRemaining = Math.max(0, delay);
  state.phase = state.exitRemaining > EPS ? 'exiting' : 'ready';
}

export function attemptActiveCooldown(state, config = RECOVERED_E11_HEAT) {
  const result = activeCooldownWindow(state, config);
  if (result === null) return null;
  state.activeAttempted = true; state.lastCooldownResult = result;
  if (result === 'failure') {
    state.penaltyRemaining = config.failurePenalty + config.failureExitDelay;
  } else {
    if (result === 'super-success') state.boostRemaining = config.superSuccessDuration;
    beginExit(state, config.successPenalty + config.successExitDelay);
  }
  return result;
}

// Consume every phase boundary inside a frame, so an idle/cooling frame does
// not throw away the fraction after a delay, penalty, vent, or exit completes.
export function advanceHeat(state, dt, config = RECOVERED_E11_HEAT, { firing = false } = {}) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('heat dt must be finite and nonnegative');
  state.boostRemaining = Math.max(0, state.boostRemaining - dt);
  let remaining = dt;
  while (remaining > EPS) {
    if (state.phase === 'exiting') {
      const used = Math.min(remaining, state.exitRemaining);
      state.exitRemaining = Math.max(0, state.exitRemaining - used); remaining -= used;
      if (state.exitRemaining <= EPS) { state.exitRemaining = 0; state.phase = 'ready'; }
      continue;
    }
    if (state.phase === 'ready') {
      const delay = Math.min(remaining, state.delayRemaining);
      state.delayRemaining = Math.max(0, state.delayRemaining - delay); remaining -= delay;
      if (!(firing && config.preventHeatDropWhileFiring)) {
        state.heat = Math.max(0, state.heat - config.coolingPerSecond * config.heatDropMultiplier * remaining);
      }
      break;
    }
    if (state.penaltyRemaining > EPS) {
      const used = Math.min(remaining, state.penaltyRemaining);
      state.penaltyRemaining = Math.max(0, state.penaltyRemaining - used); remaining -= used;
      continue;
    }
    const venting = state.phase === 'venting';
    const rate = venting ? state.ventStartHeat / config.ventDuration
      : config.coolingPerSecond * config.heatDropMultiplier * config.overheatedDropMultiplier;
    const untilCooled = venting ? state.ventRemaining : Math.max(0, state.heat - config.resetThreshold) / rate;
    const used = Math.min(remaining, untilCooled);
    state.heat = Math.max(0, state.heat - rate * used);
    if (venting) state.ventRemaining = Math.max(0, state.ventRemaining - used);
    state.coolingElapsed += used; remaining -= used;
    if (untilCooled <= used + EPS) {
      const exitDelay = venting && config.exitVentingDelay >= 0 ? config.exitVentingDelay : config.exitOverheatDelay;
      beginExit(state, exitDelay);
    } else break;
  }
  return state;
}
