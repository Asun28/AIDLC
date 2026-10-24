// Card T0-HOOK-LAZY-2: the hook guards load the router, the goal, lease and journal stores and the planning claims on
// first use, so a hook event that reads no state loads no yaml; the config check with zod is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as lazy from '../../src/hooks/lazy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const counterUrl = pathToFileURL(path.join(root, 'bench', 'counter.ts')).href;
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

/** The child environment, built at each call without any variable the loop reads or that changes what Node loads, in every letter case. */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    const upper = k.toUpperCase();
    if (upper.startsWith('AIDLC_') || ['CLAUDE_CODE_SESSION_ID', 'RELEASE_APPROVAL', 'NODE_OPTIONS', 'NODE_COMPILE_CACHE'].includes(upper)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

function withTemp<T>(fn: (dir: string) => T): T {
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'aidlc-hook-lazy-')));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('T0-HOOK-LAZY-2 acceptance 1: a PreToolUse Bash, a PreToolUse Edit and a Stop event each load exactly zod, with no output [R1] [R2]', () => {
  const events: Record<string, Record<string, unknown>> = {
    bash: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } },
    edit: { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src', 'config.ts'), old_string: 'a', new_string: 'b' } },
    stop: { hook_event_name: 'Stop' },
  };
  withTemp((dir) => {
    for (const [name, event] of Object.entries(events)) {
      const state = path.join(dir, name);
      mkdirSync(state);
      const out = path.join(dir, `${name}.json`);
      const r = spawnSync(process.execPath, ['--import', counterUrl, path.join(root, 'bin', 'aidlc-hook.js')], {
        cwd: root,
        input: JSON.stringify({ ...event, cwd: root, session_id: 'hook-lazy' }),
        env: childEnv({ AIDLC_STATE_DIR: state, AIDLC_SESSION: 'hook-lazy', AIDLC_BENCH_OUT: out }),
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], name);
      const counts = JSON.parse(readFileSync(out, 'utf8')) as { deps: Record<string, number> };
      assert.deepEqual(Object.keys(counts.deps), ['zod'], `${name}: the dependencies loaded`);
    }
  });
});

/** The value imports of a module's source text (an `import type` or `export type` is erased and loads nothing). */
function valueImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specs: string[] = [];
  for (const m of text.matchAll(/^(?:import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?'([^']+)'/gm)) if (!m[1]) specs.push(m[2] as string);
  return specs;
}

/** The packages the value imports of `starts` reach, following each relative import through its source text. */
function packagesReached(starts: string[]): string[] {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of valueImports(file)) {
      if (spec.startsWith('.')) visit(path.resolve(path.dirname(file), spec));
      else if (!spec.startsWith('node:')) packages.add(spec);
    }
  };
  for (const start of starts) visit(start);
  return [...packages].sort();
}

test('T0-HOOK-LAZY-2 acceptance 2: each lazy module is a source file loaded as the one instance import() gives, and the hook modules reach no package but zod statically [R1]', async () => {
  const loaders: Record<string, () => unknown> = {
    '../core/router': lazy.router,
    '../state/goal-store': lazy.goalStore,
    '../state/journal': lazy.journal,
    '../state/claims': lazy.claims,
    '../coordination/lease': lazy.lease,
  };
  assert.deepEqual(Object.keys(loaders).sort(), [...lazy.LAZY_MODULES].sort());
  for (const [rel, load] of Object.entries(loaders)) {
    const file = path.join(root, 'src', 'hooks', `${rel}.ts`);
    assert.ok(existsSync(file), file);
    assert.equal(load(), await import(pathToFileURL(file).href), rel);
  }
  const hooks = ['index.ts', 'entry.ts'].map((f) => path.join(root, 'src', 'hooks', f));
  const lazyFiles = lazy.LAZY_MODULES.map((rel) => path.join(root, 'src', 'hooks', `${rel}.ts`));
  for (const file of hooks) {
    const statics = valueImports(file).filter((spec) => spec.startsWith('.')).map((spec) => path.resolve(path.dirname(file), spec));
    assert.deepEqual(statics.filter((s) => lazyFiles.includes(s)), [], `${path.basename(file)} imports a lazy module statically`);
  }
  assert.deepEqual(packagesReached(hooks), ['zod']);
});

