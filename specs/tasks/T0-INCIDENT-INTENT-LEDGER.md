---
id: T0-INCIDENT-INTENT-LEDGER
title: An incident intent never overwrites an existing intent file, and an incident ledger that does not parse stops the command before any write
status: todo
branch: T0-INCIDENT-INTENT-LEDGER
worktree: D:\wt\AIDLC\T0-INCIDENT-INTENT-LEDGER
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: about 55 source lines in src/maintain/incident.ts, src/core/types.ts and src/cli/main.ts; the rest is the schema table test, the read-class rows, the write-boundary rows, the intent naming rows, the CLI rows, docs and about 25 lines of attempt evidence; raised from 360 to 820 by the coordinator on the candidate 111aecf8, which is 728 changed lines: 76 source lines in three files, 487 lines of tests, 159 lines of attempt evidence with the clause, revert, schema and file-system tables the review reads, the rest docs; the repair of the pre-review findings follows"
allow_paths:
  - src/maintain/incident.ts
  - src/core/types.ts
  - src/cli/main.ts
  - tests/surface/incident.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-INCIDENT-INTENT-LEDGER.md
dod_command: npm run typecheck && node --test tests/surface/incident.test.ts tests/infra/update-json.test.ts
dod_exit: 0
requirements:
  - R1. `src/core/types.ts` shall define the zod schema `IncidentRecord` and `IncidentLedgerFile` (a JSON object from a string key to an `IncidentRecord`), with these fields. `identity` a non-empty string. `firstSeen` and `lastSeen` an `IsoTimestamp` (types.ts:18-20, a text pattern: `YYYY-MM-DDTHH:MM:SS`, optional one to three fraction digits, then `Z`; it is not a calendar check, so a value with an offset such as `+02:00` is refused and a value of that shape with an impossible date is accepted; this is what valid timestamp means in this card). `count` a positive integer. `intentFile` an optional string (absent, not null). `filedAt` an optional `IsoTimestamp`, absent valid. `disposition` exactly one of `open`, `fix-now`, `scheduled`, `dismissed` (case-sensitive). `dismissReason` an optional string. Keys the schema does not name are kept as read. The schema is compatible with every valid legacy record (every record the writer of main produces from `new Date().toISOString()` times). src/maintain/incident.ts uses that type and no longer declares its own `IncidentRecord` interface; src/index.ts keeps exporting the name through src/core/types.ts.
  - R2. `IncidentLedger.read` shall read `incidents.json` with `readJson(file, IncidentLedgerFile)` (src/state/store.ts), with these input classes. An absent file is an empty ledger, as on main. A file that is not JSON (empty, whitespace only, cut short, a byte order mark before the JSON) throws `StoreError` `MALFORMED_JSON` naming the file. JSON that is not an object of valid records (an array, null, a string, a number, a record without a required field or with a field outside R1) throws `StoreError` `SCHEMA_VIOLATION` naming the file and the path of the first issue. A file that cannot be read (a directory at that path, a read error such as EACCES) throws `StoreError` `READ_FAILED` naming the file. Whether the file is absent is decided by a stat of it in which only "no entry" (ENOENT) means absent: a ledger path under a regular file (ENOTDIR on POSIX) or under a parent that cannot be read (EACCES) throws `StoreError` `READ_FAILED` naming the file, before `readJson` and before any write, so `shouldFile`, `attachIntent`, `triage` and the read of R5 never treat an unreadable ledger as empty (`readJson` alone would: it asks `existsSync`, which answers false for both). A ledger whose JSON holds an own key `__proto__`, at the top level, in a record or deeper, is refused with `SCHEMA_VIOLATION` naming the file: the schema parse and the store's serializer drop that key, so a record stored under it or a field named so would be lost without a trace. (Both added by the planner on 2026-11-11 after a pre-review of the built candidate.)
  - R3. `IncidentLedger.shouldFile`, `attachIntent` and `triage` shall read through R2 before they change anything, so a ledger that does not parse is never rewritten, and `IncidentLedger.write` parses what it is given with `IncidentLedgerFile` and then writes it with `atomicWriteJson` (a temporary file renamed into place): a write never stores a ledger that a read refuses, and a write that fails before the rename leaves the previous ledger as it was.
  - R4. `writeIncidentIntent` shall never overwrite an existing path: it creates `<intentDir>/<slug>.md` with `createExclusive` (src/state/store.ts), and when that name is taken (a file or a directory of that name) it tries `<slug>-2.md`, `<slug>-3.md` and so on up to `<slug>-999.md`, writes the intent with its front matter `slug` equal to the file name it created without `.md`, and returns that path. If all 999 names are taken it throws an error naming the directory and the slug and writes nothing. An exclusive create whose write then fails leaves that new file partly written and propagates the error; the name counts as taken on the next filing; this is not a transaction. An EPERM that `createExclusive` raises while the path is absent (audit item F3) propagates. The base slug is the one `intentFromBreach` builds on main (`incident-<metric>-<rule>-<date>`, slugified and cut at 60 characters), so the first filing keeps its name.
  - R5. `aidlc monitor check --file-intent` (src/cli/main.ts:1343-1363 at 6c1a6cfd) shall read and validate the ledger once, through R2, before it iterates the breaches, also when the evaluation has no breach or only log-tier breaches; on a refusal it prints the breach output it prints on main with `filed` empty, then writes `aidlc: ` and the `StoreError` message on stderr and exits 1, having written no intent file, ledger or journal event. Otherwise it files each breach to a distinct intent file under R4, so two breaches filed on the same day (the two sides of a metric, or one breach refiled after its dedupe window) leave two files and the first unchanged; an intent write that fails propagates with nothing attached and nothing journaled for that breach. Without `--file-intent` the ledger is not read, as on main.
  - R6. `docs/OPERATIONS.md` (Incident -> intent) and `CHANGELOG.md` Unreleased shall each state the naming rule of R4, the refusal of R2 and R5 and the atomic write of R3, and `docs/ARCHITECTURE.md` names `IncidentRecord` and `IncidentLedgerFile` in the `incidents/incidents.json` row of the persisted-state table (line 191 at 6c1a6cfd).
