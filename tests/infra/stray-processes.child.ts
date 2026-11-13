/**
 * Child of tests/infra/stray-processes.test.ts, acceptance 10 (card T0-DOCTOR-STRAY-PROCESSES-2).
 *
 *   node stray-processes.child.ts <rows as JSON> <options as JSON>
 *
 * Calls `strayEntries` with the parsed rows and options and prints its value as one JSON line. The parent runs it under a
 * timeout, so a parent walk that never ends fails the row on its status instead of hanging the suite.
 */
import { strayEntries } from '../../src/probes/processes.ts';

const [rows, options] = process.argv.slice(2);
if (rows === undefined || options === undefined) {
  process.stderr.write('usage: stray-processes.child.ts <rows as JSON> <options as JSON>\n');
  process.exit(2);
}
process.stdout.write(JSON.stringify(strayEntries(JSON.parse(rows), JSON.parse(options))) + '\n');
