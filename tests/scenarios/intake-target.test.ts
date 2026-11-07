// Card T0-INTAKE-TARGET-2 (issue 222): a word in a request no longer sets a delivery target. A goal that names a card or an
// issue takes its target only from the flag, and free text sets one only by asking for a delivery.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyRequest } from '../../src/core/router.ts';
import { driveCardToDone, makeFixture, writeCard } from './_harness.ts';

const REF = 'T0-EXAMPLE';
/** The rows of issue 222: requests that ask for no delivery. */
const NO_DELIVERY = [
  'Fix issue 162: a production goal reaches DONE when staging was verified on its delivered attempt',
  'fix the null check in the production config parser',
  'add a unit test for the staging stage in goal-machine',
  'rename the installer helper in the init scaffold',
  'the docs mention uat twice, remove one',
  'fix the monitor check band parser',
];

function assertDevelopment(r: ReturnType<typeof classifyRequest>, text: string): void {
  assert.deepEqual([r.target, r.targetSource], ['development', 'default'], text);
  assert.notEqual(r.kind, 'release', text);
  assert.ok(r.modules.includes('card-loop'), `${text}: ${r.modules.join('+')}`);
}

for (const text of NO_DELIVERY) {
  test(`T0-INTAKE-TARGET-2 acceptance 1: with a ref, "${text.slice(0, 40)}" stays a development card [R1]`, () => {
    assertDevelopment(classifyRequest({ text, source: 'card', ref: REF, explicitSize: 'T0-bugfix' }), text);
  });
  test(`T0-INTAKE-TARGET-2 acceptance 2: as free text, "${text.slice(0, 40)}" asks for no delivery [R3]`, () => {
    assertDevelopment(classifyRequest({ text }), text);
  });
}

test('T0-INTAKE-TARGET-2 acceptance 3: a request that names a card or an issue takes its target only from the flag [R1]', () => {
  for (const request of [{ source: 'card', ref: REF }, { source: 'issue', ref: '#222' }, { source: 'bug-evidence', ref: REF }] as const) {
    assertDevelopment(classifyRequest({ text: 'deploy to production', ...request }), request.source);
    const flagged = classifyRequest({ text: 'deploy to production', ...request, explicitTarget: 'staging' });
    assert.deepEqual([flagged.target, flagged.targetSource], ['staging', 'explicit'], request.source);
  }
});

test('T0-INTAKE-TARGET-2 acceptance 4: --target development keeps a request to deliver out of the release kind [R2]', () => {
  const r = classifyRequest({ text: 'deploy to production', explicitTarget: 'development' });
  assert.equal(r.target, 'development');
  assert.equal(r.kind, 'change');
  assert.ok(r.modules.includes('card-loop'), r.modules.join('+'));
  assert.ok(!r.reasons.includes('explicit production release request'), JSON.stringify(r.reasons));
});

