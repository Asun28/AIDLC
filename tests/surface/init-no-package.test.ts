import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_HOOK_CONFIG } from '../../src/hooks/index.ts';
import { hookWiringReport } from '../../src/probes/hook-wiring.ts';
import * as init from '../../src/scaffold/init.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK_ENTRY = path.join(root, 'bin', 'aidlc-hook.js');
const ABSOLUTE = `node "${HOOK_ENTRY.replace(/\\/g, '/')}"`;
const NPX = 'npx --no-install aidlc hook auto';
const LOCAL = 'node node_modules/aidlc/bin/aidlc-hook.js';
const OTHER_PATH = 'node "C:/elsewhere/aidlc/bin/aidlc-hook.js"';
const NEW_MATCHER = 'Bash|PowerShell|Edit|Write|MultiEdit';
const OLD_MATCHER = 'Bash|Edit|Write|MultiEdit';
const FOREIGN_A = { type: 'command', command: 'gate-a' };
const FOREIGN_B = { type: 'command', command: 'gate-b' };

type Hook = { type: string; command: string };
type Entry = { matcher?: string; hooks: Hook[] };

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-no-package-'));
  dirs.push(dir);
  return dir;
}

function settingsFile(target: string): string {
  return path.join(target, '.claude', 'settings.json');
}

function hooksOf(target: string): Record<string, Entry[]> {
  return (JSON.parse(readFileSync(settingsFile(target), 'utf8')) as { hooks: Record<string, Entry[]> }).hooks;
}

/** The commands of every hook entry; the three events are asserted so an empty list cannot pass. */
function commands(target: string): string[] {
  const hooks = hooksOf(target);
  assert.deepEqual(Object.keys(hooks), ['PreToolUse', 'Stop', 'UserPromptSubmit']);
  return Object.values(hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
}

function targetWithSettings(settings: unknown, target = tempDir()): string {
  mkdirSync(path.join(target, '.claude'));
  writeFileSync(settingsFile(target), typeof settings === 'string' ? settings : JSON.stringify(settings));
  return target;
}

function targetWithPackage(pkg: string): string {
  const target = tempDir();
  writeFileSync(path.join(target, 'package.json'), pkg);
  return target;
}

describe('T1-INIT-HOOK-PATH: the command init writes', () => {
  test('acceptance 1: with no package.json every hook entry gets the absolute node form, with forward slashes [R1]', () => {
    const target = tempDir();
    init.initProject({ target, hookEntry: HOOK_ENTRY });
    assert.deepEqual(commands(target), [ABSOLUTE, ABSOLUTE, ABSOLUTE]);
    assert.ok(!ABSOLUTE.includes('\\'), ABSOLUTE);
  });

  test('acceptance 1: a package.json that lists nothing or does not parse counts as no package [R1]', () => {
    for (const pkg of ['{ not json', 'null', '{"name":"other","dependencies":{"left-pad":"1"}}', '{"dependencies":"aidlc"}', '{"dependencies":["aidlc"],"devDependencies":5}', '{"devDependencies":null}']) {
      const target = targetWithPackage(pkg);
      init.initProject({ target, hookEntry: HOOK_ENTRY });
      assert.deepEqual(commands(target), [ABSOLUTE, ABSOLUTE, ABSOLUTE], pkg);
    }
  });

  test('acceptance 1: a package.json holding the key aidlc keeps the npx form, whatever its version [R1]', () => {
    for (const field of ['dependencies', 'devDependencies']) {
      for (const version of ['*', '']) {
        const target = targetWithPackage(JSON.stringify({ name: 'app', [field]: { aidlc: version } }));
        init.initProject({ target, hookEntry: HOOK_ENTRY });
        assert.deepEqual(commands(target), [NPX, NPX, NPX], `${field} ${JSON.stringify(version)}`);
      }
    }
  });

  test('acceptance 1: a local install keeps the direct node form, and the aidlc package its own [R1]', () => {
    const installed = tempDir();
    mkdirSync(path.join(installed, 'node_modules', 'aidlc', 'bin'), { recursive: true });
    writeFileSync(path.join(installed, 'node_modules', 'aidlc', 'bin', 'aidlc-hook.js'), '');
    init.initProject({ target: installed, hookEntry: HOOK_ENTRY });
    assert.deepEqual(commands(installed), [LOCAL, LOCAL, LOCAL]);

    const own = targetWithPackage('{"name":"aidlc"}');
    mkdirSync(path.join(own, 'bin'));
    writeFileSync(path.join(own, 'bin', 'aidlc-hook.js'), '');
    init.initProject({ target: own, hookEntry: HOOK_ENTRY });
    assert.deepEqual(commands(own), Array(3).fill('node bin/aidlc-hook.js'));
  });

  test('acceptance 3: with no hookEntry init writes the npx form [R2]', () => {
    const target = tempDir();
    init.initProject({ target });
    assert.deepEqual(commands(target), [NPX, NPX, NPX]);
  });
});

describe('T1-INIT-HOOK-PATH: a real hook process', () => {
  /** A target laid by the real CLI, so the path of the running CLI reaches the settings file. */
  function initialisedByCli(): string {
    const target = tempDir();
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'aidlc.js'), 'init', target, '--json'], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    return target;
  }

  function runWritten(target: string, command: string): { status: number | null; stderr: string } {
    const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: path.join(target, 'state') };
    delete env['RELEASE_APPROVAL'];
    delete env['AIDLC_RELEASE_APPROVAL'];
    const written = commands(target)[0]!;
    assert.equal(written, ABSOLUTE);
    const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: target });
    return spawnSync(written, { shell: true, input, cwd: target, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  }

  test('acceptance 2: the written command exits 2 on a production command with no approval [R1] [R2]', () => {
    const command = ['kubectl', 'apply', '-f', ['pr', 'od/'].join('')].join(' ');
    assert.ok(DEFAULT_HOOK_CONFIG.productionPatterns.some((p) => new RegExp(p, 'i').test(command)), 'the command matches a default pattern');
    const r = runWritten(initialisedByCli(), command);
    assert.equal(r.status, 2, r.stderr);
  });

  test('acceptance 2: the written command exits 0 on echo hello [R1] [R2]', () => {
    const r = runWritten(initialisedByCli(), 'echo hello');
    assert.equal(r.status, 0, r.stderr);
  });
});

