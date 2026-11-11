---
id: T0-AUDIT-DOC-TRUTH
title: Three statements the audit of 2026-11-11 found untrue of the code are corrected with no behaviour change, the config-file rule of CLAUDE.md, the reserved and provenance fields and unrecorded stop reasons of src/core/types.ts, and the source files the docs/ARCHITECTURE.md module map leaves out, each with a test that keeps it true
status: merged
branch: T0-AUDIT-DOC-TRUTH
worktree: D:\wt\AIDLC\T0-AUDIT-DOC-TRUTH
allow_paths:
  - CLAUDE.md
  - src/core/types.ts
  - docs/ARCHITECTURE.md
  - tests/surface/config.test.ts
  - tests/core/types.test.ts
  - tests/surface/module-map.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-AUDIT-DOC-TRUTH.md
dod_command: npm run typecheck && node --test tests/surface/config.test.ts tests/core/types.test.ts tests/surface/module-map.test.ts tests/core/stop.test.ts tests/surface/claude-md-size.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/templates.test.ts tests/infra/exec.test.ts tests/infra/exec-sync-tree.test.ts
dod_exit: 0
requirements:
  - R1. CLAUDE.md, section Configuration and environment, shall replace the bullet at :80-82 on main at 877af98f (`aidlc.config.json` is parsed by the zod `ProjectConfig` in `src/config.ts`. `templates/aidlc.config.json` is the copy `aidlc init` installs; add new fields to both.) with the three lines of body section "CLAUDE.md text", which state the rule the coordinator ruled for audit item C22. Each of the two files lists only what it sets. In a schema-valid configuration, a key left out has its `ProjectConfig` default or none: none for an optional key the schema gives no default (`repository`, `userLimitMs`, `hooks.testPathPatterns`, `github.ciTimeoutMs` and the other `.optional()` keys of src/config.ts, whose absence the code that reads the key handles). The qualification is needed because leaving out a required member of an object that is present fails validation, so the configuration is refused rather than defaulted: a `preReview.fallback` without `command` or without `reviewer` (src/config.ts:20-21; the parse names `preReview.fallback.command` or `preReview.fallback.reviewer`), and an effort rule `high` or `xhigh` without `minChangedLines` (src/core/types.ts:295-297; the parse names `formalReview.effort.high.minChangedLines` for that key). A card that adds a field says which file carries it. CLAUDE.md stays at 178 lines (cap 200, tests/surface/claude-md-size.test.ts). The bullet is above the AI-native SDLC (aidlc) section (:119), so that last section and templates/CLAUDE.aidlc.md do not change. No other file states the old rule (sweep), so no other document changes for it.
  - R2. tests/surface/config.test.ts shall gain one test which, for `aidlc.config.json` and `templates/aidlc.config.json`, asserts that every key path of the raw JSON is present in the value `ProjectConfig.parse(raw)` returns, and that it found at least one key path in each file. Key paths are every key of every object, nested objects walked; an array and a scalar (string, number, boolean, null) is a leaf and array elements are not walked. A path is present when, at each of its keys, the parsed value is a non-array object that has that key as an own key. `ProjectConfig` is a `z.object`, which strips an unknown key, so a key the schema drops (a misspelt key such as `preReview.rouns`, a removed field such as `cardPolicy`, which T1-SWEEP-DEAD-CODE removed) is reported by its dotted path and fails the test. On main no key is dropped (76 key paths in aidlc.config.json, 46 in the template), so the test passes on main: it is a pin, and no key of either file needs a change. The test reads the two files and changes neither.
  - R3. The existing pins of the two config files shall stay as they are and pass unchanged, each being a file that sets what its card named, which the rule of R1 allows. tests/surface/config.test.ts:152-155 (the template `formalReview` is exactly five keys, T1-OPUS55-R3 acceptance 5), :470 (the repository `preReview` has no `coverage` key, T1-EFF-REVIEW-CONFIG R1 and T0-R2-OFF R1), :304-307 (both files parse); tests/surface/templates.test.ts:98-100 (`ci.scanSetupSteps` in both, T0-SCAN-SETUP-STEP-2 acceptance 6) and :200-201, :562-563, :674-675 (`reviewPolicyVersion` `REVIEW.md@6` in both). Neither config file changes.
  - R4. src/core/types.ts shall carry the JSDoc comment of body section "Comment text" directly above each of `RoleProfile.modelVersion` (:600), `RoleProfile.fallback` (:608), `ReleaseAttempt.previousHealthyRelease` (:913), `ReleaseAttempt.authorizationRef` (:914) and `ReleaseAttempt.linkedAttempt` (:929), each stating that the field is reserved (audit item F27). No code in src sets or reads it by name: `resolveRoleProfile` (src/core/roles.ts:46-56) sets neither role field and the evidence manifest (src/cli/main.ts:1296) copies only role, provider and model. A stored value (a hand edit; for the three attempt fields also a raw `aidlc report --result release-result` patch, src/loop/controller.ts:637-643) is kept when the record is read and saved again. A stored value never establishes authority (`authorizationRef`), a recovery target (`previousHealthyRelease`, `linkedAttempt`), a fallback (`RoleProfile.fallback`, which is not the reviewer fallback of aidlc.config.json) or a model version (`modelVersion`). Every field keeps its type and stays optional.
  - R5. src/core/types.ts shall carry the JSDoc comment of body section "Comment text" directly above `CardRun.cardRevision` (:850) and `CardRun.goalGeneration` (:851), each stating that the field is creation provenance. It is set by name only in `GoalController.ensureCardRun` when it creates the run (src/loop/controller.ts:721-722: the goal's `cardRevisions` entry for the card, 0 without one, and the goal's `generation`); an existing run is returned unchanged (:713), and a raw `card-result` patch can replace either like any field the loop does not own (:604-609). Nothing in src reads it. It is required, so a run stored without it does not parse. Both stay required non-negative integers, as on main: a run without either, or with -1, 1.5 or the string "0" in either, is refused; 0 and 3 parse.
  - R6. src/core/types.ts shall carry the inline comment of body section "Comment text" at each of the `StopReason` values `scope` (:112), `frozen` (:114) and `migration` (:125), each saying "Not selected as a new reason by built-in loop decisions. Accepted in caller-supplied or persisted STOP records and propagated, journaled and displayed by generic STOP handling." No built-in decision selects them: every `makeStop` call with a literal reason names another reason, of the two calls with a variable reason controller.ts:376 propagates the reason of a stopped card run to the goal stop and card-runner.ts:937 passes `ownership` or `tool`, and src builds no STOP record without `makeStop`. They are accepted wherever a STOP record is supplied or read back: the `StopRecord` schema, the raw `card-result` and `release-result` patches (controller.ts:604-609, :637-643), library callers through the exports of src/index.ts (:7-10, :28) and a hand-edited record. Generic handling then propagates them (the goal stop from a stopped card run, controller.ts:375-376, or from a stopped attempt, :647, saved by `persistStopValue`, :780-782), journals them (`CARD_RESULT` data, :611; `GOAL_STOPPED`, :782) and displays them (`formatStop`, src/core/stop.ts:39; the board, src/state/board.ts:80, :140, :145; `terminalGoalRefusal`, src/core/card-goal.ts:53; `aidlc bounds`, src/state/bounds.ts:62, :68). These sites are examples; the comment names no closed list of readers. The `frozen` comment also says that `GLOBAL_REASONS` (src/core/stop.ts:9) holds it, so `makeStop` defaults its `global` to true. All three values stay in the enum; docs/OPERATIONS.md (STOP reasons, :591, :593, :604) and tests/core/stop.test.ts:8-11 do not change.
  - R7. docs/ARCHITECTURE.md, section Module map, shall name the five source files the document names nowhere, each with the sentence of body section "Module map text", taken from the file's header comment and exports (src/loop/context-pack.ts has no header comment; its sentence is taken from its exports and their comments). `stop.ts` goes in the `src/core/` paragraph (:12); `hook-wiring.ts` at the end of the `src/probes/` paragraph (:20); `context-pack.ts` in the paragraph that holds the `src/loop/` sentence (:40); `src/config.ts` and `src/index.ts` in one new paragraph between the `src/audit/` paragraph (:38) and the paragraph that begins with `src/hooks/index.ts` (:40). tests/surface/module-map.test.ts (new) shall list every `.ts` file under `src/` and assert that each is named by the rule of body section "Acceptance detail", item 5, with no file excluded: the map names the two other entry files (`src/cli/main.ts`, `src/hooks/entry.ts`), so nothing shows a deliberate exclusion, and `src/index.ts` is named. On main the test fails for exactly src/config.ts, src/core/stop.ts, src/index.ts, src/loop/context-pack.ts and src/probes/hook-wiring.ts; the other 70 of the 75 files pass, five of them (`controller.ts`, `release-runner.ts`, `directive.ts`, `worktree-reclaim.ts`, `github-ship.ts`) through a path the document names outside the map, and those five do not change (`card-runner.ts` is named inside the map, as `loop/card-runner.ts` at :14).
  - R8. CHANGELOG.md, Unreleased, shall carry the entry of body section "CHANGELOG text", directly above the entry that begins `- T0-DIRTY-SUCCESS-2`.
  - R9. No behaviour shall change. No file under src/ other than src/core/types.ts changes, and in that file only comment text changes: no code token, field, type, optionality, default or enum value. aidlc.config.json, templates/aidlc.config.json, templates/CLAUDE.aidlc.md and docs/OPERATIONS.md do not change.
