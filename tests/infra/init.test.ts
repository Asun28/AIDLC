import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initProject } from '../../src/scaffold/init.ts';
import { loadProjectConfig } from '../../src/config.ts';
import { GitProbe } from '../../src/probes/git.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIT_OK = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;
/** The header init writes before the entries it appends. */
const HEADER = '# aidlc runtime state (never committed)';

describe('aidlc init (scaffold)', () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test('lays the playbook layout over an empty directory and is idempotent', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'aidlc-init-'));
    dirs.push(target);
    const first = initProject({ target, shipPath: 'dry-run' });
    for (const rel of ['.claude/settings.json', '.claude/skills/aidlc-loop/SKILL.md', '.claude/skills/aidlc-loop/card-loop.md', '.claude/agents/verifier.md', '.claude/skills/tdd/SKILL.md', '.claude/skills/diagnose/SKILL.md', '.claude/skills/grilling/SKILL.md', '.claude/skills/merge-conflicts/SKILL.md', 'docs/LESSONS.md', 'docs/THIRD-PARTY-NOTICES.md', '.github/workflows/security-scanners.yml', 'REVIEW.md', 'bands.yaml', 'intent/_TEMPLATE.md', 'specs/README.md', 'plans/_TEMPLATE.md', 'specs/tasks/_TEMPLATE.md', 'evals/example-regression.json', '.github/workflows/agent-evals.yml', 'aidlc.config.json', 'aidlc.ops.example.json', 'docs/DELIVERY-OPS.md', 'CLAUDE.md', '.gitignore']) {
      assert.ok(existsSync(path.join(target, rel)), `${rel} not created`);
    }
    assert.ok(first.created.length >= 25);
    const cfg = loadProjectConfig(target);
    assert.equal(cfg.found, true);
    assert.equal(cfg.config.shipPath, 'dry-run');
    assert.equal(cfg.config.cardsDir, 'specs/tasks');
    assert.match(readFileSync(path.join(target, '.gitignore'), 'utf8'), /\.aidlc\//);
    assert.match(readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), /## AI-native SDLC \(aidlc\)/);
    const gitignore = readFileSync(path.join(target, '.gitignore'), 'utf8');
    assert.equal(gitignore, `${HEADER}
.aidlc/
_local/
.review/
`, 'T0-INIT-REVIEW-IGNORE acceptance 1: the three entries once each, in this order');
    const second = initProject({ target, shipPath: 'dry-run' });
    assert.equal(readFileSync(path.join(target, '.gitignore'), 'utf8'), gitignore, 'a second init leaves .gitignore byte-identical');
    assert.equal(second.created.length, 0, 'second init must not create files');
    assert.ok(second.skipped.length >= 25);
    assert.ok(!second.merged.includes('.gitignore'), '.gitignore entries are not duplicated');
    assert.ok(second.skipped.includes('CLAUDE.md (section present)'));
  });

  test('merges an existing settings.json (hooks + deny) and appends to an existing CLAUDE.md', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'aidlc-init-'));
    dirs.push(target);
    mkdirSync(path.join(target, '.claude'), { recursive: true });
    writeFileSync(path.join(target, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Read(./secret.txt)'], allow: ['Bash(git *)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-existing-gate' }, { type: 'command', command: 'npx --no-install aidlc hook production-gate' }] }] } }));
    writeFileSync(path.join(target, 'CLAUDE.md'), '# my project\n\n## Commands\n- make test\n');
    const report = initProject({ target, cardsDir: 'cards' });
    assert.ok(report.merged.includes('.claude/settings.json'));
    assert.ok(report.merged.includes('CLAUDE.md'));
    const settings = JSON.parse(readFileSync(path.join(target, '.claude', 'settings.json'), 'utf8')) as { permissions: { deny: string[]; allow: string[] }; hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>> };
    assert.ok(settings.permissions.deny.includes('Read(./secret.txt)'));
    assert.ok(settings.permissions.deny.some((d) => d.includes('.env')));
    assert.deepEqual(settings.permissions.allow, ['Bash(git *)']);
    const pre = settings.hooks['PreToolUse']!;
    const all = pre.flatMap((h) => h.hooks.map((x) => x.command));
    assert.ok(all.includes('my-existing-gate'), 'foreign hook must survive the merge');
    assert.equal(all.filter((c) => /aidlc hook auto$/.test(c)).length, 1, `dispatcher wired once: ${all.join(', ')}`);
    assert.ok(!all.some((c) => /aidlc hook production-gate$/.test(c)), 'legacy per-guard hook must be replaced by the dispatcher');
    const claude = readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /^# my project/);
    assert.match(claude, /## AI-native SDLC \(aidlc\)/);
    assert.ok(existsSync(path.join(target, 'cards', '_TEMPLATE.md')));
    assert.equal(loadProjectConfig(target).config.cardsDir, 'cards');
  });

  test('dry run reports without writing', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'aidlc-init-'));
    dirs.push(target);
    const report = initProject({ target, dryRun: true });
    assert.ok(report.created.length > 0);
    assert.ok(!existsSync(path.join(target, 'REVIEW.md')));
  });
});

