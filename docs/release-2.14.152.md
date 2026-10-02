# JKCREW 2.14.152 — Quieter crew chat

Automatic chat updates are limited to leaderboard overtakes, a new crew leader,
successful weekly challenge completions and completed battle results. Individual
trick landings and park-champion announcements no longer enter chat. Existing
riding records and historical posts remain stored.

The message query and unread badge share the same event filter, applied before
the message limit. Old trick announcements no longer fill the latest-message
window or badge. Muted realtime events do not rerender an open conversation.
Ordinary messages, coach announcements, videos and their notification preferences
remain supported. The legacy crew feed no longer includes raw landing activity.

Leaderboard milestones require a genuine points lead, avoiding announcements for
alphabetical tie breaks or weekly resets. Battle messages use the recorded final
result and are deduplicated; payouts and challenge scoring are unchanged.

Both entry points ship as 2.14.152 with separate service-worker cache namespaces.

## Verification

- 70 isolated database checks cover exact rank crossings, ties, resets, new
  riders, ghost privacy, weekly challenges, 2-v-1/three-team/drawn battles,
  retries, bounded messages and permission checks.
- 19 native PostgreSQL checks cover simultaneous score gains and battle results,
  rollback recovery and the new deferred publisher's challenge-lock ordering.
- 33 browser checks cover message filtering before pagination, unread counts,
  realtime behavior, preserved drafts, manual messages and video posts.
- Release smoke, loading-performance and all 50 installed-app update checks pass.
  The exact JSON-path filter also parses successfully against the live REST API.

## Production verification

Applied `20261002235311_crew_chat_milestones_only`. All three old noisy/rank-row
triggers are absent; all three deferred score hooks are enabled. Thirty private
rank baselines were seeded without posting historical announcements. The coach
feed returns 47 retained messages, including all 18 manual messages, and no raw
landings or old first-trick announcements. All 263 historical posts remain stored.

Point totals and records are unchanged: 1,063 normal awards, 82 adjustments, four
challenge completions and 16 completed battles. Internal publisher and receipt
access is denied to client roles. The security scan has no new warnings; its two
new informational findings reflect intentionally inaccessible private tables with
RLS enabled and no client policies. No test messages were posted to production.

Physical-device push delivery was not tested. Existing personal notification
preferences and delivery paths are unchanged; this release changes automatic
chat announcements and their unread badge.
