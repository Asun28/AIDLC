import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ZodError } from 'zod';
import { FormalReviewConfig, FormalReviewFallback, ProjectConfig, resolveWorktreeRoot } from '../../src/config.ts';

const explicit = ProjectConfig.parse({ worktreeRoot: 'D:\\wt\\AIDLC' });
const empty = ProjectConfig.parse({});

describe('resolveWorktreeRoot (T0-WORKTREE-ROOT-DEFAULT)', () => {
  test('an explicit worktreeRoot is returned as given on either platform [R1]', () => {
    assert.equal(resolveWorktreeRoot(explicit, 'D:\\Projects\\AIDLC', { SystemDrive: 'C:' }, 'win32'), 'D:\\wt\\AIDLC');
    assert.equal(resolveWorktreeRoot(explicit, '/home/u/src/AIDLC', { HOME: '/home/u' }, 'linux'), 'D:\\wt\\AIDLC');
  });

  test('an empty worktreeRoot resolves to the platform root joined with the main checkout name [R2]', () => {
    assert.equal(resolveWorktreeRoot(empty, 'D:\\Projects\\AIDLC', { SystemDrive: 'D:' }, 'win32'), 'D:\\wt\\AIDLC');
    assert.equal(resolveWorktreeRoot(empty, '/home/u/src/AIDLC', { HOME: '/home/u' }, 'linux'), '/home/u/.wt/AIDLC');
    assert.equal(resolveWorktreeRoot(empty, '/Users/u/src/AIDLC', { HOME: '/Users/u' }, 'darwin'), '/Users/u/.wt/AIDLC');
  });

  test('two repositories with the same card id resolve to different directories [R2]', () => {
    const a = resolveWorktreeRoot(empty, 'D:\\Projects\\AIDLC', { SystemDrive: 'C:' }, 'win32');
    const b = resolveWorktreeRoot(empty, 'D:\\Projects\\MyInspection', { SystemDrive: 'C:' }, 'win32');
    assert.equal(a, 'C:\\wt\\AIDLC');
    assert.equal(b, 'C:\\wt\\MyInspection');
    assert.notEqual(path.win32.join(a, 'T0-CI-CARD1-MIN'), path.win32.join(b, 'T0-CI-CARD1-MIN'));
  });

  test('the checkout name is read after a trailing separator is dropped [R2]', () => {
    const plain = resolveWorktreeRoot(empty, 'D:\\Projects\\AIDLC', { SystemDrive: 'C:' }, 'win32');
    assert.equal(resolveWorktreeRoot(empty, 'D:\\Projects\\AIDLC\\', { SystemDrive: 'C:' }, 'win32'), plain);
    assert.equal(resolveWorktreeRoot(empty, '/home/u/src/AIDLC/', { HOME: '/home/u' }, 'linux'), resolveWorktreeRoot(empty, '/home/u/src/AIDLC', { HOME: '/home/u' }, 'linux'));
  });

  test('a missing or empty SystemDrive falls back to C: and a missing or empty HOME to /tmp [R2] [T0-WORKTREE-ROOT-EDGE R2]', () => {
    assert.equal(resolveWorktreeRoot(empty, 'D:\\Projects\\AIDLC', {}, 'win32'), 'C:\\wt\\AIDLC');
    assert.equal(resolveWorktreeRoot(empty, 'D:\\Projects\\AIDLC', { SystemDrive: '' }, 'win32'), 'C:\\wt\\AIDLC', 'an empty SystemDrive is missing, not a relative root');
    assert.equal(resolveWorktreeRoot(empty, '/srv/AIDLC', {}, 'linux'), '/tmp/.wt/AIDLC');
    assert.equal(resolveWorktreeRoot(empty, '/srv/AIDLC', { HOME: '' }, 'linux'), '/tmp/.wt/AIDLC', 'an empty HOME is missing, not a relative root');
  });

  test('a main checkout with no directory name (a filesystem root) is refused with an error naming worktreeRoot and the checkout [T0-WORKTREE-ROOT-EDGE R1]', () => {
    assert.throws(() => resolveWorktreeRoot(empty, 'D:\\', { SystemDrive: 'C:' }, 'win32'), (err: unknown) => err instanceof Error && /worktreeRoot/.test(err.message) && err.message.includes("'D:\\'"));
    assert.throws(() => resolveWorktreeRoot(empty, '/', { HOME: '/home/u' }, 'linux'), (err: unknown) => err instanceof Error && /worktreeRoot/.test(err.message) && err.message.includes("'/'"));
  });

  test('an explicit worktreeRoot is returned for a nameless checkout too [T0-WORKTREE-ROOT-EDGE R3]', () => {
    assert.equal(resolveWorktreeRoot(explicit, 'D:\\', { SystemDrive: 'C:' }, 'win32'), 'D:\\wt\\AIDLC');
    assert.equal(resolveWorktreeRoot(explicit, '/', { HOME: '/home/u' }, 'linux'), 'D:\\wt\\AIDLC');
  });

  test('env and platform default to the process (the resolved root ends with the checkout name) [R2]', () => {
    const resolved = resolveWorktreeRoot(empty, path.join('some', 'where', 'REPO-X'));
    assert.equal(path.basename(resolved), 'REPO-X');
    assert.equal(path.basename(path.dirname(resolved)), process.platform === 'win32' ? 'wt' : '.wt');
  });
});

