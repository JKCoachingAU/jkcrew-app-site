// Regression for auxiliary scoring work. Synthetic data only: no network, real
// accounts, push delivery, secrets, or production connection. PGlite is one SQL
// session; the captured-ID interleaving below is deterministic, not a load test.
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),migrations=path.join(root,'supabase/migrations');
const read=name=>fs.readFileSync(path.join(migrations,name),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
function fn(source,name){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const match=new RegExp(`create(?: or replace)? function ${escaped}\\(`,'i').exec(source);
 if(!match)throw new Error('Missing production function '+name);
 const text=source.slice(match.index),body=/\bas\s+(\$[a-z_]*\$)/i.exec(text);
 if(!body)throw new Error('Missing function body '+name);
 const end=text.indexOf(body[1],body.index+body[0].length);
 return text.slice(0,end+body[1].length)+';';
}
(async()=>{const db=new PGlite();try{
 await db.exec(`
 create schema private;create schema auth;create schema cron;
 create role anon;create role authenticated;create role service_role;
 grant usage on schema public,private,auth to authenticated,service_role;
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');
 create table profiles(id uuid primary key references auth.users on delete cascade,display_name text,role text,country_code text,country_name text,avatar jsonb default '{}',ghost_mode boolean default false,is_platform_owner boolean default false,level integer default 1,xp_total integer default 0);
 create table coach_teams(id uuid primary key,coach_id uuid references profiles on delete cascade,name text,status text);
 create table private.coach_account_access(coach_id uuid primary key references profiles on delete cascade,status text);
 create table private.coach_team_memberships(coach_id uuid primary key references profiles on delete cascade,team_id uuid references coach_teams,status text);
 create table coach_athletes(coach_id uuid references profiles on delete cascade,athlete_id uuid references profiles on delete cascade,team_id uuid references coach_teams);
 create table parent_athletes(parent_id uuid,athlete_id uuid);
 create table training_sessions(id uuid primary key,athlete_id uuid references profiles on delete cascade,total_points integer default 0,started_at timestamptz,ended_at timestamptz);
 create table assignment_point_awards(id uuid primary key default gen_random_uuid(),athlete_id uuid references profiles on delete cascade,session_id uuid references training_sessions on delete cascade,award_key text,points integer,venue text,created_at timestamptz default now(),unique(athlete_id,award_key));
 create table leaderboard_point_adjustments(id uuid primary key default gen_random_uuid(),athlete_id uuid references profiles on delete cascade,points integer,week_start date,reason text);
 create table weekly_other_try_awards(athlete_id uuid,points numeric,created_at timestamptz);
 create table athlete_badges(athlete_id uuid,badge_key text,badge_type text,label text,icon text,description text,earned_at timestamptz);
 create table leaderboard_rank_snapshots(athlete_id uuid primary key references profiles on delete cascade,week_start date,rank_number bigint,weekly_points bigint,weekly_started boolean,updated_at timestamptz);
 create table private.crew_leaderboard_snapshots(athlete_id uuid primary key,week_start date,rank_number bigint,weekly_points bigint,weekly_started boolean,updated_at timestamptz default now());
 create table private.crew_milestone_receipts(event_key text primary key,created_at timestamptz default now());
 create table crew_posts(id uuid primary key default gen_random_uuid(),author_id uuid references profiles on delete cascade,body text,post_type text,metadata jsonb);
 create table private.park_crown_titles(athlete_id uuid primary key,crown_title text);
 create table private.team_park_king_snapshots(team_id uuid references coach_teams on delete cascade,venue_key text,venue_name text,athlete_id uuid references profiles on delete cascade,display_name text,avatar jsonb,points integer,updated_at timestamptz,primary key(team_id,venue_key));
 create table park_king_events(id uuid primary key default gen_random_uuid(),venue_key text,venue_name text,athlete_id uuid references profiles on delete cascade,display_name text,points integer,crown_title text,created_at timestamptz default now());
 create table push_preferences(user_id uuid,leaderboard_overtaken boolean);
 create table push_subscriptions(user_id uuid,endpoint text,p256dh text,auth text,enabled boolean);
 create table push_notification_queue(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,title text,body text,url text,payload jsonb,dedupe_key text unique,created_at timestamptz default now());
 create table cron.job(jobid bigint generated always as identity,jobname text,schedule text,command text,active boolean default true);
 create function cron.schedule(text,text,text)returns bigint language plpgsql as $$declare x bigint;begin insert into cron.job(jobname,schedule,command)values($1,$2,$3)returning jobid into x;return x;end$$;
 create function private.require_coach_approval()returns void language plpgsql stable as $$begin if auth.uid() is not null and not private.jkcrew_actor_approved(auth.uid())then raise exception 'Approval required'using errcode='42501';end if;end$$;
 create function private.xp_progression_enabled()returns boolean language sql stable as $$select false$$;
 create function level_for_xp(integer)returns integer language sql immutable as $$select 1$$;
 create function get_earned_badges(uuid)returns jsonb language sql stable as $$select '[]'::jsonb$$;
 create function jkcrew_country_timezone(text)returns text language sql stable as $$select case $1 when 'DE'then'Europe/Berlin'else'Australia/Brisbane'end$$;
 create function jkcrew_week_bounds(text,p_now timestamptz default now())returns table(week_start_date date,week_start_ts timestamptz,next_week_start_ts timestamptz,local_today date)language sql stable as $$with local_clock as(select public.jkcrew_country_timezone($1)z,p_now at time zone public.jkcrew_country_timezone($1)t),bounds as(select*,t::date-extract(dow from t)::integer d from local_clock)select d,d::timestamp at time zone z,(d+7)::timestamp at time zone z,t::date from bounds$$;
 create function private.jkcrew_venue_key(text)returns text language sql immutable as $$select lower(regexp_replace(btrim(coalesce($1,'')),'[^[:alnum:]]+','','g'))$$;
 create function private.jkcrew_park_crown_title(uuid)returns text language sql stable as $$select coalesce((select crown_title from private.park_crown_titles where athlete_id=$1),'King')$$;
 `);
 const tenant=read('20261116123906_isolate_team_data_and_add_coach_memberships.sql');
 for(const name of ['private.jkcrew_actor_approved','private.jkcrew_user_team_ids','private.jkcrew_profile_team_id','private.jkcrew_profiles_share_team','private.jkcrew_notification_uuid','private.jkcrew_notification_allowed','private.guard_notification_team_scope','private.jkcrew_current_park_king_for_team','public.get_park_king'])await db.exec(fn(tenant,name));
 await db.exec(`create trigger guard_notification_team_scope before insert on push_notification_queue for each row execute function private.guard_notification_team_scope();
 create function get_weekly_leaderboard()returns table(athlete_id uuid,display_name text,level integer,avatar jsonb,country_code text,country_name text,weekly_points bigint,all_time_points bigint,session_count bigint,earned_badges jsonb,ghost_mode boolean,rank_number bigint,all_time_rank_number bigint,weekly_started boolean,weekly_point_events bigint,all_time_point_events bigint)language plpgsql security definer as $$begin return query select * from private.approved_f58214f32cd50c933615433a();end$$;`);
 await db.exec(read('20261118213525_optimize_concurrent_startup_leaderboards.sql'));
 await db.exec(read('20261118220526_scope_rank_notification_refresh_work.sql'));
 await db.exec(read('20261118221931_defer_scoring_announcements_from_critical_writes.sql'));
 // Attach the actual live trigger definitions: replacing a trigger function is
 // insufficient unless the regression also fires that trigger for source writes.
 await db.exec(`
 create trigger assignment_awards_leaderboard_push after insert or update or delete on assignment_point_awards for each row execute function private.handle_jkcrew_leaderboard_push_change();
 create trigger assignment_awards_refresh_park_king after insert or update or delete on assignment_point_awards for each row execute function private.handle_park_king_award_change();
 create constraint trigger crew_rank_awards_milestone after insert or update or delete on assignment_point_awards deferrable initially deferred for each row execute function private.jkcrew_deferred_rank_milestone();
 create trigger training_sessions_leaderboard_push after insert or delete or update of total_points on training_sessions for each row execute function private.handle_jkcrew_leaderboard_push_change();
 create constraint trigger crew_rank_sessions_milestone after insert or update or delete on training_sessions deferrable initially deferred for each row execute function private.jkcrew_deferred_rank_milestone();
 create trigger training_sessions_refresh_park_king after update of ended_at on training_sessions for each row execute function private.handle_park_king_session_completion();
 create trigger point_adjustments_leaderboard_push after insert or update or delete on leaderboard_point_adjustments for each row execute function private.handle_jkcrew_leaderboard_push_change();
 create constraint trigger crew_rank_adjustments_milestone after insert or update or delete on leaderboard_point_adjustments deferrable initially deferred for each row execute function private.jkcrew_deferred_rank_milestone();
 `);
 for(const[n,role,owner]of[[1,'coach',true],[2,'coach',false],[3,'athlete',false],[4,'athlete',false]]){
 await db.query('insert into auth.users(id,email,raw_app_meta_data)values($1,$2,$3)',[id(n),`${n}@example.test`,JSON.stringify({role,registered_coach_id:id(n===3?1:2)})]);
 await db.query("insert into profiles(id,display_name,role,is_platform_owner,country_code,country_name)values($1,$2,$3,$4,'AU','Australia')",[id(n),`Synthetic ${n}`,role,owner]);
 }
 for(const n of[1,2]){
 await db.query("insert into coach_teams(id,coach_id,name,status)values($1,$2,$3,'active')",[id(100+n),id(n),`Team ${n}`]);
 await db.query("insert into private.coach_account_access(coach_id,status)values($1,'approved')",[id(n)]);
 await db.query("insert into private.coach_team_memberships(coach_id,team_id,status)values($1,$2,'active')",[id(n),id(100+n)]);
 await db.query('insert into coach_athletes(coach_id,athlete_id,team_id)values($1,$2,$3)',[id(n),id(n+2),id(100+n)]);
 }
 const assert=require('node:assert/strict');let checks=0;
 const q=(sql,args=[])=>db.query(sql,args),scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
 const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const as=async n=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);if(n)await db.exec('set role authenticated');};
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),0,'Migration does not backfill historical announcements');
 await q('insert into training_sessions(id,athlete_id,started_at)values($1,$2,now())',[id(301),id(3)]);
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),0,'Zero point Daily start creates no auxiliary work');
 await db.exec('begin');
 await q("insert into assignment_point_awards(athlete_id,session_id,award_key,points,venue)values($1,$2,'one_bang:rollback',2,'The Village')",[id(3),id(301)]);
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs')>0,true,'Point transaction atomically inserts auxiliary jobs');
 await db.exec('rollback');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),0,'Rolled back award leaves no worker jobs');
 eq(await scalar('select count(*)::int from assignment_point_awards'),0,'Rolled back award leaves no point receipt');
 await q("insert into assignment_point_awards(athlete_id,session_id,award_key,points,venue)values($1,$2,'one_bang:review',2,'The Village')",[id(3),id(301)]);
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs')>=3,true,'Committed positive award queues rank/chat/crown');
 eq(await scalar('select count(*)::int from park_king_events'),0,'Scoring does not synchronously generate crown events');
 eq(await scalar('select count(*)::int from crew_posts'),0,'Scoring does not synchronously generate chat');
 await as(3);
 eq(Number(await scalar('select weekly_points from get_weekly_leaderboard() where athlete_id=$1',[id(3)])),2,'Authoritative live board immediately includes receipt before worker');
 eq(await scalar("select points from get_park_king('The Village')"),2,'Authoritative crown immediately includes receipt before worker');
 await assert.rejects(q('select count(*) from private.scoring_announcement_jobs'),/permission denied/);checks++;
 await assert.rejects(q('select private.process_scoring_announcements()'),/permission denied/);checks++;
 await assert.rejects(q("select private.enqueue_scoring_announcement('rank',$1)",[id(3)]),/permission denied/);checks++;
 await as(null);

 const beforeJobs=await scalar('select count(*)::int from private.scoring_announcement_jobs');
 eq(await scalar('select private.process_scoring_announcements()'),beforeJobs,'Cron context processes captured committed jobs');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),0,'Successful worker removes captured jobs');
 eq(Number(await scalar('select weekly_points from leaderboard_rank_snapshots where athlete_id=$1',[id(3)])),2,'Worker advances private rank snapshot to committed score');
 eq(await scalar('select count(*)::int from park_king_events'),1,'Worker emits one coalesced crown event');
 eq(await scalar('select private.process_scoring_announcements()'),0,'Empty retry is quiet');
 eq(await scalar('select count(*)::int from park_king_events'),1,'Empty retry does not duplicate crown event');
 // Force a strict chat failure after rank refresh; all auxiliary changes roll back,
 // while the already-committed point receipt remains authoritative and available.
 const originalChat=await scalar("select pg_get_functiondef('private.refresh_team_chat_snapshots_now(uuid,uuid,text)'::regprocedure)");
 await db.exec(`create or replace function private.refresh_team_chat_snapshots_now(p_team uuid,p_changed_athlete uuid,p_event_key text) returns void language plpgsql set search_path='' as $$begin raise exception 'injected strict auxiliary outage';end$$;`);
 await q("insert into assignment_point_awards(athlete_id,session_id,award_key,points,venue)values($1,$2,'one_bang:failure-review',2,'The Village')",[id(3),id(301)]);
 const failingJobs=await scalar('select count(*)::int from private.scoring_announcement_jobs');
 eq(await scalar('select private.process_scoring_announcements()'),0,'Strict auxiliary failure is retained for retry');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),failingJobs,'Failure never deletes captured jobs');
 eq(await scalar("select count(*)::int from private.scoring_announcement_jobs where attempts=1 and last_error like '%injected strict%' and available_at>clock_timestamp()"),failingJobs,'Failure records bounded backoff and diagnostic');
 eq(Number(await scalar('select weekly_points from leaderboard_rank_snapshots where athlete_id=$1',[id(3)])),2,'Rank snapshot write rolls back together with later chat failure');
 eq(await scalar('select sum(points)::int from assignment_point_awards'),4,'Auxiliary failure cannot roll back already-committed training points');
 await db.exec(originalChat+';');
 await db.exec('update private.scoring_announcement_jobs set available_at=now()');
 eq(await scalar('select private.process_scoring_announcements()'),failingJobs,'Retained jobs recover with strict helper restored');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),0,'Recovered batch drains');
 // Simulate a source committing a fresh event after worker captures its batch.
 // Appending from a snapshot trigger reaches the same DELETE captured-ID boundary.
 await db.exec(`create function private.inject_review_job()returns trigger language plpgsql security definer set search_path='' as $$begin perform private.enqueue_scoring_announcement('chat',new.athlete_id,'','captured-id-race-probe');return new;end$$;create trigger inject_review_job after update of weekly_points on leaderboard_rank_snapshots for each row execute function private.inject_review_job();`);
 await q("insert into assignment_point_awards(athlete_id,session_id,award_key,points,venue)values($1,$2,'one_bang:race-review',2,'The Village')",[id(3),id(301)]);
 const captured=await scalar('select count(*)::int from private.scoring_announcement_jobs');
 eq(await scalar('select private.process_scoring_announcements()'),captured,'Worker counts only rows captured before processing');
 eq(await scalar("select count(*)::int from private.scoring_announcement_jobs where event_key='captured-id-race-probe'"),1,'A newly-enqueued event survives deletion of captured batch');
 await db.exec('drop trigger inject_review_job on leaderboard_rank_snapshots');
 eq(await scalar('select private.process_scoring_announcements()'),1,'Next pass processes the preserved new event');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),0,'Next pass drains only remaining event');
 // Existing unique award receipts still control point idempotence.
 await q("insert into assignment_point_awards(athlete_id,session_id,award_key,points,venue)values($1,$2,'one_bang:race-review',2,'The Village') on conflict do nothing",[id(3),id(301)]);
 eq(await scalar('select sum(points)::int from assignment_point_awards'),6,'Retried source receipt adds no duplicate points');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),0,'Duplicate receipt inserts no duplicate auxiliary work');

 // Seed two additional own riders through the existing membership workflow.
 for(const n of [5,6]){
 await q('insert into auth.users(id,email,raw_app_meta_data)values($1,$2,$3)',[id(n),`review${n}@example.test`,JSON.stringify({role:'athlete',registered_coach_id:id(1)})]);
 await q("insert into profiles(id,display_name,role,country_code)values($1,$2,'athlete','AU')",[id(n),`Review Rider ${n}`]);
 await q('insert into coach_athletes(coach_id,athlete_id,team_id)values($1,$2,$3)',[id(1),id(n),id(101)]);
 await q('insert into training_sessions(id,athlete_id,started_at)values($1,$2,now())',[id(300+n),id(n)]);
 }
 await q("insert into assignment_point_awards(athlete_id,session_id,award_key,points,venue)values($1,$2,'one_bang:seed5',4,'The Village'),($3,$4,'one_bang:seed6',2,'The Village')",[id(5),id(305),id(6),id(306)]);
 await q('select private.process_scoring_announcements()');
 await q("insert into push_subscriptions(user_id,endpoint,p256dh,auth,enabled)values($1,'https://example.invalid/review','fixture-key','fixture-auth',true)",[id(3)]);
 const eventsBeforeMulti=await scalar('select count(*)::int from park_king_events');
 await q("insert into assignment_point_awards(athlete_id,session_id,award_key,points,venue)values($1,$2,'one_bang:pass5',4,'The Village'),($3,$4,'one_bang:pass6',8,'The Village')",[id(5),id(305),id(6),id(306)]);
 await q('select private.process_scoring_announcements()');
 const push=(await q("select recipient_id,body,payload from push_notification_queue where notification_type='leaderboard_overtaken' order by created_at desc limit 1")).rows[0];
 eq(push?.recipient_id,id(3),'Verified rank push reaches the actually overtaken same-team rider');
 eq(push?.payload?.overtaken_by,id(6),'Coalesced rank push preserves a real actual passer source');
 eq(push?.payload?.tenant_rank_version,1,'Coalesced rank push keeps tenant source version');
 eq(push?.body.startsWith('The leaderboard changed.'),true,'Multi-actor batch avoids naming an arbitrary changed actor');
 eq(await scalar('select count(*)::int from park_king_events'),eventsBeforeMulti+1,'Many same-venue source jobs coalesce into one final crown event');
 eq(await scalar("select private.jkcrew_notification_allowed($1,'leaderboard_overtaken',$2)",[id(4),push.payload]),false,'Foreign team cannot receive the actual passer source');
 eq(await scalar("select private.jkcrew_notification_allowed($1,'leaderboard_overtaken',$2)",[id(3),{...push.payload,overtaken_by:null}]),false,'Source guard still rejects anonymous/generic actor claims');
 // Bounded batches leave later rows pending rather than dropping them.
 await q("insert into private.scoring_announcement_jobs(team_id,athlete_id,kind,event_key)select $1,$2,'chat','bounded-'||n from generate_series(1,201)n",[id(101),id(3)]);
 eq(await scalar('select private.process_scoring_announcements()'),200,'Worker processes at most200 captured rows per pass');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),1,'Bounded pass retains the remaining job');
 eq(await scalar('select private.process_scoring_announcements()'),1,'Remaining job receives next-pass service');
 // A failing team cannot prevent a healthy team from making progress.
 const latestChat=await scalar("select pg_get_functiondef('private.refresh_team_chat_snapshots_now(uuid,uuid,text)'::regprocedure)");
 await db.exec(`create or replace function private.refresh_team_chat_snapshots_now(p_team uuid,p_changed_athlete uuid,p_event_key text)returns void language plpgsql set search_path='' as $$begin if p_team='${id(101)}'::uuid then raise exception 'one team outage';end if;end$$;`);
 await q("insert into private.scoring_announcement_jobs(team_id,athlete_id,kind,event_key)values($1,$2,'chat','failure-team'),($3,$4,'chat','healthy-team')",[id(101),id(3),id(102),id(4)]);
 eq(await scalar('select private.process_scoring_announcements()'),1,'Healthy team progresses when another team helper fails');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs where team_id=$1 and attempts=1',[id(101)]),1,'Only failed-team job remains with retry state');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs where team_id=$1',[id(102)]),0,'Healthy-team job is removed after its success');
 await db.exec(latestChat+';');await db.exec('update private.scoring_announcement_jobs set available_at=now()');await q('select private.process_scoring_announcements()');
 // A deleted athlete needs no FK in the private jobs table; their team and venues
 // were captured before profile cascades removed membership/award lookups.
 await q('delete from profiles where id=$1',[id(6)]);
 eq(await scalar("select count(*)::int from private.scoring_announcement_jobs where athlete_id=$1 and kind='crown' and venue='The Village'",[id(6)])>0,true,'Before-delete captures departing champion venue while membership still exists');
 eq(await scalar('select count(*)::int from private.crew_leaderboard_snapshots where athlete_id=$1',[id(6)]),0,'Departing private chat snapshot is removed');
 await q('select private.process_scoring_announcements()');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),0,'Deleted-actor jobs process without missing-profile failures');
 eq(await scalar("select athlete_id from private.team_park_king_snapshots where team_id=$1 and venue_key=private.jkcrew_venue_key('The Village')",[id(101)]),id(5),'Surviving rider becomes cached champion after departed champion cleanup');
 // Team removal cascades only that team’s pending jobs.
 await q("insert into private.scoring_announcement_jobs(team_id,athlete_id,kind)values($1,$2,'chat'),($3,$4,'chat')",[id(101),id(3),id(102),id(4)]);
 await q('delete from coach_athletes where team_id=$1',[id(102)]);await q('delete from private.coach_team_memberships where team_id=$1',[id(102)]);await q('delete from coach_teams where id=$1',[id(102)]);
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs where team_id=$1',[id(102)]),0,'Deleted team cascades its private queued jobs');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs where team_id=$1',[id(101)]),1,'Unrelated team job survives another team deletion');

 await q('select private.process_scoring_announcements()');
 eq(await scalar("select schedule from cron.job where jobname='jkcrew-scoring-announcements'"),'5 seconds','Migration installs a five-second server cron job');
 const workerFns=['private.process_scoring_announcements()','private.enqueue_scoring_announcement(text,uuid,text,text)','private.refresh_team_push_snapshots_now(uuid,uuid,text)','private.refresh_team_chat_snapshots_now(uuid,uuid,text)','private.refresh_park_king_for_team_now(uuid,text,text)','private.jkcrew_post_crew_milestone_strict(uuid,text,jsonb,text)','private.jkcrew_post_leaderboard_milestone_for_team(uuid,uuid,text)'];
 for(const role of ['anon','authenticated','service_role'])eq(await scalar("select bool_and(not has_function_privilege($1,fn,'EXECUTE'))from unnest($2::text[])fn",[role,workerFns]),true,role+' cannot execute queue/worker/strict auxiliary helpers');
 await q("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
 await assert.rejects(q('select private.process_scoring_announcements()'),/Server worker required/);checks++;
 await q("select set_config('request.jwt.claim.sub','',false)");
 await q("insert into auth.users(id,email)values($1,'pending@example.test')",[id(7)]);
 await q("insert into profiles(id,display_name,role)values($1,'Pending coach','coach')",[id(7)]);
 await q("insert into private.coach_account_access values($1,'pending')",[id(7)]);
 await q("insert into private.coach_team_memberships values($1,$2,'active')",[id(7),id(101)]);
 eq(await scalar("select private.jkcrew_notification_allowed($1,'leaderboard_overtaken',$2)",[id(7),push.payload]),false,'Pending coach cannot receive a coalesced source-backed private rank notification');
 await as(7);await assert.rejects(q('select * from get_weekly_leaderboard()'),/Approval required/);checks++;await as(null);
 await db.exec('begin');
 await q("update assignment_point_awards set venue='Ramp Attack' where athlete_id=$1 and award_key='one_bang:review'",[id(3)]);
 eq((await q("select distinct private.jkcrew_venue_key(venue)venue from private.scoring_announcement_jobs where kind='crown'order by venue")).rows.map(r=>r.venue),['rampattack','thevillage'],'Venue correction invalidates both old and new venue crowns');
 await db.exec('rollback');
 eq(await scalar('select count(*)::int from private.scoring_announcement_jobs'),0,'Rolled-back venue correction leaves no announcements');
 console.log(`PASS: ${checks} independent queue checks (production SQL bodies + synthetic schema; no production writes).`);
 }finally{await db.close();}})().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1});
