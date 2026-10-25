# Battle scoring correction — 25 October 2026

An earlier battle's reward was being counted in an overlapping battle. The active
Lars/Koby versus Duke/Felix battle showed 5–0 even though none of its participants
had scored training points during its window. The five points came from a genuine
earlier result; the active battle had not paid any reward.

Both full-window and day-allocation score helpers now exclude adjustments whose
reason starts with `Rider battle `. Training awards, approved extras, weekly
challenge bonuses and ordinary corrections retain their existing behavior.
Existing pending/active battles and future battles use this rule, including after
they finish. A per-battle flag preserves the calculations of already completed
battles. No leaderboard adjustments are removed or rewritten.

## Verification and deployment

- `tests/battle-reward-score-isolation.cjs`: 11 isolated PostgreSQL/PGlite scenarios
  passed. Covers the reproduced reward leak, old losses, forfeits, score windows,
  day allocations, coach/rider/spectator feeds, future requests and acceptance,
  settlement, draws, repeated settlement, existing history and denied client writes.
- Independent migration review found no actionable issues.
- Applied `20261025014336_exclude_battle_rewards_from_live_scores.sql` to production.
- Read-only production coach and rider feeds both returned 0–0 for the active
  battle after deployment. All four contributions and payout fields were zero;
  status and start/end times stayed unchanged.
- Before/after fingerprints matched for all 96 point adjustments and all 65
  completed participant score/outcome records.
- Security advisor findings were unchanged; no permissions or public APIs added.

This is a backend-only release. Client version 2.14.174 and its installed-app cache
remain unchanged. Existing battle refresh controls and automatic refresh load the
corrected scores without an app update.
