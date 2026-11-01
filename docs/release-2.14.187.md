# JKCREW 2.14.187 — Trick Links editor and save fix

Reproduced the failed-save path: typing `Barspin - Tailwhip` used the generic
trick/notes parser, producing a one-trick title with Tailwhip as a note. The
server correctly rejected this as an incomplete pair.

Session Viewer now uses numbered Link 1, Link 2, Link 3 boxes, matching Lines.
Existing larger lists retain all their boxes. Each box holds one two-trick link.
Spaced dashes, arrows, ASCII arrows, pipes and two lines inside a numbered box
normalize to one `First trick → Second trick` assignment. Hyphenated names such
as X-UP and No-footer remain intact. Already-saved explicit pairs keep coaching
notes. Blank boxes are ignored; malformed nonempty pairs are rejected without
silently removing an entry. No special arrow needs to be typed.

The same parser supports dash-separated pairs in rider profiles, scheduled
lists, optional proposals and trick requests. Those list editors retain one pair
per row. Session Viewer restores Save even if parsing fails. Failed next-week
planner saves now keep the current editor, restore both save buttons and allow
retry; duplicate submissions and stale rider/account responses are guarded.

Verification:

- 91 UI/function checks, including numbered boxes, alternate separators,
  editor-save-reopen round trips, invalid pair recovery, existing notes,
  parent read-only views and 320/390px light/dark layouts.
- 110 database checks, including actual frontend-parsed payloads passed into
  the production SQL save function in an isolated database. Dash, pipe and
  multiline pairs save correctly; invalid/oversized pairs do not replace lists.
  Existing 2-point scoring, duplicate-award protection and undo checks pass.
- 61 planner recovery checks: draft/schedule failures, rejected promises,
  preserved text, retry, duplicate submission and stale request behaviour.
- Existing numbered Lines tests, syntax, release smoke and 50 installed-app
  update checks passed. Root/test-site release assets remain mirrored.

No production database migration or rider-data edits. Scoring remains 2 normal
points per completed pair. Tests use isolated data and synthetic browser
transport; no real rider assignments were modified for testing.