acceptance:
  - 1. `tests/surface/config.test.ts` "every key path of both shipped configs is present in the parsed config, and a key the schema drops is reported" passes on main and with this card (a pin; none of the 76 and 46 key paths is dropped); its controls report exactly `preReview.rouns` and `cardPolicy`, and `toString`. [R2] [dod arm 1] Detail: body section Acceptance detail, item 1.
  - 2. The config pins named in R3 pass unchanged, and neither config file is in the diff. [R3] [dod arm 1] Detail: body section Acceptance detail, item 2.
  - 3. `tests/core/types.test.ts` "a release attempt, a goal role profile and a stop record keep the reserved values through parse, JSON and parse" passes on main and with this card (a pin). [R4] [R6] [dod arm 1] Detail: body section Acceptance detail, item 3.
  - 4. Same file, "a card run without cardRevision or goalGeneration, or with one that is not a non-negative integer, is refused" passes on main and with this card (a pin). [R5] [dod arm 1] Detail: body section Acceptance detail, item 4.
  - 5. `tests/surface/module-map.test.ts` "every source file under src/ is named in docs/ARCHITECTURE.md" fails on main naming exactly the five files of R7 and passes with this card; its matcher controls (two on the real document, ten synthetic) pass on both. This is the card's RED. [R7] [dod arm 1] Detail: body section Acceptance detail, item 5.
  - 6. `tests/infra/exec.test.ts`, `tests/infra/exec-sync-tree.test.ts`, `tests/surface/claude-md-size.test.ts`, `tests/surface/mirror.test.ts`, `tests/surface/prose.test.ts` and `tests/core/stop.test.ts` pass unchanged. [R1] [R6] [R7] [dod arm 1] Detail: body section Acceptance detail, item 6.
  - 7. CLAUDE.md carries the text of R1 and keeps 178 lines (reviewer-verified against the diff). [R1] Detail: body section Acceptance detail, item 7.
  - 8. src/core/types.ts carries the comments of R4, R5 and R6 and no other change (reviewer-verified against the diff). [R4] [R5] [R6] [R9] Detail: body section Acceptance detail, item 8.
  - 9. Each Module map sentence of R7 is true of its file (reviewer-verified against the diff). [R7] Detail: body section Acceptance detail, item 9.
  - 10. The CHANGELOG entry states R8 (reviewer-verified against the diff). [R8] Detail: body section Acceptance detail, item 10.
