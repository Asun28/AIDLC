// Card T1-SWEEP2-FLAGS acceptance 3: `aidlc security check` reports that no scanner is bound without naming a config binding that does not exist.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The package entry the card names; it runs the sources when no build is at least as new as them (`bin/resolve-entry.js`). */
const BIN = path.join(root, 'bin', 'aidlc.js');

const temps: string[] = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

test('T1-SWEEP2-FLAGS acceptance 3: `node bin/aidlc.js security check --json` exits 2 with NOT CONFIGURED and a detail that keeps "never a pass" and names no aidlc.config.json [R3]', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'aidlc-security-check-'));
  temps.push(cwd);
  const init = spawnSync('git', ['init', '-q'], { cwd, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'], AIDLC_STATE_DIR: path.join(cwd, 'state'), AIDLC_SESSION: 'security-check-test' };
  const r = spawnSync(process.execPath, [BIN, 'security', 'check', '--json'], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 2, r.stderr);
  const report = JSON.parse(r.stdout) as { status: string; detail: string };
  assert.deepEqual(report, {
    status: 'NOT CONFIGURED',
    detail: "aidlc binds no security scanner; run the project's own scanner or a CI security job; a missing scanner is never a pass",
  });
  assert.ok(report.detail.includes('never a pass'), 'a missing scanner is never a pass');
  assert.ok(!report.detail.includes('aidlc.config.json'), 'the detail names no aidlc.config.json binding');
});
