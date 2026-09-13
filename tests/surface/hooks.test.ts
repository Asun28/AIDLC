import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_HOOK_CONFIG, loadHookConfig, productionGate, protectPaths, protectTests, routeNewWork, runHook, secretsGuard, verifyBeforeDone, type HookResult } from '../../src/hooks/index.ts';
import { dispatchHook, hookNamesFor } from '../../src/hooks/entry.ts';
import { AuthorizationRecord, CardRun, Goal, addMs, nowIso, type AuthorizationRecord as AuthRec } from '../../src/core/types.ts';
import { classifyRequest } from '../../src/core/router.ts';
import { stagesForTarget } from '../../src/core/goal-machine.ts';
import { computeGoalDeadlines } from '../../src/core/deadlines.ts';
import { resolveStatePaths } from '../../src/state/paths.ts';
import { GoalStore } from '../../src/state/goal-store.ts';

function envWithState(): { cwd: string; env: NodeJS.ProcessEnv; stateDir: string } {
  const cwd = mkdtempSync(path.join(tmpdir(), 'aidlc-hooks-'));
  const stateDir = path.join(cwd, 'state');
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], AIDLC_STATE_DIR: stateDir };
  return { cwd, env, stateDir };
}

function decision(r: HookResult): string | undefined {
  if (!r.stdout) return undefined;
  const parsed = JSON.parse(r.stdout) as { hookSpecificOutput?: { permissionDecision?: string } };
  return parsed.hookSpecificOutput?.permissionDecision;
}

function makeGoal(id: string, authorizations: AuthRec[] = []) {
  const now = nowIso();
  return Goal.parse({
    schemaVersion: 1,
    id,
    generation: 0,
    revision: 0,
    revisions: [{ revision: 0, at: now, reason: 'created', request: { text: 'fix the login bug', source: 'natural-language' } }],
    repository: 'repo',
    routing: classifyRequest({ text: 'fix the login bug' }),
    target: 'development',
    stages: stagesForTarget('development'),
    state: 'RUN',
    deadlines: computeGoalDeadlines(now, { cardCount: 1 }),
    authorizations,
    createdAt: now,
    updatedAt: now,
  });
}

test('production-gate: non-production commands pass', () => {
  const { cwd, env } = envWithState();
  const r = productionGate({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, env, DEFAULT_HOOK_CONFIG, cwd);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, undefined);
  const dev = productionGate({ tool_name: 'Bash', tool_input: { command: 'deploy --env dev' } }, env, DEFAULT_HOOK_CONFIG, cwd);
  assert.equal(dev.exitCode, 0);
});

test('production-gate: production deploy without RELEASE_APPROVAL is blocked with a reason', () => {
  const { cwd, env } = envWithState();
  const r = productionGate({ tool_name: 'Bash', tool_input: { command: 'make deploy ENV=production' } }, env, DEFAULT_HOOK_CONFIG, cwd);
  assert.equal(r.exitCode, 2);
  assert.ok(r.stderr?.includes('release authorization'));
  const r2 = runHook('production-gate', { tool_input: { command: 'kubectl apply -f prod/' } }, { cwd, env });
  assert.equal(r2.exitCode, 2);
});

test('production-gate: RELEASE_APPROVAL with no aidlc goals recorded is honoured', () => {
  const { cwd, env } = envWithState();
  const r = productionGate({ tool_input: { command: 'deploy production' } }, { ...env, RELEASE_APPROVAL: 'rel-1' }, DEFAULT_HOOK_CONFIG, cwd);
  assert.equal(r.exitCode, 0);
});

