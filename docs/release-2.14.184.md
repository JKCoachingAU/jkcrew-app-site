# JKCREW 2.14.184 — Points-only progression and private health summary

Levels, XP, Prestige and earned achievement badges are removed from active
rider, coach, parent and public views, including Today’s Progress, leaderboards,
profiles and exports. Normal trick, Daily, challenge, battle, park and UCI points
remain. Unread notification indicators and park crowns remain. The retired
Prestige artwork is no longer downloaded as part of the app shell.

New XP and badge awarding is paused server-side behind a private reversible
setting. Old client writes cannot change historical XP or badges while paused;
legitimate account and assignment foreign-key cleanup still works. Existing
records are preserved for a possible future return. New achievement-only
messages are suppressed without suppressing battle, challenge or park alerts.

The former home XP card now hosts a private wearable health summary. WHOOP is
the first implemented provider: sleep, resting heart rate, HRV, WHOOP recovery
and strain with units, source dates and a last-sync time. Missing values stay
unknown, and a zero remains a real zero. Distinct restrained colours, light and
dark themes, 44px controls and mobile layouts keep the card compact.

The WHOOP backend and UI are deployed but **not activated**. The owner does not
have a WHOOP account/developer app yet. No account, membership, subscription,
provider credentials or real rider health connection was created. The UI says
that setup is incomplete, offers no false Connect action and shows no invented
health readings. Apple Health and Garmin explain their setup requirements;
there is no live Apple Health or Garmin sync in this release.

WHOOP activation requires a developer app, exact registered callback, client
credentials, encryption key and a consenting test rider. Setup instructions are
in `supabase/functions/health-whoop/README.md`. No costs have been accepted.

Health data is private to its rider. Coach and parent links grant no health
access. Tokens are encrypted server-side, OAuth uses expiring hashed state and
a separate authenticated completion ticket, and refresh-token rotation is
serialised. Browser memory is cleared on account changes/navigation; readings
are not stored in browser storage or service-worker caches. Refresh is bounded
and limited to once per 15 minutes across devices, with no background polling.
Disconnect removes stored readings and tokens and reports any unconfirmed
provider revocation rather than claiming it succeeded.

Verification:

- 58 database scoring/pause checks, including all Daily bonuses, retry safety,
  unchanged XP history, legacy client guards and reversible re-enabling.
- 77 UI retirement checks plus responsive layouts at 320/390/768/1280px.
- 25 private WHOOP database/Edge Function checks using disposable PostgreSQL,
  the actual handler and synthetic Auth/provider transport.
- Browser health checks for setup, consent redirect allowlist, callback tickets,
  cancellation, duplicate taps, null/zero readings, stale dates, offline failures,
  disconnect warnings, account isolation and light/dark layouts.
- 105 full-page Home checks; parent leaderboards (207), profile goals (57),
  recovery integration (63), full recovery page (50) and access boundaries.
- Installed-app update checks and release smoke.
- Production before/after checksums match for 11 datasets: profiles' progression,
  XP/badges, trick awards, adjustments, sessions, attempts, challenges, battles,
  battle participants and UCI records. No historical score or progress changed.
- Live health endpoint returns 401 unsigned and 403 for a foreign origin;
  database confirms no direct rider/anonymous grants and zero health connections.

Real WHOOP OAuth, device sync and provider approval remain unverified until
credentials and a consenting device are available. Native Apple Health and an
approved Garmin business integration remain separate prerequisites. Existing
unrelated database advisories predate this release; new private-table
no-policy notices are intentional deny-by-default access boundaries.
