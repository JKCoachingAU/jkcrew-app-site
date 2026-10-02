// Isolated Postgres regression. Synthetic fixtures only; no production connection.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
const migration=read('20261002235311_crew_chat_milestones_only.sql');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const between=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
async function initialize(db){
 await db.exec(`create schema private;create schema auth;create schema vault;create role anon;create role authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;
 create table profiles(id uuid primary key,display_name text,role text default 'athlete',country_code text default 'AU',ghost_mode boolean default false,avatar jsonb);
 create table crew_posts(id uuid primary key default gen_random_uuid(),author_id uuid references profiles,body text,post_type text,metadata jsonb default '{}',created_at timestamptz default now());
 create table trick_attempts(id uuid primary key default gen_random_uuid(),athlete_id uuid,trick_name text,status text,points integer,created_at timestamptz default now());
 create table park_king_events(id uuid default gen_random_uuid(),athlete_id uuid,display_name text,venue_name text);
 create table assignment_point_awards(id uuid primary key default gen_random_uuid(),athlete_id uuid,session_id uuid,points integer,created_at timestamptz default now());
 create table training_sessions(id uuid primary key default gen_random_uuid(),athlete_id uuid,total_points integer,started_at timestamptz default now());
 create table leaderboard_point_adjustments(id uuid primary key default gen_random_uuid(),athlete_id uuid,points integer,week_start date,reason text,created_at timestamptz default now());
 create table leaderboard_rank_snapshots(athlete_id uuid primary key,week_start date,rank_number bigint,weekly_points bigint,weekly_started boolean,updated_at timestamptz);
 create table push_preferences(user_id uuid primary key,leaderboard_overtaken boolean default true,crew_chat boolean default true);
 create table push_subscriptions(user_id uuid,enabled boolean);
 create table push_notification_queue(recipient_id uuid,notification_type text,title text,body text,url text,payload jsonb,dedupe_key text unique);
 create table weekly_challenges(id uuid primary key,title text);
 create table weekly_challenge_completions(challenge_id uuid,athlete_id uuid,awarded_at timestamptz default now(),primary key(challenge_id,athlete_id));
 create table weekly_rider_battles(id uuid primary key,status text default 'accepted',winning_team integer,winner_id uuid);
 create table weekly_rider_battle_participants(battle_id uuid,athlete_id uuid,team_number integer,is_winner boolean,points_delta integer default 0,primary key(battle_id,athlete_id));
 `);
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/daily-production-functions.json'),'utf8')).functions;
 for(const signature of ['jkcrew_country_timezone(text)','jkcrew_week_bounds(text,timestamp with time zone)'])await db.exec(fixture.find(f=>f.signature===signature).definition);
 const push=read('202607181200_add_web_push_notifications.sql');
 await db.exec(between(push,'create or replace function private.jkcrew_current_push_rankings()','create or replace function private.refresh_jkcrew_leaderboard_push_snapshots('));
 await db.exec(read('202607181300_harden_push_leaderboard_trigger.sql'));
 await db.exec(between(push,'create or replace function private.queue_jkcrew_chat_push()','create or replace function private.jkcrew_points_for_window('));
 await db.exec(between(read('202609031200_upgrade_crew_chat.sql'),'create or replace function private.jkcrew_moderate_crew_post()','alter table public.crew_posts replica identity'));
 await db.exec(read('202609031230_add_crew_achievement_events.sql'));
 await db.exec(read('202609031300_add_crew_ranking_events.sql'));
 await db.exec(read('202606071350_public_chat_sender_names.sql'));
 await db.exec(`create trigger score_snapshot after insert or update or delete on assignment_point_awards for each row execute function private.handle_jkcrew_leaderboard_push_change();
 create trigger adjustment_snapshot after insert or update or delete on leaderboard_point_adjustments for each row execute function private.handle_jkcrew_leaderboard_push_change();`);
}
async function run(){const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');const db=new PGlite();let checks=0;
 const q=(s,a=[])=>db.query(s,a);const value=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
 const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const events=()=>value("select coalesce(jsonb_agg(jsonb_build_object('author',author_id,'type',metadata->>'event_type','body',body,'metadata',metadata) order by created_at,id),'[]') from crew_posts where metadata->>'event_type' in ('rank_one','leaderboard_overtake','challenge_complete','battle_result')");
 const count=()=>value('select count(*)::int from crew_posts');
 const reset=async()=>{await db.exec('truncate assignment_point_awards,leaderboard_point_adjustments,leaderboard_rank_snapshots,private.crew_leaderboard_snapshots,crew_posts,private.crew_milestone_receipts,push_notification_queue,weekly_challenge_completions,weekly_challenges,weekly_rider_battle_participants,weekly_rider_battles');await q("update profiles set ghost_mode=false,display_name=case id when $1 then 'Ava' when $2 then 'Bea' when $3 then 'Cam' else 'Dee' end",[id(1),id(2),id(3)]);};
 const baseline=async(scores=[30,20,10,0])=>{await db.exec('alter table assignment_point_awards disable trigger score_snapshot;alter table assignment_point_awards disable trigger crew_rank_awards_milestone');for(let i=0;i<scores.length;i++)if(scores[i])await q('insert into assignment_point_awards(athlete_id,points) values($1,$2)',[id(i+1),scores[i]]);await db.exec('alter table assignment_point_awards enable trigger score_snapshot;alter table assignment_point_awards enable trigger crew_rank_awards_milestone');await q("select private.refresh_crew_milestone_snapshots($1,'seed')",[id(1)]);await db.exec('truncate crew_posts,private.crew_milestone_receipts,push_notification_queue');};
 const score=(r,p)=>q('insert into assignment_point_awards(athlete_id,points) values($1,$2)',[id(r),p]);
 const scenario=async(name,fn)=>{await reset();await fn();console.log('PASS '+name);};
 const battle=async(n,teams,winningTeam)=>{await q('insert into weekly_rider_battles(id) values($1)',[id(n)]);for(const [r,team,delta]of teams)await q('insert into weekly_rider_battle_participants(battle_id,athlete_id,team_number,is_winner,points_delta) values($1,$2,$3,$4,$5)',[id(n),id(r),team,winningTeam===null?null:team===winningTeam,delta]);};
 const finish=(n,win)=>q("update weekly_rider_battles set status='completed',winning_team=$2 where id=$1",[id(n),win]);
 try{
 await initialize(db);for(let n=1;n<=4;n++)await q('insert into profiles(id,display_name) values($1,$2)',[id(n),['Ava','Bea','Cam','Dee'][n-1]]);
 await q("insert into crew_posts(author_id,body,post_type,metadata) values($1,'Barspin landed','announcement','{\"event_type\":\"new_trick\"}')",[id(1)]);eq(await count(),1,'Existing per-trick automatic history');
 await q("insert into crew_posts(author_id,body,post_type) values($1,'Hello crew','chat')",[id(1)]);const before=await count();
 await db.exec(migration);eq(await count(),before,'Migration preserves all history');eq(await value('select count(*)::int from assignment_point_awards'),0,'Migration never awards points');
 await q("insert into trick_attempts(athlete_id,trick_name,status,points) values($1,'Tailwhip','landed',2)",[id(1)]);await q("insert into park_king_events(athlete_id,display_name,venue_name) values($1,'Ava','Park')",[id(1)]);eq(await count(),before,'New tricks and park kings no longer post');
 await q("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);eq((await q('select body from get_crew_feed()')).rows,[{body:'Hello crew'}],'Feed excludes old automatic tricks and landed union, retains manual chat');
 await scenario('genuine overtake, strict tie handling and one new-leader event',async()=>{
  await baseline();await score(3,5);eq(await count(),0,'Points with no movement silent');await score(3,5);eq(await count(),0,'Equal points silent');await score(3,1);let e=await events();eq(e.length,1);eq(e[0].type,'leaderboard_overtake');eq(e[0].metadata.overtaken,[{athlete_id:id(2),name:'Bea'}]);
  await score(3,10);e=await events();eq(e.length,2);eq(e[1].type,'rank_one','Becoming leader emits no duplicate overtake');eq(e[1].metadata.rank,1);
  await q("select private.refresh_crew_milestone_snapshots($1,'repeat')",[id(3)]);eq(await count(),2,'Unchanged retry silent');await score(3,2);eq(await count(),2,'Leader scoring again silent');
 });
 await scenario('first positive score announces one leader; seed/reset/negative/name changes silent',async()=>{
  await baseline([0,0,0,0]);await score(1,1);eq((await events()).map(e=>e.type),['rank_one'],'First earning leader, even already alphabetic #1');
  await reset();await baseline();await q("update profiles set display_name='Aaron' where id=$1",[id(3)]);await q("select private.refresh_crew_milestone_snapshots($1,'rename')",[id(3)]);eq(await count(),0);
  await score(1,-25);eq(await count(),0,'Another rider losing points is not a scored overtake');
  await reset();await baseline([0,0,0,0]);await q('update private.crew_leaderboard_snapshots set week_start=week_start-7');await score(3,0);eq(await count(),0,'Zero-point reset cannot announce leader');
  await db.exec('truncate private.crew_leaderboard_snapshots');await q("select private.refresh_crew_milestone_snapshots($1,'reseed')",[id(3)]);eq(await count(),0,'Rebuild cannot replay existing winners');
 });
 await scenario('first real points after local weekly reset produce one true new leader',async()=>{
  await baseline([0,0,0,0]);await q('update private.crew_leaderboard_snapshots set week_start=week_start-7,weekly_points=100');
  await score(2,2);eq((await events()).map(e=>[e.author,e.type]),[[id(2),'rank_one']]);
  await reset();await baseline([0,0,0,0]);await q('update private.crew_leaderboard_snapshots set week_start=week_start-7,weekly_points=100');
  await q('insert into assignment_point_awards(athlete_id,points) values($1,1),($2,3)',[id(2),id(3)]);
  eq((await events()).map(e=>[e.author,e.type]),[[id(3),'rank_one']],'Multirow reset awards announce only the final leader');
 });
 await scenario('a transaction announces its final score, never transient ties or intermediate leaders',async()=>{
  await baseline([30,20,10,0]);await db.exec('begin');await score(3,25);await score(2,30);eq(await count(),0,'Deferred until transaction completion');await db.exec('commit');
  eq((await events()).map(e=>[e.author,e.type]).sort(),[[id(2),'rank_one'],[id(3),'leaderboard_overtake']]);
  await reset();await baseline();await db.exec('begin');await score(3,100);await db.exec('rollback');eq(await count(),0,'Rolled-back landing announces nothing');eq(await value('select count(*)::int from private.crew_milestone_receipts'),0);
 });
 await scenario('newly created rider can become leader on their first landed trick',async()=>{
  await baseline();await q("insert into profiles(id,display_name) values($1,'New rider')",[id(5)]);eq(await count(),0,'Profile registration stays silent');
  await score(5,40);eq((await events()).map(e=>[e.author,e.type]),[[id(5),'rank_one']]);
  await db.exec('truncate crew_posts');await q('delete from profiles where id=$1',[id(5)]);
 });
 await scenario('multirow score statement compares every rider before replacing snapshot',async()=>{
  await baseline([40,30,10,0]);await q('insert into assignment_point_awards(athlete_id,points) values($1,25),($2,32)',[id(3),id(4)]);
  const e=await events();eq(e.length,2,'Both legitimate overtakes are retained');eq(e.map(x=>x.author).sort(),[id(3),id(4)]);eq(e.every(x=>x.type==='leaderboard_overtake'),true);
  await q("select private.refresh_crew_milestone_snapshots($1,'retry')",[id(4)]);eq(await count(),2);
 });
 await scenario('multiple overtakes condensed and ghost riders remain private',async()=>{
  await baseline();await score(4,25);let e=await events();eq(e.length,1);eq(e[0].metadata.overtaken.length,2);eq(e[0].body.includes('2 riders'),true);
  await q('update profiles set ghost_mode=true where id=$1',[id(2)]);await score(2,100);eq(await count(),1,'Hidden rider cannot announce leaderboard movement');
  await q('insert into weekly_challenges values($1,$2)',[id(50),'Weekly Challenge']);await q('insert into weekly_challenge_completions(challenge_id,athlete_id) values($1,$2)',[id(50),id(2)]);eq(await count(),1,'Hidden challenge completion silent');
 });
 await scenario('completed weekly challenge once; pending and retries do not announce',async()=>{
  await q('insert into weekly_challenges values($1,$2)',[id(50),'Weekly Challenge']);eq(await count(),0);await q('insert into weekly_challenge_completions(challenge_id,athlete_id) values($1,$2) on conflict do nothing',[id(50),id(1)]);await q('insert into weekly_challenge_completions(challenge_id,athlete_id) values($1,$2) on conflict do nothing',[id(50),id(1)]);eq((await events()).map(e=>e.type),['challenge_complete']);
  await db.exec('delete from weekly_challenge_completions');await q('insert into weekly_challenge_completions(challenge_id,athlete_id) values($1,$2)',[id(50),id(1)]);eq(await count(),1,'Private receipt also prevents delete/reinsert administrative retry');
 });
 await scenario('2v1 persisted battle payouts and retry, cancel, draw and three teams',async()=>{
  await battle(60,[[1,1,3],[2,1,2],[3,2,-5]],1);await finish(60,1);let e=await events();eq(e.length,1);eq(e[0].type,'battle_result');eq(e[0].metadata.participants.map(p=>p.points_delta),[3,2,-5]);eq(e[0].body,'Ava + Bea won the battle! +5 points awarded to the winning team.');await finish(60,1);eq(await count(),1);
  await q("update weekly_rider_battles set status='accepted' where id=$1",[id(60)]);await finish(60,1);eq(await count(),1,'Replayed result is idempotent');
  await battle(61,[[1,1,0],[2,2,0]],null);await finish(61,null);e=await events();eq(e.length,2);eq(e[1].body,'Ava + Bea finished their battle in a draw. No points changed hands.');
  await battle(62,[[1,1,-5],[2,2,10],[3,3,-5]],2);await finish(62,2);e=await events();eq(e[2].metadata.winning_team,2);eq(e[2].body,'Bea won the battle! +10 points awarded to the winning team.');
  await battle(63,[[1,1,0],[2,2,0]],null);await q("update weekly_rider_battles set status='cancelled' where id=$1",[id(63)]);eq(await count(),3,'Cancelled battle not a result');
  eq(await value('select sum(points_delta)::int from weekly_rider_battle_participants'),0,'Result writing never changes payout ledger');
 });
 await scenario('hidden battle participant, bounded long-name messages, automatic failure never blocks completion',async()=>{
  await q('update profiles set ghost_mode=true where id=$1',[id(2)]);await battle(60,[[1,1,5],[2,2,-5]],1);await finish(60,1);eq(await count(),0,'No result leaks hidden participant');
  await q("update profiles set ghost_mode=false,display_name=repeat('Long Rider Name ',50)");await battle(61,[[1,1,3],[2,1,2],[3,2,-5]],1);await finish(61,1);eq(await count(),1);eq(await value('select max(char_length(body))<=300 from crew_posts'),true);
  await db.exec("create function private.fail_chat() returns trigger language plpgsql as $$begin raise exception 'Simulated chat unavailable';end$$;create trigger fail_chat before insert on crew_posts for each row execute function private.fail_chat();");
  await battle(62,[[1,1,5],[2,2,-5]],1);await finish(62,1);eq(await value('select status from weekly_rider_battles where id=$1',[id(62)]),'completed');eq(await value("select count(*)::int from private.crew_milestone_receipts where event_key=$1",['battle:'+id(62)]),0,'Failed post also rolls back receipt');await db.exec('drop trigger fail_chat on crew_posts');
 });
 await scenario('chat push unchanged; milestone announcements do not broadcast phone pushes',async()=>{
  await q('insert into push_subscriptions values($1,true),($2,true)',[id(2),id(3)]);await q('insert into push_preferences(user_id,crew_chat) values($1,false)',[id(3)]);await q("insert into crew_posts(author_id,body,post_type) values($1,'Meet at the park','chat')",[id(1)]);eq(await value("select count(*)::int from push_notification_queue where notification_type='crew_chat'"),1);
  await q('insert into weekly_challenges values($1,$2)',[id(50),'Weekly Challenge']);await q('insert into weekly_challenge_completions(challenge_id,athlete_id) values($1,$2)',[id(50),id(1)]);eq(await value('select count(*)::int from push_notification_queue'),1,'Automatic milestone adds no all-crew push');
  await q("insert into crew_posts(author_id,body,post_type,metadata) values($1,'Old park king','announcement','{\"event_type\":\"park_king\"}'),($1,'Manual announcement','announcement','{}')",[id(1)]);
  await db.exec('set role authenticated');eq(await value('select count(*)::int from get_crew_feed()'),3,'Manual chat and manual announcement remain, old park king hidden');await db.exec('reset role');
  for(const fn of ['private.jkcrew_seed_chat_rank_snapshot()','private.refresh_crew_milestone_snapshots(uuid,text)','private.jkcrew_deferred_rank_milestone()','private.jkcrew_post_crew_milestone(uuid,text,jsonb,text)','private.jkcrew_post_leaderboard_milestone(uuid,text)','private.jkcrew_post_challenge_event()','private.jkcrew_post_battle_result_event()'])eq(await value('select has_function_privilege($1,$2,$3)',['authenticated',fn,'EXECUTE']),false,'Protected '+fn);
  eq(await value("select has_table_privilege('authenticated','private.crew_milestone_receipts','INSERT')"),false);eq(await value("select has_function_privilege('anon','public.get_crew_feed()','EXECUTE')"),false);
  await q("select set_config('request.jwt.claim.sub','',false)");eq(await value('select count(*)::int from get_crew_feed()'),0,'No auth subject yields no private crew feed');
 });
 console.log(`PASS ${checks} chat milestone DB checks`);
 }finally{await db.close();}}
module.exports={initialize,migration,id};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
