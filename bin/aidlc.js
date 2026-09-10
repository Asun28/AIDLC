#!/usr/bin/env node
// aidlc CLI entry. Prefers the compiled build; falls back to the TypeScript sources on Node >= 22.18
// (type stripping) so `node bin/aidlc.js` works from a source checkout without a build step.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist', 'cli', 'main.js');
const src = path.join(here, '..', 'src', 'cli', 'main.ts');
const target = existsSync(dist) ? dist : src;
const mod = await import(pathToFileURL(target).href);
if (typeof mod.main === 'function') {
  await mod.main(process.argv);
}
