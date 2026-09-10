---
name: secure-api-review
description: >-
  Apply the API security standard. Use whenever creating or modifying an
  external-facing endpoint, reviewing API code, or generating an OpenAPI spec.
---
# Secure API review

When you create or change an API endpoint:
1. Authentication: every endpoint requires the gateway JWT (or the project's
   equivalent); no anonymous routes outside `/health`.
2. Authorization: server-side checks on every state-changing route; object
   ownership is verified (no IDOR); no client-supplied role or tenant.
3. Input validation: validate request bodies against the OpenAPI/JSON schema
   and reject unknown fields; bound sizes and list lengths.
4. Audit: every state-changing endpoint emits an audit event with actor,
   action, entity and timestamp.
5. Data classification: fields tagged `pii` in the schema never appear in
   logs, error messages, URLs or analytics.
6. Sessions and tokens: no session fixation, tokens stored server-side or in
   http-only cookies, CSRF protection on cookie-authenticated mutations,
   passwords hashed with a slow adaptive hash.
7. Errors: generic messages to clients, details to structured logs only.

Run the project's endpoint check and include its output in your summary:
- if `scripts/check-endpoints.*` exists, run it;
- otherwise run `aidlc security check` (prints NOT CONFIGURED until a project
  script is bound; NOT CONFIGURED is not a pass).

Report findings as `[security] <rule> @ <file:line>: <why> -> <fix>`.
This skill is advisory; the review gate (`REVIEW.md`) and hooks enforce.
