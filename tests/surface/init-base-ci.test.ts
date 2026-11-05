// Card T1-INIT-BASE-CI: the base of a created config, the workflows that need a package.json, and the npx form of every workflow.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject, type InitOptions } from '../../src/scaffold/init.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI = '.github/workflows/aidlc-ci.yml';
const EVALS = '.github/workflows/agent-evals.yml';
const SCANNERS = '.github/workflows/security-scanners.yml';
const SKIP_CI = `${CI} (no package.json)`;
const SKIP_EVALS = `${EVALS} (no package.json)`;

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-base-ci-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
}

/** A repository on `branch` with one commit. */
function repository(branch: string): string {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'first');
  return dir;
}

/** A clone of a repository on `branch`, moved to a branch `work`, so only the remote lookup can name `branch`. */
function cloneOf(branch: string): string {
  const clone = path.join(tempDir(), 'clone');
  git(path.dirname(clone), 'clone', '-q', repository(branch), clone);
  git(clone, 'switch', '-q', '-c', 'work');
  return clone;
}

function baseAfterInit(target: string): unknown {
  initProject({ target });
  return (JSON.parse(readFileSync(path.join(target, 'aidlc.config.json'), 'utf8')) as { base: unknown }).base;
}

function holdingOneFile(): string {
  const target = tempDir();
  writeFileSync(path.join(target, 'build.gradle'), '');
  return target;
}

describe('T1-INIT-BASE-CI: the base of a created config', () => {
  test('acceptance 1: a clone whose remote default branch is master gets master, whatever branch it is on [R1]', () => {
    assert.equal(baseAfterInit(cloneOf('master')), 'master');
  });

  test('acceptance 1: a remote default with a slash in its name loses only the leading origin/ [R1]', () => {
    assert.equal(baseAfterInit(cloneOf('feature/x')), 'feature/x');
  });

  test('acceptance 1: a repository with no remote on branch develop gets develop [R1]', () => {
    assert.equal(baseAfterInit(repository('develop')), 'develop');
  });

  test('acceptance 1: a repository with no remote and no commit gets its current branch [R1]', () => {
    const target = tempDir();
    git(target, 'init', '-q', '-b', 'develop');
    assert.equal(baseAfterInit(target), 'develop');
  });

  test('acceptance 1: a tag named like the branch still gives the branch name [R1]', () => {
    const target = repository('develop');
    git(target, 'tag', 'develop');
    assert.equal(baseAfterInit(target), 'develop');
  });

  test('acceptance 1: a local branch origin/master beside the remote default still gives master [R1]', () => {
    const target = cloneOf('master');
    git(target, 'branch', 'origin/master');
    assert.equal(baseAfterInit(target), 'master');
  });

  test('acceptance 1: an origin/HEAD that points outside origin falls to the current branch [R1]', () => {
    const target = cloneOf('master');
    git(target, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/upstream/main');
    assert.equal(baseAfterInit(target), 'work');
  });

  test('acceptance 1: a detached HEAD with no remote gets the template value [R1]', () => {
    const target = repository('develop');
    git(target, 'checkout', '-q', '--detach');
    assert.equal(baseAfterInit(target), 'main');
  });

  test('acceptance 1: a directory that is no repository gets the template value [R1]', () => {
    assert.equal(baseAfterInit(tempDir()), 'main');
  });

  test('acceptance 1: an existing aidlc.config.json keeps its bytes [R1]', () => {
    const target = repository('develop');
    const held = '{ "base":  "trunk" }\r\n';
    writeFileSync(path.join(target, 'aidlc.config.json'), held);
    initProject({ target });
    assert.equal(readFileSync(path.join(target, 'aidlc.config.json'), 'utf8'), held);
  });
});

describe('T1-INIT-BASE-CI: a target with no package.json', () => {
  const OPTIONS: Array<{ name: string; options: Partial<InitOptions> }> = [
    { name: 'no option', options: {} },
    { name: 'force', options: { force: true } },
    { name: 'dryRun', options: { dryRun: true } },
    { name: 'force and dryRun', options: { force: true, dryRun: true } },
  ];

  for (const { name, options } of OPTIONS) {
    test(`acceptance 2: with ${name} neither workflow is written and the report carries both reasons [R2]`, () => {
      const target = holdingOneFile();
      const report = initProject({ target, ...options });
      assert.equal(existsSync(path.join(target, CI)), false);
      assert.equal(existsSync(path.join(target, EVALS)), false);
      assert.ok(report.skipped.includes(SKIP_CI), SKIP_CI);
      assert.ok(report.skipped.includes(SKIP_EVALS), SKIP_EVALS);
      assert.ok(!report.created.includes(CI) && !report.created.includes(EVALS), 'neither is reported as created');
      assert.ok(report.created.includes(SCANNERS), SCANNERS);
      assert.equal(existsSync(path.join(target, SCANNERS)), !options.dryRun);
    });
  }

  test('acceptance 2: dryRun writes nothing [R2]', () => {
    const target = holdingOneFile();
    initProject({ target, dryRun: true });
    assert.deepEqual(readdirSync(target), ['build.gradle']);
  });

  test('acceptance 2: force leaves an existing copy of a skipped workflow as it stands [R2]', () => {
    const target = holdingOneFile();
    mkdirSync(path.join(target, '.github', 'workflows'), { recursive: true });
    writeFileSync(path.join(target, CI), 'held\n');
    const report = initProject({ target, force: true });
    assert.equal(readFileSync(path.join(target, CI), 'utf8'), 'held\n');
    assert.ok(report.skipped.includes(SKIP_CI), SKIP_CI);
    assert.ok(!report.skipped.includes(CI), 'one line per workflow');
  });

  test('acceptance 2: the CLI prints each skip on its own line, and writes nothing on --dry-run [R2]', () => {
    const target = holdingOneFile();
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'aidlc.js'), 'init', target, '--dry-run'], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split(/\r?\n/);
    assert.ok(lines.includes(`  = ${SKIP_CI}`), r.stdout);
    assert.ok(lines.includes(`  = ${SKIP_EVALS}`), r.stdout);
    assert.deepEqual(readdirSync(target), ['build.gradle']);
  });
});

