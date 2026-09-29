# JKCREW 2.14.150 — Live Run coaching workspace

Live calls now use a map-first workspace with contextual tools, compact mobile
video, optional Follow coach and temporary pointing highlights. Watch together
requires both participants to join; either can play, pause or seek. Simultaneous
run editing and the separate Save Run/End Call actions are preserved.

Course/event settings collapse after setup. The selected dot’s trick/timing tools
sit beside the map on desktop and in a compact panel on mobile. Both video tiles
remain visible when minimized. Low-data and audio-only modes support weak links.

Call-status polls omit course images entirely. Realtime signal notifications with
bounded polling reduce repeated requests; temporary coaching messages travel over
the existing peer connection. JSON key-order differences, fullscreen teardown and
hangups during pending media changes are explicitly handled.

## Verification

- Two independent browser sessions with native WebRTC and synthetic camera/audio:
  shared pointer, follow, opt-in playback, play/pause/seek in inline and fullscreen,
  simultaneous edits, field/keyboard preservation, retry/conflict recovery, correct
  rider/event saves, repeat calls and media cleanup. No real rider records used.
- 73 native media/connection checks and 15 transport checks pass, including hangup
  during delayed track replacement and quality changes.
- 44 protocol checks cover malformed/out-of-order messages, reconnect epochs, stale
  selections, course changes, clock skew/latency and simultaneous playback actions.
- Disposable PostgreSQL: 68 checks for unchanged authorization, device binding,
  lifecycle and API grants; a faulting draft view proves status never reads it.
- Mobile widths 320/390/768/1280: no horizontal overflow; desktop and compact video
  layout inspected. Existing private-planner opening and Save/Watch journeys pass.
- Existing 166 live-edit sync checks, release smoke, loading-performance checks and
  50 installed-app cache/update checks pass.

## Measurements and limits

For a synthetic 1 MiB course photo, the call-status response falls from 1,049,871
bytes to 1,077 bytes (99.90% smaller). A controlled 30-second ringing test uses 11
compact status checks instead of roughly 46 previous full-draft checks. These are
local payload/request measurements, not measured cellular bills or phone FPS.

Root/Riley assets, manifests and service-worker caches ship together as 2.14.150.
No new service, recurring cost, account or scoring changes. Physical iOS/Android
background behavior and a cellular-to-Wi-Fi call through TURN still require real
network/device testing; no relay service was provisioned by this release.


## Production verification

Applied migration `20260929095937_live_run_call_status_metadata`. Read-only
postflight confirms only the reviewed status branch changed, public invoker and
private explicit-auth roles/search paths/grants remain unchanged, and anonymous
execution remains denied. Security advisory comparison reports no new notices.
The migration changes functions only; it does not change rider records.
