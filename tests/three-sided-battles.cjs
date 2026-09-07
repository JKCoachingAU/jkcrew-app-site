const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260907212548_three_sided_rider_battles.sql'),'utf8');
const db=new PGlite();
const sql=(q,p=[])=>db.query(q,p);
const auth=id=>sql("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);
let coach,riders,parent,outsider;
async function rejects(fn,pattern){await db.exec("savepoint expected_failure");try{await assert.rejects(fn,pattern);}finally{await db.exec("rollback to savepoint expected_failure");}}
async function test(name,fn){await db.exec('begin');try{await fn();console.log('PASS '+name);}finally{await db.exec('rollback');}}
async function create(size=1,count=3,stake=5){await auth(coach);return (await sql('select public.request_rider_battle_v3($1,$2,$3,1,$4) id',[riders.slice(0,size),riders.slice(size,size*2),count===3?riders.slice(size*2,size*3):[],stake])).rows[0].id;}
async function accept(id){const ps=(await sql('select athlete_id from weekly_rider_battle_participants where battle_id=$1 order by team_number,athlete_id',[id])).rows;for(let i=0;i<ps.length;i++){await auth(ps[i].athlete_id);const result=(await sql("select respond_rider_battle($1,'accepted') status",[id])).rows[0].status;assert.equal(result,i===ps.length-1?'accepted':'pending');}await auth(coach);}
async function score(id,scores,expired=true){await sql("update weekly_rider_battles set starts_at=now()-interval '2 days',ends_at=now()+case when $2 then interval '-1 day' else interval '1 day' end where id=$1",[id,expired]);const ps=(await sql('select athlete_id,team_number from weekly_rider_battle_participants where battle_id=$1',[id])).rows;for(const p of ps)await sql("insert into assignment_point_awards(athlete_id,points,created_at) values($1,$2,now()-interval '36 hours')",[p.athlete_id,scores[p.team_number-1]]);}
(async()=>{
await db.exec(`
create schema auth; create schema private; create role anon; create role authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table profiles(id uuid primary key default gen_random_uuid(),role text,display_name text,ghost_mode boolean default false,avatar jsonb default '{}',level integer default 1);
create table coach_athletes(coach_id uuid,athlete_id uuid,primary key(coach_id,athlete_id));
create table weekly_rider_battles(id uuid primary key default gen_random_uuid(),challenger_id uuid references profiles,opponent_id uuid references profiles,week_start date,status text default 'pending',duration_days integer default 7,starts_at timestamptz,ends_at timestamptz,winner_id uuid,reward_points integer default 5,responded_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),created_by uuid,battle_size integer default 1,winning_team integer,forfeited_by uuid,forfeited_at timestamptz,archived_at timestamptz,archived_by uuid,
constraint weekly_rider_battles_winning_team_check check(winning_team in(1,2)),check(battle_size between 1 and 3),check(reward_points between 1 and 20));
create unique index weekly_rider_battles_active_pair_idx on weekly_rider_battles(week_start,least(challenger_id::text,opponent_id::text),greatest(challenger_id::text,opponent_id::text)) where status in ('pending','accepted');
create table weekly_rider_battle_participants(battle_id uuid references weekly_rider_battles on delete cascade,athlete_id uuid references profiles,team_number integer,response text default 'pending',responded_at timestamptz,baseline_points integer default 0,is_winner boolean,points_delta integer default 0,created_at timestamptz default now(),primary key(battle_id,athlete_id),constraint weekly_rider_battle_participants_team_number_check check(team_number in(1,2)));
create table push_notification_queue(recipient_id uuid,notification_type text,title text,body text,url text,payload jsonb,dedupe_key text unique);
create table leaderboard_point_adjustments(id uuid default gen_random_uuid(),athlete_id uuid,coach_id uuid,points integer,reason text,week_start date,created_at timestamptz default now());
create table assignment_point_awards(id uuid default gen_random_uuid(),athlete_id uuid,session_id uuid,points integer,created_at timestamptz default now());
create table training_sessions(id uuid default gen_random_uuid(),athlete_id uuid,total_points integer,started_at timestamptz default now());
create function current_rider_weekly_points(uuid) returns integer language sql as $$ select 0 $$;
`);
await db.exec(migration);
await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260907212718_private_three_sided_battle_creation.sql'),'utf8'));
await db.exec('grant usage on schema private to authenticated');
coach=(await sql("insert into profiles(role,display_name) values('coach','Test Coach') returning id")).rows[0].id;
parent=(await sql("insert into profiles(role,display_name) values('parent','Test Parent') returning id")).rows[0].id;
riders=(await sql("insert into profiles(role,display_name) select 'athlete','Rider '||i from generate_series(1,8)i returning id")).rows.map(r=>r.id);
outsider=(await sql("insert into profiles(role,display_name) values('athlete','Unlinked') returning id")).rows[0].id;
for(const id of riders)await sql('insert into coach_athletes values($1,$2)',[coach,id]);
await test('authorization, format validation and duplicate-rider rejection',async()=>{
 await auth(null);await rejects(()=>createAsCurrent(),/signed in/);
 async function createAsCurrent(t1=[riders[0]],t2=[riders[1]],t3=[riders[2]]){return sql('select request_rider_battle_v3($1,$2,$3,1,5)',[t1,t2,t3]);}
 await auth(parent);await rejects(()=>createAsCurrent(),/own team|Only riders/);
 await auth(coach);await rejects(()=>createAsCurrent([riders[0]],[riders[1]],[riders[0]]),/only appear once/);
 await rejects(()=>createAsCurrent([riders[0]],[riders[1]],[riders[2],riders[3]]),/equal teams/);
 await rejects(()=>createAsCurrent(riders.slice(0,3),riders.slice(3,6),[riders[6],riders[7],outsider]),/equal teams/);
 await rejects(()=>createAsCurrent([riders[0]],[riders[1]],[outsider]),/your crew/);
 await rejects(()=>createAsCurrent([riders[0]],null,[riders[1]]),/equal teams/);
 await rejects(()=>sql('select request_rider_battle_v3($1,$2,$3,1,0)',[[riders[0]],[riders[1]],[riders[2]]]),/value/);
});
for(const [size,count] of [[1,2],[2,2],[3,2],[1,3],[2,3]])for(const stake of [1,5,20])await test(`${Array(count).fill(size).join('v')} ${stake}-point exact payout and idempotency`,async()=>{
 const id=await create(size,count,stake);await accept(id);await score(id,count===3?[2,4,8]:[2,8]);
 const result=(await sql('select settle_expired_rider_battles() n')).rows[0].n;assert.equal(result,1);
 const sums=(await sql('select team_number,sum(points_delta)::integer delta,bool_and(is_winner) winner from weekly_rider_battle_participants where battle_id=$1 group by team_number order by team_number',[id])).rows;
 assert.equal(sums.at(-1).delta,stake*(count-1));assert(sums.at(-1).winner);
 assert(sums.slice(0,-1).every(r=>r.delta===-stake&&!r.winner));assert.equal(sums.reduce((s,r)=>s+r.delta,0),0);
 const ledger=(await sql('select count(*)::integer n,sum(points)::integer total from leaderboard_point_adjustments')).rows[0];assert.equal(ledger.total,0);
 assert.equal((await sql('select settle_expired_rider_battles() n')).rows[0].n,0);
 assert.equal((await sql('select count(*)::integer n from leaderboard_point_adjustments')).rows[0].n,ledger.n);
 const feed=(await sql('select get_coach_rider_battles_v2() feed')).rows[0].feed;assert.equal(feed[0].team_count,count);assert.equal(feed[0].participants.length,size*count);
});
await test('top-score tie is a draw with no point transfer',async()=>{const id=await create();await accept(id);await score(id,[8,8,2]);await sql('select settle_expired_rider_battles()');assert.equal((await sql('select winning_team from weekly_rider_battles where id=$1',[id])).rows[0].winning_team,null);assert.equal((await sql('select count(*)::integer n from leaderboard_point_adjustments')).rows[0].n,0);});
await test('third-side forfeit keeps two sides live; final forfeit awards survivor',async()=>{const id=await create(2);await accept(id);await score(id,[8,5,20],false);await auth(riders[4]);assert.equal((await sql('select forfeit_rider_battle($1) status',[id])).rows[0].status,'accepted');assert.equal((await sql('select count(*)::integer n from leaderboard_point_adjustments')).rows[0].n,0);await rejects(()=>sql('select forfeit_rider_battle($1)',[id]),/already forfeited/);await auth(riders[0]);assert.equal((await sql('select forfeit_rider_battle($1) status',[id])).rows[0].status,'completed');assert.equal((await sql('select winning_team from weekly_rider_battles where id=$1',[id])).rows[0].winning_team,2);assert.equal((await sql('select sum(points_delta)::integer n from weekly_rider_battle_participants where battle_id=$1 and team_number=2',[id])).rows[0].n,10);});
await test('a forfeited team cannot win at expiry',async()=>{const id=await create();await accept(id);await score(id,[4,8,20],false);await auth(riders[2]);await sql('select forfeit_rider_battle($1)',[id]);await sql("update weekly_rider_battles set ends_at=now()-interval '1 second' where id=$1",[id]);await sql('select settle_expired_rider_battles()');assert.equal((await sql('select winning_team from weekly_rider_battles where id=$1',[id])).rows[0].winning_team,2);});
await test('decline cancels the request; later accept cannot revive it',async()=>{const id=await create();await auth(riders[1]);await sql("select respond_rider_battle($1,'declined')",[id]);await auth(riders[2]);await rejects(()=>sql("select respond_rider_battle($1,'accepted')",[id]),/no longer pending/);});
await test('legacy two-sided RPC and forfeit still work',async()=>{await auth(coach);const id=(await sql('select request_rider_battle_v2($1,$2,1,5) id',[[riders[0]],[riders[1]]])).rows[0].id;await accept(id);await auth(riders[0]);assert.equal((await sql('select forfeit_rider_battle($1) status',[id])).rows[0].status,'completed');assert.equal((await sql('select winning_team,team_count from weekly_rider_battles where id=$1',[id])).rows[0].team_count,2);});
await test('authenticated API wrapper can create a three-sided battle',async()=>{await auth(riders[0]);await db.exec('set local role authenticated');const id=(await sql('select request_rider_battle_v3($1,$2,$3,1,5) id',[[riders[0]],[riders[1]],[riders[2]]])).rows[0].id;assert(id);await db.exec('reset role');});
assert.equal((await sql("select has_function_privilege('anon','public.request_rider_battle_v3(uuid[],uuid[],uuid[],integer,integer)','execute') allowed")).rows[0].allowed,false);
await db.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
