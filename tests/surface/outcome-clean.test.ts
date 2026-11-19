// Card T1-REPLAY-CLEAN: the confirmed clean cases of the reviewer bench (evals/review/clean/), chosen by the seeded rule of bench/outcome/clean.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { cleanup, tmpDir } from '../infra/helpers.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewBenchCase } from '../../src/core/types.ts';
import { parseCardText } from '../../src/artifacts/card.ts';
import { loadBenchCases } from '../../src/review/bench.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const clean = (): Promise<typeof import('../../bench/outcome/clean.ts')> => import('../../bench/outcome/clean.ts');
const C = (n: number): string => n.toString(16).padStart(40, '0');
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const byHash = (xs: string[]): string[] => [...xs].sort((a, b) => (sha(a) < sha(b) ? -1 : 1));
const draft = (card: string, n: number, candidate: number): ReviewBenchCase => ({ kind: 'clean', id: `${card}.g-${n}.clean`, candidate: C(candidate), base: C(999), card: { id: card, path: `specs/tasks/${card}.md` }, confirmed: false, origin: `${card} clean` });
interface Facts { cardStatus: string | undefined; supersededBy: string | undefined; scorable: boolean; replayCandidate: boolean }
const ok: Facts = { cardStatus: 'merged', supersededBy: undefined, scorable: true, replayCandidate: false };

test('T1-REPLAY-CLEAN acceptance 1: selectClean keeps merged cards with no successor, one per card, ordered by the sha256 of the id, with distinct candidates', async () => {
  const { selectClean, CLEAN_RULE } = await clean();
  assert.match(CLEAN_RULE, /no person checked this case$/);
  const eligible = Array.from({ length: 20 }, (_, i) => draft(`T1-OK-${i}`, 1, 100 + i));
  const second = draft('T1-OK-0', 2, 300); // a second draft of T1-OK-0, larger id
  const repeated = draft('T1-REPEAT', 1, 100); // the candidate of T1-OK-0
  const excluded: Array<[ReviewBenchCase, Partial<Facts>]> = [
    [draft('T1-OPEN', 1, 201), { cardStatus: 'todo' }],
    [draft('T1-GONE', 1, 202), { cardStatus: undefined }],
    [draft('T1-SUCC', 1, 203), { supersededBy: 'T1-SUCC-2' }],
    [draft('T1-BIG', 1, 204), { scorable: false }],
    [draft('T1-REPLAY', 1, 205), { replayCandidate: true }],
  ];
  const facts = new Map<string, Facts>(excluded.map(([d, f]) => [d.id, { ...ok, ...f }]));
  const drafts = [...excluded.map(([d]) => d), second, ...eligible, repeated];
  const result = selectClean(drafts, (d) => facts.get(d.id) ?? ok);
  // T1-REPEAT shares T1-OK-0's candidate: whichever of the two comes first by hash is kept.
  const order = byHash([...eligible, repeated].map((d) => d.id));
  const seen = new Set<string>();
  const ids = order.filter((id) => { const c = [...eligible, repeated].find((d) => d.id === id)!.candidate; return !seen.has(c) && Boolean(seen.add(c)); }).slice(0, 40);
  assert.deepEqual(result.cases.map((c) => c.id), ids);
  assert.ok(result.cases.every((c) => c.confirmed && c.confirmedBy === CLEAN_RULE && c.kind === 'clean'));
  assert.equal(new Set(result.cases.map((c) => c.candidate)).size, 20);
  assert.equal(result.shortBy, 20);
  // Below the limit every eligible draft is returned, so each exclusion, the per-card choice and the candidate rule shows in the result.
  const few = Array.from({ length: 5 }, (_, i) => draft(`T1-FEW-${i}`, 1, 400 + i));
  const [small, large] = [draft('T1-TWO', 1, 410), draft('T1-TWO', 2, 411)]; // one card, distinct candidates; T1-TWO.g-1 < T1-TWO.g-2
  const dup = draft('T1-DUP', 1, 400); // the candidate of T1-FEW-0
  const bug = { ...draft('T1-BUG', 1, 420), kind: 'bug', expected: [{ file: 'src/a.ts', line: 1, window: 0, class: 'dim-1' }] } as ReviewBenchCase;
  const kept = sha(dup.id) < sha(few[0]!.id) ? dup : few[0]!;
  const want = byHash([kept, ...few.slice(1), small].map((d) => d.id));
  for (const input of [[...excluded.map(([d]) => d), bug, small, large, ...few, dup], [dup, ...few, large, small, bug, ...excluded.map(([d]) => d)]]) {
    const below = selectClean(input, (d) => facts.get(d.id) ?? ok);
    assert.deepEqual(below.cases.map((c) => c.id), want);
    assert.equal(below.shortBy, 40 - want.length);
  }
});

test('T1-REPLAY-CLEAN acceptance 2: selectClean reports how many it is short of 15', async () => {
  const { selectClean } = await clean();
  const drafts = [...Array.from({ length: 11 }, (_, i) => draft(`T1-OK-${i}`, 1, 100 + i)), draft('T1-OPEN', 1, 200)];
  const result = selectClean(drafts, (d) => (d.card.id === 'T1-OPEN' ? { ...ok, cardStatus: 'todo' } : ok));
  assert.deepEqual(result.cases.map((c) => c.id), byHash(drafts.slice(0, 11).map((d) => d.id)));
  assert.equal(result.shortBy, 29);
});