depends_on: []
budget: 250
tdd: true
diagnosis:
  root_cause: "Three statements were never checked against the code. CLAUDE.md:81-82 asks for every new config field in both files, while the cards that added fields chose per field (T0-SCAN-SETUP-STEP-2 put `ci.scanSetupSteps` in both, T0-CI-RERUN-STRUCTURED put `ci.transientSteps` in the template only) and two tests pin an omission; nothing checks that a key in either file is one the schema keeps, since `ProjectConfig` strips unknown keys. Seven schema fields of src/core/types.ts carry no comment: five have had no writer or reader since b9457c9e and two are set when a run is created and never read; no built-in loop decision selects three of the stop reasons. A reader takes all ten for live contracts. No test checks that docs/ARCHITECTURE.md names every source file, so five files went unnamed."
  repro: "Read-only probes in C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\eb02f3fb-6d6a-4a44-870b-34d780644c33\\scratchpad\\probe-drafts-4 on main at 877af98f: config-keys.ts printed `aidlc.config.json: 76 key paths, 0 dropped`, `templates/aidlc.config.json: 46 key paths, 0 dropped` and, for the template with `preReview.rouns` and `cardPolicy` added, both keys absent after the parse; module-map2.ts (the rule of R7) printed `75 files; 5 not named: src/config.ts, src/core/stop.ts, src/index.ts, src/loop/context-pack.ts, src/probes/hook-wiring.ts`."
  same_class: "Other statements of the config rule: none (sweep). Other fields without a reader: `CompletionResult.modelVersion` (src/providers/types.ts:39) and the `baseline` of bands.yaml (src/maintain/bands.ts:19, audit item C21) are outside this card, which does not sweep every field of src/core/types.ts. Other unnamed source files: the test of R7 covers every file under src/."
