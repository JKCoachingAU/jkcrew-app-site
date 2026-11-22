// Use disposable PGlite and the real push scope/emitter with synthetic network responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const db = new PGlite();
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const migration = name => read(`supabase/migrations/${name}`);
const slice = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
const count = table => value(`select count(*)::integer from ${table}`);
const seed = JSON.parse(read('data/uci-rankings.json'));
const date = value => new Date(value).toISOString().slice(0, 10);
const midnight = Date.parse(`${date(Date.now())}T00:00:00Z`);
const dayMs = 86400000;
const recentWeek = midnight - ((new Date(midnight).getUTCDay() + 6) % 7) * dayMs;
const oldWeek = date(recentWeek - 7 * dayMs);
const newWeek = date(recentWeek);
const checkedAt = Date.now() - 60000;
const snapshot = (men, women, offset = 0) => ({ schemaVersion: 1, checkedAt: new Date(checkedAt + offset).toISOString(),
  categories: {
    men: { ...seed.categories.men, rankingDate: men },
    women: { ...seed.categories.women, rankingDate: women },
  },
});
const apply = item => value('select private.apply_uci_ranking_notice_snapshot($1)', [item]);
const allowed = (actor, week = newWeek) => value("select private.jkcrew_notification_allowed($1, 'uci_rankings_published', $2)", [id(actor), { publication_week: week }]);

