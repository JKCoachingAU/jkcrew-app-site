// Isolated database regression. Uses production Daily/ledger schemas, real roles
// and the actual feature-access/scoring-pause functions; never contacts Supabase.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');
const {initialize:initializeDaily,id}=require('./daily-partial-db.cjs');
const root=path.resolve(__dirname,'..');
const migration='20260920025223_other_things_landed_coach_review.sql';
async function initialize(db){
  await initializeDaily(db);
  const feature=fs.readFileSync(path.join(root,'supabase/migrations/20260914101302_rider_feature_access_controls.sql'),'utf8');
  await db.exec(feature.split('-- Apply the restriction')[0]);
  await db.exec('create table weekly_challenges(id uuid primary key,title text);');
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260909085252_add_private_points_receipts.sql'),'utf8'));
  // Deliberately allow the older broad ledger API in this fixture: the new
  // source must remain protected even when a caller can edit other ledger rows.
  await db.exec('grant select,insert,update,delete on assignment_point_awards to authenticated;');
  // Same BEFORE trigger definition as production, including inherited venue hints.
  await db.exec(`create function private.attach_assignment_award_venue() returns trigger language plpgsql security definer set search_path=public,private as $$
    declare v_category text:=split_part(new.award_key,':',1);v_request_venue text:=nullif(btrim(current_setting('jkcrew.venue',true)),'');begin
    if btrim(coalesce(new.venue,''))<>'' then new.venue:=btrim(new.venue);return new;end if;
    if v_category in ('daily','daily-complete','daily-under-20') then select nullif(btrim(assignment.venue),'') into new.venue from weekly_trick_assignments assignment where assignment.id=new.assignment_id;else new.venue:=v_request_venue;end if;
    if btrim(coalesce(new.venue,''))='' and new.session_id is not null then select nullif(btrim(g.venue),'') into new.venue from coach_group_session_participants p join coach_group_sessions g on g.id=p.group_session_id where p.training_session_id=new.session_id and p.athlete_id=new.athlete_id order by p.joined_at desc limit 1;end if;
    new.venue:=coalesce(btrim(new.venue),'');return new;end$$;
    create trigger assignment_awards_attach_venue before insert or update of venue on assignment_point_awards for each row execute function private.attach_assignment_award_venue();
    alter table assignment_point_awards add check(points between 0 and 5);`);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
}
async function run(){
  const db=new PGlite();let checks=0;
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const scalar=async(sql,args=[])=>Object.values((await q(sql,args))[0])[0];
  const actor=async(n,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec(`set role ${role}`);};
  const inspect=async(fn)=>{await db.exec('reset role');try{return await fn();}finally{await db.exec('set role authenticated');}};
  const read=(sql,args=[])=>inspect(()=>scalar(sql,args));
  const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};const ok=(a,m)=>{assert(a,m);checks++;};
  const deny=async(fn,test=error=>error.code==='42501')=>{await assert.rejects(fn,test);checks++;};
  const submit=(entries,venue='Test park')=>scalar('select submit_other_things_landed($1::jsonb,$2)',[JSON.stringify(entries),venue]);
  const review=(n,decision='approved')=>scalar('select review_other_thing_landed($1,$2)',[id(n),decision]);
  const get=(n=10,limit=50,offset=0)=>scalar('select get_other_things_landed($1,$2,$3)',[id(n),limit,offset]);
  const entry=(n,name=`New trick ${n}`,note='')=>({id:id(n),trick_name:name,note});
  const score=(n=10)=>read(`select jsonb_build_object('points',(select coalesce(sum(points),0) from assignment_point_awards where athlete_id=$1),'xp',(select coalesce(sum(xp),0) from xp_ledger where athlete_id=$1),'history',(select count(*) from tricktionary_landing_history where athlete_id=$1),'sessions',(select count(*) from training_sessions where athlete_id=$1),'assignments',(select count(*) from weekly_trick_assignments where athlete_id=$1))`,[id(n)]);
  try{
    await initialize(db);
    await db.exec(`insert into profiles(id,role,display_name) values('${id(1)}','coach','Coach One'),('${id(2)}','coach','Coach Two'),('${id(3)}','parent','Parent'),('${id(4)}','coach','Unlinked Coach'),('${id(5)}','admin','Unlinked Admin'),('${id(10)}','athlete','Rider One'),('${id(11)}','athlete','Rider Two');insert into coach_athletes values('${id(1)}','${id(10)}'),('${id(2)}','${id(10)}');insert into parent_athletes values('${id(3)}','${id(10)}');`);
    await actor(10);eq((await get()).items,[]);eq((await get()).can_submit,true);eq((await get()).can_review,false);
    const batch=[entry(100,'  X-UP  ','  First time over the box  '),entry(101,'Opposite 360')];
    const sent=await submit(batch);eq(sent.items.length,2);eq(sent.items[0].trick_name,'X-UP');eq(sent.items[0].note,'First time over the box');eq(sent.items[0].status,'pending');eq(sent.items[0].points,0);eq(sent.items[0].reviewed_at,null);ok(sent.items[0].submitted_at);
    eq(await score(),{points:0,xp:0,history:0,sessions:0,assignments:0},'Submissions do not add scores or claim landed evidence');
    eq(await submit(batch),sent,'Exact IDs make submission retries idempotent');eq((await get()).total_count,2);
    await deny(()=>submit([entry(100,'Changed name')]),/different details/);
    await deny(()=>submit([entry(102,'Valid'),entry(103,'')]),/Trick names/);eq((await get()).total_count,2,'Invalid batches roll back all their rows');
    for(const payload of [null,{},[],Array.from({length:11},(_,i)=>entry(200+i)),[entry(102),entry(102)],[{...entry(102),athlete_id:id(11)}],[entry(102,'\n')],[entry(102,'a'.repeat(121))],[entry(102,'Valid','n'.repeat(181))],[{id:id(102),trick_name:12}],[{...entry(102),note:null}],[{...entry(102),id:'wrong'}]])await deny(()=>submit(payload),error=>error.code==='22023');
    await deny(()=>submit([entry(102)],'v'.repeat(121)),error=>error.code==='22023');
    await deny(()=>review(100));
    await deny(()=>q("insert into other_things_landed(id,athlete_id,trick_name,status,reviewed_at,reviewer_name) values($1,$2,'Fake','approved',now(),'Fake coach')",[id(300),id(10)]));
    await deny(()=>q("update other_things_landed set status='approved' where id=$1",[id(100)]));await deny(()=>q('delete from other_things_landed where id=$1',[id(100)]));
    await deny(()=>q("insert into assignment_point_awards(id,athlete_id,award_key,points) values($1,$2,$3,1)",[id(100),id(10),'other-landed:'+id(100)]));
    await actor(1);eq((await get()).can_review,true);eq((await get()).can_submit,false);await deny(()=>submit([entry(102)]));
    const approved=await review(100);eq(approved.already_reviewed,false);eq(approved.item.status,'approved');eq(approved.item.points,1);eq(approved.item.reviewer_id,id(1));eq(approved.item.reviewer_name,'Coach One');ok(approved.item.reviewed_at);
    eq(await score(),{points:1,xp:0,history:1,sessions:0,assignments:0});
    const award=await read('select to_jsonb(a) from assignment_point_awards a where id=$1',[id(100)]);eq(award.points,1);eq(award.assignment_id,null);eq(award.session_id,null);eq(award.venue,'Test park');eq(award.created_at,approved.item.reviewed_at);
    const proof=await read('select to_jsonb(h) from tricktionary_landing_history h where id=$1',['other-landed:'+id(100)]);eq(proof.trick_name,'X-UP');eq(proof.landed_count,1);eq(proof.category,'other');eq(proof.notes,'','Private short notes do not misclassify landed tricks');eq(proof.landed_at,sent.items[0].submitted_at);
    eq((await review(100)).item,approved.item);await actor(2);const competing=await review(100,'declined');eq(competing.already_reviewed,true);eq(competing.item,approved.item,'A second coach cannot overwrite a final decision');eq((await score()).points,1);
    for(const sql of ["update assignment_point_awards set points=2 where id=$1","update assignment_point_awards set athlete_id='"+id(11)+"' where id=$1","update assignment_point_awards set award_key='other' where id=$1","delete from assignment_point_awards where id=$1"])await deny(()=>q(sql,[id(100)]));
    const declined=await review(101,'declined');eq(declined.item.points,0);eq(declined.item.status,'declined');eq((await review(101)).item,declined.item);eq((await score()).points,1);eq((await score()).history,1);
    await deny(()=>review(101,'pending'),error=>error.code==='22023');
    // Exercise the actual all-time/weekly leaderboard, with a harmless badge stub.
    await inspect(()=>db.exec("create or replace function get_earned_badges(uuid) returns jsonb language sql as $$select '[]'::jsonb$$;"));
    const standings=(await q('select * from get_weekly_leaderboard()')).find(row=>row.athlete_id===id(10));eq(Number(standings.weekly_points),1);eq(Number(standings.all_time_points),1);
    // Existing ledgers are unaffected for every other scoring prefix.
    await q("insert into assignment_point_awards(athlete_id,award_key,points) values($1,'existing-other-source',2)",[id(10)]);await q("update assignment_point_awards set points=3 where award_key='existing-other-source'");await q("delete from assignment_point_awards where award_key='existing-other-source'");eq((await score()).points,1);
    // Privacy also holds for direct SELECT and for direct calls to private helpers.
    for(const n of [3,4,5,11]){await actor(n);await deny(()=>get());eq(await q('select * from other_things_landed'),[]);await deny(()=>review(100));await deny(()=>scalar('select private.get_other_things_landed($1,50,0)',[id(10)]));}
    await actor(11);await deny(()=>submit([entry(100,'X-UP','First time over the box')]),error=>error.code==='42501');
    await actor(null,'anon');await deny(()=>get());await deny(()=>submit([entry(105)]));await deny(()=>review(100));await deny(()=>q('select * from other_things_landed'));
    await actor(10);await submit([entry(104),entry(105),entry(106)]);await actor(1);await q('select * from set_rider_scoring_pause($1,true)',[id(10)]);await actor(10);eq((await get()).can_submit,false);await deny(()=>submit([entry(107)]),/scoring is paused/);eq((await submit([entry(104)])).items[0].id,id(104),'Saved submission retries remain harmless while paused');
    await actor(1);await deny(()=>review(104),/scoring is paused/);eq((await review(100)).item,approved.item,'Approved retries do not add points even while paused');eq((await review(105,'declined')).item.points,0,'Decline stays available during scoring pause');
    await q('select * from set_rider_scoring_pause($1,false)',[id(10)]);eq((await review(104)).item.points,1);
    await q('select * from set_rider_feature_access($1,true)',[id(10)]);await actor(10);await deny(()=>get());await deny(()=>submit([entry(107)]));eq(await q('select * from other_things_landed'),[]);await actor(1);ok((await get()).can_review,'Linked coaches retain management of disabled riders');await q('select * from set_rider_feature_access($1,false)',[id(10)]);
    // A failure after the decision update must roll back decision, point and history.
    await inspect(()=>db.exec(`create function private.fail_other_history() returns trigger language plpgsql as $$begin if new.id='other-landed:${id(106)}' then raise exception 'History unavailable';end if;return new;end$$;create trigger fail_other_history before insert on tricktionary_landing_history for each row execute function private.fail_other_history();`));
    await deny(()=>review(106),/History unavailable/);eq((await get()).items.find(row=>row.id===id(106)).status,'pending');eq(await read('select count(*)::int from assignment_point_awards where id=$1',[id(106)]),0);await inspect(()=>db.exec('drop trigger fail_other_history on tricktionary_landing_history;'));eq((await review(106)).item.points,1);
    await actor(10);await submit([entry(108)],'');await actor(1);await q("select set_config('jkcrew.venue','Incorrect inherited venue',false)");eq((await review(108)).item.venue,'');eq(await read('select venue from assignment_point_awards where id=$1',[id(108)]),'','Empty submitted venues never inherit another rider’s park');
    await actor(10);const page1=await get(10,2,0),page2=await get(10,2,2);eq(page1.items.length,2);eq(page2.items.length,2);ok(page1.items.every(a=>page2.items.every(b=>a.id!==b.id)));eq(page1.total_count,6);await deny(()=>get(10,101),error=>error.code==='22023');
    await db.exec('begin read only');try{ok((await get()).items.length>0,'History reload does not mutate scores or badges');}finally{await db.exec('rollback');}
    // Both new award types use the existing receipt, never a client-side sum.
    await actor(1);await q("insert into assignment_point_awards(athlete_id,award_key,points) values($1,'daily-tier-two:current-day',4)",[id(10)]);
    for(const scope of ['weekly','all_time']){
      const receipt=await scalar('select get_points_receipt($1,$2)',[id(10),scope]);
      eq(receipt.rows.find(row=>row.label==='Other Things Landed'),{label:'Other Things Landed',detail:'Coach approved',points:4,events:4});
      eq(receipt.rows.find(row=>row.label==='Daily Tier 2'),{label:'Daily Tier 2',detail:'Entire extra list completed',points:4,events:1});eq(receipt.total,8);
    }
    await actor(3);eq((await scalar("select get_points_receipt($1,'weekly')",[id(10)])).total,8,'Linked parent receipt access remains unchanged');
    for(const n of [4,5,11]){await actor(n);await deny(()=>scalar("select get_points_receipt($1,'all_time')",[id(10)]),/private/);}
    await actor(null,'anon');await deny(()=>scalar("select get_points_receipt($1,'weekly')",[id(10)]));
    console.log(`PASS: ${checks} Other Things Landed validation, transactional review, exact scoring, ledger integrity, RLS, retries, pause, feature access, history and leaderboard checks.`);
  }finally{await db.close();}
}
if(require.main===module)run().catch(error=>{console.error(error.stack,error.where||'');process.exitCode=1;});
module.exports={initialize,migration,id};
