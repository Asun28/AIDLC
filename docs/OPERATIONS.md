# Operations

How to run goals with the `aidlc` CLI, coordinate sessions, bind provider operations, wire hooks, run evals and audits, and read STOP reasons. Every command below exists in `src/cli/main.ts`; commands print JSON when stdout is not a TTY or when `--json` is given.

## Setup

```bash
npm install
node bin/aidlc.js init [dir] [--cards-dir specs/tasks] [--ship-path scaffold|github|dry-run] [--force] [--dry-run]
node bin/aidlc.js doctor
```

`init` copies `templates/` into the repository: `.claude/skills/aidlc-loop/*`, `.claude/skills/secure-api-review`, `.claude/agents/*`, a merged `.claude/settings.json`, `REVIEW.md`, `bands.yaml`, `intent/`, `specs/README.md` and `specs/_SPEC-TEMPLATE.md`, `plans/`, `<cardsDir>/_TEMPLATE.md`, `evals/`, `.github/workflows/agent-evals.yml` and `aidlc-ci.yml`, `docs/DELIVERY-OPS.md`, `aidlc.config.json`, `aidlc.ops.example.json`, an appended `## AI-native SDLC (aidlc)` section in `CLAUDE.md`, and `.aidlc/` plus `_local/` in `.gitignore`. Existing files are skipped unless `--force`.

`aidlc.config.json` keys (`src/config.ts`): `cardsDir`, `archiveDir`, `intentDir`, `specsDir`, `plansDir`, `evalsDir`, `worktreeRoot`, `base`, `mode` (`local|remote`), `shipPath` (`scaffold` drives `scripts/task.ps1`; `github` runs the native git/gh chain and needs `repository`; `dry-run` for fixtures), `reviewPool`, `reviewPolicyVersion`, `reviewer`, `gateRequired`, `maxWorkers` (1-2), `family` (`claude|gpt`), `provider` (`claude-api|claude-code|mock`), `repository` (`owner/name` for gh), `userLimitMs`, `hooks.frozenPaths`, `hooks.testPathPatterns`, `hooks.productionPatterns`, `tierPaths.tierS|tier0|frozen`, `preReview.command|reviewer|rounds|timeoutMs|onExhausted|shell|maxDiffBytes` (see Pre-review).

## Running a goal

### T0 bugfix

```bash
aidlc goal new "NPE in ClaimStatus when adjuster is null" --bug-evidence
aidlc next                                  # plan (T0-bugfix: one coherent card, no funnel)
# write specs/tasks/T0-CLAIM-NPE.md (diagnosis + fix + regression test), then:
aidlc cards validate --card T0-CLAIM-NPE
aidlc report --result cards-projected --cards T0-CLAIM-NPE
aidlc next                                  # run-card T0-CLAIM-NPE
aidlc card fix-task T0-CLAIM-NPE            # locks test files for the agent (protect-tests hook)
aidlc card next T0-CLAIM-NPE                # prepare -> build
# establish RED, implement, run the DoD, then:
aidlc card attempt T0-CLAIM-NPE --outcome success --dod-receipt "pytest exit 0" --red-receipt "<sha>:1"
aidlc card fix-task --clear
aidlc card next T0-CLAIM-NPE                # ship (dry-run or scaffold task.ps1)
aidlc card next T0-CLAIM-NPE                # close: lists missing closure steps
aidlc card close T0-CLAIM-NPE --all
aidlc next                                  # verify-arc, then report arc-verified
aidlc report --result arc-verified --detail "regression test green on integrated SHA"
aidlc next                                  # close -> done
```

A failed attempt is recorded with `--outcome fail --cause "<normalised cause>" [--progress]`; the same cause twice without progress stops the branch, and only an evidenced third failure can justify the single escalated attempt.

### T1 feature

