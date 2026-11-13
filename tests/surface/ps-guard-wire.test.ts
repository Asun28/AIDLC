import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOOK_CONFIG, isBlock, runHook, type HookEvent, type HookResult } from '../../src/hooks/index.ts';
import { dispatchHook, hookNamesFor } from '../../src/hooks/entry.ts';
import { initProject } from '../../src/scaffold/init.ts';
import { tmpDir } from '../infra/helpers.ts';
import { changelogSince010 } from '../infra/changelog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NEW_MATCHER = 'Bash|PowerShell|Edit|Write|MultiEdit';
const OLD_MATCHER = 'Bash|Edit|Write|MultiEdit';
const TEMPLATE_COMMAND = 'npx --no-install aidlc hook auto';
const DISPATCHERS = [TEMPLATE_COMMAND, 'node node_modules/aidlc/bin/aidlc-hook.js', 'node bin/aidlc-hook.js'];
const FOREIGN = { type: 'command', command: 'my-existing-gate' };

type Entry = { matcher?: string; hooks: Array<{ type: string; command: string }> };

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = tmpDir('aidlc-ps-guard-');
  dirs.push(dir);
  return dir;
}

function envWithState(): { cwd: string; env: NodeJS.ProcessEnv } {
  const cwd = tempDir();
  return { cwd, env: { PATH: process.env['PATH'], AIDLC_STATE_DIR: path.join(cwd, 'state') } };
}

function powerShell(command: string): HookEvent {
  return { hook_event_name: 'PreToolUse', tool_name: 'PowerShell', tool_input: { command } };
}

function denial(r: HookResult): { decision?: string; reason?: string } {
  const parsed = JSON.parse(r.stdout ?? '{}') as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
  return { decision: parsed.hookSpecificOutput?.permissionDecision, reason: parsed.hookSpecificOutput?.permissionDecisionReason };
}

/** A target whose `.claude/settings.json` holds exactly these `PreToolUse` entries. */
function targetWith(entries: Entry[]): { target: string; settings: string } {
  const target = tempDir();
  mkdirSync(path.join(target, '.claude'));
  const settings = path.join(target, '.claude', 'settings.json');
  writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: entries } }));
  return { target, settings };
}

function preToolUse(settings: string): Entry[] {
  return (JSON.parse(readFileSync(settings, 'utf8')) as { hooks: Record<string, Entry[]> }).hooks['PreToolUse']!;
}

function dispatcherEntry(...extra: Array<{ type: string; command: string }>): Entry {
  return { matcher: OLD_MATCHER, hooks: [{ type: 'command', command: TEMPLATE_COMMAND }, ...extra] };
}

describe('T1-PS-GUARD-WIRE: wiring', () => {
  test('acceptance 1: both settings files hold one PreToolUse entry, with the matcher that names PowerShell [R1]', () => {
    for (const rel of ['.claude/settings.json', 'templates/claude/settings.json']) {
      const entries = preToolUse(path.join(root, rel));
      assert.equal(entries.length, 1, rel);
      assert.equal(entries[0]!.matcher, NEW_MATCHER, rel);
    }
  });

  test('acceptance 2: a PowerShell event selects the guard list of a Bash event [R2]', () => {
    const list = hookNamesFor({ hook_event_name: 'PreToolUse', tool_name: 'PowerShell' });
    assert.deepEqual(list, ['production-gate', 'protect-paths', 'secrets-guard']);
    assert.deepEqual(list, hookNamesFor({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }));
  });

  test('acceptance 3: a PowerShell command matching a production pattern, with no approval, is blocked by the production gate [R2]', () => {
    const { cwd, env } = envWithState();
    const command = 'kubectl apply -f prod/';
    assert.ok(DEFAULT_HOOK_CONFIG.productionPatterns.some((p) => new RegExp(p, 'i').test(command)), 'the command matches a default pattern');
    const r = dispatchHook(powerShell(command), { cwd, env });
    assert.equal(r.exitCode, 2);
    assert.ok(r.stderr?.includes('release authorization'), r.stderr);
  });

  test('acceptance 3: a PowerShell command holding a fake AWS key id is blocked by the secrets guard [R2]', () => {
    const { cwd, env } = envWithState();
    const awsLike = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    const r = dispatchHook(powerShell(`$env:AWS_ACCESS_KEY_ID = "${awsLike}"`), { cwd, env });
    assert.ok(isBlock(r), JSON.stringify(r));
    assert.ok(JSON.stringify(r).includes('AWS access key id'), JSON.stringify(r));
  });
});

