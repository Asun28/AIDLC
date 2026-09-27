import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { JournalEvent, JournalEventType } from '../../src/core/types.ts';
import { Journal } from '../../src/state/journal.ts';

// Card T0-UNWRITTEN-EVENT-TYPES (issue 101, plan finding F4): the journal declares only event types some code writes.

/** The seven types no code wrote (survey of main ec8eb67). */
const REMOVED = ['CARD_AMENDED', 'LEASE_RELEASED', 'LEASE_FENCED', 'AUDIT_VERIFIED', 'INCIDENT_DETECTED', 'MODEL_INVOCATION', 'HOOK_DECISION'];
/** `JournalEventType` on main ec8eb67, in order. */
const DECLARED = [
  'GOAL_CREATED', 'GOAL_ROUTED', 'GOAL_REVISED', 'GOAL_STATE', 'GOAL_STOPPED', 'GOAL_DONE', 'GOAL_TAKEOVER', 'PLAN_INVOKED', 'PLAN_ACCEPTED',
  'CARDS_PROJECTED', 'CARD_STATE', 'CARD_DISPATCHED', 'CARD_RESULT', 'CARD_AMENDED', 'ATTEMPT_STARTED', 'ATTEMPT_FINISHED', 'REVIEW_REQUESTED',
  'REVIEW_ADMITTED', 'REVIEW_DECIDED', 'REVIEW_HOLD', 'PRE_REVIEW_DECIDED', 'FINDING_DISPUTED', 'FINDING_ACCEPTED', 'CI_CLASSIFIED', 'CI_RERUN',
  'OPERATION_INTENT', 'OPERATION_ISSUED', 'OPERATION_RESULT', 'OPERATION_RECONCILED', 'RELEASE_STATE', 'HEALTH_EVALUATED', 'AUTHORIZATION_GRANTED',
  'AUTHORIZATION_CHECKED', 'LEASE_ACQUIRED', 'LEASE_RENEWED', 'LEASE_RELEASED', 'LEASE_FENCED', 'EVIDENCE_RETAINED', 'MANIFEST_SEALED',
  'AUDIT_VERIFIED', 'INCIDENT_DETECTED', 'INTENT_FILED', 'MODEL_INVOCATION', 'HOOK_DECISION', 'NOTE',
];

/** A temp journal with one NOTE, and the event as written. */
function written(): { dir: string; event: JournalEvent } {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-jet-'));
  const event = Journal.forGoal(dir, 'g-1').append({ type: 'NOTE', goalId: 'g-1', data: { text: 'x' } });
  return { dir, event };
}

test('T0-UNWRITTEN-EVENT-TYPES acceptance 1: a journal event with a removed type fails the JournalEvent parse, and a journal line carrying one makes readAll throw [R1]', () => {
  const { dir, event } = written();
  try {
    assert.equal(JournalEvent.safeParse(event).success, true, 'the event as written parses');
    for (const type of REMOVED) {
      assert.equal(JournalEvent.safeParse({ ...event, type }).success, false, `${type} is no journal event type`);
      const file = path.join(dir, `${type}.jsonl`);
      writeFileSync(file, JSON.stringify({ ...event, type }) + '\n', 'utf8');
      assert.throws(() => new Journal(file).readAll(), (e: unknown) => e instanceof Error, `a journal line of type ${type} is refused`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T0-UNWRITTEN-EVENT-TYPES acceptance 1: every other declared type stays, in its order [R1]', () => {
  for (const type of REMOVED) assert.ok(!(JournalEventType.options as readonly string[]).includes(type), `${type} is removed`);
  const kept = JournalEventType.options.filter((t) => DECLARED.includes(t));
  assert.deepEqual(kept, DECLARED.filter((t) => !REMOVED.includes(t)), 'the kept types, in order');
});

const root = path.resolve(import.meta.dirname, '..', '..');
/** The CHANGELOG entry this card adds, one line under Unreleased. */
const CHANGELOG_ENTRY =
  "- Removed: seven journal event types no code writes, card T0-UNWRITTEN-EVENT-TYPES (issue 101, plan finding F4): `JournalEventType` no longer declares `CARD_AMENDED`, `LEASE_RELEASED`, `LEASE_FENCED`, `AUDIT_VERIFIED`, `INCIDENT_DETECTED`, `MODEL_INVOCATION` or `HOOK_DECISION`. No released version wrote them, so no persisted journal changes; library code that names one no longer typechecks. The verifier's trace check (`TRACE_MISSING`) reads `CARD_DISPATCHED` only, since no `MODEL_INVOCATION` was ever journaled. A writer wanted later brings its type back with its own acceptance item.";

test('T0-UNWRITTEN-EVENT-TYPES acceptance 3: CHANGELOG.md Unreleased carries the entry [R3]', () => {
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.ok(unreleased.split('\n').includes(CHANGELOG_ENTRY), 'CHANGELOG.md Unreleased carries the entry');
});
