// Card T1-CI-SHARD: the Windows suite of the ci workflow in four test shards behind the required check name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { tmpDir } from '../infra/helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

type Step = { uses?: string; run?: string; name?: string; shell?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { name?: string; needs?: string; if?: string; 'runs-on'?: string; strategy?: { 'fail-fast'?: boolean; matrix?: Record<string, unknown> }; steps?: Step[]; [key: string]: unknown };
type Workflow = { on?: unknown; permissions?: unknown; concurrency?: unknown; jobs: Record<string, Job> };

const ci = (): Workflow => YAML.parse(read('.github/workflows/ci.yml')) as Workflow;
const runsOf = (job: Job | undefined): string[] => (job?.steps ?? []).filter((s) => s.run !== undefined).map((s) => s.run!);
const TEST_SCRIPT = 'node --test --test-reporter=spec "tests/**/*.test.ts"';
const DOCTOR = 'node bin/aidlc.js doctor --json || true';

/** The `test` script of package.json with the shard option inserted before the quoted pattern. */
function shardCommand(): string {
  const script = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts['test'];
  assert.equal(script, TEST_SCRIPT);
  return script.replace(' "tests/', ' --test-shard=${{ matrix.shard }}/4 "tests/');
}

test('T1-CI-SHARD acceptance 1 - the Windows suite runs in four shard jobs that run the test script of package.json with the shard option before the pattern', () => {
  const { jobs } = ci();
  const shard = jobs['check-windows-shard'];
  assert.ok(shard, 'ci.yml has a check-windows-shard job');
  assert.equal(shard['runs-on'], 'windows-latest');
  assert.equal(shard.strategy?.['fail-fast'], false);
  assert.deepEqual(shard.strategy?.matrix, { shard: [1, 2, 3, 4] });
  for (const key of ['if', 'permissions', 'continue-on-error']) assert.ok(!(key in shard), `no ${key} on the shard job`);
  const check = jobs['check']!.steps!;
  const steps = shard.steps ?? [];
  assert.deepEqual(steps[0], check[0]);
  assert.deepEqual(steps[1], { ...check[1], with: { ...check[1]!.with, 'node-version': 22 } });
  assert.deepEqual(steps.at(-1), check.at(-1), 'the doctor step of check');
  assert.deepEqual(runsOf(shard), ['npm ci', 'npm run typecheck', shardCommand(), 'npm run build', DOCTOR]);
});

test('T1-CI-SHARD acceptance 2 - the job named check (windows-latest, 22) needs the shards, always runs and fails unless they succeeded, and check runs on ubuntu-latest only', () => {
  const { jobs } = ci();
  const agg = jobs['check-windows'];
  assert.ok(agg, 'ci.yml has a check-windows job');
  assert.equal(agg.name, 'check (windows-latest, 22)');
  assert.equal(agg.needs, 'check-windows-shard');
  assert.equal(agg.if, 'always()');
  assert.equal(agg['runs-on'], 'ubuntu-latest');
  assert.ok(!('strategy' in agg), 'no strategy on the aggregate');
  assert.deepEqual(agg.steps, [{ env: { RESULT: '${{ needs.check-windows-shard.result }}' }, run: 'test "$RESULT" = success' }]);
  assert.deepEqual(Object.keys(jobs).filter((id) => jobs[id]!.name === 'check (windows-latest, 22)'), ['check-windows']);
  assert.deepEqual(jobs['check']!.strategy?.matrix, { os: ['ubuntu-latest'], node: [22] });
  assert.deepEqual(runsOf(jobs['check']), ['npm ci', 'npm run typecheck', 'npm test', 'npm run build', DOCTOR]);
});

test('T1-CI-SHARD acceptance 3 - one concurrency group per pull request cancels only pull-request runs, and the triggers and permissions are unchanged', () => {
  const wf = ci();
  assert.deepEqual(wf.concurrency, {
    group: '${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}',
    'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
  });
  assert.deepEqual(wf.on, {
    push: { branches: ['main', 'master'], 'paths-ignore': ['docs/**', 'intent/**', 'plans/**', 'specs/**', 'CHANGELOG.md', 'README.md'] },
    pull_request: null,
  });
  assert.deepEqual(wf.permissions, { contents: 'read' });
});

/** Splits a command line into words on spaces, removing double quotes. */
function words(line: string): string[] {
  return (line.match(/"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/"/g, ''));
}

test('T1-CI-SHARD acceptance 4 - the shard command of ci.yml, run for shards 1 to 4 over a fixture, runs each test file in exactly one shard', () => {
  const command = runsOf(ci().jobs['check-windows-shard']).find((r) => r.includes('--test-shard='));
  assert.ok(command, 'ci.yml has a shard command');
  const dir = tmpDir('aidlc-ci-shard-');
  writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const files = ['tests/root.test.ts', ...['a', 'b', 'c'].flatMap((d) => [1, 2, 3].map((n) => `tests/${d}/f${n}.test.ts`))];
  for (const rel of files) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), `import { test } from 'node:test';\ntest('file ${rel}', () => {});\n`);
  }
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (k.toUpperCase() !== 'NODE_TEST_CONTEXT') env[k] = v;
  const named: string[] = [];
  for (let k = 1; k <= 4; k += 1) {
    const [node, ...args] = words(command.replace('${{ matrix.shard }}', String(k)));
    assert.equal(node, 'node');
    const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8' });
    assert.equal(r.status, 0, `shard ${k}: ${r.stdout}${r.stderr}`);
    const names = [...r.stdout.matchAll(/file (tests\/[\w/]+\.test\.ts)/g)].map((m) => m[1]!);
    assert.ok(names.length >= 1, `shard ${k} names a test: ${r.stdout}`);
    named.push(...names);
  }
  assert.deepEqual([...named].sort(), [...files].sort());
});
