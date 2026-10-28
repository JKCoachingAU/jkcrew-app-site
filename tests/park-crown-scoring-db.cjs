// Isolated PostgreSQL regressions: synthetic accounts only, no production access.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.join(__dirname, '..');
const migrations = path.join(root, 'supabase/migrations');
const read = name => fs.readFileSync(path.join(migrations, name), 'utf8');
const between = (sql, first, last) => {
  assert(sql.includes(first) && sql.includes(last), 'Expected migration function boundaries exist');
  return sql.slice(sql.indexOf(first), sql.indexOf(last, sql.indexOf(first)));
};
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const dayOne = '2026-10-27T01:00:00Z';
const dayTwo = '2026-10-28T01:00:00Z';

(async () => {
  const db = new PGlite();
  let checks = 0;
  let nextAward = 10000;
  const q = (sql, values = []) => db.query(sql, values);
  const scalar = async (sql, values = []) => Object.values((await q(sql, values)).rows[0])[0];
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const session = (n, rider, start = dayTwo, end = null) => q(
    'insert into training_sessions(id,athlete_id,started_at,ended_at,total_points) values($1,$2,$3,$4,0)',
    [id(n), id(rider), start, end]);
  const award = (n, rider, venue, prefix, points, at = dayTwo, key = null) => q(
    'insert into assignment_point_awards(id,session_id,athlete_id,venue,award_key,points,created_at) values($1,$2,$3,$4,$5,$6,$7)',
    [id(++nextAward), n == null ? null : id(n), id(rider), venue, key || `${prefix}:synthetic-${nextAward}`, points, at]);
  const winner = async venue => (await q('select athlete_id,points from private.jkcrew_current_park_king($1)', [venue])).rows[0] || null;
  const snapshot = async venue => (await q('select athlete_id,points,crown_title from park_king_snapshots where venue_key=private.jkcrew_venue_key($1)', [venue])).rows[0] || null;
  const refresh = venue => q('select private.refresh_park_king($1)', [venue]);
  const immutableData = async () => (await q(`select
    (select jsonb_agg(to_jsonb(a) order by id) from assignment_point_awards a) awards,
    (select jsonb_agg(to_jsonb(s) order by id) from training_sessions s) sessions,
    (select jsonb_agg(to_jsonb(x) order by id) from xp_ledger x) xp,
    (select jsonb_agg(to_jsonb(e) order by id) from park_king_events e) events,
    (select jsonb_agg(to_jsonb(p) order by dedupe_key) from push_notification_queue p) pushes`)).rows[0];
  try {
    await db.exec(`
      create schema private; create schema auth; create role anon; create role authenticated;
      grant usage on schema public,auth to anon,authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table profiles(id uuid primary key,display_name text,role text default 'athlete',country_code text default 'AU',avatar jsonb default '{}');
      create table training_sessions(id uuid primary key,athlete_id uuid references profiles,started_at timestamptz default now(),ended_at timestamptz,total_points integer default 0);
      create table assignment_point_awards(id uuid primary key default gen_random_uuid(),session_id uuid,athlete_id uuid references profiles,award_key text,venue text,points integer,created_at timestamptz default now());
      create table xp_ledger(id uuid primary key,athlete_id uuid,xp integer);
      create table park_king_snapshots(venue_key text primary key,venue_name text,athlete_id uuid references profiles,display_name text,avatar jsonb,points integer,updated_at timestamptz default now());
      create table park_king_events(id uuid primary key default gen_random_uuid(),venue_key text,venue_name text,athlete_id uuid references profiles,display_name text,points integer,created_at timestamptz default now());
      create table push_notification_queue(recipient_id uuid,notification_type text,title text,body text,url text,payload jsonb,dedupe_key text unique);
      create function private.jkcrew_venue_key(text) returns text language sql immutable as $$select regexp_replace(lower(btrim(coalesce($1,''))),'[^a-z0-9]','','g')$$;
      create function public.jkcrew_country_timezone(text) returns text language sql immutable as $$select case when $1='DE' then 'Europe/Berlin' else 'Australia/Brisbane' end$$;
    `);
    const initial = read('202607190030_fix_king_of_the_park_per_session.sql');
    const flawed = read('20260831150239_fix_park_king_live_session_scores.sql');
    await db.exec(between(flawed, 'create or replace function private.jkcrew_current_park_king(', '-- Refresh the venue'));
    await db.exec(between(initial, 'create or replace function public.get_park_king(', 'create or replace function private.handle_park_king_award_change()'));
    for (const [n, name] of [[1,'Kebe'],[2,'mylee toohey'],[3,'Ali'],[4,'Kim Lea Müller'],[5,'Lara'],[6,'Romy King'],[7,'Koby'],[8,'Other rider'],[9,'German rider']])
      await q('insert into profiles(id,display_name,country_code) values($1,$2,$3)', [id(n),name,n===9?'DE':'AU']);
    await db.exec(read('20261028095856_park_champion_crown_titles.sql'));
    await session(101,7,dayOne);
    for (const category of ['one_bang','lines','bonus']) await award(101,7,'HOTBOX',category,5,dayOne);
    await award(101,7,'OASIS PARK','one_bang',2,dayTwo);
    await session(105,5,dayTwo,'2026-10-28T03:00:00Z');
    await award(105,5,'OASIS PARK','daily-complete',1,dayTwo,'daily-complete:OASIS PARK:2026-10-28');
    await award(105,5,'OASIS PARK','daily-under-20',1,dayTwo,'daily-under-20:OASIS PARK:2026-10-28');
    await award(105,5,'OASIS PARK','group-first-finish',1);
    await award(105,5,'OASIS PARK','lines',3);
    await award(105,5,'OASIS PARK','percentage',3);
    eq(await winner('OASIS PARK'),{athlete_id:id(7),points:17},'Reproduces the real defect: yesterday’s Hotbox awards inflate the Oasis crown');
    await refresh('OASIS PARK');
    await refresh('HOTBOX');
    await q("insert into park_king_snapshots(venue_key,venue_name,athlete_id,display_name,avatar,points) values('old-oasis-alias','OASIS PARK',$1,'Koby','{}',17),('emptypark','Empty park',$1,'Koby','{}',8)",[id(7)]);
    await q('insert into xp_ledger values($1,$2,35)',[id(100),id(5)]);
    await q('update training_sessions set total_points=17 where id=$1',[id(101)]);
    await q('update training_sessions set total_points=9 where id=$1',[id(105)]);
    const before = await immutableData();
    const migrationName = process.env.JKCREW_PARK_SCORING_MIGRATION || fs.readdirSync(migrations).find(name => name.endsWith('_isolate_park_crown_venue_and_day.sql'));
    assert(migrationName,'Set JKCREW_PARK_SCORING_MIGRATION to the park scoring fix migration');
    const fix = read(migrationName);
    await db.exec('begin');
    await db.exec(fix);
    await db.exec('commit');
    eq(await winner('OASIS PARK'),{athlete_id:id(5),points:7},'Oasis now uses only the best score at Oasis');
    eq(await snapshot('OASIS PARK'),{athlete_id:id(5),points:7,crown_title:'Queen'},'Quiet correction immediately fixes the saved crown and Queen title');
    eq(await winner('HOTBOX'),{athlete_id:id(7),points:15},'Hotbox keeps its own legitimate score');
    eq(await snapshot('HOTBOX'),{athlete_id:id(7),points:15,crown_title:'King'},'Hotbox snapshot also removes points from the other venue');
    eq(await scalar("select count(*)::int from park_king_snapshots where venue_key in ('old-oasis-alias','emptypark')"),0,'Obsolete alias and empty-score cache rows are removed');
    eq(await immutableData(),before,'Backfill changes no earned points, XP, sessions, crown history or queued notifications');
    await db.exec(fix);
    eq(await snapshot('OASIS PARK'),{athlete_id:id(5),points:7,crown_title:'Queen'},'Reapplying the migration preserves the corrected snapshot');
    eq(await immutableData(),before,'Repeating the backfill produces no score writes or announcement replay');

    await session(201,7,dayOne);
    await session(205,5);
    await award(201,7,'Stale session','bonus',5,dayOne);
    await award(201,7,'Stale session','bonus',5,dayTwo);
    await award(205,5,'Stale session','lines',3,dayTwo);
    await award(205,5,'Stale session','percentage',3,dayTwo);
    eq(await winner('Stale session'),{athlete_id:id(5),points:6},'A session accidentally left open across days cannot combine two days’ scores');

    await session(301,7);
    await session(302,7);
    await session(305,5);
    await award(301,7,'Separate sessions','one_bang',2);
    await award(302,7,'Separate sessions','bonus',5);
    await award(305,5,'Separate sessions','lines',3);
    await award(305,5,'Separate sessions','percentage',3);
    eq(await winner('Separate sessions'),{athlete_id:id(5),points:6},'Separate sessions on the same day still cannot be combined');

    await session(401,7);
    for (const [category,points] of [['one_bang',2],['dialled',2],['percentage',3],['lines',3],['bonus',5]])
      await award(401,7,'All categories',category,points);
    for (const category of ['daily','daily-complete','daily-under-20']) await award(401,7,'All categories',category,1);
    for (const category of ['group-first-finish','battle','battle-win','weekly-challenge','other-landed','daily-tier-two']) await award(401,7,'All categories',category,5);
    eq(await winner('All categories'),{athlete_id:id(7),points:16},'Five training categories count, Daily is capped at one, and bonus/battle/challenge rewards are excluded');
    await session(402,7);
    await award(402,7,'Legacy daily','daily-under-20',1);
    eq(await winner('Legacy daily'),{athlete_id:id(7),points:1},'Legacy under20 evidence counts as one completed Daily, never an extra park bonus');

    await session(501,7,'2026-10-27T13:50:00Z');
    await session(505,5,'2026-10-27T14:00:00Z');
    await award(501,7,'Brisbane midnight','bonus',5,'2026-10-27T13:55:00Z');
    await award(501,7,'Brisbane midnight','bonus',5,'2026-10-27T14:05:00Z');
    await award(505,5,'Brisbane midnight','lines',3,'2026-10-27T14:10:00Z');
    await award(505,5,'Brisbane midnight','percentage',3,'2026-10-27T14:11:00Z');
    eq(await winner('Brisbane midnight'),{athlete_id:id(5),points:6},'Day boundaries follow Brisbane local time, not UTC');
    await session(509,9,'2026-10-27T22:50:00Z');
    await award(509,9,'Berlin midnight','bonus',5,'2026-10-27T22:55:00Z');
    await award(509,9,'Berlin midnight','bonus',5,'2026-10-27T23:05:00Z');
    eq(await winner('Berlin midnight'),{athlete_id:id(9),points:5},'German riders use their local day boundary');

    await session(601,7);
    await award(601,7,'Detached daily','lines',3);
    await award(null,7,'Detached daily','daily-complete',1);
    eq(await winner('Detached daily'),{athlete_id:id(7),points:4},'Detached daily completion is recovered only for the same rider, venue and day');
    await award(null,7,'Other daily venue','daily-complete',1);
    await award(null,7,'Detached daily','daily-complete',1,dayOne);
    await award(null,8,'Detached daily','daily-complete',1);
    eq(await winner('Detached daily'),{athlete_id:id(7),points:4},'Other dates, venues and riders cannot add daily credit');

    await session(701,7,dayOne);
    await award(701,7,'Single venue','one_bang',2,dayTwo);
    await award(701,7,'','lines',3,dayTwo);
    await award(701,7,'Yesterday venue','bonus',5,dayOne);
    eq(await winner('Single venue'),{athlete_id:id(7),points:5},'Historical blank-venue Lines are retained when that session/day has one known venue');
    eq(await winner('Yesterday venue'),{athlete_id:id(7),points:5},'Blank Lines from another day do not leak backwards');
    await award(701,7,'Second venue','one_bang',2,dayTwo);
    eq(await winner('Single venue'),{athlete_id:id(7),points:2},'Ambiguous blank-venue points are not guessed into the first venue');
    eq(await winner('Second venue'),{athlete_id:id(7),points:2},'Ambiguous blank-venue points are not guessed into the second venue');
    await session(702,7);
    await award(702,7,'  Mixed CASE Park  ','one_bang',2);
    await award(702,7,'mixed-case park','lines',3);
    eq(await winner('MIXED CASE PARK'),{athlete_id:id(7),points:5},'Venue normalization combines spelling/case variants without crossing actual venues');

    await session(801,7,'2026-10-28T00:00:00Z');
    await session(805,5,'2026-10-28T00:00:00Z');
    await award(805,5,'Tie park','bonus',5,'2026-10-28T01:00:00Z');
    await refresh('Tie park');
    await award(801,7,'Tie park','bonus',5,'2026-10-28T02:00:00Z');
    await refresh('Tie park');
    eq(await snapshot('Tie park'),{athlete_id:id(5),points:5,crown_title:'Queen'},'Matching the reigning girl’s score does not take the crown');
    await award(805,5,'Tie park','battle',5,'2026-10-28T03:00:00Z');
    await award(805,5,'Tie park','lines',0,'2026-10-28T03:30:00Z');
    await refresh('Tie park');
    eq(await snapshot('Tie park'),{athlete_id:id(5),points:5,crown_title:'Queen'},'Excluded rewards cannot change a tie’s achievement time');
    await award(801,7,'Tie park','one_bang',2,'2026-10-28T04:00:00Z');
    await refresh('Tie park');
    eq(await snapshot('Tie park'),{athlete_id:id(7),points:7,crown_title:'King'},'A boy who actually beats the score takes the crown as King');
    eq(await scalar("select count(*)::int from push_notification_queue where payload->>'athlete_id'=$1 and payload->>'points'='7' and title='New King of the Park'",[id(7)]),8,'Real future crown changes still notify the other riders');
    const eventsAfterWin=await scalar('select count(*)::int from park_king_events');
    const pushesAfterWin=await scalar('select count(*)::int from push_notification_queue');
    await refresh('Tie park');
    eq(await scalar('select count(*)::int from park_king_events'),eventsAfterWin,'Repeated refresh never emits a duplicate crown event');
    eq(await scalar('select count(*)::int from push_notification_queue'),pushesAfterWin,'Repeated refresh never emits duplicate pushes');

    await session(901,7);
    await award(901,8,'Ownership park','bonus',5);
    eq(await winner('Ownership park'),null,'An award with the wrong rider cannot transfer points through another rider’s session');
    await session(902,7);
    await award(902,7,'Empty score','battle',5);
    eq(await winner('Empty score'),null,'A battle-only session cannot claim a park crown');
    await session(903,7);
    await award(903,7,'Revoked points','daily-complete',0);
    await award(903,7,'Revoked points','one_bang',0);
    await award(903,7,'Revoked points','lines',-3);
    eq(await winner('Revoked points'),null,'Zero or negative rewards cannot create a park crown');
    await session(904,7);
    await award(904,7,'Only named training','one_bang',2);
    await award(null,7,'Only named training','daily-complete',0);
    eq(await winner('Only named training'),{athlete_id:id(7),points:2},'A detached zero-point Daily cannot add a completion point');
    eq(await winner('Unknown park'),null,'A venue with no score returns no champion');
    eq(await winner(''),null,'An empty venue cannot produce a crown');

    for (const role of ['anon','authenticated'])
      eq(await scalar('select has_function_privilege($1,$2,$3)',[role,'private.jkcrew_current_park_king(text)','EXECUTE']),false,'Internal score helper is not directly callable by '+role);
    eq(await scalar("select has_function_privilege('authenticated','public.get_park_king(text)','EXECUTE')"),true,'Existing authenticated RPC remains available');
    await q("select set_config('request.jwt.claim.sub',$1,false)",[id(7)]);
    await db.exec('set role authenticated');
    eq((await q("select athlete_id,points,crown_title from public.get_park_king('OASIS PARK')")).rows,[{athlete_id:id(5),points:7,crown_title:'Queen'}],'Actual authenticated RPC serves the corrected Queen and score');
    await q("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(q("select * from public.get_park_king('OASIS PARK')"),/Authentication required/);checks++;
    await db.exec('reset role');
    console.log(`PASS ${checks} park crown scoring database checks (${migrationName})`);
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
