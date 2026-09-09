const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 await db.exec(`create schema auth;create schema private;create role authenticated;create role anon;
 grant usage on schema auth,private,public to authenticated;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table coach_athletes(coach_id uuid,athlete_id uuid);
 create table run_plans(id uuid primary key,athlete_id uuid,coach_id uuid,created_by uuid,title text,venue text,plan_type text,notes text,points jsonb,image_data_url text,contest_item_id uuid,updated_at timestamptz default now());
 grant select on coach_athletes to authenticated;
 grant select,insert,update on run_plans to authenticated;
 alter table run_plans enable row level security;
 create policy rider_select on run_plans for select to authenticated using(athlete_id=auth.uid());
 create policy run_plans_athlete_own_update on run_plans for update to authenticated using(athlete_id=auth.uid() and created_by=auth.uid()) with check(athlete_id=auth.uid() and created_by=auth.uid());
 create policy coach on run_plans to authenticated using(coach_id=auth.uid() and exists(select 1 from coach_athletes c where c.coach_id=auth.uid() and c.athlete_id=run_plans.athlete_id)) with check(coach_id=auth.uid() and exists(select 1 from coach_athletes c where c.coach_id=auth.uid() and c.athlete_id=run_plans.athlete_id));`);
 const migrations=path.join(__dirname,'../supabase/migrations');
 await db.exec(fs.readFileSync(process.env.JKCREW_SAVED_RUN_SQL||path.join(migrations,fs.readdirSync(migrations).find(f=>f.endsWith('_saved_run_shared_editing.sql'))),'utf8'));
 const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const rider=id(1),coach=id(2),stranger=id(3),parent=id(4);
 await db.query('insert into coach_athletes values($1,$2)',[coach,rider]);
 for(const creator of [rider,coach])await db.query("insert into run_plans(id,athlete_id,coach_id,created_by,title,points,image_data_url) values($1,$2,$3,$4,'Original','[]','photo')",[creator===rider?id(10):id(11),rider,coach,creator]);
 const as=async who=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);await db.exec('set role authenticated');};
 const stamp=async run=>(await db.query('select updated_at::text stamp from run_plans where id=$1',[run])).rows[0].stamp;
 const content={title:'Edited',points:[{x:1,y:1},{x:90,y:90}],image_data_url:'photo',notes:'New timing'};
 const save=(run,version)=>db.query('select save_shared_run_edits($1,$2,$3) result',[run,version,JSON.stringify(content)]);
 for(const actor of [rider,coach]){
  await as(actor);
  for(const run of [id(10),id(11)]){
   const before=await stamp(run);await save(run,before);assert.notEqual(await stamp(run),before);
   await assert.rejects(()=>save(run,before),/run changed/);
   for(const field of ['athlete_id','coach_id','created_by'])await assert.rejects(()=>db.query(`update run_plans set ${field}=$1 where id=$2`,[stranger,run]),/original rider and coach/);
  }
 }
 const latest=await stamp(id(11));
 for(const actor of [stranger,parent]){await as(actor);assert.equal((await db.query('select * from run_plans')).rows.length,0);await assert.rejects(()=>save(id(11),latest),/no longer available/);}
 await db.exec('reset role');await db.exec('delete from coach_athletes');await as(coach);await assert.rejects(()=>save(id(11),latest),/no longer available/);
 await as(rider);await save(id(11),latest);
 assert.equal((await db.query('select created_by from run_plans where id=$1',[id(11)])).rows[0].created_by,coach);
 assert.equal((await db.query('select count(*)::int n from run_plans')).rows[0].n,2,'Edits update existing runs without duplicates');
 assert.equal((await db.query("select has_function_privilege('anon','save_shared_run_edits(uuid,timestamptz,jsonb)','execute') allowed")).rows[0].allowed,false);
 await db.close();
 // Exercise the actual UI handlers with a fresh single-run response and wrong prior rider selection.
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
 const run={id:id(11),athlete_id:rider,coach_id:coach,created_by:coach,updated_at:'2026-09-10T00:00:00.123456Z',title:'Finals',points:content.points,image_data_url:'photo'};
 const state={user:{id:rider},profile:{role:'athlete'},selectedAthleteId:stranger};let rpcCall=null,queryId=null,saveError=null;
 const ctx=vm.createContext({escapeHtml:String,dateLabel:()=>"",runMapHtml:()=>"",runReviewPanelHtml:()=>"",runPlaybackControlsHtml:()=>"",state,liveRun:null,runUndoStack:[],runRedoStack:[],isCoachRole:r=>r==='coach',setButtonBusy:()=>()=>{},withTimeout:async p=>p,runView:v=>v||{},closeContestEventModal:()=>{},navigate:async()=>{},document:{querySelector:()=>null},notify:()=>{},messageFrom:e=>e.message,runBuilderRefreshView:async()=>{},cacheClear:()=>{},setSyncStatus:()=>{},runBuilderStage:()=> 'playback',FormData:class{get(k){return k==='title'?'Edited':'Notes';}},client:{from:()=>({select(){return this},eq(k,v){queryId=v;return this},single:async()=>({data:run})}),rpc:async(name,args)=>{rpcCall={name,args};return {error:saveError};}}});
 vm.runInContext(['coachEventRunViewerHtml','canEditRun','editRunPlan','saveRunPlan'].map(extract).join('\n'),ctx);
 assert(vm.runInContext(`canEditRun(${JSON.stringify(run)})`,ctx),'Rider can edit coach-created run');
 assert(ctx.coachEventRunViewerHtml([run]).includes('data-edit-run='));
 state.profile.role='parent';assert(!ctx.coachEventRunViewerHtml([run]).includes('data-edit-run='));assert.equal(vm.runInContext(`canEditRun(${JSON.stringify(run)})`,ctx),false);
 for(const actor of [rider,coach]){
  state.user.id=actor;state.profile.role=actor===coach?'coach':'athlete';
  await ctx.editRunPlan({currentTarget:{dataset:{editRun:run.id}}});assert.equal(queryId,run.id);assert.equal(state.runBuilder.athleteId,rider);assert.equal(state.runBuilder.updatedAt,run.updated_at);
  await ctx.saveRunPlan({preventDefault(){},currentTarget:{}});assert.equal(rpcCall.name,'save_shared_run_edits');assert.equal(rpcCall.args.p_run_id,run.id);assert.equal(rpcCall.args.p_expected_updated_at,run.updated_at);assert.equal(rpcCall.args.p_content.athlete_id,rider);assert.equal(state.runBuilder,null);
 }
 await ctx.editRunPlan({currentTarget:{dataset:{editRun:run.id}}});saveError={message:'This run changed'};await ctx.saveRunPlan({preventDefault(){},currentTarget:{}});assert(state.runBuilder,'Stale-save failure retains the local edits');
 console.log('PASS: rider/coach edits of either creator, preserved identity, fresh exact-run loading, stale-save protection, denied outsiders/parents/unlinked coaches, no duplicate saves and retained failed drafts.');
})().catch(e=>{console.error(e);process.exit(1);});
