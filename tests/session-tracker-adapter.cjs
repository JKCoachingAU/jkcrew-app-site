// Real app adapters with synthetic transport: no live sessions or rider data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (value, label) => { assert(value, label); checks++; };
const rejected = async (promise, pattern, label) => { await assert.rejects(promise, pattern, label); checks++; };
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const range = { from: '2026-11-01', to: '2026-11-08' };

function setup() {
  const qa = { active: true, queries: [], writes: [], holds: {}, pending: {}, failures: {}, state: { user: { id: 'coach' }, profile: { role: 'coach' } } };
  qa.rows = {
    coach_athletes: [{ athlete_id: 'rider-1' }, { athlete_id: 'rider-1' }],
    profiles: [{ id: 'rider-1', display_name: 'Test Rider' }],
    coach_venues: [{ id: 'v1', name: 'Park', sort_order: 0 }],
    coach_training_blocks: [{ id: 'block-1', name: 'Term 4', start_date: '2026-10-05', updated_at: '2026-11-04T01:00:00Z' }],
    coach_tracked_sessions: Array.from({ length: 31 }, (_, index) => ({ id: String(index), rider_ids: ['rider-1'] })),
  };
  const settle = (key, result) => {
    const value = qa.failures[key] ? { error: new Error(qa.failures[key]) } : { data: clone(result) };
    if (!qa.holds[key]) return Promise.resolve(value);
    return new Promise(resolve => { (qa.pending[key] ||= []).push(() => resolve(value)); });
  };
  const client = {
    from(table) {
      const calls = [];
      qa.queries.push({ table, calls });
      const query = { then(resolve, reject) { return settle(table, qa.rows[table]).then(resolve, reject); } };
      for (const method of ['select', 'eq', 'is', 'gte', 'lt', 'order', 'range', 'in', 'contains']) {
        query[method] = (...args) => { calls.push([method, ...args]); return query; };
      }
      return query;
    },
    rpc(name, params) {
      qa.writes.push({ name, params: clone(params) });
      return settle(name, name === 'add_coach_tracker_location'
        ? { id: 'v2', name: 'New Park', sort_order: 1 }
        : name === 'save_coach_training_block' ? { id: params.p_id, name: params.p_name, start_date: params.p_start_date, updated_at: '2026-11-04T02:00:00.123456Z' }
        : { id: params.p_id, updated_at: '2026-11-04T02:00:00.123456Z', archived_at: params.p_archived ? '2026-11-04T02:00:00Z' : null });
    },
  };
  const factory = new Function('state', 'client', 'withTimeout', 'isCoachRole', `${extract('createCoachSessionTrackerAdapter')}; return createCoachSessionTrackerAdapter;`)(
    qa.state, client, promise => promise, role => ['coach', 'admin'].includes(role));
  qa.adapter = factory({ userId: 'coach', isActive: () => qa.active });
  qa.count = table => qa.queries.filter(query => query.table === table).length;
  qa.release = key => qa.pending[key]?.shift()?.();
  return qa;
}

