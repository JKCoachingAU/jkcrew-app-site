# JKCREW 2.14.170 — Dedicated LA28 navigation

Riders now have an LA28 tab beside Contests in the bottom navigation and desktop
sidebar, with the full accessible name Road to LA28. The official schedule stays
within LA28, and its Back button returns to the tracker. Opening a calendar event
still switches to Contests. The tracker no longer has a redundant Back button on
the rider screen; coaches retain their existing Coach Tools navigation.

The phone navigation uses seven equal columns and consistent label sizing when
notification badges are present. Existing Home and Contests shortcuts still work.
Parent navigation and recovery-only access are preserved. No rider data or
permissions are changed.

Verified with 30 tracker routing/draft/access checks, 65 schedule integration
checks and 63 recovery integration checks. A temporary actual-shell browser
fixture passed 80 checks across 320/375/390/430/768px, both themes, notifications,
desktop sidebar and role-specific navigation. All seven phone targets remain at
least 44px wide/high, with no horizontal overflow. Release smoke checks and 50 installed-app update lifecycle checks also passed.
Root/Riley release assets and installed-app versions are synchronized.
