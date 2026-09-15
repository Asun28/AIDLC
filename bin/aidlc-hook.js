#!/usr/bin/env node
// One-process Claude Code hook entry: reads the event JSON from stdin and runs every aidlc guard that
// applies to it (see src/hooks/entry.ts). Loads the compiled build when it is at least as new as every
// source file, else the TypeScript sources on Node >= 22.18 (type stripping). Loads only the hook
// modules, never the whole CLI. `AIDLC_ENTRY_DEBUG=1` prints the choice.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { resolveEntry } from './resolve-entry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist', 'hooks', 'entry.js');
const src = path.join(here, '..', 'src', 'hooks', 'entry.ts');
const chosen = resolveEntry({ dist, src, srcRoot: path.join(here, '..', 'src') });
if (process.env['AIDLC_ENTRY_DEBUG']) process.stderr.write(`[aidlc entry] target=${chosen.target} reason=${chosen.reason}\n`);
const mod = await import(pathToFileURL(chosen.target).href);
await mod.main();
