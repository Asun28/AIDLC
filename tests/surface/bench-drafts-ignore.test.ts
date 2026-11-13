// Card T0-BENCH-DRAFTS-IGNORE-2: git ignores the case files directly under evals/review and no directory there.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, tmpDir } from '../infra/helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RULE = '/evals/review/*.json';
const EXCEPT = '!/evals/review/*.json/';
const COMMENT = '# reviewer bench cases: a draft of aidlc review bench export stays local, and a confirmed case is committed with git add -f (evals/review/README.md)';
const ENTRY = '- T0-BENCH-DRAFTS-IGNORE-2 (replaces T0-BENCH-DRAFTS-IGNORE, audit item H5): `.gitignore` lists `/evals/review/*.json`, so plain `git status` no longer lists the unconfirmed drafts that `aidlc review bench export` writes into `evals/review/` (490 stood untracked on 2026-11-14); a second line excepts a directory of such a name, so nothing in a directory is hidden. A tracked case stays tracked, and a newly confirmed case is committed with `git add -f evals/review/<id>.json` (evals/review/README.md). `aidlc review bench run` loads every case file of the directory as before; the two lines change only what git lists.';

const gitignore = readFileSync(path.join(ROOT, '.gitignore'));
const temps: string[] = [];
after(() => {
  for (const dir of temps) cleanup(dir);
});

test('the root .gitignore carries the rule and its exception once, under the comment', () => {
  const text = gitignore.toString('utf8');
  const lines = text.split('\n');
  const at = lines.flatMap((line, i) => (line === RULE ? [i] : []));
  assert.equal(at.length, 1, 'exactly one line is the rule');
  assert.equal(lines.filter((line) => line === EXCEPT).length, 1, 'exactly one line is the exception');
  const i = at[0]!;
  assert.equal(lines[i + 1], EXCEPT);
  assert.equal(lines[i - 1], COMMENT);
  assert.equal(lines[i - 2], '');
  assert.deepEqual(lines.filter((line, j) => line.includes('evals') && j !== i && j !== i + 1 && j !== i - 1), []);
  assert.ok(text.endsWith(`${EXCEPT}\n`), 'the text ends with the exception and one line feed');
});

type Repo = { dir: string; git: (args: string[]) => ReturnType<typeof spawnSync<string>> };

/** A new repository in a temporary directory that holds a byte copy of the root .gitignore. Child environment: no GIT_ variable, no NODE_OPTIONS, an empty global configuration, ceilings above the fixture. */
function repo(): Repo {
  const dir = tmpDir('aidlc-drafts-ignore-');
  temps.push(dir);
  const cfgDir = tmpDir('aidlc-drafts-ignore-cfg-');
  temps.push(cfgDir);
  const config = path.join(cfgDir, 'gitconfig');
  writeFileSync(config, '');
  const inherited = Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !/^GIT_/i.test(e[0]) && e[0].toUpperCase() !== 'NODE_OPTIONS');
  const ceilings = [path.dirname(dir), path.dirname(realpathSync.native(dir))].join(path.delimiter);
  const env = { ...Object.fromEntries(inherited), GIT_CEILING_DIRECTORIES: ceilings, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', AIDLC_STATE_DIR: path.join(dir, '.no-state'), AIDLC_SESSION: 'bench-drafts-ignore' };
  const git = (args: string[]) => spawnSync('git', args, { cwd: dir, env, encoding: 'utf8', windowsHide: true });
  const init = git(['init', '--quiet']);
  assert.equal(init.status, 0, init.stderr);
  writeFileSync(path.join(dir, '.gitignore'), gitignore);
  return { dir, git };
}

test('git reads the rule as case files directly under evals/review and nothing else', () => {
  const { git } = repo();
  const n = gitignore.toString('utf8').split('\n').indexOf(RULE) + 1;
  const draft = 'evals/review/T0-X.g-20260101000000-abcdef.F1.json';
  const rows: Array<[string, number, string]> = [
    [draft, 0, n > 0 ? `.gitignore:${n}:${RULE}\t${draft}\n` : ''],
    ['evals/review/README.md', 1, ''],
    ['evals/review/sub/x.json', 1, ''],
    ['evals/x.json', 1, ''],
    ['evals/review/x.json.bak', 1, ''],
    ['sub/evals/review/x.json', 1, ''],
  ];
  for (const [file, status, stdout] of rows) {
    const r = git(['check-ignore', '-v', '--no-index', '--', file]);
    assert.equal(r.status, status, `${file}: exit code`);
    assert.equal(r.stdout, stdout, `${file}: output`);
  }
});

test('a directory named like a case file and the files in it are not ignored', () => {
  const { dir, git } = repo();
  mkdirSync(path.join(dir, 'evals', 'review', 'archive.json'), { recursive: true });
  for (const file of ['evals/review/draft.json', 'evals/review/archive.json/README.md', 'evals/review/archive.json/inner.json']) writeFileSync(path.join(dir, file), '{}\n');
  const r = git(['status', '--porcelain', '--untracked-files=all']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split('\n').filter((line) => line !== '').sort(), ['?? .gitignore', '?? evals/review/archive.json/README.md', '?? evals/review/archive.json/inner.json']);
});

test('CHANGELOG.md carries the entry above the 0.1.0 section', () => {
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const start = changelog.indexOf('## Unreleased');
  const end = changelog.indexOf('\n## 0.1.0 - 2026-09-11');
  assert.ok(start >= 0 && end > start);
  assert.ok(changelog.slice(start, end).split('\n').includes(ENTRY));
});