```bash
aidlc intent new --title "Claims status self-service" --author "J. Ortiz" --problem "..." --outcome "..." --affected "..." --constraints "..."
aidlc intent validate intent/claims-status-self-service.md
aidlc spec validate specs/claims-status.md
aidlc goal new "add claims status self-service to the portal"    # routes T1
aidlc next                                  # plan: concise plan points and 2-5 cards
aidlc plan check plans/claims-status.md     # definition-of-ready gates
aidlc report --result plan-produced --plan-ref plans/claims-status.md
aidlc cards project --plan plans/claims-status.md --write   # drafts from the task-split table; edit before validate
aidlc cards validate
aidlc report --result cards-projected --cards T1-STATUS-API,T1-STATUS-PANEL,T1-STATUS-NAV
aidlc next                                  # run-card for the first wave (cap two, disjoint resources)
```

Repeat `aidlc card next <id>` per dispatched card. When every card is DONE, `aidlc next` returns `verify-arc`; report `arc-verified` with evidence, or `aidlc goal repair <goal> --cards T1-STATUS-FIX --detail "..."` for the single bounded repair cycle.

### T2 system

Same as T1 with the full funnel. After `cards-projected`, `aidlc next` returns `checkpoint` with the plan+projection packet. Approve once with `aidlc plan approve <goalId> --by <who>` (or `aidlc report --result approved --kind plan-checkpoint`); approval is carried forward for the same revision. `aidlc goal amend <id> --text "..." [--cards ...] [--replace '{"T2-OLD":"T2-NEW"}']` records a revision and returns to PLAN with unaffected evidence retained.

### Standalone release (package / staging / production)

```bash
aidlc goal new "package a runnable build of the portal" --target package
aidlc next                                  # release directive with attemptId (goal is in DELIVER)
aidlc release candidate <attemptId> --digest <candidateDigest> --sha <sourceSha> [--env staging] [--config-digest <d>]
aidlc release next <attemptId>              # prepare: needs, or NOT CONFIGURED -> STOP/release-config
aidlc release report <attemptId> --step package-run-proof --status succeeded --evidence "installed and ran smoke"
```

Staging: `--target staging`; `release next` issues the bound `deploy` operation for the staging environment, waits on provider status, then asks for `stage-verify` (`aidlc release report <id> --step stage-verify --status succeeded`). The attempt finishes after staging verification; CHECKPOINT/APPLY are never entered.

Production: `--target production`; after staging verification `release next` prints the approval packet (`aidlc release packet <id>`). Record the authority bound to the exact candidate, environment and operations:

```bash
aidlc authorize production --goal <goalId> --env production --candidate <digest> --sha <sourceSha> --ops deploy,status,health --by "release manager" --ref CHG-1234
aidlc release next <attemptId>              # apply -> observe (health window) -> close -> done
```

A BREACH routes to RECOVER only with a `recovery` authorization (`aidlc authorize recovery --env production --ops rollback --recovery '{"eligibleBaseline":"v1.4.2","healthTrigger":"5xx>2%","procedure":"rollback","migrationCompatibility":"expand-only","windowMs":1800000,"owner":"oncall"}'`); the attempt closes as `recovered`, and the goal stops with `release-health` so a new candidate re-enters with fresh approval.

### Incident -> intent

```bash
aidlc monitor check --bands bands.yaml --data samples.json --file-intent
```

`samples.json` is `{"baseline":[...numbers...],"recent":[{"at":"<iso>","value":n},...]}`. Deterministic Western Electric rules decide the tier; `diagnose`/`propose` breaches file `intent/incident-<metric>-<rule>-<date>.md` once per dedupe window and record the identity in `.aidlc/incidents/incidents.json`. The intent then enters the normal loop with `aidlc goal new`.

## Sessions

