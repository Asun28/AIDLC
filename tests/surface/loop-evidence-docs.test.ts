// Card T1-EVIDENCE-DOCS: CHANGELOG.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md describe the loop-run DoD record of
// T1-DOD-RECORD-2, and both implementer agent copies tell the worker to run a successful attempt with the 10-minute shell timeout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { changelogSince010 } from '../infra/changelog.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const E1 =
  "- T1-DOD-RECORD-2: `aidlc card attempt <card> --outcome success`, once every refusal of a success has passed, runs the card's `dod_command` in the card worktree through the platform shell, as the mutant sweep runs it, and stores on the attempt the record `loopDod`: the commit and whether the worktree was clean (when the call's candidate probe read them), the exit code, or a timeout after 9 minutes (`LOOP_DOD_TIMEOUT_MS`), at which the runner's existing tree kill ends the DoD (when the root has already exited at the timeout, or `taskkill`, `ps` or the tree helper fails, a process of the DoD can remain), the expected exit (`dod_exit`), the duration, the sha256 of the output and its last 4096 bytes; a run with no worktree directory records the DoD as not run. The record changes no card state, outcome or allowance, and the worker's `--dod-receipt` is still required. `aidlc card status` prints a `loopDod=` line that says `DIFFERS` when the exit is not `dod_exit`, and `loopDod=-` when no attempt has a record, as for a run written before this card. Both implementer agent copies tell the worker to run that command with the shell tool's timeout at its 10-minute maximum (card T1-EVIDENCE-DOCS).";
const O1 =
  "Loop-run DoD record (card T1-DOD-RECORD-2). When `aidlc card attempt <card> --outcome success` has passed every refusal of a success (a dirty worktree, a missing receipt, a mutant marker), the loop runs the card's `dod_command` once in the card worktree, through the platform shell as the mutant sweep runs it, and stores the record `loopDod` on that attempt: the commit and whether the worktree was clean (from the same call's candidate probe, when it read them), the exit code, the expected exit (`dod_exit`), the duration, the sha256 of stdout, one 0x00 byte and stderr, and the last 4096 bytes of stdout followed directly by stderr, decoded as UTF-8. A DoD that has not ended after 9 minutes (`LOOP_DOD_TIMEOUT_MS`) is ended by the tree kill the runner already applies to a timed-out command (`killProcessTree`, src/probes/exec.ts), and the record holds `timedOut: true` with no exit code; when the root has already exited at the timeout, or `taskkill`, `ps` or the tree helper fails, a process of the DoD can remain, and no card of this goal adds cleanup for those cases. A run that names no worktree directory records `ran: false` with the reason and starts nothing. The record changes no card state, outcome or allowance: the DoD receipt above is still what the card machine requires, and an exit that differs from `dod_exit` stops nothing. `aidlc card status <card>` prints the record of the last attempt that has one on a `loopDod=` line after the `lease=` line, with `DIFFERS` when the exit is not `dod_exit` or the DoD timed out, and `loopDod=-` when no attempt has one, as for a run written before this card. A worker runs `card attempt --outcome success` with its shell tool's timeout at the 10-minute maximum, since a call stopped earlier ends the command and records nothing (`.claude/agents/implementer.md`, step 3).";
const A1 =
  'the loop-run DoD record `loopDod` of a successful attempt (card T1-DOD-RECORD-2: commit, clean worktree, exit code or timeout, expected exit, duration, output sha256 and tail, or not run with its reason; it changes no state),';
const I1 = [
  "   Run `aidlc card attempt <id> --outcome success` with the shell tool's",
  '   timeout at its 10-minute maximum (600000 ms): the command runs the DoD',
  '   again for up to 9 minutes, and a call stopped before it ends records',
  '   nothing.',
];

/** E1 stands once, under `## Unreleased` with no heading between, with an empty line directly before and after it. */
function changelogHolds(text: string): boolean {
  const part = changelogSince010(text.replace(/\r\n/g, '\n'));
  if (part === '' || text.split(E1).length !== 2) return false;
  const lines = part.split('\n');
  const u = lines.indexOf('## Unreleased');
  const e = lines.indexOf(E1);
  if (u === -1 || e <= u || lines.slice(u + 1, e).some((l) => l.startsWith('## '))) return false;
  return lines[e - 1] === '' && lines[e + 1] === '';
}

const F = ['# Changelog', '', '## Unreleased', '', E1, '', '## 0.2.0 - 2026-11-14', '', '- an older entry', '', '## 0.1.0 - 2026-09-11', '', '- the first entry'];
const fixture = (lines: string[]) => `${lines.join('\n')}\n`;
const at = (lines: string[], i: number, ...insert: string[]) => [...lines.slice(0, i), ...insert, ...lines.slice(i)];
const without = (lines: string[], i: number, count = 1) => [...lines.slice(0, i), ...lines.slice(i + count)];

test('CHANGELOG.md carries the entry under Unreleased, above the 0.2.0 section', () => {
  const rows = [
    read('CHANGELOG.md'),
    fixture(F),
    fixture(at(F, 4, '- another entry', '')),
    fixture(without(F, 5)),
    fixture(at(without(F, 4, 2), 6, E1, '')),
    fixture(at(F, 10, E1, '')),
    fixture(without(F, 10)),
    fixture(at(F, 6, '- another entry', '')),
  ];
  assert.deepEqual(rows.map(changelogHolds), [true, true, true, false, false, false, false, true]);
});

test('OPERATIONS.md carries the loop-run DoD paragraph after the DoD receipt paragraph', () => {
  const lines = read('docs/OPERATIONS.md').split('\n');
  assert.equal(lines.filter((l) => l === O1).length, 1, 'O1 stands once');
  const i = lines.indexOf(O1);
  assert.deepEqual([lines[i - 1], lines[i - 2]?.startsWith('A DoD receipt names the command'), lines[i + 1], lines[i + 2]], ['', true, '', '### T1 feature']);
});

test('ARCHITECTURE.md names the DoD run record in the card-run row', () => {
  const row = read('docs/ARCHITECTURE.md').split('\n').find((l) => l.startsWith('| `cards/<goalId>/<cardId>.json` | '));
  assert.ok(row?.includes(`receipts, ${A1} closure flags`), 'the card-run row carries A1 between receipts and closure flags');
});

test('both implementer agents run a successful attempt with the 10-minute shell timeout', () => {
  for (const file of ['.claude/agents/implementer.md', 'templates/claude/agents/implementer.md']) {
    const text = read(file);
    assert.match(text, /^[\x00-\x7f]*$/, `${file} is ASCII`);
    const lines = text.split('\n');
    const step3 = lines.findIndex((l) => l.startsWith('3. Run'));
    assert.deepEqual(lines.slice(step3 + 1, step3 + 5), I1, `${file}: I1 follows step 3`);
    assert.ok(lines[step3 + 5]?.startsWith('4. Never edit test files'), `${file}: step 4 follows I1`);
  }
});
