// Card T1-REPLAY-CLEAN: the confirmed clean cases of the reviewer bench (evals/review/clean/), chosen by the seeded rule of bench/outcome/clean.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  const ids = order.filter((id) => { const c = [...eligible, repeated].find((d) => d.id === id)!.candidate; return !seen.has(c) && Boolean(seen.add(c)); }).slice(0, 15);
  assert.deepEqual(result.cases.map((c) => c.id), ids);
  assert.ok(result.cases.every((c) => c.confirmed && c.confirmedBy === CLEAN_RULE && c.kind === 'clean'));
  assert.equal(new Set(result.cases.map((c) => c.candidate)).size, 15);
  assert.equal(result.shortBy, undefined);
});

test('T1-REPLAY-CLEAN acceptance 2: selectClean reports how many it is short of 15', async () => {
  const { selectClean } = await clean();
  const drafts = [...Array.from({ length: 11 }, (_, i) => draft(`T1-OK-${i}`, 1, 100 + i)), draft('T1-OPEN', 1, 200)];
  const result = selectClean(drafts, (d) => (d.card.id === 'T1-OPEN' ? { ...ok, cardStatus: 'todo' } : ok));
  assert.deepEqual(result.cases.map((c) => c.id), byHash(drafts.slice(0, 11).map((d) => d.id)));
  assert.equal(result.shortBy, 4);
});

test('T1-REPLAY-CLEAN acceptance 3: evals/review/clean holds 15 confirmed clean cases on 15 distinct candidates, none a replay candidate, each card merged with no successor', async () => {
  const dir = path.join(root, 'evals', 'review', 'clean');
  assert.equal(readdirSync(dir).filter((n) => n.endsWith('.json')).length, 15);
  const { CLEAN_RULE } = await clean();
  const cases = loadBenchCases(dir);
  assert.equal(cases.length, 15);
  const replay = new Set(loadBenchCases(path.join(root, 'evals', 'review', 'replay')).map((c) => c.candidate));
  assert.equal(new Set(cases.map((c) => c.candidate)).size, 15);
  for (const c of cases) {
    assert.equal(c.kind, 'clean', c.id);
    assert.equal(c.confirmed, true, c.id);
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
