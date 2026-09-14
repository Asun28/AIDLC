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
- 2026-09-14 T1-LOOP-LADDER: NEVER edit a card file on main and on its branch in separate commits; write the registry copy on main before branching and sync the branch text to main before the ship, since adjacent-line edits conflict and GitHub runs no pull_request workflow on a conflicting PR (source: PR #10, no check runs until main carried the branch card text)
- 2026-09-14 T1-LOOP-LESSONS: NEVER guard a shared file with a Node file lock when a fenced lease already owns the writer; append-only writes and an idempotent retry are the serialisation, and every review round on a lock protocol found a new corner (source: PR #12 review history, two R3 decisions and five R2 rounds)
- 2026-09-14 T1-LOOP-RESUME: NOTE when a review finding overrules a mechanism the card acceptance names, amend the card on main and merge main into the branch before the next R2 round; the panel reads the card from the base and blocked twice on the stale text (source: PR #13 review history, R2 cycle 2 rounds 1 and 2)