/** A ZodError, not a crash, whose issue names the given path. */
const issueAt = (at: string) => (err: unknown): boolean => err instanceof ZodError && err.issues.some((i) => i.path.join('.') === at);

describe('formalReview.fallback (T0-R3-FALLBACK-2)', () => {
  test('a fallback with only command and reviewer is accepted and defaulted like formalReview [R1]', () => {
    const c = ProjectConfig.parse({ formalReview: { command: ['primary'], reviewer: 'p', fallback: { command: ['backup', '-p'], reviewer: 'b' } } });
    assert.deepEqual(c.formalReview.fallback?.command, ['backup', '-p']);
    assert.equal(c.formalReview.fallback?.reviewer, 'b');
    assert.equal(c.formalReview.fallback?.timeoutMs, 20 * 60 * 1000);
    assert.equal(c.formalReview.fallback?.maxDiffBytes, 300_000);
  });

  test('a fallback with an empty command is rejected with an issue naming formalReview.fallback.command, not a crash [R1]', () => {
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['primary'], fallback: { command: [], reviewer: 'b' } } }), issueAt('formalReview.fallback.command'));
  });

  test('a config without a fallback parses to fallback undefined [R1]', () => {
    assert.equal(empty.formalReview.fallback, undefined);
    assert.equal(ProjectConfig.parse({ formalReview: { command: ['primary'] } }).formalReview.fallback, undefined);
  });
});

