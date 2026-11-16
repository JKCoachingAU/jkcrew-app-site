// Actual private resource loaders with synthetic accounts/transport only.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, label); checks++; };
const rejects = async (promise, pattern) => { await assert.rejects(promise, pattern); checks++; };
const state = { user: { id: id(1) }, profile: { role: 'coach', is_platform_owner: true }, sessionSetupVersion: 1, cache: {}, inFlight: new Map() };
const access = (actor = id(1)) => ({ approval_status: 'approved', team: { id: id(20), role: actor === id(1) ? 'head_coach' : 'assistant_coach', country_code: 'DE' }, coaches: [{ coach_id: id(1), role: 'head_coach' }, { coach_id: id(2), role: 'assistant_coach' }] });
const calls = [];
const notifications = [], renders = { student:0, parents:0 };
let rpcResult = access(), rpcHold = null, queryHold = null, failQuery = null;
const tables = {
  coach_venues: [{ id: 'own', coach_id: id(1), name: 'Own park' }, { id: 'team', coach_id: id(2), name: 'Team park' }, { id: 'foreign', coach_id: id(3), name: 'Other country team park' }],
  athlete_private_records: [{ athlete_id: id(10), coach_id: id(1), updated_at: '2026-10-01', medical_notes: 'older' }, { athlete_id: id(10), coach_id: id(2), updated_at: '2026-11-01', medical_notes: 'current' }],
  athlete_documents: [], injury_reports: [], attendance_records: [], run_plans: [],
  parent_athletes: [],
};
const context = vm.createContext({
  state, Date, Map, Set, Error, Number, String, Promise, Infinity,
  isCoachRole: role => ['coach', 'admin'].includes(role), withTimeout: promise => promise, RUN_SUMMARY_SELECT: 'id',
  notify:(message,tone)=>notifications.push({message,tone}),messageFrom:error=>error.message,
  renderStudentProfile:async()=>{renders.student++;},renderParents:async()=>{renders.parents++;},
  client: {
    async rpc(name) { calls.push({ rpc: name }); if (rpcHold) return rpcHold.promise; return { data: rpcResult }; },
    from(table) {
      const filters = [], order = []; let limit = Infinity, single = false, action = 'read', payload = null;
      const query = {
        select() { return this; }, in(key, values) { filters.push([key, [...values]]); return this; },
        eq(key, value) { filters.push([key, [value]]); return this; }, is() { return this; }, not() { return this; },
        order(key, options) { order.push([key, options]); return this; }, limit(value) { limit = value; return this; },
        maybeSingle() { single = true; return this; },
        delete() { action = 'delete'; return this; },
        insert(values) { action = 'insert'; payload = JSON.parse(JSON.stringify(values)); return this; },
        async then(resolve, reject) {
          try {
            calls.push({ table, filters, order, limit, single, action, payload });
            if (queryHold) await queryHold.promise;
            if (failQuery?.table === table && failQuery.action === action) return resolve({error:new Error(failQuery.message),data:null});
            let rows = [...(tables[table] || [])].filter(row => filters.every(([key, values]) => values.includes(row[key])));
            if (action === 'delete') tables[table] = tables[table].filter(row => !rows.includes(row));
            if (action === 'insert') { rows = payload.map((row,index)=>({id:`created-${index}`, ...row}));tables[table].push(...rows); }
            rows.sort((a, b) => { for (const [key, options] of order) { const n = String(a[key]).localeCompare(String(b[key])); if (n) return n * (options?.ascending === false ? -1 : 1); } return 0; });
            rows = rows.slice(0, limit);
            return resolve({ data: single ? rows[0] || null : rows });
          } catch (error) { return reject(error); }
        },
      };
      return query;
    },
  },
});
vm.runInContext(['cacheGet','cacheSet','cacheClear','getCoachTeamScopeIds','canManageCoachTeamRecord','getCoachVenues','getStudentPrivateData','canEditRun','saveCoachVenueNames','unlinkParentAccount','unlinkParentFromAdmin'].map(extract).join('\n'), context);
const reset = (actor = id(1)) => { state.user = { id: actor }; state.profile = { role: 'coach', is_platform_owner: actor === id(1) }; state.sessionSetupVersion++; state.cache = {}; state.inFlight.clear();state.selectedAthleteId=id(10);state.view='student';rpcResult = access(actor);calls.length=0;notifications.length=0;renders.student=0;renders.parents=0;failQuery=null; };
(async () => {
  eq(await context.getCoachTeamScopeIds(), [id(1), id(2)], 'Owner still fetches only own approved team metadata');
  eq(calls.filter(call => call.rpc).length, 1, 'Owner fast approval does not bypass team membership query');
  eq((await context.getCoachVenues()).map(row => row.id), ['own', 'team'], 'Head coach sees team colleagues’ parks and excludes foreign team');
  eq(calls.filter(call => call.rpc).length, 1, 'Private loaders share one validated metadata request');
  eq(context.canEditRun({ coach_id: id(2) }), true, 'Approved colleague’s run is manageable');
  eq(context.canEditRun({ coach_id: id(3) }), false, 'Platform owner cannot manage foreign coach run');
  const privateData = await context.getStudentPrivateData(id(10));
  eq(privateData.record.medical_notes, 'current', 'Shared private record chooses most recently updated staff record');
  const recordQuery = calls.find(call => call.table === 'athlete_private_records');
  eq(recordQuery.limit, 1, 'Multiple staff records cannot cause maybeSingle ambiguity');
  eq(recordQuery.order.map(row => row[0]), ['updated_at','coach_id'], 'Single record choice is deterministic');
  reset(id(2));
  eq((await context.getCoachVenues()).map(row => row.id), ['own', 'team'], 'Assistant sees the same approved team resources');
  eq(context.canEditRun({ coach_id: id(1) }), true, 'Assistant can manage head coach team run');
  eq(context.canEditRun({ coach_id: id(3) }), false, 'Assistant cannot manage a foreign team run');
  for (const bad of [
    { ...access(), approval_status: 'pending' }, { ...access(), approval_status: 'suspended' },
    { ...access(), coaches: [] }, { ...access(), team: null },
    { ...access(), coaches: [{ coach_id: id(2), role: 'head_coach' }] },
    { ...access(), team: { id: id(20), role: 'owner' } },
    { ...access(), coaches: [{ coach_id: id(1), role: 'country_admin' }] },
    { ...access(), coaches: [{ coach_id: 'malformed', role: 'coach' }] },
  ]) {
    reset(); rpcResult = bad;
    await rejects(context.getCoachVenues(), /team access|team membership/);
    eq(calls.some(call => call.table), false, 'Invalid/unapproved membership fails before resource queries');
  }
  reset(); state.profile.role = 'parent';
  await rejects(context.getCoachTeamScopeIds(), /Coach sign-in required/);
  eq(calls.length, 0, 'Parent cannot use coach membership scope');
  reset(); rpcHold = deferred();
  const old = context.getCoachTeamScopeIds(), failed = rejects(old, /account access changed/);
  const deduplicated = context.getCoachTeamScopeIds(); deduplicated.catch(() => {});
  eq(calls.filter(call => call.rpc).length, 1, 'Concurrent shared reads deduplicate metadata RPC');
  reset(id(2)); rpcHold.resolve({ data: access() }); rpcHold = null;
  await failed;
  eq(context.cacheGet('coach-team-scope'), null, 'Previous identity metadata cannot populate next account’s scope');
  reset(); await context.getCoachTeamScopeIds(); queryHold = deferred();
  const locations = context.getCoachVenues(), stale = rejects(locations, /account access changed/);
  await new Promise(resolve => setImmediate(resolve));
  reset(id(2)); queryHold.resolve(); queryHold = null; await stale;
  reset(); await context.getCoachTeamScopeIds(); state.sessionSetupVersion++;
  eq(context.canEditRun({ coach_id: id(2) }), false, 'Epoch change removes cached colleague authorization from run UI');
  const teamUi = fs.readFileSync(path.join(__dirname, '..', 'team-access.js'), 'utf8');
  assert(teamUi.includes("await config.onChanged(); return;")); checks++;
  assert(source.includes('onChanged: () => handleSession(state.session)')); checks++;

  const linkedParent={parent_id:id(21),athlete_id:id(10),coach_id:id(1)};
  const foreignLink={parent_id:id(22),athlete_id:id(11),coach_id:id(3)};
  reset(id(2));tables.parent_athletes=[{...linkedParent},{...foreignLink}];
  await context.unlinkParentAccount({currentTarget:{dataset:{unlinkParent:id(21)}}});
  eq(tables.parent_athletes,[foreignLink],'Assistant unlinks a head-created parent record and preserves the foreign team');
  eq(renders.student,1,'Confirmed parent deletion refreshes the current rider once');
  eq(notifications.at(-1).message,'Parent viewer unlinked.','Verified rider unlink reports success');
  const firstDelete=calls.find(call=>call.table==='parent_athletes'&&call.action==='delete');
  eq(firstDelete.filters.find(row=>row[0]==='coach_id')[1],[id(1),id(2)],'Parent delete uses validated approved team coach IDs');
  await context.unlinkParentAccount({currentTarget:{dataset:{unlinkParent:id(21)}}});
  eq(notifications.at(-1).tone,'error','Zero-row rider unlink reports an error');
  eq(renders.student,1,'Zero-row rider unlink cannot falsely refresh as success');
  reset(id(2));tables.parent_athletes=[{...linkedParent},{...foreignLink}];
  await context.unlinkParentFromAdmin({currentTarget:{dataset:{unlinkParentGlobal:id(21),unlinkAthleteGlobal:id(10)}}});
  eq(tables.parent_athletes,[foreignLink],'Parents screen assistant unlink removes head-created relationship');
  eq(renders.parents,1,'Confirmed parent admin unlink refreshes the parents page');
  await context.unlinkParentFromAdmin({currentTarget:{dataset:{unlinkParentGlobal:id(22),unlinkAthleteGlobal:id(11)}}});
  eq(tables.parent_athletes,[foreignLink],'A forged foreign relationship cannot be deleted');
  eq(notifications.at(-1).tone,'error','Foreign or vanished relationship never reports success');
  eq(renders.parents,1,'Zero-row admin unlink does not refresh as a successful deletion');
  reset(id(2));tables.parent_athletes=[{...linkedParent}];failQuery={table:'parent_athletes',action:'delete',message:'Delete denied'};
  await context.unlinkParentAccount({currentTarget:{dataset:{unlinkParent:id(21)}}});
  eq(notifications.at(-1),{message:'Delete denied',tone:'error'},'Database deletion error remains visible');
  eq(tables.parent_athletes,[linkedParent],'Failed unlink preserves the relationship');
  reset(id(2));rpcResult={...access(id(2)),approval_status:'pending'};
  await context.unlinkParentFromAdmin({currentTarget:{dataset:{unlinkParentGlobal:id(21),unlinkAthleteGlobal:id(10)}}});
  eq(calls.some(call=>call.action==='delete'),false,'Pending coach cannot issue parent deletion');
  reset(id(2));queryHold=deferred();const oldUnlink=context.unlinkParentAccount({currentTarget:{dataset:{unlinkParent:id(21)}}});
  await new Promise(resolve=>setImmediate(resolve));reset(id(1));queryHold.resolve();queryHold=null;await oldUnlink;
  eq(notifications.length,0,'An obsolete account’s unlink does not notify the current account');
  eq(renders.student,0,'An obsolete account’s unlink cannot repaint the current rider');

  reset(id(2));tables.coach_venues=[{id:'head-original',coach_id:id(1),name:'Team Park'},{id:'staff-copy',coach_id:id(2),name:' TEAM  PARK '},{id:'foreign-original',coach_id:id(3),name:'Foreign Park'}];
  const uniqueVenues=await context.getCoachVenues();
  eq(uniqueVenues.length,1,'Shared venue names are deduplicated ignoring whitespace and case');
  eq(['head-original','staff-copy'].includes(uniqueVenues[0].id),true,'Deduplication retains an existing location row ID');
  await context.saveCoachVenueNames([{name:'Team park'},{name:'New location'},{name:' New  location '}]);
  eq(tables.coach_venues.filter(row=>row.coach_id===id(2)).map(row=>row.name),['New location'],'Saving merged locations avoids copying a colleague venue or duplicate submitted names');
  eq(tables.coach_venues.some(row=>row.id==='head-original'),true,'Saving locations preserves the original colleague record');
  eq(tables.coach_venues.some(row=>row.id==='foreign-original'),true,'Saving locations preserves foreign team records');
  const venueDelete=calls.find(call=>call.table==='coach_venues'&&call.action==='delete');
  eq(venueDelete.filters,[['coach_id',[id(2)]]],'Location replacement deletes only actor-authored records');
  reset(id(2));const venuesBefore=JSON.parse(JSON.stringify(tables.coach_venues));
  failQuery={table:'coach_venues',action:'read',message:'Venue connection failed'};
  await rejects(context.saveCoachVenueNames([{name:'Unsaved park'}]),/Venue connection failed/);
  eq(calls.some(call=>call.action==='delete'||call.action==='insert'),false,'Failed prerequisite venue read prevents every mutation');
  eq(tables.coach_venues,venuesBefore,'Failed location preflight leaves all stored venues intact');
  console.log(`PASS: ${checks} shared coach client checks; approved same-team resources, owner/assistant scope, pending/malformed denial, latest shared records, stale account requests and membership cache reset.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
