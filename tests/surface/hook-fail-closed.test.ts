// Card T0-HOOK-FAIL-CLOSED: a guard that throws on a PreToolUse event blocks the tool call (exit 2); on any other event the
// throw reaches the hook entry as before.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchHook } from '../../src/hooks/entry.ts';
import { runHook, type HookEvent } from '../../src/hooks/index.ts';
import { tmpDir } from '../infra/helpers.ts';
import { rmSync } from 'node:fs';

/** A `tool_input` whose `key` getter throws `message`, so the first guard that reads it throws. */
function throwingInput(key: 'command' | 'file_path', message: string): Record<string, unknown> {
  return Object.defineProperty({}, key, {
    enumerable: true,
    get() {
      throw new Error(message);
    },
  });
}

const line = (guard: string, message: string) => `[aidlc hook] ${guard} could not decide; the tool call is blocked: ${message}`;

function withDir<T>(fn: (dir: string) => T): T {
  const dir = tmpDir('aidlc-hook-fail-closed-');
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('T0-HOOK-FAIL-CLOSED acceptance 3: a guard that throws', () => {
  test('on a PreToolUse event blocks with exit 2 and one stderr line naming the guard, through runHook and dispatchHook [R1]', () => {
    withDir((cwd) => {
      const env = {};
      const bash = (message: string): HookEvent => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: throwingInput('command', message), cwd });
      const edit: HookEvent = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: throwingInput('file_path', 'no path'), cwd };
      assert.deepEqual(runHook('production-gate', bash('no command'), { cwd, env }), { exitCode: 2, stderr: line('production-gate', 'no command') });
      assert.deepEqual(runHook('protect-paths', edit, { cwd, env }), { exitCode: 2, stderr: line('protect-paths', 'no path') });
      assert.deepEqual(runHook('production-gate', bash('a\nb'), { cwd, env }), { exitCode: 2, stderr: line('production-gate', 'a | b') });
      assert.deepEqual(dispatchHook(bash('no command'), { cwd, env }), { exitCode: 2, stderr: line('production-gate', 'no command') });
    });
  });

  test('on a UserPromptSubmit event or an event with no name throws its error, as before [R2]', () => {
    withDir((cwd) => {
      const env = {};
      for (const name of ['UserPromptSubmit', undefined]) {
        const event: HookEvent = { tool_name: 'Bash', tool_input: throwingInput('command', 'no command'), cwd, ...(name ? { hook_event_name: name } : {}) };
        assert.throws(() => runHook('production-gate', event, { cwd, env }), { message: 'no command' }, String(name));
      }
    });
  });
});
