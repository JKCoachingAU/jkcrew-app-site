# Release 2.14.136

Tier 2 now recognises riders who save an incomplete Daily result and then land every remaining trick that day. The server verifies the same list, venue, current ticks and durable landing evidence. Identical lists copied into a new week and ended training sessions are supported. The original partial receipt, timing, points, XP and PB remain unchanged.

After a successful later Daily tick, the rider and coach session views immediately check authoritative Tier 2 eligibility and present the existing unlock celebration and saved list. Existing refresh recovery and once-per-day reveal/reward controls remain in place.

Validation completed before publishing:

- 142 database checks for Tier 2 eligibility, evidence, permissions, reset/history, immutable receipts and exactly-once rewards.
- 150 existing partial Daily regression checks.
- 66 assertions across eight real PostgreSQL concurrency races using 17 independent connections, including final tick versus unlock and simultaneous rider/coach unlocks.
- 95 mobile handoff, 42 team-session and 35 Tier 2 UI checks; existing Daily completion browser suite passed.
- Syntax and smoke checks; local production and Riley entry points loaded without application errors or missing assets.

Migration `20260920081607_qualify_tier_two_after_partial_daily.sql` applied successfully. Production read-back confirmed the reported rider's completed list qualifies while her original partial result is unchanged. No progress, awards or reveal claims were manually created. Security advisor findings are unchanged; the new helper has no anonymous or authenticated execution grant.