sweep: "On main at 877af98f. (1) git grep -n -i 'add new\\|fields to both\\|new field\\|new key\\|both config' -- CLAUDE.md README.md REVIEW.md docs templates .claude specs/tasks/_TEMPLATE.md: CLAUDE.md:81-82 (R1); docs/DELIVERY-OPS.md:42 and its template copy (no new keys to simulate an operation, another subject). docs/OPERATIONS.md:21 lists the config keys and :641 says `--force` overwrites aidlc.config.json: neither states the rule. docs/OPERATIONS.md:337 says `reviewPolicyVersion` is `REVIEW.md@6` in both configs: one field and its files, which R1 allows. (2) git grep -n 'previousHealthyRelease\\|authorizationRef\\|linkedAttempt\\|modelVersion' -- src tests docs README.md templates .claude: types.ts:600, :913, :914, :929 only, plus src/providers/types.ts:39 (`CompletionResult.modelVersion`, another type, non-goal); git log -S of each name in src lists only b9457c9e, so no writer ever existed. (3) git grep -n 'roleProfiles\\|RoleProfile\\b\\|resolveRoleProfile' -- src: writer controller.ts:148 through roles.ts:41-57 (sets neither `modelVersion` nor `fallback`); readers card-runner.ts:991-992, :1067 and controller.ts:397 (`supportedEfforts`), main.ts:1296 (role, provider, model), roles.ts:86-91 (`reviewerIndependent`: readOnly, model, pool, provider). Every other `.fallback` read in src is a reviewer config or a perspective record (card-runner.ts:1497-2560, pre-review.ts:1184-1345). (4) git grep -n -w 'goalGeneration\\|cardRevision' -- src: types.ts:850-851 and controller.ts:721-722 only; in tests, fixtures and literal records write both (tests/core/_fixtures.ts:73-74, tests/infra/helpers.ts:135-136 and ten other files) and none reads them. (5) git grep -n 'makeStop(' -- src: literal reasons arc-verify, audit, auth, cancelled, capability, card, checkpoint, ci, ownership, release-auth, release-config, release-health, review, risk, rollback-auth, time, tool; variable reasons at controller.ts:376 (the reason of the first stopped card run, :375, propagated to the goal stop, which `persistStopValue` saves and journals as `GOAL_STOPPED`, :780-782) and card-runner.ts:937 (`ownership` or `tool`, src/delivery/worktree.ts:25). git grep -n \"reason: '[a-z-]*',\" -- src: no STOP record built without `makeStop`. git grep -n \"'scope'\\|'frozen'\" -- src: types.ts:112, :114 and stop.ts:9. `'migration'` in src is a delivery target, request kind or evidence kind, never a stop reason. Supplied or persisted STOP records with any reason: the raw patches at controller.ts:604-609 and :637-643, library callers through src/index.ts:7-10 and :28 (types.ts, stop.ts, goal-store.ts exports). Generic handling of any reason: propagation controller.ts:375-376 and :647; journal `CARD_RESULT` data (:611) and `GOAL_STOPPED` (:782); display `formatStop` (stop.ts:39; CLI main.ts:305, :331, :685, :706), board.ts:80, :140 and :145, card-goal.ts:53, bounds.ts:62 and :68. (6) Module map: round2.ts walks src/ (75 files) with the span recognizer of acceptance detail 5: five unnamed under the rule of R7; ten unnamed if only the Module map section counts, the five extra named outside it (controller.ts :44 and :184, release-runner.ts :192, directive.ts :148, worktree-reclaim.ts :138, github-ship.ts :212); `loop/card-runner.ts` is inside the map (:14). The recognizer and a single-backtick regular expression find the same 640 code spans in docs/ARCHITECTURE.md today. No test checks the map against src/; the only src walk in tests/surface is bench.test.ts:221-230 (imports of bench/). (7) Tests that read a changed document: git grep -l ARCHITECTURE -- tests (30 files) and git grep -l CLAUDE.md -- tests (13 files). Text inside a changed paragraph: exec.test.ts:408-409 and exec-sync-tree.test.ts:94-95 find the line that begins with the `src/probes/` sentence and require the `exec.ts` sentence followed by a space (kept: the new sentence goes at the end of that line); roles.test.ts:104, pre-review.test.ts:1302-1307 and config.test.ts:215 (sentences of the `src/core/` line, unchanged); card-goal.test.ts:115, hook-lazy.test.ts:226, mutant-gen.test.ts:1024, mutants.test.ts:1053-1054 and mutants-review.test.ts:321 (sentences of the :40 line, unchanged). No test pins the CLAUDE.md bullet; claude-md-size.test.ts:31 uses the Configuration and environment heading as a boundary. base-sync-jsdoc.test.ts:27 reads src/core/types.ts for the `CandidateInfo.baseSync` comment, which this card does not touch."
forbid:
  - weakening or skipping a test to go green
  - any change to src/core/types.ts other than the comment lines of R4, R5 and R6 (the reviewer diffs the file; no code token, field, type, optionality, default or enum value changes)
  - any change to another file under src/, to aidlc.config.json or templates/aidlc.config.json, or to an assertion of the pins named in R3
  - any change to templates/CLAUDE.aidlc.md or to the AI-native SDLC (aidlc) section of CLAUDE.md, and a CLAUDE.md longer than 178 lines
  - an exclusion list in the module-map test, or a rule that accepts a bare file name (a root-level one included) anywhere but in a Module map paragraph holding a code span that begins with its directory, a path below src/ without a slash, or a name or path that is only part of a code span
  - a module-map test that starts a process (git ls-files) or a test that creates a temporary directory; none of the new tests needs one
  - editing .aidlc state by hand
non_goals:
  - removing or wiring a reserved field or one of the three stop reasons
  - CompletionResult.modelVersion (src/providers/types.ts:39)
  - a note in the STOP reasons table of docs/OPERATIONS.md
  - Module map file names for the five files named elsewhere in the document
  - a test pinning the exact text of the types.ts comments or the CLAUDE.md bullet
  - adding defaulted keys to either config file
hygiene: "Line numbers are from main at 877af98f; no file under src/, docs/, tests/ or templates/ and neither CLAUDE.md nor CHANGELOG.md changed up to 136908a7; read them again at PREPARE. The card file is committed on main before implementation; the budget counts the lines the branch adds or deletes, the attempt evidence added to this file included (estimate per file: body section Size). Insert the CHANGELOG entry directly above the entry that begins `- T0-DIRTY-SUCCESS-2`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. T0-PROD-GATE-GENERATION adds one optional field to the authorization schema in src/core/types.ts in the same batch: the two cards merge one after the other, never in parallel, and the second reads src/core/types.ts again after the first has merged. T0-CLAUDE-EFFORT-OPT-IN depends on the CLAUDE.md text of R1 and starts after this card merges. Before the first review the coordinator runs every test file that reads a document this card changes and records the counts in the Attempt evidence; the full suite runs in CI. RED: commit the three test changes first; tests/surface/module-map.test.ts then fails naming the five files of R7, and the tests of acceptance 1, 3 and 4 pass, as pins of what the comments and the CLAUDE.md rule state (REVIEW.md dimension 6: this card changes no behaviour, so its only failing-first test is the document check). No lock section is needed: every new test reads committed files and writes nothing, with no clock, child process or temporary directory. The module-map test walks src/ with readdirSync, so an untracked .ts file in a local src/ fails it until it is named or removed; CI checks out a clean tree. Paths of the walk are joined with `/` on every platform; run the three new or changed test files on Linux as well as Windows before the first R3. tests/infra/exec.test.ts runs real processes with 6-second limits: a failure there in a loaded run is rerun alone before it counts (of what this card changes it reads the `src/probes/` line and the CHANGELOG Unreleased section, where its own entry stays). src/core/types.ts is not in the verify-card-run-writes coverage record."
doc_sync: CLAUDE.md (Configuration and environment), docs/ARCHITECTURE.md (Module map), CHANGELOG.md
---

# T0-AUDIT-DOC-TRUTH

