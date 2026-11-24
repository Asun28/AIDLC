---
name: ui-verify
description: >-
  Runtime check of a user-visible interface change: run the app, drive the
  changed flow, keep screenshots, and video when motion or timing matters.
  Use when an acceptance item asks for it or the card changes a file that
  the project's interface verify skill covers. Never otherwise.
---
# ui-verify: run it, drive it, keep the proof

Optional. It applies when an acceptance item asks for it, or when the card
changes a file that the project's interface verify skill covers. Otherwise
do nothing. It adds no gate: the DoD and the reviews decide as before.

## Set up once per interface
When an acceptance item asks for the check and the project has no verify
skill for that interface, write `.claude/skills/verify-<surface>/SKILL.md`
from what the repository holds, with no placeholder left:
- Coverage: the interface paths, and the sync commit, the commit on the
  base branch at which the check was last confirmed.
- Launch: the start command, the sign that the app is usable (not only
  that a process answers), and the stop command.
- Drive: the harness the project has (its browser tests, a device bridge).
  Prefer roles, labels and test ids to coordinates. Add no dependency.
- Flows: for each main flow, how a user reaches it and the end state that
  proves it.
- Cleanup: stop by pid what this run started; keep the captures.
Run it end to end once before it is committed.

## Evidence for each interface acceptance item
1. Capture before (on the base) and after (on the candidate), at the same
   viewport and with the same data. A new screen has no before: say so.
2. Assert the end state as text, role or stored data, and record the
   assertion beside its capture: one row per capture, in the columns of
   `.claude/agents/verifier.md`, with the expected state, the observed
   state, the capture and the verdict. A picture alone is not a pass.
3. Record video only when the item concerns motion, timing or a flow of
   several steps. With no recorder, take one numbered capture per step.
4. Use made-up data only: no real user data, secret or signed-in account.
5. A flow you did not run is a row too: `Unverified` with the reason, never
   a pass.

## Keep it
Write captures outside the worktree and never commit them. After
`aidlc card attempt` records the success, read `candidate.digest` from
`aidlc card status <card> --json` and keep each file:

    aidlc evidence retain --goal <goal> --card <card> --candidate <digest> --kind <screenshot|video> --id <card>-<sha7>-<item>-<capture>.<ext> --file <path> --note "<expected>; <observed>; <verdict>"

`<sha7>` is the start of the candidate commit, `<item>` the number of
the acceptance item and `<capture>` is `before`, `after`, `step-<n>` or
`video`. Give every file its own id: an id used again replaces the
earlier file. After a candidate that changes a covered file, take new
captures: the audit does not report an old one as stale.
