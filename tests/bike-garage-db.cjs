const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
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
  const whiteConfiguration = {
    ...configuration,
    colors: Object.fromEntries(Object.keys(configuration.colors).map(key => [key, '#FFFFFF'])),
    tyreStyle: 'white', decal: 'none'
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

  const moduleContext = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../bike-config.js'), 'utf8'), moduleContext);
  const bikeConfig = moduleContext.JKCrewBikeConfig;
  const plain = value => JSON.parse(JSON.stringify(value));
  const normalized = value => plain(bikeConfig.normalize(value));
  const v2Default = normalized();
  equal(v2Default.version, 2, 'The shared configuration module emits version two');
  equal(Object.keys(v2Default.colors), [...Object.keys(configuration.colors), 'seatpost','stem','headset','spokes','nipples','pegs'], 'The shared module contains exactly the sixteen supported colour parts');
  equal(Array.from(bikeConfig.metalParts), ['frame','fork','bars','rims','hubs','cranks','sprocket','seatpost','stem','headset','pegs'], 'Only supported metal parts expose finishes');
  equal(Array.from(bikeConfig.finishOptions), ['gloss','matte','chrome','raw','jetfuel'], 'All five finish identifiers are stable');
  equal(Array.from(bikeConfig.seatDesignIds), ['solid', ...Array.from({length:50}, (_, n) => `design-${String(n + 1).padStart(2,'0')}`)], 'The seat design catalogue includes solid and exactly fifty designs');
  for (const part of Object.keys(configuration.colors)) equal(v2Default.colors[part], '#F1F4F8', 'Existing blank-bike parts remain neutral white');
  for (const part of ['seatpost','stem','headset','spokes','nipples','pegs']) equal(v2Default.colors[part], '#BCC7D6', 'New hardware defaults to chrome colour');
  for (const part of bikeConfig.metalParts) equal(v2Default.finishes[part], ['seatpost','stem','headset','pegs'].includes(part) ? 'chrome' : 'gloss', 'Metal finish defaults match the existing paint or new hardware');
  const legacyInput = { ...configuration, barStyle:'four-piece', tyreStyle:'tan-wall', seatStyle:'padded', pegs:'both', decal:'lightning' };
  const legacyBefore = plain(legacyInput), upgraded = normalized(legacyInput);
  equal(legacyInput, legacyBefore, 'Normalising a legacy bike does not mutate its source');
  for (const [part, value] of Object.entries(legacyInput.colors)) equal(upgraded.colors[part], value.toUpperCase(), 'Legacy colours survive the version upgrade');
  for (const key of ['barStyle','tyreStyle','seatStyle','pegs','decal']) equal(upgraded[key], legacyInput[key], 'Every existing style survives the version upgrade');
  equal(normalized(upgraded), upgraded, 'Version two normalisation is idempotent');
  for (const bad of [null, [], 'bike', 123, { colors:[], finishes:'chrome', seatDesign:'design-51', frameFadeColor:'url(secret)', extra:'private' }]) equal(normalized(bad), v2Default, 'Invalid or unknown fields use safe defaults and are stripped');
  equal(normalized(Object.create({ colors:{frame:'#123456'}, pegs:'four', seatDesign:'design-50' })), v2Default, 'Inherited properties cannot inject cosmetic choices');
  const mutable = bikeConfig.normalize(); mutable.colors.frame='#123456'; mutable.finishes.frame='matte';
  equal(normalized(), v2Default, 'A caller can edit its normalised copy without altering defaults');
  ok(Object.isFrozen(bikeConfig) && Object.isFrozen(bikeConfig.defaults) && Object.isFrozen(bikeConfig.defaults.colors) && Object.isFrozen(bikeConfig.defaults.finishes), 'Published defaults are protected from accidental mutation');

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

  // Apply the additive migration over real saved builds in all three old styles.
  // Its only definition change is the extra enum value; rows and ACLs stay intact.
  await denied(save(3, 'White tyres before upgrade', whiteConfiguration, 1), '22023', 'The original validator does not accidentally accept solid white tyres');
  const beforeWhiteMigration = await garage();
  const validatorMetadata = async () => (await db.query(`
    select pg_get_functiondef(oid) definition, proacl::text privileges, prosecdef, provolatile, proconfig
    from pg_proc where oid='private.bike_garage_configuration_is_valid(jsonb)'::regprocedure
  `)).rows[0];
  const originalValidator = await validatorMetadata();
  const whiteSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260911111023_allow_solid_white_bike_tyres.sql'), 'utf8');
  await db.exec('reset role');
  await db.exec(whiteSql);
  await as(rider);
  const whiteValidator = await validatorMetadata();
  equal({ ...whiteValidator, definition: whiteValidator.definition.replace("('black','tan-wall','white-wall','white')", "('black','tan-wall','white-wall')") }, originalValidator, 'The additive migration preserves all validation, invoker security and privileges except the new tyre enum value');
  equal(await garage(), beforeWhiteMigration, 'The migration leaves saved black, tan-wall and white-wall builds unchanged');
  const whiteUpdate = await save(3, 'Solid white bike', whiteConfiguration, 1);
  equal(whiteUpdate.configuration, whiteConfiguration, 'Solid white tyres and white component colours round-trip through an update');
  equal(whiteUpdate.revision, 2, 'A white-tyre update obeys normal revision checks');
  equal((await garage()).builds.find(build => build.slot === 3), whiteUpdate, 'Another garage read sees the complete solid white configuration');
  await denied(save(3, 'Stale white update', whiteConfiguration, 1), '40001', 'Solid white builds preserve stale-write protection');
  const oldStyleUpdate = await save(3, 'White-wall tyres', thirdStyle, whiteUpdate.revision);
  equal(oldStyleUpdate.configuration.tyreStyle, 'white-wall', 'A solid white build can still change back to an existing tyre style');

  const validationResults = async values => (await db.query(`
    select private.bike_garage_configuration_is_valid(value) valid
    from jsonb_array_elements($1::jsonb) with ordinality order by ordinality
  `, [JSON.stringify(values)])).rows.map(row => row.valid);
  const legacyCases = [];
  for (const barStyle of ['two-piece','four-piece']) for (const tyreStyle of ['black','tan-wall','white-wall','white'])
    for (const seatStyle of ['slim','padded']) for (const pegs of ['none','rear','both']) for (const decal of ['jkcrew','lightning','none'])
      legacyCases.push({...configuration,barStyle,tyreStyle,seatStyle,pegs,decal});
  legacyCases.push(null, {}, {...configuration, pegs:'four'}, {...configuration, framePaint:'solid'}, {...configuration, colors:{...configuration.colors, stem:'#123456'}}, {...configuration, version:'1'});
  const legacyValidation = await validationResults(legacyCases);
  const beforePartsMigration = await garage();
  await denied(save(3, 'Version two before upgrade', v2Default, oldStyleUpdate.revision), '22023', 'The old validator requires the additive migration before accepting new parts');
  const partsSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260911122927_support_bike_garage_parts_v2.sql'), 'utf8');
  await db.exec('reset role'); await db.exec(partsSql); await as(rider);
  const {definition: priorDefinition, ...priorAccess} = whiteValidator;
  const {definition: partsDefinition, ...partsAccess} = await validatorMetadata();
  equal(partsAccess, priorAccess, 'Adding parts preserves validator privileges, invoker security and search path');
  equal(await garage(), beforePartsMigration, 'Adding parts does not rewrite saved bikes, timestamps or revisions');
  equal(await validationResults(legacyCases), legacyValidation, 'Every old style combination and legacy rejection remains unchanged');
  equal(await validationResults([v2Default, upgraded]), [true,true], 'Module defaults and upgraded v1 bikes match the database v2 schema');

  const fullV2 = normalized({
    ...v2Default, pegs:'four', framePaint:'fade', frameFadeColor:'#428CFF', pedalMaterial:'metal', brakeStyle:'dual',
    spokeStyle:'rainbow', stemStyle:'front-load', seatDesign:'design-50',
    colors:{...v2Default.colors, seatpost:'#123456',stem:'#ABCDEF',headset:'#345678',spokes:'#456789',nipples:'#567890',pegs:'#678901'},
    finishes:Object.fromEntries(bikeConfig.metalParts.map((part, index) => [part, bikeConfig.finishOptions[index % bikeConfig.finishOptions.length]]))
  });
  equal(normalized(fullV2), fullV2, 'Every new option survives client normalisation');
  const finishCases = bikeConfig.metalParts.flatMap(part => bikeConfig.finishOptions.map(finish => ({...fullV2,finishes:{...fullV2.finishes,[part]:finish}})));
  const designCases = bikeConfig.seatDesignIds.map(seatDesign => ({...fullV2,seatDesign}));
  equal(await validationResults([...finishCases,...designCases]), Array(finishCases.length + designCases.length).fill(true), 'Every finish on every metal part and all fifty seat designs are accepted');
  const v2Saved = await save(3, 'Expanded parts bike', fullV2, oldStyleUpdate.revision);
  equal(v2Saved.configuration, fullV2, 'A v2 update round-trips all parts, finishes and options');
  equal(v2Saved.revision, oldStyleUpdate.revision + 1, 'New parts use the existing revision contract');
  equal((await garage()).builds.find(build => build.slot===3), v2Saved, 'Saved v2 details are returned intact');
  await denied(save(3, 'Stale expanded bike', fullV2, oldStyleUpdate.revision), '40001', 'Expanded builds retain stale-write protection');
  const invalidV2 = [
    {...fullV2, version:3}, {...fullV2, version:'2'}, {...fullV2, owner_id:otherRider}, {...fullV2, extra:'x'.repeat(8193)},
    {...fullV2, colors:null}, {...fullV2, colors:[]}, {...fullV2, colors:{...fullV2.colors,chain:'#123456'}},
    {...fullV2, finishes:null}, {...fullV2, finishes:[]}, {...fullV2, finishes:'chrome'}, {...fullV2, finishes:{...fullV2.finishes,seat:'chrome'}},
    {...fullV2, framePaint:'rainbow'}, {...fullV2, frameFadeColor:'#12345'}, {...fullV2, frameFadeColor:123456},
    {...fullV2, pedalMaterial:'carbon'}, {...fullV2, brakeStyle:true}, {...fullV2, spokeStyle:'other'}, {...fullV2, stemStyle:'side-load'},
    ...['design-00','design-51','design-1','design-050','DESIGN-01','design-01<script>',null,50].map(seatDesign=>({...fullV2,seatDesign})),
    ...Object.keys(fullV2).map(key=>Object.fromEntries(Object.entries(fullV2).filter(([name])=>name!==key))),
    ...Object.keys(fullV2.colors).map(part=>({...fullV2,colors:Object.fromEntries(Object.entries(fullV2.colors).filter(([name])=>name!==part))})),
    ...Object.keys(fullV2.colors).map(part=>({...fullV2,colors:{...fullV2.colors,[part]:'#NOTHEX'}})),
    ...bikeConfig.metalParts.map(part=>({...fullV2,finishes:Object.fromEntries(Object.entries(fullV2.finishes).filter(([name])=>name!==part))})),
    ...bikeConfig.metalParts.map(part=>({...fullV2,finishes:{...fullV2.finishes,[part]:'polished'}}))
  ];
  equal(await validationResults(invalidV2), Array(invalidV2.length).fill(false), 'V2 requires exact keys, every part and finish, valid values/types, bounded size and design IDs');
  for (const bad of invalidV2.slice(0,26)) await denied(save(3, 'Invalid new choice', bad, v2Saved.revision), '22023', 'RPC validation rejects malformed new choices');
  await denied(db.query('update public.bike_garage_builds set configuration=$1 where slot=3', [JSON.stringify({...fullV2,seatDesign:'design-51'})]), '23514', 'Direct table writes cannot bypass the new option constraints');
  equal((await garage()).builds.find(build=>build.slot===3), v2Saved, 'Invalid new options leave the saved v2 build unchanged');
  await as(otherRider);
  await denied(save(3, 'Foreign expanded bike', fullV2, v2Saved.revision), '40001', 'V2 fields do not bypass ownership');
  await as(rider);
  const beforePartsRerun = await garage();
  await db.exec('reset role'); await db.exec(partsSql); await as(rider);
  equal(await garage(), beforePartsRerun, 'Repeating the additive migration leaves v1 and v2 rows unchanged');
  // A rolled-back fixture verifies new-slot creation without changing the other
  // owner fixtures used by the existing access and profile-cleanup regressions.
  await as(coach); const coachBefore = await garage(); await db.exec('begin');
  const v2Created = await save(2, 'New expanded bike', fullV2);
  equal(v2Created.configuration, fullV2, 'A new v2 build round-trips through creation');
  equal(v2Created.revision, 1, 'A new v2 build uses revision one');
  equal((await garage()).builds.find(build=>build.slot===2), v2Created, 'The newly created v2 build is readable by its owner');
  await db.exec('rollback'); equal(await garage(), coachBefore, 'The isolated creation fixture leaves existing test owners untouched');
  await as(rider);

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
  const whiteCreate = await save(1, 'Coach bike', whiteConfiguration);
  equal(whiteCreate.configuration, whiteConfiguration, 'A brand-new solid white build round-trips through save');
  equal(whiteCreate.revision, 1, 'A new solid white build starts at revision one');
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
