# JKCREW 2.14.181 — Add daily locations from Session Viewer

The coach's location filter now ends with a compact blue square plus button.
It opens a park-name form and appends the saved location to the existing coach
venue list. Empty locations remain available after switching groups or reopening
the page, ready for the coach to add each rider's daily tricks.

Existing names and venue aliases are reused. Repeated taps are blocked while
saving; failed saves keep the entered name for retry. Adding a location during
an active session keeps the current session's location fixed.

Verified in desktop and mobile browser fixtures, dark and light themes, using
the actual render and save functions. Checks cover creation, reload/group
switch persistence, duplicate names/aliases, rapid submissions, retry, unique
conflict recovery, stale accounts, cancellation and active-session behaviour.
Existing Session Viewer setup/counter checks, coach startup, release smoke,
syntax and installed-app update checks passed. An authenticated live database
insert/read/duplicate check was rolled back, leaving no test records.

No schema changes. Adding a location does not edit assignments or rider progress.
