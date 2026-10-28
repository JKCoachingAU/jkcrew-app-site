// Isolated Postgres checks. Synthetic riders only; no production connection.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const migration = read('20261028095856_park_champion_crown_titles.sql');
const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const names = ['Kebe', 'mylee toohey', 'Ali', 'Kim Lea Müller', 'Lara', 'Romy King', 'Boy'];
(async () => {
  const db = new PGlite();
  let checks = 0;
  const q = (sql, params = []) => db.query(sql, params);
  const value = async (sql, params = []) => Object.values((await q(sql, params)).rows[0])[0];
  const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  try {
    await db.exec(`
      create schema private; create schema auth; create role anon; create role authenticated;
      grant usage on schema public,auth to anon,authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table profiles(id uuid primary key,display_name text,role text default 'athlete',country_code text default 'AU',avatar jsonb default '{}');
      create table training_sessions(id uuid primary key,athlete_id uuid references profiles,started_at timestamptz default now());
      create table assignment_point_awards(id uuid primary key default gen_random_uuid(),session_id uuid,athlete_id uuid references profiles,award_key text,venue text,points integer,created_at timestamptz default now());
      create table park_king_snapshots(venue_key text primary key,venue_name text,athlete_id uuid references profiles,display_name text,avatar jsonb,points integer,updated_at timestamptz default now());
      create table park_king_events(id uuid primary key default gen_random_uuid(),venue_key text,venue_name text,athlete_id uuid references profiles,display_name text,points integer,created_at timestamptz default now());
      create table push_notification_queue(recipient_id uuid,notification_type text,title text,body text,url text,payload jsonb,dedupe_key text unique);
      create function private.jkcrew_venue_key(text) returns text language sql immutable as $$select regexp_replace(lower($1),'[^a-z0-9]','','g')$$;
      create function public.jkcrew_country_timezone(text) returns text language sql immutable as $$select 'Australia/Brisbane'::text$$;
    `);
    const initial = read('202607190030_fix_king_of_the_park_per_session.sql');
    const current = read('20260831150239_fix_park_king_live_session_scores.sql');
    await db.exec(between(current, 'create or replace function private.jkcrew_current_park_king(', '-- Refresh the venue'));
    await db.exec(between(initial, 'create or replace function public.get_park_king(', 'create or replace function private.handle_park_king_award_change()'));
    for (let i = 0; i < names.length; i++) await q('insert into profiles(id,display_name) values($1,$2)', [id(i + 1), names[i]]);
    await q("insert into park_king_snapshots values('oldpark','Old Park',$1,'Lara','{}',7,'2026-10-01T00:00:00Z')", [id(5)]);
    await q("insert into park_king_events(venue_key,venue_name,athlete_id,display_name,points,created_at) values('oldpark','Old Park',$1,'Lara',7,'2026-10-01T00:00:00Z')", [id(5)]);
    await q("insert into profiles(id,display_name) values($1,'Lara')", [id(99)]);
    await db.exec('begin');
    await assert.rejects(db.exec(migration), /Expected one rider for park crown title: lara/); checks++;
    await db.exec('rollback');
    eq(await value("select to_regclass('private.park_crown_titles') is null"),true,'Ambiguous rider matching rolls back the entire migration');
    eq(await value("select count(*)::int from information_schema.columns where table_name='park_king_snapshots' and column_name='crown_title'"),0,'Failed migration leaves existing API schema untouched');
    await q('delete from profiles where id=$1', [id(99)]);
    await db.exec('begin');
    await db.exec(migration);
    await db.exec('commit');
    eq(await value('select count(*)::int from private.park_crown_titles'), 6, 'Only the six named accounts receive title preferences');
    eq((await q('select crown_title,points,updated_at from park_king_snapshots')).rows.map(r => [r.crown_title,r.points,r.updated_at]), [['Queen',7,new Date('2026-10-01T00:00:00Z')]], 'Existing crown metadata is corrected without changing score or date');
    eq(await value('select count(*)::int from park_king_events'), 1, 'Metadata migration emits no crown events');
    eq(await value('select count(*)::int from push_notification_queue'), 0, 'Metadata migration sends no notification');
    eq(await value('select crown_title from park_king_events'), 'Queen', 'Historical crown event receives matching title');
    eq(await value('select count(*)::int from assignment_point_awards'), 0, 'Migration awards no points');
    eq(await value('select count(*)::int from training_sessions'), 0, 'Migration changes no sessions');
    for (let i = 1; i <= 6; i++) {
      eq(await value('select private.jkcrew_park_crown_title($1)', [id(i)]), 'Queen', names[i - 1] + ' has Queen title');
    }
    await q("update profiles set display_name='Renamed rider' where id=$1", [id(3)]);
    eq(await value('select private.jkcrew_park_crown_title($1)', [id(3)]), 'Queen', 'Alirah/Ali retains title after profile rename');
    await q("insert into profiles(id,display_name) values($1,'Ali')", [id(8)]);
    eq(await value('select private.jkcrew_park_crown_title($1)', [id(8)]), 'King', 'A different account cannot inherit title by copying a name');
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id(7)]);
    const score = async (rider, points) => {
      const session = id(100 + rider);
      await q('insert into training_sessions(id,athlete_id) values($1,$2) on conflict do nothing', [session,id(rider)]);
      await q("insert into assignment_point_awards(session_id,athlete_id,award_key,venue,points) values($1,$2,'one_bang:test','Test Park',$3)", [session,id(rider),points]);
      await q("select private.refresh_park_king('Test Park')");
    };
    const champion = async () => (await q("select athlete_id,points,crown_title from get_park_king('Test Park')")).rows[0];
    await score(7,5);
    eq(await champion(), {athlete_id:id(7),points:5,crown_title:'King'}, 'Boy champion uses King');
    await score(5,6);
    eq(await champion(), {athlete_id:id(5),points:6,crown_title:'Queen'}, 'Higher scoring girl takes same shared crown as Queen');
    eq((await q("select athlete_id,points,crown_title from park_king_snapshots where venue_key='testpark'")).rows[0], await champion(), 'Snapshot and RPC agree');
    eq((await q("select distinct title,body,payload->>'crown_title' crown_title from push_notification_queue where payload->>'athlete_id'=$1", [id(5)])).rows,
      [{title:'New Queen of the Park',body:'Lara is now Queen of Test Park with 6 park points.',crown_title:'Queen'}], 'Future notifications use Queen title and preserve score');
    const notificationsBefore = await value('select count(*)::int from push_notification_queue');
    const eventsBefore = await value('select count(*)::int from park_king_events');
    await q("select private.refresh_park_king('Test Park')");
    eq(await value('select count(*)::int from push_notification_queue'), notificationsBefore, 'Repeated refresh does not replay notifications');
    eq(await value('select count(*)::int from park_king_events'), eventsBefore, 'Repeated refresh does not mint events');
    await score(7,2);
    eq(await champion(), {athlete_id:id(7),points:7,crown_title:'King'}, 'Boy beating score changes title back to King');
    eq((await q("select distinct title,body,payload->>'crown_title' crown_title from push_notification_queue where payload->>'athlete_id'=$1 and (payload->>'points')::int=7", [id(7)])).rows,
      [{title:'New King of the Park',body:'Boy is now King of Test Park with 7 park points.',crown_title:'King'}], 'Future boy notification title changes back automatically');
    eq((await q("select distinct crown_title from park_king_events where athlete_id=$1",[id(7)])).rows,[{crown_title:'King'}], 'Realtime boy event has King title');
    eq((await q("select distinct crown_title from park_king_events where athlete_id=$1",[id(5)])).rows,[{crown_title:'Queen'}], 'Realtime girl event has Queen title');
    eq(await value('select sum(points)::int from assignment_point_awards'),13,'Crown refresh never changes earned points');
    await q("update park_king_snapshots set crown_title='Queen' where venue_key='testpark'");
    eq(await value("select crown_title from park_king_snapshots where venue_key='testpark'"),'King','Derived snapshot title cannot drift from account title');
    for (const fn of ['private.jkcrew_park_crown_title(uuid)','private.set_park_crown_title()','private.refresh_park_king(text,text)']) {
      for (const role of ['anon','authenticated']) eq(await value('select has_function_privilege($1,$2,$3)',[role,fn,'EXECUTE']),false,'Private helper is inaccessible: '+fn+' '+role);
    }
    for (const role of ['anon','authenticated']) for (const privilege of ['SELECT','INSERT','UPDATE','DELETE'])
      eq(await value('select has_table_privilege($1,$2,$3)',[role,'private.park_crown_titles',privilege]),false,'Private mapping stays protected');
    eq(await value("select relrowsecurity from pg_class where oid='private.park_crown_titles'::regclass"),true,'Private mapping also enables RLS');
    eq(await value("select has_function_privilege('anon','public.get_park_king(text)','EXECUTE')"),false,'Anon cannot read park RPC');
    eq(await value("select has_function_privilege('authenticated','public.get_park_king(text)','EXECUTE')"),true,'Authenticated park RPC remains available');
    await db.exec('set role authenticated');
    eq((await champion()).crown_title,'King','Actual authenticated call reads title');
    await q("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(champion,/Authentication required/);checks++;
    await db.exec('reset role');
    console.log(`PASS ${checks} park crown database checks`);
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
