// Card T0-AUDIT-BINDING: `aidlc audit verify` reports the two binding warnings without exit 1, and `aidlc audit seal`
// requires a final digest and refuses unbound evidence inside its lock section.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actor, cleanup } from '../infra/helpers.ts';
import { EvidenceStore } from '../../src/audit/manifest.ts';
import { makeFixture, writeCard, goalForCards, T0, type Fixture } from './_harness.ts';

/** The CLI from the sources, never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const PRELOAD = new URL('./seal-binding.preload.ts', import.meta.url).href;
const ACTOR = actor('seal-binding');
const BLANK = 'aidlc: --final-digest is blank; name the final candidate digest';
const unboundText = (goalId: string, ids: string) => `aidlc: manifest of ${goalId} holds evidence of a candidate-bound kind with no candidate digest: ${ids}; `;
const RETAIN_AGAIN = 'retain each again with --candidate <digest>, then seal';
const SEALED_ALREADY = 'this sealed manifest cannot accept replacement evidence; its audit level remains at most traceable';

/** The environment of a child CLI: no git or Node variable of the caller, git confined to the fixture, its own state directory. */
function childEnv(fx: Fixture, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    const upper = name.toUpperCase();
    if (!upper.startsWith('GIT_') && upper !== 'NODE_OPTIONS') env[name] = value;
  }
  env['GIT_CEILING_DIRECTORIES'] = [path.dirname(fx.tmp), path.dirname(realpathSync.native(fx.tmp))].join(path.delimiter);
  env['AIDLC_STATE_DIR'] = fx.paths.root;
  env['AIDLC_SESSION'] = 'seal-binding';
  return { ...env, ...extra };
}

