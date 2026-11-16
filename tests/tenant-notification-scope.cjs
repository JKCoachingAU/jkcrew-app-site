// Executes the notification SQL and Edge worker with synthetic sources only.
// No production connection, browser subscriptions or push delivery is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const fragmentSource = () => {
  if (process.env.JKCREW_NOTIFICATION_SQL) return fs.readFileSync(process.env.JKCREW_NOTIFICATION_SQL,'utf8');
  const directory=path.join(root,'supabase/migrations');
  const source=fs.readdirSync(directory).filter(name=>name.endsWith('.sql')).reverse().map(name=>fs.readFileSync(path.join(directory,name),'utf8')).find(text=>text.includes('-- Notifications keep their original history,'));
  assert(source,'Committed tenant notification migration exists');
  return source.slice(source.indexOf('-- Notifications keep their original history,'),source.indexOf('-- End tenant notification isolation.')+'-- End tenant notification isolation.'.length);
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = new PGlite();
let checks = 0;
const q = (sql, values = []) => db.query(sql, values);
const val = async (sql, values = []) => Object.values((await q(sql, values)).rows[0])[0];
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const allowed = (recipient, type, payload) => val('select private.jkcrew_notification_allowed($1,$2,$3)', [id(recipient), type, payload]);

async function databaseChecks() {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema private; create schema auth; create schema vault;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table profiles(id uuid primary key,role text,display_name text,country_code text default 'AU',ghost_mode boolean default false);
    create table private.fixture_cohort(profile_id uuid primary key,team_id uuid,approved boolean default true);
    create function private.jkcrew_actor_approved(uuid) returns boolean language sql stable security definer as $$select coalesce((select approved from private.fixture_cohort where profile_id=$1),false)$$;
    create function private.jkcrew_profile_team_id(uuid) returns uuid language sql stable security definer as $$select team_id from private.fixture_cohort where profile_id=$1$$;
    create function private.jkcrew_profiles_share_team(uuid,uuid) returns boolean language sql stable security definer as $$select coalesce(private.jkcrew_profile_team_id($1)=private.jkcrew_profile_team_id($2),false)$$;
    create table parent_athletes(parent_id uuid,athlete_id uuid);
    create table private.uci_schedule_announcements(source_id text,payload jsonb);
    create table park_king_events(id uuid primary key,athlete_id uuid);
    create table crew_posts(id uuid primary key,author_id uuid,post_type text);
    create table weekly_challenges(id uuid primary key,created_by uuid);
    create table weekly_challenge_completions(challenge_id uuid,athlete_id uuid);
    create table weekly_rider_battles(id uuid primary key,created_by uuid,challenger_id uuid);
    create table weekly_rider_battle_participants(battle_id uuid,athlete_id uuid);
    create table dashboard_items(id uuid primary key,created_by uuid,owner_id uuid,item_type text);
    create table run_plans(id uuid primary key,athlete_id uuid,coach_id uuid,contest_item_id uuid);
    create table trick_help_requests(id uuid primary key,athlete_id uuid,coach_id uuid);
    create table rider_sheet_proposals(id uuid primary key,athlete_id uuid,coach_id uuid);
    create table run_live_sessions(id uuid primary key,athlete_id uuid,coach_id uuid);
    create table coach_broadcasts(id uuid primary key,coach_id uuid);
    create table coach_broadcast_recipients(broadcast_id uuid,recipient_id uuid);
    create table weekly_assignment_plans(athlete_id uuid,coach_id uuid,target_week_start date);
    create table weekly_trick_assignments(id uuid primary key,athlete_id uuid);
    create table app_notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,payload jsonb);
    create table push_notification_queue(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,title text,body text,url text,payload jsonb,dedupe_key text unique,status text default 'pending',attempts integer default 0,available_at timestamptz default now(),created_at timestamptz default now(),processed_at timestamptz,last_error text);
    alter table app_notifications enable row level security;
    alter table push_notification_queue enable row level security;
    create policy own_notification on app_notifications for all to authenticated using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
    create policy own_queue on push_notification_queue for all to authenticated using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
    grant usage on schema public,private,auth to authenticated,service_role;
    grant select,update on app_notifications,push_notification_queue to authenticated;
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    insert into vault.decrypted_secrets values('jkcrew_push_worker_secret','fixture-secret');
    create function private.recovery_reminder_due(uuid,text,text) returns boolean language sql stable as $$select true$$;
    create function private.xp_progression_enabled() returns boolean language sql immutable as $$select false$$;
    create function private.is_xp_progression_notification(text,jsonb) returns boolean language sql immutable as $$select false$$;
    create function private.rider_recovery_active(uuid) returns boolean language sql stable as $$select false$$;
    create function public.jkcrew_week_bounds(text) returns table(week_start_date date,week_start_ts timestamptz,next_week_start_ts timestamptz) language sql stable as $$select date '2026-11-15',timestamptz '2026-11-15',timestamptz '2026-11-22'$$;
    create table assignment_point_awards(session_id uuid,athlete_id uuid,points integer,created_at timestamptz);
    create table training_sessions(id uuid,athlete_id uuid,total_points integer,started_at timestamptz);
    create table leaderboard_point_adjustments(athlete_id uuid,points integer,week_start date,reason text);
    create table leaderboard_rank_snapshots(athlete_id uuid primary key,week_start date,rank_number bigint,weekly_points bigint,weekly_started boolean,updated_at timestamptz);
    create table push_preferences(user_id uuid,leaderboard_overtaken boolean);
    create table push_subscriptions(user_id uuid,enabled boolean);
  `);
  const profiles = [[1,'coach','Head A',101,true],[2,'athlete','Rider A',101,true],[3,'athlete','Peer A',101,true],[4,'coach','Head B',102,true],[5,'athlete','Rider B',102,true],[6,'coach','Pending A',101,false],[7,'parent','Parent A',101,true]];
  for (const [n,role,name,team,approved] of profiles) {
    await q('insert into profiles(id,role,display_name) values($1,$2,$3)', [id(n),role,name]);
    await q('insert into private.fixture_cohort values($1,$2,$3)', [id(n),id(team),approved]);
  }
  await db.exec(`
    insert into parent_athletes values('${id(7)}','${id(2)}');
    insert into park_king_events values('${id(201)}','${id(2)}');
    insert into crew_posts values('${id(202)}','${id(1)}','chat');
    insert into weekly_challenges values('${id(203)}','${id(1)}');
    insert into weekly_challenge_completions values('${id(203)}','${id(2)}');
    insert into weekly_rider_battles values('${id(204)}','${id(1)}','${id(2)}');
    insert into weekly_rider_battle_participants values('${id(204)}','${id(2)}'),('${id(204)}','${id(3)}');
    insert into dashboard_items values('${id(205)}','${id(1)}',null,'event');
    insert into run_plans values('${id(206)}','${id(2)}','${id(1)}','${id(205)}');
    insert into trick_help_requests values('${id(207)}','${id(2)}','${id(1)}');
    insert into rider_sheet_proposals values('${id(208)}','${id(2)}','${id(1)}');
    insert into run_live_sessions values('${id(209)}','${id(2)}','${id(1)}');
    insert into coach_broadcasts values('${id(210)}','${id(1)}');
    insert into coach_broadcast_recipients values('${id(210)}','${id(2)}');
    insert into weekly_assignment_plans values('${id(2)}','${id(1)}','2026-11-22');
    insert into weekly_trick_assignments values('${id(211)}','${id(2)}');
    insert into private.uci_schedule_announcements values('official-1','{"sourceUrl":"https://www.uci.org/official"}');
    insert into assignment_point_awards values(null,'${id(2)}',5,'2026-11-16'),(null,'${id(3)}',4,'2026-11-16'),(null,'${id(5)}',100,'2026-11-16');
    insert into push_subscriptions values('${id(1)}',true),('${id(2)}',true),('${id(3)}',true),('${id(5)}',true),('${id(6)}',true);
    -- A historical row created before the new guards must remain stored but hidden.
    insert into app_notifications(recipient_id,notification_type,payload) values('${id(5)}','park_king_changed','{"event_id":"${id(201)}","athlete_id":"${id(2)}"}');
    insert into push_notification_queue(id,recipient_id,notification_type,payload) values('${id(301)}','${id(5)}','park_king_changed','{"event_id":"${id(201)}","athlete_id":"${id(2)}"}');
    insert into push_notification_queue(id,recipient_id,notification_type,payload) values('${id(303)}','${id(6)}','park_king_changed','{"event_id":"${id(201)}","athlete_id":"${id(2)}"}');
  `);
  await db.exec(fragmentSource());
  const cases = [
    ['park_king_changed',{event_id:id(201),athlete_id:id(2)},3],
    ['crew_chat',{post_id:id(202),author_id:id(1)},2],
    ['leaderboard_overtaken',{overtaken_by:id(3),tenant_rank_version:1},2],
    ['weekly_challenge_published',{challenge_id:id(203)},2],
    ['weekly_challenge_completed',{challenge_id:id(203)},2],
    ['rider_battle_started',{battle_id:id(204)},2],
    ['event_updated',{event_id:id(205)},2],
    ['event_run_planned',{run_plan_id:id(206),athlete_id:id(2),event_id:id(205)},1],
    ['video_review_returned',{request_id:id(207)},2],
    ['list_request_approved',{proposal_id:id(208)},2],
    ['live_run_invite',{live_run_id:id(209)},2],
    ['coach_message',{broadcast_id:id(210)},2],
    ['daily_list_completed',{assignment_id:id(211),athlete_id:id(2)},1],
    ['parent_weekly_summary',{athlete_id:id(2)},7],
  ];
  for (const [type,payload,recipient] of cases) {
    eq(await allowed(recipient,type,payload),true,type+' permits its approved own-team recipient');
    eq(await allowed(5,type,payload),false,type+' blocks a different team');
    eq(await allowed(6,type,payload),false,type+' blocks pending coaches');
  }
  eq(await allowed(7,'parent_weekly_summary',{athlete_id:id(3)}),false,'A parent cannot receive another same-team child’s private summary');
  eq(await allowed(3,'video_review_returned',{request_id:id(207)}),false,'A teammate cannot receive private video feedback');
  eq(await allowed(2,'sheet_scheduled',{week_start:'2026-11-22'}),true,'Own scheduled sheet has an authoritative plan');
  eq(await allowed(5,'sheet_scheduled',{week_start:'2026-11-22'}),false,'Foreign scheduled sheet is not inferred from a date');
  eq(await allowed(5,'uci_qualification_update',{announcement_id:'official-1',source_url:'https://www.uci.org/official'}),true,'Verified public official news remains available to other teams');
  eq(await allowed(2,'uci_qualification_update',{announcement_id:'missing',source_url:'https://www.uci.org/official'}),false,'Unverified public-source claims fail closed');
  eq(await allowed(2,'park_king_changed',{event_id:id(201),athlete_id:id(5)}),false,'Payload cannot substitute another athlete for a crown event');
  eq(await allowed(2,'park_king_changed',{event_id:id(201)}),false,'Missing subject ID cannot become SQL-null permission');
  eq(await allowed(2,'park_king_changed',{event_id:'malformed',athlete_id:id(2)}),false,'Malformed UUID fails closed');
  eq(await allowed(2,'leaderboard_overtaken',{overtaken_by:id(3),rank:99}),false,'Historical global ranks are hidden');
  eq(await allowed(2,'unknown_type',{}),false,'Unknown notifications fail closed');
  eq(await allowed(2,'daily_hype',{}),true,'Generic self-only reminders are retained');
  eq(await allowed(6,'notification_test',{}),false,'Pending coach cannot bypass approval with a generic notification');
  eq((await q('select athlete_id,rank_number from private.jkcrew_current_push_rankings() order by athlete_id')).rows.map(r=>[r.athlete_id,Number(r.rank_number)]),[[id(2),1],[id(3),2],[id(5),1]],'Ranks are calculated separately per team');
  const invalid = {event_id:id(201),athlete_id:id(2)};
  await q('insert into app_notifications(recipient_id,notification_type,payload) values($1,$2,$3)',[id(5),'park_king_changed',invalid]);
  eq(await val('select count(*)::int from app_notifications'),1,'Foreign new in-app rows are suppressed without deleting history');
  await q('insert into push_notification_queue(recipient_id,notification_type,payload) values($1,$2,$3)',[id(5),'park_king_changed',invalid]);
  eq(await val('select count(*)::int from push_notification_queue'),2,'Foreign new push rows are suppressed');
  await q('insert into app_notifications(recipient_id,notification_type,payload) values($1,$2,$3)',[id(2),'park_king_changed',invalid]);
  await q("select set_config('request.jwt.claim.sub',$1,false)",[id(5)]);
  await db.exec('set role authenticated');
  eq(await val('select count(*)::int from app_notifications'),0,'Historical foreign in-app rows are invisible even to their old recipient');
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false)",[id(2)]);
  await db.exec('set role authenticated');
  eq(await val('select count(*)::int from app_notifications'),1,'Own historical notification is still visible');
  await db.exec('reset role');
  for (const role of ['anon','authenticated']) eq(await val("select has_function_privilege($1,'public.validate_jkcrew_push_scope(uuid)','EXECUTE')",[role]),false,'Only the worker can validate notification IDs: '+role);
  await q('insert into push_notification_queue(id,recipient_id,notification_type,payload) values($1,$2,$3,$4)',[id(302),id(1),'video_review_requested',{request_id:id(207)}]);
  eq((await q("select id from public.claim_jkcrew_push_notifications('fixture-secret',50)")).rows.map(row=>row.id),[id(302)],'Claim skips historical foreign queue rows');
  eq(await val('select status from push_notification_queue where id=$1',[id(301)]),'skipped','Old foreign pending delivery is cancelled, not deleted');
  eq(await val('select status from push_notification_queue where id=$1',[id(303)]),'skipped','Old pending-coach delivery is cancelled despite a previously registered enabled browser token');
  eq(await val('select public.validate_jkcrew_push_scope($1)',[id(302)]),true,'Claimed own source can deliver');
  await q('update private.fixture_cohort set approved=false where profile_id=$1',[id(1)]);
  eq(await val('select public.validate_jkcrew_push_scope($1)',[id(302)]),false,'Delivery rechecks revoked approval after claim');
  await q('update private.fixture_cohort set approved=true where profile_id=$1',[id(1)]);
  await q('update private.fixture_cohort set team_id=$1 where profile_id=$2',[id(102),id(1)]);
  eq(await val('select public.validate_jkcrew_push_scope($1)',[id(302)]),false,'Delivery rechecks current team membership after claim');
  await q('update private.fixture_cohort set team_id=$1 where profile_id=$2',[id(101),id(1)]);
  const before=await val('select count(*)::int from push_notification_queue');
  await q('select private.refresh_jkcrew_leaderboard_push_snapshots($1,$2)',[id(5),'foreign-change']);
  eq(await val('select count(*)::int from push_notification_queue'),before,'A foreign score change does not emit an own-team rank notification');
  // Real sources are often inserted in an outer statement, with notifications
  // queued by an AFTER trigger. The scope guard must see that source immediately.
  await db.exec(`
    create function private.fixture_completion_notify() returns trigger language plpgsql as $$begin
      insert into public.app_notifications(recipient_id,notification_type,payload)
      values(new.athlete_id,'weekly_challenge_completed',jsonb_build_object('challenge_id',new.challenge_id,'athlete_id',new.athlete_id));
      return new;
    end$$;
    create trigger fixture_completion_notify after insert on weekly_challenge_completions
      for each row execute function private.fixture_completion_notify();
    insert into weekly_challenge_completions values('${id(203)}','${id(3)}');
  `);
  eq(await val("select count(*)::int from app_notifications where recipient_id=$1 and notification_type='weekly_challenge_completed'",[id(3)]),1,'Notification guards see an authoritative source created by the enclosing trigger statement');
}

async function workerChecks() {
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(root,'supabase/functions/send-jkcrew-push/index.ts'),'utf8').replace(/^import .+;\n/gm,''));
  async function run(sequence, devices=1, scopeError=false, recipient=2) {
    let handler,validations=0,subscriptionReads=0; const sends=[],finishes=[],updates=[];
    const item={id:id(901),recipient_id:id(recipient),notification_type:'crew_chat',title:'Fixture',body:'Own team',payload:{post_id:id(202),author_id:id(1)}};
    const client={rpc:async(name,args)=>{
      if(name==='get_jkcrew_push_worker_config')return{data:{vapid_public_key:'fixture',vapid_private_key:'fixture'}};
      if(name==='claim_jkcrew_push_notifications')return{data:[item]};
      if(name==='validate_jkcrew_push_scope'){validations++;return scopeError?{error:Error('scope unavailable')}:{data:sequence.shift()??false};}
      if(name==='finish_jkcrew_push_notification'){finishes.push(args);return{data:null};}
      throw Error('Unexpected worker RPC: '+name);
    },from:table=>{
      const builder={select(){subscriptionReads++;return builder;},eq(){return builder;},limit(){return Promise.resolve({data:Array.from({length:devices},(_,n)=>({id:'device'+n,endpoint:'https://push.test/'+n,p256dh:'x',auth:'x'}))});},update(value){updates.push(value);return builder;},then(resolve){return Promise.resolve({data:null}).then(resolve);}};
      assert.equal(table,'push_subscriptions');return builder;
    }};
    vm.runInNewContext(source,{Deno:{env:{get:key=>({SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'}[key])},serve:fn=>handler=fn},createClient:()=>client,webpush:{setVapidDetails(){},sendNotification:async(_,payload)=>sends.push(JSON.parse(payload))},Response,Request,JSON,console,Date,Number,Math,Error});
    const response=await handler(new Request('https://fixture.test/push',{method:'POST',headers:{'x-push-worker-secret':'fixture'}}));
    eq(response.status,200,'Worker completes safe scope checks');
    return {validations,subscriptionReads,sends,finishes,updates};
  }
  let result=await run([false]);
  eq(result.subscriptionReads,0,'Foreign message does not load browser devices');
  eq(result.sends.length,0,'Foreign message is never sent');
  eq(result.finishes[0].p_failed,0,'Ineligible message is skipped instead of retried');
  result=await run([false],2,false,6);eq(result.subscriptionReads,0,'Pending coach’s previously registered browser tokens are never loaded');eq(result.sends.length,0,'Pending coach receives no delivery through an existing token');
  result=await run([true,false]);eq(result.sends.length,0,'Revocation between claim and device delivery blocks sending');
  result=await run([true,true,false],2);eq(result.sends.length,1,'Approval is rechecked before each device');eq(result.validations,3,'Both per-message and per-device checks run');
  result=await run([],1,true);eq(result.sends.length,0,'A failed eligibility read fails closed');eq(result.updates.length,0,'Authorization outage does not disable a browser subscription');eq(result.finishes[0].p_failed,1,'Authorization read failure can be retried safely');
}

(async()=>{try {await databaseChecks();await workerChecks();console.log(`PASS: ${checks} tenant notification checks; authoritative sources, current approval, private child links, historical visibility, scoped ranks, queue claims and real Edge delivery gates.`);} finally {await db.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
