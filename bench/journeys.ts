// The loop's hot paths as bench journeys (card T0-LOOP-BENCH): every hook event, the Stop hook over a long history,
// and the CLI start. Each run gets its own state directory and an environment without the loop's variables, so the
// live .aidlc/ and the developer's session never change a count.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeGoalDeadlines } from '../src/core/deadlines.ts';
import { stagesForTarget } from '../src/core/goal-machine.ts';
import { Goal } from '../src/core/types.ts';
import { GoalStore } from '../src/state/goal-store.ts';
import { statePathsFromRoot } from '../src/state/paths.ts';
import type { Entry, Measured } from './ratchet.ts';

export interface Journey {
  id: string;
  script: 'bin/aidlc-hook.js' | 'bin/aidlc.js';
  args: string[];
  /** The hook event sent on stdin, built for the repository root the run uses. */
  event?: (root: string) => Record<string, unknown>;
  /** Finished goals written into the run's state directory before it starts. */
  goals?: number;
}

export const JOURNEYS: Journey[] = [
  { id: 'hook.pre-bash', script: 'bin/aidlc-hook.js', args: [], event: () => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } }) },
  {
    id: 'hook.pre-edit',
    script: 'bin/aidlc-hook.js',
    args: [],
    event: (root) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src', 'config.ts'), old_string: 'a', new_string: 'b' } }),
  },
  { id: 'hook.prompt', script: 'bin/aidlc-hook.js', args: [], event: () => ({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the failing router test' }) },
  { id: 'hook.stop', script: 'bin/aidlc-hook.js', args: [], event: () => ({ hook_event_name: 'Stop' }) },
  { id: 'hook.stop.200-goals', script: 'bin/aidlc-hook.js', args: [], event: () => ({ hook_event_name: 'Stop' }), goals: 200 },
  { id: 'cli.start', script: 'bin/aidlc.js', args: ['goal', 'list'] },
];

export interface RunOptions {
  /** The checkout whose bin/ and src/ run. */
  root: string;
  /** Where the per-run directories go: the OS temp directory unless a test injects one. */
  tmpRoot?: string;
}

const COUNTER = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'counter.ts')).href;
const FIXTURE_AT = '2026-01-01T00:00:00.000Z';

/**
 * The child environment, built at each call: nothing the loop reads (every `AIDLC_*`, the session and approval
 * variables) and nothing that changes what Node loads (`NODE_OPTIONS`, `NODE_COMPILE_CACHE`), in any letter case,
 * since Windows looks variables up case-insensitively; then the bench's own variables.
 */
export function benchEnv(base: NodeJS.ProcessEnv, own: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    const upper = key.toUpperCase();
    if (upper.startsWith('AIDLC_') || ['CLAUDE_CODE_SESSION_ID', 'RELEASE_APPROVAL', 'NODE_OPTIONS', 'NODE_COMPILE_CACHE'].includes(upper)) continue;
    env[key] = value;
  }
  return { ...env, ...own };
}

/** Writes `count` finished goals into the state directory at `stateRoot`, as the loop leaves them. */
export function seedGoals(stateRoot: string, count: number): void {
  const store = new GoalStore(statePathsFromRoot(stateRoot));
  for (let i = 0; i < count; i++) {
    store.saveGoal(
      Goal.parse({
        schemaVersion: 1,
        id: `g-bench-${String(i).padStart(4, '0')}`,
        generation: 0,
        revision: 0,
        revisions: [{ revision: 0, at: FIXTURE_AT, reason: 'intake', request: { text: 'bench fixture goal', source: 'natural-language' } }],
        repository: 'bench',
        routing: {
          size: 'T0',
          sizeSource: 'inferred',
          kind: 'change',
          target: 'development',
          targetSource: 'default',
          cardCount: 1,
          modules: ['router', 'card-loop'],
          nextModule: 'card-loop',
          skills: ['tdd'],
          dataImpact: false,
          reasons: [],
        },
        target: 'development',
        stages: stagesForTarget('development'),
        state: 'DONE',
        terminal: true,
        deadlines: computeGoalDeadlines(FIXTURE_AT, { cardCount: 1 }),
        createdAt: FIXTURE_AT,
        updatedAt: FIXTURE_AT,
      }),
    );
  }
}

interface Spawned {
  stdout: string;
  stderr: string;
  wallMs: number;
  counts?: Record<string, unknown>;
}

function spawnJourney(journey: Journey, options: RunOptions, counted: boolean): Spawned {
  const dir = mkdtempSync(path.join(options.tmpRoot ?? os.tmpdir(), 'aidlc-bench-'));
  try {
    const state = path.join(dir, 'state');
    if (journey.goals) seedGoals(state, journey.goals);
    const out = path.join(dir, 'counts.json');
    const argv = [...(counted ? ['--import', COUNTER] : []), path.join(options.root, journey.script), ...journey.args];
    const input = journey.event ? JSON.stringify({ ...journey.event(options.root), cwd: options.root, session_id: 'bench' }) : '';
    const env = benchEnv(process.env, { AIDLC_STATE_DIR: state, AIDLC_SESSION: 'bench', ...(counted ? { AIDLC_BENCH_OUT: out } : {}) });
    const started = performance.now();
    const r = spawnSync(process.execPath, argv, { cwd: options.root, input, env, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
    const wallMs = performance.now() - started;
    if (r.error) throw r.error;
    // A journey is an allowed path: a crash or a block would do less work and pass the gate, so it fails the run.
    if (r.status !== 0) throw new Error(`journey ${journey.id} exited ${String(r.status)}: ${r.stderr.trim().slice(0, 400)}`);
    return { stdout: r.stdout, stderr: r.stderr, wallMs, ...(counted ? { counts: JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown> } : {}) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One counted run of a journey: the counter's counts and the bytes the process wrote. */
export function runJourney(journey: Journey, options: RunOptions): Measured {
  const run = spawnJourney(journey, options, true);
  const c = run.counts ?? {};
  const num = (key: string): number => {
    const value = c[key];
    if (typeof value !== 'number') throw new Error(`journey ${journey.id}: the counter wrote no ${key}`);
    return value;
  };
  return {
    id: journey.id,
    entry: c['entry'] as Entry,
    counts: {
      modules: num('modules'),
      depBytes: num('depBytes'),
      startFsCalls: num('startFsCalls'),
      fsCalls: num('fsCalls'),
      fsBytesRead: num('fsBytesRead'),
      spawns: num('spawns'),
      outBytes: Buffer.byteLength(run.stdout) + Buffer.byteLength(run.stderr),
    },
    ownBytes: num('ownBytes'),
    deps: (c['deps'] ?? {}) as Record<string, number>,
  };
}

/** The wall time of one run without the counter, in milliseconds: reported, never compared. */
export function timeJourney(journey: Journey, options: RunOptions): number {
  return spawnJourney(journey, options, false).wallMs;
}
