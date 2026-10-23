# JKCREW 2.14.163 — Private recovery check-ins

Recovery mode gives an athlete a quiet check-in, history, clinician-plan and
support view. Their linked coach can enable it from Riders → Recovery or the
rider profile's Recovery & check-ins action. Turning it off restores the
normal app without deleting training progress or recovery history. Each new
recovery period gets a separate episode.

The daily form requires explicit ratings for all eight symptoms and a sleep
answer. It records dated entries, supports editing and retrying, and explains
that the symptom total is not a return-to-riding assessment. The plan is
coach-entered: the app does not invent clinical stages or clear an athlete.
Turning recovery off asks the coach to record clinician clearance.

Private database tables and authenticated RPCs restrict records to the rider
and their linked coach. Version checks prevent silently overwriting another
device's edits; request receipts prevent duplicate check-ins on retries.
Unsaved health information remains in memory, not local storage, and is cleared
on account or episode changes.

While enabled, server and UI gates pause ordinary rider features and scoring.
The app suppresses new training notifications, stops live-call/media resources,
and shows only recovery navigation. Existing scores, training plans, runs and
battle payouts remain intact. A push already being processed at activation may
still arrive; pending pushes are skipped. Account-disable and scoring-pause
flags remain independent of recovery mode.

## Verification

- Recovery database: 13 disposable PGlite cases covering linked-coach/self
  access, ordinary feature restrictions, idempotency, conflicts, validation,
  dates, episode history and existing feature-access compatibility.
- Recovery browser UI: explicit-zero validation, all required answers,
  duplicate taps, uncertain-save retries across remount, conflicts, escaping,
  account isolation, clinician approval and 320–1024px layouts.
- Recovery integration: 58 checks using the app's actual integration functions,
  including deep links, stale responses, episode changes, feature gates,
  notification cleanup and installed-app update access.
- Full-page recovery: 50 checks against the shipped HTML/modules with isolated
  synthetic responses, including login, save/reload, retry and mobile layout.
  Also verifies no ranking downloads or health details in browser storage/cache.
  No production health entries were created by tests.
- Existing regression checks passed: auth startup (47), auth resilience (49),
  rider Home startup (90), service-worker startup/upgrade (50), coach startup,
  rider feature access, session refresh, live-run waiting (52), companion synchronization (44) and
  teardown (4), chat milestones (33), challenge rewards (16), release smoke,
  JavaScript parsing and whitespace checks. Current UCI Home/profile (63),
  leaderboard (133) and private metadata (47) checks also pass.
- The Home timing check was rerun in isolation after concurrent browser suites
  exceeded its time budget; first Home ready in 1,954 ms, with all 90 checks passing.
- A real athlete's installed phone still needs confirmation after deployment.

## Deployment

Backend migration `20261023111344_rider_recovery_mode.sql` was applied before frontend publication through the signed-in Supabase SQL Editor, with its migration-history record in the same transaction. The MCP migration connector returned expired request-state errors; the reviewed SQL was unchanged. The migration is
additive and does not enroll any athlete automatically. Root and Riley assets
share version 2.14.163 and retain separate service-worker cache namespaces.
No additional paid service is required. The release preserves the latest UCI
rankings and Elite Riders features.

The original recovery implementation was held on `codex/recovery-mode-pending`
because the Supabase connector failed during its earlier deployment attempt.
This release integrates that implementation with the current production app.

Kim's recovery mode is activated separately after the frontend is confirmed
live. No synthetic symptoms or check-ins are added to production. The coach
confirmed her doctor assessment and plan approval, but the exact clinical plan
text was not supplied; keep the written instructions empty until provided.

A real installed phone still needs confirmation of loading and submitting a
check-in. Browser tests use isolated accounts and do not claim to establish
clinical suitability or return-to-riding clearance.
