import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BandsConfig, DEFAULT_BANDS_YAML, breachIdentity, computeBaseline, evaluateBands, parseBandsYaml, type Sample } from '../../src/maintain/bands.ts';

const baseline = [9, 10, 11, 9, 10, 11, 9, 10, 11, 9, 10, 11]; // mean 10, std ~0.853
const cfg = BandsConfig.parse({
  metric: 'error_rate',
  direction: 'both',
  tiers: { '1sigma': { action: 'log' }, '2sigma': { action: 'diagnose', tools: 'Read' }, '3sigma': { action: 'propose', routes: ['pull_request'] } },
});
const at = '2026-09-11T00:00:00.000Z';
const s = (values: number[]): Sample[] => values.map((value, i) => ({ at: `2026-09-11T00:0${i}:00.000Z`, value }));

test('computeBaseline uses the sample standard deviation', () => {
  const b = computeBaseline([1, 2, 3, 4]);
  assert.equal(b.mean, 2.5);
  assert.equal(b.n, 4);
  assert.ok(Math.abs(b.std - Math.sqrt(5 / 3)) < 1e-9);
  assert.deepEqual(computeBaseline([]), { mean: 0, std: 0, n: 0 });
  assert.equal(computeBaseline([7]).std, 0);
});

test('parseBandsYaml parses the default bands file', () => {
  const c = parseBandsYaml(DEFAULT_BANDS_YAML);
  assert.equal(c.metric, 'ci_test_failure_rate');
  assert.equal(c.rules, 'western_electric');
  assert.equal(c.direction, 'above');
  assert.equal(c.min_samples, 8);
  assert.equal(c.tiers['3sigma']?.action, 'propose');
  assert.deepEqual(c.tiers['3sigma']?.routes, ['pull_request', 'runbook:rollback-deploy']);
  assert.equal(c.tiers['2sigma']?.tools, 'Read,Grep,Bash(gh run view *)');
});

test('WE1: one point beyond 3σ is a 3sigma propose breach', () => {
  const out = evaluateBands(cfg, baseline, [{ at, value: 14 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.rule, 'WE1');
  assert.equal(out[0]?.tier, '3sigma');
  assert.equal(out[0]?.action, 'propose');
  assert.equal(out[0]?.side, 'above');
  assert.equal(out[0]?.at, at);
  assert.equal(breachIdentity(out[0]!), 'error_rate:WE1:above:3sigma');
});

test('WE2: two of three consecutive beyond 2σ is a 2sigma diagnose breach', () => {
  const out = evaluateBands(cfg, baseline, s([12, 10, 12]));
  assert.equal(out.length, 1);
  assert.equal(out[0]?.rule, 'WE2');
  assert.equal(out[0]?.action, 'diagnose');
});

test('WE3: four of five consecutive beyond 1σ is a 1sigma log breach', () => {
  const out = evaluateBands(cfg, baseline, s([11, 11, 11, 10, 11]));
  assert.equal(out.length, 1);
  assert.equal(out[0]?.rule, 'WE3');
  assert.equal(out[0]?.tier, '1sigma');
  assert.equal(out[0]?.action, 'log');
});

test('WE4: eight consecutive points on one side of the mean is drift', () => {
  const out = evaluateBands(cfg, baseline, s([10.5, 10.5, 10.5, 10.5, 10.5, 10.5, 10.5, 10.5]));
  assert.equal(out.length, 1);
  assert.equal(out[0]?.rule, 'WE4');
  assert.ok(out[0]?.detail.includes('eight consecutive'));
  const below = evaluateBands(cfg, baseline, s([9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5]));
  assert.equal(below[0]?.side, 'below');
});

test('direction: above suppresses below-mean breaches', () => {
  const above = { ...cfg, direction: 'above' as const };
  assert.deepEqual(evaluateBands(above, baseline, [{ at, value: 6 }]), []);
  assert.equal(evaluateBands(above, baseline, [{ at, value: 14 }]).length, 1);
});

test('min_samples gate and empty input yield no breaches', () => {
  assert.deepEqual(evaluateBands(cfg, [10, 10, 10], [{ at, value: 100 }]), []);
  assert.deepEqual(evaluateBands(cfg, baseline, []), []);
});

test('zero standard deviation: any deviation is a breach, equality is not', () => {
  const flat = Array.from({ length: 10 }, () => 10);
  const hit = evaluateBands(cfg, flat, [{ at, value: 11 }]);
  assert.equal(hit[0]?.rule, 'WE1');
  assert.deepEqual(evaluateBands(cfg, flat, [{ at, value: 10 }]), []);
});

test('highest tier per side wins when several rules fire', () => {
  const out = evaluateBands(cfg, baseline, s([12, 12, 12, 12, 12, 12, 12, 14]));
  assert.equal(out.length, 1);
  assert.equal(out[0]?.rule, 'WE1');
  assert.equal(out[0]?.sigma, 3);
});

test('tiers without configuration are not emitted', () => {
  const only3 = BandsConfig.parse({ metric: 'm', tiers: { '3sigma': { action: 'propose' } } });
  assert.deepEqual(evaluateBands(only3, baseline, s([12, 10, 12])), []);
});
