/**
 * Child of tests/infra/stray-processes.test.ts, acceptance 10 (card T0-DOCTOR-STRAY-PROCESSES-2).
 *
 *   node stray-processes.child.ts <rows as JSON> <options as JSON>
 *   node stray-processes.child.ts --report <input as JSON> <listing>
 *
 * Calls `strayEntries` with the parsed rows and options, or `strayProcessesReport` with the input (its `config` parsed by
 * `ProjectConfig`) and a runner that answers every call with the listing, and prints the value (`{ value, calls }` for the
 * report) as one JSON line. The parent runs it under a timeout, so a loop that never ends fails the row on its status
 * instead of hanging the suite.
 */
import { ProjectConfig } from '../../src/config.ts';
import type { Runner } from '../../src/probes/exec.ts';
import { strayEntries, strayProcessesReport } from '../../src/probes/processes.ts';

const [first, second, third] = process.argv.slice(2);
if (first === '--report' && second !== undefined && third !== undefined) {
  const input = JSON.parse(second);
  let calls = 0;
  const runner: Runner = async (command, args) => {
    calls++;
    return { command, args, cwd: '', exitCode: 0, signal: null, timedOut: false, stdout: third, stderr: '', startedAt: '', finishedAt: '', durationMs: 0, outputSha256: '' };
  };
  const value = await strayProcessesReport({ ...input, config: ProjectConfig.parse(input.config), runner });
  process.stdout.write(JSON.stringify({ value, calls }) + '\n');
} else if (first !== undefined && second !== undefined && first !== '--report') {
  process.stdout.write(JSON.stringify(strayEntries(JSON.parse(first), JSON.parse(second))) + '\n');
} else {
  process.stderr.write('usage: stray-processes.child.ts <rows as JSON> <options as JSON> | --report <input as JSON> <listing>\n');
  process.exit(2);
}
