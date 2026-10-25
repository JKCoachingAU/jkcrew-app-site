# JKCREW 2.14.172 — Simpler event entry form

Plan an event entry now contains only Event, Category, Status and optional Notes.
Removed the licence/category/federation checklist and the deadline date, time zone,
source and UTC offset inputs. Entry cards and coach attention no longer show the
removed checklist/deadline work. Cancelled events and pending results still appear
in coach attention.

Existing entry metadata is retained when editing status or notes. Resolving a
save conflict keeps the latest stored metadata alongside the user's visible edits.
The form no longer tries to validate hidden time zones using mobile Intl support;
the existing server validation remains authoritative. No database migration or
stored-record cleanup is needed. Result recording and review remain unchanged.

Verification:
- 248 tracker UI checks cover the four-field form, required values,
  normal/conflicting metadata preservation, saving, rapid taps and retry recovery.
- Entry layouts checked at 320/390px in dark and light themes, including no
  horizontal overflow, visible Save control and 44px tap target.
- Actual rider-shell preview with the app fonts checked at 390px.
- 30 app integration checks, release smoke checks and 50 installed-app update
  lifecycle checks passed. No production rider records were modified for testing.

Root and Riley assets, cache version, manifest and asset references are aligned.
Physical iPhone/Safari verification remains a real-device check.
