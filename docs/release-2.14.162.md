# JKCREW 2.14.162 — Find the crew in world rankings

UCI Men's and Women's leaderboards now highlight linked JKC riders with a teal
row accent and the existing JKC logo beside their official name. Highlights
survive searching and pagination without changing the published rank order.

JKC Weekly and All-Time leaderboards replace the XP badge artwork with a compact
UCI world rank and Men/Women category when a current ranking is available. Riders
without a matching ranking have no placeholder rank. JKC scores, ranking order,
profile navigation and earned achievements are unchanged.

Identity comes from the saved UCI ID, never a name guess. A new authenticated,
display-only RPC returns athlete ID/UCI ID pairs using the existing leaderboard
visibility rules, including Ghost Mode. It rejects anonymous, missing and
disabled accounts. No profile or scoring records are changed. The current seven
links serialize to 567 bytes, cached for 60 seconds within the signed-in session.
The existing public ranking cache and scheduled updates are reused.

JKC scores render before optional UCI requests finish. Ranking chips update in
place so expanded rows and chat drafts remain intact. Missing feeds or metadata
offer retry feedback; stale snapshots retain their publication date and warning.
Link changes invalidate pending requests as well as cached data, and removing
the last link clears its displayed rank. Concurrent refreshes share one request.

## Verification

- Exact-ID identity, nickname, duplicate/ambiguous ID, missing ranking, hidden
  rider, Men/Women, search, pagination and unchanged points regression checks.
- Async failures, retries, unlinking, expired cache, forced refresh races,
  account/session changes and preservation of expanded rows/chat drafts.
- Dark/light layouts at 320, 390, 768 and 1440 pixels, including long names,
  country flags, avatars and the actual JKC logo.
- Full-app Home/Board navigation, profile linking, public ranking cache,
  service-worker update, release smoke and root/Riley mirrors.
- Fifteen rollback-only database checks for rider/coach/parent visibility,
  Ghost Mode, anonymous/missing identity and disabled-account denial. Existing
  security-advisor findings unchanged; existing scoring RPC untouched.

No new polling, recurring costs or external setup required.
