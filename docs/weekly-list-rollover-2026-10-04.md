# Coach-first weekly list rollover

Alirah (Ali) and Alec's latest lists were still saved under the week beginning
27 September. Neither had rows for the new Sunday-start week, 4 October.
The rider/profile loader triggered rollover but the combined Coach Session Viewer
reader did not. It displayed historical Daily lists and empty weekly categories
until the rider opened their own sheet.

The combined reader now materializes each authorized rider's current local week
before reading it. It retains the same request/response contract, so already
installed clients receive the fix without an asset download or version bump.
Historical and future reads do not publish new weeks. Fresh assignment IDs reset
weekly progress without overwriting previous attempts, points or history.

Rollover, individual-list saves and full-sheet saves share a rider/week transaction
lock. Multi-rider reads acquire locks in a consistent order. Individual-list saves
first carry the current sheet, preventing the first category edit of the week from
stranding other unchanged lists. Existing current-week edits, scheduled-plan
activation and progress safeguards remain intact. Private drafts do not activate.
The migration incorporates the deployed function definitions, including existing
production safeguards that were absent from the older checked-in rollover body.

Verification:
- 48 disposable native PostgreSQL checks reproduce the old empty-week defect and
  verify retained content, fresh progress, history, repeated reads, category edits
  and clears, scheduled/private plans, access permissions, country Sunday
  boundaries and three overlapping coach/rider/save transactions.
- The migration was applied to production. Loading the two affected riders through
  the authorized coach RPC created 45 current-week rows for Ali and 39 for Alec,
  exactly matching their latest saved list content, including notes and order.
- All 670 historical assignment records, 76 progress records, 19 point-award
  records and 10 percentage attempts remained unchanged. Repeated reads created
  no duplicates. Current weekly rows had no copied progress or awards.
- Rider-authorized reads return 25 weekly items for Ali and 19 for Alec, plus
  their Daily locations. Cross-rider and rider-to-coach reads remain denied;
  anonymous execution remains revoked.
- Release smoke and diff checks passed. Supabase advisory count stayed at 113;
  the existing authorized security-definer RPC notice now reports PL/pgSQL instead
  of SQL. No new permission exposure was introduced.

Scope: carries the latest saved whole sheet when a new week has not been created.
It does not guess missing categories in an already populated sheet, because that
would resurrect deliberate removals. The existing absence of an explicit empty
whole-sheet marker remains a separate edge case: clearing every list can allow
the prior sheet to carry again. No existing partial or deliberately cleared sheets
were bulk-repaired. Physical-phone confirmation is still pending.
