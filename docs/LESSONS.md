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
- 2026-09-15 T0-SESSION-IDENTITY-3: NOTE when a card documents an operator recovery path, derive every precondition from the code that performs it (session, host, ownership generation) and name the unsupported cases; recovery text written from the happy path took three R3 blocks across T0-SESSION-IDENTITY and T0-SESSION-IDENTITY-2 (source: PR #14 review history)
- 2026-09-15 T0-BIN-STALE-DIST-4: NEVER spread process.env into the environment of a child a test spawns when the test asserts on a variable's absence; build the child environment at each call and drop every letter case of the variable, since Windows looks variables up case-insensitively (source: PR #15 and #16 review history, R3 decisions of T0-BIN-STALE-DIST-2 and -3)
- 2026-09-15 T0-CARD-TAKEOVER-2: NEVER narrow a read-then-write window one field per review round; when a review probes a window of a store without compare-and-set, state the limit and its recovery in the first candidate, since every round on a window found the next one (source: PR #17 review history, four R3 decisions and 25 findings across T0-CARD-TAKEOVER and T0-CARD-TAKEOVER-2)
- 2026-09-15 T0-SHIP-BASE-SYNC-2: NEVER let text from outside the producer (a filename, a configured base name, a verdict reason, command output) reach the ship output raw; flatten and encode every failure detail once at the single failure helper in the first candidate and prove a merge state from git (MERGE_HEAD) rather than from a line of text, since four R3 decisions across T0-SHIP-BASE-SYNC and T0-SHIP-BASE-SYNC-2 each found the next unencoded site (source: PR #18 review history, 12 findings)