## Deliverable
CLAUDE.md states the config-file rule the two files and their tests already follow, and a test fails when either file holds a key the schema drops. src/core/types.ts says, at each field and stop reason the audit found unused, that it is reserved, creation provenance or not selected as a new reason by built-in loop decisions, and tests pin that stored records keep those values. The module map of docs/ARCHITECTURE.md names the five source files the document named nowhere, and a test fails when a file under src/ is named nowhere in the document. No behaviour changes.

## Why
Audit of 2026-11-11: item C22 (CLAUDE.md:81-82 says "add new fields to both"; neither file follows it and two tests pin omissions), item F27 (schema fields that nothing in src reads or writes with meaning) and hygiene item H15 (four source files missing from the module map; the test of R7 found a fifth, src/index.ts). Two consultants analysed C22 and F27 and the coordinator ruled: each config file lists only what it sets; every field and every stop reason stays and its comment states the truth.

## CLAUDE.md text
Replace CLAUDE.md:80-82 with these three lines (two-space continuation indent, as the other bullets):

```
- Each of `aidlc.config.json` and `templates/aidlc.config.json` (installed by `aidlc init`)
  lists only what it sets. In a schema-valid configuration, a key left out has its
  `ProjectConfig` default or none (`src/config.ts`). A card that adds a field says which file carries it.
```

## Comment text
Each JSDoc line goes directly above the field shown under it, at the field's indentation; the field lines themselves do not change. The three `StopReason` lines change only by the comment after the value.

```ts
  // RoleProfile
  /** Reserved (audit item F27): `resolveRoleProfile` (src/core/roles.ts) never sets it and no code in src reads it. A stored value is kept when the goal is read and saved again, and never selects a model version. */
  modelVersion: z.string().optional(),
  /** Reserved (audit item F27): `resolveRoleProfile` never sets it and no code in src reads it; it is not the reviewer fallback of aidlc.config.json (`preReview.fallback`, `formalReview.fallback`). A stored value is kept when the goal is read and saved again, and never selects a fallback. */
  fallback: z.string().optional(),

  // CardRun
  /** Creation provenance (audit item F27): set by name only in `GoalController.ensureCardRun` when it creates the run, from the goal's `cardRevisions` entry for the card (0 without one); a raw `card-result` patch can replace it like any field the loop does not own. Nothing in src reads it. Required: a run stored without it does not parse. */
  cardRevision: z.number().int().nonnegative(),
  /** Creation provenance (audit item F27): set by name only in `GoalController.ensureCardRun` when it creates the run, from the goal's `generation`; a raw `card-result` patch can replace it like any field the loop does not own. Nothing in src reads it. Required: a run stored without it does not parse. */
  goalGeneration: z.number().int().nonnegative(),

  // ReleaseAttempt
  /** Reserved (audit item F27): no code in src sets or reads it by name. A stored value (a hand edit, or a raw `aidlc report --result release-result` patch) is kept when the attempt is read and saved again, and never names a recovery target. */
  previousHealthyRelease: z.string().optional(),
  /** Reserved (audit item F27): no code in src sets or reads it by name. A stored value (a hand edit, or a raw `aidlc report --result release-result` patch) is kept when the attempt is read and saved again, and never establishes authority. */
  authorizationRef: z.string().optional(),
  /** Reserved (audit item F27): no code in src sets or reads it by name. A stored value (a hand edit, or a raw `aidlc report --result release-result` patch) is kept when the attempt is read and saved again, and links no attempt and names no recovery target. */
  linkedAttempt: z.string().optional(),

  // StopReason
  'scope', // Not selected as a new reason by built-in loop decisions. Accepted in caller-supplied or persisted STOP records and propagated, journaled and displayed by generic STOP handling.
  'frozen', // Not selected as a new reason by built-in loop decisions. Accepted in caller-supplied or persisted STOP records and propagated, journaled and displayed by generic STOP handling. GLOBAL_REASONS (src/core/stop.ts) holds it, so makeStop defaults its global to true.
  'migration', // Not selected as a new reason by built-in loop decisions. Accepted in caller-supplied or persisted STOP records and propagated, journaled and displayed by generic STOP handling.
```

The four `// RoleProfile`-style labels above only mark the schema each group belongs to; they are not written to the source.

## Module map text
(a) In the `src/core/` paragraph (:12), after the sentence that begins with `deadlines.ts`:

```markdown
`stop.ts` builds STOP records (`makeStop`, whose `global` defaults to true for `auth`, `audit`, `cancelled`, `ownership`, `risk`, `frozen` and `time`), the next action of a stop nothing lifts (`toolStopNextAction`) and their one-line rendering (`formatStop`).
```

(b) At the end of the `src/probes/` paragraph (:20), after the `gh.ts` sentence:

```markdown
`hook-wiring.ts` gives `aidlc doctor` its `hookCommand` line (`hookWiringReport`): whether the file that the hook dispatcher in `.claude/settings.json` starts exists, checked without starting a process.
```

(c) In the paragraph at :40, after the sentence that ends "stops on human gates, review blocks, quota holds and deadlines.":

```markdown
`context-pack.ts` builds the context pack of the controller's `run-card` directive (`loadContextPack`): the card's plan section, acceptance, `allow_paths`, `non_goals` and the lesson lines of `docs/LESSONS.md` that name its paths or modules, as JSON within a byte budget that drops lessons first and then shortens the plan section, never the acceptance list, read only from the plan file and `docs/LESSONS.md` inside the main checkout.
```

