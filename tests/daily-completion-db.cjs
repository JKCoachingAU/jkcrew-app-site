const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
(async () => {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema private; create role anon; create role authenticated; create role service_role;
    grant usage on schema public,auth to authenticated,anon;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create type public.user_role as enum ('athlete','coach','admin','parent');
    create table profiles(id uuid primary key,role user_role,display_name text,country_code text default 'AU',country_name text default 'Australia',level integer default 1,avatar jsonb default '{}',ghost_mode boolean default false,daily_pb_seconds integer,daily_pb_updated_at timestamptz,xp_total integer default 0,updated_at timestamptz default now());
    create table coach_athletes(coach_id uuid,athlete_id uuid); create table parent_athletes(parent_id uuid,athlete_id uuid);
    create table weekly_trick_assignments(id uuid primary key default gen_random_uuid(),coach_id uuid,athlete_id uuid,week_start date not null,trick_name text,category text,target_reps integer default 1,notes text default '',sort_order integer default 0,venue text default '',created_at timestamptz default now(),updated_at timestamptz default now());
    create table assignment_progress(assignment_id uuid primary key references weekly_trick_assignments(id) on delete cascade,athlete_id uuid,progress_date date,completed_at timestamptz,streak_count integer default 0,updated_at timestamptz default now());
    create table training_sessions(id uuid primary key default gen_random_uuid(),athlete_id uuid,started_at timestamptz default now(),ended_at timestamptz,total_points integer default 0,notes text default '',created_at timestamptz default now(),daily_completed_seconds integer,daily_completed_at timestamptz);
    create table coach_group_sessions(id uuid primary key default gen_random_uuid(),coach_id uuid,group_name text,venue text default '',status text default 'running',started_at timestamptz default now(),paused_at timestamptz,total_paused_seconds integer default 0,ended_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table coach_group_session_participants(group_session_id uuid,athlete_id uuid,training_session_id uuid,joined_at timestamptz default now(),last_activity_at timestamptz,daily_finished_at timestamptz,daily_finish_seconds integer,primary key(group_session_id,athlete_id));
    create table assignment_point_awards(id uuid primary key default gen_random_uuid(),athlete_id uuid,session_id uuid,assignment_id uuid,award_key text,points integer,venue text default '',created_at timestamptz default now(),unique(athlete_id,award_key));
    create table trick_attempts(id uuid primary key default gen_random_uuid(),session_id uuid,athlete_id uuid,trick_name text,category text,status text,duration_seconds integer,points integer,created_at timestamptz default now());
    create table xp_ledger(id uuid primary key default gen_random_uuid(),athlete_id uuid,source_type text,source_id text,xp integer,reason text,assignment_id uuid,session_id uuid,trick_name text,venue text,coach_id uuid,metadata jsonb default '{}',level_before integer,level_after integer,created_at timestamptz default now(),updated_at timestamptz default now(),unique(athlete_id,source_type,source_id));
    create table leaderboard_point_adjustments(id uuid primary key default gen_random_uuid(),athlete_id uuid,coach_id uuid,points integer,reason text,week_start date,created_at timestamptz default now());
    create table tricktionary_landing_history(id text primary key,assignment_id uuid,athlete_id uuid,trick_name text,category text,notes text default '',venue text,landed_at timestamptz,landing_date date,landed_count integer,evidence_type text);
    create table push_notification_queue(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,title text,body text,url text,payload jsonb,dedupe_key text unique);
    create table push_preferences(user_id uuid,trick_completed boolean); create table push_subscriptions(user_id uuid,enabled boolean);
    -- Cosmetic badge computation is outside this regression; award storage and
    -- authoritative leaderboard scoring below use the retrieved production SQL.
    create function get_earned_badges(uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
    create function level_for_xp(integer) returns integer language sql as $$select 1$$;
    create function sync_profile_xp(p_id uuid) returns jsonb language plpgsql as $$declare n integer; begin select coalesce(sum(xp),0)::integer into n from xp_ledger where athlete_id=p_id; update profiles set xp_total=n where id=p_id; return jsonb_build_object('level',1,'xp_total',n); end$$;
  `);
  const source = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/daily-production-functions.json'),'utf8')).functions;
  const ordered = ['jkcrew_country_timezone(text)','jkcrew_week_bounds(text,timestamp with time zone)','private.jkcrew_venue_key(text)','level_badge(integer)','sync_xp_award(uuid,text,text,integer,text,uuid,uuid,text,text,uuid,jsonb)','sync_assignment_progress_xp()','sync_daily_pb_xp()','sync_daily_completion_timing()','record_assignment_action(uuid,text)','record_assignment_action_at_venue(uuid,text,text)','finish_group_session_daily(uuid,uuid,integer)','get_weekly_leaderboard()'];
  for (const signature of ordered) await db.exec(source.find(f=>f.signature===signature).definition);
  await db.exec(`create trigger assignment_progress_xp_sync after insert or update or delete on assignment_progress for each row execute function sync_assignment_progress_xp();
    create trigger assignment_progress_daily_completion_timing after insert or update of progress_date on assignment_progress for each row when(new.progress_date is not null) execute function sync_daily_completion_timing();
    create trigger profiles_daily_pb_xp_sync after update of daily_pb_seconds on profiles for each row execute function sync_daily_pb_xp();`);
  const historySql=fs.readFileSync(path.join(root,'supabase/migrations/20260911030012_preserve_tricktionary_landed_history.sql'),'utf8');
  for (const name of ['private.capture_tricktionary_progress','private.sync_tricktionary_progress_history']) {
    const start=historySql.indexOf(`create or replace function ${name}(`), end=historySql.indexOf('\n$$;',start)+4;
    await db.exec(historySql.slice(start,end));
  }
  await db.exec(`create trigger tricktionary_progress_history after insert or update of progress_date,completed_at,streak_count on assignment_progress for each row execute function private.sync_tricktionary_progress_history();`);
  const actor=async n=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const scalar=async(sql,args=[]) => Object.values((await q(sql,args))[0])[0];
  const rpc=async(name,args=[]) => scalar(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
  const rider=1,coach=2,parent=3,stranger=4,otherRider=5;
  for(const [n,role,name] of [[rider,'athlete','Fixture Rider'],[coach,'coach','Fixture Coach'],[parent,'parent','Fixture Parent'],[stranger,'coach','Unlinked Coach'],[otherRider,'athlete','Second Rider']]) await db.query('insert into profiles(id,role,display_name) values($1,$2,$3)',[id(n),role,name]);
  await db.query('insert into coach_athletes values($1,$2),($1,$3)',[id(coach),id(rider),id(otherRider)]); await db.query('insert into parent_athletes values($1,$2)',[id(parent),id(rider)]);
  const assignment=async(n,who=rider,category='daily',name=`Trick ${n}`,venue='Test park',weekOffset=0)=>db.query(`insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select $1,$2,$3,b.week_start_date+$7::integer,$4,$5,$6 from jkcrew_week_bounds('AU') b`,[id(n),id(coach),id(who),name,category,venue,weekOffset]);
  const session=async(n,who=rider,seconds=600)=>db.query('insert into training_sessions(id,athlete_id,started_at) values($1,$2,now()-make_interval(secs=>$3))',[id(n),id(who),seconds]);
  const action=async(n,what='landed',tap=null)=>rpc('record_daily_trick_action',[id(n),what,'Test park',tap]);
  const today=()=>rpc('get_today_training_progress',[id(rider)]);
  const confirmed=()=>scalar("select count(*)::int from private.daily_finish_candidates where status='confirmed'");
  await assignment(10);await assignment(11);await session(100);
  await actor(rider);
  // Prove the live pre-change definitions exhibit the exact bug.
  await rpc('record_assignment_action',[id(10),'landed']); await rpc('record_assignment_action',[id(11),'landed']);
  assert.equal(await scalar('select total_points from training_sessions where id=$1',[id(100)]),2,'Old final tick automatically awards completion points');
  assert.notEqual(await scalar('select daily_completed_seconds from training_sessions where id=$1',[id(100)]),null,'Old trigger automatically finalizes time');
  assert.equal(await scalar("select xp from xp_ledger where source_type='daily_complete'"),35,'Old XP trigger autoawards before confirmation');
  // Reset only generated test rows; preserve a legacy PB to verify no migration rewriting.
  await db.exec('truncate assignment_progress,trick_attempts,assignment_point_awards,xp_ledger; update training_sessions set total_points=0,daily_completed_at=null,daily_completed_seconds=null; update profiles set daily_pb_seconds=99,xp_total=0 where role=\'athlete\';');
  const before=await q('select * from profiles order by id');
  await db.query('insert into push_subscriptions values($1,true)',[id(coach)]);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260911085353_confirm_daily_tricks_and_today_progress.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260911100447_make_daily_standings_read_only.sql'),'utf8'));
  assert.deepEqual(await q('select * from profiles order by id'),before,'Migration preserves existing rider/PB data');
  assert.equal((await action(10)).completion_candidate,null);
  const tap=await scalar("select clock_timestamp()-interval '2 seconds'");
  const final=await action(11,'landed',tap.toISOString());
  assert(final.completion_candidate?.candidate_id,'Only actual final tick returns confirmation candidate');
  let candidate=final.completion_candidate;
  assert.equal(candidate.rider_name,'Fixture Rider');assert.equal(candidate.total_count,2);assert(candidate.seconds>=598 && candidate.seconds<=602);
  assert.equal(await scalar('select total_points from training_sessions where id=$1',[id(100)]),0);assert.equal(await scalar('select daily_completed_seconds from training_sessions where id=$1',[id(100)]),null);
  assert.equal(await scalar('select count(*)::int from xp_ledger where athlete_id=$1',[id(rider)]),1,'Only preexisting PB test fixture XP exists, no new completion award');
  await assert.rejects(()=>db.query('update training_sessions set daily_completed_seconds=1,daily_completed_at=now() where id=$1',[id(100)]),/Confirm Daily/);
  await assert.rejects(()=>db.query('update profiles set daily_pb_seconds=1 where id=$1',[id(rider)]),/Confirm Daily/);
  assert.equal((await action(11)).completion_candidate,null,'Repeated landed event does not auto reopen or create a fresh candidate');
  assert.equal(await scalar('select count(*)::int from push_notification_queue'),0,'Pending ticks must not send a completion notification');
  assert.equal((await today()).daily_results.length,0,'Reading Today does not confirm a complete pending list');
  const reopen=await rpc('prepare_daily_finish',[id(rider),id(100),'Test park',null]);
  assert.notEqual(reopen.completion_candidate.candidate_id,candidate.candidate_id); assert(reopen.completion_candidate.seconds>=candidate.seconds,'Go back/reopen captures later running clock');
  await assert.rejects(()=>rpc('confirm_daily_finish',[candidate.candidate_id]),/changed/); candidate=reopen.completion_candidate;
  await action(10,'unlanded'); await assert.rejects(()=>rpc('confirm_daily_finish',[candidate.candidate_id]),/changed/);
  candidate=(await action(10)).completion_candidate;
  await new Promise(resolve=>setTimeout(resolve,1100));
  await actor(coach); const result=await rpc('confirm_daily_finish',[candidate.candidate_id]);
  assert.equal(result.seconds,candidate.seconds,'Confirmation reading delay cannot alter captured time');assert.equal(result.completion_points,2);assert.equal(result.completion_xp,35);assert.equal(result.is_first_pb,true);assert.equal(result.previous_pb_seconds,null,'Unproven legacy scalar is not compared to a different checklist');
  assert.equal(await scalar('select daily_pb_seconds from profiles where id=$1',[id(rider)]),99,'Legacy faster global PB is preserved');
  assert.equal(await scalar('select ended_at from training_sessions where id=$1',[id(100)]),null,'Daily finish leaves untimed riding active');
  const retries=await Promise.all([rpc('confirm_daily_finish',[candidate.candidate_id]),rpc('confirm_daily_finish',[candidate.candidate_id])]);
  assert.deepEqual(retries,[result,result]);assert.equal(await confirmed(),1); assert.equal(await scalar('select count(*)::int from assignment_point_awards'),2);
  assert.deepEqual((await rpc('prepare_daily_finish',[id(rider),id(100)])).result,result,'Omitted venue inherits saved timer context');
  await assert.rejects(()=>rpc('prepare_daily_finish',[id(rider),id(100),'',null]),/this venue/);
  await actor(rider);assert.deepEqual(await rpc('confirm_daily_finish',[candidate.candidate_id]),result,'Rider and coach share one authoritative result');
  assert.equal((await today()).today_points,2);assert.equal((await today()).daily_results.length,1);
  assert.equal((await today()).completed_categories.find(c=>c.category==='daily').items.length,2);
  await action(10,'unlanded'); assert.equal((await today()).completed_categories.find(c=>c.category==='daily').items.length,1); assert.equal((await today()).today_points,2,'Post-finish correction preserves earned daily points as before');
  await rpc('record_assignment_action',[id(10),'landed']);assert.equal(await scalar('select count(*)::int from assignment_point_awards'),2,'Legacy RPC now routes through confirmation, not autoawards');
  await assert.rejects(()=>rpc('finish_group_session_daily',[id(400),id(rider),1]),/confirm/);
  // Untimed categories retain real production scoring/XP and count once across visits.
  for(const [n,category,points] of [[20,'one_bang',2],[21,'dialled',2],[22,'bonus',5],[23,'foam_pit',0]]){
    await assignment(n,rider,category);const first=await rpc('record_assignment_action',[id(n),'landed']);assert.equal(first.points_awarded,points);await rpc('record_assignment_action',[id(n),'landed']);
  }
  assert.equal((await today()).today_points,11);assert.equal((await today()).completed_categories.find(c=>c.category==='one_bang').items.length,1);
  await rpc('record_assignment_action',[id(20),'unlanded']);assert.equal((await today()).today_points,9);assert(!(await today()).completed_categories.some(c=>c.category==='one_bang'));
  // Completion and PB identity follows a second recorded visit, with no daily award duplication.
  await session(101,rider,500);await action(11,'unlanded');candidate=(await action(11)).completion_candidate;
  const second=await rpc('confirm_daily_finish',[candidate.candidate_id]);assert.equal(second.completion_points,0);assert.equal(second.completion_xp,0);assert.equal(second.previous_pb_seconds,result.seconds);assert.equal(second.is_new_pb,true);
  assert.equal(await scalar("select count(*)::int from push_notification_queue where notification_type='daily_list_completed'"),1,'Confirmed rider finish preserves the deduped coach notification');
  await rpc('confirm_daily_finish',[second.result_id]);assert.equal(await scalar('select count(*)::int from push_notification_queue'),1);
  assert.equal((await today()).daily_results.length,2);assert.equal((await today()).today_points,9);
  // Pending candidate rejected for raw progress edits and changed/replaced checklist.
  await session(102,rider,400);await action(10,'unlanded');candidate=(await action(10)).completion_candidate;
  await db.query('update weekly_trick_assignments set target_reps=2 where id=$1',[id(10)]);
  await assert.rejects(()=>rpc('confirm_daily_finish',[candidate.candidate_id]),/changed/);
  candidate=(await rpc('prepare_daily_finish',[id(rider),id(102),'Test park',null])).completion_candidate;
  const changed=await rpc('confirm_daily_finish',[candidate.candidate_id]);assert.equal(changed.is_first_pb,true);assert.equal(changed.previous_pb_seconds,null,'Changed repetition target cannot produce an incompatible PB comparison');
  // Group bonus is awarded once to the first confirmed rider, independent clocks.
  await db.query("insert into coach_group_sessions(id,coach_id,venue,started_at,total_paused_seconds) values($1,$2,'Test park',now()-interval '10 minutes',60)",[id(400),id(coach)]);
  await session(103,rider,100);await session(104,otherRider,100);await assignment(30,otherRider);await assignment(31,otherRider);
  await db.query('insert into coach_group_session_participants(group_session_id,athlete_id,training_session_id) values($1,$2,$3),($1,$4,$5)',[id(400),id(rider),id(103),id(otherRider),id(104)]);
  await action(10,'unlanded');const firstPending=(await action(10)).completion_candidate;
  await actor(coach);await action(30);const otherPending=(await action(31)).completion_candidate;
  assert(otherPending.seconds>=540 && otherPending.seconds<=545,'Group pause is subtracted from Daily timer');
  await db.query("update coach_group_sessions set status='paused',paused_at=now() where id=$1",[id(400)]);
  const groupOther=await rpc('confirm_daily_finish',[otherPending.candidate_id]);const groupFirst=await rpc('confirm_daily_finish',[firstPending.candidate_id]);
  assert.equal(groupOther.completion_points,3);assert.equal(groupFirst.completion_points,0);
  await db.query("update coach_group_sessions set status='running',paused_at=null where id=$1",[id(400)]);assert.equal(await scalar("select count(*)::int from assignment_point_awards where award_key like 'group-first-finish:%'"),1);
  assert.equal(await scalar('select count(*)::int from coach_group_session_participants where daily_finished_at is not null'),2);
  // Under-20 boundary and rejected-save rollback preserve both timer and ticks.
  await db.query("update coach_group_sessions set started_at=now()-interval '30 minutes',total_paused_seconds=0 where id=$1",[id(400)]);
  await session(105,otherRider,0); await db.query('update coach_group_session_participants set training_session_id=$1 where athlete_id=$2',[id(105),id(otherRider)]);
  await action(30,'unlanded');const slow=(await action(30)).completion_candidate;assert(slow.seconds>=1800);
  await db.exec(`create function private.fail_confirmation_once() returns trigger language plpgsql as $$begin raise exception 'Injected save failure';end$$;create trigger fail_confirmation before update of daily_completed_at on training_sessions for each row execute function private.fail_confirmation_once();`);
  await assert.rejects(()=>rpc('confirm_daily_finish',[slow.candidate_id]),/Injected save failure/);
  assert.equal(await scalar('select daily_completed_at from training_sessions where id=$1',[id(105)]),null);assert.equal(await scalar('select status from private.daily_finish_candidates where id=$1',[slow.candidate_id]),'pending','A failed transaction leaves the same candidate available for retry');
  await db.exec('drop trigger fail_confirmation on training_sessions');const slowResult=await rpc('confirm_daily_finish',[slow.candidate_id]);assert.equal(slowResult.seconds,slow.seconds);assert.equal(slowResult.completion_points,0);
  // A stale/future device clock is not trusted as a faster result.
  await session(106,otherRider,-1);await db.query('update training_sessions set started_at=now() where id=$1',[id(106)]);await action(31,'unlanded');await action(30,'unlanded');await action(30);
  const future=(await action(31,'landed','2099-01-01T00:00:00Z')).completion_candidate;assert(future.seconds<=2);assert(new Date(future.captured_at).getUTCFullYear()<2099);
  await db.query('update assignment_progress set progress_date=null where assignment_id=$1',[id(31)]);await assert.rejects(()=>rpc('confirm_daily_finish',[future.candidate_id]),/changed/);
  // Parent read allowed; parent writes, unlinked coach and anonymous calls denied.
  await actor(parent);assert.equal((await today()).athlete_id,id(rider));await assert.rejects(()=>action(10),/private/);
  await actor(stranger);await assert.rejects(()=>today(),error=>error.code==='42501');await assert.rejects(()=>rpc('confirm_daily_finish',[candidate.candidate_id]),/private/);
  await db.query("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(()=>today(),/private/);
  for(const fn of ['record_daily_trick_action(uuid,text,text,timestamp with time zone)','prepare_daily_finish(uuid,uuid,text,timestamp with time zone)','confirm_daily_finish(uuid)','get_today_training_progress(uuid)','start_daily_tricks(text)']) assert.equal(await scalar("select has_function_privilege('anon',$1,'execute')",['public.'+fn]),false);
  assert.equal(await scalar("select has_table_privilege('authenticated','private.daily_finish_candidates','insert')"),false);
  await db.query("insert into profiles(id,role,display_name) values($1,'athlete','Default venue rider')",[id(6)]);await actor(6);
  await assignment(40,6,'daily','Default trick','');
  await assert.rejects(()=>rpc('record_daily_trick_action',[id(40),'landed','',null]),/Start Daily/);
  // Legacy pre-ticked list is preserved, but cannot create a false instant PB.
  await db.query("insert into assignment_progress(assignment_id,athlete_id,progress_date,updated_at) select $1,$2,b.local_today,now()-interval '1 hour' from jkcrew_week_bounds('AU') b",[id(40),id(6)]);
  const defaultTimer=await rpc('start_daily_tricks',['']);assert.equal(defaultTimer.daily_venue,'default');
  await assert.rejects(()=>rpc('prepare_daily_finish',[id(6),defaultTimer.id,'',null]),/before this timer started/);
  await rpc('record_daily_trick_action',[id(40),'unlanded','',null]);const defaultCandidate=(await rpc('record_daily_trick_action',[id(40),'landed','',null])).completion_candidate;
  const defaultResult=await rpc('confirm_daily_finish',[defaultCandidate.candidate_id]);assert.equal(defaultResult.venue,'default');assert.equal(defaultResult.completion_points,2);
  await assignment(41,6,'daily','Second park trick','Another park');await assert.rejects(()=>rpc('record_daily_trick_action',[id(41),'landed','Another park',null]),/this venue/);const anotherTimer=await rpc('start_daily_tricks',['Another park']);assert.notEqual(anotherTimer.id,defaultTimer.id);assert.equal(anotherTimer.daily_venue,'Another park');
  const anotherCandidate=(await rpc('record_daily_trick_action',[id(41),'landed','Another park',null])).completion_candidate;const anotherResult=await rpc('confirm_daily_finish',[anotherCandidate.candidate_id]);assert.equal(anotherResult.completion_points,2);assert.equal(anotherResult.is_first_pb,true);
  assert.equal(await scalar('select ended_at from training_sessions where id=$1',[defaultTimer.id]),null,'Starting another park preserves prior untimed riding history');
  await actor(coach);await db.query('update profiles set daily_pb_seconds=98 where id=$1',[id(rider)]);assert.equal(await scalar('select daily_pb_seconds from profiles where id=$1',[id(rider)]),98,'Linked coach manual PB remains available');
  // Overnight active rows remain in history; fresh local-day timer gets a new row.
  await actor(rider);await db.query('update training_sessions set started_at=now()-interval \'1 day\' where athlete_id=$1',[id(rider)]);
  const oldRows=await scalar('select count(*)::int from training_sessions where athlete_id=$1',[id(rider)]);
  const fresh=await rpc('start_daily_tricks',['Test park']);assert.equal(fresh.athlete_id,id(rider));assert.equal(fresh.daily_completed_at,null);
  assert.equal(await scalar('select count(*)::int from training_sessions where athlete_id=$1',[id(rider)]),oldRows+1);assert.equal(await scalar('select count(*)::int from training_sessions where athlete_id=$1 and ended_at is not null',[id(rider)]),0);
  assert.equal((await rpc('start_daily_tricks',['Test park'])).id,fresh.id,'Repeated Start reuses the active local-day timer');
  // Today is the rider's configured local day even when read by their coach.
  await db.query("insert into profiles(id,role,display_name,country_code) values($1,'athlete','Timezone rider','US')",[id(7)]);await db.query('insert into coach_athletes values($1,$2)',[id(coach),id(7)]);
  const localStart=await scalar("select ((now() at time zone 'America/Los_Angeles')::date)::timestamp at time zone 'America/Los_Angeles'");
  await db.query("insert into assignment_point_awards(athlete_id,award_key,points,created_at) values($1,'before-local-day',20,$2::timestamptz-interval '1 second'),($1,'in-local-day',7,$2::timestamptz+interval '1 second')",[id(7),localStart]);
  await db.query("insert into xp_ledger(athlete_id,source_type,source_id,xp,created_at) values($1,'fixture','before',50,$2::timestamptz-interval '1 second'),($1,'fixture','today',10,$2::timestamptz+interval '1 second')",[id(7),localStart]);
  await db.query("update xp_ledger set updated_at=created_at where athlete_id=$1 and source_id='before'",[id(7)]);
  await db.query("insert into tricktionary_landing_history(id,assignment_id,athlete_id,trick_name,category,notes,landed_at,landed_count,evidence_type) values('today-line',$1,$2,'Manual','lines','Barspin - 180',$3::timestamptz+interval '1 second',1,'progress'),('duplicate-line-evidence',$1,$2,'Manual','lines','Barspin - 180',$3::timestamptz+interval '2 seconds',1,'archived_progress')",[id(70),id(7),localStart]);
  await actor(coach);const localProgress=await rpc('get_today_training_progress',[id(7)]);assert.equal(localProgress.timezone,'America/Los_Angeles');assert.equal(localProgress.today_points,7);assert.equal(localProgress.today_xp,10);assert.equal(localProgress.xp_attribution,'complete');assert.equal(localProgress.completed_categories[0].items.length,1);assert.equal(localProgress.completed_categories[0].items[0].notes,'Barspin - 180');
  await db.query("update xp_ledger set xp=65,updated_at=now() where athlete_id=$1 and source_id='before'",[id(7)]);const partialXp=await rpc('get_today_training_progress',[id(7)]);assert.equal(partialXp.today_xp,null,'Revised historical XP has no trustworthy daily delta');assert.equal(partialXp.attributable_today_xp,10);assert.equal(partialXp.xp_attribution,'partial');assert.match(partialXp.xp_attribution_note,/earlier XP/);
  await actor(rider);
  // Read-only activity excludes prior local day, duplicate history and fabricated session totals.
  await db.query("insert into assignment_point_awards(athlete_id,award_key,points,created_at) values($1,'prior-day-fixture',100,now()-interval '2 days')",[id(rider)]);
  await db.query('insert into training_sessions(athlete_id,total_points) values($1,999)',[id(rider)]);
  const day=await today();assert.equal(day.today_points,9,'Today does not infer award timestamps from legacy session totals');assert(day.weekly_score>=day.today_points,'Weekly total stays separate');
  await db.exec(`create function private.reject_review_write() returns trigger language plpgsql as $$begin raise exception 'Read-only progress attempted a write';end$$;`);
  for(const table of ['profiles','training_sessions','assignment_progress','assignment_point_awards','xp_ledger','private.daily_finish_candidates']) await db.exec(`create trigger readonly_check before insert or update or delete on ${table} for each statement execute function private.reject_review_write()`);
  assert.deepEqual(await today(),day,'Today RPC is read-only and stable');
  await db.close();console.log('PASS: production auto-finish reproduced; explicit Daily candidate/confirm, corrections, canonical result/PB, duplicate awards, coach/rider/group rules, untimed scoring, Today across visits, local-day start and access controls.');
})().catch(error=>{console.error(error.message, error.where || '', error.stack);process.exit(1)});
