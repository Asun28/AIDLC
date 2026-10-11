// Card T1-SWEEP-UNUSED-GATE: the typecheck and the build refuse unused locals, imports and parameters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
type TsConfig = { extends?: string; compilerOptions?: Record<string, unknown> };

test('T1-SWEEP-UNUSED-GATE acceptance 1: tsconfig.json turns on both unused-code options and tsconfig.test.json keeps them [R1] [R4]', () => {
  const build = JSON.parse(read('tsconfig.json')) as TsConfig;
  assert.equal(build.compilerOptions?.['noUnusedLocals'], true);
  assert.equal(build.compilerOptions?.['noUnusedParameters'], true);
  const typecheck = JSON.parse(read('tsconfig.test.json')) as TsConfig;
  assert.equal(typecheck.extends, './tsconfig.json');
  assert.equal('noUnusedLocals' in (typecheck.compilerOptions ?? {}), false, 'tsconfig.test.json inherits noUnusedLocals');
  assert.equal('noUnusedParameters' in (typecheck.compilerOptions ?? {}), false, 'tsconfig.test.json inherits noUnusedParameters');
});

test('T1-SWEEP-UNUSED-GATE acceptance 4: CLAUDE.md names the unused-code options in its static gate sentence; the CHANGELOG names the card [R5]', () => {
  assert.ok(read('CLAUDE.md').includes('There is no linter; strict `tsc` with `noUnusedLocals` and `noUnusedParameters` is the only static gate.\n'));
  const changelog = read('CHANGELOG.md').replace(/\r\n/g, '\n');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.ok(unreleased.includes('\n- T1-SWEEP-UNUSED-GATE: `tsconfig.json` turns on `noUnusedLocals` and `noUnusedParameters`, so `npm run typecheck` (sources and tests) and `npm run build` refuse an unused local, import or parameter.'));
});
