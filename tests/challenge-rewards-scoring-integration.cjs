// Actual deployed scoring RPCs with the real Daily/XP/pause/standings foundation.
// No remote connections or production records.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {initialize,id}=require('./daily-partial-db.cjs');
const {migration}=require('./challenge-rewards-db.cjs');
async function run(){const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');const db=new PGlite();let checks=0;
 const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
 const actor=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec('set role authenticated');};
 const inspect=async(fn)=>{await db.exec('reset role');try{return await fn();}finally{await db.exec('set role authenticated');}};
 const bonus=()=>inspect(()=>value('select coalesce(sum(points),0)::int from leaderboard_point_adjustments'));
 const ordinary=()=>inspect(()=>value('select coalesce(sum(points),0)::int from assignment_point_awards'));
 try{
 await initialize(db);
 const source=fs.readFileSync(path.join(__dirname,'challenge-rewards-db.cjs'),'utf8');
 for(const name of ['coach_athlete_groups','private.rider_feature_access','weekly_challenges','weekly_challenge_completions']){
  const sql=source.match(new RegExp('create table '+name.replaceAll('.','\\.')+'\\([^;]+;'))[0];await db.exec(sql);
 }
 await db.exec(`create function private.activate_due_weekly_challenges() returns integer language sql as $$select 0$$;`);
 for(const fn of JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/challenge-scoring-production-functions.json'),'utf8')).functions)await db.exec(fn.definition);
 await db.exec(`insert into profiles(id,role,display_name) values('${id(1)}','coach','Coach'),('${id(2)}','coach','Stranger'),('${id(10)}','athlete','Rider');insert into coach_athletes values('${id(1)}','${id(10)}');
  insert into weekly_challenges(id,title,category,target_count,reward_points,starts_at,ends_at,created_by) values('${id(50)}','Dialled','dialled',2,5,now()-interval '1 hour',now()+interval '1 day','${id(1)}');
  insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,category,trick_name) select n::uuid,'${id(1)}','${id(10)}',b.week_start_date,'dialled','Dialled test trick' from (values('${id(100)}'),('${id(101)}')) x(n) cross join jkcrew_week_bounds('AU')b;`);
 await actor(1);await value('select record_assignment_action($1,$2)',[id(100),'landed']);await value('select record_assignment_action($1,$2)',[id(101),'landed']);eq(await ordinary(),4);eq(await bonus(),0,'Reproduces bug: actual scoring RPCs finish challenge but no bonus');
 await db.exec('reset role');await db.exec(migration);eq(await bonus(),0,'Migration does not silently backfill');
 await actor(10);eq((await value('select get_my_weekly_challenge()')).new_award,true,'Active qualifying rider can recover through original screen path');eq(await bonus(),5);eq(await ordinary(),4,'Tier1 points unchanged');
 await inspect(()=>db.exec(`update weekly_challenges set status='archived';insert into weekly_challenges(id,title,category,target_count,reward_points,starts_at,ends_at,created_by) values('${id(51)}','Bonus','bonus',1,5,now()-interval '1 hour',now()+interval '1 day','${id(1)}');
 insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,category,trick_name) select '${id(102)}','${id(1)}','${id(10)}',b.week_start_date,'bonus','Bonus test' from jkcrew_week_bounds('AU')b;`));
 await actor(2);await assert.rejects(()=>value('select record_assignment_action($1,$2)',[id(102),'landed']),/cannot|permission|access/i);checks++;eq(await bonus(),5);
 await actor(1);await value('select record_assignment_action($1,$2)',[id(102),'landed']);eq(await ordinary(),9,'Normal +5 Bonus trick retained');eq(await bonus(),10,'Challenge +5 automatically added inside actual coach scoring RPC');
 await inspect(()=>db.exec(`update weekly_challenges set status='archived';insert into weekly_challenges(id,title,category,completion_rule,target_count,reward_points,starts_at,ends_at,created_by) values('${id(52)}','Perfect','percentage','percentage_perfect',3,10,now()-interval '1 hour',now()+interval '1 day','${id(1)}');
 insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,category,trick_name) select n::uuid,'${id(1)}','${id(10)}',b.week_start_date,'percentage','Percentage test' from (values('${id(110)}'),('${id(111)}'),('${id(112)}')) x(n) cross join jkcrew_week_bounds('AU')b;`));
 await actor(10);
 for(let n=110;n<113;n++)for(let a=1;a<=10;a++)await value('select set_percentage_attempt($1,$2,$3)',[id(n),a,true]);
 eq(await bonus(),20,'All3 perfect real Percentage RPCs automatically give +10');eq(await ordinary(),18,'Normal3 points per perfect Percentage trick retained');
 await value('select set_percentage_attempt($1,$2,$3)',[id(112),10,true]);eq(await bonus(),20,'Percentage RPC reward rewrite cannot duplicate challenge');eq(await ordinary(),18);
 eq((await value('select get_my_weekly_challenge()')).completed,true);eq((await value('select get_my_weekly_challenge()')).new_award,false);
 // Pure standings use the same adjustment ledger; receipt sees both categories.
 const receipt=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260909085252_add_private_points_receipts.sql'),'utf8');await inspect(()=>db.exec(receipt));
 const score=await value('select get_points_receipt($1,$2)',[id(10),'weekly']);eq(Number(score.total),38,'Weekly receipt includes18 regular and20 challenge points');eq(Number(score.rows.filter(r=>r.label==='Weekly challenge').reduce((n,r)=>n+Number(r.points),0)),20);
 console.log(`PASS ${checks} real scoring RPC integration checks, reproduced missing reward and verified automatic repair`);
 }finally{await db.close();}}
run().catch(e=>{console.error(e);process.exitCode=1;});
