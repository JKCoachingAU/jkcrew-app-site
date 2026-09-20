# Daily Tier 2

Tier 2 is an optional second round unlocked by a confirmed, fully completed standard Daily result. A saved partial can also qualify once every trick in that same Daily list is genuinely landed on the same rider-local day. The server requires matching list contents, count and canonical venue, plus current ticks and durable same-day landing evidence for every current assignment. The original partial result remains unchanged: it earns no retroactive Tier 1 point, XP, timed bonus or PB. An ended overall session and a copied identical sheet with new assignment IDs do not hide that verified completion. No existing Tier 1 progress, reward, XP, personal-best or finish function is replaced.

The default is a fresh round of the same coach-assigned Daily tricks. A linked coach can configure 1–20 custom tricks under **Edit current list → Tier 2**, or **Session Viewer → Daily Tricks → Edit Daily → Tier 2**. Use **Save Tier 2** to save this bonus list separately from the standard schedule. This current template is not part of the next-week scheduler. The template is copied at unlock. Template/sheet changes never rewrite an already unlocked round or historical evidence. If the standard list changed between its qualifying finish and unlock, the server asks the coach to configure the challenge rather than silently substituting different tricks.

## Integration

Load `daily-tier-two.css` and `daily-tier-two.js` before app integration. The global API is `JKCrewDailyTierTwo`:

```js
const tier = JKCrewDailyTierTwo.mount(host, {
  client,
  athleteId,
  canEdit: true,       // rider or linked coach; server verifies this independently
  canReveal: true,     // rider only; coach never consumes the rider's surprise
  eligibleHint: false,// true only if an authoritative full Daily result is known
  isCurrent: () => currentUserAndViewStillMatch() && !riderFeaturesDisabled(),
  onChange: result => {
    // result.reveal_claimed: collapse Tier 1 in place, without remounting Tier 2
    // result.points_awarded === 4: refresh weekly points and Today's Progress
    // every landed change: invalidate Tricktionary evidence/progress caches
  },
  onError: error => {},
});
await tier.ready;
await tier.refresh(); // after a full Daily confirm and during coach/rider refresh
await tier.refresh({ eligibleHint: true }); // reused host after a known full finish
tier.destroy();       // before replacing the host or leaving the view

const editor = JKCrewDailyTierTwo.mountEditor(coachContentHost, {
  client, athleteId, isCurrent: () => currentCoachAndRiderStillMatch(),
});
await editor.ready;
editor.destroy();
```

Both controllers expose `refresh`, `ready`, `destroy`; the rider controller also exposes `getState`. `destroyAll()` tears down all current controllers for logout/access restriction. `localDate: 'YYYY-MM-DD'` requests a read-only historical snapshot. The module polls only while visible, refreshes on focus, and schedules the server-provided midnight reset. All requests time out after 15 seconds; `timeoutMs` is available for tests. A saved result can safely be retried after a timeout. If the server confirms eligibility but unlocking fails, a visible Retry message remains even when no active-session hint is available.

In rider sessions (including coach-started team sessions), the Tier 2 card sits directly below the Daily timer, before other lists. In the coach Team Session, it appears immediately below the selected rider’s list tabs. Before eligibility the host is hidden. A confirmed Daily result is required: a full result qualifies directly; a partial qualifies only after the same list is fully verified that day. Ticking every trick without any confirmed finish does not qualify. `eligibleHint` only enables a useful retry card when a known full finish cannot load its unlocked content; it never grants server eligibility. Keyboard focus moves from Open Tier 2 to the first checkbox. The reveal and staggered list/particles happen only for the winning server reveal claim, with a reduced-motion alternative. Subsequent refreshes do not replay them.

## RPCs and result shape

