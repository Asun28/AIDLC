# Lessons

Durable rules this repository learned from its own review blocks and
incidents. Append-only: one dated line per lesson, written at CLOSE of the
card that learned it, only when a review block or an incident taught a
rule the playbook did not already state. Past lines are never rewritten;
a superseded lesson gets a new line that names it. PREPARE reads this
file once per card.

Format: `- YYYY-MM-DD <card or incident>: NEVER|ALWAYS|NOTE <rule> (source: <verdict, PR or incident ref>)`

## Lessons
- 2026-09-14 T1-LOOP-SKILLS-2: NEVER let a review block spend a build attempt; the ladder counts DoD failures only and reviews keep their own rounds and decisions (source: PR #9 review history, two episodes ended escalation-failed with every finding fixed)
