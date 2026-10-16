import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  RECOVERED_E11_HEAT as config, createHeatState, applyShotHeat,
  startVenting, attemptActiveCooldown, activeCooldownWindow, advanceHeat, heatBlocksFire,
} from '../src/weapon-heat.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message ?? ''}: ${actual} vs ${expected}`);
function heatToFull() {
  const s = createHeatState();
  for (let shot = 0; shot < 25; shot++) {
    assert.equal(applyShotHeat(s), true);
    if (shot < 24) advanceHeat(s, .2);
  }
  return s;
}

test('heat parameters match source fields and source artifact hashes', () => {
  const evidence = JSON.parse(fs.readFileSync(new URL('../../tools/gameplay-recovery/e11-heat-state-evidence.json', import.meta.url)));
  assert.equal(evidence.runtimeObserved, false);
  for (const source of evidence.sources) {
    const bytes = fs.readFileSync(new URL(`../../${source.file}`, import.meta.url));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.jsonSha256);
  }
  for (const [key, field] of Object.entries(evidence.runtimeParameters)) {
    assert.deepEqual(config[key], field.value, key);
    const source = JSON.parse(fs.readFileSync(new URL(`../../${field.file}`, import.meta.url)));
    const observed = field.jsonPointer.split('/').slice(1).reduce((v, part) => v[part], source);
    assert.deepEqual(observed, field.sourceValue, `${key} source pointer`);
  }
});

test('runtime heat document selects the source E-11 and preserves inference labels', () => {
  const document = JSON.parse(fs.readFileSync(new URL('../public/assets/weapon-heat.json', import.meta.url)));
  assert.equal(document.weapon.guid, '68f9d096-0221-11e6-ba00-c572adcfb1b9');
  assert.equal(document.weapon.name, 'Gameplay/Equipment/Rifles/E11/W_BlasterRifle_E11');
  assert.equal(document.provenance.runtimeObserved, false);
  assert.match(document.provenance.stateMachineEvidence, /Reconstructed interpretation/);
  assert.deepEqual(document.config, config);
});

test('25 source-cadence shots fill the E-11; its first 24 shots remain available', () => {
  const s = heatToFull();
  assert.equal(s.phase, 'overheated'); near(s.heat, 1);
  assert.equal(applyShotHeat(s), false);
  advanceHeat(s, .99); near(s.heat, 1);
  advanceHeat(s, .11); near(s.heat, .955);
});

test('natural cooling counts only time after the last-shot delay', () => {
  const s = createHeatState(); applyShotHeat(s);
  advanceHeat(s, 4.95); near(s.heat, .04);
  advanceHeat(s, .1); near(s.heat, .025);
  applyShotHeat(s); near(s.heat, .065);
  advanceHeat(s, 5); near(s.heat, .065);
  advanceHeat(s, 1); near(s.heat, 0);
});

test('overheat remains blocked through cooling and the final exit delay', () => {
  const s = heatToFull(), cooling = (1 - config.resetThreshold) / (.3 * 1.5);
  advanceHeat(s, 1 + cooling + .299);
  near(s.heat, 0); assert.equal(heatBlocksFire(s), true);
  advanceHeat(s, .001); assert.equal(heatBlocksFire(s), false);
  assert.equal(applyShotHeat(s), true);
});

test('manual vent takes the selected duration and does not instantly subtract heat', () => {
  const s = createHeatState(); for (let i = 0; i < 10; i++) applyShotHeat(s);
  assert.equal(startVenting(s), true); near(s.heat, .4);
  assert.equal(startVenting(s), false); assert.equal(applyShotHeat(s), false);
  advanceHeat(s, .5); near(s.heat, .2);
  advanceHeat(s, .5); near(s.heat, 0); assert.equal(s.phase, 'exiting');
  advanceHeat(s, .3); assert.equal(s.phase, 'ready');
});

test('active cooling observes minimum time, successful zone and recovery penalty', () => {
  const s = heatToFull();
  assert.equal(attemptActiveCooldown(s), null);
  advanceHeat(s, 1 + .25 / .45);
  assert.equal(activeCooldownWindow(s), 'success');
  assert.equal(attemptActiveCooldown(s), 'success'); near(s.heat, 0);
  advanceHeat(s, .199); assert.equal(applyShotHeat(s), false);
  advanceHeat(s, .001); assert.equal(applyShotHeat(s), true);
});

test('a missed active cooling attempt pauses cooling once, without repeated retries', () => {
  const s = heatToFull(); advanceHeat(s, 1.2);
  const heat = s.heat;
  assert.equal(attemptActiveCooldown(s), 'failure');
  advanceHeat(s, .2); near(s.heat, heat);
  assert.equal(attemptActiveCooldown(s), null);
  advanceHeat(s, .2); near(s.heat, heat - .045);
});

test('super success grants the observed baseline six-second zero-heat branch', () => {
  const s = heatToFull(); advanceHeat(s, 1 + .65 / .45);
  assert.equal(attemptActiveCooldown(s), 'super-success'); near(s.boostRemaining, 6);
  advanceHeat(s, .2); assert.equal(applyShotHeat(s), true); near(s.heat, 0);
  advanceHeat(s, 5.799); assert.equal(applyShotHeat(s), true); near(s.heat, 0);
  advanceHeat(s, .001); assert.equal(applyShotHeat(s), true); near(s.heat, .04);
});

test('phase transitions agree for coarse and fine time steps', () => {
  for (const vent of [false, true]) {
    const coarse = heatToFull(), fine = structuredClone(coarse);
    if (vent) {
      coarse.phase = fine.phase = 'ready'; coarse.heat = fine.heat = .92;
      startVenting(coarse); startVenting(fine);
    }
    advanceHeat(coarse, 4.1);
    for (let i = 0; i < 410; i++) advanceHeat(fine, .01);
    assert.equal(coarse.phase, fine.phase); near(coarse.heat, fine.heat);
    near(coarse.exitRemaining, fine.exitRemaining);
  }
});

test('respawn state is independent and invalid elapsed time is rejected', () => {
  const a = heatToFull(), b = createHeatState();
  assert.equal(heatBlocksFire(a), true); assert.equal(heatBlocksFire(b), false);
  assert.throws(() => advanceHeat(b, NaN), RangeError);
  assert.throws(() => advanceHeat(b, -1), RangeError);
});
