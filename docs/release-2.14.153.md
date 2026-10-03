# JKCREW 2.14.153 — Quick event creation

Coaches now have a compact teal + beside Upcoming Events in Events & Runs.
It opens a focused Add Event dialog with name, location and start/end dates,
using the existing shared-event save and duplicate detection paths. Coach event
creation does not automatically mark the coach as attending. Rider creation and
attendance behaviour stay unchanged; parents retain read-only event access.

The dialog supports keyboard focus, Escape and mobile layouts. Failed or timed-out
saves retain the form and show an inline retry message. Repeated submissions are
blocked while saving. No schema change or production test event was needed.

Verification:
- 41 isolated browser checks: coach/admin creation, parent restrictions, unchanged
  rider attendance, 320/390/1440px layouts, keyboard behaviour, invalid dates,
  failed saves, rapid submissions, duplicate detection, timeouts and late success.
- Live RLS inspected read-only: authenticated coach-owned event INSERT/SELECT is
  already allowed under the existing ownership policies.
- Release smoke and JavaScript parsing passed; all 50 installed-app update checks
  passed. Root and Riley assets ship as 2.14.153 with separate cache namespaces.

Browser saves used fixture data. No real crew events or attendance were modified
for testing; physical-device keyboard behaviour was not tested.
