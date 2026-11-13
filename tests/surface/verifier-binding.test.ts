// Card T0-AUDIT-BINDING: `independently-verified` needs evidence bound to a candidate, and the evidence of each card is
// compared with the candidates its merges carried.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { actor, cleanup, tmpDir } from '../infra/helpers.ts';
import { Journal } from '../../src/state/journal.ts';
import { EvidenceStore, Manifest, fileSha256 } from '../../src/audit/manifest.ts';
import { verifyAudit, type AuditFinding } from '../../src/audit/verifier.ts';
import { OperationLedger } from '../../src/coordination/reconcile.ts';
import type { JournalEventType } from '../../src/core/types.ts';
import { changelogSince010 } from '../infra/changelog.ts';

const T = '2026-11-12T00:00:00.000Z';
const ACTOR = actor('verifier-binding');
const roots: string[] = [];
after(() => {
  for (const root of roots) cleanup(root);
});

/** A fresh journal, evidence store and operation ledger whose journal starts with `GOAL_CREATED`. */
function fixture(goalId = 'g1') {
  const root = tmpDir('aidlc-binding-');
  roots.push(root);
  const journal = Journal.forGoal(path.join(root, 'journal'), goalId);
  const evidence = new EvidenceStore(path.join(root, 'evidence'), goalId);
  const operations = new OperationLedger(path.join(root, 'operations'));
  const append = (type: JournalEventType, cardId?: string, data: Record<string, unknown> = {}) => journal.append({ type, goalId, cardId, data, actor: ACTOR, ts: T });
  append('GOAL_CREATED');
  return { journal, evidence, operations, goalId, append };
}
type Fx = ReturnType<typeof fixture>;

/** A succeeded merge as the card runner journals it. */
function merge(f: Fx, cardId: string, digest: string, operationId = `op-${cardId}-${digest}`): void {
  f.append('OPERATION_INTENT', cardId, { operationId, kind: 'merge', candidateDigest: digest });
  f.append('OPERATION_RESULT', cardId, { operationId, status: 'succeeded' });
}

function retain(f: Fx, id: string, kind: string, candidateDigest?: string, cardId?: string): void {
  f.evidence.retain(f.evidence.load(f.goalId, 0, 0, T), { id, kind, content: id, candidateDigest, cardId });
}

function seal(f: Fx, finalCandidateDigest?: string): void {
  const head = f.journal.head();
  f.evidence.seal(f.evidence.load(f.goalId, 0, 0, T), { journalHead: head.hash, journalEvents: head.seq + 1, finalCandidateDigest, now: T });
}

function verify(f: Fx, finalCandidateDigest?: string, manifest: Manifest = f.evidence.load(f.goalId, 0, 0, T)) {
  return verifyAudit({ goalId: f.goalId, journal: f.journal, operations: f.operations, evidence: f.evidence, manifest, finalCandidateDigest, now: T });
}

const codes = (findings: AuditFinding[], only?: string[]) => findings.map((x) => x.code).filter((c) => !only || only.includes(c));
const stale = (findings: AuditFinding[]) => findings.filter((x) => x.code === 'EVIDENCE_STALE_CANDIDATE').map((x) => x.detail);
const UNBOUND_MANIFEST: AuditFinding = { severity: 'warn', code: 'MANIFEST_UNBOUND', detail: 'manifest of g1 is sealed without a final candidate digest' };
const unboundEntry = (id: string, kind: string): AuditFinding => ({ severity: 'warn', code: 'EVIDENCE_UNBOUND', detail: `${id} (${kind}) names no candidate digest` });

