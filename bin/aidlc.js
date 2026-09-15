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
const mod = await import(pathToFileURL(chosen.target).href);
if (typeof mod.main === 'function') {
  await mod.main(process.argv);
}
