# JKCREW 2.14.155 — Clear weekly-list completion

The rider Session stat previously labelled “Sheets completed” now reads
“Weekly lists”, with “Dailies excluded” underneath. The existing calculation
already excludes Daily assignments from both the completed count and the total;
this release makes that scope visible. Weekly score, Daily point awards and
world ranking are unchanged. There are no database or scoring changes.

Verification:
- 58 regression checks across the root and Riley bundles confirm Daily rows,
  awards, multiple venues, date resets and pending Daily updates cannot affect
  weekly-list completion. Existing weekly categories and percentage-attempt
  completion rules are preserved, with no input mutation.
- Actual stat markup and styles checked in an isolated browser at 320, 390,
  768 and 1440 pixels: readable labels, no clipped text or overflow, unchanged
  score/rank, and no JavaScript errors. Physical-device testing remains pending.
- Release smoke, JavaScript parsing and diff checks passed.
- All 50 installed-app update checks passed with synthetic local assets.
- Root and Riley releases use 2.14.155, retaining separate cache namespaces.
