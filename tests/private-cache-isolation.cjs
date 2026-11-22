// Actual cache/fetch functions with deferred synthetic data, never live accounts.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, name + ' exists');
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise,resolve}; };
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const state = {user:{id:'coach-a'},sessionSetupVersion:1,cache:{},inFlight:new Map(),coachRosterIds:new Set()};
const rpcRequests = [];
const context = vm.createContext({
  state, URL, Date, Map, Set, Number, Error, String, Promise, recentEventCoursePhoto:null,
  HELP_VIDEO_SIGNED_URL_SECONDS:3600,TRICK_HELP_VIDEO_BUCKET:'trick-help-videos',
  hydrateHelpRequestMediaUrls:async rows=>rows,
  isCoachRole:role=>['coach','admin'].includes(role),
  console:{warn(){},error(){}}, SUPABASE_URL:'https://fixture.supabase.co',
  venueKey: value => value, venueIdentityKey: value => String(value).toLowerCase(),
  client:{
    rpc(name,args) { const request = {...deferred(),name,args,viewer:state.user.id}; rpcRequests.push(request); return request.promise; },
    from(name) {
      const request={...deferred(),name,viewer:state.user.id};rpcRequests.push(request);
      const query={then:(done,fail)=>request.promise.then(done,fail)};
      for(const method of ['select','order','eq','maybeSingle','limit'])query[method]=()=>query;
      return query;
    },
  },
  withTimeout: promise => promise,
});
vm.runInContext(['cacheGet','cacheSet','cacheClear','getParkKing','getAllParkKings','getSessionViewerRoster','getPublicAthleteProfile','realtimeVisibleAthleteIds','getEventCoursePhoto','fetchHelpVideoMedia','prepareCoachReviewPlaybackMedia'].map(extract).join('\n'),context);
const switchTo = userId => { state.user={id:userId}; state.sessionSetupVersion++; state.cache={}; state.inFlight.clear(); };
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
(async () => {
  context.cacheSet('private', {label:'a'});
  eq(context.cacheGet('private').label,'a','Current account reads its own cache');
  state.user={id:'coach-b'};
  eq(context.cacheGet('private'),null,'An uncleared cache entry cannot cross accounts');
  state.user={id:'coach-a'}; state.sessionSetupVersion++;
  eq(context.cacheGet('private'),null,'A new session cannot reuse the same account’s old generation');
  const oldScope={userId:'coach-a',generation:state.sessionSetupVersion};
  switchTo('coach-b'); switchTo('coach-a');
  assert.throws(()=>context.cacheSet('private',{label:'old'},oldScope),/account access changed/);checks++;
  eq(Object.keys(state.cache).length,0,'An obsolete A→B→A write never enters the cache');

  switchTo('coach-a');
  const first=context.getParkKing('Village');
  const firstRejected=assert.rejects(first,/account access changed/);
  const firstRequest=rpcRequests.at(-1);
  switchTo('coach-b');
  const second=context.getParkKing('Village');
  const secondRequest=rpcRequests.at(-1);
  const pendingSecond=state.inFlight.get('park-king:village');
  firstRequest.resolve({data:[{display_name:'Private A',points:13}]});
  await firstRejected;checks++;
  eq(state.inFlight.get('park-king:village'),pendingSecond,'An old finally block cannot delete the next account’s same-key request');
  eq(context.cacheGet('park-king:village'),null,'The earlier team’s crown is not cached');
  secondRequest.resolve({data:[{display_name:'Private B',points:2}]});
  eq((await second).display_name,'Private B','New account receives only its own crown response');
  eq(context.cacheGet('park-king:village').king.display_name,'Private B','New account’s crown is the only stored value');
  eq(state.inFlight.size,0,'Completed current request cleans up itself');

  const oldAll=context.getAllParkKings();
  const oldAllRejected=assert.rejects(oldAll,/account access changed/);
  const oldAllRequest=rpcRequests.at(-1);
  switchTo('coach-a');
  const newAll=context.getAllParkKings();
  const newAllRequest=rpcRequests.at(-1);
  const pendingAll=state.inFlight.get('park-kings:all');
  oldAllRequest.resolve({data:[{display_name:'Private B'}]});
  await oldAllRejected;checks++;
  eq(state.inFlight.get('park-kings:all'),pendingAll,'Global crown-list key retains its new-account request');
  newAllRequest.resolve({data:[{display_name:'Private A'}]});
  eq((await newAll)[0].display_name,'Private A','Global list resolves for the current account only');

  // A late implicit-scope roster RPC must not overwrite realtime authorization.
  const roster=context.getSessionViewerRoster();
  const rosterRejected=assert.rejects(roster,/account access changed/);
  const rosterRead=rpcRequests.at(-1);
  eq(rosterRead.name,'get_my_session_viewer_roster','Session roster uses the implicit coach-scoped RPC');
  await flush();
  switchTo('coach-b');state.coachRosterIds=new Set(['b-rider']);
  rosterRead.resolve({data:{links:[{athlete_id:'a-rider',group_name:'monday'}],athletes:[{id:'a-rider',display_name:'Private A rider'}],group_links:[]}});
  await rosterRejected;checks++;
  eq([...state.coachRosterIds],['b-rider'],'Old roster cannot replace the next coach’s realtime identity set');

  state.profile={role:'coach'};
  const oldRealtime=context.realtimeVisibleAthleteIds(), oldRealtimeRequest=rpcRequests.at(-1);
  switchTo('coach-a'); state.coachRosterIds=new Set(['a-current-rider']);
  oldRealtimeRequest.resolve({data:[{athlete_id:'b-private-rider'}]});
  eq([...(await oldRealtime)],[],'Obsolete realtime roster results are discarded');
  eq([...state.coachRosterIds],['a-current-rider'],'Realtime scope discovery cannot overwrite a new account’s identity set');
  const oldPhoto=context.getEventCoursePhoto('private-event'), oldPhotoRequest=rpcRequests.at(-1);
  const photoRejected=assert.rejects(oldPhoto,/account access changed/);
  switchTo('coach-b'); oldPhotoRequest.resolve({data:{image_data_url:'old private event photo'}});
  await photoRejected;checks++;
  eq(context.recentEventCoursePhoto,null,'Late event photo cannot enter another session’s cache');
  const currentPhoto=context.getEventCoursePhoto('private-event');
  rpcRequests.at(-1).resolve({data:{image_data_url:'current event photo'}}); await currentPhoto;
  const beforePhotoReload=rpcRequests.length; state.sessionSetupVersion++;
  const freshPhoto=context.getEventCoursePhoto('private-event');
  eq(rpcRequests.length,beforePhotoReload+1,'A new epoch must authorize the same account’s event photo again');
  rpcRequests.at(-1).resolve({data:{image_data_url:'reauthorized photo'}}); await freshPhoto;

  state.videoReviewMedia=new Map();
  const oldVideo=context.fetchHelpVideoMedia('private-review'), oldVideoRequest=rpcRequests.at(-1);
  const oldVideoRejected=assert.rejects(oldVideo,/account access changed/);
  switchTo('coach-a'); oldVideoRequest.resolve({data:[{id:'private-review',video_data_url:'another account’s private clip'}]});
  await oldVideoRejected;checks++;
  eq(state.videoReviewMedia.size,0,'A delayed private review cannot populate the next account’s media cache');
  const currentVideo=context.fetchHelpVideoMedia('private-review');
  rpcRequests.at(-1).resolve({data:[{id:'private-review',video_data_url:'authorized current clip'}]});await currentVideo;
  const videoRequests=rpcRequests.length;
  await context.fetchHelpVideoMedia('private-review');
  eq(rpcRequests.length,videoRequests,'Current epoch can reuse authorized private video');
  state.sessionSetupVersion++;
  const reauthorizedVideo=context.fetchHelpVideoMedia('private-review');
  eq(rpcRequests.length,videoRequests+1,'A new epoch cannot reuse old review media even for the same user');
  rpcRequests.at(-1).resolve({data:[{id:'private-review',video_data_url:'reauthorized current clip'}]});await reauthorizedVideo;
  const revokedBlobs=[], download=deferred();
  context.URL=class extends URL {static createObjectURL(){return 'blob:old-private-review';}static revokeObjectURL(value){revokedBlobs.push(value);}};
  context.client.storage={from:()=>({download:()=>download.promise})};
  state.view='videoReviews';state.videoReviewActiveRequestId='private-review';
  const playback=context.prepareCoachReviewPlaybackMedia('private-review',{video_storage_path:'private/clip.mp4'});
  const playbackRejected=assert.rejects(playback,/selected review changed/);
  state.sessionSetupVersion++;download.resolve({data:{size:20}});await playbackRejected;checks++;
  eq(revokedBlobs,['blob:old-private-review'],'A late recording download revokes its obsolete private blob');
  eq(state.videoReviewMedia.get('private-review')?.video_playback_url,undefined,'An obsolete recording blob is never cached');

  // Private showreels are hydrated with authorized short-lived Storage URLs.
  const signs=[];
  context.client.storage={from(bucket){eq(bucket,'profile-showreels','Only the private profile-showreels bucket is used');return {createSignedUrl:async(storagePath,seconds)=>{signs.push({storagePath,seconds});return {data:{signedUrl:'https://fixture.supabase.co/storage/v1/object/sign/'+storagePath+'?token=fixture'}};}};}};
  const profile=context.getPublicAthleteProfile('rider');
  rpcRequests.at(-1).resolve({data:[{id:'rider',showreel_videos:[
    {id:'modern',storage_path:'rider/clip.mp4',video_url:'old public source'},
    {id:'legacy',video_url:'https://fixture.supabase.co/storage/v1/object/public/profile-showreels/rider/old%20clip.mp4'},
    {id:'unknown',video_url:'https://elsewhere.example/secret.mp4'},
  ]}]});
  const hydrated=await profile;
  eq(signs.map(row=>row.storagePath),['rider/clip.mp4','rider/old clip.mp4'],'Stored paths and same-project legacy public paths are signed');
  eq(signs.every(row=>row.seconds===300),true,'Private clips use five-minute URLs');
  eq(hydrated.showreel_videos.every(row=>!row.video_url.includes('/object/public/')),true,'Public bucket URLs are not returned as playback sources');
  eq(hydrated.showreel_videos[2].video_url,'','Unknown public URL cannot masquerade as private playback');
  context.client.storage.from=()=>({createSignedUrl:async()=>({error:{message:'denied'}})});
  const denied=context.getPublicAthleteProfile('rider');
  rpcRequests.at(-1).resolve({data:[{id:'rider',showreel_videos:[{storage_path:'rider/clip.mp4',video_url:'old'}]}]});
  eq((await denied).showreel_videos[0].video_url,'','Signing denial never falls back to the old public URL');
  const heldSign=deferred();context.client.storage.from=()=>({createSignedUrl:()=>heldSign.promise});
  const staleProfile=context.getPublicAthleteProfile('rider');
  const staleProfileRejected=assert.rejects(staleProfile,/account access changed/);
  rpcRequests.at(-1).resolve({data:[{id:'rider',showreel_videos:[{storage_path:'rider/clip.mp4'}]}]});
  await flush();switchTo('coach-a');heldSign.resolve({data:{signedUrl:'private old account URL'}});
  await staleProfileRejected;checks++;
  eq(Object.keys(state.cache).length,0,'Signing results are never cached across accounts');
  console.log(`PASS: ${checks} private cache/media checks; account/epoch isolation, deferred same-key races, roster identity protection and authorized showreel URLs.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
