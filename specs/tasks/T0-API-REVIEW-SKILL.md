---
id: T0-API-REVIEW-SKILL
title: "secure-api-review checks authentication and personal data against what the project declares, its description names what it checks, and a surface test covers the file"
status: todo
branch: T0-API-REVIEW-SKILL
worktree: D:\wt\AIDLC\T0-API-REVIEW-SKILL
allow_paths:
  - templates/claude/skills/secure-api-review/SKILL.md
  - .claude/skills/secure-api-review/SKILL.md
  - tests/surface/templates.test.ts
  - changelog.d/T0-API-REVIEW-SKILL.md
  - specs/tasks/T0-API-REVIEW-SKILL.md
dod_command: npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. In both copies of `secure-api-review/SKILL.md` (`templates/claude/skills/` and `.claude/skills/`), rule 1 shall require the authentication scheme the project declares and allow as anonymous only the routes the project declares public, with the gateway JWT and `/health` named as the defaults for a project that declares none.
  - R2. Rule 5 shall keep out of logs, error messages, URLs and analytics the fields the project's data classification marks as personal data, with the schema tag `pii` named as the default for a project that declares none.
  - R3. The file shall say, above the rules, where each declaration is read (authentication and public routes in the OpenAPI `securitySchemes` and `security` entries, CLAUDE.md or the project's security docs; classification in the schema's field tags or the project's classification doc) and that a default applies only where the project declares none.
  - R4. The folded `description` shall name what the skill checks (authentication, authorization, input validation, audit events, PII in logs, sessions and tokens, error text) in place of "Apply the API security standard.", with its "Use whenever" sentence kept word for word.
  - R5. Every other line of the file shall stay as on main.
  - R6. The file shall stay ASCII, identical in both copies and at most 2500 bytes (1568 on main; 2500 is the smallest companion cap in use that holds the reworded file).
  - R7. `changelog.d/T0-API-REVIEW-SKILL.md` shall state that the installed secure-api-review skill checks authentication, public routes and personal data against what the project declares, with the gateway JWT, `/health` and the `pii` tag as defaults, and that its description names what it checks.
acceptance:
  - 1. `tests/surface/templates.test.ts` gains one test, placed after the companion-skills test, which stays as it is. For `templates/claude/skills/secure-api-review/SKILL.md` it asserts that the file exists, is at most 2500 bytes, is ASCII, starts with `---\nname: secure-api-review\n` and holds `\ndescription: >-\n`. These hold on main; they guard later edits. [R6] [dod arm 2]
  - 2. Same test. The description, read as the folded lines from `description: >-` to the closing `---` with runs of white space as one space and case ignored, holds each of `authentication`, `authorization`, `input validation`, `audit`, `pii`, `session` and `error`. RED on main, whose description holds none of them. [R4] [dod arm 2]
  - 3. Rules 1 and 5 and the paragraph above the rules read as R1, R2 and R3 say, the "Use whenever" sentence is word for word that of main, and no other line changes (reviewer-verified against the diff). [R1] [R2] [R3] [R4] [R5]
  - 4. `tests/surface/mirror.test.ts` passes with no change. [R6] [dod arm 3]
  - 5. `changelog.d/T0-API-REVIEW-SKILL.md` says what R7 says (reviewer-verified against the diff) in the form of `changelog.d/README.md`; the fragment and prose tests pass. [R7] [dod arms 4, 5]
depends_on: []
budget: 60
tdd: true
sweep: "On main at c44e06fc. `git grep -n -i 'secure-api-review' -- . ':!specs/tasks' ':!CHANGELOG.md'`: the two SKILL.md copies; README.md:70 and docs/OPERATIONS.md:13 (pinned by tests/infra/init.test.ts:168) name the path only; tests/surface/spec.test.ts:35 uses the name as fixture data. `git grep -n -E 'gateway JWT|anonymous routes|tagged .pii.'`: the two copies only, so no test or doc pins the reworded lines. `aidlc-loop/SKILL.md` does not name the skill, and the file has no attribution line, so the two companion assertions for those do not apply to it."
forbid: [a change to `CAPS` or `COMPANION_CAPS` in tests/surface/templates.test.ts, a change to another skill file]
non_goals:
  - "naming secure-api-review in `aidlc-loop/SKILL.md` or giving it an attribution line: it triggers from its own description and is not adapted from mattpocock/skills"
  - "trigger-rate cases for the skill (issue 428)"
  - "reasons for rules 2, 3, 4, 6 and 7 (issue 429)"
  - "a configuration key in which a project declares its scheme: the skill reads the project's own documents"
hygiene: "Issue 431, found by checking the repository skills against the skill-creator guide. The skill is installed downstream by `aidlc init` and is the only installed skill outside aidlc-loop with no surface test."
doc_sync: changelog.d/T0-API-REVIEW-SKILL.md
---

# T0-API-REVIEW-SKILL

From issue 431.

## Observation
`secure-api-review/SKILL.md` is installed into every downstream repository, and states one project's setup as the rule: rule 1 requires the gateway JWT and allows no anonymous route but `/health`, and rule 5 assumes a schema tag `pii`. A project with another scheme, health path or classification is told it is in breach. The description says "Apply the API security standard" without saying what the skill checks. No test reads the file.

## Deliverable
Rules 1 and 5 check the code against what the project declares, with the present values as defaults where it declares none; a paragraph above the rules says where the declarations are read. The description names the seven things the skill checks. One new surface test covers the file's existence, size, ASCII form, frontmatter and description.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the new test passes, the companion-skills test and the mirror test pass unchanged, and the fragment has the required form.
