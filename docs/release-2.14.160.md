# JKCREW 2.14.160 — UCI world rankings

The Board now offers JKC Weekly, JKC All-Time, UCI Men and UCI Women to coaches
and riders. UCI views show official BMX Freestyle Park Elite individual rankings,
publication dates, points, movement, an official source link, rider/nation search
and 50-row pages. Switching tabs leaves chat drafts and selected videos intact.
JKC scores, scoring rules, accounts and permissions are unchanged.

## Public ranking updates

`tools/update-uci-rankings.mjs` reads UCI DataRide's public season catalogue,
publication dates and paginated individual rankings. It discovers new seasons,
pins a publication across pagination, rejects incomplete/duplicate/mixed data,
and writes only after both categories validate. An older publication cannot
replace newer published data.

`.github/workflows/update-uci-rankings.yml` checks daily at 17:23 UTC (03:23
Brisbane), so weekly UCI updates and delayed releases are picked up without
an app release. It writes only `rankings.json` on the `uci-rankings` data branch
using a SHA-guarded update, and verifies the result. The app reads that public
feed directly, avoiding GitHub's restriction that GITHUB_TOKEN commits do not
trigger Pages builds. A manual workflow dispatch supports operational checks.
The workflow uses standard public-repository Actions runners; no paid service,
new recurring subscription or Supabase access is required.

Rankings are fetched only when a UCI tab opens, with a one-hour client cache,
request deduplication, bounded timeouts and a local last-good snapshot. A bundled
snapshot supports first-load fallback. Failed refreshes are labelled, with a
retry button. No auth credentials, app-session data or referrer are sent to the
public feed. Initial snapshot: 20 October 2026, 368 men and 118 women, 49,612 bytes.

## Verification

- Six importer regression checks: complete pagination, season rollover, tied
  ranks/new riders, malformed/duplicate/mixed responses, regression rejection,
  failed-fetch preservation and atomic replacement.
- Client checks: lazy/deduplicated requests, persistence, cache expiry/refresh,
  blocked storage, timeouts, fallback, no rollback and persistent retry warnings.
- 74 browser UI checks: coach/rider tabs, existing JKC totals, search/pagination,
  safe source links, keyboard operation, 320/390/768/1440px dark/light layouts,
  preserved chat drafts/videos and stale-response guards across tabs/accounts.
- Actual official data rendered and visually inspected at 390 and 1440px.
- 33 existing chat milestone checks, 50 service-worker startup/update checks,
  release smoke, JavaScript syntax and whitespace checks pass.
- Live public feed was read back byte-for-byte with browser-compatible CORS.

Root and Riley entry points use the same assets and release version, with
separate service-worker cache namespaces. Recovery-mode work remains on its
separate pending branch and is not included.

Operational verification must include a successful live workflow dispatch and
Pages build before calling automatic updates enabled. GitHub can disable
scheduled workflows after 60 days without repository activity; daily successful
snapshot commits provide normal activity, while a prolonged upstream failure
must be investigated in Actions. The app labels an unchecked feed after 3 days.
