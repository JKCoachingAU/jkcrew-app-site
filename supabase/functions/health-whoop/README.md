# Optional WHOOP health summary

This backend is implemented and tested with synthetic WHOOP responses and a
disposable local PostgreSQL database. Real WHOOP OAuth, account approval and
device synchronisation have **not** been verified. Applying the migration does
not connect any rider, import health data or create a paid subscription.

## Before enabling connections

1. Create a JKCREW app in the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/).
   Register the exact callback:
   `https://soanwttlorlgdfrzbvtp.supabase.co/functions/v1/health-whoop/callback`.
2. Request only `offline read:sleep read:recovery read:cycles`. Supply a privacy
   policy explaining the summary data stored, rider-only access and deletion on
   disconnect. Each rider connects their own account with WHOOP's consent screen.
3. Apply `20261029114127_private_whoop_health_connection.sql`, then deploy
   `health-whoop` with the configuration in `supabase/config.toml`.
   `verify_jwt=false` permits the OAuth callback; POST requests still verify the
   bearer token with Supabase Auth and check the current database athlete role.
4. Store these as **Edge Function secrets**, never frontend config, git, browser
   storage or ordinary logs:
   - `WHOOP_CLIENT_ID`
   - `WHOOP_CLIENT_SECRET`
   - `WHOOP_TOKEN_ENCRYPTION_KEY`: a securely generated random 32-byte key encoded
     as base64. Keep a secure backup; replacing it without re-encrypting existing
     connections will require those riders to reconnect.
   Supabase's injected `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` are also required.
5. Verify one consenting test rider, including revoke/disconnect and an expired
   access token, before rollout. WHOOP starts apps at Sandbox/10 members. The
   next tier is Build/100 members, manually reviewed; request it if required.
   Do not accept paid services or commercial commitments without owner approval.

No Garmin or Apple Health synchronisation is implied by this implementation.
Garmin needs business developer access. Apple Health needs a native HealthKit
component; this repository is currently a web PWA.

## Frontend contract

Use `supabase.functions.invoke('health-whoop', {body:{action}})` from the rider's
own authenticated session. Allowed actions: `status`, `connect`, `refresh`,
`disconnect`, plus `complete` with a one-use `ticket` after the OAuth callback.
No actor IDs, return URLs or arbitrary provider URLs are accepted.
Only the production JKCREW origin is enabled for CORS.

Status and refresh responses:

```json
{
  "provider": "whoop",
  "availability": "ready",
  "connection": "connected",
  "summary": {
    "source": "WHOOP",
    "synced_at": "2026-10-29T08:00:00.000Z",
    "observed_at": "2026-10-29T07:00:00.000Z",
    "metric_observed_at": {
      "sleep": "2026-10-29T07:00:00.000Z",
      "recovery": "2026-10-29T07:00:00.000Z",
      "strain": "2026-10-29T07:00:00.000Z"
    },
    "sleep_minutes": 420,
    "resting_heart_rate_bpm": 50,
    "hrv_rmssd_ms": 64,
    "recovery_percent": 0,
    "strain": 0
  },
  "synced_at": "2026-10-29T08:00:00.000Z",
  "retry_after": "2026-10-29T08:15:00.000Z",
  "syncing": false,
  "sync_due": false
}
```

Values above are documentation examples, not live health data.
`availability` is `not_configured` until all three WHOOP secrets are valid;
Connect must not appear functional in that state. `connection` can be
`disconnected`, `connected`, or `reconnect_required`. `summary` is null until a
successful sync; individual missing/unscored values are null. Zero is a value.
The per-metric times refer to the underlying sleep/recovery/cycle, separately
from `synced_at`. Day strain is WHOOP's cycle score, not a JKCREW score or medical
assessment. Only recent data (seven days, up to 25 records per resource) is read.
Naps are excluded from the main sleep card, and sleep minutes sum the actual
sleep stages, not time in bed. No earlier scored result substitutes for the
latest unscored record.

Call refresh once when connected and `sync_due` is true. The server enforces a
15-minute shared cooldown and serialises token rotation across requests. There
is no browser polling, background schedule or webhook subscription in this
initial implementation. Transient failures preserve the last summary and set
a 60-second cooldown. The frontend must preserve its observed dates. A failed
or ambiguous token rotation requires reconnecting rather than replaying an old
refresh token.

Connect returns `{provider, availability, authorization_url}`. Navigate only
to the fixed WHOOP authorisation origin/path. The callback exchanges the code
server-side and stages encrypted tokens pending authenticated completion. It
returns to the fixed JKCREW home URL with
`?health=complete#whoop_complete=<one-use-ticket>`, or `?health=error` on failure.
The ticket is an independent random 64-character hex value, hashed in the
database, valid for five minutes. It contains no user IDs, health data or OAuth
tokens. Capture it in module memory and immediately remove the fragment/query
with `history.replaceState`; do not persist it in browser storage. Then invoke
`{action:'complete',ticket}` under the current JKCREW session. Only the same
verified rider who initiated the connection can activate these pending tokens.
Wrong-rider completion is denied without consuming the intended rider's ticket.
This prevents a shared authorisation URL from attaching another rider's WHOOP
to its initiator's JKCREW account. After completion, fetch status/refresh.
OAuth state is also hashed, rider-bound, expires after five minutes and is
consumed once. New attempts invalidate previous pending states and tokens.

Disconnect tries to revoke provider access and deletes JKCREW's encrypted token,
summary and pending states. If revocation cannot be confirmed (including an
expired token), the response says to remove JKCREW permission inside WHOOP too.
Disconnect during an active sync returns a recoverable 409; retry after that
short operation finishes. No local data is presented as removed until deletion
has completed. All health operations remain private to the rider; a linked
coach or parent has no access.

## Security and verification

- Private schema, RLS enabled, no anon/authenticated grants or policies.
- Service-only RPC uses invoker permissions and a fixed empty search path.
- Current athlete role checked at each backend operation; no authorisation from
  mutable user metadata or an actor ID in a browser payload.
- AES-256-GCM with a random IV and athlete ID bound as authenticated additional
  data; OAuth secrets and plaintext tokens never leave the Edge Function.
- Expiring operation lease plus generation guards prevent stale callback/sync
  writes and refresh-token races. Deletion cannot be undone by an old callback.
- Provider/DB/Auth calls time out, redirects are rejected, response size is
  bounded, and all browser responses use `Cache-Control: no-store`.
- No public leaderboard, coach sharing, medical inference or raw sensor archive.

Regression commands (set `JKCREW_PGLITE_PATH` if PGlite is not on `NODE_PATH`):

```sh
node tests/health-whoop-db.cjs
node tests/health-whoop-edge.cjs
```

These run the actual migration and function against isolated PostgreSQL with
mock WHOOP/Auth transport. They cover access denial, encrypted token privacy,
one-use/expired/superseded state, concurrency, cooldowns, source dates,
zero/missing scores, sleep duration, failures/timeouts and disconnect cleanup.
No test contacts a real rider or provider account.

Official references:
[WHOOP API v2](https://developer.whoop.com/api/),
[OAuth](https://developer.whoop.com/docs/developing/oauth/),
[App approval](https://developer.whoop.com/docs/developing/app-approval/),
[Supabase function authentication](https://supabase.com/docs/guides/functions/auth),
[Supabase secrets](https://supabase.com/docs/guides/functions/secrets).