acceptance:
  - 1. `tests/surface/incident.test.ts` "the ledger schema" (a table test of `IncidentLedgerFile.safeParse`): a record with every required field passes, with and without each optional field (`intentFile`, `filedAt`, `dismissReason`); each of the four dispositions passes; an unnamed extra key passes and is kept; these fail: `Dismissed`, count -1, 1.5, 0 and `"1"`, identity `""`, `intentFile` null, `firstSeen` `2026-09-11T00:00:00+02:00`, `firstSeen` `yesterday`, each required field missing; `2026-02-31T00:00:00Z` passes (text pattern, R1). [R1] [dod arm 1]
  - 2. Same file, "a ledger that does not parse is an error naming the file, and nothing is rewritten": for an empty file, whitespace, `{` cut short, a byte order mark before `{}`, `[]`, `null`, `"x"`, `3`, a record without `count`, a record with `disposition` `closed`, and a directory at the ledger path, and for a read error injected on `fs.readFileSync` of the ledger (EACCES), each of `read`, `shouldFile`, `attachIntent` and `triage` throws `StoreError` with the code R2 names and the file path in its message, and the ledger path holds the same bytes (or is still the directory) afterwards. An absent file reads as `{}`. Fails on main. [R2] [R3] [dod arm 1]
  - 3. Same file, "the ledger is written whole and only in a form a read accepts": `write` with a record whose `count` is 0 throws and leaves the previous file; with `fs.renameSync` onto `incidents.json` failing, `shouldFile` throws and the previous ledger bytes are unchanged and no `.tmp-` file is left beside it; after a successful `shouldFile` no `.tmp-` file is left and an unnamed key of a record is still there. Fails on main for the rename row. [R1] [R3] [dod arm 1]
  - 4. Same file, "an intent file name that exists is never overwritten": writing the same intent three times into one directory returns `<slug>.md`, `<slug>-2.md` and `<slug>-3.md`, each with its own name as front matter `slug` and each parseable by `parseIntent`; the first file keeps its bytes; with a directory named `<slug>.md` the first write returns `<slug>-2.md`; with `<slug>.md` and `<slug>-2.md` to `<slug>-999.md` present the write throws naming the directory and writes nothing; with `fs.writeSync` failing on the new intent file the write throws, the earlier intents keep their bytes, and the next write of the same intent returns the following suffix. Fails on main. [R4] [dod arm 1]
  - 5. Same file, "aidlc monitor check reads the ledger first and files distinct intents": with `incidents.json` holding `{` and `--file-intent`, the command exits 1 for data with a propose-tier breach, for data with no breach and for data with only log-tier breaches; in each case stdout holds the breach output with `filed` empty, stderr names the ledger file after it, and the intent directory, the ledger bytes and the host journal are unchanged. With no ledger, two checks on the same day whose breaches are on the two sides of the metric (bands with `direction: both`) file two different paths and the first file is unchanged after the second check. With an intent write that fails (a directory `<slug>.md` to `<slug>-999.md` present), the command exits 1 and the ledger holds no `intentFile` for that breach and the host journal no `INTENT_FILED`. Fails on main. [R5] [dod arm 1]
  - 6. Regression controls: the five tests of `tests/surface/incident.test.ts` at 6c1a6cfd pass unchanged (the window and `filedAt` tests of T0-AUDIT-FIXES R12 among them), and `tests/infra/update-json.test.ts` passes unchanged ("one lock primitive in src": the exclusive create stays in src/state/store.ts, :198-202). [R1] [R3] [R4] [dod arm 1]
  - 7. The three documents state R6 (reviewer-verified against the diff). [R6]
