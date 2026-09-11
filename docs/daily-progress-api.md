# Daily Tricks / Today Progress review API

Release 2.14.93 API. The migration has been applied to production as authorized; share cards are excluded from the client release.

All RPC names live in public, accept authenticated rider or their linked coach/admin. Today read also allows linked parent. Snake_case JSON. Each mutation is one database transaction.

## record_daily_trick_action
Arguments: p_assignment_id uuid, p_action text ('landed'|'unlanded'), p_venue text default '', p_tapped_at timestamptz default null.
Returns existing assignment-action fields (assignment_id, category, venue, progress_date, completed_at, streak_count, points_awarded:0, points_removed:0, message, live_session, elapsed_seconds), plus completion_candidate object or null.
Only a genuine final incomplete→complete write returns completion_candidate. Repeated ticks do not cause fresh popup or awards. Corrections invalidate pending candidate; reload/realtime only updates ticks.
Candidate: {candidate_id, athlete_id, rider_name, session_id, group_session_id, venue, local_date, seconds, captured_at, completed_count, total_count}.
Timestamp accepted only from last 30 seconds and not future; absent/invalid clock uses server arrival time. Pending time excludes confirmation reading delay.

## prepare_daily_finish
Arguments: p_athlete_id uuid, p_session_id uuid default null, p_venue text default null, p_tapped_at timestamptz default null.
Returns {completion_candidate: candidate|null, result: persisted_result|null}.
An omitted/null venue inherits the session/group venue; explicit empty text selects the default list. Manual Finish/reopen requires an active Daily timer and complete current checklist. It replaces an unconfirmed candidate with the new Finish tap time, so Go back leaves timer running. If this session already finished, returns saved result without new points. Existing saved legacy session finish is never overwritten.

## confirm_daily_finish
Arguments: p_candidate_id uuid.
Returns persisted_result directly, unchanged for repeat calls:
{result_id,candidate_id,athlete_id,rider_name,session_id,group_session_id,venue,local_date,seconds,completed_at,completion_points,completion_xp,point_awards:[{label,points}],previous_pb_seconds,pb_seconds,is_new_pb,is_first_pb,pb_comparable:true,weekly_score,rank_number,completed_count,total_count}.
PB comparison uses same venue + exact normalized assigned Daily list/reps signature (order independent); an old scalar profile PB has no list provenance and is preserved but not falsely compared. First comparable result is first PB.
Completion points preserve current +1 list, +1 under 20 minutes, +1 first confirmed group finisher rules, same award keys. 35 completion XP still uses same key; existing global PB XP rule is preserved. Group-first is serialized. Results idempotent across coach/rider simultaneous confirmation. No training session ended_at write.

## get_today_training_progress
Arguments: p_athlete_id uuid.
Returns {athlete_id,rider_name,local_date,timezone,daily_results:[],completed_categories:[{category,items:[{id,trick_name,completed_at,venue}]}],today_points,today_xp,weekly_score,rank_number,improvements:[],next_goal,no_data}.
Local day uses existing rider-country timezone mapping (same as scoring), not viewing coach timezone. Daily results include confirmed results and labeled legacy saved times; read never finalizes unfinished ticks. Activity deduplicated by assignment/source; tombstones/corrections excluded. Points/XP use persisted award-ledger timestamps only (and labelled attributable score adjustments), not inferred session totals; weekly score from existing authoritative leaderboard. improvements only supported saved PB results, next_goal from remaining assigned training. No total duration/session-end.


## Review decisions and edge cases

- start_daily_tricks(p_venue text default '') is rider-only and returns the training_sessions row, now with nullable daily_venue metadata. A fresh local day or a different venue after a saved Daily result creates a new row; old rows/results stay intact and ended_at is never forced. Same venue/day reuses its row. An unfinished other-venue timer must be completed at that venue first.
- New landed Daily actions require an active rider-local-day timer; corrections remain possible. Every Daily landing must have durable evidence at/after that timer's start for a new time/PB. Earlier ticked lists stay saved but must be unticked and completed again to record a valid timed result. No fabricated zero-second result or untimed Daily award is generated from pre-ticked lists.
- A zero-second result is still a valid integer if all actual taps occur inside the first clock second; clients must use null checks instead of truthiness.
- Group timing preserves the existing shared group start minus pauses, with independent per-rider finish timestamps. The once-per-group bonus goes to the first **confirmed** finish; pending candidates are not finishes. Eligibility is captured on the final tap, so pausing while reading the popup does not alter under-20/first-finish eligibility.
- Local day uses the existing saved-country timezone mapping. This does not infer an individual's timezone from their device or travel location.
- Client tap timestamps are trusted only within 30 seconds before server arrival; clock skew or longer offline delivery uses server arrival. The confirmation popup delay is always excluded.
- Existing global profile PBs and legacy saved results remain intact. Existing authorized linked-coach manual PB edits still work. A direct old-app write to Daily timing/PB columns is rejected; confirm_daily_finish is the athlete's authoritative save path.
- The rider-to-coach Daily-completed push is queued only after a successful saved confirmation with the existing dedupe key and notification preferences. No notifications were sent by this review work.
- Today category items and next_goal also include notes for presentation of legacy Lines; the private summary may reconstruct the line, while the share image uses only trick_name and never text derived from notes.

## Local validation

Run: JKCREW_PGLITE_PATH=/path/to/@electric-sql/pglite node tests/daily-completion-db.cjs
The test starts from read-only retrieved production function definitions and reproduces the old auto-awards before applying this isolated migration. It checks actual transaction rollback, repeat coach/rider confirms, corrections, timing/PB compatibility, per-venue scoring, first-confirmed group awards, Daily-only XP/push behavior, untouched untimed scoring, day boundaries and authorization. The PGlite harness serializes requests. Separately, tests/daily-concurrency-postgres.cjs passed on PostgreSQL 17.11 with nine independent psql connections and verified lock waits. It covers duplicate coach/rider confirmations, competing group bonuses and both correction/confirmation orderings. That test database was removed and its temporary server stopped. No real rider data was changed by testing.

XP attribution: when a ledger entry created before today was revised today, the existing table has no durable delta. Today returns today_xp:null, attributable_today_xp for safely dated entries, xp_attribution:'partial', and xp_attribution_note. It never reports the whole revised historical balance as newly earned today. Untouched/entirely today entries return a numeric today_xp with xp_attribution:'complete'. Existing removed historical ledger entries cannot be reconstructed; this is attributable earned XP, not an inferred balance change.