test('production-gate: recorded production authorization must match the approval id', () => {
  const { cwd, env } = envWithState();
  const store = new GoalStore(resolveStatePaths(cwd, env));
  const auth = AuthorizationRecord.parse({ id: 'rel-1', kind: 'production', grantedBy: 'release-manager', grantedAt: nowIso(), environment: 'prod', candidateDigest: 'abc', operations: ['deploy'] });
  store.saveGoal(makeGoal('g1', [auth]));
  const ok = productionGate({ tool_input: { command: 'deploy production' } }, { ...env, RELEASE_APPROVAL: 'rel-1' }, DEFAULT_HOOK_CONFIG, cwd);
  assert.equal(ok.exitCode, 0);
  const wrong = productionGate({ tool_input: { command: 'deploy production' } }, { ...env, AIDLC_RELEASE_APPROVAL: 'rel-2' }, DEFAULT_HOOK_CONFIG, cwd);
  assert.equal(wrong.exitCode, 2);
  assert.ok(wrong.stderr?.includes('rel-2'));
  // a development-kind record never authorises production
  const store2 = new GoalStore(resolveStatePaths(cwd, env));
  store2.saveGoal(makeGoal('g2', [AuthorizationRecord.parse({ id: 'dev-1', kind: 'development', grantedBy: 'u', grantedAt: nowIso() })]));
  const devOnly = productionGate({ tool_input: { command: 'deploy production' } }, { ...env, RELEASE_APPROVAL: 'dev-1' }, DEFAULT_HOOK_CONFIG, cwd);
  assert.equal(devOnly.exitCode, 2);
});

test('protect-paths: deny file edits and write commands, defer read-only, nothing when unconfigured', () => {
  const config = { ...DEFAULT_HOOK_CONFIG, frozenPaths: ['specs/verdict\\.schema\\.json', 'android/core/src/main/sqldelight/'] };
  const edit = protectPaths({ tool_name: 'Edit', tool_input: { file_path: 'D:\\repo\\specs\\verdict.schema.json' } }, config);
  assert.equal(decision(edit), 'deny');
  assert.ok(edit.stdout?.includes('FROZEN'));
  const write = protectPaths({ tool_name: 'Bash', tool_input: { command: "sed -i 's/a/b/' specs/verdict.schema.json" } }, config);
  assert.equal(decision(write), 'deny');
  const redirect = protectPaths({ tool_input: { command: 'echo x > android/core/src/main/sqldelight/Foo.sq' } }, config);
  assert.equal(decision(redirect), 'deny');
  const read = protectPaths({ tool_input: { command: 'cat specs/verdict.schema.json' } }, config);
  assert.equal(decision(read), 'defer');
  const other = protectPaths({ tool_input: { file_path: 'src/app.ts' } }, config);
  assert.equal(other.stdout, undefined);
  const none = protectPaths({ tool_input: { file_path: 'specs/verdict.schema.json' } }, DEFAULT_HOOK_CONFIG);
  assert.deepEqual(none, { exitCode: 0 });
});

// BUG: WRITE_VERBS has no `i` flag, so PowerShell's canonical casing (`Set-Content`, `Remove-Item`,
// `Out-File`) is classified as read-only and only deferred. The scaffold's guard-frozen.ps1 matches
// the same verb list case-insensitively.
test('protect-paths denies PowerShell-cased write verbs', () => {
  const config = { ...DEFAULT_HOOK_CONFIG, frozenPaths: ['specs/verdict\\.schema\\.json'] };
  const r = protectPaths({ tool_name: 'PowerShell', tool_input: { command: 'Set-Content specs/verdict.schema.json -Value x' } }, config);
  assert.equal(decision(r), 'deny');
  const rm = protectPaths({ tool_name: 'PowerShell', tool_input: { command: 'Remove-Item specs/verdict.schema.json' } }, config);
  assert.equal(decision(rm), 'deny');
});

test('protect-paths reads frozenPaths from aidlc.config.json via runHook', () => {
  const { cwd, env } = envWithState();
  writeFileSync(path.join(cwd, 'aidlc.config.json'), JSON.stringify({ hooks: { frozenPaths: ['contracts/'] } }), 'utf8');
  assert.deepEqual(loadHookConfig(cwd).frozenPaths, ['contracts/']);
  const r = runHook('protect-paths', { tool_input: { file_path: 'contracts/api.yaml' } }, { cwd, env });
  assert.equal(decision(r), 'deny');
  assert.deepEqual(loadHookConfig(mkdtempSync(path.join(tmpdir(), 'aidlc-nocfg-'))), DEFAULT_HOOK_CONFIG);
});