depends_on: []
budget: 820
tdd: true
diagnosis:
  root_cause: "C14: `intentFromBreach` (src/maintain/incident.ts:91 at 6c1a6cfd, unchanged since 92796d4f) names the intent `incident-<metric>-<rule>-<date>` without the side or the time, and `writeIncidentIntent` (:106-111) writes it with `writeFileSync`, which replaces an existing file, so a second breach of the same metric and rule on the same day (the other side, or a refiling after the dedupe window) overwrites the first intent. C15: `IncidentLedger.read` (:31-38) returns `{}` when `JSON.parse` throws, and `shouldFile` then writes the ledger back from that empty object, erasing every record, dismissals included; `write` (:40-43) uses `writeFileSync`, so a process that ends during it leaves the ledger cut short, which the next read then reads as empty. The CLI reads the ledger only inside the breach loop (main.ts:1349-1355), so a check with no breach never sees a corrupt ledger."
  repro: "Both reviews of 2026-11-11 reproduced C14 and C15 on 92796d4f with probes; acceptance 2, 4 and 5 fail there (a corrupt ledger is read as empty and replaced; a second write of the same intent returns the same path and replaces the first file)."
  same_class: "Other state files read as JSON (git grep JSON.parse(readFileSync -- src): the evidence manifest (src/audit/manifest.ts:66) throws on a malformed file; the lease listings (src/coordination/lease.ts:142, src/hooks/index.ts:610) skip a malformed lease without rewriting it; no other state file is read as empty on a parse failure and then rewritten. `exportBenchCases` already creates its files exclusively (`createExclusive`, src/cli/main.ts:1051)."
sweep: "git grep -n 'IncidentLedger\|writeIncidentIntent\|intentFromBreach\|IncidentRecord\|incidents.json' -- src tests docs at 6c1a6cfd. src/maintain/incident.ts (the class, both functions, the interface); src/cli/main.ts:1343-1363 (the one CLI caller: shouldFile, writeIncidentIntent, attachIntent, then the INTENT_FILED append of the host journal at :1358; changed by R5); src/index.ts:50 (library export, unchanged); src/state/paths.ts:192 (the directory, unchanged); docs/OPERATIONS.md:151 and docs/ARCHITECTURE.md:26 and :191 (changed under R6). Tests that pin the behaviour touched: tests/surface/incident.test.ts:28-49 (shouldFile, dedupe, dismissal; it writes through `write`), :68-74 (a record written without filedAt), :76-94 (one write of an intent into an empty directory), :96-120 (the CLI records filedAt); none asserts the overwrite or the empty read. tests/infra/update-json.test.ts:192-205 allows an exclusive create only in src/state/store.ts, which this card imports from and does not change."
forbid:
  - weakening or skipping a test to go green
  - a change to the dedupe rule of `shouldFile` (T0-AUDIT-FIXES R12) or to `breachIdentity`
  - a change to src/state/store.ts, or an exclusive create outside it
  - repairing, renaming or deleting an existing ledger or intent file
  - a new `mkdtempSync` call in a test; create a temporary directory with `tmpDir` of tests/infra/helpers.ts and remove it with `cleanup` in an `after` hook
  - editing .aidlc state by hand