test('T0-AUDIT-BINDING: a sealed manifest with no final candidate digest is a MANIFEST_UNBOUND warning that keeps the level at traceable', () => {
  for (const final of [undefined, '']) {
    const f = fixture();
    retain(f, 'dod', 'dod-receipt', 'cand-1');
    seal(f, final);
    const report = verify(f);
    assert.deepEqual(report.findings, [UNBOUND_MANIFEST], `final ${JSON.stringify(final)}`);
    assert.equal(report.level, 'traceable', `final ${JSON.stringify(final)}`);
  }

  const trailing = fixture();
  retain(trailing, 'dod', 'dod-receipt', 'cand-1');
  seal(trailing);
  trailing.append('NOTE');
  assert.deepEqual(codes(verify(trailing).findings), ['MANIFEST_UNBOUND', 'MANIFEST_TRAILING']);

  const broken = fixture();
  retain(broken, 'dod', 'dod-receipt', 'cand-1');
  writeFileSync(broken.evidence.manifestFile(), JSON.stringify({ ...broken.evidence.load('g1', 0, 0, T), seal: 'x' }), 'utf8');
  assert.deepEqual(codes(verify(broken).findings), ['MANIFEST_SEAL', 'MANIFEST_UNBOUND']);

  const bound = fixture();
  retain(bound, 'dod', 'dod-receipt', 'cand-1');
  seal(bound, 'cand-1');
  const boundReport = verify(bound);
  assert.deepEqual(codes(boundReport.findings, ['MANIFEST_UNBOUND']), [], 'the manifest names its digest; no input digest is given');
  assert.equal(boundReport.level, 'independently-verified', JSON.stringify(boundReport.findings));

  const space = fixture();
  retain(space, 'dod', 'dod-receipt', 'cand-1');
  seal(space, ' ');
  assert.deepEqual(codes(verify(space).findings, ['MANIFEST_UNBOUND']), [], 'a digest of only whitespace is a digest');

  const unsealed = fixture();
  retain(unsealed, 'dod', 'dod-receipt', 'cand-1');
  assert.deepEqual(codes(verify(unsealed).findings, ['MANIFEST_UNSEALED', 'MANIFEST_UNBOUND']), ['MANIFEST_UNSEALED']);

  const input = fixture();
  retain(input, 'dod', 'dod-receipt', 'cand-1');
  seal(input);
  assert.deepEqual(codes(verify(input, 'cand-1').findings, ['MANIFEST_UNBOUND']), ['MANIFEST_UNBOUND'], 'the input digest does not stand in for the manifest field');

  // A manifest as main wrote it before this card: no final digest, an entry with no candidate digest and no card.
  const old = fixture();
  mkdirSync(old.evidence.dir, { recursive: true });
  writeFileSync(path.join(old.evidence.dir, 'old'), 'old', 'utf8');
  const legacy = { schemaVersion: 1, goalId: 'g1', generation: 0, revision: 0, createdAt: T, entries: [{ id: 'old', kind: 'dod-receipt', path: 'old', sha256: fileSha256(path.join(old.evidence.dir, 'old')), bytes: 3 }], models: [] };
  writeFileSync(old.evidence.manifestFile(), JSON.stringify(legacy), 'utf8');
  seal(old);
  const parsed = Manifest.parse(JSON.parse(readFileSync(old.evidence.manifestFile(), 'utf8')));
  assert.deepEqual(codes(verify(old, undefined, parsed).findings), ['MANIFEST_UNBOUND', 'EVIDENCE_UNBOUND']);
});

const BOUND_KINDS = ['dod-receipt', 'review-verdict', 'ci-run', 'test-output', 'health'];

/** The entries of acceptance 2, in their order: six unbound entries of the five kinds, then entries that are not unbound. */
function mixedEntries(f: Fx): void {
  BOUND_KINDS.forEach((kind, i) => retain(f, `k${i + 1}`, kind));
  retain(f, 'k6', 'review-verdict', '');
  retain(f, 'ok', 'dod-receipt', 'cand-1');
  ['review', 'Review-Verdict', ' dod-receipt', 'red-receipt', 'artifact', 'other'].forEach((kind, i) => retain(f, `n${i + 1}`, kind));
  ['artifact', 'review', 'red-receipt'].forEach((kind, i) => retain(f, `z${i + 1}`, kind, 'dZ'));
}
const SIX = [...BOUND_KINDS.map((kind, i) => unboundEntry(`k${i + 1}`, kind)), unboundEntry('k6', 'review-verdict')];

