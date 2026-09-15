// Isolated PostgreSQL-compatible execution of the actual deployed Daily functions
// and the additive partial-finish migration. Never connects to a live project.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migrationFiles=['20260911085353_confirm_daily_tricks_and_today_progress.sql','20260911100447_make_daily_standings_read_only.sql','20260914104325_rider_scoring_pause.sql'];
const partialMigration='20260915214800_allow_partial_daily_finish.sql';
async function initialize(db){
  // Share the existing production-shaped schema, as the real-connection suite
  // does; this keeps all three Daily harnesses on the same column definitions.
  const behavior=fs.readFileSync(path.join(__dirname,'daily-completion-db.cjs'),'utf8');
  await db.exec(behavior.match(/await db\.exec\(`([\s\S]*?)`\);/)[1]);
  await db.exec(`grant usage on schema private to authenticated;
    create table percentage_attempts(id uuid primary key default gen_random_uuid(),assignment_id uuid,athlete_id uuid,attempt_number integer,landed boolean,created_at timestamptz default now(),unique(assignment_id,attempt_number));
    create table assignment_attempts(id uuid primary key default gen_random_uuid(),assignment_id uuid,athlete_id uuid,session_id uuid,attempted_at timestamptz default now());`);
  const definitions=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/daily-production-functions.json'),'utf8')).functions;
  for(const signature of ['jkcrew_country_timezone(text)','jkcrew_week_bounds(text,timestamp with time zone)','private.jkcrew_venue_key(text)','level_badge(integer)','sync_xp_award(uuid,text,text,integer,text,uuid,uuid,text,text,uuid,jsonb)','sync_assignment_progress_xp()','sync_daily_pb_xp()','sync_daily_completion_timing()','record_assignment_action(uuid,text)','record_assignment_action_at_venue(uuid,text,text)','finish_group_session_daily(uuid,uuid,integer)','get_weekly_leaderboard()']){
    const definition=definitions.find(fn=>fn.signature===signature)?.definition;assert(definition,signature);await db.exec(definition);
  }
  await db.exec(`create trigger assignment_progress_xp_sync after insert or update or delete on assignment_progress for each row execute function sync_assignment_progress_xp();
    create trigger assignment_progress_daily_completion_timing after insert or update of progress_date on assignment_progress for each row when(new.progress_date is not null) execute function sync_daily_completion_timing();
    create trigger profiles_daily_pb_xp_sync after update of daily_pb_seconds on profiles for each row execute function sync_daily_pb_xp();`);
  const history=fs.readFileSync(path.join(root,'supabase/migrations/20260911030012_preserve_tricktionary_landed_history.sql'),'utf8');
  for(const name of ['private.capture_tricktionary_progress','private.sync_tricktionary_progress_history']){
    const start=history.indexOf(`create or replace function ${name}(`);assert(start>=0);await db.exec(history.slice(start,history.indexOf('\n$$;',start)+4));
  }
  await db.exec('create trigger tricktionary_progress_history after insert or update of progress_date,completed_at,streak_count on assignment_progress for each row execute function private.sync_tricktionary_progress_history();');
  for(const file of migrationFiles)await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  // A read-only result must not accidentally call the old badge synchronizer.
  await db.exec(`create or replace function get_earned_badges(uuid) returns jsonb language plpgsql as $$begin raise exception 'Unexpected badge synchronization';end$$;`);
}
async function run(){
  const db=new PGlite();let checks=0;
  const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
  const ok=(value,message)=>{assert(value,message);checks++;};
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const scalar=async(sql,args=[]) => Object.values((await q(sql,args))[0])[0];
  const rpc=(name,args=[])=>scalar(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
  const admin=()=>db.exec('reset role');
  const actor=async(n,role='authenticated')=>{await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec(`set role ${role}`);};
  const denied=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
  const inspect=async fn=>{const role=await scalar('select current_user');await admin();try{return await fn();}finally{if(['authenticated','anon','service_role'].includes(role))await db.exec(`set role ${role}`);}};
  const read=(sql,args=[])=>inspect(()=>scalar(sql,args));
  try{
    await initialize(db);
    const migration=fs.readFileSync(path.join(root,'supabase/migrations',partialMigration),'utf8');assert(migration.trim(),'Partial Daily migration has its implementation');await db.exec(migration);
    await db.query("insert into profiles(id,role,display_name) values($1,'coach','Coach One'),($2,'coach','Coach Two'),($3,'parent','Linked Parent'),($4,'coach','Unlinked Coach')",[id(1),id(2),id(3),id(4)]);
    await db.query('insert into push_subscriptions values($1,true),($2,true)',[id(1),id(2)]);
    const setup=async(n,{group=null,total=2,venue='Test park'}={})=>{
      await admin();const session=n*100,assignments=Array.from({length:total},(_,i)=>n*1000+i);
      await db.query("insert into profiles(id,role,display_name,daily_pb_seconds) values($1,'athlete',$2,123)",[id(n),`Partial Rider ${n}`]);
      await db.query('insert into coach_athletes values($1,$3),($2,$3)',[id(1),id(2),id(n)]);await db.query('insert into parent_athletes values($1,$2)',[id(3),id(n)]);
      for(const assignment of assignments)await db.query("insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select $1,$2,$3,week_start_date,$4,'daily',$5 from jkcrew_week_bounds('AU')",[id(assignment),id(1),id(n),`Trick ${assignment}`,venue]);
      await db.query("insert into training_sessions(id,athlete_id,started_at,daily_venue) values($1,$2,greatest(now()-interval '5 minutes',((now() at time zone 'Australia/Brisbane')::date)::timestamp at time zone 'Australia/Brisbane'),$3)",[id(session),id(n),venue]);
      if(group)await db.query('insert into coach_group_session_participants(group_session_id,athlete_id,training_session_id) values($1,$2,$3)',[id(group),id(n),id(session)]);
      await actor(n);return {rider:n,session,assignments,venue,group};
    };
    const action=(f,index=0,what='landed')=>rpc('record_daily_trick_action',[id(f.assignments[index]),what,f.venue,null]);
    const prepare=f=>rpc('prepare_daily_finish',[id(f.rider),id(f.session),f.venue,null]);
    const confirm=candidate=>rpc('confirm_daily_finish',[candidate.candidate_id]);
    const facts=f=>read(`select jsonb_build_object('points',(select coalesce(sum(points),0) from assignment_point_awards where athlete_id=$1),'xp',(select coalesce(sum(xp),0) from xp_ledger where athlete_id=$1),'pb',(select daily_pb_seconds from profiles where id=$1),'notifications',(select count(*) from push_notification_queue where payload->>'athlete_id'=$1::text),'session',(select to_jsonb(s) from training_sessions s where id=$2),'ticks',(select count(*) from assignment_progress where athlete_id=$1 and progress_date is not null),'history',(select count(*) from tricktionary_landing_history where athlete_id=$1 and landed_count>0),'results',(select count(*) from private.daily_finish_candidates where athlete_id=$1 and status='confirmed'))`,[id(f.rider),id(f.session)]);
    const noRewards=(result,label)=>{eq(result.completion_points,0,`${label}: no completion or timing points`);eq(result.completion_xp,0,`${label}: no completion XP`);eq(result.point_awards,[],`${label}: no point receipt`);eq(result.previous_pb_seconds,null,`${label}: not compared to a complete run`);eq(result.pb_seconds,null,`${label}: no reported PB`);eq(result.is_new_pb,false,`${label}: not a personal best`);eq(result.is_first_pb,false,`${label}: not a first personal best`);eq(result.pb_comparable,false,`${label}: no completion comparison`);};
    // One tick is an honest partial finish, not an implicit successful Daily list.
    const one=await setup(10);await action(one);const before=await facts(one);
    const candidate=(await prepare(one)).completion_candidate;ok(candidate?.candidate_id,'Manual Finish offers an incomplete list for confirmation');eq(candidate.completed_count,1);eq(candidate.total_count,2);eq(candidate.all_completed,false);
    eq((await facts(one)).session.daily_completed_at,null,'Preparing is not a completed timer');
    const result=await confirm(candidate);noRewards(result,'1/2 partial');eq(result.completed_count,1);eq(result.total_count,2);eq(result.all_completed,false);eq(result.seconds,candidate.seconds,'Popup reading time is excluded');
    const after=await facts(one);eq(after.points,before.points);eq(after.xp,before.xp);eq(after.pb,123);eq(after.notifications,0,'No full-list completion notification');eq(after.ticks,1);eq(after.history,1);eq(after.results,1);
    eq(after.session.ended_at,null,'Finishing Daily leaves the overall training session active');eq(after.session.daily_completed_at,null,'A partial result never masquerades as a full completion');eq(after.session.daily_completed_seconds,null);
    eq(await confirm(candidate),result,'A repeated confirmation returns the same immutable partial result');await actor(2);eq(await confirm(candidate),result,'The second linked coach receives the same saved result');eq((await prepare(one)).result,result,'Manual reopening restores the saved result');
    await actor(one.rider);const today=await rpc('get_today_training_progress',[id(one.rider)]);eq(today.daily_results.find(row=>row.result_id===result.result_id)?.all_completed,false,'Today distinguishes partial results');eq(today.improvements,[],'Partial finish cannot create a completion/PB improvement');
    eq(await rpc('get_daily_finish_results',[[id(one.session)]]),[result],'Reload restores the exact stopped Daily result');eq(await rpc('get_daily_finish_results',[[]]),[],'Empty session reads are harmless');
    await action(one,1);eq((await prepare(one)).result,result,'Later ticks cannot turn a saved partial result into a completed result');eq((await facts(one)).points,0,'Filling the remaining tick after partial finish cannot award Daily points');
    // Other categories continue in the same active session, with their real rules.
    await inspect(()=>db.query("insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select $1,$2,$3,week_start_date,'Manual','one_bang','Test park' from jkcrew_week_bounds('AU')",[id(10999),id(1),id(one.rider)]));
    eq((await rpc('record_assignment_action',[id(10999),'landed'])).points_awarded,2,'Untimed training still scores normally after partial Daily');eq((await facts(one)).session.ended_at,null);
    // Zero progress is also valid when there is an assigned, nonempty list.
    const zero=await setup(11);const zeroCandidate=(await prepare(zero)).completion_candidate;eq(zeroCandidate.completed_count,0);eq(zeroCandidate.total_count,2);eq(zeroCandidate.all_completed,false);const zeroResult=await confirm(zeroCandidate);noRewards(zeroResult,'0/2 partial');eq((await facts(zero)).ticks,0);eq((await facts(zero)).history,0);
    const empty=await setup(12,{total:0});await denied(()=>prepare(empty),/Daily|list|assign/i);eq((await facts(empty)).results,0,'An empty/unassigned list cannot fabricate a result');
    // A pending partial result cannot overwrite ticks arriving before confirmation.
    const changing=await setup(13);await action(changing);const oldPartial=(await prepare(changing)).completion_candidate;const fullCandidate=(await action(changing,1)).completion_candidate;await denied(()=>confirm(oldPartial),/changed/i);
    ok(fullCandidate?.candidate_id,'Landing the remaining trick prepares the usual full finish');const full=await confirm(fullCandidate);eq(full.all_completed,true);eq(full.completed_count,2);eq(full.completion_points,2);eq(full.completion_xp,35);eq(full.is_first_pb,true);eq(full.pb_comparable,true);ok((await facts(changing)).session.daily_completed_at,'Full completion still saves its normal timer');
    const corrected=await setup(14);await action(corrected);const correctedCandidate=(await prepare(corrected)).completion_candidate;await action(corrected,0,'unlanded');await denied(()=>confirm(correctedCandidate),/changed/i);const reviewed=(await prepare(corrected)).completion_candidate;eq(reviewed.completed_count,0);noRewards(await confirm(reviewed),'Corrected 0/2 partial');
    const listChanged=await setup(15);const listCandidate=(await prepare(listChanged)).completion_candidate;await inspect(()=>db.query('update weekly_trick_assignments set target_reps=3 where id=$1',[id(listChanged.assignments[0])]));await denied(()=>confirm(listCandidate),/changed/i);
    // Partial group finish must not consume the genuine first-full-finish bonus.
    await admin();await db.query("insert into coach_group_sessions(id,coach_id,venue,started_at,total_paused_seconds) values($1,$2,'Test park',now()-interval '10 minutes',60)",[id(900),id(1)]);
    const groupPartial=await setup(16,{group:900}),groupFull=await setup(17,{group:900});await actor(groupPartial.rider);await action(groupPartial);const gp=(await prepare(groupPartial)).completion_candidate;ok(gp.seconds>=539&&gp.seconds<=550,'Paused group time is still excluded');noRewards(await confirm(gp),'Group partial');
    eq(await read('select daily_finished_at from coach_group_session_participants where group_session_id=$1 and athlete_id=$2',[id(900),id(groupPartial.rider)]),null,'Partial is not a completed-group timer');eq(await read('select daily_finish_seconds from coach_group_session_participants where group_session_id=$1 and athlete_id=$2',[id(900),id(groupPartial.rider)]),null);
    await actor(groupFull.rider);await action(groupFull);const gf=(await action(groupFull,1)).completion_candidate;const groupFullResult=await confirm(gf);eq(groupFullResult.completion_points,3,'The first fully completed rider receives the preserved group bonus');eq(await read("select count(*)::int from assignment_point_awards where award_key like 'group-first-finish:%'"),1);
    // Pausing still blocks new scoring, while an honest zero-reward stop is safe.
    const paused=await setup(18);await action(paused);await actor(1);await q('select * from set_rider_scoring_pause($1,true)',[id(paused.rider)]);await actor(paused.rider);await denied(()=>action(paused,1),error=>error.code==='42501');const pausedCandidate=(await prepare(paused)).completion_candidate;noRewards(await confirm(pausedCandidate),'Paused partial');eq((await facts(paused)).points,0);eq((await facts(paused)).pb,123);
    const pausedFull=await setup(19);await action(pausedFull);const pausedFullCandidate=(await action(pausedFull,1)).completion_candidate;await actor(1);await q('select * from set_rider_scoring_pause($1,true)',[id(pausedFull.rider)]);await actor(pausedFull.rider);await denied(()=>confirm(pausedFullCandidate),error=>error.code==='42501');const pausedFacts=await facts(pausedFull);eq(pausedFacts.points,0);eq(pausedFacts.xp,0);eq(pausedFacts.results,0);eq(pausedFacts.session.daily_completed_at,null);eq(pausedFacts.ticks,2,'Rejected full confirmation does not erase progress');
    await actor(1);await q('select * from set_rider_scoring_pause($1,false)',[id(pausedFull.rider)]);eq((await confirm(pausedFullCandidate)).completion_points,2,'The original full candidate succeeds once scoring is resumed');
    // A failed transaction must leave its original candidate available for retry.
    const failed=await setup(20);await action(failed);const failedCandidate=(await prepare(failed)).completion_candidate;
    await inspect(()=>db.exec(`create function private.fail_partial_save() returns trigger language plpgsql as $$begin if new.athlete_id='${id(failed.rider)}' and new.status='confirmed' then raise exception 'Simulated storage failure';end if;return new;end$$;
      create trigger fail_partial_save before update on private.daily_finish_candidates for each row execute function private.fail_partial_save();`));
    await denied(()=>confirm(failedCandidate),/Simulated storage failure/);eq((await facts(failed)).results,0);eq((await facts(failed)).ticks,1);eq((await facts(failed)).points,0);eq((await facts(failed)).session.ended_at,null);
    await inspect(()=>db.exec('drop trigger fail_partial_save on private.daily_finish_candidates;'));noRewards(await confirm(failedCandidate),'Retried failed partial');
    const reopened=await setup(21);const superseded=(await prepare(reopened)).completion_candidate;const replacement=(await prepare(reopened)).completion_candidate;ok(replacement.candidate_id!==superseded.candidate_id);await denied(()=>confirm(superseded),/changed/i);noRewards(await confirm(replacement),'Reopened partial');
    // Legacy timers without a venue must still respect the saved result's venue.
    await actor(zero.rider);eq((await rpc('start_daily_tricks',[zero.venue])).id,id(zero.session),'Same venue reuses its saved partial rather than restarting it');
    await inspect(()=>db.query('update training_sessions set daily_venue=null where id=$1',[id(zero.session)]));
    eq((await rpc('prepare_daily_finish',[id(zero.rider),id(zero.session),null,null])).result,zeroResult,'Omitted legacy venue restores its canonical saved result');
    await denied(()=>rpc('prepare_daily_finish',[id(zero.rider),id(zero.session),'Another park',null]),/venue/i);
    // Another venue receives a fresh timer; the saved partial remains immutable.
    await inspect(()=>db.query("insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select $1,$2,$3,week_start_date,'Other park daily','daily','Another park' from jkcrew_week_bounds('AU')",[id(11999),id(1),id(zero.rider)]));await actor(zero.rider);const another=await rpc('start_daily_tricks',['Another park']);ok(another.id!==id(zero.session),'A stopped partial allows a new venue timer');eq(another.daily_venue,'Another park');eq((await facts(zero)).session.ended_at,null,'The previous training history remains active and intact');eq(await rpc('get_daily_finish_results',[[id(zero.session)]]),[zeroResult]);
    // Role and privacy boundaries remain the same for both new and saved results.
    await actor(3);ok((await rpc('get_today_training_progress',[id(one.rider)])).daily_results.length,'Linked parent may still read the rider summary');eq(await rpc('get_daily_finish_results',[[id(one.session)]]),[result],'Linked parent may restore the stopped timer for viewing');await denied(()=>prepare(one),error=>error.code==='42501');await denied(()=>confirm(candidate),error=>error.code==='42501');
    await actor(4);await denied(()=>prepare(one),error=>error.code==='42501');await denied(()=>confirm(candidate),error=>error.code==='42501');await denied(()=>rpc('get_daily_finish_results',[[id(one.session)]]),error=>error.code==='42501');await actor(zero.rider);await denied(()=>confirm(candidate),error=>error.code==='42501');await denied(()=>rpc('get_daily_finish_results',[[id(zero.session),id(one.session)]]),error=>error.code==='42501');
    await actor(null,'anon');await denied(()=>prepare(zero),error=>error.code==='42501');await denied(()=>confirm(zeroCandidate),error=>error.code==='42501');await denied(()=>rpc('get_daily_finish_results',[[id(zero.session)]]),error=>error.code==='42501');
    await actor(one.rider);await denied(()=>db.query('select * from private.daily_finish_candidates'),error=>error.code==='42501');
    await denied(()=>rpc('get_daily_finish_results',[Array.from({length:101},(_,i)=>id(90000+i))]),error=>error.code==='22023');
    await db.exec('begin read only');try{eq(await rpc('get_daily_finish_results',[[id(one.session),id(one.session)]]),[result],'Read-only reload deduplicates repeated IDs');eq((await rpc('get_today_training_progress',[id(one.rider)])).daily_results.find(row=>row.result_id===result.result_id)?.all_completed,false,'Today reads partial results without hidden writes');}finally{await db.exec('rollback');}
    console.log(`PASS: ${checks} partial/full Daily result, zero-progress, reward, PB, history, ongoing training, stale candidate, group bonus, retry and authorization checks.`);
  }finally{await db.close();}
}
if(require.main===module)run().catch(error=>{console.error(error.stack,error.where||'');process.exitCode=1;});
module.exports={initialize,id,migrationFiles,partialMigration};
