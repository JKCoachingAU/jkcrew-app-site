# JKCREW 2.14.178 — Collapsible official points breakdown

The Road to LA28 points ledger now shows Official points breakdown as a compact,
closed dropdown. Tap its header or use the keyboard to reveal the official event
results, source, snapshot status and refresh control. Total UCI points remain
visible above it. The open/closed choice survives refreshes and tab changes for
each rider during the current tracker visit.

The shared presentation applies to coach, rider and parent views. Ranking data,
recorded results and permissions are unchanged; there is no database migration.

Verified: 252 existing tracker UI checks and 65 parent UI checks, including
closed initial state, keyboard opening and the visible total. Dark/light phone,
tablet and desktop layouts passed; closed/open screenshots were reviewed.
Release smoke and 50 service-worker/update checks passed. Root and Riley assets
match with their established separate worker cache names.
