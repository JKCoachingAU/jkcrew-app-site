// Synthetic Postgres only. No app accounts, network, or device push providers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || "@electric-sql/pglite");

const migrationRoot = process.env.JKCREW_MIGRATIONS || path.join(__dirname, "../supabase/migrations");
const migration = name => fs.readFileSync(path.join(migrationRoot, name), "utf8");
const cut = (sql, start, end) => {
  const first = sql.indexOf(start);
  const last = end ? sql.indexOf(end, first) : sql.length;
  assert(first >= 0 && last > first);
  return sql.slice(first, last);
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const db = new PGlite();
const sql = (query, args = []) => db.query(query, args);
const value = async (query, args = []) => Object.values((await sql(query, args)).rows[0])[0];
let checked = 0;
function eq(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checked++;
}
const actor = n => sql("select set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : ""]);
const entitled = (n, type, payload) => value("select private.jkcrew_notification_allowed($1,$2,$3)", [id(n), type, payload]);
const count = async (table, type, n) => value(
  `select count(*)::int from public.${table} where notification_type=$1 and recipient_id=$2`, [type, id(n)]
);
const history = (type, n) => count("app_notifications", type, n);
const queue = (type, n) => count("push_notification_queue", type, n);
const newRun = (n, rider, coach, creator, event = null) => sql(
  "insert into public.run_plans(id,athlete_id,coach_id,created_by,contest_item_id) values($1,$2,$3,$4,$5)",
  [id(n), id(rider), id(coach), id(creator), event ? id(event) : null]
);
const newList = (n, rider, coach) => sql(
  "insert into public.rider_sheet_proposals(id,athlete_id,coach_id) values($1,$2,$3)", [id(n), id(rider), id(coach)]
);
const newVideo = (n, rider, coach) => sql(
  "insert into public.trick_help_requests(id,athlete_id,coach_id) values($1,$2,$3)", [id(n), id(rider), id(coach)]
);

async function setup() {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema private; create schema auth; create schema vault;
    grant usage on schema public,private,auth to authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key,role text,display_name text,
      country_code text default 'AU',ghost_mode boolean default false,is_platform_owner boolean default false);
    create table public.coach_teams(id uuid primary key,status text);
    create table public.coach_athletes(coach_id uuid,athlete_id uuid,primary key(coach_id,athlete_id));
    create table private.coach_team_memberships(coach_id uuid,team_id uuid,status text,primary key(coach_id));
    create table private.fixture_cohort(profile_id uuid primary key,team_id uuid,approved boolean default true);
    create function private.jkcrew_actor_approved(uuid) returns boolean language sql stable security definer set search_path='' as
      $$select coalesce((select approved from private.fixture_cohort where profile_id=$1),false)$$;
    create function private.jkcrew_profile_team_id(uuid) returns uuid language sql stable security definer set search_path='' as
      $$select team_id from private.fixture_cohort where profile_id=$1$$;
    create function private.jkcrew_profiles_share_team(uuid,uuid) returns boolean language sql stable security definer set search_path='' as
      $$select coalesce(private.jkcrew_profile_team_id($1)=private.jkcrew_profile_team_id($2),false)$$;
    create function private.jkcrew_is_team_coach(uuid) returns boolean language sql stable security definer set search_path='' as
      $$select private.jkcrew_actor_approved(auth.uid())
        and exists(select 1 from private.coach_team_memberships caller join private.coach_team_memberships target using(team_id)
          where caller.coach_id=auth.uid() and caller.status='active' and target.coach_id=$1 and target.status='active')$$;
    create table public.parent_athletes(parent_id uuid,athlete_id uuid);
    create table private.uci_schedule_announcements(source_id text,payload jsonb);
    create function private.jkcrew_uci_rankings_notification_allowed(uuid,jsonb) returns boolean language sql as $$select false$$;
    create function private.install_uci_rankings_notification_jobs() returns void language sql as $$select$$;
    create table public.park_king_events(id uuid primary key,athlete_id uuid);
    create table public.crew_posts(id uuid primary key,author_id uuid,post_type text);
    create table public.weekly_challenges(id uuid primary key,created_by uuid);
    create table public.weekly_challenge_completions(challenge_id uuid,athlete_id uuid);
    create table public.weekly_rider_battles(id uuid primary key,created_by uuid,challenger_id uuid);
    create table public.weekly_rider_battle_participants(battle_id uuid,athlete_id uuid);
    create table public.dashboard_items(id uuid primary key,created_by uuid,owner_id uuid,item_type text,title text);
    create table public.run_plans(id uuid primary key,athlete_id uuid,coach_id uuid,created_by uuid,
      contest_item_id uuid,updated_at timestamptz default now(),archived_at timestamptz,points jsonb,image_data_url text);
    create table public.trick_help_requests(id uuid primary key,athlete_id uuid,coach_id uuid,status text default 'open',
      coach_comment text,coach_video_storage_path text);
    create table public.rider_sheet_proposals(id uuid primary key,athlete_id uuid,coach_id uuid,status text default 'pending',title text);
    create table public.run_live_sessions(id uuid primary key,athlete_id uuid,coach_id uuid);
    create table public.coach_broadcasts(id uuid primary key,coach_id uuid);
    create table public.coach_broadcast_recipients(broadcast_id uuid,recipient_id uuid);
    create table public.weekly_assignment_plans(athlete_id uuid,coach_id uuid,target_week_start date);
    create table public.weekly_trick_assignments(id uuid primary key,athlete_id uuid);
    create table public.push_notification_queue(id uuid primary key default gen_random_uuid(),recipient_id uuid,
      notification_type text,title text,body text,url text,payload jsonb,dedupe_key text unique,status text default 'pending',
      attempts integer default 0,available_at timestamptz default now(),created_at timestamptz default now(),
      processed_at timestamptz,last_error text);
    alter table public.push_notification_queue enable row level security;
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    insert into vault.decrypted_secrets values('jkcrew_push_worker_secret','offline-fixture');
    create function private.recovery_reminder_due(uuid,text,text) returns boolean language sql stable as $$select true$$;
    create function private.xp_progression_enabled() returns boolean language sql immutable as $$select false$$;
    create function private.is_xp_progression_notification(text,jsonb) returns boolean language sql immutable as $$select false$$;
    create function private.rider_recovery_active(uuid) returns boolean language sql stable as $$select false$$;
    create function public.jkcrew_country_timezone(text) returns text language sql immutable as $$select 'Australia/Brisbane'::text$$;
    create function public.jkcrew_week_bounds(text) returns table(week_start_date date,week_start_ts timestamptz,next_week_start_ts timestamptz)
      language sql stable as $$select date '2026-11-15',timestamptz '2026-11-15',timestamptz '2026-11-22'$$;
    create table public.assignment_point_awards(session_id uuid,athlete_id uuid,points integer,created_at timestamptz);
    create table public.training_sessions(id uuid,athlete_id uuid,total_points integer,started_at timestamptz);
    create table public.leaderboard_point_adjustments(athlete_id uuid,points integer,week_start date,reason text);
    create table public.leaderboard_rank_snapshots(athlete_id uuid primary key,week_start date,rank_number bigint,
      weekly_points bigint,weekly_started boolean,updated_at timestamptz);
    create table public.push_preferences(user_id uuid primary key,leaderboard_overtaken boolean,list_requests boolean);
    create table public.push_subscriptions(user_id uuid,enabled boolean);
  `);
  const original = migration("20260828090000_finish_notification_center_and_alerts.sql");
  await db.exec(cut(original, "-- JKCREW 2.14.18:", "create or replace function public.send_my_test_notification()"));
  await db.exec(cut(original, "-- A rider-created private event run", "-- Notify riders when a new weekly challenge"));
  await db.exec(cut(
    migration("202608261715_add_coaching_push_notifications.sql"),
    "create or replace function private.queue_jkcrew_list_request_push()",
    "do $block$"
  ));
  await db.exec(migration("20260827182500_release_video_coaching_notifications.sql"));
  await db.exec(cut(
    migration("20261116123906_isolate_team_data_and_add_coach_memberships.sql"),
    "-- Notifications keep their original history,",
    "-- End tenant notification isolation."
  ));
  await db.exec(cut(
    migration("20261118220526_scope_rank_notification_refresh_work.sql"),
    "create function private.jkcrew_push_rankings_for_team(",
    "create or replace function private.jkcrew_current_push_rankings()"
  ));

  for (const [n, role, team, approved, active] of [
    [1, "coach", 101, true, true], [2, "athlete", 101, true], [3, "athlete", 101, true],
    [4, "admin", 102, true, true], [5, "athlete", 102, true], [6, "coach", 101, false, true],
    [7, "parent", 101, true], [8, "coach", 101, true, true], [9, "coach", 101, true, true],
    [10, "athlete", 101, true], [11, "coach", 101, true, false],
  ]) {
    await sql("insert into public.profiles(id,role,display_name,is_platform_owner) values($1,$2,$3,$4)",
      [id(n), role, `Fixture ${n}`, n === 4]);
    await sql("insert into private.fixture_cohort values($1,$2,$3)", [id(n), id(team), approved]);
    if (active !== undefined) {
      await sql("insert into private.coach_team_memberships values($1,$2,$3)", [id(n), id(team), active ? "active" : "inactive"]);
    }
    if (![7, 9, 10].includes(n)) await sql("insert into public.push_subscriptions values($1,true)", [id(n)]);
  }
  await sql("insert into public.coach_teams values($1,'active'),($2,'active')", [id(101), id(102)]);
  await sql("insert into public.parent_athletes values($1,$2)", [id(7), id(2)]);
  await sql("insert into public.coach_athletes values($1,$2),($1,$3),($4,$2),($5,$6),($7,$2),($8,$2)",
    [id(1), id(2), id(3), id(8), id(4), id(5), id(9), id(6)]);
  await sql("insert into public.dashboard_items values($1,$2,$2,'event','Private contest'),($3,$4,$4,'event','Other contest')",
    [id(201), id(1), id(202), id(4)]);
  await actor(2);
  await newRun(210, 2, 1, 2, 201);
  eq(await history("event_run_planned", 1), 1, "Baseline historical notification exists before installing coverage");
  await actor(null);
  await db.exec(`begin;\n${migration("20261122073100_notify_private_coaching_activity.sql")}\ncommit;`);
}

async function verifyCoachingAlerts() {
  eq(await history("event_run_planned", 1), 1, "Migration leaves old event notification and queue history intact");
  await sql(`insert into public.push_preferences(user_id,list_requests,coaching_updates,event_updates,quiet_hours_enabled,quiet_hours_start,quiet_hours_end)
    values($1,true,true,true,true,((now() at time zone 'Australia/Brisbane') - interval '1 hour')::time,
      ((now() at time zone 'Australia/Brisbane') + interval '1 hour')::time),
      ($2,false,false,false,false,time '20:00',time '08:00')`, [id(1), id(8)]);

  await actor(2);
  await newList(301, 2, 1);
  await newList(302, 2, 8);
  await newList(303, 2, 9);
  await newList(304, 2, 6);
  await newList(305, 2, 4);
  await newVideo(311, 2, 1);
  await newVideo(312, 2, 8);
  await newVideo(313, 2, 9);
  await newVideo(314, 2, 4);
  eq(await history("list_request_sent", 1), 1, "Weekly list alert goes to its assigned coach");
  eq(await queue("list_request_sent", 1), 1, "Subscribed coach has a queue item");
  eq(await history("list_request_sent", 8), 1, "List preference off retains in-app history");
  eq(await queue("list_request_sent", 8), 0, "List preference off skips device push");
  eq(await history("list_request_sent", 9), 1, "Coach without a device can still see a list alert");
  eq(await queue("list_request_sent", 9), 0, "No device means no queue item");
  eq(await history("list_request_sent", 6), 0, "Pending coach receives no history despite old device registration");
  eq(await history("list_request_sent", 4), 0, "Foreign platform owner cannot receive another team's submission");
  eq(await history("video_review_requested", 1), 1, "Trick video request goes to its assigned coach");
  eq(await history("video_review_requested", 8), 1, "Trick request history remains when coach turns off device alerts");
  eq(await queue("video_review_requested", 8), 0, "Coach video preference off skips push");
  eq(await history("video_review_requested", 9), 1, "Coach without a device still receives in-app video request");
  eq(await history("video_review_requested", 4), 0, "Foreign owner cannot receive trick requests");
  eq(await value(`select count(*)::int from public.push_notification_queue
    where recipient_id=$1 and notification_type in ('list_request_sent','video_review_requested') and available_at > now()+interval '55 minutes'`,
    [id(1)]), 2, "Quiet hours delay both list and video pushes");

  await newRun(320, 2, 1, 2);
  await newRun(321, 2, 1, 2);
  await newRun(322, 2, 1, 2, 201);
  await newRun(323, 2, 4, 2);
  await newRun(324, 2, 1, 8);
  await newRun(325, 2, 1, 2, 202);
  eq(await history("rider_run_saved", 1), 2, "Each new standalone rider run has its own alert");
  eq(await history("event_run_planned", 1), 2, "New event run uses the original kind in addition to legacy history");
  eq(await history("rider_run_saved", 4), 0, "Coach from another team never receives rider run notices");
  await sql("update public.run_plans set points='[]' where id in ($1,$2)", [id(320), id(322)]);
  eq(await history("event_run_planned", 1), 2, "Editing or retrying existing event run does not notify twice");
  eq(await history("rider_run_saved", 1), 2, "Editing existing training run does not notify twice");

  await actor(8);
  await sql("update public.rider_sheet_proposals set status='accepted' where id=$1", [id(301)]);
  eq(await history("list_request_approved", 2), 1, "Approved same-team collaborator can approve for the assigned coach");
  await sql("update public.rider_sheet_proposals set status='accepted' where id=$1", [id(301)]);
  eq(await history("list_request_approved", 2), 1, "Approval retry does not duplicate the alert");
  await newRun(326, 2, 8, 8, 201);
  await newRun(327, 2, 1, 8);
  eq(await history("coach_run_saved", 2), 1, "Rider receives collaborator's own run for them, not mismatched author");
  eq(await history("coach_run_saved", 3), 0, "A peer rider never receives private run details");
  await sql("update public.trick_help_requests set status='replied',coach_comment='Fixture feedback' where id=$1", [id(311)]);
  eq(await history("video_review_returned", 2), 1, "Same-team collaborator can return a rider's review");
  eq(await queue("video_review_returned", 2), 1, "Subscribed rider receives video feedback push");
  await sql("update public.trick_help_requests set status='reviewed' where id=$1", [id(311)]);
  eq(await history("video_review_returned", 2), 1, "Archiving an already returned review does not send it again");
  await sql("update public.trick_help_requests set status='reviewed' where id=$1", [id(312)]);
  eq(await history("video_review_returned", 2), 2, "First explicit reviewed status sends once even without written feedback");
  await sql("insert into public.push_preferences(user_id,coaching_updates) values($1,false) on conflict(user_id) do update set coaching_updates=false", [id(2)]);
  await sql("update public.trick_help_requests set coach_comment='Revised fixture feedback' where id=$1", [id(311)]);
  eq(await history("video_review_returned", 2), 3, "Distinct new feedback gets a separate history item");
  eq(await queue("video_review_returned", 2), 2, "New feedback after rider opt-out stays in-app");
  eq(await entitled(8, "list_request_sent", { proposal_id: id(301) }), false, "Same-team teammate is not the assigned notification recipient");
  eq(await entitled(7, "video_review_returned", { request_id: id(311) }), false, "Parent cannot read rider-only feedback alert");
  eq(await entitled(3, "coach_run_saved", {run_plan_id: id(326), athlete_id: id(2), event_id: id(201)}), false,
    "A peer cannot use known IDs to receive private run alerts");
  await actor(null);
}

async function verifyRankAlerts() {
  await sql("update public.push_preferences set coach_rank_updates=false where user_id=$1", [id(8)]);
  await sql("insert into public.push_preferences(user_id,leaderboard_overtaken) values($1,false)", [id(3)]);
  await sql(`insert into public.assignment_point_awards values
    (null,$1,8,'2026-11-16'),(null,$2,7,'2026-11-16'),(null,$3,2,'2026-11-16'),(null,$4,99,'2026-11-16')`,
    [id(2), id(3), id(10), id(5)]);
  await sql("select private.refresh_team_push_snapshots_now($1,null,'baseline')", [id(101)]);
  eq(await history("coach_leaderboard_overtake", 1), 0, "Building original ranks sends no notice");
  await db.exec("create temp table before_overtake as select * from public.leaderboard_rank_snapshots");
  await sql("insert into public.assignment_point_awards values(null,$1,8,'2026-11-17')", [id(10)]);
  await sql("select private.refresh_team_push_snapshots_now($1,$2,'fixture-score-event')", [id(101), id(10)]);
  eq(await history("coach_leaderboard_overtake", 1), 1, "A true score-backed overtake creates one coach notice");
  eq(await queue("coach_leaderboard_overtake", 1), 1, "Opted-in coach with device gets a queue item");
  eq(await history("coach_leaderboard_overtake", 8), 1, "Other active approved coach sees rank history even with device opt-out");
  eq(await queue("coach_leaderboard_overtake", 8), 0, "Coach-specific rank preference suppresses push");
  eq(await history("coach_leaderboard_overtake", 9), 1, "Another active coach without device receives history");
  eq(await queue("coach_leaderboard_overtake", 9), 0, "No device suppresses coach rank push");
  eq(await history("coach_leaderboard_overtake", 4), 0, "Foreign platform owner cannot see private team score changes");
  eq(await history("coach_leaderboard_overtake", 6), 0, "Pending same-team coach cannot see rank changes");
  eq(await history("coach_leaderboard_overtake", 11), 0, "Inactive membership cannot see rank changes");
  eq(await queue("leaderboard_overtaken", 2), 1, "Existing overtaken rider notification remains enabled");
  eq(await queue("leaderboard_overtaken", 3), 0, "Existing rider-specific opt-out remains effective");
  eq(await queue("leaderboard_overtaken", 5), 0, "Foreign rider does not receive team rank alert");
  eq(await value("select count(*)::int from private.team_leaderboard_overtake_events"), 1, "Both overtaken riders share one actual score source for coach dedupe");
  const rank = (await sql("select id,payload,available_at from public.push_notification_queue where notification_type='coach_leaderboard_overtake'")).rows[0];
  eq(await value("select $1::timestamptz > now()+interval '55 minutes'", [rank.available_at]), true,
    "Coach rank alert respects quiet hours");
  eq(await entitled(1, "coach_leaderboard_overtake", rank.payload), true, "Active team coach sees the actual rank event");
  eq(await entitled(8, "coach_leaderboard_overtake", rank.payload), true, "Second active team coach may see event history");
  eq(await entitled(4, "coach_leaderboard_overtake", rank.payload), false, "Foreign platform owner denied at delivery/history gate");
  eq(await entitled(2, "coach_leaderboard_overtake", rank.payload), false, "Rider cannot receive the coach-only event");
  eq(await entitled(1, "coach_leaderboard_overtake", { rank_event_id: id(899) }), false, "Fabricated rank source fails closed");

  await db.exec("delete from public.leaderboard_rank_snapshots; insert into public.leaderboard_rank_snapshots select * from before_overtake");
  await sql("select private.refresh_team_push_snapshots_now($1,$2,'fixture-score-event')", [id(101), id(10)]);
  eq(await queue("coach_leaderboard_overtake", 1), 1, "Reprocessing same score source doesn't duplicate coach push");
  eq(await queue("leaderboard_overtaken", 2), 1, "Reprocessing same source preserves rider dedupe");
  await sql("select private.refresh_team_push_snapshots_now($1,$2,'new-job-no-score-change')", [id(101), id(10)]);
  eq(await history("coach_leaderboard_overtake", 1), 1, "An unrelated refresh with no score crossing has no alert");
  eq(await value("select count(*)::int from private.team_leaderboard_overtake_events"), 1, "No source row from unrelated refresh");

  await sql("update public.push_notification_queue set status='processing' where id=$1", [rank.id]);
  await db.exec("set role service_role");
  eq(await value("select public.validate_jkcrew_push_scope($1)", [rank.id]), true, "Privileged worker can validate approved rank push");
  await db.exec("reset role");
  await sql("update private.fixture_cohort set approved=false where profile_id=$1", [id(1)]);
  await actor(1);
  await db.exec("set role authenticated");
  eq(await value("select has_function_privilege('private.refresh_team_push_snapshots_now(uuid,uuid,text)','execute')"), false,
    "Authenticated client cannot invoke score announcement generation directly");
  eq(await value("select has_table_privilege('private.team_leaderboard_overtake_events','select')"), false,
    "Authenticated client cannot directly read source rows with private rank information");
  eq(await history("coach_leaderboard_overtake", 1), 0, "Revoked coach cannot read historical rank alert through RLS");
  await db.exec("reset role");
  await actor(null);
  await db.exec("set role service_role");
  eq(await value("select public.validate_jkcrew_push_scope($1)", [rank.id]), false, "Approval revocation blocks already-claimed rank delivery");
  await sql("select count(*) from public.claim_jkcrew_push_notifications('offline-fixture',50)");
  await db.exec("reset role");
  eq(await value("select status from public.push_notification_queue where id=$1", [rank.id]), "skipped",
    "Queue claim skips previously processing rank item after revocation");
  await sql("update private.fixture_cohort set team_id=$1 where profile_id=$2", [id(102), id(10)]);
  eq(await entitled(9, "coach_leaderboard_overtake", rank.payload), false, "Moving a rider to a different club revokes rank source visibility");
}

(async () => {
  try {
    await setup();
    await verifyCoachingAlerts();
    await verifyRankAlerts();
    console.log(`PASS: ${checked} private coaching notification checks`);
  } finally {
    await db.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
