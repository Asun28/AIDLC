---
slug: always-on-agent-study
title: Decide whether aidlc, here or downstream, needs an always-on agent, by measuring the delay one would remove before building it
author: asun28 (owner); drafted by the coordinator session
status: accepted
created: 2026-11-22T22:15:00Z
source: human
---

# Intent: Decide whether aidlc, here or downstream, needs an always-on agent, by measuring the delay one would remove before building it
Author: asun28 (owner); drafted by the coordinator session. Status: accepted.

## Problem
The owner asked on 2026-11-23 for Anthropic's article "Building always-on
agents" (2026-11-13, claude.com/resources/articles/building-always-on-agents)
to be discussed with a Codex gpt-6-astra agent, to decide whether this
repository or the repositories `aidlc init` installs into should have an
always-on agent, and to agree a plan.

The article describes an agent that sleeps and wakes for short runs, built
from five parts: a durable event inbox with one worker, timers in a durable
store, memory that holds only what cannot be looked up again, permissions
(a credential proxy, a classifier, user review of the important decisions,
deferred tool calls), and an outbox that starts quiet. It gives no guidance on
sandboxing, observability, cost ceilings or when not to build one.

The coordinator session and Codex discussed it in two rounds. Each row below
was checked against main at 4de752de; files under `talk/`, which is untracked,
were used as leads only.

## The five parts checked against this repository
| Part | What exists here | Gap |
| --- | --- | --- |
| Inbox | Goal and card records, the hash-chained journal, the operation ledger, the review queue, the incident ledger (`docs/ARCHITECTURE.md`) | No queue of inbound wake events with acknowledgement, dedupe and redelivery. The journal records actions; it redelivers nothing |
| Timers | `wait` directives with `until` or `pollSeconds` (`src/loop/directive.ts`), deadlines, review `holdUntil` and pool `resetAt` | Nothing wakes a process that has ended. `/loop` waits only inside an open session; a `/schedule` routine runs in a fresh clone without `.aidlc/` (`docs/OPERATIONS.md`, Unattended runs) |
| Memory | Artifacts, evidence bound to the candidate, LESSONS, the context pack (`src/loop/context-pack.ts`) | None found that a new store would fill |
| Permissions | Recorded authority, review allowances, `ask`/`checkpoint`/`stop` directives, hooks, `AIDLC_RUN_NO_SHIP` | No credential proxy outside the worker; hooks and environment flags are not a sandbox against a worker (`docs/OPERATIONS.md`, Running a goal) |
| Outbox | Directive JSON, the board, `aidlc board --watch` | No delivered notification with acknowledgement |

Facts that set the answer:
- An unattended driver exists: `aidlc run` dispatches directives through the
  `claude-code` provider, waits on ordinary waits without a model call and
  exits at `ask`, `checkpoint`, `release`, `done`, `stop`, a review block, a
  quota hold and the shipping boundary. This repository's `provider` is
  `mock`, which `aidlc run` refuses.
- `aidlc next` commits derived transitions, so a timer must not call it to
  observe a goal.
- `src/maintain/incident.ts` states that no hidden watcher is installed after
  development DONE.
- The GitHub ship path polls CI every 20 s up to a 30 min ceiling in ordinary
  code (`src/delivery/github-ship.ts`), so a wait on CI costs no model tokens
  while a process is alive.
- Card amendments, continuations, review rulings and production, tag and
  publish need the owner's instruction, a named delegation or recorded
  authority (`CLAUDE.md`, Hard limits). A scheduler supplies none of these.
- No record holds when a session opened or closed, and the controller does not
  journal each `wait` it returns with its `until` (`src/loop/controller.ts`).
  A quiet stretch in the journal does not show that no session was working.

## Proposed outcome
1. This repository: no always-on agent now. It is reconsidered only on the
   measurement below.
2. Downstream: `aidlc init` installs no always-on agent, daemon or schedule.
   It is reconsidered when the local trial shows a saving and at least two
   downstream projects name a trigger, an operating owner and a credential
   boundary.
3. Measurement (issue 425): the coordinator session fixes the protocol before it
   counts (the last 14 active days, timezone, which journal events count as
   progress on that goal or card and generation, the exclusions, the classes
   confirmed, excluded and unknown), then runs a read-only script outside the
   worktree over `.aidlc/` and targeted `gh` reads, never `aidlc next`, and
   writes a case table with the source of each case. The owner decides
   against the threshold: at least 3 confirmed cases over 30 min each and more
   than 2 h in total, in which work the gates already permitted waited only
   because no session was open. Excluded: a human decision, a quota still
   held, an unresolved operation, an expired deadline. Below the threshold
   with adequate coverage: defer. Unknowns that could change the result:
   instrumentation only. Threshold met: a spec is written; nothing is
   deployed.
4. Conditional on 3 (issue 426): either record wait episodes in the existing
   records (identity, reason, candidate and generation, observation time,
   `notBefore`, later resumption; no field named `eligibleAt`, since no
   process can certify that every gate was satisfied while nobody observed),
   or specify an opt-in, same-host waker with dispatch ownership, authority
   and recovery tests, which takes no lease over, merges nothing, grants no
   authority and extends no deadline.
5. Downstream recipe (card T0-INCIDENT-CI-RECIPE): `docs/OPERATIONS.md`,
   Incident -> intent, gains an opt-in recipe for running
   `aidlc monitor check --file-intent` on a schedule in the project's own CI.

## Affected users and systems
`docs/OPERATIONS.md`, `changelog.d/` and one card under `specs/tasks/`; the
issue tracker of `Asun28/AIDLC`. No file under `src/`, no prompt, no template
and no loop behaviour changes by this intent.

## Constraints
- Outside figures and files under `talk/` are leads, never evidence.
- The measurement reads state and writes none: no `aidlc next`, `aidlc report`
  or other command that writes under `.aidlc/`.
- A raw gap between two timestamps is not a confirmed delay.
- No change to `aidlc init`, the templates or the hooks.

## Decisions (owner, 2026-11-23, in the session)
- The plan agreed by the coordinator session and Codex is accepted, committed
  as this intent, and logged as one card (outcome 5) and issues 425 and 426
  (outcomes 3 and 4).

## Open questions
- (none)
