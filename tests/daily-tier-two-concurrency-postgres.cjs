const assert=require('node:assert/strict');
const {createHarness,literal:q,json}=require('./helpers/local-postgres.cjs');
const {initializeTierTwo,id}=require('./daily-tier-two-db.cjs');
(async()=>{
 const pg=createHarness('tier_two_races');let checks=0,overlaps=0;
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
    const waiting=b.query('begin;'+actor(secondActor,secondSql));await pg.waitLock(b);overlaps++;await a.query('commit;');const second=json(await waiting);await b.query('commit;');return [first,second];
  }
  const unlocks=await race('unlock',10,call('unlock_daily_tier_two',[id(10)]),1,call('unlock_daily_tier_two',[id(10)]));eq(unlocks[0].items,unlocks[1].items,'Two devices create one immutable round');
  eq(pg.batch('select count(*) from private.daily_tier_two_rounds;'),'1');
  const reveals=await race('reveal',10,call('claim_daily_tier_two_reveal',[id(10)]),10,call('claim_daily_tier_two_reveal',[id(10)]));eq(reveals.map(r=>r.reveal_claimed),[true,false],'Only one simultaneous device claims reveal');
  const items=unlocks[0].items;
  const ticks=await race('ticks',10,call('record_daily_tier_two_trick',[id(10),items[0].id,'true']),1,call('record_daily_tier_two_trick',[id(10),items[1].id,'true']));eq(ticks[1].completed_count,2,'Concurrent different ticks are merged, never lost');
  const completes=await race('complete',1,call('complete_daily_tier_two',[id(10)]),2,call('complete_daily_tier_two',[id(10)]));eq(completes.map(r=>r.points_awarded),[4,0],'Two coaches bank exactly one +4 award');
  eq(pg.batch("select sum(points) from assignment_point_awards where award_key like 'daily-tier-two:%';"),'4');eq(pg.batch("select count(*) from assignment_point_awards where award_key like 'daily-tier-two:%';"),'1');
  eq(pg.batch("select count(*) from tricktionary_landing_history where evidence_type='daily_tier_two';"),'2');
  // Partial Daily results remain immutable. A later completed copy of the same
  // list can qualify for Tier 2, independently of the original stopped timer.
  const rpc=(n,name,args)=>json(pg.batch(actor(n,call(name,args))));
  const state=n=>json(pg.batch(`select jsonb_build_object(
    'results',(select jsonb_agg(to_jsonb(c) order by c.id) from private.daily_finish_candidates c where athlete_id=${q(id(n))} and status='confirmed'),
    'profile',(select jsonb_build_object('pb',daily_pb_seconds,'pb_at',daily_pb_updated_at,'xp',xp_total) from profiles where id=${q(id(n))}),
    'session',(select to_jsonb(s) from training_sessions s where id=${q(id(n*1000))}),
    'awards',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from assignment_point_awards a where athlete_id=${q(id(n))}),
    'xp',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from xp_ledger x where athlete_id=${q(id(n))}),
    'notifications',(select count(*) from push_notification_queue where payload->>'athlete_id'=${q(id(n))}));`));
  const setupPartial=(n,{total=2,initial=0}={})=>{
    pg.batch(`insert into profiles(id,role,display_name,daily_pb_seconds) values(${q(id(n))},'athlete',${q('Partial Rider '+n)},123);
      insert into coach_athletes values(${q(id(1))},${q(id(n))}),(${q(id(2))},${q(id(n))});
      insert into training_sessions(id,athlete_id,started_at,daily_venue) values(${q(id(n*1000))},${q(id(n))},greatest(now()-interval '5 minutes',date_trunc('day',now() at time zone 'Australia/Brisbane') at time zone 'Australia/Brisbane'),'Test park');`);
    for(let i=0;i<total;i++)pg.batch(`insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue,sort_order)
      select ${q(id(n*100+i))},${q(id(1))},${q(id(n))},week_start_date,${q('Trick '+i)},'daily','Test park',${i} from jkcrew_week_bounds('AU');`);
    for(let i=0;i<initial;i++)rpc(n,'record_daily_trick_action',[id(n*100+i),'landed','Test park']);
    const candidate=rpc(n,'prepare_daily_finish',[id(n),id(n*1000),'Test park']).completion_candidate;
    const result=rpc(n,'confirm_daily_finish',[candidate.candidate_id]);
    eq(result.completed_count,initial);eq(result.total_count,total);eq(result.all_completed,false);
    eq(result.completion_points,0);eq(result.completion_xp,0);eq(result.pb_comparable,false);
    return {candidate,result,before:state(n)};
  };
  const noTierOneChanges=(n,before,label)=>{
    eq(state(n),before,label+': original result, timer, PB, ledger, XP and notifications are untouched');
    eq(pg.batch(`select count(*) from private.daily_finish_candidates where athlete_id=${q(id(n))} and status='confirmed';`),'1');
  };

  const finalTick=setupPartial(20);
  rpc(20,'record_daily_trick_action',[id(2000),'landed','Test park']);
  eq(rpc(20,'get_daily_tier_two',[id(20)]).eligible,false,'One later tick is still incomplete');
  const tickThenUnlock=await race('partial_final_tick',1,call('record_daily_trick_action',[id(2001),'landed','Test park']),20,call('unlock_daily_tier_two',[id(20)]));
  eq(tickThenUnlock[0].completion_candidate,null,'Final later tick does not manufacture a replacement timed result');
  eq(tickThenUnlock[1].unlocked,true,'Unlock waiting on the final tick sees the newly complete list');
  eq(tickThenUnlock[1].completed_count,0,'Tier 2 starts with fresh checkboxes');
  eq(tickThenUnlock[1].items.map(item=>item.trick_name),['Trick 0','Trick 1']);
  eq(pg.batch(`select source_candidate_id from private.daily_tier_two_rounds where athlete_id=${q(id(20))};`),finalTick.candidate.candidate_id);
  noTierOneChanges(20,finalTick.before,'0/2 then later 2/2');

  const correction=setupPartial(21,{initial:1});
  rpc(21,'record_daily_trick_action',[id(2101),'landed','Test park']);
  eq(rpc(21,'get_daily_tier_two',[id(21)]).eligible,true);
  const undoThenUnlock=await race('partial_undo',1,call('record_daily_trick_action',[id(2101),'unlanded','Test park']),21,call('unlock_daily_tier_two',[id(21)]));
  eq(undoThenUnlock[1].unlocked,false,'Correction committed before unlock keeps Tier 2 locked');
  eq(undoThenUnlock[1].eligible,false);
  eq(pg.batch(`select count(*) from private.daily_tier_two_rounds where athlete_id=${q(id(21))};`),'0');
  noTierOneChanges(21,correction.before,'Correction versus unlock');

  const unlockedFirst=setupPartial(22);
  for(const assignment of [2200,2201])rpc(22,'record_daily_trick_action',[id(assignment),'landed','Test park']);
  const unlockThenUndo=await race('partial_unlock_first',1,call('unlock_daily_tier_two',[id(22)]),22,call('record_daily_trick_action',[id(2201),'unlanded','Test park']));
  eq(unlockThenUndo[0].unlocked,true);
  const persisted=rpc(22,'get_daily_tier_two',[id(22)]);
  eq(persisted.unlocked,true,'A validly unlocked round is immutable after a later correction');
  eq(persisted.items,unlockThenUndo[0].items);eq(persisted.points,0);eq(persisted.completed_count,0);
  noTierOneChanges(22,unlockedFirst.before,'Unlock before subsequent correction');

  // Mylee's actual shape: 0/10 saved, list copied with new assignment IDs but
  // identical contents, all new rows landed today, original training ended.
  const copied=setupPartial(23,{total:10});
  pg.batch(`delete from weekly_trick_assignments where athlete_id=${q(id(23))};`);
  for(let i=0;i<10;i++)pg.batch(`insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue,sort_order)
    select ${q(id(2350+i))},${q(id(1))},${q(id(23))},week_start_date,${q('Trick '+i)},'daily',' TEST-PARK ',${i} from jkcrew_week_bounds('AU');`);
  for(let i=0;i<10;i++)rpc(1,'record_daily_trick_action',[id(2350+i),'landed','Test park']);
  pg.batch(`update training_sessions set ended_at=clock_timestamp() where id=${q(id(23000))};`);
  const endedSnapshot=state(23);
  eq(endedSnapshot.results[0].result,copied.result,'Copied list and later ticks retain the exact saved 0/10 result');
  eq(endedSnapshot.session.daily_completed_at,null);eq(endedSnapshot.profile.pb,123);
  eq(rpc(23,'get_daily_tier_two',[id(23)]).eligible,true,'A completed copied list remains eligible after training ends');
  const copiedUnlocks=await race('partial_copied_unlock',23,call('unlock_daily_tier_two',[id(23)]),2,call('unlock_daily_tier_two',[id(23)]));
  eq(copiedUnlocks[0].unlocked,true);eq(copiedUnlocks[1].unlocked,true);
  eq(copiedUnlocks[0].items,copiedUnlocks[1].items,'Two clients share one list and identical stable item IDs');
  eq(copiedUnlocks[0].items.length,10);eq(copiedUnlocks[0].completed_count,0);
  eq(pg.batch(`select count(*) from private.daily_tier_two_rounds where athlete_id=${q(id(23))};`),'1');
  eq(pg.batch(`select source_candidate_id from private.daily_tier_two_rounds where athlete_id=${q(id(23))};`),copied.candidate.candidate_id);
  noTierOneChanges(23,endedSnapshot,'Two-client copied-list unlock after ended training');
  console.log(`PASS: ${checks} assertions across ${overlaps} genuine PostgreSQL lock races (${pg.count()} independent connections), including partial→later complete, corrections and copied lists after ended sessions.`);
 }finally{await pg.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