describe('T1-INIT-HOOK-PATH: one dispatcher per matcher entry', () => {
  const CASES: Array<{ event: string; matcher?: string }> = [{ event: 'PreToolUse', matcher: NEW_MATCHER }, { event: 'Stop' }, { event: 'UserPromptSubmit' }];
  for (const { event, matcher } of CASES) {
    for (const spelling of [NPX, OTHER_PATH]) {
      test(`acceptance 4: ${event} entry holding ${spelling} and foreign hooks ends with the absolute dispatcher once, and a second init changes no byte [R3] [R4]`, () => {
        const scope = matcher ? { matcher } : {};
        const target = targetWithSettings({ hooks: { [event]: [{ ...scope, hooks: [FOREIGN_A, { type: 'command', command: spelling }, FOREIGN_B] }] } });
        init.initProject({ target, hookEntry: HOOK_ENTRY });
        assert.deepEqual(hooksOf(target)[event], [{ ...scope, hooks: [FOREIGN_A, FOREIGN_B, { type: 'command', command: ABSOLUTE }] }]);
        const first = readFileSync(settingsFile(target), 'utf8');
        init.initProject({ target, hookEntry: HOOK_ENTRY });
        assert.equal(readFileSync(settingsFile(target), 'utf8'), first);
      });
    }
  }

  const HELD = { type: 'command', command: ABSOLUTE };
  const NPX_HOOK = { type: 'command', command: NPX };
  const OTHER_HOOK = { type: 'command', command: OTHER_PATH };
  const AT_NEW = (...hooks: Hook[]): Entry => ({ matcher: NEW_MATCHER, hooks });
  const REPEATS: Array<{ name: string; before: Entry[]; after: Entry[] }> = [
    { name: 'twice and another spelling once', before: [AT_NEW(HELD, FOREIGN_A, NPX_HOOK, HELD, FOREIGN_B)], after: [AT_NEW(HELD, FOREIGN_A, FOREIGN_B)] },
    { name: 'three times with no foreign hook', before: [AT_NEW(HELD, HELD, HELD)], after: [AT_NEW(HELD)] },
    { name: 'in two entries of one matcher', before: [AT_NEW(NPX_HOOK, FOREIGN_A), AT_NEW(HELD, OTHER_HOOK)], after: [AT_NEW(FOREIGN_A), AT_NEW(HELD)] },
    { name: 'only as an old spelling in a second entry of one matcher', before: [AT_NEW(FOREIGN_A), AT_NEW(OTHER_HOOK)], after: [AT_NEW(FOREIGN_A, HELD)] },
    { name: 'under another matcher', before: [{ matcher: 'Bash', hooks: [NPX_HOOK, FOREIGN_A] }, AT_NEW(OTHER_HOOK)], after: [{ matcher: 'Bash', hooks: [FOREIGN_A] }, AT_NEW(HELD)] },
    { name: 'under another matcher, with no new-matcher entry', before: [{ matcher: 'Bash', hooks: [HELD] }], after: [AT_NEW(HELD)] },
  ];
  for (const { name, before, after: expected } of REPEATS) {
    test(`acceptance 4: a dispatcher ${name} ends once on the event, foreign order kept, and a second init changes no byte [R3]`, () => {
      const target = targetWithSettings({ hooks: { PreToolUse: before } });
      init.initProject({ target, hookEntry: HOOK_ENTRY });
      assert.deepEqual(hooksOf(target)['PreToolUse'], expected);
      const first = readFileSync(settingsFile(target), 'utf8');
      init.initProject({ target, hookEntry: HOOK_ENTRY });
      assert.equal(readFileSync(settingsFile(target), 'utf8'), first);
    });
  }

  test('acceptance 4: an absolute dispatcher comes off an old-matcher entry and a foreign hook stays [R4]', () => {
    const target = targetWithSettings({ hooks: { PreToolUse: [{ matcher: OLD_MATCHER, hooks: [{ type: 'command', command: OTHER_PATH }, FOREIGN_A] }] } });
    init.initProject({ target, hookEntry: HOOK_ENTRY });
    assert.deepEqual(hooksOf(target)['PreToolUse'], [{ matcher: OLD_MATCHER, hooks: [FOREIGN_A] }, { matcher: NEW_MATCHER, hooks: [{ type: 'command', command: ABSOLUTE }] }]);
  });
});

