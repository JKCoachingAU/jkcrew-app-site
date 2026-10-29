// Real PostgreSQL-compatible scoring/XP functions; synthetic riders only.
// Does not connect to Supabase or modify live accounts.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const { initialize, id, partialMigration } = require('./daily-partial-db.cjs');
const root = path.resolve(__dirname, '..');
const readMigration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const pause = readMigration('20261029113237_pause_xp_and_badge_progression.sql');
function sqlFunction(source, name) {
  const start = source.search(new RegExp(`create (?:or replace )?function ${name.replaceAll('.', '\\.')}\\(`, 'i'));
  assert(start >= 0, name);
  const tail = source.slice(start), delimiter = tail.match(/\bas\s+(\$[a-z_]*\$)/i);
  const end = tail.indexOf(delimiter[1], delimiter.index + delimiter[0].length);
  return tail.slice(0, end + delimiter[1].length) + ';';
}
(async () => {
  const db = new PGlite(); let checks = 0;
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
  const rpc = (name, args = []) => scalar(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})`, args);
  const actor = async (n, role = 'authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : '']);
    await db.exec(`set role ${role}`);
  };
  const freezeSnapshot = async () => ({
    profiles: await q('select id,xp_total,level,badges from profiles order by id'),
    xp: await q('select * from xp_ledger order by id'),
    badges: await q('select * from athlete_badges order by athlete_id,badge_key'),
  });
  try {
    await initialize(db);
    await db.exec(readMigration(partialMigration));
    await db.exec(`
      drop function public.sync_profile_xp(uuid);
      drop function public.level_for_xp(integer);
      alter table profiles add column badges jsonb default '[]';
      create table athlete_badges(
        athlete_id uuid references profiles on delete cascade, badge_key text, badge_type text default 'achievement', level integer,
        label text,icon text default '',tone text default '',description text default '',source text default 'system',source_id text,
        earned_at timestamptz default now(),awarded_by uuid references profiles on delete set null,metadata jsonb default '{}',
        created_at timestamptz default now(),updated_at timestamptz default now(),primary key(athlete_id,badge_key));
      alter table xp_ledger add foreign key(athlete_id) references profiles on delete cascade;
      alter table xp_ledger add foreign key(assignment_id) references weekly_trick_assignments on delete set null;
      alter table xp_ledger add foreign key(session_id) references training_sessions on delete set null;
      alter table xp_ledger add foreign key(coach_id) references profiles on delete set null;
      alter table push_notification_queue add column status text default 'pending',add column attempts integer default 0,
        add column available_at timestamptz default now(),add column created_at timestamptz default now(),add column processed_at timestamptz,
        add column last_error text default '';
      create table app_notifications(id uuid default gen_random_uuid(),recipient_id uuid,notification_type text,payload jsonb default '{}',archived_at timestamptz);
      create schema vault; create table vault.decrypted_secrets(name text,decrypted_secret text);
      insert into vault.decrypted_secrets values('jkcrew_push_worker_secret','fixture-secret');
      create function private.recovery_reminder_due(uuid,text,text) returns boolean language sql as $$select true$$;
      create function private.rider_recovery_active(uuid) returns boolean language sql as $$select false$$;
    `);
    const originalXp = readMigration('202606110930_add_gamified_xp_levels.sql');
    for (const name of ['public.xp_required_for_level', 'public.level_for_xp', 'public.xp_progress_json', 'public.adjust_athlete_xp']) {
      await db.exec(sqlFunction(originalXp, name));
    }
    for (const fn of JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/progression-production-functions.json'), 'utf8')).functions) await db.exec(fn.definition);
    await db.exec('create trigger percentage_attempt_xp_sync after insert or update or delete on percentage_attempts for each row execute function sync_percentage_attempt_xp();');

    // Install the real automatic challenge reward path alongside the real scoring
    // RPCs, so the regression covers the feature most easily confused with XP.
    const challengeFixture = fs.readFileSync(path.join(__dirname, 'challenge-rewards-db.cjs'), 'utf8');
    for (const name of ['coach_athlete_groups', 'private.rider_feature_access', 'weekly_challenges', 'weekly_challenge_completions']) {
      await db.exec(challengeFixture.match(new RegExp('create table ' + name.replaceAll('.', '\\.') + '\\([^;]+;'))[0]);
    }
    await db.exec('create function private.activate_due_weekly_challenges() returns integer language sql as $$select 0$$;');
    for (const fn of JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/challenge-scoring-production-functions.json'), 'utf8')).functions) await db.exec(fn.definition);
    await db.exec(readMigration('20261002080137_auto_award_weekly_challenge_rewards.sql'));
    await db.exec(`
      insert into profiles(id,role,display_name) values('${id(1)}','coach','Coach'),('${id(2)}','athlete','Rider'),('${id(3)}','parent','Parent'),('${id(4)}','athlete','Other rider');
      insert into coach_athletes values('${id(1)}','${id(2)}'); insert into parent_athletes values('${id(3)}','${id(2)}');
      insert into push_subscriptions values('${id(1)}',true);
      insert into training_sessions(id,athlete_id,started_at,daily_venue) values('${id(20)}','${id(2)}',now()-interval '10 minutes','Test park');
      insert into coach_group_sessions(id,coach_id,venue,started_at) values('${id(30)}','${id(1)}','Test park',now()-interval '10 minutes');
      insert into coach_group_session_participants(group_session_id,athlete_id,training_session_id) values('${id(30)}','${id(2)}','${id(20)}');
    `);
    for (const [n, category] of [[10,'one_bang'],[11,'dialled'],[12,'bonus'],[13,'percentage'],[14,'daily'],[15,'daily'],[16,'one_bang']]) {
      await q("insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select $1,$2,$3,week_start_date,$4,$5,'Test park' from jkcrew_week_bounds('AU')", [id(n),id(1),id(2),`Trick ${n}`,category]);
    }
    await actor(2);
    eq((await rpc('record_assignment_action', [id(10),'landed'])).points_awarded, 2, 'Reproduce normal scoring before the pause');
    await db.exec('reset role');
    eq(await scalar('select xp_total from profiles where id=$1', [id(2)]),35, 'Before change a normal trick generates XP');
    assert((await scalar('select count(*)::int from athlete_badges')) > 0, 'Before change an XP read/award creates badges'); checks++;
    await q("insert into athlete_badges(athlete_id,badge_key,badge_type,label,awarded_by) values($1,'legacy-manual','manual','Historical badge',$2)", [id(2),id(1)]);
    await rpc('sync_xp_award',[id(4),'historical','legacy',20,'Historical award']);
    await q("update profiles set badges='[\"historical\"]' where id=$1",[id(2)]);
    await q("insert into push_notification_queue(recipient_id,notification_type,payload,dedupe_key) values($1,'level_up','{}','old-xp'),($1,'weekly_challenge_completed','{}','old-challenge')",[id(2)]);
    await q("insert into app_notifications(recipient_id,notification_type) values($1,'badge_earned'),($1,'park_king_changed')",[id(2)]);
    const before = await freezeSnapshot();
    const pointsBefore = await q('select * from assignment_point_awards order by id');
    const policies = await q("select * from pg_policies where schemaname='public' order by tablename,policyname");
    const scoreDefinition = await scalar("select pg_get_functiondef('public.record_assignment_action(uuid,text)'::regprocedure)");
    await db.exec(pause);
    eq(await freezeSnapshot(), before, 'Migration keeps every historical XP/profile/badge value and timestamp');
    eq(await q('select * from assignment_point_awards order by id'), pointsBefore, 'Migration does not rewrite normal points');
    eq(await q("select * from pg_policies where schemaname='public' order by tablename,policyname"), policies, 'Existing public permissions stay unchanged');
    eq(await scalar("select pg_get_functiondef('public.record_assignment_action(uuid,text)'::regprocedure)"),scoreDefinition,'Scoring RPC implementation is unchanged');
    eq(await scalar("select status from push_notification_queue where dedupe_key='old-xp'"),'skipped','Queued XP notification retained but cancelled');
    eq(await scalar("select status from push_notification_queue where dedupe_key='old-challenge'"),'pending','Challenge push still pending');
    eq(await scalar("select archived_at is not null from app_notifications where notification_type='badge_earned'"),true,'Historical badge notice hidden without deletion');
    eq(await scalar("select archived_at is null from app_notifications where notification_type='park_king_changed'"),true,'Park crown history kept visible');

    await actor(2);
    const unchanged = await rpc('sync_xp_award',[id(2),'one_bang',id(10),999,'Old client overwrite']);
    eq(unchanged.xp_delta,0); eq(unchanged.xp_awarded,0); eq(unchanged.xp_removed,0); eq(unchanged.leveled_up,false); eq(unchanged.xp_enabled,false);
    eq((await rpc('sync_xp_award',[id(2),'one_bang',id(10),0,'Old client undo'])).xp_removed,0);
    await rpc('get_xp_summary',[id(2)]); await rpc('get_earned_badges',[id(2)]);
    eq(await rpc('ensure_level_badges',[id(2)]),0); eq(await rpc('sync_achievement_badges',[id(2)]),0);
    await actor(1); eq((await rpc('adjust_athlete_xp',[id(2),500,'Old coach app'])).xp_awarded,0);
    await actor(2); await assert.rejects(()=>rpc('adjust_athlete_xp',[id(2),500,'Rider']),/coach/i); checks++;
    await actor(3); eq((await rpc('get_xp_summary',[id(2)])).xp_enabled,false,'Linked parent old summary remains compatible');
    await actor(2);
    eq((await rpc('record_assignment_action',[id(11),'landed'])).points_awarded,2,'Dialled still awards normal points');
    eq((await rpc('record_assignment_action',[id(10),'unlanded'])).points_removed,2,'Undo still removes normal trick points');
    eq((await rpc('record_assignment_action',[id(10),'landed'])).points_awarded,2,'Retick scores normally, without new XP');
    await db.exec('reset role');
    await q("insert into weekly_challenges(id,title,category,target_count,reward_points,starts_at,ends_at,created_by) values($1,'Bonus challenge','bonus',1,5,now()-interval '1 hour',now()+interval '1 day',$2)",[id(80),id(1)]);
    await actor(1); eq((await rpc('record_assignment_action',[id(12),'landed'])).points_awarded,5,'Bonus trick still awards +5');
    await actor(2); eq((await rpc('get_my_weekly_challenge')).completed,true,'Challenge automatically completes');
    for(let attempt=1;attempt<=10;attempt++) await rpc('set_percentage_attempt',[id(13),attempt,true]);
    await db.exec('reset role');
    eq(await scalar('select sum(points)::int from leaderboard_point_adjustments'),5,'Challenge reward retained, exactly once');
    eq(await scalar('select points from assignment_point_awards where assignment_id=$1',[id(13)]),3,'Perfect percentage points retained');
    await actor(2);
    await rpc('record_daily_trick_action',[id(14),'landed','Test park',null]);
    const candidate=(await rpc('record_daily_trick_action',[id(15),'landed','Test park',null])).completion_candidate;
    assert(candidate?.candidate_id); checks++;
    const finish=await rpc('confirm_daily_finish',[candidate.candidate_id]);
    eq(finish.completion_points,3,'Daily completion, under-20 and first group finisher points all retained');
    eq(finish.completion_xp,0,'Daily result reports no new XP');
    eq(await rpc('confirm_daily_finish',[candidate.candidate_id]),finish,'Repeated finish does not duplicate points');
    await db.exec('reset role'); eq(await freezeSnapshot(),before,'Actual trick, challenge, percentage and Daily RPCs leave historical XP/badges frozen');
    eq(await scalar('select sum(points)::int from assignment_point_awards'),15,'All normal training points total correctly');
    eq(await scalar('select count(*)::int from private.daily_finish_candidates where status=\'confirmed\''),1,'Daily result still saved');

    // Defensive tests deliberately grant direct table access in this isolated
    // fixture. Existing production RLS is not loosened by the migration.
    await db.exec('grant select,insert,update,delete on athlete_badges,xp_ledger,profiles to authenticated;');
    await actor(2);
    await q("insert into xp_ledger(athlete_id,source_type,source_id,xp) values($1,'legacy','new',100)",[id(2)]);
    await q('update xp_ledger set xp=999'); await q('delete from xp_ledger');
    await q("insert into athlete_badges(athlete_id,badge_key,label) values($1,'new','New')",[id(2)]);
    await q("update athlete_badges set label='Changed'"); await q('delete from athlete_badges');
    await q("update profiles set xp_total=999,level=50,badges='[\"new\"]',display_name='Updated name' where id=$1",[id(2)]);
    await db.exec('reset role'); eq(await freezeSnapshot(),before,'Legacy direct writes cannot alter frozen values');
    eq(await scalar('select display_name from profiles where id=$1',[id(2)]),'Updated name','Unrelated profile edits still save');
    await q("insert into profiles(id,role,xp_total,level,badges) values($1,'athlete',999,50,'[\"new\"]')",[id(5)]);
    eq((await q('select xp_total,level,badges from profiles where id=$1',[id(5)]))[0],{xp_total:0,level:1,badges:[]},'New accounts cannot inherit supplied XP/badges');
    for(const role of ['anon','authenticated','service_role']) {
      eq(await scalar('select has_table_privilege($1,\'private.progression_feature_settings\',\'update\')',[role]),false,`${role} cannot enable progression`);
      eq(await scalar('select has_function_privilege($1,\'private.paused_xp_progress(uuid)\',\'execute\')',[role]),false,`${role} cannot read private helper directly`);
    }

    const normalTypes=['weekly_challenge_completed','rider_battle_result','park_king_changed','recovery_checkin_reminder','uci_qualification_update'];
    for(const type of [...normalTypes,'xp_awarded','level_up','badge_earned','prestige_earned']) {
      await q('insert into push_notification_queue(recipient_id,notification_type,payload,dedupe_key) values($1,$2,\'{}\',$2)',[id(2),type]);
      await q('insert into app_notifications(recipient_id,notification_type,payload) values($1,$2,\'{}\')',[id(2),type]);
    }
    await q("insert into push_notification_queue(recipient_id,notification_type,payload,dedupe_key) values($1,'achievement','{\"celebration\":\"prestige\"}','generic-prestige'),($1,'achievement','{\"celebration\":\"weekly_challenge\"}','generic-challenge')",[id(2)]);
    eq(await scalar("select count(*)::int from push_notification_queue where dedupe_key in ('xp_awarded','level_up','badge_earned','prestige_earned','generic-prestige')"),0,'Retired-feature notices suppressed');
    eq(await scalar('select count(*)::int from push_notification_queue where dedupe_key=any($1)',[normalTypes]),normalTypes.length,'Training/UCI/recovery notification types retained');
    eq(await scalar("select count(*)::int from push_notification_queue where dedupe_key='generic-challenge'"),1,'Generic challenge achievement retained');
    await q("update push_notification_queue set status='pending' where dedupe_key='old-xp'");
    const claimed=await q("select notification_type from claim_jkcrew_push_notifications('fixture-secret',100)");
    eq(claimed.some(row=>row.notification_type==='level_up'),false,'Retried old XP messages are also excluded at claim time');
    assert(normalTypes.every(type=>claimed.some(row=>row.notification_type===type))); checks++;
    await assert.rejects(()=>q("select * from claim_jkcrew_push_notifications('wrong',100)"),/secret/); checks++;

    // Stored original implementations can resume later; no history restoration
    // or account reset is needed. Re-pause before checking reference cleanup.
    await q('update private.progression_feature_settings set xp_enabled=true');
    await actor(2); eq((await rpc('record_assignment_action',[id(16),'landed'])).points_awarded,2);
    await db.exec('reset role'); eq(await scalar('select xp_total from profiles where id=$1',[id(2)]),70,'Re-enable resumes original +35 XP implementation');
    await q('update private.progression_feature_settings set xp_enabled=false');
    const historicXp=await scalar('select sum(xp)::int from xp_ledger');
    await q('delete from weekly_trick_assignments where id=$1',[id(16)]);
    eq(await scalar('select sum(xp)::int from xp_ledger'),historicXp,'Deleting a list does not erase historical XP');
    eq(await scalar('select assignment_id from xp_ledger where source_id=$1',[id(16)]),null,'FK reference can clear safely when a list is deleted');
    await q('delete from profiles where id=$1',[id(1)]);
    eq(await scalar("select awarded_by from athlete_badges where badge_key='legacy-manual'"),null,'Badge coach FK cleanup stays compatible');
    await q('delete from profiles where id=$1',[id(4)]);
    eq(await scalar('select count(*)::int from xp_ledger where athlete_id=$1',[id(4)]),0,'Explicit account deletion can still perform its existing XP FK cascade');
    eq(await scalar('select count(*)::int from athlete_badges where athlete_id=$1',[id(4)]),0,'Explicit account deletion can still perform its existing badge FK cascade');
    console.log(`PASS ${checks} progression-pause checks: preserved history; genuine Daily, trick, percentage and challenge scoring; legacy RPC/direct-write freeze; notification filtering; private switch; reversible resume; safe FK cleanup. Synthetic PGlite only.`);
  } finally { await db.close(); }
})().catch(error=>{console.error(error.stack,error.where||'');process.exitCode=1;});
