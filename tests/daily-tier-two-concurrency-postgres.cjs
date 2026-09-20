const assert=require('node:assert/strict');
const {createHarness,literal:q,json}=require('./helpers/local-postgres.cjs');
const {initializeTierTwo,id}=require('./daily-tier-two-db.cjs');
(async()=>{
 const pg=createHarness('tier_two_races');let checks=0;
 const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
 const actor=(n,sql)=>`select set_config('request.jwt.claim.sub',${q(id(n))},false);set role authenticated;${sql}`;
 const call=(name,args)=>`select public.${name}(${args.map(q).join(',')});`;
 try{
  await initializeTierTwo(pg.adapter);
  pg.batch(`insert into profiles(id,role,display_name) values(${q(id(1))},'coach','Coach One'),(${q(id(2))},'coach','Coach Two'),(${q(id(10))},'athlete','Race Rider');
    insert into coach_athletes values(${q(id(1))},${q(id(10))}),(${q(id(2))},${q(id(10))});
    insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select ${q(id(101))},${q(id(1))},${q(id(10))},week_start_date,'Bunny hop','daily','Test park' from jkcrew_week_bounds('AU');
    insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select ${q(id(102))},${q(id(1))},${q(id(10))},week_start_date,'Manual','daily','Test park' from jkcrew_week_bounds('AU');
    insert into training_sessions(id,athlete_id,started_at,daily_venue) values(${q(id(1000))},${q(id(10))},greatest(now()-interval '5 minutes',date_trunc('day',now() at time zone 'Australia/Brisbane') at time zone 'Australia/Brisbane'),'Test park');`);
  pg.batch(actor(10,call('record_daily_trick_action',[id(101),'landed','Test park'])));
  const c=json(pg.batch(actor(10,call('record_daily_trick_action',[id(102),'landed','Test park'])))).completion_candidate;
  pg.batch(actor(10,call('confirm_daily_finish',[c.candidate_id])));
  async function race(name,firstActor,firstSql,secondActor,secondSql){
    const a=pg.connect(name+'_a'),b=pg.connect(name+'_b');
    const first=json(await a.query('begin;'+actor(firstActor,firstSql)));
    const waiting=b.query('begin;'+actor(secondActor,secondSql));await pg.waitLock(b);await a.query('commit;');const second=json(await waiting);await b.query('commit;');return [first,second];
  }
  const unlocks=await race('unlock',10,call('unlock_daily_tier_two',[id(10)]),1,call('unlock_daily_tier_two',[id(10)]));eq(unlocks[0].items,unlocks[1].items,'Two devices create one immutable round');
  eq(pg.batch('select count(*) from private.daily_tier_two_rounds;'),'1');
  const reveals=await race('reveal',10,call('claim_daily_tier_two_reveal',[id(10)]),10,call('claim_daily_tier_two_reveal',[id(10)]));eq(reveals.map(r=>r.reveal_claimed),[true,false],'Only one simultaneous device claims reveal');
  const items=unlocks[0].items;
  const ticks=await race('ticks',10,call('record_daily_tier_two_trick',[id(10),items[0].id,'true']),1,call('record_daily_tier_two_trick',[id(10),items[1].id,'true']));eq(ticks[1].completed_count,2,'Concurrent different ticks are merged, never lost');
  const completes=await race('complete',1,call('complete_daily_tier_two',[id(10)]),2,call('complete_daily_tier_two',[id(10)]));eq(completes.map(r=>r.points_awarded),[4,0],'Two coaches bank exactly one +4 award');
  eq(pg.batch("select sum(points) from assignment_point_awards where award_key like 'daily-tier-two:%';"),'4');eq(pg.batch("select count(*) from assignment_point_awards where award_key like 'daily-tier-two:%';"),'1');
  eq(pg.batch("select count(*) from tricktionary_landing_history where evidence_type='daily_tier_two';"),'2');
  console.log(`PASS: ${checks} assertions across four genuine PostgreSQL lock races (${pg.count()} independent connections).`);
 }finally{await pg.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
