# JKCREW 2.14.186 — Trick Links

Trick Links is a weekly training list for two tricks landed back to back. Each
pair is one assignment, written `Barspin → Tailwhip`, and earns 2 normal points
when completed. Coaches can assign links in Session Viewer, rider schedules and
Sheet Scheduler; riders see the list in Session, and linked parents can view it.
Optional links can accompany whole-sheet proposals or individual trick requests.

Pairs accept `→` or `->`, normalize spacing, and require exactly two nonempty
components within 120 characters. Invalid saves preserve the existing list and
keep the editor text. Unchanged saves retain assignment IDs and completion;
repeated pair rows are deduplicated. Older proposals without optional links do
not erase an existing coach-added links list.

Completion uses the established server-authorized scoring path. Repeated
completion requests cannot duplicate the award or session receipt. Unticking
removes its two points from the original session. Weekly completion, normal
challenge rewards, park totals, summaries, history and Tricktionary evidence
include links. Previous-week ticks compare the ordered pair separately from
individual tricks and Lines. Pair editors do not offer single-trick suggestions
that would overwrite or split a pair. XP remains paused.

Verification:

- 98 isolated database checks using current production function definitions and
  the actual migration: validation, optional proposals, saves, rollover,
  scheduling, scoring/retries/undo, permissions, challenge integration, history,
  park scores and preserved XP.
- 78 browser/function checks: real app handlers with synthetic transport,
  pair/request/proposal round trips, native double taps, recoverable failures,
  weekly summaries, parent read-only views, 320/390px light/dark layouts.
- Existing numbered Lines, previous-week history, progress-sharing,
  Tricktionary automation and Session Viewer counter regression suites passed.
  Counter layouts cover 320/390/1024/1440px and keyboard/navigation behaviour.
- 105 full Home startup/journey checks, 50 installed-app update checks, syntax,
  release smoke and root/test-site mirror checks passed. An initial Home run
  during parallel browser tests exceeded its 3500ms timing budget (4080ms);
  the isolated rerun passed with a longest startup of 1616ms. No threshold was
  relaxed.
- Production migration applied; pair validation, category constraints, scoring
  definition and denied anonymous helper execution verified. Existing row
  counts stayed at 20,321 assignments, 3,295 progress records, 1,378 point awards
  totalling 2,613 points, and 1,088 XP ledger records. Security advisory counts
  are unchanged from the pre-release baseline.

No real rider was edited to test the feature. Real multi-device simultaneous
requests and physical mobile devices were not exercised; database uniqueness
and row locking provide duplicate-award protection. The existing 50-item proposal
cap allows up to 23 optional links alongside the 27 required items.
