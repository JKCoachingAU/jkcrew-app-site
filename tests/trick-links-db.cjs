// Execute real production SQL with synthetic data in an isolated PostgreSQL-compatible DB.
// No network access or live rider mutations. Run with JKCREW_PGLITE_PATH set when needed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');
const {initialize,id,partialMigration}=require('./daily-partial-db.cjs');
const root=path.resolve(__dirname,'..');
const migrationName='20261101114201_add_trick_links_training_category.sql';
const read=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/trick-links-production-functions.json'),'utf8')).functions;
function extract(source,name){const start=source.search(new RegExp(`create (?:or replace )?function ${name.replaceAll('.','\\.')}\\(`,'i'));assert(start>=0,name);const tail=source.slice(start),m=tail.match(/\bas\s+(\$[a-z_]*\$)/i);return tail.slice(0,tail.indexOf(m[1],m.index+m[0].length)+m[1].length)+';';}
async function run(){
 const db=new PGlite();let checks=0;
 const q=async(s,a=[]) => (await db.query(s,a)).rows;
 const scalar=async(s,a=[])=>Object.values((await q(s,a))[0])[0];
 const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const ok=(a,label)=>{assert(a,label);checks++;};
 const denied=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
 const rpc=(n,a=[])=>scalar(`select public.${n}(${a.map((_,i)=>'$'+(i+1)).join(',')})`,a);
 const actor=async(n,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec('set role '+role);};
 const inspect=async fn=>{const role=await scalar('select current_user');await db.exec('reset role');try{return await fn();}finally{if(['authenticated','anon','service_role'].includes(role))await db.exec('set role '+role);}};
 const get=(s,a=[])=>inspect(()=>scalar(s,a));
 const rows=(s,a=[])=>inspect(()=>q(s,a));
 try{
  await initialize(db);await db.exec(read(partialMigration));
  await db.exec(`
   create table coach_venues(id uuid primary key default gen_random_uuid(),coach_id uuid,name text,sort_order integer);
   create table weekly_assignment_plans(id uuid primary key default gen_random_uuid(),coach_id uuid,athlete_id uuid,target_week_start date,trick_name text,category text,target_reps integer,notes text,sort_order integer,venue text,status text,created_at timestamptz default now(),updated_at timestamptz default now(),published_at timestamptz);
   create table trick_requests(id uuid primary key default gen_random_uuid(),athlete_id uuid,coach_id uuid,target_week_start date,trick_name text,category text,notes text,venue text,status text default 'pending',planned_assignment_id uuid,reviewed_by uuid,reviewed_at timestamptz,updated_at timestamptz default now());
   create table weekly_challenges(id uuid primary key default gen_random_uuid(),title text,description text,category text,target_count integer,audience_group text,starts_at timestamptz,ends_at timestamptz,created_by uuid,status text default 'active');
   create table rider_sheet_proposals(id uuid primary key default gen_random_uuid(),athlete_id uuid,coach_id uuid,week_start date,title text,venue text,items jsonb,status text default 'pending',coach_note text,reviewed_by uuid,reviewed_at timestamptz,updated_at timestamptz default now());
   create table private.rider_sheet_replacement_backups(proposal_id uuid,assignment_id uuid,assignment jsonb,assignment_progress jsonb,assignment_attempts jsonb,percentage_attempts jsonb,assignment_point_awards jsonb,xp_ledger jsonb,primary key(proposal_id,assignment_id));
   alter table weekly_trick_assignments add constraint weekly_trick_assignments_category_check check(category in ('daily','one_bang','dialled','percentage','foam_pit','bonus','lines'));
   alter table weekly_assignment_plans add constraint weekly_assignment_plans_category_check check(category in ('daily','one_bang','dialled','percentage','foam_pit','bonus','lines'));
   alter table trick_requests add constraint trick_requests_category_check check(category in ('daily','one_bang','dialled','percentage'));
   alter table weekly_challenges add constraint weekly_challenges_category_check check(category in ('daily','one_bang','dialled','percentage','foam_pit','bonus','lines'));
   alter table weekly_trick_assignments add unique(coach_id,athlete_id,week_start,sort_order);
  `);
  await db.exec(`
   alter table weekly_challenges add column completion_rule text default 'standard',add column reward_points integer default 5,add column created_at timestamptz default now();
   create table coach_athlete_groups(coach_id uuid,athlete_id uuid,group_name text);
   create table private.rider_feature_access(athlete_id uuid primary key,features_disabled boolean default false);
   create table weekly_challenge_completions(challenge_id uuid references weekly_challenges,athlete_id uuid references profiles,awarded_at timestamptz default now(),primary key(challenge_id,athlete_id));
   create function private.activate_due_weekly_challenges() returns integer language sql as $$select 0$$;
  `);
  await db.exec(read('20261002080137_auto_award_weekly_challenge_rewards.sql'));
  await db.exec(extract(read('20261004132236_carry_weekly_lists_into_coach_session_viewer.sql'),'public.ensure_current_week_assignments'));
  await db.exec("create table private.progression_feature_settings(singleton boolean primary key,xp_enabled boolean);insert into private.progression_feature_settings values(true,false);");
  await db.exec(extract(read('20261029113237_pause_xp_and_badge_progression.sql'),'private.xp_progression_enabled'));
  for(const fn of fixture)await db.exec(fn.definition);
  // Exercise authenticated API calls and verify the migration never widens grants.
  for(const fn of fixture.filter(f=>!f.signature.startsWith('private.')))await db.exec(`revoke all on function ${fn.signature} from public,anon;grant execute on function ${fn.signature} to authenticated;`);
  await q("insert into profiles(id,role,display_name,xp_total) values($1,'coach','Coach',100),($2,'athlete','Rider',100),($3,'parent','Parent',0),($4,'athlete','Other rider',0),($5,'coach','Unlinked coach',0)",[1,2,3,4,5].map(id));
  await q('insert into coach_athletes values($1,$2)',[id(1),id(2)]);await q('insert into parent_athletes values($1,$2)',[id(3),id(2)]);
  await q("insert into training_sessions(id,athlete_id,started_at,daily_venue) values($1,$2,now()-interval '10 minutes','Park A')",[id(20),id(2)]);
  await q("insert into xp_ledger(athlete_id,source_type,source_id,xp) values($1,'historical','before',100)",[id(2)]);
  const week=await scalar("select week_start_date::text from jkcrew_week_bounds('AU')");
  const offset=async(n)=>scalar('select ($1::date+$2::integer)::text',[week,n]);
  const link={trick_name:' X-up -> Tailwhip ',category:'trick_links',target_reps:99};
  await actor(1);
  await denied(()=>rpc('save_weekly_assignment_list',[id(2),week,'trick_links','',[link]]),/Unsupported trick list/);
  await denied(()=>inspect(()=>q("insert into weekly_trick_assignments(athlete_id,week_start,trick_name,category) values($1,$2,'A → B','trick_links')",[id(2),week])),/category_check/);
  const historyBefore=await rows('select id,xp_total,level from profiles order by id'),xpBefore=await rows('select * from xp_ledger order by id');
  const aclBefore=await rows("select oid::regprocedure::text as signature,proacl::text from pg_proc where oid in (select oid from pg_proc where proname in ('record_assignment_action','save_weekly_assignments','rider_sheet_items_are_complete')) order by signature");
  await inspect(()=>db.exec(read(migrationName)));
  eq(await rows('select id,xp_total,level from profiles order by id'),historyBefore,'Migration preserves account history');
  eq(await rows('select * from xp_ledger order by id'),xpBefore,'Migration preserves existing XP');
  eq(await rows("select oid::regprocedure::text as signature,proacl::text from pg_proc where oid in (select oid from pg_proc where proname in ('record_assignment_action','save_weekly_assignments','rider_sheet_items_are_complete')) order by signature"),aclBefore,'Existing RPC grants unchanged');
  eq(await rpc('save_weekly_assignment_list',[id(2),week,'trick_links','',[link,{trick_name:'x-up → tailwhip'}]]),1,'Duplicate pair normalized into one weekly assignment');
  let assignment= (await rows("select * from weekly_trick_assignments where category='trick_links'"))[0];
  eq(assignment.trick_name,'X-up → Tailwhip');eq(assignment.target_reps,1,'Pair needs one combined completion');
  eq(await rpc('save_weekly_assignment_list',[id(2),week,'trick_links','',[link]]),1);
  eq(await get("select id from weekly_trick_assignments where category='trick_links'"),assignment.id,'Repeated saves retain assignment ID and completion');
  for(const bad of ['Barspin','A →','→ B','A → B → C','A -> B -> C','A → B -> C','A'.repeat(119)+' → B','',null]){
   await denied(()=>rpc('save_weekly_assignment_list',[id(2),week,'trick_links','',[{trick_name:bad}]]),/Enter two tricks/);
   eq(await get("select trick_name from weekly_trick_assignments where id=$1",[assignment.id]),assignment.trick_name,'Invalid pair leaves list intact');
  }
  await denied(()=>inspect(()=>q("insert into trick_requests(athlete_id,category,trick_name) values($1,'trick_links','Only one')",[id(2)])),/trick_link_pair_check/);
  await actor(2);let result=await rpc('record_assignment_action',[assignment.id,'landed']);eq(result.points_awarded,2);eq(result.message,'Trick Link complete');
  const completed=result.completed_at;
  eq((await rpc('record_assignment_action',[assignment.id,'landed'])).points_awarded,0,'Retry awards no extra points');
  eq(await get("select count(*)::int from trick_attempts where category='trick_links'"),1,'Retry creates no duplicate session receipt');
  eq(await get('select total_points from training_sessions where id=$1',[id(20)]),2);
  eq(await get("select sum(points)::int from assignment_point_awards where athlete_id=$1",[id(2)]),2);
  eq((await rpc('record_assignment_action',[assignment.id,'landed'])).completed_at,completed,'Retry keeps completion time');
  eq(await get("select count(*)::int from tricktionary_landing_history where athlete_id=$1 and category='trick_links' and landed_count>0",[id(2)]),1,'Link is kept in landed history');
  eq((await rpc('get_today_training_progress',[id(2)])).today_points,2,'Today includes ordinary link points');
  // Exact source used by the park crown includes the new pair's two points.
  await inspect(()=>q("update assignment_point_awards set venue='Park A' where assignment_id=$1",[assignment.id]));
  eq(await get("select points from private.jkcrew_current_park_king('Park A')"),2,'Park score includes a completed Trick Link');
  for(const n of [3,4,5]){await actor(n);await denied(()=>rpc('record_assignment_action',[assignment.id,'landed']),/cannot update/);}
  await actor(null,'anon');await denied(()=>rpc('record_assignment_action',[assignment.id,'landed']),/permission denied/);
  await actor(null);await denied(()=>rpc('record_assignment_action',[assignment.id,'landed']),/Sign in required/);
  await actor(1);eq((await rpc('record_assignment_action',[assignment.id,'unlanded'])).points_removed,2,'Linked coach can correct completion');
  eq(await get('select total_points from training_sessions where id=$1',[id(20)]),0);eq(await get("select count(*)::int from trick_attempts where category='trick_links'"),0);
  eq((await rpc('record_assignment_action',[assignment.id,'unlanded'])).points_removed,0,'Undo retry is idempotent');
  await actor(2);eq((await rpc('record_assignment_action',[assignment.id,'landed'])).points_awarded,2,'Corrected pair can earn exactly two again');
  // Undo after opening a later session still removes the original session receipt.
  await inspect(()=>q("update training_sessions set ended_at=now() where id=$1;",[id(20)]));
  await inspect(()=>q('insert into training_sessions(id,athlete_id) values($1,$2)',[id(21),id(2)]));
  eq((await rpc('record_assignment_action',[assignment.id,'unlanded'])).points_removed,2);
  eq(await get('select total_points from training_sessions where id=$1',[id(20)]),0);eq(await get("select count(*)::int from trick_attempts where category='trick_links'"),0,'Original session receipt removed');
  await actor(1);await q('select * from set_rider_scoring_pause($1,true)',[id(2)]);await actor(2);
  await denied(()=>rpc('record_assignment_action',[assignment.id,'landed']),error=>error.code==='42501');
  await actor(1);await q('select * from set_rider_scoring_pause($1,false)',[id(2)]);await actor(2);
  eq((await rpc('record_assignment_action',[assignment.id,'landed'])).points_awarded,2);
  await actor(1);
  for(const [category,points] of [['one_bang',2],['dialled',2],['bonus',5],['foam_pit',0]]){
   await rpc('save_weekly_assignment_list',[id(2),week,category,'',[{trick_name:category+' trick'}]]);
   const other=await get('select id from weekly_trick_assignments where category=$1',[category]);
   eq((await rpc('record_assignment_action',[other,'landed'])).points_awarded,points,category+' still scores unchanged');
  }
  eq(await rows('select * from xp_ledger order by id'),xpBefore,'Links and other completions do not resume paused XP');
  eq(await rows('select id,xp_total,level from profiles order by id'),historyBefore,'Levels remain paused');
  // All scheduling routes accept and canonicalize a full pair before any truncation.
  const next=await offset(7),following=await offset(14),later=await offset(21);
  eq(await rpc('save_weekly_assignment_draft',[id(2),next,[link],null]),1);
  eq(await get("select trick_name from weekly_assignment_plans where target_week_start=$1 and status='draft_next_week'",[next]),'X-up → Tailwhip');
  await denied(()=>rpc('save_weekly_assignment_draft',[id(2),next,[{...link,trick_name:'A ->'}],null]),/Enter two tricks/);
  eq(await get("select count(*)::int from weekly_assignment_plans where target_week_start=$1 and status='draft_next_week'",[next]),1,'Failed draft preserves previous draft');
  eq(await rpc('save_weekly_assignment_plan',[id(2),following,[link],null]),1);
  eq(await get("select target_reps from weekly_assignment_plans where target_week_start=$1 and status='scheduled_next_week'",[following]),1);
  eq(await rpc('save_weekly_assignments',[id(2),later,[link],null]),1);
  await denied(()=>rpc('save_weekly_assignments',[id(2),later,[{...link,trick_name:'A'.repeat(119)+' -> B'}],null]),/Enter two tricks/);
  eq(await get('select trick_name from weekly_trick_assignments where athlete_id=$1 and week_start=$2',[id(2),later]),'X-up → Tailwhip','Full save cannot silently truncate pair');
  eq(await rpc('ensure_weekly_assignment_draft',[id(2),await offset(28)]),1,'Draft carry includes Trick Links');
  // Scheduled activation creates fresh assignments and never inherits completion.
  eq(await rpc('ensure_current_week_assignments',[id(2),following]),1);
  const carried=(await rows('select * from weekly_trick_assignments where week_start=$1',[following]))[0];
  ok(carried.id!==assignment.id);eq(carried.category,'trick_links');
  eq(await get('select count(*)::int from assignment_progress where assignment_id=$1',[carried.id]),0);
  ok(await get('select completed_at is not null from assignment_progress where assignment_id=$1',[assignment.id]),'Prior week completion retained');
  // Optional request fields do not change the existing required 27-item sheet.
  const sheet=Object.entries({daily:10,one_bang:5,dialled:5,percentage:3,lines:3,bonus:1}).flatMap(([category,n])=>Array.from({length:n},(_,i)=>({category,trick_name:`${category} ${i+1}`})));
  eq(await rpc('rider_sheet_items_are_complete',[sheet]),true);
  eq(await rpc('rider_sheet_items_are_complete',[[...sheet,link]]),true);
  eq(await rpc('rider_sheet_items_are_complete',[[...sheet,{...link,trick_name:'A'}]]),false);
  eq(await rpc('rider_sheet_items_are_complete',[[...sheet.slice(1),link]]),false,'Links cannot replace required Dailys');
  const proposal=async(items)=>inspect(()=>scalar('insert into rider_sheet_proposals(athlete_id,coach_id,week_start,items) values($1,$2,$3,$4) returning id',[id(2),id(1),week,JSON.stringify(items)]));
  let p=await proposal(sheet);eq((await rpc('review_edited_rider_sheet_proposal',[p,'My list','Park A',sheet,''])).status,'accepted');
  eq(await get('select id from weekly_trick_assignments where athlete_id=$1 and week_start=$2 and category=\'trick_links\'',[id(2),week]),assignment.id,'27-item request preserves existing optional coach link');
  p=await proposal([...sheet,{...link,trick_name:'Manual -> Barspin'}]);
  eq((await rpc('review_edited_rider_sheet_proposal',[p,'My list','Park A',[...sheet,{...link,trick_name:'Manual -> Barspin'}],''])).status,'accepted');
  eq(await get('select trick_name from weekly_trick_assignments where athlete_id=$1 and week_start=$2 and category=\'trick_links\'',[id(2),week]),'Manual → Barspin','Optional proposed link saves normally');
  const req=await inspect(()=>scalar("insert into trick_requests(athlete_id,target_week_start,category,trick_name) values($1,$2,'trick_links','Manual -> Barspin') returning id",[id(2),next]));
  const planId=await rpc('accept_trick_request_into_plan',[req]);eq(await rpc('accept_trick_request_into_plan',[req]),planId,'Accept retry returns same planned pair');
  eq(await get('select trick_name from weekly_assignment_plans where id=$1',[planId]),'Manual → Barspin');
  const challengeId=await rpc('create_weekly_challenge',['Linked up','Complete pairs','trick_links',2,null]);
  ok(challengeId,'Coach may choose links for a weekly challenge');
  await rpc('save_weekly_assignment_list',[id(2),week,'trick_links','',[{trick_name:'Manual -> Barspin'},{trick_name:'X-up -> Tailwhip'}]]);
  const challengeLinks=await rows("select id from weekly_trick_assignments where athlete_id=$1 and week_start=$2 and category='trick_links' order by sort_order",[id(2),week]);
  await actor(2);
  // A failed point write must roll back progress and let the same input retry.
  await inspect(()=>db.exec(`create function private.fail_link_award() returns trigger language plpgsql as $$begin if new.award_key like 'trick_links:%' then raise exception 'Simulated link save failure';end if;return new;end$$;
    create trigger fail_link_award before insert on assignment_point_awards for each row execute function private.fail_link_award();`));
  await denied(()=>rpc('record_assignment_action',[challengeLinks[0].id,'landed']),/Simulated link save failure/);
  eq(await get('select count(*)::int from assignment_progress where assignment_id=$1 and completed_at is not null',[challengeLinks[0].id]),0,'Failed save rolls back completion');
  eq(await get('select count(*)::int from weekly_challenge_completions where challenge_id=$1',[challengeId]),0,'Failed save cannot award challenge');
  await inspect(()=>db.exec('drop trigger fail_link_award on assignment_point_awards'));
  eq((await rpc('record_assignment_action',[challengeLinks[0].id,'landed'])).points_awarded,2,'Failed save can retry safely');
  eq(await get('select count(*)::int from weekly_challenge_completions where challenge_id=$1',[challengeId]),0,'One complete pair counts as one challenge item');
  eq((await rpc('record_assignment_action',[challengeLinks[1].id,'landed'])).points_awarded,2,'Second pair earns exactly two base points');
  eq(await get('select count(*)::int from weekly_challenge_completions where challenge_id=$1',[challengeId]),1,'Second pair completes a two-pair challenge');
  eq(await get("select sum(points)::int from leaderboard_point_adjustments where reason=$1",['Weekly challenge '+challengeId+' completed']),5,'Separate normal weekly challenge reward remains intact');
  eq((await rpc('record_assignment_action',[challengeLinks[1].id,'landed'])).points_awarded,0);
  eq(await get('select count(*)::int from weekly_challenge_completions where challenge_id=$1',[challengeId]),1,'Retry cannot duplicate challenge bonus');
  await actor(3);await denied(()=>rpc('save_weekly_assignment_list',[id(2),week,'trick_links','',[link]]),/Only coaches/);
  await actor(5);await denied(()=>rpc('save_weekly_assignment_list',[id(2),week,'trick_links','',[link]]),/not linked/);
  console.log(`PASS: ${checks} Trick Links validation, optional proposals, 2-point scoring, retries, undo, session receipts, permissions, paused XP, scheduling, rollover, history and park-score checks.`);
 }finally{await db.close();}
}
if(require.main===module)run().catch(e=>{console.error(e.stack,e.where||'');process.exitCode=1;});
module.exports={run,migrationName};
