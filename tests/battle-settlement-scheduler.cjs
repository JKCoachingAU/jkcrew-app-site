// Isolated PostgreSQL/PGlite regression; no network or production mutations.
// pg_cron is unavailable in WASM, so its named-job registration is a test double.
// Production verification must additionally inspect cron.job and job_run_details.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const migration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const fix = migration('20261002080151_schedule_rider_battle_settlement.sql');
const db = new PGlite();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params = []) => Object.values((await q(sql, params))[0])[0];
const auth = id => scalar("select set_config('request.jwt.claim.sub', $1, false)", [id || '']);
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const coach = uid(1), riders = Array.from({length: 18}, (_, i) => uid(i + 100));
let checks = 0;
async function test(name, fn) {
  await db.exec('begin');
  try { await fn(); console.log('PASS ' + name); checks++; }
  finally { await db.exec('rollback'); }
}
async function rejects(fn, pattern) {
  await db.exec('savepoint expected_failure');
  try { await assert.rejects(fn, pattern); }
  finally { await db.exec('rollback to savepoint expected_failure'); }
}
async function create(sizes = [1, 1], stake = 5, expire = true, scores = [8, 4]) {
  const id = await scalar(`insert into weekly_rider_battles(challenger_id,opponent_id,created_by,week_start,battle_size,team_count,reward_points,status,starts_at,ends_at)
    values($1,$2,$3,current_date,$4,$5,$6,'accepted',now()-interval '2 days',now()+case when $7 then interval '-1 minute' else interval '1 day' end) returning id`,
    [riders[0],riders[sizes[0]],coach,sizes[0],sizes.length,stake,expire]);
  let i = 0;
  for (let team = 1; team <= sizes.length; team++) for (let rank = 0; rank < sizes[team - 1]; rank++) {
    const rider = riders[i++];
    await q("insert into weekly_rider_battle_participants(battle_id,athlete_id,team_number,response) values($1,$2,$3,'accepted')",[id,rider,team]);
    if (rank === 0) await q("insert into assignment_point_awards(athlete_id,points,created_at) values($1,$2,now()-interval '12 hours')",[rider,scores[team-1] || 0]);
  }
  return id;
}
const state = () => q(`select to_jsonb(b) battle,(select jsonb_agg(p order by p.athlete_id) from weekly_rider_battle_participants p where p.battle_id=b.id) participants from weekly_rider_battles b order by b.id`);
async function assertPayout(id, sizes, stake, winner) {
  const participants = await q('select * from weekly_rider_battle_participants where battle_id=$1 order by team_number,athlete_id',[id]);
  const ledger = await q("select athlete_id,points,reason from leaderboard_point_adjustments where reason like 'Rider battle '||$1||'%' order by athlete_id",[id]);
  for (let team=1;team<=sizes.length;team++) {
    const members=participants.filter(p=>p.team_number===team), amount=stake*(team===winner?sizes.length-1:1);
    members.forEach((p,rank)=>{
      const share=Math.floor(amount/members.length)+(rank<amount%members.length?1:0);
      assert.equal(p.points_delta,winner===null?0:((team===winner?share:-share)||0));
      assert.equal(p.is_winner,winner===null?null:team===winner);
      assert.equal(ledger.filter(a=>a.athlete_id===p.athlete_id).length,p.points_delta?1:0);
      if(p.points_delta)assert.equal(ledger.find(a=>a.athlete_id===p.athlete_id).points,p.points_delta);
    });
  }
  assert.equal(ledger.reduce((s,p)=>s+p.points,0),0);
  assert.equal(await scalar('select status from weekly_rider_battles where id=$1',[id]),'completed');
  return ledger;
}
(async()=>{
  const source=fs.readFileSync(path.join(__dirname,'battle-team-sizes-db.cjs'),'utf8');
  await db.exec(source.match(/await db\.exec\(`\n([\s\S]*?)\n  `\);/)[1]);
  await db.exec('create role service_role;');
  for(const name of ['20260907212548_three_sided_rider_battles.sql','20260907212718_private_three_sided_battle_creation.sql','20260911042341_expand_rider_battles_to_six_per_team.sql','20260914101000_support_five_point_stakes_for_large_teams.sql','20260915095056_battle_day_score_allocations.sql','20260921115318_unequal_two_rider_battles.sql']) await db.exec(migration(name));
  await db.exec(`create schema cron;
    create table cron.job(jobname text primary key,schedule text,command text,username name,active boolean default true);
    create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language plpgsql as $$begin
      insert into cron.job(jobname,schedule,command,username) values(p_name,p_schedule,p_command,current_user)
      on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command,active=true;
      return 1; end$$;
    revoke all on function public.settle_expired_rider_battles() from public,anon,authenticated;
    grant execute on function public.settle_expired_rider_battles() to service_role;
    grant usage on schema auth,private to anon,authenticated,service_role;
  `);
  await q("insert into profiles(id,role,display_name) values($1,'coach','Coach')",[coach]);
  for (const [i,id] of riders.entries()) {
    await q("insert into profiles(id,role,display_name) values($1,'athlete',$2)",[id,'Rider '+i]);
    await q('insert into coach_athletes values($1,$2)',[coach,id]);
  }
  await test('old public settlement cannot run unattended without a rider JWT',async()=>{
    await create(); await auth(null);
    await rejects(()=>q('select public.settle_expired_rider_battles()'),/must be signed in/);
    assert.equal(await scalar("select count(*)::integer from weekly_rider_battles where status='accepted'"),1);
  });
  const acl=await scalar("select proacl::text from pg_proc where oid='public.settle_expired_rider_battles()'::regprocedure");
  const old=await create([2,1]); const before=await state();
  await db.exec(fix);
  assert.deepEqual(await state(),before,'Applying migration never settles, rewrites or backfills historical data');
  assert.equal(await scalar("select proacl::text from pg_proc where oid='public.settle_expired_rider_battles()'::regprocedure"),acl);
  await db.exec(fix);
  assert.equal(await scalar("select count(*)::integer from cron.job where jobname='jkcrew-settle-rider-battles'"),1);
  const job=(await q('select * from cron.job'))[0];
  assert.equal(job.schedule,'* * * * *'); assert.equal(job.command,'select private.settle_expired_rider_battles();'); assert.equal(job.active,true);
  for(const role of ['anon','authenticated','service_role']) assert.equal(await scalar("select has_function_privilege($1,'private.settle_expired_rider_battles()','execute')",[role]),false);
  assert.equal(await scalar("select prosecdef from pg_proc where oid='private.settle_expired_rider_battles()'::regprocedure"),false);
  assert.equal(await scalar("select array_to_string(proconfig,',') from pg_proc where oid='private.settle_expired_rider_battles()'::regprocedure"),'search_path=""');
  await db.exec('truncate weekly_rider_battles,assignment_point_awards,leaderboard_point_adjustments,push_notification_queue cascade;');
  console.log('PASS history, API grants, internal worker isolation and idempotent cron registration preserved'); checks++;
  for(const sizes of [[1,1],[2,1],[1,2],[2,2],[5,5,5]]) for(const winner of [...sizes.map((_,i)=>i+1),null]) {
    await test(`${sizes.join('v')} scheduled ${winner===null?'draw':'team '+winner+' win'} pays exact shares once without app activity`,async()=>{
      const stake=sizes.length===3?25:5;
      const id=await create(sizes,stake,true,sizes.map((_,i)=>winner===null?8:winner===i+1?12:4));
      await auth(null);
      assert.equal(await scalar(job.command),1);
      const ledger=await assertPayout(id,sizes,stake,winner);
      const events=await scalar('select count(*)::integer from push_notification_queue');
      assert.equal(await scalar(job.command),0);
      assert.deepEqual(await assertPayout(id,sizes,stake,winner),ledger);
      await auth(riders[0]);
      await q('select public.get_my_rider_battles()');
      assert.deepEqual(await assertPayout(id,sizes,stake,winner),ledger);
      assert.equal(await scalar('select count(*)::integer from push_notification_queue'),events);
    });
  }
  await test('future and pending battles stay untouched',async()=>{
    const id=await create([1,1],5,false);
    await auth(null); const before=await state();
    assert.equal(await scalar(job.command),0); assert.deepEqual(await state(),before);
    await q("update weekly_rider_battles set status='pending',ends_at=now()-interval '1 day' where id=$1",[id]);
    const pending=await state(); assert.equal(await scalar(job.command),0); assert.deepEqual(await state(),pending);
  });
  await test('settlement failure rolls back status, participant payouts and ledger; retry pays once',async()=>{
    const id=await create(); await auth(null);
    await db.exec(`create function public.fail_battle_test() returns trigger language plpgsql as $$begin raise exception 'test ledger unavailable'; end$$;
      create trigger fail_battle before insert on leaderboard_point_adjustments for each row execute function public.fail_battle_test();`);
    const before=await state(); await rejects(()=>scalar(job.command),/test ledger unavailable/);
    assert.deepEqual(await state(),before); assert.equal(await scalar('select count(*)::integer from leaderboard_point_adjustments'),0);
    await db.exec('drop trigger fail_battle on leaderboard_point_adjustments;');
    assert.equal(await scalar(job.command),1); await assertPayout(id,[1,1],5,1); assert.equal(await scalar(job.command),0);
  });
  await test('anon, rider, coach and service client cannot invoke the owner-only worker',async()=>{
    for(const [role,id] of [['anon',null],['authenticated',riders[0]],['authenticated',coach],['service_role',null]]) {
      await auth(id); await db.exec('set local role '+role);
      await rejects(()=>scalar(job.command),/permission denied/);
      await db.exec('reset role');
    }
    await auth(null); await rejects(()=>q('select public.settle_expired_rider_battles()'),/signed in/);
  });
  await test('two-sided forfeit and subsequent scheduled retry do not double-pay',async()=>{
    const id=await create([2,1],5,false); await auth(riders[0]);
    assert.equal(await scalar('select public.forfeit_rider_battle($1)',[id]),'completed');
    const ledger=await assertPayout(id,[2,1],5,2); await auth(null);
    assert.equal(await scalar(job.command),0); assert.deepEqual(await assertPayout(id,[2,1],5,2),ledger);
  });
  await test('three-sided forfeiture stays live until expiry, then only an eligible team wins',async()=>{
    const id=await create([2,2,2],5,false,[8,4,20]); await auth(riders[4]);
    assert.equal(await scalar('select public.forfeit_rider_battle($1)',[id]),'accepted');
    await auth(null); assert.equal(await scalar(job.command),0);
    await q("update weekly_rider_battles set ends_at=now()-interval '1 second' where id=$1",[id]);
    assert.equal(await scalar(job.command),1); await assertPayout(id,[2,2,2],5,1);
  });
  console.log(`${checks} battle scheduler regression cases passed`);
  await db.close();
})().catch(error=>{console.error(error.stack);process.exit(1);});
