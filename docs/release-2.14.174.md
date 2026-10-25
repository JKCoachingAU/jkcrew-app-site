# JKCREW 2.14.174 — Parent Road to LA28

Linked parents now have a Home card and LA28 navigation tab. The card and tracker
use the selected child's UCI ID, including the official men's/women's ranking,
points total and publication date. Parents can view upcoming crew events, saved
entry status/notes, the official points breakdown, recorded results and the
verified UCI schedule. Families with multiple children can switch children using
the existing selector. Children without a ranking still have event-planning access;
the existing positive-points rule for the rider's own LA28 tab is unchanged.

Parent access is read-only. Separate tracker and schedule RPCs check the current
parent role, current child links and recovery/feature restrictions on every request.
No parent record writes, verification actions, event imports or coach notification
subscription changes are permitted. Existing rider/coach permissions and private
run-plan boundaries are preserved. Private tracker records stay in memory. Late
responses cannot replace the current child/page/account; access denial clears the
tracker. Home ranking fetches reuse the existing public feed cache.

Verification:
- 69 parent app integration checks: selected-child identity, Home/tab routing,
  official source links, retry states and delayed child/account responses.
- 64 parent tracker and 85 parent schedule browser checks, including forged controls,
  response permission flags, revocation, empty/loading/retry states and mobile themes.
- 27 tracker and 25 schedule database checks, including cross-child isolation,
  current/unlinked/restricted parents, read-only transactions and denied writes.
- Existing rider/coach regression suites: 248 tracker UI, 208 schedule UI,
  125 rider-navigation, 76 UCI Home/profile, 29 tracker routing and 66 schedule
  routing checks passed.
- Parent layouts checked at 320/390/430/768px, tracker/schedule at 1440px too,
  dark/light themes, seven navigation targets at least 44px wide.
- Release smoke and 50 installed-app/service-worker lifecycle checks passed.
- Deployed additive parent RPC migration. Read-only production checks verified
  Ali's and Koby's actual parent links, scoped tracker responses and official
  schedule access. Koby's parent was denied Ali's tracker and record writes.
- No new-function security advisor findings. Existing unrelated advisor warnings
  were not changed by this release. No production rider records changed for testing.

Root/Riley assets, manifest and service-worker versions are aligned. No new service
or recurring cost is required. Physical parent-device/iOS Safari testing remains.
