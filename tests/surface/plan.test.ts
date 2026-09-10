import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePlanReadiness, parsePlanCards, renderPlan, type Plan } from '../../src/artifacts/plan.ts';

const base: Plan = {
  slug: 'claims-status',
  title: 'Claims status self-service',
  specRef: 'specs/claims-status.md',
  size: 'T0',
  status: 'draft',
  createdAt: '2026-09-11T00:00:00.000Z',
  filesThatChange: ['portal/src/claims/StatusPanel.tsx (new)', 'claims-api/routes/status.py'],
  orderOfWork: ['Add the status endpoint behind existing auth.', 'Build the panel against the endpoint.'],
  risks: ['claims-core rate-limits at 50 rps; the panel must cache.'],
  proof: ['test_status.py covers the four claim states.'],
};

const full: Plan = {
  ...base,
  size: 'T1',
  goalAndBoundaries: 'Show claim status.',
  cards: [
    { id: 'T1-STATUS-API', priority: 'MUST', output: 'status endpoint', dependsOn: [], parallelWindow: 'W1', freezePoint: true },
    { id: 'T1-STATUS-PANEL', priority: 'SHOULD', output: 'panel', dependsOn: ['T1-STATUS-API'], parallelWindow: 'W2' },
  ],
};

test('renderPlan light omits the ten-section skeleton; full includes it', () => {
  const light = renderPlan(base);
  assert.ok(!light.includes('## 1. Goal and boundaries'));
  assert.ok(light.includes('## Files that change'));
  assert.ok(light.includes('1. Add the status endpoint'));
  const long = renderPlan(full);
  assert.ok(long.includes('## 1. Goal and boundaries'));
  assert.ok(long.includes('none this version'));
  assert.ok(long.includes('## 7. Task split'));
  assert.ok(long.includes('| T1-STATUS-API | MUST | status endpoint | - | W1 | yes |'));
  assert.ok(long.includes('## 10. After merge'));
});

test('readiness admits a complete light plan and a complete full plan', () => {
  const r = evaluatePlanReadiness(renderPlan(base), { light: true });
  assert.equal(r.overall, 'admit', JSON.stringify(r.gates));
  assert.deepEqual(r.questions, []);
  const f = evaluatePlanReadiness(renderPlan(full));
  assert.equal(f.overall, 'admit', JSON.stringify(f.gates));
});

test('readiness needs clarification for missing files, order, proof and task split', () => {
  const noFiles = evaluatePlanReadiness(renderPlan({ ...base, filesThatChange: [] }), { light: true });
  assert.equal(noFiles.overall, 'needs-clarification');
  assert.ok(noFiles.questions.includes('Which files change?'));
  const noOrder = evaluatePlanReadiness(renderPlan({ ...base, orderOfWork: [] }), { light: true });
  assert.ok(noOrder.gates.find((g) => g.gateId === 2)?.verdict === 'fail');
  const noProof = evaluatePlanReadiness(renderPlan({ ...base, proof: [] }), { light: true });
  assert.ok(noProof.gates.find((g) => g.gateId === 4)?.verdict === 'fail');
  const noRisks = evaluatePlanReadiness(renderPlan({ ...base, risks: [] }), { light: true });
  assert.equal(noRisks.gates.find((g) => g.gateId === 5)?.verdict, 'skip');
  assert.equal(noRisks.overall, 'admit');
  const noCards = evaluatePlanReadiness(renderPlan({ ...full, cards: [] }));
  assert.equal(noCards.overall, 'needs-clarification');
  assert.ok(noCards.gates.find((g) => g.gateId === 7)?.verdict === 'fail');
});

test('open TODO fails but a closed [TBD: question] passes', () => {
  const todo = evaluatePlanReadiness(renderPlan({ ...base, risks: ['TODO decide the cache'] }), { light: true });
  assert.equal(todo.gates.find((g) => g.gateId === 3)?.verdict, 'fail');
  assert.equal(todo.overall, 'needs-clarification');
  const tbd = evaluatePlanReadiness(renderPlan({ ...base, risks: ['cache size [TBD: which cache backend?]'] }), { light: true });
  assert.equal(tbd.gates.find((g) => g.gateId === 3)?.verdict, 'pass');
});

test('fileExists resolver flags missing existing files but not (new) ones', () => {
  const r = evaluatePlanReadiness(renderPlan(base), { light: true, fileExists: (p) => p !== 'claims-api/routes/status.py' });
  const g6 = r.gates.find((g) => g.gateId === 6)!;
  assert.equal(g6.verdict, 'fail');
  assert.ok(g6.finding?.includes('claims-api/routes/status.py'));
  assert.ok(!g6.finding?.includes('StatusPanel'));
  const ok = evaluatePlanReadiness(renderPlan(base), { light: true, fileExists: () => true });
  assert.equal(ok.gates.find((g) => g.gateId === 6)?.verdict, 'pass');
  const skipped = evaluatePlanReadiness(renderPlan(base), { light: true });
  assert.equal(skipped.gates.find((g) => g.gateId === 6)?.verdict, 'skip');
});

test('parsePlanCards reads the task split table', () => {
  const rows = parsePlanCards(renderPlan(full));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { id: 'T1-STATUS-API', priority: 'MUST', output: 'status endpoint', dependsOn: [], parallelWindow: 'W1', freezePoint: true });
  assert.deepEqual(rows[1]?.dependsOn, ['T1-STATUS-API']);
  assert.equal(rows[1]?.freezePoint, false);
  assert.deepEqual(parsePlanCards(renderPlan(base)), []);
});
