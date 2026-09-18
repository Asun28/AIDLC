# AIDLC project state

Updated: 2026-09-18 (main at `ab0c1df`). Working directory: `D:\Projects\AIDLC`; remote `Asun28/AIDLC`, ship path `github`.

## Current deliverable

The v5 plan (`docs/plans/PLAN-aidlc-loop.md`) is implemented as a TypeScript library and CLI in `src/`, with the Claude Code assets in `templates/` that `aidlc init` copies into a target repository. The plan documents, the capability comparison and the session review remain the requirement authority; this implementation is their runtime. Since 2026-09-10 the repository runs the loop on itself: every change is a card in `specs/tasks/`, shipped as a GitHub PR through the loop's own R2 (DeepSeek panel, three angles), R3 (Codex) and the four required CI checks.

## Verified

- `npm run check` on 2026-09-18 at `ab0c1df`: typecheck clean, 671 tests in 62 suites, 0 failures (29 s).
- CI on every PR: `check (ubuntu-latest, 22)`, `check (windows-latest, 22)`, `build-test`, `Gitleaks (committed history)`; all four required before a squash merge.
- Skill file sizes under their caps, asserted by `tests/surface/templates.test.ts`: SKILL.md 4394/4500, card-loop.md 6488/6500, arc.md 4109/4500, release.md 4488/4500, migrate.md 2267/3000 bytes. Headroom is small; a sentence added needs an equal cut in the same file.
- `docs/LESSONS.md`: 12 lessons, each written at CLOSE of the card that learned it.

## Merged through the loop (PRs #1-#22)

| PR | Card(s) | Change |
|---|---|---|
| 1-3 | T0-LOOP-SPEED, T0-LEASE-HEARTBEAT, T0-WAIT-VERIFY | one-process hooks, lease renewal on `card next`, WAIT resumes to RUN before VERIFY_ARC |
| 4, 8 | T0-PRE-REVIEW, T0-R2-PANEL, T0-R3-COMMAND | bounded R2 pre-review, the three-angle panel, R3 as a Codex command |
| 7, 9, 10, 12, 13 | T1-LOOP-SKILLS(-2), T1-LOOP-LADDER, T1-LOOP-LESSONS, T1-LOOP-RESUME | companion skills, directives carry skills and open questions, review blocks reopen the episode without spending an attempt, lessons at PREPARE and CLOSE, extension and resume |
| 11 | T1-LOOP-GATES-2 | the secret scan as a merge gate; required checks and the verdict rule from config to the GitHub ship path |
| 14, 16, 17, 18 | T0-SESSION-IDENTITY-3, T0-BIN-STALE-DIST-4, T0-CARD-TAKEOVER-2, T0-SHIP-BASE-SYNC-2 | session identity, `bin/` prefers `dist/` only when current, `aidlc card takeover`, merge-based base sync before the ship |
| 19, 20, 22 | T1-REVIEW-FINDINGS-4, T1-REVIEW-INPUTS, T1-REVIEW-STATS | findings with ids and dispositions, the recovery envelope, bounded and traceable review inputs, `aidlc review stats` |
| 21 | T0-ARC-EXTERN-DEP-2 | a prerequisite merged under another goal satisfies the arc gate |

Cards with a `-2`, `-3` or `-4` suffix replaced a predecessor stopped after two R3 decisions; the predecessors carry `superseded_by` and stay in the registry. Six of the merges (PRs #17-#22) landed under a human ruling after the second substantive R3 block, with every finding repaired first.

## Active goals (2026-09-18)

- `g-20260918020618-5688de` (T1, RUN): plan `plans/review-coverage.md`, three serial cards. T1-REVIEW-INVARIANTS (the NEVER and ALWAYS lessons in every R2 and R3 prompt, one finding per site) -> T1-REVIEW-COVERAGE (one coverage entry per acceptance item from the `ac-coverage` angle, joined per item, retained in shadow with the outcome unchanged) -> T1-REVIEW-COVERAGE-STATS (coverage completeness in `aidlc review stats`). Source: the GPT6 checked-graph card pack, reduced to briefs 06, 02-04 and 10; briefs 01, 05, 07, 08 and 09 cut or deferred, reasons in `intent/review-coverage.md`.
- `g-20260918021545-195e85` (T0, RUN): T0-PLANNING-CLAIMS. `aidlc doctor` names the goal and session that claims each uncommitted planning file (derived from the goal record and its lease, no claims file), and the Stop hook asks a session to commit its own goal's planning artifacts before it ends.

Every other goal is terminal (`aidlc goal list`).

## Accepted decisions (carried from v5)

- Accept dynamic requirements, old-card amendments, new systems and bugs; proportionate routing; automatic execution to integrated acceptance.
- Development, tests, review and integration are the default; deployment, migration and operations are opt-in per target and never activated by the presence of tools or files.
- Multiple sessions are a normal target: shared leases, generations, fencing and review admission live in `.aidlc/` under the main checkout; a single controller is an interim mode only. Planning artifacts drafted on main are claimed through the goal record and its lease (T0-PLANNING-CLAIMS).
- Task-based effort with at most three baseline attempts and one justified escalation; same cause twice stops early; quota and infrastructure failures do not escalate. A review block never spends an attempt.
- Development DONE is not board emptiness; full audit claims require the verifier and a host capture boundary.
- No new external orchestrator; this package is the orchestrator and adapts to project tools (scaffold `task.ps1`, `gh`, bound provider operations).
- Review policy at `REVIEW.md@3`: findings carry ids, dispositions and re-raise references; an unchanged candidate is never re-reviewed without a dispute; a diff over the byte cap is refused before dispatch; the second substantive R3 block stops the card for a human ruling.

## Next steps, in order

1. Run the two active goals to DONE through the loop (`aidlc next --goal <id>`), one card at a time; they share `docs/OPERATIONS.md` and `CHANGELOG.md`, which the merge-based base sync reconciles.
2. Once T1-REVIEW-COVERAGE-STATS has merged and a few cards have run in shadow, read `aidlc review stats` and decide on a required coverage mode (the pack's brief 05); keep it off until the numbers say otherwise.
3. Qualify `aidlc init` and the `scaffold` ship path against `D:\Projects\MyInspection` (dry run, then one T0 goal from the main checkout); `github` is qualified by this repository's own PRs.
4. Bind `aidlc.ops.json` in one downstream project and run a staging-only release attempt (Q16-Q22 in `docs/REQUIREMENTS-TRACEABILITY.md`).