describe('T0-INIT-REVIEW-IGNORE: init ignores .review/', () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  /** Writes `before` as the target's .gitignore, runs init twice, returns the file after each run and the merged lists. */
  function upgrade(before: string): { first: string; second: string; merged1: string[]; merged2: string[] } {
    const target = mkdtempSync(path.join(tmpdir(), 'aidlc-init-gi-'));
    dirs.push(target);
    const gi = path.join(target, '.gitignore');
    writeFileSync(gi, before);
    const r1 = initProject({ target, shipPath: 'dry-run' });
    const first = readFileSync(gi, 'utf8');
    const r2 = initProject({ target, shipPath: 'dry-run' });
    return { first, second: readFileSync(gi, 'utf8'), merged1: r1.merged, merged2: r2.merged };
  }

  test('acceptance 2: a .gitignore an earlier init wrote gains one .review/ line and keeps the rest; a further run leaves it byte-identical [R1]', () => {
    const cases: Array<[string, string, string]> = [
      ['trailing newline', `node_modules/\n${HEADER}\n.aidlc/\n_local/\n`, `node_modules/\n${HEADER}\n.aidlc/\n_local/\n${HEADER}\n.review/\n`],
      ['no trailing newline', `node_modules/\n${HEADER}\n.aidlc/\n_local/`, `node_modules/\n${HEADER}\n.aidlc/\n_local/\n${HEADER}\n.review/\n`],
      ['CRLF', `node_modules/\r\n${HEADER}\r\n.aidlc/\r\n_local/\r\n`, `node_modules/\r\n${HEADER}\r\n.aidlc/\r\n_local/\n${HEADER}\n.review/\n`],
    ];
    for (const [name, before, expected] of cases) {
      const r = upgrade(before);
      assert.equal(r.first, expected, `${name}: one .review/ line appended, user line, .aidlc/ and _local/ kept once`);
      assert.ok(r.merged1.includes('.gitignore'), `${name}: the upgrade reports .gitignore as merged`);
      assert.equal(r.second, expected, `${name}: a further run leaves .gitignore byte-identical`);
      assert.ok(!r.merged2.includes('.gitignore'), `${name}: a further run does not report .gitignore as merged`);
    }
  });

  test('acceptance 2: a .gitignore that lists every entry, .review without the slash, is left byte-identical and not merged [R1]', () => {
    for (const before of ['.aidlc/\n_local/\n.review\n', '.aidlc/\r\n_local/\r\n.review\r\n', '.aidlc\n_local\n.review']) {
      const r = upgrade(before);
      assert.equal(r.first, before, `${JSON.stringify(before)} unchanged`);
      assert.ok(!r.merged1.includes('.gitignore'), `${JSON.stringify(before)} not reported as merged`);
      assert.equal(r.second, before);
    }
  });

  test('acceptance 3: a linked worktree of a committed init repository stays clean with review files under .review/ [R2]', { skip: !GIT_OK && 'git is not available' }, () => {
    const base = mkdtempSync(path.join(tmpdir(), 'aidlc-init-git-'));
    dirs.push(base);
    // The test's own git configuration only: no global or system file of the developer is read.
    const emptyGlobal = path.join(base, 'empty.gitconfig');
    writeFileSync(emptyGlobal, '');
    const saved = { global: process.env['GIT_CONFIG_GLOBAL'], nosystem: process.env['GIT_CONFIG_NOSYSTEM'] };
    process.env['GIT_CONFIG_GLOBAL'] = emptyGlobal;
    process.env['GIT_CONFIG_NOSYSTEM'] = '1';
    try {
      const repo = path.join(base, 'repo');
      mkdirSync(repo);
      const git = (cwd: string, ...args: string[]) => {
        const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
        assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
      };
      git(repo, 'init', '-q');
      git(repo, 'config', 'user.name', 'aidlc test');
      git(repo, 'config', 'user.email', 'aidlc-test@example.invalid');
      initProject({ target: repo, shipPath: 'dry-run' });
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'init');
      const worktree = path.join(base, 'wt');
      git(repo, 'worktree', 'add', '-q', '-b', 'T1-X', worktree);
      const files = ['T1-X.json', 'T1-X.pre.0.1.1.r1.json', 'T1-X.pre.0.1.1.r1.log', 'verdict.schema.json'];
      mkdirSync(path.join(worktree, '.review'));
      for (const f of files) writeFileSync(path.join(worktree, '.review', f), '{}\n');
      for (const f of files) assert.ok(existsSync(path.join(worktree, '.review', f)), `${f} exists`);
      assert.deepEqual(new GitProbe().status(worktree), { dirty: false, entries: [], untracked: [] });
    } finally {
      for (const [key, value] of [['GIT_CONFIG_GLOBAL', saved.global], ['GIT_CONFIG_NOSYSTEM', saved.nosystem]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  /** The Setup list sentence and its sentence on `.review/`, then the upgrade paragraph, one sentence each. */
  const SETUP = [
    '`init` copies `templates/` into the repository: `.claude/skills/aidlc-loop/*`, `.claude/skills/secure-api-review`, `.claude/skills/{tdd,diagnose,grilling,merge-conflicts}` (companion skills), `.claude/agents/*`, a merged `.claude/settings.json`, `REVIEW.md`, `bands.yaml`, `intent/`, `specs/README.md` and `specs/_SPEC-TEMPLATE.md`, `plans/`, `<cardsDir>/_TEMPLATE.md`, `evals/`, `.github/workflows/agent-evals.yml`, `aidlc-ci.yml` and `security-scanners.yml`, `docs/DELIVERY-OPS.md`, `docs/LESSONS.md`, `docs/THIRD-PARTY-NOTICES.md`, `aidlc.config.json`, `aidlc.ops.example.json`, an appended `## AI-native SDLC (aidlc)` section in `CLAUDE.md`, and `.aidlc/`, `_local/` and `.review/` in `.gitignore`.',
    '`.review/` holds what R2 and R3 write into the review checkout (the card worktree, or the main checkout for a run without one): verdicts, logs, failure markers, reservations and the verdict schema, files that would otherwise stay untracked and make the next review refuse that checkout as dirty.',
  ];
  const UPGRADE = [
    'An existing repository takes the `.review/` entry (card T0-INIT-REVIEW-IGNORE) by running `aidlc init` again, which appends only the missing `.review/` entry to `.gitignore`, and then committing and pushing `.gitignore` on the base branch.',
    "A card worktree created before that commit keeps its old `.gitignore` until it merges the base; meanwhile a `.review/` line in the main checkout's `.git/info/exclude`, which every linked worktree reads, covers it.",
  ];
  /** Every pinned doc sentence `doc` lacks: the Setup sentences adjacent inside `## Setup`, the upgrade paragraph whole inside its section. */
  function missingDoc(doc: string): string[] {
    const setupStart = doc.indexOf('\n## Setup\n');
    const setup = setupStart < 0 ? '' : doc.slice(setupStart, doc.indexOf('\n## ', setupStart + 1));
    const upgradeStart = doc.indexOf('\n## Upgrading a downstream repository\n');
    const upgrade = upgradeStart < 0 ? '' : doc.slice(upgradeStart);
    const missing = [...SETUP.filter((s) => !setup.includes(s)), ...UPGRADE.filter((s) => !upgrade.includes(s))];
    if (!missing.length && !setup.includes(SETUP.join(' '))) missing.push('Setup sentences not adjacent');
    if (!missing.length && !upgrade.includes(`\n\n${UPGRADE.join(' ')}\n`)) missing.push('upgrade paragraph not whole');
    return missing;
  }

  test('acceptance 4: docs/OPERATIONS.md carries the Setup sentences and the upgrade paragraph, and fails with any one removed [R3]', () => {
    const doc = readFileSync(path.join(ROOT, 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
    assert.deepEqual(missingDoc(doc), []);
    for (const s of [...SETUP, ...UPGRADE]) assert.notDeepEqual(missingDoc(doc.replace(s, '')), [], `removing "${s.slice(0, 60)}" is caught`);
  });

  const CHANGELOG_ENTRY =
    "- T0-INIT-REVIEW-IGNORE (bugfix): `aidlc init` adds `.review/` to the target's `.gitignore` beside `.aidlc/` and `_local/`, appending only the entries the file lacks (an entry with or without its trailing slash counts as present), so the verdicts and logs R2 and R3 write under `.review/` in a card worktree no longer stay untracked and make the next review refuse with `the review checkout ... has uncommitted or untracked changes (?? .review/...)`. An existing repository runs `aidlc init` again and commits and pushes `.gitignore` on the base branch; a card worktree created before that commit is covered meanwhile by a `.review/` line in the main checkout's `.git/info/exclude`.";

  /** Whether the Unreleased section of `changelog` carries the entry as one line. */
  function hasChangelogEntry(changelog: string): boolean {
    const start = changelog.indexOf('\n## Unreleased\n');
    if (start < 0) return false;
    const end = changelog.indexOf('\n## ', start + 1);
    return changelog.slice(start, end < 0 ? undefined : end).split('\n').includes(CHANGELOG_ENTRY);
  }

  test('acceptance 5: the CHANGELOG Unreleased section carries the T0-INIT-REVIEW-IGNORE entry, and fails with it removed [R4]', () => {
    const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(hasChangelogEntry(changelog), true);
    assert.equal(hasChangelogEntry(changelog.replace(CHANGELOG_ENTRY, '')), false);
  });
});
