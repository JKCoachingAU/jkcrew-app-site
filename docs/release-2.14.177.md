# JKCREW 2.14.177 — Parents can follow their child's battles

Parent Home now shows active battles for the selected linked child, with both
teams, authoritative live scores, time remaining and a clear child highlight.
The compact empty state explains when no battle is active. Prize points are
separate from live scores; this view has no battle management or reward actions.

The existing spectator renderer is shared with riders. Parents use the new
`get_parent_active_rider_battles` RPC, which checks the current parent role,
parent-child link and account restrictions on every request. It returns only
accepted, started, nonexpired battles involving the selected child. Unrelated
ghost identities are redacted. The migration changes no records or table access.

Scores refresh every 20 seconds while visible and online using one bounded
summary request. Rapid refresh taps coalesce. Child/account/view changes abort
the old controller and reject late responses. Network failures preserve the
last available scores with a retry state; permission failures clear them. A
failed background Home reload keeps the current child's mounted feed working.

Verified:
- 91 parent battle browser checks, including child scope, 1v1/2v1/multiple
  teams, live totals, expiry, retry, offline recovery and lifecycle cleanup.
- 12 database regression groups covering authorization, redaction, pagination,
  canonical scoring, all supported team sizes and read-only operation.
- Existing rider Active Battles UI suite, 207 Parent Home leaderboard checks
  and 69 parent LA28 integration checks; 11 battle reward isolation regressions.
- Dark/light layouts at 320, 390, 430, 768 and 1440px, reduced motion and mobile
  screenshot review; release smoke and 50 installed-app update checks.
- Deployed RPC returned Koby's current battle through his linked parent in a
  read-only transaction, without settling or awarding anything.
- Ali's linked parent received the same active battle summary as the rider
  spectator feed; unlinked Lars, anonymous and non-parent requests were denied.
  Deployed grants and advisors showed no findings for the new functions.

Both app entry points ship matching assets with their separate worker cache
namespaces. No new service, notification or recurring cost is required.
Browser journey tests use synthetic families; physical parent-phone testing
remains.
