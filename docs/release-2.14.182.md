# JKCREW 2.14.182 — Queen of the Park

Park champion cards now show Queen of the Park for Kebe, Mylee, Ali
(Alirah), Kim Lea Müller, Lara and Romy. The title is stored against each
rider's account, so renaming an account does not change its crown title.
When another rider takes the crown, the label follows the new champion.

Rider and coach Session cards, the coach dashboard, live crown celebrations
and future crown push notifications use the same title. The dashboard section
is called Park Kings & Queens. Loading and unclaimed parks use neutral text.

The migration adds crown-title metadata to the existing park responses and
events. It does not recalculate winners, change scores or announce existing
crowns again. The previously identified Oasis venue/session scoring problem
is separate and is not corrected by this title change.

Verification covers all six configured riders, account renaming, King to Queen
to King changes, future notification text, metadata-only backfill and access
permissions. Browser checks cover rider and coach layouts, dark and light
themes, mobile and desktop, live celebrations and empty/loading states.
Release smoke, JavaScript syntax, existing chat milestone checks and installed
app update tests also pass.

Live database verification confirmed all six Queen titles and authenticated
King/Queen responses. Park-score hashes and crown event/push counts were
unchanged by the migration. The 49 database, 268 browser, 33 chat and 50
installed-app update checks passed.

The separate Oasis scoring issue was subsequently fixed by the
[28 October backend correction](park-crown-scoring-2026-10-28.md), which
isolates park records by venue and riding day while preserving earned points.
