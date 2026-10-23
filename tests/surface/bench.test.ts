// Card T0-LOOP-BENCH: the loop benchmark (bench/), deterministic counts of the hot paths against ceilings that only go down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { compare, GATED, median, ratchet, type Baseline, type Measured, type Metric } from '../../bench/ratchet.ts';
import { benchEnv, JOURNEYS, runJourney, timeJourney } from '../../bench/journeys.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const counterUrl = pathToFileURL(path.join(root, 'bench', 'counter.ts')).href;
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

/** The child environment, built at each call without any variable the loop or the bench reads, in every letter case. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    const upper = k.toUpperCase();
    if (upper.startsWith('AIDLC_') || ['CLAUDE_CODE_SESSION_ID', 'RELEASE_APPROVAL'].includes(upper)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

function withTemp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aidlc-bench-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs `code` as an ES module under the counter, in the repository root, and returns the counts it wrote. */
function countChild(dir: string, name: string, code: string): Record<string, unknown> {
  const out = path.join(dir, `${name}.json`);
  const r = spawnSync(process.execPath, ['--import', counterUrl, '--input-type=module', '-e', code], { cwd: root, env: childEnv({ AIDLC_BENCH_OUT: out }), encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
}

test('T0-LOOP-BENCH acceptance 1: the counter counts modules, dependency bytes, fs calls, bytes read and spawns, the same on every run [R1]', () => {
  withTemp((dir) => {
    const file = path.join(dir, 'data.txt');
    writeFileSync(file, 'x'.repeat(1000));
    const code = [
      "import { readFileSync } from 'node:fs';",
      "import { spawnSync } from 'node:child_process';",
      "await import('yaml');",
      `readFileSync(${JSON.stringify(file)});`,
      `readFileSync(${JSON.stringify(file)}, 'utf8');`,
      "spawnSync(process.execPath, ['-e', '0']);",
    ].join('\n');
    const first = countChild(dir, 'first', code);
    assert.ok((first['modules'] as number) >= 1, `modules ${String(first['modules'])}`);
    assert.ok((first['depBytes'] as number) > 0, `depBytes ${String(first['depBytes'])}`);
    assert.equal(first['fsCalls'], 2);
    assert.equal(first['fsBytesRead'], 2 * statSync(file).size);
    assert.equal(first['spawns'], 1);
    assert.equal(first['startFsCalls'], 0);
    assert.equal(first['entry'], 'none');
    assert.equal(first['ownBytes'], 0, 'the evaluated script is no file module');
    assert.deepEqual(first['deps'], { yaml: first['depBytes'] });
    assert.deepEqual(countChild(dir, 'second', code), first);
    const scoped = countChild(dir, 'scoped', "await import('@anthropic-ai/sdk');");
    assert.ok(Object.keys(scoped['deps'] as object).includes('@anthropic-ai/sdk'), JSON.stringify(scoped['deps']));
    const native = "import fs from 'node:fs';\nif (typeof fs.realpathSync.native !== 'function') process.exit(3);\nif (!fs.realpathSync.native('.')) process.exit(4);";
    assert.equal(countChild(dir, 'native', native)['fsCalls'], 1);
  });
});

const all = (n: number): Record<Metric, number> => Object.fromEntries(GATED.map((m) => [m, n])) as Record<Metric, number>;
const SLACK = all(0.1);
const NONE = all(0);
const measured = (id: string, counts: Record<Metric, number>, entry: Measured['entry'] = 'dist'): Measured => ({ id, entry, counts, ownBytes: 5, deps: { zod: 3, yaml: 2 } });
const baseline = (entry: Measured['entry'] = 'dist', allowance = NONE, ceiling = 100): Baseline => ({ slack: SLACK, allowance, journeys: { j: { entry, ceilings: all(ceiling) } } });
const statusOf = (reports: ReturnType<typeof compare>, metric: Metric): string | undefined => reports[0]?.metrics.find((r) => r.metric === metric)?.status;

test('T0-LOOP-BENCH acceptance 2: compare fails above ceiling plus slack and skips startFsCalls across entries; ratchet only lowers [R3]', () => {
  const at110 = compare([measured('j', all(110))], baseline());
  for (const m of GATED) assert.equal(statusOf(at110, m), 'pass', m);
  assert.equal(at110[0]?.ok, true);
  const at111 = compare([measured('j', { ...all(100), fsCalls: 111 })], baseline());
  assert.equal(statusOf(at111, 'fsCalls'), 'fail');
  assert.equal(statusOf(at111, 'modules'), 'pass');
  assert.equal(at111[0]?.ok, false);
  const small = baseline('dist', { ...NONE, fsCalls: 25 }, 7);
  assert.equal(statusOf(compare([measured('j', { ...all(7), fsCalls: 32 })], small), 'fsCalls'), 'pass');
  assert.equal(statusOf(compare([measured('j', { ...all(7), fsCalls: 33 })], small), 'fsCalls'), 'fail');
  assert.equal(statusOf(compare([measured('j', { ...all(7), modules: 8 })], small), 'modules'), 'fail', 'the allowance is per metric');
  const unknown = compare([measured('other', all(5))], baseline());
  for (const m of GATED) assert.equal(statusOf(unknown, m), 'new', m);
  assert.equal(unknown[0]?.ok, true, 'a journey with no ceiling is reported, not failed');
  const deps = compare([{ ...measured('j', all(1)), deps: { a: 1, b: 5, c: 3, d: 4, e: 3 }, wallMs: 12 }], baseline())[0];
  assert.deepEqual(deps?.topDeps, [['b', 5], ['d', 4], ['c', 3]]);
  assert.equal(deps?.wallMs, 12);
  assert.equal('wallMs' in (compare([measured('j', all(1))], baseline())[0] ?? {}), false);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 3);
  assert.equal(median([]), 0);
  const crossEntry = compare([measured('j', { ...all(100), startFsCalls: 500 }, 'src')], baseline());
  assert.equal(statusOf(crossEntry, 'startFsCalls'), 'skipped');
  assert.equal(crossEntry[0]?.ok, true);
  assert.equal(statusOf(compare([measured('j', { ...all(100), startFsCalls: 500 })], baseline()), 'startFsCalls'), 'fail');

  const lowered = ratchet([measured('j', { ...all(100), fsCalls: 90, spawns: 120 })], baseline());
  assert.equal(lowered.journeys['j']?.ceilings.fsCalls, 90);
  assert.equal(lowered.journeys['j']?.ceilings.spawns, 100);
  assert.deepEqual(lowered.slack, SLACK);
  assert.deepEqual(lowered.allowance, NONE);
  const added = ratchet([measured('k', all(7))], baseline());
  assert.deepEqual(added.journeys['k'], { entry: 'dist', ceilings: all(7) });
  assert.deepEqual(added.journeys['j'], baseline().journeys['j']);
  assert.throws(() => ratchet([measured('j', all(1), 'src')], baseline()), /src/);
  assert.throws(() => ratchet([measured('j', all(1), 'none')], baseline()), /none/);
});

test('T0-LOOP-BENCH acceptance 3: a journey gives the same counts on every run, in its own state directory, removed after it [R2]', () => {
  const byId = (id: string) => {
    const journey = JOURNEYS.find((j) => j.id === id);
    assert.ok(journey, `journey ${id}`);
    return journey;
  };
  assert.deepEqual(JOURNEYS.map((j) => j.id), ['hook.pre-bash', 'hook.pre-edit', 'hook.prompt', 'hook.stop', 'hook.stop.200-goals', 'cli.start']);
  withTemp((tmpRoot) => {
    const first = runJourney(byId('hook.pre-bash'), { root, tmpRoot });
    const second = runJourney(byId('hook.pre-bash'), { root, tmpRoot });
    assert.deepEqual(second.counts, first.counts);
    assert.equal(first.counts.spawns, 1);
    assert.equal(first.counts.outBytes, 0);
    assert.ok(first.counts.modules > 0 && first.counts.depBytes > 0, JSON.stringify(first.counts));
    assert.ok(first.entry === 'dist' || first.entry === 'src', first.entry);
    assert.ok(first.counts.startFsCalls >= 1, 'the freshness check stats dist/ before the entry loads');
    assert.ok(first.counts.fsCalls >= 1 && first.ownBytes > 0, JSON.stringify(first));
    assert.ok(Object.keys(first.deps).includes('zod'), JSON.stringify(first.deps));
    assert.ok(timeJourney(byId('hook.pre-bash'), { root, tmpRoot }) > 0);
    assert.throws(() => runJourney({ id: 'broken', script: 'bin/aidlc.js', args: ['no-such-command'] }, { root, tmpRoot }), /journey broken exited 1/);
    const stop = runJourney(byId('hook.stop'), { root, tmpRoot });
    const history = runJourney(byId('hook.stop.200-goals'), { root, tmpRoot });
    assert.ok(history.counts.fsBytesRead > stop.counts.fsBytesRead, `${history.counts.fsBytesRead} > ${stop.counts.fsBytesRead}`);
    assert.deepEqual(readdirSync(tmpRoot), []);
  });
});

test('T0-LOOP-BENCH acceptance 3: the child environment drops the loop, session and loader variables in any letter case [R2]', () => {
  const env = benchEnv(
    { PATH: 'p', AIDLC_STATE_DIR: 'live', aidlc_fix_task: 'x', Aidlc_Session: 's', Claude_Code_Session_Id: 'c', RELEASE_APPROVAL: 'yes', release_approval: 'yes', AIDLC_RELEASE_APPROVAL: 'yes', NODE_OPTIONS: '--require x', node_compile_cache: 'c' },
    { AIDLC_STATE_DIR: 'bench-state', AIDLC_SESSION: 'bench' },
  );
  assert.deepEqual(env, { PATH: 'p', AIDLC_STATE_DIR: 'bench-state', AIDLC_SESSION: 'bench' });
});

test('T0-LOOP-BENCH acceptance 4: bench/run.ts reports every journey against bench/baseline.json, and --check fails over a zero baseline [R4] [R5]', () => {
  const plain = spawnSync(process.execPath, ['bench/run.ts', '--json'], { cwd: root, env: childEnv(), encoding: 'utf8', windowsHide: true });
  assert.equal(plain.status, 0, plain.stderr);
  const report = JSON.parse(plain.stdout) as { ok: boolean; journeys: { id: string; entry: string; metrics: { metric: string; ceiling?: number; status: string }[] }[] };
  assert.deepEqual(report.journeys.map((j) => j.id), JOURNEYS.map((j) => j.id));
  for (const j of report.journeys) {
    assert.deepEqual(j.metrics.map((m) => m.metric), [...GATED], j.id);
    for (const m of j.metrics) assert.equal(typeof m.ceiling, 'number', `${j.id} ${m.metric} has no ceiling`);
  }
  withTemp((dir) => {
    const zero = path.join(dir, 'zero.json');
    const journeys = Object.fromEntries(JOURNEYS.map((j) => [j.id, { entry: 'dist', ceilings: all(0) }]));
    writeFileSync(zero, JSON.stringify({ slack: NONE, allowance: NONE, journeys }));
    const checked = spawnSync(process.execPath, ['bench/run.ts', '--check', '--json', '--baseline', zero], { cwd: root, env: childEnv(), encoding: 'utf8', windowsHide: true });
    assert.equal(checked.status, 1, checked.stderr);
    const failing = JSON.parse(checked.stdout) as { ok: boolean; journeys: { id: string; ok: boolean }[] };
    assert.equal(failing.ok, false);
    assert.deepEqual(failing.journeys.map((j) => [j.id, j.ok]), JOURNEYS.map((j) => [j.id, false]));
    assert.equal(readFileSync(zero, 'utf8'), JSON.stringify({ slack: NONE, allowance: NONE, journeys }), '--check never writes the baseline');

    // Without --check a failing report still exits 0; the text report marks each journey and its wall time.
    const timed = spawnSync(process.execPath, ['bench/run.ts', '--time', '1', '--baseline', zero], { cwd: root, env: childEnv(), encoding: 'utf8', windowsHide: true });
    assert.equal(timed.status, 0, timed.stderr);
    const lines = timed.stdout.split('\n').filter((l) => l.startsWith('FAIL '));
    assert.deepEqual(lines.map((l) => l.split(/\s+/)[1]), JOURNEYS.map((j) => j.id));
    for (const l of lines) assert.match(l, /\| \d+ ms/);
    assert.match(timed.stdout, /bench: above the ceiling plus slack: hook\.pre-bash modules \d+ > 0/);
    const badTime = spawnSync(process.execPath, ['bench/run.ts', '--time', 'x'], { cwd: root, env: childEnv(), encoding: 'utf8', windowsHide: true });
    assert.equal(badTime.status, 1);
    assert.match(badTime.stderr, /--time takes a whole number of runs/);

    // --ratchet lowers a high baseline to the counts when the compiled entry ran, and refuses a source run.
    const high = path.join(dir, 'high.json');
    const highText = JSON.stringify({ slack: NONE, allowance: NONE, journeys: Object.fromEntries(JOURNEYS.map((j) => [j.id, { entry: 'dist', ceilings: all(1e9) }])) });
    writeFileSync(high, highText);
    const ratcheted = spawnSync(process.execPath, ['bench/run.ts', '--ratchet', '--json', '--baseline', high], { cwd: root, env: childEnv(), encoding: 'utf8', windowsHide: true });
    const entries = new Set(report.journeys.map((j) => j.entry));
    if (entries.size === 1 && entries.has('dist')) {
      assert.equal(ratcheted.status, 0, ratcheted.stderr);
      const before = JSON.parse(ratcheted.stdout) as { lowerable: string[]; journeys: { id: string; metrics: { metric: Metric; count: number }[] }[] };
      assert.equal(before.lowerable.length, JOURNEYS.length * GATED.length);
      const written = JSON.parse(readFileSync(high, 'utf8')) as Baseline;
      for (const j of before.journeys) for (const m of j.metrics) assert.equal(written.journeys[j.id]?.ceilings[m.metric], m.count, `${j.id} ${m.metric}`);
    } else {
      assert.equal(ratcheted.status, 1);
      assert.match(ratcheted.stderr, /ratchet records the compiled entry only/);
      assert.equal(readFileSync(high, 'utf8'), highText);
    }
  });
});

test('T0-LOOP-BENCH acceptance 5: a bench CI job builds then checks; nothing under src/ imports bench/; npm run check runs no bench [R6]', () => {
  const ci = YAML.parse(read('.github/workflows/ci.yml')) as { jobs: Record<string, { 'runs-on': string; steps: { run?: string }[] }> };
  const bench = ci.jobs['bench'];
  assert.ok(bench, 'ci.yml has a bench job');
  assert.equal(bench['runs-on'], 'ubuntu-latest');
  const runs = bench.steps.map((s) => s.run ?? '');
  const build = runs.indexOf('npm run build');
  const check = runs.indexOf('npm run bench -- --check');
  assert.ok(runs.includes('npm ci'), runs.join(' | '));
  assert.ok(build >= 0 && check > build, runs.join(' | '));
  assert.ok(ci.jobs['check'], 'the check job stays');
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.ts')) sources.push(abs);
    }
  };
  walk(path.join(root, 'src'));
  const importers = sources.filter((f) => /from\s+['"][^'"]*\bbench\//.test(readFileSync(f, 'utf8')) || /import\(\s*['"][^'"]*\bbench\//.test(readFileSync(f, 'utf8')));
  assert.deepEqual(importers, []);
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
  assert.ok(!/bench/.test(scripts['check'] ?? ''), scripts['check']);
  assert.ok(!/bench/.test(scripts['test'] ?? '') && !/bench/.test(scripts['typecheck'] ?? ''));
  assert.equal(scripts['bench'], 'node bench/run.ts');
});

/** The text of the `## <heading>` section up to the next `## ` heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `## ${heading}`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

test('T0-LOOP-BENCH acceptance 6: the docs carry the loop benchmark sentences [R7]', () => {
  const ops = read('docs/OPERATIONS.md');
  const evals = ops.indexOf('\n## Evals\n');
  const benchAt = ops.indexOf('\n## Loop benchmark\n');
  const audit = ops.indexOf('\n## Audit\n');
  assert.ok(evals >= 0 && benchAt > evals && audit > benchAt, `Evals ${evals} < Loop benchmark ${benchAt} < Audit ${audit}`);
  const text = section(ops, 'Loop benchmark');
  for (const sentence of [
    "`npm run bench` measures the loop's hot paths with counts that are the same on every run of the same code.",
    'It runs six journeys once each under a counting preload (`bench/counter.ts`): `hook.pre-bash`, `hook.pre-edit`, `hook.prompt` and `hook.stop` send one event each to `bin/aidlc-hook.js`, `hook.stop.200-goals` sends the Stop event over a state directory holding 200 finished goals, and `cli.start` runs `aidlc goal list` over an empty state directory.',
    'The gated metrics are `modules` (modules loaded), `depBytes` (source bytes loaded from node_modules), `startFsCalls` (fs calls of the bin freshness check, before the entry module loads), `fsCalls` and `fsBytesRead` (fs calls and bytes read after it), `spawns` (child processes started) and `outBytes` (the output, which a hook adds to the model\'s context on every event).',
    'Wall time is reported and never gated: `npm run bench -- --time 5` prints the median of five runs beside the counts, and identical runs on one machine differ by tens of milliseconds, so a gate on wall time would fail at random.',
    'A metric stays gated only while lowering it lowers the median wall time; a metric that stops tracking wall time is removed from `GATED` in `bench/ratchet.ts`.',
    'Ceilings only go down.',
    'A change that needs a higher ceiling edits `bench/baseline.json` by hand and gives the reason in its PR body.',
    'A card that changes a hook, the CLI start or a dependency runs `npm run bench -- --check` before its first review, since a CI failure after review costs a review decision.',
    "by more than the larger of the metric's slack and its allowance (2 to 10 percent, or 10 modules, 25 fs calls or 32 KB read; none for `spawns` and `outBytes`), so a count fails only on a cost that moves wall time",
    'The `bench` job in `.github/workflows/ci.yml` runs `npm run bench -- --check` after `npm run build` on every pull request and every push to main that runs the `ci` workflow, beside the `check` job; no hook and no `npm run check` compares counts with the ceilings.',
    'Run `npm run bench -- --time 5` by hand before and after a Node or dependency upgrade and compare the two reports.',
  ]) {
    assert.ok(text.includes(sentence), `OPERATIONS Loop benchmark: ${sentence}`);
  }
  assert.ok(read('docs/ARCHITECTURE.md').includes('`bench/` (outside `src/` and never shipped) holds the loop benchmark: `npm run bench` counts the modules, fs calls, child processes and output of each hook event and the CLI start, and compares them with the ceilings in `bench/baseline.json` (docs/OPERATIONS.md, Loop benchmark).'));
  const commands = read('CLAUDE.md').split('```bash\n')[1]?.split('```')[0] ?? '';
  assert.ok(commands.includes('\nnpm run bench                  # loop benchmark: deterministic counts of each hook event against bench/baseline.json (--check, --ratchet, --time 5)\n'), commands);
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.ok(unreleased.includes('\n- T0-LOOP-BENCH: `npm run bench` runs six journeys of the loop'), 'CHANGELOG Unreleased entry');
});
