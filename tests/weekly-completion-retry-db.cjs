// Actual scoring/history function bodies on an isolated synthetic schema. No
// network, production accounts, or timing claims. Public approval/team wrapper
// is retained; helper fixture data supplies only synthetic authorization state.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');
const {initialize,id}=require('./daily-partial-db.cjs');
const root=path.resolve(__dirname,'..');
const migration='20261118223752_make_completed_weekly_retries_read_only.sql';
const PUBLIC_WRAPPER="CREATE OR REPLACE FUNCTION public.record_assignment_action(p_assignment_id uuid, p_action text DEFAULT 'landed'::text)\n RETURNS jsonb\n LANGUAGE plpgsql\n SET search_path TO ''\nAS $function$begin perform private.require_coach_approval(); if $1 is not null and not (exists(select 1 from public.weekly_trick_assignments a where a.id=$1 and private.jkcrew_same_team_profile(a.athlete_id))) then raise exception 'This record belongs to another private team.' using errcode='42501'; end if; return private.approved_b223f0cd2e29fcfebf9311d3($1,$2); end;$function$\n";
const read=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
function extract(source,name){const start=source.toLowerCase().indexOf('create or replace function '+name+'(');assert(start>=0,name);const tail=source.slice(start),m=tail.match(/\bas\s+(\$[a-z_]*\$)/i);return tail.slice(0,tail.indexOf(m[1],m.index+m[0].length)+m[1].length)+';';}
(async()=>{const db=new PGlite();let checks=0;
const q=async(s,a=[]) => (await db.query(s,a)).rows;
const val=async(s,a=[])=>Object.values((await q(s,a))[0])[0];
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const denied=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const actor=async n=>q("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);
const action=(n,what='landed')=>val('select public.record_assignment_action($1,$2)',[id(n),what]);
try{
 await initialize(db);
 const baseline=extract(read('20261101114201_add_trick_links_training_category.sql'),'public.record_assignment_action').replace('public.record_assignment_action(','private.approved_b223f0cd2e29fcfebf9311d3(');
 await db.exec(baseline);
 await db.exec('revoke all on function private.approved_b223f0cd2e29fcfebf9311d3(uuid,text) from public,anon;grant execute on function private.approved_b223f0cd2e29fcfebf9311d3(uuid,text) to authenticated,service_role');
 await db.exec(`
 create table private.fixture_approval(actor uuid primary key,approved boolean,team integer);
 create function private.require_coach_approval()returns void language plpgsql as $$begin if not exists(select 1 from private.fixture_approval where actor=auth.uid() and approved)then raise exception 'Coach approval is required.' using errcode='42501';end if;end$$;
 create function private.jkcrew_same_team_profile(uuid)returns boolean language sql as $$select exists(select 1 from private.fixture_approval a join private.fixture_approval p on p.team=a.team where a.actor=auth.uid() and p.actor=$1)$$;
 create table private.fixture_write_audit(table_name text,op text);
 create function private.fixture_write_count()returns trigger language plpgsql as $$begin insert into private.fixture_write_audit values(tg_table_name,tg_op);return case when tg_op='DELETE' then old else new end;end$$;
 create function private.fixture_capture_count()returns trigger language plpgsql as $$begin insert into private.fixture_write_audit values('history_attempt',tg_op);return new;end$$;
 create trigger count_history_attempt before insert or update on tricktionary_landing_history for each row execute function private.fixture_capture_count();
 `);
 for(const table of ['assignment_progress','assignment_point_awards','trick_attempts','training_sessions','tricktionary_landing_history','xp_ledger'])await db.exec('create trigger fixture_write_count after insert or update or delete on '+table+' for each row execute function private.fixture_write_count()');
 await db.exec(PUBLIC_WRAPPER);
 await q("insert into profiles(id,role,display_name)values($1,'coach','Coach'),($2,'athlete','Rider'),($3,'athlete','Other team'),($4,'parent','Parent'),($5,'coach','Pending coach')",[1,2,3,4,5].map(id));
 await q('insert into coach_athletes values($1,$2)',[id(1),id(2)]);
 await q('insert into private.fixture_approval values($1,true,1),($2,true,1),($3,true,2),($4,true,1),($5,false,2)',[1,2,3,4,5].map(id));
 await q("insert into training_sessions(id,athlete_id,started_at)values($1,$2,now()-interval '5 minutes')",[id(20),id(2)]);
 const add=async(n,category)=>q("insert into weekly_trick_assignments(id,athlete_id,coach_id,week_start,trick_name,category,venue)select $1,$2,$3,week_start_date,$4,$5,'Test Park' from jkcrew_week_bounds('AU')",[id(n),id(2),id(1),'Trick '+n,category]);
 await add(100,'one_bang');await actor(2);await action(100);
 await db.exec('truncate private.fixture_write_audit');await action(100);
 eq(await val("select count(*)::int from private.fixture_write_audit where table_name='assignment_progress' and op='UPDATE'"),1,'Baseline repeat rewrites completed progress');
 eq(await val("select count(*)::int from private.fixture_write_audit where table_name='trick_attempts' and op='INSERT'"),1,'Baseline repeat writes a zero-point landed attempt');
 eq(await val("select count(*)::int from private.fixture_write_audit where table_name='history_attempt'"),2,'Baseline repeat revisits existing history INSERT and UPDATE');
 const before=await q('select assignment_id,athlete_id,completed_at,updated_at from assignment_progress order by assignment_id');
 const grantsBefore=await q("select proacl::text acl from pg_proc where oid='private.approved_b223f0cd2e29fcfebf9311d3(uuid,text)'::regprocedure");
 await db.exec(read(migration));
 eq(await q('select assignment_id,athlete_id,completed_at,updated_at from assignment_progress order by assignment_id'),before,'Migration does not rewrite progress');
 eq(await q("select proacl::text acl from pg_proc where oid='private.approved_b223f0cd2e29fcfebf9311d3(uuid,text)'::regprocedure"),grantsBefore,'Private implementation grants are preserved');
 const fields=['assignment_id','category','venue','progress_date','streak_count','completed_at','points_awarded','points_removed','message','live_session','elapsed_seconds'].sort();
 const categories=['one_bang','dialled','bonus','trick_links','foam_pit'];
 for(let index=0;index<categories.length;index++){
  const category=categories[index],n=200+index;await add(n,category);await actor(2);
  const first=await action(n),points=category==='bonus'?5:category==='foam_pit'?0:2;
  eq(first.points_awarded,points,category+' keeps its normal first award');
  eq(Object.keys(first).sort(),fields,category+' first response contract stays intact');
  const state=await q('select * from assignment_progress where assignment_id=$1',[id(n)]);
  const sessionPoints=await val('select total_points from training_sessions where id=$1',[id(20)]);
  await db.exec('truncate private.fixture_write_audit');
  const repeat=await action(n);
  eq(repeat.points_awarded,0,category+' repeat awards zero');eq(repeat.points_removed,0,category+' repeat removes zero');
  eq(Object.keys(repeat).sort(),fields,category+' retry response contract stays intact');
  eq(repeat.completed_at,first.completed_at,category+' retry preserves completion time');eq(repeat.message,first.message,category+' retry keeps category message');
  eq(await q('select * from assignment_progress where assignment_id=$1',[id(n)]),state,category+' retry does not touch progress/heartbeat');
  eq(await val('select total_points from training_sessions where id=$1',[id(20)]),sessionPoints,category+' retry does not touch session total');
  eq(await val('select count(*)::int from private.fixture_write_audit'),0,category+' retry performs no scoring/history/attempt writes');
  await actor(1);eq((await action(n)).points_awarded,0,category+' linked coach gets the same read-only retry');
  await actor(2);const undo=await action(n,'unlanded');eq(undo.points_removed,points,category+' undo still removes its original award');
  eq(await val('select completed_at from assignment_progress where assignment_id=$1',[id(n)]),null,category+' undo clears completion');
  eq(await val("select evidence_type from tricktionary_landing_history where id='assignment:'||$1::text",[id(n)]),'revoked',category+' undo still revokes landing evidence');
  eq((await action(n)).points_awarded,points,category+' re-tick after undo earns one valid receipt');
 }
 // Completed state with no receipt must follow the repair path, not the retry.
 await add(300,'one_bang');await q('insert into assignment_progress(assignment_id,athlete_id,completed_at)values($1,$2,now())',[id(300),id(2)]);
 eq((await action(300)).points_awarded,2,'Legacy completed progress repairs a missing point receipt');
 eq((await action(300)).points_awarded,0,'A repaired receipt is idempotent');
 // A pause blocks new scoring and missing-receipt repair but permits harmless
 // retries of an existing award, and permits undo as before.
 await actor(1);await val('select private.set_rider_scoring_pause($1,true)',[id(2)]);await actor(2);
 await db.exec('truncate private.fixture_write_audit');eq((await action(300)).points_awarded,0,'Paused rider existing completion is a harmless no-op');
 eq(await val('select count(*)::int from private.fixture_write_audit'),0,'Paused retry creates no scoring evidence');
 await add(301,'one_bang');await denied(()=>action(301),/paused/);
 await actor(1);await val('select private.set_rider_scoring_pause($1,false)',[id(2)]);await actor(2);
 await add(302,'bonus');await q('insert into assignment_progress(assignment_id,athlete_id,completed_at)values($1,$2,now())',[id(302),id(2)]);
 await actor(1);await val('select private.set_rider_scoring_pause($1,true)',[id(2)]);await actor(2);
 await denied(()=>action(302),/paused/);eq(await val('select count(*)::int from assignment_point_awards where assignment_id=$1',[id(302)]),0,'Pause cannot be bypassed by preexisting completed progress');
 eq((await action(300,'unlanded')).points_removed,2,'Paused rider undo remains available');
 await actor(1);await val('select private.set_rider_scoring_pause($1,false)',[id(2)]);
 // Cached results never move above the existing authorization gates.
 for(const [n,re] of [[3,/private team/],[4,/cannot update/],[5,/approval/]]){await actor(n);await denied(()=>action(200),re);}
 await actor(null);await denied(()=>action(200),/approval/);
 await actor(2);await denied(()=>action(200,'unexpected'),/Unknown action/);await denied(()=>action(9999),/private team/);
 // Direct same-value progress updates are also inexpensive, while changed
 // evidence must still land, revoke and restore history normally.
 await db.exec('truncate private.fixture_write_audit');await q('update assignment_progress set completed_at=completed_at,progress_date=progress_date,streak_count=streak_count,updated_at=now() where assignment_id=$1',[id(200)]);
 eq(await val("select count(*)::int from private.fixture_write_audit where table_name='history_attempt'"),0,'Same-value evidence fields skip history capture');
 await q('update assignment_progress set completed_at=null where assignment_id=$1',[id(200)]);
 eq(await val("select evidence_type from tricktionary_landing_history where id='assignment:'||$1::text",[id(200)]),'revoked','Changed completion still revokes history');
 await q('update assignment_progress set completed_at=now() where assignment_id=$1',[id(200)]);
 eq(await val("select evidence_type from tricktionary_landing_history where id='assignment:'||$1::text",[id(200)]),'progress','Changed completion restores history');
 // Daily history is per local date: unchanged dates are cheap, but a new date
 // still adds evidence and an untick revokes only that date.
 await add(400,'daily');
 await q("insert into assignment_progress(assignment_id,athlete_id,progress_date)values($1,$2,'2026-11-17')",[id(400),id(2)]);
 await db.exec('truncate private.fixture_write_audit');
 await q('update assignment_progress set progress_date=progress_date,updated_at=now() where assignment_id=$1',[id(400)]);
 eq(await val("select count(*)::int from private.fixture_write_audit where table_name='history_attempt'"),0,'Unchanged Daily date skips history work');
 await q("update assignment_progress set progress_date='2026-11-18' where assignment_id=$1",[id(400)]);
 eq(await val('select count(*)::int from tricktionary_landing_history where assignment_id=$1 and landed_count>0',[id(400)]),2,'Changed Daily date retains both landed dates');
 await q('update assignment_progress set progress_date=null where assignment_id=$1',[id(400)]);
 eq(await val("select evidence_type from tricktionary_landing_history where id='daily:'||$1::text||':2026-11-18'",[id(400)]),'revoked','Daily untick still revokes the current date');
 eq(await val("select landed_count from tricktionary_landing_history where id='daily:'||$1::text||':2026-11-17'",[id(400)]),1,'Daily untick preserves the previous date');
 console.log('PASS: '+checks+' weekly retry, write-budget, repair, pause, undo, history and authorization checks (synthetic database).');
}finally{await db.close();}})().catch(e=>{console.error(e.stack,e.where||'');process.exitCode=1});