describe('T1-PS-GUARD-WIRE: aidlc init moves an old-matcher entry', () => {
  for (const command of DISPATCHERS) {
    test(`acceptance 4: an old-matcher entry holding only ${command} leaves one new-matcher entry [R3]`, () => {
      const { target, settings } = targetWith([{ matcher: OLD_MATCHER, hooks: [{ type: 'command', command }] }]);
      initProject({ target });
      assert.deepEqual(preToolUse(settings), [{ matcher: NEW_MATCHER, hooks: [{ type: 'command', command: TEMPLATE_COMMAND }] }]);
    });
  }

  test('acceptance 5: a foreign hook stays on the old matcher, the dispatcher runs once under the new one, and a second init changes nothing [R3]', () => {
    const { target, settings } = targetWith([dispatcherEntry(FOREIGN)]);
    initProject({ target });
    const expected = [
      { matcher: OLD_MATCHER, hooks: [FOREIGN] },
      { matcher: NEW_MATCHER, hooks: [{ type: 'command', command: TEMPLATE_COMMAND }] },
    ];
    assert.deepEqual(preToolUse(settings), expected);
    const first = readFileSync(settings, 'utf8');
    initProject({ target });
    assert.equal(readFileSync(settings, 'utf8'), first);
  });

  test('acceptance 5: every dispatcher spelling on one old-matcher entry comes off it [R3]', () => {
    const { target, settings } = targetWith([{ matcher: OLD_MATCHER, hooks: [...DISPATCHERS.map((command) => ({ type: 'command', command })), FOREIGN] }]);
    initProject({ target });
    assert.deepEqual(preToolUse(settings), [
      { matcher: OLD_MATCHER, hooks: [FOREIGN] },
      { matcher: NEW_MATCHER, hooks: [{ type: 'command', command: TEMPLATE_COMMAND }] },
    ]);
  });
});

test('T1-PS-GUARD-WIRE acceptance 6: under a config that cannot be used, a PowerShell command is denied in its own words and the doctor passes [R4]', () => {
  const { cwd, env } = envWithState();
  writeFileSync(path.join(cwd, 'aidlc.config.json'), '{ not json');
  const denied = denial(dispatchHook(powerShell('npm test'), { cwd, env }));
  assert.equal(denied.decision, 'deny');
  assert.ok(denied.reason?.startsWith('PowerShell is denied while '), denied.reason);
  const byPaths = denial(runHook('protect-paths', powerShell('npm test'), { cwd, env }));
  assert.ok(byPaths.reason?.startsWith('PowerShell is denied while '), byPaths.reason);
  assert.equal(isBlock(dispatchHook(powerShell('aidlc doctor'), { cwd, env })), false);
});

test('T1-PS-GUARD-WIRE acceptance 7: OPERATIONS and the CHANGELOG hold the exact texts [R5] [R6]', () => {
  const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
  for (const text of [
    '`templates/claude/settings.json` (merged by `init`) wires a single command for `PreToolUse` (matcher `Bash|PowerShell|Edit|Write|MultiEdit`), `Stop` and `UserPromptSubmit`',
    '| `production-gate` | PreToolUse Bash, PowerShell | ',
    '| `protect-paths` | PreToolUse Edit, Write, MultiEdit, Bash, PowerShell | ',
    '| `secrets-guard` | PreToolUse Edit, Write, MultiEdit, Bash, PowerShell | ',
  ]) {
    assert.ok(operations.includes(text), `docs/OPERATIONS.md states: ${text}`);
  }
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const unreleased = changelogSince010(changelog);
  const entry = '- T1-PS-GUARD-WIRE (bugfix, issue 117): a PowerShell tool call now runs the Bash guard set (`production-gate`, `protect-paths`, `secrets-guard`), through the `PreToolUse` matcher `Bash|PowerShell|Edit|Write|MultiEdit` in both settings files, and `aidlc init` takes the dispatcher off an old-matcher entry, so it runs once per tool call and a foreign hook keeps its matcher.';
  assert.ok(unreleased.includes(entry), `CHANGELOG Unreleased states: ${entry}`);
});
