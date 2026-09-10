# migrate: data impact, phases, recovery

Loads when the request or changed surface has data impact, or for an
explicit migration target. Use `aidlc migrate assess` and `aidlc migrate
plan`; execution goes through release.md states, never by hand.

## Detect impact (LC2)
Judge behavior and contracts, not directories: ORM/entity definitions,
embedded DDL/SQL, schema files, storage formats and serializers, backfills,
bulk updates. Migration directories are only hints. Local/scratch checks
need no production connection or cloud backup. No data change => do not
load this module.

## Phase graph (LC8)
Pattern, not command order: expand -> compatible deploy -> backfill ->
verify consumers and data -> contract. Contract/destructive cleanup waits
for consumer-compatibility evidence, data invariants and explicit
authority; it is never first and never runs "because it is schema". Split
schema and bulk data steps only when they need separate compatibility,
recovery or deployment boundaries. Express dependencies in card
`depends_on` / `migration_phase` and in the accepted deployment procedure.

## Execution
Production apply never runs as a leg of ordinary card ship. STAGE/APPLY
invoke the approved phase at the right point. Record intent before apply.
After an interruption query migration versions/checksums and data
checkpoints; backfills use the resumable, idempotent mechanism. Failed or
UNKNOWN data effects block dependent deployment steps until reconciled.
Scratch apply/down success is migration evidence, not behavioral RED.

## Recovery (LC9)
Reversible: exercise apply and reverse plus invariants on representative
scratch/staging data. Irreversible: name the impact and a compatible
forward repair or backup-restore strategy with its authority; do not demand
a nonexistent down migration; the label waives no verification. Before a
production mutation that depends on recoverable data, verify the actual
recovery point: identifier, freshness, access, retention. A staging
rehearsal proves the procedure, not that a production recovery point
exists. Application rollback and database restore are separate effects;
never roll an old binary onto a contracted schema. An unavailable recovery
path blocks this migration only, not unrelated development.
