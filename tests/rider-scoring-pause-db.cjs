const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const pauseMessage = /Trick scoring is paused for this rider\. Contact your coach\./;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
async function actor(n, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : '']);
  await db.exec(`set role ${role}`);
}
const setPause = (n, paused) => q('select * from public.set_rider_scoring_pause($1,$2)', [id(n), paused]);
const getPause = n => q('select * from public.get_rider_scoring_pause($1)', [id(n)]);
const action = (n, value = 'landed') => scalar('select public.record_assignment_action($1,$2)', [id(n), value]);
const daily = (n, value = 'landed') => scalar('select public.record_daily_trick_action($1,$2,$3,null)', [id(n), value, 'Test park']);
function sqlFunction(source, name) {
  const start = source.search(new RegExp(`create (?:or replace )?function ${name.replaceAll('.', '\\.')}\\(`, 'i'));
  assert(start >= 0, `Actual ${name} exists`);
  const tail = source.slice(start);
  const delimiter = tail.match(/\bas\s+(\$[a-z_]*\$)/i);
  assert(delimiter, `Body delimiter for ${name}`);
  const body = delimiter.index + delimiter[0].length;
  const end = tail.indexOf(delimiter[1], body);
  return tail.slice(0, end + delimiter[1].length) + ';';
}
(async () => {
  await db.exec(`
    create schema auth; create schema private;
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public,auth,private to authenticated,service_role;
    grant usage on schema public,auth to anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create type public.user_role as enum('athlete','coach','admin','parent');
    create table profiles(id uuid primary key,role user_role,display_name text,country_code text default 'AU',xp_total integer default 0,level integer default 1,daily_pb_seconds integer,daily_pb_updated_at timestamptz,updated_at timestamptz default now());
    create table coach_athletes(coach_id uuid,athlete_id uuid);
    create table parent_athletes(parent_id uuid,athlete_id uuid);
    create table weekly_trick_assignments(id uuid primary key,coach_id uuid,athlete_id uuid,week_start date not null,trick_name text,category text,target_reps integer default 1,notes text default '',sort_order integer default 0,venue text default '',created_at timestamptz default now(),updated_at timestamptz default now());
    create table assignment_progress(assignment_id uuid primary key references weekly_trick_assignments(id),athlete_id uuid,progress_date date,completed_at timestamptz,streak_count integer default 0,updated_at timestamptz default now());
    create table training_sessions(id uuid primary key default gen_random_uuid(),athlete_id uuid,started_at timestamptz default now(),ended_at timestamptz,total_points integer default 0,notes text default '',created_at timestamptz default now(),daily_venue text,daily_completed_seconds integer,daily_completed_at timestamptz);
    create table coach_group_sessions(id uuid primary key,coach_id uuid,group_name text,venue text default '',status text default 'running',started_at timestamptz default now(),paused_at timestamptz,total_paused_seconds integer default 0,ended_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table coach_group_session_participants(group_session_id uuid,athlete_id uuid,training_session_id uuid,joined_at timestamptz default now(),last_activity_at timestamptz,daily_finished_at timestamptz,daily_finish_seconds integer,primary key(group_session_id,athlete_id));
    create table assignment_point_awards(id uuid primary key default gen_random_uuid(),athlete_id uuid,session_id uuid,assignment_id uuid,award_key text,points integer,venue text default '',created_at timestamptz default now(),unique(athlete_id,award_key));
    create table trick_attempts(id uuid primary key default gen_random_uuid(),session_id uuid,athlete_id uuid,trick_name text,category text,status text,duration_seconds integer,points integer,created_at timestamptz default now());
    create table percentage_attempts(id uuid primary key default gen_random_uuid(),assignment_id uuid references weekly_trick_assignments(id),athlete_id uuid,attempt_number integer,landed boolean,created_at timestamptz default now(),unique(assignment_id,attempt_number));
    create table assignment_attempts(id uuid primary key default gen_random_uuid(),assignment_id uuid references weekly_trick_assignments(id),athlete_id uuid,coach_id uuid,trick_name text,category text,week_start date,venue text,session_id uuid,group_session_id uuid,source text,attempted_at timestamptz default now());
    create table run_plans(id uuid primary key,athlete_id uuid,title text);
    create table run_checklist_progress(id uuid primary key default gen_random_uuid(),athlete_id uuid,run_plan_id uuid,point_index integer,completed boolean default true,updated_at timestamptz default now(),unique(athlete_id,run_plan_id,point_index));
    create table xp_ledger(id uuid primary key default gen_random_uuid(),athlete_id uuid,source_type text,source_id text,xp integer,reason text,assignment_id uuid,session_id uuid,trick_name text,venue text,coach_id uuid,metadata jsonb default '{}',level_before integer,level_after integer,created_at timestamptz default now(),updated_at timestamptz default now(),unique(athlete_id,source_type,source_id));
    create table leaderboard_point_adjustments(id uuid primary key default gen_random_uuid(),athlete_id uuid,coach_id uuid,points integer,reason text,week_start date,created_at timestamptz default now());
    create table tricktionary_landing_history(id text primary key,assignment_id uuid,athlete_id uuid,trick_name text,category text,notes text default '',venue text,landed_at timestamptz,landing_date date,landed_count integer,evidence_type text);
    create function sync_profile_xp(p_id uuid) returns jsonb language plpgsql as $$declare n integer; begin select coalesce(sum(xp),0)::integer into n from xp_ledger where athlete_id=p_id; update profiles set xp_total=n where id=p_id; return jsonb_build_object('level',1,'xp_total',n); end$$;
  `);
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/daily-production-functions.json'), 'utf8')).functions;
  for (const signature of ['jkcrew_country_timezone(text)', 'jkcrew_week_bounds(text,timestamp with time zone)', 'private.jkcrew_venue_key(text)', 'level_badge(integer)', 'sync_xp_award(uuid,text,text,integer,text,uuid,uuid,text,text,uuid,jsonb)']) {
    const definition = source.find(fn => fn.signature === signature)?.definition;
    assert(definition, signature); await db.exec(definition);
  }
  const dailySource = fs.readFileSync(path.join(root, 'supabase/migrations/20260911085353_confirm_daily_tricks_and_today_progress.sql'), 'utf8');
  for (const name of ['private.require_daily_access', 'private.daily_list_rows', 'private.daily_list_state', 'public.record_daily_trick_action', 'public.record_assignment_action', 'public.sync_assignment_progress_xp']) await db.exec(sqlFunction(dailySource, name));
  const historySource = fs.readFileSync(path.join(root, 'supabase/migrations/20260911030012_preserve_tricktionary_landed_history.sql'), 'utf8');
  for (const name of ['private.capture_tricktionary_progress', 'private.sync_tricktionary_progress_history']) await db.exec(sqlFunction(historySource, name));
  await db.exec(`
    create trigger assignment_progress_xp_sync after insert or update or delete on assignment_progress for each row execute function sync_assignment_progress_xp();
    create trigger tricktionary_progress_history after insert or update of progress_date,completed_at,streak_count on assignment_progress for each row execute function private.sync_tricktionary_progress_history();
  `);
  // Existing permissive fixture policies deliberately permit direct and definer
  // writes so tests prove the new guards enforce the target rider independently.
  const tables = (await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(row => row.tablename);
  for (const table of tables) await db.exec(`alter table public.${table} enable row level security; grant select,insert,update,delete on public.${table} to authenticated; create policy fixture_existing on public.${table} for all to authenticated using(true) with check(true);`);
  for (const [n, role] of [[1,'coach'],[2,'athlete'],[3,'athlete'],[4,'coach'],[5,'parent'],[6,'admin']]) await db.query('insert into profiles(id,role,display_name) values($1,$2,$3)', [id(n), role, `Person ${n}`]);
  await db.query('insert into coach_athletes values($1,$2),($1,$3),($4,$3)', [id(1),id(2),id(3),id(6)]);
  await db.query('insert into parent_athletes values($1,$2)', [id(5),id(2)]);
  for (const [n, rider, category] of [[10,2,'one_bang'],[11,2,'daily'],[12,2,'daily'],[13,2,'percentage'],[14,2,'dialled'],[15,2,'bonus'],[16,2,'lines'],[17,2,'one_bang'],[20,3,'one_bang'],[21,3,'daily'],[22,3,'daily'],[23,3,'percentage']]) {
    await db.query("insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select $1,$2,$3,b.week_start_date,$4,$5,'Test park' from jkcrew_week_bounds('AU') b", [id(n),id(1),id(rider),`Trick ${n}`,category]);
  }
  await db.query("insert into training_sessions(id,athlete_id,started_at,daily_venue) values($1,$2,now()-interval '1 minute','Test park'),($3,$4,now()-interval '1 minute','Test park')", [id(100),id(2),id(101),id(3)]);
  await db.query("insert into coach_group_sessions(id,coach_id,group_name,venue) values($1,$2,'monday','Test park')", [id(200),id(1)]);
  await db.query('insert into coach_group_session_participants(group_session_id,athlete_id,training_session_id) values($1,$2,$3),($1,$4,$5)', [id(200),id(2),id(100),id(3),id(101)]);
  await db.query("insert into run_plans values($1,$2,'Paused rider run'),($3,$4,'Other run')", [id(300),id(2),id(301),id(3)]);
  await actor(2);
  assert.equal((await action(10)).points_awarded, 2, 'Real One Bang action works before pause');
  await daily(11);
  await db.query('insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed) values($1,$2,1,true)', [id(13),id(2)]);
  await db.query('insert into run_checklist_progress(athlete_id,run_plan_id,point_index,completed) values($1,$2,0,true)', [id(2),id(300)]);
  await db.exec('reset role');
  const beforeProfiles = await q('select * from profiles order by id');
  const policies = await q("select * from pg_policies where schemaname='public' order by tablename,policyname");
  const beforePoints = await scalar('select sum(points)::int from assignment_point_awards');
  const beforeHistory = await scalar('select count(*)::int from tricktionary_landing_history');
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260914104325_rider_scoring_pause.sql'), 'utf8');
  assert(migration.trim(), 'Scoring pause migration exists'); await db.exec(migration);
  assert.deepEqual(await q('select * from profiles order by id'), beforeProfiles, 'Migration never rewrites profiles or earned XP');
  assert.deepEqual(await q("select * from pg_policies where schemaname='public' order by tablename,policyname"), policies, 'Existing public RLS policies unchanged');
  assert.equal(await scalar('select count(*)::int from private.rider_scoring_pauses'), 0, 'Migration does not pause any rider automatically');
  assert.equal(await scalar('select sum(points)::int from assignment_point_awards'), beforePoints, 'Existing earned points unchanged');
  assert.equal(await scalar('select count(*)::int from tricktionary_landing_history'), beforeHistory, 'Existing landed history preserved');

  await actor(2); assert.equal((await getPause(2))[0].scoring_paused, false);
  await assert.rejects(() => setPause(2,true), /coach|allowed/i, 'Rider cannot pause or unpause themselves');
  await assert.rejects(() => getPause(3), /private|linked|allowed|Only this rider/i, 'Rider cannot query another rider');
  await actor(4); await assert.rejects(() => setPause(2,true), /linked|allowed/i, 'Unlinked coach cannot control rider');
  await actor(5); await assert.rejects(() => setPause(2,true), /coach|allowed/i, 'Parent cannot override coach pause');
  await actor(1);
  await assert.rejects(() => setPause(2,null), /pause|boolean|value/i);
  await assert.rejects(() => setPause(1,true), /rider|athlete|linked/i, 'Cannot pause a coach');
  const paused = (await setPause(2,true))[0];
  assert.equal(paused.scoring_paused, true); assert.equal(paused.paused_by,id(1)); assert(paused.paused_at);
  await setPause(2,true);
  await actor(2); assert.equal((await getPause(2))[0].scoring_paused,true);
  await assert.rejects(() => db.query('update private.rider_scoring_pauses set scoring_paused=false where athlete_id=$1',[id(2)]),/permission denied/);
  const snapshot = async () => {
    const counts = {};
    for (const table of ['assignment_progress','assignment_point_awards','trick_attempts','assignment_attempts','percentage_attempts','xp_ledger','tricktionary_landing_history','training_sessions','coach_group_session_participants','run_checklist_progress']) counts[table] = await q(`select * from ${table} order by to_jsonb(${table})::text`);
    return counts;
  };
  let before = await snapshot();
  for (const who of [2,1]) {
    await actor(who);
    for (const n of [17,14,15]) await assert.rejects(() => action(n),pauseMessage,`${who===1?'Coach':'Rider'} cannot record new category ${n}`);
    await assert.rejects(() => daily(12),pauseMessage,'Actual Daily RPC cannot complete a tick while paused');
  }
  assert.deepEqual(await snapshot(), before, 'Rejected real RPCs roll back all progress, points, XP, history, session and attempt changes');
  await actor(2);
  const rejectWrite = async (sql,args=[]) => assert.rejects(() => db.query(sql,args),pauseMessage,sql);
  await rejectWrite('insert into assignment_progress(assignment_id,athlete_id,completed_at) values($1,$2,now())',[id(16),id(2)]);
  await rejectWrite('update assignment_progress set progress_date=current_date+1 where assignment_id=$1',[id(11)]);
  await rejectWrite('update assignment_progress set streak_count=9 where assignment_id=$1',[id(10)]);
  await rejectWrite('insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed) values($1,$2,2,false)',[id(13),id(2)]);
  await rejectWrite("insert into assignment_attempts(assignment_id,athlete_id,category) values($1,$2,'dialled')",[id(14),id(2)]);
  await rejectWrite("insert into trick_attempts(session_id,athlete_id,status,points) values($1,$2,'landed',0)",[id(100),id(2)]);
  await rejectWrite("insert into trick_attempts(session_id,athlete_id,status,points) values($1,$2,'missed',1)",[id(100),id(2)]);
  await rejectWrite("insert into assignment_point_awards(athlete_id,assignment_id,award_key,points) values($1,$2,'paused-award',2)",[id(2),id(17)]);
  await rejectWrite('update assignment_point_awards set points=100 where athlete_id=$1',[id(2)]);
  await rejectWrite("update assignment_point_awards set created_at=created_at+interval '1 day' where athlete_id=$1",[id(2)]);
  await rejectWrite("update assignment_point_awards set award_key=award_key||':moved' where athlete_id=$1",[id(2)]);
  await rejectWrite("update trick_attempts set created_at=created_at+interval '1 day' where athlete_id=$1 and status='landed'",[id(2)]);
  await rejectWrite("update trick_attempts set trick_name='Different trick' where athlete_id=$1 and status='landed'",[id(2)]);
  await rejectWrite("update trick_attempts set category='Different category' where athlete_id=$1 and status='landed'",[id(2)]);
  await rejectWrite("update xp_ledger set created_at=created_at+interval '1 day' where athlete_id=$1 and source_type='one_bang'",[id(2)]);
  await rejectWrite("update xp_ledger set source_id=source_id||':moved' where athlete_id=$1 and source_type='one_bang'",[id(2)]);
  await rejectWrite("update training_sessions set started_at=started_at-interval '1 day' where id=$1",[id(100)]);
  await rejectWrite('update training_sessions set total_points=100 where id=$1',[id(100)]);
  await rejectWrite('update training_sessions set daily_completed_at=now(),daily_completed_seconds=20 where id=$1',[id(100)]);
  await rejectWrite('update coach_group_session_participants set daily_finished_at=now(),daily_finish_seconds=20 where athlete_id=$1',[id(2)]);
  await db.query('insert into run_checklist_progress(athlete_id,run_plan_id,point_index,completed) values($1,$2,1,true)',[id(2),id(300)]); // Unscored run practice is intentionally available.
  for (const type of ['daily_complete','daily_pb','one_bang','dialled','bonus','percentage']) await rejectWrite('insert into xp_ledger(athlete_id,source_type,source_id,xp) values($1,$2,$3,35)',[id(2),type,`new-${type}`]);

  // The production XP helper is SECURITY DEFINER and takes a free-text source.
  // Neither a forged label nor a supplied coach_id may bypass the rider pause.
  for (const [who,role] of [[2,'authenticated'],[null,'anon'],[4,'authenticated'],[5,'authenticated']]) {
    await actor(who,role);
    for (const type of ['unknown_source','coach_adjustment']) await rejectWrite(
      'select public.sync_xp_award($1,$2,$3,35,$4,null,null,null,null,$5)',
      [id(2),type,`forged-${who || 'anon'}-${type}`,'Forged correction',id(1)]);
  }
  await actor(1);
  await rejectWrite('select public.sync_xp_award($1,$2,$3,35,$4)',[id(2),'unknown_source','coach-unknown','Not a historical correction']);
  assert.equal((await scalar('select public.sync_xp_award($1,$2,$3,10,$4)',[id(2),'coach_adjustment','real-coach','Historical correction'])).xp_awarded,10,'Real linked coach can make an explicit historical XP correction');

  // Canonical parent IDs must prevent disguising paused work as another rider.
  await actor(1);
  await rejectWrite('insert into assignment_progress(assignment_id,athlete_id,completed_at) values($1,$2,now())',[id(17),id(3)]);
  await rejectWrite('insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed) values($1,$2,2,true)',[id(13),id(3)]);
  await rejectWrite("insert into assignment_attempts(assignment_id,athlete_id) values($1,$2)",[id(17),id(3)]);
  await rejectWrite("insert into trick_attempts(session_id,athlete_id,status,points) values($1,$2,'landed',2)",[id(100),id(3)]);
  await rejectWrite("insert into assignment_point_awards(athlete_id,assignment_id,award_key,points) values($1,$2,'disguised',2)",[id(3),id(17)]);

  await rejectWrite('update assignment_progress set athlete_id=$1 where assignment_id=$2',[id(3),id(10)]);
  await rejectWrite('update assignment_point_awards set athlete_id=$1 where athlete_id=$2',[id(3),id(2)]);
  await rejectWrite('update training_sessions set athlete_id=$1 where id=$2',[id(3),id(100)]);

  // No-op and reduction upserts exercise BEFORE INSERT ahead of ON CONFLICT.
  await db.query('insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed) values($1,$2,1,false) on conflict(assignment_id,attempt_number) do update set landed=excluded.landed',[id(13),id(2)]);
  await db.query('update assignment_progress set updated_at=now() where assignment_id=$1',[id(10)]);
  await db.query('insert into xp_ledger(athlete_id,source_type,source_id,xp) values($1,$2,$3,20) on conflict(athlete_id,source_type,source_id) do update set xp=excluded.xp',[id(2),'one_bang',id(10)]);
  await db.query('insert into xp_ledger(athlete_id,source_type,source_id,xp) values($1,$2,$3,20) on conflict(athlete_id,source_type,source_id) do update set xp=excluded.xp',[id(2),'one_bang',id(10)]);
  await db.query('insert into assignment_point_awards(athlete_id,assignment_id,award_key,points) values($1,$2,$3,1) on conflict(athlete_id,award_key) do update set points=excluded.points',[id(2),id(10),`one_bang:${id(10)}`]);
  await db.query('insert into run_checklist_progress(athlete_id,run_plan_id,point_index,completed) values($1,$2,0,false) on conflict(athlete_id,run_plan_id,point_index) do update set completed=excluded.completed',[id(2),id(300)]);
  await db.query("update training_sessions set total_points=1,notes='Coach correction' where id=$1",[id(100)]);
  await db.query("insert into leaderboard_point_adjustments(athlete_id,coach_id,points,reason) values($1,$2,-1,'Historical correction')",[id(2),id(1)]);
  await db.query("insert into xp_ledger(athlete_id,source_type,source_id,xp) values($1,'coach_adjustment','manual',10)",[id(2)]);
  await db.query("update profiles set display_name='Updated rider name' where id=$1",[id(2)]);
  await db.query('insert into assignment_progress(assignment_id,athlete_id) values($1,$2) on conflict do nothing',[id(17),id(2)]);
  await db.query('insert into training_sessions(athlete_id,total_points,ended_at) values($1,0,now())',[id(2)]);
  assert.equal((await action(10,'unlanded')).points_removed,1,'Coach can undo real recorded One Bang with award/XP rollback');
  await actor(2); await daily(11,'unlanded');
  assert.equal(await scalar('select progress_date from assignment_progress where assignment_id=$1',[id(11)]),null,'Daily undo remains possible');
  await db.query('delete from percentage_attempts where assignment_id=$1',[id(13)]);
  await db.query('update training_sessions set ended_at=now() where id=$1',[id(100)]);

  // Other riders continue training through real RPCs and the same guards.
  await actor(3);
  assert.equal((await action(20)).points_awarded,2);
  await daily(21);
  await db.query('insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed) values($1,$2,1,false)',[id(23),id(3)]);
  await db.query('insert into run_checklist_progress(athlete_id,run_plan_id,point_index,completed) values($1,$2,1,true)',[id(3),id(301)]);
  assert.equal(await scalar('select completed_at is not null from assignment_progress where assignment_id=$1',[id(20)]),true);
  assert.equal((await getPause(3))[0].scoring_paused,false);
  await actor(6); await setPause(3,true); await setPause(3,false);
  await actor(1);
  const restored = (await setPause(2,false))[0];
  assert.equal(restored.scoring_paused,false); assert.equal(restored.paused_at,null); assert.equal(restored.paused_by,null);
  await actor(2); assert.equal((await action(17)).points_awarded,2,'Resumed rider can score again without recreating profile');
  await actor(null,'anon'); await assert.rejects(() => getPause(2), /permission denied/); await assert.rejects(() => setPause(2,false), /permission denied/);
  await db.exec('reset role');
  assert.equal(await scalar('select count(*)::int from profiles'),6,'Every account retained');
  assert.equal(await scalar('select count(*)::int from private.rider_scoring_pause_audit where athlete_id=$1',[id(2)]),2,'Audit records pause and resume once each, without duplicate retries');
  assert.equal(await scalar("select relrowsecurity from pg_class where oid='private.rider_scoring_pauses'::regclass"),true,'Private pause table has RLS defense in depth');
  assert.equal(await scalar("select has_table_privilege('authenticated','private.rider_scoring_pauses','update')"),false);
  assert.equal(await scalar("select has_function_privilege('anon','public.set_rider_scoring_pause(uuid,boolean)','execute')"),false);
  await db.close();
  console.log('PASS scoring pause: real rider/coach One Bang and Daily RPCs, atomic point/XP/history rejection, canonical assignment/session owner checks, all completion tables, Percentage misses, safe no-op/reduced upserts and undo, unscored run practice, historical corrections/session ending, unrelated riders, linked coach-only reversible access, unchanged history/RLS. Isolated PGlite only.');
})().catch(error => { console.error(error); process.exit(1); });
