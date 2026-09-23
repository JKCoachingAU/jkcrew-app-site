// Real PostgreSQL checks for the shared layout archive. Fixtures are confined to
// the disposable local database created by the existing /tmp-socket harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, literal, json } = require('./helpers/local-postgres.cjs');
const h = createHarness('past_events');
const migration = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [rider, coach, otherRider, parent, admin, otherCoach, unlinkedParent] = [1, 2, 3, 4, 5, 6, 7].map(id);
const [expired, completed, future, undated, dueOnly, noPhoto, privateTask, equalEnd] = [101, 102, 103, 104, 105, 106, 107, 108].map(id);
const photo = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024);
let passed = 0;
const as = (actor, sql, role = 'authenticated') => h.batch(`begin; select set_config('request.jwt.claim.sub',${literal(actor || '')},true); set local role ${role}; ${sql}; commit;`);
const rows = (actor, sql, role) => json(as(actor, `select coalesce(jsonb_agg(t),'[]'::jsonb) from (${sql}) t`, role));
const archive = (actor, args = '') => rows(actor, `select * from get_past_contest_events(${args})`);
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }

(async () => {
  try {
    await h.adapter.exec(`
      create role authenticated; create role anon;
      create schema auth; create schema private;
      grant usage on schema auth,public to authenticated,anon;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table profiles(id uuid primary key, role text);
      create table coach_athletes(coach_id uuid, athlete_id uuid);
      create table parent_athletes(parent_id uuid, athlete_id uuid);
      create table dashboard_items(id uuid primary key,owner_id uuid,created_by uuid,item_type text,title text,details text,
        due_at timestamptz,end_at timestamptz,completed boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
      create table run_plans(id uuid primary key,athlete_id uuid,coach_id uuid,image_data_url text,notes text);
      grant select on profiles,coach_athletes,parent_athletes,run_plans to authenticated;
      grant select,insert,update,delete on dashboard_items to authenticated;
      alter table profiles enable row level security;
      create policy self_profile on profiles for select to authenticated using(id=auth.uid());
      alter table coach_athletes enable row level security;
      create policy coach_links on coach_athletes for select to authenticated using(coach_id=auth.uid() or athlete_id=auth.uid());
      alter table parent_athletes enable row level security;
      create policy parent_links on parent_athletes for select to authenticated using(parent_id=auth.uid() or athlete_id=auth.uid());
      alter table run_plans enable row level security;
      create policy private_runs on run_plans for select to authenticated using(athlete_id=auth.uid() or coach_id=auth.uid());
      alter table dashboard_items enable row level security;
      create policy "Dashboard items are visible to owner links" on dashboard_items for select to authenticated using(
        owner_id=auth.uid() or exists(select 1 from coach_athletes c where c.coach_id=auth.uid() and c.athlete_id=owner_id)
        or exists(select 1 from parent_athletes p where p.parent_id=auth.uid() and p.athlete_id=owner_id));
      create policy "Dashboard items can be updated by owner or coach" on dashboard_items for update to authenticated
        using(owner_id=auth.uid() or exists(select 1 from coach_athletes c where c.coach_id=auth.uid() and c.athlete_id=owner_id))
        with check(owner_id=auth.uid() or exists(select 1 from coach_athletes c where c.coach_id=auth.uid() and c.athlete_id=owner_id));
      create policy "Active events are visible to authenticated crew" on dashboard_items for select to authenticated
        using(item_type='event' and completed=false and coalesce(end_at,due_at+interval '1 day','infinity')>=now());
      insert into profiles values('${rider}','athlete'),('${coach}','coach'),('${otherRider}','athlete'),('${parent}','parent'),('${admin}','admin'),('${otherCoach}','coach'),('${unlinkedParent}','parent');
      insert into coach_athletes values('${coach}','${rider}');
      insert into parent_athletes values('${parent}','${rider}');
      insert into dashboard_items(id,owner_id,created_by,item_type,title,details,due_at,end_at,completed) values
        ('${expired}','${otherRider}','${otherRider}','event','Logan finals','Loganland',now()-interval '3 days',now()-interval '2 days',false),
        ('${completed}','${rider}','${rider}','event','Finished early','Beenleigh',now()+interval '2 days',now()+interval '3 days',true),
        ('${future}','${rider}','${rider}','event','Upcoming finals','Beenleigh',now(),now()+interval '2 days',false),
        ('${undated}','${rider}','${rider}','event','Date TBC','No schedule yet',null,null,false),
        ('${dueOnly}','${otherRider}','${otherRider}','event','Single day event','Brisbane',now()-interval '2 days',null,false),
        ('${noPhoto}','${rider}','${rider}','event','100% finished','No photo',now()-interval '4 days',null,false),
        ('${privateTask}','${otherRider}','${otherRider}','task','Private reminder','Secret coaching task',now()-interval '2 days',null,true);
      insert into run_plans values('${id(500)}','${otherRider}','${otherCoach}','PRIVATE-RUN-IMAGE','private trick notes');
    `);
    // Apply the real existing course schema/RLS, omitting the unrelated merge RPC.
    const courseMigration = migration('20260830114500_shared_event_course_photos.sql');
    h.batch(courseMigration.slice(0, courseMigration.indexOf('-- Keep the source course photo recoverable')));
    h.batch(migration('20260830123000_parent_event_course_read_only.sql'));
    h.batch(`insert into event_course_photos(event_id,image_data_url,updated_by) values
      ('${expired}',${literal(photo)},'${coach}'),('${completed}',${literal(photo)},'${coach}'),('${future}',${literal(photo)},'${coach}');`);

    test('reproduces the missing expired layout before the fix', () => {
      assert.equal(rows(coach, `select event_id from event_course_photos where event_id='${expired}'`).length, 0);
      assert.equal(rows(coach, `select id from dashboard_items where id='${expired}'`).length, 0);
    });

    h.batch(migration('20260923214947_coach_past_events_layout_archive.sql'));
    test('coach sees completed and date-expired events, including shared events outside their roster', () => {
      assert.deepEqual(new Set(archive(coach).map(row => row.id)), new Set([expired, completed, dueOnly, noPhoto]));
      assert.deepEqual(new Set(archive(otherCoach).map(row => row.id)), new Set([expired, completed, dueOnly, noPhoto]));
      assert.deepEqual(new Set(archive(admin).map(row => row.id)), new Set([expired, completed, dueOnly, noPhoto]));
    });
    test('archive metadata accurately marks saved layouts and contains no images or private runs', () => {
      const result = archive(coach);
      assert(result.filter(row => [expired, completed].includes(row.id)).every(row => row.course_photo_available));
      assert(result.filter(row => [dueOnly, noPhoto].includes(row.id)).every(row => !row.course_photo_available));
      assert.deepEqual(Object.keys(result[0]).sort(), ['id', 'title', 'details', 'due_at', 'end_at', 'completed', 'effective_finished_at', 'course_photo_available'].sort());
      assert(JSON.stringify(result).length < 3000, 'A page does not contain the megabyte course payloads');
      assert.equal(rows(coach, 'select * from run_plans').length, 0);
      assert.equal(rows(coach, `select * from dashboard_items where id='${privateTask}'`).length, 0);
    });
    test('opening a past layout returns the original saved image unchanged', () => {
      assert.equal(rows(coach, `select image_data_url from event_course_photos where event_id='${expired}'`)[0].image_data_url, photo);
      assert.equal(rows(admin, `select image_data_url from event_course_photos where event_id='${completed}'`)[0].image_data_url, photo);
    });
    test('riders and parents cannot use the archive RPC or read archived course photos', () => {
      for (const actor of [rider, otherRider, parent, unlinkedParent]) {
        assert.throws(() => archive(actor), /Only coaches can view past events/);
        assert.equal(rows(actor, `select event_id from event_course_photos where event_id in('${expired}','${completed}')`).length, 0);
      }
      assert.throws(() => archive(null), /Only coaches can view past events/);
      assert.throws(() => rows(null, 'select * from get_past_contest_events()', 'anon'), /permission denied/);
    });
    test('existing rider and linked-parent active-course access still works', () => {
      for (const actor of [rider, otherRider, parent, coach]) {
        assert.equal(rows(actor, `select event_id from event_course_photos where event_id='${future}'`).length, 1);
      }
      assert.equal(rows(unlinkedParent, `select event_id from event_course_photos where event_id='${future}'`).length, 0);
    });
    test('archived courses remain protected against writes and private tasks stay scoped', () => {
      assert.throws(() => as(coach, `update event_course_photos set image_data_url=${literal(photo)} where event_id='${expired}'`), /row-level security/);
      assert.deepEqual(json(as(otherCoach, `with changed as (update dashboard_items set title='Unrelated edit' where id='${completed}' returning id) select coalesce(jsonb_agg(changed),'[]'::jsonb) from changed`)), []);
    });
    test('search uses title and venue with literal percent signs and case-insensitive matching', () => {
      assert.equal(archive(coach, "'lOgAn'")[0].id, expired);
      assert.equal(archive(coach, "'brisbane'")[0].id, dueOnly);
      assert.deepEqual(archive(coach, "'%'" ).map(row => row.id), [noPhoto]);
      assert.equal(archive(coach, "'missing'").length, 0);
    });
    test('pagination is deterministic and bounded, with safe null/negative arguments', () => {
      const all = archive(coach);
      assert.deepEqual(archive(coach, "'',2,0"), all.slice(0, 2));
      assert.deepEqual(archive(coach, "'',2,2"), all.slice(2, 4));
      assert.deepEqual(archive(coach, 'null,null,null'), all);
      assert.deepEqual(archive(coach, "'',-10,-20"), all.slice(0, 1));
      assert.deepEqual(archive(coach, "'',2,10000"), []);
    });
    test('finishing an event preserves its image and automatically moves it into the archive', () => {
      const before = rows(coach, `select event_id,md5(image_data_url) as checksum from event_course_photos where event_id='${future}'`);
      as(coach, `update dashboard_items set completed=true,updated_at=now() where id='${future}'`);
      assert(archive(coach).some(row => row.id === future && row.course_photo_available));
      assert.deepEqual(rows(coach, `select event_id,md5(image_data_url) as checksum from event_course_photos where event_id='${future}'`), before);
      assert.equal(rows(rider, `select event_id from event_course_photos where event_id='${future}'`).length, 0);
    });
    test('finish-time equality remains active until time passes; start-only events use the existing 24-hour fallback', () => {
      const result = json(h.batch(`begin;
        insert into dashboard_items(id,owner_id,item_type,title,end_at) values('${equalEnd}','${rider}','event','At boundary',now());
        select set_config('request.jwt.claim.sub','${coach}',true); set local role authenticated;
        select json_build_object('past_at_boundary',exists(select 1 from get_past_contest_events() where id='${equalEnd}'),
          'active_at_boundary',exists(select 1 from dashboard_items where id='${equalEnd}' and completed=false and coalesce(end_at,due_at+interval '1 day','infinity')>=now()));
        rollback;`));
      assert.deepEqual(result, { past_at_boundary: false, active_at_boundary: true });
      assert(archive(coach).some(row => row.id === dueOnly));
    });
    test('page size cannot exceed 50 and equal timestamps have a stable ID tie-breaker', () => {
      h.batch(`insert into dashboard_items(id,owner_id,item_type,title,completed,updated_at)
        select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${rider}','event','Page fixture',true,'2026-01-01'::timestamptz from generate_series(1000,1060) n;`);
      const page = archive(coach, "'Page fixture',999,0");
      assert.equal(page.length, 50);
      assert.equal(page[0].id, id(1060));
      assert.equal(page.at(-1).id, id(1011));
      assert.equal(archive(coach, "'Page fixture',50,50").length, 11);
    });
    console.log(`${passed} past-event database checks passed.`);
  } finally { await h.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
