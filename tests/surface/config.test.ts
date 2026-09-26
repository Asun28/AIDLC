import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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

  test('aidlc.config.json runs R3 on a read-only Codex gpt-6-astra at medium effort [T0-R3-CODEX-ASTRA R1]', () => {
    const repoConfig = ProjectConfig.parse(JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', 'aidlc.config.json'), 'utf8')));
    const r3 = repoConfig.formalReview;
    assert.deepEqual(r3.command, ['codex', 'exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort={effort}', '--sandbox', 'read-only', '--output-schema', '{schema}']);
    assert.equal(r3.reviewer, 'codex');
    assert.equal(r3.timeoutMs, 1_200_000);
    assert.equal(r3.maxDiffBytes, 800_000);
    assert.deepEqual(r3.effort, { default: 'medium' }, 'medium for every candidate: no high rule');
    assert.equal(r3.command[r3.command.indexOf('--sandbox') + 1], 'read-only', 'the reviewer can only read');
    assert.equal(r3.command[r3.command.indexOf('--output-schema') + 1], '{schema}', 'the verdict schema reaches Codex');
    assert.ok(r3.command.every((a) => a.length > 0), 'no empty argument for the Windows shell to drop');
  });

  test('aidlc.config.json runs the read-only Claude Opus 5.5 R3 ran on before as the fallback, with its effort policy [T0-R3-CODEX-ASTRA R2]', () => {
    const repoConfig = ProjectConfig.parse(JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', 'aidlc.config.json'), 'utf8')));
    const fallback = repoConfig.formalReview.fallback;
    assert.ok(fallback, 'Opus 5.5 runs while Codex is held on quota');
    assert.deepEqual(fallback.command, ['claude', '-p', '--model', 'claude-opus-5-5', '--effort', '{effort}', '--tools', 'Read,Grep,Glob', '--setting-sources=', '--strict-mcp-config', '--no-session-persistence'], 'the arguments R3 ran on before, unchanged');
    assert.equal(fallback.reviewer, 'claude-opus-5-5');
    assert.equal(fallback.timeoutMs, 1_200_000);
    assert.equal(fallback.maxDiffBytes, 800_000);
    assert.deepEqual(fallback.effort, { default: 'medium', high: { minChangedLines: 500, paths: ['src/core/**', 'src/coordination/**', 'src/state/**'] } });
    assert.equal(fallback.command[fallback.command.indexOf('--tools') + 1], 'Read,Grep,Glob', 'the reviewer can only read');
    assert.ok(fallback.command.includes('--setting-sources='), 'no setting sources: no hooks or plugins in the reviewer session');
    assert.ok(fallback.command.includes('--strict-mcp-config'), 'no MCP servers, the account connectors included');
    assert.ok(fallback.command.every((a) => a.length > 0), 'no empty argument for the Windows shell to drop');
  });

  test('docs/OPERATIONS.md, CLAUDE.md, the pre-review header and CHANGELOG.md name Codex gpt-6-astra as the R3 reviewer and Opus 5.5 as its fallback [T0-R3-CODEX-ASTRA R4]', () => {
    const read = (...parts: string[]) => readFileSync(path.join(import.meta.dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
    const flat = (text: string) => text.replace(/\n \* /g, ' ').replace(/\s+/g, ' ');
    const ops = read('docs', 'OPERATIONS.md');
    const opsSentences = [
      'In this repository R3 is Codex `gpt-6-astra` in a read-only sandbox at `medium` for every candidate (card T0-R3-CODEX-ASTRA); it receives the effort level `{effort}` expands to as `-c model_reasoning_effort=<level>` and the verdict schema through `--output-schema`.',
      'Its fallback, which runs while Codex is held on quota, is the headless Claude Opus 5.5 that R3 ran on before (card T0-R3-OPUS-PRIMARY), limited to the Read, Grep and Glob tools, with no setting sources (no hooks or plugins) and no MCP servers (`--strict-mcp-config`, which also drops the account connectors); it receives the level as `--effort <level>` and keeps its effort policy, `high` from 500 changed lines or a change under `src/core`, `src/coordination` or `src/state`:',
      '"command": ["codex", "exec", "-m", "gpt-6-astra", "-c", "model_reasoning_effort={effort}", "--sandbox", "read-only", "--output-schema", "{schema}"], "reviewer": "codex", "timeoutMs": 1200000,',
      '"command": ["claude", "-p", "--model", "claude-opus-5-5", "--effort", "{effort}", "--tools", "Read,Grep,Glob", "--setting-sources=", "--strict-mcp-config", "--no-session-persistence"], "reviewer": "claude-opus-5-5", "timeoutMs": 1200000,',
      'Codex `gpt-6-sol`, the primary until Codex became unavailable, is refused for a Codex login with a ChatGPT account ("The \'gpt-6-sol\' model is not supported when using Codex with a ChatGPT account"), so R3 runs on `gpt-6-astra`.',
      'To run R3 without Codex again, move the fallback\'s `command`, `reviewer` and `effort` up to `formalReview` and remove `formalReview.fallback`, as card T0-R3-OPUS-PRIMARY did, since a Codex fallback would be dispatched on an Opus quota hold and fail as well.',
      'The base-sync reviewer, `codex-base-sync`, runs the same Codex command on the same login, so it shares the primary\'s quota but not its review pool (`<reviewPool>/codex-base-sync` against `<reviewPool>/codex`), and a hold on one pool does not hold the other.',
    ];
    for (const sentence of opsSentences) assert.ok(ops.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    assert.ok(!ops.includes('In this repository R3 is a headless Claude Opus 5.5 with no fallback'), 'docs/OPERATIONS.md no longer names Opus 5.5 as the R3 reviewer');
    assert.ok(flat(read('CLAUDE.md')).includes('this repo uses DeepSeek for R2 and Codex gpt-6-astra for R3, with Claude Opus 5.5 as the fallback)'), 'CLAUDE.md names the R3 reviewer');
    assert.ok(flat(read('src', 'review', 'pre-review.ts')).includes('`deepseek` CLI for R2 and Codex `gpt-6-astra` in a read-only sandbox for R3, with a read-only headless `claude -p` (Opus 5.5) as its fallback, in this repository.'), 'the pre-review header names the R3 reviewer');
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    const changelogSentences = [
      '- Formal review on Codex gpt-6-astra, card T0-R3-CODEX-ASTRA: this repository runs R3 on Codex `gpt-6-astra` in a read-only sandbox at `medium` for every candidate, with the headless Claude Opus 5.5 reviewer, its read-only flags and its effort policy moved to `formalReview.fallback`, which runs while Codex is held on quota.',
      '`gpt-6-sol` is refused for a Codex login with a ChatGPT account.',
      'The base-sync reviewer keeps its command under the name `codex-base-sync`, since the configuration refuses a base-sync reviewer named like the primary.',
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

describe('preReview.answerMarker (T0-R2-ANSWER-MARKER)', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const configOf = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8')) as { preReview: Record<string, unknown>; formalReview?: Record<string, unknown> };
  test('acceptance 3: the setting is a string that defaults to empty, and a non-string is refused [R1] [R3]', () => {
    assert.equal(empty.preReview.answerMarker, '');
    assert.equal(ProjectConfig.parse({ preReview: { answerMarker: '=== answer ===' } }).preReview.answerMarker, '=== answer ===');
    assert.throws(() => ProjectConfig.parse({ preReview: { answerMarker: 1 } }), (err: unknown) => err instanceof ZodError && err.issues.some((i) => i.path.join('.') === 'preReview.answerMarker'));
  });
  test('acceptance 3: this repository sets the DeepSeek answer line, the installed template leaves it empty, and the formal review has no such setting [R1] [R3]', () => {
    assert.equal(configOf('aidlc.config.json').preReview['answerMarker'], '=== answer ===');
    assert.equal(ProjectConfig.parse(configOf('aidlc.config.json')).preReview.answerMarker, '=== answer ===');
    assert.equal(configOf('templates/aidlc.config.json').preReview['answerMarker'], '');
    assert.equal(ProjectConfig.parse(configOf('templates/aidlc.config.json')).preReview.answerMarker, '');
    assert.equal('answerMarker' in ProjectConfig.parse({ formalReview: { command: ['r3'], answerMarker: '=== answer ===' } }).formalReview, false, 'the formal review keeps no marker');
  });
});

describe('formalReview.baseSync (T0-BASE-SYNC-REVIEW acceptance 5)', () => {
  const read = (file: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', file), 'utf8')) as { formalReview: Record<string, unknown> };
  test('a base-sync reviewer with only command and reviewer is accepted, defaulted like formalReview and its effort defaults to medium [R1]', () => {
    const c = ProjectConfig.parse({ formalReview: { command: ['primary'], reviewer: 'p', baseSync: { command: ['cx', '{effort}'], reviewer: 'codex' } } });
    const bs = (c.formalReview as { baseSync?: { command: string[]; reviewer: string; timeoutMs: number; maxDiffBytes: number; effort?: { default: string } } }).baseSync;
    assert.deepEqual(bs?.command, ['cx', '{effort}']);
    assert.equal(bs?.reviewer, 'codex');
    assert.equal(bs?.timeoutMs, 20 * 60 * 1000);
    assert.equal(bs?.maxDiffBytes, 300_000);
    assert.equal(bs?.effort?.default, 'medium');
    assert.equal((ProjectConfig.parse({ formalReview: { command: ['primary'] } }).formalReview as { baseSync?: unknown }).baseSync, undefined);
  });
  test('an empty argument, a blank reviewer and a reviewer named like the primary or the fallback in any spelling are refused at formalReview.baseSync [R1]', () => {
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['primary'], baseSync: { command: [], reviewer: 'codex' } } }), issueAt('formalReview.baseSync.command'));
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['primary'], baseSync: { command: ['cx', ''], reviewer: 'codex' } } }), issueAt('formalReview.baseSync.command'));
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['primary'], baseSync: { command: ['cx'], reviewer: '  ' } } }), issueAt('formalReview.baseSync.reviewer'));
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['primary'], reviewer: 'Opus', baseSync: { command: ['cx'], reviewer: ' opus ' } } }), issueAt('formalReview.baseSync.reviewer'));
    assert.throws(() => ProjectConfig.parse({ formalReview: { command: ['primary'], reviewer: 'p', fallback: { command: ['b'], reviewer: 'Backup' }, baseSync: { command: ['cx'], reviewer: 'BACKUP' } } }), issueAt('formalReview.baseSync.reviewer'));
  });
  test('aidlc.config.json names Codex gpt-6-astra at {effort} with effort default medium as the base-sync reviewer codex-base-sync; the template has none [R1] [T0-R3-CODEX-ASTRA R3]', () => {
    const repo = ProjectConfig.parse(read('aidlc.config.json')).formalReview as { reviewer: string; fallback?: { reviewer: string }; baseSync?: { command: string[]; reviewer: string; effort?: { default: string; high?: unknown } } };
    assert.deepEqual(repo.baseSync?.command, ['codex', 'exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort={effort}', '--sandbox', 'read-only', '--output-schema', '{schema}']);
    assert.equal(repo.baseSync?.reviewer, 'codex-base-sync', 'a name of its own: the configuration refuses a base-sync reviewer named like the primary codex');
    assert.equal(new Set([repo.reviewer, repo.fallback?.reviewer, repo.baseSync?.reviewer]).size, 3, 'the primary, the fallback and the base-sync reviewer are three names');
    assert.equal(repo.baseSync?.effort?.default, 'medium');
    assert.equal(repo.baseSync?.effort?.high, undefined, 'medium for every base-sync candidate');
    assert.equal(read('templates/aidlc.config.json').formalReview['baseSync'], undefined);
  });
});

