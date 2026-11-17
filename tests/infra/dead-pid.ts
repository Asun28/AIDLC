// Card T0-DEAD-PID-TESTS (issue 312): the pid of a gone process, for a test that needs an owner that no longer runs.
//
// The pid of a child that has just exited is not safe for this: Windows reuses process ids quickly, so another process can
// hold that pid by the time the code under test signals it, and the owner reads as alive. This module returns a pid that no
// process can hold instead. The bounds it relies on:
// - Linux: `kernel.pid_max` is at most 2**22 (4194304), so every pid is at most 2**22.
// - macOS: pids are handed out below 100000 (PID_MAX 99999).
// - Windows: process ids are multiples of 4 drawn from a handle table, and stay far below 2**31.
// The value is 2**31-4: above every pid of those platforms, so it cannot name a live process, and not above 2**31-1, the
// largest pid `process.kill` accepts (`MAX_PID` of src/coordination/review-queue.ts), so `process.kill(pid, 0)` throws
// ESRCH rather than a range error and `aidlc review release` reads the pid as a usable one whose process is gone.

/** A process id no process can hold on Linux, macOS or Windows: 2**31-4. */
export function deadPid(): number {
  return 2 ** 31 - 4;
}
