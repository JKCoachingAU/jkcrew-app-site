# Simultaneous rider startup and scoring validation

Two consecutive hosted runs used 15 independent HTTPS clients and an isolated coach with 15 synthetic riders. Each run completed 376 requests with **zero HTTP failures**, including every optional board request. Every measured phase reached 15 overlapping requests. These are live Supabase Auth/Data API tests, separate from the browser test using simulated network latency.

| Phase | First run p50 / maximum | Repeat p50 / maximum | Passed each run |
| --- | --- | --- | --- |
| Fresh sign-in to training read-chain ready | 2.352 / 2.477 s | 3.005 / 3.191 s | 15/15 |
| Real refresh-token grant | 0.771 / 0.792 s | 4.951 / 5.009 s | 15/15 |
| Refreshed session training read-chain ready | 3.847 / 7.897 s | 13.746 / 16.724 s | 15/15 |
| Start Daily Tricks | 0.742 / 0.790 s | 0.334 / 0.357 s | 15/15 |
| Land a weekly One Bang, +2 points | 4.074 / 4.202 s | 2.535 / 2.687 s | 15/15 |
| Retry the same completed trick | 0.255 / 0.306 s | 0.245 / 0.316 s | 15/15 |

Startup latency varied during the burst; this does not establish a fixed fast-opening SLA. The repeated training read chain contains sequential profile, access, weekly initialization and sheet requests. Individual requests kept their existing timeouts. No timeout was raised to obtain a pass.

Each synthetic rider had ten current Daily assignments, one weekly One Bang and one initial +2 receipt. Both runs verified a final score of four, exactly two receipts, and exactly one +2 attempt after the repeated landing. Only synthetic accounts were signed in or refreshed. No existing user's credentials or refresh tokens were used. The fixture has limited history; separate full-result comparison covered the existing 35-rider dataset. Shared park Wi-Fi was not simulated.

Machine-readable summaries: [first run](startup-capacity-2026-11-18.json) and [repeat](startup-capacity-repeat-2026-11-18.json). Neither contains identities, credentials, tokens or API secrets.

## Database behavior and regression checks

- The set-based leaderboard returned all 16 columns identically for all 35 existing riders. Full JSON serialization of the 1,120,598-byte result measured 398.7 ms before and 66.9 ms after in the controlled comparison.
- Scoring, progress, award receipts and live leaderboard/crown queries remain immediate and transactional. Auxiliary chat/push snapshots are appended to a private queue and coalesced by the five-second worker after commit.
- Captured job IDs prevent a concurrently appended event from being deleted. Strict helper failures roll back the auxiliary batch, retain jobs and apply bounded retry backoff. Verified same-team source identities remain required for overtake notifications.
- Completed weekly retries return the existing result without another progress/history/attempt write. Missing receipts still take the normal scoring path. Per-assignment locking preserves undo and retry serialization.
- Assignment prechecks retain approval, canonical rider and coach team checks, and existing scoring authorization, without recursively expanding the legacy assignment/profile/parent RLS plan twice.
- Empty notification inserts no longer start Edge claim workers. Actual inserts and eligible recovery requeues still do.

Reproducible PostgreSQL suites passed: leaderboard 16, tenant notifications 93, announcement queue 60, assignment prechecks 33, weekly retry/history 101, empty push batches 22, and worker history retention 21 checks. An additional full-schema rehearsal passed 24 existing behavior checks. Queue tests exercise transaction interleavings in one database session; the hosted HTTP runs provide the actual concurrent-client evidence.

## Cleanup and production verification

- Zero synthetic Auth users, profiles, training lists, point receipts or active announcement jobs remain. The temporary service-only fixture function and its private run table were dropped by the final cleanup migration.
- The original account-creation Edge Function was restored byte-for-byte as version 22, with its original `verify_jwt=false` setting. Source SHA-256: `551052a52bf551f4041347c5dff878a5a919847225ad5999abcaefec01983e8c`. A harmless honeypot request returned the original response with HTTP 200.
- All existing data counts and ordered JSONB hashes match the captured baseline: 1,698 awards, 713 sessions, 24,092 assignments and 4,191 progress rows. The pending Germany coach account remains pending.
- Cleanup used an exact whitelist of 60 known synthetic actor UUIDs. Nineteen recent private orphan milestone dedupe receipts could not be reliably attributed to that whitelist and were deliberately retained. They are not point awards or active notification jobs. No potentially human history was deleted on the basis of time or a missing profile alone.
- The announcement queue is empty, with zero retry/error rows. The last twenty worker runs succeeded. The worker remains active every five seconds.
- Hourly retention removes at most 5,000 completed run-history rows older than seven days, scoped to the new worker and its own pruning job owned by the function owner. Unrelated, recent and running cron history is preserved. Initial production pruning removed zero rows.
- A team foreign-key index was added to the queue. Health advisors report zero findings. The new private queue's deny-all RLS produces the expected informational [no-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy); its new index can appear as informational unused until normal workload uses it. No new warning or error was reported for the changed objects.

No production compute settings, Auth rate limits or global statement timeouts were increased. No coach approval or tenant boundary was relaxed.
