# DELIVERY-OPS: binding release, migration and recovery to real project tools

Development is the default target and finishes without any of this. Nothing
in this file deploys anything by itself. An operation runs only when it is
bound in `aidlc.ops.json`, the goal's target enables it, an intent is
recorded, and the matching authority exists. The scaffold never auto-deploys;
CD is downstream opt-in.

## Operation roles (not invented flags)

| Role | Purpose | Required for target |
|---|---|---|
| build | produce the candidate artifact | package |
| package | produce the installable/runnable package | package |
| deploy | submit the candidate to an environment | staging, production |
| status | look up a submitted deployment by operation id | staging, production |
| environment | report what is running where (version, config digest) | staging, production |
| health | smoke/health signals bound to environment + candidate | staging, production |
| recover | application rollback/restore to a named baseline | production |
| migration-status | schema versions/checksums, backfill checkpoints | migration |
| migration-apply | apply one approved migration phase | migration |
| backup-verify | verify the recovery point (id, freshness, access, retention) | migration |
| restore | database restore from a verified recovery point | migration (irreversible) |

## Per-operation record (every binding must state)
- `command`: argv array, never a shell string.
- target selection: `arg` + `targetArg`, `env`, `config`, or `none`.
- credential scope (never the credential value).
- effects, and whether they are externally visible.
- timeout; `async: true` when exit zero only means "submitted".
- `statusLookup` with `{id}` and `operationIdPattern` to reconcile later.
- `idempotencyKeyArg` when the provider supports exactly-once submission.
- success/failure patterns; anything else reads as UNKNOWN.
- evidence location; `triggersPublication` for tag/release side effects.

## NOT CONFIGURED semantics
- A required role with no binding => `STOP/release-config` with the exact
  setup need. An optional target does not require the role to exist.
- "I could not read the config" (missing, malformed, unreadable) is a
  failure, never "off". `verify: NOT CONFIGURED` is honest, not a pass.
- No aliases, `pre-approved: rollback` switches or new keys to simulate
  capability. If a destructive or externally visible operation cannot be
  reconciled, it is a prerequisite before unattended use.

## Asynchronous operations: exit zero is not done
Record intent before issuing (`aidlc op intent`), capture the provider
operation id, then reconcile through `statusLookup`. A lost response means
"look it up", never "retry". Outcomes the provider cannot resolve stay
UNKNOWN and block dependent steps. Exactly-once requires an idempotency key
or unambiguous status lookup; without either the unattended path stops.

## Tags and publication
Inspect tag- or release-triggered workflows before any tag action. A local
tag, a pushed tag and a published release are three effects; the ones that
trigger external publication or CD sit behind production authority. Mark
such bindings `triggersPublication: true`.

## Ownership
One owner per environment and per database (aidlc leases). Deployments and
migrations serialize by their real resources, including against other goals
or controllers. A second window attaches read-only or takes over only after
the previous owner's operations are reconciled.

## Health
Declare each required signal with source, threshold, minimum samples,
staleness bound, window and maximum wait before deployment. Evaluation is
PASS / BREACH / INSUFFICIENT_DATA; missing telemetry, stale data, no traffic
or an unavailable probe is never PASS. A soak duration is a setting, not a
proof.

## Recovery
Application rollback and database restore are separate effects. Verify the
production recovery point before a mutation that depends on it; a staging
rehearsal proves the procedure only. Never roll an old binary onto a
contracted schema. Recovery is reported as `recovered`, never as delivery.
