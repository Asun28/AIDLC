---
id: T1-OPUS55-PROMPTS
title: The R2 and R3 prompts and the reviewer agent end only on the verdict line and ask for every finding with the block rule deciding only the verdict, the implementer ends only on its report or a named blocker, and arc children receive the elapsed time against their deadline, per the Opus 5 and 5.5 prompting guides
status: merged
branch: T1-OPUS55-PROMPTS
worktree: D:\wt\AIDLC\T1-OPUS55-PROMPTS
allow_paths:
  - src/review/pre-review.ts
  - tests/surface/pre-review.test.ts
  - tests/surface/templates.test.ts
  - tests/surface/prose.test.ts
  - .claude/agents/reviewer.md
  - templates/claude/agents/reviewer.md
  - .claude/agents/implementer.md
  - templates/claude/agents/implementer.md
  - .claude/skills/aidlc-loop/arc.md
  - templates/claude/skills/aidlc-loop/arc.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-OPUS55-PROMPTS.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R7. The formal and pre-review prompts and the reviewer agent shall state that the reply ends with the verdict JSON line and that a progress note is not an end of the review.
  - R8. The agent prompts and skills shall carry the Opus 5 and 5.5 guide changes that apply to them, and no instruction a guide says to remove.
acceptance:
  - 1. `buildReviewPrompt` for the formal stage and for the pre-review stage (single pass and each perspective) contains the end-of-turn sentence: the reply ends with the verdict JSON line, and a progress note, a summary that announces a next step or an offer to continue is not the end of the review (pre-review.test.ts). [R7] [dod arm 1]
  - 2. The pre-review prompt asks for every finding and states that the block rule decides only whether a finding blocks, not whether it is reported (Prompting Claude Opus 5, code review: a "report only high-severity" instruction is followed literally and reports less) (pre-review.test.ts). [R8] [dod arm 1]
  - 3. `.claude/agents/reviewer.md` carries the end-of-turn rule as a numbered procedure step; `.claude/agents/implementer.md` states that its turn ends only with the report or a named blocker, never with a summary that announces the next step without taking it; each is byte-identical to its `templates/claude/agents/` copy (mirror.test.ts). [R7] [R8] [dod arm 1]
  - 4. `arc.md` lists the elapsed time against the deadline (`elapsed <s> / <s>`) among the inputs a child receives (Prompting Claude Opus 5.5, time signals for multiagent harnesses); both copies stay ASCII, identical and under their byte caps (templates.test.ts, mirror.test.ts). [R8] [dod arm 1]
  - 5. No agent, skill or review prompt file in the repository contains an instruction the two guides say to remove: a request to double-check or re-verify the answer, a "think carefully" or "think step by step" line, a "use a subagent to verify" line, or a "be conservative" or "only report high-severity" review limit; the ship evidence carries the grep and its empty result, and the audit table of every agent and skill file with the guide section it was checked against and the change or "no change" (prose.test.ts asserts the grep). [R8] [dod arm 1]
  - 6. CHANGELOG.md Unreleased carries the entry; `docs/OPERATIONS.md` names the end-of-turn rule in the review section. [R7] [dod arm 1]
depends_on: [T1-OPUS55-MODELS]
plan_ref: plans/opus-5-5.md#7
budget: 250
tdd: true
sweep: "grep -rniE 'double-check|re-verify|think carefully|step by step|subagent to verify|be conservative|only report|high-severity' .claude templates src/review REVIEW.md: no hit on 2026-09-24; the review prompts at pre-review.ts:243 and :247, the six agents and eleven skill files are the surfaces"
non_goals: [rewriting REVIEW.md, the verifier agent (a gate of this loop, not a self-verification instruction), SKILL.md and card-loop.md text (6 and 3 bytes under their caps; audited, not changed), prompt changes for R2 effort, the pasted-content and frontend guide sections (no such surface here)]
forbid: [changing the verdict schema or the review allowances, raising a skill byte cap]
hygiene: "The end-of-turn rule addresses the Opus 5.5 unattended-run behaviour: a turn can end on a progress note, which for a headless reviewer is a missing verdict and spends a decision. The prompt byte-equality tests in pre-review.test.ts change on purpose; the change is the new sentences only."
doc_sync: docs/OPERATIONS.md (Formal review), CHANGELOG.md
---

# T1-OPUS55-PROMPTS

## Deliverable
The review prompts and agents were written before Opus 5.5. Per the Opus 5.5 guide, an unattended turn can end on a progress note instead of the requested output; for a headless R3 reviewer that is a missing verdict, which spends one of two decisions. Per the Opus 5 guide, a review prompt that limits what is reported makes the model report less. This card adds the end-of-turn rule to the R2 and R3 prompts and the reviewer and implementer agents, separates "report" from "block" in the R2 prompt, gives arc children an elapsed-time signal, and records an audit of every agent and skill file against both guides.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