(async () => {
  const qa = setup();
  const first = await qa.adapter.load({ ...range, venue: 'Park', riderId: 'rider-1' });
  eq(first.sessions.length, 30, 'List returns one bounded page');
  eq(first.hasMore, true, 'Look-ahead row enables pagination');
  eq(first.roster, qa.rows.profiles, 'Rider dropdown uses minimal coach roster');
  eq(first.blocks, qa.rows.coach_training_blocks, 'Training blocks accompany existing context');
  const sessionQuery = qa.queries.find(query => query.table === 'coach_tracked_sessions');
  for (const expected of [
    ['eq', 'coach_id', 'coach'], ['is', 'archived_at', null], ['gte', 'session_date', range.from], ['lt', 'session_date', range.to],
    ['eq', 'venue', 'Park'], ['contains', 'rider_ids', ['rider-1']], ['range', 0, 30],
    ['order', 'session_date', { ascending: true }], ['order', 'start_time', { ascending: true, nullsFirst: false }], ['order', 'id', { ascending: true }],
  ]) ok(sessionQuery.calls.some(call => JSON.stringify(call) === JSON.stringify(expected)), `Scoped query: ${JSON.stringify(expected)}`);
  const profileQuery = qa.queries.find(query => query.table === 'profiles');
  ok(profileQuery.calls.some(call => call[0] === 'select' && call[1] === 'id,display_name'), 'Roster does not download avatars, media or progress');
  ok(profileQuery.calls.some(call => call[0] === 'in' && call[1] === 'id' && call[2].length === 1), 'Roster uses deduplicated linked IDs');
  ok(profileQuery.calls.some(call => call[0] === 'eq' && call[1] === 'role' && call[2] === 'athlete'), 'Roster excludes other account roles');
  for (const table of ['coach_athletes', 'coach_venues', 'coach_training_blocks']) {
    ok(qa.queries.find(query => query.table === table).calls.some(call => call[0] === 'eq' && call[1] === 'coach_id' && call[2] === 'coach'), `${table} owner filter`);
  }
  qa.rows.coach_tracked_sessions = [];
  const next = await qa.adapter.load({ ...range, offset: 30 });
  eq(next.hasMore, false, 'Empty page stops pagination');
  eq(qa.count('coach_athletes'), 1, 'Paging reuses roster');
  eq(qa.count('profiles'), 1, 'Paging reuses rider names');
  eq(qa.count('coach_venues'), 1, 'Paging reuses locations');
  eq(qa.count('coach_training_blocks'), 1, 'Paging reuses training blocks');
  ok(qa.queries.filter(query => query.table === 'coach_tracked_sessions').at(-1).calls.some(call => call[0] === 'range' && call[1] === 30 && call[2] === 60), 'Next page starts after shown rows');
  qa.rows.profiles.push({ id: 'rider-2', display_name: 'New Rider' });
  const refreshed = await qa.adapter.load({ ...range, refreshContext: true });
  eq(refreshed.roster.length, 2, 'Explicit Refresh fetches changed roster');
  eq(qa.count('coach_venues'), 2, 'Explicit Refresh fetches changed locations');

  const record = { id: 'stable-id', session_date: '2026-11-04', start_time: '16:00', venue: 'Park', rider_ids: ['rider-1'], updated_at: '2026-11-04T01:00:00.123456Z' };
  await qa.adapter.save(record); await qa.adapter.save(record);
  eq(qa.writes[0].name, 'save_coach_tracked_session_v3', 'New saves use the extended API without replacing old-client API');
  eq(qa.writes[0], qa.writes[1], 'Retry keeps same stable ID, payload and expected version');
  eq(qa.writes[0].params.p_expected_updated_at, record.updated_at, 'Timestamp precision is preserved');
  await qa.adapter.save({ ...record, updated_at: null, start_time: '' });
  eq(qa.writes.at(-1).params.p_start_time, null, 'Optional time remains null');
  eq(qa.writes.at(-1).params.p_expected_updated_at, null, 'New record has no existing version');
  eq(qa.writes.at(-1).params.p_session_kind, 'regular', 'Old records do not become additional sessions');
  eq(qa.writes.at(-1).params.p_session_completed, false, 'Past dates are not proof of attendance');
  eq(qa.writes.at(-1).params.p_park_fee_paid_by_coach, false, 'Planned entry is not a confirmed payment');
  eq(qa.writes.at(-1).params.p_extra_fee_cents, null, 'Unknown extra fee is not silently zero');
  eq(qa.writes.at(-1).params.p_invoice_date, null, 'No invented invoice date');
  eq(qa.writes.at(-1).params.p_invoice_status, 'expected', 'New records are not already invoiced');
  const costs = { ...record, session_kind: 'additional', session_completed: true, extra_fee_cents: 4500, park_fee_cents: 1250, park_fee_paid_by_coach: true, invoice_date: '2026-11-23', invoice_status: 'invoiced' };
  await qa.adapter.save(costs);
  for (const key of ['session_kind','session_completed','extra_fee_cents','park_fee_paid_by_coach','invoice_date','invoice_status']) {
    eq(qa.writes.at(-1).params['p_'+key], costs[key], 'Saved parent cost field: '+key);
    ok(sessionQuery.calls.some(call => call[0] === 'select' && call[1].split(',').includes(key)), 'Coach reads saved cost field: '+key);
  }
  await qa.adapter.save({ ...costs, extra_fee_cents: 0 });
  eq(qa.writes.at(-1).params.p_extra_fee_cents, 0, 'Explicit free extra session remains zero');
  await qa.adapter.save({ ...costs, extra_fee_cents: null });
  eq(qa.writes.at(-1).params.p_extra_fee_cents, null, 'TBC extra session retains unknown price');
  for (const bad of [{session_kind:'other'}, {extra_fee_cents:-1}, {extra_fee_cents:1.5}, {extra_fee_cents:1000001}, {extra_fee_cents:NaN}, {extra_fee_cents:Infinity}, {session_kind:'regular'}, {invoice_status:'unknown'}, {invoice_date:'tomorrow'}, {park_fee_cents:0}]) {
    const before = qa.writes.length;
    await rejected(qa.adapter.save({...costs,...bad}), /session type|extra-session price|additional sessions|billing status|invoice date|entry fee/, 'Invalid cost record rejected');
    eq(qa.writes.length,before,'Invalid cost does not reach server');
  }
  await qa.adapter.save({...costs,invoice_status:'paid'});
  eq(qa.writes.at(-1).params.p_invoice_status,'paid','Confirmed payment is distinct from an invoice');
  await rejected(qa.adapter.save({...costs,invoice_status:'paid',extra_fee_cents:null}),/price before marking it paid/,'Unknown extra price cannot be marked paid');
  const archived = await qa.adapter.archive(record, true);
  eq(qa.writes.at(-1).params.p_archived, true, 'Archive invokes archive RPC');
  await qa.adapter.archive(archived, false);
  eq(qa.writes.at(-1).params.p_expected_updated_at, archived.updated_at, 'Undo uses returned archive version');
  eq(qa.writes.at(-1).params.p_archived, false, 'Undo restores without deleting data');
  await qa.adapter.addLocation('New Park');
  await qa.adapter.addLocation('New Park');
  const withLocation = await qa.adapter.load(range);
  eq(withLocation.locations.length, 2, 'Returned locations are cached without duplicates');
  eq(qa.count('coach_venues'), 2, 'Location save does not refetch entire context');
  const writes = qa.writes.length;
  qa.active = false;
  await rejected(qa.adapter.save(record), /no longer active/, 'Navigation blocks late save');
  qa.active = true; qa.state.user.id = 'other';
  await rejected(qa.adapter.addLocation('No write'), /no longer active/, 'Account switch blocks late location creation');
  qa.state.user.id = 'coach'; qa.state.profile.role = 'athlete';
  await rejected(qa.adapter.archive(record, true), /no longer active/, 'Role changes block writes');
  eq(qa.writes.length, writes, 'Blocked actions never reach backend');
  qa.state.profile.role = 'coach';
  await rejected(qa.adapter.load({ from: range.to, to: range.from }), /valid session/, 'Invalid date range is rejected');
  await rejected(qa.adapter.load({ ...range, offset: -1 }), /Refresh/, 'Negative pagination is rejected');
  await rejected(qa.adapter.save({}), /Reopen/, 'Missing stable ID is rejected');
  await rejected(qa.adapter.archive({ id: 'x' }, true), /Refresh/, 'Archive needs a version');

  const retry = setup();
  retry.failures.coach_venues = 'Offline';
  await rejected(retry.adapter.load(range), /Offline/, 'Failed context load is recoverable');
  delete retry.failures.coach_venues;
  await retry.adapter.load(range);
  eq(retry.count('coach_venues'), 2, 'Retry does not cache failed context');
  retry.holds.save_coach_tracked_session_v3 = true;
  const staleSave = retry.adapter.save(record);
  retry.state.user.id = 'other'; retry.release('save_coach_tracked_session_v3');
  await rejected(staleSave, /no longer active/, 'Late mutation response is not exposed to another account');

  const race = setup();
  race.holds.profiles = true;
  const oldLoad = race.adapter.load(range);
  await tick();
  race.rows.profiles = [{ id: 'rider-2', display_name: 'Updated roster' }];
  const newLoad = race.adapter.load({ ...range, refreshContext: true });
  await tick();
  race.pending.profiles.pop()(); await newLoad;
  race.pending.profiles.shift()(); await oldLoad;
  eq((await race.adapter.load(range)).roster[0].display_name, 'Updated roster', 'Older context response cannot overwrite explicit refresh');

  const blocks = setup();
  blocks.rows.coach_tracked_sessions = Array.from({ length: 42 }, (_, index) => ({ id: `s${index}`, block_id: 'block-1', rider_ids: ['rider-1'], park_fee_cents: 1500, park_fee_basis: 'per_rider' }));
  const blockRows = await blocks.adapter.load({ ...range, blockId: 'block-1', venue: 'Ignored filter', riderId: 'rider-1' });
  eq(blockRows.sessions.length, 42, 'Complete block includes sessions beyond a 30-row page');
  eq(blockRows.hasMore, false, 'Complete block never displays a partial total');
  const blockQuery = blocks.queries.find(query => query.table === 'coach_tracked_sessions');
  ok(blockQuery.calls.some(call => call[0] === 'eq' && call[1] === 'block_id' && call[2] === 'block-1'), 'Block query is explicitly scoped');
  ok(!blockQuery.calls.some(call => ['gte', 'lt', 'contains'].includes(call[0]) || (call[0] === 'eq' && call[1] === 'venue')), 'Block totals include every saved session regardless of UI filters or month');
  ok(blockQuery.calls.some(call => call[0] === 'range' && call[1] === 0 && call[2] === 500), 'Block query is bounded with overflow detection');
  ok(blockQuery.calls.some(call => call[0] === 'select' && call[1].includes('park_fee_cents') && call[1].includes('block_id')), 'Sessions include stored integer fees and block membership');
  await blocks.adapter.save({ ...record, block_id: 'block-1', park_fee_cents: 1535, park_fee_basis: 'per_rider' });
  eq(blocks.writes.at(-1).params.p_park_fee_cents, 1535, 'Cents reach the database without rounding');
  eq(blocks.writes.at(-1).params.p_block_id, 'block-1', 'Session remains attached to selected block');
  for (const fee of [-1, 1.5, NaN, Infinity, 1000001]) await rejected(blocks.adapter.save({ ...record, park_fee_cents: fee }), /park fee/, 'Invalid fees do not reach transport');
  await rejected(blocks.adapter.save({ ...record, park_fee_basis: 'unknown' }), /fee basis/, 'Unknown fee basis is rejected');
  const savedBlock = await blocks.adapter.saveBlock({ id: 'block-2', name: 'Summer block', start_date: '2026-12-14' });
  eq(savedBlock.name, 'Summer block', 'New training block is persisted');
  eq(blocks.writes.at(-1).params.p_expected_updated_at, null, 'New block has no expected prior version');
  const withBlock = await blocks.adapter.load({ ...range, blockId: 'block-2' });
  eq(withBlock.blocks.map(block => block.id), ['block-2', 'block-1'], 'New block is cached in date order');
  eq(blocks.count('coach_training_blocks'), 1, 'Saving a block avoids unnecessary roster/context reloads');
  await blocks.adapter.saveBlock({ ...savedBlock, name: 'Renamed' });
  eq(blocks.writes.at(-1).params.p_expected_updated_at, savedBlock.updated_at, 'Block edit retains optimistic timestamp');
  await rejected(blocks.adapter.saveBlock({}), /Reopen/, 'Block requires stable retry ID');
  await rejected(blocks.adapter.load({ ...range, blockId: 'missing' }), /no longer available/, 'Unknown block cannot produce a misleading empty total');
  blocks.rows.coach_tracked_sessions = Array.from({ length: 501 }, (_, index) => ({ id: `s${index}` }));
  await rejected(blocks.adapter.load({ ...range, blockId: 'block-1' }), /complete total/, 'Oversized block fails explicitly instead of silently undercounting');
  blocks.active = false;
  const beforeBlockedWrite = blocks.writes.length;
  await rejected(blocks.adapter.saveBlock(savedBlock), /no longer active/, 'Closed page cannot mutate blocks');
  eq(blocks.writes.length, beforeBlockedWrite, 'Stale block saves never reach transport');
  const tooManyBlocks = setup();
  tooManyBlocks.rows.coach_training_blocks = Array.from({ length: 501 }, (_, index) => ({ id: `b${index}` }));
  await rejected(tooManyBlocks.adapter.load(range), /too many training blocks/, 'Block selector never silently truncates history');

  let mounted, destroyed = 0, navigated = '', readyResolved = false;
  const renderState = { view: 'sessionTracker', user: { id: 'coach' }, profile: { role: 'coach', country_code: 'DE' }, sessionSetupVersion: 1, sessionTrackerMount: { destroy() { destroyed++; } } };
  const view = { isConnected: true };
  let releaseReady;
  const ready = new Promise(resolve => { releaseReady = resolve; });
  const render = new Function('state', 'document', 'window', 'navigate', 'isCoachRole', 'dateForCountryCode', 'countryTimezones', 'createCoachSessionTrackerAdapter', `${extract('renderSessionTracker')}; return renderSessionTracker;`)(
    renderState, { querySelector: () => view }, { JKCSessionTracker: { mount(root, options) { mounted = { root, options }; return { ready, destroy() {}, hasUnsavedChanges() { return false; } }; } } },
    target => { navigated = target; }, role => ['coach', 'admin'].includes(role), code => code === 'DE' ? '2026-11-03' : '2026-11-04', { DE: 'Europe/Berlin' }, () => ({ load() {} }));
  const rendering = render().then(() => { readyResolved = true; });
  eq(destroyed, 1, 'Remount destroys previous tracker');
  eq(mounted.options.today, '2026-11-03', 'Initial date follows coach country');
  eq(mounted.options.timeZone, 'Europe/Berlin', 'Timezone follows coach country');
  eq(mounted.options.isActive(), true, 'Current mount is active');
  eq(readyResolved, false, 'Render awaits initial load');
  releaseReady(); await rendering;
  eq(readyResolved, true, 'Ready completes render');
  renderState.sessionSetupVersion++;
  eq(mounted.options.isActive(), false, 'Auth setup change invalidates callbacks');
  renderState.profile.role = 'parent'; await render();
  eq(navigated, 'home', 'Parents cannot enter coach tracker');
  ok(extract('navigate').includes('state.sessionTrackerMount?.destroy()'), 'Navigation destroys tracker');
  ok(extract('teardownRealtimeSync').includes('state.sessionTrackerMount?.destroy()'), 'Account cleanup destroys tracker');
  ok(extract('shouldDeferAppUpdate').includes('state.sessionTrackerMount?.hasUnsavedChanges()'), 'Automatic update preserves drafts');
  ok(extract('applyPendingAppUpdate').includes('state.sessionTrackerMount?.hasUnsavedChanges()'), 'Manual update preserves drafts');
  console.log(`Session Tracker adapter checks passed (${checks}).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
