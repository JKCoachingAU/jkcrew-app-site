# Live Run calls and shared saves

Live Run calls add audio/video to the existing two-person private run draft. The rider must be linked to the coach. Either may initiate; only the other person may accept. Disabled feature access denies both the call and draft for that pair. A scoring pause alone is not a feature-access restriction, and these APIs award no points or XP.

## API contract

`live_run_call_action(p_action, p_session_id=null, p_client_id=null, p_message_id=null, p_payload={}, p_athlete_id=null, p_coach_id=null, p_after=0)` returns JSON. Use a stable UUID for a browser tab (`p_client_id`) and a separate stable UUID for each start or signal retry (`p_message_id`). Never recreate the request UUID after an uncertain response.

| Action | Inputs | Result / behavior |
| --- | --- | --- |
| `start` | Pair IDs, client ID, message ID, payload `{mode:'audio'|'video', draft?:snapshot}` | `{session,draft}` or `{busy:true,session:null}`. Both participants are reserved atomically; crossed starts cannot create two calls. Default draft is blank. Optional initial draft is validated. |
| `get` | Session ID, bound client ID for an active call or ringing caller | Returns `{session}`. The caller can recover their seeded `draft` while ringing; the callee receives no draft until acceptance. After acceptance, either participant can recover the draft, including after the call ends. Active calls and ringing callers reject a different browser/device with a clear permission error. Access always requires the current linked pair. |
| `accept` | Session ID, callee client ID | `{session,draft}`. Caller cannot accept. Same accepting client retry is idempotent. If already expired/terminal, returns `{session,unavailable:true}`. |
| `decline` | Session ID, callee client ID | `{session}`; never saves a run. |
| `cancel` | Session ID, bound caller client ID | Cancels a ringing call only. Does not end an already-accepted call; use `end`. |
| `end` | Session ID, bound client ID | Ends call and releases editing, retains draft and saved runs. Idempotent. |
| `heartbeat` | Session ID, bound client ID | Refreshes only this participant's presence; returns current session. Send every 15 seconds while active. A terminal response must stop media locally. |
| `signal` | Bound client ID, stable message UUID, payload `{kind:'offer'|'answer'|'ice',data:RTCSessionDescriptionInit|RTCIceCandidateInit}` | `{session,signal}`. `signal.payload` is **data only**; `kind` is separate. Duplicate same ID/content returns same row; reusing ID with different content errors. |
| `signals` | Bound client ID, `p_after` global sequence cursor | `{session,signals:[{seq,id,sender_id,kind,payload,created_at}]}`, ordered ascending, at most 100 recipient-only rows. After terminal returns empty signals and `unavailable:true`. |

Realtime subscriptions use existing `public.run_live_sessions` UPDATE/INSERT metadata and new `public.run_live_signals` INSERT rows filtered by `session_id`. RLS exposes a signal only to its intended recipient while that call remains accepted and active. Fetch `signals` after subscription/reconnection to close delivery gaps. Dedupe realtime and polled rows by `id`; advance the cursor only for handled rows. SDP/ICE are transport control messages, not executable instructions. Validate them again before passing into WebRTC. Negotiation glare/ICE buffering is handled in the client.

Session fields:

- `call_status`: `idle` (older draft), `ringing`, `active`, `declined`, `cancelled`, `missed`, `ended`.
- `status`: remains `active` throughout an accepted call and every save; becomes `ended` when call terminates. Legacy non-call saves retain their previous `saved` status behavior.
- `call_mode`, `call_started_at`, `call_ended_at`, `call_end_reason`, `ring_expires_at`.
- `athlete_name`, `coach_name`, `caller_name` are display-name snapshots; `created_by` identifies the caller.
- `athlete_client_id` / `coach_client_id` bind the accepted call devices. Initial caller holds the draft edit lease. Accepting refreshes that lease; it does not silently take editing away.
- `athlete_seen_at` / `coach_seen_at` track independent presence.
- `saved_run_id`, `saved_version`, `saved_run_updated_at` identify the last committed run revision.

Ringing expires after 60 seconds (`missed`, reason `unanswered`). Either participant absent for 90 seconds ends an active call (`connection_timeout`). Checks occur during call actions and draft reads/mutations; `clean-live-run-signaling` cron also checks each minute. The client must stop local tracks on hangup, timeout, sign-out, access revocation or navigation as appropriate; server state cannot switch off a device microphone.

## Event / course and saving

The existing course model has **one image per event**, keyed by `event_course_photos.event_id`. There is no independent course ID. Shared draft fields stay `contestItemId`, `imageDataUrl`, `venue`, `points`, `view`, `title`, `notes`, `planType`, plus `courseSource:'event'|'upload'`.

Use the active shared event catalogue (`dashboard_items.item_type='event'`). A task, completed event or expired event is rejected. An accepted new call can begin blank, but Save requires an available event, title, photo and at least start/finish dots. `courseSource:'event'` requires the exact current shared event image. Uploading a different photo switches the source to `upload`; the selected event remains. Adjusting the existing photo viewport preserves its course source. This avoids silently identifying another picture as the event's course.

The existing `live_run_action` still handles `get`, `claim`, `release`, `heartbeat`, `patch`, `save`, `end`. Send its current `p_version` and bound editor client UUID. Existing 45-second exclusive edit leases, 300ms client flush, handover and stale-revision protection remain. Local unsent work must be retained by the client on lease/network conflicts, never blindly overwritten with fetched data.

