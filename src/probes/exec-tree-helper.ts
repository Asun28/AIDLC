/**
 * Tree helper of `runSync` with `killTree` (card T0-EXEC-SYNC-TREE-KILL). Reads one JSON request on
 * stdin ({ command, args, input, timeoutMs, shell }), runs the command with the async runner `run`,
 * which ends the command's whole process tree at `timeoutMs`, and prints the receipt as one JSON
 * document. Its cwd and environment are the ones `runSync` started it with, the caller's.
 */
import { run } from './exec.ts';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { command: string; args: string[]; input?: string; timeoutMs: number; shell?: boolean };
const receipt = await run(request.command, request.args, { timeoutMs: request.timeoutMs, input: request.input, shell: request.shell });
process.stdout.write(JSON.stringify(receipt), () => process.exit(0));
