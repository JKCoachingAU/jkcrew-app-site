# JKCREW 2.14.193

The Coach Tools → Session Viewer now loads a lightweight roster summary first. Full percentage attempts, assignment attempts and recent award data are fetched only for the rider whose card is open. Cached summary/detail reads are reused for filter and list-tab changes, so switching between Daily Tricks, Dialled, Lines and other lists no longer re-reads the whole team.

The renderer also tolerates a missing rider display name instead of breaking the entire session page. The Supabase summary RPC preserves current-week list rollover and venue fallback behaviour; the existing detailed RPC remains scoped to the selected rider.

Verification: Session Viewer counter/location tests, the new summary/detail traffic regression test, the team-session completion regression, loading-performance checks and smoke checks passed. The team-session fixture was updated to include the `trick_links` category used by current lists; no production data was changed.