(d) A new paragraph between the `src/audit/` paragraph (:38) and the paragraph that begins with `src/hooks/index.ts` (:40), with a blank line on each side:

```markdown
`src/config.ts` defines `ProjectConfig`, the zod schema of `aidlc.config.json` and its defaults; `loadProjectConfig` reads the file (an absent file gives the defaults, and one that is not JSON or fails the schema throws `ConfigError`) and `resolveWorktreeRoot` gives the directory card worktrees are created under. `src/index.ts` is the library entry point (`main` in `package.json`, built to `dist/index.js`) and only re-exports modules.
```

None of the four texts holds `src/core/stop.ts` or `core/stop.ts` as a code span (acceptance 5, control 1). The position of a sentence inside its paragraph is not tested; the reviewer checks it against the diff.

## CHANGELOG text
One line, followed by a blank line:

```markdown
- T0-AUDIT-DOC-TRUTH (docs and comments, audit items C22 and F27 and hygiene item H15 of 2026-11-11; no behaviour change): CLAUDE.md now says that `aidlc.config.json` and `templates/aidlc.config.json` each list only what they set, that in a schema-valid configuration, a key left out has its `ProjectConfig` default or none, and that a card adding a field says which file carries it, in place of "add new fields to both", which neither file followed. `tests/surface/config.test.ts` checks that every key of both files is kept by the parse, so a key the schema drops fails the suite. Comments in `src/core/types.ts` mark `ReleaseAttempt.previousHealthyRelease`, `authorizationRef` and `linkedAttempt` and `RoleProfile.modelVersion` and `fallback` as reserved (no code sets or reads them; a stored value is kept and grants nothing), `CardRun.cardRevision` and `goalGeneration` as creation provenance that nothing reads, and the stop reasons `scope`, `frozen` and `migration` as not selected as a new reason by built-in loop decisions, though accepted in caller-supplied or persisted STOP records and propagated, journaled and displayed by generic STOP handling; every field and reason stays, so stored records parse as before. The module map of `docs/ARCHITECTURE.md` names `src/config.ts`, `src/index.ts`, `src/core/stop.ts`, `src/loop/context-pack.ts` and `src/probes/hook-wiring.ts`, and `tests/surface/module-map.test.ts` fails when a file under `src/` is named nowhere in that document.
```

## Size
This card file is committed on main before implementation, so its text as drafted is not part of the branch. The budget counts the lines the branch adds or deletes (`git diff --numstat origin/main...HEAD`, added plus deleted), the attempt evidence added to this file included. Estimate:

| File | Lines added plus deleted |
|---|---|
| CLAUDE.md | 6 (3 deleted, 3 added) |
| src/core/types.ts | 13 (7 comment lines added; 3 enum lines deleted and added again with their comments) |
| docs/ARCHITECTURE.md | 8 (3 paragraph lines rewritten; the new paragraph and its blank line) |
| CHANGELOG.md | 2 |
| tests/surface/config.test.ts | 30 |
| tests/core/types.test.ts | 26 |
| tests/surface/module-map.test.ts (new) | 70 |
| specs/tasks/T0-AUDIT-DOC-TRUTH.md (attempt evidence) | 70 |
| Total | 225, budget 250 |

A total above 250 needs a `size_exception` (`MAX_CODE_CARD_BUDGET`, src/artifacts/card.ts:35, since the card changes src/); the coordinator records it before the branch exceeds the budget.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/config.test.ts tests/core/types.test.ts tests/surface/module-map.test.ts tests/core/stop.test.ts tests/surface/claude-md-size.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/templates.test.ts tests/infra/exec.test.ts tests/infra/exec-sync-tree.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; the existing test files pass unchanged.

## Acceptance detail

### Item 1
A new `describe` at the end of tests/surface/config.test.ts, "the shipped configs hold only keys the schema keeps (T0-AUDIT-DOC-TRUTH)", with its own `root` constant as the file's other blocks have (:226, :273). Helpers: `keyPaths(value, prefix = [])` returns, for a non-array object, each key's path followed by the paths under its value, and nothing for an array or a scalar; `present(parsed, keys)` walks the keys and answers false at the first step whose value is not a non-array object holding the key as an own key; `dropped(raw)` is the dotted form of every key path of `raw` not present in `ProjectConfig.parse(raw)`. The test title carries `[T0-AUDIT-DOC-TRUTH R2]`. For each of `aidlc.config.json` and `templates/aidlc.config.json` read from the repository: `keyPaths(raw).length > 0`, and `dropped(raw)` deep-equals `[]`, with the file name as the message. Control A: the template object with `rouns: 2` added inside `preReview` and `cardPolicy: {}` added at the top; `dropped(...)`, sorted, deep-equals `['cardPolicy', 'preReview.rouns']`. Control B, independent of A: the template object with an own top-level key `toString: 1`; `dropped(...)` deep-equals `['toString']`. The parsed object inherits `toString` from `Object.prototype`, so a `present` written with `in` in place of `Object.hasOwn` reports nothing and fails control B. Measured on main by a probe of the same walk (scratchpad round2.ts): 76 and 46 key paths, none dropped; control A reported both keys; control B reported `toString` with `Object.hasOwn` and nothing with `in`. The test passes on main and with this card; it fails when a key of either file is one the schema strips.

### Item 2
tests/surface/config.test.ts:152-155, :304-307 and :470 and tests/surface/templates.test.ts:98-100, :200-201, :562-563 and :674-675 run in the dod_command with no line changed; `git diff --stat origin/main...HEAD -- aidlc.config.json templates/aidlc.config.json` is empty.

