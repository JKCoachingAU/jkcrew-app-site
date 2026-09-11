const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
(async()=>{
  const db = new PGlite();
  const behavior=fs.readFileSync(path.join(__dirname,'daily-completion-db.cjs'),'utf8');
  await db.exec(behavior.match(/await db\.exec\(`([\s\S]*?)`\);/)[1]);
  const funcs=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/daily-production-functions.json'),'utf8')).functions;
  const order=['jkcrew_country_timezone(text)','jkcrew_week_bounds(text,timestamp with time zone)','private.jkcrew_venue_key(text)','level_badge(integer)','sync_xp_award(uuid,text,text,integer,text,uuid,uuid,text,text,uuid,jsonb)','sync_assignment_progress_xp()','sync_daily_pb_xp()','sync_daily_completion_timing()','record_assignment_action(uuid,text)','record_assignment_action_at_venue(uuid,text,text)','finish_group_session_daily(uuid,uuid,integer)','get_weekly_leaderboard()'];
  for(const signature of order) await db.exec(funcs.find(f=>f.signature===signature).definition);
  const base=fs.readFileSync(path.join(root,'supabase/migrations/20260911085353_confirm_daily_tricks_and_today_progress.sql'),'utf8');
  await db.exec(base);
  const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
  const actor=async n=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);
  const today=()=>scalar('select get_today_training_progress($1) value',[id(10)]);
  const standings=async fn=>(await db.query(`select athlete_id,weekly_points::text,rank_number::text from ${fn}()`)).rows;
  for(const [n,role,name,ghost,country] of [[1,'coach','Coach',false,'AU'],[2,'parent','Parent',false,'AU'],[10,'athlete','Rider',false,'AU'],[11,'athlete','Ghost leader',true,'US'],[12,'athlete','Zero event',false,'NZ'],[13,'athlete','Zero event',false,'AU'],[14,'athlete','No event',false,'AU'],[15,'athlete','Clamped score',false,'AU']]) await db.query('insert into profiles(id,role,display_name,ghost_mode,country_code) values($1,$2,$3,$4,$5)',[id(n),role,name,ghost,country]);
  await db.query('insert into coach_athletes values($1,$2)',[id(1),id(10)]);await db.query('insert into parent_athletes values($1,$2)',[id(2),id(10)]);
  await db.query("insert into training_sessions(id,athlete_id,total_points) values($1,$2,5),($3,$2,999),($4,$2,50)",[id(100),id(10),id(101),id(102)]);
  await db.query("insert into assignment_point_awards(athlete_id,session_id,award_key,points) values($1,$2,'current',10),($3,null,'ghost-current',40),($4,null,'zero',0)",[id(10),id(101),id(11),id(12)]);
  await db.query("insert into assignment_point_awards(athlete_id,session_id,award_key,points,created_at) values($1,$2,'old-excludes-session',50,now()-interval '14 days')",[id(10),id(102)]);
  await db.query("insert into leaderboard_point_adjustments(athlete_id,points,reason,week_start) select $1::uuid,7,'Coach bonus',week_start_date from jkcrew_week_bounds('AU') union all select $1::uuid,100,'All-time score correction fixture',week_start_date from jkcrew_week_bounds('AU') union all select $2::uuid,0,'Zero event',week_start_date from jkcrew_week_bounds('AU') union all select $3::uuid,-8,'Deduction',week_start_date from jkcrew_week_bounds('AU')",[id(10),id(13),id(15)]);
  const expected=new Map();for(const who of [1,2,10,11,14]){await actor(who);expected.set(who,await standings('public.get_weekly_leaderboard'));}
  assert.equal(expected.get(1).find(r=>r.athlete_id===id(10)).weekly_points,'22');
  assert.equal(expected.get(1).find(r=>r.athlete_id===id(12)).rank_number,expected.get(1).find(r=>r.athlete_id===id(13)).rank_number,'RANK preserves equal-name equal-point ties');
  assert(!expected.get(10).some(r=>r.athlete_id===id(11)),'Hidden ghost rows must be removed before rank');
  // Reproduce the hidden production dependency before installing the fix.
  await db.exec(`create or replace function public.get_earned_badges(uuid) returns jsonb language plpgsql as $$begin raise exception 'Forbidden badge sync reached';end$$;`);
  await actor(10);await assert.rejects(()=>today(),/Forbidden badge sync reached/);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260911100447_make_daily_standings_read_only.sql'),'utf8'));
  for(const who of [1,2,10,11,14]){await actor(who);assert.deepEqual(await standings('private.daily_readonly_standings'),expected.get(who),'Scores/ranks/visibility match the original reader exactly');}
  await actor(10);await db.exec('begin read only');const summary=await today();await db.exec('commit');assert.equal(summary.weekly_score,22,'Today succeeds inside a genuine read-only transaction');
  // Build one confirmed result. The trap remains installed during every call.
  await db.query("insert into weekly_trick_assignments(id,athlete_id,coach_id,week_start,trick_name,category,venue) select $1,$2,$3,week_start_date,'Safe Daily','daily','Test park' from jkcrew_week_bounds('AU')",[id(300),id(10),id(1)]);
  await db.query("insert into training_sessions(id,athlete_id,started_at) values($1,$2,greatest(now()-interval '1 minute',((now() at time zone 'Australia/Brisbane')::date)::timestamp at time zone 'Australia/Brisbane'))",[id(301),id(10)]);
  // End fixture scoring sessions so the explicit new timer is selected.
  await db.query('update training_sessions set ended_at=now() where athlete_id=$1 and id<>$2',[id(10),id(301)]);
  await db.query("insert into assignment_progress(assignment_id,athlete_id,progress_date) select $1,$2,local_today from jkcrew_week_bounds('AU')",[id(300),id(10)]);
  await db.query("insert into tricktionary_landing_history(id,assignment_id,athlete_id,trick_name,category,venue,landed_at,landing_date,landed_count,evidence_type) select 'daily:'||$1::text||':'||local_today::text,$1::uuid,$2::uuid,'Safe Daily','daily','Test park',now(),local_today,1,'progress' from jkcrew_week_bounds('AU')",[id(300),id(10)]);
  const pending=await scalar('select prepare_daily_finish($1,$2,$3) value',[id(10),id(301),'Test park']);
  const result=await scalar('select confirm_daily_finish($1) value',[pending.completion_candidate.candidate_id]);
  assert.equal(result.completion_points,2);assert.equal(result.weekly_score,24);assert.equal(result.rank_number,1);
  await db.exec('begin read only');assert.equal((await today()).weekly_score,24);await db.exec('commit');
  assert.equal(await scalar("select has_function_privilege('authenticated','private.daily_readonly_standings()','execute') value"),false);
  assert.equal(await scalar("select has_function_privilege('anon','private.daily_readonly_standings()','execute') value"),false);
  assert.equal(await scalar("select provolatile='s' as value from pg_proc where oid='private.daily_readonly_standings()'::regprocedure"),true);
  await db.close();console.log('PASS: hidden badge dependency reproduced; Today/confirm avoid it; read-only transaction succeeds; weekly score, ties, visibility and country boundaries preserve legacy parity.');
})().catch(error=>{console.error(error.message,error.where||'',error.stack);process.exit(1)});
