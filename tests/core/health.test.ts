import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHealth, evaluateSignal, windowElapsed } from '../../src/core/health.ts';
import { addMs } from '../../src/core/types.ts';
import { T0, signal } from './_fixtures.ts';

const WINDOW = { from: T0, to: addMs(T0, 10 * 60_000) };

describe('health evaluation (LC7 / Q19)', () => {
  test('a bound, fresh, sufficient signal within threshold passes', () => {
    const e = evaluateSignal(signal(), T0);
    assert.equal(e.result, 'PASS');
    assert.equal(e.synthetic, false);
  });

  test('Q19: too few samples is INSUFFICIENT_DATA, never PASS', () => {
    const e = evaluateSignal(signal({ samples: 2, minSamples: 5, observed: 0 }), T0);
    assert.equal(e.result, 'INSUFFICIENT_DATA');
    assert.match(e.detail, /samples 2 < required 5/);
  });

  test('Q19: stale telemetry is INSUFFICIENT_DATA', () => {
    const e = evaluateSignal(signal({ lastSampleAt: T0, maxStalenessMs: 60_000 }), addMs(T0, 61_000));
    assert.equal(e.result, 'INSUFFICIENT_DATA');
    assert.match(e.detail, /old exceeds/);
    assert.equal(evaluateSignal(signal({ lastSampleAt: undefined }), T0).result, 'INSUFFICIENT_DATA');
  });

  test('Q19: an unavailable required probe or missing observation is INSUFFICIENT_DATA', () => {
    assert.equal(evaluateSignal(signal({ probeAvailable: false }), T0).result, 'INSUFFICIENT_DATA');
    assert.equal(evaluateSignal(signal({ observed: undefined }), T0).result, 'INSUFFICIENT_DATA');
  });

  test('threshold operators decide PASS vs BREACH', () => {
    assert.equal(evaluateSignal(signal({ threshold: { op: '<', value: 0.01 }, observed: 0.02 }), T0).result, 'BREACH');
    assert.equal(evaluateSignal(signal({ threshold: { op: '>=', value: 99 }, observed: 99 }), T0).result, 'PASS');
    assert.equal(evaluateSignal(signal({ threshold: { op: '>', value: 99 }, observed: 99 }), T0).result, 'BREACH');
    assert.equal(evaluateSignal(signal({ threshold: { op: '==', value: 200 }, observed: 200 }), T0).result, 'PASS');
    assert.equal(evaluateSignal(signal({ threshold: { op: '<=', value: 1 }, observed: 1 }), T0).result, 'PASS');
  });

  test('Q19: BREACH takes precedence over INSUFFICIENT_DATA, which takes precedence over PASS', () => {
    const breach = signal({ name: 'errors', observed: 0.5 });
    const insufficient = signal({ name: 'latency', samples: 0 });
    const ok = signal({ name: 'ok' });
    assert.equal(evaluateHealth([ok, insufficient, breach], WINDOW, T0).result, 'BREACH');
    assert.equal(evaluateHealth([ok, insufficient], WINDOW, T0).result, 'INSUFFICIENT_DATA');
    assert.equal(evaluateHealth([ok], WINDOW, T0).result, 'PASS');
  });

  test('Q19: no declared signals can never be PASS', () => {
    const e = evaluateHealth([], WINDOW, T0, { candidate: 'c1', environment: 'staging' });
    assert.equal(e.result, 'INSUFFICIENT_DATA');
    assert.equal(e.candidate, 'c1');
    assert.equal(e.environment, 'staging');
  });

  test('synthetic traffic is identified as such', () => {
    const e = evaluateHealth([signal({ synthetic: true })], WINDOW, T0);
    assert.equal(e.signals[0]?.synthetic, true);
  });

  test('windowElapsed: a PASS before the window ends is not a soak result', () => {
    assert.equal(windowElapsed(WINDOW, T0), false);
    assert.equal(windowElapsed(WINDOW, WINDOW.to), true);
  });
});
