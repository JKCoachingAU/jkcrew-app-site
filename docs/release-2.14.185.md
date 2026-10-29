# JKCREW 2.14.185 — Basic health summary

The rider Home health card now shows only sleep, WHOOP recovery and estimated
calories burned. Three compact columns use lavender, gold and rose accents.
Heart rate, HRV and strain are removed from the displayed and newly saved
summary. Normal trick/UCI points and the reversible XP pause are unchanged.

Calories use the latest scored WHOOP physiological cycle's reported kilojoules
converted to kcal (kJ / 4.184), rounded to a whole calorie. The card identifies
this as a WHOOP cycle estimate rather than food intake, exercise-only calories,
or a calendar-day total. Per-reading source dates remain visible. Missing,
invalid and unscored readings remain unknown; genuine zeroes remain zero.

WHOOP syncing remains unavailable until a developer app and server credentials
are configured. WHOOP's Sandbox permits up to 10 members without a tier approval
request, but app registration and each rider's consent are still required for
these basic readings. The owner has no WHOOP account. No account, subscription,
new permissions or real health connection was created. Apple Health/Garmin
connections remain unavailable as documented in 2.14.184.

Verification:

- 16 Edge Function regressions against the actual migration with synthetic
  WHOOP/Auth transport: conversion, strict numeric validation, source dates,
  three-field persistence, null/zero, consent, access boundaries, cooldown,
  concurrency and disconnect cleanup.
- Browser health regression checks for the three metrics, legacy extra fields,
  malformed/missing/zero readings, errors, consent, account isolation and no
  browser persistence; light/dark layouts at 320/390/768/1280px.
- Independent review of the actual nested Home layout at 320/360/390px with
  larger numbers found no overflow.
- 105 full Home startup/journey checks, 50 installed-app update checks and
  release smoke passed. The first concurrent full Home run exceeded its
  startup timing budget (3827ms vs 3500ms); the isolated rerun passed with a
  longest startup of 1801ms. No timing threshold was relaxed.
- Production Edge Function version 2 deployed; no database schema/data changes.

Real WHOOP consent and device synchronisation remain unverified until setup and
a consenting test device are available.
