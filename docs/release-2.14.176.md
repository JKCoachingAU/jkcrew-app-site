# JKCREW 2.14.176 — Parent Home leaderboards

Parent Home now includes the existing JKC Weekly, JKC All-Time, UCI Men and
UCI Women leaderboards below Upcoming Events. The selected linked child is
highlighted in JKC standings. Exact UCI identities mark visible JKC riders in
the official rankings, with the existing ranking dates, sources and stale-data
messages. Search, bounded UCI lists and View Full Leaderboard keep Home usable
on small screens.

The shared leaderboard renderer supports a read-only Home mount. Parent rows
have no public-profile or points-receipt actions; existing parent permissions,
ghost restrictions and linked-child access remain unchanged. No chat is loaded.
Switching tabs reuses the Home JKC scores and existing UCI cache. Async responses
are guarded against child, account, session and navigation changes.

Parent Home now requests actual JKC scores without the older zero-score fallback.
If loading fails, the Home score is unavailable and JKC tabs offer retry; the
family dashboard and UCI tabs stay usable. Verified loads have a separate cache
and in-flight key so they cannot join a request that returns fallback standings.

Verified:
- 207 parent Home browser checks, including all four tabs, scores/order, exact
  UCI highlights, read-only controls, failures/retries and stale responses.
- Dark/light layouts at 320, 390, 430, 768 and 1440px, long names, no horizontal
  overflow and 44px tab targets. Mobile screenshots visually inspected.
- 18 actual loader checks for strict errors, retry, cache and concurrent loads.
- 133 existing leaderboard UI, 47 UCI link cache and 69 parent LA28 integration
  checks; release smoke and 50 installed-app/service-worker lifecycle checks.
- Read-only backend review confirmed parent UCI links and private profile scope.

No database migration, account change or new service is required. Both app entry
points ship identical assets and use the established update prompt. Browser tests
used synthetic families; physical parent-phone testing remains.