describe('T1-INIT-BASE-CI: a target that keeps both workflows', () => {
  function assertBothWritten(target: string, reportOf: () => { created: string[]; skipped: string[] } = () => initProject({ target })): void {
    const report = reportOf();
    for (const rel of [CI, EVALS]) {
      assert.ok(existsSync(path.join(target, rel)), `${rel} not written`);
      assert.ok(report.created.includes(rel), `${rel} not reported`);
    }
    assert.ok(!report.skipped.includes(SKIP_CI) && !report.skipped.includes(SKIP_EVALS), 'no skip');
  }

  test('acceptance 3: an empty directory gets both workflows [R2]', () => {
    assertBothWritten(tempDir());
  });

  test('acceptance 3: a target that does not exist yet counts as empty [R2]', () => {
    assertBothWritten(path.join(tempDir(), 'new'));
  });

  test('acceptance 3: a directory holding a package.json gets both workflows [R2]', () => {
    const target = holdingOneFile();
    writeFileSync(path.join(target, 'package.json'), '{}');
    assertBothWritten(target);
  });

  test('acceptance 3: a package.json that is a directory exists, so both workflows are written [R2]', () => {
    const target = holdingOneFile();
    mkdirSync(path.join(target, 'package.json'));
    assertBothWritten(target);
  });

  test('acceptance 3: .git alone counts as empty [R2]', () => {
    const target = tempDir();
    git(target, 'init', '-q', '-b', 'develop');
    assert.deepEqual(readdirSync(target), ['.git']);
    assertBothWritten(target);
  });

  test('acceptance 3: dryRun over an empty directory reports both as created [R2]', () => {
    const target = tempDir();
    const report = initProject({ target, dryRun: true });
    assert.ok(report.created.includes(CI) && report.created.includes(EVALS), 'both are reported');
    assert.deepEqual(readdirSync(target), []);
  });
});

test('T1-INIT-BASE-CI acceptance 4: every workflow calls npx --no-install aidlc, and none holds the bare form [R3]', () => {
  const calls: Record<string, number> = {
    '.github/workflows/agent-evals.yml': 1,
    '.github/workflows/aidlc-ci.yml': 2,
    '.github/workflows/docs-check.yml': 1,
    'templates/github/workflows/agent-evals.yml': 1,
    'templates/github/workflows/aidlc-ci.yml': 2,
  };
  for (const [rel, count] of Object.entries(calls)) {
    assert.equal(readFileSync(path.join(root, rel), 'utf8').split('npx --no-install aidlc').length - 1, count, rel);
  }
  for (const dir of ['.github/workflows', 'templates/github/workflows']) {
    for (const file of readdirSync(path.join(root, dir))) {
      assert.ok(!readFileSync(path.join(root, dir, file), 'utf8').includes('npx aidlc'), `${dir}/${file} holds the bare form`);
    }
  }
});

test('T1-INIT-BASE-CI acceptance 6: OPERATIONS and the CHANGELOG hold the exact texts [R5] [R6]', () => {
  const paragraph = "A config that `aidlc init` creates names the target's default branch (card T1-INIT-BASE-CI): the remote default, else the current branch, else `main`. On a repository with no `package.json`, `init` writes no `aidlc-ci.yml` and no `agent-evals.yml`, since both need one, and reports each as skipped. Every workflow calls `npx --no-install aidlc`, because a bare `npx aidlc` with no local package fetches the unrelated npm package of that name.";
  const lines = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').split(/\r?\n/);
  const agents = lines.findIndex((l) => l.startsWith('Agent files name a model and an effort'));
  assert.ok(agents >= 0 && lines.indexOf(paragraph) === agents + 2, `docs/OPERATIONS.md states, after the Agent files paragraph: ${paragraph}`);

  const entry = "- T1-INIT-BASE-CI (bugfix): a config that `aidlc init` creates names the target's default branch, and a repository with no `package.json` gets no `aidlc-ci.yml` and no `agent-evals.yml`, each reported as skipped. Every workflow calls `npx --no-install aidlc`, so a repository with no local package cannot fetch the unrelated npm package of that name.";
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.ok(unreleased.split(/\r?\n/).includes(entry), `CHANGELOG Unreleased states: ${entry}`);
});