function bytes(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

/** Every file of a directory with its bytes, so a refusal is checked by content. */
function files(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort().map((name) => `${name}=${bytes(path.join(dir, name)) ?? ''}`) : [];
}

/** A goal of one card in a fresh fixture, removed after the test, with its evidence store and its CLI. */
function goal(t: TestContext) {
  const fx = makeFixture();
  t.after(() => cleanup(fx.tmp));
  writeCard(fx, { id: 'T0-A', title: 'binds its evidence' });
  const goalId = goalForCards(fx, ['T0-A']).id;
  const ev = new EvidenceStore(fx.paths.evidence, goalId);
  const run = (args: string[], options: { extra?: Record<string, string>; preload?: boolean; goal?: string } = {}) =>
    spawnSync(process.execPath, [...(options.preload ? ['--import', PRELOAD] : []), MAIN, ...args, '--goal', options.goal ?? goalId, '--json'], { cwd: fx.tmp, env: childEnv(fx, options.extra ?? {}), encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const state = () => ({ manifest: bytes(ev.manifestFile()), journal: bytes(fx.journal(goalId).file), evidence: files(ev.dir) });
  return {
    fx,
    goalId,
    ev,
    seal: (...digest: string[]) => run(['audit', 'seal', ...(digest.length ? ['--final-digest', digest[0]!] : [])]),
    run,
    state,
    sealed: () => fx.events(goalId).filter((e) => e.type === 'MANIFEST_SEALED'),
    retain: (id: string, kind: string, candidateDigest?: string, cardId?: string) => ev.retain(ev.load(goalId, 0, 0, T0), { id, kind, content: id, candidateDigest, cardId }),
    librarySeal: (finalCandidateDigest?: string) => {
      const head = fx.journal(goalId).head();
      return ev.seal(ev.load(goalId, 0, 0, T0), { journalHead: head.hash, journalEvents: head.seq + 1, finalCandidateDigest, now: T0 });
    },
  };
}

type Report = { level: string; findings: Array<{ severity: string; code: string; detail: string }> };
const report = (stdout: string): Report => (JSON.parse(stdout) as Report[])[0]!;

test('T0-AUDIT-BINDING: aidlc audit verify exits 0 with the two warnings and 1 with a stale entry of an unsealed manifest', (t) => {
  const unbound = goal(t);
  unbound.retain('dod', 'dod-receipt');
  unbound.librarySeal();
  const warned = unbound.run(['audit', 'verify']);
  assert.equal(warned.status, 0, warned.stderr);
  const warnings = report(warned.stdout);
  assert.equal(warnings.level, 'traceable', JSON.stringify(warnings.findings));
  for (const code of ['MANIFEST_UNBOUND', 'EVIDENCE_UNBOUND']) assert.equal(warnings.findings.find((f) => f.code === code)?.severity, 'warn', code);

  const merged = goal(t);
  merged.fx.journal(merged.goalId).append({ type: 'OPERATION_INTENT', goalId: merged.goalId, cardId: 'T0-A', data: { operationId: 'op1', kind: 'merge', candidateDigest: 'dA' }, actor: ACTOR, ts: T0 });
  merged.fx.journal(merged.goalId).append({ type: 'OPERATION_RESULT', goalId: merged.goalId, cardId: 'T0-A', data: { operationId: 'op1', status: 'succeeded' }, actor: ACTOR, ts: T0 });
  merged.retain('dod-T0-A', 'dod-receipt', 'dX', 'T0-A');
  const blocked = merged.run(['audit', 'verify']);
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.equal(report(blocked.stdout).findings.find((f) => f.code === 'EVIDENCE_STALE_CANDIDATE')?.severity, 'block');
});

test('T0-AUDIT-BINDING: aidlc audit seal requires a final digest that is not blank, refused before anything else is read', (t) => {
  const g = goal(t);
  g.retain('a', 'dod-receipt', 'cand-1');
  const before = g.state();
  const missing = g.seal();
  assert.equal(missing.status, 1, missing.stderr);
  assert.ok(missing.stderr.includes("error: required option '--final-digest <digest>' not specified"), missing.stderr);
  assert.deepEqual(g.state(), before);
  for (const blank of ['', '   ', '\t', ' ', '　', '﻿']) {
    const r = g.seal(blank);
    assert.equal(r.status, 1, JSON.stringify(blank));
    assert.ok(r.stderr.includes(BLANK), `${JSON.stringify(blank)}: ${r.stderr}`);
    assert.deepEqual(g.state(), before, JSON.stringify(blank));
  }
  assert.deepEqual(g.sealed(), []);

  const unreadable = goal(t);
  mkdirSync(unreadable.ev.dir, { recursive: true });
  writeFileSync(unreadable.ev.manifestFile(), '{', 'utf8');
  const lookup = goal(t);
  const config = goal(t);
  writeFileSync(path.join(config.fx.tmp, 'aidlc.config.json'), '{', 'utf8');
  for (const [name, row, goalId] of [['a manifest that does not parse', unreadable, undefined], ['a goal that does not exist', lookup, 'g-missing'], ['a configuration that does not parse', config, undefined]] as const) {
    const held = row.state();
    const r = row.run(['audit', 'seal', '--final-digest', ''], { goal: goalId });
    assert.equal(r.status, 1, name);
    assert.ok(r.stderr.includes(BLANK), `${name}: ${r.stderr}`);
    assert.deepEqual(row.state(), held, name);
    assert.deepEqual(row.sealed(), [], name);
  }

  const spaced = goal(t);
  spaced.retain('a', 'dod-receipt', 'cand-1');
  const r = spaced.seal(' cand-1 ');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(spaced.sealed().at(-1)?.data['finalCandidateDigest'], ' cand-1 ');
  assert.equal(spaced.ev.load(spaced.goalId, 0, 0, T0).finalCandidateDigest, ' cand-1 ');
});

test('T0-AUDIT-BINDING: aidlc audit seal refuses unbound evidence, naming the ids, before anything is written or journaled', (t) => {
  const g = goal(t);
  const retain = (id: string, kind: string, ...candidate: string[]) => {
    const r = g.run(['evidence', 'retain', '--id', id, '--kind', kind, '--content', id, ...(candidate.length ? ['--candidate', candidate[0]!] : [])]);
    assert.equal(r.status, 0, r.stderr);
  };
  retain('a', 'dod-receipt', 'cand-1');
  retain('b', 'review-verdict');
  retain('c', 'artifact');
  retain('d', 'ci-run', '');
  retain('e', 'health');
  const before = g.state();
  const refused = g.seal('cand-1');
  assert.equal(refused.status, 1, refused.stderr);
  assert.ok(refused.stderr.includes(unboundText(g.goalId, 'b, d, e') + RETAIN_AGAIN), refused.stderr);
  assert.deepEqual(g.state(), before);
  assert.deepEqual(g.sealed(), []);

  for (const kind of ['dod-receipt', 'test-output', 'health']) {
    const one = goal(t);
    one.retain('u', kind);
    const held = one.state();
    const r = one.seal('cand-1');
    assert.equal(r.status, 1, kind);
    assert.ok(r.stderr.includes(unboundText(one.goalId, 'u') + RETAIN_AGAIN), `${kind}: ${r.stderr}`);
    assert.deepEqual(one.state(), held, kind);
  }

  for (const [id, kind] of [['b', 'review-verdict'], ['d', 'ci-run'], ['e', 'health']]) retain(id!, kind!, 'cand-1');
  const accepted = g.seal('cand-1');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(g.sealed().at(-1)?.data['finalCandidateDigest'], 'cand-1');
  const verified = g.run(['audit', 'verify']);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(report(verified.stdout).level, 'independently-verified', verified.stdout);

  const sealed = goal(t);
  sealed.retain('u', 'dod-receipt');
  sealed.librarySeal();
  const held = sealed.state();
  const again = sealed.seal('cand-1');
  assert.equal(again.status, 1, again.stderr);
  assert.ok(again.stderr.includes(unboundText(sealed.goalId, 'u') + SEALED_ALREADY), again.stderr);
  assert.deepEqual(sealed.state(), held);

  const reseal = goal(t);
  reseal.retain('a', 'dod-receipt', 'cand-1');
  reseal.librarySeal();
  const resealed = reseal.seal('cand-1');
  assert.equal(resealed.status, 0, resealed.stderr);
  assert.equal(reseal.ev.load(reseal.goalId, 0, 0, T0).finalCandidateDigest, 'cand-1');

  const rows: Array<[string, Array<[string, string, string?]>]> = [
    ['artifact and other with no digest', [['x', 'artifact'], ['y', 'other']]],
    ['review and Review-Verdict with no digest', [['x', 'review'], ['y', 'Review-Verdict']]],
    ['a review-verdict whose digest is a space', [['x', 'review-verdict', ' ']]],
    ['no manifest file', []],
  ];
  for (const [name, entries] of rows) {
    const row = goal(t);
    for (const [id, kind, digest] of entries) row.retain(id, kind, digest);
    const r = row.seal('cand-1');
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
  }
});

test('T0-AUDIT-BINDING: the seal checks the manifest of its lock section', (t) => {
  const g = goal(t);
  g.retain('a', 'dod-receipt', 'cand-1');
  const journal = g.state().journal;
  const r = g.run(['audit', 'seal', '--final-digest', 'cand-1'], { extra: { AIDLC_TEST_RETAIN_BEFORE_SEAL: 'late' }, preload: true });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes(unboundText(g.goalId, 'late') + RETAIN_AGAIN), r.stderr);
  const stored = g.ev.load(g.goalId, 0, 0, T0);
  assert.equal(stored.seal, undefined);
  assert.deepEqual(stored.entries.map((e) => e.id), ['a', 'late']);
  assert.equal(g.state().journal, journal);

  const locked = goal(t);
  locked.retain('u', 'dod-receipt');
  const before = locked.state();
  const lock = `${locked.ev.manifestFile()}.lock`;
  writeFileSync(lock, `pid=${process.pid} at=${T0} nonce=0badc0de`, 'utf8');
  t.after(() => {
    if (existsSync(lock)) unlinkSync(lock);
  });
  const refused = locked.seal('cand-1');
  unlinkSync(lock);
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /LOCKED/);
  assert.equal(refused.stderr.includes('holds evidence of a candidate-bound kind'), false, refused.stderr);
  assert.deepEqual(locked.state(), before);
});
