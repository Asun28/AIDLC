---
slug: review-verification
title: Verify the card-run write protocol and measure the reviewers, from the code-review study
intent: intent/review-verification.md
status: accepted
created: 2026-10-19T09:50:00Z
skills_applied: [tdd]
---

# Spec: Verify the card-run write protocol and measure the reviewers, from the code-review study
From intent: intent/review-verification.md. Status: accepted. Skills applied: tdd.

## Requirements (EARS)
- R1. The test suite shall run each covered card-run command once per store write and journal append that the command performs, fail that one write, run the card's next step again, and check the persisted card run and the goal journal against the invariants the card names.
- R2. The test suite shall show that the fault-point check fails on a component whose write order is broken.
- R3. IF the fault-point check fails on the current code, THEN the loop shall keep the property unchanged and carry the counterexample, as steps in the code's words, to a T0-bugfix card.
- R4. The repository shall carry a project-local verify skill that states the property and the harm in one sentence each, the covered files and functions, the sync commit, the run command, the bounds and assumptions, the real-code variant used to show the check failing, how to tell a modelling error from a bug, and how to extend the check when a covered command gains a write.
- R5. WHEN a card changes a file that a project verify skill covers, the card-loop skill text shall tell the agent to run that skill's check before SHIP and to move the sync commit only after confirming that the check describes the code at the new commit.
- R6. The loop shall parse reviewer bench cases from `evals/review/*.json` with a zod schema: a bug case names the candidate and base commits, the card text, and one or more expected locations (file, line, window) with a defect class; a clean case names the candidate and base commits and the card text; every case carries `confirmed` and `origin`.
- R7. WHEN `aidlc review bench run --stage <pre|formal>` runs, the loop shall run that stage's configured reviewer on every confirmed case's candidate in a detached temporary checkout, report per bug case whether a cited block reason lands inside an expected window and per clean case whether the review blocked, report recall and the false-block rate, and remove every temporary checkout.
- R8. WHEN `aidlc review bench export --card <id>` runs, the loop shall write one unconfirmed draft case per formal finding of the card's runs, with its candidate commit, cited location and class, and pin each candidate commit under `refs/aidlc/bench/` so that garbage collection keeps it.
- R9. The reviewer bench shall never run in CI, never change a card run, and never block a card.
- R10. WHERE a block reason carries `(class: <slug>)`, the loop shall record the slug as the finding's class.
- R11. WHEN a block returns a card to REVIEW_FIX, the repair directive shall list each class of the block with its cited sites and ask the author to fix every site of that class inside the card's allowed paths.
- R12. The review prompts, REVIEW.md and the reviewer agent shall ask for a class on each block reason and, on a later round or decision, ask the reviewer to check that every site of each prior class was fixed.
- R13. The `aidlc review dispute` command shall accept a kind `wrong`, `intentional` or `not-worth-fixing`, default `wrong`, and record it on the dispute with the note.
- R14. IF a reason tagged `[pre-existing]` cites a line that the candidate diff did not change, THEN the loop shall treat the reason as advisory in both stages.
- R15. IF a reason tagged `[pre-existing]` cites a changed line or no line, THEN the loop shall classify the reason as if the tag were absent.
- R16. The `aidlc review stats` command shall report findings by response (fixed, wrong, intentional, not-worth-fixing, open) and the count of pre-existing advisory reasons.
- R17. WHEN `aidlc card mutants <id>` runs, the loop shall apply each mutation operator to the changed source lines of the card's committed candidate one mutant at a time, run the card's DoD command per mutant under a timeout, restore the file, and write each mutant's file, line, operator and outcome to `<worktree>/.review/<card>.mutants.json` bound to the candidate commit.
- R18. IF the card worktree has uncommitted changes, THEN the `aidlc card mutants` command shall refuse before it writes any file.
- R19. The `aidlc card mutants` command shall stop at a mutant cap and report how many mutants it skipped.
- R20. WHEN a mutant report exists for the current candidate commit, the R3 prompt shall list its surviving mutants as advisory evidence that never blocks by itself.
- R21. The loop documentation shall record each card's behaviour in `docs/OPERATIONS.md`, in `docs/ARCHITECTURE.md` where the card changes the loop, and in the CHANGELOG Unreleased section.
- R22. The test suite shall check, after recovery from each single fault, that the card run reaches the state the fault-free run reaches, failing on every violation that is not on a pinned list of known violations with their counterexamples.
- R23. WHEN a pinned known violation no longer reproduces, the test suite shall fail and name that violation.

