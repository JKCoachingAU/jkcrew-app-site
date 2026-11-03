# JKCREW 2.14.188 — Coach Session Tracker

Coach Tools now has a Session Tracker tab and hub card. Coaches can save dated
sessions with an optional local start time, a location and selected riders.
Location and rider filters narrow a month of sessions. Each session is a compact
expandable row with its riders and an Edit action. The rider picker supports
search and multiple selections, and a small + beside Location adds a venue to
the existing shared coach location list.

Records are private to the owning coach/admin and only linked athletes can be
added. Previously linked rider IDs can remain on existing records so history is
not lost. This is a separate planning/logging feature: it does not start live
timers, infer attendance, alter points, or create messages/notifications.

Saves use stable UUIDs for retry safety and optimistic timestamps to avoid
silently replacing newer edits. Failed saves retain the entered values; saving
cannot discard a typed-but-not-yet-added location. Removing a session archives
it, with an immediate Undo action. Archive/restore are also retry-safe. Drafts
are protected during navigation, closing a tab, and installed-app updates.

Reads are month-scoped and server-filtered, with 30 sessions per page. Roster
reads include only IDs and names, and locations/roster are cached within the
screen until explicit refresh. There is no background polling, image download,
local storage of private data, or live-session history duplication.

Verification:

- 101 real-SQL checks in isolated PGlite: RLS, role/owner spoofing, linked-rider
  validation, stable retries, stale versions, archive/undo, venue deduplication,
  bounded filtering, and unchanged scoring/timers/attendance.
- 58 actual app-adapter checks: scoped minimal queries, pagination, refreshed
  context races, coach-country dates, stale accounts and lifecycle guards.
- 125 browser checks: create/edit/reopen, rejected and lost responses, duplicate
  taps, new-location Enter and premature Save, keyboard rider search, filters,
  pagination, archive/undo recovery, revoked access and late responses.
- Visual checks in actual coach shell at 320/390/1024px, dark/light themes,
  including long names, date fields, scrolling and 44px controls.
- Existing coach startup, 140 Session Viewer location workflow checks,
  Session Viewer setup/counters, release smoke and syntax checks passed.
- 53 installed-app/update checks passed, including preserving tracker drafts.
- Root and Riley test-site assets match (service-worker cache namespace differs).

Database migration add_coach_session_tracker was applied to production and
verified read-only: RLS enabled, no anonymous access, no authenticated delete,
and all three API functions use invoker privileges. No production test records
or existing rider data were changed. Security and performance advisor findings
match the baseline, apart from the expected unused-index INFO for the new,
empty tracker table. New module assets are included in the installed-app shell.

Browser tests use synthetic transport; database tests use an isolated database.
Physical iPhone/Android keyboard and installed-device checks remain unperformed.
