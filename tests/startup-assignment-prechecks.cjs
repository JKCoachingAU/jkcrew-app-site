// Authorization precheck regression. Synthetic data only: no network, real
// accounts, push delivery, secrets, or production connection. The scorer is a
// stub: this exercises the outer read gate; scoring authorization is tested separately.
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),migrations=path.join(root,'supabase/migrations');
const read=name=>fs.readFileSync(path.join(migrations,name),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
function fn(source,name){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const match=new RegExp(`create(?: or replace)? function ${escaped}\\(`,'i').exec(source);
 if(!match)throw new Error('Missing production function '+name);
 const text=source.slice(match.index),body=/\bas\s+(\$[a-z_]*\$)/i.exec(text);
 if(!body)throw new Error('Missing function body '+name);
 const end=text.indexOf(body[1],body.index+body[0].length);
 return text.slice(0,end+body[1].length)+';';
}

(async()=>{const db=new PGlite();let checks=0;try{
 const q=(sql,args=[])=>db.query(sql,args),scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
 const assert=require('node:assert/strict'),eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const as=async n=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);if(n)await db.exec('set role authenticated');};
 await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role;
 grant usage on schema public,private,auth to authenticated,anon,service_role;
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,raw_app_meta_data jsonb default '{}');
 create table profiles(id uuid primary key,role text,is_platform_owner boolean default false);
 create table private.coach_account_access(coach_id uuid primary key,status text);
 create table private.coach_team_memberships(coach_id uuid primary key,team_id uuid,status text);
 create table coach_athletes(coach_id uuid,athlete_id uuid,team_id uuid);
 create table parent_athletes(parent_id uuid,athlete_id uuid,coach_id uuid);
 create table weekly_trick_assignments(id uuid primary key,athlete_id uuid,coach_id uuid);
 create function private.require_coach_approval()returns void language plpgsql stable security definer set search_path='' as $$begin if auth.uid()is not null and not private.jkcrew_actor_approved(auth.uid())then raise exception 'Approval required'using errcode='42501';end if;end$$;
 -- Scorer stubs let this test prove which outer gate is called. The actual
 -- scorer retains its independent own-athlete/linked-coach write authorization.
 create function private.approved_b223f0cd2e29fcfebf9311d3(uuid,text)returns jsonb language sql as $$select jsonb_build_object('assignment',$1,'action',$2)$$;
 create function private.approved_1f66e273bce3fd6228b21a0d(uuid,text,text)returns jsonb language sql as $$select jsonb_build_object('assignment',$1,'action',$2,'venue',$3)$$;
 `);
 const tenant=read('20261116123906_isolate_team_data_and_add_coach_memberships.sql');
 for(const name of ['private.jkcrew_actor_approved','private.jkcrew_user_team_ids','private.jkcrew_profile_team_id','private.jkcrew_profiles_share_team','private.jkcrew_same_team_profile','private.jkcrew_is_team_coach'])await db.exec(fn(tenant,name));
 for(const[n,role,team,status]of [[1,'coach',101,'approved'],[2,'coach',101,'approved'],[3,'coach',102,'approved'],[4,'coach',101,'pending'],[5,'coach',101,'suspended'],[6,'coach',null,'approved'],[11,'athlete'],[12,'athlete'],[13,'athlete'],[14,'athlete'],[15,'athlete'],[21,'parent'],[22,'parent'],[23,'parent']]){
  const registered=n===15?{registered_coach_id:id(1)}:{};
  await q('insert into auth.users values($1,$2)',[id(n),registered]);
  await q('insert into profiles values($1,$2,$3)',[id(n),role,n===1]);
  if(role==='coach'){
   await q('insert into private.coach_account_access values($1,$2)',[id(n),status]);
   if(team)await q("insert into private.coach_team_memberships values($1,$2,'active')",[id(n),id(team)]);
  }
 }
 await q('insert into coach_athletes values($1,$2,$3),($4,$2,$3),($1,$5,$3),($6,$7,$8)',[id(1),id(11),id(101),id(2),id(12),id(3),id(13),id(102)]);
 await q('insert into parent_athletes values($1,$2,$3),($4,$5,$3),($6,$7,$8)',[id(21),id(11),id(1),id(22),id(12),id(23),id(13),id(3)]);
 const assignments=[[111,11,1],[112,12,1],[113,13,3],[114,14,1],[115,15,1],[116,11,3],[117,13,1]];
 for(const[n,a,c]of assignments)await q('insert into weekly_trick_assignments values($1,$2,$3)',[id(n),id(a),id(c)]);
 await db.exec(read('20261118223640_avoid_recursive_rls_in_assignment_prechecks.sql'));
 const visible=async(actor,assignment)=>{await as(actor);return scalar('select private.jkcrew_assignment_action_visible($1)',[assignment?id(assignment):null]);};
 const cases=[
 [11,111,true,'Rider reads own canonical assignment'],[11,112,false,'Rider cannot use teammate assignment'],[11,113,false,'Rider cannot use foreign assignment'],
 [1,111,true,'Owner reads own team assignment'],[1,113,false,'Owner cannot use foreign team assignment'],[2,111,true,'Approved assistant reads shared team assignment'],[3,111,false,'Approved foreign coach cannot use owner assignment'],
 [4,111,false,'Pending coach remains denied despite active membership'],[5,111,false,'Suspended coach remains denied despite active membership'],[6,111,false,'Unlinked coach remains denied'],
 [21,111,true,'Linked parent passes read gate for own child'],[21,112,false,'Linked parent cannot use teammate child assignment'],[22,111,false,'Other parent in same team cannot use this child assignment'],[23,111,false,'Foreign parent remains denied'],
 [15,115,true,'Verified registered rider passes own read gate before link materialization'],[1,115,true,'Approved coach reads registered own student'],
 [14,114,false,'Unlinked self-assignment cannot bypass canonical coach team check'],[1,114,false,'Coach cannot use unlinked target athlete'],
 [11,116,false,'Own athlete ID cannot bypass foreign canonical coach'],[1,116,false,'Owner cannot bypass foreign canonical coach'],[3,117,false,'Own student ID cannot bypass foreign canonical assignment coach'],
 [11,999,false,'Missing assignment fails closed'],[11,null,false,'Null assignment fails closed'],[null,111,false,'No JWT fails closed']
 ];
 for(const[a,b,w,label]of cases)eq(await visible(a,b),w,label);
 await as(11);eq((await scalar('select record_assignment_action($1,$2)',[id(111),'landed'])).assignment,id(111),'Public scorer wrapper reaches existing scorer for own allowed assignment');
 eq((await scalar('select record_assignment_action_at_venue($1,$2,$3)',[id(111),'landed','The Village'])).venue,'The Village','Venue wrapper preserves existing signature and venue argument');
 for(const name of ['record_assignment_action','record_assignment_action_at_venue']){await assert.rejects(q(`select ${name}($1,'landed')`,[id(113)]),/another private team/);checks++;}
 await as(4);await assert.rejects(q("select record_assignment_action($1,'landed')",[id(111)]),/Approval required/);checks++;
 await as(null);
 for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(q('select private.jkcrew_assignment_action_visible($1)',[id(111)]),/permission denied/);checks++;await db.exec('reset role');}
 eq(await scalar("select has_function_privilege('authenticated','private.jkcrew_assignment_action_visible(uuid)','EXECUTE')"),true,'Authenticated invoker wrappers can call the auth-bound private helper');
 eq(await scalar('select count(*)::int from weekly_trick_assignments'),7,'Authorization reads do not mutate assignments');
 console.log(`PASS: ${checks} assignment precheck authorization/permission checks with actual production helper bodies and synthetic accounts.`);
 }finally{await db.close();}})().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1});