## Design
Two groups of work. Verification: a node:test file drives the real `CardRunner` and injects each fault at the `node:fs` calls that every card-run write and journal append passes through (`renameSync`, `appendFileSync`), the boundary `docs/LESSONS.md` asks ordering claims to be proven against, rather than at a mock of the repository's own classes. A first pass counts the writes of the command; the enumerator then reruns the scenario from the same fixture N times, failing write k on run k, runs `card next` again, and checks the invariants. A small in-test component with a deliberately wrong write order proves that the enumerator can fail. A second card adds liveness: after recovery the run reaches the state the fault-free run reaches; each violation the current code shows is pinned with its counterexample, so the suite stays green, a fix must remove its pin, and every confirmed violation becomes a T0-bugfix card. The project-local skill wraps this check for the next agent, following the cursor verification skills (true to the code, able to fail, findings stay findings, honest scope, cheap to rerun, kept in step through a sync commit). The card-loop text gains one generic rule so a downstream repository's own verify skills are used the same way.

Review measurement: the bench reuses `buildReviewPrompt`, `runReviewPanel` and the configured commands, so a case is reviewed exactly as a card would be. Cases live in `evals/review/` beside the existing evals and are scored by location window. The exporter reads the card-run ledgers and pins candidates. The class tag, the response kinds and the pre-existing tag travel in reason text and CLI flags; the ledger gains optional fields that parse old records unchanged. The mutant command is an in-house text mutator over the changed hunks of source files; its report reaches R3 the way the pre-review advisory notes do.

## Interfaces and contracts
- `ReviewFinding.class` (optional string), `ReviewFinding.disputes[].kind` (optional `wrong|intentional|not-worth-fixing`); old records parse unchanged.
- Reason text: `(class: <slug>)` after the dimension; `[pre-existing]` as an advisory tag in the same positions as `[question]` and `[suggestion]`.
- `ReviewBenchCase` zod schema in `src/core/types.ts`; files under `evals/review/`.
- CLI: `aidlc review bench run --stage <pre|formal> [--dir evals/review] [--case <id>]`, `aidlc review bench export --card <id> [--goal <id>]`, `aidlc review dispute <card> <id> --note "<why>" [--kind <kind>]`, `aidlc card mutants <id> [--max <n>] [--timeout-ms <n>]`.
- Prompt sections: the repair directive's class list; `## Surviving mutants` in the R3 prompt.
- `reviewPolicyVersion` moves to `REVIEW.md@4` in both configs if a card changes REVIEW.md's output contract.
- The verdict JSON schema (`VERDICT_SCHEMA`) is frozen.

## Data model and migration impact
Optional fields on `ReviewFinding` and its disputes; a new case file format; refs under `refs/aidlc/bench/`. No migration: records written before the change parse unchanged.

## Flagged concerns (route to policy owners)
- `[pre-existing]` lets a reviewer downgrade a finding. The tag only counts when the cited line is outside the candidate's changed hunks, a check made in code, so a defect on a changed line still blocks.
- Pinning candidate commits keeps old objects in the repository; the refs are local and never pushed.

## Non-goals
- A TLA+ model or any verifier that needs Java or a new dependency.
- Running the reviewer bench in CI, or as a gate on a card.
- Verifier voting on findings (the measured problem is recall at R2 and repeated classes, not precision).
- A tier path that skips R2: 0 of 156 cards had docs-only allowed paths.
- Changing the R2 rounds, the R3 decision allowance or the stop rule (the loop-efficiency goal owns them).
- Fixing a defect that the fault-point check finds; that is a T0-bugfix card.

## Acceptance
- 1. The fault-point test fails each covered command at every write in turn and passes on the current code; its self-test fails on the broken-order component. [R1] [R2] [R3]
- 8. The liveness check runs over the same fault points; each violation of the current code is on the pinned list with its counterexample; removing a pin or fixing a pinned violation fails the test. [R22] [R23]
- 2. The verify skill exists with every section R4 names, a sync commit and a recorded real-code break; both card-loop copies carry the rule under the byte cap. [R4] [R5]
- 3. `review bench run` scores scripted fixture cases (one hit, one miss, one clean pass, one clean block) with the right recall and false-block rate and leaves no checkout; `review bench export` writes unconfirmed cases and pins the candidates. [R6] [R7] [R8] [R9]
- 4. A block reason with `(class: x)` records the class; the REVIEW_FIX directive lists it with its sites; the prompts, REVIEW.md and the reviewer agent ask for it. [R10] [R11] [R12]
- 5. `review dispute --kind` records the kind; `[pre-existing]` on an unchanged line is advisory and on a changed line blocks; `review stats` reports responses and the pre-existing count. [R13] [R14] [R15] [R16]
- 6. `card mutants` reports a surviving and a killed mutant from a fixture card, refuses a dirty worktree, stops at the cap, and the R3 prompt lists the survivors for the current candidate only. [R17] [R18] [R19] [R20]
- 7. Each card's docs and CHANGELOG entry exist. [R21]