- Set `AIDLC_SESSION=<unique id>` in every window that coordinates (Claude Code sessions can rely on `CLAUDE_SESSION_ID`). Without it all processes share the default token in `.aidlc/session-default` and lease ownership cannot tell windows apart; `aidlc doctor` prints `DEFAULT: every window shares this identity` in that case.
- `aidlc goal status`, `aidlc goal list`, `aidlc board [goalId]` show state; the board is a view.
- A second window that runs `aidlc next` on a goal owned by another live session receives `wait` with the owner and lease expiry. After expiry, `aidlc goal takeover <id>` succeeds only when `aidlc ops list --goal <id>` shows no unresolved operations; otherwise reconcile first with `aidlc ops reconcile <opId> --status succeeded|failed|running|cancelled|UNKNOWN`.
- `aidlc review status [--pool <name>]` shows active slots, queued requests, `retry-after` holds and the pool reset time. Raising a pool above one concurrent review needs provider evidence (`ReviewQueue.setPoolLimit`).
- `aidlc goal extend <id> --until <iso> --by <who> --reason "..."` is the only way to move a deadline; retries, revisions and delayed approvals never extend it.
- `aidlc goal cancel <id>` and `aidlc goal resume <id> --reason "..."` handle terminal goals; resume links a new generation and keeps exhausted limits.

## Provider operation bindings

`aidlc.ops.json` (schema `DeliveryOpsConfig` in `src/delivery/ops.ts`; example in `aidlc.ops.example.json`):

```json
{
  "schemaVersion": 1,
  "environments": {
    "staging": { "description": "pre-production", "production": false },
    "production": { "description": "live", "database": "claims-prod", "production": true }
  },
  "operations": [
    { "role": "deploy", "command": ["./scripts/deploy.sh"], "targetSelection": "arg", "targetArg": "--env",
      "async": true, "operationIdPattern": "deployment id: ([A-Za-z0-9-]+)",
      "statusLookup": ["./scripts/deploy-status.sh", "{id}"], "successPattern": "status: healthy", "failurePattern": "status: failed",
      "idempotencyKeyArg": "--idempotency-key", "timeoutMs": 1800000, "effects": ["replace running version"], "credentialScope": "deploy-role" },
    { "role": "status", "command": ["./scripts/deploy-status.sh"], "targetSelection": "arg", "targetArg": "--env", "externallyVisible": false },
    { "role": "environment", "command": ["./scripts/env-identity.sh"], "targetSelection": "arg", "targetArg": "--env", "externallyVisible": false },
    { "role": "health", "command": ["./scripts/health.sh"], "targetSelection": "arg", "targetArg": "--env", "externallyVisible": false },
    { "role": "recover", "command": ["./scripts/rollback.sh"], "targetSelection": "arg", "targetArg": "--env", "async": true,
      "statusLookup": ["./scripts/deploy-status.sh", "{id}"], "successPattern": "status: healthy", "effects": ["restore previous version"] }
  ],
  "health": [
    { "name": "http_5xx_rate", "source": "prometheus", "threshold": { "op": "<", "value": 0.02 }, "minSamples": 30, "maxStalenessMs": 120000, "windowMs": 600000, "maxWaitMs": 1800000, "owner": "oncall" }
  ]
}
```

Rules: commands are argv arrays, never shell strings; `async: true` means exit zero is only "issued" and the outcome comes from `statusLookup`; `triggersPublication: true` puts the operation behind production authority; `aidlc release ops --target staging|production|package|migration` lists which roles are bound and which are `NOT CONFIGURED`. Required roles: package -> build, package; staging -> deploy, status, environment, health; production -> those plus recover; migration -> migration-status, migration-apply, backup-verify. An unreadable config is a failure, never "off".

## Hooks

One hook process per event. `templates/claude/settings.json` (merged by `init`) wires a single command for `PreToolUse` (matcher `Bash|Edit|Write|MultiEdit`), `Stop` and `UserPromptSubmit`; that process runs every guard that applies to the event (`src/hooks/entry.ts`, `dispatchHook`) and returns the first block, else the first advisory output. `init` picks the fastest entry it can see: `node node_modules/aidlc/bin/aidlc-hook.js` when the package is installed locally, `node bin/aidlc-hook.js` inside the aidlc repository itself, otherwise the portable `npx --no-install aidlc hook auto`. Measured on Windows: about 0.2 s per tool call for the direct entry, about 1.4 s for the npx form, against about 4.5 s for the 0.1.0 wiring that started three npx processes per tool call. Re-running `aidlc init` on a repository with the 0.1.0 per-guard hooks replaces them with the dispatcher and keeps any foreign hooks. `aidlc hook <name>` still runs one guard for debugging.

