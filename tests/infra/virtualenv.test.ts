/**
 * Card T0-DOD-VENV (issue 450): `virtualenvFor` finds a Python virtualenv (`.venv`, else `venv`, holding `pyvenv.cfg` and its
 * scripts directory) in the given roots in order and builds the environment an activate script gives; `dodCall` carries it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { virtualenvFor } from '../../src/probes/virtualenv.ts';
import { dodCall } from '../../src/review/mutants.ts';
import { cleanup, tmpDir } from './helpers.ts';

function inTemp(body: (dir: string) => void): void {
  // tmpDir makes the directory with mkdtempSync and registers its removal (T0-TEST-TEMP-SWEEP); the finally block removes it.
  const dir = tmpDir('aidlc-venv-');
  try {
    body(dir);
  } finally {
    cleanup(dir);
  }
}

/** A virtualenv directory `<root>/<name>` with `pyvenv.cfg` (unless `cfg` is false) and the scripts directory `scripts`. */
function venv(root: string, name: string, scripts: 'bin' | 'Scripts', cfg = true): string {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, scripts), { recursive: true });
  if (cfg) writeFileSync(path.join(dir, 'pyvenv.cfg'), 'home = /usr/bin\n', 'utf8');
  return dir;
}

test('(a) a .venv with bin on linux: the scripts directory is first on PATH, VIRTUAL_ENV is the directory [R1] [R2]', () => {
  inTemp((root) => {
    const dir = venv(root, '.venv', 'bin');
    const found = virtualenvFor([root], { PATH: '/usr/bin' }, 'linux');
    assert.ok(found, 'a virtualenv is found');
    assert.equal(found.dir, dir);
    assert.deepEqual(found.env, { PATH: `${path.join(dir, 'bin')}:/usr/bin`, VIRTUAL_ENV: dir });
  });
});

test('(b) win32: one key per variable, spelled as the env given spells it first, PYTHONHOME in every spelling removed [R2]', () => {
  inTemp((root) => {
    const dir = venv(root, '.venv', 'Scripts');
    const found = virtualenvFor([root], { Path: 'C:\\x', PATH: 'C:\\y', PYTHONHOME: 'h', pythonhome: 'h2', virtual_env: 'old', KEEP: 'k' }, 'win32');
    assert.ok(found, 'a virtualenv is found');
    assert.equal(found.dir, dir);
    assert.deepEqual(Object.keys(found.env).sort(), ['KEEP', 'Path', 'virtual_env']);
    assert.deepEqual(found.env, { Path: `${path.join(dir, 'Scripts')};C:\\y`, virtual_env: dir, KEEP: 'k' });
  });
});

test('(b2) win32 with no PATH spelling: the key is PATH and VIRTUAL_ENV in upper case [R2]', () => {
  inTemp((root) => {
    const dir = venv(root, '.venv', 'Scripts');
    const found = virtualenvFor([root], { KEEP: 'k' }, 'win32');
    assert.deepEqual(found?.env, { KEEP: 'k', PATH: path.join(dir, 'Scripts'), VIRTUAL_ENV: dir });
  });
});

test('(b3) win32: every variable keeps one key spelled as given first, and a non-enumerable variable is copied [R2]', () => {
  inTemp((root) => {
    const dir = venv(root, '.venv', 'Scripts');
    const env: NodeJS.ProcessEnv = { Keep: '', KEEP: 'k', other: 'o' };
    Object.defineProperty(env, 'virtual_env', { value: 'old', enumerable: false });
    Object.defineProperty(env, 'Hidden', { value: 'h', enumerable: false });
    const found = virtualenvFor([root], env, 'win32');
    assert.deepEqual(found?.env, { Keep: 'k', other: 'o', Hidden: 'h', virtual_env: dir, PATH: path.join(dir, 'Scripts') });
    assert.deepEqual(Object.keys(found!.env).sort(), ['Hidden', 'Keep', 'PATH', 'other', 'virtual_env']);
  });
});

test('(b4) linux: every own variable is copied with its exact name, a non-enumerable one too [R2]', () => {
  inTemp((root) => {
    const dir = venv(root, '.venv', 'bin');
    const env: NodeJS.ProcessEnv = { Keep: 'a', KEEP: 'b' };
    Object.defineProperty(env, 'Hidden', { value: 'h', enumerable: false });
    assert.deepEqual(virtualenvFor([root], env, 'linux')?.env, { Keep: 'a', KEEP: 'b', Hidden: 'h', PATH: path.join(dir, 'bin'), VIRTUAL_ENV: dir });
  });
});

test('(b5) a variable named __proto__ is copied as an own variable on linux and win32 [R2]', () => {
  inTemp((root) => {
    for (const platform of ['linux', 'win32'] as const) {
      venv(root, '.venv', platform === 'win32' ? 'Scripts' : 'bin');
      const env = JSON.parse('{"__proto__":"p","KEEP":"k"}') as NodeJS.ProcessEnv;
      const found = virtualenvFor([root], env, platform);
      assert.ok(found, platform);
      assert.equal(Object.hasOwn(found.env, '__proto__'), true, `${platform}: __proto__ is an own variable`);
      assert.equal(Object.getOwnPropertyDescriptor(found.env, '__proto__')?.value, 'p', platform);
      assert.equal(Object.getPrototypeOf(found.env), Object.prototype, `${platform}: the prototype is unchanged`);
      assert.deepEqual(Object.keys(found.env).sort(), ['KEEP', 'PATH', 'VIRTUAL_ENV', '__proto__'], platform);
    }
  });
});

