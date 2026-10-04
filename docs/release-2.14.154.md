# JKCREW 2.14.154 — Previous-week landing ticks

Coach Session Viewer lists now show a small green tick beside tricks with a
recorded landing in the rider's previous training week. A compact legend explains
it. This is separate from the current completion control and never awards points.
Daily, One Bangs, Dialled, Percentage, Bonus and complete Lines use the same hint.

The existing private landing history survives sheet replacement. Reads are limited
to the opened rider and previous Sunday-to-Sunday sheet week, with the rider's
country timezone and explicit Daily dates respected. Only positive, non-revoked
landing evidence qualifies; foam practice and missed attempts do not. Matching
uses the full trick name (case/space normalized), and the full sequence for Lines.
The marker means landed at least once, not a completed percentage test or streak.

Queries are paginated, deduplicated and cached for five minutes by coach, rider,
country and week. Manual Refresh clears this cache. Old page/account responses
cannot repaint a different rider. A bounded request timeout and inline Retry keep
the current list usable if historical data cannot load. There are no schema,
permission or scoring changes.

Verification:
- Evidence tests: rider-local Sunday and DST boundaries, explicit Daily dates,
  revoked/zero evidence, successful percentage reps, foam exclusion, exact Lines,
  805-row pagination, cache expiry, retries and overlapping account switches.
- 48 isolated browser checks at 320/390/1440px, including real list renderers and
  both Session Viewer mount paths, accessible ticks, unchanged completion actions,
  stale responses and retry. No production browser writes or test landings.
- Session Viewer counters/setup, complete numbered Lines, Tricktionary history, JavaScript
  parsing, release smoke and all 50 installed-app update checks passed.
- Production history schema/RLS checked read-only; linked-coach SELECT already
  exists, and the REST API denies anonymous reads. Existing history rows confirmed
  without modifying rider progress.
- Root and Riley releases share assets, with separate installed-app cache namespaces.

Older isolated test fixtures were brought in line with existing feature mounts
and connected-form guards; a stale assertion now reflects the already-supported
partial Daily finish, with empty-list protection checked separately. Physical iPhone testing remains outstanding.
