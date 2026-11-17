// Card T0-GUARD-SWEEP: both implementer agent copies tell the worker to sweep each guard its change adds (step 2 and the report),
// both tdd skill copies carry a `## Guards` section between Seams and Anti-patterns, and the changelog fragment holds its entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fragmentEntry } from '../infra/changelog.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const bytes = (file: string) => readFileSync(path.join(ROOT, file));

const G1 = [
  "   Then sweep each guard the change adds, as the tdd skill's Guards section",
  "   says, and list the sweep in the card's Attempt evidence table.",
];
const G2 = [
  '- the guard sweep: each guard the change adds, its loosened form and the',
  '  test that failed, or `equivalent:` and why no input can tell them apart.',
];
const GUARDS = [
  '## Guards',
  'A guard the change adds (a bound or comparison, a regex class, quantifier',
  'or anchor, an early return, a filter, sort or dedupe) is behaviour of the',
  "acceptance item it serves: test it at that item's seam. Before the first",
  'review, loosen each guard in turn, run its test file, see a test fail,',
  'then restore it. A guard no test catches gets an assertion there; a',
  'loosened form no input can detect is recorded as `equivalent:` with why.',
];
const FRAGMENT =
  '- T0-GUARD-SWEEP: before the first review the implementer loosens each guard its change adds, one at a time, and sees a test fail. Both copies of `implementer.md` add the sweep to step 2 and to the report, and both copies of the tdd skill gain a `## Guards` section: a guard the change adds (a bound or comparison, a regex class, quantifier or anchor, an early return, a filter, sort or dedupe) is tested at the seam of the acceptance item it serves, each guard is loosened in turn and its test file run until a test fails, then restored, and a loosened form no input can detect is recorded as `equivalent:`. Of the 40 most recently reviewed cards before this change, 6 of 33 blocking R3 decisions held only untested-guard findings.';

const STEP2_LINE2 = '   a diff over about 200 lines not mandated by the card means stop and ask.';
const REPORT_LAST = '  checks gained/lost, next hypothesis.';

/** The index of the one line of `lines` equal to `line`; fails when it stands other than once. */
function onlyIndex(lines: string[], line: string, label: string): number {
  assert.equal(lines.filter((l) => l === line).length, 1, `${label}: "${line}" stands once`);
  return lines.indexOf(line);
}

/** The two files are byte-equal, ASCII and use LF line endings only; returns the lines of the first. */
function sameAsciiLf(a: string, b: string): string[] {
  const left = bytes(a);
  assert.ok(left.equals(bytes(b)), `${a} and ${b} are byte-equal`);
  const text = left.toString('latin1');
  assert.match(text, /^[\x00-\x7f]*$/, `${a} is ASCII`);
  assert.equal(text.includes('\r'), false, `${a} has LF line endings only`);
  return text.split('\n');
}

test('T0-GUARD-SWEEP acceptance 1 - both implementer copies carry the guard sweep in step 2 and in the report', () => {
  const files = ['.claude/agents/implementer.md', 'templates/claude/agents/implementer.md'];
  sameAsciiLf(files[0], files[1]);
  for (const file of files) {
    const lines = bytes(file).toString('latin1').split('\n');
    const s = onlyIndex(lines, STEP2_LINE2, file);
    assert.ok(lines[s - 1]?.startsWith('2. GREEN'), `${file}: the anchor is the second line of step 2`);
    assert.deepEqual(lines.slice(s + 1, s + 3), G1, `${file}: G1 follows the second line of step 2`);
    assert.ok(lines[s + 3]?.startsWith('3. Run'), `${file}: step 3 follows G1`);
    const r = onlyIndex(lines, REPORT_LAST, file);
    assert.deepEqual(lines.slice(r + 1, r + 3), G2, `${file}: G2 follows the report bullet`);
    assert.equal(lines[r + 3], 'Do not claim done; the loop verifies and ships.', `${file}: the closing line follows G2`);
  }
});

test('T0-GUARD-SWEEP acceptance 2 - both tdd skill copies carry the Guards section between Seams and Anti-patterns within the cap', () => {
  const files = ['.claude/skills/tdd/SKILL.md', 'templates/claude/skills/tdd/SKILL.md'];
  sameAsciiLf(files[0], files[1]);
  for (const file of files) {
    const buf = bytes(file);
    assert.ok(buf.length <= 3500, `${file} is at most 3500 bytes (is ${buf.length})`);
    const lines = buf.toString('latin1').split('\n');
    const g = onlyIndex(lines, '## Guards', file);
    const end = lines.indexOf('', g);
    assert.ok(end > g, `${file}: a blank line ends the Guards section`);
    assert.deepEqual(lines.slice(g, end), GUARDS, `${file}: the Guards section, whole`);
    assert.deepEqual(lines.slice(g - 2, g), ['  placement (new units get new files).', ''], `${file}: Seams ends right before Guards`);
    assert.deepEqual(lines.slice(end, end + 2), ['', '## Anti-patterns (a fake RED)'], `${file}: Anti-patterns follows Guards`);
  }
});

test('T0-GUARD-SWEEP acceptance 3 - the fragment holds its entry', () => {
  assert.equal(fragmentEntry(ROOT, 'T0-GUARD-SWEEP'), FRAGMENT);
});
