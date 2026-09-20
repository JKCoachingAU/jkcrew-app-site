# JKCREW 2.14.128

## Delivered

- Hidden Daily Tier 2, revealed once per daily cycle after a confirmed full Daily list. Persisted challenge progress, mobile/reduced-motion celebration, coach-configurable list, and exactly four additional points on completion.
- Other Things Landed submissions with pending, approved and declined states. Only a linked coach can review; approval records one point atomically and supplies Tricktionary evidence.
- Live Run calls with incoming/ringing/busy/declined/canceled/unanswered states, native audio/video, media controls, event/course selection, leased shared HD edits, retained unsent drafts and continuous saves to the correct rider/event. Save keeps the call active.

Existing Tier 1 scoring, partial Daily completion, account restrictions and share-card settings are preserved.

## Verification

- Database tests: daily persistence and reset boundaries, one-time awards, submission ownership, coach authorization, immutable reviews, call/device permissions, event ownership and idempotent saving.
- Real PostgreSQL concurrency: 15 overlapping scenarios across 33 independent connections, including duplicate awards, simultaneous approvals, crossed calls, competing edits and repeated saves.
- Mobile Tier 2 reveal at 320/390/820/1280 widths and reduced motion; existing partial Daily and disabled-account regressions.
- Two isolated Chrome user sessions with native WebRTC and synthetic camera/audio: both participants connect, edit and hand over the shared HD run, save to the expected rider/event, remain connected after saving, and release media on ending. Includes delayed acceptance, lost acknowledgements, permission failures, reconnect and retry coverage.
- Root and Riley app shells load all new modules without page errors or missing local assets; syntax and smoke checks pass.

No test uses real rider accounts or alters their scores.

## Deployment and remaining configuration

The three additive migrations and authenticated `live-run-ice` Edge Function were deployed to the existing Supabase project. Anonymous access to the endpoint is rejected. New public RPC wrappers are authenticated-only; no new security-advisor warnings were introduced.

The user has no existing TURN service. Direct connections are available, but reliable calls across mobile/Wi-Fi networks still require a TURN REST-compatible provider, server-side `TURN_URLS` and `TURN_SHARED_SECRET`, and a real cross-network call test. See [Live Run setup](live-run-calls.md#ice-edge-function-setup). Local two-session verification does not prove cross-network connectivity. No paid service has been provisioned.
