---
id: T0-WORKTREE-ROOT-EDGE
title: An empty worktreeRoot refuses a main checkout with no directory name (a filesystem root) with an error naming worktreeRoot instead of resolving to the unscoped root, and an empty SystemDrive or HOME counts as missing so the C: and /tmp fallbacks apply instead of a relative path
status: merged
branch: T0-WORKTREE-ROOT-EDGE
worktree: D:\wt\AIDLC\T0-WORKTREE-ROOT-EDGE
allow_paths:
  - src/config.ts
  - tests/surface/config.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-WORKTREE-ROOT-EDGE.md
dod_command: npm run typecheck && node --test tests/surface/config.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `worktreeRoot` is empty and the main checkout has no base name (a filesystem root such as `D:\` or `/`), `resolveWorktreeRoot` shall throw an error naming `worktreeRoot` and the checkout, instead of returning the unscoped platform root.
  - R2. WHEN `worktreeRoot` is empty and `SystemDrive` (win32) or `HOME` (elsewhere) is set to the empty string, `resolveWorktreeRoot` shall treat it as missing and return the `C:` or `/tmp` fallback joined as for an unset variable, never a relative path.
  - R3. WHEN `worktreeRoot` is set, `resolveWorktreeRoot` shall return it unchanged for any main checkout, a filesystem root included.
acceptance:
  - 1. `resolveWorktreeRoot(empty, 'D:\', { SystemDrive: 'C:' }, 'win32')` and `resolveWorktreeRoot(empty, '/', { HOME: '/home/u' }, 'linux')` throw with a message matching `/worktreeRoot/` (tests/surface/config.test.ts, a new test in the existing `resolveWorktreeRoot` describe). [R1] [dod arm 2]
  - 2. `{ SystemDrive: '' }` on win32 resolves a checkout named AIDLC to `C:\wt\AIDLC` and `{ HOME: '' }` on linux to `/tmp/.wt/AIDLC`, the same values the existing fallback test asserts for the unset variable (that test gains the two empty-string assertions). [R2] [dod arm 2]
  - 3. `resolveWorktreeRoot(explicit, 'D:\', { SystemDrive: 'C:' }, 'win32')` returns the explicit root, so a nameless checkout with an explicit `worktreeRoot` is not refused. [R3] [dod arm 2]
  - 4. `npm run typecheck` is clean and no call site changes: the resolver keeps its signature `(config, mainRoot, env, platform)`. [R1] [R2] [dod arm 1]
  - 5. `docs/OPERATIONS.md` (the `worktreeRoot` paragraph) states that a checkout at a filesystem root has no name to scope by and must set `worktreeRoot`, and that an empty `SystemDrive` or `HOME` counts as missing; CHANGELOG.md Unreleased carries the entry under this card id (the sweep grep finds both). [R1] [R2]
depends_on: []
budget: 40
tdd: true
sweep: "grep -rn 'SystemDrive\|HOME' src/ docs/OPERATIONS.md CHANGELOG.md: the resolver is the only reader of either variable in src/; the OPERATIONS paragraph and the parent CHANGELOG entry state the fallbacks"
forbid: [a change to the resolver's signature or to any call site, a second root probed when the expected path is missing, reading the repository name from a git remote, merging the parked branch T0-WORKTREE-ROOT-DEFAULT-repair instead of re-applying the change]
non_goals: [a name derived from anything but the checkout path, the renderCard fallback for callers that pass no root, moving existing worktrees, this repository's explicit worktreeRoot]
diagnosis:
  root_cause: "`path.basename` of a filesystem root is the empty string and `path.join` drops it, so a checkout at `D:\` resolved to the unscoped `C:\wt` the parent card retired; `??` on an environment variable falls back on undefined only, so an empty `SystemDrive` or `HOME` joined into the relative `wt\<name>` or `.wt/<name>`. Both were R2 round 1 advisory notes on T0-WORKTREE-ROOT-DEFAULT (PR #29) and could not ship under that episode after its pass (docs/LESSONS.md 2026-09-20)."
  same_class: "resolveWorktreeRoot is the only reader of SystemDrive and HOME under src/ and the only resolver that takes the base name of a path (sweep); no sibling site."
hygiene: "The parked branch T0-WORKTREE-ROOT-DEFAULT-repair (cc688e5) holds the same change against the pre-merge parent; this card re-applies it on main so the candidate's history is the card's own, and the branch is deleted at CLOSE."
doc_sync: docs/OPERATIONS.md (worktreeRoot paragraph), CHANGELOG.md
---

# T0-WORKTREE-ROOT-EDGE

## Deliverable
`resolveWorktreeRoot` (src/config.ts) closes the two edge cases the R2 review of T0-WORKTREE-ROOT-DEFAULT (PR #29) noted as advisory and the parent card could not repair after its pass. A main checkout at a filesystem root (`D:\`, `/`) has no base name, and `path.join` drops the empty segment, so an empty `worktreeRoot` resolved to the unscoped `C:\wt` or `/tmp/.wt` the parent card retired; the resolver now throws, the message naming the checkout and `worktreeRoot` as the fix. `SystemDrive` and `HOME` were read with `??`, so a variable set to the empty string joined into the relative `wt\<name>` or `.wt/<name>`; an empty value now counts as missing and the `C:` or `/tmp` fallback applies. The signature and every call site are unchanged; an explicit `worktreeRoot` is returned as given for any checkout. `docs/OPERATIONS.md` and CHANGELOG.md state both rules.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/config.test.ts
```
- Expected exit code: 0
- Assertion: typecheck is clean with the resolver's signature unchanged; the resolver tests pass for the nameless checkout (throws naming `worktreeRoot`, explicit root still returned), the empty `SystemDrive` and `HOME` (the `C:` and `/tmp` fallbacks) and every existing case.
