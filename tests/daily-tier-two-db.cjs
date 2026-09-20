// No network or production writes: real Daily/partial/pause functions in PGlite.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');
const {initialize,id,partialMigration}=require('./daily-partial-db.cjs');
const root=path.resolve(__dirname,'..');
const migration='20260920025715_daily_tier_two_surprise_unlock.sql';
async function initializeTierTwo(db){
  await initialize(db);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',partialMigration),'utf8'));
  const venueSource=fs.readFileSync(path.join(root,'supabase/migrations/202607181730_add_king_of_the_park.sql'),'utf8');
  const venueStart=venueSource.indexOf('create or replace function private.attach_assignment_award_venue()');
  await db.exec(venueSource.slice(venueStart,venueSource.indexOf('create or replace function public.record_assignment_action_at_venue',venueStart)));
  await db.exec(`create table private.rider_feature_access(athlete_id uuid primary key,features_disabled boolean default false);
    create function private.rider_features_disabled() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from private.rider_feature_access where athlete_id=(select auth.uid()) and features_disabled);$$;`);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
}
async function run(){
  const db=new PGlite();let checks=0;
  const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
  const ok=(a,label)=>{assert(a,label);checks++;};
  const denied=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  const rpc=(name,args=[])=>scalar(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
  const admin=()=>db.exec('reset role');
  const actor=async(n,role='authenticated')=>{await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec(`set role ${role}`);};
  const inspect=async fn=>{const role=await scalar('select current_user');await admin();try{return await fn();}finally{if(['authenticated','anon'].includes(role))await db.exec(`set role ${role}`);}};
  const read=(sql,args=[])=>inspect(()=>scalar(sql,args));
  try{
    await initializeTierTwo(db);
    await db.query("insert into profiles(id,role,display_name) values($1,'coach','Coach'),($2,'coach','Coach Two'),($3,'parent','Parent'),($4,'coach','Stranger')",[id(1),id(2),id(3),id(4)]);
    const setup=async n=>{
      await admin();await db.query("insert into profiles(id,role,display_name) values($1,'athlete',$2)",[id(n),`Rider ${n}`]);
      await db.query('insert into coach_athletes values($1,$3),($2,$3)',[id(1),id(2),id(n)]);await db.query('insert into parent_athletes values($1,$2)',[id(3),id(n)]);
      for(let i=0;i<2;i++)await db.query("insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select $1,$2,$3,week_start_date,$4,'daily','Test park' from jkcrew_week_bounds('AU')",[id(n*100+i),id(1),id(n),`Trick ${i}`]);
      await db.query("insert into training_sessions(id,athlete_id,started_at,daily_venue) values($1,$2,greatest(now()-interval '5 minutes',date_trunc('day',now() at time zone 'Australia/Brisbane') at time zone 'Australia/Brisbane'),'Test park')",[id(n*1000),id(n)]);await actor(n);return n;
    };
    const tick=(n,i)=>rpc('record_daily_trick_action',[id(n*100+i),'landed','Test park',null]);
    const full=async n=>{await tick(n,0);const c=(await tick(n,1)).completion_candidate;return rpc('confirm_daily_finish',[c.candidate_id]);};
    const get=n=>rpc('get_daily_tier_two',[id(n)]);
    const unlock=n=>rpc('unlock_daily_tier_two',[id(n)]);
    const mark=(n,item,landed=true)=>rpc('record_daily_tier_two_trick',[id(n),item.id,landed]);
    const complete=n=>rpc('complete_daily_tier_two',[id(n)]);
    const points=n=>read("select coalesce(sum(points),0)::int from assignment_point_awards where athlete_id=$1 and award_key like 'daily-tier-two:%'",[id(n)]);
    await setup(10);eq((await get(10)).unlocked,false);eq((await unlock(10)).unlocked,false,'Cannot unlock an empty Daily');await tick(10,0);eq((await get(10)).eligible,false,'Partial progress stays hidden');
    const partial=(await rpc('prepare_daily_finish',[id(10),id(10000),'Test park',null])).completion_candidate;await rpc('confirm_daily_finish',[partial.candidate_id]);await tick(10,1);
    eq((await unlock(10)).unlocked,false,'A saved partial is still ineligible after later ticks');await denied(()=>complete(10),e=>e.code==='42501');eq(await points(10),0);
    await setup(11);await tick(11,0);const pending=(await tick(11,1)).completion_candidate;eq((await get(11)).eligible,false,'Unconfirmed finish cannot unlock');
    const tierOne=await rpc('confirm_daily_finish',[pending.candidate_id]);eq(tierOne.all_completed,true);eq(tierOne.completion_points,2);eq(tierOne.completion_xp,35);
    const beforeXp=await read('select xp_total from profiles where id=$1',[id(11)]);
    const beforeTicks=await read('select count(*)::int from assignment_progress where athlete_id=$1 and progress_date is not null',[id(11)]);
    eq((await get(11)).eligible,true);const round=await unlock(11);eq(round.source,'daily_round_two');eq(round.items.map(i=>i.trick_name),['Trick 0','Trick 1']);eq(round.completed_count,0,'Tier 2 begins with fresh ticks');eq(round.reward_points,4);
    eq((await unlock(11)).items,round.items,'Reload uses immutable item IDs');eq((await get(11)).revealed_at,null,'Reading never consumes the surprise');
    await actor(1);await denied(()=>rpc('claim_daily_tier_two_reveal',[id(11)]),e=>e.code==='42501');eq((await get(11)).revealed_at,null,'Coach cannot consume rider reveal');
    await actor(11);eq((await rpc('claim_daily_tier_two_reveal',[id(11)])).reveal_claimed,true);eq((await rpc('claim_daily_tier_two_reveal',[id(11)])).reveal_claimed,false,'Second device/retry cannot replay reveal');
    await denied(()=>complete(11),e=>e.code==='22023');await mark(11,round.items[0]);eq(await points(11),0,'A tick earns no fractional reward');await mark(11,round.items[0]);
    eq(await read("select count(*)::int from tricktionary_landing_history where athlete_id=$1 and evidence_type='daily_tier_two'",[id(11)]),1,'Repeated tick has one durable evidence record');
    await mark(11,round.items[0],false);eq((await get(11)).completed_count,0);eq(await read("select sum(landed_count)::int from tricktionary_landing_history where athlete_id=$1 and category='daily_tier_two'",[id(11)]),0,'Undo removes landed evidence');
    await mark(11,round.items[0]);await actor(2);await mark(11,round.items[1]);eq((await get(11)).completed_count,2,'Linked coach can tick a rider round');
    const result=await complete(11);eq(result.points_awarded,4);eq(result.points,4);ok(result.completed_at);eq((await complete(11)).points_awarded,0);eq(await points(11),4);
    await actor(11);eq((await complete(11)).points_awarded,0,'Rider and second coach share the same reward');eq((await mark(11,round.items[0],false)).completed_count,2,'Banked round is immutable');
    eq(await read('select xp_total from profiles where id=$1',[id(11)]),beforeXp,'No unsolicited Tier 2 XP');eq(await read('select count(*)::int from assignment_progress where athlete_id=$1 and progress_date is not null',[id(11)]),beforeTicks,'Tier 1 ticks unchanged');
    const today=await rpc('get_today_training_progress',[id(11)]);eq(today.today_points,tierOne.completion_points+4,'Existing Today includes the +4 ledger award');
    // A different venue can score its normal Daily, but never a second Tier 2.
    await inspect(()=>db.query("insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select $1,$2,$3,week_start_date,'Other park trick','daily','Another park' from jkcrew_week_bounds('AU')",[id(1150),id(1),id(11)]));
    await rpc('start_daily_tricks',['Another park']);const otherVenueCandidate=(await rpc('record_daily_trick_action',[id(1150),'landed','Another park',null])).completion_candidate;
    await rpc('confirm_daily_finish',[otherVenueCandidate.candidate_id]);eq((await unlock(11)).items,result.items,'Another venue keeps the same daily round');eq((await complete(11)).points_awarded,0);eq(await points(11),4);
    // Even a privileged unrelated RPC cannot forge, mutate or erase this prefix.
    await inspect(()=>db.exec(`create function public.test_forge_tier_two(p_rider uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$begin
      if p_action='insert' then insert into public.assignment_point_awards(athlete_id,award_key,points,venue) values(p_rider,'daily-tier-two:2000-01-01',4,'Forged');
      elsif p_action='delete' then delete from public.assignment_point_awards where athlete_id=p_rider and award_key like 'daily-tier-two:%';
      else update public.assignment_point_awards set points=5 where athlete_id=p_rider and award_key like 'daily-tier-two:%';end if;end$$;`));
    for(const action of ['insert','update','delete'])await denied(()=>rpc('test_forge_tier_two',[id(11),action]),e=>e.code==='42501');eq(await points(11),4);
    // Sheet replacement does not lose the snapshot, reward or Tricktionary facts.
    await inspect(()=>db.query('delete from weekly_trick_assignments where athlete_id=$1',[id(11)]));eq((await get(11)).items,result.items);eq(await points(11),4);
    eq(await read("select count(*)::int from tricktionary_landing_history where athlete_id=$1 and evidence_type='daily_tier_two'",[id(11)]),2);
    await setup(12);await actor(1);eq((await rpc('get_daily_tier_two_template',[id(12)])).default_round,true);
    const custom=[{trick_name:'Manual',notes:'Choose a comfortable distance'},{trick_name:'Bunny hop',notes:'Controlled landing'}];
    await rpc('set_daily_tier_two_template',[id(12),JSON.stringify(custom)]);await actor(12);await full(12);const customRound=await unlock(12);eq(customRound.source,'coach_template');eq(customRound.items.map(i=>i.trick_name),['Manual','Bunny hop']);
    await actor(1);await rpc('set_daily_tier_two_template',[id(12),JSON.stringify([{trick_name:'Different trick'}])]);eq((await get(12)).items,customRound.items,"Coach edits affect future unlocks, never today's snapshot");
    await rpc('set_daily_tier_two_template',[id(12),null]);eq((await rpc('get_daily_tier_two_template',[id(12)])).default_round,true);await denied(()=>rpc('set_daily_tier_two_template',[id(12),'[]']),e=>e.code==='22023');
    await denied(()=>rpc('set_daily_tier_two_template',[id(12),JSON.stringify([{trick_name:''}])]),e=>e.code==='22023');
    await actor(12);await denied(()=>rpc('set_daily_tier_two_template',[id(12),JSON.stringify(custom)]),e=>e.code==='42501');
    await actor(1);await rpc('set_rider_scoring_pause',[id(12),true]);await actor(12);await denied(()=>mark(12,customRound.items[0]),e=>e.code==='42501');await denied(()=>complete(12),e=>e.code==='42501');eq(await points(12),0);ok((await get(12)).scoring_paused);
    await actor(1);await rpc('set_rider_scoring_pause',[id(12),false]);await actor(12);await mark(12,customRound.items[0]);await actor(1);await rpc('set_rider_scoring_pause',[id(12),true]);await actor(12);eq((await mark(12,customRound.items[0],false)).completed_count,0,'Pause allows correction');
    await setup(13);await full(13);const failing=await unlock(13);for(const item of failing.items)await mark(13,item);
    await inspect(()=>db.exec(`create function private.fail_tier_two_test() returns trigger language plpgsql as $$begin if new.athlete_id='${id(13)}' and new.award_key like 'daily-tier-two:%' then raise exception 'Simulated ledger failure';end if;return new;end$$;create trigger zzz_fail_tier_two_test before insert on assignment_point_awards for each row execute function private.fail_tier_two_test();`));
    await denied(()=>complete(13),/Simulated ledger failure/);eq((await get(13)).completed_at,null,'Failed reward rolls back completed snapshot');eq((await get(13)).completed_count,2,'Failed completion preserves landed ticks');eq(await points(13),0);
    await inspect(()=>db.exec('drop trigger zzz_fail_tier_two_test on assignment_point_awards'));eq((await complete(13)).points_awarded,4,'Retry after failure banks exactly one reward');
    await setup(14);await full(14);const blank=await unlock(14);
    await inspect(()=>db.query("update private.daily_tier_two_rounds set venue='' where athlete_id=$1",[id(14)]));for(const item of blank.items)await mark(14,item);
    await db.exec("begin;select set_config('jkcrew.venue','Inherited wrong park',true);");try{eq((await complete(14)).points_awarded,4);await db.exec('commit');}catch(error){await db.exec('rollback');throw error;}
    eq(await read("select venue from assignment_point_awards where athlete_id=$1 and award_key like 'daily-tier-two:%'",[id(14)]),'','Blank snapshot venue is not replaced by an inherited request hint');
    await actor(12);
    await inspect(()=>db.query('insert into private.rider_feature_access values($1,true)',[id(12)]));await denied(()=>get(12),e=>e.code==='42501');await denied(()=>mark(12,customRound.items[1]),e=>e.code==='42501');
    await actor(3);eq((await get(11)).points,4,'Linked parent may read');await denied(()=>unlock(11),e=>e.code==='42501');await denied(()=>complete(11),e=>e.code==='42501');
    await actor(4);await denied(()=>get(11),e=>e.code==='42501');await denied(()=>rpc('set_daily_tier_two_template',[id(11),JSON.stringify(custom)]),e=>e.code==='42501');
    await actor(10);await denied(()=>get(11),e=>e.code==='42501');await actor(null,'anon');await denied(()=>get(11),e=>e.code==='42501');
    await actor(11);await denied(()=>db.query('select * from private.daily_tier_two_rounds'),e=>e.code==='42501');
    await db.exec('begin read only');try{eq((await get(11)).points,4,'Summary is genuinely read-only');}finally{await db.exec('rollback');}
    // Saved date is derived by the same country helper as Daily, not browser time.
    eq(round.local_date,await read("select (now() at time zone jkcrew_country_timezone('AU'))::date::text"));
    eq((await rpc('get_daily_tier_two',[id(11),'2000-01-01'])).unlocked,false,'Historical empty day cannot unlock today');
    // Advance the fixture's saved day (without changing production clock) to test
    // immutable history and per-day selection independently of wall-clock waits.
    await inspect(()=>db.query("update private.daily_tier_two_rounds set local_date=local_date-1 where athlete_id=$1",[id(11)]));
    const previous=await read('select local_date::text from private.daily_tier_two_rounds where athlete_id=$1',[id(11)]);const history=await rpc('get_daily_tier_two',[id(11),previous]);eq(history.historical,true);eq(history.points,4);eq(history.items,result.items);
    eq((await get(11)).unlocked,false,'New local day does not reuse old ticks');
    console.log(`PASS: ${checks} Tier 2 eligibility, partial/full, privacy, reveal, local date, immutable history, scoring-pause, idempotency, reward and evidence checks.`);
  }finally{await db.close();}
}
if(require.main===module)run().catch(e=>{console.error(e.stack,e.where||'');process.exitCode=1;});
module.exports={initializeTierTwo,migration,id};