- `get_daily_tier_two(p_athlete_id, p_local_date default null)` is read-only. Own rider, linked coach and linked parent may read.
- `unlock_daily_tier_two(p_athlete_id)` creates one immutable daily snapshot, using a confirmed full result or a same-day partial whose unchanged list is now fully verified; otherwise returns `unlocked:false`.
- `claim_daily_tier_two_reveal(p_athlete_id)` is rider-only and returns `reveal_claimed:true` exactly once per rider/day across devices.
- `record_daily_tier_two_trick(p_athlete_id,p_item_id,p_landed)` saves one fresh Tier 2 tick, idempotently; unticking is allowed before completion. An old or foreign item ID cannot change today's checklist.
- `complete_daily_tier_two(p_athlete_id)` verifies every Tier 2 tick, records the completed snapshot and awards exactly four points atomically. Returns `points_awarded:4` once and `0` on retries. Completed rounds are immutable; coach ledger adjustments remain the correction mechanism.
- `get_daily_tier_two_template(p_athlete_id)` / `set_daily_tier_two_template(p_athlete_id,p_items)` are linked-coach only. `p_items:null` restores the default. Entries have `trick_name` (1–120 characters), optional `notes` (0–180 characters).

Result fields include `unlocked`, `eligible`, `athlete_id`, `local_date`, `reset_at`, `source`, `venue`, `items:[{id,trick_name,notes,landed}]`, `completed_count`, `total_count`, `revealed_at`, `completed_at`, `points`, `reward_points:4`, `historical` and `scoring_paused`.

## Persistence and scoring

Private tables `daily_tier_two_templates` and `daily_tier_two_rounds` have RLS enabled and no direct authenticated/anonymous grants. Public invoker RPCs use narrowly authorized private definer functions with an empty search path. All mutations use the same rider profile row lock as Daily scoring. A `(athlete_id,local_date)` primary key and the existing points-ledger unique key enforce one round and one total reward across venues, devices, linked coaches and retries.

`local_date` comes from `jkcrew_country_timezone(profiles.country_code)` and server time, matching the existing Daily midnight reset. This is unrelated to the separate 4pm timed challenge. No browser-supplied date controls mutations.

The award is `assignment_point_awards.award_key = 'daily-tier-two:' + local_date`, `points=4`, with its snapshot venue. Its `assignment_id` and `session_id` are null so deleting/replacing a sheet or session does not destroy this daily reward. Existing weekly points, battle score, park points and Today's Progress read the same authoritative ledger. Render this prefix as **Daily Tier 2**. No extra XP or Tier 1 completion/PB is granted.

Actual Tier 2 landings create idempotent `tricktionary_landing_history` records with category/evidence type `daily_tier_two` and stable `daily-tier-two:<athlete>:<date>:<item>` IDs. Unticking before completion revokes that evidence. Label this category **Daily Tier 2**. Parent and coach privacy remains the existing history policy.

The source-specific `zz_guard_daily_tier_two_award` trigger protects only this new reward prefix against unrelated write RPCs; ordinary scoring is untouched. Disabled callers are denied by the existing access gate and explicit new-function checks. Scoring-paused riders cannot add Tier 2 landings or receive its points; existing ticks can still be corrected downward. A linked coach cannot bypass scoring pause.

## Verification

- `tests/daily-tier-two-db.cjs`: production-shaped PGlite fixture with actual Daily/partial/pause functions; full/partial eligibility, one reward, multiple venues, source integrity, evidence, read-only history, authorization and retry rollback.
- `tests/daily-tier-two-concurrency-postgres.cjs`: real PostgreSQL transactions on a disposable `/tmp` socket database; simultaneous unlock, reveal, independent ticks and two-coach completion.
- `tests/daily-tier-two-ui.cjs`: real browser module at 320/390/820/1280 widths, reveal persistence, reduced motion, error/timeout recovery, stale account teardown and coach editor.
- `tests/daily-features-integration.cjs`: actual app mount/preservation helpers, both new feature modules and actual Daily confirmation flow; checks rider/coach/profile mounts, draft/progress preservation and disabled-account/navigation cleanup.

The migration is additive and does not backfill existing points or create existing riders' Tier 2 rounds during deployment. It uses local lock/statement timeouts for a bounded deployment.
