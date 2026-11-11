---
id: T0-EVIDENCE-ID-COLLISION
title: Evidence retain refuses, before any write, an id whose file name is another retained id's, the review copy directory, or a name other Windows tools cannot open, copy or delete
status: todo
branch: T0-EVIDENCE-ID-COLLISION
worktree: D:\wt\AIDLC\T0-EVIDENCE-ID-COLLISION
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: budget raised from 210 to 320 on the candidate 86f869ea, which is 294 changed lines; 21 source lines in src/audit/manifest.ts, 244 lines of the acceptance tests for the name classes of R2, the rest docs and attempt evidence"
allow_paths:
  - src/audit/manifest.ts
  - tests/scenarios/evidence-id.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-EVIDENCE-ID-COLLISION.md
dod_command: npm run typecheck && node --test tests/scenarios/evidence-id.test.ts tests/scenarios/manifest-lock.test.ts tests/surface/manifest.test.ts tests/surface/verifier.test.ts tests/scenarios/audit.test.ts tests/scenarios/card-close-cleanup.test.ts tests/scenarios/worktree-reclaim.test.ts
dod_exit: 0
requirements:
  - R1. `EvidenceStore.retain` shall derive the file name of an id as on main (src/audit/manifest.ts:79 at 92796d4f: each run of characters outside `A-Za-z0-9._-` becomes one `_`), so a name holds ASCII letters, digits, `.`, `_` and `-` only, and two names denote the same file when they are equal after ASCII lower-casing. Windows 8.3 short names (`NAME~1.EXT`) cannot arise from an id: `~` maps to `_` first.
  - R2. `EvidenceStore.retain` shall refuse the id, inside the locked section of card T0-MANIFEST-LOCK and before any write (no artifact file, no manifest write), when its file name is (a) empty; (b) ends with `.` (`.`, `..`, `a.`); (c) the same file as `review`, the directory of `.review/` copies that card close and worktree reclaim make (src/loop/card-runner.ts:3172, src/loop/worktree-reclaim.ts:129); (d) a name whose part before its first `.` is, ignoring case, one of the 24 Windows device names `CON`, `PRN`, `AUX`, `NUL`, `COM0` to `COM9`, `LPT0` to `LPT9`; or (e) the same file as the `path` of an entry of the stored manifest whose `id` differs from the given id. The reason for (b) and (d): Node on Windows does create `a.`, `nul` and `con` as files, but other Windows tools (Explorer, cmd, PowerShell, git) cannot open, copy or delete them by that name, and `.` and `..` name the evidence directory and its parent.
  - R3. Inside the section the refusals shall run in this order: the sealed check, the reserved manifest names of card T0-MANIFEST-LOCK, the rules (a) to (e) of R2 in that order, then the `evidence source missing` check; the first that applies is the one reported.
  - R4. New file names produced by R1 shall obey R2 identically on every platform; this does not repair existing manifests.
  - R5. A retain of an id the stored manifest already holds shall replace that entry and its file, as on main, unless a rule of R2 other than (e) refuses it; rule (e) compares only with entries of other ids, so in a legacy manifest whose two ids already share a path, a retain of either id is refused naming the other.
  - R6. The refusal shall name the id, its file name and the reason: `empty`, `ends with a dot`, the reserved name `review`, the device name, or the other id that has the same file.
  - R7. `aidlc evidence retain` shall exit non-zero with the refusal of R2 and append no `EVIDENCE_RETAINED` event.
  - R8. Every evidence id the loop names or that this repository has retained shall be accepted: `<card>.verdict` (the retain command `checkRetained` prints, src/loop/card-runner.ts:3153), `dod-<card>` (the docs/OPERATIONS.md Audit example at :510) and the 1,283 entries in 139 manifests under this repository's .aidlc/evidence on 2026-11-11, none of which R2 refuses and no two of which share a file in one manifest.
  - R9. `docs/OPERATIONS.md` (Audit) and `docs/ARCHITECTURE.md` (the `EvidenceStore.retain` item) shall state R2, R3 and R5; the CHANGELOG Unreleased section shall state R2, R5 and R7.
