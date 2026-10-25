# JKCREW 2.14.175 — Compact schedule cards and cancelled events

UCI schedule cards show compact points/qualification status badges without the
repeated explanatory paragraphs. Detailed notes are available inside the existing
Eligibility, registration & sources disclosure. Dates, locations, classes,
categories, source links and Add/View event actions remain available.

Cancelled events are excluded from shared Upcoming Events for coaches, riders
and parents, parent Road to LA28 upcoming events, and calendar reminders/previews.
Existing cancelled entries still show their status in the tracker history.
Noncancelled historical calendar entries and saved run records remain unchanged.

The existing Saudi 2026 World Championships calendar record was marked cancelled
after checking the [official UCI announcement](https://www.uci.org/pressrelease/the-uci-and-saudi-cycling-federation-confirm-that-the-2026-uci-urban-cycling-world-championships-will-not-proceed/AsZUTThGT0DsbQPmWS58d).
The targeted update changed only its cancellation status and update timestamp,
with before/after records saved to the existing private event audit. Verification
confirmed the original event fields, three attendance records and park photo were
unchanged. It had no linked saved runs. The 2027 schedule has no Saudi 2026 event
or calendar link that could restore it on weekly refresh. No schema change needed.

Verified:
- 213 schedule UI and 85 parent schedule checks; 320/390/768/1440px layouts,
  dark/light themes, reduced motion, source disclosure, saves/retries and roles.
- 15 cancellation visibility checks, including real shared loader logic and
  preserving noncancelled calendar history.
- 65 parent tracker, 69 parent integration and 59 Past Events UI checks.
- Release smoke and 50 installed-app/service-worker lifecycle checks.
- Root/Riley assets and release versions aligned; mobile card visually inspected.

The release uses the existing app update prompt. Physical iPhone testing remains;
no new service or recurring cost is required.