For new accepted calls either authorized current editor can Save. The first save creates a private run owned by the session athlete and linked coach, with the actual saving actor in `created_by`. Further saves update that **same run**, do not duplicate it, and keep the call/edit lease active. Unchanged-version save retries return the same saved run. Outside edits to the saved run are checked through `updated_at` and cannot be overwritten by a stale call draft. The source is recorded in `run_plans.course_source`; course image/route/view are saved as a snapshot. Save never ends the training session or call and never awards scoring points.

## Media infrastructure and verification

No media recording, audio or video blobs are stored in Postgres. Signals expire after 10 minutes, become unreadable immediately on terminal call, and are physically deleted by a private minute cron. No anonymous/direct writes to session/signaling tables are granted. The public API is an invoker wrapper over explicit-auth private functions; no service role is sent to a client.

STUN may connect some peer networks, but reliable calls across mobile networks/firewalls require TURN. This repository had no configured TURN service at implementation. Production still needs the operator's TURN URL and server-side REST/HMAC secret for short-lived, authenticated credentials; do not put permanent TURN credentials in static app assets. The application should disclose a missing relay instead of claiming guaranteed connectivity. The credential Edge Function and media client are included; this migration provisions no paid service.

Database regression: `tests/live-run-calls.cjs` uses synthetic independent actor identities in isolated PGlite, tests lifetime/privacy/device binding/malformed signals/busy reservation, leased conflicting edits, event/photo matching, continuous idempotent saves, outside-edit conflicts, disabled/revoked access, cleanup and older draft compatibility. `tests/live-run-calls-concurrency.cjs` additionally passed on PostgreSQL 17.11 using 13 independent connections and explicit overlapping transactions. It verifies crossed starts, repeated start IDs, simultaneous saves, equal-version edit conflicts, lease claim contention and a hangup/save race. Neither database suite proves cross-network WebRTC connectivity; two browser contexts and a real TURN test are separate media checks.

Read-only preflight confirmed production's existing `private.live_run_action` matched the prior invitation migration, `event_course_photos` and feature access tables existed, and pg_cron 1.6.4 was installed. No production mutations are performed by the test.

## ICE Edge Function setup

Deploy `supabase/functions/live-run-ice/index.ts`. The function authenticates the bearer token using Supabase Auth `/user`, then checks the accepted call and bound device through the same authenticated RPC. Its gateway `verify_jwt` is false because authentication is performed in the function for both legacy and newer signing keys. Anonymous, expired, unrelated, unaccepted and wrong-device requests receive no credentials.

With no relay configured it returns a STUN server and `relayConfigured:false`. To enable a TURN REST-compatible relay, set these **Supabase Edge Function secrets** using your provider's actual settings:

- `TURN_URLS`: comma-separated TURN/TURNS URLs; include a TCP/TLS endpoint for restrictive networks.
- `TURN_SHARED_SECRET`: the TURN REST/HMAC shared secret from that relay.

Credentials expire after one hour and are issued only for an accepted private call; the shared secret never reaches the browser. Do not put these values in app.js, git, screenshots or client configuration. A provider/account is not provisioned by this change. Check the relay's credential format matches TURN REST HMAC-SHA1, then verify one phone on mobile data against another participant on Wi-Fi. The current local browser verification proves native audio/video, signaling, editing and saving, but does not substitute for that cross-network relay check.

`tests/live-run-ice.cjs` executes the actual TypeScript handler after Node's type stripping and verifies identity/call/recipient restrictions, no-store responses, direct fallback and the HMAC credential signature. `tests/live-run-call-webrtc.cjs` uses separate Chrome sessions with native WebRTC and synthetic camera/audio; `tests/live-runs-ui.cjs` combines the actual HD builder with those native media connections. No test logs into or alters real rider accounts.

### Compact course-photo transport

The optional `live_run_edit_compact` and `live_run_action_compact` RPCs delegate
all authorization, device binding, operation receipts, conflict detection and
saving to the existing RPCs. They add `image_key` (SHA-256 of `imageDataUrl`) and
`image_omitted`. A client sends `p_image_key` only for the photo in its current
live-session cache; matching responses omit the photo, and changed/unknown keys
return it in full. The browser hydrates the draft from the cache captured for
that specific request before passing it to the unchanged merge logic. Closing
the live session discards the cache. Old installed clients retain full responses.
If the compact endpoint is not yet deployed, the browser falls back only on an
explicit missing-function response, never on a timeout or failed mutation.

Connected visible builders use Realtime invalidation with a five-second fallback
metadata poll; disconnected subscriptions use two seconds. Hidden builders skip
metadata polling and refresh when visible. Media signaling and call heartbeats
continue separately so this does not end an active call.

Regression checks: `tests/live-run-compact-client.cjs`,
`tests/live-run-compact-payload.cjs`, `tests/live-runs-ui.cjs`, and
`JKCREW_LIVE_COMPACT=1 node tests/live-run-shared-edits-concurrency.cjs`.
The two SQL tests use `tests/helpers/local-postgres.cjs`: provide
`JKCREW_PG_BIN` and `JKCREW_PG_SOCKET` for a disposable local PostgreSQL server;
the harness refuses non-`/tmp` sockets and creates/drops only its own test database.
