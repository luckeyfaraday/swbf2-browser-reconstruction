# Selected E-11 heat recovery

`BF2-E11-HEAT-002` builds on `BF2-E11-ROUTING-001`. The selected source
component supplies 24 mapped scalars/intervals; retained source hashes and
JSON field pointers are verified by `web/test/weapon-heat.test.js`.

The bounded additional export contains only shared heat schematics and the
super-success affector. Its ID 3998562258 matches the heat graph receivers,
which feed both the zero-heat branch and ResetHeat. The graph routes default
duration 6 through a math node to the affector. Optional modifiers exist.
The class schematics have no recovered executable body.

Run `python tools/gameplay-recovery/inspect-e11-heat-state.py` from the project
root to regenerate `e11-heat-state-evidence.json` and
`web/public/assets/weapon-heat.json`. The latter is explicitly bound to weapon
GUID `68f9d096-0221-11e6-ba00-c572adcfb1b9`; synthetic fixtures or other weapons
must not silently acquire the E-11 heat settings.

`web/src/weapon-heat.js` exports mutable per-actor heat state:

- `createHeatState()` resets each new life.
- `advanceHeat(state, dt, config, {firing})` handles frame time across boundaries.
- `heatBlocksFire(state)` reports vent/overheat/exit lockout.
- `applyShotHeat(state, config, multiplier)` adds heat on an accepted shot.
- `startVenting(state, config)` starts a manual vent.
- `attemptActiveCooldown(state, config)` consumes one eligible cooling attempt.
- `activeCooldownWindow(state, config)` provides the current HUD window.

Observed configuration is separate from reconstructed transitions. In particular,
`OverheatDropDelay=5` is observed, but **its use as ordinary cooling delay after
the last shot has not been established by native code or runtime**. The overheat
penalty order, .001 reset threshold, -1 vent-exit fallback, absolute descending
heat intervals, minimum-trigger clock and failure behavior are explicit inferences.
The native super interval may be relative to the containing success interval;
difficulty changes and affector overrides remain unresolved.

Module validation covers 25-shot accumulation, ordinary cooldown delay,
overheat recovery, timed vent, active success/failure, super-success duration,
coarse/fine frame agreement and source hashes. These checks establish the browser
state machine's consistency, not native gameplay parity.