| Guard | Runs on | Blocks when |
|---|---|---|
| `production-gate` | PreToolUse Bash | the command matches a deploy/release verb together with `prod|production|live` and `RELEASE_APPROVAL` (or `AIDLC_RELEASE_APPROVAL`) is unset or does not name a recorded production authorization; exit 2 with the reason |
| `protect-paths` | PreToolUse Edit, Write, MultiEdit, Bash | the file path or a write-verb command matches `hooks.frozenPaths`; a read-only command is deferred with a note |
| `secrets-guard` | PreToolUse Edit, Write, MultiEdit, Bash | content looks like a credential (Anthropic, OpenAI, AWS, GitHub, Slack keys, private keys, inline password assignments) or the target is a secret file (`.env` except `.env.example`, `.pem`, `.key`, `id_rsa`, `.secrets/`) |
| `protect-tests` | PreToolUse Edit, Write, MultiEdit | a fix-task marker is active (`AIDLC_FIX_TASK` or `.aidlc/fix-task`) and the path matches `hooks.testPathPatterns` |
| `verify-before-done` | Stop | an active card run in BUILD, SHIP or REVIEW_FIX has no DoD receipt; adds Stop context asking for the verification output |
| `route-new-work` | UserPromptSubmit | never blocks; prints the `[route]` line and size guidance for build/fix/deploy requests |

The scaffold's 18 secret-file `Read(...)` denials are merged into `permissions.deny`.

## Pre-review (R2)

A bounded second-model review in front of the ship, so the formal PR review (R3, two substantive decisions) sees candidates that already survived a cheaper pass. Configure it in `aidlc.config.json`:

```json
"preReview": { "command": ["deepseek", "--model", "deepseek-v4-pro"], "reviewer": "deepseek-v4-pro", "rounds": 3, "timeoutMs": 600000, "onExhausted": "stop" }
```