test('T0-AUDIT-BINDING: each entry of a candidate-bound kind with no candidate digest is an EVIDENCE_UNBOUND warning, in a sealed or an unsealed manifest', () => {
  const sealed = fixture();
  mixedEntries(sealed);
  seal(sealed, 'cand-1');
  const report = verify(sealed, 'cand-1');
  assert.deepEqual(report.findings, SIX);
  assert.equal(report.level, 'traceable');

  const unsealed = fixture();
  mixedEntries(unsealed);
  assert.deepEqual(verify(unsealed, 'cand-1').findings, [{ severity: 'warn', code: 'MANIFEST_UNSEALED', detail: 'manifest not sealed' }, ...SIX]);

  const space = fixture();
  retain(space, 'blank', 'dod-receipt', ' ');
  seal(space, 'cand-1');
  assert.deepEqual(codes(verify(space, 'cand-1').findings), ['EVIDENCE_STALE_CANDIDATE'], 'a digest of only whitespace is compared exactly');

  for (const [damage, code] of [[(file: string) => writeFileSync(file, 'changed', 'utf8'), 'ARTIFACT_ALTERED'], [(file: string) => rmSync(file), 'ARTIFACT_MISSING']] as const) {
    const f = fixture();
    retain(f, 'u', 'dod-receipt');
    seal(f, 'cand-1');
    damage(path.join(f.evidence.dir, 'u'));
    assert.deepEqual(verify(f, 'cand-1').findings.map((x) => `${x.code} ${x.detail.split(/[ :]/)[0]}`), [`${code} u`, 'EVIDENCE_UNBOUND u']);
  }
});

test('T0-AUDIT-BINDING: a goal of two cards whose evidence is bound reaches independently-verified, and each warning alone withholds it', () => {
  const THREE = ['MANIFEST_UNBOUND', 'EVIDENCE_UNBOUND', 'EVIDENCE_STALE_CANDIDATE'];
  const goal = (final: string | undefined, extra?: (f: Fx) => void) => {
    const f = fixture();
    merge(f, 'T0-A', 'dA');
    merge(f, 'T0-B', 'dB');
    retain(f, 'dod-T0-A', 'dod-receipt', 'dA', 'T0-A');
    retain(f, 'T0-A.verdict', 'review-verdict', 'dA', 'T0-A');
    retain(f, 'dod-T0-B', 'dod-receipt', 'dB', 'T0-B');
    retain(f, 'T0-B.verdict', 'review-verdict', 'dB', 'T0-B');
    extra?.(f);
    seal(f, final);
    return verify(f, final);
  };
  const bound = goal('dB');
  assert.deepEqual(codes(bound.findings, THREE), []);
  assert.equal(bound.level, 'independently-verified', JSON.stringify(bound.findings));

  const noFinal = goal(undefined);
  assert.deepEqual(codes(noFinal.findings, THREE), ['MANIFEST_UNBOUND']);
  assert.equal(noFinal.level, 'traceable');

  const unboundRun = goal('dB', (f) => retain(f, 'ci', 'ci-run'));
  assert.deepEqual(codes(unboundRun.findings, THREE), ['EVIDENCE_UNBOUND']);
  assert.equal(unboundRun.level, 'traceable');
});