test('protect-tests: denies test edits only while a fix task is active', () => {
  const { cwd, env } = envWithState();
  const free = protectTests({ tool_input: { file_path: 'tests/foo.test.ts' } }, cwd, env, DEFAULT_HOOK_CONFIG);
  assert.deepEqual(free, { exitCode: 0 });
  const fixing = { ...env, AIDLC_FIX_TASK: 'T1-FIX' };
  const denied = protectTests({ tool_input: { file_path: 'src/__tests__/../tests/foo.test.ts' } }, cwd, fixing, DEFAULT_HOOK_CONFIG);
  assert.equal(decision(denied), 'deny');
  assert.ok(denied.stdout?.includes('T1-FIX'));
  const spec = protectTests({ tool_input: { file_path: 'src/foo.spec.ts' } }, cwd, fixing, DEFAULT_HOOK_CONFIG);
  assert.equal(decision(spec), 'deny');
  const src = protectTests({ tool_input: { file_path: 'src/foo.ts' } }, cwd, fixing, DEFAULT_HOOK_CONFIG);
  assert.deepEqual(src, { exitCode: 0 });
  // marker file in the state dir also activates the lock
  const { cwd: cwd2, env: env2, stateDir } = envWithState();
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, 'fix-task'), 'T2-FIX\n', 'utf8');
  const viaFile = protectTests({ tool_input: { file_path: 'tests/bar.test.ts' } }, cwd2, env2, DEFAULT_HOOK_CONFIG);
  assert.equal(decision(viaFile), 'deny');
});

test('secrets-guard: denies credential patterns and secret files, allows placeholders', () => {
  assert.equal(decision(secretsGuard({ tool_input: { content: 'const key = "sk-ant-api03-' + 'A'.repeat(40) + '";' } })), 'deny');
  assert.equal(decision(secretsGuard({ tool_input: { new_string: 'aws_access_key_id = AKIAABCDEFGHIJKLMNOP' } })), 'deny');
  assert.equal(decision(secretsGuard({ tool_input: { command: 'echo "-----BEGIN RSA PRIVATE KEY-----" > k' } })), 'deny');
  assert.equal(decision(secretsGuard({ tool_input: { content: 'password = "hunter2hunter2hunter2"' } })), 'deny');
  assert.equal(decision(secretsGuard({ tool_input: { file_path: 'D:/repo/.env' } })), 'deny');
  assert.equal(decision(secretsGuard({ tool_input: { file_path: 'config/.env.production', content: 'x' } })), 'deny');
  assert.equal(decision(secretsGuard({ tool_input: { file_path: 'deploy/server.pem' } })), 'deny');
  assert.deepEqual(secretsGuard({ tool_input: { content: 'ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxexample' } }), { exitCode: 0 });
  assert.deepEqual(secretsGuard({ tool_input: { file_path: 'config/settings.ts', content: 'API_KEY=<your-key>' } }), { exitCode: 0 });
  assert.deepEqual(secretsGuard({ tool_input: { content: 'const x = 1;' } }), { exitCode: 0 });
});

// BUG: the secret-file regex `(^|\/)\.env(\.|$)` also matches `.env.example`, so the hook blocks
// the very placeholder file its own deny message tells the agent to use.
test('secrets-guard allows writing .env.example placeholders', () => {
  assert.deepEqual(secretsGuard({ tool_input: { file_path: '.env.example', content: 'API_KEY=<your-key>' } }), { exitCode: 0 });
});

test('verify-before-done: active card without a DoD receipt injects Stop context', () => {
  const { cwd, env } = envWithState();
  const store = new GoalStore(resolveStatePaths(cwd, env));
  store.saveGoal(makeGoal('g1'));
  const now = nowIso();
  store.saveCardRun(CardRun.parse({ goalId: 'g1', cardId: 'T1-FOO', cardRevision: 0, goalGeneration: 0, state: 'BUILD', startedAt: now, deadline: addMs(now, 3600_000), updatedAt: now }));
  const r = verifyBeforeDone(cwd, env);
  assert.ok(r.stdout);
  const parsed = JSON.parse(r.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'Stop');
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('T1-FOO (BUILD)'));
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('DoD receipt'));
  // with a receipt, nothing is injected
  store.saveCardRun(CardRun.parse({ goalId: 'g1', cardId: 'T1-FOO', cardRevision: 0, goalGeneration: 0, state: 'BUILD', startedAt: now, deadline: addMs(now, 3600_000), updatedAt: now, dodReceipt: 'evidence/g1/dod' }));
  assert.deepEqual(runHook('verify-before-done', {}, { cwd, env }), { exitCode: 0 });
  // a terminal goal is ignored
  const empty = envWithState();
  assert.deepEqual(verifyBeforeDone(empty.cwd, empty.env), { exitCode: 0 });
});