`command` is argv (the prompt arrives on stdin; on Windows it runs through a shell unless `shell` is set); an empty command disables the stage. `aidlc review pre <card>` builds the prompt from `REVIEW.md`, the card (acceptance, allow_paths, non_goals, forbid, tier, diagnosis), the committed diff against the base and the findings still to verify (the previous round's block, or the R3 reasons after an R3 block), runs the command with a receipt, takes the last JSON line as the verdict, writes `.review/<card>.pre.<cycle>.<round>.json` and `.log` next to the candidate, records the round in the card run and journals `PRE_REVIEW_DECIDED`.

The gate lives inside SHIP: `aidlc card next` returns a `pre-review` directive until a `pass` exists for the current candidate. A `block` moves the run back to BUILD as a counted repair attempt (the DoD receipt is cleared; the reasons are carried into the next prompt), so the effort ladder (baseline + 2 repairs + 1 justified escalation) still bounds the total work. Rounds are capped per R3 cycle by `rounds`; a third block with `onExhausted: "stop"` is STOP/review with the retained verdicts, `"ship"` hands the residual findings to R3 instead. A missing or malformed verdict gets one retry, a reported quota hold is retried after the hold and never counts as a decision. An R3 block starts a new cycle: the repaired candidate needs a fresh pre-review pass before it ships again. R3 itself (`reviewer`, `gateRequired`, the PR review) is unchanged.

## Evals

Eval cases live in `evals/*.json` (`EvalCase` in `src/evals/runner.ts`: `id`, `dimension`, `prompt`, `allowedTools`, `role`, `effort`, `checks[]`, `origin`). Check types: `command` (argv, expected exit), `contains` / `not-contains` (file, text), `output-matches` (regex over the model output), `json-field` (path, equals).

```bash
aidlc evals run [--dir evals] [--threshold 0.9] [--provider mock|claude-code|claude-api] [--skip-model]
```

The gate fails (exit 1) below the threshold. `templates/github/workflows/agent-evals.yml` runs the suite on changes to `CLAUDE.md`, `.claude/**` and `evals/**` and nightly. Every incident that ships a fix should add a `regression` eval.

## Audit

```bash
aidlc evidence retain --goal <id> --id dod-T1-STATUS-API --kind dod-receipt --file out/test.log --candidate <digest>
aidlc audit seal --goal <id> --final-sha <sha> --final-digest <digest>
aidlc audit verify --goal <id> | --all
aidlc audit verify --goal <id> --claim-full [--capture-boundary]
```

`verify` reports the level (`none`, `recorded`, `traceable`, `independently-verified`) and findings: blocking `JOURNAL_CHAIN`, `OP_UNRESOLVED`, `OP_INTENT_MISSING`, `TRACE_MISSING`, `WORK_AFTER_TERMINAL`, `MANIFEST_SEAL`, `MANIFEST_STALE`, `ARTIFACT_MISSING`, `ARTIFACT_ALTERED`, `EVIDENCE_STALE_CANDIDATE`; warnings `OP_UNKNOWN`, `MANIFEST_UNSEALED`, `MANIFEST_TRAILING`. Any block sets exit 1. `--claim-full` evaluates the "fully audited" claim: `verified` only at `independently-verified` with `--capture-boundary` asserted by the operator; otherwise `BLOCKED/capability` with the prerequisite. A mutation journaled after the seal makes it `MANIFEST_STALE`; non-mutating closure events after the seal are only `MANIFEST_TRAILING`. Seal after the last mutation.

## STOP reasons

| Reason | Meaning | Next action |
|---|---|---|
| `card` | card contract invalid, unmet dependency, or repair episode exhausted | fix the card or record cause/evidence; no new attempt from another session |
| `capability` | a required control is missing (no reviewer backend, advisory ship could merge a defect) | configure the control (`gateRequired`, reviewer) or choose a blocking path |
| `scope` | requested work leaves the accepted scope | amend the goal (`aidlc goal amend`) or split a successor card |
| `risk` | secrets or license gates tripped, or a high-risk operation refused | remove the offending content or dependency; gates are never bypassed |
| `frozen` | a frozen contract or schema would change | route the change through version review |
| `checkpoint` | plan/projection checkpoint rejected or planning allowance exhausted | revise under a recorded revision or close the goal |
| `review` | second substantive block, or no verdict after the single retry | hand the PR and verdict evidence to a human adjudicator |
| `tool` | unclassified ship or probe outcome | inspect the receipt; resume with the printed `[SAGA-RESUME]` command |
| `ci` | unclassified CI failure or rerun allowance consumed | diagnose the failure before any rerun |
| `auth` | account or permission guard failed | `gh auth login` for the configured account; never downgrade to local mode |
| `time` | admission deadline or reconciliation grace reached | hand off with branches, PRs and evidence; extend only explicitly |
| `arc-verify` | integrated acceptance failed after the single repair cycle | hand off with the integrated evidence |
| `release-config` | a required provider operation is NOT CONFIGURED or unreadable | bind it in `aidlc.ops.json` |
| `release-auth` | no matching staging/production authority for the prepared effects | record the authorization bound to candidate, environment and operations |
| `release-health` | health breach not recoverable, insufficient telemetry past max wait, or the attempt was recovered | diagnose; a new candidate re-enters with fresh approval |
| `migration` | migration state UNKNOWN or phase order violated | reconcile migration versions/checkpoints before dependent steps |
| `rollback-auth` | recovery needed but no applicable recovery authorization or procedure | record the recovery pre-authorization or hand off to the owner |
| `audit` | capture or persistence failure after a mutation | reconcile unknown effects; do not repeat the mutation |
| `ownership` | stale generation, foreign lease, or worktree/branch mismatch | the owner's own `card next` renews its lease and clears a stop caused only by expiry (journal `LEASE_RENEWED` with `revalidated`); otherwise attach read-only or `goal takeover` after reconciliation |
| `cancelled` | user cancellation | none; evidence retained; `goal resume` links a new generation |