non_goals:
  - a short write inside the store's write primitives (`atomicWriteText` and `createExclusive` treat a positive short `writeSync` result as complete, src/state/store.ts; it affects every state record, and src/state/store.ts is not this card's to change); "written whole" in this card means written to a temporary file that is renamed into place
  - a lock on the ledger read-modify-write; two monitor checks at the same time can still lose a count, and the atomic write keeps the file whole
  - a check that a record key equals its `identity`
  - renaming intent files filed before this card
  - an automatic recovery of a ledger that does not parse; the operator repairs or moves the file, as the error says
  - an intent file created and then `attachIntent` failing, or the process ending between the two; the next check files `<slug>-2.md` for the same breach
  - the Windows EPERM at the ledger rename while another process reads the file (the same case card T0-MANIFEST-LOCK names); the write throws and the previous ledger stays
hygiene: "Line numbers are from main at 6c1a6cfd; read them again at PREPARE. T0-AUDIT-FIXES changed `shouldFile` and `attachIntent` on 2026-11-11 (filedAt); keep its tests as they are. `createExclusive` and `atomicWriteJson` are imported from src/state/store.ts, which this card does not change. Insert the CHANGELOG entry directly above the entry that begins `- T1-EVAL-TRANSCRIPT-2 (replaces`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict."
doc_sync: docs/OPERATIONS.md (Incident -> intent), docs/ARCHITECTURE.md (persisted-state table), CHANGELOG.md
---

# T0-INCIDENT-INTENT-LEDGER

## Deliverable
`aidlc monitor check --file-intent` never replaces an intent it filed before: each filing gets its own file. An incident ledger that does not parse stops the command with an error naming the file, read before any breach is filed, where main read it as empty and wrote over every record.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/incident.test.ts tests/infra/update-json.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence

Attempt 1, effort high. RED commit efdc00cd (tests only; at that commit the file fails to load because `IncidentLedgerFile` is not exported by src/core/types.ts, so the per-test RED receipt was taken with a throwaway stub export, not committed: 12 of 23 tests failed, first assertion lines below). GREEN commits follow it; tests added after RED are marked "added after RED".

DoD: `npm run typecheck && node --test tests/surface/incident.test.ts tests/infra/update-json.test.ts` exit 0; typecheck clean; 42 tests, 40 pass, 0 fail, 2 skipped (the two POSIX-only tests, skipped on Windows and for uid 0 with the reason in the skip); output sha256 prefix 31636c8c4c1768a.

RED receipt (stub export in types.ts, other code as main), first failing assertion per test:

| test | first failing line |
|---|---|
| the ledger schema | `AssertionError: disposition Dismissed (case-sensitive)` |
| a ledger that does not parse ... | `Missing expected exception: empty: read` |
| the ledger is written whole ... | `Missing expected exception.` (count 0 write) |
| an intent file name that exists is never overwritten | deepEqual: actual `<slug>.md` twice, expected `<slug>-2.md`, `<slug>-3.md` |
| a base slug cut at 60 characters ... | actual `<slug>.md`, expected `<slug>-2.md` |
| a directory named <slug>.md counts as taken | `EISDIR: illegal operation on a directory, open '...<slug>.md'` |
| with <slug>.md and <slug>-2.md to <slug>-999.md present | `Missing expected exception.` |
| an exclusive create whose write fails ... | `Missing expected exception.` |
| an EPERM ... propagates | `Missing expected exception.` |
| aidlc monitor check reads the ledger first | `a propose-tier breach:` (status 0, not 1) |
| aidlc monitor check files the two sides | `Expected "actual" to be strictly unequal to:` |
| aidlc monitor check refiles one breach after its window | `Expected "actual" to be strictly unequal to:` |

Passing on main by design (controls, as the card allows): the five tests of main; "a ledger under a regular file reads as absent..."; "the intent directory classes"; "aidlc monitor check without --file-intent does not read the ledger"; "aidlc monitor check with an intent write that fails ..." (on main a directory at `<slug>.md` makes `writeFileSync` throw EISDIR, so exit 1 with nothing attached holds there too and must keep holding). Added after RED: "a ledger written by main ... reads back unchanged and the library exports the schema names" (passes on main code with the new schema: compatibility control), "with every name but <slug>-999.md taken the write returns <slug>-999.md" (fails on main), the array-ledger row of the CLI read-first test, the `write` row under the failing rename, the absent-ledger-directory row of "written whole". The final file run against main's incident.ts and main.ts (new types.ts kept): 12 fail, 11 pass, 2 skipped.

### One row per acceptance item

