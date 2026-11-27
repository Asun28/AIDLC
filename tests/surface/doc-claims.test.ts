import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const STALE_NEXT = 'read-only apart from derived transitions';

test('T0-DOC-CLAIMS-3 acceptance 1a: the Sessions lock sentence lists release records, not review-pool records, as last-writer-wins [R1]', () => {
  const ops = read('docs/OPERATIONS.md');
  const at = ops.indexOf('\n## Sessions\n') + 1;
  const sessions = ops.slice(at, ops.indexOf('\n## ', at) + 1);
  assert.ok(!sessions.includes('review-pool records stay last-writer-wins'), 'review-pool records are written under the queue lock');
  assert.ok(sessions.includes('release records stay last-writer-wins'), 'release records are written with no lock');
});

test('T0-DOC-CLAIMS-3 acceptance 1b: CLAUDE.md names the board write of aidlc next [R3]', () => {
  const claude = read('CLAUDE.md');
  assert.ok(!claude.replace(/\s+/g, ' ').includes(STALE_NEXT), `CLAUDE.md holds no "${STALE_NEXT}", across line breaks too`);
  const paragraph = claude.split('\nOne directive per call.')[1]?.split('\n\n')[0] ?? '';
  assert.ok(paragraph.includes('board view'), 'the One directive per call. paragraph names the board view');
});

test('T0-DOC-CLAIMS-3 acceptance 1c: the help of aidlc next names the board write [R3]', () => {
  const main = read('src/cli/main.ts');
  const description = main.split(".command('next [goalId]')")[1]?.match(/\.description\('([^']*)'\)/)?.[1] ?? '';
  assert.ok(!description.includes(STALE_NEXT), `the next description holds no "${STALE_NEXT}"`);
  assert.ok(description.includes('board'), `the next description names the board: ${description}`);
});

test('T0-DOC-CLAIMS-3 acceptance 1d: REQUIREMENTS-TRACEABILITY no longer says init and the CLI have no tests [R4]', () => {
  const trace = read('docs/REQUIREMENTS-TRACEABILITY.md');
  assert.ok(!trace.includes('`src/scaffold/init.ts` and `src/cli/main.ts` have no automated tests'), 'the stale line is gone');
  for (const file of ['tests/infra/init.test.ts', 'tests/surface/init-base-ci.test.ts', 'tests/surface/init-no-package.test.ts', 'tests/infra/cli-inprocess.test.ts']) {
    assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), `${file} exists`);
  }
});
