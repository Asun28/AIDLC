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

  test('a missing SystemDrive falls back to C: and a missing HOME to /tmp, as before [R2]', () => {
    assert.equal(resolveWorktreeRoot(empty, 'D:\\Projects\\AIDLC', {}, 'win32'), 'C:\\wt\\AIDLC');
    assert.equal(resolveWorktreeRoot(empty, '/srv/AIDLC', {}, 'linux'), '/tmp/.wt/AIDLC');
  });

  test('env and platform default to the process (the resolved root ends with the checkout name) [R2]', () => {
    const resolved = resolveWorktreeRoot(empty, path.join('some', 'where', 'REPO-X'));
    assert.equal(path.basename(resolved), 'REPO-X');
    assert.equal(path.basename(path.dirname(resolved)), process.platform === 'win32' ? 'wt' : '.wt');
  });
});
