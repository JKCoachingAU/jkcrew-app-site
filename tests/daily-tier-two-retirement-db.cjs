// Synthetic accounts only: retire Tier 2 without changing earned rewards or Daily.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { initializeTierTwo, id } = require('./daily-tier-two-db.cjs');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const retirement = fs.readdirSync(path.join(root, 'supabase/migrations')).find(name => name.endsWith('_retire_daily_tier_two.sql'));
(async () => {
  const db = new PGlite(); let checks = 0;
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const actor = async (n, role = 'authenticated') => {
    await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : '']); await db.exec(`set role ${role}`);
  };
  const rpc = (name, args = []) => scalar(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})`, args);
  const reject = async (fn, code) => { await assert.rejects(fn, error => error.code === code); checks++; };
  const snapshot = async () => {
    await db.exec('reset role');
    return scalar(`select jsonb_build_object(
      'templates',(select jsonb_agg(to_jsonb(t) order by athlete_id) from private.daily_tier_two_templates t),
      'rounds',(select jsonb_agg(to_jsonb(r) order by athlete_id,local_date) from private.daily_tier_two_rounds r),
      'awards',(select jsonb_agg(to_jsonb(a) order by id) from assignment_point_awards a),
      'landings',(select jsonb_agg(to_jsonb(h) order by id) from tricktionary_landing_history h),
      'progress',(select jsonb_agg(to_jsonb(p) order by assignment_id) from assignment_progress p))`);
  };
  try {
    await initializeTierTwo(db);
    await db.query("insert into profiles(id,role,display_name) values($1,'coach','Coach'),($2,'parent','Parent'),($3,'coach','Unlinked coach')", [id(1), id(2), id(3)]);
    for (const n of [10, 11, 12]) {
      await db.query("insert into profiles(id,role,display_name) values($1,'athlete',$2)", [id(n), `Rider ${n}`]);
      await db.query('insert into coach_athletes values($1,$2)', [id(1), id(n)]);
      await db.query('insert into parent_athletes values($1,$2)', [id(2), id(n)]);
      await db.query("insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select $1,$2,$3,week_start_date,'Manual','daily','Test park' from jkcrew_week_bounds('AU')", [id(n * 100), id(1), id(n)]);
      await db.query("insert into training_sessions(id,athlete_id,started_at,daily_venue) values($1,$2,greatest(now()-interval '5 minutes',date_trunc('day',now() at time zone 'Australia/Brisbane') at time zone 'Australia/Brisbane'),'Test park')", [id(n * 1000), id(n)]);
    }
    await actor(1);
    await rpc('set_daily_tier_two_template', [id(10), JSON.stringify([{ trick_name: 'Bunny hop', notes: 'Saved coach challenge' }])]);
    const rounds = {};
    for (const n of [10, 11]) {
      await actor(n);
      const candidate = (await rpc('record_daily_trick_action', [id(n * 100), 'landed', 'Test park', null])).completion_candidate;
      await rpc('confirm_daily_finish', [candidate.candidate_id]);
      rounds[n] = await rpc('unlock_daily_tier_two', [id(n)]);
      if (n === 10) {
        await rpc('record_daily_tier_two_trick', [id(n), rounds[n].items[0].id, true]);
        eq((await rpc('complete_daily_tier_two', [id(n)])).points_awarded, 4);
      }
    }
    const before = await snapshot();
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations', retirement), 'utf8');
    await db.exec(sql);
    eq(await snapshot(), before, 'Retirement changes no templates, rounds, progress, awards or landing history');
    await db.exec(sql);
    eq(await snapshot(), before, 'Migration can safely be reapplied');
    for (const n of [1, 2, 10]) {
      await actor(n);
      const hidden = await rpc('get_daily_tier_two', [id(10)]);
      eq(hidden.retired, true); eq(hidden.unlocked, false); eq(hidden.eligible, false);
      const history = await rpc('get_daily_tier_two', [id(10), rounds[10].local_date]);
      eq(history.points, 4, 'Previously earned reward remains visible in authorized history');
      eq(history.historical, true); eq(history.retired, true);
    }
    for (const n of [1, 11]) {
      await actor(n);
      await reject(() => rpc('unlock_daily_tier_two', [id(11)]), '55000');
      await reject(() => rpc('claim_daily_tier_two_reveal', [id(11)]), '55000');
      await reject(() => rpc('record_daily_tier_two_trick', [id(11), rounds[11].items[0].id, true]), '55000');
      await reject(() => rpc('complete_daily_tier_two', [id(11)]), '55000');
      await reject(() => rpc('set_daily_tier_two_template', [id(11), '[{"trick_name":"Late edit"}]']), '55000');
      await reject(() => scalar('select private.unlock_daily_tier_two($1)', [id(11)]), '55000');
    }
    for (const n of [3, 12]) { await actor(n); await reject(() => rpc('get_daily_tier_two', [id(10)]), '42501'); }
    await actor(null, 'anon'); await reject(() => rpc('get_daily_tier_two', [id(10)]), '42501');
    eq(await snapshot(), before, 'Stale clients cannot mutate retired rounds or award new points');
    await actor(12);
    const candidate = (await rpc('record_daily_trick_action', [id(1200), 'landed', 'Test park', null])).completion_candidate;
    const result = await rpc('confirm_daily_finish', [candidate.candidate_id]);
    eq(result.all_completed, true, 'Standard Daily still completes');
    eq(result.completion_points, 2, 'Existing full Daily and timing rewards still apply');
    await rpc('confirm_daily_finish', [candidate.candidate_id]);
    await db.exec('reset role');
    eq(await scalar("select sum(points)::int from assignment_point_awards where athlete_id=$1", [id(12)]), 2, 'Repeated standard completion never duplicates rewards');
    eq(await scalar("select sum(points)::int from assignment_point_awards where award_key like 'daily-tier-two:%'"), 4, 'Legacy Tier 2 points remain exactly once');
    console.log(`PASS: ${checks} Tier 2 retirement, stale-client blocking, retained history/points, permissions and standard Daily reward checks.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error.stack, error.where || ''); process.exitCode = 1; });