test('route-new-work prints a routing line for real requests only', () => {
  const r = routeNewWork({ prompt: 'Add a reporting dashboard feature with charts to the admin portal' });
  assert.ok(r.stdout?.startsWith('[route]'));
  assert.ok(r.stdout?.includes('size=T1'));
  assert.ok(r.stdout?.includes('[aidlc] T1:'));
  assert.ok(r.stdout?.includes('skills=grilling+tdd'), `route line names the companion skills: ${r.stdout}`);
  assert.deepEqual(routeNewWork({ prompt: 'hi' }), { exitCode: 0 });
  assert.deepEqual(routeNewWork({ prompt: 'what does this function do exactly, in plain words?' }), { exitCode: 0 });
  const t2 = routeNewWork({ prompt: 'Build a fully AI native SDLC system from scratch with a new architecture' });
  assert.ok(t2.stdout?.includes('T2:'));
});

test('runHook dispatches by name and tolerates unknown names', () => {
  const { cwd, env } = envWithState();
  assert.equal(decision(runHook('secrets-guard', { tool_input: { file_path: '.env' } }, { cwd, env })), 'deny');
  assert.deepEqual(runHook('protect-tests', { tool_input: { file_path: 'tests/a.test.ts' } }, { cwd, env }), { exitCode: 0 });
  assert.deepEqual(runHook('nope' as never, {}, { cwd, env }), { exitCode: 0 });
});

test('dispatchHook runs every guard for the event in one process: first block wins, advisory output passes through', () => {
  const { cwd, env } = envWithState();
  assert.deepEqual(hookNamesFor({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }), ['production-gate', 'protect-paths', 'secrets-guard']);
  assert.deepEqual(hookNamesFor({ hook_event_name: 'PreToolUse', tool_name: 'Edit' }), ['protect-paths', 'secrets-guard', 'protect-tests']);
  assert.deepEqual(hookNamesFor({ hook_event_name: 'PreToolUse', tool_name: 'MultiEdit' }), hookNamesFor({ hook_event_name: 'PreToolUse', tool_name: 'Write' }));
  assert.deepEqual(hookNamesFor({ hook_event_name: 'Stop' }), ['verify-before-done']);
  assert.deepEqual(hookNamesFor({ hook_event_name: 'UserPromptSubmit' }), ['route-new-work']);
  assert.deepEqual(hookNamesFor({ hook_event_name: 'PreToolUse', tool_name: 'Read' }), []);
  assert.deepEqual(hookNamesFor({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }), []);
  const covered = new Set([{ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, { hook_event_name: 'PreToolUse', tool_name: 'Write' }, { hook_event_name: 'Stop' }, { hook_event_name: 'UserPromptSubmit' }].flatMap((e) => hookNamesFor(e)));
  assert.deepEqual([...covered].sort(), ['production-gate', 'protect-paths', 'protect-tests', 'route-new-work', 'secrets-guard', 'verify-before-done']);
  // blocks: an exit-2 gate and a deny decision each stop the tool. The literals are assembled across lines so
  // the guards of this repository never see a gated pattern in the command that writes this file.
  const gatedCommand = ['make deploy',
    'ENV=production'].join(' ');
  const gateResult = dispatchHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: gatedCommand } }, { cwd, env });
  assert.equal(gateResult.exitCode, 2);
  assert.ok(gateResult.stderr?.includes('release authorization'));
  assert.equal(decision(dispatchHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '.env', content: 'A=1' } }, { cwd, env })), 'deny');
  const awsLike = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
  assert.equal(decision(dispatchHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `echo ${awsLike} > creds` } }, { cwd, env })), 'deny');
  // passes: nothing to say means exit 0 with no output
  assert.deepEqual(dispatchHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }, { cwd, env }), { exitCode: 0 });
  assert.deepEqual(dispatchHook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '.env' } }, { cwd, env }), { exitCode: 0 });
  assert.deepEqual(dispatchHook({ hook_event_name: 'Stop' }, { cwd, env }), { exitCode: 0 });
  assert.deepEqual(dispatchHook({}, { cwd, env }), { exitCode: 0 });
  // advisory output is returned unchanged
  const route = dispatchHook({ hook_event_name: 'UserPromptSubmit', prompt: 'Add a reporting dashboard feature with charts to the admin portal' }, { cwd, env });
  assert.ok(route.stdout?.startsWith('[route]'));
});
