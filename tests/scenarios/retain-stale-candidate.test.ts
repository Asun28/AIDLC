// Card T0-RETAIN-STALE-CANDIDATE: `aidlc evidence retain` refuses, before any write, the entry that `aidlc audit verify` reports
// as EVIDENCE_STALE_CANDIDATE through the merges of its card; the kind `earlier-candidate` holds a file of a candidate that did not merge.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { actor, cleanup, tmpDir } from '../infra/helpers.ts';
import { runCliInProcess } from '../infra/cli-inprocess.ts';
import { Journal } from '../../src/state/journal.ts';
import { CANDIDATE_BOUND_KINDS, EARLIER_CANDIDATE_KIND, EvidenceStore } from '../../src/audit/manifest.ts';
import { staleCandidateRefusal, verifyAudit } from '../../src/audit/verifier.ts';
import { OperationLedger } from '../../src/coordination/reconcile.ts';
import type { JournalEventType } from '../../src/core/types.ts';
import { makeFixture, writeCard, goalForCards, type Fixture } from './_harness.ts';

const T = '2026-11-23T00:00:00.000Z';
const ACTOR = actor('retain-stale-candidate');
const CARD = 'T0-RETAIN';
const [OLD, MERGED, LATER] = ['a1'.repeat(32), 'b2'.repeat(32), 'c3'.repeat(32)];
const roots: string[] = [];
const fixtures: Fixture[] = [];
after(() => {
  for (const root of roots) cleanup(root);
  for (const fx of fixtures) fx.cleanup();
});

const refusalText = (id: string, kind: string, digest: string, card: string, merged: string[]): string => // the refusal, whole
  `evidence ${id} of the candidate-bound kind ${kind} names candidate ${digest}, and ${card} merged ${merged.join(', ')}: aidlc audit verify blocks such an entry (EVIDENCE_STALE_CANDIDATE). Evidence of a merged candidate takes its digest as --candidate; a file of an earlier candidate takes --kind earlier-candidate`;
const staleFinding = (id: string, merged: string[]) => ({ severity: 'block', code: 'EVIDENCE_STALE_CANDIDATE', detail: `${id} is bound to candidate ${OLD.slice(0, 12)}, ${CARD} merged ${merged.map((d) => d.slice(0, 12)).join(', ')}` });
type Append = (type: JournalEventType, cardId?: string, data?: Record<string, unknown>) => void;
type Entry = { kind: string; candidateDigest?: string; cardId?: string };
/** A succeeded merge as the card runner journals it. */
const merge = (append: Append, cardId: string, digest: string, result: JournalEventType = 'OPERATION_RESULT'): void => {
  append('OPERATION_INTENT', cardId, { operationId: `op-${cardId}-${digest}`, kind: 'merge', candidateDigest: digest });
  append(result, cardId, { operationId: `op-${cardId}-${digest}`, status: 'succeeded' });
};
const one = (a: Append) => merge(a, CARD, MERGED);
const two = (a: Append) => [MERGED, LATER].forEach((digest) => merge(a, CARD, digest));
/** One operation: a merge intent of the card with the merged digest and a succeeded result of the card, but for `change`. */
const operation = (change: { intentCard?: string; kind?: string; noDigest?: boolean; resultCard?: string; status?: string | null }) => (a: Append) => {
  a('OPERATION_INTENT', change.intentCard ?? CARD, { operationId: 'op-1', kind: change.kind ?? 'merge', ...(change.noDigest ? {} : { candidateDigest: MERGED }) });
  if (change.status !== null) a('OPERATION_RESULT', change.resultCard ?? CARD, { operationId: 'op-1', status: change.status ?? 'succeeded' });
};
const entry = (candidateDigest?: string, cardId?: string, kind = 'review-verdict'): Entry => ({ kind, candidateDigest, cardId });

