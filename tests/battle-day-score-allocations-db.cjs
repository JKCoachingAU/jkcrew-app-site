// Isolated regression tests for battle-only, Brisbane-day score allocation.
// Never connects to Supabase or modifies live data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const db = new PGlite();
const root = path.resolve(__dirname, '..');
const migration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const coach=id(1), outsider=id(2), riders=Array.from({length:15},(_,i)=>id(100+i));
const q = async (sql,args=[]) => (await db.query(sql,args)).rows;
const scalar = async (sql,args=[]) => Object.values((await q(sql,args))[0])[0];
const auth = value => q("select set_config('request.jwt.claim.sub',$1,false)",[value || '']);
let scoreDate, day, sequence=1000, checks=0;
const at = (offset=0,hour=12) => new Date(Date.parse(day) + (offset*24+hour)*3600000).toISOString();
const award = (athlete,points,time=at()) => q('insert into assignment_point_awards(athlete_id,points,created_at) values($1,$2,$3)',[athlete,points,time]);
const adjust = (athlete,points,time=at(),reason='Training correction') => q('insert into leaderboard_point_adjustments(athlete_id,coach_id,points,created_at,reason) values($1,$2,$3,$4,$5)',[athlete,coach,points,time,reason]);
const points = (battle,athlete=riders[0]) => scalar('select private.jkcrew_rider_battle_points($1,$2)',[battle,athlete]);
const allocation = (battle,athlete=riders[0]) => scalar('select private.jkcrew_rider_battle_score_allocations($1,$2)',[battle,athlete]);
const allocate = (battle,athlete=riders[0],team=2,date=scoreDate,by=coach) => q('insert into private.rider_battle_day_allocations(battle_id,athlete_id,team_number,score_date,created_by,reason) values($1,$2,$3,$4,$5,$6)',[battle,athlete,team,date,by,'Coach assigned this training day']);
async function create(count=3) {
  const battle=id(sequence++);
  await q("insert into weekly_rider_battles(id,challenger_id,opponent_id,week_start,status,duration_days,starts_at,ends_at,reward_points,created_by,battle_size,team_count) values($1,$2,$3,$4,'accepted',7,$5,now()+interval '1 day',25,$6,5,$7)",[battle,riders[0],riders[5],scoreDate,at(-1,9),coach,count]);
  for(let i=0;i<count*5;i++) await q("insert into weekly_rider_battle_participants(battle_id,athlete_id,team_number,response,responded_at) values($1,$2,$3,'accepted',now())",[battle,riders[i],Math.floor(i/5)+1]);
  return battle;
}
async function expire(battle,time=at(2,19.5)) { await q('update weekly_rider_battles set ends_at=$2 where id=$1',[battle,time]); }
async function rejects(fn,pattern) { await db.exec('savepoint expected_failure'); try { await assert.rejects(fn,pattern); } finally { await db.exec('rollback to savepoint expected_failure'); } }
async function test(name,fn) { await db.exec('begin'); try { await auth(coach); await fn(); checks++; console.log('PASS '+name); } finally { await db.exec('reset role; rollback'); } }
const snapshot = async () => {
  const result={};
  for(const table of ['profiles','weekly_rider_battles','weekly_rider_battle_participants','assignment_point_awards','training_sessions','leaderboard_point_adjustments','push_notification_queue']) result[table]=await q(`select to_jsonb(row) value from ${table} row order by to_jsonb(row)::text`);
  return result;
};
const teamScores = participants => participants.reduce((scores,participant)=>{
  for(const [team,value] of Object.entries(participant.score_allocations)) scores[team]=(scores[team] || 0)+value;
  return scores;
},{});
(async () => {
  await db.exec(`
    create schema auth; create schema private; create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table profiles(id uuid primary key default gen_random_uuid(), role text, display_name text, ghost_mode boolean default false, avatar jsonb default '{}', level integer default 1);
    create table coach_athletes(coach_id uuid, athlete_id uuid, primary key(coach_id, athlete_id));
    create table weekly_rider_battles(id uuid primary key default gen_random_uuid(), challenger_id uuid references profiles, opponent_id uuid references profiles, week_start date, status text default 'pending', duration_days integer default 7, starts_at timestamptz, ends_at timestamptz, winner_id uuid, reward_points integer default 5, responded_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, battle_size integer default 1, winning_team integer, forfeited_by uuid, forfeited_at timestamptz, archived_at timestamptz, archived_by uuid,
      constraint weekly_rider_battles_winning_team_check check(winning_team in (1, 2)), check(battle_size between 1 and 3), constraint weekly_rider_battles_reward_points_check check(reward_points between 1 and 20));
    create unique index weekly_rider_battles_active_pair_idx on weekly_rider_battles(week_start, least(challenger_id::text, opponent_id::text), greatest(challenger_id::text, opponent_id::text)) where status in ('pending', 'accepted');
    create table weekly_rider_battle_participants(battle_id uuid references weekly_rider_battles on delete cascade, athlete_id uuid references profiles, team_number integer, response text default 'pending', responded_at timestamptz, baseline_points integer default 0, is_winner boolean, points_delta integer default 0, created_at timestamptz default now(), primary key(battle_id, athlete_id), constraint weekly_rider_battle_participants_team_number_check check(team_number in (1, 2)));
    create table push_notification_queue(recipient_id uuid, notification_type text, title text, body text, url text, payload jsonb, dedupe_key text unique);
    create table leaderboard_point_adjustments(id uuid default gen_random_uuid(), athlete_id uuid, coach_id uuid, points integer, reason text, week_start date, created_at timestamptz default now());
    create table assignment_point_awards(id uuid default gen_random_uuid(), athlete_id uuid, session_id uuid, points integer, created_at timestamptz default now());
    create table training_sessions(id uuid default gen_random_uuid(), athlete_id uuid, total_points integer, started_at timestamptz default now());
    create function current_rider_weekly_points(uuid) returns integer language sql as $$ select 0 $$;
  `);

  for(const name of ['20260907212548_three_sided_rider_battles.sql','20260907212718_private_three_sided_battle_creation.sql','20260911042341_expand_rider_battles_to_six_per_team.sql','20260914101000_support_five_point_stakes_for_large_teams.sql']) await db.exec(migration(name));
  await db.exec('grant usage on schema public,auth,private to authenticated; grant usage on schema public,auth to anon');
  await q("insert into profiles(id,role,display_name) values($1,'coach','Fixture coach'),($2,'coach','Unlinked coach')",[coach,outsider]);
  for(let i=0;i<riders.length;i++) { await q("insert into profiles(id,role,display_name) values($1,'athlete',$2)",[riders[i],`Rider ${i+1}`]); await q('insert into coach_athletes values($1,$2)',[coach,riders[i]]); }
  // Last week's Tuesday: every boundary and next-day event is safely in the past.
  const dates=(await q("select (date_trunc('week',timezone('Australia/Brisbane',now()))-interval '6 days')::date::text score_date,((date_trunc('week',timezone('Australia/Brisbane',now()))-interval '6 days') at time zone 'Australia/Brisbane') day_start"))[0];
  scoreDate=dates.score_date; day=dates.day_start;
  await auth(coach);
  const originalRaw=await q("select pg_get_functiondef('private.jkcrew_rider_battle_points(uuid,uuid)'::regprocedure) definition,proacl::text privileges from pg_proc where oid='private.jkcrew_rider_battle_points(uuid,uuid)'::regprocedure");
  const originalGrants=await q("select proname,proacl::text privileges from pg_proc where oid in ('public.get_my_rider_battles()'::regprocedure,'public.get_coach_rider_battles_v2(integer)'::regprocedure,'public.settle_expired_rider_battles()'::regprocedure) order by proname");
  const existing=await create(); await award(riders[0],14);
  const before=await snapshot();
  await db.exec(migration('20260915095056_battle_day_score_allocations.sql'));
  assert.deepEqual(await snapshot(),before,'Migration does not rewrite any roster, stake, score, account or notification');
  assert.deepEqual(await q("select pg_get_functiondef('private.jkcrew_rider_battle_points(uuid,uuid)'::regprocedure) definition,proacl::text privileges from pg_proc where oid='private.jkcrew_rider_battle_points(uuid,uuid)'::regprocedure"),originalRaw,'Personal battle score definition and grant are unchanged');
  assert.deepEqual(await q("select proname,proacl::text privileges from pg_proc where oid in ('public.get_my_rider_battles()'::regprocedure,'public.get_coach_rider_battles_v2(integer)'::regprocedure,'public.settle_expired_rider_battles()'::regprocedure) order by proname"),originalGrants,'Public feed and settlement grants preserved');
  assert.equal(await scalar('select count(*)::int from private.rider_battle_day_allocations'),0,'Migration never creates a live allocation');
  await q('delete from weekly_rider_battles where id=$1',[existing]); await db.exec('delete from assignment_point_awards');

  await test('exactly 14 points move once; roster, personal totals and stakes stay unchanged',async()=>{
    const battle=await create(); await award(riders[0],14);
    const original=await snapshot(); await allocate(battle);
    for(let i=0;i<3;i++) assert.deepEqual(await allocation(battle),{'1':0,'2':14});
    assert.equal(await points(battle),14); assert.deepEqual(await snapshot(),original);
    await q("insert into private.rider_battle_day_allocations(battle_id,athlete_id,team_number,score_date,created_by,reason) values($1,$2,2,$3,$4,'Retry') on conflict(battle_id,athlete_id) do nothing",[battle,riders[0],scoreDate,coach]);
    assert.deepEqual(await allocation(battle),{'1':0,'2':14});
    assert.equal(await scalar('select count(*)::int from private.rider_battle_day_allocations'),1);
    await rejects(()=>allocate(battle),/duplicate key/);
  });
  await test('only that Brisbane day moves; previous and tomorrow scores remain with original team',async()=>{
    const battle=await create(); await award(riders[0],4,at(-1,21)); await award(riders[0],14); await award(riders[0],6,at(1,14)); await allocate(battle);
    assert.equal(await points(battle),24); assert.deepEqual(await allocation(battle),{'1':10,'2':14});
    const other=await create(); assert.deepEqual(await allocation(other),{'1':24});
    assert.deepEqual(await allocation(battle,riders[1]),{'1':0});
    assert.deepEqual(await allocation(battle,id(900)),{});
  });
  await test('Brisbane midnight and exact battle start/end boundaries are half open',async()=>{
    const battle=await create(); await allocate(battle); await expire(battle);
    const start=at(-1,9), end=at(2,19.5);
    for(const [n,time] of [[100,new Date(Date.parse(start)-1).toISOString()],[2,start],[3,at(0,0)],[4,new Date(Date.parse(at(1,0))-1).toISOString()],[5,at(1,0)],[6,new Date(Date.parse(end)-1).toISOString()],[100,end]]) await award(riders[0],n,time);
    assert.equal(await points(battle),20); assert.deepEqual(await allocation(battle),{'1':13,'2':7});
    assert.equal(await scalar("select $1::timestamptz at time zone 'Australia/Brisbane' = $2::date::timestamp",[at(0,0),scoreDate]),true);
  });
  await test('award-backed sessions are deduplicated; legacy sessions and permitted adjustments retain parity',async()=>{
    const battle=await create(); const session=id(2000), legacy=id(2001);
    await q('insert into training_sessions(id,athlete_id,total_points,started_at) values($1,$2,99,$3),($4,$2,4,$3)',[session,riders[0],at(),legacy]);
    await q('insert into assignment_point_awards(athlete_id,session_id,points,created_at) values($1,$2,10,$3)',[riders[0],session,at()]);
    await adjust(riders[0],2); await adjust(riders[0],-2); await adjust(riders[0],900,at(),'All-time score correction: ignored'); await award(riders[0],6,at(1));
    await allocate(battle); assert.equal(await points(battle),20); assert.deepEqual(await allocation(battle),{'1':6,'2':14});
    // A session on Tuesday with an award on Wednesday counts only the award day.
    await q('insert into training_sessions(id,athlete_id,total_points,started_at) values($1,$2,500,$3)',[id(2002),riders[0],at()]);
    await q('insert into assignment_point_awards(athlete_id,session_id,points,created_at) values($1,$2,8,$3)',[riders[0],id(2002),at(1)]);
    assert.equal(await points(battle),28); assert.deepEqual(await allocation(battle),{'1':14,'2':14});
  });
  await test('negative adjustments cap routed points to the whole-battle nonnegative total',async()=>{
    const battle=await create(); await award(riders[0],14); await adjust(riders[0],-12,at(1)); await allocate(battle);
    assert.equal(await points(battle),2); assert.deepEqual(await allocation(battle),{'1':0,'2':2});
    await adjust(riders[0],-10,at(1)); assert.equal(await points(battle),0); assert.deepEqual(await allocation(battle),{'1':0,'2':0});
  });
  await test('negative-only routed day does not create negative contributions or erase another day',async()=>{
    const battle=await create(); await award(riders[0],10,at(1)); await adjust(riders[0],-3); await allocate(battle);
    assert.equal(await points(battle),7); assert.deepEqual(await allocation(battle),{'1':7,'2':0});
  });
  await test('live allocations exclude future timestamps using the same current-time cutoff as raw scores',async()=>{
    const battle=await create();
    const today=await scalar("select timezone('Australia/Brisbane',now())::date::text");
    await q("insert into assignment_point_awards(athlete_id,points,created_at) values($1,3,$2::date::timestamp at time zone 'Australia/Brisbane'),($1,7,($2::date::timestamp at time zone 'Australia/Brisbane')-interval '1 microsecond'),($1,100,now()+interval '1 second')",[riders[0],today]);
    await allocate(battle,riders[0],2,today);
    assert.equal(await points(battle),10); assert.deepEqual(await allocation(battle),{'1':7,'2':3});
  });
  await test('the allocation respects the source rider forfeiture cutoff at the exact instant',async()=>{
    const battle=await create(); await allocate(battle);
    await award(riders[0],3,at(-1,21)); await award(riders[0],4,at(0,9)); await award(riders[0],20,at(0,10)); await award(riders[0],100,at(0,11));
    await q('update weekly_rider_battle_participants set forfeited_at=$3 where battle_id=$1 and athlete_id=$2',[battle,riders[0],at(0,10)]);
    assert.equal(await points(battle),7); assert.deepEqual(await allocation(battle),{'1':3,'2':4});
  });
  await test('coach and athlete feeds expose identical allocations and retain personal score and original team',async()=>{
    const battle=await create(); await award(riders[0],14); await award(riders[1],20); await award(riders[5],25); await award(riders[10],10); await allocate(battle);
    await db.exec('set local role authenticated');
    await auth(coach); const coachFeed=await scalar('select public.get_coach_rider_battles_v2()');
    await auth(riders[0]); const athleteFeed=await scalar('select public.get_my_rider_battles()');
    const c=coachFeed.find(row=>row.id===battle), a=athleteFeed.find(row=>row.id===battle);
    for(const feed of [c,a]) { assert.equal(feed.participants.length,15); assert.equal(feed.reward_points,25); assert.deepEqual(teamScores(feed.participants),{'1':20,'2':39,'3':10}); const rider=feed.participants.find(row=>row.athlete_id===riders[0]); assert.equal(rider.team_number,1); assert.equal(rider.battle_points,14); assert.equal(rider.weekly_points,14); assert.equal(rider.score_allocation_date,scoreDate); assert.deepEqual(rider.score_allocations,{'1':0,'2':14}); }
    assert.deepEqual(a.participants.map(row=>row.score_allocations),c.participants.map(row=>row.score_allocations));
    await auth(id(999)); assert.deepEqual(await scalar('select public.get_my_rider_battles()'),[]);
    await db.exec('reset role');
  });
  await test('settlement selects the allocated winner and splits the unchanged 75-point pot across five riders',async()=>{
    const battle=await create(); await award(riders[0],14); await award(riders[1],20); await award(riders[5],25); await award(riders[10],10); await allocate(battle); await expire(battle);
    assert.equal(await scalar('select public.settle_expired_rider_battles()'),1);
    assert.equal(await scalar('select winning_team from weekly_rider_battles where id=$1',[battle]),2);
    const participants=await q('select athlete_id,team_number,is_winner,points_delta from weekly_rider_battle_participants where battle_id=$1',[battle]);
    assert.equal(participants.length,15); assert(participants.every(row=>row.points_delta===(row.team_number===2?10:-5))); assert(participants.every(row=>row.is_winner===(row.team_number===2)));
    assert.equal(participants.reduce((sum,row)=>sum+row.points_delta,0),0);
    assert.equal(participants.filter(row=>row.is_winner).reduce((sum,row)=>sum+5+row.points_delta,0),75);
    const after=await snapshot(); assert.equal(await scalar('select public.settle_expired_rider_battles()'),0); assert.deepEqual(await snapshot(),after,'Settling twice creates no duplicate awards or notifications');
    assert.equal(await scalar('select count(*)::int from leaderboard_point_adjustments'),15); assert.equal(await points(battle),14); assert.deepEqual(await allocation(battle),{'1':0,'2':14});
  });
  await test('unallocated battles retain their old winner and exact stake distribution',async()=>{
    const battle=await create(); await award(riders[0],34); await award(riders[5],25); await award(riders[10],10); await expire(battle);
    assert.equal(await scalar('select public.settle_expired_rider_battles()'),1); assert.equal(await scalar('select winning_team from weekly_rider_battles where id=$1',[battle]),1);
    const rows=await q('select team_number,points_delta from weekly_rider_battle_participants where battle_id=$1',[battle]); assert(rows.every(row=>row.points_delta===(row.team_number===1?10:-5)));
  });
  await test('allocation guards reject wrong date/team/rider/coach and ended battles',async()=>{
    const battle=await create();
    await rejects(()=>allocate(battle,riders[0],1),/another active team/);
    await rejects(()=>allocate(battle,riders[0],4),/active team|check/);
    await rejects(()=>allocate(battle,riders[0],2,'2001-01-01'),/overlap/);
    await rejects(()=>allocate(battle,id(999),2),/active team|foreign key/);
    await rejects(()=>allocate(battle,riders[0],2,scoreDate,outsider),/linked coach/);
    await q('update weekly_rider_battle_participants set forfeited_at=now() where battle_id=$1 and team_number=2',[battle]); await rejects(()=>allocate(battle),/active team/);
    await q('update weekly_rider_battle_participants set forfeited_at=null where battle_id=$1',[battle]); await expire(battle); await rejects(()=>allocate(battle),/active battle/);
  });
  await test('authenticated and anonymous callers cannot directly read/write allocations or call internal helpers',async()=>{
    const battle=await create(); await award(riders[0],14); await allocate(battle);
    for(const role of ['authenticated','anon']) {
      await db.exec(`set local role ${role}`); await auth(role==='authenticated'?coach:null);
      await rejects(()=>q('select * from private.rider_battle_day_allocations'),/permission denied/);
      await rejects(()=>q('delete from private.rider_battle_day_allocations'),/permission denied/);
      await rejects(()=>q('update private.rider_battle_day_allocations set team_number=3'),/permission denied/);
      await rejects(()=>allocate(battle),/permission denied/);
      await rejects(()=>allocation(battle),/permission denied/);
      await db.exec('reset role');
    }
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='private.rider_battle_day_allocations'::regclass"),true);
    assert.equal(await scalar("select count(*)::int from pg_policies where schemaname='private' and tablename='rider_battle_day_allocations'"),0);
    assert.deepEqual(await allocation(battle),{'1':0,'2':14});
  });
  await db.close(); console.log(`PASS ${checks} battle-day allocation scenarios; isolated PGlite only.`);
})().catch(error=>{console.error(error);process.exit(1);});