describe('T1-INIT-HOOK-PATH: isDispatcherCommand', () => {
  test('acceptance 5: the three spellings and the absolute form are dispatchers [R4]', () => {
    for (const command of [NPX, LOCAL, 'node bin/aidlc-hook.js', OTHER_PATH, 'node "/home/a b/aidlc/bin/aidlc-hook.js"', 'node "C:/Program Files (x86)/aidlc/bin/aidlc-hook.js"', 'node "/bin/aidlc-hook.js"', 'node "C:/bin/aidlc-hook.js"']) {
      assert.equal(init.isDispatcherCommand(command), true, command);
    }
  });

  test('acceptance 5: any other command is refused, a chained or expanding one included [R4]', () => {
    for (const command of [
      'node "x.js"',
      'node "a/bin/aidlc-hook.js" ; rm -rf x',
      '',
      'rm -rf x ; node "a/bin/aidlc-hook.js"',
      'node "/$(rm -rf x)/bin/aidlc-hook.js"',
      'node "/`rm -rf x`/bin/aidlc-hook.js"',
      'node "/%COMSPEC%/bin/aidlc-hook.js"',
      'node "/a/bin/aidlc-hook.js"\nrm -rf x',
      'node "a/bin/aidlc-hook.js"',
      'node "./a/bin/aidlc-hook.js"',
      'node "C:a/bin/aidlc-hook.js"',
      'node "--eval=console.log(1)//bin/aidlc-hook.js"',
      'node "//host/share/bin/aidlc-hook.js"',
      'node "/\\host\\share/bin/aidlc-hook.js"',
      'node "C:/a\\b/bin/aidlc-hook.js"',
      'node "-e/bin/aidlc-hook.js"',
      ...['&', '|', '<', '>', '^', '\0'].map((c) => `node "C:/a${c}b/bin/aidlc-hook.js"`),
    ]) {
      assert.equal(init.isDispatcherCommand(command), false, command);
    }
  });

  test('acceptance 5: a hookEntry holding & makes resolveHookCommand return the npx form [R4]', () => {
    assert.equal(init.resolveHookCommand(tempDir(), 'C:/a&b/bin/aidlc-hook.js'), NPX);
    assert.equal(init.resolveHookCommand(tempDir(), 'a/bin/aidlc-hook.js'), NPX, 'a relative hookEntry');
  });
});

