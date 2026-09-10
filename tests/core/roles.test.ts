import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODELS, assessTaskEffort, resolveRoleProfile, reviewerIndependent } from '../../src/core/roles.ts';
import { EFFORT_LADDERS } from '../../src/core/effort.ts';
import type { EffortLevel } from '../../src/core/types.ts';

describe('role profiles (MA1 / MA3)', () => {
  test('defaults: Claude roles resolve to Opus 5 (investigator Sonnet 5); GPT roles to the configured seat', () => {
    const impl = resolveRoleProfile({ role: 'implementer', family: 'claude' });
    assert.equal(impl.model, 'claude-opus-5');
    assert.equal(impl.provider, 'anthropic');
    assert.deepEqual(impl.supportedEfforts, EFFORT_LADDERS['claude']);
    assert.equal(impl.readOnly, false);
    assert.equal(impl.roleCheck, 'not-run');
    assert.equal(resolveRoleProfile({ role: 'investigator', family: 'claude' }).model, 'claude-sonnet-5');
    assert.equal(resolveRoleProfile({ role: 'planner', family: 'gpt' }).model, DEFAULT_MODELS.gpt.planner.model);
    assert.deepEqual(resolveRoleProfile({ role: 'planner', family: 'gpt' }).supportedEfforts, EFFORT_LADDERS['gpt']);
  });

  test('reviewer and investigator are read-only; implementer gets write tools', () => {
    assert.equal(resolveRoleProfile({ role: 'reviewer', family: 'claude' }).readOnly, true);
    assert.equal(resolveRoleProfile({ role: 'investigator', family: 'gpt' }).readOnly, true);
    assert.ok(resolveRoleProfile({ role: 'implementer', family: 'claude' }).tools.includes('Edit'));
    assert.ok(!resolveRoleProfile({ role: 'reviewer', family: 'claude' }).tools.includes('Edit'));
  });

  test('configured seats override defaults and carry pool/tools', () => {
    const p = resolveRoleProfile({ role: 'reviewer', family: 'gpt', configured: { reviewer: { provider: 'openai', model: 'gpt-5.6-sol', pool: 'acct-a', tools: ['Read'] } } });
    assert.equal(p.pool, 'acct-a');
    assert.deepEqual(p.tools, ['Read']);
    assert.equal(resolveRoleProfile({ role: 'planner', family: 'claude' }).pool, 'anthropic:default');
  });

  test('MA3: a cross-family reviewer requirement flips the reviewer family only', () => {
    const r = resolveRoleProfile({ role: 'reviewer', family: 'claude', crossFamilyReviewer: true });
    assert.equal(r.provider, 'openai');
    const i = resolveRoleProfile({ role: 'implementer', family: 'claude', crossFamilyReviewer: true });
    assert.equal(i.provider, 'anthropic');
  });

  test('MA3: reviewer independence: read-only, not the author seat, cross-family when required', () => {
    const author = resolveRoleProfile({ role: 'implementer', family: 'claude' });
    const same = { ...resolveRoleProfile({ role: 'reviewer', family: 'claude' }), model: author.model, pool: author.pool };
    assert.equal(reviewerIndependent(author, same, false).ok, false);
    assert.equal(reviewerIndependent(author, { ...same, readOnly: false }, false).ok, false);
    const other = { ...resolveRoleProfile({ role: 'reviewer', family: 'claude' }), pool: 'anthropic:reviewers' };
    assert.equal(reviewerIndependent(author, other, false).ok, true);
    assert.equal(reviewerIndependent(author, other, true).ok, false, 'cross-family required');
    assert.equal(reviewerIndependent(author, resolveRoleProfile({ role: 'reviewer', family: 'gpt' }), true).ok, true);
  });

  test('MA2: task effort is assessed from the task itself and never starts at the ladder top', () => {
    const ladder = EFFORT_LADDERS['gpt']!;
    const levels: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
    const scopes: Array<'narrow' | 'moderate' | 'wide'> = ['narrow', 'moderate', 'wide'];
    const burdens: Array<'light' | 'moderate' | 'heavy'> = ['light', 'moderate', 'heavy'];
    const seen = new Set<EffortLevel>();
    for (const u of levels) for (const s of scopes) for (const r of levels) for (const b of burdens) {
      const e = assessTaskEffort({ uncertainty: u, scope: s, risk: r, verificationBurden: b }, ladder);
      assert.notEqual(e, ladder[ladder.length - 1], 'escalation headroom must remain');
      seen.add(e);
    }
    assert.ok(seen.has('low') && seen.has('high'), 'the assessment spans the usable range');
    assert.equal(assessTaskEffort({ uncertainty: 'low', scope: 'narrow', risk: 'low', verificationBurden: 'light' }, ladder), 'low');
    assert.equal(assessTaskEffort({ uncertainty: 'high', scope: 'wide', risk: 'high', verificationBurden: 'heavy' }, ['medium']), 'medium', 'a one-rung ladder returns its only level');
  });
});
