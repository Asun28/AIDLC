---
id: T0-BIN-STALE-DIST
title: The bin entries load the sources when the compiled build is older than any source file, so a source checkout never runs stale code
status: todo
branch: T0-BIN-STALE-DIST
worktree: D:\wt\AIDLC\T0-BIN-STALE-DIST
superseded_by: T0-BIN-STALE-DIST-2
allow_paths:
  - bin/aidlc.js
  - bin/aidlc-hook.js
  - bin/resolve-entry.js
  - tests/infra/bin-entry.test.ts
  - CLAUDE.md
  - README.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-BIN-STALE-DIST.md
dod_command: npm run typecheck && node --test tests/infra/bin-entry.test.ts tests/infra/init.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `dist/` exists and no file under `src/` is newer than the compiled entry, `bin/aidlc.js` and `bin/aidlc-hook.js` shall load the compiled entry.
  - R2. WHEN `dist/` is missing, or any file under `src/` is newer than the compiled entry, the bin entries shall load the TypeScript sources.
  - R3. The choice shall be one function shared by both entries, with the reason for the choice printable for diagnosis.
acceptance:
  - 1. `resolveEntry({ dist, src, srcRoot })` in `bin/resolve-entry.js` returns `{ target: dist, reason: 'dist' }` when the compiled entry exists and every file under `srcRoot` is at most as new as it; `{ target: src, reason: 'no-dist' }` when the compiled entry is missing; `{ target: src, reason: 'stale-dist' }` when any `.ts` file under `srcRoot` (recursively, symbolic links to files and directories followed with cycle detection) is newer than the compiled entry; `{ target: src, reason: 'src-unreadable' }` when a descendant directory or a source file under a readable `srcRoot` cannot be inspected (an incomplete scan is never proof of freshness); a `srcRoot` that cannot be read at all counts as not newer (bin-entry.test.ts). [R1] [R2] [dod arm 1]
  - 2. `bin/aidlc.js` and `bin/aidlc-hook.js` both import `resolveEntry` from `./resolve-entry.js` and load its target: bin-entry.test.ts lays a package out in a temp dir (both entries and the resolver copied, a compiled `dist/cli/main.js` and `dist/hooks/entry.js`, sources `src/cli/main.ts` and `src/hooks/entry.ts`, each printing which one ran), spawns both entries with the build older than a source and asserts the sources ran, then with the build newer and asserts the build ran; `AIDLC_ENTRY_DEBUG=1` prints the chosen target and the reason to stderr once. The seeded RED runs that regression against the previous entries (`.review/T0-BIN-STALE-DIST.red-seeded.log`). [R3] [dod arm 1]
  - 3. `CLAUDE.md` (Commands, the note under it), `README.md` (the build line) and `docs/OPERATIONS.md` describe the rule, and the CHANGELOG Unreleased carries the entry. [dod arm 1]
budget: 160
tdd: true
sweep: "grep -rn 'dist' bin CLAUDE.md README.md docs/OPERATIONS.md: bin/aidlc.js and bin/aidlc-hook.js (the resolver), CLAUDE.md:25 and :31 (the note), README.md:24 (the build line), OPERATIONS.md hooks section (the entry init picks)"
non_goals: [rebuilding dist/ automatically, watching src/ for changes, changing what `npm run build` emits, the `npx --no-install aidlc` entry of installed packages]
forbid: [importing from src/ inside dist/ or the reverse, running tsc from the bin entries]
diagnosis:
  root_cause: "bin/aidlc.js and bin/aidlc-hook.js load dist/ whenever it exists (existsSync), so a checkout with a build from an earlier commit runs that build against newer sources; the four T1-REVIEW-FINDINGS cards ran every R2 round and R3 decision through main's stale dist/, never through the findings code under review."
  same_class: "bin/aidlc-hook.js has the identical rule and is corrected with it; `npm run dev` always runs the sources and is unaffected."
hygiene: "The rule is a file-mtime comparison, not a content hash: a source checkout with touched files prefers the sources, which is the safe direction; `npm run build` restores the compiled entry as the newest file."
doc_sync: CLAUDE.md (Commands), README.md (build line), docs/OPERATIONS.md (Hooks), CHANGELOG.md
---

# T0-BIN-STALE-DIST

## Deliverable
`bin/resolve-entry.js` exports `resolveEntry({ dist, src, srcRoot })`: the compiled entry when it exists and is at least as new as every source file (links followed), else the sources, with the reason (`dist`, `no-dist`, `stale-dist`, `src-unreadable`). Both bin entries use it; `AIDLC_ENTRY_DEBUG=1` prints the choice. The docs state the rule.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/bin-entry.test.ts tests/infra/init.test.ts
```
- Expected exit code: 0
- Assertion: the resolver tests pass for the three reasons and the unreadable source root; both bin files import the resolver; the debug spawn prints the target and the reason; the init tests still pass.
