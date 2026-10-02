// Genuine independent PostgreSQL backends against a disposable /tmp-socket DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, literal, json } = require('./helpers/local-postgres.cjs');
const h=createHarness('scheduled_battle_rewards');
const root=path.resolve(__dirname,'..');
const migration=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const coach=uid(1),winner=uid(100),loser=uid(101);
const auth=id=>`select set_config('request.jwt.claim.sub',${literal(id||'')},true);`;
const scalar=sql=>h.batch(sql).split('\n').at(-1);
const rows=sql=>json(h.batch(`select coalesce(jsonb_agg(t),'[]') from (${sql}) t`));
let checks=0;
function create(){
 h.batch('truncate weekly_rider_battles,assignment_point_awards,leaderboard_point_adjustments,push_notification_queue cascade;');
 return scalar(`with b as (insert into weekly_rider_battles(challenger_id,opponent_id,created_by,week_start,battle_size,team_count,reward_points,status,starts_at,ends_at)
 values(${literal(winner)},${literal(loser)},${literal(coach)},current_date,1,2,5,'accepted',now()-interval '1 day',now()-interval '1 minute') returning id), p as (
 insert into weekly_rider_battle_participants(battle_id,athlete_id,team_number,response)
 select b.id,${literal(winner)}::uuid,1,'accepted' from b union all select b.id,${literal(loser)}::uuid,2,'accepted' from b), a as (
 insert into assignment_point_awards(athlete_id,points,created_at) values(${literal(winner)},8,now()-interval '12 hours'),(${literal(loser)},4,now()-interval '12 hours')) select id from b;`);
}
function settled(id){
 assert.equal(scalar(`select status from weekly_rider_battles where id=${literal(id)}`),'completed');
 assert.deepEqual(rows('select athlete_id,points from leaderboard_point_adjustments order by points desc'),[{athlete_id:winner,points:5},{athlete_id:loser,points:-5}]);
 assert.equal(scalar("select count(*) from push_notification_queue where notification_type='rider_battle_result'"),'2');
}
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'battle-team-sizes-db.cjs'),'utf8');
 await h.adapter.exec(source.match(/await db\.exec\(`\n([\s\S]*?)\n  `\);/)[1]);
 await h.adapter.exec('create role service_role;');
 for(const name of ['20260907212548_three_sided_rider_battles.sql','20260907212718_private_three_sided_battle_creation.sql','20260911042341_expand_rider_battles_to_six_per_team.sql','20260914101000_support_five_point_stakes_for_large_teams.sql','20260915095056_battle_day_score_allocations.sql','20260921115318_unequal_two_rider_battles.sql'])h.batch(migration(name));
 h.batch(`create schema cron; create table cron.job(jobname text primary key,schedule text,command text);
 create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values($1,$2,$3) on conflict(jobname) do update set schedule=$2,command=$3;return 1;end$$;
 revoke all on function public.settle_expired_rider_battles() from public,anon,authenticated;
 grant execute on function public.settle_expired_rider_battles() to service_role;
 grant usage on schema auth,private to authenticated;
 insert into profiles(id,role,display_name) values(${literal(coach)},'coach','Coach'),(${literal(winner)},'athlete','Winner'),(${literal(loser)},'athlete','Loser');
 insert into coach_athletes values(${literal(coach)},${literal(winner)}),(${literal(coach)},${literal(loser)});`);
 h.batch(migration('20261002080151_schedule_rider_battle_settlement.sql'));
 const a=h.connect('cron_worker'),b=h.connect('battle_feed');
 await test('scheduled worker and rider feed overlap without duplicate payout',async()=>{
  const id=create();assert.equal(await a.query('begin; select private.settle_expired_rider_battles();'),'1');
  const before=json(await b.query(`begin; ${auth(winner)} set local role authenticated; select public.get_my_rider_battles(); commit;`));
  assert.equal(before[0].status,'accepted','Feed sees old committed status while worker owns settlement row');
  await a.query('commit;');settled(id);
  const after=json(await b.query(`begin; ${auth(winner)} set local role authenticated; select public.get_my_rider_battles(); commit;`));
  assert.equal(after[0].status,'completed');settled(id);
 });
 await test('rider feed holding settlement causes scheduler to skip the locked battle',async()=>{
  const id=create();const feed=json(await b.query(`begin; ${auth(winner)} set local role authenticated; select public.get_my_rider_battles();`));
  assert.equal(feed[0].status,'completed');assert.equal(await a.query('select private.settle_expired_rider_battles();'),'0');
  await b.query('commit;');settled(id);
 });
 await test('two independent cron workers settle a single battle once',async()=>{
  const id=create();assert.equal(await a.query('begin; select private.settle_expired_rider_battles();'),'1');
  assert.equal(await b.query('select private.settle_expired_rider_battles();'),'0');
  await a.query('commit;');assert.equal(await b.query('select private.settle_expired_rider_battles();'),'0');settled(id);
 });
 await test('worker rollback leaves battle payable by another backend',async()=>{
  const id=create();assert.equal(await a.query('begin; select private.settle_expired_rider_battles();'),'1');
  assert.equal(await b.query('select private.settle_expired_rider_battles();'),'0');await a.query('rollback;');
  assert.equal(scalar('select count(*) from leaderboard_point_adjustments'),'0');
  assert.equal(await b.query('select private.settle_expired_rider_battles();'),'1');settled(id);
 });
 await test('forfeit waits for scheduled settlement and cannot replace the completed winner',async()=>{
  const id=create();assert.equal(await a.query('begin; select private.settle_expired_rider_battles();'),'1');
  const c=h.connect('racing_forfeit');
  const forfeit=c.query(`begin; ${auth(winner)} set local role authenticated; select public.forfeit_rider_battle(${literal(id)}); commit;`);
  const expected=assert.rejects(forfeit,/Only a live battle/);
  await h.waitLock(c);await a.query('commit;');await expected;settled(id);
 });
 console.log(`${checks} genuine PostgreSQL concurrent battle scheduler cases passed`);
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>h.close());
