// Card T1-HOOK-WIRING-LOCAL: the hookCommand line of `aidlc doctor` reads the dispatcher of .claude/settings.local.json too.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hookWiringReport } from '../../src/probes/hook-wiring.ts';
import { tmpDir } from '../infra/helpers.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const RELATIVE = 'node bin/aidlc-hook.js';
const RELATIVE_FILE = 'bin/aidlc-hook.js';
const ABSOLUTE_FILE = 'with space/bin/aidlc-hook.js';
const absolute = (target: string): string => `node "${target.replace(/\\/g, '/')}/${ABSOLUTE_FILE}"`;
const failed = (command: string): string => `FAILED: every guard is off until this command runs: ${command}`;

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = tmpDir('aidlc-hook-local-');
  dirs.push(dir);
  return dir;
}

/** The settings text that wires `command` on `event`. */
const wiring = (command: unknown, event = 'PreToolUse'): string => JSON.stringify({ hooks: { [event]: [{ hooks: [{ type: 'command', command }] }] } });

function writeSettings(target: string, name: 'settings.json' | 'settings.local.json', text: string): void {
  mkdirSync(path.join(target, '.claude'), { recursive: true });
  writeFileSync(path.join(target, '.claude', name), text);
}

function writeFileIn(target: string, rel: string, text = ''): void {
  mkdirSync(path.dirname(path.join(target, rel)), { recursive: true });
  writeFileSync(path.join(target, rel), text);
}

describe('T1-HOOK-WIRING-LOCAL', () => {
  test('T1-HOOK-WIRING-LOCAL acceptance 1: a dispatcher wired only in settings.local.json is reported ok with its file present and FAILED with it missing or a directory [R1] [R2]', () => {
    const spellings: Array<[string, (target: string) => string]> = [[ABSOLUTE_FILE, absolute], [RELATIVE_FILE, () => RELATIVE]];
    for (const [file, command] of spellings) {
      const present = tempDir();
      writeFileIn(present, file);
      writeSettings(present, 'settings.local.json', wiring(command(present)));
      assert.equal(hookWiringReport(present), `ok: ${command(present)}`);
      const missing = tempDir();
      writeSettings(missing, 'settings.local.json', wiring(command(missing)));
      assert.equal(hookWiringReport(missing), failed(command(missing)));
      const directory = tempDir();
      mkdirSync(path.join(directory, file), { recursive: true });
      writeSettings(directory, 'settings.local.json', wiring(command(directory)));
      assert.equal(hookWiringReport(directory), failed(command(directory)));
    }
  });

  describe('T1-HOOK-WIRING-LOCAL acceptance 2: with a dispatcher in each file the first whose file exists is reported, the shared one first [R1] [R2]', () => {
    // The shared file wires the relative spelling, the local file the absolute one.
    const rows: Array<[string, boolean, boolean, (target: string) => string]> = [
      ['both files present', true, true, () => `ok: ${RELATIVE}`],
      ['only the local one present', false, true, (target) => `ok: ${absolute(target)}`],
      ['only the shared one present', true, false, () => `ok: ${RELATIVE}`],
      ['neither present', false, false, () => failed(RELATIVE)],
    ];
    for (const [name, shared, local, expected] of rows) {
      test(name, () => {
        const target = tempDir();
        writeSettings(target, 'settings.json', wiring(RELATIVE));
        writeSettings(target, 'settings.local.json', wiring(absolute(target)));
        if (shared) writeFileIn(target, RELATIVE_FILE);
        if (local) writeFileIn(target, ABSOLUTE_FILE);
        assert.equal(hookWiringReport(target), expected(target));
      });
    }
  });

  describe('T1-HOOK-WIRING-LOCAL acceptance 3: a settings.local.json that gives no candidate changes nothing [R1] [R2]', () => {
    const local = (text: string) => (target: string): void => writeSettings(target, 'settings.local.json', text);
    const forms: Array<[string, (target: string) => void]> = [
      ['absent', () => {}],
      ['a directory in its place', (target) => void mkdirSync(path.join(target, '.claude', 'settings.local.json'), { recursive: true })],
      ['text that is not JSON', local('{ not json')],
      ['{}', local('{}')],
      ['hooks without PreToolUse', local('{"hooks":{}}')],
      ['a hook command that is an array', local(wiring([RELATIVE]))],
      ['a hook command that is a number', local(wiring(5))],
      ['a hook command that is null', local(wiring(null))],
      ['a foreign command', local(wiring('gate-a'))],
      ['an absolute dispatcher with & in its path', (target) => {
        writeFileIn(target, 'x&y/bin/aidlc-hook.js');
        local(wiring(`node "${target.replace(/\\/g, '/')}/x&y/bin/aidlc-hook.js"`))(target);
      }],
      ['a dispatcher under Stop only', (target) => {
        writeFileIn(target, ABSOLUTE_FILE);
        local(wiring(absolute(target), 'Stop'))(target);
      }],
    ];
    for (const [name, write] of forms) {
      test(name, () => {
        const alone = tempDir();
        write(alone);
        assert.equal(hookWiringReport(alone), 'not wired');
        const beside = tempDir();
        writeSettings(beside, 'settings.json', wiring(RELATIVE));
        writeFileIn(beside, RELATIVE_FILE);
        write(beside);
        assert.equal(hookWiringReport(beside), `ok: ${RELATIVE}`);
      });
    }
  });

  test('T1-HOOK-WIRING-LOCAL acceptance 4: the file a local dispatcher names is not run [R2] [R3]', () => {
    const target = tempDir();
    const marker = path.join(target, 'ran.marker');
    writeFileIn(target, ABSOLUTE_FILE, `require('fs').mkdirSync(${JSON.stringify(marker)});`);
    writeSettings(target, 'settings.local.json', wiring(absolute(target)));
    assert.equal(hookWiringReport(target), `ok: ${absolute(target)}`);
    assert.equal(existsSync(marker), false);
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) if (!/^(GIT_|NODE_|AIDLC_)/.test(key.toUpperCase())) env[key] = value;
    env['GIT_CEILING_DIRECTORIES'] = [path.dirname(target), path.dirname(realpathSync.native(target))].join(path.delimiter);
    env['AIDLC_STATE_DIR'] = path.join(target, 'state');
    env['AIDLC_SESSION'] = 'hook-wiring-local';
    // child (R1, the output bin/aidlc.js prints): this case reads the hookCommand line printed through bin/aidlc.js.
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'aidlc.js'), 'doctor', '--json'], { cwd: target, env, encoding: 'utf8', timeout: 120_000, windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    assert.equal((JSON.parse(r.stdout) as { hookCommand: string }).hookCommand, `ok: ${absolute(target)}`);
    assert.equal(existsSync(marker), false);
  });
});
