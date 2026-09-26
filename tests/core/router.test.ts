import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRequest, formatRouting } from '../../src/core/router.ts';

describe('router (Q2)', () => {
  test('Q2: bare number matching both a card stage prefix and an issue is an ambiguity, not a guess', () => {
    const r = classifyRequest({ text: '42', knownCardIds: ['T42-FOO'], knownIssueNumbers: [42] });
    assert.ok(r.ambiguity, 'ambiguity must be reported');
    assert.match(r.ambiguity!, /42/);
    assert.match(formatRouting(r), /ASK=/);
  });

  test('Q2: bare number that is only an issue resolves to an issue reference', () => {
    const r = classifyRequest({ text: '#42', knownIssueNumbers: [42] });
    assert.equal(r.kind, 'issue');
    assert.equal(r.ambiguity, undefined);
    assert.ok(r.reasons.includes('ref=#42'));
  });

  test('Q2: bare number with no match does not become a card or issue', () => {
    const r = classifyRequest({ text: '7' });
    assert.ok(r.ambiguity);
    assert.notEqual(r.kind, 'card-execute');
  });

  test('Q2: a narrow reproducible bug routes T0-bugfix via card-loop only', () => {
    const r = classifyRequest({ text: 'Fix crash when opening the settings page', hasBugEvidence: true });
    assert.equal(r.kind, 'bugfix');
    assert.equal(r.size, 'T0-bugfix');
    assert.equal(r.cardCount, 1);
    assert.deepEqual(r.modules, ['router', 'card-loop']);
    assert.equal(r.nextModule, 'card-loop');
    assert.equal(r.target, 'development');
    assert.deepEqual(r.skills, ['diagnose', 'tdd'], 'a bugfix route names diagnose before the build skill');
  });

  test('R1: companion skills per route: tdd on every card-loop route, grilling on T1/T2, none on a release-only route', () => {
    assert.deepEqual(classifyRequest({ text: 'Fix a typo in the README' }).skills, ['tdd']);
    assert.deepEqual(classifyRequest({ text: 'Alert: 5xx spike on checkout service after deploy', source: 'incident' }).skills, ['diagnose', 'tdd'], 'an incident route names diagnose too');
    assert.deepEqual(classifyRequest({ text: 'implement T3-API', knownCardIds: ['T3-API'], explicitSize: 'T0-bugfix' }).skills, ['diagnose', 'tdd'], 'an explicit T0-bugfix card execution names diagnose');
    assert.deepEqual(classifyRequest({ text: 'implement T3-API', knownCardIds: ['T3-API'], explicitSize: 'T1' }).skills, ['grilling', 'tdd'], 'an explicit T1 card route names grilling');
    assert.deepEqual(classifyRequest({ text: 'implement T3-API', knownCardIds: ['T3-API'], explicitSize: 'T2' }).skills, ['grilling', 'tdd'], 'an explicit T2 card route names grilling');
    assert.deepEqual(classifyRequest({ text: 'Add a reporting dashboard feature with charts to the admin portal' }).skills, ['grilling', 'tdd']);
    assert.deepEqual(classifyRequest({ text: 'Build a fully AI native SDLC system from scratch with a new architecture' }).skills, ['grilling', 'tdd']);
    const rel = classifyRequest({ text: 'Deploy the current build to staging for online testing' });
    assert.equal(rel.kind, 'release');
    assert.ok(!rel.modules.includes('card-loop'));
    assert.deepEqual(rel.skills, []);
    assert.deepEqual(classifyRequest({ text: 'Deploy the current build to staging for online testing', explicitSize: 'T0-bugfix' }).skills, [], 'the release-only exclusion applies to diagnose as well');
  });

  test('Q2: a short authentication bug escalates to T1 with a reported reason', () => {
    const r = classifyRequest({ text: 'Fix crash when the password reset token expires' });
    assert.equal(r.kind, 'bugfix');
    assert.equal(r.size, 'T1');
    assert.equal(r.sizeSource, 'inferred');
    assert.ok(r.impactEscalation);
    assert.match(r.impactEscalation!, /auth\/sensitive data/);
    assert.ok(r.modules.includes('arc'));
  });

  test('Q2: explicit size is preserved but impact evidence is reported', () => {
    const r = classifyRequest({ text: 'Fix crash when the password reset token expires', explicitSize: 'T0' });
    assert.equal(r.size, 'T0');
    assert.equal(r.sizeSource, 'explicit');
    assert.ok(r.impactEscalation);
    assert.match(r.impactEscalation!, /explicit T0 kept but reported/);
  });

  test('Q2/Q15: "build a system" is T2 development-only; hosting is never enabled by it', () => {
    const r = classifyRequest({ text: 'Build a full inventory management system from scratch' });
    assert.equal(r.kind, 'system');
    assert.equal(r.size, 'T2');
    assert.equal(r.target, 'development');
    assert.equal(r.targetSource, 'default');
    assert.equal(r.cardCount, 'unknown');
    assert.deepEqual(r.modules, ['router', 'arc', 'card-loop']);
    assert.equal(r.nextModule, 'arc');
    assert.ok(!r.modules.includes('release'));
    assert.ok(r.reasons.some((x) => /hosting\/deploy not authorised/.test(x)));
  });

  test('Q2: a feature request is T1 with arc + card-loop', () => {
    const r = classifyRequest({ text: 'Add support for exporting reports as a new feature module' });
    assert.equal(r.kind, 'feature');
    assert.equal(r.size, 'T1');
    assert.equal(r.cardCount, 'unknown');
    assert.equal(r.nextModule, 'arc');
  });

  test('Q16: explicit staging request selects the staging target and loads release', () => {
    const r = classifyRequest({ text: 'Deploy the current build to staging for online testing' });
    assert.equal(r.target, 'staging');
    assert.equal(r.targetSource, 'explicit');
    assert.equal(r.kind, 'release');
    assert.equal(r.cardCount, 0);
    assert.ok(r.modules.includes('release'));
    assert.equal(r.nextModule, 'release');
  });

  test('Q17: explicit production release selects production, never inferred from staging', () => {
    const r = classifyRequest({ text: 'Release version 2.0 to production' });
    assert.equal(r.target, 'production');
    assert.equal(r.kind, 'release');
    assert.ok(r.modules.includes('release'));
  });

  test('Q16: explicit package request selects the package target', () => {
    const r = classifyRequest({ text: 'Build a runnable package for the app' });
    assert.equal(r.target, 'package');
    assert.equal(r.kind, 'release');
  });

  test('explicitTarget overrides detection', () => {
    const r = classifyRequest({ text: 'Fix the login page layout', explicitTarget: 'staging' });
    assert.equal(r.target, 'staging');
    assert.equal(r.targetSource, 'explicit');
    assert.ok(r.modules.includes('release'));
  });

  test('Q20: data impact loads migrate even for a development-only change', () => {
    const r = classifyRequest({ text: 'Add a column to the orders schema and update the ORM model' });
    assert.equal(r.dataImpact, true);
    assert.ok(r.modules.includes('migrate'));
    assert.equal(r.target, 'development');
    assert.ok(!r.modules.includes('release'));
  });

  test('Q20: affected surfaces under migrations/ set data impact', () => {
    const r = classifyRequest({ text: 'Tidy the naming in the helper', affectedSurfaces: ['db/migrations/0004_x.sql'] });
    assert.equal(r.dataImpact, true);
    assert.ok(r.modules.includes('migrate'));
  });

  test('explicit migration operation routes kind=migration with target migration', () => {
    const r = classifyRequest({ text: 'Run the migration against the reporting database' });
    assert.equal(r.kind, 'migration');
    assert.equal(r.target, 'migration');
    assert.ok(r.modules.includes('migrate'));
  });

  test('card id in the registry resolves to card-execute; wording-only request is card-amendment', () => {
    const exec = classifyRequest({ text: 'implement T3-API', knownCardIds: ['T3-API'] });
    assert.equal(exec.kind, 'card-execute');
    assert.ok(exec.reasons.includes('ref=T3-API'));
    assert.equal(exec.cardCount, 1);
    const amend = classifyRequest({ text: 'reword the card text of T3-API', knownCardIds: ['T3-API'] });
    assert.equal(amend.kind, 'card-amendment');
    assert.equal(amend.size, 'T0');
    assert.deepEqual(amend.modules, ['router', 'card-loop']);
  });

  test('incident source routes kind=incident and sizes by impact', () => {
    const plain = classifyRequest({ text: 'Alert: 5xx spike on checkout service after deploy', source: 'incident' });
    assert.equal(plain.kind, 'incident');
    assert.equal(plain.size, 'T0-bugfix');
    const sensitive = classifyRequest({ text: 'Alert: error rate spike on the authentication service', source: 'incident' });
    assert.equal(sensitive.size, 'T1');
  });

  test('ongoing operations request selects the operations target without release', () => {
    const r = classifyRequest({ text: 'Keep watching the service and page on-call when latency spikes' });
    assert.equal(r.target, 'operations');
    assert.ok(!r.modules.includes('release'));
  });

  test('formatRouting prints the concise line with size/kind/target/cards', () => {
    const line = formatRouting(classifyRequest({ text: 'Fix a typo in the README' }));
    assert.match(line, /^\[route\] size=T0 kind=change target=development cards=1 modules=router\+card-loop next=card-loop/);
    assert.match(line, / next=card-loop skills=tdd/, 'skills follow next= so the anchored prefix stays valid');
    assert.match(formatRouting(classifyRequest({ text: 'Deploy the current build to staging for online testing' })), / skills=none/);
  });

  test('scope is not inferred from prompt length', () => {
    const long = 'Fix a typo in the README. '.repeat(40);
    assert.equal(classifyRequest({ text: long }).size, 'T0');
  });
});

