---
id: T0-STALE-DOCS-REMOVE
title: "Remove the two out-of-date docs that Claude and Codex agreed are unnecessary: docs/PROJECT-STATE.md and docs/plans/PLAN-aidlc-loop-v3-archive.md"
status: todo
branch: T0-STALE-DOCS-REMOVE
allow_paths:
  - docs/PROJECT-STATE.md
  - docs/plans/PLAN-aidlc-loop-v3-archive.md
  - docs/plans/PLAN-aidlc-loop.md
  - README.md
  - tests/surface/removed-surface.test.ts
  - changelog.d/T0-STALE-DOCS-REMOVE.md
  - specs/tasks/T0-STALE-DOCS-REMOVE.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/surface/removed-surface.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The repository shall not contain `docs/PROJECT-STATE.md`, and `README.md` shall not name it (the bullet at `README.md:190` goes).
  - R2. The repository shall not contain `docs/plans/PLAN-aidlc-loop-v3-archive.md`, and `docs/plans/PLAN-aidlc-loop.md` section 10 shall name `the historical v4 archive` where it now says `historical v4/v3 archives`.
  - R3. The change shall leave `docs/plans/PLAN-aidlc-loop.md`, `docs/plans/PLAN-aidlc-loop-v4-archive.md` and `docs/migration/file-transfer-manifest.json` present, the manifest and every card file byte-identical to main, and one changelog fragment shall record both removals.
acceptance:
  - 1. `tests/surface/removed-surface.test.ts`, new test `T0-STALE-DOCS-REMOVE`: both removed paths do not exist; `README.md` does not contain `PROJECT-STATE`; `docs/plans/PLAN-aidlc-loop.md` contains `the historical v4 archive` and not `v4/v3`. RED on main. [R1] [R2] [dod arm 3]
  - 2. The existing `T1-SWEEP-DEAD-CODE acceptance 6` test passes unchanged (canonical plan, v4 archive and manifest still exist); `git diff origin/main --stat -- docs/migration specs/tasks` lists only this card's file. [R3] [dod arm 3]
  - 3. `changelog.d/T0-STALE-DOCS-REMOVE.md` holds one line in the form of `changelog.d/README.md`. [R3] [dod arm 3]
  - 4. The typecheck and `npm run check:tree` are clean. [dod arm 1] [dod arm 2]
depends_on: []
budget: 40
tdd: true
sweep: "Main at c5eee64f. `git grep -n PROJECT-STATE` outside specs/tasks and CHANGELOG.md finds README.md:190 only; the file's own line 3 says it is a 2026-09-18 snapshot not kept current. `git grep -n PLAN-aidlc-loop-v3-archive` finds docs/migration/file-transfer-manifest.json:3 (a past-transfer record that specs/dead-code-sweep.md non-goals keep unedited) and the sweep text of T0-PREPARE-START-CMD; PLAN-aidlc-loop.md:533 calls it historical. `cards validate` checks allow_paths strings, counts, tiers and overlap, not file existence (src/artifacts/card.ts:161, :263), so the historical cards T0-CARD-SHORT and T1-CI-SHARD that list PROJECT-STATE.md stay valid. Callers grep (lesson T0-HOOK-FAIL-CLOSED): no test under tests/ reads PROJECT-STATE.md, the v3 archive, README.md:190 or the `v4/v3` text; tests/surface/removed-surface.test.ts:43 requires only the canonical plan, the v4 archive and the manifest."
forbid: [network]
non_goals:
  - "docs/plans/REVIEW-claude-session-lifecycle.md, root aidlc.ops.example.json and root bands.yaml: proposed by one reviewer, kept on agreement (cited rationale; dogfood copies of `aidlc init` output)"
  - "prose-pin tests such as `T1-REVIEW-BENCH-2 acceptance 15` and `T0-HOOK-LAZY-2 acceptance 5`: the owner decision of 2026-11-19 (docs/reliability/test-audit.md) gates any test removal on approved audit rows"
  - "editing docs/migration/file-transfer-manifest.json or historical cards, CHANGELOG.md or LESSONS.md that name the removed files"
hygiene: "Planned 2026-11-27 from an independent cleanup audit by Claude and Codex (two rounds); only the items both agreed to remove are in this card."
---

# T0-STALE-DOCS-REMOVE

## Why
Claude and Codex each audited the tracked files for old, out-of-date or
unnecessary files, scripts and tests, then settled the differences in a second
round. Source exports, scripts, bench data, reviewer bench cases, workflows and
tests had no agreed removal. Two docs did:

- `docs/PROJECT-STATE.md` states it is a 2026-09-18 snapshot that is not kept
  current; `git log`, `specs/tasks/` and `CHANGELOG.md` hold the current state.
- `docs/plans/PLAN-aidlc-loop-v3-archive.md` is the v3 plan, replaced by the v4
  archive and the canonical v5 plan, and read by no code or test.

## PR summary

### What
This change removes `docs/PROJECT-STATE.md` and `docs/plans/PLAN-aidlc-loop-v3-archive.md`. The README and the v5 plan no longer name them.

### Why / Intent
Claude and Codex audited the repository for old files. Both agreed that only these two files were out of date and not used.

### How / Behaviour
The change deletes the two files and the README bullet. The v5 plan now names only the v4 archive.

### System impact
No code changes. The canonical plan, the v4 archive and the transfer manifest stay.

### Security
No security impact. The change removes documentation only.

### Tests and review
A new test in `tests/surface/removed-surface.test.ts` checks the removals. R3 review is by Codex.

### Risk
Low. No code or test reads the removed files. Old cards still name them as history.

### Ownership
The aidlc maintainers own these docs.

### Docs
README.md, the v5 plan and one changelog fragment change.

## Attempt evidence

| item | proof | result |
| --- | --- | --- |
| 1 | `tests/surface/removed-surface.test.ts`, `T0-STALE-DOCS-REMOVE acceptance 1`; RED at 1ea31151 | pass |
| 2 | same file, `T1-SWEEP-DEAD-CODE acceptance 6` unchanged; `git diff origin/main --stat -- docs/migration specs/tasks` lists only this card | pass |
| 3 | `changelog.d/T0-STALE-DOCS-REMOVE.md`; `tests/surface/changelog-fragments.test.ts` | pass |
| 4 | `npm run typecheck` and `npm run check:tree` | pass |