test('T1-REPLAY-CLEAN acceptance 3: evals/review/clean holds 15 confirmed clean cases on 15 distinct candidates, none a replay candidate, each card merged with no successor', async () => {
  const dir = path.join(root, 'evals', 'review', 'clean');
  assert.equal(readdirSync(dir).filter((n) => n.endsWith('.json')).length, 41);
  const { CLEAN_RULE } = await clean();
  const cases = loadBenchCases(dir);
  assert.equal(cases.length, 41);
  const replay = new Set(loadBenchCases(path.join(root, 'evals', 'review', 'replay')).map((c) => c.candidate));
  assert.equal(new Set(cases.map((c) => c.candidate)).size, 41);
  for (const c of cases) {
    assert.equal(c.kind, 'clean', c.id);
    assert.equal(c.confirmed, c.id !== R3_CASE, c.id);
    assert.equal(c.confirmedBy, CLEAN_RULE, c.id);
    assert.ok(!replay.has(c.candidate), `${c.id}: a replay candidate`);
    const file = path.join(root, 'specs', 'tasks', `${c.card.id}.md`);
    assert.ok(existsSync(file), `${c.id}: no card file`);
    const parsed = parseCardText(readFileSync(file, 'utf8'), file, { strict: false });
    assert.ok(!('error' in parsed), `${c.id}: card does not parse`);
    assert.equal(parsed.card.status, 'merged', c.id);
    assert.equal(parsed.card.superseded_by, undefined, c.id);
  }
});

const R3_CASE = 'T0-INTAKE-TARGET-2.g-20261107061914-d4ca11.clean';
const R3_NOTE = 'R4: BUG text that INCIDENT also matches gets kind incident (router.ts:138); R3: CR-only and U+2028 line breaks are not sentence boundaries (router.ts:43), so such text routes to staging';
const confirmedCase = (d: ReviewBenchCase): ReviewBenchCase => ({ ...d, confirmed: true, confirmedBy: 'main' });

test('T1-BENCH-CLEAN-40-2 acceptance 1: existing cases are kept and drafts are added in seeded order until 40 are confirmed, skipping held candidates', async () => {
  const { selectClean, WANT, CLEAN_RULE } = await clean();
  assert.equal(WANT, 40);
  const existing = [confirmedCase(draft('T1-HELD-A', 1, 1)), confirmedCase(draft('T1-HELD-B', 1, 2)), confirmedCase(draft('T1-HELD-C', 1, 3)), draft('T1-HELD-U', 1, 4)];
  const eligible = Array.from({ length: 50 }, (_, i) => draft(`T1-NEW-${i}`, 1, 100 + i));
  // Each is skipped: the held cases' own drafts, a held candidate (confirmed or not), and a held card on a new candidate.
  const skipped = [draft('T1-HELD-A', 1, 1), draft('T1-HELD-U', 1, 4), draft('T1-ON-HELD', 1, 2), draft('T1-ON-UNCONFIRMED', 1, 4), draft('T1-HELD-B', 0, 500)];
  const result = selectClean([...skipped, ...eligible], () => ok, existing);
  assert.deepEqual(result.cases.slice(0, 4), existing);
  assert.deepEqual(result.cases.slice(4).map((c) => c.id), byHash(eligible.map((d) => d.id)).slice(0, 37));
  assert.ok(result.cases.slice(4).every((c) => c.confirmed && c.confirmedBy === CLEAN_RULE));
  assert.equal(result.cases.filter((c) => c.confirmed).length, 40);
  assert.equal(result.shortBy, undefined);
  const few = selectClean([...skipped, ...eligible.slice(0, 5)], () => ok, existing);
  assert.deepEqual(few.cases.slice(4).map((c) => c.id), byHash(eligible.slice(0, 5).map((d) => d.id)));
  assert.equal(few.shortBy, 32);
  const full = Array.from({ length: 41 }, (_, i) => confirmedCase(draft(`T1-FULL-${i}`, 1, 600 + i)));
  assert.deepEqual(selectClean(eligible, () => ok, full), { cases: full, eligible: 50 });
});