/** A case: its name, the journal before the retain, the entry, and the merge digests the refusal names (none: accepted). */
type Case = [string, (a: Append) => void, Entry, string[]?];
const CASES: Case[] = [
  ...CANDIDATE_BOUND_KINDS.map((kind): Case => [`${kind} of an earlier candidate`, one, entry(OLD, CARD, kind), [MERGED]]),
  ...CANDIDATE_BOUND_KINDS.map((kind): Case => [`${kind} of the merged candidate`, one, entry(MERGED, CARD, kind)]),
  ...[EARLIER_CANDIDATE_KIND, 'artifact', 'Review-Verdict', 'review-verdict '].map((kind): Case => [`the kind ${JSON.stringify(kind)}`, one, entry(OLD, CARD, kind)]),
  ['no candidate digest', one, entry(undefined, CARD)],
  ['an empty candidate digest', one, entry('', CARD)],
  ['no card', one, entry(OLD)],
  ['an empty card', one, entry(OLD, '')],
  ['a merge of another card only', (a) => merge(a, 'T0-OTHER', MERGED), entry(OLD, CARD)],
  ['no journal event of the card', () => undefined, entry(OLD, CARD)],
  ['one operation as the card runner journals it', operation({}), entry(OLD, CARD), [MERGED]],
  ['a merge intent with no result', operation({ status: null }), entry(OLD, CARD)],
  ['a merge that failed', operation({ status: 'failed' }), entry(OLD, CARD)],
  ['a succeeded result of another card for the operation', operation({ resultCard: 'T0-OTHER' }), entry(OLD, CARD)],
  ['a succeeded result of the card for the merge intent of another card', operation({ intentCard: 'T0-OTHER' }), entry(OLD, CARD)],
  ['a succeeded operation that is not a merge', operation({ kind: 'deploy' }), entry(OLD, CARD)],
  ['a succeeded merge whose intent names no digest', operation({ noDigest: true }), entry(OLD, CARD)],
  ['a merge that a reconciliation found succeeded', (a) => merge(a, CARD, MERGED, 'OPERATION_RECONCILED'), entry(OLD, CARD), [MERGED]],
  ['two merges, an earlier candidate', two, entry(OLD, CARD), [MERGED, LATER]],
  ['two merges, the candidate of the first', two, entry(MERGED, CARD)],
  ['two merges, the candidate of the second', two, entry(LATER, CARD)],
];

test('T0-RETAIN-STALE-CANDIDATE acceptance 1: the refusal is the whole text for an entry of a candidate-bound kind whose card merged and whose digest is no merge digest, nothing for any other entry, and it is given exactly where the audit reports the entry as stale [R1] [R2]', () => {
  for (const [name, journalOf, e, refused] of CASES) {
    const root = tmpDir('aidlc-retain-stale-');
    roots.push(root);
    const journal = Journal.forGoal(path.join(root, 'journal'), 'g1');
    const evidence = new EvidenceStore(path.join(root, 'evidence'), 'g1');
    const append: Append = (type, cardId, data = {}) => void journal.append({ type, goalId: 'g1', cardId, data, actor: ACTOR, ts: T });
    append('GOAL_CREATED');
    journalOf(append);
    assert.equal(staleCandidateRefusal({ id: 'e1', ...e }, () => journal.readAll()), refused ? refusalText('e1', e.kind, e.candidateDigest!, e.cardId!, refused) : undefined, name);
    // What the audit says of the same entry once the manifest holds it.
    evidence.retain(evidence.load('g1', 0, 0, T), { id: 'e1', ...e, content: 'x' });
    const report = verifyAudit({ goalId: 'g1', journal, operations: new OperationLedger(path.join(root, 'operations')), evidence, manifest: evidence.load('g1', 0, 0, T), now: T });
    assert.deepEqual(report.findings.filter((f) => f.code === 'EVIDENCE_STALE_CANDIDATE'), refused ? [staleFinding('e1', refused)] : [], name);
  }
});

