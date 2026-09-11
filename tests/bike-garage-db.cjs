const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');

// This fixture uses genuine non-owner database roles and the migration's RLS,
// column privileges and RPC bodies. No Supabase or production data is accessed.
(async () => {
  const db = new PGlite();
  const rider = '00000000-0000-0000-0000-000000000001';
  const otherRider = '00000000-0000-0000-0000-000000000002';
  const coach = '00000000-0000-0000-0000-000000000003';
  const missingProfile = '00000000-0000-0000-0000-000000000004';
  const configuration = {
    version: 1,
    colors: Object.fromEntries(['frame', 'fork', 'bars', 'grips', 'rims', 'hubs', 'seat', 'pedals', 'cranks', 'sprocket'].map((key, n) => [key, n % 2 ? '#abcdef' : '#A1B2C3'])),
    barStyle: 'two-piece', tyreStyle: 'black', seatStyle: 'slim', pegs: 'none', decal: 'jkcrew'
  };
  await db.exec(`
    create schema auth; create schema private;
    create role anon; create role authenticated;
    grant usage on schema public, auth to anon, authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.profiles(id uuid primary key, role text, points integer default 19);
    insert into public.profiles(id, role) values ('${rider}','athlete'), ('${otherRider}','athlete'), ('${coach}','coach');
    create table public.xp_ledger(id integer primary key, xp integer);
    create table public.assignment_point_awards(id integer primary key, points integer);
    insert into public.xp_ledger values(1, 23);
    insert into public.assignment_point_awards values(1, 29);
    create function private.reject_existing_write() returns trigger language plpgsql as $$
      begin raise exception 'Bike Garage must not write existing table %', tg_table_name; end;
    $$;
    create trigger existing_profile_guard before insert or update or delete on public.profiles
      for each statement execute function private.reject_existing_write();
    create trigger existing_xp_guard before insert or update or delete on public.xp_ledger
      for each statement execute function private.reject_existing_write();
    create trigger existing_points_guard before insert or update or delete on public.assignment_point_awards
      for each statement execute function private.reject_existing_write();
    -- Reproduce older Supabase automatic grants so the migration must revoke
    -- broad privileges before applying its explicit column-level grants.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges grant execute on functions to public, anon, authenticated;
  `);
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260911102828_add_private_bike_garage.sql'), 'utf8');
  await db.exec(sql);
  let assertions = 0;
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
  const ok = (value, message) => { assert(value, message); assertions++; };
  const denied = async (promise, code, message) => {
    await assert.rejects(promise, error => error.code === code, message); assertions++;
  };
  const as = async (user, role = 'authenticated') => {
    await db.exec(`reset role; set role ${role};`);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']);
  };
  const save = async (slot, name, config = configuration, expected = 0) =>
    (await db.query('select public.save_bike_build($1,$2,$3::jsonb,$4) result', [slot, name, config === null ? null : JSON.stringify(config), expected])).rows[0].result;
  const remove = async (slot, expected) =>
    (await db.query('select public.delete_bike_build($1,$2) result', [slot, expected])).rows[0].result;
  const garage = async () => (await db.query('select public.get_bike_garage() result')).rows[0].result;

  const metadata = (await db.query(`
    select p.proname, p.prosecdef, p.provolatile,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_bike_garage','save_bike_build','delete_bike_build')
  `)).rows;
  equal(metadata.length, 3, 'Only the three intended public garage RPCs are installed');
  for (const fn of metadata) {
    equal(fn.prosecdef, false, `${fn.proname} runs with caller permissions`);
    equal(fn.anon_execute, false, `${fn.proname} is not callable anonymously`);
    equal(fn.authenticated_execute, true, `${fn.proname} is callable after sign-in`);
  }
  equal(metadata.find(fn => fn.proname === 'get_bike_garage').provolatile, 's', 'Garage reader is STABLE');
  equal((await db.query("select relrowsecurity from pg_class where oid='public.bike_garage_builds'::regclass")).rows[0].relrowsecurity, true, 'RLS is enabled');
  equal((await db.query("select has_table_privilege('anon','public.bike_garage_builds','SELECT') permitted")).rows[0].permitted, false, 'Anonymous table access is revoked');

  await as(null, 'anon');
  await denied(garage(), '42501', 'Anonymous garage reads are denied');
  await denied(save(1, 'Anonymous'), '42501', 'Anonymous writes are denied');
  await denied(remove(1, 1), '42501', 'Anonymous removal is denied');
  await denied(db.query('select * from public.bike_garage_builds'), '42501', 'Anonymous direct table reads are denied');
  await as(null);
  await denied(garage(), '42501', 'Authenticated role without a user ID cannot read a garage');
  await denied(save(1, 'Missing identity'), '42501', 'An empty identity cannot create a build');
  await denied(remove(1, 1), '42501', 'An empty identity cannot remove a build');

  await as(rider);
  equal(await garage(), { builds: [] }, 'A new rider has an empty garage');
  const first = await save(1, '  Qualifying bike  ');
  equal(Object.keys(first).sort(), ['configuration', 'name', 'revision', 'slot', 'updated_at'], 'RPC output contains the documented build fields only');
  equal(first.name, 'Qualifying bike', 'Names are trimmed before saving');
  equal(first.revision, 1, 'A new slot starts at revision one');
  equal(first.configuration, configuration, 'Every cosmetic choice is stored unchanged');
  ok(Number.isFinite(Date.parse(first.updated_at)), 'Saved metadata contains a timestamp');
  const originalCreatedAt = (await db.query('select created_at from public.bike_garage_builds where slot=1')).rows[0].created_at;
  await denied(save(1, 'Accidental overwrite'), '40001', 'A second expected-zero create cannot overwrite an existing build');
  equal((await garage()).builds[0], first, 'Failed create leaves the saved build and revision unchanged');
  const different = { ...configuration, barStyle: 'four-piece', tyreStyle: 'tan-wall', seatStyle: 'padded', pegs: 'rear', decal: 'lightning' };
  const second = await save(1, 'Finals bike', different, first.revision);
  equal(second.revision, first.revision + 1, 'Editing increments the protected revision');
  equal(second.configuration, different, 'Updated configuration round-trips');
  equal((await db.query('select created_at from public.bike_garage_builds where slot=1')).rows[0].created_at, originalCreatedAt, 'Editing preserves creation time');
  await denied(save(1, 'Old device', configuration, first.revision), '40001', 'An old device cannot overwrite a newer save');
  await denied(remove(1, first.revision), '40001', 'An old device cannot remove a newer save');
  await denied(save(2, 'Missing current row', configuration, 1), '40001', 'A positive revision cannot create a missing row');
  const thirdStyle = { ...configuration, tyreStyle: 'white-wall', pegs: 'both', decal: 'none' };
  await save(3, 'Third slot', thirdStyle);
  await save(2, '🚲'.repeat(40));
  equal((await garage()).builds.map(build => build.slot), [1, 2, 3], 'All three slots are returned in slot order');
  await denied(save(4, 'Fourth slot'), '22023', 'No fourth slot can be created');
  // Resetting the role/identity models a fresh signed-in visit with no local state.
  await as(otherRider); await as(rider);
  equal((await garage()).builds[0], second, 'A separate visit sees the authoritative saved build');

  const beforeInvalid = await garage();
  for (const [slot, name, config, revision, label] of [
    [0, 'Bad slot', configuration, 0, 'zero slot'], [null, 'Bad slot', configuration, 0, 'missing slot'],
    [2, '', configuration, 1, 'empty name'], [2, '   ', configuration, 1, 'blank name'],
    [2, null, configuration, 1, 'missing name'], [2, 'x'.repeat(41), configuration, 1, 'long name'],
    [2, 'Bad revision', configuration, -1, 'negative revision'], [2, 'Bad revision', configuration, null, 'missing revision'],
    ...[
      null, [], 'bike', {}, { ...configuration, version: '1' }, { ...configuration, version: 2 },
      { ...configuration, surprise: true }, { ...configuration, owner_id: otherRider },
      { ...configuration, colors: null }, { ...configuration, colors: [] },
      { ...configuration, colors: { ...configuration.colors, frame: '#12345' } },
      { ...configuration, colors: { ...configuration.colors, fork: 'red' } },
      { ...configuration, colors: { ...configuration.colors, bars: 123456 } },
      { ...configuration, colors: { ...configuration.colors, frame: '#aabbccdd' } },
      { ...configuration, colors: { ...configuration.colors, chain: '#123456' } },
      { ...configuration, colors: Object.fromEntries(Object.entries(configuration.colors).filter(([key]) => key !== 'hubs')) },
      { ...configuration, barStyle: 'six-piece' }, { ...configuration, tyreStyle: 'racing' },
      { ...configuration, seatStyle: true }, { ...configuration, pegs: 4 },
      { ...configuration, decal: null }, { ...configuration, extra: 'x'.repeat(8193) },
      Object.fromEntries(Object.entries(configuration).filter(([key]) => key !== 'seatStyle')),
    ].map((config, n) => [2, 'Invalid configuration', config, 1, `invalid configuration ${n}`])
  ]) await denied(save(slot, name, config, revision), '22023', label);
  for (const [slot, revision] of [[0, 1], [4, 1], [null, 1], [1, 0], [1, -1], [1, null]]) {
    await denied(remove(slot, revision), '22023', 'Removal validates slot and expected revision');
  }
  equal(await garage(), beforeInvalid, 'Validation failures do not change any saved builds');

  // Clients may use invoker table privileges, but cannot forge protected metadata.
  for (const change of ['revision=999', `owner_id='${otherRider}'`, 'slot=2', "created_at='2000-01-01'", "updated_at='2000-01-01'"]) {
    await denied(db.query(`update public.bike_garage_builds set ${change} where slot=1`), '42501', 'System columns cannot be changed directly');
  }
  await denied(db.query('delete from public.bike_garage_builds where slot=1'), '42501', 'Direct deletion cannot discard a slot revision');
  await denied(db.query('insert into public.bike_garage_builds(owner_id,slot,name,configuration) values($1,1,$2,$3)', [otherRider, 'Other owner', JSON.stringify(configuration)]), '42501', 'Explicit owner IDs cannot be inserted');
  await denied(db.query("update public.bike_garage_builds set configuration='{}'::jsonb where slot=1"), '23514', 'Table constraints also reject invalid direct configuration updates');
  await denied(db.query('update public.bike_garage_builds set name=null where slot=1'), '23514', 'Only complete removal can create an empty slot');
  await denied(db.query("update public.bike_garage_builds set name='   ' where slot=1"), '23514', 'Direct table writes enforce the name constraint');
  equal(await garage(), beforeInvalid, 'Denied direct writes leave the garage untouched');

  await as(otherRider);
  equal(await garage(), { builds: [] }, 'Another rider cannot read the first garage');
  equal((await db.query('select * from public.bike_garage_builds where owner_id=$1', [rider])).rows, [], 'RLS hides the other rider even with an explicit filter');
  equal((await db.query('update public.bike_garage_builds set name=$1 where owner_id=$2 returning slot', ['Stolen', rider])).rows, [], 'RLS excludes cross-owner updates');
  await denied(save(1, 'Stale foreign build', configuration, second.revision), '40001', 'Foreign revisions never address someone else’s build');
  await denied(remove(1, second.revision), '40001', 'A user cannot remove someone else’s same-number slot');
  const otherBuild = await save(1, 'Other rider bike');
  equal(otherBuild.revision, 1, 'A second owner has an independent three-slot garage');
  await as(coach);
  equal(await garage(), { builds: [] }, 'Coaches do not automatically see rider garages');
  equal((await db.query('select * from public.bike_garage_builds')).rows, [], 'A coach database role still sees only their own rows');
  await save(1, 'Coach bike');
  await as(missingProfile);
  await denied(save(1, 'No profile'), '23503', 'Build ownership must reference an existing profile');

  await as(rider);
  equal(await remove(1, second.revision), { deleted: true }, 'Removal reports success only after changing the expected build');
  equal((await garage()).builds.map(build => build.slot), [2, 3], 'Removed builds disappear from the reader');
  const tombstone = (await db.query('select name,configuration,revision from public.bike_garage_builds where slot=1')).rows[0];
  equal(tombstone, { name: null, configuration: null, revision: second.revision + 1 }, 'Removal clears the content and preserves a revision tombstone');
  await denied(remove(1, second.revision), '40001', 'Repeated removal does not report a second success');
  await denied(save(1, 'Stale resurrection', configuration, tombstone.revision), '40001', 'A removed row cannot be revived as an ordinary update');
  const recreated = await save(1, 'New bike in old slot');
  equal(recreated.revision, tombstone.revision + 1, 'Recreating a removed slot does not recycle an old revision');
  await denied(save(1, 'Old pre-removal device', configuration, second.revision), '40001', 'Delete/recreate cannot allow a stale overwrite');
  await denied(remove(1, second.revision), '40001', 'Delete/recreate cannot allow a stale removal');
  equal((await garage()).builds[0], recreated, 'Stale pre-removal operations do not change the new bike');
  const direct = (await db.query("update public.bike_garage_builds set name='Direct own edit' where slot=1 returning revision,created_at")).rows[0];
  equal(direct.revision, recreated.revision + 1, 'Permitted direct own edits still increment the protected revision');
  equal(direct.created_at, originalCreatedAt, 'Recreation and direct edits preserve slot creation metadata');
  await denied(save(1, 'Old RPC version', configuration, recreated.revision), '40001', 'Direct edits cannot leave a stale RPC revision valid');

  await db.exec('reset role');
  equal((await db.query('select id,points from public.profiles order by id')).rows, [rider, otherRider, coach].map(id => ({ id, points: 19 })), 'Existing profiles and scores are unchanged');
  equal((await db.query('select * from public.xp_ledger')).rows, [{ id: 1, xp: 23 }], 'Garage changes award no XP');
  equal((await db.query('select * from public.assignment_point_awards')).rows, [{ id: 1, points: 29 }], 'Garage changes award no points');
  equal((await db.query('select max(total)::integer maximum from (select count(*) total from public.bike_garage_builds group by owner_id) slots')).rows[0].maximum, 3, 'Even cleared slots cannot exceed three rows per owner');
  await db.exec('drop trigger existing_profile_guard on public.profiles');
  await db.query('delete from public.profiles where id=$1', [rider]);
  equal((await db.query('select * from public.bike_garage_builds where owner_id=$1', [rider])).rows, [], 'Deleting a profile also removes its builds and revision tombstones');
  equal((await db.query('select count(*)::integer total from public.bike_garage_builds')).rows[0].total, 2, 'Profile cleanup preserves every other owner’s garage');
  await db.close();
  console.log(`Bike Garage database regressions passed (${assertions} assertions; real RLS roles, CRUD, validation, ownership and revision conflicts).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
