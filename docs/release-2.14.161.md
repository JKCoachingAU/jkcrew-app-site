# JKCREW 2.14.161 — Personal UCI world ranking

Linked riders now see their official BMX Freestyle Park world ranking on Home,
with UCI points, Men/Women Elite category, rider name and publication date. The
card opens the matching UCI leaderboard filtered to that rider. The existing
homepage crew position is labelled JKC ranking to distinguish the two systems.

The card loads independently of the dashboard and shares the existing public
ranking cache with the Board. Home-to-Board navigation reuses the same snapshot;
unlinked riders make no additional ranking request. Failed refreshes retain the
last available snapshot with a warning; complete failures offer a retry. Late
responses cannot populate a different account or a screen that was replaced.

Rider Profile and the coach's rider profile include an official-name search and
a UCI link control. Only a validated 11-digit UCI ID is saved. Search handles UCI
surname-first ordering and accents; display names are never used to guess a
home ranking. Save failures preserve the selection, repeated taps are blocked,
and the existing profile ownership/coach permissions continue to apply.

The additive `profiles.uci_id` migration is deployed before the new client.
It changes no policies, scores, accounts or existing profile fields. Seven
confirmed Elite Riders were linked. Liangliang remains unlinked as requested.
The existing daily UCI updater continues to pick up weekly publications.

## Verification

- Exact-ID, nickname, Men/Women navigation, missing/ambiguous identity, escaping,
  cache/error/retry, stale-account responses and profile-save regression checks.
- Responsive card and link controls at 320, 390, 768 and 1440 pixels in both
  themes; mobile card visually reviewed.
- Full-app rider startup with a stalled UCI feed keeps Home usable, then resolves
  the ranking and opens the correct Board result with no second public download.
- Existing leaderboard, profile/goals, service-worker update and release smoke
  checks; root/Riley mirrors and JavaScript syntax.
- Seven database permission/constraint checks in a rolled-back transaction:
  own read/write, linked-coach write, other-rider/anonymous denial, malformed-ID
  rejection and nullable unlink. Existing security-advisor findings unchanged.

No recurring service, paid integration or additional background polling added.