describe('formalReview.fallback validation and this repository config (T0-R3-FALLBACK-2)', () => {
  test('a fallback with an empty argument anywhere (the Windows shell drops it), an empty reviewer, or the primary name is rejected [R1]', () => {
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['p'], reviewer: 'p', fallback: { command: [''], reviewer: 'b' } } }), issueAt('formalReview.fallback.command'));
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['p'], reviewer: 'p', fallback: { command: ['b', '--setting-sources', ''], reviewer: 'b' } } }), issueAt('formalReview.fallback.command'));
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['p'], reviewer: 'p', fallback: { command: ['b'], reviewer: '' } } }), (err: unknown) => err instanceof ZodError && err.issues.some((i) => i.path.join('.') === 'formalReview.fallback.reviewer'));
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['p'], reviewer: 'same', fallback: { command: ['b'], reviewer: 'same' } } }), /must differ/);
    // Request keys and pool files fold case and surrounding blanks, so a case or blank variant is the same reviewer.
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['p'], reviewer: 'codex', fallback: { command: ['b'], reviewer: 'Codex ' } } }), /must differ/);
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['p'], reviewer: 'p', fallback: { command: ['b'], reviewer: '   ' } } }), (err: unknown) => err instanceof ZodError && err.issues.some((i) => i.path.join('.') === 'formalReview.fallback.reviewer'));
    assert.deepEqual(ProjectConfig.parse({ formalReview: { command: ['p'], reviewer: 'p', fallback: { command: ['b', '--setting-sources='], reviewer: 'b' } } }).formalReview.fallback?.command, ['b', '--setting-sources=']);
  });

  test('aidlc.config.json runs R3 on a read-only Claude Opus 5.5 at {effort} with no fallback while Codex is unavailable [T0-R3-OPUS-PRIMARY R1]', () => {
    const repoConfig = ProjectConfig.parse(JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', 'aidlc.config.json'), 'utf8')));
    const effort = { default: 'medium', high: { minChangedLines: 500, paths: ['src/core/**', 'src/coordination/**', 'src/state/**'] } };
    const r3 = repoConfig.formalReview;
    assert.deepEqual(r3.command, ['claude', '-p', '--model', 'claude-opus-5-5', '--effort', '{effort}', '--tools', 'Read,Grep,Glob', '--setting-sources=', '--strict-mcp-config', '--no-session-persistence'], 'the arguments of the former fallback, unchanged');
    assert.equal(r3.reviewer, 'claude-opus-5-5');
    assert.equal(r3.timeoutMs, 1_200_000);
    assert.deepEqual(r3.effort, effort);
    assert.equal(r3.fallback, undefined, 'no fallback: a Codex fallback would be dispatched on an Opus quota hold and fail while Codex is unavailable');
    assert.equal(r3.command[r3.command.indexOf('--tools') + 1], 'Read,Grep,Glob', 'the reviewer can only read');
    assert.ok(r3.command.includes('--setting-sources='), 'no setting sources: no hooks or plugins in the reviewer session');
    assert.ok(r3.command.includes('--strict-mcp-config'), 'no MCP servers, the account connectors included');
    assert.ok(r3.command.every((a) => a.length > 0), 'no empty argument for the Windows shell to drop');
  });

  test('docs/OPERATIONS.md, CLAUDE.md and CHANGELOG.md name Opus 5.5 as the R3 reviewer and keep the Codex restore path [T0-R3-OPUS-PRIMARY R2]', () => {
    const read = (...parts: string[]) => readFileSync(path.join(import.meta.dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
    const flat = (text: string) => text.replace(/\s+/g, ' ');
    const ops = read('docs', 'OPERATIONS.md');
    const opsSentences = [
      'In this repository R3 is a headless Claude Opus 5.5 with no fallback (card T0-R3-OPUS-PRIMARY), limited to the Read, Grep and Glob tools, with no setting sources (no hooks or plugins) and no MCP servers (`--strict-mcp-config`, which also drops the account connectors); it receives the effort level `{effort}` expands to as `--effort <level>`:',
      'Codex `gpt-6-sol` was the primary, with Opus 5.5 as its fallback, until Codex became unavailable. No Codex fallback is configured: the fallback runs while the primary is held on quota, and a Codex run would fail as well.',
      'To restore Codex, put its command back as `formalReview.command` with `"reviewer": "codex"` and move the Opus 5.5 command to `formalReview.fallback`; Codex takes the level as `-c model_reasoning_effort=<level>`:',
    ];
    for (const sentence of opsSentences) assert.ok(ops.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    assert.ok(ops.includes('"command": ["codex", "exec", "-m", "gpt-6-sol", "-c", "model_reasoning_effort={effort}", "--sandbox", "read-only", "--output-schema", "{schema}"], "reviewer": "codex"'), 'docs/OPERATIONS.md keeps the Codex command');
    assert.ok(flat(read('CLAUDE.md')).includes('this repo uses DeepSeek for R2 and Claude Opus 5.5 for R3 while Codex is unavailable)'), 'CLAUDE.md names the R3 reviewer');
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    const changelogSentences = [
      '- Formal review on Opus 5.5, card T0-R3-OPUS-PRIMARY: Codex is unavailable, so this repository runs R3 on the headless Claude Opus 5.5 reviewer that was its fallback, with the same read-only flags, effort policy and timeout, and with no fallback, since a Codex fallback would be dispatched on an Opus quota hold and fail.',
      '`docs/OPERATIONS.md` keeps the Codex `gpt-6-sol` command as the way to restore it, and `CLAUDE.md` names Opus 5.5 for R3.',
    ];
    for (const sentence of changelogSentences) assert.ok(unreleased.includes(sentence), `CHANGELOG.md Unreleased states: ${sentence}`);
  });

  test('templates/aidlc.config.json gains only formalReview.effort medium; its command and reviewer are unchanged [T1-OPUS55-R3 acceptance 5]', () => {
    const raw = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', 'templates', 'aidlc.config.json'), 'utf8')) as { formalReview: Record<string, unknown> };
    assert.deepEqual(raw.formalReview, { command: [], reviewer: 'codex', timeoutMs: 1200000, effort: { default: 'medium' } });
  });
});

describe('formalReview effort (T1-OPUS55-R3 acceptance 2)', () => {
  const effort = { default: 'high', high: { minChangedLines: 500, paths: ['src/core/**'] } };

  test('the primary and the fallback parse an effort object [R1]', () => {
    assert.deepEqual(FormalReviewConfig.parse({ command: ['p'], effort }).effort, effort);
    assert.deepEqual(FormalReviewFallback.parse({ command: ['b'], reviewer: 'b', effort }).effort, effort);
  });

  test('an effort object without default or high paths is defaulted to medium and no paths [R1]', () => {
    assert.deepEqual(FormalReviewConfig.parse({ command: ['p'], effort: { high: { minChangedLines: 10 } } }).effort, { default: 'medium', high: { minChangedLines: 10, paths: [] } });
  });

  test('a reviewer without an effort object parses with none [R1]', () => {
    assert.equal(FormalReviewConfig.parse({ command: ['p'] }).effort, undefined);
    assert.equal(FormalReviewFallback.parse({ command: ['b'], reviewer: 'b' }).effort, undefined);
  });

  test('a level of low or an unknown level is rejected with an issue naming effort.default [R1]', () => {
    assert.throws(() => FormalReviewConfig.parse({ command: ['p'], effort: { default: 'low' } }), issueAt('effort.default'));
    assert.throws(() => FormalReviewFallback.parse({ command: ['b'], reviewer: 'b', effort: { default: 'extreme' } }), issueAt('effort.default'));
  });

  test('a negative or fractional minChangedLines is rejected with an issue naming effort.high.minChangedLines [R1]', () => {
    assert.throws(() => FormalReviewConfig.parse({ command: ['p'], effort: { high: { minChangedLines: -1 } } }), issueAt('effort.high.minChangedLines'));
    assert.throws(() => FormalReviewFallback.parse({ command: ['b'], reviewer: 'b', effort: { high: { minChangedLines: 1.5 } } }), issueAt('effort.high.minChangedLines'));
  });

  test('inside the project config the issue names formalReview.fallback.effort.default [R1]', () => {
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['p'], reviewer: 'p', fallback: { command: ['b'], reviewer: 'b', effort: { default: 'low' } } } }), issueAt('formalReview.fallback.effort.default'));
  });

  test('a default of xhigh or max with a high rule is rejected with an issue naming effort.high: the rule would lower the level [R1]', () => {
    const high = { minChangedLines: 500 };
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['p'], reviewer: 'p', effort: { default: 'xhigh', high } } }), issueAt('formalReview.effort.high'));
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['p'], reviewer: 'p', fallback: { command: ['b'], reviewer: 'b', effort: { default: 'max', high } } } }), issueAt('formalReview.fallback.effort.high'));
    assert.deepEqual(FormalReviewConfig.parse({ command: ['p'], effort: { default: 'max' } }).effort, { default: 'max' }, 'max without a high rule parses');
  });
});

