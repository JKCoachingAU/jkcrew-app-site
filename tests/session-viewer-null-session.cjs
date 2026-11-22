// Actual Session Full+Light renderers with synthetic controls and reads. No network, live accounts or external baseline files.
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.resolve(__dirname, '..'), candidate=fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract=(source, name)=>{
  const i=source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(i>=0, name);
  const s=source.slice(i);
  return s.slice(0, s.indexOf('\n}')+2);
};
const gate=()=>{
  let resolve, reject;
  const promise=new Promise((a, b)=>{
    resolve=a;
    reject=b;
  });
  return{
    promise, resolve, reject
  };
};
let checks=0;
const eq=(a, b, label)=>{
  assert.deepEqual(a, b, label);
  checks++;
};
function fixture(source = candidate, { active = null, emptyVenue = false } = {}) {
  let clock=100000;
  const calls=[], grid={
    isConnected: true, innerHTML: ''
  }, view={
    innerHTML: ''
  };
  const state={
    user: {
      id: 'coach'
    }, profile: {
      role: 'coach'
    }, view: 'sessionViewer', sessionSetupVersion: 1, loadingOverlayToken: 1, sessionViewerDataVersion: 0, sessionViewerRenderVersion: 0,
    sessionViewerGroup: 'monday', sessionViewerVenue: emptyVenue?'': 'Park', sessionViewerSearch: '', sessionViewerOpenAthleteId: 'r1',
    sessionViewerActiveList: 'daily', sessionViewerRosterCache: [], sessionViewerActiveSessionCache: null, sessionViewerSetupOpen: false
  };
  const athlete={
    id: 'r1', country_code: 'AU', display_name: 'Rider', groupNames: ['monday']
  };
  const rows=[{
    id: 'daily', athlete_id: 'r1', category: 'daily', venue: 'Park', trick_name: 'Manual'
  }];
  const f={
    state, Promise, Map, Set, Date: class extends Date{
      static now(){
        return clock;
      }
    }, Number, String, Boolean, Error, document: {
      querySelector: selector=>selector==='.viewer-rider-grid'?grid: selector==='#view'?view: null
    }, console, setInterval: ()=>1, clearInterval: ()=>{
    }, withTimeout: p=>p, client: {
      rpc: async()=>({
        data: []
      })
    }, getSessionViewerRoster: async()=>[athlete], getActiveCoachGroupSession: async()=>{
      calls.push('active');
      return active;
    }, getCoachVenues: async()=>[], getCoachRoster: async()=>[athlete], getSessionViewerPlanData: async()=>{
      calls.push('plan');
      if(f.beforePlan)f.beforePlan();
      return{
        assignmentsByAthlete: new Map([['r1', rows]]), runsByAthlete: new Map(), runProgressByPlan: new Map()
      };
    }, isCoachRole: r=>r==='coach', navigate: ()=>{
    }, contestPrepGroupId: 'contest', assignmentsForVenue: (a, v)=>a.filter(r=>r.venue===v), dailyVenues: a=>[...new Set(a.map(r=>r.venue))],
    normalizeAssignmentProgress: (_a, p)=>p, coachGroupLabel: g=>g, groupLabelList: a=>a.join(','), escapeHtml: v=>String(v??''),
    venueLabel: v=>String(v||''), venueIdentityKey: v=>String(v||'').toLowerCase(), sessionViewerVenueOptions: ()=>'',
    sessionViewerGroupOptions: ()=>'', sessionViewerRiderCardHtml: entry=>`<article>${entry.athlete.id}:${entry.daily.length}</article>`,
    sessionViewerClockFaceHtml: ()=>'', sessionViewerSnapshotHtml: ()=>'', parkKingCardHtml: ()=>'', sessionGroupBattlesHtml: ()=>'',
    groupSessionElapsedSeconds: ()=>0, bindCoachBattleControls: ()=>{
    }, bindSessionViewerActions: ()=>{
    }, bindSessionViewerFastActions: ()=>{
    }, paintSessionViewerSnapshot: ()=>{
    }, updateGroupSessionTimerDom: ()=>{
    }, refreshParkKingCard: async()=>{
    }, cacheClear: ()=>{
    }
  };
  vm.createContext(f);
  const names=['renderSessionViewer', 'refreshSessionViewerLight', 'invalidateSessionViewerData', 'invalidateCachesForRealtime'];
  if(source.includes('function rememberSessionViewerVerifiedNullSession('))names.push('rememberSessionViewerVerifiedNullSession',
  'canReuseSessionViewerVerifiedNullSession');
  vm.runInContext(names.map(n=>extract(source, n)).join('\n'), f);
  return{
    f, state, calls, grid, view, advance: ms=>{
      clock+=ms;
    }, activeReads: ()=>calls.filter(c=>c==='active').length
  };
}
(async()=>{
  const next=fixture();
  await next.f.renderSessionViewer();
  const before=next.activeReads();
  for(let n=0; n<4; n++)await next.f.refreshSessionViewerLight({
    displayOnly: true
  });
  eq(next.activeReads()-before, 0, 'Verified no-active session adds zero live-session reads for four warm category displays');
  eq(next.grid.innerHTML, '<article>r1:1</article>', 'Warm rendering keeps the verified rider list');
  {
    const x=fixture();
    await x.f.refreshSessionViewerLight({
      displayOnly: true
    });
    eq(x.activeReads(), 1, 'Default null is unknown and must be verified');
  }
  {
    const x=fixture();
    await x.f.renderSessionViewer();
    const at=x.state.sessionViewerVerifiedNullSession.checkedAt;
    x.advance(6000);
    await x.f.refreshSessionViewerLight({
      displayOnly: true
    });
    x.advance(5000);
    await x.f.refreshSessionViewerLight({
      displayOnly: true
    });
    eq(x.state.sessionViewerVerifiedNullSession.checkedAt, at, 'Local category clicks never extend the verification TTL');
    eq(x.activeReads(), 1, 'Original null receipt remains usable strictly before12s');
    x.advance(1000);
    await x.f.refreshSessionViewerLight({
      displayOnly: true
    });
    eq(x.activeReads(), 2, 'At12s the next category display uses the existing fresh reader');
  }
  for(const context of ['owner', 'setup', 'navigation', 'group', 'venue', 'data']){
    const x=fixture();
    await x.f.renderSessionViewer();
    if(context==='owner')x.state.user={
      id: 'other-coach'
    };
    if(context==='setup')x.state.sessionSetupVersion++;
    if(context==='navigation')x.state.loadingOverlayToken++;
    if(context==='group')x.state.sessionViewerGroup='other';
    if(context==='venue')x.state.sessionViewerVenue='Other Park';
    if(context==='data')x.f.invalidateSessionViewerData();
    await x.f.refreshSessionViewerLight({
      displayOnly: true
    });
    eq(x.activeReads(), 2, context+': changed context cannot reuse verified null');
  }
  for(const options of [{
  }, {
    force: true, displayOnly: true
  }, {
    forceParkKing: true, displayOnly: true
  }]){
    const x=fixture();
    await x.f.renderSessionViewer();
    await x.f.refreshSessionViewerLight(options);
    eq(x.activeReads(), 2, 'Refresh/realtime/force paths remain fresh rather than becoming display-only');
  }
  {
    const active={
      id: 'group', group_name: 'monday', venue: 'Park', status: 'running', coach_group_session_participants: [{
        athlete_id: 'r1', training_session_id: 't1'
      }]
    };
    for(const source of [candidate]){
      const x=fixture(source, {
        active
      });
      await x.f.renderSessionViewer();
      for(let n=0; n<4; n++)await x.f.refreshSessionViewerLight({
        displayOnly: true
      });
      eq(x.activeReads(), 1, 'Known active session caching remains unchanged');
      eq(x.state.sessionViewerActiveSessionCache, active, 'Known active session/clock metadata stays intact');
    }
  }
  {
    const x=fixture();
    await x.f.renderSessionViewer();
    const remote={
      id: 'group', status: 'running', coach_group_session_participants: [{
        athlete_id: 'r1', daily_finish_seconds: 77, daily_result: {
          all_completed: false, completion_points: 0
        }
      }]
    };
    x.f.getActiveCoachGroupSession=async()=>{
      x.calls.push('active');
      return remote;
    };
    x.f.invalidateCachesForRealtime('coach_group_session_participants');
    eq(x.state.sessionViewerVerifiedNullSession, null, 'Remote participant event clears verified-null metadata');
    await x.f.refreshSessionViewerLight({
      displayOnly: true
    });
    eq(x.activeReads(), 2, 'Remote participant invalidation forces the existing fresh session read');
    eq(x.state.sessionViewerActiveSessionCache.coach_group_session_participants[0].daily_result.all_completed, false,
    'Authoritative remote partial result is preserved');
  }
  {
    const x=fixture();
    x.f.beforePlan=()=>x.advance(15000);
    await x.f.renderSessionViewer();
    eq(x.state.sessionViewerVerifiedNullSession.checkedAt, 100000, 'Full render remembers actual live-read time, not later plan-paint time');
    x.f.beforePlan=null;
    await x.f.refreshSessionViewerLight({
      displayOnly: true
    });
    eq(x.activeReads(), 2, 'Slow unrelated Full reads cannot silently extend null freshness');
  }
  for(const changed of ['owner', 'setup', 'navigation', 'data']){
    const x=fixture();
    x.f.beforePlan=()=>{
      if(changed==='owner')x.state.user={
        id: 'other'
      };
      if(changed==='setup')x.state.sessionSetupVersion++;
      if(changed==='navigation')x.state.loadingOverlayToken++;
      if(changed==='data')x.state.sessionViewerDataVersion++;
    };
    await x.f.renderSessionViewer();
    eq(Boolean(x.state.sessionViewerVerifiedNullSession), false, changed+': late read cannot seed another scope\'s null receipt');
  }
  {
    const x=fixture(candidate, {
      emptyVenue: true
    });
    await x.f.renderSessionViewer();
    eq(x.state.sessionViewerVerifiedNullSession.venue, 'Park', 'Automatic initial venue is recorded in the final display context');
    await x.f.refreshSessionViewerLight({
      displayOnly: true
    });
    eq(x.activeReads(), 1, 'First warm category after automatic venue selection reuses its verified null');
  }
  {
    const x=fixture();
    x.f.getActiveCoachGroupSession=async()=>{
      throw Error('Offline');
    };
    await assert.rejects(x.f.renderSessionViewer(), /Offline/);
    checks++;
    eq(Boolean(x.state.sessionViewerVerifiedNullSession), false, 'A failed read never becomes verified null');
  }
  for(const name of ['openSessionViewerCounter', 'selectViewerListTab'])eq(extract(candidate, name).includes('displayOnly: true'),
  true, name+': category display action opts into verified-null reuse');
  for(const name of ['bindSessionViewerActions', 'recordViewerAssignmentAction', 'saveSessionViewerAssignments'])eq(extract(candidate,
  name).includes('displayOnly'), false, name+': realtime/filter/save/scoring paths retain normal fresh reads');
  console.log(`PASS: ${checks} actual Full+Light verified-null, TTL, scope, invalidation and unchanged-behavior checks.`);
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