describe('blank values of the keys that gate behaviour (T1-PARSE-GUARD acceptance 1, 2 and 10)', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  /** A ZodError with an issue at `at` or at one of its elements. */
  const issueUnder = (at: string) => (err: unknown): boolean => err instanceof ZodError && err.issues.some((i) => i.path.join('.') === at || i.path.join('.').startsWith(`${at}.`));
  /** A config that parses, with `value` at the dotted path `at`. */
  const withValue = (at: string, value: unknown): Record<string, unknown> => {
    const config: Record<string, any> = { formalReview: { command: ['p'], reviewer: 'p', fallback: { command: ['b'], reviewer: 'b' }, baseSync: { command: ['cx'], reviewer: 'cx' } } };
    const keys = at.split('.');
    let node = config;
    for (const key of keys.slice(0, -1)) node = node[key] ??= {};
    node[keys.at(-1)!] = value;
    return config;
  };
  const SCALARS = ['base', 'reviewPool', 'reviewPolicyVersion', 'reviewer', 'repository', 'cardsDir', 'archiveDir', 'intentDir', 'specsDir', 'plansDir', 'evalsDir', 'preReview.reviewer', 'formalReview.reviewer', 'formalReview.fallback.reviewer'];
  const EMPTY_ALLOWED = ['preReview.answerMarker', 'worktreeRoot'];
  const LISTS = ['preReview.command', 'formalReview.command', 'formalReview.fallback.command', 'formalReview.baseSync.command', 'preReview.perspectives', 'github.requiredChecks', 'hooks.frozenPaths', 'hooks.testPathPatterns', 'hooks.productionPatterns', 'tierPaths.tierS', 'tierPaths.tier0', 'tierPaths.frozen'];
  test('the base config of these cases parses, so each refusal below is the blank value [R1]', () => {
    assert.doesNotThrow(() => ProjectConfig.parse(withValue('base', 'main')));
    for (const at of LISTS) assert.doesNotThrow(() => ProjectConfig.parse(withValue(at, ['ok'])), at);
  });
  test('a whitespace-only value is refused with an issue at its path, in every key and every list element that gates behaviour [R1]', () => {
    for (const at of [...SCALARS, ...EMPTY_ALLOWED]) assert.throws(() => ProjectConfig.parse(withValue(at, '   ')), issueUnder(at), `${at}: "   "`);
    for (const at of [...SCALARS, ...EMPTY_ALLOWED]) assert.throws(() => ProjectConfig.parse(withValue(at, '\t\n')), issueUnder(at), `${at}: a tab and a newline`);
    for (const at of LISTS) assert.throws(() => ProjectConfig.parse(withValue(at, ['ok', '   '])), issueUnder(at), `${at}: ["ok", "   "]`);
  });
  test('an empty value is refused everywhere but preReview.answerMarker and worktreeRoot, which accept it as off and as the default [R1]', () => {
    for (const at of SCALARS) assert.throws(() => ProjectConfig.parse(withValue(at, '')), issueUnder(at), `${at}: ""`);
    for (const at of LISTS) assert.throws(() => ProjectConfig.parse(withValue(at, ['ok', ''])), issueUnder(at), `${at}: ["ok", ""]`);
    const parsed = ProjectConfig.parse({ worktreeRoot: '', preReview: { answerMarker: '' } });
    assert.equal(parsed.worktreeRoot, '');
    assert.equal(parsed.preReview.answerMarker, '');
  });
  test('a value with a non-blank character still parses, surrounding blanks included, and both shipped configs parse [R1]', () => {
    assert.equal(ProjectConfig.parse({ preReview: { answerMarker: ' === answer === ' } }).preReview.answerMarker, ' === answer === ');
    assert.deepEqual(ProjectConfig.parse({ preReview: { command: ['r2', '--flag='] } }).preReview.command, ['r2', '--flag=']);
    for (const file of ['aidlc.config.json', path.join('templates', 'aidlc.config.json')]) assert.doesNotThrow(() => ProjectConfig.parse(JSON.parse(readFileSync(path.join(root, file), 'utf8'))), file);
  });
  test('aidlc doctor on a whitespace-only preReview.answerMarker prints config: ERROR naming the path and exits 1, with no stack trace [R2]', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-config-error-'));
    try {
      const doctor = (config: string) => {
        writeFileSync(path.join(dir, 'aidlc.config.json'), config, 'utf8');
        const r = spawnSync(process.execPath, [path.join(root, 'bin', 'aidlc.js'), 'doctor'], { cwd: dir, env: { ...process.env, AIDLC_STATE_DIR: path.join(dir, 'state') }, encoding: 'utf8', timeout: 60_000, windowsHide: true });
        return { status: r.status, output: `${r.stdout}${r.stderr}` };
      };
      const blank = doctor(JSON.stringify({ preReview: { answerMarker: '   ' } }));
      assert.equal(blank.status, 1, blank.output);
      assert.match(blank.output, /config: ERROR aidlc\.config\.json: preReview\.answerMarker: must be empty or not blank/);
      assert.doesNotMatch(blank.output, /^\s+at /m, 'no stack trace');
      const unparsable = doctor('{ not json');
      assert.equal(unparsable.status, 1, unparsable.output);
      assert.match(unparsable.output, /config: ERROR/);
      assert.doesNotMatch(unparsable.output, /^\s+at /m, 'no stack trace');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('docs/OPERATIONS.md and the CHANGELOG Unreleased section state the refused blank values and the doctor config error [R1] [R2]', () => {
    const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
    const operations = read('docs', 'OPERATIONS.md');
    const opsSentences = [
      'A key that gates behaviour refuses a value that is only whitespace, and every such key but `worktreeRoot` and `preReview.answerMarker`, where empty is the default or off, refuses an empty value as well (card T1-PARSE-GUARD): `cardsDir`, `archiveDir`, `intentDir`, `specsDir`, `plansDir`, `evalsDir`, `base`, `reviewPool`, `reviewPolicyVersion`, `reviewer`, `repository`, the reviewer names of `preReview` and `formalReview`, each element of the `command` arrays, of `preReview.perspectives`, of `github.requiredChecks`, of the three `hooks` lists and of the three `tierPaths` lists, and the `successPattern`, `failurePattern` and `operationIdPattern` of an `aidlc.ops.json` binding.',
      'A whitespace-only `preReview.answerMarker` used to read the whole stdout as if no marker were set.',
      '`aidlc doctor` on an `aidlc.config.json` that does not parse prints `config: ERROR` with the failing path and exits 1, with no stack trace.',
    ];
    for (const sentence of opsSentences) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    const sentence = 'A blank value of a configuration key that gates behaviour is refused, and `aidlc doctor` reports a configuration that does not parse as `config: ERROR` with exit 1 instead of a stack trace.';
    assert.ok(unreleased.includes(sentence), `CHANGELOG.md Unreleased states: ${sentence}`);
  });
});