acceptance:
  - 1. `tests/scenarios/evidence-id.test.ts` "an id whose file name is another retained id's is refused": after retaining `a/b`, the ids `a_b`, `a b`, `a//b`, `A/B` and `A_b` are each refused naming `a/b`; after retaining `Dod-X`, `dod-x` is refused naming `Dod-X`. Each refusal leaves the artifact and manifest bytes unchanged. Fails on main (`a_b` overwrites the file of `a/b`). [R1] [R2] [R6] [dod arm 1]
  - 2. Same file "every class of R2": (a) the id `''` and (b) the ids `.`, `..`, `a.` and `x..` are refused with their reason; (c) `review`, `Review` and `REVIEW` are refused; (d) each of the 24 device stems is refused bare, with an extension (`.txt`) and in mixed case (`nUl.Log`); accepted near misses: `a.nul`, `console`, `com10`, `lpt`, `reviews`, `review.json`, `.x`, `a.b`, `nul_x`. Every refusal leaves the artifact and manifest bytes unchanged. RED on main: `a.`, `review` and the device names are accepted there; `''`, `.` and `..` fail on main with EISDIR, so their assertion is the early diagnostic of R6 together with unchanged bytes. [R2] [R4] [R6] [dod arm 1]
  - 3. Same file "the manifest names stay refused": `manifest.json`, `manifest.json.lock` and `manifest.json.tmp-1-abcdef12` are refused (rule of card T0-MANIFEST-LOCK, regression test here). [R3] [dod arm 1]
  - 4. Same file "order of the refusals": on a sealed manifest a colliding id gets the sealed refusal; a colliding id whose `--file` is missing gets the collision refusal; a reserved-and-device name such as `review.` gets rule (b). [R3] [dod arm 1]
  - 5. Same file "same-id replacement and a legacy manifest": `verdict` retained twice and `a/b` retained twice each leave one entry with the second content and digest; a manifest written by hand with ids `p/q` and `p_q` on one path refuses a retain of either id, naming the other, and a retain of `r` succeeds. [R5] [dod arm 1]
  - 6. Same file "two colliding retains in a deterministic interleave": a copy is loaded, `a/b` is retained, then `a_b` is retained with the copy; the second is refused naming `a/b`, because the section reads the stored manifest. Fails on main. [R2] [dod arm 1]
  - 7. Same file "the loop's ids are accepted": `T1-X.verdict`, `dod-T1-X`, `review/T1-X.json`, `T1-X/T1-X.pre.0.1.1.202b79d6.ac-coverage.json`, `r3-decision-2-verdict`, `merge-T1-X-pr22` and `arc-check` are retained into one manifest. [R8] [dod arm 1]
  - 8. Same file "the CLI refuses a colliding id and journals nothing": `aidlc evidence retain --id a_b` after `--id a/b` exits non-zero naming `a/b`, the goal journal has the same events and the file of `a/b` keeps its bytes. Fails on main. [R7] [dod arm 1]
  - 9. `tests/scenarios/manifest-lock.test.ts`, `tests/surface/manifest.test.ts`, `tests/surface/verifier.test.ts`, `tests/scenarios/audit.test.ts`, `tests/scenarios/card-close-cleanup.test.ts` and `tests/scenarios/worktree-reclaim.test.ts` pass unchanged (they retain `dod-receipt`, `dod`, `verdict`, `verdict.json`, `bound`, `free`, `a`, `b` and `x`). [R5] [R8] [dod arm 1]
  - 10. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and the CHANGELOG state what R9 assigns to each (reviewer-verified against the diff). [R9]
depends_on: [T0-MANIFEST-LOCK]
budget: 320
tdd: true
diagnosis:
  root_cause: "`EvidenceStore.retain` (src/audit/manifest.ts:79-80 at 92796d4f) maps an id to a file name by replacing characters outside `A-Za-z0-9._-` and writes the artifact there without checking which other id, directory or device that name already denotes. Entries are keyed by id while files are keyed by name, so two ids can share one file; `.` and `..` name directories, `review` is the copy directory of card close, and device names and trailing dots give files other Windows tools cannot handle."
  repro: "Audit of 2026-11-11 (Codex, reproduced by Fable xhigh with probes/p2-stores.mts) and the second card review of 2026-11-11 with probes: `a/b` then `a_b` left two entries over one file holding the second content; the id `..` threw EISDIR after nothing was recorded. Acceptance 1, 2 (except `''`, `.` and `..`, which assert the diagnostic), 6 and 8 fail on main."
  same_class: "Every place an evidence id becomes a path: `retain` (the only one; `intact` and `verifyAudit` join the stored `entry.path`). Every other name in `<evidence>/<goal>/`: `manifest.json`, `manifest.json.lock` and `manifest.json.tmp-*` (refused by card T0-MANIFEST-LOCK), and `review/<card>/` from `retireWorktree` (rule (c)). Case: the file name is ASCII after R1, so ASCII lower-casing decides sameness exactly."
