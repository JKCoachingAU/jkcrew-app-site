# JKCREW 2.14.148 — Active Battles

Riders can watch the crew’s current battles at the top of Challenges. The section shows all participants, team totals, the leading or tied sides, and time remaining. It supports unequal teams (including 2v1), three sides, forfeits, and existing formats through 6v6v6. Pending invitations, scheduled starts and ended/archived battles are excluded.

## Data and permissions

A bounded, read-only RPC returns competition metadata and canonical battle score allocations. It does not settle battles, award points, expose private training records, or expand table policies. Signed-in eligible riders and coaches/admins may read it; anonymous users, parents and disabled rider accounts cannot. Cards provide no spectator mutation actions.

The browser requests 12 matchups per page, refreshes every 20 seconds while the page is visible and online, coalesces concurrent requests, stops on navigation/logout/access changes, and uses server time to expire finished cards. Requests contain no avatars, videos or course images. Read-only production checks under coach and unrelated rider authorization both returned the current two battles in 1,594 bytes of JSON text (not a wire-compressed measurement).

## Stability and usability

Refresh failures retain the last successful scores with an update-delayed message and retry. Initial failures do not display a false empty state. Invitation drafts survive spectator updates and personal realtime notifications, including opening a draft while a background refresh is already loading. Legacy Challenges read failures leave the existing live feed working. Superseded page and account loads cannot replace a newer screen.

The section uses JKCREW colours, responsive team cards, 44px minimum buttons, readable light-mode colours and reduced-motion support. Refresh text remains inside its button at 320px.

## Verification

- Nine real PostgreSQL 17 regression checks: roles/access, table grants/RLS unchanged, read-only data snapshots, exact metadata keys, filtering, all formats, canonical guest-day allocations/corrections/session deduplication, forfeits and keyset pagination.
- New browser suite: actual module plus Challenges/realtime integration, 320/390/1024px dark/light screenshots, escaping, expiry and device-clock skew, offline/hidden recovery, paging, retry/coalescing, account/access/navigation guards, draft races and failed personal reads. No browser exceptions or console errors.
- Existing battle UI, unequal-battle UI, rematch UI, battle refresh, loading-performance and release smoke suites pass.
- Root and Riley app assets, manifests and service-worker caches are versioned together. Migration version matches Supabase’s applied record: 20260928003552.
- Production coach/rider read-only queries verified two live matchups; anonymous execute permission is false. Security advisor review found no new Active Battles warnings.

Physical installed-app testing on iOS/Android remains a real-device follow-up; browser mobile viewports and service-worker update/caching behaviour were tested. No recurring service or external configuration is required.
