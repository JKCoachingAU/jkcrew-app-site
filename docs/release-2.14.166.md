# JKCREW 2.14.166 — Road to LA28

The new private tracker is reachable from Coach Tools, the coach UCI leaderboard,
Events & Runs, and each linked rider’s Home UCI card. It brings together official
UCI event points, saved event-entry preparation, coach-reviewed result records,
and a coach Needs attention list.

## Official points

The existing ranking refresh now reads UCI’s public IndividualEventRankings
source for the 11 verified identities in `data/uci-tracked-riders.json`. The first
snapshot contains 84 event results, checked 25 October 2026 Brisbane, against the
20 October official ranking publication. Every counted sum reconciles exactly
with its rider’s published total. UCI’s explicit outside-best-results flag is
shown as such; it is never called disqualification, expiry or Olympic credit.
Source links and publication dates stay attached to the figures.

The feed is 72,348 bytes (under the existing 900 KB publishing limit). Existing
scheduled ranking checks include the new breakdown automatically, with at most
11 additional bounded rider requests, not a request from each user’s device.
A failed individual fetch preserves valid older evidence marked stale. Unknown
or ambiguous IDs never receive guessed results. Newly linked riders require
adding their verified UCI ID to the bounded importer configuration; the app
shows unavailable breakdowns honestly until that happens.

## Private preparation and records

Entry stages are Planning, Entry submitted, Entry confirmed, and Not going /
withdrawn. Licence, category and federation checks are separately recorded.
Optional organiser deadlines include an IANA time zone and evidence URL; the
server rejects non-existent DST times and requires an offset for repeated times.
Saving a plan does not register anyone with an organiser. Withdrawn and finished
entries stop generating irrelevant action items.

Riders may submit event results with unknown points left blank. Only an assigned
coach can verify a result, with known points and an evidence URL. Manual records
remain separate from the published UCI total and never alter JKC scores. Private
history records reviewer, versions and save receipts. Conflicting edits retain
the draft for comparison; identical retries cannot create duplicates or overwrite
newer changes. Calendar deletion does not destroy saved tracker history.

Migration `20261024232140_uci_rider_tracker` is deployed. Production read-only
role checks verified assigned coach and own-rider access; no real entry/result
records were created for tests. Existing account, recovery, scoring and calendar
features remain unchanged.

## Verification

- 19 actual-migration PostgreSQL/PGlite regression groups: permission and recovery
  gates, exact category identity, null/zero points, retry receipts, version
  conflicts, DST validation, review evidence, withdrawn plans and retained history.
- 171 browser checks cover both roles, offline retries, newer concurrent saves,
  unknown-outcome responses, validation, private-data cleanup and dirty forms.
- 24 app integration checks cover navigation, account changes, parent/disabled/
  recovery restrictions and preserving edits before an installed-app update.
- Responsive dark/light views and editors checked at 320, 390, 768 and 1440px.
- Existing UCI, Home, Coach Command, recovery, release smoke and installed-app
  update checks run alongside the new feature checks.

Actual installed-phone interaction and simultaneous saves from two physical
devices remain real-device checks. Database versions/locks and simulated racing
browser responses were tested; PGlite’s queued calls are not a multi-connection
load test.

Olympic qualification calculations are deliberately not inferred from ordinary
UCI points. The official UCI 19 October announcement still says revised rules
will follow in November. The existing official schedule provides the latest
reviewed guidance. This release adds no automatic registration, new deadline push
service or guaranteed Olympic eligibility. The earlier schedule-document semantic
review automation limitation remains documented in `uci-2027-schedule.md`.
