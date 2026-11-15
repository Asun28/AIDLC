// Card T1-OUTCOME-REPLAY: the recall baseline's bug cases (evals/review/replay/) and its runs (bench/outcome/replay-main.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FinalRow } from '../../bench/outcome/adjudicate.ts';
import { AGREED, assembleReplay, OWNER, planReplay, trialCases, trialEntry, type AssembleInput, type Report, type TrialCase } from '../../bench/outcome/replay.ts';
import type { ReviewBenchCase } from '../../src/core/types.ts';
import { loadBenchCases } from '../../src/review/bench.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const C = (n: number): string => n.toString(16).padStart(40, '0');
const row = (findingId: string, final: FinalRow['final'], source: FinalRow['source'], extra: Partial<FinalRow> = {}): FinalRow => ({ goalId: 'g1', cardId: 'T1-X', findingId, group: 'superseded', candidate: C(1), labelA: null, labelB: null, final, ownerRuled: false, left: null, source, adjudicator: null, ...extra });
const idOf = (r: { cardId: string; goalId: string; findingId: string }): string => `${r.cardId}.${r.goalId}.${r.findingId}`;
const draft = (r: FinalRow, extra: Partial<ReviewBenchCase> = {}): ReviewBenchCase => ({ kind: 'bug', id: idOf(r), candidate: r.candidate ?? C(1), base: C(999), card: { id: 'T1-X', path: 'specs/tasks/T1-X.md' }, confirmed: false, origin: 'o', expected: [{ file: 'src/a.ts', line: 3, window: 5, class: 'dim-1' }], ...extra } as ReviewBenchCase);
const qualifies = (r: FinalRow): boolean => (r.source === 'agreed' || r.source === 'owner') && r.final === 'true-defect';
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

test('a true-defect finding of both models or of the owner is a bug case, and every other draft is removed', () => {
  assert.equal(AGREED, 'two-model label agreement in bench/outcome/labels.jsonl under the owner\'s rule of 2026-11-14; no person checked this case');
  assert.equal(OWNER, 'the owner\'s label in the spot check of bench/outcome/labels-spotcheck.jsonl; no person checked this case');
  const fillers = Array.from({ length: 9 }, (_, i) => row(`X${i}`, 'true-defect', 'agreed', { candidate: C(10 + i) }));
  const [F1, F2, F3, F4, F5, F6] = [row('F1', 'true-defect', 'agreed'), row('F2', 'speculative', 'agreed'), row('F3', 'true-defect', 'owner'), row('F4', 'true-defect', 'adjudicator'), row('F5', 'speculative', 'adjudicator'), row('F6', 'true-defect', 'agreed')];
  const rows = [...fillers, F1, F2, F3, F4, F5, F6, row('F7', 'true-defect', 'owner'), row('clean', 'true-defect', 'agreed'), row('L1', null, null, { left: 'gone' })];
  const keep = [...fillers.map((r) => draft(r)), draft(F1), draft(F3)];
  const { expected: _e, ...clean } = draft(row('clean', null, null)) as Extract<ReviewBenchCase, { kind: 'bug' }>;
  const gone = [draft(F2), draft(F4), draft(F5), { ...clean, kind: 'clean' } as ReviewBenchCase, draft(row('F9', 'true-defect', 'agreed')), draft(F6)];
  const scorable = (c: ReviewBenchCase): boolean => c.id !== idOf(F6);
  const plan = planReplay({ rows, drafts: [...gone.slice(0, 3), ...keep, ...gone.slice(3)], scorable });
  assert.deepEqual(plan.write, keep.map((d) => ({ ...d, confirmed: true, confirmedBy: d.id === idOf(F3) ? OWNER : AGREED })));
  assert.deepEqual([...plan.remove].sort(), gone.map((d) => d.id).sort());
  assert.equal(plan.stop, undefined);
  assert.deepEqual([plan.counts.withoutDraft, plan.counts.notScorable, plan.counts.adjudicator, plan.counts.left], [1, 1, 2, 1]);
  assert.throws(() => planReplay({ rows: [...rows, row('F8', null, null)], drafts: keep, scorable }));
  assert.throws(() => planReplay({ rows, drafts: [...keep.slice(1), { ...draft(F1), confirmed: true, confirmedBy: 'x' }], scorable }));
});