test('T0-AUDIT-BINDING: an entry retained for a card is compared with the merge digests of that card', () => {
  const run = (arrange: (f: Fx) => void, options: { sealed?: boolean; input?: string } = {}) => {
    const f = fixture();
    arrange(f);
    const input = 'input' in options ? options.input : 'dF';
    if (options.sealed ?? true) seal(f, input);
    return stale(verify(f, input).findings);
  };
  const result = (f: Fx, operationId: string, type: JournalEventType = 'OPERATION_RESULT', status = 'succeeded', cardId = 'T0-A') => f.append(type, cardId, { operationId, status });
  const intent = (f: Fx, operationId: string, digest: string) => f.append('OPERATION_INTENT', 'T0-A', { operationId, kind: 'merge', candidateDigest: digest });

  assert.deepEqual(run((f) => (merge(f, 'T0-A', 'dA'), retain(f, 'e', 'dod-receipt', 'dA', 'T0-A'))), [], '(a) bound to the merged candidate');
  assert.deepEqual(run((f) => (merge(f, 'T0-A', 'dA'), retain(f, 'e', 'dod-receipt', 'dF', 'T0-A'))), ['e is bound to candidate dF, T0-A merged dA'], '(b) bound to the final digest, not the merged one');
  assert.deepEqual(
    run((f) => {
      merge(f, 'T0-A', 'd1', 'op1');
      merge(f, 'T0-A', 'd2', 'op2');
      retain(f, 'e1', 'dod-receipt', 'd1', 'T0-A');
      retain(f, 'e2', 'dod-receipt', 'd2', 'T0-A');
      retain(f, 'e3', 'dod-receipt', 'd3', 'T0-A');
    }),
    ['e3 is bound to candidate d3, T0-A merged d1, d2'],
    '(c) two merges',
  );
  assert.deepEqual(run((f) => (merge(f, 'T0-A', 'dA'), retain(f, 'e', 'dod-receipt', 'DA', 'T0-A'))), ['e is bound to candidate DA, T0-A merged dA'], '(d) exact comparison');
  assert.deepEqual(
    run((f) => {
      intent(f, 'op1', 'dA');
      result(f, 'op1', 'OPERATION_RESULT', 'UNKNOWN');
      result(f, 'op1', 'OPERATION_RECONCILED', 'succeeded');
      retain(f, 'e', 'dod-receipt', 'dA', 'T0-A');
    }),
    [],
    '(e) a reconciled merge counts',
  );
  const f3 = (f: Fx) => retain(f, 'e', 'dod-receipt', 'd3', 'T0-A');
  assert.deepEqual(run((f) => (intent(f, 'op1', 'd1'), intent(f, 'op2', 'd2'), result(f, 'op2'), result(f, 'op1'), f3(f))), ['e is bound to candidate d3, T0-A merged d1, d2'], '(f) intent order');
  assert.deepEqual(run((f) => (intent(f, 'op1', 'd1'), result(f, 'op1'), result(f, 'op1', 'OPERATION_RECONCILED'), f3(f))), ['e is bound to candidate d3, T0-A merged d1'], '(f) one intent counts once');
  assert.deepEqual(run((f) => (intent(f, 'op1', 'd1'), intent(f, 'op2', 'd1'), result(f, 'op1'), result(f, 'op2'), f3(f))), ['e is bound to candidate d3, T0-A merged d1'], '(f) distinct digests');
  assert.deepEqual(run((f) => (intent(f, 'op1', 'd1'), intent(f, 'op1', 'd2'), result(f, 'op1'), f3(f))), ['e is bound to candidate d3, T0-A merged d1, d2'], '(f) each intent judged on its own');
  assert.deepEqual(run((f) => (merge(f, 'T0-A', 'abcdefghijkl1'), retain(f, 'e', 'dod-receipt', 'abcdefghijkl2', 'T0-A'))), ['e is bound to candidate abcdefghijkl, T0-A merged abcdefghijkl'], '(g) whole-string comparison, cut detail');
  assert.deepEqual(run((f) => (merge(f, 'T0-A', 'dA'), retain(f, 'e', 'dod-receipt', 'dX', 'T0-A')), { sealed: false, input: undefined }), ['e is bound to candidate dX, T0-A merged dA'], '(h) an unsealed manifest with no input digest');
  assert.deepEqual(run((f) => (result(f, 'op1'), intent(f, 'op1', 'dA'), retain(f, 'e', 'dod-receipt', 'dA', 'T0-A'))), [], '(i) a succeeded completion journaled before its intent');
});