(async () => {
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema private; create schema auth; create schema cron; create schema net;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create table public.profiles (id uuid primary key, role text, country_code text, is_platform_owner boolean default false);
      create table public.coach_teams (id uuid primary key, status text);
      create table private.coach_team_memberships (coach_id uuid primary key, team_id uuid, status text);
      create table private.coach_account_access (coach_id uuid primary key, status text);
      create table public.push_subscriptions (user_id uuid, enabled boolean);
      create table public.push_preferences (user_id uuid primary key, list_requests boolean, coach_rank_updates boolean);
      create table net.requests (id bigint generated always as identity, url text, timeout_ms integer);
      create table net._http_response (id bigint primary key, status_code integer, timed_out boolean, error_msg text, content text);
      create function net.http_get(url text, timeout_milliseconds integer) returns bigint language sql as $$
        insert into net.requests (url, timeout_ms) values (url, timeout_milliseconds) returning id
      $$;
      create table cron.test_jobs (name text primary key, schedule text, statement text);
      create function cron.schedule(name text, schedule text, statement text) returns bigint language sql as $$
        insert into cron.test_jobs values (name, schedule, statement) returning 1::bigint
      $$;
    `);
    const push = migration('202607181200_add_web_push_notifications.sql');
    const alerts = migration('20260828090000_finish_notification_center_and_alerts.sql');
    const teams = migration('20261116123906_isolate_team_data_and_add_coach_memberships.sql');
    await db.exec(slice(push, 'create table if not exists public.push_notification_queue', 'create table if not exists public.leaderboard_rank_snapshots'));
    await db.exec(slice(alerts, 'create table if not exists public.app_notifications', '-- Preserve every existing push type'));
    await db.exec(slice(teams, 'create function private.jkcrew_actor_approved', 'create function private.jkcrew_user_team_ids'));
    await db.exec(migration('202606131215_add_colombia_country_timezone.sql'));
    await db.exec(migration('20261122030606_publish_uci_world_ranking_notifications.sql'));
    assert.equal(await count('cron.test_jobs'), 0, 'Wait for the shared scope migration to install cron');

    const scope = migration('20261122073100_notify_private_coaching_activity.sql');
    await db.exec(slice(scope, 'create or replace function private.jkcrew_notification_allowed', 'create or replace function private.queue_jkcrew_list_request_push'));
    await db.exec(slice(teams, 'create or replace function private.guard_notification_team_scope', '-- Retain the worker secret'));
    const install = 'select private.install_uci_rankings_notification_jobs();';
    assert(scope.includes(install), 'The shared scope migration installs cron after extending the scope');
    await db.exec(install);
    assert.deepEqual((await rows('select schedule from cron.test_jobs order by name')).map(row => row.schedule), ['*/5 23 * * *', '0 23 * * *']);
    const coachCases = [
      [1, 'coach', 101, 'active', 'approved'], [2, 'coach', 101, 'active', 'approved'],
      [3, 'coach', 102, 'active', 'approved'], [4, 'coach', 101, 'active', 'pending'],
      [5, 'coach', 101, 'revoked', 'approved'], [6, 'coach', 103, 'active', 'approved'],
      [7, 'athlete', 101, 'active', 'approved'], [8, 'parent', 101, 'active', 'approved'],
      [9, 'admin', 102, 'active', null], [10, 'coach', 101, 'active', 'approved'],
      [11, 'coach', null, null, 'approved'], [12, 'coach', 101, 'active', 'suspended'],
    ];
    for (const n of [101, 102, 103]) await rows('insert into public.coach_teams values ($1, $2)', [id(n), n === 103 ? 'archived' : 'active']);
    for (const [n, role, team, status, approval] of coachCases) {
      await rows('insert into public.profiles values ($1, $2, $3, $4)', [id(n), role, n === 2 ? 'DE' : 'AU', n === 9]);
      if (team) await rows('insert into private.coach_team_memberships values ($1, $2, $3)', [id(n), id(team), status]);
      if (approval) await rows('insert into private.coach_account_access values ($1, $2)', [id(n), approval]);
      await rows('insert into public.push_subscriptions values ($1, $2)', [id(n), n !== 10]);
    }
    await rows('insert into public.push_preferences(user_id,event_updates) values ($1,false)', [id(3)]);
    await rows(`insert into public.push_preferences (user_id,quiet_hours_enabled,quiet_hours_start,quiet_hours_end)
      values ($1,true,(timezone('Europe/Berlin',now()) - interval '1 hour')::time,
        (timezone('Europe/Berlin',now()) + interval '1 hour')::time)`, [id(2)]);

    assert.equal(await apply(snapshot(oldWeek, oldWeek)), 0, 'Initial published pair seeds silently');
    assert.equal(await count('public.app_notifications'), 0);
    assert.equal(await apply({ ...snapshot(oldWeek, oldWeek, 1000), worldCup: { men: { rankingDate: newWeek } } }), 0,
      'New check time and World Cup updates do not count as a world ranking publication');
    const invalid = snapshot(newWeek, newWeek, 2000);
    invalid.categories.women.sourceUrl = invalid.categories.women.sourceUrl.replace('RankingDetails/241', 'RankingDetails/273');
    await assert.rejects(apply(invalid), /verified UCI world-ranking category/);
    await assert.rejects(apply({ ...invalid, checkedAt: new Date(Date.now() - 4 * dayMs).toISOString() }), /source check is stale/);
    await assert.rejects(apply({ ...invalid, categories: { women: invalid.categories.women } }), /verified UCI world-ranking category/);
    assert.equal(await count('public.app_notifications'), 0);

    await rows('select private.request_uci_ranking_notice_refresh()');
    await rows('select private.request_uci_ranking_notice_refresh()');
    assert.deepEqual(await rows('select url, timeout_ms from net.requests'), [{ url: 'https://raw.githubusercontent.com/JKCoachingAU/jkcrew-app-site/uci-rankings/rankings.json', timeout_ms: 20000 }]);
    await rows('select private.consume_uci_ranking_notice_refresh()');
    assert.equal(await value('select request_id::integer from private.uci_ranking_notice_state'), 1, 'Still waits for the scheduled async response');
    await rows("insert into net._http_response values (1,503,false,'network error',null)");
    await rows('select private.consume_uci_ranking_notice_refresh()');
    assert.equal(await value('select last_poll_error from private.uci_ranking_notice_state'), 'Published UCI rankings unavailable.');
    assert.equal(await count('public.app_notifications'), 0, 'An unavailable feed never emits');

    await rows('select private.request_uci_ranking_notice_refresh()');
    await rows('insert into net._http_response values (2,200,false,null,$1)', [JSON.stringify(snapshot(newWeek, oldWeek, 3000))]);
    await rows('select private.consume_uci_ranking_notice_refresh()');
    assert.equal(await value('select last_poll_error from private.uci_ranking_notice_state'), null);
    assert.deepEqual((await rows('select recipient_id from public.app_notifications order by recipient_id')).map(row => row.recipient_id), [1,2,3,9,10].map(id));
    const pushes = await rows('select recipient_id,url,payload,available_at > now() as quiet from public.push_notification_queue order by recipient_id');
    assert.deepEqual(pushes.map(row => row.recipient_id), [1,2,9].map(id), 'Event preference and device permission control push only');
    assert.equal(pushes[1].quiet, true, 'Existing emitter applies coach quiet hours in their timezone');
    assert(pushes.every(row => row.url === './?push=command' && Object.keys(row.payload).sort().join() === 'publication_week,view'));
    assert.equal(await apply(snapshot(newWeek, newWeek, 4000)), 0, 'Second category of the same official week does not duplicate the notice');
    assert.equal(await apply(snapshot(newWeek, newWeek, 5000)), 0, 'Repeated daily checks have no new notification');
    await assert.rejects(apply(snapshot(oldWeek, newWeek, 6000)), /Older UCI ranking snapshot/);
    assert.equal(await count('public.push_notification_queue'), 3);
    assert.equal(await allowed(1), true);
    assert.equal(await allowed(1, oldWeek), false, 'No approved notification source for the baseline');
    assert.equal(await allowed(4), false, 'No cross-coach queued receipt');
    const claimed = await value("update public.push_notification_queue set status='processing' where recipient_id=$1 returning id", [id(1)]);
    assert.equal(await value('select public.validate_jkcrew_push_scope($1)', [claimed]), true);
    await rows("update private.coach_account_access set status='suspended' where coach_id=$1", [id(1)]);
    assert.equal(await value('select public.validate_jkcrew_push_scope($1)', [claimed]), false, 'Worker rechecks current team eligibility before sending');
    assert.equal(await allowed(1), false, 'Scope guard rejects a queued item after approval is withdrawn');
    await rows("update private.coach_team_memberships set team_id=$1 where coach_id=$2", [id(102), id(2)]);
    assert.equal(await allowed(2), false, 'Scope guard rejects queued items after changing teams');

    const privileges = await value("select has_function_privilege('authenticated','private.apply_uci_ranking_notice_snapshot(jsonb)','execute') or has_function_privilege('anon','private.install_uci_rankings_notification_jobs()','execute') or has_table_privilege('service_role','private.uci_ranking_notice_receipts','insert')");
    assert.equal(privileges, false, 'Public API and service callers cannot forge notifications or install jobs');
    console.log('PASS UCI ranking alerts: silent seed, verified men/women dates, weekly dedupe, async failure recovery, active team approvals, private receipts, event preferences and quiet hours.');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
