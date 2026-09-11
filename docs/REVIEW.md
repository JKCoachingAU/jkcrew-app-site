# JKCREW review — Daily progress and rematches

Prepared version **2.14.93**, on branch `review/daily-progress-rematches`.

**Nothing has been deployed.** This is an isolated copy of JKCREW. The live 2.14.92 app, original checkout and real rider results are unchanged. No real battle invitations, posts or notifications were sent.

## What changed

### Daily Tricks

The rider's Session screen and each rider in the coach's Team Session Viewer now use the same finish confirmation. An actual final tick captures the candidate time before the request; reading the popup does not add to it. Loading, realtime updates and completed lists reopening never trigger the popup.

**Go back** keeps the ticks and timer. Correcting a trick invalidates the pending finish. **Finish Daily Tricks** reopens confirmation using the new tap time. **Yes — finish Daily Tricks** saves one authoritative result and the existing completion rewards in one transaction. Failed saves offer a retry of the same finish; double taps and repeated confirmations cannot add rewards again.

The saved result shows the rider, completion time, actual completion points, compatible PB, weekly score and rank when available. It includes reduced-motion support, **Keep riding**, and a branded **Share result** preview. One Bangs, Dialled, Lines and other training remain untimed and available.

**Today's Progress** is available without ending training. It brings together recorded activity from the rider's local day, Daily results, attributable points/XP, supported PB improvements and a next goal. It refreshes on opening, relevant recorded activity and returning to the tab. Share and Save Image produce a portrait PNG; sharing requires a separate user action.

### Battles

Completed battles have **Rematch**. It fills the previous teams, format, duration and points into the existing builder for review. Unavailable riders and changed eligibility are explained and checked again before Send. It supports the existing formats through 6v6v6, keeps participant acceptance and active-battle limits, and uses the existing invitation/scoring APIs.

A **suggested opponent** option uses comparable training points from the last seven days and explains the numbers. It does not infer skill or promise an evenly matched battle. The custom builder remains available. Opening a suggestion or rematch never sends or accepts an invitation.

## Review images

All images below use fictional test data.

| Preview | Image |
| --- | --- |
| Final-trick confirmation | [Phone confirmation](review-assets/daily-confirmation-phone.png) |
| Saved time, points and PB comparison | [Daily result](review-assets/daily-result-phone.png) |
| Separate coach/rider context | [Coach view](review-assets/daily-coach-context-tablet.png) |
| On-demand activity summary | [Today's Progress](review-assets/today-progress-phone.png) |
| Portrait sharing preview | [Share preview](review-assets/progress-share-phone.png) |
| Reviewed rider rematch | [Rider rematch](review-assets/battle-rematch-phone.png) |
| Reviewed coach rematch | [Coach rematch](review-assets/battle-rematch-coach-phone.png) |

## Validation

The existing production coach flow was inspected read-only. Rider and coach browser tests use actual application renderers and action handlers with isolated RPC fixtures. Database tests use PGlite with retrieved production function definitions and generated test records.

- `daily-completion-db.cjs`: reproduced the former automatic finish paths; tested confirmation-only rewards, final-tap timing, correction/reopen, rollback/retry, repeated coach/rider confirmation, point and XP rules, compatible/legacy PBs, independent rider finishes, pause during confirmation, per-venue results, pre-timer ticks, local-day boundaries, notification deduplication, read-only summaries and access controls.
- `daily-completion-ui.cjs`: rider/coach flows, Go back, corrections, manual reopening, failed save/retry, duplicate taps, queued rider confirmations, no render/realtime popup, navigation races, zero-second and legacy results, continued untimed training, timer cleanup, different venues and 320/390/1024px layouts.
- `progress-sharing.cjs`: privacy allowlist and adversarial coaching-note checks, multiple visits, refreshed day, access revocation, late responses, incomplete/legacy/partial-XP data, portrait PNG downloads, native-share success/cancellation fixtures, reduced motion and dark/light layouts.
- `battle-rematches.cjs`, `battle-rematches-db.cjs`, `battle-rematches-ui.cjs`: all existing team formats, correct team rotation, unavailable participants, active limits, recent-only suggestions, authorization, changed eligibility before Send and no automatic invitations.
- Existing regression checks passed for battle UI and team-size payouts, session setup, closed sections, coach challenges, save feedback, points receipts, private milestones, milestone and receipt UI, plus the application smoke and existing startup/cache integration checks.

The integration also mirrors the shared assets on the existing Riley test path and includes them in both service workers. The release number changed only in this unpublished copy.

## Decisions and limits to review

- Existing reward amounts and award keys remain: +1 Daily list, +1 within 20 minutes where eligible, and the once-per-group +1. With explicit confirmation, the group bonus goes to the first **confirmed** eligible finish. A pending popup earns nothing.
- PB comparisons require the same venue and normalized Daily list/reps. Existing scalar PBs and older results remain saved, but cannot establish a compatible historical comparison. The first result with that evidence establishes the comparable PB.
- Local day follows the app's existing saved-country timezone mapping. It does not infer a travelling rider's device timezone.
- Client tap timestamps are accepted within 30 seconds before server arrival. Invalid clocks or longer delays use server arrival; popup reading time is excluded. Offline attempts are not silently treated as saved.
- Daily ticks require an active timer. Older ticks recorded before that timer remain intact, but must be unticked and completed again before recording a valid timed finish. A second venue after finishing can start its own timer without rewriting the first result.
- If an older XP ledger row changes today without a recorded delta, the summary marks today's XP as unavailable rather than inventing an earned total. Legacy unattributable rewards are also shown as unavailable.
- Shared images use only approved result fields and trick names. They exclude coaching notes, even when notes contain part of a legacy Line, plus contact details and private run plans. The private summary can still reconstruct legacy Lines. Long images show a balanced selection and an explicit remaining count; the private summary lists all returned completions.
- Native sharing was tested with browser API fixtures, and real PNG downloads were verified. A physical iPhone/iPad share sheet has not been tested.
- PGlite serializes database requests. Transaction rollback, repeat requests, unique constraints and lock ordering were checked; simultaneous contention across separate PostgreSQL connections remains a staging check.

## Handoff

Review the two new SQL migrations together with the client changes. They have **not** been applied to Supabase. Publishing requires the new RPCs/nullable `daily_venue` column and the 2.14.93 client as one coordinated release: old direct Daily finish paths deliberately cannot bypass confirmation.

- [Daily database/API contract](daily-progress-api.md)
- [Progress and sharing integration](progress-sharing-integration.md)
- `supabase/migrations/20260911084911_add_read_only_battle_match_options.sql`
- `supabase/migrations/20260911085353_confirm_daily_tricks_and_today_progress.sql`

No general loading redesign or other requested app features were added in this review.
