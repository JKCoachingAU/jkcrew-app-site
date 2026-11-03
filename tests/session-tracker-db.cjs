// Real SQL, synthetic identities, isolated PostgreSQL. Never touches live data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const migrationName = '20261103212528_add_coach_session_tracker.sql';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function run() {
  const db = new PGlite();
  let checks = 0;
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
  const ok = (a, label) => { assert(a, label); checks++; };
  const denied = async (fn, re) => { await assert.rejects(fn, re); checks++; };
  const actor = async (n, role = 'authenticated') => {
    await db.exec('reset role');
    await q("select set_config('request.jwt.claim.sub', $1, false)", [n ? id(n) : '']);
    await db.exec(`set role ${role}`);
  };
  const inspect = async fn => {
    const role = await scalar('select current_user');
    await db.exec('reset role');
    try { return await fn(); } finally { await db.exec(`set role ${role}`); }
  };
  const save = (n, fields = {}, version = null) => scalar(`select public.save_coach_tracked_session($1,$2,$3,$4,$5,$6)`, [
    id(n), fields.date === undefined ? '2026-11-04' : fields.date,
    fields.time === undefined ? null : fields.time,
    fields.venue === undefined ? 'Pizzey Skate Park' : fields.venue,
    fields.riders === undefined ? [id(2), id(3)] : fields.riders, version,
  ]);
  const archive = (n, archived, version) => scalar('select public.archive_coach_tracked_session($1,$2,$3)', [id(n), archived, version]);
  const location = name => scalar('select public.add_coach_tracker_location($1)', [name]);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public, auth, private to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      create type public.user_role as enum ('coach','admin','athlete','parent');
      create table public.profiles(id uuid primary key, role public.user_role not null, display_name text, points integer default 0);
      create function private.current_user_role() returns public.user_role language sql stable security definer set search_path=public as $$ select role from public.profiles where id=auth.uid() $$;
      grant execute on function private.current_user_role() to authenticated;
      alter table public.profiles enable row level security;
      create policy own_profile on public.profiles for select to authenticated using(id=(select auth.uid()));
      create policy coach_profile on public.profiles for select to authenticated using((select private.current_user_role()) in ('coach','admin'));
      grant select on public.profiles to authenticated;
      create table public.coach_athletes(coach_id uuid references profiles, athlete_id uuid references profiles, primary key(coach_id,athlete_id));
      alter table public.coach_athletes enable row level security;
      create policy coached_roster on public.coach_athletes for select to authenticated using(coach_id=(select auth.uid()) or athlete_id=(select auth.uid()));
      grant select on public.coach_athletes to authenticated;
      create table public.coach_venues(id uuid primary key default gen_random_uuid(),coach_id uuid not null default auth.uid() references profiles,name text not null check(char_length(btrim(name)) between 1 and 80),sort_order integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(coach_id,name));
      alter table public.coach_venues enable row level security;
      create policy venues_owner on public.coach_venues for all to authenticated using(coach_id=auth.uid()) with check(coach_id=auth.uid());
      grant select,insert,update,delete on public.coach_venues to authenticated;
      create table public.coach_group_sessions(id uuid primary key,coach_id uuid,status text,venue text);
      create table public.training_sessions(id uuid primary key,athlete_id uuid);
      create table public.attendance_sessions(id uuid primary key,coach_id uuid,venue text);
      create table public.assignment_point_awards(id uuid primary key,athlete_id uuid,points integer);
      create table public.push_notification_queue(id uuid primary key,recipient_id uuid);
    `);
    await q('insert into profiles(id,role,display_name,points) values ($1,\'coach\',\'Coach\',0),($2,\'athlete\',\'Rider A\',10),($3,\'athlete\',\'Rider B\',20),($4,\'coach\',\'Other coach\',0),($5,\'athlete\',\'Stranger rider\',7),($6,\'parent\',\'Parent\',0),($7,\'admin\',\'Admin\',0)', [1,2,3,4,5,6,7].map(id));
    await q('insert into coach_athletes values ($1,$2),($1,$3),($4,$5),($6,$2)', [1,2,3,4,5,7].map(id));
    await q("insert into coach_group_sessions values($1,$2,'running','Existing live park')", [id(80),id(1)]);
    await q('insert into training_sessions values($1,$2)', [id(81),id(2)]);
    await q("insert into attendance_sessions values($1,$2,'Existing attendance')", [id(82),id(1)]);
    await q('insert into assignment_point_awards values($1,$2,5)', [id(83),id(2)]);
    await q('insert into push_notification_queue values($1,$2)', [id(84),id(2)]);
    const unaffectedTables = ['profiles','coach_group_sessions','training_sessions','attendance_sessions','assignment_point_awards','push_notification_queue'];
    const before = await Promise.all(unaffectedTables.map(table => q(`select * from public.${table} order by id`)));
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',migrationName),'utf8'));
    eq(await scalar("select relrowsecurity from pg_class where oid='public.coach_tracked_sessions'::regclass"), true, 'RLS enabled');
    eq(await scalar("select count(*)::int from pg_proc where proname in ('save_coach_tracked_session','archive_coach_tracked_session','add_coach_tracker_location','validate_coach_tracked_session') and prosecdef"), 0, 'All new functions use caller permissions');
    eq(await scalar("select count(*)::int from pg_proc where proname in ('save_coach_tracked_session','archive_coach_tracked_session','add_coach_tracker_location','validate_coach_tracked_session') and not coalesce(proconfig @> array['search_path=\"\"'],false)"), 0, 'Every function has fixed search_path');
    await actor(1);
    const first = await save(100,{venue:'  Pizzey   Skate Park ',riders:[id(3),id(2),id(2)]});
    eq(first.coach_id,id(1)); eq(first.venue,'Pizzey Skate Park'); eq(first.rider_ids,[id(2),id(3)]);
    eq(first.session_date,'2026-11-04'); eq(first.start_time,null);
    const retry = await save(100);
    eq(retry,first,'Lost-response retry returns unchanged row and timestamp');
    eq(await scalar('select count(*)::int from coach_tracked_sessions'),1,'Repeated submit never duplicates session');
    await denied(()=>save(100,{time:'16:30'}),/session has changed/i);
    const edited = await save(100,{time:'16:30'},first.updated_at);
    eq(edited.start_time,'16:30:00'); ok(edited.updated_at!==first.updated_at);
    await denied(()=>save(100,{time:'17:00'},first.updated_at),/session has changed/i);
    eq(await save(100,{time:'16:30'},first.updated_at),edited,'Retry of successful update accepts identical content');
    eq((await q('select start_time::text from coach_tracked_sessions where id=$1',[id(100)]))[0].start_time,'16:30:00');
    for(const fields of [{riders:[]},{riders:null},{riders:[null]},{riders:Array(201).fill(id(2))},{venue:' \n '},{venue:'x'.repeat(81)},{date:null},{date:'infinity'},{time:'24:00'},{riders:[id(5)]},{riders:[id(6)]}]) {
      await denied(()=>save(101,fields),/Choose|Enter|constraint|linked/i);
      eq(await scalar('select count(*)::int from coach_tracked_sessions where id=$1',[id(101)]),0,'Invalid save is atomic');
    }
    await denied(()=>save(101,{date:'2026-02-30'}),/date\/time|out of range/i);
    await denied(()=>q('insert into coach_tracked_sessions(id,coach_id,session_date,venue,rider_ids) values($1,$2,$3,$4,$5)',[id(102),id(4),'2026-11-04','Park',[id(2)]]),/session coach|row-level security/i);
    await denied(()=>q('insert into coach_tracked_sessions(id,session_date,venue,rider_ids) values($1,$2,$3,$4)',[id(102),'2026-11-04','Park',[id(5)]]),/linked/i);
    await denied(()=>q('update coach_tracked_sessions set coach_id=$1 where id=$2',[id(4),id(100)]),/permission denied/i);
    await denied(()=>q('update coach_tracked_sessions set created_at=now() where id=$1',[id(100)]),/permission denied/i);
    await denied(()=>q('delete from coach_tracked_sessions where id=$1',[id(100)]),/permission denied/i);
    await denied(()=>archive(100,true,first.updated_at),/session has changed/i);
    const removed=await archive(100,true,edited.updated_at);
    ok(removed.archived_at,'Remove is reversible archive');
    eq(await archive(100,true,edited.updated_at),removed,'Repeated remove is idempotent');
    eq(await scalar('select count(*)::int from coach_tracked_sessions where archived_at is null'),0);
    await denied(()=>save(100,{time:'17:00'},removed.updated_at),/session was removed/i);
    await denied(()=>save(100,{time:'16:30'},edited.updated_at),/session was removed/i);
    eq(await scalar('select archived_at::text from coach_tracked_sessions where id=$1',[id(100)])!==null,true,'Saving cannot silently restore a removed session');
    await denied(()=>archive(100,false,edited.updated_at),/session has changed/i);
    const restored=await archive(100,false,removed.updated_at);
    eq(restored.archived_at,null); eq(await archive(100,false,removed.updated_at),restored);
    await denied(()=>archive(100,null,restored.updated_at),/Choose/);
    await denied(()=>archive(999,true,restored.updated_at),/no longer available/i);
    // Unlinking a rider must not erase history or prevent changing a time.
    await inspect(()=>q('delete from coach_athletes where coach_id=$1 and athlete_id=$2',[id(1),id(3)]));
    const historical=await save(100,{time:'18:00'},restored.updated_at);
    eq(historical.rider_ids,[id(2),id(3)],'Former linked rider retained in existing history');
    await denied(()=>save(103,{riders:[id(3)]}),/linked/i);
    const smaller=await save(100,{time:'18:00',riders:[id(2)]},historical.updated_at);
    await denied(()=>save(100,{time:'18:00'},smaller.updated_at),/linked/i);
    // A parent or rider linked in the wider app cannot see coach planning.
    for(const n of [2,3,4,5,6]) {
      await actor(n);
      eq(await scalar('select count(*)::int from coach_tracked_sessions'),0,`Actor ${n} cannot read another coach's plan`);
      await denied(()=>save(100,{riders:[id(5)]}),/Only coaches|could not be saved|linked/i);
      await denied(()=>archive(100,true,smaller.updated_at),/Only coaches|no longer available/i);
      if(n!==4) await denied(()=>location('Not a coach park'),/Only coaches/i);
    }
    await actor(4);
    const other=await save(104,{riders:[id(5)]}); eq(other.coach_id,id(4));
    eq(await scalar('select count(*)::int from coach_tracked_sessions'),1);
    await actor(7);
    const admin=await save(105,{riders:[id(2)]}); eq(admin.coach_id,id(7),'Admin only owns their own plans');
    eq(await scalar('select count(*)::int from coach_tracked_sessions'),1);
    await actor(null,'anon');
    await denied(()=>q('select * from coach_tracked_sessions'),/permission denied/i);
    await denied(()=>save(106),/permission denied/i);
    await denied(()=>archive(100,true,smaller.updated_at),/permission denied/i);
    await denied(()=>location('Unauthenticated park'),/permission denied/i);
    await actor(null);
    await denied(()=>save(106),/Only coaches/i);
    await actor(1);
    const park=await location('  Oasis   Skate Park ');
    eq(park.name,'Oasis Skate Park'); eq(park.coach_id,id(1)); eq(park.sort_order,0);
    eq(await location('oAsIs \n skate   park'),park,'Case and whitespace retries return same location');
    eq(await scalar('select count(*)::int from coach_venues'),1);
    const second=await location('Pizzey Skate Park'); eq(second.sort_order,1);
    for(const name of ['',null,'  \n ', 'x'.repeat(81)]) await denied(()=>location(name),/between 1 and 80/);
    await actor(4); const otherPark=await location('Oasis Skate Park'); ok(otherPark.id!==park.id,'Locations are private per coach');
    await actor(1);
    // A replaced venue list cannot delete or alter a saved plan's snapshot.
    await q('delete from coach_venues where id=$1',[second.id]);
    eq(await scalar('select venue from coach_tracked_sessions where id=$1',[id(100)]),'Pizzey Skate Park');
    await save(110,{date:'2026-12-01',riders:[id(2)]});
    await save(111,{date:'2026-11-06',riders:[id(2)],venue:'Oasis Skate Park'});
    await save(112,{date:'2026-11-07',riders:[id(2)],venue:'Oasis Skate Park'});
    const page=await q("select id from coach_tracked_sessions where archived_at is null and session_date >= '2026-11-01' and session_date < '2026-12-01' and venue='Oasis Skate Park' and rider_ids @> $1::uuid[] order by session_date,start_time,id limit 1 offset 1",[[id(2)]]);
    eq(page.map(row=>row.id),[id(112)],'Date/location/rider filters paginate consistently');
    const after=await inspect(()=>Promise.all(unaffectedTables.map(table=>q(`select * from public.${table} order by id`))));
    eq(after,before,'Planning never changes accounts, live timers, attendance, rider scores or notifications');
    console.log(`PASS: ${checks} Session Tracker database checks: coach-only RLS, roster validation, retry-safe saves, stale edits, archive/undo, location dedupe, filters and unchanged live/scoring records.`);
  } finally { await db.close(); }
}
if(require.main===module) run().catch(error=>{console.error(error.stack,error.where||'');process.exitCode=1;});
module.exports={run,migrationName};