### Item 3
In tests/core/types.test.ts, a new `describe` "types: fields kept for compatibility (T0-AUDIT-DOC-TRUTH)", fixtures from tests/core/_fixtures.ts. Title tags `[R4] [R6]`. (a) `const a = release({ previousHealthyRelease: 'rel-g1-1', authorizationRef: 'auth-1', linkedAttempt: 'rel-g1-2' })`; `ReleaseAttempt.parse(JSON.parse(JSON.stringify(a)))` deep-equals `a`, and each of the three fields equals its value. (b) A profile `{ role: 'implementer', provider: 'anthropic', model: 'claude-opus-5-5', modelVersion: '2026-09-01', supportedEfforts: ['low', 'medium'], pool: 'anthropic:default', fallback: 'claude-sonnet-5-5' }`; `const g = goal({ roleProfiles: [profile] })`; `Goal.parse(JSON.parse(JSON.stringify(g)))` deep-equals `g`, and its `roleProfiles[0]` has `modelVersion` `'2026-09-01'` and `fallback` `'claude-sonnet-5-5'`. (c) For each of `scope`, `frozen` and `migration`: `StopRecord.parse({ reason, detail: 'd', nextAction: 'n', global: false, at: T0 })` parses, its JSON parses again to a deep-equal record, and `reason` is kept. Passes on main; removing a field from its schema (the parse strips it) or a value from `StopReason` (the parse refuses it) fails it.

### Item 4
Same `describe`, title tag `[R5]`. From `cardRun()`: the record without `cardRevision` and the record without `goalGeneration` (object rest, as types.test.ts:96-101 does) each give `CardRun.safeParse(...).success === false`; each field set to `-1`, `1.5` and `'0'` gives `false`; each set to `0` and to `3` gives `true`. Passes on main; making either field optional or giving it a default fails it.

### Item 5
New file tests/surface/module-map.test.ts, `node:test` and `node:assert/strict`, title tag `[T0-AUDIT-DOC-TRUTH R7]`. It reads docs/ARCHITECTURE.md with `\r\n` turned into `\n` and lists every file ending in `.ts` under `src/` with `readdirSync(dir, { withFileTypes: true })`, recursively, as paths relative to the repository root joined with `/`. No temporary file or directory: the synthetic controls are strings.

Code spans: on each line, a run of n backticks opens a span and the next run of exactly n backticks on that line closes it; the whole text between the two runs is the span and is compared whole; a run with no closing run of its length is plain text. A span does not cross a line (every span of docs/ARCHITECTURE.md is on one line).

Rule `named(file, doc)`, where the Module map section runs from its heading to the next level-2 heading and is split into paragraphs on blank lines:
- (i) An exact full path (`src/loop/context-pack.ts`), or an exact path below `src/` that contains `/` (`loop/card-runner.ts`), as a whole code span anywhere in the document, names the file.
- (ii) A bare file name, a root-level one included (`stop.ts`, `config.ts`), names the file only as a whole code span in a Module map paragraph that also holds a code span beginning with the file's directory followed by `/` (`src/core/` for `src/core/stop.ts`; `src/` for a file at the top of `src/`).

Assertions: the listing includes `src/config.ts` and `src/core/types.ts`; the files for which `named` is false deep-equal `[]` (on main `['src/config.ts', 'src/core/stop.ts', 'src/index.ts', 'src/loop/context-pack.ts', 'src/probes/hook-wiring.ts']`, which is the RED); the controls below hold. Measured on main with this recognizer and rule (scratchpad round2.ts): 75 files, those five not named; after the four texts of body section "Module map text", none; every control as listed.

