import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canRerun, classifyCiFailure, hasUnreconciledRerun, reconcileRerun, recordRerunIntent, type CiJob } from '../../src/core/ci-policy.ts';
import { classifyShipOutput, encodeUntrusted } from '../../src/delivery/ship.ts';
import { CiLedger } from '../../src/core/types.ts';
import { T0 } from './_fixtures.ts';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir } from '../infra/helpers.ts';
import { changelogSince010 } from '../infra/changelog.ts';

describe('CI classification (Q7)', () => {
  test('a transient log pattern alone is unknown: log text never grants a rerun, and its match stays as evidence (T0-CI-RERUN-STRUCTURED)', () => {
    const c = classifyCiFailure([{ name: 'test', conclusion: 'failure', logExcerpt: 'npm ERR! network read ECONNRESET' }]);
    assert.equal(c.class, 'unknown');
    assert.deepEqual(c.failedJobs, ['test']);
    assert.ok(c.evidence.some((e) => e.startsWith('transient:')));
  });

  test('deterministic test failures classify as code defects and win over transient noise', () => {
    const c = classifyCiFailure([{ name: 'test', conclusion: 'failure', logExcerpt: 'AssertionError: expected 1 to equal 2\nsocket hang up' }]);
    assert.equal(c.class, 'code-defect');
    assert.ok(c.evidence.some((e) => e.startsWith('code:')));
  });

  test('no evidence is unknown; extra log text is considered', () => {
    assert.equal(classifyCiFailure([{ name: 'lint', conclusion: 'failure' }]).class, 'unknown');
    assert.equal(classifyCiFailure([{ name: 'lint', conclusion: 'failure' }], 'The hosted runner encountered an error and lost communication').class, 'unknown', 'a lost runner in the log alone is no rerun');
  });

  test('successful / neutral / skipped jobs are not failures', () => {
    const c = classifyCiFailure([
      { name: 'a', conclusion: 'success' },
      { name: 'b', conclusion: 'neutral' },
      { name: 'c', conclusion: 'skipped' },
    ]);
    assert.deepEqual(c.failedJobs, []);
    assert.equal(c.class, 'unknown');
  });

  test('a cancelled job is unknown, whatever its log says (T0-CI-RERUN-STRUCTURED)', () => {
    assert.equal(classifyCiFailure([{ name: 'a', conclusion: 'cancelled', logExcerpt: 'The operation was canceled.' }]).class, 'unknown');
    assert.equal(classifyCiFailure([{ name: 'a', conclusion: 'cancelled' }]).class, 'unknown');
  });
});

