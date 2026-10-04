# JKCREW 2.14.156 — Run-builder curve controls

Tapping a route dot changed the selected state on pointerdown but left the old
editor mounted unless the rider dragged. Tapping dot 2 after dot 1 therefore
left the curve slider disabled. Selection now refreshes after taps as well as
drags, preserves unsaved run names, and opens collapsed live tools. Returning
from Watch to Build also restores a valid editable dot selection.

Tapping a line now opens “Curve this line” alongside its existing travel-time
control in both Route and Tricks. Curve inputs target the line's endpoint
explicitly, so selecting another dot cannot bend the wrong line. Matching
controls and live participants stay synchronized. Sliders have a 44-pixel
minimum touch area and keep touch gestures from scrolling the page.

Verification:
- `tests/run-curves.cjs`: actual production rendering and handlers with real
  Chrome touch, mouse, keyboard and native slider gestures. Pre-fix HEAD fails
  at the original dot-2 tap regression; the updated code passes positive and
  negative curves, SVG geometry/hit targets, private/live layouts, collapsed
  controls, unsaved titles, Watch/Build, line endpoint targeting, reload and
  read-only protection.
- `tests/run-segment-timing.cjs` and `tests/run-timing-editor.cjs`: phone/tablet
  line selection, timing, playback, undo/redo, focus, scroll and zoom pass.
- `tests/run-builder-save-watch.cjs`: new and existing run saves retain positive
  and negative bends for rider/coach on phone/tablet, including after Watch;
  duplicate-submit prevention, failed-save recovery and draft retention pass.
- `tests/run-builder-opening.cjs`: course loading/upload, empty setup, retry and
  stale-request protection pass.
- `tests/live-runs-ui.cjs`: two separate local browser sessions with connected
  WebRTC and synthetic media. Curves synchronize both directions into the
  open line editor, render identically, and survive shared saving. Existing
  concurrent-edit/conflict, disconnection recovery, rider/event ownership and
  separate call-ending checks pass. Database responses use isolated fixtures;
  no production rider records or media were changed by these tests.
- 166 live-sync checks, run-timing checks, release smoke, JavaScript parsing,
  diff checks and all 50 installed-app update checks pass.
- Inspected the phone line-editor screenshot: visible curve control and no
  clipped controls. Physical iPhone/Safari testing remains to be confirmed.

Root and Riley assets share version 2.14.156 and retain separate worker cache
namespaces. No database migration or scoring changes.
