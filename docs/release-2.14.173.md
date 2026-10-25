# JKCREW 2.14.173 — LA28 tab for riders with UCI points

The rider LA28 tab now appears only when the rider's linked 11-digit UCI ID
uniquely matches a published men's or women's ranking row with more than zero
points. Elite group membership is not a substitute for points. Zero, missing,
invalid and ambiguous identities keep the regular six-tab navigation; eligible
riders get seven evenly spaced tabs. The Home card's LA28 shortcut uses the same rule.

The existing public rankings cache provides the initial state and shared async
refresh. Valid offline snapshots retain eligibility; successful updates with zero
or no matching points remove the tab. No ranking request is made for an unlinked
rider. Feed updates and own-profile UCI link changes update only navigation, without
replacing the current screen or discarding input. Coach/parent/recovery navigation
and existing record access are unchanged.

Verification:
- 125 actual-shell navigation/public-feed checks: identity, both categories,
  non-elite points, zero points, stale/offline/failed data, profile link changes,
  account-switch races, draft preservation and request coalescing.
- Six/seven-tab layouts checked at 320/390/768px in dark/light themes, with 44px
  tap targets, plus desktop and coach/parent/recovery cases.
- Public rankings client tests cover read-only cache inspection and asynchronous
  update signals without extra downloads or recursive events.
- 76 Home/profile checks and 30 tracker routing/access integration checks passed.
- Release smoke and 50 installed-app update lifecycle checks passed.

Root/Riley assets, manifest, cache and asset references are aligned. No private
production data was changed for testing. Physical iPhone/Safari remains a device check.