describe('structured transient evidence (T0-CI-RERUN-STRUCTURED)', () => {
  /** A red gate line naming the checks, as the GitHub ship path prints it. */
  const gate = (checks: Array<{ name: string; conclusion: string }>) => `[CI-GATE-RED] ${JSON.stringify(checks)}`;
  /** A step line for a check: its failed step, or null when the record places none. */
  const step = (check: string, name: string | null) => `[CI-GATE-STEP] ${JSON.stringify({ check, job: '456', step: name === null ? null : { number: 3, name, conclusion: 'failure' } })}`;
  const ship = (text: string, transientSteps?: string[]) => classifyCiFailure([{ name: 'ship-ci-gate', aggregate: true, conclusion: 'failure', logExcerpt: text }], undefined, transientSteps ? { transientSteps } : undefined);
  const build = [{ name: 'build', conclusion: 'failure' }];

  test('acceptance 1: a red check whose failed step is Set up job or Complete job is transient; a project step, a null step or no step line is unknown [R3]', () => {
    for (const infra of ['Set up job', 'Complete job']) assert.equal(ship(`${gate(build)}\n${step('build', infra)}`).class, 'transient', infra);
    assert.equal(ship(`${gate(build)}\n${step('build', 'Run npm run check')}\nnpm ERR! network ECONNRESET`).class, 'unknown', 'a project step is no infrastructure under the default list');
    assert.equal(ship(`${gate(build)}\n${step('build', null)}`).class, 'unknown', 'no failed step placed');
    assert.equal(ship(`${gate(build)}\nnpm ERR! network ECONNRESET`).class, 'unknown', 'no step line: no structured evidence');
    assert.equal(ship(`${gate(build)}\n${step('other', 'Set up job')}`).class, 'unknown', 'a step line of another check is no evidence for this one');
    const succeeded = `[CI-GATE-STEP] ${JSON.stringify({ check: 'build', job: '456', step: { number: 1, name: 'Set up job', conclusion: 'success' } })}`;
    assert.equal(ship(`${gate(build)}\n${succeeded}`).class, 'unknown', 'a step that did not fail is no evidence');
    const encoded = `[CI-GATE-STEP] ${JSON.stringify({ check: 'build', job: '456', step: { number: 4, name: 'Run %5Bnet%5D fetch', conclusion: 'failure' } })}`;
    assert.equal(ship(`${gate(build)}\n${encoded}`, ['Run [net] fetch']).class, 'transient', 'step names are decoded before the list is read');
  });

  test('successor R3: unnamed independent failures cannot earn a rerun', () => {
    for (const name of ['', '   ']) {
      for (const conclusion of ['failure', 'startup_failure']) {
        const result = classifyCiFailure([{ name, conclusion, logExcerpt: step(name, 'Set up job') }]);
        assert.equal(result.class, 'unknown', JSON.stringify({ name, conclusion }));
        assert.equal(canRerun({ reruns: [] }, '42', 1, 'sha', result.class).allowed, false);
      }
    }
  });

  test('acceptance 1: a startup_failure conclusion is transient; every red check needs evidence [R3]', () => {
    assert.equal(ship(gate([{ name: 'build', conclusion: 'startup_failure' }])).class, 'transient');
    assert.equal(classifyCiFailure([{ name: 'build', conclusion: 'startup_failure' }]).class, 'transient', 'a failed job passed in directly');
    const two = [{ name: 'build', conclusion: 'failure' }, { name: 'lint', conclusion: 'failure' }];
    assert.equal(ship(`${gate(two)}\n${step('build', 'Set up job')}`).class, 'unknown', 'lint carries no evidence');
    assert.equal(ship(`${gate(two)}\n${step('build', 'Set up job')}\n${step('lint', 'Complete job')}`).class, 'transient', 'both carry evidence');
    assert.equal(ship(gate([{ name: 'build', conclusion: 'cancelled' }])).class, 'unknown', 'a cancelled check without evidence');
  });

  test('R3 F1: duplicate red names cannot borrow one job’s infrastructure evidence', () => {
    for (const other of ['', step('build', 'Run tests').replace('456', '789'), step('build', null).replace('456', '789')]) {
      const result = ship(`${gate([...build, ...build])}\n${step('build', 'Set up job')}\n${other}`);
      assert.equal(result.class, 'unknown', other || 'second job record missing');
      assert.equal(canRerun({ reruns: [] }, '123', 1, 'candidate', result.class).allowed, false);
    }
  });

  test('R3 F2: required skipped and neutral checks remain red beside an evidenced failure', () => {
    assert.equal(ship('[CI-GATE-RED] build=startup_failure').class, 'transient', 'a fully evidenced legacy gate still earns a rerun');
    assert.equal(ship('[CI-GATE-TIMEOUT] [{"name":"build","conclusion":"startup_failure"},{"name":"pending","conclusion":null}]').class, 'transient', 'pending timeout checks are not labelled red');
    for (const conclusion of ['skipped', 'neutral']) {
      for (const other of [{ name: 'build', conclusion: 'startup_failure' }, ...build]) {
        for (const red of [gate([{ name: 'required', conclusion }, other]), `[CI-GATE-RED] required=${conclusion},build=${other.conclusion}`]) {
          const result = ship(`${red}\n${step('build', 'Set up job')}`);
          assert.equal(result.class, 'unknown', `${conclusion} beside ${other.conclusion}`);
          assert.equal(canRerun({ reruns: [] }, '123', 1, 'candidate', result.class).allowed, false);
        }
      }
    }
  });

  test('R3 F3: unresolved red lines block transient eligibility without losing stronger evidence', () => {
    const startup = gate([{ name: 'build', conclusion: 'startup_failure' }]);
    for (const unresolved of ['[CI-GATE-RED] build,linux=failure', '[CI-GATE-RED] unreadable', '[CI-GATE-RED] [{"name":"lint"}', '[CI-GATE-RED] []', '[CI-GATE-RED] [null]', '[CI-GATE-RED] [7]', '[CI-GATE-RED] [{"name":7,"conclusion":"startup_failure"}]', '[CI-GATE-RED] [{"name":" ","conclusion":"startup_failure"}]', '[CI-GATE-RED] [{"name":"lint"}]', '[CI-GATE-RED] [{"name":"lint","conclusion":"startup_failure"},null]']) {
      const text = `${startup}\n${unresolved}\n${step('lint', 'Set up job')}`;
      const result = ship(text);
      assert.equal(result.class, 'unknown', unresolved);
      assert.equal(canRerun({ reruns: [] }, '123', 1, 'candidate', result.class).allowed, false);
      assert.equal(ship(`${text}\nAssertionError: expected 1`).class, 'code-defect');
      assert.equal(ship(`${text}\nleaks found: 1`).class, 'security');
    }
    assert.equal(ship(`${startup}\n[CI-GATE-RED] AssertionError: expected 1`).class, 'code-defect', 'scaffold text keeps its log classification');
  });

  test('R3 F3: whitespace-only names make a legacy red gate unresolved', () => {
    for (const text of ['[CI-GATE-RED]   =startup_failure', '[CI-GATE-RED] build=startup_failure,   =startup_failure']) {
      const result = ship(text);
      assert.equal(result.class, 'unknown', text);
      assert.equal(canRerun({ reruns: [] }, '123', 1, 'candidate', result.class).allowed, false);
    }
  });

  test('successor R3: structured evidence never hides an independent failed job', () => {
    const startup = { name: 'build', conclusion: 'startup_failure' };
    const jobs = [startup, { name: 'lint', conclusion: 'failure' }];
    const result = classifyCiFailure(jobs, gate([startup]));
    assert.equal(result.class, 'unknown');
    assert.equal(canRerun({ reruns: [] }, '123', 1, 'candidate', result.class).allowed, false);
    assert.deepEqual(result.failedJobs, ['build', 'lint']);
    assert.equal(classifyCiFailure([{ name: 'build', conclusion: 'failure' }, jobs[1]!], `${gate(build)}\n${step('build', 'Set up job')}`).class, 'unknown', 'same conclusion with a different name remains an independent failure');
    assert.equal(classifyCiFailure(jobs, `${gate([startup])}\n${step('lint', 'Set up job')}`).class, 'transient', 'every independent failure carries evidence');
  });

  test('successor R3: receipt wrappers must be explicit, never inferred from a name', () => {
    const log = gate([{ name: 'build', conclusion: 'startup_failure' }]);
    for (const name of ['log', 'ship-ci-gate', 'custom receipt']) {
      assert.equal(classifyCiFailure([{ name, conclusion: 'failure', logExcerpt: log }]).class, 'unknown', name);
      assert.equal(classifyCiFailure([{ name, conclusion: 'failure', logExcerpt: log, aggregate: true }]).class, 'transient', name);
    }
    assert.equal(classifyCiFailure([{ name: 'receipt', conclusion: 'startup_failure', aggregate: true }]).class, 'unknown', 'a wrapper conclusion is no job evidence');
  });

  test('successor R3: duplicate or contradictory independent records cannot disappear during matching', () => {
    const startup = { name: 'build', conclusion: 'startup_failure' };
    assert.equal(classifyCiFailure([startup, startup], gate([startup])).class, 'unknown');
    assert.equal(classifyCiFailure([{ name: 'build', conclusion: 'failure' }], gate([startup])).class, 'unknown');
    assert.equal(classifyCiFailure([{ ...startup, conclusion: 'STARTUP_FAILURE' }], gate([startup])).class, 'transient', 'case does not create a contradictory conclusion');
  });

  test('successor R3: identity validation includes non-failed independent records and gate records', () => {
    const startup = { name: 'build', conclusion: 'startup_failure' };
    for (const conclusion of ['success', 'neutral', 'skipped', null, undefined]) {
      const other = { name: 'build', conclusion };
      assert.equal(classifyCiFailure([other], gate([startup])).class, 'unknown', `gate conflict: ${conclusion}`);
      assert.equal(classifyCiFailure([startup, other]).class, 'unknown', `independent conflict: ${conclusion}`);
      assert.equal(classifyCiFailure([startup, { name: 'lint', conclusion }, { name: 'lint', conclusion }]).class, 'unknown', `duplicate non-failed name: ${conclusion}`);
      assert.equal(classifyCiFailure([startup, { name: 'lint', conclusion }]).class, 'transient', `unrelated record: ${conclusion}`);
      const timeout = `[CI-GATE-TIMEOUT] 0 pending checks: ${JSON.stringify([other])}`;
      assert.equal(classifyCiFailure([startup], timeout).class, 'unknown', `timeout conflict: ${conclusion}`);
      assert.equal(classifyCiFailure([], `${gate([startup])}\n${timeout}`).class, 'unknown', `gate-only conflict: ${conclusion}`);
    }
  });

  test('successor R3: structured lines count even inside a non-failed carrier', () => {
    const startup = { name: 'build', conclusion: 'startup_failure' };
    for (const conclusion of ['success', 'neutral', 'skipped', null, undefined]) for (const aggregate of [true, false]) {
      const carrier = { name: 'receipt', conclusion, aggregate };
      assert.equal(classifyCiFailure([startup, { ...carrier, logExcerpt: gate([{ name: 'lint', conclusion: 'failure' }]) }]).class, 'unknown');
      assert.equal(classifyCiFailure([startup, { ...carrier, logExcerpt: '[CI-GATE-RED] malformed' }]).class, 'unknown');
      assert.equal(classifyCiFailure([startup, { ...carrier, logExcerpt: `${gate([{ name: 'lint', conclusion: 'failure' }])}\n${step('lint', 'Set up job')}` }]).class, 'transient');
      for (const name of ['gitleaks', 'secret-scan', 'security']) {
        const secured = classifyCiFailure([startup, { ...carrier, logExcerpt: gate([{ name, conclusion: 'startup_failure' }]) }]);
        assert.equal(secured.class, 'security');
        assert.deepEqual(secured.evidence, [`security: ${name}`]);
      }
      assert.deepEqual(classifyCiFailure([startup, { ...carrier, logExcerpt: 'AssertionError: failed tests; leaks found: 3; ECONNRESET' }]), classifyCiFailure([startup]), 'non-failed carrier text keeps its original exclusion from log evidence');
    }
  });

  test('successor R3: malformed timeout records cannot hide behind evidenced red checks', () => {
    const ready = gate([{ name: 'build', conclusion: 'startup_failure' }]);
    for (const payload of ['[null]', '[42]', '[{}]', '[{"name":"","conclusion":"failure"}]', '[{"name":"lint","conclusion":42}]', '[{"name":"lint"}]', '[broken', 'not json']) {
      assert.equal(ship(`${ready}\n[CI-GATE-TIMEOUT] 1 pending checks: ${payload}`).class, 'unknown', payload);
    }
  });

  test('acceptance 1: ci.transientSteps declares which failed steps are infrastructure; the default does not list project steps [R1] [R3]', () => {
    const text = `${gate(build)}\n${step('build', 'Run npm ci')}\nnpm ERR! network ECONNRESET`;
    assert.equal(ship(text).class, 'unknown');
    assert.equal(ship(text, ['Set up job', 'Complete job', 'Run npm ci']).class, 'transient', 'a listed project step grants the rerun');
    assert.equal(ship(`${gate(build)}\n${step('build', 'Set up job')}`, ['Run npm ci']).class, 'unknown', 'the list replaces the default');
  });

  test('acceptance 1: code-defect and security evidence win over structured transient evidence; a step name is no log evidence [R3]', () => {
    assert.equal(ship(`${gate(build)}\n${step('build', 'Set up job')}\nAssertionError: expected 1 to equal 2`).class, 'code-defect');
    assert.equal(ship(`${gate([{ name: 'gitleaks', conclusion: 'failure' }])}\n${step('gitleaks', 'Set up job')}`).class, 'security');
    const named = ship(`${gate(build)}\n${step('build', 'AssertionError flaky retrying in 5')}`);
    assert.equal(named.class, 'unknown', 'the step name reaches no log pattern');
    assert.ok(!named.evidence.some((e) => e.startsWith('code:') || e.startsWith('transient:')), named.evidence.join('; '));
  });

  test('acceptance 2: a [CI-GATE-STEP] line is no ship sentinel [R2]', () => {
    const r = classifyShipOutput({ command: 'x', args: [], cwd: '', exitCode: 1, signal: null, timedOut: false, stdout: step('build', 'Set up job'), stderr: '', startedAt: T0, finishedAt: T0, durationMs: 0, outputSha256: '' });
    assert.equal(r.outcome, 'unclassified');
  });
});