test('T0-AUDIT-BINDING: an entry without a card, or of a card with no merge digest, is compared with the input final digest when one is given', () => {
  const intent = (f: Fx, data: Record<string, unknown>, cardId: string | null = 'T0-C') => f.append('OPERATION_INTENT', cardId ?? undefined, { operationId: 'op1', kind: 'merge', candidateDigest: 'dZ', ...data });
  const done = (f: Fx, data: Record<string, unknown> = {}, cardId = 'T0-C', type: JournalEventType = 'OPERATION_RESULT') => f.append(type, cardId, { operationId: 'op1', status: 'succeeded', ...data });
  const cases: Array<[string, string | undefined, (f: Fx) => void]> = [
    ['no cardId', undefined, () => undefined],
    ['cardId empty', '', () => undefined],
    ['no merge', 'T0-C', () => undefined],
    ...['failed', 'UNKNOWN', 'cancelled'].map((status): [string, string, (f: Fx) => void] => [`result ${status}`, 'T0-C', (f) => (intent(f, {}), done(f, { status }))]),
    ['intent without digest', 'T0-C', (f) => (intent(f, { candidateDigest: undefined }), done(f))],
    ['intent with an empty digest', 'T0-C', (f) => (intent(f, { candidateDigest: '' }), done(f))],
    ['intent with a numeric digest', 'T0-C', (f) => (intent(f, { candidateDigest: 42 }), done(f))],
    ['intent without a card', 'T0-C', (f) => (intent(f, {}, null), done(f))],
    ['result of another card', 'T0-C', (f) => (intent(f, {}), done(f, {}, 'T0-D'))],
    ['result of another operation', 'T0-C', (f) => (intent(f, {}), done(f, { operationId: 'op2' }))],
    ['intent of another kind', 'T0-C', (f) => (intent(f, { kind: 'deploy' }), done(f))],
    ['intent without an operation id', 'T0-C', (f) => (intent(f, { operationId: undefined }), done(f))],
    ['intent with a numeric operation id', 'T0-C', (f) => (intent(f, { operationId: 5 }), done(f, { operationId: 5 }))],
    ['a NOTE as the completion', 'T0-C', (f) => (intent(f, {}), done(f, {}, 'T0-C', 'NOTE'))],
    ['card ids compared exactly', 't0-c', (f) => (intent(f, {}), done(f))],
    ['a NOTE carrying the fields of a merge intent', 'T0-C', (f) => (f.append('NOTE', 'T0-C', { operationId: 'op1', kind: 'merge', candidateDigest: 'dZ' }), done(f))],
    ['entry, intent and completion with the card id empty', '', (f) => (intent(f, {}, ''), done(f, {}, ''))],
  ];
  for (const [name, cardId, arrange] of cases) {
    const f = fixture();
    arrange(f);
    retain(f, 'ok', 'dod-receipt', 'dF', cardId);
    retain(f, 'bad', 'dod-receipt', 'dZ', cardId);
    assert.deepEqual(stale(verify(f, 'dF').findings), ['bad is bound to candidate dZ, final is dF'], name);
  }

  const broken = fixture();
  merge(broken, 'T0-A', 'dZ');
  retain(broken, 'ok', 'dod-receipt', 'dF', 'T0-A');
  retain(broken, 'bad', 'dod-receipt', 'dZ', 'T0-A');
  const lines = readFileSync(broken.journal.file, 'utf8').split('\n');
  const first = JSON.parse(lines[0]!) as { data: Record<string, unknown> };
  first.data['tampered'] = true;
  lines[0] = JSON.stringify(first);
  writeFileSync(broken.journal.file, lines.join('\n'), 'utf8');
  assert.deepEqual(stale(verify(broken, 'dF').findings), ['bad is bound to candidate dZ, final is dF'], 'a broken chain gives no merge digest');

  const nothing = fixture();
  retain(nothing, 'bad', 'dod-receipt', 'dZ', 'T0-C');
  assert.deepEqual(stale(verify(nothing).findings), [], 'no input digest and no merge: nothing is compared');

  const library = fixture();
  retain(library, 'bad', 'dod-receipt', 'dZ');
  seal(library, 'dF');
  const report = verify(library);
  assert.deepEqual(stale(report.findings), [], 'a library caller that passes no input digest');
  assert.equal(report.level, 'independently-verified', JSON.stringify(report.findings));
});

/** A section of a markdown file from its heading to the next heading of the same level, line endings normalised. */
function section(file: string, heading: string): string {
  const doc = readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n');
  const start = doc.indexOf(`\n${heading}\n`);
  if (start < 0) return '';
  const end = doc.indexOf('\n## ', start + heading.length + 2);
  return doc.slice(start, end < 0 ? undefined : end);
}