test('(c) no PATH, or an empty one: PATH is the scripts directory alone [R2]', () => {
  inTemp((root) => {
    const dir = venv(root, '.venv', 'bin');
    assert.deepEqual(virtualenvFor([root], {}, 'linux')?.env, { PATH: path.join(dir, 'bin'), VIRTUAL_ENV: dir });
    assert.deepEqual(virtualenvFor([root], { PATH: '' }, 'linux')?.env, { PATH: path.join(dir, 'bin'), VIRTUAL_ENV: dir });
  });
});

test('(c2) elsewhere than win32 the names are exact: another spelling of PATH is an ordinary variable [R2]', () => {
  inTemp((root) => {
    const dir = venv(root, '.venv', 'bin');
    assert.deepEqual(virtualenvFor([root], { Path: '/x', PYTHONHOME: 'h' }, 'linux')?.env, { Path: '/x', PATH: path.join(dir, 'bin'), VIRTUAL_ENV: dir });
  });
});

test('(d) a .venv without pyvenv.cfg is not a virtualenv: the venv beside it is [R1]', () => {
  inTemp((root) => {
    venv(root, '.venv', 'bin', false);
    const dir = venv(root, 'venv', 'bin');
    assert.equal(virtualenvFor([root], {}, 'linux')?.dir, dir);
  });
});

test('(e) .venv comes before venv in the same root [R1]', () => {
  inTemp((root) => {
    const dir = venv(root, '.venv', 'bin');
    venv(root, 'venv', 'bin');
    assert.equal(virtualenvFor([root], {}, 'linux')?.dir, dir);
  });
});

test('(f) the roots are read in order: the first root with a virtualenv wins [R1]', () => {
  inTemp((tmp) => {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    mkdirSync(a);
    mkdirSync(b);
    const inB = venv(b, 'venv', 'bin');
    assert.equal(virtualenvFor([a, b], {}, 'linux')?.dir, inB, 'only b holds one');
    const inA = venv(a, 'venv', 'bin');
    assert.equal(virtualenvFor([a, b], {}, 'linux')?.dir, inA, 'both hold one');
  });
});

test('(g) a missing root, the layout of the other platform and a scripts path that is a file give no virtualenv [R1]', () => {
  inTemp((root) => {
    assert.equal(virtualenvFor([path.join(root, 'missing')], {}, 'linux'), undefined);
    venv(root, '.venv', 'Scripts');
    assert.equal(virtualenvFor([root], {}, 'linux'), undefined, 'Scripts is not the linux layout');
    const other = path.join(root, 'other');
    mkdirSync(path.join(other, '.venv'), { recursive: true });
    writeFileSync(path.join(other, '.venv', 'pyvenv.cfg'), '', 'utf8');
    writeFileSync(path.join(other, '.venv', 'bin'), '', 'utf8');
    assert.equal(virtualenvFor([other], {}, 'linux'), undefined, 'bin is a file');
    const cfgDir = path.join(root, 'cfgdir');
    mkdirSync(path.join(cfgDir, '.venv', 'pyvenv.cfg'), { recursive: true });
    mkdirSync(path.join(cfgDir, '.venv', 'bin'));
    assert.equal(virtualenvFor([cfgDir], {}, 'linux'), undefined, 'pyvenv.cfg is a directory');
  });
});

test('(h) the env given is not changed [R2]', () => {
  inTemp((root) => {
    venv(root, '.venv', 'Scripts');
    const env = { Path: 'C:\\x', PYTHONHOME: 'h', KEEP: 'k' };
    const before = structuredClone(env);
    virtualenvFor([root], env, 'win32');
    assert.deepEqual(env, before);
  });
});

const SCRIPTS = process.platform === 'win32' ? 'Scripts' : 'bin';

test('dodCall carries the virtualenv env on every ship path, and no env without one [R3]', () => {
  inTemp((wt) => {
    for (const ship of ['github', 'dry-run', 'scaffold'] as const) assert.deepEqual(dodCall({ dod_command: 'x' }, wt, 5000, ship, [wt]), dodCall({ dod_command: 'x' }, wt, 5000, ship), `${ship}: no virtualenv`);
    for (const ship of ['github', 'dry-run', 'scaffold'] as const) assert.equal('env' in dodCall({ dod_command: 'x' }, wt, 5000, ship, [wt])[2], false, `${ship}: no env key`);
    const dir = venv(wt, '.venv', SCRIPTS);
    for (const ship of ['github', 'dry-run', 'scaffold'] as const) {
      const [command, args, options] = dodCall({ dod_command: 'x' }, wt, 5000, ship, [wt]);
      const { env, ...rest } = options as typeof options & { env?: NodeJS.ProcessEnv };
      assert.equal(env?.VIRTUAL_ENV, dir, `${ship}: VIRTUAL_ENV`);
      assert.deepEqual(env, virtualenvFor([wt])?.env, `${ship}: the env of virtualenvFor`);
      const [mainCommand, mainArgs, mainOptions] = dodCall({ dod_command: 'x' }, path.join(wt, 'none'), 5000, ship);
      assert.deepEqual([command, args, rest], [mainCommand, mainArgs, { ...mainOptions, cwd: wt }], `${ship}: the rest of the call`);
    }
    assert.equal(dodCall({ dod_command: 'x' }, wt, 5000, 'github')[2].env?.VIRTUAL_ENV, dir, 'the default roots are the worktree');
  });
});