| item | test or command | result |
|---|---|---|
| 1 | "the ledger schema: a table of the fields R1 names" | pass; 12 accepted rows, 23 refused rows, 4 non-object whole values, `{}` accepted, extra key kept |
| 2 | "a ledger that does not parse is an error naming the file, and nothing is rewritten" | pass; 10 content rows, directory, injected EACCES, absent; each of read, shouldFile, attachIntent, triage; bytes compared after |
| 3 | "the ledger is written whole and only in a form a read accepts" | pass |
| 4 | "an intent file name that exists is never overwritten", "a directory named <slug>.md ...", "with <slug>.md and <slug>-2.md to <slug>-999.md present ...", "an exclusive create whose write fails ..." | pass |
| 5 | "aidlc monitor check reads the ledger first ..." (rows: propose breach, no breach, log-only breach, array ledger), "files the two sides ...", "refiles one breach after its dedupe window ...", "with an intent write that fails ..." | pass |
| 6 | the five tests of main unchanged (git diff removes only the two import lines of the test file); `node --test tests/infra/update-json.test.ts` | pass |
| 7 | docs, reviewer-verified | see the R6 row below |

### Clause by clause (point A)

| clause | code | test that fails without it |
|---|---|---|
| R1 fields identity, firstSeen, lastSeen, count, disposition, intentFile, filedAt, dismissReason | src/core/types.ts IncidentRecord | schema table (every field mutated one at a time in the revert table) |
| R1 unnamed keys kept | `z.looseObject` | schema table last assertion; "written whole" keeps `note` |
| R1 timestamp is a text pattern | `IsoTimestamp` reused | schema table: `2026-02-31T00:00:00Z` accepted, `+02:00` refused |
| R1 legacy compatible | same schema | "a ledger written by main ... reads back unchanged" |
| R1 no own interface in incident.ts, index exports the name | incident.ts imports the type; index.ts `export *` of types.ts | typecheck (tests import `IncidentRecord` from types.ts and the library); same test asserts `lib.IncidentRecord` and `lib.IncidentLedgerFile` |
| R2 absent is `{}` | `readJson(...) ?? {}` | "does not parse" test, absent row (and no directory created) |
| R2 not JSON (empty, whitespace, cut short, BOM) is MALFORMED_JSON naming the file | readJson | four content rows, four methods |
| R2 not an object of valid records is SCHEMA_VIOLATION with the first issue path | readJson, IncidentLedgerFile | rows `[]`, `null`, `"x"`, `3`, no count (`k.count` in message), disposition closed (`k.disposition`) |
| R2 unreadable file or directory is READ_FAILED | readJson | directory row, injected EACCES row; mode 0o000 row (POSIX only) |
| R3 shouldFile, attachIntent, triage read through R2 first | `this.read()` in each | each of the four methods in every row; per-method revert rows below |
| R3 write parses | `IncidentLedgerFile.parse(data)` | "written whole": count 0 and disposition closed writes throw, file bytes same |
| R3 write is atomic | `atomicWriteJson` | "written whole": rename onto the ledger fails for `shouldFile` and for `write`, bytes same, no `.tmp-` file |
| R4 never overwrites; `<slug>.md`, `-2` to `-999` | `createExclusive` loop | "never overwritten" (three writes, bytes of the first), directory row, 60-character row |
| R4 front matter slug equals the file name | `renderIntent({ ...intent, slug })` | `parseIntent(...).intent.slug` in three tests |
| R4 all 999 taken: error naming directory and slug, nothing written | final `throw` | 999 test: message includes both, 999 entries remain, `-999.md` bytes same |
| R4 only `-999` free is returned | loop bound | "with every name but <slug>-999.md taken" |
| R4 failed write leaves a partial file, propagates, name taken | `createExclusive` (not wrapped) | "an exclusive create whose write fails ..." (injected `fs.writeSync` ENOSPC) |
| R4 EPERM with the path absent propagates | `createExclusive` (store.ts, unchanged) | "an EPERM ..." (injected `fs.openSync`) |
| R4 base slug unchanged, first filing keeps its name | `intentFromBreach` untouched | slug literal asserted; first name `<slug>.md` |
| R5 ledger read once before the breaches, also with no or log-only breaches | `ledger.read()` before the loop | CLI rows no breach and log-only |
| R5 refusal prints breach output with `filed` empty, `aidlc: ` + message on stderr, exit 1, nothing written | `refused`, `process.stderr.write`, `process.exitCode = 1` | CLI rows: stdout JSON, stderr prefix, code and file name, ledger bytes, no intent directory, host journal bytes |
| R5 distinct files for two sides and for a refile | R4 | "files the two sides" and "refiles one breach" |
| R5 failed intent write: nothing attached or journaled | no code (the throw propagates before `attachIntent`) | "with an intent write that fails" (999 directories) |
| R5 no ledger read without `--file-intent` | read inside `if (o.fileIntent)` | "without --file-intent does not read the ledger" |
| R6 three documents | docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md | reviewer reads the diff; every sentence maps to a test above |

