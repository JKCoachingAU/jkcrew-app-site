// Real PostgreSQL only, in a disposable database on the /tmp-only test harness.
// All users, photos and session data below are synthetic.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { initialize } = require('./live-run-shared-edits.cjs');
const { createHarness, literal, json } = require('./helpers/local-postgres.cjs');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const rider=id(1),coach=id(2),stranger=id(3),parent=id(4),otherCoach=id(5),riderTab=id(10),coachTab=id(11),event=id(20);
const photo='data:image/png;base64,'+'a'.repeat(1024*1024), changedPhoto=photo.slice(0,-1)+'b';
const sqlJson = value => `${literal(JSON.stringify(value))}::jsonb`;
async function run() {
 const h=createHarness('compact_payload');let checks=0,next=100,sid,version,tab=riderTab,actor=rider;
 const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
 const ok=(value,label)=>{assert(value,label);checks++;};
 const acting=who=>`reset role;set role authenticated;set request.jwt.claim.sub=${literal(who||'')};`;
 const query=sql=>json(h.batch(acting(actor)+sql));
 const rejects=(fn,pattern,label)=>{assert.throws(fn,pattern,label);checks++;};
 const call=(action,payload={})=>query(`select public.live_run_call_action(${literal(action)},${action==='start'?'null':literal(sid)},'${tab}','${id(next++)}',${sqlJson(payload)},'${rider}','${coach}',0);`);
 const edit=(ops=[],key=null,v=version,request=id(next++),compact=true)=>query(`select public.live_run_edit${compact?'_compact':''}('${sid}','${tab}','${request}',${v},${sqlJson(ops)}${compact?','+(key?literal(key):'null'):''});`);
 const legacy=(key=null,action='get',patch={},compact=true)=>query(`select public.live_run_action${compact?'_compact':''}('${action}','${sid}','${tab}',${version},${sqlJson(patch)},'${rider}','${coach}'${compact?','+(key?literal(key):'null'):''});`);
 const set=(key,before,value)=>({op:'set',key,before,value});
 try {
  await initialize(h.adapter);
  h.batch(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260921062609_compact_live_run_course_payloads.sql'),'utf8'));
  h.batch(`insert into profiles values('${rider}','athlete','Rider'),('${coach}','coach','Coach'),('${stranger}','athlete','Other rider'),('${parent}','parent','Parent'),('${otherCoach}','coach','Other coach');
   insert into coach_athletes values('${coach}','${rider}');
   insert into dashboard_items(id,item_type,end_at) values('${event}','event',now()+interval '1 day');`);
  const draft={title:'Finals',venue:'Test park',planType:'competition',contestItemId:event,courseSource:'upload',imageDataUrl:photo,notes:'',points:[{x:10,y:10},{x:45,y:60,label:'Manual',travelSeconds:12},{x:90,y:90}],view:{scale:1,x:0,y:0}};
  let session=call('start',{mode:'video',draft}).session;sid=session.id;version=session.version;
  actor=coach;tab=coachTab;session=call('accept').session;version=session.version;
  let result=edit();version=result.session.version;
  eq(result.draft.imageDataUrl,photo,'Initial join includes course photo');eq(result.image_omitted,false);ok(/^[a-f0-9]{64}$/.test(result.image_key));
  const key=result.image_key,base=result.draft,baseVersion=version;
  const oldBytes=Buffer.byteLength(JSON.stringify(edit([],null,version,id(next++),false)));
  result=edit([],key);eq(Object.hasOwn(result.draft,'imageDataUrl'),false);eq(result.image_omitted,true);eq(result.image_key,key);
  const newBytes=Buffer.byteLength(JSON.stringify(result));ok(newBytes<oldBytes/100,'Unchanged course responses cut more than 99% of wire bytes for 1 MiB photo');
  const request=id(next++),ops=[set('notes','','Coach note')];result=edit(ops,key,version,request);version=result.session.version;
  eq(result.applied,true);eq(result.image_omitted,true);eq(result.draft.notes,'Coach note');
  actor=rider;tab=riderTab;
  result=edit([set('title','Finals','Rider title')],key,baseVersion);version=result.session.version;
  eq(result.applied,true);eq(result.draft.notes,'Coach note');eq(result.draft.title,'Rider title');eq(result.image_omitted,true,'Stale disjoint edits merge without downloading photo');
  actor=coach;tab=coachTab;
  result=edit(ops,key,baseVersion,request);eq(result.replayed,true);eq(result.session.version,version);eq(result.image_omitted,true,'Lost ACK retry stays idempotent and compact');
  result=edit([set('title','Finals','Conflicting title')],key,baseVersion);eq(result.applied,false);eq(result.conflicts,['title']);eq(result.draft.title,'Rider title');eq(result.image_omitted,true,'Conflict still returns authoritative non-image data');
  result=edit([], 'unknown-cache-key');eq(result.image_omitted,false);eq(result.draft.imageDataUrl,photo,'Bad cache key recovers full photo');
  result=edit([set('imageDataUrl',photo,changedPhoto)],key);version=result.session.version;
  eq(result.image_omitted,false);eq(result.draft.imageDataUrl,changedPhoto);ok(result.image_key!==key,'One-byte photo change invalidates cache');
  const changedKey=result.image_key;
  result=edit([{op:'point',id:base.points[1].id,before:base.points[1],value:{...base.points[1],x:33}}],key,baseVersion);
  eq(result.applied,false);eq(result.conflicts,['course']);eq(result.draft.imageDataUrl,changedPhoto,'Stale route conflict receives current photo, never local stale photo');
  result=edit([],changedKey);eq(result.image_omitted,true);
  result=edit([],null,version,id(next++),false);eq(result.draft.imageDataUrl,changedPhoto);eq(Object.hasOwn(result,'image_omitted'),false,'Old installed clients retain full response contract');
  result=legacy(changedKey);eq(result.image_omitted,true);eq(result.draft.title,'Rider title','Lease/get RPC uses compact format too');
  eq(legacy(null,'get',{},false).draft.imageDataUrl,changedPhoto,'Legacy get still sends the full image');
  const saved=legacy(changedKey,'save');eq(saved.session.call_status,'active');ok(saved.session.saved_run_id);
  eq(legacy(changedKey,'save').session.saved_run_id,saved.session.saved_run_id,'Repeated saves keep one row');
  eq(json(h.batch(`select jsonb_build_object('n',count(*),'rider',min(athlete_id::text),'event',min(contest_item_id::text),'image',min(image_data_url)='${changedPhoto}') from run_plans;`)),{n:1,rider,event,image:true},'Persisted run keeps correct rider, contest, photo');
  for(const who of [null,stranger,parent,otherCoach]){actor=who;rejects(()=>edit([],key),/private|Sign in/);rejects(()=>legacy(key),/private|Sign in/);}
  actor=coach;tab=id(12);rejects(()=>edit([],key),/another tab/);rejects(()=>legacy(key),/another tab/);tab=coachTab;
  h.batch(`insert into private.rider_feature_access values('${rider}',true);`);rejects(()=>edit([],key),/private/);rejects(()=>legacy(key),/private/);
  h.batch('delete from private.rider_feature_access;');
  for(const signature of ['public.live_run_edit_compact(uuid,uuid,uuid,bigint,jsonb,text)','public.live_run_action_compact(text,uuid,uuid,bigint,jsonb,uuid,uuid,text)','private.compact_live_run_result(jsonb,text)']){
   eq(json(h.batch(`select jsonb_build_object('anon',has_function_privilege('anon',${literal(signature)},'execute'),'authenticated',has_function_privilege('authenticated',${literal(signature)},'execute'),'definer',(select prosecdef from pg_proc where oid=${literal(signature)}::regprocedure));`)),{anon:false,authenticated:true,definer:false});
  }
  result=edit([set('imageDataUrl',changedPhoto,'')],changedKey);version=result.session.version;eq(result.draft.imageDataUrl,'');eq(result.image_omitted,false,'Clearing photo is explicit');
  eq(edit([],result.image_key).image_omitted,true,'Empty photo can also be cached');
  call('end');rejects(()=>edit([],key),/Accept an active call/);
  console.log(`PASS ${checks} real PostgreSQL compact payload checks. Same draft with 1 MiB course photo: ${oldBytes.toLocaleString()} -> ${newBytes.toLocaleString()} JSON bytes (${(100*(1-newBytes/oldBytes)).toFixed(2)}% reduction per unchanged-photo response). Permissions, receipts, simultaneous-field semantics, course conflicts, legacy clients and save ownership preserved.`);
 } finally {await h.close();}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
