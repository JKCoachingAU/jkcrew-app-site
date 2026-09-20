# Other Things Landed

Separate from Working On. A rider submits one or more landed trick names and an optional short note per trick. No score or landed evidence is created until a linked coach approves that item. Approval gives exactly one point, no XP; decline gives zero. Reviews are final and retries return the original outcome/reviewer.

## Integration

Load `other-things-landed.css` and `other-things-landed.js` before app.js. Mount into an empty host:

```js
const handle = JKCrewOtherThingsLanded.mount({
  element: host, client, athleteId, role: 'rider', // or 'coach'
  venue: selectedVenue || '',
  isCurrent: () => capturedUser === state.user?.id && host.isConnected,
  onChanged: ({ athleteId, status, points }) => { /* invalidate scoring/history caches */ }
});
// Before navigation/replacing the host: handle.destroy().
// Existing realtime handlers may call handle.refresh().
```

The panel starts closed and loads only when opened. Its own Refresh and visible-panel refresh keep review statuses current without blocking the page. The callback reports recorded state, not an instruction to add points on the client. Keep Working On unchanged. Use the rider host on Session and coach hosts within each rider’s Session Viewer content.

## Database contract

- `get_other_things_landed(p_athlete_id uuid, p_limit int = 50, p_offset int = 0)` → `{items,total_count,pending_count,can_review,can_submit,scoring_paused}`. Pending first, then newest submissions. Limit max100, paged history.
- `submit_other_things_landed(p_entries jsonb, p_venue text = '')` → `{items}`. 1–10 objects `{id: UUID, trick_name: string, note: string}`. The caller must be that rider; there is no client-supplied owner. Reuse entry IDs on a retry. IDs already saved with identical content return the same rows; changed content with an existing ID fails.
- `review_other_thing_landed(p_submission_id uuid, p_decision text)` → `{item,already_reviewed}`. Decision `approved` or `declined`; only a linked coach/admin. A competing final decision returns the already-saved outcome, never silently overwrites it.
- Each item: `id,athlete_id,trick_name,note,venue,status,submitted_at,reviewed_at,reviewer_id,reviewer_name,points`.

Names are trimmed, 1–120 characters; notes 0–180 and venue 0–120. New submissions and approvals obey scoring pause; read, decline and completed retries remain possible. Feature-disabled riders cannot access this feature; coach management remains available under the existing actor-based feature policy.

Approval writes `assignment_point_awards` using key `other-landed:<id>`, `points=1`, no invented assignment or training session. This preserves existing weekly/all-time/venue calculations without changing session totals or awarding XP. The same transaction creates durable `tricktionary_landing_history` evidence with category `other`, server submission time and the submitted trick name. Existing history deduplication consumes it. Optional rider notes stay on the submission and are not used as Tricktionary classification hints.

No new push messages are sent. Existing point-ledger triggers continue their normal behavior. No existing scoring function is replaced. The existing private points receipt gets display labels for `other-landed:` and `daily-tier-two:`; its authorization, calculations and date boundaries are unchanged.

## Verification

- `tests/other-things-landed-db.cjs`: actual local PostgreSQL-compatible schema/functions, real authenticated/anon roles, transactional +1 approval, no XP, immutable review, protected ledger, rollback, pauses, feature access, privacy, paged reads and weekly/all-time receipt labels.
- `tests/other-things-landed-concurrency.cjs`: genuine separate PostgreSQL connections overlap duplicate submissions, approve/approve, decline/approve, approve/decline and scoring-pause/approve. Each test database is created locally and dropped afterward; only a `/tmp` Unix socket is accepted.
- `tests/other-things-landed-history.cjs`: actual app Tricktionary aggregation consumes the approved history source without counting its score receipt again.
- `tests/other-things-landed-ui.cjs`: mocked network service with the actual module; real browser forms, response-loss retries, double taps, reviews, stale reads, privacy, text escaping and phone/tablet layouts in both themes.

Supabase’s September 20 changelog and current RLS/functions/API-security docs were reviewed. Explicit grants and revokes cover the upcoming default Data API grant change. Live schema/advisor inspection was read-only; tests use isolated fixtures. The SQL migration was generated with official Supabase CLI v2.117.0 and has not been applied by this feature’s implementation agent.