describe('T0-CI-RERUN-STRUCTURED acceptance 4: the docs state the rule and the CLI says a log alone cannot be transient [R4] [R5]', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
  const SENTENCES = [
    'A CI failure is `transient`, and earns the one same-origin rerun, only on structured evidence for every red check (card T0-CI-RERUN-STRUCTURED): its conclusion is `startup_failure`, or the `[CI-GATE-STEP]` line the GitHub ship path prints from the job record names a failed step listed in `ci.transientSteps` (default `Set up job` and `Complete job`, the steps GitHub runs itself).',
    'Log text never grants a rerun: a failure whose only transient evidence is text, a cancelled check included, is `unknown` and stops as `ci` for diagnosis.',
    'A repository can list its own steps in `ci.transientSteps`; a listed step grants the rerun on any failure in it, so list only steps whose failures are usually infrastructure (a dependency download, for example).',
    'The scaffold path\'s CI gate prints no step lines, so a scaffold ship never earns a transient rerun (issue 137), and `aidlc ci classify --log` says that a log alone cannot be transient.',
  ];
  const SUCCESSOR_SENTENCES = [
    'Independent jobs remain required beside structured gate evidence (T0-CI-RERUN-STRUCTURED-2).',
    'The classifier unions independent failed jobs with gate checks, matches the same name and conclusion once, and refuses duplicate or contradictory identities.',
    'Only an explicit `aggregate: true` record is a receipt wrapper; the card runner and log CLI mark theirs, and a job name alone never excludes a failure.',
  ];
  const SUCCESSOR_ENTRY = '- T0-CI-RERUN-STRUCTURED-2: structured gate evidence no longer hides independently supplied failed jobs. Aggregate receipt wrappers are explicit; duplicate or contradictory independent jobs prevent a transient rerun.';
  const CHANGELOG_ENTRY = '- CI rerun on structured evidence, card T0-CI-RERUN-STRUCTURED (issue 76 item 2): a red CI failure is `transient`, the one same-origin rerun, only when every red check carries structured evidence, a `startup_failure` conclusion or a failed step listed in the new `ci.transientSteps` (default `Set up job`, `Complete job`), which the GitHub ship path prints as `[CI-GATE-STEP]` lines from the job records; log text, a cancelled check\'s included, no longer grants a rerun and classifies as `unknown` (STOP/ci). A network failure inside a project step is no longer rerun unless that step is listed; the scaffold path never earns a transient rerun (issue 137).';

  test('docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rule', () => {
    const operations = read('docs', 'OPERATIONS.md');
    for (const sentence of [...SENTENCES, ...SUCCESSOR_SENTENCES]) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    const changelog = read('CHANGELOG.md');
    assert.ok(changelogSince010(changelog).split('\n').includes(CHANGELOG_ENTRY), 'CHANGELOG.md Unreleased carries the entry');
    assert.ok(changelogSince010(changelog).split('\n').includes(SUCCESSOR_ENTRY), 'CHANGELOG.md Unreleased carries the successor entry');
  });

  test('aidlc ci classify --log on a log-only transient prints unknown and the note', () => {
    const dir = tmpDir('aidlc-ci-');
    try {
      const log = path.join(dir, 'ci.log');
      writeFileSync(log, 'npm ERR! network read ECONNRESET\n');
      const out = spawnSync(process.execPath, [path.join(root, 'src', 'cli', 'main.ts'), 'ci', 'classify', '--log', log, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, AIDLC_STATE_DIR: path.join(dir, '.aidlc') }, timeout: 60_000 });
      assert.equal(out.status, 0, out.stderr);
      const r = JSON.parse(out.stdout) as { class: string; note: string };
      assert.equal(r.class, 'unknown');
      assert.match(r.note, /a log alone cannot be transient/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('successor R4: ci classify marks a complete log receipt as aggregate', () => {
  const dir = tmpDir('aidlc-ci-aggregate-');
  try {
    const file = path.join(dir, 'ci.log');
    writeFileSync(file, '[CI-GATE-RED] [{"name":"build","conclusion":"startup_failure"}]');
    const cli = path.resolve(import.meta.dirname, '../../src/cli/main.ts');
    const out = spawnSync(process.execPath, [cli, 'ci', 'classify', '--log', file, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, AIDLC_STATE_DIR: path.join(dir, '.aidlc') }, timeout: 60_000 });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).class, 'transient');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('successor R4: ci classify applies disabled defaults and custom configured steps', () => {
  const dir = tmpDir('aidlc-ci-config-');
  try {
    const file = path.join(dir, 'ci.log');
    const cli = path.resolve(import.meta.dirname, '../../src/cli/main.ts');
    for (const [transientSteps, name, expected] of [
      [[], 'Set up job', 'unknown'],
      [['Download dependencies'], 'Download dependencies', 'transient'],
      [['Download dependencies'], 'Set up job', 'unknown'],
    ] as const) {
      writeFileSync(path.join(dir, 'aidlc.config.json'), JSON.stringify({ ci: { transientSteps } }));
      writeFileSync(file, '[CI-GATE-RED] [{"name":"build","conclusion":"failure"}]\n[CI-GATE-STEP] ' + JSON.stringify({ check: 'build', job: '1', step: { number: 1, name, conclusion: 'failure' } }));
      const out = spawnSync(process.execPath, [cli, 'ci', 'classify', '--log', file, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, AIDLC_STATE_DIR: path.join(dir, '.aidlc') }, timeout: 60_000 });
      assert.equal(out.status, 0, out.stderr);
      assert.equal(JSON.parse(out.stdout).class, expected, JSON.stringify({ transientSteps, name }));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('CI rerun allowance (Q7)', () => {
  test('Q7: a code defect never reruns; unknown must be diagnosed first', () => {
    assert.equal(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', 'code-defect').allowed, false);
    assert.match(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', 'code-defect').reason, /repair in BUILD/);
    assert.equal(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', 'unknown').allowed, false);
  });

  test('Q7: a justified transient failure reruns once per candidate; the intent is persisted first', () => {
    let ledger = CiLedger.parse({});
    assert.equal(canRerun(ledger, 'run-1', 1, 'cand-1', 'transient').allowed, true);
    ledger = recordRerunIntent(ledger, 'run-1', 1, 'cand-1', T0);
    assert.equal(ledger.reruns[0]?.outcome, 'requested');
    assert.equal(hasUnreconciledRerun(ledger), true);
    assert.equal(canRerun(ledger, 'run-1', 2, 'cand-1', 'transient').allowed, false, 'allowance consumed for the candidate');
    assert.equal(canRerun(ledger, 'run-2', 1, 'cand-1', 'transient').allowed, false);
  });

  test('Q7: a lost or queued rerun response still consumes the allowance', () => {
    let ledger = recordRerunIntent(CiLedger.parse({}), 'run-1', 1, 'cand-1', T0);
    ledger = reconcileRerun(ledger, 'run-1', 1, 'lost', T0);
    assert.equal(ledger.reruns[0]?.outcome, 'lost');
    assert.equal(ledger.reruns[0]?.reconciledAt, T0);
    assert.equal(hasUnreconciledRerun(ledger), true, 'a lost response must be looked up before any further CI action');
    assert.equal(canRerun(ledger, 'run-1', 2, 'cand-1', 'transient').allowed, false);
    ledger = reconcileRerun(ledger, 'run-1', 1, 'queued', T0);
    assert.equal(canRerun(ledger, 'run-1', 2, 'cand-1', 'transient').allowed, false);
  });

  test('a cancelled rerun does not count; a new candidate has its own allowance', () => {
    let ledger = recordRerunIntent(CiLedger.parse({}), 'run-1', 1, 'cand-1', T0);
    ledger = reconcileRerun(ledger, 'run-1', 1, 'cancelled', T0);
    assert.equal(hasUnreconciledRerun(ledger), false);
    assert.equal(canRerun(ledger, 'run-1', 2, 'cand-1', 'transient').allowed, true);
    ledger = recordRerunIntent(ledger, 'run-1', 2, 'cand-1', T0);
    ledger = reconcileRerun(ledger, 'run-1', 2, 'success', T0);
    assert.equal(canRerun(ledger, 'run-3', 1, 'cand-2', 'transient').allowed, true);
    assert.equal(canRerun(ledger, 'run-3', 1, 'cand-1', 'transient').allowed, false);
  });
});

describe('security class (T1-LOOP-GATES R7)', () => {
  /** The gate record the card runner hands classifyCiFailure: the ship receipt text as the log of an aggregate job. */
  const shipGate = (text: string): CiJob => ({ name: 'ship-ci-gate', aggregate: true, conclusion: 'failure', logExcerpt: text });
  /** The decoded names classifyCiFailure gives as security evidence for a gate text: its failed scan checks, in order. */
  const redScans = (text: string): string[] => classifyCiFailure([shipGate(text)]).evidence.filter((e) => e.startsWith('security: ')).map((e) => e.slice('security: '.length));
  /**
   * Whether classifyCiFailure reads these checks (decoded name and conclusion) from a gate text with no red scan. Each
   * check gets a failed `Set up job` step line and a direct job of the same name: with the same conclusion the failure is
   * transient only when every red gate check is one of them and agrees; with another conclusion it is not, which shows
   * the gate text reported that name.
   */
  const readsChecks = (text: string, checks: CiJob[]): boolean => {
    const steps = checks.map((c) => `[CI-GATE-STEP] ${JSON.stringify({ check: c.name, job: '1', step: { number: 1, name: 'Set up job', conclusion: 'failure' } })}`);
    const classify = (direct: CiJob[]) => classifyCiFailure([...direct, shipGate([text, ...steps].join('\n'))]).class;
    const other = (c: CiJob): CiJob => ({ ...c, conclusion: c.conclusion === 'neutral' ? 'skipped' : 'neutral' });
    return classify(checks) === 'transient' && checks.every((_, i) => classify(checks.map((c, j) => (j === i ? other(c) : c))) !== 'transient');
  };

  test('a failed check run named for a secret scan classifies as security from the JSON gate line', () => {
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"failure"}]\n[SAGA-FAIL]\n[SAGA-RESUME] aidlc card next T1-A' }]);
    assert.equal(c.class, 'security');
    assert.ok(c.evidence.includes('security: Gitleaks (committed history)'), c.evidence.join(' | '));
  });

  test('a raw gitleaks log classifies as security, as job text or as extra log text', () => {
    const log = 'Finding:     REDACTED\nSecret:      REDACTED\nRuleID:      generic-api-key\nEntropy:     4.2\n\n1:23PM WRN leaks found: 2';
    assert.equal(classifyCiFailure([{ name: 'log', conclusion: 'failure', logExcerpt: log }]).class, 'security');
    assert.equal(classifyCiFailure([{ name: 'log', conclusion: 'failure' }], log).class, 'security');
  });

  test('a failed job named for the secret scan classifies as security by its name; a green scan is no failure', () => {
    assert.equal(classifyCiFailure([{ name: 'Gitleaks (committed history)', conclusion: 'failure' }]).class, 'security');
    assert.equal(classifyCiFailure([{ name: 'secret_scan', conclusion: 'failure' }]).class, 'security');
    assert.equal(classifyCiFailure([{ name: 'secret-scanning', conclusion: 'failure' }]).class, 'security');
    assert.equal(classifyCiFailure([{ name: 'Gitleaks (committed history)', conclusion: 'success' }]).class, 'unknown');
  });

  test('security wins over code-defect and transient evidence next to the gate line', () => {
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] [{"name":"check (ubuntu-latest, 22)","conclusion":"failure"},{"name":"Gitleaks (committed history)","conclusion":"failure"}]\nAssertionError: expected 1 to equal 2\nsocket hang up' }]);
    assert.equal(c.class, 'security');
    assert.deepEqual(c.failedJobs, ['ship-ci-gate']);
  });

  test('a red check without a secret-scan name is not security', () => {
    assert.equal(classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] [{"name":"check (ubuntu-latest, 22)","conclusion":"failure"}]' }]).class, 'unknown');
    assert.equal(classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] [{"name":"check (ubuntu-latest, 22)","conclusion":"failure"}]\nAssertionError: expected 1 to equal 2' }]).class, 'code-defect');
  });

  test('names with =value fragments, recognised conclusion words inside them and underscore spellings survive; transient noise never earns the scan a rerun', () => {
    const line = '[CI-GATE-RED] [{"name":"scan (tool=gitleaks, os=linux)","conclusion":"failure"},{"name":"secret scan (tool=success, os=linux)","conclusion":"failure"},{"name":"secret_scan","conclusion":"failure"}]';
    assert.deepEqual(redScans(line), ['scan (tool=gitleaks, os=linux)', 'secret scan (tool=success, os=linux)', 'secret_scan']);
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: line + '\nread ECONNRESET while fetching artifact' }]);
    assert.equal(c.class, 'security', c.evidence.join(' | '));
    assert.ok(c.evidence.includes('security: secret scan (tool=success, os=linux)'), 'a conclusion word inside a name never truncates it');
    assert.equal(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', c.class).allowed, false);
  });

  test('the JSON gate line keeps names with newlines and sentinel-like text; brackets and percent signs decode; a non-JSON gate line is opaque', () => {
    const jsonLine = '[CI-GATE-RED] [{"name":"scan (tool=gitleaks,\\nos=linux)","conclusion":"failure"},{"name":"%5BSHIP-MERGE-FAIL%5D 100%25 diagnostics","conclusion":"success"}]';
    // A red scan is security before any other name counts, so the second entry is read on a red line of its own.
    assert.deepEqual(redScans(jsonLine), ['scan (tool=gitleaks,\nos=linux)']);
    assert.ok(readsChecks('[CI-GATE-RED] [{"name":"%5BSHIP-MERGE-FAIL%5D 100%25 diagnostics","conclusion":"success"}]', [{ name: '[SHIP-MERGE-FAIL] 100% diagnostics', conclusion: 'success' }]));
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: jsonLine + '\nread ECONNRESET while fetching artifact' }]);
    assert.equal(c.class, 'security', c.evidence.join(' | '));
    const timeout = '[CI-GATE-TIMEOUT] 2 pending checks: [{"name":"ci","conclusion":null,"status":"in_progress"},{"name":"x","conclusion":null,"status":"absent"}]';
    assert.ok(readsChecks(`${timeout}\n[CI-GATE-RED] [{"name":"build","conclusion":"startup_failure"}]`, [{ name: 'ci', conclusion: null }, { name: 'x', conclusion: null }, { name: 'build', conclusion: 'startup_failure' }]), 'the timeout line is structured too');
    const opaque = '[CI-GATE-RED] secret scan (tool=success, os=linux)=failure';
    assert.deepEqual(redScans(opaque), [`unparsed red gate line naming a scan: ${opaque}`], 'text after the sentinel is never parsed into names');
  });

  test('a green scan next to a red build is a code defect: conclusions decide which scans count', () => {
    const json = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"success"},{"name":"build-test","conclusion":"failure"}]\nAssertionError: expected 1 to equal 2' }]);
    assert.equal(json.class, 'code-defect', json.evidence.join(' | '));
    assert.equal(classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"skipped"},{"name":"build-test","conclusion":"failure"}]' }]).class, 'unknown', 'a skipped scan is no security evidence');
  });

  test('a name with a Unicode line separator survives the JSON gate line, in the text and through the parser', () => {
    for (const sep of ['\u2028', '\u2029']) {
      const line = '[CI-GATE-RED] ' + JSON.stringify([{ name: `scan (tool=gitleaks,${sep}os=linux)`, conclusion: 'failure' }, { name: 'flaky-tests', conclusion: 'failure' }]);
      assert.deepEqual(redScans(line), [`scan (tool=gitleaks,${sep}os=linux)`]);
      assert.ok(readsChecks('[CI-GATE-RED] ' + JSON.stringify([{ name: 'flaky-tests', conclusion: 'failure' }]), [{ name: 'flaky-tests', conclusion: 'failure' }]), 'the second entry, on a red line of its own');
      const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: line + '\nread ECONNRESET while fetching artifact' }]);
      assert.equal(c.class, 'security', c.evidence.join(' | '));
    }
  });

  test('the safe legacy form still counts: plain name=conclusion pairs parse, an ambiguous red line with a scan name fails closed, the scaffold text stays free text', () => {
    const legacy = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] secret_scan=failure\nread ECONNRESET while fetching artifact' }]);
    assert.equal(legacy.class, 'security', legacy.evidence.join(' | '));
    assert.ok(readsChecks('[CI-GATE-RED] Gitleaks (committed history)=success,build-test=failure', [{ name: 'Gitleaks (committed history)', conclusion: 'success' }, { name: 'build-test', conclusion: 'failure' }]));
    const green = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] Gitleaks (committed history)=success,build-test=failure\nAssertionError: expected 1 to equal 2' }]);
    assert.equal(green.class, 'code-defect', green.evidence.join(' | '));
    const ambiguous = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] secret scan (tool=success, os=linux)=failure\nread ECONNRESET while fetching artifact' }]);
    assert.equal(ambiguous.class, 'security', 'a red line that names a scan but cannot be parsed fails closed');
    assert.equal(classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] job failed: https://github.com/o/r/actions/runs/777 ... AssertionError: expected 2 to equal 3' }]).class, 'code-defect', 'scaffold output keeps its log classification');
  });

  test('every red gate line counts: a scan failure on a later line wins over an earlier build failure and transient text', () => {
    const text = '[CI-GATE-RED] [{"name":"build-test","conclusion":"failure"}]\n[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"failure"}]\nread ECONNRESET while fetching artifact';
    assert.deepEqual(redScans(text), ['Gitleaks (committed history)']);
    assert.ok(readsChecks(text.split('\n')[0]!, [{ name: 'build-test', conclusion: 'failure' }]), 'the first line, read without the red scan of the second');
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: text }]);
    assert.equal(c.class, 'security', c.evidence.join(' | '));
  });

  test('check metadata never feeds the log regexes: a wait line naming flaky-tests is no transient evidence and a green scan named after a leak is no security evidence', () => {
    const noise = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-WAIT] 1 pending: [{"name":"flaky-tests","conclusion":null,"status":"in_progress"}]\n[CI-GATE-RED] [{"name":"build-test","conclusion":"failure"}]' }]);
    assert.equal(noise.class, 'unknown', noise.evidence.join(' | '));
    assert.equal(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', noise.class).allowed, false);
    const named = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] [{"name":"Gitleaks leaks found: 2","conclusion":"success"},{"name":"build-test","conclusion":"failure"}]\nAssertionError: expected 1 to equal 2' }]);
    assert.equal(named.class, 'code-defect', named.evidence.join(' | '));
  });

  test('security never reruns', () => {
    const d = canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', 'security');
    assert.equal(d.allowed, false);
    assert.match(d.reason, /security gate/);
  });
});

