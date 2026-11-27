---
id: T0-CLAUDE-MD-DUPES
title: "CLAUDE.md drops the lines package.json, tsconfig.json and docs/ARCHITECTURE.md already state, and its bold lead-ins"
status: todo
branch: T0-CLAUDE-MD-DUPES
allow_paths:
  - CLAUDE.md
  - tests/surface/claude-md-dupes.test.ts
  - changelog.d/T0-CLAUDE-MD-DUPES.md
  - specs/tasks/T0-CLAUDE-MD-DUPES.md
dod_command: npm run typecheck && node --test tests/surface/claude-md-dupes.test.ts tests/surface/claude-md-size.test.ts tests/surface/claude-md-reuse.test.ts tests/surface/bench.test.ts tests/infra/build-atomic.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/templates.test.ts tests/surface/command-lines.test.ts tests/surface/prose.test.ts tests/surface/layers.test.ts tests/infra/stray-processes.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The Commands block of `CLAUDE.md` shall drop the four lines that restate a `package.json` script and add nothing to it, `npm run typecheck`, `npm test`, `npm run test:watch` and `npm run dev`, and keep its other lines as they are.
  - R2. The Architecture paragraph that starts with the layer list shall drop the list of `src/` directories and keep, from `docs/ARCHITECTURE.md`, Module map, describes each, its text as it is.
  - R3. The first Conventions bullet shall name ESM and the explicit `.ts` extension of relative imports, and leave `erasableSyntaxOnly` and `verbatimModuleSyntax`, which `tsconfig.json` enforces and the typecheck reports, to that file.
  - R4. The five bold lead-ins of the Architecture section (`One directive per call.`, `Layers, inner to outer`, `Card state is selected, not stored.`, `Review before ship.`, `Every side effect is injectable.`) shall lose their bold markup; `CLAUDE.md` shall hold no bold span after this card, that is no `**` at a line start or after white space and followed by a character that is not white space; the path globs `templates/claude/**` and `.claude/**` stay (owner amendment of 2026-11-27).
  - R5. No other line of `CLAUDE.md` changes, `templates/CLAUDE.aidlc.md` does not change, and every test that pins `CLAUDE.md` text passes unchanged.
  - R6. `changelog.d/T0-CLAUDE-MD-DUPES.md` shall state R1 to R4 and the line count before and after.
acceptance:
  - 1. `tests/surface/claude-md-dupes.test.ts`, new file: the Commands block of `CLAUDE.md` holds no line that starts with `npm run typecheck`, `npm test`, `npm run test:watch` or `npm run dev` and still holds the lines starting `npm run check`, `node --test tests/core/router.test.ts`, `node --test --test-name-pattern`, `npm run build`, `node bin/aidlc.js <cmd>` and `npm run bench`; the file names none of `erasableSyntaxOnly`, `verbatimModuleSyntax` and `` `core/` (pure decision engines``; it holds no match of `(^|s)**S` (owner amendment of 2026-11-27); it still holds `Relative imports carry an explicit` and `.ts` extension in Conventions. RED on main, which holds each removed text. [R1] [R2] [R3] [R4] [dod arm 2]
  - 2. Same file: `CLAUDE.md` has fewer than 199 lines, its count on main at 5ef3ec3e. `git diff` against the base shows only the removed lines, the rewrapped lines of the Layers paragraph and the first Conventions bullet, and the dropped `**` (reviewer-verified against the diff). [R5] [dod arm 2]
  - 3. `tests/surface/claude-md-size.test.ts`, `claude-md-reuse.test.ts`, `bench.test.ts`, `tests/infra/build-atomic.test.ts`, `tsconfig-gate.test.ts`, `templates.test.ts`, `command-lines.test.ts`, `prose.test.ts`, `layers.test.ts` and `tests/infra/stray-processes.test.ts` pass unchanged; `git diff` shows no change to `templates/CLAUDE.aidlc.md`. [R5] [dod arm 2]
  - 4. `changelog.d/T0-CLAUDE-MD-DUPES.md` holds one line in the form of `changelog.d/README.md` stating R1 to R4 and the line counts (`tests/surface/changelog-fragments.test.ts` passes). [R6] [dod arm 2]
  - 5. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 60
tdd: true
sweep: "On main at 5ef3ec3e `CLAUDE.md` is 199 lines. The plan agreed with Codex on 2026-11-26 (issue 500 comment) names the Commands block (`CLAUDE.md:12`, mirroring `package.json` scripts), the layer list (`:45`), the conventions `tsconfig.json` enforces (`:94`) and the bold at `:40`, `:55` and `:62`. Tests pin some of that text, so it stays: `tests/surface/bench.test.ts:249` (the `npm run bench` line), `tests/infra/build-atomic.test.ts:327` (the `npm run build` line), `tests/surface/tsconfig-gate.test.ts:24` (the `There is no linter` sentence), `tests/surface/claude-md-reuse.test.ts:12` (from `docs/ARCHITECTURE.md`, Module map, describes each, onward), and `tests/surface/claude-md-size.test.ts` (the limit sentence and the adapter clause). No test pins the four script lines, the layer list words, the two tsconfig option names or the bold. `tests/surface/layers.test.ts` names the Layers sentence in a comment only and reads `src/`. The `aidlc` section is `templates/CLAUDE.aidlc.md` and stays as it is: its Hard limits guard irreversible actions, which the talk keeps."
forbid: [network]
non_goals:
  - "removing text another test pins (the bench and build lines, the linter sentence, the module-map sentence, the limit sentence, the adapter clause); deleting or editing those assertions is not this card's"
  - "`templates/CLAUDE.aidlc.md` and the aidlc section of `CLAUDE.md`"
  - "running `/doctor prompt-audit`, which the plan made optional"
  - "a new size limit; `tests/surface/claude-md-size.test.ts` stays as is"
hygiene: "From issue 500 (card 5 of the plan agreed with Codex on 2026-11-26), after Lydia Hallie's talk 'Rethinking Claude Code Best Practices' (AI Engineer CODE, 2026-11-11): CLAUDE.md holds what the code cannot show, without emphasis. RED first: acceptance 1 on main."
---

# T0-CLAUDE-MD-DUPES

From issue 500 (card 5 of the plan agreed with Codex on 2026-11-26).

## Why
Every session loads `CLAUDE.md`. Lines that restate `package.json`, `tsconfig.json` or `docs/ARCHITECTURE.md` cost context and say nothing the code does not, and bold lead-ins are emphasis the talk says current models over-apply.

## Deliverable
`CLAUDE.md` without the four script lines, the layer list, the two tsconfig option names and the bold, with every pinned line kept.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/claude-md-dupes.test.ts tests/surface/claude-md-size.test.ts tests/surface/claude-md-reuse.test.ts tests/surface/bench.test.ts tests/infra/build-atomic.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/templates.test.ts tests/surface/command-lines.test.ts tests/surface/prose.test.ts tests/surface/layers.test.ts tests/infra/stray-processes.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the removed text is gone, every pinned line stays, and the file is shorter.
