---
slug: loop-integration
title: Companion skills, lessons and CI gates driven by the loop itself
intent: intent/loop-integration.md
status: accepted
created: 2026-09-14T00:00:00Z
skills_applied: [tdd, grilling]
---

# Spec: Companion skills, lessons and CI gates driven by the loop itself
From intent: intent/loop-integration.md. Status: accepted. Skills applied: tdd, grilling.

## Requirements (EARS)
- R1. The loop shall include a skills list in every routing result and every directive, computed from size, kind and card evidence.
- R2. WHEN a T1 or T2 goal enters PLAN, the loop shall name grilling and list the open questions of the known intent file.
- R3. WHEN a card enters BUILD, the loop shall name tdd, and diagnose as well for a bugfix goal or a card with a diagnosis field.
- R4. WHEN the ship path reports a merge conflict, the loop shall return the card to BUILD naming merge-conflicts with the effort episode reopened and the DoD receipt cleared.
- R5. WHEN a card enters PREPARE, the loop shall provide the lessons file reference and its recent entries.
- R6. WHILE a card has no lesson disposition, the loop shall keep lessons among the missing closure steps.
- R7. WHEN a CI check named for a secret scan fails, the loop shall classify the failure as security, refuse a rerun and stop the card with reason risk.
- R8. The loop shall pass configured required checks and verdict policy to the GitHub ship path and treat a required check absent from the run list as pending.
- R9. WHERE a real evals provider is configured, the evals job shall run one case per companion skill.
- R10. WHEN a pre-review block returns a card to BUILD, the loop shall reopen the effort episode without converting the blocked attempt into a counted failure.
- R11. WHEN a formal review block returns a card to REVIEW_FIX, the loop shall reopen the effort episode the same way, so the two-decision allowance is the only budget the formal review consumes.
- R12. The loop shall count only DoD failures toward the effort ladder.

## Design
Skills are computed once by the router next to modules and travel with the routing result into the goal, the journal, the route line and the directive base. Card directives set the skill for their own step (build, prepare, the merge-conflict return). Lessons are a sixth closure predicate with an explicit disposition recorded by aidlc card close. The secret scan is a blocking workflow job whose check-run name the CI classifier recognises as the security class. Required checks are a config block passed to the GitHub ship path.

## Interfaces and contracts
- RoutingResult.skills (string list, default empty); Directive base skills (default empty); CardDirective.skills optional.
- Goal.intentRef optional; aidlc goal new --intent <file>.
- CardRun.closure.lessons boolean (default false); aidlc card close --lesson "<KIND> <rule> (source: <ref>)" or --no-lesson "<why>"; --all leaves lessons untouched.
- CiFailureClass gains security; ProjectConfig.github block: requiredChecks, requireVerdict, ciTimeoutMs, ciPollMs.
- docs/LESSONS.md line format is frozen: - YYYY-MM-DD <ref>: NEVER|ALWAYS|NOTE <rule> (source: <ref>).

## Data model and migration impact
Persisted goals and card runs gain defaulted fields; records written before this change parse unchanged. No migration.

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- A hard PLAN gate that refuses to advance while open questions remain.
- Merge-conflict handling for the scaffold ship path.
- Behaviour evals beyond one fact per skill.
- A local secret scanner bound to aidlc security check.

## Acceptance
- 1. aidlc goal new prints skills= in the route line and the routing result carries the list per size. [R1]
- 2. The T1/T2 plan directive names grilling and lists the open questions of the intent. [R2]
- 3. The build directive names tdd, and diagnose on bugfix evidence. [R3]
- 4. A merge-conflict ship outcome yields a build directive naming merge-conflicts, with a following attempt accepted. [R4]
- 5. The prepare directive carries the lessons reference and recent entries. [R5]
- 6. The close directive lists lessons until a disposition is recorded; a recorded lesson is one valid appended line. [R6]
- 7. A red secret-scan check stops the card with reason risk and no rerun. [R7]
- 8. Required checks and verdict policy reach the ship path from config; an absent required check is pending. [R8]
- 9. Deferred: one eval case per companion skill under the real provider. [R9]
- 10. A review-blocked attempt stays a success; the episode reopens and the repair is admitted at the same effort. [R10] [R11]
- 11. Four review blocks on a card that passes its DoD leave the ladder untouched; three DoD failures still stop it. [R12]
