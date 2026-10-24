# JKCREW 2.14.167 — Compact Road to LA28

Olympic qualification is now a collapsed dropdown with a full-width touch target
and native keyboard support. Opening it shows the existing guidance and official
schedule link. Its open state survives tracker refreshes and tab changes.

Removed the duplicate Official UCI snapshot card from Road to LA28. Riders’
Home UCI ranking cards remain. The Points ledger retains official event results,
source dates and counted/excluded labels; its refresh/retry control now sits with
the breakdown. Removed copy referring to the deleted total above.

No database or account changes. Both production and Riley assets are mirrored,
with separate service-worker cache namespaces and release 2.14.167.

Validation: tracker browser checks cover dropdown pointer/keyboard operation,
removed snapshot, role access, saves/retries and feed errors. Responsive dark/light
layouts checked from 320 to 1440px. Home ranking, tracker integration, release
smoke and installed-app update checks also run before publishing.
