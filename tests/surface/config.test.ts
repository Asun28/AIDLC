import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ProjectConfig, resolveWorktreeRoot } from '../../src/config.ts';

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