describe('T1-INIT-HOOK-PATH: aidlc doctor hookCommand', () => {
  function doctorLine(cwd: string, base: NodeJS.ProcessEnv = process.env): string {
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'aidlc.js'), 'doctor', '--json'], { cwd, env: { ...base, AIDLC_STATE_DIR: path.join(cwd, 'state') }, encoding: 'utf8', timeout: 60_000, windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    return (JSON.parse(r.stdout) as { hookCommand: string }).hookCommand;
  }

  function wired(command: string, target = tempDir()): string {
    return targetWithSettings({ hooks: { PreToolUse: [{ matcher: NEW_MATCHER, hooks: [{ type: 'command', command }] }] } }, target);
  }

  /** On Windows `shell: true` starts ComSpec, so a command that needs a shell cannot start under this environment. POSIX does not read it. */
  const NO_WINDOWS_SHELL: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'comspec')), ComSpec: 'C:/no-such-dir/cmd.exe' };

  test('acceptance 6: a real dispatcher under a path holding a space reports ok with no shell [R5]', () => {
    const target = tempDir();
    const entry = path.join(target, 'with space', 'bin', 'aidlc-hook.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, `import(${JSON.stringify(pathToFileURL(HOOK_ENTRY).href)});`);
    const command = `node "${entry.replace(/\\/g, '/')}"`;
    assert.equal(doctorLine(wired(command, target), NO_WINDOWS_SHELL), `ok: ${command}`);
  });

  /** A target with `rel` present as a script that leaves a marker directory when it runs. */
  function withPlantedFile(rel: string): string {
    const target = tempDir();
    mkdirSync(path.dirname(path.join(target, rel)), { recursive: true });
    writeFileSync(path.join(target, rel), `require('fs').mkdirSync(${JSON.stringify(path.join(target, 'ran.marker'))});`);
    return target;
  }

  const CHECKED: Array<{ command: string; file: string }> = [
    { command: 'node bin/aidlc-hook.js', file: 'bin/aidlc-hook.js' },
    { command: LOCAL, file: 'node_modules/aidlc/bin/aidlc-hook.js' },
    { command: NPX, file: 'node_modules/aidlc/bin/aidlc-hook.js' },
  ];

  for (const { command, file } of CHECKED) {
    test(`acceptance 6: ${command} with its file present reports ok and the file does not run [R5]`, () => {
      const target = wired(command, withPlantedFile(file));
      assert.equal(doctorLine(target), `ok: ${command}`);
      assert.equal(existsSync(path.join(target, 'ran.marker')), false);
    });

    test(`acceptance 6: ${command} with no file, or a directory in its place, reports the FAILED text [R5]`, () => {
      const failed = `FAILED (exit 1): every guard is off until this command runs: ${command}`;
      assert.equal(doctorLine(wired(command)), failed);
      const directory = tempDir();
      mkdirSync(path.join(directory, file), { recursive: true });
      assert.equal(doctorLine(wired(command, directory)), failed);
    });
  }

  test('acceptance 6: the npx text does not reach an npx.cmd in the repository root [R5]', () => {
    const target = wired(NPX);
    writeFileSync(path.join(target, 'npx.cmd'), '@mkdir ran.marker\r\n');
    assert.equal(doctorLine(target), `FAILED (exit 1): every guard is off until this command runs: ${NPX}`);
    assert.equal(existsSync(path.join(target, 'ran.marker')), false);
  });

  test('acceptance 6: the launcher receives no shell option, and only the absolute spelling reaches it [R5]', () => {
    const calls: unknown[][] = [];
    const recording = ((...args: unknown[]) => {
      calls.push(args);
      return { status: 0 };
    }) as unknown as typeof spawnSync;
    for (const { command, file } of CHECKED) hookWiringReport(wired(command, withPlantedFile(file)), recording);
    assert.deepEqual(calls, [], 'a relative spelling or the npx text reached the launcher');
    assert.equal(hookWiringReport(wired(ABSOLUTE), recording), `ok: ${ABSOLUTE}`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]![0], 'node');
    assert.equal('shell' in (calls[0]!.at(-1) as object), false, 'no shell option');
  });

  test('acceptance 6: a working dispatcher reports ok [R5]', () => {
    assert.equal(doctorLine(wired(ABSOLUTE)), `ok: ${ABSOLUTE}`);
  });

  test('acceptance 6: an absolute dispatcher naming a missing file reports FAILED with its exit code [R5]', () => {
    const missing = `node "${tempDir().replace(/\\/g, '/')}/gone/bin/aidlc-hook.js"`;
    assert.equal(doctorLine(wired(missing)), `FAILED (exit 1): every guard is off until this command runs: ${missing}`);
    const separator = `node "${tempDir().replace(/\\/g, '/')}/a\u2028b/bin/aidlc-hook.js"`;
    assert.equal(doctorLine(wired(separator), NO_WINDOWS_SHELL), `FAILED (exit 1): every guard is off until this command runs: ${separator}`, 'a path holding U+2028 still runs with no shell');
  });

  test('acceptance 6: a launch that throws reports FAILED (exit null) [R5]', () => {
    const throwing = (): never => {
      throw new Error('launch failed');
    };
    assert.equal(hookWiringReport(wired(ABSOLUTE), throwing), `FAILED (exit null): every guard is off until this command runs: ${ABSOLUTE}`);
  });

  test('acceptance 6: no settings file, or one that does not parse, reports not wired [R5]', () => {
    assert.equal(doctorLine(tempDir()), 'not wired');
    assert.equal(doctorLine(targetWithSettings('{ not json')), 'not wired');
  });

  test('acceptance 6: a hook command that is not a string, or a NUL in its path, reports not wired and doctor keeps exit 0 [R5]', () => {
    for (const command of [['node "/a/bin/aidlc-hook.js"'], 5, null, 'node "/a\0b/bin/aidlc-hook.js"']) {
      assert.equal(doctorLine(targetWithSettings({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command }] }] } })), 'not wired', JSON.stringify(command));
    }
  });

  test('acceptance 6: a foreign hook, a Node option in the path, or an absolute dispatcher with & in its path, reports not wired and runs nothing [R5]', () => {
    const ampersand = `node "${tempDir().replace(/\\/g, '/')}/x&mkdir ran.marker&/bin/aidlc-hook.js"`;
    for (const command of ['mkdir ran.marker', ampersand, `node "--eval=require('fs').mkdirSync('ran.marker')//bin/aidlc-hook.js"`]) {
      const target = wired(command);
      const line = doctorLine(target);
      assert.equal(existsSync(path.join(target, 'ran.marker')), false, `ran: ${command}`);
      assert.equal(line, 'not wired', command);
    }
  });
});