test('the preflight stops below ten distinct candidates and prints the reviews and their spend', () => {
  const rows = [1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n, i) => row(`F${i}`, 'true-defect', 'agreed', { candidate: C(n) }));
  const drafts = rows.map((r, i) => draft(r, i === 3 ? { card: { id: 'T1-X', path: 'specs/tasks/other/T1-X.md' } } : {}));
  const nine = planReplay({ rows: rows.slice(0, 11), drafts: drafts.slice(0, 11), scorable: () => true });
  assert.match(nine.stop ?? '', /9 distinct candidates.*fewer than ten/);
  assert.deepEqual(nine.write, []);
  assert.deepEqual([nine.counts.cases, nine.counts.candidates, nine.counts.triples, nine.counts.reviews, nine.counts.spendUsd], [11, 9, 10, 40, 56]);
  const ten = planReplay({ rows, drafts, scorable: () => true });
  assert.equal(ten.stop, undefined);
  assert.deepEqual([ten.counts.candidates, ten.counts.triples, ten.counts.reviews, ten.counts.spendUsd], [10, 11, 41, 57.4]);
  const based = planReplay({ rows, drafts: drafts.map((d, i) => (i === 1 ? { ...d, base: C(998) } : d)), scorable: () => true }); // same candidate and card path, another base
  assert.deepEqual([based.counts.triples, based.counts.reviews, based.counts.spendUsd], [12, 42, 58.8]);
});

test('the ten trial cases come by the hash of the case id with distinct candidates', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `T1-X.g1.F${i}`);
  const byHash = (xs: string[]): string[] => [...xs].sort((a, b) => (sha(a) < sha(b) ? -1 : 1));
  // The first two by hash share a candidate, so the second of them is skipped.
  const make = (xs: string[]): ReviewBenchCase[] => xs.map((id, i) => draft(row(id.slice(8), 'true-defect', 'agreed'), { candidate: C(id === byHash(xs)[0] || id === byHash(xs)[1] ? 100 : 200 + i) }));
  const [s12, s6] = [byHash(ids), byHash(ids.slice(0, 6))];
  assert.deepEqual(trialCases(make(ids)).map((c) => c.id), [s12[0], ...s12.slice(2, 11)]);
  assert.deepEqual(trialCases(make(ids.slice(0, 6))).map((c) => c.id), [s6[0], ...s6.slice(2)]);
  const z = Array.from({ length: 64 }, (_, i) => `T1-X.g1.Z${i}`).find((id) => sha(id) < sha(s6[0]!))!; // a clean case first by hash, on its own candidate
  assert.deepEqual(trialCases([...make(ids.slice(0, 6)), { ...draft(row('Z', null, null)), id: z, kind: 'clean', candidate: C(300) } as ReviewBenchCase]).map((c) => c.id), [s6[0], ...s6.slice(2)]);
});