### Revert check, one source hunk at a time (point 6)

Each row reverts one hunk, runs `tests/surface/incident.test.ts` (unit rows without the CLI tests, CLI rows with the CLI tests only), then restores the file. Script kept outside the repository. Result column: FAILS means at least one test fails.

| hunk | first test that fails | result |
|---|---|---|
| types: `z.looseObject` to `z.object` | schema table (unnamed key kept); "written whole" | FAILS |
| types: identity `.min(1)` | schema table (identity empty) | FAILS |
| types: firstSeen `IsoTimestamp` | schema table (offset, yesterday) | FAILS |
| types: lastSeen `IsoTimestamp` | schema table (lastSeen yesterday) | FAILS |
| types: count `.int()` | schema table (count 1.5) | FAILS |
| types: count `.positive()` | schema table (count 0, -1); "written whole" (count 0) | FAILS |
| types: intentFile nullable | schema table (intentFile null) | FAILS |
| types: intentFile required | main's tests (records without intentFile) | FAILS |
| types: filedAt `IsoTimestamp` | schema table (filedAt yesterday) | FAILS |
| types: filedAt required | main's tests, schema table | FAILS |
| types: disposition enum | schema table (Dismissed, closed); "does not parse" (closed row) | FAILS |
| types: dismissReason string | schema table (dismissReason 3); main's tests | FAILS |
| types: ledger values unchecked (`z.record(z.string(), z.any())`) | schema table (disposition, count rows); "does not parse" (record rows) | FAILS |
| incident: read swallows errors | "does not parse" (empty row); CLI read-first | FAILS |
| incident: read without the schema | "does not parse" (record without count) | FAILS |
| incident: shouldFile does not read through R2 | "does not parse" shouldFile rows; main's tests | FAILS |
| incident: attachIntent does not read through R2 | "does not parse" attachIntent rows | FAILS |
| incident: triage does not read through R2 | "does not parse" triage rows | FAILS |
| incident: write without parse | "written whole" (count 0 write) | FAILS |
| incident: write not atomic (`writeFileSync`, parse kept) | "written whole" (rename row) | FAILS |
| incident: intent write overwrites | "never overwritten" and five more | FAILS |
| incident: first name `-2` | "never overwritten" and five more | FAILS |
| incident: limit 998 | "with every name but <slug>-999.md taken" (added for this row; it survived before) | FAILS |
| incident: limit 1000 | 999 test | FAILS |
| incident: front matter slug is the base slug | "never overwritten" and two more | FAILS |
| incident: error omits the directory | 999 test | FAILS |
| incident: error omits the slug | 999 test; CLI failing-write test | FAILS |
| incident: suffix on the first name too | "never overwritten" and four more | FAILS |
| cli: no pre-read | CLI read-first | FAILS |
| cli: breaches filed after a refusal | CLI read-first | FAILS |
| cli: no stderr line | CLI read-first | FAILS |
| cli: exit code 0 on refusal | CLI read-first | FAILS |
| cli: stderr without the `aidlc: ` prefix | CLI read-first | FAILS |
| cli: ledger read without `--file-intent` | "without --file-intent does not read the ledger" | FAILS |

Two rows survived on the first run and were fixed: `count` (the script had changed another schema, a mutation of the wrong line, rerun with the unique line: both FAIL) and limit 998 (the 999 test cannot tell 998 from 999; the "-999 free" test was added). A catch of a non-`StoreError` in the CLI read was removed as unreachable (`readJson` throws only `StoreError`).

### Schema field matrix (point C, R1)

