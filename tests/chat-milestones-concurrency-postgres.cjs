// Real independent PostgreSQL connections; disposable database on a /tmp socket only.
// Supply JKCREW_PG_BIN, JKCREW_PG_SOCKET and optionally JKCREW_PG_PORT.
const assert = require('node:assert/strict');
const { createHarness, json } = require('./helpers/local-postgres.cjs');
const { initialize, id, migration } = require('./chat-milestones-db.cjs');
async function run() {
  const h = createHarness('chat_milestones');
  let checks = 0;
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const score = (rider, points) => `insert into assignment_point_awards(athlete_id,points) values('${id(rider)}',${points});`;
  const scalar = sql => h.batch(sql).split('\n').at(-1);
  const events = () => json(h.batch("select coalesce(jsonb_agg(jsonb_build_object('author',author_id,'type',metadata->>'event_type') order by author_id),'[]') from crew_posts;"));
  const reset = () => {
    h.batch(`truncate assignment_point_awards,leaderboard_point_adjustments,leaderboard_rank_snapshots,
      private.crew_leaderboard_snapshots,crew_posts,private.crew_milestone_receipts,push_notification_queue,
      weekly_rider_battle_participants,weekly_rider_battles;
      alter table assignment_point_awards disable trigger user;
      ${score(1,40)} ${score(2,30)} ${score(3,10)}
      alter table assignment_point_awards enable trigger user;
      select private.refresh_jkcrew_leaderboard_push_snapshots('${id(1)}','seed');
      select private.refresh_crew_milestone_snapshots('${id(1)}','seed');
      truncate crew_posts,private.crew_milestone_receipts,push_notification_queue;`);
  };
  const createBattle = n => h.batch(`insert into weekly_rider_battles(id) values('${id(n)}');
    insert into weekly_rider_battle_participants(battle_id,athlete_id,team_number,is_winner,points_delta)
      values('${id(n)}','${id(1)}',1,true,5),('${id(n)}','${id(2)}',2,false,-5);`);
  const finish = n => `update weekly_rider_battles set status='completed',winning_team=1 where id='${id(n)}';`;
  try {
    await initialize(h.adapter);
    for (let n = 1; n <= 4; n++) h.batch(`insert into profiles(id,display_name) values('${id(n)}','${['Ava','Bea','Cam','Dee'][n-1]}');`);
    h.batch('begin;\n' + migration + '\ncommit;');
    const a = h.connect('coach_save');
    const b = h.connect('rider_save');
    reset();
    eq(scalar("select count(*) from pg_trigger where tgname in ('crew_rank_awards_milestone','crew_rank_adjustments_milestone','crew_rank_sessions_milestone') and tgdeferrable and tginitdeferred;"), '3', 'All three new score publishers defer their locks until commit');
    await a.query('begin;' + score(3,25));
    eq(scalar('select count(*) from crew_posts;'), '0', 'Uncommitted score emits no chat post');
    const otherScore = b.query('begin;' + score(4,32));
    await h.waitLock(b);
    await a.query('commit;');
    await otherScore;
    await b.query('commit;');
    eq(events(), [{author:id(3),type:'leaderboard_overtake'},{author:id(4),type:'leaderboard_overtake'}], 'Two overlapping score gains preserve both genuine overtakes once');
    eq(scalar('select count(*) from private.crew_milestone_receipts;'), '2', 'Each concurrent movement has one durable receipt');
    eq(json(h.batch('select jsonb_agg(jsonb_build_object(\'rider\',athlete_id,\'points\',weekly_points,\'rank\',rank_number) order by rank_number) from private.crew_leaderboard_snapshots;')),
      [{rider:id(1),points:40,rank:1},{rider:id(3),points:35,rank:2},{rider:id(4),points:32,rank:3},{rider:id(2),points:30,rank:4}], 'Private snapshot includes both committed scores');
    await a.query(`begin;select private.refresh_crew_milestone_snapshots('${id(3)}','retry');`);
    const retry = b.query(`begin;select private.refresh_crew_milestone_snapshots('${id(4)}','retry');`);
    await h.waitLock(b); await a.query('commit;'); await retry; await b.query('commit;');
    eq(scalar('select count(*) from crew_posts;'), '2', 'Parallel unchanged refresh retries cannot duplicate overtakes');

    reset(); createBattle(60);
    await a.query('begin;' + finish(60));
    const resultRetry = b.query('begin;' + finish(60));
    await h.waitLock(b); await a.query('commit;'); await resultRetry; await b.query('commit;');
    eq(events(), [{author:id(1),type:'battle_result'}], 'Two simultaneous result updates publish one battle result');
    eq(scalar("select count(*) from private.crew_milestone_receipts where event_key='battle:" + id(60) + "';"), '1', 'Concurrent battle result has one receipt');
    eq(scalar('select sum(points_delta) from weekly_rider_battle_participants;'), '0', 'Chat publication leaves the persisted battle point split intact');

    reset(); createBattle(61);
    await a.query('begin;' + finish(61));
    eq(await a.query('select count(*) from private.crew_milestone_receipts;'), '1', 'Result and receipt are visible inside their own transaction');
    await a.query('rollback;');
    eq(scalar('select count(*) from private.crew_milestone_receipts;'), '0', 'Rolled-back result leaves no receipt');
    eq(scalar('select count(*) from crew_posts;'), '0', 'Rolled-back result leaves no public announcement');
    await b.query(finish(61));
    eq(events(), [{author:id(1),type:'battle_result'}], 'A later successful settlement can publish after rollback');
    await a.query('begin;' + score(3,100)); await a.query('rollback;');
    eq(scalar("select count(*) from crew_posts where metadata->>'event_type'='rank_one';"), '0', 'Aborted score cannot announce a new leader');
    eq(scalar(`select weekly_points from private.crew_leaderboard_snapshots where athlete_id='${id(3)}';`), '10', 'Aborted score leaves the prior chat ranking intact');

    // Isolate the new chat lock from the unchanged legacy push-snapshot row
    // locking. This reproduces the challenge-lock/chat-lock ordering identified
    // during review without conflating it with the old push implementation.
    reset();
    h.batch('alter table assignment_point_awards disable trigger score_snapshot;alter table leaderboard_point_adjustments disable trigger adjustment_snapshot;');
    const challengeLock = `select pg_advisory_xact_lock(hashtextextended('weekly-challenge:${id(50)}:${id(3)}',0));`;
    await a.query('begin;' + challengeLock);
    await b.query('begin;' + score(4,32));
    eq(await b.query("select count(*) from pg_locks where pid=pg_backend_pid() and locktype='advisory';"), '0', 'A mid-save score has not taken the global chat lock');
    const awaitingChallenge = b.query(challengeLock);
    await h.waitLock(b);
    await a.query(score(3,25) + 'commit;');
    await awaitingChallenge;
    await b.query('commit;');
    eq(events(), [{author:id(3),type:'leaderboard_overtake'},{author:id(4),type:'leaderboard_overtake'}], 'Opposite challenge-lock order completes both scoring saves without a chat-lock inversion');
    eq(scalar('select count(*) from private.crew_milestone_receipts;'), '2', 'Mixed challenge/scoring lock flow preserves exactly two milestones');
    eq(/deadlock|skipped|timeout/i.test(a.errors + b.errors), false, 'No deadlock or silently skipped announcement warnings');
    console.log(`PASS ${checks} real PostgreSQL chat concurrency, deferred-lock, retry and rollback checks.`);
  } finally { await h.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