test('the committed replay cases agree with labels-final.jsonl', () => {
  const dir = path.join(root, 'evals', 'review', 'replay');
  assert.ok(existsSync(dir), 'evals/review/replay/ exists');
  const rows = readFileSync(path.join(root, 'bench', 'outcome', 'labels-final.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as FinalRow);
  const byId = new Map(rows.filter(qualifies).map((r) => [idOf(r), r]));
  const cases = loadBenchCases(dir);
  assert.equal(cases.length, readdirSync(dir).length);
  for (const c of cases) {
    const r = byId.get(c.id);
    assert.ok(c.kind === 'bug' && c.confirmed && r, `${c.id} is a confirmed bug case of a qualifying row`);
    assert.equal(c.confirmedBy, r.source === 'owner' ? OWNER : AGREED);
  }
  assert.ok(new Set(cases.map((c) => c.candidate)).size >= 10);
});

const implied: Record<string, string> = { hit: 'block', 'no-verdict': 'no-verdict' };
type Saved = Report & { cases: TrialCase[]; totals: Record<string, number> };
const KEEP = ['id', 'kind', 'confirmed', 'outcome', 'runStatus', 'detail', 'durationMs'];
const reduce = (c: object): object => Object.fromEntries(KEEP.filter((k) => k in c).map((k) => [k, (c as Record<string, unknown>)[k]]));
const reducedKeys = (c: object): boolean => Object.keys(c).join() === KEEP.filter((k) => k in c).join();

test('replay-main.json is one formal run over every replay case and three trials of the ten', () => {
  const file = path.join(root, 'bench', 'outcome', 'replay-main.json');
  assert.ok(existsSync(file), 'bench/outcome/replay-main.json exists');
  const text = readFileSync(file, 'utf8');
  assert.ok(!text.includes('\r') && text.endsWith('}\n'));
  assert.ok(Buffer.byteLength(text, 'utf8') < 200000, 'replay-main.json is under 200000 bytes');
  const v = JSON.parse(text) as { commit: string; policyHash: string; reports: Record<string, string>; run: Saved; trials: Array<{ case: string; outcomes: string[]; agree: boolean; verdicts: string[]; verdictAgree: boolean; report: Saved }>; leftOut: { candidateGone: number; trueDefectWithoutCase: number } };
  assert.deepEqual(Object.keys(v), ['commit', 'policyHash', 'reports', 'run', 'trials', 'leftOut']);
  assert.match(v.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(v.reports), ['run', ...v.trials.map((t) => t.case)]);
  assert.ok(Object.values(v.reports).every((h) => /^[0-9a-f]{64}$/.test(h)), 'each report hash is 64 lowercase hex');
  for (const r of [v.run, ...v.trials.map((t) => t.report)]) assert.ok([r.cases, ...r.trialResults.map((t) => t.cases)].flat().every(reducedKeys), 'every case result is reduced');
  const count = (o: string): number => v.run.cases.filter((c) => c.outcome === o).length;
  assert.deepEqual([v.run.totals['hits'], v.run.totals['misses'], v.run.totals['noVerdict'], v.run.totals['errors']], [count('hit'), count('miss'), count('no-verdict'), count('error')]);
  assert.deepEqual(v.run.trialResults.map((t) => t.cases), [v.run.cases]);
  const cases = loadBenchCases(path.join(root, 'evals', 'review', 'replay'));
  const runCases = v.run.trialResults[0]!.cases;
  assert.ok(v.run.stage === 'formal' && v.run.trialResults.length === 1 && v.run.leftCheckouts.length === 0 && v.policyHash === v.run.policyHash);
  assert.ok(runCases.every((c) => c.outcome !== 'error' && c.detail !== 'not reviewed: a quota hold stopped the run'));
  assert.deepEqual(runCases.map((c) => c.id).sort(), cases.map((c) => c.id).sort());
  assert.deepEqual(v.trials.map((t) => t.case), trialCases(cases).map((c) => c.id));
  for (const t of v.trials) {
    assert.ok(t.report.trialResults.length === 3 && t.report.trialResults.every((r) => r.cases.length === 1 && r.cases[0]!.id === t.case) && t.report.policyHash === v.policyHash);
    const outcomes = t.report.trialResults.map((r) => r.cases[0]!.outcome);
    assert.deepEqual([t.outcomes, t.agree], [outcomes, outcomes.every((o) => o === outcomes[0])]);
    assert.ok(t.verdicts.every((x, i) => ['pass', 'block', 'no-verdict'].includes(x) && (outcomes[i] === 'miss' || x === implied[outcomes[i]!])));
    assert.equal(t.verdictAgree, t.verdicts.every((x) => x === t.verdicts[0]));
  }
  const rows = readFileSync(path.join(root, 'bench', 'outcome', 'labels-final.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as FinalRow);
  const ids = new Set(cases.map((c) => c.id));
  assert.equal(v.leftOut.trueDefectWithoutCase, rows.filter((r) => qualifies(r) && !ids.has(idOf(r))).length);
  assert.ok(Number.isInteger(v.leftOut.candidateGone) && v.leftOut.candidateGone >= rows.filter((r) => r.candidate === null).length && v.leftOut.candidateGone <= rows.length);
});

const report = (id: string, outcomes: string[], extra: Partial<TrialCase> = {}): Report => ({ stage: 'formal', policyHash: 'h', leftCheckouts: [], trialResults: outcomes.map((outcome, i) => ({ cases: [{ id, outcome, verdictRef: `${id}.${i}`, ...extra }] })) });
const docs = (m: Record<string, string>) => (ref: string): string | undefined => (m[ref] === undefined ? undefined : JSON.stringify({ outcome: m[ref] }));

test('a trial\'s verdicts come from its outcomes, and a miss from its retained document', () => {
  const a = trialEntry('A', report('A', ['miss', 'miss', 'miss']), docs({ 'A.0': 'pass', 'A.1': 'block', 'A.2': 'pass' }));
  assert.deepEqual([a.case, a.outcomes, a.agree, a.verdicts, a.verdictAgree], ['A', ['miss', 'miss', 'miss'], true, ['pass', 'block', 'pass'], false]);
  const b = trialEntry('A', report('A', ['hit', 'hit', 'miss']), docs({ 'A.2': 'block' }));
  assert.deepEqual([b.agree, b.verdicts, b.verdictAgree], [false, ['block', 'block', 'block'], true]);
  const c = trialEntry('A', report('A', ['hit', 'no-verdict', 'hit']), () => { throw new Error('read'); });
  assert.deepEqual(c.verdicts, ['block', 'no-verdict', 'block']);
  assert.throws(() => trialEntry('A', report('A', ['miss', 'hit', 'hit']), docs({})));
  assert.throws(() => trialEntry('A', report('A', ['miss', 'hit', 'hit']), docs({ 'A.0': 'no-verdict' })));
  assert.throws(() => trialEntry('A', report('A', ['pass', 'hit', 'hit']), docs({})));
});

test('assembly refuses each case of R8 before any write', () => {
  const cases = [draft(row('F1', 'true-defect', 'agreed')), draft(row('F2', 'true-defect', 'owner', { candidate: C(2) }))].map((c) => ({ ...c, confirmed: true, confirmedBy: AGREED }));
  const [A, B] = cases.map((c) => c.id) as [string, string];
  const build = (change: (o: { run: Report; trials: Record<string, Report>; input: AssembleInput }) => void = () => {}) => {
    const run: Report = { stage: 'formal', policyHash: 'h', leftCheckouts: [], trialResults: [{ cases: [{ id: A, outcome: 'hit', detail: 'kept' }, { id: B, outcome: 'miss', verdictRef: 'b' }] }] };
    const trials: Record<string, Report> = { [A]: report(A, ['hit', 'hit', 'hit'], { detail: 'kept' }), [B]: report(B, ['hit', 'no-verdict', 'hit']) };
    const rows = [row('F1', 'true-defect', 'agreed'), row('F2', 'true-defect', 'owner', { candidate: C(2) }), row('F3', 'true-defect', 'agreed'), row('F4', null, null, { candidate: null, left: 'gone' })];
    const input: AssembleInput = { status: '', commit: C(7), run: undefined, trials: {}, cases, rows, hasCommit: () => true, readDoc: docs({ b: 'pass', [`${B}.1`]: 'no-verdict' }), selfCheck: () => {} };
    change({ run, trials, input });
    // Whole case results, as the bench writes them: the removable keys in `cases` and in every `trialResults` element.
    const whole = (r: Report): string => { const results = r.trialResults.map((t) => ({ cases: t.cases.map((c) => ({ kind: 'bug', confirmed: true, runStatus: 'ran', cited: 'why', matched: ['m'], verdictRef: 'v', logRef: 'log', durationMs: 7, ...c })), totals: { hits: 1 } })); return JSON.stringify({ ...r, cases: results[0]?.cases ?? [], totals: { hits: 1 }, trialResults: results }); };
    const texts = { run: input.run ?? whole(run), trials: { ...Object.fromEntries(Object.entries(trials).map(([k, r]) => [k, whole(r)])), ...input.trials } };
    const written: string[] = [];
    return { result: assembleReplay({ ...input, ...texts, run: input.run === 'missing' ? undefined : texts.run }, (t) => written.push(t)), written, texts };
  };
  const ok = build();
  assert.equal(ok.result, undefined);
  assert.equal(ok.written.length, 1);
  const value = JSON.parse(ok.written[0]!) as { commit: string; reports: unknown; run: unknown; trials: Array<{ report: unknown }>; leftOut: unknown };
  assert.deepEqual([Object.keys(value), value.commit, value.leftOut], [['commit', 'policyHash', 'reports', 'run', 'trials', 'leftOut'], C(7), { candidateGone: 1, trueDefectWithoutCase: 1 }]);
  const order = [A, B].sort((x, y) => (sha(x) < sha(y) ? -1 : 1));
  assert.equal(JSON.stringify(value.reports), JSON.stringify({ run: sha(ok.texts.run), ...Object.fromEntries(order.map((id) => [id, sha(ok.texts.trials[id]!)])) }));
  const reduced = (text: string): string => { const r = JSON.parse(text) as Saved; return JSON.stringify({ ...r, cases: r.cases.map(reduce), trialResults: r.trialResults.map((t) => ({ ...t, cases: t.cases.map(reduce) })) }); };
  assert.equal(JSON.stringify(value.run), reduced(ok.texts.run));
  assert.deepEqual(value.trials.map((t) => JSON.stringify(t.report)), order.map((id) => reduced(ok.texts.trials[id]!)));
  const gone = build((o) => { o.input.hasCommit = (s) => s !== C(2); }); // a valid --commit and a row candidate the store lacks
  assert.deepEqual((JSON.parse(gone.written[0]!) as { leftOut: unknown }).leftOut, { candidateGone: 2, trueDefectWithoutCase: 1 });
  const nv = (o: { run: Report; input: AssembleInput }, read?: () => string) => { o.run.trialResults[0]!.cases[1] = { id: B, outcome: 'no-verdict', verdictRef: 'm' }; const d = o.input.readDoc; if (read) o.input.readDoc = (ref) => (ref === 'm' ? read() : d(ref)); };
  const changes: Array<Parameters<typeof build>[0]> = [
    (o) => { o.input.commit = undefined; }, (o) => { o.input.hasCommit = (s) => s !== C(7); },
    (o) => { o.input.status = ' M src/a.ts'; }, (o) => { o.input.run = 'missing'; }, (o) => { o.input.trials = { [A]: '{' }; }, (o) => { o.input.selfCheck = () => { throw new Error('rule (h)'); }; },
    (o) => { o.run.stage = 'pre'; }, (o) => { o.run.leftCheckouts = ['x']; }, (o) => { o.trials[A]!.trialResults[1]!.cases[0]!.outcome = 'error'; },
    (o) => { o.run.trialResults[0]!.cases[0] = { id: A, outcome: 'no-verdict', detail: 'not reviewed: a quota hold stopped the run' }; },
    (o) => { o.run.trialResults[0]!.cases[1] = { id: B, outcome: 'no-verdict', verdictRef: 'q' }; o.input.readDoc = docs({ q: 'quota-hold', [`${B}.1`]: 'no-verdict' }); },
    (o) => { o.run.trialResults.push(o.run.trialResults[0]!); }, (o) => { o.run.trialResults[0]!.cases[0]!.id = 'T1-X.g1.F9'; },
    (o) => { o.trials[A]!.trialResults.pop(); }, (o) => { o.trials[A] = report(B, ['hit', 'hit', 'hit']); }, (o) => { delete o.trials[A]; },
    (o) => { o.trials['T1-X.g1.F3'] = report('T1-X.g1.F3', ['hit', 'hit', 'hit']); }, (o) => { o.trials[B]!.policyHash = 'other'; },
    (o) => nv(o), (o) => nv(o, () => '{'), (o) => nv(o, () => { throw new Error('read'); }),
  ];
  for (const [i, change] of changes.entries()) {
    const r = build(change);
    assert.ok(r.result && r.written.length === 0, `change ${i} is refused before any write`);
  }
});
