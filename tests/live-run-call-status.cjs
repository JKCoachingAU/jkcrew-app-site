'use strict';
// Disposable local PostgreSQL only. No real accounts, network calls or app data.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { initialize } = require('./live-run-shared-edits.cjs');
const { createHarness, literal, json } = require('./helpers/local-postgres.cjs');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const rider=id(1), coach=id(2), stranger=id(3), parent=id(4), otherCoach=id(5);
const riderTab=id(10), coachTab=id(11), wrongTab=id(12);
const signature='live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint)';
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260929095937_live_run_call_status_metadata.sql'),'utf8');
async function run() {
 const h=createHarness('call_status');
 let checks=0, actor=rider, tab=riderTab, sid=null, next=100;
 const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const ok=(value,label)=>{assert(value,label);checks++;};
 const rejects=(fn,pattern,label)=>{assert.throws(fn,pattern,label);checks++;};
 const query=sql=>json(h.batch(`reset role;set role authenticated;set request.jwt.claim.sub=${literal(actor||'')};${sql}`));
 const sqlCall=(action,payload={})=>`select public.live_run_call_action(${literal(action)},${action==='start'?'null':literal(sid)},${tab?literal(tab):'null'},'${id(next++)}',${literal(JSON.stringify(payload))}::jsonb,'${rider}','${coach}',0);`;
 const call=(action,payload={})=>query(sqlCall(action,payload));
 const photo='data:image/png;base64,'+'a'.repeat(1024*1024);
 const draft={title:'Coaching run',imageDataUrl:photo,points:[{x:10,y:10},{x:80,y:60}],courseSource:'upload'};
 const start=()=>{actor=rider;tab=riderTab;sid=call('start',{mode:'video',draft}).session.id;};
 const metadata=()=>{const result=call('status');eq(Object.keys(result),['session'],'Only session metadata returned');ok(!JSON.stringify(result).includes('data:image'),'No image payload anywhere');return result.session;};
 try {
  await initialize(h.adapter);
  const before=json(h.batch(`select to_jsonb(prosrc) from pg_proc where oid='private.${signature}'::regprocedure;`));
  h.batch(migration);
  const after=json(h.batch(`select to_jsonb(prosrc) from pg_proc where oid='private.${signature}'::regprocedure;`));
  const expected=before.replace("  if p_action='get' then\n","  if p_action in ('get','status') then\n")
   .replace('    select draft into d from private.run_live_drafts where session_id=s.id\n      and (s.invitation_status=',
    "    -- Metadata polls must not read/decode the private draft or its course image.\n    if p_action='status' then return jsonb_build_object('session',to_jsonb(s)); end if;\n    select draft into d from private.run_live_drafts where session_id=s.id\n      and (s.invitation_status=");
  eq(after,expected,'Only the status branch changes; all auth/lifecycle/save/signaling code retained');
  rejects(()=>h.batch(migration),/needs review/,'Migration fails closed if the expected original branch changed');
  h.batch(`insert into profiles values('${rider}','athlete','Rider'),('${coach}','coach','Coach'),('${stranger}','athlete','Stranger'),('${parent}','parent','Parent'),('${otherCoach}','coach','Other coach');insert into coach_athletes values('${coach}','${rider}');`);
  start();
  let session=metadata();eq(session.call_status,'ringing');
  const legacy=call('get');eq(legacy.draft.imageDataUrl,photo,'Older clients retain draft recovery');eq(legacy.session,session,'Status uses the same session as get');
  const oldBytes=Buffer.byteLength(JSON.stringify(legacy)),newBytes=Buffer.byteLength(JSON.stringify({session}));
  ok(newBytes<oldBytes/100,'Over 99% response reduction with 1 MiB course image');
  for(const badTab of [null,wrongTab]){tab=badTab;rejects(()=>call('status'),/another tab/,'Ringing caller remains device-bound');}
  tab=riderTab;
  for(const who of [null,stranger,parent,otherCoach]){actor=who;rejects(()=>call('status'),/private|Sign in/,'Unrelated or missing user rejected');}
  actor=rider;rejects(()=>query(sqlCall('status',[])),/Invalid call request/,'Invalid payload rejected');
  rejects(()=>h.batch(`reset role;set role anon;${sqlCall('status')}`),/permission denied/,'Anonymous role cannot execute API');
  actor=coach;tab=null;eq(metadata().call_status,'ringing','Unaccepted callee sees metadata with get-equivalent permissions');
  tab=coachTab;session=call('accept').session;eq(metadata().call_status,'active');
  for(const who of [rider,coach]){
   actor=who;tab=who===rider?riderTab:coachTab;
   const status=metadata();eq(call('get').session,status);eq(call('get').draft.imageDataUrl,photo);
   for(const badTab of [null,wrongTab]){tab=badTab;rejects(()=>call('status'),/another tab/,'Accepted participants remain device-bound');}
  }
  actor=rider;tab=riderTab;
  session=metadata();call('status');eq(metadata().athlete_seen_at,session.athlete_seen_at,'Status is not a presence heartbeat');
  h.batch(`insert into private.rider_feature_access values('${rider}',true);`);
  rejects(()=>call('status'),/private/,'Disabled rider pair cannot read status');
  h.batch(`delete from private.rider_feature_access;delete from coach_athletes;`);
  rejects(()=>call('status'),/private/,'Revoked coach relationship denies status immediately');
  h.batch(`insert into coach_athletes values('${coach}','${rider}');`);
  // Make any actual draft evaluation fail. Status must still work; get must fail.
  h.batch(`alter table private.run_live_drafts rename to test_status_drafts;
   create function private.test_fail_draft(jsonb) returns jsonb language plpgsql volatile as $$begin raise exception 'Draft accessed by test';end$$;
   create view private.run_live_drafts as select session_id,private.test_fail_draft(draft) draft from private.test_status_drafts;`);
  eq(metadata().call_status,'active','Status succeeds without loading/evaluating course data');
  rejects(()=>call('get'),/Draft accessed by test/,'Test trap proves full get evaluates the draft');
  h.batch('drop view private.run_live_drafts;drop function private.test_fail_draft(jsonb);alter table private.test_status_drafts rename to run_live_drafts;');
  eq(call('get').draft.imageDataUrl,photo,'Draft recovery unchanged after status reads');
  h.batch(`update run_live_sessions set coach_seen_at=now()-interval '91 seconds' where id='${sid}';`);
  session=metadata();eq(session.call_status,'ended');eq(session.call_end_reason,'connection_timeout','Status applies active-call expiry');
  tab=wrongTab;eq(metadata().call_status,'ended','Terminal status preserves legacy get device behavior');
  start();h.batch(`update run_live_sessions set ring_expires_at=now()-interval '1 second' where id='${sid}';`);
  session=metadata();eq(session.call_status,'missed');eq(session.call_end_reason,'unanswered','Status expires unanswered calls');
  for(const ending of ['cancel','decline','end']){
   start();if(ending==='decline'){actor=coach;tab=coachTab;}
   const terminal=call(ending).session;eq(metadata(),terminal,'Metadata handles '+ending+' without exposing a draft');
  }
  for(const schema of ['public','private']) {
   const props=json(h.batch(`select jsonb_build_object('anon',has_function_privilege('anon','${schema}.${signature}','execute'),'authenticated',has_function_privilege('authenticated','${schema}.${signature}','execute'),'definer',prosecdef,'path',proconfig) from pg_proc where oid='${schema}.${signature}'::regprocedure;`));
   eq(props,{anon:false,authenticated:true,definer:schema==='private',path:['search_path=""']},'Existing explicit auth/invoker/search_path boundary retained');
  }
  console.log(`PASS ${checks} real PostgreSQL status checks. 1 MiB synthetic photo: ${oldBytes.toLocaleString()} -> ${newBytes.toLocaleString()} JSON bytes (${(100*(1-newBytes/oldBytes)).toFixed(2)}% fewer). Verified no draft reads, legacy compatibility, roles, device binding, relationship/feature revocation and call lifetimes.`);
 } finally {await h.close();}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