test('T1-BENCH-CLEAN-40-2 acceptance 2: --extend writes only added files and a plain run on a non-empty directory is refused', async () => {
  const { selectClean, writeClean } = await clean();
  const tmp = tmpDir('aidlc-clean-40-'), dir = path.join(tmp, 'clean');
  try {
    const drafts = Array.from({ length: 3 }, (_, i) => draft(`T1-NEW-${i}`, 1, 100 + i));
    const select = (existing: ReviewBenchCase[]) => selectClean(drafts, () => ok, existing);
    assert.ok('written' in writeClean(tmpDir('empty-', tmp), false, () => ({ cases: [], eligible: 0 })), 'a plain run on an empty directory is not refused');
    const first = writeClean(dir, false, select);
    assert.ok('written' in first, 'a plain run with no directory writes');
    assert.deepEqual([...first.written].sort(), drafts.map((d) => d.id).sort());
    const held = Object.fromEntries(readdirSync(dir).map((n) => [n, readFileSync(path.join(dir, n), 'utf8')]));
    writeFileSync(path.join(dir, `${drafts[0]!.id}.json`), `${JSON.stringify({ ...drafts[0], note: 'hand edit' }, null, 2)}\n`);
    held[`${drafts[0]!.id}.json`] = readFileSync(path.join(dir, `${drafts[0]!.id}.json`), 'utf8');
    let called = false;
    const refused = writeClean(dir, false, (e) => ((called = true), select(e)));
    assert.ok('refused' in refused && !called, 'a plain run on a non-empty directory is refused before selecting');
    drafts.push(draft('T1-NEW-3', 1, 103), draft('T1-NEW-4', 1, 100));
    const extended = writeClean(dir, true, select);
    assert.ok('written' in extended);
    assert.deepEqual(extended.written, ['T1-NEW-3.g-1.clean']);
    for (const [name, text] of Object.entries(held)) assert.equal(readFileSync(path.join(dir, name), 'utf8'), text, name);
    assert.deepEqual(readdirSync(dir).sort(), [...Object.keys(held), 'T1-NEW-3.g-1.clean.json'].sort());
  } finally { cleanup(tmp); }
});

test('T1-BENCH-CLEAN-40-2 acceptance 3: evals/review/clean/ holds 40 confirmed cases on distinct candidates plus the unconfirmed case of R3, and the other 14 files of main are byte-identical', async () => {
  const dir = path.join(root, 'evals', 'review', 'clean');
  const { CLEAN_RULE } = await clean();
  const cases = loadBenchCases(dir);
  assert.equal(readdirSync(dir).length, 41);
  assert.equal(cases.filter((c) => c.confirmed && c.confirmedBy === CLEAN_RULE && c.kind === 'clean').length, 40);
  assert.equal(new Set(cases.map((c) => c.candidate)).size, 41);
  const r3 = cases.find((c) => c.id === R3_CASE);
  assert.equal(r3?.confirmed, false);
  assert.equal(r3?.note, R3_NOTE);
  const main: Record<string, string> = {
    'T0-BENCH-DRAFTS-IGNORE-2.g-20261113192241-bc89c5': '8bf9ed18cad96726386208e75a5c56b3f8f6dcb61e1aa4b3880fd8a4b22dddc5',
    'T0-BOARD-OWNER-WAIT.g-20261110004006-d26e06': '56f356faae44b208a2665fac5b29539311afdc39abee80e299ae6870090a6b23',
    'T0-EDGE-SCOPE.g-20261110002415-636259': 'df72cbec8823640b81a12979b40ab270a5459c9ffa5ad73d5ac26ebb1f66983d',
    'T0-EVAL-TEST-TEMP.g-20261110042730-ae66fa': '072884c3c7ebfd7b1144945accd17b03d23a03420aa7eda7f913c6f4f4661e1a',
    'T0-HOOK-CLASSIFIER-3.g-20260927185019-1b4266': '0b1b60901358267d50091d3d7d99fad9ff02620f963a0dd0e2a2f50287e07faf',
    'T0-LESSONS-TEST-RUN-ENV.g-20261107073339-f8808f': '9cceddb8c43d046b2114fe4b2687f9dac10fbca592acb235975af22bc549e3c7',
    'T0-MANIFEST-LOCK.g-20261111055540-7e0044': '5e4c0e8283ea5c73e1e1365de25426cce106c4536131be746da6ea2a9d1d73f1',
    'T0-MERGED-VIEW-CHECK.g-20261107014429-8ad0cf': 'ae3d029f0115933ea46e7a44deb565fb7bda015773de0c31c425f54f8d088039',
    'T0-OPS-INTENT-KIND.g-20261107012016-84da8b': 'b50b646ecb6618f37aa5a22356dafbfdeab119d2b9d747525802f660a3326c91',
    'T0-PROD-GATE-GENERATION.g-20261111204133-83a5b6': '2dd5b751c9e76f8668f0590851c016a136f231518ae89b7431760cccce1c1fa2',
    'T0-R2-OFF.g-20261106222641-3df166': 'f887843441a9f7539144ba3dd62bcde491a1a80987fe867e24a9e2340b772fa0',
    'T1-EFF-AGENTS-DOD.g-20261019092137-6fcee2': '4b114b41dcea54e075cf291890dff2c4040ad21d8d933ffabfcf4376334a81c4',
    'T1-SWEEP2-EXTEND-REASON.g-20261014085120-fa9517': '1593d10319be38531e05d77edb7dc0ec1a2b9d85be3e34cf28f47dfad4119f47',
    'T1-VERIFY-SKILL.g-20261023072913-94f64f': '5c9931b158d0192e9929ee6923d291f2de097d18114c7d65727c3552bb4201bc',
  };
  for (const [id, hash] of Object.entries(main)) assert.equal(createHash('sha256').update(readFileSync(path.join(dir, `${id}.clean.json`))).digest('hex'), hash, id);
});
