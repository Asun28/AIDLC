import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Directive } from '../../src/loop/directive.ts';

// Card T0-UNATTENDED-RUNS: OPERATIONS.md documents /goal and /loop over `aidlc next`, and every DoD receipt example names the test count.
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]): string => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

const GOAL_PROMPT =
  '/goal Drive aidlc goal <id>: run `aidlc next --goal <id>`, do that directive, then `aidlc report`. Met when the latest `aidlc next` JSON shown in this conversation has "kind" of "done", "stop", "ask", "checkpoint" or "wait"; print that JSON line as the last line of your reply. Stop after 40 turns and name the next directive.';
const LOOP_PROMPT =
  '/loop Run `aidlc next --goal <id>`. While "kind" is "wait", wait until its `until` (or `pollSeconds`). When it is anything else, show that JSON and stop this loop.';
const GOAL_KINDS = ['done', 'stop', 'ask', 'checkpoint', 'wait'];

describe('T0-UNATTENDED-RUNS', () => {
  it('docs/OPERATIONS.md carries the /goal condition and its three rules (acceptance 1)', () => {
    const ops = read('docs', 'OPERATIONS.md');
    for (const sentence of [
      GOAL_PROMPT,
      'The goal ends on `wait` because a turn that only repeats `aidlc next` during a quota hold or a running CI job spends tokens and changes nothing; `ask`, `checkpoint` and `stop` need a person.',
      '`/goal` grants no permission and changes no gate: the hooks, the review allowances and the deadlines apply to each goal turn as they do to a prompted one, and turns run unattended only in a permission mode that already allows their tool calls.',
      'While a background command such as `aidlc review pre` is still running at the end of a turn, the evaluation of that turn is skipped; Claude Code delivers the result as a new turn, so the condition is judged after the result is read.',
    ]) {
      assert.ok(ops.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    }
  });

  it('every kind the /goal condition names is a Directive kind, and the /loop prompt names fields of the wait directive (acceptance 2)', () => {
    const kinds = Directive.options.map((o) => o.shape.kind.value as string);
    for (const kind of GOAL_KINDS) {
      assert.ok(kinds.includes(kind), `${kind} is a Directive kind`);
      assert.ok(GOAL_PROMPT.includes(`"${kind}"`), `the /goal condition names ${kind}`);
    }
    const wait = Directive.options.find((o) => o.shape.kind.value === 'wait');
    assert.ok(wait, 'the Directive schema has a wait kind');
    for (const field of ['until', 'pollSeconds']) {
      assert.ok(field in wait.shape, `${field} is a field of the wait directive`);
      assert.ok(LOOP_PROMPT.includes(`\`${field}\``), `the /loop prompt names ${field}`);
    }
  });

  it('docs/OPERATIONS.md carries the /loop prompt and the /schedule sentence (acceptance 3)', () => {
    const ops = read('docs', 'OPERATIONS.md');
    for (const sentence of [
      LOOP_PROMPT,
      'A `/schedule` cloud routine cannot drive a goal: it runs in a fresh clone of the repository, and `.aidlc/` is local to the main checkout and gitignored, so the routine sees no goal, lease or journal.',
    ]) {
      assert.ok(ops.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    }
  });

  it('every --dod-receipt example names an exit code and a pass count, and OPERATIONS.md says why (acceptance 4)', () => {
    for (const file of [['docs', 'OPERATIONS.md'], ['README.md']]) {
      const receipts = [...read(...file).matchAll(/--dod-receipt "([^"]*)"/g)].map((m) => m[1]!);
      assert.ok(receipts.length > 0, `${file.join('/')} shows a --dod-receipt example`);
      for (const receipt of receipts) {
        assert.match(receipt, /\bexit \d+\b/, `${file.join('/')} receipt "${receipt}" names the exit code`);
        assert.match(receipt, /\b\d+ pass(?:ed)?\b/, `${file.join('/')} receipt "${receipt}" names the pass count`);
      }
    }
    const sentence =
      'An exit code alone proves nothing about the tests: on Node 22, `node --test` exits 0 on a test file that holds no test (it reports `# tests 1` and `# pass 1`), on a file whose every test is skipped, and on a glob that matches no file; only a named file that does not exist exits 1.';
    assert.ok(read('docs', 'OPERATIONS.md').includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  });

  it('CHANGELOG.md Unreleased carries the entry under the card id (acceptance 5)', () => {
    const changelog = read('CHANGELOG.md');
    const start = changelog.indexOf('## Unreleased');
    const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
    for (const sentence of [
      '- Unattended runs, card T0-UNATTENDED-RUNS: `docs/OPERATIONS.md` documents a `/goal` condition that drives a goal through `aidlc next` and `aidlc report` until the latest directive is `done`, `stop`, `ask`, `checkpoint` or `wait`, and a self-paced `/loop` that waits on a `wait` directive by its `until` or `pollSeconds`; a `/schedule` cloud routine cannot drive a goal, since `.aidlc/` is local and gitignored.',
      'Every `--dod-receipt` example in `docs/OPERATIONS.md` and `README.md` names the test count, since `node --test` exits 0 on a file with no test, on a file whose every test is skipped and on a glob that matches no file.',
    ]) {
      assert.ok(unreleased.includes(sentence), `CHANGELOG.md Unreleased states: ${sentence}`);
    }
  });
});