sweep: "git grep -n 'replace(/\\[^A-Za-z0-9._-\\]\\|evidence retain\\|--id \\|retain(' -- src docs tests on main at 92796d4f. src: audit/manifest.ts:79 the name (checked here); loop/card-runner.ts:3153 prints `--id <card>.verdict` (accepted, R8); cli/main.ts:1306 `--id` is required and passed through (unchanged). docs/OPERATIONS.md:510 `--id dod-T1-STATUS-API` (accepted). Tests that retain ids and pin their acceptance, all to pass unchanged: tests/surface/manifest.test.ts:17-51 (`dod-receipt`, `verdict`, `x`, `a`, `b`), tests/scenarios/card-close-cleanup.test.ts:449-450 and :483-485 (`verdict.json`, `bound`, `free`), tests/scenarios/worktree-reclaim.test.ts:617 and :643 (`verdict.json`), tests/surface/verifier.test.ts:26 and :115 (`dod`, `a`), tests/scenarios/audit.test.ts:39 (`dod-receipt`). Live ids: a read-only scan of .aidlc/evidence/*/manifest.json on 2026-11-11 found 1,283 entries in 139 manifests (ids beginning T0, T1, review/, arc-, dod-, pack2, driver, successor, r3-, context and others); R2 refuses none and no two entries of one manifest share a file name ignoring case."
forbid: [weakening or skipping a test to go green, changing the file name of an id that R2 does not refuse (stored entries keep their path), renaming or moving files already retained, repairing an existing manifest, editing .aidlc state by hand]
non_goals: [names longer than the file system allows (the write fails with the system error before any entry is recorded, as on main), repairing a manifest that already holds two entries over one file (R5 refuses a further retain of either id, which is fail-closed), the lock, the sealed check and the manifest names (card T0-MANIFEST-LOCK)]
hygiene: "Line numbers are from main at 92796d4f; read them again at PREPARE, after card T0-MANIFEST-LOCK has merged: this card follows it into src/audit/manifest.ts and runs the checks of R2 inside the section that card adds, against the manifest that section reads. RED: acceptance 1, 2, 6 and 8 fail on main as each states. Before the first R3, revert each source hunk in a scratch copy and run acceptance 1 to 8, and keep every input class of R2 enumerated in the test as acceptance 2 lists it (lesson 2026-11-11 T0-AUDIT-FIXES). Create the test's temporary directories through a helper an after hook removes (lesson 2026-11-10 T0-EVAL-TEST-TEMP). Insert the CHANGELOG entry directly above the entry that begins `- T0-CARD-SIZE: `, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict."
doc_sync: docs/OPERATIONS.md (Audit), docs/ARCHITECTURE.md (the `EvidenceStore.retain` item), CHANGELOG.md
---

# T0-EVIDENCE-ID-COLLISION

## Deliverable
`aidlc evidence retain` refuses an id that would write over another retained file or the `review/` copy directory, and an id whose file name other Windows tools cannot open, copy or delete. A retain of the same id again still replaces its entry.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/evidence-id.test.ts tests/scenarios/manifest-lock.test.ts tests/surface/manifest.test.ts tests/surface/verifier.test.ts tests/scenarios/audit.test.ts tests/scenarios/card-close-cleanup.test.ts tests/scenarios/worktree-reclaim.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the existing retain tests pass unchanged.

## Attempt evidence

RED commit c1e0e6b3 (tests only). On main (c29c594a) six of the eight tests fail: 1 `expected the call to throw` (`a_b` accepted); 2 `id "": EISDIR: illegal operation on a directory`; 4 `evidence source missing` where the collision refusal is expected; 5 `expected the call to throw` (legacy `p/q`); 6 `expected the call to throw`; 8 `Expected "actual" to be strictly unequal to: 0`. Tests 3 and 7 pass on main, as the card says.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/evidence-id.test.ts` "an id whose file name is another retained id's is refused" | pass |
| 2 | same file, "every class of R2": (a) to (d) with the 24 device stems bare, lower case, `.txt`, mixed case and mixed case with `.Log`; near misses retained | pass |
| 3 | same file, "the manifest names stay refused" (passes on main too) | pass |
| 4 | same file, "order of the refusals": sealed, collision before missing source, `review.`, `nul.`, (c) and (d) before (e) | pass |
| 5 | same file, "same-id replacement and a legacy manifest" | pass |
| 6 | same file, "two colliding retains in a deterministic interleave" | pass |
| 7 | same file, "the loop's ids are accepted" (passes on main too) | pass |
| 8 | same file, "the CLI refuses a colliding id and journals nothing" | pass |
| 9 | DoD files `manifest-lock`, `surface/manifest`, `surface/verifier`, `audit`, `card-close-cleanup`, `worktree-reclaim`, unchanged | pass |
| 10 | `docs/OPERATIONS.md` (Audit, the retain paragraph), `docs/ARCHITECTURE.md` (evidence and audit chain, item 2), `CHANGELOG.md` entry above T0-CARD-SIZE | reviewer reads the diff |

Name rules run through `EvidenceStore.retain` on every platform: a refusal happens before any write, and the accepted near misses (`com10`, `console`, `a.nul`, `nul_x`) are not Windows device names, so no test creates a device-named file and none is gated on `process.platform`.

Reading of the card: the refusal text is `evidence id <id> has the file name <name>, refused: <reason>; choose another id`, with the reasons of R6 (`empty`, `ends with a dot`, `the reserved name review`, `the device name <stem>`, `the file of the id <other>`); the card fixes the reasons, not the sentence.

Revert check (each hunk reverted alone, the eight tests run): empty rule removed: "every class of R2"; dot rule: that test and "order of the refusals"; `review` rule: the same two; `review` case-sensitive: "every class of R2"; device rule removed, stem from the last dot, stem the whole name: "every class of R2" and "order of the refusals"; device stem case-sensitive, list without `com0`/`lpt0`, list without `con`: "every class of R2"; other-id rule removed: tests 1, 4, 5, 6, 8; other-id comparison case-sensitive: test 1; other-id rule also against the same id: test 5; rule against the argument manifest, not the stored one: test 6; rules after the missing-source check: tests 1, 2, 4, 5, 6, 8. No hunk left the tests green.
