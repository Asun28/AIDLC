---
id: T0-LESSONS-FILE-CONST
title: Remove the unread LESSONS_FILE constant from src/artifacts/lessons.ts
status: merged
branch: T0-LESSONS-FILE-CONST
worktree: D:\wt\AIDLC\T0-LESSONS-FILE-CONST
allow_paths:
  - src/artifacts/lessons.ts
  - tests/surface/lessons.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-LESSONS-FILE-CONST.md
dod_command: npm run typecheck && npm run build && node --test tests/surface/lessons.test.ts
dod_exit: 0
requirements:
  - R1. `src/artifacts/lessons.ts` shall not export `LESSONS_FILE`, which nothing in `src/`, `tests/`, `bin/` or `templates/` reads; `lessonsPath` and every other export of the module are unchanged.
  - R2. The CHANGELOG Unreleased section shall carry an entry naming this card.
acceptance:
  - 1. `tests/surface/lessons.test.ts`: a namespace import of `src/artifacts/lessons.ts` has no `LESSONS_FILE` property, and its `lessonsPath(root)` returns `path.join(root, 'docs', 'LESSONS.md')`. [R1] [dod arm 3]
  - 2. `npm run typecheck` and `npm run build` exit 0, so no file imports the removed name. [R1] [dod arms 1, 2]
  - 3. Reviewer-verified from the diff: the only line removed from `src/artifacts/lessons.ts` is the `LESSONS_FILE` declaration. [R1]
  - 4. `tests/surface/lessons.test.ts` reads a T0-LESSONS-FILE-CONST entry in the CHANGELOG Unreleased section. [R2] [dod arm 3]
depends_on: []
budget: 40
tdd: true
sweep: "TypeScript language-service reference scan of every export in src/ (main at 82395c3, after goal g-20261011215435-db0e02): LESSONS_FILE has no reference; the dead-code-sweep audit summary missed it. grep -rn LESSONS_FILE src tests bin templates docs README.md CLAUDE.md on main at 9b5ef3e: only its definition, src/artifacts/lessons.ts:11. src/index.ts re-exports src/artifacts/{frontmatter,card,intent,spec,plan}.ts and not lessons.ts, and package.json exports only '.', so no library export changes."
forbid: [changing lessonsPath, replacing the docs/LESSONS.md literal in src/loop/context-pack.ts, changing an existing assertion]
non_goals: ["one shared constant for the docs/LESSONS.md path (lessonsPath and src/loop/context-pack.ts:137 each spell it)"]
doc_sync: CHANGELOG.md
---

# T0-LESSONS-FILE-CONST

## Deliverable
`src/artifacts/lessons.ts` no longer exports the `LESSONS_FILE` constant that nothing reads; `lessonsPath` stays the one function that names the lessons file.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run build && node --test tests/surface/lessons.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck and the build are clean and every lessons test passes.
