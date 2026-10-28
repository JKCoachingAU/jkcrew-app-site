# Park crown scoring correction — 28 October 2026

Backend hotfix for the existing 2.14.182 app. A training session left open
across parks or riding days could transfer earlier points into another
park's record.

The crown now uses one rider's score from one session, park and local
award date. Daily completion remains capped at one park point. Timed,
first-finisher, battle and challenge bonuses do not increase a park record.
The earlier tied score retains the crown. Legacy awards without a venue
are included only when their session and day identify one park.

The migration quietly recalculates the saved crown list. It preserves
earned points, weekly leaderboards, XP, sessions, timing and historical
notifications. Short transaction locks prevent an older in-flight score
calculation from overwriting the corrected cache. Existing authenticated
RPCs and King/Queen titles remain unchanged.

Validation:
- 39 database regressions, including reproduction of cross-venue inflation,
  stale multi-day sessions, local midnight, separate sessions, legacy data,
  daily caps, ties, permissions and quiet idempotent backfill.
- Existing 49 crown-title database checks and 268 browser checks passed.
- Release smoke checks passed.
- Production coach and rider RPC reads agree with the repaired snapshot.
  All saved park records agree with a fresh calculation.
- Production hashes confirm no changes to 1,333 earned-point awards,
  1,078 XP records, 568 sessions, 23 historical crown events or 697 crown
  notifications. No new security-advisor findings.
- The production Oasis lookup completed in about 32 ms in one measured run.

The frontend assets are unchanged, so installed users do not need a new
download. Reloading an already-open screen refreshes its in-memory crown.
