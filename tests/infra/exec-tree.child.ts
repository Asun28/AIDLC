/**
 * Process-tree fixture for tests/infra/exec.test.ts (card T0-EXEC-TREE-KILL).
 *
 *   node exec-tree.child.ts stay <pidFile>     the root starts the sleeper through a shell with
 *                                              inherited stdio, waits for its pid file, then sleeps
 *   node exec-tree.child.ts exit <pidFile>     the same, but the root exits once the pid file exists,
 *                                              so the sleeper alone keeps the inherited output open
 *   node exec-tree.child.ts sleeper <pidFile>  writes its pid to <pidFile>, then sleeps
 *
 * The root writes its own pid to `<pidFile>.root` before it starts the sleeper.
 *
 * The sleeper is node on every OS, never a shell builtin, and sleeps 60 s; the tests end it.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SLEEP_MS = 60_000;
const [mode, pidFile] = process.argv.slice(2);
if (!pidFile || !['stay', 'exit', 'sleeper'].includes(mode ?? '')) {
  process.stderr.write('usage: exec-tree.child.ts stay|exit|sleeper <pidFile>\n');
  process.exit(2);
}

if (mode === 'sleeper') {
  writeFileSync(`${pidFile}.tmp`, String(process.pid));
  renameSync(`${pidFile}.tmp`, pidFile);
  setTimeout(() => {}, SLEEP_MS);
} else {
  writeFileSync(`${pidFile}.root`, String(process.pid));
  // Quote each path: node lives under Program Files on a developer machine.
  const quote = (s: string): string => `"${s}"`;
  spawn(`${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} sleeper ${quote(pidFile)}`, { shell: true, stdio: 'inherit' });
  const poll = setInterval(() => {
    if (!existsSync(pidFile) || !/^\d+$/.test(readFileSync(pidFile, 'utf8'))) return;
    clearInterval(poll);
    if (mode === 'exit') process.exit(0);
    setTimeout(() => {}, SLEEP_MS);
  }, 20);
}
