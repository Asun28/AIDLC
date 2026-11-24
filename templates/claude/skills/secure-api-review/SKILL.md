---
name: secure-api-review
description: >-
  Checks API endpoint code for authentication, authorization, input
  validation, audit events, PII in logs, sessions and tokens, and error
  text. Use whenever creating or modifying an external-facing endpoint,
  reviewing API code, or generating an OpenAPI spec.
---
# Secure API review

Rules 1 and 5 check the code against what the project declares. Read its
authentication scheme and public routes from the OpenAPI `securitySchemes`
and `security` entries, CLAUDE.md or the project's security docs, and its
data classification from the schema's field tags or the project's
classification doc. A default applies only where the project declares none.

When you create or change an API endpoint:
1. Authentication: every endpoint requires the scheme the project declares
   (default: the gateway JWT); the only anonymous routes are the ones it
   declares public (default: `/health`).
2. Authorization: server-side checks on every state-changing route; object
   ownership is verified (no IDOR); no client-supplied role or tenant.
3. Input validation: validate request bodies against the OpenAPI/JSON schema
   and reject unknown fields; bound sizes and list lengths.
4. Audit: every state-changing endpoint emits an audit event with actor,
   action, entity and timestamp.
5. Data classification: fields the project's classification marks as
   personal data (default: fields tagged `pii` in the schema) never appear
   in logs, error messages, URLs or analytics.
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
