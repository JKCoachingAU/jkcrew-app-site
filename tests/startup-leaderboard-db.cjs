// Set-based startup reports in isolated PostgreSQL. No production requests.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
(async () => {
  const db = new PGlite(); let checks = 0;
  const q = (sql, args = []) => db.query(sql, args), scalar = async (sql, args) => Object.values((await q(sql, args)).rows[0])[0];
  const eq = (a, b, why) => { assert.deepEqual(a, b, why); checks++; };
  const as = actor => q("select set_config('request.jwt.claim.sub',$1,false)", [actor ? id(actor) : '']);
  try {
    await db.exec(`
      create schema auth; create schema private;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table profiles(id uuid primary key,display_name text,role text,level integer default 1,xp_total integer default 0,avatar jsonb default '{}',country_code text,country_name text,ghost_mode boolean default false,is_platform_owner boolean default false);
      create table auth.users(id uuid primary key,raw_app_meta_data jsonb default '{}');
      create table private.coach_account_access(coach_id uuid primary key,status text);
      create table private.coach_team_memberships(coach_id uuid primary key,team_id uuid,status text);
      create table coach_athletes(coach_id uuid,athlete_id uuid);
      create table parent_athletes(parent_id uuid,athlete_id uuid);
      create table assignment_point_awards(athlete_id uuid,session_id uuid,points integer,created_at timestamptz);
      create table training_sessions(id uuid,athlete_id uuid,total_points integer,started_at timestamptz);
      create table leaderboard_point_adjustments(athlete_id uuid,points integer,week_start date,reason text);
      create table athlete_badges(athlete_id uuid,badge_key text,badge_type text,label text,icon text,description text,earned_at timestamptz);
      create table weekly_other_try_awards(athlete_id uuid,points numeric,created_at timestamptz);
      create function private.xp_progression_enabled() returns boolean language sql stable as $$select false$$;
      create function private.require_coach_approval() returns void language plpgsql stable as $$begin
        if auth.uid() is not null and not exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role not in ('coach','admin') or p.is_platform_owner or exists(select 1 from private.coach_account_access a where a.coach_id=p.id and a.status='approved'))) then raise exception 'Approval required' using errcode='42501';end if;end$$;
      create function public.level_for_xp(integer) returns integer language sql immutable as $$select 1$$;
      create function public.get_earned_badges(uuid) returns jsonb language plpgsql as $$begin raise exception 'Retired sync must not run';end$$;
      create function public.jkcrew_week_bounds(p_country_code text,p_now timestamptz default now()) returns table(week_start_date date,week_start_ts timestamptz,next_week_start_ts timestamptz,local_today date) language sql stable as $$
        with zone as(select case p_country_code when 'DE' then 'Europe/Berlin' when 'US' then 'America/Los_Angeles' when 'CN' then 'Asia/Shanghai' else 'Australia/Brisbane' end z),local_clock as(select z,p_now at time zone z t from zone),bounds as(select *,t::date-extract(dow from t)::integer d from local_clock)
        select d,d::timestamp at time zone z,(d+7)::timestamp at time zone z,t::date from bounds$$;
    `);
    const cohort = fs.readFileSync(path.join(root, 'supabase/migrations/20261116123906_isolate_team_data_and_add_coach_memberships.sql'), 'utf8');
    await db.exec(cohort.slice(cohort.indexOf('create function private.jkcrew_actor_approved('), cohort.indexOf('create function private.jkcrew_same_team_profile(')));
    await db.exec(`create function public.get_weekly_leaderboard() returns table(athlete_id uuid,display_name text,level integer,avatar jsonb,country_code text,country_name text,weekly_points bigint,all_time_points bigint,session_count bigint,earned_badges jsonb,ghost_mode boolean,rank_number bigint,all_time_rank_number bigint,weekly_started boolean,weekly_point_events bigint,all_time_point_events bigint) language plpgsql as $$begin perform private.require_coach_approval();return query select * from private.approved_f58214f32cd50c933615433a();end$$;`);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261118213525_optimize_concurrent_startup_leaderboards.sql'), 'utf8'));
    for (const [n, role, team, status] of [[1, 'coach', 101, 'approved'], [2, 'coach', 102, 'approved'], [3, 'coach', 101, 'approved'], [4, 'coach', 104, 'pending']]) {
      await q('insert into profiles(id,display_name,role,country_code,is_platform_owner) values($1,$2,$3,\'AU\',$4)', [id(n), `Coach ${n}`, role, n === 1]);
      await q('insert into private.coach_account_access values($1,$2)', [id(n), status]);
      await q("insert into private.coach_team_memberships values($1,$2,'active')", [id(n), id(team)]);
    }
    for (let n = 201; n <= 215; n++) {
      const country = ['AU', 'DE', 'US', 'CN'][n % 4];
      await q("insert into profiles(id,display_name,role,country_code,country_name,ghost_mode)values($1,$2,'athlete',$3,$3,$4)", [id(n), `Rider ${n}`, country, n === 215]);
      await q("insert into auth.users values($1,$2)", [id(n), JSON.stringify({ role: 'athlete', registered_coach_id: id(1) })]);
      await q('insert into coach_athletes values($1,$2),($3,$2)', [id(1), id(n), id(3)]);
      const bounds = (await q('select * from jkcrew_week_bounds($1)', [country])).rows[0];
      await q('insert into training_sessions values($1,$2,999,now()),($3,$2,3,now()),($4,$2,11,$5::timestamptz-interval \'1 second\')', [id(n + 1000), id(n), id(n + 2000), id(n + 3000), bounds.week_start_ts]);
      await q("insert into assignment_point_awards values($1,$2,2,now()),($1,null,4,$3::timestamptz-interval '1 day'),($1,null,5,$3::timestamptz-interval '1 second'),($1,null,6,$3),($1,null,7,$4)", [id(n), id(n + 1000), bounds.week_start_ts, bounds.next_week_start_ts]);
      await q("insert into leaderboard_point_adjustments values($1,-2,$2,'Manual'),($1,10,$2,'All-time score correction fixture'),($1,1,$2::date-7,'Previous week')", [id(n), bounds.week_start_date]);
      await q("insert into weekly_other_try_awards values($1,0.5,now()),($1,0.5,$2::timestamptz-interval '1 day')", [id(n), bounds.week_start_ts]);
    }
    await q("insert into athlete_badges values($1,'history','manual','Historical badge','x','Preserved',now())", [id(201)]);
    await q("insert into profiles(id,display_name,role,country_code)values($1,'Foreign rider','athlete','AU'),($2,'Unlinked rider','athlete','AU')", [id(301), id(401)]);
    await q('insert into coach_athletes values($1,$2)', [id(2), id(301)]);
    await q('insert into assignment_point_awards values($1,null,500,now())', [id(301)]);
    await q("insert into profiles(id,display_name,role,country_code) values($1,'Parent','parent','AU')", [id(501)]);
    await q('insert into parent_athletes values($1,$2)', [id(501), id(201)]);
    const report = () => q('select * from private.approved_a99af139d8dd7b72d7f249bf()');
    await as(1); let board = (await report()).rows;
    eq(board.length, 15, 'Owner sees 15 own riders including ghost, never foreign rider');
    eq(board.every(r => Number(r.weekly_points) === 9.5 && Number(r.all_time_points) === 48), true, 'Country week bounds, legacy sessions, correction rules and half points stay exact');
    eq(board.every(r => Number(r.weekly_point_events) === 5 && Number(r.all_time_point_events) === 12 && Number(r.session_count) === 3), true, 'Events/sessions are not doubled by two coach links');
    eq(board[0].rank_number, 1, 'Foreign 500-point rider never affects own rank');
    eq(board.find(r => r.athlete_id === id(201)).earned_badges[0].key, 'history', 'Historical badges read without retired sync');
    await as(3); eq((await report()).rows, board, 'Assistant gets identical own-team live scores');
    await as(201); eq((await report()).rows.length, 14, 'Rider cannot see another rider in ghost mode');
    await as(215); eq((await report()).rows.length, 15, 'Ghost rider can see own row');
    await as(501); eq((await report()).rows.length, 14, 'Linked parent sees only own team and respects ghosts');
    await as(2); board = (await report()).rows; eq(board.map(r => r.athlete_id), [id(301)], 'Same-country foreign coach stays isolated');
    eq(Number(board[0].weekly_points), 500, 'Foreign team keeps its independent score');
    await as(401); eq((await report()).rows.map(r => r.athlete_id), [id(401)], 'Unlinked athlete sees only self');
    await as(4); await assert.rejects(report(), /Approval required/); checks++;
    await as(null); await assert.rejects(report(), /Sign in required/); checks++;
    await as(1); await q("insert into leaderboard_point_adjustments values($1,-1000,(select week_start_date from jkcrew_week_bounds('DE')),'Negative fixture')", [id(201)]);
    const floor = (await report()).rows.find(r => r.athlete_id === id(201));
    eq([Number(floor.weekly_points), Number(floor.all_time_points)], [0.5, 1], 'Base negative scores clamp before precise half awards, as before');
    eq(await scalar('select count(*)::int from assignment_point_awards'), 76, 'Reads never create or alter point receipts');
    console.log(`PASS: ${checks} startup leaderboard DB checks; 15 riders, precise live scores, country boundaries, shared staff, ghost visibility, historical badges and tenant/approval isolation.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error.message, error.where || ''); process.exitCode = 1; });
