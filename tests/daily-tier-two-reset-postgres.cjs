// Real PostgreSQL on the disposable /tmp-only harness. Synthetic identities and saved-day rollover.
const assert=require('node:assert/strict');
const {initializeTierTwo,id}=require('./daily-tier-two-db.cjs');
const {createHarness,literal:q,json}=require('./helpers/local-postgres.cjs');
(async()=>{
 const pg=createHarness('tier_two_reset_audit'); let checks=0;
 const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
 const actor=(n,sql,role='authenticated')=>`select set_config('request.jwt.claim.sub',${q(n?id(n):'')},false);set role ${role};${sql}`;
 const call=(name,args)=>`select public.${name}(${args.map(q).join(',')});`;
 const rpc=(n,name,args)=>json(pg.batch(actor(n,call(name,args))));
 const denied=(n,sql,role='authenticated')=>{assert.throws(()=>pg.batch(actor(n,sql,role)),/permission|access|authoriz|denied|sign in|not allowed|rider|coach/i);checks++;};
 try{
  await initializeTierTwo(pg.adapter);
  pg.batch(`insert into profiles(id,role,display_name) values(${q(id(1))},'coach','Coach'),(${q(id(2))},'coach','Other Coach'),(${q(id(3))},'parent','Parent'),(${q(id(10))},'athlete','Rider'),(${q(id(11))},'athlete','Other Rider');
   insert into coach_athletes values(${q(id(1))},${q(id(10))});
   insert into parent_athletes values(${q(id(3))},${q(id(10))});
   insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select ${q(id(101))},${q(id(1))},${q(id(10))},week_start_date,'Bunny hop','daily','Test park' from jkcrew_week_bounds('AU');
   insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select ${q(id(102))},${q(id(1))},${q(id(10))},week_start_date,'Manual','daily','Test park' from jkcrew_week_bounds('AU');
   insert into training_sessions(id,athlete_id,started_at,daily_venue) values(${q(id(1000))},${q(id(10))},greatest(now()-interval '5 minutes',date_trunc('day',now() at time zone 'Australia/Brisbane') at time zone 'Australia/Brisbane'),'Test park');`);
  rpc(10,'record_daily_trick_action',[id(101),'landed','Test park']);
  const candidate=rpc(10,'record_daily_trick_action',[id(102),'landed','Test park']).completion_candidate;
  rpc(10,'confirm_daily_finish',[candidate.candidate_id]);
  const round=rpc(10,'unlock_daily_tier_two',[id(10)]);
  eq(round.local_date,pg.batch("select (now() at time zone jkcrew_country_timezone('AU'))::date::text;"),'Daily cycle uses rider country, not client date');
  for(const item of round.items)rpc(10,'record_daily_tier_two_trick',[id(10),item.id,'true']);
  const result=rpc(10,'complete_daily_tier_two',[id(10)]);
  eq(result.points_awarded,4);eq(rpc(10,'complete_daily_tier_two',[id(10)]).points_awarded,0);
  eq(rpc(3,'get_daily_tier_two',[id(10)]).points,4,'Linked parent can read');
  denied(3,call('unlock_daily_tier_two',[id(10)]));denied(3,call('complete_daily_tier_two',[id(10)]));
  denied(2,call('get_daily_tier_two',[id(10)]));denied(11,call('get_daily_tier_two',[id(10)]));denied(null,call('get_daily_tier_two',[id(10)]),'anon');
  denied(10,'select * from private.daily_tier_two_rounds;');
  eq(json(pg.batch(actor(10,'begin read only;'+call('get_daily_tier_two',[id(10)])))).points,4,'Summary reads in read-only transaction');
  eq(rpc(10,'get_daily_tier_two',[id(10),'2000-01-01']).unlocked,false,'Empty historical day stays locked');
  pg.batch(`update private.daily_tier_two_rounds set local_date=local_date-1 where athlete_id=${q(id(10))};`);
  const previous=pg.batch(`select local_date::text from private.daily_tier_two_rounds where athlete_id=${q(id(10))};`);
  const history=rpc(10,'get_daily_tier_two',[id(10),previous]);
  eq(history.historical,true);eq(history.points,4);eq(history.items,result.items,'Historical completed items persist');
  eq(rpc(10,'get_daily_tier_two',[id(10)]).unlocked,false,'New local day does not reuse old ticks');
  eq(pg.batch("select sum(points) from assignment_point_awards where award_key like 'daily-tier-two:%';"),'4','Date rollover adds no duplicate reward');
  console.log(`PASS: ${checks} PostgreSQL local-day/history, repeated completion, linked-parent read-only, unauthorized coach/rider/anon, and private-table access checks. Fixture saved date shifted one day; production untouched.`);
 }finally{await pg.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
