const assert=require('node:assert/strict');
const {createHarness,literal,json}=require('./helpers/local-postgres.cjs');
const {initialize,id,migration}=require('./challenge-rewards-db.cjs');
async function run(){const h=createHarness('challenge_rewards');let checks=0;
 const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
 const auth=n=>`select set_config('request.jwt.claim.sub',${literal(id(n))},false);set role authenticated;`;
 const land=n=>`insert into assignment_progress(assignment_id,athlete_id,completed_at) values('${id(n)}','${id(10)}',now()) on conflict(assignment_id) do update set completed_at=excluded.completed_at;`;
 try{
  await initialize(h.adapter);h.batch(migration);
  h.batch(`insert into profiles(id,role) values('${id(1)}','coach'),('${id(10)}','athlete');insert into coach_athletes values('${id(1)}','${id(10)}');
   insert into weekly_challenges(id,title,category,target_count,reward_points,starts_at,ends_at,created_by) values('${id(50)}','Concurrent challenge','dialled',2,5,now()-interval '1 hour',now()+interval '1 day','${id(1)}');
   insert into weekly_trick_assignments(id,athlete_id,category) values('${id(100)}','${id(10)}','dialled'),('${id(101)}','${id(10)}','dialled');`);
  const a=h.connect('rider'),b=h.connect('coach');
  await a.query(auth(10));await b.query(auth(1));
  await a.query('begin;'+land(100));
  eq(h.batch('select count(*) from weekly_challenge_completions;'),'0','First of two tricks does not award');
  const final=b.query('begin;'+land(101));await h.waitLock(b);
  await a.query('commit;');await final;await b.query('commit;');
  eq(h.batch('select count(*) from weekly_challenge_completions;'),'1','Simultaneous distinct final tricks produce one completion');
  eq(h.batch('select sum(points) from leaderboard_point_adjustments;'),'5','Second statement refreshes snapshot after serialized first commit');
  eq(h.batch('select count(*) from notification_fixture;'),'1','One notification for simultaneous completion');
  await a.query('begin;'+land(100));const repeated=b.query('begin;'+land(101));await h.waitLock(b);await a.query('commit;');await repeated;await b.query('commit;');
  eq(h.batch('select count(*) from leaderboard_point_adjustments;'),'1','Parallel repeated taps cannot award twice');
  eq(json(await a.query('select get_my_weekly_challenge();')).new_award,false,'Later screen request stays idempotent');
  eq(json(await a.query('select get_my_weekly_challenge();')).completed,true,'Later screen shows persisted award');
  // Two different final perfect sets finish together without opening Challenges.
  h.batch(`delete from weekly_challenge_completions;delete from leaderboard_point_adjustments;delete from notification_fixture;
   update weekly_challenges set category='percentage',completion_rule='percentage_perfect',reward_points=10;
   update weekly_trick_assignments set category='percentage';
   insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed) select a.id,a.athlete_id,i,true from weekly_trick_assignments a cross join generate_series(1,9)i;`);
  const attempt=n=>`insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed) values('${id(n)}','${id(10)}',10,true);`;
  await a.query('begin;'+attempt(100));const lastAttempt=b.query('begin;'+attempt(101));await h.waitLock(b);await a.query('commit;');await lastAttempt;await b.query('commit;');
  eq(h.batch('select sum(points) from leaderboard_point_adjustments;'),'10','Parallel final perfect sets get correct +10');
  eq(h.batch('select count(*) from weekly_challenge_completions;'),'1');
  console.log(`PASS ${checks} real PostgreSQL challenge race checks across separate rider and coach connections`);
 }finally{await h.close();}}
run().catch(e=>{console.error(e);process.exitCode=1;});