const REQUESTS: Array<[string, 'production' | 'staging' | 'package' | 'migration' | 'operations']> = [
  ['deploy to production', 'production'],
  ['Release version 2.0 to production', 'production'],
  ['release to prod', 'production'],
  ['ship it to production', 'production'],
  ['publish the build to production', 'production'],
  ['roll out the app to production', 'production'],
  ['rollout to production', 'production'],
  ['roll-out to production', 'production'],
  ['promote the build to the production cluster', 'production'],
  ['go live', 'production'],
  ['release to staging', 'staging'],
  ['Deploy the current build to staging for online testing', 'staging'],
  ['push the build to uat', 'staging'],
  ['deploy it for online testing', 'staging'],
  ['release the build to the test environment', 'staging'],
  ['deploy to preprod', 'staging'],
  // R3 decision 1 F1: no limit on the words between the verb and the target, and a line break inside a sentence is wrapping.
  ['deploy the approved customer reporting application build from the latest successful verification pipeline to staging', 'staging'],
  ['deploy\nto staging', 'staging'],
  ['deploy to\nstaging', 'staging'],
  ['deploy the build\n  to\n  production', 'production'],
  ['Release version 2.0 to production.', 'production'],
  // Main read these two as production: `\bproduction\b` matches after the hyphen, and `observe production` named the word.
  ['deploy to pre-production', 'staging'],
  ['observe production', 'operations'],
  ['Build a runnable package for the app', 'package'],
  ['package the app', 'package'],
  ['publish the docker image', 'package'],
  ['package it', 'package'],
  ['package a build', 'package'],
  ['produce an installer', 'package'],
  ['make an apk', 'package'],
  ['create an installer', 'package'],
  ['create a build artifact', 'package'],
  ['cut a distributable', 'package'],
  ['generate an msi', 'package'],
  ['Run the migration against the reporting database', 'migration'],
  ['apply the migration', 'migration'],
  ['migrate the database', 'migration'],
  ['backfill the orders', 'migration'],
  ['run a data migration', 'migration'],
  ['run the data migration', 'migration'],
  ['run data migration', 'migration'],
  ['migrate the data', 'migration'],
  ['Keep watching the service and page on-call when latency spikes', 'operations'],
  ['monitor the service', 'operations'],
  ['page on-call', 'operations'],
  ['page oncall', 'operations'],
  ['keep watching the service', 'operations'],
  ['monitor it', 'operations'],
  ['monitor this service', 'operations'],
  ['monitor our app', 'operations'],
  ['monitor production', 'operations'],
  ['monitor prod', 'operations'],
  // A request with two target words takes the target of its form.
  ['deploy the production build to staging', 'staging'],
  ['run the migration on staging', 'migration'],
  ['package the app for staging', 'package'],
  // A line break inside a form is wrapping.
  ['go\nlive', 'production'],
  ['release to\nprod', 'production'],
  ['deploy to the test\nenvironment', 'staging'],
  ['deploy it for online\ntesting', 'staging'],
  ['publish the docker\nimage', 'package'],
  ['package the\napp', 'package'],
  ['run the\nmigration', 'migration'],
  ['keep\nwatching', 'operations'],
  ['take over ongoing operations', 'operations'],
];
for (const [text, target] of REQUESTS) {
  test(`T0-INTAKE-TARGET-2 acceptance 5: "${text}" asks for ${target} [R3]`, () => {
    const r = classifyRequest({ text });
    assert.deepEqual([r.target, r.targetSource], [target, 'explicit']);
  });
}

/** One row per class the narrowing drops: each goes to the default, where `--target` still names any target. */
const DROPPED = [
  'the job runs in production',
  'deploy on staging',
  'deploy on production',
  'the production release step',
  'the prod release step',
  'a staging deploy',
  'Release the notes. The next step is to production',
  // R3 decision 1 F2: a sentence can end inside a closing quote or bracket.
  'Please write "Release the notes." The next step is to production',
  'Please write "Build the documentation." The installer is described later',
  '(Release the notes.) The next step is to production',
  'Release the notes\n\nThe next step is to production',
  '- Release the notes\n- Link it to production docs',
  '1. Release the notes\n2. Link it to production docs',
  '1) Release the notes\n2) Link it to production docs',
  'Release the notes\n  \nThe next step is to production',
  'link the page to production docs and deploy the notes',
  // R3 decision 2 F3: the verb is not its own object.
  'rename the build artifact helper',
  'the build artifact',
  'build artifact',
  'Release the notes; the next step is to production',
  'uat',
  'preprod',
  'online testing',
  'the installer',
  'an apk',
  'the docker image',
  'alerting docs',
  'the on-call page',
  'the maintenance window',
  'the data migration helper',
  'ship it to prod',
  'deploy it for online tests',
  'deploy it for online test',
];
for (const text of DROPPED) {
  test(`T0-INTAKE-TARGET-2 acceptance 6: "${text}" reads as no target [R3]`, () => {
    const r = classifyRequest({ text });
    assert.deepEqual([r.target, r.targetSource], ['development', 'default']);
  });
}

/** R3 decision 2 F4: a sentence ends at any terminator with any closing marks after it, and any list marker starts a new item. */
const TERMINATORS = ['.', '!', '?', ';', '\u2026', '\u3002', '\uff01', '\uff1f', '\uff1b', '\uff0e', '\uff61', '\u0964', '\u06d4'];
const CLOSERS = ['', '"', "'", '\u201d', '\u2019', '\u00bb', '\u203a', ')', ']', '}', '>', '*', '**', '_', '`', '\u300d', '\uff09', '"}'];
for (const terminator of TERMINATORS) {
  for (const closer of CLOSERS) {
    const text = `Release the notes${terminator}${closer} The next step is to production`;
    test(`T0-INTAKE-TARGET-2 acceptance 6: a sentence ends at ${JSON.stringify(terminator + closer)} [R3]`, () => {
      const r = classifyRequest({ text });
      assert.deepEqual([r.target, r.targetSource], ['development', 'default'], text);
    });
  }
}
for (const terminator of ['\u3002', '\uff01', '\uff0e', '\uff1f', '\uff1b', '\uff61']) {
  test(`T0-INTAKE-TARGET-2 acceptance 6: the full-width terminator ${JSON.stringify(terminator)} ends a sentence with no whitespace [R3]`, () => {
    const r = classifyRequest({ text: `Release the notes${terminator}The next step is to production` });
    assert.deepEqual([r.target, r.targetSource], ['development', 'default']);
  });
}
for (const marker of ['-', '*', '+', '\u2022', '\u2013', '>', '1.', '1)', '(1)', 'a.', 'a)', 'iv.', '10.']) {
  test(`T0-INTAKE-TARGET-2 acceptance 6: the list marker ${JSON.stringify(marker)} starts a new item [R3]`, () => {
    const r = classifyRequest({ text: `${marker} Release the notes\n${marker} Link it to production docs` });
    assert.deepEqual([r.target, r.targetSource], ['development', 'default']);
  });
}
for (const text of ['Deploy example.com to staging', 'Release v2.0.1 to staging', 'deploy the build\n(all of it) to staging', 'deploy the build\nsome) to staging', 'deploy the build\n-all of it to staging', 'deploy the build\nto staging. Then tell the team']) {
  test(`T0-INTAKE-TARGET-2 acceptance 5: ${JSON.stringify(text)} stays one sentence [R3]`, () => {
    assert.equal(classifyRequest({ text }).target, 'staging');
  });
}

