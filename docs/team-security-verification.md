# Coach approval and private teams

The existing Auth user and profile identities remain in use. Coach approval is a server-controlled state in `private.coach_account_access`; new non-owner coaches begin pending. The platform owner keeps an approved coaching membership in their own team.

Purchasing-team membership is held separately from countries and from existing coach-owned training groups. Country labels never grant access. A new head coach starts a separate team. Additional coaches redeem a one-use, role-specific invitation from that team's approved head coach. An invitation does not bypass platform approval. Its creator must still hold the required active membership when the code is redeemed.

The platform-owner overview returns coach account details and distinct student counts. It has no student-detail drill-down. Platform-owner status does not bypass normal team authorization, including when an owner supplies a foreign student UUID directly.

## Enforcement

- Restrictive RLS applies to direct application tables and private Storage objects. Foreign-key guards prevent combining an authorized rider with another team's assignment, event, session, run, or parent account. Tracker rider arrays receive their own guard.
- Existing privileged RPCs retain their signatures and defaults. Approval wrappers check every request, and resource parameters are authorized before the existing implementations run. Global reports filter the team before calculating ranks, aggregates, or pagination.
- Coaches approved for the same team share roster links. Additions, edits, renamed groups and removals propagate consistently. Existing authored team data cannot be carried into a different team by accepting another invitation.
- Events and active challenges have team-specific uniqueness. Imported official calendar dates remain shared, while each team's calendar instance and attendance remain private.
- Park champions are calculated separately from each team's award history, even when teams use the same park name. Legacy global history is retained; new private snapshots use a team-and-venue key.
- Notifications validate authoritative source records at insertion, historical read, queue claim, and delivery. Old global rank notifications/posts are hidden unless their ranks were produced with team scoping. The push worker revalidates before sending to each device.
- Profile showreels use private Storage and authorized signed URLs. Private database schemas are not exposed through PostgREST.
- Student and parent admission codes are role-specific and one-use. Joining a team does not create a parent-child link automatically. Account deletion checks the caller's team, revokes the target's sessions, and then uses Auth deletion.

## Verification

Synthetic PostgreSQL tests cover pending approval, malicious profile bootstrap, foreign UUID reads and writes, same-country isolation, invitation reuse and lifecycle checks, shared roster changes, parent admission, Storage paths, queue delivery, independent park champions, and unchanged points.

Run with `JKCREW_PGLITE_PATH` pointing to an installed `@electric-sql/pglite` package:

```sh
node tests/coach-approval-db.cjs
node tests/coach-team-scope-db.cjs
node tests/shared-coach-schedule-saves.cjs
node tests/tenant-notification-scope.cjs
node tests/tenant-park-crown.cjs
```

The complete migration was also compiled with function-body checking enabled against a local schema-only copy of the live table and function definitions. Actual report implementations were exercised with synthetic independent teams: both teams received their own number-one rank and park champion; creating a challenge did not archive the other team's challenge.

Full-week and Lines edits by a colleague retain existing assignment IDs and completed progress. Draft initialization and planned-week updates leave one team plan, with the same rider/week transaction lock used by every editor. Manual Tricktionary classifications share one team catalogue. Deleting an admitted family account clears the invitation's recipient foreign key while retaining its consumed timestamp.

After deployment, transaction-rollback probes verified that an approved foreign coach still received no owner-team events, scores, riders, battles, attendance, media or private calendar links. A temporary foreign student was visible only as an aggregate count to the platform owner. With two approved coaches on one synthetic team, the real leaderboard retained one rider and the original point total, and attendance remained one row.

Before/after hashes of all existing point awards, sessions, weekly assignments and progress rows matched. Synthetic production probes were rolled back and left no accounts or approvals behind. The owner retained every existing linked rider and event.

Security advisories were reviewed after deployment. The intentionally guarded authenticated RPCs remain security definers; private tables without client policies intentionally deny direct access. Legacy anonymous trigger-function grants and mutable helper search paths were removed. The existing Auth leaked-password-protection setting was not changed.