| field | accepted | refused | tests |
|---|---|---|---|
| identity | non-empty string | empty, number, missing | table |
| firstSeen, lastSeen | text pattern incl. `2026-02-31T00:00:00Z`, 1 to 3 fraction digits | offset, `yesterday`, 4 fraction digits, missing | table |
| count | positive integer | -1, 0, 1.5, "1", missing | table |
| intentFile | absent, string | null, number | table |
| filedAt | absent, timestamp | `yesterday` | table |
| disposition | open, fix-now, scheduled, dismissed | Dismissed, closed, missing | table |
| dismissReason | absent, string | number | table |
| unnamed key | kept | | table, "written whole" |
| whole value | `{}`, object of records | array, null, string, number, record null, record string | table, does-not-parse |

### File-system input classes (point C)

| call | absent | directory where a file is expected | path under a regular file | unreadable parent | content that does not parse |
|---|---|---|---|---|---|
| ledger read (`readJson`, `existsSync`) | `{}`, nothing created | READ_FAILED | `{}` (existsSync is false; the write then throws and the file keeps its bytes) | POSIX: `{}` (existsSync false), write throws, file keeps bytes (gated test); file mode 0o000: READ_FAILED (gated test), injected EACCES: READ_FAILED (all platforms) | MALFORMED_JSON, SCHEMA_VIOLATION |
| ledger write (`atomicWriteJson`) | directory created (row in "written whole") | n/a (the target is read first) | throws, file unchanged | throws (gated) | refused before any write |
| intent write (`createExclusive`) | directory created | `<slug>.md` a directory: name taken, next suffix | throws, file unchanged | throws, nothing written (gated) | n/a |

The `{}` for a ledger under an unreadable parent or under a regular file is a property of `readJson` (`existsSync`), which this card must not change (forbid: store.ts); no write follows because the write fails.

### forbid and non_goals, one line each

- weakening or skipping a test: `git diff origin/main...HEAD -- tests` removes two lines, both import lines; the only skips are the two POSIX-only tests, with the reason in the skip.
- dedupe rule and `breachIdentity`: `src/maintain/bands.ts` is not in the diff and the `shouldFile` body is untouched (grep of the incident.ts diff for `withinWindow` and `existing.count` finds only context).
- store.ts or an exclusive create outside it: `git diff --name-only origin/main...HEAD` lists no src/state file; `grep -rln "'wx'" src` prints only src/state/store.ts; tests/infra/update-json.test.ts passes in the DoD.
- repairing, renaming or deleting an existing ledger or intent: the src diff has no unlink, rename, rmSync, repair or retry of mine; tests compare the ledger and intent bytes after a refusal.
- a new `mkdtempSync` call in a test: `grep -c "mkdtempSync("` is 4 on main and 4 now (the four calls of the five existing tests, unchanged); every directory of the new tests comes from `scratch()`, built on `tmpDir`, removed by a top-level `after` hook, or from a fixture of `fixture()`, removed by an `after` hook.
- editing .aidlc state by hand: no `.aidlc` path in the diff; tests write only under temporary directories.
- non-goal lock on the read-modify-write: no lock code added (grep for `.lock` in the src diff is empty).
- non-goal key equals identity: no such check in the diff.
- non-goal renaming old intents: none renamed; only `writeIncidentIntent` changed.
- non-goal automatic recovery: a ledger that does not parse throws and is never written (bytes tests).
- non-goal intent created then `attachIntent` failing: no handling added; `attachIntent` stays after `writeIncidentIntent` in main.ts.
- non-goal Windows EPERM at the ledger rename: no retry; the failing-rename test shows the previous ledger stays.

### Temporary directories (message of the coordinator)

One run of the two DoD test files leaves 4 `aidlc-*` directories in the OS temp directory on this machine: `aidlc-incident-` x3 and `aidlc-intent-` x1, from the four `mkdtempSync` calls of the five tests of main (lines 35, 58, 75 and 83 of the test file), which acceptance 6 requires to pass unchanged. The new tests leave none (a run of only the new CLI tests changes no `aidlc-scn-` directory; the scratch root `aidlc-incident-t-` is gone after the run). Changing those four calls to `tmpDir` would make the count 0 and would edit tests the card names as unchanged: left for the coordinator to rule.

### Doc-reading run

78 test files read ARCHITECTURE.md, OPERATIONS.md or CHANGELOG.md: 1863 tests, 1850 pass, 1 fail, 12 skipped. The one failure is `T0-EXEC-TREE-KILL run on real processes` in tests/infra/exec.test.ts (a 6 s timing bound, machine load); `node --test tests/infra/exec.test.ts tests/infra/exec-sync-tree.test.ts` alone: 84 pass, 0 fail.

Coordinator verification:
