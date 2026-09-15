# Operations

How to run goals with the `aidlc` CLI, coordinate sessions, bind provider operations, wire hooks, run evals and audits, and read STOP reasons. Every command below exists in `src/cli/main.ts`; commands print JSON when stdout is not a TTY or when `--json` is given.

## Setup

```bash
npm install
node bin/aidlc.js init [dir] [--cards-dir specs/tasks] [--ship-path scaffold|github|dry-run] [--force] [--dry-run]
node bin/aidlc.js doctor
```

`init` copies `templates/` into the repository: `.claude/skills/aidlc-loop/*`, `.claude/skills/secure-api-review`, `.claude/skills/{tdd,diagnose,grilling,merge-conflicts}` (companion skills), `.claude/agents/*`, a merged `.claude/settings.json`, `REVIEW.md`, `bands.yaml`, `intent/`, `specs/README.md` and `specs/_SPEC-TEMPLATE.md`, `plans/`, `<cardsDir>/_TEMPLATE.md`, `evals/`, `.github/workflows/agent-evals.yml`, `aidlc-ci.yml` and `security-scanners.yml`, `docs/DELIVERY-OPS.md`, `docs/LESSONS.md`, `docs/THIRD-PARTY-NOTICES.md`, `aidlc.config.json`, `aidlc.ops.example.json`, an appended `## AI-native SDLC (aidlc)` section in `CLAUDE.md`, and `.aidlc/` plus `_local/` in `.gitignore`. Existing files are skipped unless `--force`.

`aidlc.config.json` keys (`src/config.ts`): `cardsDir`, `archiveDir`, `intentDir`, `specsDir`, `plansDir`, `evalsDir`, `worktreeRoot`, `base`, `mode` (`local|remote`), `shipPath` (`scaffold` drives `scripts/task.ps1`; `github` runs the native git/gh chain and needs `repository`; `dry-run` for fixtures), `reviewPool`, `reviewPolicyVersion`, `reviewer`, `gateRequired`, `maxWorkers` (1-2), `family` (`claude|gpt`), `provider` (`claude-api|claude-code|mock`), `repository` (`owner/name` for gh), `userLimitMs`, `hooks.frozenPaths`, `hooks.testPathPatterns`, `hooks.productionPatterns`, `tierPaths.tierS|tier0|frozen`, `preReview.command|reviewer|rounds|timeoutMs|onExhausted|shell|maxDiffBytes` (see Pre-review), `formalReview.command|reviewer|timeoutMs|shell|maxDiffBytes` (see Formal review as a command), `github.requiredChecks|requireVerdict|ciTimeoutMs|ciPollMs` (see Ship gates).

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
aidlc card close T0-CLAIM-NPE --all         # the five mechanical steps; the lesson step stays open
aidlc card close T0-CLAIM-NPE --lesson "NEVER <rule> (source: <ref>)"   # or --skip-lesson "<why>" (commander reserves --no-)
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
aidlc goal new "add claims status self-service to the portal" --intent intent/claims-status-self-service.md    # routes T1; PLAN lists the open questions of the intent and names the grilling skill
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

- Every process identifies its session: `AIDLC_SESSION` when set (one value per window, the explicit override), else the Claude Code session, which Claude Code exports to its Bash and PowerShell subprocesses as `CLAUDE_CODE_SESSION_ID` (the older `CLAUDE_SESSION_ID` is still read), else the default token in `.aidlc/session-default`, which every process without a session shares, so lease ownership cannot tell windows apart; `aidlc doctor` prints the source, and `DEFAULT: every window shares this identity` in that case. A hook process acts as the `session_id` of the hook event, the same Claude Code session. A `/clear` or a new window is a new session, and a lease recorded under the default token by an earlier version belongs to that token; no lease record is rewritten. `aidlc goal takeover <id>` takes the goal lease once it has expired (10-minute TTL) and the old owner's operations are reconciled; it does not touch card leases. A card whose lease is held by an ended session stops for ownership: a fresh run at PREPARE, naming the owner and the takeover command; a run in progress before PREPARE, with the generic stale-generation detail. That stop outlives the lease's expiry. `aidlc card status <card> --goal <id>` prints the lease next to the run (`lease.owner.session` and host, `lease.generation`, expiry, released, whether this session owns it) and the run's `ownerGeneration`, live or expired. While the lease is live the only continuation is the owner identity: when `ownerGeneration` equals `lease.generation`, which holds for every run PREPARE completed, run with `AIDLC_SESSION=<lease.owner.session>` on the same host and the renewal clears the stop (a run interrupted between the lease claim and the end of PREPARE has no `ownerGeneration` and is not continued this way). Once the lease has expired and no operation of the card is unresolved in any goal that lists it (the lease is one resource per repository and card; `aidlc ops list --goal <id>` shows each goal's, and the takeover names the ids it finds), `aidlc card takeover <card> --goal <id>` takes it in the acting session: the lease generation advances (a write of the old owner at its generation is fenced), the run, read again once the lease is held so that a stop another process persisted meanwhile stays, records the new generation, a run without one included, and the card state is selected again from the persisted evidence, which clears the ownership stop and keeps any other stop as `card next` would (a deadline the wall clock has passed selects STOP/time, the case `aidlc goal extend` re-admits once the dispatch has stopped the goal on it); `aidlc card next <card>` then continues the card, a run without a worktree at PREPARE. The takeover refuses and writes nothing when the card has no lease record or a released one (`card next` claims those), when this session holds the lease at the generation the run carries (`card next` renews it), while the lease of another session is live (expiry alone does not prove the owner stopped) and while an operation of the card is unresolved in any goal (named by id; `aidlc ops reconcile` first); the record and the ledger are read again inside the reconciliation, so a release, a takeover or an operation that landed after the command's first read is seen. An operation admitted after that read and before the lease write is found right after the write: the lease stays taken (its writer is fenced from then on), the run stays as it was, the command names the ids, and once they are reconciled the command run again completes the takeover. A handoff intent is journaled before the lease write (`NOTE`, `card-takeover-intent`, naming the previous owner) and one `LEASE_ACQUIRED` per generation after it, both resolved by card resource and generation in every goal's journal, so a process that ends in between leaves a completion that names the previous owner and journals nothing twice. A lease this session holds at a generation the run does not carry is such a takeover (or a claim) whose run update did not land: running the command again completes it without another advance, after reading the lease once more (a record released or taken by another session since the first read refuses without a write), and refuses while an operation of the card is unresolved. `card next` reads the stored run, never a caller's snapshot, before its plan-checkpoint guard too: a dispatch from a window that kept the run it read before the takeover records only its ownership stop on the stored run (which the owner's next call clears), writes nothing of its own back, and a stop already persisted there (risk, time) stands. The guarantees end where the store's do: `.aidlc/` writes are atomic but have no compare-and-set, so four windows remain, each with its recovery. The lease write: a renewal by the old owner that lands between the lease store's read and its write is overwritten (the primitive's window, shared with `aidlc goal takeover`), and the old owner's next write is fenced. The run write: a writer that passed its fence before the lease write and saves after it (`recordAttempt`, the ship, a review decision, a stale dispatch) writes the run at the old generation, and the takeover's own save can lose a stop persisted after its read; `aidlc card takeover` run again completes the run at the lease generation, and a lost stop is re-recorded by its author. The journal: two completions of one session may both journal the acquisition of one generation; the audit keys on generation. The ledger: an operation admitted after the takeover's last read is left to the assessment of `card next` (issued, running and UNKNOWN in the run's goal, as always); an intended one is reconciled with `aidlc ops reconcile`. The goal lease is untouched, and the goal-level `aidlc next` run between the card's stop and the takeover stops the goal on that stop: `aidlc goal resume <id> --reason "<why>"` after the takeover, and the dispatch then reports the card running (`wait` on `<card>:BUILD` for a run with a worktree, `run-card` for one at PREPARE) until `aidlc card next <card>` continues it.
- `aidlc goal status`, `aidlc goal list`, `aidlc board [goalId]` show state; the board is a view.
- A second window that runs `aidlc next` on a goal owned by another live session receives `wait` with the owner and lease expiry. After expiry, `aidlc goal takeover <id>` succeeds only when `aidlc ops list --goal <id>` shows no unresolved operations; otherwise reconcile first with `aidlc ops reconcile <opId> --status succeeded|failed|running|cancelled|UNKNOWN`.
- `aidlc review status [--pool <name>]` shows active slots, queued requests, `retry-after` holds and the pool reset time. Raising a pool above one concurrent review needs provider evidence (`ReviewQueue.setPoolLimit`).
- `aidlc goal extend <id> --until <iso> --by <who> --reason "..."` is the only way to move a deadline; retries, revisions and delayed approvals never extend it. An extension (an ISO-8601 UTC timestamp) re-admits a goal stopped for time and every card of its current projection stopped for time (their deadlines move to the new goal deadline, the runs are in progress again; a stop for any other reason, or of a card superseded by a revision, stays); re-entry runs through the projection check, so a T2 goal is re-authorized before any dispatch. `aidlc goal resume <id> --reason "..." [--text "..."] [--cards a,b] [--replace '{"old":"new"}']` carries a revision into the resume (replacement ids must exist in the registry, a superseded card may not stay listed, and a listed card keeps every prerequisite it names) and applies it before the projection, re-entering through CARDS with the completion evidence of the old projection invalidated, the only way to re-plan a terminal goal (a DONE goal included): `aidlc goal amend` refuses a terminal goal and names the resume.
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

One hook process per event. `templates/claude/settings.json` (merged by `init`) wires a single command for `PreToolUse` (matcher `Bash|Edit|Write|MultiEdit`), `Stop` and `UserPromptSubmit`; that process runs every guard that applies to the event (`src/hooks/entry.ts`, `dispatchHook`) and returns the first block, else the first advisory output. `init` picks the fastest entry it can see: `node node_modules/aidlc/bin/aidlc-hook.js` when the package is installed locally, `node bin/aidlc-hook.js` inside the aidlc repository itself, otherwise the portable `npx --no-install aidlc hook auto`. Both bin entries load the compiled build only when it is at least as new as every file under `src/` (`bin/resolve-entry.js`: reasons `dist`, `no-dist`, `stale-dist`, and `src-unreadable` when a source below a readable `src/` cannot be inspected, since an incomplete scan is never proof of freshness; links to files and directories are followed; `AIDLC_ENTRY_DEBUG=1` prints the choice to stderr), so a checkout with a build from an earlier commit runs the sources, never the stale build. Measured on Windows: about 0.2 s per tool call for the direct entry, about 1.4 s for the npx form, against about 4.5 s for the 0.1.0 wiring that started three npx processes per tool call. Re-running `aidlc init` on a repository with the 0.1.0 per-guard hooks replaces them with the dispatcher and keeps any foreign hooks. `aidlc hook <name>` still runs one guard for debugging.

| Guard | Runs on | Blocks when |
|---|---|---|
| `production-gate` | PreToolUse Bash | the command matches a deploy/release verb together with `prod|production|live` and `RELEASE_APPROVAL` (or `AIDLC_RELEASE_APPROVAL`) is unset or does not name a recorded production authorization; exit 2 with the reason |
| `protect-paths` | PreToolUse Edit, Write, MultiEdit, Bash | the file path or a write-verb command matches `hooks.frozenPaths`; a read-only command is deferred with a note |
| `secrets-guard` | PreToolUse Edit, Write, MultiEdit, Bash | content looks like a credential (Anthropic, OpenAI, AWS, GitHub, Slack keys, private keys, inline password assignments) or the target is a secret file (`.env` except `.env.example`, `.pem`, `.key`, `id_rsa`, `.secrets/`) |
| `protect-tests` | PreToolUse Edit, Write, MultiEdit | a fix-task marker is active (`AIDLC_FIX_TASK` or `.aidlc/fix-task`) and the path matches `hooks.testPathPatterns` |
| `verify-before-done` | Stop | an active card run in BUILD, SHIP or REVIEW_FIX has no DoD receipt and its card lease is absent, released or owned by the acting session (the hook event's `session_id`, or `AIDLC_SESSION`); a run whose lease names another session is that session's to verify; a lease record that cannot be read leaves its run listed for every session and is named by card id and store error code only, never by content; adds Stop context asking for the verification output |
| `route-new-work` | UserPromptSubmit | never blocks; prints the `[route]` line and size guidance for build/fix/deploy requests |

The scaffold's 18 secret-file `Read(...)` denials are merged into `permissions.deny`.

## Pre-review (R2)

A bounded second-model review in front of the ship, so the formal PR review (R3, two substantive decisions) sees candidates that already passed a cheaper review. Configure it in `aidlc.config.json`:

```json
"preReview": { "command": ["deepseek", "--model", "deepseek-v4-pro"], "reviewer": "deepseek-v4-pro", "rounds": 3, "timeoutMs": 600000, "onExhausted": "stop" }
```

`command` is argv (the prompt arrives on stdin; on Windows it runs through a shell unless `shell` is set); an empty command disables the stage. `aidlc review pre <card>` builds the prompt from `REVIEW.md`, the card (acceptance, allow_paths, non_goals, forbid, tier, diagnosis), the committed diff against the base and the findings still to verify (the previous round's block, or the R3 reasons after an R3 block), runs the command with a receipt, takes the last JSON line as the verdict, writes `.review/<card>.pre.<cycle>.<round>.json` and `.log` next to the candidate, records the round in the card run and journals `PRE_REVIEW_DECIDED`.

The gate lives inside SHIP: `aidlc card next` returns a `pre-review` directive until a `pass` exists for the current candidate. A `block` moves the run back to BUILD (the DoD receipt is cleared; the reasons are carried into the next prompt) and reopens the effort episode without spending an attempt: the rounds are the pre-review's own budget, and the effort ladder (baseline + 2 repairs + 1 justified escalation) counts DoD failures only. Rounds are capped per R3 cycle by `rounds`; a third block with `onExhausted: "stop"` is STOP/review with the retained verdicts, `"ship"` hands the residual findings to R3 instead. A missing or malformed verdict gets one retry, a reported quota hold is retried after the hold and never counts as a decision. An R3 block starts a new cycle: the repaired candidate needs a fresh pre-review pass before it ships again. R3 itself (`reviewer`, `gateRequired`, the PR review) is unchanged.

### Review panel

With `preReview.perspectives` set, one pre-review round runs one reviewer process per perspective concurrently, each with a perspective section in its prompt (built-in guidance for `bugs`, `security` and `compliance`, the three passes in REVIEW.md; any other name is a custom focus). The round verdict is aggregated: quota-hold > block > no-verdict > pass, so a round passes only when every angle passes; block reasons are unioned and tagged with their perspective; axes take the worse verdict; angles that bind different candidates never aggregate into a pass. Per-perspective verdict and log files are retained as `.review/<card>.pre.<cycle>.<round>.<perspective>.*` next to the aggregated round file, and the round record lists every angle with its outcome and duration; the round document is retained even when the round ends in a hold or without a verdict. The formal review is never fanned out: one exhaustive pass per decision. Reason: native reviewers cap findings per pass (Codex `/review` reports 1-3 by design, openai/codex#4710, #5547), so breadth per decision replaces repeated decisions. Citation rule, enforced in code where the verdict is classified: a block reason must carry an axis tag (`[spec]` or `[standards]`) and a diff location (`@ file[:line]`); anything else is advisory, retained in the verdict file and the journal, and never blocks. Recommended split: R2 as three contract-bound angles (`ac-coverage`, `spec-deviations`, `edge-cases`) and R3 as one exhaustive pass, since a union of three broad reviewers multiplies uncited findings. A deterministic scope gate runs before any model call: changed paths outside `allow_paths` block the round (R2) or refuse the dispatch (R3) with no tokens spent.

### Formal review (R3) as a command

The same mechanism runs the formal review when `formalReview.command` is set; otherwise the R3 verdict comes from the ship path (scaffold ReviewGate) as before. In this repository R3 is Codex:

```json
"gateRequired": true,
"formalReview": { "command": ["codex", "exec", "--sandbox", "read-only", "--output-schema", "{schema}"], "reviewer": "codex", "timeoutMs": 1200000 }
```

Placeholders in argv: `{instructions}` (the prompt; when absent the prompt goes to stdin, which avoids shell quoting of a multi-line prompt on Windows), `{base}`, `{head}`, `{card}`, `{schema}` (a materialised `verdict.schema.json` for reviewers that enforce structured output), `{cwd}`. `aidlc review r3 <card>` refuses to run before the pre-review pass when R2 is configured, runs the command with a receipt, writes the candidate-bound verdict to `.review/<card>.json` (the file the ship paths read; a ship path re-reading a pass is not a second decision) and records the decision through the existing R3 ledger: two substantive decisions, one no-verdict retry, quota hold as WAIT with `holdUntil`, second substantive block as STOP/review. Guards: a further required review beyond the two decisions is STOP/review before any third run; an advisory block (standards-only without a required gate) is recorded and the ship proceeds with the findings retained; a verdict naming another sha is stale, never a pass, and never overwrites the candidate-bound file; `review pre` and `review r3` refuse to run inside an active quota hold, on a stopped card run, or when the checkout HEAD is not the pinned candidate; `review r3` also refuses while a formal review of the candidate is pending, when the shared review pool does not admit it, and once the two-decision allowance is used, even if the candidate already holds its pass. The invocation is reserved in the ledger before dispatch and persisted state is re-read after the review, so a concurrent call cannot spend the same decision and a STOP saved meanwhile is kept. The canonical `.review/<card>.json` is published only for a successful, non-stale decision; an advisory block is published as a pass with the findings under `advisory`. A document that reports its own failure keeps it. Dynamic instructions never pass through a shell; perspective names must be filename-safe and unique. With `gateRequired: true` every block is merge-blocking: the card returns to REVIEW_FIX, the episode reopens without spending an attempt (the two decisions are the formal review's own budget), and the repaired candidate restarts the pre-review cycle (R2 round 1) before `review r3` runs again. `aidlc card next` in SHIP returns `pre-review`, then `review`, then ships.

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

## Ship gates (GitHub ship path)

`github.requiredChecks` lists the check-run names that must be present and conclude success on the candidate before the squash merge (skipped or neutral never satisfies a required name). A required name absent from the check runs of the head counts as pending until `github.ciTimeoutMs` (default 30 minutes, polled every `github.ciPollMs`, default 20 seconds), never as satisfied; every other check that reports on the head must succeed as well. `github.requireVerdict` (default true) keeps the candidate-bound R3 verdict a precondition of any remote effect; it may be false only while `gateRequired` is false (the config parser refuses the pair), and a block verdict present for the candidate fails the ship in either case. This repository requires `check (ubuntu-latest, 22)`, `check (windows-latest, 22)`, `build-test` and `Gitleaks (committed history)`; `evals` runs only for some paths and stays out of the list, and it still blocks when it reports red.

The gitleaks history scan (`security-scanners.yml`) is a blocking job. A red check run whose name matches a secret or security scan (gitleaks, secret scan in any spelling, security), or raw gitleaks output given to `aidlc ci classify --log`, is the CI class `security`: it is never rerun, the card stops with reason `risk`, and the way out is to remove the finding from the change or the history and ship a new candidate. The ship path reports its check runs on the gate lines as JSON with bracket-encoded names, and the runner classifies a red gate from those checks alone: a check name is never evidence of a transient or code failure, a green scan next to a red build is a code defect, every red gate line counts, plain name=conclusion pairs are still read, and a red pair-like line that cannot be parsed and names a scan fails closed as security.
## STOP reasons

| Reason | Meaning | Next action |
|---|---|---|
| `card` | card contract invalid, unmet dependency, or repair episode exhausted | fix the card or record cause/evidence; no new attempt from another session |
| `capability` | a required control is missing (no reviewer backend, advisory ship could merge a defect) | configure the control (`gateRequired`, reviewer) or choose a blocking path |
| `scope` | requested work leaves the accepted scope | amend the goal (`aidlc goal amend`) or split a successor card |
| `risk` | secrets or license gates tripped, a red secret or security scan in CI, or a high-risk operation refused | remove the offending content or dependency; gates are never bypassed |
| `frozen` | a frozen contract or schema would change | route the change through version review |
| `checkpoint` | plan/projection checkpoint rejected or planning allowance exhausted | revise under a recorded revision or close the goal |
| `review` | second substantive block, or no verdict after the single retry | hand the PR and verdict evidence to a human adjudicator |
| `tool` | unclassified ship or probe outcome | inspect the receipt; resume with the printed `[SAGA-RESUME]` command |
| `ci` | unclassified CI failure or rerun allowance consumed | diagnose the failure before any rerun |
| `auth` | account or permission guard failed | `gh auth login` for the configured account; never downgrade to local mode |
| `time` | admission deadline or reconciliation grace reached | hand off with branches, PRs and evidence; `aidlc goal extend` is the explicit extension and re-admits the goal and its time-stopped cards |
| `arc-verify` | integrated acceptance failed after the single repair cycle | hand off with the integrated evidence |
| `release-config` | a required provider operation is NOT CONFIGURED or unreadable | bind it in `aidlc.ops.json` |
| `release-auth` | no matching staging/production authority for the prepared effects | record the authorization bound to candidate, environment and operations |
| `release-health` | health breach not recoverable, insufficient telemetry past max wait, or the attempt was recovered | diagnose; a new candidate re-enters with fresh approval |
| `migration` | migration state UNKNOWN or phase order violated | reconcile migration versions/checkpoints before dependent steps |
| `rollback-auth` | recovery needed but no applicable recovery authorization or procedure | record the recovery pre-authorization or hand off to the owner |
| `audit` | capture or persistence failure after a mutation | reconcile unknown effects; do not repeat the mutation |
| `ownership` | stale generation, foreign lease, or worktree/branch mismatch | the owner's own `card next` renews its lease and clears a stop caused only by expiry (journal `LEASE_RENEWED` with `revalidated`); otherwise attach read-only, continue as the owner identity (`AIDLC_SESSION`) while the lease is live, or `card takeover` once it has expired and the card's operations are reconciled (Sessions); `goal takeover` for the goal lease |
| `cancelled` | user cancellation | none; evidence retained; `goal resume` links a new generation |

## Companion skills

Advisory skills installed next to `aidlc-loop`; the loop's gates decide, and a skill never overrides `aidlc next`. Each is read by path when the step needs it (the implementer, investigator and planner agents point at them) or called by name in a session.

| Skill | When the loop reaches for it | What it must not do |
|---|---|---|
| `tdd` | BUILD, before writing or changing a test: the agreed seams are the acceptance items and the interfaces they exercise; anti-patterns that fake a RED (implementation-coupled, tautological, horizontal slicing); mocks only at system boundaries | Add a test at a seam the card does not name; weaken a test |
| `diagnose` | T0-bugfix and the card `diagnosis:` field, or a DoD/CI failure with no known cause: a red-capable command first, then 3-5 ranked falsifiable hypotheses, one variable per probe, the regression test before the fix | Form a hypothesis before the red-capable command exists; count attempts (that stays with `aidlc card attempt`) |
| `grilling` | T1/T2 intake while the intent's Open questions are not empty, and the T2 plan checkpoint: rounds over the frontier, recommended answer first, at most three rounds, leftovers become `[TBD: ...]` in the spec | Grill on T0 work; ask for a fact that can be looked up; add a confirmation gate the loop does not have |
| `merge-conflicts` | SHIP when the base moved and the merge-based sync stops on conflicts: resolve by the intent of each side, merge only, rerun DoD and review | Rebase or amend receipt-bound history; take a whole side blindly |

Lessons: `docs/LESSONS.md` is append-only. PREPARE reads it once per card; CLOSE appends at most one dated `NEVER|ALWAYS|NOTE` line when a review block or an incident taught a rule the playbook did not state.

## Upgrading a downstream repository

`aidlc init` adds files that are missing and never overwrites an existing one, so a re-run on an existing repository installs new skills, agents, docs and workflows and leaves everything else as it is. `--force` overwrites ordinary files (including `aidlc.config.json` and `docs/LESSONS.md`) but never refreshes a CLAUDE.md section that is already present. To take a new `REVIEW.md` or CLAUDE.md section into an existing repository, copy the changed sections by hand and bump `reviewPolicyVersion` in `aidlc.config.json`: the version is part of the review admission key, so a pass already recorded for a candidate stays valid and only a changed candidate is reviewed under the new text.
