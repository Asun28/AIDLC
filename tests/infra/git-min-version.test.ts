// Card T1-GIT-MIN-VERSION: the git line of `aidlc doctor` marks a version older than 2.45.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gitVersionLine } from '../../src/probes/git.ts';
import { tmpDir } from './helpers.ts';

const repo = path.resolve(import.meta.dirname, '..', '..');

test('T1-GIT-MIN-VERSION acceptance 1: gitVersionLine keeps a version of 2.45 or newer, marks an older one and names a line with no version [R1]', () => {
  const rows: Array<[string | undefined, string]> = [
    [undefined, 'MISSING'],
    ['git version 2.56.0.windows.4', 'git version 2.56.0.windows.4'],
    ['git version 2.45.0', 'git version 2.45.0'],
    ['git version 2.100.1', 'git version 2.100.1'],
    ['git version 3.0.0', 'git version 3.0.0'],
    ['git version 2.44.2', 'git version 2.44.2 (UNSUPPORTED: aidlc needs git 2.45 or newer)'],
    ['git version 2.39.5 (Apple Git-154)', 'git version 2.39.5 (Apple Git-154) (UNSUPPORTED: aidlc needs git 2.45 or newer)'],
    ['git version 2.5.0', 'git version 2.5.0 (UNSUPPORTED: aidlc needs git 2.45 or newer)'],
    ['git version 1.99.0', 'git version 1.99.0 (UNSUPPORTED: aidlc needs git 2.45 or newer)'],
    ['', 'UNREADABLE: "" names no git version; aidlc needs git 2.45 or newer'],
    ['hub version 2.14.2', 'UNREADABLE: "hub version 2.14.2" names no git version; aidlc needs git 2.45 or newer'],
    ['git version 2', 'UNREADABLE: "git version 2" names no git version; aidlc needs git 2.45 or newer'],
  ];
  for (const [firstLine, value] of rows) assert.equal(gitVersionLine(firstLine), value, String(firstLine));
});

// A `git.cmd` first on PATH is not run by a spawn of `git` without a shell on Windows, so this case needs a POSIX host.
test('T1-GIT-MIN-VERSION acceptance 2: aidlc doctor --json prints the marked git line second, after node, and exits 0 when git reports 2.43.0 [R2]', { skip: process.platform === 'win32' ? 'needs a POSIX host' : false }, () => {
  const dir = realpathSync.native(tmpDir('aidlc-git-min-'));
  const shim = path.join(dir, 'shim');
  const target = path.join(dir, 'target');
  for (const d of [shim, target, path.join(dir, 'state')]) mkdirSync(d);
  const git = path.join(shim, 'git');
  writeFileSync(git, `#!/bin/sh
if [ "$1" = --version ]; then echo 'git version 2.43.0'; exit 0; fi
PATH="$AIDLC_TEST_REAL_PATH"
export PATH
exec git "$@"
`);
  chmodSync(git, 0o755);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(GIT_|NODE_|AIDLC_)/.test(key.toUpperCase())) env[key] = value;
  env['GIT_CEILING_DIRECTORIES'] = dir;
  env['AIDLC_STATE_DIR'] = path.join(dir, 'state');
  env['AIDLC_SESSION'] = 'git-min-version';
  env['AIDLC_TEST_REAL_PATH'] = env['PATH'];
  env['PATH'] = [shim, env['PATH']].join(path.delimiter);
  // child (R1, the output bin/aidlc.js prints): this case reads the git line printed through bin/aidlc.js with a substitute git on PATH.
  const r = spawnSync(process.execPath, [path.join(repo, 'bin', 'aidlc.js'), 'doctor', '--json'], { cwd: target, env, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  const checks = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(checks['git'], 'git version 2.43.0 (UNSUPPORTED: aidlc needs git 2.45 or newer)');
  assert.deepEqual(Object.keys(checks).slice(0, 3), ['node', 'git', 'gh']);
});
