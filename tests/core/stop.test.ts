import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStop, isGlobalStop, makeStop } from '../../src/core/stop.ts';
import { T0 } from './_fixtures.ts';

describe('stop records', () => {
  test('global prohibitions default to global; a blocked branch does not', () => {
    for (const reason of ['auth', 'audit', 'cancelled', 'ownership', 'risk', 'frozen', 'time'] as const) {
      assert.equal(makeStop(reason, 'd', 'n', { at: T0 }).global, true, reason);
    }
    for (const reason of ['card', 'review', 'ci', 'tool', 'arc-verify', 'release-auth', 'release-config', 'migration', 'rollback-auth', 'scope', 'checkpoint', 'capability', 'release-health'] as const) {
      assert.equal(makeStop(reason, 'd', 'n', { at: T0 }).global, false, reason);
    }
  });

  test('explicit global override and unresolved operations are preserved', () => {
    const s = makeStop('review', 'second block', 'hand off', { global: true, unresolvedOperations: ['op-1'], at: T0 });
    assert.equal(s.global, true);
    assert.deepEqual(s.unresolvedOperations, ['op-1']);
    assert.equal(s.at, T0);
    assert.equal(isGlobalStop(s), true);
    assert.equal(isGlobalStop(undefined), false);
  });

  test('formatStop renders reason, scope, detail, next action and unresolved ops', () => {
    const s = makeStop('review', 'second block', 'adjudicate', { unresolvedOperations: ['op-9'], at: T0 });
    const line = formatStop(s);
    assert.match(line, /^STOP\/review \(branch\) second block -> next: adjudicate unresolved=op-9$/);
    assert.match(formatStop(makeStop('time', 'x', 'y', { at: T0 })), /\(global\)/);
  });
});
