# Release 2.14.145 — performance and reliability audit

Preserves the existing accounts, progress, scores, permissions and JKCREW branding. No rider data was changed during verification.

## Confirmed problems and fixes

- Live-run acknowledgements and refreshes returned the full course photo on ordinary text/point edits. New opt-in RPC wrappers use a SHA-256 photo identity to omit unchanged photos. The client restores only an exact matching cached photo; changed photos, joining participants and old clients retain full-image behavior. Existing authorization, transactional merges, receipts and save logic run unchanged. Realtime remains immediate; idle metadata fallback polling slows to five seconds and pauses while hidden/offline.
- Parent/coach help lists selected all columns and hydrated media automatically. Lists now request only metadata, in pages of 200, with short account/rider-scoped caching and coalescing. Six history entries show initially, with older reviews available on demand. The existing private viewer retrieves only the chosen review's hosted or legacy embedded clips. Closing/navigating releases media.
- Battle refreshes could reload full profiles/avatars and training history every 20 seconds. Live score updates now use a lightweight roster cached for 60 seconds, with realtime/manual invalidation and no offline polling. Full rider details load when needed to create a battle.
- Auth forms allowed duplicate requests and replaced the user's entries after errors; reset and password-change requests could be automatically retried. Requests now have explicit pending guards, inline feedback and bounded waits. Detached results cannot replace newer screens, token refresh preserves recovery input, and local logout cleans only this project's credentials while keeping drafts. Mobile login keeps the brand, brings the form above the fold, and improves keyboard hints and touch targets.
- A successful video save followed by a failed screen refresh deleted its committed upload. Saving and rendering are now separate outcomes, with repeat-tap protection and draft retention on failure. Stable request IDs and saved-record checks now recover lost responses without duplicate uploads. Coach retries keep their original revision and cannot overwrite intervening feedback. Both corruption cases were reproduced against the original handlers.
- Garage code/styles downloaded on every sign-in and service-worker installation. Ten assets now load on first opening, in dependency order, and cache for later use. Abortable downloads allow retry without executing a late script twice. Navigating away during loading cannot paint over the current page.
- Installed-app upgrades could reload active forms/calls, and old workers could cache a newer HTML document prematurely. Updates now wait for the user when work is active, only cache HTML from their own release, and retain one prior public asset cache for deferred pages. Private API/account responses are never cached.

## Measurements

Controlled regression fixtures, not billing estimates:

| Path | Before | After |
| --- | ---: | ---: |
| Live-edit response with unchanged 1 MiB photo | 1,050,246 bytes | 1,730 bytes (99.84% smaller) |
| Metadata for 405 reviews containing embedded clips | 177,110,372 bytes | 129,694 bytes (99.93% smaller) |
| Twelve-rider roster across three battle polls | 12 queries / 1,340,244 bytes | 3 queries / 2,459 bytes; score queries unchanged |
| Idle connected live session over 60 seconds | 50 metadata polls | 12; zero hidden-tab polls |
| Initial optional Garage downloads | 10 requests / 226,696 uncompressed bytes | Deferred until the Garage opens |

A read-only production aggregate found 15 reviews, four containing **87,326,704 bytes** of embedded video. The new list projection excludes those fields; this is not a claim that every page previously downloaded all four reviews.

## Verification

- Actual bundled Supabase SDK with isolated network fixtures: rider/parent/coach sign-in, reload/session persistence, valid and revoked expired refresh tokens, recovery/token refresh, logout and backend failure. Auth suites passed 191 checks. Login layouts checked at 320, 375, 390 and 768px; real-asset mobile screenshot reviewed.
- Local real PostgreSQL 17: compact RPC permissions, legacy compatibility, photo change/retry and save behavior; 58 checks. Concurrent live edits/saves: 25 independent connections with 12 verified lock overlaps. Tested underlying live-run functions match deployed definitions exactly.
- Two separate browser sessions with real WebRTC and synthetic cameras/microphones: ringing/acceptance, simultaneous edits, conflict and lost-response retries, course changes, shared save and remaining on the call. No real rider calls or profile writes.
- Help traffic/upload (including 66 lost-response, conflict and draft checks) and parent/coach video-viewer tests, including legacy media, preserved reply drafts, failed requests and cleanup. Battle refresh and coach challenge screens checked on mobile/desktop and light/dark themes.
- Daily/Tier 2/Other Things Landed browser suites passed: 33 integration, 61 team-session, 35 Tier 2 and 45 extras and 72 coach-queue checks. Covers reduced motion, reveal/progress recovery, mobile layouts, review controls and retry/draft preservation.
- Daily scoring/reset verification on disposable PostgreSQL: 66 assertions across eight Tier 2 concurrency races (17 independent connections), extra-landing submission/review races (11 connections), and 17 country-local date/history/permission checks. A fixture saved-date shift simulates rollover; no real midnight/device claim.
- Real local browser worker install/upgrade tests (50 checks): first installation preserves login fields; active input defers upgrade; explicit update reloads once; same-body registrations do not reload; previous-version Garage code/engine/photos remain available during a deferred offline upgrade; public offline cache coverage remains separate from private requests. Earlier installed clients keep their previous upgrade behavior until this release loads.
- Local root/Riley entry points load with real assets and no application exceptions or missing assets. Garage download failure/stall/retry/navigation checks and Shred Zone navigation passed. Syntax, whitespace and release smoke checks passed.

## Backend/release

Additive migration `20260921062609_compact_live_run_course_payloads.sql` applied successfully. Read-back confirms all new wrappers are SECURITY INVOKER, anonymous execution is denied, and authenticated calls retain existing participant checks. Original functions remain available for installed older clients. No tables, score rules or RLS policies were changed.

Production auth health, auth settings and a zero-row public database probe returned HTTP 200 on 21 September 2026. The project is ACTIVE_HEALTHY; no active HTTP 402 quota restriction was observed. This does not verify invoice/payment status or remaining billing allowances, which are not exposed by those checks.

Versioned entry points, manifests, root/Riley mirrors and service-worker assets use 2.14.145. Publish through the established `main` → GitHub Pages workflow, then compare deployed file hashes and smoke-test both mobile sign-in routes.

## Remaining real-device/service checks

Physical iOS keyboard/autofill and installed-PWA behavior, actual reset-email delivery, cellular/background camera behavior and calls across restrictive networks need real-device testing. TURN connectivity across restrictive networks was not exercised; this audit adds no paid service or recurring cost. Benchmarks above use controlled fixtures and do not establish real-device FPS, global load times or a bill reduction.
