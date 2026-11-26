#!/usr/bin/env node
// aidlc CLI entry. Loads the compiled build when it is at least as new as every source file, else the TypeScript
// sources on Node >= 22.18 (type stripping), so a source checkout never runs a build from an earlier commit and
// `node bin/aidlc.js` works without a build step. `AIDLC_ENTRY_DEBUG=1` prints the choice.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { resolveEntry } from './resolve-entry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist', 'cli', 'main.js');
const src = path.join(here, '..', 'src', 'cli', 'main.ts');
const chosen = resolveEntry({ dist, src, srcRoot: path.join(here, '..', 'src') });
if (process.env['AIDLC_ENTRY_DEBUG']) process.stderr.write(`[aidlc entry] target=${chosen.target} reason=${chosen.reason}\n`);
// `aidlc hook` with modules that fail to load blocks a PreToolUse call (exit 2) and ends as before on any other event
// (card T0-HOOK-LOAD-FAIL-CLOSED); every other command ends as before and never reads stdin.
const args = process.argv.slice(2);
const isHook = args[0] === 'hook' || ((args[0] === '-C' || args[0] === '--cwd') && args[2] === 'hook');
let mod;
try {
  mod = await import(pathToFileURL(chosen.target).href);
} catch (err) {
  if (!isHook) throw err;
  await (await import('./hook-load-failure.js')).failHookLoad(err);
}
if (typeof mod.main === 'function') {
  // A rejection is one `aidlc: <message>` line, its line breaks joined with ` | `, and exit 1, never a stack trace (card
  // T0-R3-POOL-WAIT); the direct entry `node src/cli/main.ts` prints the message as thrown.
  try {
    await mod.main(process.argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`aidlc: ${message.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l !== '').join(' | ')}\n`);
    process.exit(1);
  }
}
