---
slug: loop-integration
title: Companion skills, lessons and CI gates driven by the loop itself
author: asun28 (owner)
status: accepted
created: 2026-09-14T00:00:00Z
source: human
---

# Intent: Companion skills, lessons and CI gates driven by the loop itself
Author: asun28 (owner). Status: accepted.

## Problem
The four companion skills (tdd, diagnose, grilling, merge-conflicts), the
lessons policy and the gitleaks history scan landed in PR #7 as advisory
text. A session may or may not read them, the lessons file is never
written, a merge conflict during a base sync stops the card with a generic
tool error, and a red secret scan reports without blocking. The loop cannot
claim the steps happened because nothing in the engine names them.

## Proposed outcome
Every routing result and directive names the skills the step needs; a
merge conflict returns the card to BUILD with the right skill named; the
lessons file is read at PREPARE and a lesson disposition is a closure step
the card cannot skip; a red secret scan is a merge gate that stops the card
with reason risk and never reruns; required checks flow from config to the
GitHub ship path. Every change ships through the loop's own R2, R3 and
GitHub ship, one small card per PR.

## Affected users and systems
The aidlc CLI (src/core, src/loop, src/cli, src/config), the GitHub ship
path, the CI workflows, the templates that aidlc init installs, and every
downstream repository on its next aidlc init.

## Constraints
No runtime behaviour change for persisted records: new fields default.
Each card stays under its declared budget so R2 and R3 pass in one round.
card-loop.md cannot grow (6496 of 6500 bytes). The evals card waits for an
ANTHROPIC_API_KEY repository secret.

## Open questions
- (none)
