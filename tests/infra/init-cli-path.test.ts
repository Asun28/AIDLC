// Card T0-INIT-CLI-PATH (issue 451): `aidlc init` says what to run when `aidlc` is not on PATH, and so do the skill and the CLAUDE.md section.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aidlcOnPath, initCli, initNextLine } from '../../src/scaffold/init.ts';
import { cleanup, tmpDir } from './helpers.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const dirs: string[] = [];
after(() => {
  for (const d of dirs) cleanup(d);
});

/** An `isFile` that holds exactly `files` and records every path it is asked about. */
function fakeFs(files: string[], noCase = false): { isFile: (p: string) => boolean; asked: string[] } {
  const asked: string[] = [];
  const fold = (p: string) => (noCase ? p.toLowerCase() : p);
  return { asked, isFile: (p: string) => (asked.push(p), files.map(fold).includes(fold(p))) };
}
/** `fakeFs` comparing names without case, as a Windows file system does. */
const winFs = (files: string[]) => fakeFs(files, true);

describe('T0-INIT-CLI-PATH: aidlcOnPath', () => {
  test('acceptance 1: win32 reads Path and PATHEXT without case, finds aidlc with a PATHEXT extension in a later or quoted entry, and no bare aidlc [R1] [R2]', () => {
    for (const name of ['aidlc.cmd', 'AIDLC.CMD', 'aidlc.exe']) {
      const fs = winFs([`C:\\two\\${name}`]);
      assert.equal(aidlcOnPath({ Path: 'C:\\one;C:\\two' }, 'win32', fs.isFile), true, name);
    }
    assert.equal(aidlcOnPath({ Path: 'C:\\one;C:\\two' }, 'win32', winFs(['C:\\two\\aidlc']).isFile), false, 'a bare aidlc is not a Windows command');
    assert.equal(aidlcOnPath({ Path: 'C:\\two' }, 'win32', winFs(['C:\\two\\aidlc.ps1']).isFile), false, '.ps1 is not in the default PATHEXT');
    assert.equal(aidlcOnPath({ Path: 'C:\\two', pathext: '.EXE;.PS1' }, 'win32', winFs(['C:\\two\\aidlc.ps1']).isFile), true, 'PATHEXT read without case');
    assert.equal(aidlcOnPath({ Path: 'C:\\two', PATHEXT: '.EXE' }, 'win32', winFs(['C:\\two\\aidlc.cmd']).isFile), false, 'PATHEXT replaces the default list');
    assert.equal(aidlcOnPath({ PATH: '"C:\\Program Files\\npm"' }, 'win32', winFs(['C:\\Program Files\\npm\\aidlc.cmd']).isFile), true, 'a quoted entry');
  });

  test('acceptance 1: elsewhere PATH is split by colon and only a file named aidlc counts [R1] [R2]', () => {
    assert.equal(aidlcOnPath({ PATH: '/usr/bin:/home/u/.npm/bin' }, 'linux', fakeFs(['/home/u/.npm/bin/aidlc']).isFile), true);
    assert.equal(aidlcOnPath({ PATH: '/usr/bin:/home/u/.npm/bin' }, 'linux', fakeFs(['/home/u/.npm/bin/aidlc.cmd']).isFile), false);
    assert.equal(aidlcOnPath({ Path: '/home/u/.npm/bin' }, 'linux', fakeFs(['/home/u/.npm/bin/aidlc']).isFile), false, 'the key is PATH exactly off Windows');
  });

  test('acceptance 1: an absent, empty or all-empty PATH gives false and asks about no relative path [R2]', () => {
    for (const [env, platform] of [[{}, 'linux'], [{}, 'win32'], [{ PATH: '' }, 'linux'], [{ Path: '' }, 'win32'], [{ PATH: '::' }, 'linux'], [{ PATH: ';;' }, 'win32'], [{ PATH: '""' }, 'win32']] as const) {
      const fs = fakeFs(['aidlc', 'aidlc.cmd', 'aidlc.CMD']);
      assert.equal(aidlcOnPath(env, platform, fs.isFile), false, `${platform} ${JSON.stringify(env)}`);
      assert.deepEqual(fs.asked.filter((p) => !path.win32.isAbsolute(p) && !path.posix.isAbsolute(p)), [], `${platform} ${JSON.stringify(env)} asks only absolute paths`);
    }
  });
});

