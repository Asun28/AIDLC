import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { goal, cardRun } from '../core/_fixtures.ts';
import { cleanup } from '../infra/helpers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

/** Every file under `dir` with its bytes, so a write, a new file or a new directory shows up as a difference. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) {
        files[`${path.relative(dir, p)}/`] = '';
        walk(p);
      } else files[path.relative(dir, p)] = readFileSync(p).toString('base64');
    }
  };
  walk(dir);
  return files;
}

function cli(dir: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: dir };
  delete env.AIDLC_SESSION;
  delete env.CLAUDE_CODE_SESSION_ID;
  return spawnSync(process.execPath, [path.join(root, 'src', 'cli', 'main.ts'), ...args], { cwd: root, encoding: 'utf8', env, windowsHide: true });
}

interface Payload {
  bounds: { bound: string; fired: number; outcomes: { DONE: number; open: number; STOP: Record<string, number> } }[];
  extensions: { goalId: string; count: number }[];
}

test('aidlc bounds: JSON when piped, --goal narrows, unknown goal and unreadable run exit 1, state unchanged (acceptance 5)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-bounds-'));
  try {
    mkdirSync(path.join(dir, 'goals'), { recursive: true });
    for (const id of ['g-bounds-a', 'g-bounds-b']) mkdirSync(path.join(dir, 'cards', id), { recursive: true });
    writeFileSync(path.join(dir, 'goals', 'g-bounds-a.json'), JSON.stringify(goal({ id: 'g-bounds-a', state: 'DONE' }), null, 2), 'utf8');
    writeFileSync(path.join(dir, 'goals', 'g-bounds-b.json'), JSON.stringify(goal({ id: 'g-bounds-b', counters: { integrationRepairCycles: 1 } }), null, 2), 'utf8');
    writeFileSync(path.join(dir, 'cards', 'g-bounds-a', 'T1-A.json'), JSON.stringify(cardRun({ goalId: 'g-bounds-a', review: { substantiveDecisions: 2 } }), null, 2), 'utf8');
    const before = snapshot(dir);

    const all = cli(dir, ['bounds']);
    assert.equal(all.status, 0, all.stderr);
    const payload = JSON.parse(all.stdout) as Payload;
    const firedOf = (p: Payload) => Object.fromEntries(p.bounds.filter((b) => b.fired).map((b) => [b.bound, b.fired]));
    assert.equal(payload.bounds.length, 9, 'a piped stdout prints the JSON with all nine bounds');
    assert.deepEqual(firedOf(payload), { 'Substantive review decisions': 1, 'Integration repair cycles': 1 });
    assert.deepEqual(payload.bounds.find((b) => b.bound === 'Substantive review decisions')?.outcomes, { DONE: 1, STOP: {}, open: 0 });

    const narrowed = cli(dir, ['bounds', '--goal', 'g-bounds-b']);
    assert.equal(narrowed.status, 0, narrowed.stderr);
    const narrow = JSON.parse(narrowed.stdout) as Payload;
    assert.deepEqual(firedOf(narrow), { 'Integration repair cycles': 1 }, '--goal narrows to that goal and its runs');
    assert.deepEqual(narrow.extensions, [{ goalId: 'g-bounds-b', count: 0 }]);

    const human = cli(dir, ['--no-json', 'bounds', '--goal', 'g-bounds-b']);
    assert.equal(human.status, 0, human.stderr);
    assert.equal(human.stdout, 'Bounds: Integration repair cycles 1 (DONE 0, open 1)\nExtensions: none\n');

    const unknown = cli(dir, ['bounds', '--goal', 'g-missing']);
    assert.equal(unknown.status, 1);
    assert.equal(unknown.stderr, 'aidlc: unknown goal g-missing\n');
    const odd = cli(dir, ['bounds', '--goal', 'g-é\u001b[31m']);
    assert.equal(odd.status, 1);
    assert.equal(odd.stderr, 'aidlc: --goal is not a goal id\n', 'a non-plain value is never echoed');

    const badFile = path.join(dir, 'cards', 'g-bounds-b', 'T1-BAD.json');
    writeFileSync(badFile, JSON.stringify({ goalId: 'g-bounds-b', cardId: 'T1-BAD' }), 'utf8');
    const beforeBad = snapshot(dir);
    for (const args of [['bounds'], ['bounds', '--goal', 'g-bounds-b']]) {
      const bad = cli(dir, args);
      assert.equal(bad.status, 1, args.join(' '));
      assert.equal(bad.stderr, `aidlc: cannot read ${JSON.stringify(badFile)}: SCHEMA_VIOLATION\n`, 'names the file and the code');
      assert.doesNotMatch(bad.stderr, /\n\s+at /, 'no stack trace');
    }
    assert.deepEqual(snapshot(dir), beforeBad, 'the failing reads wrote nothing');
    writeFileSync(path.join(dir, 'goals', 'g-bounds-c.json'), '{', 'utf8');
    const malformed = cli(dir, ['bounds']);
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stderr, `aidlc: cannot read ${JSON.stringify(path.join(dir, 'goals', 'g-bounds-c.json'))}: MALFORMED_JSON\n`);

    // The successful reads above wrote nothing either: only the two files this test added differ.
    const after = snapshot(dir);
    delete after[path.relative(dir, badFile)];
    delete after[path.join('goals', 'g-bounds-c.json')];
    assert.deepEqual(after, before, 'the state directory is byte-identical afterwards');
  } finally {
    cleanup(dir);
  }
});
