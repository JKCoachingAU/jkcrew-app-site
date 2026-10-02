// Regression for a Sunday-reset rider sheet versus a Monday-start challenge.
// All rows are synthetic; never connects to production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {initialize,id,migration:automaticMigration}=require('./challenge-rewards-db.cjs');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261002092847_qualify_challenges_by_rider_sheet_week.sql'),'utf8');
async function run(){const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');const db=new PGlite();let checks=0;
 const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
 const q=(sql,args=[])=>db.query(sql,args);
 const actor=async(n)=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');};
 const inspect=async(fn)=>{await db.exec('reset role');try{return await fn();}finally{await db.exec('set role authenticated');}};
 const progress=(rider=10,challenge=50)=>value('select private.weekly_challenge_progress($1,$2)',[id(challenge),id(rider)]);
 const denied=async(fn,pattern)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);checks++;}finally{await db.exec('rollback to savepoint expected_failure');}};
 const setup=async({category='dialled',rule='standard',rider=10}={})=>{
  await db.exec('reset role');await q("insert into weekly_challenges(id,title,category,completion_rule,target_count,reward_points,starts_at,ends_at,created_by) values($1,'Weekly test',$2,$3,5,5,'2026-09-27T14:00:00Z','2026-10-04T14:00:00Z',$4)",[id(50),category,rule,id(1)]);
 };
 const assignment=async(n,{rider=10,week='2026-09-27',category='dialled',at=null,ledger=false}={})=>{
  await q('insert into weekly_trick_assignments(id,athlete_id,week_start,category) values($1,$2,$3,$4)',[id(n),id(rider),week,category]);
  if(at)await q(ledger?'insert into assignment_point_awards(assignment_id,athlete_id,created_at,points) values($1,$2,$3,2)':'insert into assignment_progress(assignment_id,athlete_id,completed_at) values($1,$2,$3)',[id(n),id(rider),at]);
 };
 const selectWeek=()=>q("update weekly_challenges set qualification_week='2026-09-27' where id=$1",[id(50)]);
 const scenario=async(name,fn)=>{await db.exec('reset role;begin');try{await q("select set_config('request.jwt.claim.sub','',false)");await fn();console.log('PASS '+name);}finally{await db.exec('rollback;reset role');}};
 try{
  await initialize(db);await db.exec(automaticMigration);
  await db.exec(`insert into profiles(id,role,country_code) values('${id(1)}','coach','AU'),('${id(2)}','coach','AU'),('${id(10)}','athlete','DE'),('${id(11)}','athlete','AU'),('${id(12)}','athlete','DE');insert into coach_athletes values('${id(1)}','${id(10)}'),('${id(1)}','${id(11)}');`);
  await setup();await assignment(100,{at:'2026-09-27T11:50:17Z'});await assignment(101,{at:'2026-09-27T13:18:12Z'});await assignment(102,{at:'2026-09-30T17:48:54Z'});await assignment(103,{at:'2026-10-01T16:40:20Z'});await assignment(104,{at:'2026-10-01T16:59:16Z'});
  // Extra landings on the previous week's sheet must not inflate this challenge.
  for(let n=105;n<108;n++)await assignment(n,{week:'2026-09-20',at:'2026-09-26T15:28:00Z'});
  eq(await progress(),3,'Reproduces5/5 sheet yet3/5 challenge');
  const snapshot=()=>value(`select jsonb_build_object('challenges',(select jsonb_agg(to_jsonb(c)-'qualification_week') from weekly_challenges c),'completions',(select jsonb_agg(c) from weekly_challenge_completions c),'awards',(select jsonb_agg(a) from leaderboard_point_adjustments a),'progress',(select jsonb_agg(p) from assignment_progress p),'trick_awards',(select jsonb_agg(a) from assignment_point_awards a))`);
  const before=await snapshot();const privileges=await value("select proacl::text from pg_proc where oid='private.weekly_challenge_progress(uuid,uuid)'::regprocedure");
  await db.exec(migration);eq(await snapshot(),before,'Migration changes no challenge settings, training, completion or score');eq(await value("select qualification_week is null from weekly_challenges"),true);eq(await progress(),3,'Null preserves old timestamp semantics');
  eq(await value("select proacl::text from pg_proc where oid='private.weekly_challenge_progress(uuid,uuid)'::regprocedure"),privileges,'Helper privileges retained');
  await selectWeek();eq(await progress(),5,'All 5 current-sheet landings counted; 3 old-sheet extras excluded');
  await q("update weekly_challenges set qualification_week=null");eq(await progress(),3,'Nullable opt-in reversible without changing data');
  await db.exec('delete from assignment_progress;delete from assignment_point_awards;delete from weekly_trick_assignments;delete from weekly_challenges;');

  await scenario('rider-local Sunday boundaries, category, owner and exactsheet filters',async()=>{
   await setup();await selectWeek();
   // Germany summer time: Sep27 midnight = Sep26 22:00 UTC.
   const times=['2026-09-26T21:59:59.999999Z','2026-09-26T22:00:00Z','2026-10-03T21:59:59.999999Z','2026-10-03T22:00:00Z'];
   for(let i=0;i<times.length;i++)await assignment(100+i,{at:times[i]});eq(await progress(),2,'DE exactstart included, exactnextSunday excluded');
   await assignment(110,{week:'2026-09-20',at:'2026-09-27T12:00:00Z'});await assignment(111,{category:'bonus',at:'2026-09-27T12:00:00Z'});await assignment(112,{rider:12,at:'2026-09-27T12:00:00Z'});eq(await progress(),2,'Different sheet/category/rider not counted');
   await assignment(113,{ledger:true,at:'2026-09-27T12:00:00Z'});eq(await progress(),3,'Authoritative award-only evidence accepted');
   await q('insert into assignment_progress values($1,$2,$3)',[id(113),id(10),'2026-09-27T12:00:00Z']);eq(await progress(),3,'Progress plus ledger evidence counts one assignment');
   // Brisbane: Sep27 midnight = Sep26 14:00 UTC.
   for(const [i,at]of ['2026-09-26T13:59:59.999999Z','2026-09-26T14:00:00Z','2026-10-03T13:59:59.999999Z','2026-10-03T14:00:00Z'].entries())await assignment(120+i,{rider:11,at,ledger:true});eq(await progress(11),2,'Australia uses its own boundaries, including the award-only path');
   await assignment(130,{rider:11,week:'2026-09-20',at:'2026-09-27T12:00:00Z',ledger:true});eq(await progress(11),2,'Old-sheet ledger is excluded');
  });
  await scenario('legacy standard window remains exact and inclusive when not configured',async()=>{
   await setup();await assignment(100,{at:'2026-09-27T13:59:59.999999Z'});await assignment(101,{at:'2026-09-27T14:00:00Z'});await assignment(102,{at:'2026-10-04T14:00:00Z'});await assignment(103,{at:'2026-10-04T14:00:00.000001Z'});eq(await progress(),2);
   await assignment(104,{week:'2026-09-20',at:'2026-09-30T14:00:00Z'});eq(await progress(),3,'Legacy rolling rule still counts the window regardless of sheet');
  });
  await scenario('Perfectionist remains strict and the legacy rolling rule is unchanged',async()=>{
   await setup({category:'percentage',rule:'percentage_perfect'});
   for(let n=100;n<103;n++){await assignment(n,{category:'percentage'});for(let a=1;a<=10;a++)await q('insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed,created_at) values($1,$2,$3,true,$4)',[id(n),id(10),a,n===100?'2026-09-27T13:00:00Z':n===101?'2026-09-28T15:00:00Z':'2026-10-04T14:00:00Z']);}
   eq(await progress(),2,'Null still includes the exact end and excludes pre-start attempts');await selectWeek();eq(await progress(),2,'Opt-in counts the Sunday set but excludes the next Sunday set');
   await q('update percentage_attempts set landed=false where assignment_id=$1 and attempt_number=1',[id(100)]);eq(await progress(),1,'Missed attempt preventsperfectset');
   await q('update weekly_trick_assignments set week_start=$1 where id=$2',['2026-09-20',id(101)]);eq(await progress(),0,'Perfect set from the wrong sheet is excluded');
  });
  await scenario('perfect sets respect exact local boundaries and a Sunday sheet date',async()=>{
   await setup({category:'percentage',rule:'percentage_perfect'});await selectWeek();
   await denied(()=>q("update weekly_challenges set qualification_week='2026-09-28'"),/qualification_week_sunday/);eq(await value('select qualification_week::text from weekly_challenges'),'2026-09-27','Monday is rejected without changing the selected week');
   for(const [index,at] of ['2026-09-26T22:00:00Z','2026-10-03T21:59:59.999999Z','2026-10-03T22:00:00Z'].entries()){
    await assignment(100+index,{category:'percentage'});for(let i=1;i<=10;i++)await q('insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed,created_at) values($1,$2,$3,true,$4)',[id(100+index),id(10),i,at]);
   }
   eq(await progress(),2,'Perfect sets include exact local start, exclude exact next local Sunday');
   await q('update percentage_attempts set created_at=$1 where assignment_id=$2 and attempt_number=1',['2026-09-26T21:59:59.999999Z',id(100)]);eq(await progress(),1,'One attempt before local start invalidates the perfect set');
  });
  await scenario('timezone daylight-saving change still uses midnight at both ends',async()=>{
   await setup();await q("update weekly_challenges set qualification_week='2026-10-25'");await assignment(100,{week:'2026-10-25',at:'2026-10-24T22:00:00Z'});await assignment(101,{week:'2026-10-25',at:'2026-10-31T22:59:59Z'});await assignment(102,{week:'2026-10-25',at:'2026-10-31T23:00:00Z'});eq(await progress(),2,'Germany’s 25-hour Sunday correctly ends at midnight CET next Sunday');
  });
  await scenario('configured-week award keeps permissions, pause, retries and deadline unchanged',async()=>{
   await setup();await selectWeek();for(let i=0;i<5;i++)await assignment(100+i,{at:'2026-09-27T12:00:00Z'});
   await q("update weekly_challenges set starts_at=now()-interval '1 hour',ends_at=now()+interval '1 hour'");
   const ends=await value('select ends_at from weekly_challenges');
   await actor(2);eq(await value('select get_my_weekly_challenge()'),null,'Unlinked coach cannot claim');
   await denied(()=>value('select private.weekly_challenge_progress($1,$2)',[id(50),id(10)]),/permission denied/);
   await actor(12);eq(await value('select get_my_weekly_challenge()'),null,'Unlinked rider is not eligible');
   await actor(10);await denied(()=>q("update weekly_challenges set qualification_week='2026-09-20'"),/permission denied/);
   await inspect(()=>q('insert into private.rider_scoring_pauses values($1,true)',[id(10)]));
   let status=await value('select get_my_weekly_challenge()');eq(status.progress,5);eq(status.completed,false,'Scoring pause still prevents a new bonus');eq(await inspect(()=>value('select count(*)::int from leaderboard_point_adjustments')),0);
   await inspect(()=>q('update private.rider_scoring_pauses set scoring_paused=false'));
   await inspect(()=>q('insert into private.rider_feature_access values($1,true)',[id(10)]));eq((await value('select get_my_weekly_challenge()')).new_award,false,'Disabled rider is still blocked');
   await inspect(()=>q('update private.rider_feature_access set features_disabled=false'));
   status=await value('select get_my_weekly_challenge()');eq(status.new_award,true);eq(status.completed,true);eq(await inspect(()=>value('select sum(points)::int from leaderboard_point_adjustments')),5,'Exactly 5 challenge bonus points');
   eq((await value('select get_my_weekly_challenge()')).new_award,false,'Repeat claims are idempotent');eq(await inspect(()=>value('select count(*)::int from weekly_challenge_completions')),1);
   eq(await inspect(()=>value('select ends_at from weekly_challenges')),ends,'Qualification does not extend the deadline');
   await inspect(()=>q("update weekly_challenges set ends_at=now()-interval '1 second'"));eq(await value('select get_my_weekly_challenge()'),null,'Expired challenge still cannot be claimed');eq(await inspect(()=>value('select sum(points)::int from leaderboard_point_adjustments')),5);

  });
  console.log(`PASS ${checks} challenge sheet-week checks`);
 }finally{await db.close();}}
run().catch(e=>{console.error(e);process.exitCode=1;});