describe('T0-INIT-CLI-PATH: initCli', () => {
  test('acceptance 2: the command is aidlc when it is on PATH, else the node form with the npm link note [R3]', () => {
    assert.deepEqual(initCli('C:\\x\\aidlc\\bin\\aidlc.js', true), { onPath: true, command: 'aidlc' });
    assert.deepEqual(initCli('C:\\x\\aidlc\\bin\\aidlc.js', false), {
      onPath: false,
      command: 'node "C:/x/aidlc/bin/aidlc.js"',
      note: 'aidlc is not on PATH: run each aidlc command as node "C:/x/aidlc/bin/aidlc.js" <command>, or run npm link in "C:/x/aidlc" to put aidlc on PATH',
    });
    assert.deepEqual(initCli('/opt/aidlc/bin/aidlc.js', false), {
      onPath: false,
      command: 'node "/opt/aidlc/bin/aidlc.js"',
      note: 'aidlc is not on PATH: run each aidlc command as node "/opt/aidlc/bin/aidlc.js" <command>, or run npm link in "/opt/aidlc" to put aidlc on PATH',
    });
    assert.deepEqual(initCli('C:\\Program Files (x86)\\a b\\bin\\aidlc.js', false), {
      onPath: false,
      command: 'node "C:/Program Files (x86)/a b/bin/aidlc.js"',
      note: 'aidlc is not on PATH: run each aidlc command as node "C:/Program Files (x86)/a b/bin/aidlc.js" <command>, or run npm link in "C:/Program Files (x86)/a b" to put aidlc on PATH',
    });
  });

  test('acceptance 6: a CLI path with $, a backtick, % or a double quote gets a plain-text note and no command; the next line drops the backticks only then [R3] [R4]', () => {
    for (const ch of ['$', '`', '%', '"']) {
      for (const [entry, checkout] of [[`C:\\x${ch}y\\aidlc\\bin\\aidlc.js`, `C:/x${ch}y/aidlc`], [`/opt/x${ch}y/bin/aidlc.js`, `/opt/x${ch}y`]] as const) {
        const cli = initCli(entry, false);
        assert.deepEqual(cli, {
          onPath: false,
          note: `aidlc is not on PATH, and the path of this CLI holds $, a backtick, % or a double quote, which a shell can expand or end a quote at, so no command is printed: run node with bin/aidlc.js under the aidlc checkout at ${checkout}, quoted for your shell, or run npm link in that checkout to put aidlc on PATH`,
        }, entry);
        assert.ok(!Object.hasOwn(cli, 'command'), `${entry}: no command key`);
        assert.equal(initNextLine(cli), 'next: review aidlc.config.json, then run doctor through node as the line above says', entry);
        assert.ok(!initNextLine(cli).includes('`'), `${entry}: the next line holds no backtick`);
        assert.deepEqual(initCli(entry, true), { onPath: true, command: 'aidlc' }, `${entry} on PATH`);
      }
    }
    assert.equal(initNextLine(initCli('/opt/aidlc/bin/aidlc.js', true)), 'next: review aidlc.config.json, then `aidlc doctor`');
    assert.equal(initNextLine(initCli('/opt/aidlc/bin/aidlc.js', false)), 'next: review aidlc.config.json, then `node "/opt/aidlc/bin/aidlc.js" doctor`');
  });
});

describe('T0-INIT-CLI-PATH: the init report', () => {
  /** `node src/cli/main.ts init <dir> --json` with PATH, under any case of its key, replaced by `pathDir`. */
  function initWithPath(pathDir: string): Record<string, unknown> {
    const env: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(process.env)) if (k.toUpperCase() !== 'PATH') env[k] = v;
    env['PATH'] = pathDir;
    const target = tmpDir('aidlc-init-cli-');
    dirs.push(target);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli', 'main.ts'), 'init', target, '--json'], { encoding: 'utf8', env, windowsHide: true, timeout: 120_000 });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout) as Record<string, unknown>;
  }

  test('acceptance 3: with no aidlc on PATH the report carries the node command; with one it carries aidlc [R4]', () => {
    const empty = tmpDir('aidlc-path-empty-');
    dirs.push(empty);
    assert.deepEqual(initWithPath(empty)['cli'], initCli(path.join(ROOT, 'bin', 'aidlc.js'), false));
    const linked = tmpDir('aidlc-path-linked-');
    dirs.push(linked);
    writeFileSync(path.join(linked, process.platform === 'win32' ? 'aidlc.cmd' : 'aidlc'), '');
    assert.deepEqual(initWithPath(linked)['cli'], { onPath: true, command: 'aidlc' });
  });
});

describe('T0-INIT-CLI-PATH: the skill and the CLAUDE.md section', () => {
  const SENTENCE = 'No `aidlc` on PATH => `node <aidlc checkout>/bin/aidlc.js` instead.';
  const LINE = '- No `aidlc` on PATH: run `node <aidlc checkout>/bin/aidlc.js` in its place, or `npm link` in that checkout; `aidlc init` prints the path.';

  test('acceptance 4: entry check 1 of both identical SKILL.md copies says what to run in place of aidlc, within the cap [R5]', () => {
    const live = readFileSync(path.join(ROOT, '.claude', 'skills', 'aidlc-loop', 'SKILL.md'));
    const template = readFileSync(path.join(ROOT, 'templates', 'claude', 'skills', 'aidlc-loop', 'SKILL.md'));
    assert.ok(live.equals(template), 'both SKILL.md copies are identical');
    assert.ok(template.every((b) => b < 0x80), 'SKILL.md is ASCII');
    assert.ok(template.length <= 4500, `SKILL.md is ${template.length} bytes, cap 4500`);
    const text = template.toString('utf8');
    const entry1 = text.slice(text.indexOf('\n1. `aidlc doctor`'), text.indexOf('\n2. ')).replace(/\s+/g, ' ');
    assert.ok(entry1.includes(SENTENCE), `entry check 1 holds: ${SENTENCE}`);
  });

  test('acceptance 4: both CLAUDE.md copies end the Commands list with the fallback line [R6]', () => {
    for (const file of ['CLAUDE.md', 'templates/CLAUDE.aidlc.md']) {
      const text = read(file);
      const from = text.indexOf('### Commands\n');
      const to = text.indexOf('\n\n', from);
      assert.ok(from >= 0 && to > from, `${file} has a Commands list`);
      const items = text.slice(from, to).split('\n').slice(1);
      assert.equal(items.at(-1), LINE, `${file}: the last Commands item`);
    }
  });
});