test('T0-RETAIN-STALE-CANDIDATE acceptance 2: the journal is read once for an entry of a candidate-bound kind with a card and a digest, and not at all for any other entry [R2] [R4]', () => {
  const never = (): never => assert.fail('the journal was read');
  const unchecked = [entry(OLD, CARD, 'artifact'), entry(OLD, CARD, EARLIER_CANDIDATE_KIND), entry(undefined, CARD), entry('', CARD), entry(OLD), entry(OLD, '')];
  for (const e of unchecked) assert.equal(staleCandidateRefusal({ id: 'e1', ...e }, never), undefined, JSON.stringify(e));
  let reads = 0;
  assert.equal(staleCandidateRefusal({ id: 'e1', ...entry(OLD, CARD) }, () => { reads += 1; return []; }), undefined);
  assert.equal(reads, 1);
  assert.equal(EARLIER_CANDIDATE_KIND, 'earlier-candidate');
  assert.ok(!CANDIDATE_BOUND_KINDS.includes(EARLIER_CANDIDATE_KIND));
});

/** A goal of a fixture state directory, its stores and the retain command bound to it, run in this process. */
function cliGoal() {
  const fx = makeFixture();
  fixtures.push(fx);
  writeCard(fx, { id: CARD, title: 'retains evidence' });
  const goal = goalForCards(fx, [CARD]);
  const ev = new EvidenceStore(fx.paths.evidence, goal.id);
  const journal = fx.journal(goal.id);
  const append: Append = (type, cardId, data = {}) => void journal.append({ type, goalId: goal.id, cardId, data, actor: ACTOR, ts: T });
  const retain = (id: string, kind: string, digest: string | undefined, card: string | undefined, content = id) =>
    runCliInProcess(['evidence', 'retain', '--id', id, '--kind', kind, ...(digest === undefined ? [] : ['--candidate', digest]), ...(card === undefined ? [] : ['--card', card]), '--content', content, '--goal', goal.id, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root } });
  /** The journal and every file of the evidence directory, by name, with its text. */
  const written = (): Record<string, string> => {
    const out: Record<string, string> = { journal: readFileSync(journal.file, 'utf8') };
    if (existsSync(ev.dir)) for (const name of readdirSync(ev.dir)) out[name] = readFileSync(path.join(ev.dir, name), 'utf8');
    return out;
  };
  const entries = () => ev.load(goal.id, 0, 0, T).entries;
  const retained = () => fx.events(goal.id).filter((e) => e.type === 'EVIDENCE_RETAINED').map((e) => e.data);
  const audit = () => verifyAudit({ goalId: goal.id, journal, operations: fx.ops, evidence: ev, manifest: ev.load(goal.id, 0, 0, T), now: T }).findings;
  return { ev, goal, journal, append, retain, written, entries, retained, audit };
}

test('T0-RETAIN-STALE-CANDIDATE acceptance 3: the command refuses the entry with exit 1 and the whole text, and writes no file, no manifest and no journal event [R1] [R3]', async () => {
  const g = cliGoal();
  one(g.append);
  const none = g.written();
  assert.deepEqual(Object.keys(none), ['journal'], 'no evidence directory before the first accepted retain');
  const first = await g.retain('r3-1', 'review-verdict', OLD, CARD);
  assert.equal(first.status, 1, first.stdout);
  assert.ok(first.stderr.includes(refusalText('r3-1', 'review-verdict', OLD, CARD, [MERGED])), first.stderr);
  assert.deepEqual(g.written(), none);

  // The same with a manifest that holds an entry: a new id, and an id the manifest holds.
  assert.equal((await g.retain('dod', 'dod-receipt', MERGED, CARD)).status, 0);
  const before = g.written();
  for (const id of ['r3-1', 'dod']) {
    const again = await g.retain(id, 'dod-receipt', OLD, CARD);
    assert.equal(again.status, 1, again.stdout);
    assert.ok(again.stderr.includes(refusalText(id, 'dod-receipt', OLD, CARD, [MERGED])), again.stderr);
    assert.deepEqual(g.written(), before, id);
  }
});

