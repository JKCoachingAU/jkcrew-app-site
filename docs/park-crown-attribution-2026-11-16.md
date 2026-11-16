# Village score attribution — 16 November 2026

Evie's seven existing point receipts totalled 14 points: 11 from weekly tricks,
one for completing the daily list, one for finishing within 20 minutes, and one
for finishing first. The last four receipts had been entered after the Village
timer ended, while Ramp Attack remained selected. They had no training-session
link and were stamped with the wrong venue.

The coach confirmed that these tricks belonged to the Village visit. A targeted
transaction moved those four existing receipts to that visit and venue. Its
stored session total now reconciles to 14. No points, completion times or tricks
were created. Evie's account now has the Queen crown-title preference.

Verification:

- Rehearsed the full transaction with rollback before applying it.
- All 1,660 earned-point receipts and their 3,103-point total were preserved;
  the hash of IDs, owners, award keys, values and award dates was identical.
- Rider progress, the complete push queue and historical crown events were
  unchanged, checked with hashes inside the repair transaction.
- An authenticated rider read returns seven Village receipts totalling 14 and
  the corrected 14-point session, preserving the 13:46 daily completion time.
- The correction was quiet: notification triggers were suppressed only inside
  the transaction, then restored. No notification was added.

The existing all-time park rule still excludes the under-20 and first-finisher
bonuses. On that rule Evie has 12 park-record points, while Cruz's record is 13.
Counting both bonuses consistently for every rider would give Evie 14 and Cruz
15. The crown rule was left unchanged pending the coach's choice of today's
leader versus the all-time record. The app must not force a named winner against
the selected rule.

The exact guarded repair, including the reviewed receipt IDs, is retained in a
private local audit outside this public website repository.
