import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canRerun, classifyCiFailure, gateChecks, hasUnreconciledRerun, reconcileRerun, recordRerunIntent } from '../../src/core/ci-policy.ts';
import { classifyShipOutput } from '../../src/delivery/ship.ts';
import { CiLedger } from '../../src/core/types.ts';
import { T0 } from './_fixtures.ts';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
  const CHANGELOG_ENTRY = '- CI rerun on structured evidence, card T0-CI-RERUN-STRUCTURED (issue 76 item 2): a red CI failure is `transient`, the one same-origin rerun, only when every red check carries structured evidence, a `startup_failure` conclusion or a failed step listed in the new `ci.transientSteps` (default `Set up job`, `Complete job`), which the GitHub ship path prints as `[CI-GATE-STEP]` lines from the job records; log text, a cancelled check\'s included, no longer grants a rerun and classifies as `unknown` (STOP/ci). A network failure inside a project step is no longer rerun unless that step is listed; the scaffold path never earns a transient rerun (issue 137).';

  test('docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rule', () => {
    const operations = read('docs', 'OPERATIONS.md');
    for (const sentence of SENTENCES) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    const changelog = read('CHANGELOG.md');
    const start = changelog.indexOf('## Unreleased');
    assert.ok(changelog.slice(start, changelog.indexOf('\n## ', start + 1)).split('\n').includes(CHANGELOG_ENTRY), 'CHANGELOG.md Unreleased carries the entry');
  });

  test('aidlc ci classify --log on a log-only transient prints unknown and the note', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-ci-'));
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
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-ci-aggregate-'));
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
    assert.deepEqual(gateChecks(line)?.map((c) => c.name), ['scan (tool=gitleaks, os=linux)', 'secret scan (tool=success, os=linux)', 'secret_scan']);
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: line + '\nread ECONNRESET while fetching artifact' }]);
    assert.equal(c.class, 'security', c.evidence.join(' | '));
    assert.ok(c.evidence.includes('security: secret scan (tool=success, os=linux)'), 'a conclusion word inside a name never truncates it');
    assert.equal(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', c.class).allowed, false);
  });

  test('the JSON gate line keeps names with newlines and sentinel-like text; brackets and percent signs decode; a non-JSON gate line is opaque', () => {
    const jsonLine = '[CI-GATE-RED] [{"name":"scan (tool=gitleaks,\\nos=linux)","conclusion":"failure"},{"name":"%5BSHIP-MERGE-FAIL%5D 100%25 diagnostics","conclusion":"success"}]';
    assert.deepEqual(gateChecks(jsonLine), [{ name: 'scan (tool=gitleaks,\nos=linux)', conclusion: 'failure' }, { name: '[SHIP-MERGE-FAIL] 100% diagnostics', conclusion: 'success' }]);
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: jsonLine + '\nread ECONNRESET while fetching artifact' }]);
    assert.equal(c.class, 'security', c.evidence.join(' | '));
    assert.equal(gateChecks('[CI-GATE-TIMEOUT] 2 pending checks: [{"name":"ci","conclusion":null,"status":"in_progress"},{"name":"x","conclusion":null,"status":"absent"}]')?.length, 2, 'the timeout line is structured too');
    assert.equal(gateChecks('[CI-GATE-RED] secret scan (tool=success, os=linux)=failure'), undefined, 'text after the sentinel is never parsed into names');
  });

  test('a green scan next to a red build is a code defect: conclusions decide which scans count', () => {
    const json = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"success"},{"name":"build-test","conclusion":"failure"}]\nAssertionError: expected 1 to equal 2' }]);
    assert.equal(json.class, 'code-defect', json.evidence.join(' | '));
    assert.equal(classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"skipped"},{"name":"build-test","conclusion":"failure"}]' }]).class, 'unknown', 'a skipped scan is no security evidence');
  });

  test('a name with a Unicode line separator survives the JSON gate line, in the text and through the parser', () => {
    for (const sep of ['\u2028', '\u2029']) {
      const line = '[CI-GATE-RED] ' + JSON.stringify([{ name: `scan (tool=gitleaks,${sep}os=linux)`, conclusion: 'failure' }, { name: 'flaky-tests', conclusion: 'failure' }]);
      assert.deepEqual(gateChecks(line)?.map((c) => c.name), [`scan (tool=gitleaks,${sep}os=linux)`, 'flaky-tests']);
      const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: line + '\nread ECONNRESET while fetching artifact' }]);
      assert.equal(c.class, 'security', c.evidence.join(' | '));
    }
  });

  test('the safe legacy form still counts: plain name=conclusion pairs parse, an ambiguous red line with a scan name fails closed, the scaffold text stays free text', () => {
    const legacy = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] secret_scan=failure\nread ECONNRESET while fetching artifact' }]);
    assert.equal(legacy.class, 'security', legacy.evidence.join(' | '));
    assert.deepEqual(gateChecks('[CI-GATE-RED] Gitleaks (committed history)=success,build-test=failure'), [{ name: 'Gitleaks (committed history)', conclusion: 'success' }, { name: 'build-test', conclusion: 'failure' }]);
    const green = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] Gitleaks (committed history)=success,build-test=failure\nAssertionError: expected 1 to equal 2' }]);
    assert.equal(green.class, 'code-defect', green.evidence.join(' | '));
    const ambiguous = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] secret scan (tool=success, os=linux)=failure\nread ECONNRESET while fetching artifact' }]);
    assert.equal(ambiguous.class, 'security', 'a red line that names a scan but cannot be parsed fails closed');
    assert.equal(classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] job failed: https://github.com/o/r/actions/runs/777 ... AssertionError: expected 2 to equal 3' }]).class, 'code-defect', 'scaffold output keeps its log classification');
  });

  test('every red gate line counts: a scan failure on a later line wins over an earlier build failure and transient text', () => {
    const text = '[CI-GATE-RED] [{"name":"build-test","conclusion":"failure"}]\n[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"failure"}]\nread ECONNRESET while fetching artifact';
    assert.deepEqual(gateChecks(text)?.map((c) => c.name), ['build-test', 'Gitleaks (committed history)']);
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
