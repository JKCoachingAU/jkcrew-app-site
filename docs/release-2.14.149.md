# JKCREW 2.14.149 — Automatic Tricktionary sorting

Clear obstacle names and context now organise landed tricks into Box, Air, Spine or Hip and their subgroups. Ambiguous names remain in Needs sorting. Tap Sort trick or Change category instead of dragging; existing drag, merge, rename and hide controls remain available. Personal placements, canonical aliases, names, tombstones and landed evidence keep their existing meaning.

Coaches can remember a placement in their crew library. Qualified names keep different obstacles separate, while contradictory names never become a crew rule. Approved names are suggested in manual additions and list editors; multiline editors offer Add to list without replacing typed content. The library starts empty and learns from coach-approved sorting; it does not copy private rider overrides automatically.

Auto-organise previews one rider or the whole linked crew. Only unsorted, unambiguous placements are offered; individual suggestions can be unticked. Writes compare the original location under a row lock, preserving a placement changed elsewhere. Partial failures retain completed rows and permit safe retry.

Manual additions now preserve saved categories, use stable request IDs, block duplicate taps, restore controls on failure and retain input. Account, session, page and selected-rider guards prevent late replies or old edit dialogs from changing another screen.

## Verification

- 11 pure classification suites, including ambiguous contexts, original foam filtering, timestamp tombstones, aliases, existing overrides and unchanged identities/counts.
- 13 PostgreSQL 17 suites, including a reproduction of the original category reset, concurrent retries, authorization, catalog limits, compare-and-set writes and unchanged history/points/XP records.
- 10 manual-save regressions: timeout and uncertain-commit retry, double taps, validation, coach duplicate checks, failed refresh and stale-user/session/rider replies.
- Browser suite exercises actual rider, coach and parent renderers, sorting/teaching, selective crew cleanup, partial retry, input preservation and stale-page races. Dark/light 320/390/1024px layouts inspected; 18 screenshots; no console exceptions/errors.
- Existing Tricktionary history, loading-performance and release smoke checks pass. Service-worker shell caching, offline/version isolation and usable sign-in during CDN failure verified.
- A synthetic local batch of 300 tricks against 2,000 approved entries improved from approximately 4.7 seconds to 46 milliseconds by preparing lookups once per snapshot. This is a local benchmark, not a phone measurement.

## Production and updates

Supabase migration 20260928013458 applied successfully. Read-only coach and rider RPC checks pass; new public wrappers use invoker security, anonymous execution is denied, and direct catalog table access is denied. The security advisor reports an expected no-policy notice for the private RLS-protected catalog: all access is through checked functions. Existing legacy security-definer notices remain unchanged.

Root and Riley entry points, manifests and service-worker caches ship together as 2.14.149. No new service or recurring cost. No rider progress was modified during deployment. Physical installed iOS/Android testing remains a real-device follow-up; automated mobile-browser and cache/update checks passed.
