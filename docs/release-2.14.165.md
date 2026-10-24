# JKCREW 2.14.165 — Coach UCI rider leaderboard

Coach Command now shows a UCI rider leaderboard immediately below Upcoming
Events. It includes every linked rider with positive UCI points, grouped into
Men and Women and sorted by official world rank within each category. Rows
show the rider's familiar app name, nation, official rank and points; tapping
one opens that rider in the corresponding full UCI leaderboard. Each category
has its ranking date and official source.

The panel reuses the authorized dashboard roster, adding only its `uci_id`
field, and the existing cached public ranking loader. It introduces no new
database requests, polling, permissions changes, or scoring changes. Exact UCI
identities are required; ambiguous or unmatched links never receive invented
rankings. Empty, loading, stale and retry states remain usable, and a failed
refresh preserves previously loaded ranks. Account, navigation and render
guards prevent late responses changing another screen.

Production verification matched the nine previously linked riders to the feed
checked on 23 October 2026. Checking the remaining roster found two exact full
name matches without saved UCI links: Logan Martin and Luis Rincon Reyes.
Their verified UCI IDs were saved only where the existing link was empty and
the rider was still linked to this coach; no duplicate identity was allowed.
The result is eleven riders: eight men and three women, including Kim, Lara
and Ali. Both official category rankings are dated 20 October 2026.

## Verification

- New browser coverage (290 checks) exercises both categories, all rows without a top-five
  limit, exact and ambiguous identities, positive points, escaping, source
  links, deep links, errors/retries, rapid taps and late responses.
- Responsive dark/light layouts checked at 320, 390, 768 and 1440 pixels;
  light-theme contrast corrected after visual inspection.
- Existing UCI leaderboard (133 checks), rider Home/profile (63), cached feed,
  coach startup, dashboard traffic, installed-app update (50), release smoke,
  JavaScript parsing and whitespace checks pass.
- Browser tests use isolated fixture accounts. No production progress was
  modified. Actual installed-phone confirmation is still a real-device check.

Root and Riley releases share version 2.14.165 and retain their separate
service-worker cache namespaces. The panel uses the already-running UCI
ranking refresh; no new service, recurring cost or configuration is required.