```ts
function spansOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const runs = [...line.matchAll(/`+/g)].map((m) => ({ at: m.index!, n: m[0].length }));
    for (let i = 0; i < runs.length; i += 1) {
      const close = runs.findIndex((r, j) => j > i && r.n === runs[i]!.n);
      if (close < 0) continue;
      out.push(line.slice(runs[i]!.at + runs[i]!.n, runs[close]!.at));
      i = close;
    }
  }
  return out;
}
// Real document: control 1, with every `stop.ts` span removed src/core/stop.ts is not named; control 2, a path never named.
assert.equal(named('src/core/stop.ts', doc.replaceAll('`stop.ts`', '')), false);
assert.equal(named('src/core/absent-module.ts', doc), false);
// Synthetic documents: synth(map, rest) = `# T\n\n## Module map\n\n${map}\n\n## Next\n\n${rest}\n`; file 'src/a/b.ts' unless noted.
// true:  synth('`src/a/` holds x.', '`src/a/b.ts` is named.')          full path outside the map
// true:  synth('`src/a/` holds x.', '`a/b.ts` is named.')              path below src/ with a slash, outside the map
// true:  synth('`src/a/` holds `b.ts`.')                               base name in its directory paragraph
// false: synth('`src/c/` holds `b.ts`.')                               base name in another directory paragraph
// false: synth('`src/a/` holds x.', '`src/a/` holds `b.ts`.')          base name outside the Module map
// false: synth('`src/a/` holds b.ts as text.')                         base name as plain text
// false: synth('`src/a/` holds `b.ts.bak` and `see b.ts`.')            base name inside a longer span
// false: synth('`src/a/` holds x.', '`see src/a/b.ts` here.')          full path inside a longer span
// false: synth('`src/a/` holds `x ``b.ts`` y`.')                       doubled backticks inside a single-backtick span
// false: synth('`src/a/` holds x.', '`config.ts` is named.') for 'src/config.ts'   root-level base name outside the map
```

### Item 6
tests/infra/exec.test.ts:404-421 (T0-EXEC-TREE-KILL acceptance 7) and tests/infra/exec-sync-tree.test.ts:88-113 (T0-EXEC-SYNC-TREE-KILL acceptance 6) find the line that begins with the `src/probes/` sentence and require the `exec.ts` sentence followed by a space: the `hook-wiring.ts` sentence goes at the end of that line, after the `gh.ts` sentence, so both pass. tests/surface/claude-md-size.test.ts: at most 200 lines, the Conventions limit sentence, and the Architecture section bounded by the unchanged Configuration and environment heading. tests/surface/mirror.test.ts:73-75: CLAUDE.md ends with templates/CLAUDE.aidlc.md. tests/surface/prose.test.ts:38-60: no em dash or corner bracket in CLAUDE.md, docs/ARCHITECTURE.md, CHANGELOG.md or this card. tests/core/stop.test.ts:8-11: `frozen` defaults to global, `scope` and `migration` do not. `git diff --stat origin/main...HEAD -- tests` lists only tests/surface/config.test.ts, tests/core/types.test.ts and tests/surface/module-map.test.ts.

### Item 7
The reviewer checks that CLAUDE.md:80-82 holds the text of body section "CLAUDE.md text", that "add new fields to both" is gone, that the file has 178 lines and that nothing from the AI-native SDLC (aidlc) heading to the end changed.

### Item 8
The reviewer diffs src/core/types.ts: seven added JSDoc lines (R4, R5) and three changed enum lines (R6), each with the text of body section "Comment text", and no other line.

### Item 9
The reviewer checks each sentence of body section "Module map text" against the file it names: src/core/stop.ts:9-43, src/probes/hook-wiring.ts:1-38 and its caller src/cli/main.ts:274, src/loop/context-pack.ts:66-139 and its caller src/loop/controller.ts:399-411, src/config.ts:117-228 and src/index.ts with package.json `main`.

### Item 10
The reviewer checks that the entry of body section "CHANGELOG text" is in Unreleased directly above the entry that begins `- T0-DIRTY-SUCCESS-2`, followed by a blank line.

## Attempt evidence

### RED (measured on 09d069bd, tests only)
- tests/surface/module-map.test.ts "every source file under src/ is named in docs/ARCHITECTURE.md": fails, actual `['src/config.ts','src/core/stop.ts','src/index.ts','src/loop/context-pack.ts','src/probes/hook-wiring.ts']`, expected `[]`. The two control tests pass. Run of the three files: 77 tests, 76 pass, 1 fail.
- Pins (pass on main, acceptance 1, 3, 4): config key-path test, types compatibility test, card-run refusal test.

### Revert table (measured on 1e338683; each row reverted, test run, restored; `git status` clean after)
| # | Mutation | Test | Result |
|---|---|---|---|
| 1-4 | remove the `context-pack.ts`, `stop.ts`, `hook-wiring.ts` span; remove the `src/config.ts` and `src/index.ts` spans | module-map | red 4/4 |
| 5-9 | delete `modelVersion`, `fallback`, `authorizationRef`, `previousHealthyRelease`, `linkedAttempt` from their schema | types compat | red 5/5 |
| 10-12 | delete `scope`, `frozen`, `migration` from `StopReason` | types compat | red 3/3 |
| 13-14 | `cardRevision` given a default, `goalGeneration` made optional | types card run | red 2/2 |
| 15-16 | `cardPolicy` added to the template, `preReview.rouns` added to aidlc.config.json | config key path | red 2/2 |

Rows red/total: 16/16. The synthetic matcher controls are asserted in the same file.

### DoD (on 1e338683, exit 0)
`npm run typecheck && node --test <10 files>`: tests 229, pass 229, fail 0, skipped 0.

### Document sentences
| Sentence | True because | Test |
|---|---|---|
| CLAUDE.md rule | 76 and 46 key paths all kept by `ProjectConfig.parse`; `src/config.ts` defaults | config key-path test |
| types.ts reserved fields | no src reader or writer (card sweep 2, 3) | types compat test |
| types.ts provenance | `controller.ts` ensureCardRun sets both; required in schema | types card-run test |
| types.ts stop reasons | `GLOBAL_REASONS` in stop.ts holds `frozen`; `scope`, `migration` accepted by `StopRecord` | types compat, stop.test.ts |
| Module map: stop.ts, hook-wiring.ts, context-pack.ts, config.ts, index.ts | read against `GLOBAL_REASONS` (stop.ts:9), `hookWiringReport` (main.ts:274), `loadContextPack`, package.json `main` | module-map test (naming only) |

### Size
`git diff --shortstat origin/main...HEAD` before this section: 7 files, 167 insertions, 9 deletions (176 changed lines); this section adds about 35; budget 250. src/core/types.ts diff: comment text only (the three StopReason lines changed by a trailing comment).

Coordinator verification:
- At 486a7aa4, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/core/types.test.ts, tests/surface/config.test.ts, tests/surface/module-map.test.ts): tests 77, pass 77, fail 0, skipped 0.
- Windows, docpins: 76 test files reading 3 changed documents: # tests 1844 # pass 1832 # fail 1 docpins: tests/infra/exec.test.ts failed in the parallel run and passes alone (# pass 61): load
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.
