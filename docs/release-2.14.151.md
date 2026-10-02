# JKCREW 2.14.151 — Daily simplification and reliable rewards

Tier 2 Daily Tricks has been retired from rider sessions, coach sessions and list
editors. Standard Daily completion, partial finishes and existing point rules
remain. Older installed clients cannot unlock or award new Tier 2 rounds. Saved
history and all previously earned Tier 2 points remain intact.

Weekly challenge bonuses previously depended on opening the Challenges screen.
Qualifying training now awards the existing bonus in the same database transaction,
including coach-entered results and perfect Percentage sets. Authorization,
scoring pauses, challenge dates and team eligibility are enforced. Concurrent
devices and retries share one durable completion and reward. The existing screen
also retains its recovery path.

Challenge completion labels now require the server's confirmed completion. The
celebration uses the actual notification reward instead of always displaying +5.

Battle settlement previously waited for a battle-page visit. A private owner-only
worker now runs each minute using the existing scheduler. Payout splits, draws,
forfeits and permissions are unchanged. A production audit of 16 completed battles
and 53 participant results found no missing or duplicate payouts; a roughly
4-hour-44-minute settlement delay was verified.

## Verification

- 41 database checks cover Tier 2 retirement, stale clients, preserved records,
  authorization and unchanged standard Daily points.
- Daily browser checks cover full/partial completion, coach/rider team sessions,
  failed saves and retries. Additional suites passed 24 feature integration,
  24 team-session, 51 list-save and all-role navigation checks.
- 49 challenge database checks, 9 native PostgreSQL concurrency checks and
  18 integration checks using the deployed scoring functions passed. This
  reproduces the old missed-award behavior and checks exact normal-plus-bonus
  totals, retry safety and access restrictions after the fix.
- 16 browser checks verify authoritative challenge rewards, +5/+10 notifications
  and small-screen layouts at 320, 390 and 820 pixels.
- 23 battle database cases and 5 native PostgreSQL concurrency cases passed,
  including scheduler/feed races, rollback recovery, unequal teams and forfeits.
- Release smoke, loading-performance and 50 installed-app update checks passed.
  Root and Riley runtime assets ship together as 2.14.151.

## Production checks

Applied migrations:

- `20261002080052_retire_daily_tier_two`
- `20261002080137_auto_award_weekly_challenge_rewards`
- `20261002080151_schedule_rider_battle_settlement`

Postflight confirms the new scoring triggers are enabled, internal helpers deny
anonymous/authenticated direct execution, and the scheduled battle job runs
successfully as the database owner. Security advisories show no new findings.
All 16 historical Tier 2 awards (64 points), 28 rounds and 3 templates remain.

One missing historical +5 challenge reward was recovered from retained landing
evidence. The original trick award, earning timestamp and original weekly bucket
were preserved; the correction was checked against both completion and ledger
records. Other existing challenge awards were consistent. Missing or replaced
historical evidence cannot establish further entitlement, so no rewards were
invented from incomplete history.

Removing the Tier 2 initial assets and integration reduces uncompressed initial
runtime assets by approximately 48 KB and eliminates its polling. This is a local
asset-size measurement, not a measured mobile data or FPS improvement. No new
service or recurring cost was introduced. Physical installed iOS/Android update
behavior still needs a real-device check; browser update behavior was tested.