test('T0-HOOK-LAZY-2 acceptance 4: bench/baseline.json holds the hook journeys at zod\'s 853346 dependency bytes at most [R3]', () => {
  const baseline = JSON.parse(read('bench/baseline.json')) as { journeys: Record<string, { ceilings: Record<string, number> }> };
  for (const id of ['hook.pre-bash', 'hook.pre-edit', 'hook.prompt', 'hook.stop']) {
    const depBytes = baseline.journeys[id]?.ceilings['depBytes'];
    assert.ok(depBytes !== undefined && depBytes <= 853346, `${id}: depBytes ${String(depBytes)}`);
  }
});

const HOOKS_PARAGRAPH = 'What a hook process loads (card T0-HOOK-LAZY-2): the guards load the router, the goal, lease and journal stores and the planning claims on first use (`src/hooks/lazy.ts`), so an event that reads no state loads none of them, and no yaml, which only the planning claims load. Every event still loads zod and checks `aidlc.config.json` with the schema the CLI uses, as before. Measured on Windows in two interleaved runs of 15: each hook event takes about 35 ms less (PreToolUse Bash 217 ms to 180 ms and 208 ms to 174 ms) and loads 109 to 113 modules instead of 189.';

const ARCHITECTURE_SENTENCE = '`src/hooks/lazy.ts` loads the modules only some hook events need (the router, the goal, lease and journal stores, and the planning claims, which alone load yaml) on a guard\'s first use, through `require` with the extension of its own file (card T0-HOOK-LAZY-2).';

const CHANGELOG_ENTRY = '- T0-HOOK-LAZY-2 (replaces T0-HOOK-LAZY, stopped when R3 decision 3 re-raised the provenance of its config stamp; ruling 2026-10-24): the hook guards load the router, the goal, lease and journal stores and the planning claims on first use (`src/hooks/lazy.ts`), so a hook event that reads no state loads no yaml; the config check with zod is unchanged. Measured on Windows: about 35 ms less per hook event (PreToolUse Bash 217 ms to 180 ms), and 109 to 113 modules loaded instead of 189.';

const SUPERSEDED = 'superseded_by: T0-HOOK-LAZY-2';

/** The sentences of a paragraph: a split after a full stop that a space and a capital letter or a backtick follow. */
const sentences = (paragraph: string): string[] => paragraph.split(/(?<=\.)\s+(?=[A-Z`])/);

/** Whether each doc text this card adds is present whole: the Hooks paragraph right after the first, and each single text. */
function docsHold(ops: string, architecture: string, changelog: string, predecessor: string): boolean {
  const at = ops.indexOf('\n## Hooks\n');
  const end = ops.indexOf('\n## Pre-review (R2)\n');
  if (!(at >= 0 && end > at)) return false;
  if (ops.slice(at + '\n## Hooks\n'.length, end).trim().split('\n\n')[1] !== HOOKS_PARAGRAPH) return false;
  if (!architecture.includes(ARCHITECTURE_SENTENCE)) return false;
  if (!predecessor.split('\n').includes(SUPERSEDED)) return false;
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  return unreleased.split('\n').includes(CHANGELOG_ENTRY);
}

test('T0-HOOK-LAZY-2 acceptance 5: the docs carry every sentence this card adds, and removing any one of them fails [R4]', () => {
  const [ops, architecture, changelog, predecessor] = [read('docs/OPERATIONS.md'), read('docs/ARCHITECTURE.md'), read('CHANGELOG.md'), read('specs/tasks/T0-HOOK-LAZY.md')];
  assert.ok(docsHold(ops, architecture, changelog, predecessor), 'the doc texts this card adds are present whole');
  const removals: [string, () => boolean][] = [
    ...sentences(HOOKS_PARAGRAPH).map((s): [string, () => boolean] => [s, () => docsHold(ops.replace(s, ''), architecture, changelog, predecessor)]),
    [ARCHITECTURE_SENTENCE, () => docsHold(ops, architecture.replace(ARCHITECTURE_SENTENCE, ''), changelog, predecessor)],
    ...sentences(CHANGELOG_ENTRY).map((s): [string, () => boolean] => [s, () => docsHold(ops, architecture, changelog.replace(s, ''), predecessor)]),
    [SUPERSEDED, () => docsHold(ops, architecture, changelog, predecessor.replace(SUPERSEDED, ''))],
  ];
  assert.equal(removals.length, REMOVALS);
  for (const [sentence, holds] of removals) assert.equal(holds(), false, `removing this text still passes: ${sentence}`);
});

// 3 Hooks paragraph sentences, the ARCHITECTURE sentence, 2 CHANGELOG sentences and the superseded_by line.
const REMOVALS = 7;
