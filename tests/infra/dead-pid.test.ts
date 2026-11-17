// Card T0-DEAD-PID-TESTS acceptance 1: the pid of tests/infra/dead-pid.ts is in range for `process.kill` and names no process.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deadPid } from './dead-pid.ts';
import { processAlive } from '../../src/state/store.ts';

const checkDead = (pid: number): void => {
  assert.ok(Number.isInteger(pid), `${pid} is an integer`);
  assert.ok(pid > 2 ** 22, `${pid} is above the Linux pid_max bound 2**22`);
  assert.ok(pid <= 2 ** 31 - 1, `${pid} is at most 2**31-1`);
  assert.equal(processAlive(pid), false, 'processAlive reports it dead');
  assert.throws(() => process.kill(pid, 0), (err: unknown) => (err as NodeJS.ErrnoException).code === 'ESRCH');
};

test('acceptance 1: the dead pid is an integer above 2**22 and at most 2**31-1, reads as dead, and signalling it throws ESRCH [R1]', () => {
  checkDead(deadPid());
});

test('acceptance 1: two calls return a pid with the same properties [R1]', () => {
  checkDead(deadPid());
  checkDead(deadPid());
});
