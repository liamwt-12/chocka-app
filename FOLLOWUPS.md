# Follow-ups

Deferred work captured so it isn't lost. Tie-in to the Stellar Local roadmap in brackets.

## P1

### Transient-enumeration → retryable error on OAuth connect  [P1 — Retailer product / onboarding]
**Context:** `getManageableListings` is deliberately **all-or-nothing** — if any account's
`getLocations` fails it throws, so a partial enumeration is never treated as authoritative
(this is what stops a transient failure from auto-binding the wrong listing). The cost:
in `app/api/auth/callback/google/route.ts`, `bindManageableListing` then throws on a
transient Google error (e.g. `accounts.list`/`locations.list` 5xx), both call sites catch
and default to `'no_profile'`, and the user lands on `/no-profile` rather than a retryable
state. The listings/select routes surface it as a 500 the picker retries, but the callback
path is a dead-end for that connect.

**Why deferred:** the safe failure mode (no-profile) is acceptable for now, and the case is
rare. Correctness (never bind the wrong listing) was the P0 priority and is done.

**Fix when picked up:** in the callback, distinguish a *thrown* enumeration error from a
genuine empty result. On throw, route to a retryable error (a `connect_failed` code / the
onboarding "Try Again" path) instead of `/no-profile`, which should be reserved for a real
empty manageable set. Isolated to the two catch blocks in the callback plus one error
branch in `app/onboarding/page.tsx`. Optionally add a short low-level retry inside
`getManageableListings` for transient 5xx before giving up.