const OPERATIONS_SENTENCES = [
  'warnings `OP_UNKNOWN`, `MANIFEST_UNBOUND`, `EVIDENCE_UNBOUND`, `MANIFEST_UNSEALED`, `MANIFEST_TRAILING`, `FACT_UNVERIFIED`, `FACT_MISSING`.',
  'Any block sets exit 1. `MANIFEST_UNBOUND` and `EVIDENCE_UNBOUND` (card T0-AUDIT-BINDING) withhold `independently-verified`, so a goal with either reads at most `traceable`, and as warnings they do not set exit 1: `MANIFEST_UNBOUND` is reported for a sealed manifest with no final candidate digest, and `EVIDENCE_UNBOUND`, naming the entry, for each entry of a candidate-bound kind (`dod-receipt`, `review-verdict`, `ci-run`, `test-output` or `health`, matched exactly) with no candidate digest, in a sealed or an unsealed manifest.',
  "An entry of those kinds that has a candidate digest and a card (`--card`) is compared with the candidate digests of that card's merges the journal records as succeeded (a merge `OPERATION_INTENT` with an `OPERATION_RESULT` or `OPERATION_RECONCILED` of status `succeeded`), when the journal chain verifies and holds such a merge; any other entry of those kinds with a digest is compared with the manifest's final candidate digest when it has one.",
  'A difference is the blocking `EVIDENCE_STALE_CANDIDATE`, also when the manifest has no final digest, so the evidence of each card of a goal binds to the candidate that card merged.',
  'Seal after the last mutation. `audit seal` requires `--final-digest` (card T0-AUDIT-BINDING): without it the command exits 1 before reading anything, a value that is empty or only whitespace is refused before anything else is read, and any other value is recorded as given.',
  "Inside the manifest's lock section, before it journals `MANIFEST_SEALED`, the seal refuses a manifest that holds an entry of a candidate-bound kind with no candidate digest, naming each such id; the refusal exits 1 and writes and journals nothing.",
  'For an unsealed manifest whose ids satisfy the retain rules, retain each named entry again with `--candidate <digest>` (a retain of an id the manifest holds replaces its entry) and seal again.',
  'A manifest sealed before this card with such an entry refuses `evidence retain` and `audit seal`, so its goal stays at most `traceable`; one sealed with no final digest and every such entry bound can be sealed again with `--final-digest`.',
];

const CHANGELOG_SENTENCES = [
  '- T0-AUDIT-BINDING (audit item C10): `aidlc audit verify` withholds `independently-verified` from evidence that names no candidate.',
  'Two new warnings keep a goal at most `traceable` and do not set exit 1: `MANIFEST_UNBOUND` for a sealed manifest with no final candidate digest, and `EVIDENCE_UNBOUND` for each entry of a candidate-bound kind (`dod-receipt`, `review-verdict`, `ci-run`, `test-output`, `health`, exported as `CANDIDATE_BOUND_KINDS` from `src/audit/manifest.ts`) with no candidate digest.',
  "An entry of those kinds retained for a card is compared with the candidate digests of that card's succeeded merges in the journal, and an entry without a card, or of a card with no such merge, with the final digest; a difference is the blocking `EVIDENCE_STALE_CANDIDATE`, now also without a final digest when the entry's card has a succeeded-merge digest.",
  "Before, a goal whose other findings allowed it reached `independently-verified` when its sealed manifest had no final digest or its evidence named no candidate, since the comparison ran only when both the final digest and the entry's digest existed, and an entry retained for an earlier card of a goal of several cards, bound to that card's candidate, read as stale against the final digest.",
  'A goal that read `independently-verified` and whose sealed manifest has no final digest, or holds an entry of those kinds with no digest, now reads `traceable`, because its manifest or a candidate-bound entry lacks a required digest.',
  "`aidlc audit seal` requires `--final-digest`, refuses a blank one before anything else is read and, inside the manifest's lock section and before `MANIFEST_SEALED` is journaled, refuses a manifest holding an entry of those kinds with no candidate digest, naming the ids and writing nothing; `EvidenceStore.seal` is unchanged.",
  'The retain command of the closure failure names `--candidate` with the digest of the last passing R3 decision, the close narration says that the seal needs it, and both `card-loop.md` copies show `--candidate <digest>`.',
];

test('T0-AUDIT-BINDING: docs/OPERATIONS.md and the CHANGELOG state the warnings, the comparison and the seal', () => {
  const audit = section('docs/OPERATIONS.md', '## Audit');
  for (const sentence of OPERATIONS_SENTENCES) assert.ok(audit.includes(sentence), `docs/OPERATIONS.md, Audit: ${sentence}`);
  const unreleased = changelogSince010(readFileSync(path.resolve('CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n'));
  for (const sentence of CHANGELOG_SENTENCES) assert.ok(unreleased.includes(sentence), `CHANGELOG.md, Unreleased: ${sentence}`);
});
