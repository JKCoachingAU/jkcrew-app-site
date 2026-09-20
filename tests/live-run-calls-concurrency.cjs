const assert=require('node:assert/strict');
const {initialize}=require('./live-run-calls.cjs');
const {createHarness,literal,json}=require('./helpers/local-postgres.cjs');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function run(){
 const h=createHarness('live_run_calls'),report=[];
 const rider=id(1),coach=id(2),riderTab=id(10),coachTab=id(11),event=id(20);
 const acting=user=>`set role authenticated;set request.jwt.claim.sub=${literal(user)};`;
 const rpc=(action,session=null,client=riderTab,message=id(80),payload={})=>`select live_run_call_action(${literal(action)},${session?literal(session):'null'},'${client}','${message}',${literal(JSON.stringify(payload))}::jsonb,'${rider}','${coach}',0);`;
 const edit=(action,session,client,version,patch={})=>`select live_run_action('${action}','${session}','${client}',${version},${literal(JSON.stringify(patch))}::jsonb,'${rider}','${coach}');`;
 const photo='data:image/png;base64,'+'a'.repeat(80),draft={title:'Racing shared run',contestItemId:event,courseSource:'event',imageDataUrl:photo,points:[{x:10,y:10},{x:90,y:90}],view:{scale:1}};
 try{
  await initialize(h.adapter);
  h.batch(`insert into profiles values('${rider}','athlete','Rider'),('${coach}','coach','Coach');insert into coach_athletes values('${coach}','${rider}');insert into dashboard_items(id,item_type,end_at) values('${event}','event',now()+interval '1 day');insert into event_course_photos values('${event}',${literal(photo)});`);
  const a=h.connect('start_rider'),b=h.connect('start_coach');
  let started=json(await a.query(`begin;${acting(rider)}${rpc('start',null,riderTab,id(80),{mode:'video',draft})}`));
  const crossed=b.query(`${acting(coach)}${rpc('start',null,coachTab,id(81),{mode:'video',draft})}`);
  await h.waitLock(b);await a.query('commit;');assert.equal(json(await crossed).busy,true);
  assert.equal(h.batch("select count(*) from run_live_sessions where call_status='ringing';"),'1');report.push('crossed coach/rider starts overlap: exactly one ringing call, other sees busy');
  const session=started.session.id;
  const retry=h.connect('start_retry_a'),retryB=h.connect('start_retry_b');
  const first=json(await retry.query(`begin;${acting(rider)}${rpc('start',null,riderTab,id(80),{mode:'video',draft})}`));
  const duplicate=retryB.query(`${acting(rider)}${rpc('start',null,riderTab,id(80),{mode:'video',draft})}`);
  await h.waitLock(retryB);await retry.query('commit;');assert.equal(json(await duplicate).session.id,first.session.id);report.push('simultaneous repeated start ID returns same call without another notification');
  const accepted=json(await b.query(`${acting(coach)}${rpc('accept',session,coachTab)}`));assert.equal(accepted.session.call_status,'active');
  const saveA=h.connect('save_rider'),saveB=h.connect('save_coach');
  const saved=json(await saveA.query(`begin;${acting(rider)}${edit('save',session,riderTab,1)}`));
  const saveRetry=saveB.query(`${acting(coach)}${edit('save',session,coachTab,1)}`);await h.waitLock(saveB);await saveA.query('commit;');
  assert.equal(json(await saveRetry).session.saved_run_id,saved.session.saved_run_id);
  const facts=json(h.batch(`select jsonb_build_object('runs',(select count(*) from run_plans),'athlete',(select athlete_id from run_plans limit 1),'status',(select status from run_live_sessions where id='${session}'),'call',(select call_status from run_live_sessions where id='${session}'));`));
  assert.deepEqual(facts,{runs:1,athlete:rider,status:'active',call:'active'});report.push('overlapping saves serialize: one correct rider run; call and editing remain active');
  const patchA=h.connect('patch_first'),patchB=h.connect('patch_stale');
  const changed=json(await patchA.query(`begin;${acting(rider)}${edit('patch',session,riderTab,1,{notes:'Winning new revision'})}`));
  const stale=patchB.query(`${acting(rider)}${edit('patch',session,riderTab,1,{notes:'Stale overwrite'})}`).then(value=>({value}),error=>({error}));
  await h.waitLock(patchB);await patchA.query('commit;');assert.match((await stale).error?.message||'',/changed hands/);assert.equal(h.batch(`select draft->>'notes' from private.run_live_drafts where session_id='${session}';`),'Winning new revision');report.push('concurrent equal-version edits: newer committed draft survives, stale writer rejected');
  await a.query(`${acting(rider)}${edit('release',session,riderTab,changed.session.version)}`);
  const claimA=h.connect('claim_coach'),claimB=h.connect('claim_rider');
  await claimA.query(`begin;${acting(coach)}${edit('claim',session,coachTab,changed.session.version)}`);
  const claim=claimB.query(`${acting(rider)}${edit('claim',session,riderTab,changed.session.version)}`).then(value=>({value}),error=>({error}));
  await h.waitLock(claimB);await claimA.query('commit;');assert.match((await claim).error?.message||'',/Pass editing/);assert.equal(h.batch(`select editor_id from run_live_sessions where id='${session}';`),coach);report.push('overlapping lease claims: only one editor wins');
  const endA=h.connect('end_first'),lateSave=h.connect('save_after_end');await endA.query(`begin;${acting(coach)}${rpc('end',session,coachTab)}`);
  const afterEnd=lateSave.query(`${acting(coach)}${edit('save',session,coachTab,changed.session.version)}`).then(value=>({value}),error=>({error}));await h.waitLock(lateSave);await endA.query('commit;');assert.match((await afterEnd).error?.message||'',/active call|finished/);assert.equal(h.batch('select notes from run_plans;'),'');report.push('hangup wins a pending-save race: original saved run stays intact, shared draft retained');
  console.log(JSON.stringify({status:'PASS',postgres:h.batch('select version();'),independent_connections:h.count(),cases:report},null,2));
 }finally{await h.close();}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1});