test('T0-INTAKE-TARGET-2 acceptance 5: a wrapped form has the kind the form has on one line [R3]', () => {
  assert.equal(classifyRequest({ text: 'go\nlive' }).kind, 'release');
  assert.equal(classifyRequest({ text: 'package the\napp' }).kind, 'release');
});

for (const text of ['deploy to production fails with a 500', 'the release to staging is broken', 'deploy to production fails\nwith a 500']) {
  test(`T0-INTAKE-TARGET-2 acceptance 7: the bug report "${text}" reads as no target [R4]`, () => {
    const r = classifyRequest({ text });
    assert.deepEqual([r.target, r.targetSource, r.kind], ['development', 'default', 'bugfix']);
  });
}

test('T0-INTAKE-TARGET-2 acceptance 5: a prompt of repeated verbs and no sentence end reads as no target, in a scan that stays linear [R3]', () => {
  const r = classifyRequest({ text: 'deploy '.repeat(50_000) });
  assert.deepEqual([r.target, r.targetSource], ['development', 'default']);
});

test('T0-INTAKE-TARGET-2 acceptance 5: a child classifies long runs of each unit before its kill, so a scan that is not linear fails with no clock in the test [R3]', () => {
  // R3 decision 3 F5: 80000 hyphens took 7 seconds when the lookbehind ran at every character, so 400000 would take minutes.
  // The size stays small enough to leave the timing tests that run beside this one alone.
  const router = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'core', 'router.ts')).href;
  const units = ['-', '.', '. ', '!"', '\n-', '-\n', '\n ', 'a\n', 'deploy to ', '\u3002'];
  const script = `import { classifyRequest } from ${JSON.stringify(router)};
for (const unit of ${JSON.stringify(units)}) classifyRequest({ text: 'Add support for this: ' + unit.repeat(400000) });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, `killed by ${r.signal}: ${r.stderr}`);
});

test('T0-INTAKE-TARGET-2 acceptance 8: the routing reasons name a target the text read as when it was set aside, and name none otherwise [R5]', () => {
  const named = 'the text reads as target production; only --target sets the target of this request';
  assert.ok(classifyRequest({ text: 'deploy to production', source: 'card', ref: REF }).reasons.includes(named));
  assert.ok(classifyRequest({ text: 'deploy to production', explicitTarget: 'development' }).reasons.includes(named));
  const plain = classifyRequest({ text: 'Fix a typo in the README', source: 'card', ref: REF });
  assert.ok(!plain.reasons.some((r) => r.startsWith('the text reads as target')), JSON.stringify(plain.reasons));
});

test('T0-INTAKE-TARGET-2 acceptance 9: the goal of issue 162 holds no staging authorization and ends DONE with no release attempt [R6]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: REF, title: 'a development fix' });
    const goal = fx.controller.createGoal({ text: NO_DELIVERY[0]!, source: 'card', ref: REF, explicitSize: 'T0-bugfix', affectedSurfaces: [] }, { cards: [REF] });
    assert.equal(goal.target, 'development');
    assert.deepEqual(goal.authorizations.map((a) => a.kind), ['development']);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [REF] } });
    driveCardToDone(fx, goal.id, REF);
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: {} });
    assert.equal(fx.goal(goal.id).state, 'DONE');
    assert.deepEqual(fx.store.listReleases(goal.id), []);
  } finally {
    fx.cleanup();
  }
});
