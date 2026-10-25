// Isolated regression for overlapping battle rewards. No production connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const migration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const fix = migration('20261025014336_exclude_battle_rewards_from_live_scores.sql');
const db = new PGlite();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const coach = id(1), riders = Array.from({length: 6}, (_, i) => id(100 + i));
const auth = who => scalar("select set_config('request.jwt.claim.sub',$1,false)", [who || '']);
const points = (battle, rider = riders[0]) => scalar('select private.jkcrew_rider_battle_points($1,$2)', [battle, rider]);
const between = (battle, rider = riders[0], start = '-infinity', end = 'infinity') => scalar('select private.jkcrew_rider_battle_points_between($1,$2,$3,$4)', [battle, rider, start, end]);
const allocation = (battle, rider = riders[0]) => scalar('select private.jkcrew_rider_battle_score_allocations($1,$2)', [battle, rider]);
const award = (rider, amount, time = "now()-interval '12 hours'") => q(`insert into assignment_point_awards(athlete_id,points,created_at) values($1,$2,${time})`, [rider, amount]);
const adjust = (rider, amount, reason, time = "now()-interval '12 hours'") => q(`insert into leaderboard_point_adjustments(athlete_id,coach_id,points,reason,created_at) values($1,$2,$3,$4,${time})`, [rider, coach, amount, reason]);
let sequence = 1000, checks = 0;
async function create({sizes = [2, 2], status = 'accepted', ended = false} = {}) {
  const battle = id(sequence++);
  await q(`insert into weekly_rider_battles(id,challenger_id,opponent_id,created_by,week_start,battle_size,team_count,reward_points,status,starts_at,ends_at)
    values($1,$2,$3,$4,current_date,$5,$6,10,$7,now()-interval '2 days',now()+case when $8 then interval '-1 hour' else interval '1 day' end)`,
    [battle, riders[0], riders[sizes[0]], coach, sizes[0], sizes.length, status, ended]);
  let i = 0;
  for (let team = 1; team <= sizes.length; team++) for (let n = 0; n < sizes[team - 1]; n++) {
    await q("insert into weekly_rider_battle_participants(battle_id,athlete_id,team_number,response) values($1,$2,$3,'accepted')", [battle, riders[i++], team]);
  }
  return battle;
}
async function snapshot() {
  const result = {};
  for (const table of ['weekly_rider_battles','weekly_rider_battle_participants','assignment_point_awards','training_sessions','leaderboard_point_adjustments','push_notification_queue']) {
    result[table] = await q(`select to_jsonb(t)-'exclude_battle_rewards' value from ${table} t order by to_jsonb(t)::text`);
  }
  return result;
}
async function test(name, fn) {
  await db.exec('begin');
  try { await auth(coach); await fn(); checks++; console.log('PASS ' + name); }
  finally { await db.exec('reset role; rollback'); }
}
async function rejects(fn, pattern) {
  await db.exec('savepoint expected_failure');
  try { await assert.rejects(fn, pattern); }
  finally { await db.exec('rollback to savepoint expected_failure'); }
}
const helperACLs = () => q(`select oid::regprocedure::text name,proacl::text privileges,prosecdef,provolatile,proconfig
  from pg_proc where oid in ('private.jkcrew_rider_battle_points(uuid,uuid)'::regprocedure,
    'private.jkcrew_rider_battle_points_between(uuid,uuid,timestamptz,timestamptz)'::regprocedure)
  order by name`);
