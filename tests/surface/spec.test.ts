import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEars, parseSpec, renderSpec, type Spec } from '../../src/artifacts/spec.ts';

test('classifyEars accepts each of the five patterns', () => {
  const cases: Array<[string, string]> = [
    ['R1. The system shall store the submitted record.', 'Ubiquitous'],
    ['R2. WHEN a user submits the form, the system shall store the record.', 'Event-Driven'],
    ['R3. WHILE the session is locked, the system shall reject edits.', 'State-Driven'],
    ['R4. IF the token is expired, THEN the system shall reject the request.', 'Unwanted'],
    ['R5. WHERE audit logging is enabled, the system shall emit an audit event.', 'Optional'],
  ];
  for (const [line, pattern] of cases) {
    const c = classifyEars(line);
    assert.equal(c.pattern, pattern, line);
    assert.deepEqual(c.problems, [], `${line}: ${c.problems.join('; ')}`);
  }
});

test('classifyEars flags two shalls, banned words and unsourced numbers', () => {
  assert.ok(classifyEars('R6. The system shall log and shall notify.').problems.some((p) => p.includes('exactly one "shall", found 2')));
  assert.ok(classifyEars('R7. The system shall respond quickly.').problems.some((p) => p.startsWith('vague wording')));
  assert.ok(classifyEars('R8. The system shall respond within 200 ms.').problems.some((p) => p.includes('numeric limit without')));
  assert.deepEqual(classifyEars('R9. The system shall respond within [TBD: timeout, ms].').problems, []);
  assert.ok(classifyEars('R10. Something happens.').problems.some((p) => p.includes('does not match an EARS pattern')));
});

const spec: Spec = {
  slug: 'claims-status',
  title: 'Claims status',
  intentRef: 'intent/claims-status.md',
  status: 'draft',
  createdAt: '2026-09-11T00:00:00.000Z',
  skillsApplied: ['secure-api-review'],
  requirements: ['R1. The system shall store the submitted record.', 'R2. WHEN a user submits the form, the system shall store the record.'],
  design: 'One endpoint behind existing auth.',
  interfaces: 'GET /claims/{id}/status',
  dataModel: 'none',
  flaggedConcerns: [{ policy: 'security', concern: 'PII in logs', owner: 'sec-team' }],
  nonGoals: ['no new PII'],
  acceptance: ['record is stored. [R1]', 'form submission stores the record. [R2]'],
};

test('renderSpec re-parses cleanly', () => {
  const text = renderSpec(spec);
  const parsed = parseSpec(text);
  assert.equal(parsed.ok, true, parsed.problems.join('; '));
  assert.deepEqual(parsed.requirements.map((r) => r.id), ['R1', 'R2']);
  assert.equal(parsed.requirements[0]?.pattern, 'Ubiquitous');
  assert.ok(text.includes('**security**: PII in logs (owner: sec-team)'));
});

test('parseSpec reports a dangling citation and open markers', () => {
  const dangling = parseSpec(renderSpec({ ...spec, acceptance: ['record is stored. [R9]'] }));
  assert.equal(dangling.ok, false);
  assert.ok(dangling.problems.some((p) => p.includes('acceptance cites R9')));
  const todo = parseSpec(renderSpec({ ...spec, design: 'TODO decide the cache' }));
  assert.ok(todo.problems.some((p) => p.includes('unresolved TBD/TODO')));
  const stripped = renderSpec({ ...spec, acceptance: [] })
    .replace(/- R\d+\. .*\n/g, '')
    .replace(/- 1\. <fact that means done>.*\n/, '');
  const noReq = parseSpec(stripped);
  assert.ok(noReq.problems.some((p) => p.includes('no EARS requirements')), noReq.problems.join('; '));
  assert.ok(noReq.problems.some((p) => p.includes('no acceptance items')));
});

// BUG: renderSpec's template placeholders (`R1. The <system> shall <observable response>.` and
// `1. <fact that means done>. [R1]`) satisfy parseSpec, so an untouched template spec validates ok.
// Angle-bracket placeholders should be reported like the card parser's [CARD-PLACEHOLDER].
test('an untouched template spec does not validate', () => {
  const parsed = parseSpec(renderSpec({ ...spec, requirements: [], acceptance: [] }));
  assert.equal(parsed.ok, false);
});

test('parseSpec surfaces per-requirement EARS problems', () => {
  const parsed = parseSpec(renderSpec({ ...spec, requirements: ['R1. The system shall respond quickly.'], acceptance: ['fast. [R1]'] }));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.problems.some((p) => p.startsWith('R1: vague wording')));
  assert.equal(parseSpec('no front matter').ok, false);
});
