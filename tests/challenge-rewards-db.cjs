const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261002080137_auto_award_weekly_challenge_rewards.sql'),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function initialize(db){
 await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
 grant usage on schema public,auth,private to authenticated,service_role;grant usage on schema public,auth to anon;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,country_code text default 'AU');
 create table coach_athletes(coach_id uuid,athlete_id uuid,primary key(coach_id,athlete_id));
 create table coach_athlete_groups(coach_id uuid,athlete_id uuid,group_name text);
 create table private.rider_scoring_pauses(athlete_id uuid primary key,scoring_paused boolean default false);
 create table private.rider_feature_access(athlete_id uuid primary key,features_disabled boolean default false);
 create function private.rider_scoring_paused(uuid) returns boolean language sql as $$select exists(select 1 from private.rider_scoring_pauses where athlete_id=$1 and scoring_paused)$$;
 create table weekly_challenges(id uuid primary key,title text,description text,category text,completion_rule text default 'standard',target_count integer,reward_points integer default 5,audience_group text,starts_at timestamptz,ends_at timestamptz,status text default 'active',created_by uuid,created_at timestamptz default now());
 create table weekly_challenge_completions(challenge_id uuid references weekly_challenges,athlete_id uuid references profiles,awarded_at timestamptz default now(),primary key(challenge_id,athlete_id));
 create table weekly_trick_assignments(id uuid primary key,athlete_id uuid,category text,week_start date default current_date);
 create table assignment_progress(assignment_id uuid primary key references weekly_trick_assignments,athlete_id uuid,completed_at timestamptz);
 create table percentage_attempts(id uuid default gen_random_uuid(),assignment_id uuid references weekly_trick_assignments,athlete_id uuid,attempt_number integer,landed boolean,created_at timestamptz default now(),unique(assignment_id,attempt_number));
 create table assignment_point_awards(id uuid default gen_random_uuid(),assignment_id uuid references weekly_trick_assignments,athlete_id uuid,points integer,created_at timestamptz default now());
 create table leaderboard_point_adjustments(id uuid default gen_random_uuid(),athlete_id uuid,coach_id uuid,points integer,reason text,week_start date,created_at timestamptz default now());
 create table notification_fixture(challenge_id uuid,athlete_id uuid);
 create function private.fixture_notify() returns trigger language plpgsql as $$begin insert into public.notification_fixture values(new.challenge_id,new.athlete_id);return new;end$$;
 create trigger fixture_notify after insert on weekly_challenge_completions for each row execute function private.fixture_notify();
 create function private.activate_due_weekly_challenges() returns integer language plpgsql as $$declare n integer;begin update public.weekly_challenges set status='active' where status='scheduled' and starts_at<=now() and ends_at>now();get diagnostics n=row_count;return n;end$$;
 grant select on weekly_challenge_completions,leaderboard_point_adjustments to authenticated;
 grant select,insert,update on assignment_progress,percentage_attempts,assignment_point_awards to authenticated;
 `);
 const source=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/daily-production-functions.json'),'utf8')).functions;
 for(const signature of ['jkcrew_country_timezone(text)','jkcrew_week_bounds(text,timestamp with time zone)']) await db.exec(source.find(f=>f.signature===signature).definition);
}
async function run(){
 const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');const db=new PGlite();let checks=0;
 const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const value=async(sql,args=[])=> Object.values((await q(sql,args))[0])[0];
 const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
 const actor=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');};
 const inspect=async fn=>{await db.exec('reset role');try{return await fn();}finally{await db.exec('set role authenticated');}};
 const denied=async(fn,pattern)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);checks++;}finally{await db.exec('rollback to savepoint expected_failure');}};
 const count=()=>value('select count(*)::int from weekly_challenge_completions');
 const points=()=>value('select coalesce(sum(points),0)::int from leaderboard_point_adjustments');
 const scenario=async(name,fn)=>{await db.exec('reset role;begin');try{await fn();console.log('PASS '+name);}finally{await db.exec('rollback;reset role');}};
 const assignments=async(n,rider=10,category='dialled',base=100)=>{await db.exec('reset role');for(let i=0;i<n;i++)await db.query('insert into weekly_trick_assignments(id,athlete_id,category) values($1,$2,$3)',[id(base+i),id(rider),category]);};
 const challenge=async({n=5,category='dialled',rule='standard',group=null,status='active',reward=5}={})=>{await db.exec('reset role');await db.query("insert into weekly_challenges(id,title,description,category,target_count,reward_points,completion_rule,audience_group,starts_at,ends_at,created_by,status) values($1,'Challenge','Description',$2,$3,$4,$5,$6,now()-interval '1 hour',now()+interval '1 day',$7,$8)",[id(50),category,n,reward,rule,group,id(1),status]);};
 const land=n=>db.query('insert into assignment_progress values($1,$2,now()) on conflict(assignment_id) do update set completed_at=excluded.completed_at',[id(n),id(10)]);
 const get=()=>value('select get_my_weekly_challenge()');
 try{
 await initialize(db);
 await db.exec(`insert into profiles(id,role) values('${id(1)}','coach'),('${id(2)}','coach'),('${id(3)}','parent'),('${id(10)}','athlete'),('${id(11)}','athlete');insert into coach_athletes values('${id(1)}','${id(10)}');`);
 await db.exec(migration);check(await points(),0,'Migration never backfills scores');
 await scenario('coach-recorded final Dialled automatically awards without opening Challenges',async()=>{
  await challenge();await assignments(5);await actor(1);
  for(let i=0;i<4;i++)await land(100+i);check(await points(),0,'4 of 5 does not award');await land(104);check(await points(),5,'Coach final trick immediately adds +5');check(await count(),1);
  check(await inspect(()=>value('select count(*)::int from notification_fixture')),1,'One completion notification');
  check(await inspect(()=>value("select a.week_start=b.week_start_date from leaderboard_point_adjustments a cross join lateral jkcrew_week_bounds('AU',a.created_at)b")),true,'Correct rider weekly bucket');
  await actor(10);check((await get()).new_award,false,'Opening Challenges does not double award');await land(104);check(await points(),5,'Repeated completion is idempotent');check((await get()).completed,true);
  await db.query('update assignment_progress set completed_at=null where assignment_id=$1',[id(104)]);check((await get()).completed,true,'Earned completion preserved by corrections');check(await points(),5);
 });
 await scenario('rider direct ledger path, no double count from ledger and completion evidence',async()=>{
  await challenge({n:1,category:'bonus'});await assignments(1,10,'bonus');await actor(10);
  await db.query('insert into assignment_point_awards(athlete_id,assignment_id,points) values($1,$2,5)',[id(10),id(100)]);check(await points(),5);await land(100);check(await points(),5);check(await count(),1);
 });
 await scenario('three perfect Percentage sets award on final attempt only',async()=>{
  await challenge({n:3,category:'percentage',rule:'percentage_perfect',reward:10});await assignments(3,10,'percentage');await actor(10);
  for(let a=100;a<103;a++)for(let i=1;i<=10;i++){
   await db.query('insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed) values($1,$2,$3,$4)',[id(a),id(10),i,!(a===102&&i===10)]);
  }check(await points(),0,'29 landed and one missed do not qualify');
  await db.query('update percentage_attempts set landed=true where assignment_id=$1 and attempt_number=10',[id(102)]);check(await points(),10);check(await count(),1);await get();check(await points(),10);
 });
 await scenario('wrong dates, mixed weeks, partial sets and outside categories excluded',async()=>{
  await challenge({n:3,category:'percentage',rule:'percentage_perfect',reward:10});await assignments(3,10,'percentage');await db.query("update weekly_trick_assignments set week_start=current_date-7 where id=$1",[id(102)]);await actor(10);
  for(let a=100;a<103;a++)for(let i=1;i<=10;i++)await db.query('insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed) values($1,$2,$3,true)',[id(a),id(10),i]);check(await points(),0,'Separate sheets cannot combine');
  await inspect(()=>db.query('update weekly_trick_assignments set week_start=current_date where id=$1',[id(102)]));
  await db.query("update percentage_attempts set created_at=now()-interval '2 hours' where assignment_id=$1",[id(102)]);check((await get()).progress,2,'Old attempts do not qualify');check(await points(),0);
 });
 await scenario('permissions, group audience, paused and disabled rider cannot award',async()=>{
  await challenge({n:1,group:'Monday'});await assignments(1);await actor(2);await land(100);check(await points(),0,'Unlinked coach blocked even if source RLS mistakenly lets fixture write');await actor(3);await land(100);check(await points(),0,'Parent blocked');await actor(11);await land(100);check(await points(),0,'Other rider blocked');await actor(null);await land(100);check(await points(),0,'No actor blocked');
  await actor(10);await get();check(await points(),0,'Wrong audience excluded');await inspect(()=>db.query('insert into coach_athlete_groups values($1,$2,$3)',[id(2),id(10),'Monday']));await get();check(await points(),0,'Other coach group cannot grant eligibility');
  await inspect(()=>db.query('insert into coach_athlete_groups values($1,$2,$3)',[id(1),id(10),'Monday']));await inspect(()=>db.query('insert into private.rider_scoring_pauses values($1,true)',[id(10)]));await get();check(await points(),0,'Scoring pause respected');
  await inspect(()=>db.query('update private.rider_scoring_pauses set scoring_paused=false'));await inspect(()=>db.query('insert into private.rider_feature_access values($1,true)',[id(10)]));await get();check(await points(),0,'Feature restriction respected');
  await inspect(()=>db.query('update private.rider_feature_access set features_disabled=false'));check((await get()).new_award,true,'Authorized retry can recover existing qualifying progress');check(await points(),5);
  await denied(()=>db.query('select private.award_weekly_challenge($1,$2)',[id(50),id(10)]),/permission denied/);
  await denied(()=>db.query('insert into leaderboard_point_adjustments(athlete_id,points) values($1,100)',[id(10)]),/permission denied/);
  await db.exec('reset role;set role anon');await denied(()=>get(),/permission denied/);
 });
 await scenario('scheduled challenge activates on training, expired challenge does not award',async()=>{
  await challenge({n:1,status:'scheduled'});await assignments(1);await actor(10);await land(100);check(await points(),5);
  await inspect(()=>db.exec('delete from leaderboard_point_adjustments;delete from weekly_challenge_completions;'));await inspect(()=>db.query("update weekly_challenges set ends_at=now()-interval '1 second'"));await land(100);check(await points(),0);check(await get(),null);
 });
 await scenario('reward failure rolls back original completion and can safely retry',async()=>{
  await challenge({n:1});await assignments(1);await db.exec("create function private.fail_reward() returns trigger language plpgsql as $$begin raise exception 'Simulated point ledger failure';end$$;create trigger fail_reward before insert on leaderboard_point_adjustments for each row execute function private.fail_reward();");await actor(10);
  await denied(()=>land(100),/Simulated point ledger failure/);check(await count(),0);check(await points(),0);check(await inspect(()=>value('select count(*)::int from assignment_progress')),0,'Input save failure leaves no fake completion');check(await inspect(()=>value('select count(*)::int from notification_fixture')),0);
  await inspect(()=>db.exec('drop trigger fail_reward on leaderboard_point_adjustments'));await land(100);check(await points(),5);check(await count(),1);
 });
 await scenario('legacy award remains one award and inconsistent history never silently overwritten',async()=>{
  await challenge({n:1});await assignments(1);await db.query('insert into leaderboard_point_adjustments(athlete_id,points,reason) values($1,5,$2)',[id(10),'Weekly challenge '+id(50)+' completed']);await actor(10);await land(100);check(await points(),5);check(await count(),1);check((await get()).completed,true);
  await inspect(()=>db.exec('delete from weekly_challenge_completions;update leaderboard_point_adjustments set points=3;'));await land(100);check(await points(),3);check(await count(),0,'Inconsistent manual award not overwritten or duplicated');
 });
 console.log(`PASS ${checks} challenge reward checks`);
 }finally{await db.close();}
}
module.exports={initialize,id,migration};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
