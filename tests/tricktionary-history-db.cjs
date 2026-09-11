const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const rider = id(1), coach = id(2), parent = id(3), stranger = id(4), otherCoach = id(5), otherParent = id(6);
  await db.exec(`
    create schema auth; create schema private; create role anon; create role authenticated; create role service_role;
    grant usage on schema public, auth to authenticated, anon;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.profiles(id uuid primary key, role text, display_name text, country_code text);
    create table public.coach_athletes(coach_id uuid, athlete_id uuid);
    create table public.parent_athletes(parent_id uuid, athlete_id uuid, coach_id uuid);
    create table public.weekly_trick_assignments(
      id uuid primary key, athlete_id uuid references profiles(id), coach_id uuid,
      trick_name text, category text, notes text default '', venue text default '',
      week_start date default '2026-09-07', created_at timestamptz default now()
    );
    create table public.assignment_progress(
      assignment_id uuid primary key references weekly_trick_assignments(id) on delete cascade,
      athlete_id uuid, progress_date date, completed_at timestamptz,
      streak_count integer default 0, updated_at timestamptz default now()
    );
    create table public.percentage_attempts(
      id uuid primary key default gen_random_uuid(),
      assignment_id uuid references weekly_trick_assignments(id) on delete cascade,
      athlete_id uuid, attempt_number integer, landed boolean,
      created_at timestamptz default now(), unique(assignment_id, attempt_number)
    );
    create table public.assignment_attempts(
      id uuid primary key default gen_random_uuid(),
      assignment_id uuid references weekly_trick_assignments(id) on delete cascade,
      athlete_id uuid, trick_name text, category text, attempted_at timestamptz default now()
    );
    create table public.assignment_point_awards(id uuid primary key, points integer);
    create table public.xp_ledger(
      id uuid primary key, xp integer, athlete_id uuid, assignment_id uuid,
      source_id text, source_type text, trick_name text, venue text,
      metadata jsonb default '{}', created_at timestamptz default now()
    );
    create table public.training_sessions(id uuid primary key, total_points integer);
    create table private.retired_daily_assignment_backups(
      assignment_id uuid primary key, retired_at timestamptz default now(), reason text,
      assignment jsonb not null, assignment_progress jsonb default '[]',
      assignment_attempts jsonb default '[]', assignment_point_awards jsonb default '[]', xp_ledger jsonb default '[]'
    );
    create table private.rider_sheet_replacement_backups(
      proposal_id uuid, assignment_id uuid, backed_up_at timestamptz default now(),
      assignment jsonb not null, assignment_progress jsonb default '[]',
      assignment_attempts jsonb default '[]', percentage_attempts jsonb default '[]',
      assignment_point_awards jsonb default '[]', xp_ledger jsonb default '[]',
      primary key(proposal_id, assignment_id)
    );
    grant select on public.profiles, public.coach_athletes, public.parent_athletes to authenticated;
    create function private.reject_score_write() returns trigger language plpgsql as $$
      begin raise exception 'Tricktionary history must not write to %', tg_table_name; end;
    $$;
    insert into assignment_point_awards values('${id(900)}', 17);
    insert into training_sessions values('${id(902)}', 29);
  `);
  for (const [uid, role] of [[rider, 'athlete'], [coach, 'coach'], [parent, 'parent'], [stranger, 'athlete'], [otherCoach, 'coach'], [otherParent, 'parent']]) {
    await db.query("insert into profiles values($1, $2, 'Test user', 'AU')", [uid, role]);
  }
  await db.query('insert into coach_athletes values($1,$2)', [coach, rider]);
  await db.query('insert into parent_athletes values($1,$2,$3)', [parent, rider, coach]);
  const assignment = async (n, title, category = 'daily') => {
    await db.query('insert into weekly_trick_assignments(id,athlete_id,coach_id,trick_name,category,notes,venue) values($1,$2,$3,$4,$5,$6,$7)',
      [id(n), rider, coach, title, category, `${title} note`, 'Test park']);
  };
  const progress = async (n, date = null, completed = null) => {
    await db.query('insert into assignment_progress(assignment_id,athlete_id,progress_date,completed_at) values($1,$2,$3,$4)', [id(n), rider, date, completed]);
  };
  await assignment(10, 'Daily backfill'); await progress(10, '2026-09-09');
  for (const [n, category] of [[11, 'bonus'], [12, 'one_bang'], [13, 'dialled'], [14, 'lines'], [15, 'foam_pit']]) {
    await assignment(n, `Completed ${category}`, category); await progress(n, null, '2026-09-09T02:00:00Z');
  }
  await assignment(16, 'Unticked assignment'); await progress(16);
  await assignment(17, 'Percentage backfill', 'percentage');
  await db.query("insert into percentage_attempts(id,assignment_id,athlete_id,attempt_number,landed,created_at) values($1,$2,$3,1,true,'2026-09-09'),($4,$2,$3,2,false,'2026-09-09')", [id(171), id(17), rider, id(172)]);
  await db.query("insert into assignment_attempts(assignment_id,athlete_id,trick_name,category) values($1,$2,'Attempt only','daily')", [id(16), rider]);

  const archivedAssignment = (n, title, category = 'daily') => ({ id: id(n), athlete_id: rider, coach_id: coach, trick_name: title, category, notes: 'Archived note', venue: 'Old park', week_start: '2026-08-31' });
  const archivedProgress = (n, date = null, completed = null) => [{ assignment_id: id(n), athlete_id: rider, progress_date: date, completed_at: completed, updated_at: '2026-09-03T03:00:00Z' }];
  await db.query("insert into private.retired_daily_assignment_backups(assignment_id,reason,assignment,assignment_progress) values($1,'Test archive',$2,$3)",
    [id(20), JSON.stringify(archivedAssignment(20, 'Retired daily')), JSON.stringify(archivedProgress(20, '2026-09-03'))]);
  await db.query('insert into private.rider_sheet_replacement_backups(proposal_id,assignment_id,assignment,assignment_progress) values($1,$2,$3,$4)',
    [id(200), id(20), JSON.stringify(archivedAssignment(20, 'Retired daily')), JSON.stringify(archivedProgress(20, '2026-09-03'))]);
  await db.query('insert into private.rider_sheet_replacement_backups(proposal_id,assignment_id,assignment,assignment_progress) values($1,$2,$3,$4)',
    [id(200), id(21), JSON.stringify(archivedAssignment(21, 'Replaced bonus', 'bonus')), JSON.stringify(archivedProgress(21, null, '2026-09-02T03:00:00Z'))]);
  await db.query('insert into private.rider_sheet_replacement_backups(proposal_id,assignment_id,assignment,percentage_attempts) values($1,$2,$3,$4)',
    [id(200), id(22), JSON.stringify(archivedAssignment(22, 'Replaced percentage', 'percentage')), JSON.stringify([
      { id: id(221), assignment_id: id(22), athlete_id: rider, landed: true, attempt_number: 1, created_at: '2026-09-02T03:00:00Z' },
      { id: id(222), assignment_id: id(22), athlete_id: rider, landed: false, attempt_number: 2, created_at: '2026-09-02T03:00:00Z' }
    ])]);
  const xp = async (n, sourceAssignment, type, value = 10, metadata = {}, currentAssignment = null) => {
    await db.query('insert into xp_ledger(id,xp,athlete_id,assignment_id,source_id,source_type,trick_name,venue,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id(n), value, rider, currentAssignment, id(sourceAssignment), type, `Historical ${type} ${n}`, 'Old park', JSON.stringify(metadata)]);
  };
  await xp(301, 31, 'bonus'); await xp(302, 32, 'percentage', 10, { landed: 7 });
  await xp(303, 33, 'daily'); await xp(304, 34, 'bonus', -10);
  await xp(305, 11, 'bonus', 10, {}, id(11)); await xp(306, 21, 'bonus');
  const originalXp = (await db.query('select * from xp_ledger order by id')).rows;
  await db.exec(`
    create trigger score_read_only before insert or update or delete on assignment_point_awards for each statement execute function private.reject_score_write();
    create trigger xp_read_only before insert or update or delete on xp_ledger for each statement execute function private.reject_score_write();
    create trigger session_score_read_only before insert or update or delete on training_sessions for each statement execute function private.reject_score_write();
  `);
  const migrationPath = process.env.JKCREW_TRICKTIONARY_HISTORY_SQL || path.join(__dirname, '../supabase/migrations/20260911030012_preserve_tricktionary_landed_history.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  await db.exec(migration);
  const rows = async () => (await db.query('select * from tricktionary_landing_history order by id')).rows;
  const forAssignment = async n => (await rows()).filter(row => row.assignment_id === id(n));
  const activeFor = async n => (await forAssignment(n)).filter(row => row.landed_count > 0);
  const dates = rows => rows.map(row => row.landing_date?.toISOString().slice(0, 10)).sort();
  assert.equal((await activeFor(10)).length, 1, 'An existing daily tick is recovered');
  for (const n of [11, 12, 13, 14, 15]) assert.equal((await activeFor(n)).length, 1, 'Every completed category is captured');
  assert.equal((await forAssignment(16)).length, 0, 'An attempt or assignment alone is not a landing');
  assert.equal((await activeFor(17)).length, 1, 'Only landed percentage attempts are recovered');
  for (const n of [20, 21, 22]) assert.equal((await activeFor(n)).length, 1, 'Verified private backup evidence is recovered exactly once');
  assert((await rows()).some(row => row.id === `xp:${id(301)}` && row.landed_count === 1), 'Named orphan bonus XP supplies landing evidence');
  assert((await rows()).some(row => row.id === `xp:${id(302)}` && row.landed_count === 7), 'Orphan percentage XP preserves its confirmed landed count');
  for (const n of [303, 304, 305, 306]) assert(!(await rows()).some(row => row.id === `xp:${id(n)}`), 'Full-list, reversed, linked and already-restored XP are excluded');
  const firstBackfill = await rows();
  await db.exec(migration);
  assert.deepEqual(await rows(), firstBackfill, 'Running the backfill again does not duplicate or change evidence');

  await db.query("update assignment_progress set progress_date='2026-09-10' where assignment_id=$1", [id(10)]);
  assert.deepEqual(dates(await activeFor(10)), ['2026-09-09', '2026-09-10'], 'A new daily tick retains the previous day');
  await db.query('update assignment_progress set progress_date=null where assignment_id=$1', [id(10)]);
  assert.deepEqual(dates(await activeFor(10)), ['2026-09-09'], 'Unticking removes the current date only');
  assert((await forAssignment(10)).some(row => row.landed_count === 0 && row.evidence_type === 'revoked'), 'An untick retains a tombstone so stale session rows cannot restore it');
  await db.query("update assignment_progress set progress_date='2026-09-10' where assignment_id=$1", [id(10)]);
  assert.equal((await activeFor(10)).length, 2, 'Reticking restores the corrected landing');
  await db.query("update assignment_progress set progress_date='2026-09-10', updated_at=now() where assignment_id=$1", [id(10)]);
  assert.equal((await activeFor(10)).length, 2, 'Repeated saves of the same daily tick do not add landings');
  await db.query('delete from weekly_trick_assignments where id=$1', [id(10)]);
  assert.equal((await activeFor(10)).length, 2, 'Replacing a daily assignment retains verified history');

  await db.query('update assignment_progress set completed_at=null where assignment_id=$1', [id(11)]);
  assert.equal((await activeFor(11)).length, 0, 'Explicitly unticking a completed non-daily trick withdraws that landing');
  assert.equal((await forAssignment(11))[0].evidence_type, 'revoked');
  await db.query("update assignment_progress set completed_at='2026-09-10T03:00:00Z' where assignment_id=$1", [id(11)]);
  await db.query('delete from weekly_trick_assignments where id=$1', [id(11)]);
  assert.equal((await activeFor(11)).length, 1, 'Replacing a completed assignment retains its history');

  await db.query('update percentage_attempts set landed=true where id=$1', [id(172)]);
  assert.equal((await activeFor(17)).length, 2, 'Changing a percentage result to landed adds evidence');
  await db.query('update percentage_attempts set landed=false where id=$1', [id(172)]);
  assert.equal((await activeFor(17)).length, 1, 'Correcting a percentage result retracts only that attempt');
  await db.query('delete from percentage_attempts where id=$1', [id(171)]);
  assert.equal((await activeFor(17)).length, 0, 'Deleting an attempt while the assignment exists retracts it');
  await db.query('update percentage_attempts set landed=true where id=$1', [id(172)]);
  await db.query('delete from weekly_trick_assignments where id=$1', [id(17)]);
  assert.equal((await activeFor(17)).length, 1, 'Assignment replacement does not erase percentage landing history');

  await assignment(30, 'A newly ticked trick'); await progress(30, '2026-09-10');
  assert.equal((await activeFor(30)).length, 1, 'New progress inserts are captured after migration');
  // A restored sheet can reuse an archived assignment or attempt ID. A later
  // correction must remain authoritative when historical recovery is rerun.
  await assignment(20, 'Retired daily'); await progress(20, '2026-09-03');
  await db.query('update assignment_progress set progress_date=null where assignment_id=$1', [id(20)]);
  await db.exec(migration);
  assert.equal((await activeFor(20)).length, 0, 'Archive recovery must not revive an explicitly unticked daily landing');
  assert.equal((await forAssignment(20))[0].evidence_type, 'revoked');
  await db.query("update assignment_progress set progress_date='2026-09-03' where assignment_id=$1", [id(20)]);
  assert.equal((await activeFor(20)).length, 1, 'A new live retick may restore an archived daily landing');

  await assignment(22, 'Replaced percentage', 'percentage');
  await db.query("insert into percentage_attempts(id,assignment_id,athlete_id,attempt_number,landed,created_at) values($1,$2,$3,1,true,'2026-09-02T03:00:00Z')", [id(221), id(22), rider]);
  await db.query('update percentage_attempts set landed=false where id=$1', [id(221)]);
  assert.equal((await activeFor(22)).length, 0, 'Correcting a restored percentage attempt removes its landing');
  await db.exec(migration);
  assert.equal((await activeFor(22)).length, 0, 'Archive recovery must not revive a percentage result corrected to missed');
  assert.equal((await forAssignment(22))[0].evidence_type, 'revoked');
  await db.query('update percentage_attempts set landed=true where id=$1', [id(221)]);
  assert.equal((await activeFor(22)).length, 1, 'A new live percentage landing may restore a revoked attempt');
  await db.query('delete from percentage_attempts where id=$1', [id(221)]);
  await db.exec(migration);
  assert.equal((await activeFor(22)).length, 0, 'Archive recovery must not restore an explicitly cleared percentage attempt');
  await db.query("insert into percentage_attempts(id,assignment_id,athlete_id,attempt_number,landed,created_at) values($1,$2,$3,1,true,'2026-09-02T03:00:00Z')", [id(221), id(22), rider]);
  assert.equal((await activeFor(22)).length, 1, 'Re-recording a cleared attempt is a new live landing');
  await db.query('delete from weekly_trick_assignments where id=$1', [id(22)]);
  assert.equal((await activeFor(22)).length, 1, 'Cascading sheet replacement still retains restored percentage evidence');
  const history = await rows();
  const rpc = async () => (await db.query('select * from get_tricktionary_landing_history($1)', [rider])).rows;
  await db.exec('set role authenticated');
  for (const uid of [rider, coach, parent]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
    assert.equal((await rpc()).length, history.length, 'Rider and linked coach/parent can read the rider history');
  }
  for (const uid of [stranger, otherCoach, otherParent]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
    assert.equal((await rpc()).length, 0, 'Unrelated riders, coaches and parents cannot read history');
    assert.equal((await rows()).length, 0, 'Direct table reads respect the same privacy policy');
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [rider]);
  await assert.rejects(() => db.query('delete from tricktionary_landing_history'), /permission denied/, 'Riders cannot erase history directly');
  await assert.rejects(() => db.query("update tricktionary_landing_history set trick_name='Forged trick'"), /permission denied/, 'Riders cannot forge history directly');
  assert.equal((await db.query("select has_table_privilege('authenticated','public.tricktionary_landing_history','INSERT') allowed")).rows[0].allowed, false);
  assert.equal((await db.query("select has_function_privilege('anon','public.get_tricktionary_landing_history(uuid)','EXECUTE') allowed")).rows[0].allowed, false);
  await db.exec('reset role');
  for (const signature of [
    'private.capture_tricktionary_progress(jsonb,jsonb,text)',
    'private.capture_tricktionary_percentage(jsonb,jsonb,text)',
    'private.sync_tricktionary_progress_history()',
    'private.sync_tricktionary_percentage_history()',
    'private.preserve_tricktionary_assignment_history()'
  ]) {
    assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", ['authenticated', signature])).rows[0].allowed, false, 'Capture functions are not user-callable');
    assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", ['anon', signature])).rows[0].allowed, false, 'Capture functions are not public');
  }
  await db.exec('reset role; set role anon');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(() => rpc(), /permission denied/, 'Anonymous users cannot call the history RPC');
  await assert.rejects(() => rows(), /permission denied/, 'Anonymous users cannot read the history table');
  await db.exec('reset role');
  assert.deepEqual((await db.query('select points from assignment_point_awards')).rows, [{ points: 17 }]);
  assert.deepEqual((await db.query('select * from xp_ledger order by id')).rows, originalXp);
  assert.deepEqual((await db.query('select total_points from training_sessions')).rows, [{ total_points: 29 }]);
  await db.close();
  console.log('PASS: all completed categories, percentage results, backup/XP recovery, idempotency, daily rollover/unticks/reticks, correction versus sheet replacement, linked-only reads, and no scoring or XP writes.');
})().catch(error => { console.error(error); process.exit(1); });