describe('scan setup steps (T0-SCAN-SETUP-STEP-2)', () => {
  const SCAN = 'Gitleaks (committed history)';
  const INSTALL = 'Install gitleaks (pinned version, checksum verified)';
  /** A step line for a check, as the GitHub ship path prints it from the job record. */
  const stepLine = (check: string, name: string | null, conclusion = 'failure', job = '128690143221') => `[CI-GATE-STEP] ${JSON.stringify({ check, job, step: name === null ? null : { number: 3, name, conclusion } })}`;
  const redLine = (...names: string[]) => `[CI-GATE-RED] ${JSON.stringify(names.map((name) => ({ name, conclusion: 'failure' })))}`;
  /** The gate output of run 42467444385 attempt 1 (PR 236): the install step failed on a 504 and the scan step was skipped. */
  const RUN_42467444385 = [redLine(SCAN), stepLine(SCAN, INSTALL), 'curl: (22) The requested URL returned error: 504'].join('\n');
  const ship = (text: string, options?: { transientSteps?: string[]; scanSetupSteps?: string[] }) => classifyCiFailure([{ name: 'ship-ci-gate', aggregate: true, conclusion: 'failure', logExcerpt: text }], undefined, options);

  test('acceptance 1: a scan check red at its listed install step is no security finding and says why [R1] [R4]', () => {
    const c = ship(RUN_42467444385);
    assert.equal(c.class, 'unknown');
    assert.ok(!c.evidence.some((e) => e.startsWith('security:')), c.evidence.join(' | '));
    assert.equal(c.evidence.at(-1), 'scan-setup: "Gitleaks (committed history)" failed at "Install gitleaks (pinned version, checksum verified)" before its scan');
    assert.equal(classifyCiFailure([{ name: SCAN, conclusion: 'failure', logExcerpt: stepLine(SCAN, INSTALL) }]).class, 'unknown', 'a failed job passed in directly with its step line');
  });

  test('acceptance 2: a scan check stays security unless every record of it places the failure in a listed setup step [R3]', () => {
    const cases: Array<[string, string, { scanSetupSteps?: string[] }?]> = [
      ['no step line', [redLine(SCAN), 'curl: (22) The requested URL returned error: 504'].join('\n')],
      ['a null step', [redLine(SCAN), stepLine(SCAN, null)].join('\n')],
      ['the scan step', [redLine(SCAN), stepLine(SCAN, 'Scan committed history')].join('\n')],
      ['a listed step that did not fail', [redLine(SCAN), stepLine(SCAN, INSTALL, 'success')].join('\n')],
      ['a step line of another check', [redLine(SCAN), stepLine('build', INSTALL)].join('\n')],
      ['an empty list', RUN_42467444385, { scanSetupSteps: [] }],
      ['a second step line naming the scan step', [RUN_42467444385, stepLine(SCAN, 'Scan committed history', 'failure', '2')].join('\n')],
      ['a duplicate red check name', [redLine(SCAN, SCAN), stepLine(SCAN, INSTALL)].join('\n')],
      ['the check red on two gate lines', [RUN_42467444385, redLine(SCAN)].join('\n')],
      ['an unresolved red line', [RUN_42467444385, '[CI-GATE-RED] unreadable'].join('\n')],
      ['raw gitleaks output', [RUN_42467444385, '1:23PM WRN leaks found: 2'].join('\n')],
      ['a RuleID line', [RUN_42467444385, 'RuleID:      generic-api-key'].join('\n')],
      ['an unparsed red line naming a scan', [RUN_42467444385, '[CI-GATE-RED] Gitleaks (committed history),linux=failure'].join('\n')],
      ['a malformed step line naming the check', [RUN_42467444385, `[CI-GATE-STEP] ${JSON.stringify({ check: SCAN, job: '2', step: { number: 4, name: 'Scan committed history', conclusion: null } })}`].join('\n')],
      ['a malformed step line naming the check, the setup step on transientSteps', [RUN_42467444385, `[CI-GATE-STEP] ${JSON.stringify({ check: SCAN, job: '2', step: { number: 4, name: 'Scan committed history', conclusion: null } })}`].join('\n'), { transientSteps: ['Set up job', 'Complete job', INSTALL] } as { scanSetupSteps?: string[] }],
      ['a malformed step line naming no readable check', [RUN_42467444385, '[CI-GATE-STEP] {"job":"2","step":null'].join('\n')],
      ['a step line of valid JSON naming no check', [RUN_42467444385, '[CI-GATE-STEP] {"job":"2","step":null}'].join('\n')],
      ['a step line whose check is not a string', [RUN_42467444385, '[CI-GATE-STEP] {"check":7,"job":"2","step":null}'].join('\n')],
      ['a red line with a raw bracket in another check name', [RUN_42467444385, redLine('build [x]')].join('\n')],
      ['a lone percent sign in the step name of another check', [RUN_42467444385, stepLine('build', 'Run 100% tests')].join('\n')],
      ['a red line whose element carries another key', [RUN_42467444385, `[CI-GATE-RED] ${JSON.stringify([{ name: 'build', conclusion: 'failure', extra: 1 }])}`].join('\n')],
      ['a red line with other spacing', [RUN_42467444385, `[CI-GATE-RED]  ${JSON.stringify([{ name: 'build', conclusion: 'failure' }])}`].join('\n')],
      ['a red line whose element carries status completed', [RUN_42467444385, `[CI-GATE-RED] ${JSON.stringify([{ name: 'build', conclusion: 'failure', status: 'completed' }])}`].join('\n')],
      ...['', '  '].flatMap((blank): Array<[string, string, { scanSetupSteps?: string[] }?]> => {
        const malformed = `[CI-GATE-STEP] ${JSON.stringify({ check: blank, job: '2', step: { number: 4, name: 'Scan committed history', conclusion: null } })}`;
        const wellFormed = stepLine(blank, 'Scan committed history', 'failure', '2');
        const allowlisted = { transientSteps: ['Set up job', 'Complete job', INSTALL] } as { scanSetupSteps?: string[] };
        return [
          [`a malformed step line with the blank check ${JSON.stringify(blank)}`, [RUN_42467444385, malformed].join('\n')],
          [`a malformed step line with the blank check ${JSON.stringify(blank)}, the setup step on transientSteps`, [RUN_42467444385, malformed].join('\n'), allowlisted],
          [`a step line with the blank check ${JSON.stringify(blank)}`, [RUN_42467444385, wellFormed].join('\n')],
          [`a step line with the blank check ${JSON.stringify(blank)}, the setup step on transientSteps`, [RUN_42467444385, wellFormed].join('\n'), allowlisted],
        ];
      }),
    ];
    /** Raw gitleaks output is a hit of its own: the check itself is exempt and keeps its note. */
    const ownHit = new Set(['raw gitleaks output', 'a RuleID line']);
    for (const [label, text, options] of cases) {
      const c = ship(text, options);
      assert.equal(c.class, 'security', `${label}: ${c.evidence.join(' | ')}`);
      assert.equal(c.evidence.some((e) => e.startsWith('scan-setup:')), ownHit.has(label), `${label}: scan-setup evidence only where the check itself is exempt`);
    }
    const gate: CiJob = { name: 'ship-ci-gate', aggregate: true, conclusion: 'failure', logExcerpt: RUN_42467444385 };
    const direct: Array<[string, CiJob[]]> = [
      ['two job records of the check', [{ name: SCAN, conclusion: 'failure' }, { name: SCAN, conclusion: 'failure' }, gate]],
      ['a job record and a gate record that disagree', [{ name: SCAN, conclusion: 'success' }, gate]],
      ['an aggregate wrapper named for a scan', [{ ...gate, name: SCAN }]],
    ];
    for (const [label, jobs] of direct) {
      const c = classifyCiFailure(jobs);
      assert.equal(c.class, 'security', `${label}: ${c.evidence.join(' | ')}`);
    }
    assert.equal(classifyCiFailure([{ name: SCAN, conclusion: 'failure' }, gate]).class, 'unknown', 'one job record corroborates one gate record');
    // The only step line of the check names the install step, in a form the GitHub ship path never prints.
    const install = { number: 3, name: INSTALL, conclusion: 'failure' };
    const forms: Array<[string, string]> = [
      ['no job and no number', JSON.stringify({ check: SCAN, step: { name: INSTALL, conclusion: 'failure' } })],
      ['job null and number "bad"', JSON.stringify({ check: SCAN, job: null, step: { number: 'bad', name: INSTALL, conclusion: 'failure' } })],
      ['a numeric job', JSON.stringify({ check: SCAN, job: 128690143221, step: install })],
      ['a job that is not digits', JSON.stringify({ check: SCAN, job: 'abc', step: install })],
      ['step number 0', JSON.stringify({ check: SCAN, job: '1', step: { ...install, number: 0 } })],
      ['step number 3.5', JSON.stringify({ check: SCAN, job: '1', step: { ...install, number: 3.5 } })],
      ['another top-level key', JSON.stringify({ check: SCAN, job: '1', step: install, extra: 1 })],
      ['another step key', JSON.stringify({ check: SCAN, job: '1', step: { ...install, extra: 1 } })],
      ['a repeated key', `{"check":${JSON.stringify(SCAN)},"check":${JSON.stringify(SCAN)},"job":"1","step":${JSON.stringify(install)}}`],
      ['another key order', JSON.stringify({ job: '1', check: SCAN, step: install })],
      ['other spacing', JSON.stringify({ check: SCAN, job: '1', step: install }).replace('"job":', '"job": ')],
    ];
    for (const [label, payload] of forms) {
      for (const transientSteps of [undefined, ['Set up job', 'Complete job', INSTALL]]) {
        for (const line of [`[CI-GATE-STEP] ${payload}`, ...(label === 'other spacing' ? [`[CI-GATE-STEP]  ${JSON.stringify({ check: SCAN, job: '1', step: install })}`] : [])]) {
          const c = ship([redLine(SCAN), line].join('\n'), { ...(transientSteps ? { transientSteps } : {}) });
          assert.equal(c.class, 'security', `${label}${transientSteps ? ', the setup step on transientSteps' : ''}: ${c.evidence.join(' | ')}`);
          assert.ok(!c.evidence.some((e) => e.startsWith('scan-setup:')), `${label}: no scan-setup evidence`);
        }
      }
    }
    const slashed = { scanSetupSteps: ['Install a/b'] };
    const escaped = `[CI-GATE-STEP] {"check":${JSON.stringify(SCAN)},"job":"1","step":{"number":3,"name":"Install a\\/b","conclusion":"failure"}}`;
    assert.equal(ship([redLine(SCAN), escaped].join('\n'), slashed).class, 'unknown', 'a step name with / written as \\/, as the ship path prints it');
    assert.equal(ship([redLine(SCAN), escaped.replace('a\\/b', 'a/b')].join('\n'), slashed).class, 'security', 'a / the ship path would have escaped');
  });

  test('acceptance 3: one gate line in another form than the ship path prints denies every exemption; names in the printed encoding are exempt [R1] [R2] [R3]', () => {
    const scanStep = { number: 4, name: 'Scan committed history', conclusion: 'failure' };
    const repeated = `[CI-GATE-STEP] {"check":${JSON.stringify(SCAN)},"check":"build","job":"2","step":${JSON.stringify(scanStep)}}`;
    const bracket = 'Install [gitleaks]';
    const allowlisted = { transientSteps: ['Set up job', 'Complete job', INSTALL] };
    const cases: Array<[string, string, { transientSteps?: string[]; scanSetupSteps?: string[] }?]> = [
      ['a step line naming build whose check key repeats, the scan check first', [RUN_42467444385, repeated].join('\n')],
      ['the same line with its step conclusion null', [RUN_42467444385, repeated.replace('"conclusion":"failure"', '"conclusion":null')].join('\n')],
      ['a raw [ in the step name, listed as written', [redLine(SCAN), stepLine(SCAN, bracket)].join('\n'), { scanSetupSteps: [bracket] }],
      ['the check written with %5b in its step line', [redLine('Gitleaks %5Bx%5D'), stepLine('Gitleaks %5bx%5d', INSTALL)].join('\n')],
      ['a red line whose first element repeats name, the scan check first, beside its own element', [`[CI-GATE-RED] [{"name":${JSON.stringify(SCAN)},"name":"build","conclusion":"failure"},${JSON.stringify({ name: SCAN, conclusion: 'failure' })}]`, stepLine(SCAN, INSTALL)].join('\n')],
      ['a legacy red line for another check', [RUN_42467444385, '[CI-GATE-RED] build=failure'].join('\n')],
      ['a timeout line', [RUN_42467444385, `[CI-GATE-TIMEOUT] 1 pending checks: ${JSON.stringify([{ name: 'build', conclusion: null, status: 'queued' }])}`].join('\n')],
      ['a second step line of the check at the same listed step', [RUN_42467444385, stepLine(SCAN, INSTALL, 'failure', '2')].join('\n')],
      // R3 decision 1: the gate prints a red line only for completed check runs, so no printed element has a status.
      ['the red line of the check with status "" on its element', [`[CI-GATE-RED] ${JSON.stringify([{ name: SCAN, conclusion: 'failure', status: '' }])}`, stepLine(SCAN, INSTALL)].join('\n')],
      ['the red line of the check with status "" on its element, the setup step on transientSteps', [`[CI-GATE-RED] ${JSON.stringify([{ name: SCAN, conclusion: 'failure', status: '' }])}`, stepLine(SCAN, INSTALL)].join('\n'), allowlisted],
      ['the red line of the check with status queued on its element', [`[CI-GATE-RED] ${JSON.stringify([{ name: SCAN, conclusion: 'failure', status: 'queued' }])}`, stepLine(SCAN, INSTALL)].join('\n')],
      ['beside them, a red line with status "" on the element of another check', [RUN_42467444385, `[CI-GATE-RED] ${JSON.stringify([{ name: 'build', conclusion: 'failure', status: '' }])}`].join('\n')],
      // The step a printed step line names is the first whose conclusion is `failure`.
      ['the step line of the check with the conclusion FAILURE', [redLine(SCAN), stepLine(SCAN, INSTALL, 'FAILURE')].join('\n')],
      ['the step line of the check with the conclusion FAILURE, the setup step on transientSteps', [redLine(SCAN), stepLine(SCAN, INSTALL, 'FAILURE')].join('\n'), allowlisted],
      // A sweep of both printers: a passing run is never on a red line, and the job id prints as the check run id does.
      ['beside them, a red line whose element for another check has the conclusion success', [RUN_42467444385, `[CI-GATE-RED] ${JSON.stringify([{ name: 'build', conclusion: 'success' }])}`].join('\n')],
      ['the step line of the check with the job 0128690143221', [redLine(SCAN), stepLine(SCAN, INSTALL, 'failure', '0128690143221')].join('\n')],
      ['beside them, an empty red line', [RUN_42467444385, '[CI-GATE-RED] []'].join('\n')],
    ];
    const exempted = cases.flatMap(([label, text, options]) => {
      const c = ship(text, options);
      return c.class === 'security' && !c.evidence.some((e) => e.startsWith('scan-setup:')) ? [] : [`${label}: ${c.class}, ${c.evidence.join(' | ')}`];
    });
    assert.deepEqual(exempted, [], 'each form denies the exemption: security, with no scan-setup evidence');
    // The lines as the GitHub ship path prints them: names through encodeUntrusted, `/` written `\/`.
    const printedRed = (name: string) => `[CI-GATE-RED] ${JSON.stringify([{ name: encodeUntrusted(name), conclusion: 'failure' }]).replace(/\//g, '\\/')}`;
    const printedStep = (check: string, name: string) => `[CI-GATE-STEP] ${JSON.stringify({ check: encodeUntrusted(check), job: '1', step: { number: 3, name: encodeUntrusted(name), conclusion: 'failure' } }).replace(/\//g, '\\/')}`;
    const check = 'Gitleaks [x] 100% /runs';
    const install = 'Install [gitleaks] 100% /tmp';
    const printed = [printedRed(check), printedStep(check, install)].join('\n');
    assert.ok(printed.includes('%5Bx%5D 100%25 \\/runs') && printed.includes('%5Bgitleaks%5D 100%25 \\/tmp'), printed);
    const c = ship(printed, { scanSetupSteps: [install] });
    assert.equal(c.class, 'unknown', c.evidence.join(' | '));
    assert.equal(c.evidence.at(-1), `scan-setup: ${JSON.stringify(check)} failed at ${JSON.stringify(install)} before its scan`);
  });

  test('acceptance 4: the exempt check takes the class its other evidence gives, and ci classify reads the configured list [R1] [R4]', () => {
    assert.equal(ship(RUN_42467444385, { transientSteps: ['Set up job', 'Complete job', INSTALL] }).class, 'transient', 'a setup step also on transientSteps earns the rerun any check earns');
    const beside = [redLine('check (ubuntu-latest, 22)', SCAN), stepLine(SCAN, INSTALL), 'AssertionError: expected 1 to equal 2'].join('\n');
    assert.equal(ship(beside).class, 'code-defect', 'a failing test beside the scan setup failure is a code defect');
    const disagreeing = classifyCiFailure([{ name: 'check (ubuntu-latest, 22)', conclusion: 'cancelled' }, { name: 'ship-ci-gate', aggregate: true, conclusion: 'failure', logExcerpt: beside }]);
    assert.equal(disagreeing.class, 'code-defect', `records of another check that disagree leave the scan exempt: ${disagreeing.evidence.join(' | ')}`);
    const audit = ship([redLine(SCAN, 'security audit'), stepLine(SCAN, INSTALL)].join('\n'));
    assert.equal(audit.class, 'security', 'a second red scan check is a finding');
    assert.deepEqual([audit.evidence[0], audit.evidence.at(-1)], ['security: security audit', 'scan-setup: "Gitleaks (committed history)" failed at "Install gitleaks (pinned version, checksum verified)" before its scan']);
    const dir = tmpDir('aidlc-ci-scan-');
    try {
      const file = path.join(dir, 'ci.log');
      writeFileSync(file, RUN_42467444385);
      const cli = path.resolve(import.meta.dirname, '../../src/cli/main.ts');
      const classify = (): string => {
        const out = spawnSync(process.execPath, [cli, 'ci', 'classify', '--log', file, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, AIDLC_STATE_DIR: path.join(dir, '.aidlc') }, timeout: 60_000 });
        assert.equal(out.status, 0, out.stderr);
        return (JSON.parse(out.stdout) as { class: string }).class;
      };
      assert.equal(classify(), 'unknown', 'the default list');
      writeFileSync(path.join(dir, 'aidlc.config.json'), JSON.stringify({ ci: { scanSetupSteps: [] } }));
      assert.equal(classify(), 'security', 'an empty configured list');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