test('T1-INIT-HOOK-PATH acceptance 7: OPERATIONS and the CHANGELOG hold the exact texts [R6] [R7]', () => {
  const paragraph = 'On a repository with no Node package (card T1-INIT-HOOK-PATH), `aidlc init` writes the hook command as `node "<path>/bin/aidlc-hook.js"`, the absolute path of the CLI that ran it, because `npx --no-install aidlc hook auto` exits 1 there and a hook that exits 1 does not stop a tool call. The path is per machine: on another machine, or after the checkout moves, every guard is off until `aidlc init` runs again, and `aidlc doctor` shows it on the `hookCommand` line as `FAILED`.';
  const lines = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').split(/\r?\n/);
  const powerShell = lines.findIndex((l) => l.startsWith('A PowerShell tool call is under the same rule'));
  assert.ok(lines.indexOf(paragraph) > powerShell && powerShell >= 0, `docs/OPERATIONS.md states, after the PowerShell paragraph: ${paragraph}`);

  const entry = '- T1-INIT-HOOK-PATH (bugfix): `aidlc init` on a repository with no Node package writes the hook command as `node "<path>/bin/aidlc-hook.js"` with the absolute path of the running CLI, because `npx --no-install aidlc hook auto` exits 1 there and leaves every guard off. A matcher entry holds the dispatcher once, and `aidlc doctor` gains a `hookCommand` line that runs an absolute dispatcher, checks the file of any other spelling, and reports `ok`, `FAILED` or `not wired`.';
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.ok(unreleased.includes(entry), `CHANGELOG Unreleased states: ${entry}`);
});
