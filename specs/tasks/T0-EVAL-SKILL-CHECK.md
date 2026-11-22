---
id: T0-EVAL-SKILL-CHECK
title: An eval check `used-skill` passes on a `Skill` tool call naming the skill or a `Read` of its SKILL.md, so a skill invoked through the Skill tool is not scored as unused
status: todo
branch: T0-EVAL-SKILL-CHECK
worktree: D:\wt\AIDLC\T0-EVAL-SKILL-CHECK
allow_paths:
  - src/evals/runner.ts
  - tests/surface/evals.test.ts
  - evals/agent/add-test-reads-tdd-skill.json
  - evals/README.md
  - templates/evals/README.md
  - docs/OPERATIONS.md
  - changelog.d/T0-EVAL-SKILL-CHECK.md
  - specs/tasks/T0-EVAL-SKILL-CHECK.md
dod_command: npm run typecheck && node --test tests/surface/evals.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
acceptance:
  - 1. `EvalCheck` in `src/evals/runner.ts` gains `{ type: 'used-skill', name }`, a tool-call check. It passes when the recorded tool calls hold a `Skill` tool call whose `skill` input equals `name`, or a `Read` tool call of `.claude/skills/<name>/SKILL.md` (the `read-file` path comparison); otherwise it fails with a detail naming neither. With no model run, or no `toolCalls`, it fails with the same details as the other tool-call checks; a recorded empty list fails it. [dod arm 1]
  - 2. `tests/surface/evals.test.ts` gains a test, RED on main, that scores `used-skill` `tdd` against a `Skill` call with `skill: "tdd"` (pass), a `Read` of `.claude/skills/tdd/SKILL.md` (pass), a `Skill` call with `skill: "diagnose"` (fail), a `Grep` of the file (fail), an empty list (fail) and no `toolCalls` (fail). The existing test that every agent case has a tool-call check accepts `used-skill`. [dod arm 1]
  - 3. `evals/agent/add-test-reads-tdd-skill.json` replaces its `read-file` check with `used-skill` `tdd` and adds `Skill` to `allowedTools`; its `id` and `prompt` are unchanged. [dod arm 1]
  - 4. `evals/README.md`, `templates/evals/README.md` (kept identical where they are now) and `docs/OPERATIONS.md`, Evals, describe the check next to `read-file`. `changelog.d/T0-EVAL-SKILL-CHECK.md` holds the entry under this card id followed by one line feed. [dod arm 2]
tdd: true
budget: 60
forbid: [a change to the scoring of the four existing tool-call checks, a model-graded check, a change to the prompt of any eval case]
non_goals: [new skill trigger cases (issue 428), a change to any skill text, matching a skill invoked by a subagent the case starts]
hygiene: "Found by checking the repository skills against the skill-creator guide (anthropics/claude-plugins-official, plugins/skill-creator). The guide measures a skill by whether Claude consults it; in Claude Code a registered skill is consulted through the `Skill` tool, which `read-file` does not see (src/evals/runner.ts, the `read-file` branch matches `c.name === 'Read'` only). The one skill case, add-test-reads-tdd-skill, does not allow `Skill`, so today it can only pass by the path real sessions take less often."
doc_sync: changelog.d/T0-EVAL-SKILL-CHECK.md
sweep: "Main at dbdeb721. `grep -n read-file src/evals/runner.ts` - the check schema (:24), `TOOL_CALL_CHECKS` (:75), which turns on stream-json tool-call recording, and the scoring branch (:266-269), which matches `c.name === 'Read'` only. `grep -n read-file tests/surface/evals.test.ts` - the scoring table (:114), the no-model and no-toolCalls tests (:135, :647) and the rule that every agent case has a tool-call check (:312). `grep -rn read-file evals docs templates` - evals/README.md:13, templates/evals/README.md:13, docs/OPERATIONS.md:603. `grep -l skill evals/agent/*.json` - only add-test-reads-tdd-skill.json."
---

# T0-EVAL-SKILL-CHECK

From the skill-creator review of the repository skills, 2026-11-23.

## Diagnosis
`aidlc evals run` records tool calls and scores `read-file` on `Read` calls only.
The tdd, diagnose, grilling, merge-conflicts and secure-api-review skills are
registered skills, so a session uses them through the `Skill` tool with
`skill: "<name>"`. A case that asks "did the agent use the tdd skill" can only
check the `Read` path, and the one such case (`evals/agent/add-test-reads-tdd-skill.json`)
keeps `Skill` out of `allowedTools` to make that path the only one.

## Deliverable
One check type that accepts either path, the existing case moved to it, and the
docs that list the check types updated. Trigger cases for the other skills are
a separate issue; this card makes them scoreable.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/evals.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the new `used-skill` test and the existing eval tests pass; the changelog fragment is well formed.
