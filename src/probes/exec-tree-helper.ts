/**
 * Tree helper of `runSync` with `killTree` (card T0-EXEC-SYNC-TREE-KILL). Reads its request on stdin: a
 * JSON header line ({ command, args, timeoutMs, shell, inputBytes }) followed by the input as UTF-8 bytes.
 * Runs the command with the async runner `run`, which ends the command's whole process tree at
 * `timeoutMs`, and prints a JSON header line ({ exitCode, signal, timedOut, stdoutBytes, stderrBytes })
 * followed by the command's stdout and stderr as UTF-8 bytes, so no output byte is escaped. Its cwd and
 * environment are the ones `runSync` started it with, the caller's.
 */
import { run } from './exec.ts';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const request = Buffer.concat(chunks);
const eol = request.indexOf(0x0a);
if (eol < 0) throw new Error('tree helper: no request header line');
const header = JSON.parse(request.subarray(0, eol).toString('utf8')) as { command: string; args: string[]; timeoutMs: number; shell?: boolean; inputBytes?: number };
const body = request.subarray(eol + 1);
if (body.length !== (header.inputBytes ?? 0)) throw new Error(`tree helper: request body of ${body.length} bytes, header says ${header.inputBytes}`);
const input = header.inputBytes === undefined ? undefined : body.toString('utf8');
const receipt = await run(header.command, header.args, { timeoutMs: header.timeoutMs, input, shell: header.shell });
const [stdout, stderr] = [Buffer.from(receipt.stdout, 'utf8'), Buffer.from(receipt.stderr, 'utf8')];
const line = JSON.stringify({ exitCode: receipt.exitCode, signal: receipt.signal, timedOut: receipt.timedOut, stdoutBytes: stdout.length, stderrBytes: stderr.length });
process.stdout.write(Buffer.concat([Buffer.from(`${line}\n`, 'utf8'), stdout, stderr]), () => process.exit(0));