(async () => {
  const foundation = fs.readFileSync(path.join(__dirname, 'battle-team-sizes-db.cjs'), 'utf8');
  await db.exec(foundation.match(/await db\.exec\(`\n([\s\S]*?)\n  `\);/)[1]);
  for (const name of ['20260907212548_three_sided_rider_battles.sql','20260907212718_private_three_sided_battle_creation.sql',
    '20260911042341_expand_rider_battles_to_six_per_team.sql','20260914101000_support_five_point_stakes_for_large_teams.sql',
    '20260915095056_battle_day_score_allocations.sql','20260921115318_unequal_two_rider_battles.sql']) await db.exec(migration(name));
  await db.exec(`create role service_role;
    create schema cron;
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    create function private.rider_features_disabled() returns boolean language sql stable as $$select false$$;
    grant usage on schema public,auth,private to authenticated;
    grant usage on schema public,auth to anon;
    revoke all on function private.jkcrew_rider_battle_points(uuid,uuid) from public,anon,authenticated;
  `);
  await db.exec(migration('20261002080151_schedule_rider_battle_settlement.sql'));
  await db.exec(migration('20260928003552_add_active_battles_spectator_feed.sql'));
  await q("insert into profiles(id,role,display_name) values($1,'coach','Coach')", [coach]);
  for (const [i, rider] of riders.entries()) {
    await q("insert into profiles(id,role,display_name) values($1,'athlete',$2)", [rider, ['Lars','Koby','Duke','Felix','Fifth rider','Sixth rider'][i]]);
    await q('insert into coach_athletes values($1,$2)', [coach, rider]);
  }
  await auth(coach);
  const completed = await create({status:'completed', ended:true});
  const current = await create();
  const pending = await create({status:'pending',sizes:[1,1]});
  const declined = await create({status:'declined'});
  await adjust(riders[0], 5, 'Rider battle ' + id(900) + ' win');
  await adjust(riders[1], -5, 'Rider battle ' + id(900) + ' loss');
  await award(riders[1], 7);
  assert.equal(await points(current), 5, 'Reproduces a previous battle payout leaking into Lars’s live score');
  assert.equal(await points(current, riders[1]), 2, 'Reproduces a previous battle loss reducing training scored in the next battle');
  assert.equal(await between(current), 5, 'The day-allocation helper has the same bug');
  const oldData = await snapshot(), oldACL = await helperACLs();
  const oldCompleted = await Promise.all(riders.slice(0,4).map(rider => points(completed,rider)));
  const oldPublic = await q("select oid::regprocedure::text name,pg_get_functiondef(oid) definition,proacl::text privileges from pg_proc where oid in ('public.get_my_rider_battles()'::regprocedure,'public.get_coach_rider_battles_v2(integer)'::regprocedure,'private.settle_expired_rider_battles()'::regprocedure,'public.forfeit_rider_battle(uuid)'::regprocedure) order by name");
  await db.exec('begin'); await db.exec(fix); await db.exec('commit');
  assert.equal(await points(current), 0); assert.equal(await between(current), 0);
  assert.equal(await points(current,riders[1]), 7); assert.equal(await between(current,riders[1]), 7);
  assert.deepEqual(await snapshot(), oldData, 'No ledger, reward, training data, status, roster, outcome or timestamp rewritten');
  assert.deepEqual(await Promise.all(riders.slice(0,4).map(rider => points(completed,rider))),oldCompleted,'Finished battle scores remain unchanged');
  assert.deepEqual(await q('select id,exclude_battle_rewards from weekly_rider_battles order by id'), [
    {id:completed,exclude_battle_rewards:false},{id:current,exclude_battle_rewards:true},
    {id:pending,exclude_battle_rewards:true},{id:declined,exclude_battle_rewards:false}]);
  assert.deepEqual(await helperACLs(),oldACL,'Private helper security and ACLs preserved');
  assert.deepEqual(await q("select oid::regprocedure::text name,pg_get_functiondef(oid) definition,proacl::text privileges from pg_proc where oid in ('public.get_my_rider_battles()'::regprocedure,'public.get_coach_rider_battles_v2(integer)'::regprocedure,'private.settle_expired_rider_battles()'::regprocedure,'public.forfeit_rider_battle(uuid)'::regprocedure) order by name"),oldPublic,'Public APIs and payout routines unchanged');
  await db.exec(fix);
  assert.deepEqual(await snapshot(),oldData); assert.deepEqual(await helperACLs(),oldACL);
  console.log('PASS reproduced overlap bug, corrected live/pending rules, preserved history/ledger/ACLs and idempotent migration'); checks++;
  await db.exec('truncate weekly_rider_battles,assignment_point_awards,training_sessions,leaderboard_point_adjustments,push_notification_queue cascade');

  await test('new battle requests and later acceptance retain the corrected scoring rule', async () => {
    const battle = await scalar('select public.request_rider_battle_v2($1,$2,7,10)', [[riders[0],riders[1]],[riders[2],riders[3]]]);
    assert.equal(await scalar('select exclude_battle_rewards from weekly_rider_battles where id=$1',[battle]),true);
    for (const rider of riders.slice(0,4)) { await auth(rider); await scalar("select public.respond_rider_battle($1,'accepted')",[battle]); }
    assert.equal(await scalar('select status from weekly_rider_battles where id=$1',[battle]),'accepted');
    assert.equal(await scalar('select exclude_battle_rewards from weekly_rider_battles where id=$1',[battle]),true);
  });
  await test('coach, rider and spectator feeds agree on zero with only an old battle win', async () => {
    const battle = await create(); await adjust(riders[0],5,'Rider battle '+id(900)+' win');
    const unchanged = await snapshot();
    await db.exec('set local role authenticated');
    for (const [viewer,rpc] of [[coach,'get_coach_rider_battles_v2'],[riders[0],'get_my_rider_battles']]) {
      await auth(viewer); const result=(await scalar(`select public.${rpc}()`)).find(row=>row.id===battle);
      assert.deepEqual(result.participants.map(p=>p.battle_points),[0,0,0,0]);
      assert(result.participants.every(p=>p.points_delta===0 && p.is_winner===null));
    }
    await auth(riders[5]);
    assert.deepEqual((await scalar('select public.get_active_rider_battles()')).battles[0].teams.map(team=>team.score),[0,0]);
    await db.exec('reset role'); assert.deepEqual(await snapshot(),unchanged);
  });
  await test('positive, negative and forfeit battle transfers never count in a new battle', async () => {
    const battle=await create(); await award(riders[0],6); await award(riders[1],8);
    for (const reason of ['win','win by forfeit']) await adjust(riders[0],20,'Rider battle '+id(900)+' '+reason);
    for (const reason of ['loss','forfeit loss']) await adjust(riders[1],-20,'RIDER BATTLE '+id(900)+' '+reason);
    assert.equal(await points(battle),6); assert.equal(await points(battle,riders[1]),8);
    assert.equal(await between(battle),6); assert.equal(await between(battle,riders[1]),8);
    assert.equal(await scalar('select sum(points)::integer from leaderboard_point_adjustments'),0);
    assert.equal(await scalar('select count(*)::integer from leaderboard_point_adjustments'),4);
  });
  await test('training, approved extras, challenge bonuses and valid corrections still count once', async () => {
    const battle=await create(), tracked=id(800),legacy=id(801);
    await q("insert into training_sessions(id,athlete_id,total_points,started_at) values($1,$2,99,now()-interval '12 hours'),($3,$2,4,now()-interval '12 hours')",[tracked,riders[0],legacy]);
    await q("insert into assignment_point_awards(athlete_id,session_id,points,created_at) values($1,$2,10,now()-interval '12 hours')",[riders[0],tracked]);
    await adjust(riders[0],1,'Other things landed approval');
    await adjust(riders[0],5,'Weekly challenge reward');
    await adjust(riders[0],3,'Training correction'); await adjust(riders[0],-2,'Training correction');
    await adjust(riders[0],900,'All-time score correction: ignored');
    await adjust(riders[0],20,'Rider battle '+id(900)+' win');
    assert.equal(await points(battle),21); assert.equal(await between(battle),21);
    await adjust(riders[0],-40,'Training correction'); assert.equal(await points(battle),0);
  });
  await test('half-open score windows, current-time limit and unknown riders remain unchanged', async () => {
    const battle=await create();
    await award(riders[0],2,"now()-interval '2 days'");
    await award(riders[0],100,"now()-interval '2 days 1 second'");
    await award(riders[0],3,"now()-interval '2 hours'");
    await award(riders[0],100,"now()+interval '1 minute'");
    await q("update weekly_rider_battles set ends_at=now()-interval '1 hour' where id=$1",[battle]);
    await award(riders[0],100,"now()-interval '1 hour'");
    assert.equal(await points(battle),5); assert.equal(await between(battle),5);
    assert.equal(await points(battle,riders[5]),0); assert.equal(await between(battle,riders[5]),0);
    assert.equal(await points(id(999)),0);
    const noStart=await create({status:'pending',sizes:[1,1]}); await q('update weekly_rider_battles set starts_at=null where id=$1',[noStart]);
    assert.equal(await points(noStart),0);
  });
  await test('Brisbane day allocations route training only and retain negative correction caps', async () => {
    const battle=await create({sizes:[2,2,2]});
    const date=await scalar("select (timezone('Australia/Brisbane',now())::date-1)::text");
    const dayStart=await scalar("select $1::date::timestamp at time zone 'Australia/Brisbane'",[date]);
    await q('update weekly_rider_battles set starts_at=$2::timestamptz-interval \'1 day\' where id=$1',[battle,dayStart]);
    await q('insert into assignment_point_awards(athlete_id,points,created_at) values($1,4,$2::timestamptz-interval \'1 hour\'),($1,6,$2::timestamptz+interval \'12 hours\')',[riders[0],dayStart]);
    await q("insert into leaderboard_point_adjustments(athlete_id,coach_id,points,reason,created_at) values($1,$2,20,$3,$4::timestamptz+interval '12 hours')",[riders[0],coach,'Rider battle '+id(900)+' win',dayStart]);
    await q("insert into private.rider_battle_day_allocations(battle_id,athlete_id,score_date,team_number,created_by,reason) values($1,$2,$3,2,$4,'Coach moved this session day')",[battle,riders[0],date,coach]);
    assert.equal(await points(battle),10); assert.deepEqual(await allocation(battle),{'1':4,'2':6});
    await q("insert into leaderboard_point_adjustments(athlete_id,coach_id,points,reason,created_at) values($1,$2,-8,'Training correction',$3::timestamptz-interval '1 hour')",[riders[0],coach,dayStart]);
    assert.equal(await points(battle),2); assert.deepEqual(await allocation(battle),{'1':0,'2':2});
  });
  await test('expiry chooses the training winner, pays once and stays stable after completion', async () => {
    const battle=await create(); await award(riders[0],1); await award(riders[2],4);
    await adjust(riders[0],100,'Rider battle '+id(900)+' win');
    await q("update weekly_rider_battles set ends_at=now()-interval '1 hour' where id=$1",[battle]);
    assert.equal(await scalar('select private.settle_expired_rider_battles()'),1);
    assert.equal(await scalar('select winning_team from weekly_rider_battles where id=$1',[battle]),2);
    assert.deepEqual(await q('select team_number,points_delta from weekly_rider_battle_participants where battle_id=$1 order by athlete_id',[battle]),[
      {team_number:1,points_delta:-5},{team_number:1,points_delta:-5},{team_number:2,points_delta:5},{team_number:2,points_delta:5}]);
    assert.equal(await points(battle),1); assert.equal(await between(battle),1);
    assert.equal(await scalar('select exclude_battle_rewards from weekly_rider_battles where id=$1',[battle]),true);
    const paid=await snapshot(); assert.equal(await scalar('select private.settle_expired_rider_battles()'),0);
    assert.deepEqual(await snapshot(),paid);
  });
  await test('expiry with only an old payout is a draw and creates no new transfer', async () => {
    const battle=await create({ended:true}); await adjust(riders[0],5,'Rider battle '+id(900)+' win');
    const ledger=await q('select * from leaderboard_point_adjustments');
    assert.equal(await scalar('select private.settle_expired_rider_battles()'),1);
    assert.equal(await scalar('select winning_team from weekly_rider_battles where id=$1',[battle]),null);
    assert.deepEqual(await q('select * from leaderboard_point_adjustments'),ledger);
    assert.equal(await points(battle),0); assert.equal(await between(battle),0);
  });
  await test('forfeiture remains a separate legitimate payout and cannot boost the next battle', async () => {
    const first=await create(), second=await create({sizes:[1,2]});
    await auth(riders[0]); assert.equal(await scalar('select public.forfeit_rider_battle($1)',[first]),'completed');
    assert.equal(await scalar('select count(*)::integer from leaderboard_point_adjustments'),4);
    // Place the payout inside the observed window, rather than exactly at the
    // transaction's stable now() cutoff, to simulate the next feed refresh.
    await q("update leaderboard_point_adjustments set created_at=now()-interval '1 second'");
    for(const rider of riders.slice(0,4)) assert.equal(await points(second,rider),0);
    assert.equal(await scalar('select status from weekly_rider_battles where id=$1',[second]),'accepted');
  });
  await test('private score helpers remain inaccessible to authenticated and anonymous clients', async () => {
    const battle=await create();
    for(const role of ['authenticated','anon']) {
      await db.exec('set local role '+role);
      await rejects(()=>points(battle),/permission denied/);
      await rejects(()=>between(battle),/permission denied/);
      await rejects(()=>q('update weekly_rider_battles set exclude_battle_rewards=false where id=$1',[battle]),/permission denied/);
      await db.exec('reset role');
    }
  });
  console.log(`${checks} battle reward isolation regression cases passed`);
  await db.close();
})().catch(error=>{console.error(error.stack);process.exit(1);});
