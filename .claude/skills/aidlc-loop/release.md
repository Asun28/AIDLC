# release: package, staging, production, recovery

Loads only for an explicit target. `aidlc release start --goal <id> --target
<package|staging|production>`, then `aidlc release next` / `aidlc release
report`. Deploy commands or infra files never activate deployment.

## Targets (LC1)
| Target | Finish state | DONE evidence |
|---|---|---|
| development | none | working requested behavior on integrated source |
| package | PREPARE | package identity, config notes, install/run proof |
| staging | STAGE | candidate deployed there, agreed checks + health PASS |
| production | OBSERVE -> CLOSE | matching artifact/config, data state, health |
No automatic promotion: staging success never enters CHECKPOINT or APPLY.
A later request attaches a new delivery goal to the verified candidate;
it never reopens or extends the old goal.

## Providers (LC3): bind before running
Operation roles from `aidlc.ops.json`: build/package, deploy, status,
environment identity, health, recover, migration status/apply, backup
verify. Each binding records argv, target selection, credential scope,
effects, timeout, status lookup, success/failure/UNKNOWN reading, recovery
route and evidence location. A required role that is NOT CONFIGURED =>
STOP/release-config with the exact setup need. "Could not read the config"
is a failure, never "off". Exit zero is not completion for an async deploy
or migration. No invented flags, aliases or `pre-approved` keys; an
unreconcilable destructive op is a prerequisite.

## States (LC5)
- PREPARE: owner, providers, immutable candidate (digest, source SHA,
  config digest), source/package evidence, release checklist. Package
  target finishes here with run proof.
- STAGE: agreed non-production deployment/data sequence in project order
  (migration phase at its point); smoke, health, recovery readiness.
- CHECKPOINT (production only): present the packet: candidate, environment,
  changes, test evidence, data steps, recovery plan. Reuse matching explicit
  authority or WAIT/STOP release-auth; never manufacture one.
- APPLY: only the approved sequence via reconciled provider operations;
  record intent (`aidlc op intent`) before every external mutation; require
  an idempotency key or status lookup, else stop the unattended path.
- OBSERVE: evaluate the declared signals over the window: PASS, BREACH or
  INSUFFICIENT_DATA. Missing telemetry, stale data, no traffic or a missing
  probe is never PASS; a ten-minute wait proves nothing. Synthetic traffic
  only when agreed and labeled.
- RECOVER: establish deployed/data state first; run only an applicable
  pre-authorized procedure; verify health and data; disposition is
  recovered, never delivered. Old binary onto a contracted schema: refused.
- CLOSE/DONE/WAIT/STOP: preserve candidate, operation, health and authority
  evidence; release owned resources; no implicit promotion.

## Authority (LC6)
Production approval names candidate digest, environment, operations,
migrations, evidence and recovery target and carries through retries and
recovery of that same operation. A changed candidate, config or effect
needs fresh authority. Approval for development, the board or a failed
candidate is insufficient. Recovery pre-authorization is a real record:
environment, eligible baseline, health trigger, procedure, migration
compatibility, window/budget, owner. Prose naming "rollback" is not one. A
generic deadline or STOP grants no emergency time; only a recorded
recovery allowance does.

## Tags and publication
Inspect tag/release-triggered workflows first. Local tag, pushed tag and
published release are different effects; any external publication or CD
trigger sits behind the matching authority. Never publish an unvalidated
candidate to obtain a version label; notes state the real outcome.

## Ownership (LC4)
One owner per environment/database via `aidlc` leases; conflicting workers
and other controllers block; deploys and migrations serialize by their real
resources. After interruption or a lost response, query the recorded
operation and the actual target before deciding; UNKNOWN stays explicit.

## Breach and repair (LC10)
On breach: state first, then applicable recovery or STOP/rollback-auth. At
most one lifecycle repair cycle per goal, deduplicated by incident/release
identity and within existing time/review limits; a new candidate re-enters
staging, health and its own approval. No hidden monitor after DONE; ongoing
operations are a separately authorized goal.
