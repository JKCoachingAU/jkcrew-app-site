# Release 2.14.147 — Past Events park-layout archive

Coach Tools now includes **Past Events**, a searchable archive of finished contests and their saved shared park layouts. Events appear automatically when marked complete or after their end time; events without an end time use the existing one-day fallback from their start time. Undated, unfinished events remain upcoming. No scheduled job or image duplication is needed.

The archive retains the existing event and course-photo records. Coaches and admins can open each saved layout in a read-only viewer. Events without an uploaded shared layout are clearly marked; private rider run plans are not used as substitutes. Existing explicit event deletion still deletes its associated course photo.

The listing requests bounded metadata pages, with images downloaded only when **View Layout** is tapped. Search, loading, empty and retry states, duplicate-tap protection, keyboard focus handling, and stale navigation/account response guards are included. Existing active-event and linked-parent access remains unchanged.

## Verified

- 12 real PostgreSQL regression checks: reproduced inaccessible expired layouts before the fix; archive classification and finish-time boundaries; coach/admin permissions; rider, parent and anonymous rejection; preservation of existing active-course access; private-task/run isolation; original images unchanged; search and pagination bounds.
- 59 isolated Chrome checks: mobile layouts at 320/390px and desktop at 1024px; 44px controls; navigation, search, pagination and lazy image requests; failed reads, image errors, repeated taps and stale responses; read-only layouts and escaped content. No production test records were created.
- Existing authentication startup (47 checks), loading/performance, rider feature access, Session Viewer setup and all-role navigation regression suites passed. Stale browser-test fixtures were updated to match current authentication and daily-feature helpers.
- Root and Riley entry points loaded with real release assets at 390px, with no application exceptions or missing local assets. Syntax, release smoke, whitespace and root/Riley mirror checks passed. Existing service-worker regression checks cover release-safe HTML caching, public asset retention and exclusion of private API responses.
- Applied `20260923214947_coach_past_events_layout_archive.sql` through Supabase migrations. The CLI-generated local migration was aligned with its recorded deployment version. Read-only verification under the coach role returned 12 past events with 2 saved layouts. The listing was 3,372 characters; the two image payloads total 294,290 characters and are omitted until opened. Both image checksums were unchanged after the migration.
- The RPC is security-invoker with a fixed search path and no anonymous execution grant. Supabase security advisors reported no findings for the new function or policies; unrelated existing notices remain outside this change.

## Release

App entry points, manifests, service workers and root/Riley mirrors use **2.14.147** for the established main-to-GitHub-Pages release. Installed users receive the existing update prompt; the existing deferral protects active editing and calls. No new services, paid configuration or recurring costs are required.

Physical-device installed-app upgrade behavior was not exercised; browser and service-worker regression checks passed.
