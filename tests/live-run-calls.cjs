const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');
const root=process.env.JKCREW_ROOT||path.resolve(__dirname,'..');
const migration=name=>fs.readFileSync(path.join(root,'supabase/migrations',fs.readdirSync(path.join(root,'supabase/migrations')).find(f=>f.endsWith('_'+name+'.sql'))),'utf8');
async function initialize(db){
 await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;
 grant usage on schema public,auth to authenticated;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,display_name text);
 create table coach_athletes(coach_id uuid,athlete_id uuid);
 create table run_plans(id uuid primary key default gen_random_uuid(),athlete_id uuid,coach_id uuid,created_by uuid,title text,venue text,plan_type text,notes text,image_data_url text,points jsonb,contest_item_id uuid,updated_at timestamptz not null default clock_timestamp());
 create table dashboard_items(id uuid primary key,item_type text,completed boolean default false,due_at timestamptz,end_at timestamptz);
 create table event_course_photos(event_id uuid primary key references dashboard_items(id),image_data_url text);
 create table private.rider_feature_access(athlete_id uuid primary key,features_disabled boolean not null default false);
 create function private.rider_features_disabled() returns boolean language sql security definer set search_path='' as $$select exists(select 1 from private.rider_feature_access where athlete_id=auth.uid() and features_disabled)$$;
 create table private.test_notifications(recipient uuid,kind text,title text,body text,view text,payload jsonb,source text unique);
 create function private.emit_jkcrew_notification(uuid,text,text,text,text,jsonb,text,text) returns void language sql as $$insert into private.test_notifications values($1,$2,$3,$4,$5,$6,$7) on conflict(source) do nothing$$;
 grant select on profiles,coach_athletes to authenticated;
 alter table coach_athletes enable row level security;
 create policy linked on coach_athletes for select to authenticated using(coach_id=auth.uid() or athlete_id=auth.uid());`);
 await db.exec(migration('live_run_sessions'));await db.exec(migration('live_run_invitations'));
 await db.exec(migration('live_run_calls_and_continuous_save'));
}
async function run(){
 const db=new PGlite();
 try{
 await initialize(db);
 const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const rider=id(1),coach=id(2),stranger=id(3),parent=id(4),otherCoach=id(5),riderTab=id(10),coachTab=id(11),wrongTab=id(12),event=id(20),privateEvent=id(21),expiredEvent=id(22),noCourseEvent=id(23);
 const photo='data:image/png;base64,'+'a'.repeat(80);
 await db.query("insert into profiles values($1,'athlete','Rider'),($2,'coach','Coach'),($3,'athlete','Other'),($4,'parent','Parent'),($5,'coach','Other coach')",[rider,coach,stranger,parent,otherCoach]);
 await db.query('insert into coach_athletes values($1,$2),($1,$3),($4,$2)',[coach,rider,stranger,otherCoach]);
 await db.query("insert into dashboard_items(id,item_type,end_at) values($1,'event',now()+interval '1 day'),($2,'task',now()+interval '1 day'),($3,'event',now()-interval '1 day'),($4,'event',now()+interval '1 day')",[event,privateEvent,expiredEvent,noCourseEvent]);
 await db.query('insert into event_course_photos values($1,$2)',[event,photo]);
 const as=async who=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who||'']);await db.exec('set role authenticated')};
 const admin=async(sql,params=[])=>{await db.exec('reset role');return db.query(sql,params)};
 let session=null,tab=riderTab,next=100;
 const call=async(action,payload={},options={})=>(await db.query('select live_run_call_action($1,$2,$3,$4,$5,$6,$7,$8) result',[action,action==='start'?null:session?.id,tab,options.messageId||id(next++),JSON.stringify(payload),options.rider||rider,options.coach||coach,options.after||0])).rows[0].result;
 const edit=async(action,patch={},version=session.version)=>(await db.query('select live_run_action($1,$2,$3,$4,$5,$6,$7) result',[action,session.id,tab,version,JSON.stringify(patch),rider,coach])).rows[0].result;
 const draft={title:'Finals',venue:'Test park',contestItemId:event,courseSource:'event',imageDataUrl:photo,points:[{x:10,y:10},{x:45,y:60,label:'Manual',travelSeconds:12},{x:90,y:90}],view:{scale:2,x:10,y:20}};
 await as(rider);
 for(const bad of [{mode:'audio',draft:{athleteId:stranger}},{mode:'video',draft:{points:'oops'}},{mode:'video',draft:{contestItemId:privateEvent}},{mode:'video',draft:{contestItemId:expiredEvent}},{mode:'video',draft:{...draft,imageDataUrl:'https://private.invalid/photo'}}])await assert.rejects(()=>call('start',bad));
 const requestId=id(80);session=(await call('start',{mode:'video',draft},{messageId:requestId})).session;
 assert.equal(session.call_status,'ringing');assert.equal(session.invitation_status,'pending');assert.equal(session.caller_name,'Rider');assert.equal(session.coach_name,'Coach');
 assert.equal((await call('start',{mode:'video',draft},{messageId:requestId})).session.id,session.id,'Start retries do not ring twice');
 assert.deepEqual((await call('get')).draft.points,draft.points,'Ringing caller recovers their seeded draft after refresh');
 tab=wrongTab;await assert.rejects(()=>call('get'),/another tab/);tab=riderTab;
 assert.equal((await call('start',{mode:'audio'})).busy,true,'A participant cannot start a second call');
 await assert.rejects(()=>call('accept'),/other person/);await assert.rejects(()=>edit('patch',{notes:'before consent'}),/Accept an active call/);
 for(const who of [parent,stranger,otherCoach]){await as(who);assert.equal((await db.query('select * from run_live_sessions')).rows.length,0);for(const action of ['get','accept','signals','end'])await assert.rejects(()=>call(action),/private/)}
 await as(coach);tab=coachTab;assert.equal((await call('start',{mode:'audio'},{rider:stranger})).busy,true,'Coach cannot ring another rider while busy');
 assert.equal((await call('get')).draft,undefined,'Unaccepted callee cannot read the ringing caller draft');
 await assert.rejects(()=>edit('accept'),/call invitation/);
 let accepted=await call('accept');session=accepted.session;assert.equal(session.call_status,'active');assert.deepEqual(accepted.draft.points,draft.points);assert.equal((await call('accept')).session.id,session.id);
 await assert.rejects(()=>db.query('insert into run_live_signals(id,session_id,sender_id,recipient_id,kind,payload) values($1,$2,$3,$4,$5,$6)',[id(81),session.id,coach,rider,'offer','{}']),/permission denied/);
 await assert.rejects(()=>db.query('select * from private.run_live_drafts'),/permission denied/);
 await as(rider);tab=riderTab;
 const offer={kind:'offer',data:{type:'offer',sdp:'v=0\r\na=fixture-offer'}};
 const signalId=id(82);const signal=(await call('signal',offer,{messageId:signalId})).signal;
 assert.equal((await call('signal',offer,{messageId:signalId})).signal.seq,signal.seq,'Stable message IDs deduplicate retries');
 await assert.rejects(()=>call('signal',{kind:'offer',data:{type:'offer',sdp:'v=0\r\na=changed'}},{messageId:signalId}),/already used/);
 assert.equal((await db.query('select * from run_live_signals')).rows.length,0,'Sender does not receive its own signal rows');
 for(const bad of [{kind:'video',data:{}},{kind:'offer',data:{type:'answer',sdp:'v=0\r\na=no'}},{kind:'offer',data:{type:'offer',sdp:'v=0\r\na=yes',recipient_id:stranger}},{kind:'ice',data:{candidate:'malformed'}},{kind:'ice',data:{candidate:'candidate:test',sdpMLineIndex:-1}},{kind:'ice',data:{candidate:'candidate:test',sdpMLineIndex:'0'}},{kind:'ice',data:{candidate:'candidate:test',extra:'x'}}])await assert.rejects(()=>call('signal',bad),/Invalid/);
 await as(coach);tab=coachTab;let signals=(await call('signals')).signals;assert.equal(signals.length,1);assert.deepEqual(signals[0].payload,offer.data);assert.equal((await db.query('select * from run_live_signals')).rows.length,1,'Only intended accepted peer can read realtime payload');assert.equal((await call('signals',{}, {after:signal.seq})).signals.length,0);
 await call('signal',{kind:'answer',data:{type:'answer',sdp:'v=0\r\na=fixture-answer'}});
 await call('signal',{kind:'ice',data:{candidate:'candidate:1 1 UDP 2122260223 127.0.0.1 50000 typ host',sdpMid:'0',sdpMLineIndex:0}});
 tab=wrongTab;await assert.rejects(()=>call('get'),/another tab/);await assert.rejects(()=>call('heartbeat'),/another tab/);tab=coachTab;
 await assert.rejects(()=>edit('claim'),/Pass editing/);await assert.rejects(()=>edit('save'),/pass editing/);
 await as(rider);tab=riderTab;const version=session.version;session=(await edit('patch',{notes:'One correct shared draft'})).session;
 await assert.rejects(()=>edit('patch',{notes:'stale'},version),/changed hands/);await assert.rejects(()=>edit('save',{},version),/run changed/);
 for(const bad of [{contestItemId:privateEvent},{contestItemId:expiredEvent},{contestItemId:noCourseEvent},{imageDataUrl:photo+'other'},{points:[{x:-1,y:0}]}])await assert.rejects(()=>edit('patch',bad));
 session=(await edit('release')).session;await as(coach);tab=coachTab;session=(await edit('claim')).session;
 session=(await edit('save')).session;assert.equal(session.status,'active');assert.equal(session.call_status,'active');assert.equal(session.saved_version,session.version);
 const savedId=session.saved_run_id;assert(savedId);assert.equal((await edit('save')).session.saved_run_id,savedId);
 let rows=(await admin('select * from run_plans')).rows;assert.equal(rows.length,1);assert.equal(rows[0].athlete_id,rider);assert.equal(rows[0].coach_id,coach);assert.equal(rows[0].created_by,coach);assert.equal(rows[0].contest_item_id,event);assert.equal(rows[0].course_source,'event');assert.deepEqual(rows[0].points[0].view,draft.view);
 await as(coach);session=(await edit('patch',{notes:'Second saved revision'})).session;session=(await edit('save')).session;assert.equal(session.saved_run_id,savedId);assert.equal(session.call_status,'active');
 await admin("update run_plans set notes='Outside edit',updated_at=clock_timestamp() where id=$1",[savedId]);await as(coach);session=(await edit('patch',{notes:'My local new work'})).session;await assert.rejects(()=>edit('save'),/changed outside/);assert.equal((await edit('get')).draft.notes,'My local new work','Conflicting save preserves shared draft');
 await call('heartbeat');session=(await call('end')).session;assert.equal(session.status,'ended');assert.equal(session.call_status,'ended');assert.equal((await call('end')).session.id,session.id);assert.equal((await call('signals')).signals.length,0);assert.equal((await db.query('select * from run_live_signals')).rows.length,0,'Terminal session signals immediately hidden');
 // Both invitation directions and all terminal states; no fake saved status.
 session=(await call('start',{mode:'audio'})).session;await as(rider);tab=riderTab;session=(await call('decline')).session;assert.equal(session.call_status,'declined');assert.equal((await call('decline')).session.call_status,'declined');
 session=(await call('start',{mode:'audio'})).session;session=(await call('cancel')).session;assert.equal(session.call_status,'cancelled');assert.equal(session.status,'ended');
 session=(await call('start',{mode:'audio'})).session;await admin("update run_live_sessions set ring_expires_at=now()-interval '1 second' where id=$1",[session.id]);await as(coach);tab=coachTab;const missed=await call('accept');assert.equal(missed.session.call_status,'missed');assert.equal(missed.unavailable,true);
 session=(await call('start',{mode:'video'})).session;await as(rider);tab=riderTab;session=(await call('accept')).session;
 await assert.rejects(()=>edit('save'),/pass editing/);await as(coach);tab=coachTab;await assert.rejects(()=>edit('save'),/available event/);
 await admin("update run_live_sessions set athlete_seen_at=now()-interval '91 seconds' where id=$1",[session.id]);await as(coach);const timeout=await call('heartbeat');assert.equal(timeout.session.call_status,'ended');assert.equal(timeout.session.call_end_reason,'connection_timeout');
 // Legacy non-call Build together remains compatible with older clients.
 await as(rider);tab=riderTab;
 session=(await db.query('select live_run_action($1,null,$2,null,$3,$4,$5) result',['create',tab,JSON.stringify(draft),rider,coach])).rows[0].result.session;
 assert.equal(session.call_status,'idle');await as(coach);tab=coachTab;session=(await edit('accept')).session;
 await as(rider);tab=riderTab;session=(await edit('save')).session;assert.equal(session.status,'saved');assert.equal((await edit('save')).session.saved_run_id,session.saved_run_id);
 await as(coach);tab=coachTab;
 // Private feature restriction blocks the pair even when initiated by coach.
 await admin('insert into private.rider_feature_access values($1,true)',[rider]);await as(coach);await assert.rejects(()=>call('start',{mode:'video'}),/linked/);assert.equal((await db.query('select * from run_live_sessions')).rows.length,0);
 await admin('delete from private.rider_feature_access');await as(coach);session=(await call('start',{mode:'video'})).session;await as(rider);tab=riderTab;session=(await call('accept')).session;
 await admin('delete from coach_athletes where coach_id=$1 and athlete_id=$2',[coach,rider]);await as(rider);await assert.rejects(()=>call('signal',offer),/private/);await assert.rejects(()=>edit('get'),/private/);assert.equal((await db.query('select * from run_live_sessions')).rows.length,0);
 for(const fn of ['public.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint)','private.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint)'])assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') ok",[fn])).rows[0].ok,false);
 await admin("update run_live_signals set expires_at=now()-interval '1 second'");await db.exec('select private.clean_live_run_signaling()');assert.equal((await db.query('select count(*)::int n from run_live_signals')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from run_plans')).rows[0].n,2,'One call run plus one legacy run; declines and repeated saves never duplicate either');
 console.log('PASS private two-party call lifecycle, retry-safe start/signals/save, simultaneous-party busy exclusion, expired/unanswered calls, device binding, malformed signal/event/course rejection, lease/revision races, correct saved ownership, call survives save, outside-edit protection, RLS/revocation and signal cleanup. No production requests.');
 } finally {await db.close()}
}
module.exports={initialize};
if(require.main===module)run().catch(error=>{console.error(error);process.exit(1)});