describe('review effort documentation (T1-OPUS55-R3 acceptance 6)', () => {
  const read = (...parts: string[]) => readFileSync(path.join(import.meta.dirname, '..', '..', ...parts), 'utf8');

  test('docs/OPERATIONS.md documents the effort object, the placeholder and the flag each reviewer receives [R1] [R4]', () => {
    const ops = read('docs', 'OPERATIONS.md');
    assert.match(ops, /`formalReview\.effort`/);
    assert.match(ops, /`\{effort\}`/);
    assert.ok(ops.includes('"model_reasoning_effort={effort}"'), 'the Codex primary flag');
    assert.ok(ops.includes('"--effort", "{effort}"'), 'the Claude fallback flag');
  });

  test('docs/OPERATIONS.md says the level is counted from the pinned --text diff collected for the review, which an {instructions} reviewer does not receive [T1-OPUS55-R3-2 acceptance 10]', () => {
    const ops = read('docs', 'OPERATIONS.md');
    assert.match(ops, /counted from the pinned `--text` diff collected for the review/);
    assert.match(ops, /argv carries `\{instructions\}` receives a diff command/);
  });

  test('docs/ARCHITECTURE.md names src/core/review-effort.ts [R1]', () => {
    assert.match(read('docs', 'ARCHITECTURE.md'), /review-effort\.ts/);
  });

  test('CHANGELOG.md carries the entry under Unreleased [R1] [R4]', () => {
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    assert.match(unreleased, /T1-OPUS55-R3/);
  });
});
