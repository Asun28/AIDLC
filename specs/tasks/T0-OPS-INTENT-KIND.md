---
id: T0-OPS-INTENT-KIND
title: `aidlc ops intent` and `recordIntent` refuse a record the operation ledger cannot read, before anything is written
status: todo
branch: T0-OPS-INTENT-KIND
worktree: D:\wt\AIDLC\T0-OPS-INTENT-KIND
allow_paths:
  - src/coordination/reconcile.ts
  - src/cli/main.ts
  - tests/infra/reconcile.test.ts
  - tests/surface/ops-intent.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-OPS-INTENT-KIND.md
dod_command: npm run typecheck && node --test tests/infra/reconcile.test.ts tests/surface/ops-intent.test.ts tests/scenarios/op-intent-dup.test.ts
dod_exit: 0
requirements:
  - R1. `OperationLedger.recordIntent` shall validate the whole record against `OperationRecord` before `atomicWriteJson`, and shall write no file when the record is invalid.
  - R2. `aidlc ops intent` shall exit nonzero on a `--kind` outside `OperationKind`, naming the value and the accepted kinds, and shall journal no `OPERATION_INTENT`.
  - R3. `aidlc ops intent` shall exit nonzero on a `--timeout-ms` that is not a positive integer, and shall write no operation file.
  - R4. The CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/infra/reconcile.test.ts`: `recordIntent` with kind `cleanup` throws, the ledger directory gains no file, and `ledger.list()` still returns the existing record. [R1] [dod arm 2]
  - 2. `tests/surface/ops-intent.test.ts`: on a fixture repository, `ops intent --kind cleanup` exits nonzero, stderr names `cleanup` and `deploy`, the operations directory gains no file, the goal journal gains no `OPERATION_INTENT`, and `aidlc next --goal <id>` still exits 0. [R2] [dod arm 3]
  - 3. `tests/surface/ops-intent.test.ts`: `ops intent --kind other --timeout-ms abc` and `--timeout-ms 0` each exit nonzero with no operation file. [R3] [dod arm 3]
  - 4. `tests/surface/ops-intent.test.ts`: `ops intent --kind other --target t` still exits 0 and writes one operation file with status `intended`. [R1] [R2] [dod arm 3]
  - 5. The CHANGELOG Unreleased section has a `T0-OPS-INTENT-KIND` entry. [R4]
depends_on: []
budget: 120
tdd: true
sweep: "`grep -rn recordIntent src tests` on bbbdb10: one CLI caller casts its kind (src/cli/main.ts:947), and the typed callers in src/loop and src/coordination pass kinds of `OperationKind` and positive timeouts, so R1 changes no valid call. tests/surface has no `ops intent` test, hence the new file."
diagnosis:
  root_cause: "`recordIntent` builds the record by hand and writes it with `atomicWriteJson`, which takes no schema, and `src/cli/main.ts:947` casts `--kind` with `as never`, so nothing validates what is written. `OperationLedger.list` then parses every file before filtering by goal, so one invalid record makes every operation read throw SCHEMA_VIOLATION, including `aidlc next` and `aidlc card next`."
  same_class: "`--timeout-ms` reaches the same write through `Number(...)`, so NaN or 0 fail `OperationRecord.timeoutMs` the same way. `markIssued`, `markRunning`, `markResult` and `update` change only `status`, time and string fields of a record that already parsed, so they are out of scope."
forbid:
  - changing `OperationKind` or `OperationRecord`
  - changing how `OperationLedger.list` reads a record that is already invalid
  - weakening or skipping a test to go green
non_goals:
  - a repair command for an invalid operation file already on disk
hygiene: "Issue 150. Line numbers checked on main at bbbdb10."
---

# T0-OPS-INTENT-KIND

## Deliverable
`aidlc ops intent` cannot write an operation record the ledger cannot read back. Closes issue 150.

## Acceptance
```powershell
npm run typecheck && node --test tests/infra/reconcile.test.ts tests/surface/ops-intent.test.ts tests/scenarios/op-intent-dup.test.ts
```
- Expected exit code: 0
- Assertion: the acceptance list above.
