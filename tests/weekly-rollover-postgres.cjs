// Real PostgreSQL backends, synthetic riders and a disposable /tmp-only database.
// JKCREW_PG_BIN=/tmp/jkcrew-chat-native-bin JKCREW_PG_SOCKET=/tmp/jkcrew-rewards-postgres/socket node tests/weekly-rollover-postgres.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHarness, literal, json } = require('./helpers/local-postgres.cjs');
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const week = '2026-10-04';
const previous = '2026-09-27';
const categories = ['daily', 'one_bang', 'dialled', 'percentage', 'foam_pit', 'bonus', 'lines'];
const read = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
function extractFunction(source, name) {
  const start = source.toLowerCase().indexOf(`create or replace function ${name.toLowerCase()}(`);
  assert(start >= 0, `${name} must exist in the checked-in migration`);
  const tail = source.slice(start);
  const delimiter = tail.match(/\bas\s+(\$[a-z_]*\$)/i);
  assert(delimiter, `${name} must have a dollar-quoted body`);
  const end = tail.indexOf(delimiter[1], delimiter.index + delimiter[0].length);
  return `${tail.slice(0, end + delimiter[1].length)};`;
}
async function run() {
  const h = createHarness('weekly_rollover');
  let checks = 0;
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const acting = n => `set request.jwt.claim.sub=${literal(n ? id(n) : '')};set role authenticated;`;
  const viewerSql = (riders, dates = riders.map(() => week)) => `select coalesce(jsonb_agg(to_jsonb(rows) order by athlete_id,sort_order,id),'[]'::jsonb) from public.get_coach_session_viewer_plan_data(array[${riders.map(n => literal(id(n))).join(',')}]::uuid[],array[${dates.map(literal).join(',')}]::date[]) rows;`;
  const view = (riders, actor = 1, dates) => json(h.batch(acting(actor) + viewerSql(riders, dates)));
  const rows = (rider, date = week) => json(h.batch(`select coalesce(jsonb_agg(to_jsonb(w) order by sort_order,id),'[]'::jsonb) from weekly_trick_assignments w where athlete_id='${id(rider)}' and week_start=${literal(date)};`));
  const ensureSql = rider => `select public.ensure_current_week_assignments('${id(rider)}','${week}');`;
  const saveListSql = (rider, category, items = [], date = week) => `select public.save_weekly_assignment_list('${id(rider)}',${literal(date)},${literal(category)},'',${literal(JSON.stringify(items))}::jsonb);`;
  const saveFullSql = (rider, items) => `select public.save_weekly_assignments('${id(rider)}','${week}',${literal(JSON.stringify(items))}::jsonb,null);`;
  const history = rider => json(h.batch(`select jsonb_build_object(
    'assignments',(select jsonb_agg(w order by id) from weekly_trick_assignments w where athlete_id='${id(rider)}' and week_start='${previous}'),
    'progress',(select jsonb_agg(p order by assignment_id) from assignment_progress p where athlete_id='${id(rider)}'),
    'awards',(select jsonb_agg(a order by id) from assignment_point_awards a where athlete_id='${id(rider)}'),
    'percentage',(select jsonb_agg(p order by id) from percentage_attempts p where athlete_id='${id(rider)}'),
    'attempts',(select jsonb_agg(a order by id) from assignment_attempts a where athlete_id='${id(rider)}'));`));
  function seed(rider, { country = 'AU', oldWeek = previous, progress = false, linked = true } = {}) {
    h.batch(`insert into profiles values('${id(rider)}','athlete',${literal(country)});
      ${linked ? `insert into coach_athletes values('${id(1)}','${id(rider)}');` : ''}
      insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,target_reps,notes,sort_order,venue,created_at,updated_at) values
      ${categories.map((category, index) => `('${id(rider * 100 + index)}','${id(1)}','${id(rider)}','${oldWeek}',${literal(`${category} existing`)},'${category}',${category === 'percentage' ? 10 : category === 'dialled' ? 3 : 1},'Keep this note',${index},${literal(category === 'daily' ? 'Park A' : '')},'2026-09-28T01:00Z','2026-09-28T01:00Z')`).join(',')};
      ${progress ? `insert into assignment_progress(assignment_id,athlete_id,completed_at,progress_date,streak_count) select id,athlete_id,'2026-09-30T01:00Z','2026-09-30',3 from weekly_trick_assignments where athlete_id='${id(rider)}';
      insert into percentage_attempts(assignment_id,athlete_id,attempt_number,landed,created_at) select '${id(rider * 100 + 3)}','${id(rider)}',i,true,'2026-09-30T01:00Z' from generate_series(1,10)i;
      insert into assignment_point_awards(assignment_id,athlete_id,points,created_at) values('${id(rider * 100 + 1)}','${id(rider)}',2,'2026-09-30T01:00Z');
      insert into assignment_attempts(assignment_id,athlete_id,week_start,attempted_at) values('${id(rider * 100 + 2)}','${id(rider)}','${previous}','2026-09-30T01:00Z');` : ''}`);
  }
  function plan(rider, status, trick = 'Coach replacement') {
    h.batch(`insert into weekly_assignment_plans(coach_id,athlete_id,target_week_start,trick_name,category,target_reps,notes,sort_order,venue,status) values('${id(1)}','${id(rider)}','${week}',${literal(trick)},'lines',1,'Scheduled note',0,'',${literal(status)});`);
  }
  try {
    await h.adapter.exec(`create role anon;create role authenticated;
      create schema auth;create schema private;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,private to authenticated;
      create table profiles(id uuid primary key,role text,country_code text);
      create table coach_athletes(coach_id uuid,athlete_id uuid,primary key(coach_id,athlete_id));
      create table parent_athletes(parent_id uuid,athlete_id uuid,primary key(parent_id,athlete_id));
      create table coach_venues(id uuid primary key default gen_random_uuid(),coach_id uuid,name text,sort_order integer);
      create table weekly_trick_assignments(id uuid primary key default gen_random_uuid(),coach_id uuid,athlete_id uuid,week_start date,trick_name text,category text,target_reps integer default 1,notes text default '',sort_order integer,created_at timestamptz default now(),updated_at timestamptz default now(),venue text default '',unique(coach_id,athlete_id,week_start,sort_order));
      create table weekly_assignment_plans(id uuid primary key default gen_random_uuid(),coach_id uuid,athlete_id uuid,target_week_start date,trick_name text,category text,target_reps integer,notes text,sort_order integer,venue text,status text,created_at timestamptz default now(),updated_at timestamptz default now(),published_at timestamptz);
      create table assignment_progress(assignment_id uuid primary key references weekly_trick_assignments(id) on delete cascade,athlete_id uuid,completed_at timestamptz,progress_date date,streak_count integer default 0,updated_at timestamptz default now());
      create table percentage_attempts(id uuid primary key default gen_random_uuid(),assignment_id uuid references weekly_trick_assignments(id) on delete cascade,athlete_id uuid,attempt_number integer,landed boolean,created_at timestamptz default now(),unique(assignment_id,attempt_number));
      create table assignment_point_awards(id uuid primary key default gen_random_uuid(),assignment_id uuid references weekly_trick_assignments(id),athlete_id uuid,points integer,created_at timestamptz default now());
      create table assignment_attempts(id uuid primary key default gen_random_uuid(),assignment_id uuid references weekly_trick_assignments(id) on delete cascade,athlete_id uuid,week_start date,attempted_at timestamptz default now());
      insert into profiles values('${id(1)}','coach','AU'),('${id(2)}','coach','AU'),('${id(3)}','admin','AU'),('${id(4)}','parent','AU');`);
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/daily-production-functions.json'), 'utf8')).functions;
    for (const signature of ['jkcrew_country_timezone(text)', 'jkcrew_week_bounds(text,timestamp with time zone)', 'private.jkcrew_venue_key(text)']) {
      h.batch(fixture.find(row => row.signature === signature).definition + ';');
    }
    // Freeze only the clock seam; use the actual country/date implementation.
    h.batch(`alter function jkcrew_week_bounds(text,timestamptz) rename to fixture_week_bounds;
      create table private.fixture_clock(now_at timestamptz);insert into private.fixture_clock values('2026-10-04T13:00Z');
      create function jkcrew_week_bounds(p_country_code text,p_now timestamptz default now()) returns table(week_start_date date,week_start_ts timestamptz,next_week_start_ts timestamptz,local_today date) language sql stable security definer set search_path=public,private as $$select b.* from private.fixture_clock c cross join lateral public.fixture_week_bounds(p_country_code,case when p_now=now() then c.now_at else p_now end)b$$;`);
    const oldRollover = read('202606141205_harden_weekly_planner_drafts.sql');
    h.batch(extractFunction(oldRollover, 'public.ensure_current_week_assignments'));
    h.batch(read('202607071930_fix_weekly_assignment_save_sort_collisions.sql'));
    h.batch(extractFunction(read('20260827220000_merge_beenleigh_locations.sql'), 'public.get_coach_session_viewer_plan_data'));
    seed(10, { progress: true });
    const before = history(10);
    eq(view([10]).map(row => row.category), ['daily'], 'Baseline reproduces coach weekly lists disappearing before rider visits');
    eq(rows(10).length, 0, 'Old coach reader never materializes the new week');
    const migration = read('20261004132236_carry_weekly_lists_into_coach_session_viewer.sql');
    assert(migration.trim(), 'The rollover migration must be populated');
    h.batch(migration);
    let carried = view([10]);
    eq(carried.map(row => row.category), categories, 'First coach visit carries every list, including Lines');
    eq(carried.every(row => row.week_start === week && row.requested_week_start === week && !row.using_fallback), true, 'New list uses current-week assignment IDs');
    eq(carried.every(row => row.progress === null && row.percentage_attempts.length === 0 && row.assignment_attempts.length === 0 && row.awards.length === 0), true, 'Weekly completion, streaks, percentage attempts and awards start fresh');
    eq(carried.every(row => row.notes === 'Keep this note' && !before.assignments.some(old => old.id === row.id)), true, 'Fresh IDs preserve coach list content and notes');
    eq(history(10), before, 'Rollover preserves all previous assignments, progress, awards and attempts');
    eq(view([10]).map(row => row.id), carried.map(row => row.id), 'Repeated coach reads are idempotent');
    eq(h.batch(acting(10) + ensureSql(10)).split('\n').at(-1), '0', 'Rider opening afterward cannot duplicate the week');
    eq(rows(10).length, categories.length, 'No duplicate current assignments');

    seed(11);plan(11, 'scheduled_next_week');
    eq(view([11]).filter(row => row.category !== 'daily').map(row => row.trick_name), ['Coach replacement'], 'Scheduled plan replaces inherited weekly lists');
    eq(h.batch(`select status from weekly_assignment_plans where athlete_id='${id(11)}';`), 'archived_previous_week', 'Activated schedule is archived');
    seed(12);plan(12, 'draft_next_week', 'Private unscheduled draft');
    eq(view([12]).map(row => row.category), categories, 'Private draft does not replace active lists');
    eq(h.batch(`select status from weekly_assignment_plans where athlete_id='${id(12)}';`), 'draft_next_week', 'Reading leaves private draft untouched');
    seed(13);plan(13, 'published', 'Legacy published replacement');
    eq(view([13]).find(row => row.category === 'lines').trick_name, 'Legacy published replacement', 'Legacy published plans still activate');

    seed(14);view([14]);
    h.batch(acting(1) + saveListSql(14, 'dialled', [{ trick_name: 'Coach changed Dialled', notes: 'New plan' }]) + saveListSql(14, 'bonus'));
    const coachEdited = rows(14);
    eq(view([14]).find(row => row.category === 'dialled').trick_name, 'Coach changed Dialled', 'Coach edits are retained on repeated rollover');
    eq(view([14]).some(row => row.category === 'bonus'), false, 'Intentionally cleared weekly category does not resurrect');
    eq(rows(14), coachEdited, 'Repeated coach read never rewrites existing week');
    seed(15);
    h.batch(acting(1) + saveListSql(15, 'dialled', [{ trick_name: 'First action was editing this list' }]));
    eq(view([15]).map(row => row.category).sort(), [...categories].sort(), 'Single-list save first carries the other six categories');
    eq(view([15]).find(row => row.category === 'dialled').trick_name, 'First action was editing this list', 'Single-list change survives first coach read');

    seed(16);view([16]);plan(16, 'scheduled_next_week', 'Too late to replace progress');
    h.batch(`insert into assignment_progress(assignment_id,athlete_id,completed_at) select id,athlete_id,now() from weekly_trick_assignments where athlete_id='${id(16)}' and week_start='${week}' and category='one_bang';`);
    const progressedIds = rows(16).map(row => row.id);
    eq(view([16]).map(row => row.id), progressedIds, 'Existing production guard preserves current progress against a late schedule');
    eq(h.batch(`select status from weekly_assignment_plans where athlete_id='${id(16)}';`), 'scheduled_next_week', 'Blocked late schedule stays scheduled');

    seed(17, { linked: false });
    eq(view([17], 1), [], 'Unlinked coach cannot read or trigger rollover');
    eq(rows(17).length, 0, 'Denied coach read writes no rows');
    eq(view([17], 17), [], 'Rider cannot invoke the coach reader');
    eq(view([17], 4), [], 'Parent cannot invoke the coach reader');
    eq(view([17], null), [], 'Unauthenticated subject returns no coach data');
    assert.throws(() => h.batch(acting(2) + ensureSql(17)), /Not allowed/);checks += 1;
    assert.throws(() => h.batch(`set role anon;${viewerSql([17])}`), /permission denied/);checks += 1;
    eq(view([17], 3).length, categories.length, 'Admin can carry a visible rider without a coach link');
    seed(18);eq(view([18], 2), [], 'Other coach cannot read linked rider');
    eq(rows(18).length, 0, 'Other coach cannot materialize linked rider');
    h.batch(`insert into parent_athletes values('${id(4)}','${id(18)}');`);
    eq(h.batch(acting(4) + ensureSql(18)).split('\n').at(-1), String(categories.length), 'Existing linked-parent rollover permission remains intact');

    seed(19);
    eq(view([19], 1, [previous]).length, categories.length, 'Historical week can still be inspected');
    eq(view([19], 1, ['2026-10-11']).every(row => row.category === 'daily'), true, 'Future reads preserve Daily fallback without publishing a future sheet');
    eq(rows(19).length + rows(19, '2026-10-11').length, 0, 'Historical and future coach reads cause no assignment writes');
    seed(20);
    h.batch(`insert into weekly_trick_assignments(coach_id,athlete_id,week_start,trick_name,category,target_reps,notes,sort_order,venue,created_at,updated_at) values('${id(1)}','${id(20)}','2026-09-20','Older park survives','daily',1,'',20,'Park B','2026-09-21T01:00Z','2026-09-21T01:00Z');`);
    eq(view([20]).filter(row => row.category === 'daily').map(row => row.venue).sort(), ['Park A', 'Park B'], 'Per-location Daily fallback remains available');

    // Sunday in Brisbane is still Saturday in Germany at this fixed instant.
    h.batch("update private.fixture_clock set now_at='2026-10-03T15:00Z';");
    seed(21, { country: 'AU' });seed(22, { country: 'DE', oldWeek: '2026-09-20' });
    const mixed = view([21, 22], 1, [week, previous]);
    eq(mixed.filter(row => row.athlete_id === id(21)).length, categories.length, 'Australian coach read returns the complete new sheet');
    eq(mixed.filter(row => row.athlete_id === id(22)).length, categories.length, 'German coach read returns its complete local sheet');
    eq(mixed.filter(row => row.athlete_id === id(21)).every(row => row.week_start === week), true, 'Australia advances at its own Sunday boundary');
    eq(mixed.filter(row => row.athlete_id === id(22)).every(row => row.week_start === previous), true, 'Germany remains on its local prior week');
    eq(rows(22).length, 0, 'Australian Sunday must not publish German next week early');
    view([22], 1, [week]);eq(rows(22).length, 0, 'Explicit German future week request also remains read-only');
    h.batch("update private.fixture_clock set now_at='2026-10-04T13:00Z';");

    // Real independent backends prove the second call waits, then sees the
    // committed rows. A sequential duplicate-call test cannot catch this race.
    seed(23);
    const a = h.connect('coach_first'), b = h.connect('rider_second');
    await a.query(acting(1));await b.query(acting(23));
    const first = json(await a.query('begin;' + viewerSql([23])));
    const waiting = b.query('begin;' + ensureSql(23));
    await h.waitLock(b);await a.query('commit;');
    eq((await waiting).split('\n').at(-1), '0', 'Concurrent rider waits, then observes coach rollover');
    await b.query('commit;');
    eq(rows(23).map(row => row.id), first.map(row => row.id), 'Concurrent rider/coach keep one exact sheet');

    seed(24);
    const edit = h.connect('list_editor'), readCoach = h.connect('coach_reader');
    await edit.query(acting(1));await readCoach.query(acting(1));
    await edit.query('begin;' + saveListSql(24, 'dialled', [{ trick_name: 'Concurrent coach edit' }]));
    const waitingRead = readCoach.query('begin;' + viewerSql([24]));
    await h.waitLock(readCoach);await edit.query('commit;');
    const editedRead = json(await waitingRead);await readCoach.query('commit;');
    eq(editedRead.find(row => row.category === 'dialled').trick_name, 'Concurrent coach edit', 'Coach reader waits for single-list edit and sees saved content');
    eq(editedRead.length, categories.length, 'Single-list edit versus reader does not strand remaining lists');

    seed(25);
    const full = h.connect('full_editor'), fullReader = h.connect('full_reader');
    await full.query(acting(1));await fullReader.query(acting(1));
    await full.query('begin;' + saveFullSql(25, [{ trick_name: 'Explicit complete replacement', category: 'one_bang', target_reps: 1, notes: '', venue: '' }]));
    const waitingFullRead = fullReader.query('begin;' + viewerSql([25]));
    await h.waitLock(fullReader);await full.query('commit;');
    const afterFull = json(await waitingFullRead);await fullReader.query('commit;');
    eq(afterFull.filter(row => row.category !== 'daily').map(row => row.trick_name), ['Explicit complete replacement'], 'Full coach replacement and rollover serialize without restoring removed weekly lists');
    console.log(`PASS ${checks} weekly rollover PostgreSQL checks, including baseline reproduction and three real lock races`);
  } finally { await h.close(); }
}
run().catch(error => { console.error(error);process.exitCode = 1; });
