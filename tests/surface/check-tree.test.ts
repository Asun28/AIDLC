// Card T0-CHECK-TREE: the check:tree script and the line of this repository's card template that names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const FILES = [
  'tests/core/parse-guard.test.ts',
  'tests/infra/update-json.test.ts',
  'tests/surface/layers.test.ts',
  'tests/surface/mirror.test.ts',
  'tests/surface/module-map.test.ts',
  'tests/surface/prose.test.ts',
  'tests/surface/test-audit.test.ts',
  'tests/surface/test-temp.test.ts',
];
const LINE = '# in this repository the dod_command runs `npm run check:tree` after the typecheck: the tests that read whole directories of the tree';

test('acceptance 1: check:tree runs the eight whole-tree test files, and each exists [R1]', () => {
  const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(scripts['check:tree'], `node --test ${FILES.join(' ')}`);
  for (const file of FILES) assert.ok(existsSync(path.join(root, file)), file);
});

test('acceptance 2: the line after dod_command in the card template of this repository names check:tree, and the installed template does not [R2] [R3]', () => {
  const lines = read('specs/tasks/_TEMPLATE.md').split('\n');
  const at = lines.findIndex((l) => l.startsWith('dod_command:'));
  assert.ok(at >= 0, 'the template has a dod_command line');
  assert.equal(lines[at + 1], LINE);
  assert.ok(!read('templates/cards/_TEMPLATE.md').includes('check:tree'));
});