describe('T0-GOAL-CARD-COUNT: several named card ids leave the count to the projection', () => {
  const known = ['T1-PARSE-GUARD', 'T1-STORE-CAS', 'T3-API'];
  test('a text naming two known card ids routes with an unknown count and the arc module, naming both, with or without an explicit size [R1]', () => {
    for (const explicitSize of [undefined, 'T0', 'T1'] as const) {
      const r = classifyRequest({ text: 'v5.1 hardening wave 1: T1-PARSE-GUARD then T1-STORE-CAS', knownCardIds: known, explicitSize });
      assert.equal(r.cardCount, 'unknown', `size ${explicitSize ?? 'inferred'}`);
      assert.ok(r.modules.includes('arc'), `size ${explicitSize ?? 'inferred'}: the arc module`);
      assert.ok(r.reasons.includes('named cards: T1-PARSE-GUARD, T1-STORE-CAS (count left to the projection)'), JSON.stringify(r.reasons));
    }
  });
  test('one known card id, alone or beside an unknown or a repeated one, keeps the count 1 for a T0 size [R1]', () => {
    for (const text of ['implement T3-API', 'implement T3-API after T9-UNKNOWN', 'implement T3-API, then check T3-API again']) {
      const r = classifyRequest({ text, knownCardIds: known });
      assert.equal(r.cardCount, 1, text);
      assert.ok(r.reasons.includes('ref=T3-API'), text);
      assert.ok(!r.reasons.some((x) => x.startsWith('named cards:')), text);
    }
  });
});
