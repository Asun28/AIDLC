#!/usr/bin/env node
// One-process Claude Code hook entry: reads the event JSON from stdin and runs every aidlc guard that
// applies to it (see src/hooks/entry.ts). Prefers the compiled build; falls back to the TypeScript
// sources on Node >= 22.18 (type stripping). Loads only the hook modules, never the whole CLI.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist', 'hooks', 'entry.js');
const src = path.join(here, '..', 'src', 'hooks', 'entry.ts');
const mod = await import(pathToFileURL(existsSync(dist) ? dist : src).href);
await mod.main();
