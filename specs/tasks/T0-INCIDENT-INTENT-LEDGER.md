---
id: T0-INCIDENT-INTENT-LEDGER
title: An incident intent never overwrites an existing intent file, and an incident ledger that does not parse stops the command before any write
status: todo
branch: T0-INCIDENT-INTENT-LEDGER
worktree: D:\wt\AIDLC\T0-INCIDENT-INTENT-LEDGER
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: about 55 source lines in src/maintain/incident.ts, src/core/types.ts and src/cli/main.ts; the rest is the schema table test, the read-class rows, the write-boundary rows, the intent naming rows, the CLI rows, docs and about 25 lines of attempt evidence; raised from 360 to 820 by the coordinator on the candidate 111aecf8, which is 728 changed lines: 76 source lines in three files, 487 lines of tests, 159 lines of attempt evidence with the clause, revert, schema and file-system tables the review reads, the rest docs; the repair of the pre-review findings follows; raised from 820 to 1260 by the coordinator on the candidate b841528e, which is 1197 changed lines: 123 of source in three files, 788 of tests (the input classes of R2 through four methods and the CLI, on two platforms), 280 of attempt evidence, 7 of docs, after two pre-reviews before the first review decision; raised from 1260 to 1360 by the coordinator on the candidate 46176516, which is 1305 changed lines after the repair of the third pre-review (the array walk and the fixture beneath a repository, with their tests)"
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
  - R2. `IncidentLedger.read` shall read `incidents.json` with `readJson(file, IncidentLedgerFile)` (src/state/store.ts), with these input classes. An absent file is an empty ledger, as on main. A file that is not JSON (empty, whitespace only, cut short, a byte order mark before the JSON) throws `StoreError` `MALFORMED_JSON` naming the file. JSON that is not an object of valid records (an array, null, a string, a number, a record without a required field or with a field outside R1) throws `StoreError` `SCHEMA_VIOLATION` naming the file and the path of the first issue. A file that cannot be read (a directory at that path, a read error such as EACCES) throws `StoreError` `READ_FAILED` naming the file. Whether the file is absent is decided by a stat of it in which only "no entry" (ENOENT) means absent: a ledger path under a regular file (ENOTDIR on POSIX) or under a parent that cannot be read (EACCES) throws `StoreError` `READ_FAILED` naming the file, before `readJson` and before any write, so `shouldFile`, `attachIntent`, `triage` and the read of R5 never treat an unreadable ledger as empty (`readJson` alone would: it asks `existsSync`, which answers false for both). A ledger whose JSON holds an own key `__proto__`, at the top level, in a record or deeper, is refused with `SCHEMA_VIOLATION` naming the file: the schema parse and the store's serializer drop that key, so a record stored under it or a field named so would be lost without a trace. (Both added by the planner on 2026-11-11 after a pre-review of the built candidate.) Two more rules, added by the planner on 2026-11-11 after a second pre-review. A path the stat shows as existing and not a regular file (a directory) is refused with `READ_FAILED` from the stat result, before any read, so the refusal does not depend on what the platform's read of a directory returns. The search for an own `__proto__` key and for the nesting limit below never descends past the limit, so a value nested 6,000 levels deep, which `JSON.parse` reads, never makes it fail with a `RangeError` (the candidate walks with an explicit stack; since the limit bounds the descent at 65 containers, a recursive walk with the same limit behaves the same, which is why that one revert fails no test). Nesting limit, added by the planner on 2026-11-11 on the candidate f575000a: a ledger whose JSON nests objects or arrays more than 64 deep, counting the ledger object itself as 1 (a record is 2, a record's field value that is an object is 3), is refused with `SCHEMA_VIOLATION` naming the file and the path at which the limit is passed, on read and by `write` before it serializes, found by the same search. The reason: the store's serializer (`stableStringify`, src/state/store.ts, outside this card) recurses and overflows the call stack from about 1,700 levels on Node 22, so without a limit a deep ledger is read and then every write of it, `shouldFile` included, throws a raw `RangeError`. The records the writer produces are 2 deep, so every ledger main wrote is inside the limit. When both a `__proto__` key and the limit apply, the issue named is the one the search meets first. The search visits what the store's serializer visits: every index of an array from 0 to its length (an index defined as not enumerable included, which `Object.entries` skips and `Array.prototype.map` visits) and every enumerable own key of an object, so a value `write` accepts is one the limit and the `__proto__` rule hold for as it is serialized. (Added by the planner on 2026-11-11 after a third pre-review: an array element defined as not enumerable passed the write check 65 deep.)
  - R3. `IncidentLedger.shouldFile`, `attachIntent` and `triage` shall read through R2 before they change anything, so a ledger that does not parse is never rewritten, and `IncidentLedger.write` parses what it is given with `IncidentLedgerFile` and then writes it with `atomicWriteJson` (a temporary file renamed into place): the value handed to a write is validated before it is serialized, so a value a read would refuse is not serialized, and a write that fails before the rename leaves the previous ledger as it was. (What the bytes of the file are after a short write of the store is a non-goal; the first text, "a write never stores a ledger that a read refuses", promised it, and the planner restated it on 2026-11-11.)
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
budget: 1360
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
  - a value handed to `IncidentLedger.write` that is not JSON data (a bigint, a function, a symbol, `undefined`, an object with accessors or a prototype of its own): the module writes only what it read from the ledger with `JSON.parse` plus the fields it sets, the CLI and the three methods cannot produce such a value, and what `JSON.stringify` does with one (a `TypeError` for a bigint, a dropped key for the others) is unchanged
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

DoD at the current candidate (the commit that carries this evidence; unchanged counts after the cleanup repair): `npm run typecheck && node --test tests/surface/incident.test.ts tests/infra/update-json.test.ts` exit 0; typecheck clean; 56 tests, 53 pass, 0 fail, 3 skipped (the three POSIX-only tests, skipped on Windows and for uid 0 with the reason in the skip; the test file holds 39 tests, update-json.test.ts the rest). Earlier candidates, for the record only: at 111aecf8 42 tests, 40 pass, 2 skipped; at a70ed789 47 tests, 44 pass, 3 skipped; at f575000a 52 tests, 49 pass, 3 skipped; at b841528e 54 tests, 51 pass, 3 skipped.

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

Passing on main by design (controls, as the card allows): the five tests of main; "a ledger path under a regular file ..." (its Windows branch only: on POSIX it fails on main, which read such a ledger as `{}`); "the intent directory classes"; "aidlc monitor check without --file-intent does not read the ledger"; "aidlc monitor check with an intent write that fails ..." (on main a directory at `<slug>.md` makes `writeFileSync` throw EISDIR, so exit 1 with nothing attached holds there too and must keep holding). Added after RED: "a ledger written by main ... reads back unchanged and the library exports the schema names" (passes on main code with the new schema: compatibility control), "with every name but <slug>-999.md taken the write returns <slug>-999.md" (fails on main), the array-ledger row of the CLI read-first test, the `write` row under the failing rename, the absent-ledger-directory row of "written whole". The test file run against main's incident.ts and main.ts (new types.ts kept): at 43f3736d (25 tests) 12 fail, 11 pass, 2 skipped; at 3faa963e (35 tests) 18 fail, 14 pass, 3 skipped.

### One row per acceptance item

| item | test or command | result |
|---|---|---|
| 1 | "the ledger schema: a table of the fields R1 names" | pass; 12 accepted rows, 23 refused rows, 4 non-object whole values, `{}` accepted, extra key kept |
| 2 | "a ledger that does not parse is an error naming the file, and nothing is rewritten" | pass; 10 content rows, directory, injected EACCES, absent; each of read, shouldFile, attachIntent, triage; bytes compared after |
| 3 | "the ledger is written whole and only in a form a read accepts" | pass |
| 4 | "an intent file name that exists is never overwritten", "a directory named <slug>.md ...", "with <slug>.md and <slug>-2.md to <slug>-999.md present ...", "an exclusive create whose write fails ..." | pass |
| 5 | "aidlc monitor check reads the ledger first ..." (rows: propose breach, no breach, log-only breach, array ledger), "files the two sides ...", "refiles one breach after its dedupe window ...", "with an intent write that fails ..." | pass |
| 6 | the five tests of main unchanged (at 3faa963e `git diff origin/main...HEAD -- tests/surface/incident.test.ts` removes three lines: the two import lines it extends and the spawn line of the first CLI test, whose only change is its `env` option, now `childEnv(...)`; no assertion is removed); `node --test tests/infra/update-json.test.ts` | pass |
| 7 | docs, reviewer-verified | see the R6 row below |

### Clause by clause (point A)

| clause | code | test that fails without it |
|---|---|---|
| R1 fields identity, firstSeen, lastSeen, count, disposition, intentFile, filedAt, dismissReason | src/core/types.ts IncidentRecord | schema table (every field mutated one at a time in the revert table) |
| R1 unnamed keys kept | `z.looseObject` | schema table last assertion; "written whole" keeps `note` |
| R1 timestamp is a text pattern | `IsoTimestamp` reused | schema table: `2026-02-31T00:00:00Z` accepted, `+02:00` refused |
| R1 legacy compatible | same schema | "a ledger written by main ... reads back unchanged" |
| R1 no own interface in incident.ts, index exports the name | incident.ts imports the type; index.ts `export *` of types.ts | typecheck (tests import `IncidentRecord` from types.ts and the library); same test asserts `lib.IncidentRecord` and `lib.IncidentLedgerFile` |
| R2 absent is `{}`, decided by a stat in which only ENOENT means absent | `IncidentLedger.present()`, `read` | "does not parse" test, absent row (nothing created); injected ENOENT on an existing ledger reads `{}`; reverts `ENOENT means present`, `any stat error means absent` |
| R2 not JSON (empty, whitespace, cut short, BOM) is MALFORMED_JSON naming the file | readJson | four content rows, four methods |
| R2 not an object of valid records is SCHEMA_VIOLATION with the first issue path | readJson, IncidentLedgerFile | rows `[]`, `null`, `"x"`, `3`, no count (`k.count` in message), disposition closed (`k.disposition`) |
| R2 unreadable file or directory is READ_FAILED | readJson | directory row, injected EACCES row; mode 0o000 row (POSIX only) |
| R2 a stat error other than ENOENT (ENOTDIR under a regular file on POSIX, EACCES for an unreadable parent) is READ_FAILED naming the file, before readJson and before any write | `present()` throws `StoreError('READ_FAILED', this.file, ...)` | injected ENOTDIR, EACCES, EPERM, ELOOP through the four methods; real path under a regular file (POSIX: READ_FAILED, Windows: absent); directory mode 0o000 (POSIX only); CLI rows for no breach, log-only and propose-tier breach |
| R2 an own `__proto__` key at the top level, in a record or deeper is SCHEMA_VIOLATION naming the file | `ledgerIssue` in the `IncidentLedgerFile` schema | the `__proto__` test (four depths, four methods, `write`, issue path asserted), four CLI rows; keys that merely contain the text are kept |
| R2 the `__proto__` search does not recurse on the call stack | explicit stack in `ledgerIssue` | no input tells it from a recursive form once the limit bounds the depth (last revert row of the third round); the 6,000-deep rows show no `RangeError` |
| R2 a ledger nested more than 64 deep (ledger object = 1, record = 2) is SCHEMA_VIOLATION naming the file and the path at which the limit is passed, on read and by `write` before it serializes; the first issue met is named when `__proto__` also applies | `depth > MAX_LEDGER_DEPTH` in `ledgerIssue`; `write` validates with `safeParse` and throws `StoreError('SCHEMA_VIOLATION', ...)` | the 64-deep, 65-deep and 6,000-deep tests, the ordering rows, the CLI rows; revert rows of the third round |
| R2 an array is walked by index and an object by its enumerable own keys, as the serializer visits them (a non-enumerable array element counts and is searched) | children loop of `ledgerIssue` (`Object.keys` for objects, indices 0 to length for arrays) | "write walks an array as the serializer does ..." (64 accepted and read back, 65 and 6,000 SCHEMA_VIOLATION, `__proto__` refused); revert row `Object.entries` |
| R2 a path that exists and is not a regular file is READ_FAILED from the stat result, before any read | `if (!stats.isFile()) throw ...` in `present()` | injected stat with a read counter, real directory, CLI rows |
| R3 the value handed to a write is validated before it is serialized | `IncidentLedgerFile.parse(data)` before `atomicWriteJson` | "written whole" (count 0, disposition closed), `__proto__` test (`write`) |
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

### Revert check, one source hunk at a time (point 6; rerun in full after the pre-review: every row below FAILS, none stays green)

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
| incident: read without the stat (`present()` dropped) | "a stat of the ledger that fails with anything but no entry ..." | FAILS |
| incident: any stat error means absent | same test | FAILS |
| incident: ENOENT means present | same test (an existing ledger with a stat of ENOENT must read `{}`) | FAILS |
| incident: stat error thrown raw | same test (`StoreError` expected) | FAILS |
| incident: stat error code not READ_FAILED | same test | FAILS |
| incident: stat error message omits the file | same test (file named in the message) | FAILS |
| incident: read swallows errors (try/catch back to `{}`) | "does not parse", stat test | FAILS |
| types: `__proto__` check at the top of a value removed | `__proto__` test (top level and record rows); CLI rows | FAILS |
| types: `__proto__` check does not recurse | `__proto__` test (deeper row), CLI rows | FAILS |
| types: `__proto__` issue path loses its prefix | `__proto__` test (`k.__proto__`, `k.note.a.0.__proto__` in the message) | FAILS |
| types: `__proto__` check disabled | `__proto__` test, CLI rows | FAILS |
| incident: write without parse (now also the `__proto__` write row) | "written whole" (count 0), `__proto__` test (`write`) | FAILS |
| test: git selectors not stripped in `childEnv` | "a GIT_DIR and GIT_WORK_TREE in the caller environment ..." | FAILS |
| test: no fixed date in the child (`--import` shim removed) | "files the two sides" (`<slug>.md` with the date of the day), "refiles one breach", "with an intent write that fails" | FAILS |

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
| nesting | up to 64 containers deep (ledger object 1, record 2), objects and arrays alike | 65 or more (SCHEMA_VIOLATION naming the path of the 65th container) | 64/65/6,000-deep tests, CLI rows |
| own `__proto__` key | | at the top level, holding a record, in a record, deeper (SCHEMA_VIOLATION naming the key path) | `__proto__` test, CLI rows |
| key containing the text (`__proto__x`, `__proto__y`, `__proto__z`) | kept at the top level, in a record and deeper | | `__proto__` test |
| whole value | `{}`, object of records | array, null, string, number, record null, record string | table, does-not-parse |

### File-system input classes (point C)

| call | absent | directory where a file is expected | path under a regular file | unreadable parent | content that does not parse |
|---|---|---|---|---|---|
| ledger read (`present()` stat, then `readJson`) | `{}`, nothing created (stat ENOENT) | READ_FAILED from the stat result (`!isFile()`), before any read (injected stat and real directory; CLI) | POSIX: READ_FAILED (stat ENOTDIR), refused before any write; Windows: stat ENOENT, so absent: `{}`, and the write throws | POSIX: READ_FAILED (stat EACCES, gated test); file mode 0o000: READ_FAILED (gated test); injected stat errors and EACCES: READ_FAILED on every platform | MALFORMED_JSON, SCHEMA_VIOLATION (an own `__proto__` key included) |
| ledger write (`atomicWriteJson`) | directory created (row in "written whole") | n/a (the target is read first) | Windows: throws (a non-`StoreError` error), file unchanged; POSIX: not reached (the read refused) | not reached on POSIX (the read refused) | refused before any write |
| intent write (`createExclusive`) | directory created | `<slug>.md` a directory: name taken, next suffix | throws, file unchanged | throws, nothing written (gated) | n/a |

A ledger path under a regular file is READ_FAILED on POSIX and absent on Windows, because only the stat decides and the Windows stat reports no entry; the first attempt read both as `{}` through `readJson` (`existsSync`) and is corrected (pre-review point 1).

### forbid and non_goals, one line each

- weakening or skipping a test: at 3faa963e `git diff origin/main...HEAD -- tests` removes three lines (the two import lines and the `env` option of the first CLI test's spawn; no assertion); the only skips are the three POSIX-only tests, with the reason in the skip.
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
- non-goal a value handed to `write` that is not JSON data (bigint, function, symbol, `undefined`, accessors, own prototype): no code and no document sentence was added for it; `grep -ciE "bigint|symbol|accessor|not JSON data"` over the added lines of src, docs and the CHANGELOG is 0.

### Temporary directories (message of the coordinator)

One run of the two DoD test files leaves 4 `aidlc-*` directories in the OS temp directory on this machine: `aidlc-incident-` x3 and `aidlc-intent-` x1, from the four `mkdtempSync` calls of the five tests of main (lines 35, 58, 75 and 83 of the test file), which acceptance 6 requires to pass unchanged. The new tests leave none: measured after the pre-review with TEMP, TMP and TMPDIR pointing at an empty directory for one run of both DoD test files (the shared temp directory is changed by other processes at the same time), which holds exactly those four directories (`aidlc-incident-` x3, `aidlc-intent-` x1) and nothing else. Changing those four calls to `tmpDir` would make the count 0 and would edit tests the card names as unchanged: left for the coordinator to rule.

### Doc-reading run

After the first pre-review repairs (commit 92215c0a): 78 test files read ARCHITECTURE.md, OPERATIONS.md or CHANGELOG.md; one `node --test` call: 1867 tests, 1855 pass, 0 fail, 12 skipped, exit 0. (First attempt: 1863 tests, one failure, `T0-EXEC-TREE-KILL run on real processes` in tests/infra/exec.test.ts, a 6 s timing bound that passed alone with exec-sync-tree.test.ts, 84 pass; machine load.)

### After the pre-review

Six points of the pre-review of 111aecf8, repaired in commit 92215c0a. The card was amended on main (22e844e9, merged): R2 gained the stat rule and the `__proto__` refusal, the first non-goal names the short write.

1. R2, R5 (a ledger under a regular file or an unreadable parent became `{}`). `IncidentLedger.present()` (src/maintain/incident.ts) stats the ledger path and reads it with `readJson` only when the stat succeeds; ENOENT is absent, any other stat error throws `StoreError('READ_FAILED', file, message)` before `readJson` and before any write. Tests: "a stat of the ledger that fails with anything but no entry is READ_FAILED ..." (stat injected: ENOTDIR, EACCES, EPERM, ELOOP through read, shouldFile, attachIntent and triage; ENOENT on an existing file reads as `{}`, so the stat result decides), "a ledger path under a regular file ..." (real path), "a ledger file with mode 0o000, and one in a directory that cannot be searched ..." (POSIX only), and the CLI tests "with a ledger path under a regular file" and "with an incidents directory that cannot be searched" (POSIX only) for no breach, a log-tier breach and a propose-tier breach. The assertions that read such a ledger as `{}` and the evidence line that said so are corrected.
   - A ledger path under a regular file on POSIX: the stat fails with ENOTDIR, every method and the CLI refuse with READ_FAILED naming the file, exit 1 with the breach output and `filed` empty, no intent, ledger change or journal event.
   - The same path on Windows: the stat reports no entry (ENOENT), so by the rule "only no entry means absent" the ledger is absent. `read` is `{}`, `attachIntent` and `triage` change nothing, `shouldFile` throws a non-`StoreError` error because the write cannot land (the directory cannot be created under a file), the CLI exits 0 for no breach and for a log-tier breach, exits 1 for a propose-tier breach with empty stdout, and files no intent and journals nothing; the regular file keeps its bytes. No intent can be filed there, because the ledger write precedes the intent write.
2. R1, R2 (`__proto__`). `IncidentLedgerFile` (src/core/types.ts) is `z.unknown().superRefine(...).pipe(z.record(z.string(), IncidentRecord))`: the first step looks for an own `__proto__` key at any depth of the parsed JSON and adds an issue whose path ends at it, so `readJson` throws `SCHEMA_VIOLATION` naming the file and that path (`__proto__`, `k.__proto__`, `k.note.a.0.__proto__`); `write` parses with the same schema and refuses it too. src/state/store.ts is unchanged. Tests: "a ledger with an own __proto__ key at any depth ..." (four depths through all four methods and `write`, bytes unchanged, issue path in the message; keys `__proto__x`, `__proto__y`, `__proto__z` at the top level, in a record and deeper are kept), and four rows of "aidlc monitor check reads the ledger first" (the CLI, one per depth).
3. Short writes. No code change. "Written whole" in the test name of acceptance 3 is the card's name; it means written to a temporary file that is renamed into place (first non-goal). The comment of `write`, the CHANGELOG entry and docs/OPERATIONS.md now say "a temporary file that is renamed into place", and promise only that a write that fails before the rename leaves the previous ledger. No sentence says an intent file is complete: an exclusive create whose write fails leaves a partly written file (R4, tested).
4. Test isolation. `childEnv` removes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_CEILING_DIRECTORIES`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE` and `GIT_PREFIX` from the environment of every child process of the test file, the spawn of the first (existing) CLI test included: its assertions are unchanged, only the `env` value is. The new test "a GIT_DIR and GIT_WORK_TREE in the caller environment do not move the intent out of the fixture" sets both to another repository (`git init` in a scratch directory) in the parent and shows the intent lands under the fixture's `intent` directory and the other repository gets none; with the removal reverted it fails (revert table).
5. R6 wording. docs/OPERATIONS.md says "A ledger the command refused is never repaired, renamed or replaced by it" (a successful `shouldFile` does replace the ledger by an atomic rename, which the paragraph also says). Each sentence added to OPERATIONS.md, ARCHITECTURE.md and the CHANGELOG, with the proof: naming rule and 999 limit (intent tests, "-999 free" test); refusal classes: not JSON and not records (the "does not parse" rows and the CLI read-first rows), `__proto__` (point 2), cannot be read (directory row, injected EACCES, injected stat errors, CLI rows); POSIX path under a regular file and unreadable parent (gated tests, injected ENOTDIR and EACCES); Windows path under a regular file is absent (the Windows branches, run here); no intent, ledger or journal change after a refusal (CLI read-first rows); atomic rename and "a ledger a read would refuse is never written" ("written whole" test, `write` rows of the `__proto__` test); the ARCHITECTURE row (`present()` then `readJson`, `atomicWriteJson`; read in the code).
6. Date. The child process of every CLI test of the new tests gets a fixed clock through `--import` of a `data:` URL that replaces the no-argument `new Date()` with 2026-09-11T12:00:00.000Z (`Date.now` and `Date.parse` stay real), so the date of an intent name cannot change during a run. The exhaustion test no longer learns the slug in another process: the slug is the literal `incident-error-rate-we1-2026-09-11`, which the two-sides test asserts as the first filed name (`<slug>.md`, then `<slug>-2.md`). With the shim removed the tests fail (revert table). The first, existing CLI test does not depend on the date and is unchanged apart from the environment.

Not run here: the POSIX-only branches (three tests skipped on this Windows machine; no Node in the WSL image of this machine). They are written to the POSIX behaviour (ENOTDIR and EACCES from `statSync`); the stat classification itself runs on every platform through the injected-error test.

After the second pre-review repairs (commit 3faa963e): the same 78 test files, one `node --test` call: 1867 tests, 1855 pass, 0 fail, 12 skipped, exit 0.

### After the second pre-review

Six points of the second pre-review of a70ed789, repaired in commit 3faa963e (code, docs, tests) on top of the merge ac309437 of main (c15a6f9d: R2 refuses a non-file path from the stat and searches `__proto__` without recursion; R3 states what a write validates). Current figures of this candidate are in the DoD paragraph at the top; every figure of an earlier candidate carries its SHA.

1. Search without recursion (R2). `protoKeyPath` searched with an explicit stack; the third round (below) replaces it by `ledgerIssue`, the same traversal with the nesting limit, and replaces the tests of this point. What was measured then, on Node 22.23.1: `JSON.parse` reads 20,000 levels and the zod parse accepts them, but the store's serializer (`stableStringify`, `sortKeys`, recursive, src/state/store.ts) throws `RangeError` from depth 1,739 (1,738 is the largest depth that serializes) and `JSON.stringify` throws at 6,000; that is the reason for the limit.
2. Isolation, `git init`. The `git init` child of the isolation test gets `cleanEnv()`, and the test asserts that `other/.git` is a directory before the CLI runs. Check with `GIT_DIR` set in the environment of the test run: with the fix the test passes; with the inherited environment restored on that spawn it fails (pass 0, fail 1).
3. Case-insensitive selectors (the selector list was replaced in the fourth round by the `GIT_` prefix, below). `cleanEnv()` drops every environment name whose upper case is in the selector list, on every platform; `childEnv` and the `git init` child use it. Test: "the lowercase and mixed-case names of the git selector variables are removed from a child environment" sets `git_dir`, `Git_Work_Tree` and `GIT_INDEX_FILE` in the parent, asserts that `childEnv` holds no selector in any case and that a real child process lists none. The assertion is the same on both platforms: on Windows the three names are the selectors themselves; on POSIX `git_dir` and `Git_Work_Tree` are other variables that git ignores and are removed all the same (the policy is a case-insensitive match, so that no platform keeps a name that another would treat as a selector).
4. Not a regular file (R2). `present()` keeps the stat result and throws `READ_FAILED` naming the file when `!stats.isFile()`, before any read. Tests: "a path that exists and is not a regular file is READ_FAILED from the stat result, before any read, through all four methods" (stat injected to say not a file over a ledger whose content is valid, the read counter stays 0; and a real directory) and "aidlc monitor check with a directory at the ledger path refuses with READ_FAILED for every breach" (no breach, log-only, propose-tier: exit 1, `filed` empty, no intent, journal unchanged).
5. Wording (R3). docs/OPERATIONS.md and the CHANGELOG entry now say "The value handed to a ledger write is validated with the schema before it is serialized, and is then written to a temporary file that is renamed into place" (OPERATIONS adds: so a write that fails before the rename leaves the previous ledger); the `write` comment says the same. No sentence says anything about the bytes on disk afterwards. `grep -n "a read accepts\|a read would refuse\|never written"` over docs, the CHANGELOG and src finds none of the old phrases (the one hit, in src/coordination/review-queue.ts, is unrelated). The card's own test title of acceptance 3 keeps its words.
6. Evidence. Every historical figure in this section carries its candidate SHA: RED (efdc00cd, 23 tests, 12 fail), the run against main code (43f3736d, 25 tests: 12 fail, 11 pass, 2 skipped; 3faa963e, 35 tests: 18 fail, 14 pass, 3 skipped), the DoD (111aecf8: 42 tests, 40 pass, 2 skipped; a70ed789: 47 tests, 44 pass, 3 skipped; current: below), the removed test lines (three at 3faa963e: the two import lines and the `env` option of the first CLI test's spawn, whose assertions are untouched), the skips (three POSIX-only tests at 3faa963e), the doc runs.

Revert rows added or changed in this round (each: one hunk reverted, `tests/surface/incident.test.ts` run, file restored; all FAIL):

| hunk | first test that fails | result |
|---|---|---|
| incident: `!stats.isFile()` check removed | "a path that exists and is not a regular file ..." (the injected stat must be refused before the read) | FAILS |
| test: `cleanEnv` matches selectors case-sensitively | "the lowercase and mixed-case names ..." | FAILS |
| test: `git init` child gets the inherited environment | "a GIT_DIR and GIT_WORK_TREE ..." (run with `GIT_DIR` in the environment; the `.git` assertion fails) | FAILS (checked by hand, not by the table script) |

After the third pre-review repairs (commit c1d90bf2): the same 78 test files, one `node --test` call: 1867 tests, 1855 pass, 0 fail, 12 skipped, exit 0.

### After the third pre-review (nesting limit)

The card was amended on main (9bd138b0, merged as f28be39d): R2 gains a nesting limit of 64. Repaired in commit c1d90bf2.

The rule: a ledger whose JSON nests objects or arrays more than 64 deep, counting the ledger object itself as 1 (a record is 2, an object-valued field of a record is 3), is refused with `SCHEMA_VIOLATION` naming the file and the path of the container that passes the limit, on read, and by `write` before it serializes. The reason, measured on Node 22.23.1: `JSON.parse` reads 20,000 levels and the zod parse accepts them, but the store's serializer (`stableStringify`, `sortKeys`, recursive, src/state/store.ts, outside this card) throws `RangeError` from depth 1,739 (1,738 is the largest depth that serializes), and `JSON.stringify` throws at 6,000; so a deep ledger could be read and every write of it threw a raw `RangeError`. With the limit a ledger the store cannot serialize is refused before any write, and every ledger main wrote (2 deep) is inside it.

The search as code (src/core/types.ts; one traversal, explicit stack, depth carried with each entry):

```ts
const MAX_LEDGER_DEPTH = 64;

function ledgerIssue(root: unknown): { path: string[]; message: string } | undefined {
  type Step = { key: string; up: Step | undefined };
  const stack: Array<{ value: unknown; at: Step | undefined; depth: number }> = [{ value: root, at: undefined, depth: 1 }];
  const pathOf = (at: Step | undefined): string[] => {
    const keys: string[] = [];
    for (let step = at; step; step = step.up) keys.push(step.key);
    return keys.reverse();
  };
  while (stack.length > 0) {
    const { value, at, depth } = stack.pop()!;
    if (typeof value !== 'object' || value === null) continue;
    if (depth > MAX_LEDGER_DEPTH) return { path: pathOf(at), message: `nesting deeper than ${MAX_LEDGER_DEPTH} levels is not allowed` };
    if (Object.hasOwn(value, '__proto__')) return { path: [...pathOf(at), '__proto__'], message: 'an own "__proto__" key is not allowed' };
    const entries = Object.entries(value);
    for (let i = entries.length - 1; i >= 0; i--) stack.push({ value: entries[i]![1], at: { key: entries[i]![0], up: at }, depth: depth + 1 });
  }
  return undefined;
}
```

Order when both apply: the search is depth first in key order; at each container the limit is checked first, then an own `__proto__` key of that container, then its children. So a container at level 65 holding `__proto__` is reported for the limit; a `__proto__` in key `a` before a 65-deep value in key `b` is reported for `__proto__`, and the other way round for the limit. `IncidentLedger.write` now validates with `safeParse` and throws `StoreError('SCHEMA_VIOLATION', file, issues)` (before, a `ZodError`), so a write refusal names the file like a read refusal; the value is validated before `atomicWriteJson` serializes it.

Tests (the former 6,000-level tests and their "either lands or throws" assertion are replaced; there is no either/or any more):
- "a ledger nested exactly 64 deep is read, written by write and read back equal, and rewritten by shouldFile; objects and arrays count alike": 64 deep as objects and as arrays; read equals the parsed text; `write` of it reads back equal; `shouldFile` rewrites it, keeping the deep record, with no `.tmp-` file.
- "a ledger nested 65 deep, or 6,000 deep, is SCHEMA_VIOLATION ...": objects and arrays at 65 and at 6,000; through `read`, `shouldFile`, `attachIntent`, `triage` (the message names the file and `k.note.x...x: nesting deeper than 64 levels`, the path of 64 keys) and through `write` (a `StoreError` `SCHEMA_VIOLATION` naming the file, not a `RangeError`); the ledger bytes are unchanged and no `.tmp-` file is left; the safeParse issue path equals the 64 keys.
- "a __proto__ key below the nesting limit keeps its issue, and with the limit the issue named is the one the search meets first": five rows (proto at level 64, proto in the container at level 65, proto below level 65, proto-then-limit across keys, limit-then-proto across keys).
- "aidlc monitor check reads a ledger nested 64 deep, and refuses one nested 65 or 6,000 deep ...": 64 deep with no breach exits 0; 65 deep with no breach, 65 deep with a propose-tier breach, 6,000 deep with a log-tier breach exit 1 with the breach output, `filed` empty, `aidlc: ` + `SCHEMA_VIOLATION` + `incidents.json` + `nesting deeper than 64 levels` on stderr, no `RangeError`, the ledger bytes, the intent directory and the host journal unchanged.

Docs: docs/OPERATIONS.md and the CHANGELOG entry state the limit in the sentence that lists the refusals: "a JSON document that nests objects or arrays more than 64 deep (the ledger object is level 1, a record level 2; the refusal names the path at which the limit is passed, and `write` applies the same limit)" (the CHANGELOG wording: "the error names the path at which the limit is passed, and a write applies the same limit"). Each clause is pinned by a test above. Nothing is said about the serializer's own limit.

Revert rows of this round (one hunk reverted, `tests/surface/incident.test.ts` run without the CLI tests, file restored; this table replaces the four `__proto__`-search rows of the second round, whose tests were replaced):

| hunk | first test that fails | result |
|---|---|---|
| types: limit check removed | "a ledger nested 65 deep, or 6,000 deep ..." | FAILS |
| types: limit off by one, 64 deep refused (`>=`) | "a ledger nested exactly 64 deep ..." | FAILS |
| types: limit off by one, 65 deep accepted (`> MAX + 1`) | "a ledger nested 65 deep, or 6,000 deep ..." | FAILS |
| types: depth not counted for arrays | "a ledger nested 65 deep ..." (the arrays rows) | FAILS |
| types: ledger object counted as level 0 | "a ledger nested exactly 64 deep ..." and the 65-deep test | FAILS |
| types: `__proto__` checked before the limit at one container | "a __proto__ key below the nesting limit ..." (the level 65 row) | FAILS |
| types: children searched first-to-last | `__proto__` test (two offending keys name `a.__proto__`), the ordering rows | FAILS |
| types: issue path loses its prefix | `__proto__` test, 65-deep test (the path keys) | FAILS |
| types: the `__proto__` key is missing from the path | `__proto__` test, ordering rows | FAILS |
| incident: write throws a plain Error instead of the `StoreError` | "a ledger nested 65 deep ..." (write rows) | FAILS |
| incident: write skips the validation check | `__proto__` test (`write`), "written whole", 65-deep test | FAILS |
| types: recursive search with the limit instead of the explicit stack | none | GREEN (survives) |

The last row stays green and is not a defect of the tests: with the limit the search stops at 65 containers, so a recursive form cannot overflow the stack and no input tells it from the explicit stack. The card requires the form without recursion (R2), so the explicit stack stays; the requirement is met by the code, and what observably follows from it (no `RangeError` at 6,000 levels) is pinned by the tests above. The earlier row that did show recursion (the second round) is superseded by the limit.

### After the fourth pre-review (array walk, git ceiling)

Merged main up to 53b5bf88 (card amended in 4b7b569c: R2 walks an array by index as the serializer does, a new first non-goal, budget 1260). Repaired in commit 0c27fe35. No document was touched, so the doc-reading files were not rerun.

1. Array walk (R2). The serializer (`sortKeys` in src/state/store.ts, read only) maps an array with `Array.prototype.map`, which visits an element defined as not enumerable, and an object by `Object.keys` (enumerable own keys) read with `value[key]`. `Object.entries` skips a non-enumerable index, so a ledger with such an element 65 deep passed `write` and `read` then refused it, and at 6,000 `write` threw a raw `RangeError`. The children loop of `ledgerIssue` (the rest of the function is as shown in the third round) is now:

```ts
    const keys = Array.isArray(value) ? undefined : Object.keys(value);
    for (let i = (keys ? keys.length : (value as unknown[]).length) - 1; i >= 0; i--) {
      const key = keys ? keys[i]! : String(i);
      stack.push({ value: (value as Record<string, unknown>)[key], at: { key, up: at }, depth: depth + 1 });
    }
```

   An array is walked by index from 0 to its length (a hole reads as `undefined`, which is skipped when popped); an object by its enumerable own keys. Test, through `write` directly: "write walks an array as the serializer does: a non-enumerable element counts toward the nesting limit and is searched for __proto__": a valid record with `note = []` and index 0 defined non-enumerable holding 61 nested objects (64 deep) is written and reads back equal; 62 (65 deep) and 6,000 are `StoreError` `SCHEMA_VIOLATION` naming the file and the path `k.note.0.x...x: nesting deeper than 64 levels`, never a `RangeError`, the previous ledger unchanged; a non-enumerable element `{"__proto__":1}` is refused with `k.note.0.__proto__`.
2. Git ceiling (test isolation). The env helpers of the test file:

```ts
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith('GIT_')) env[key] = value;
  return env;
}
function childEnv(stateDir: string, cwd: string): NodeJS.ProcessEnv {
  const ceilings = [...new Set([path.dirname(cwd), path.dirname(realpathSync.native(cwd))])];
  return { ...cleanEnv(), AIDLC_STATE_DIR: stateDir, GIT_CEILING_DIRECTORIES: ceilings.join(path.delimiter) };
}
```

   Every inherited name that starts with `GIT_` in any case is removed; `GIT_CEILING_DIRECTORIES` is set to the parent of the child's working directory as given and as `realpathSync.native` returns it (a short 8.3 path on a Windows runner), joined with `path.delimiter`. `monitor()` takes the working directory as a parameter (default the fixture). Test: "a fixture beneath a git repository: the intent lands in the fixture and the enclosing repository gains no file": `git init` in a scratch directory, the CLI run in a subdirectory of it, a propose-tier breach; the intent is under the subdirectory's `intent`, the repository directory holds only `.git` and the subdirectory, the subdirectory only `bands.yaml`, `data.json` and `intent`. The helper test "every GIT_ name, in any case, is removed from a child environment and only the ceiling is set" replaces the former selector-list test: it asserts the `childEnv` keys and a real child's keys that start with `GIT_` (any case) are exactly `GIT_CEILING_DIRECTORIES`.
3. Non-JSON values handed to `write` are a non-goal (first non-goal): no code or docs were added for them.

Revert rows of this round (one hunk reverted, file restored):

| hunk | first failing line | result |
|---|---|---|
| types: arrays and objects walked with `Object.entries` again | "write walks an array as the serializer does ...": `Missing expected exception: 62 nested objects` | FAILS |
| test: `GIT_CEILING_DIRECTORIES` not set | "a fixture beneath a git repository ...": `ENOENT: no such file or directory, realpath '...\fixture\intent'` (the intent went to the enclosing repository); also the helper test | FAILS |
| test: `cleanEnv` removes only `GIT_DIR` and `GIT_WORK_TREE` | "every GIT_ name, in any case, is removed ..." | FAILS |
| test: the ceiling without the `realpathSync.native` form | none | GREEN (survives) |

The last row stays green on this machine and is the instruction of the coordinator kept as written: git normalises the entries of `GIT_CEILING_DIRECTORIES` itself (measured with a junction: both the linked and the real parent stopped the search with either entry alone), so no input here tells the two forms apart. The second form costs nothing and covers a path that a runner reports in its short form.

### After formal review decision 1 (fixture cleanup through the helper)

Decision 1 on 880cd51f blocked on one class: the forbid entry "create a temporary directory with `tmpDir` of tests/infra/helpers.ts and remove it with `cleanup` in an `after` hook" was met for `scratch()` but not for the fixtures, whose directories were removed through the harness's `fx.cleanup()`, in a `finally` or in the `after` hook. Repaired in the commit that carries this section (merged main first). Only tests/surface/incident.test.ts changed in code:

- Every `fx.cleanup()` call is gone (10 `try { ... } finally { fx.cleanup(); }` wrappers unwrapped; the body is dedented, no assertion changed). The one `after` hook over the fixtures now calls `cleanup(fx.tmp)` of tests/infra/helpers.ts. The first CLI test of main ("aidlc monitor check --file-intent records the filing time ...") uses `fixture()` instead of `makeFixture()` plus a `finally`, so the file has no `fx.cleanup` at all; its spawn line (`env`) was already changed in an earlier round, nothing else of it.
- The `finally` blocks that remain restore something that is not a directory: the `withFs` function replacements (`fs` bindings), the permission modes (`chmodSync` back to 0o644 or 0o755), and the process environment variables of two tests.
- The added `rmSync` (the test with a ledger path under a regular file, which removed the fixture's empty `incidents` state subdirectory in order to put a file there) is replaced by `renameSync(fx.paths.incidents, <scratch>/moved-incidents)`: the directory is moved into the scratch root, which the file-level `after` removes with `cleanup`; nothing is deleted by the test.
- The import line of main (`import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'`) is restored as it was, and the names this branch needs are a second import line (`fs, chmodSync, mkdirSync, readdirSync, realpathSync, renameSync, statSync`), so the diff against main adds no `mkdtempSync` and no `rmSync` text.

Grep table at the final commit (`tests/surface/incident.test.ts`):

| what | result |
|---|---|
| `grep -c 'fx\.cleanup'` | 0 |
| `grep -c rmSync` | 0 |
| `mkdtempSync` lines | 5 (the import and the 4 calls of the 5 tests of main, as on main: 5); added lines containing `mkdtempSync(`: 0 |
| directory created by `tmpDir('aidlc-incident-t-')` (the scratch root; every `scratch()` directory, `git init` repositories, planted files and `mkdirSync` trees are inside it) | removed by `after(() => cleanup(scratchRoot))` |
| fixtures created by `makeFixture()` inside `fixture()` (its directory is registered by `tmpDir` in the harness) | removed by the file-level `after`: `for (const fx of fixtures) cleanup(fx.tmp)` |
| the 4 `mkdtempSync` calls of main (`aidlc-incident-` x3, `aidlc-intent-` x1; T0-TEST-TEMP-SWEEP migrates them) | not removed by their tests; the only leak |

Leak check: `npm run typecheck` and the two DoD test files run with `TEMP`, `TMP` and `TMPDIR` pointing at an empty private directory (56 tests, 53 pass, 0 fail, 3 skipped); what is left: `aidlc-incident-BZifwn`, `aidlc-incident-RLMYn2`, `aidlc-incident-hBhgyR`, `aidlc-intent-BhLfXW` (the four `mkdtempSync` cases of main) and `node-compile-cache` (Node's own compile cache, created by the interpreter in `TMPDIR`, not by a test). Nothing from `tmpDir`, `makeFixture` or the scratch root remains.

Coordinator verification:
- At 721d4cb9, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/surface/incident.test.ts): tests 39, pass 39, fail 0, skipped 0.
- Windows, docpins: 79 test files reading 3 changed documents: # tests 1870 # pass 1858 # fail 0
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.

Coordinator verification:
- At d58f61d0, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/surface/incident.test.ts): tests 39, pass 39, fail 0, skipped 0.
- Windows, docpins: 79 test files reading 3 changed documents: # tests 1870 # pass 1858 # fail 0
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.
