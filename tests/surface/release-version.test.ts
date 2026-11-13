// Card T0-RELEASE-0-2-0: CHANGELOG.md holds the release section 0.2.0 between Unreleased and 0.1.0, and the version of package.json
// stands in every place that carries it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { cleanup, tmpDir } from '../infra/helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const VERSION = '0.2.0';
const DATE = '2026-11-14';
const ENTRY =
  "- T0-RELEASE-0-2-0 (audit item H12): release section 0.2.0, dated 2026-11-14. Every entry written since release 0.1.0 stands under it, and a new entry goes under the Unreleased heading above it, as before. The version is 0.2.0 in `package.json`, `package-lock.json`, the output of `aidlc --version`, the `aidlc` member of the host a manifest is sealed with, and README.md; no tag was created and nothing was published. The 69 test files that cut the changelog at the heading after Unreleased now read it with `changelogSince010` (`tests/infra/changelog.ts`), from the Unreleased heading down to the heading of release 0.1.0, so an entry stays pinned when a release heading is put above it. `tests/surface/release-version.test.ts` pins the section and requires the same version in the five places.";

const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const temps: string[] = [];
after(() => {
  for (const dir of temps) cleanup(dir);
});

test('CHANGELOG.md holds the release section between Unreleased and 0.1.0', () => {
  const lines = read('CHANGELOG.md').split('\n');
  const headings = lines.filter((line) => line.startsWith('## '));
  assert.deepEqual(headings, ['## Unreleased', `## ${VERSION} - ${DATE}`, '## 0.1.0 - 2026-09-11']);
  const from = lines.indexOf(`## ${VERSION} - ${DATE}`);
  const to = lines.indexOf('## 0.1.0 - 2026-09-11');
  const entries = lines.slice(from + 1, to).filter((line) => line.startsWith('- '));
  assert.equal(entries.length, 227, 'the release section holds every entry written since 0.1.0 and the entry of this card');
  assert.equal(entries[0], ENTRY, 'the entry of this card is the first of the release section');
  assert.ok(entries[1]?.startsWith('- T0-BENCH-DRAFTS-IGNORE-2 (replaces'), 'the newest entry before this card follows it');
  assert.ok(entries.at(-1)?.startsWith('- T0-LESSONS-TEST-RUN-ENV:'), 'the oldest entry since 0.1.0 is the last of the section');
});

test('the version of package.json stands in every place that carries it', () => {
  const pkg = JSON.parse(read('package.json')) as { version: string };
  assert.equal(pkg.version, VERSION);
  const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, { version?: string }> };
  assert.equal(lock.version, pkg.version, 'package-lock.json: version');
  assert.equal(lock.packages['']?.version, pkg.version, 'package-lock.json: packages[""].version');
  const readme = read('README.md').split('\n');
  assert.equal(readme.filter((line) => line === `Version ${pkg.version}.`).length, 1, 'README.md has one version line');
  assert.ok(!readme.includes('Version 0.1.0.'), 'README.md has no line Version 0.1.0.');
  const main = read('src/cli/main.ts');
  const count = (needle: string) => main.split(needle).length - 1;
  assert.equal(count(`.version('${pkg.version}')`), 1, 'src/cli/main.ts: the argument of .version(');
  assert.equal(count(`aidlc: '${pkg.version}'`), 1, 'src/cli/main.ts: the aidlc member of the manifest host');
  assert.equal(count("'0.1.0'"), 0, "src/cli/main.ts holds '0.1.0' nowhere");
});

test('aidlc --version prints the version', () => {
  const dir = tmpDir('aidlc-release-version-');
  temps.push(dir);
  const real = realpathSync.native(dir);
  const state = path.join(real, 'state');
  mkdirSync(state);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    const upper = k.toUpperCase();
    if (upper.startsWith('GIT_') || upper === 'NODE_OPTIONS') continue;
    env[k] = v;
  }
  env.GIT_CEILING_DIRECTORIES = [path.dirname(dir), path.dirname(real)].join(path.delimiter);
  env.AIDLC_STATE_DIR = state;
  env.AIDLC_SESSION = 'release-version-test';
  const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli', 'main.ts'), '--version'], { cwd: real, env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${VERSION}\n`);
});