test('T0-RETAIN-STALE-CANDIDATE acceptance 4: the command accepts a retain before the merge, evidence of the merged candidate, a file of an earlier candidate under the kind earlier-candidate and every retain that is not checked, and the audit reports none as stale; it refuses nothing on a journal whose chain does not verify [R2] [R4]', async () => {
  const g = cliGoal();
  assert.equal((await g.retain('early', 'review-verdict', OLD, CARD)).status, 0);
  one(g.append);
  const accepted: Array<[string, string, string | undefined, string | undefined]> = [
    ['merged', 'review-verdict', MERGED, CARD],
    ['earlier', EARLIER_CANDIDATE_KIND, OLD, CARD],
    ['no-card', 'review-verdict', OLD, undefined],
    ['no-candidate', 'review-verdict', undefined, CARD],
    ['other-card', 'review-verdict', OLD, 'T0-OTHER'],
  ];
  for (const args of accepted) assert.equal((await g.retain(...args)).status, 0, args[0]);
  const ids = ['early', ...accepted.map(([id]) => id)];
  assert.deepEqual([g.entries().map((e) => e.id), g.retained().map((d) => d['id'])], [ids, ids]);
  // The retain made before the merge is the one the audit reports.
  assert.deepEqual(g.audit().filter((f) => f.code === 'EVIDENCE_STALE_CANDIDATE'), [staleFinding('early', [MERGED])]);

  // A journal whose chain does not verify gives the check no merge digest, as it gives the verifier none.
  const b = cliGoal();
  one(b.append);
  const [head, ...rest] = readFileSync(b.journal.file, 'utf8').split('\n');
  writeFileSync(b.journal.file, [JSON.stringify({ ...(JSON.parse(head!) as Record<string, unknown>), ts: '2001-01-01T00:00:00.000Z' }), ...rest].join('\n'), 'utf8');
  assert.equal(b.journal.verify().ok, false);
  const r = await b.retain('r3-1', 'review-verdict', OLD, CARD);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(b.entries().map((e) => [e.id, e.kind, e.candidateDigest]), [['r3-1', 'review-verdict', OLD]]);
  const codes = b.audit().map((f) => f.code);
  assert.ok(codes.includes('JOURNAL_CHAIN') && !codes.includes('EVIDENCE_STALE_CANDIDATE'), codes.join(','));
});

test('T0-RETAIN-STALE-CANDIDATE acceptance 5: an entry that the audit reports as stale is corrected by a retain of the same id, file and digest under the kind earlier-candidate; the entry is replaced, its file digest stays, and the journal records the retain [R4]', async () => {
  const g = cliGoal();
  one(g.append);
  // A manifest as retains made it before this card: the verdict that blocked the first candidate, under a candidate-bound kind.
  g.ev.retain(g.ev.load(g.goal.id, 0, 0, T), { id: 'r3-1', kind: 'review-verdict', content: '{"verdict":"block"}', candidateDigest: OLD, cardId: CARD });
  g.ev.retain(g.ev.load(g.goal.id, 0, 0, T), { id: 'r3-2', kind: 'review-verdict', content: '{"verdict":"pass"}', candidateDigest: MERGED, cardId: CARD });
  assert.deepEqual(g.audit().filter((f) => f.severity === 'block'), [staleFinding('r3-1', [MERGED])]);
  const [block, pass] = g.entries();
  assert.notEqual(block!.sha256, pass!.sha256);

  const r = await g.retain('r3-1', EARLIER_CANDIDATE_KIND, OLD, CARD, '{"verdict":"block"}');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(g.audit().filter((f) => f.severity === 'block'), []);
  assert.deepEqual(g.entries().map((e) => [e.id, e.kind, e.candidateDigest, e.sha256]), [
    ['r3-2', 'review-verdict', MERGED, pass!.sha256],
    ['r3-1', EARLIER_CANDIDATE_KIND, OLD, block!.sha256],
  ]);
  assert.deepEqual(g.retained(), [{ id: 'r3-1', kind: EARLIER_CANDIDATE_KIND, candidateDigest: OLD, cardId: CARD }]);
});
