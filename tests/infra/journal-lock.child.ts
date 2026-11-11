/**
 * Appender for tests/infra/journal-lock.test.ts (card T0-JOURNAL-APPEND-LOCK).
 *
 *   node journal-lock.child.ts <journal file> <count>
 *
 * Appends <count> NOTE events to the journal file, one after another, and prints one JSON line:
 * `{"returned": <appends that returned>, "thrown": [{"code", "syscall", "file"}, ...]}`, one entry for each append that
 * threw (`file` is the base name of the error's path, `-` when it has none). The session comes from `AIDLC_SESSION`.
 */
import path from 'node:path';
import { Journal } from '../../src/state/journal.ts';

const [file, count] = process.argv.slice(2);
const n = Number(count);
if (!file || !Number.isInteger(n) || n < 1) {
  process.stderr.write('usage: journal-lock.child.ts <journal file> <count>\n');
  process.exit(2);
}

const journal = new Journal(file);
let returned = 0;
const thrown: Array<{ code: string; syscall: string; file: string }> = [];
for (let i = 0; i < n; i++) {
  try {
    journal.append({ type: 'NOTE', data: { pid: process.pid, i } });
    returned++;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    thrown.push({ code: String(e.code ?? e.message), syscall: e.syscall ?? '-', file: e.path ? path.basename(e.path) : '-' });
  }
}
process.stdout.write(JSON.stringify({ returned, thrown }) + '\n');
