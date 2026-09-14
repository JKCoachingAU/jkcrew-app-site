const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
async function as(n, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [n ? id(n) : '']);
  await db.exec(`set role ${role}`);
}
const access = async () => (await db.query('select * from public.get_rider_feature_access()')).rows;
const set = (n, disabled) => db.query('select * from public.set_rider_feature_access($1,$2)', [id(n), disabled]);
async function request(endpoint, method = 'POST', sql = null) {
  await db.query("select set_config('request.path',$1,false),set_config('request.method',$2,false)", [endpoint, method]);
  await db.query('select public.jkcrew_check_rider_feature_access()');
  if (sql) return db.query(sql);
}
(async () => {
  await db.exec(`
    create schema auth; create schema private; create schema storage;
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    grant usage on schema public,auth,private,storage to authenticated,service_role;
    grant usage on schema public,auth to anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key, role text, display_name text, last_app_opened_at timestamptz);
    create table public.coach_athletes(coach_id uuid,athlete_id uuid);
    create table public.training_sessions(id integer primary key,athlete_id uuid,points integer);
    create table storage.objects(id integer primary key, owner_id uuid);
    alter table public.profiles enable row level security;
    alter table public.coach_athletes enable row level security;
    alter table public.training_sessions enable row level security;
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on public.profiles,public.coach_athletes,public.training_sessions,storage.objects to authenticated;
    create policy existing_profiles on public.profiles for all to authenticated using (true) with check(true);
    create policy existing_links on public.coach_athletes for all to authenticated using(true) with check(true);
    create policy existing_training on public.training_sessions for all to authenticated using(true) with check(true);
    create policy existing_storage on storage.objects for all to authenticated using(true) with check(true);
    create function public.test_feature_definer() returns void language sql security definer as $$insert into public.training_sessions values(99,auth.uid(),10)$$;
    create function public.record_my_app_open() returns timestamptz language sql security invoker as $$update public.profiles set last_app_opened_at=now() where id=auth.uid() returning last_app_opened_at$$;
    create function public.get_weekly_leaderboard() returns setof public.training_sessions language sql security definer as $$select * from public.training_sessions$$;
  `);
  for (const [n, role] of [[1,'coach'],[2,'athlete'],[3,'athlete'],[4,'coach'],[5,'parent'],[6,'admin']]) {
    await db.query('insert into public.profiles values($1,$2,$3,null)', [id(n),role,`Person ${n}`]);
  }
  await db.query('insert into public.coach_athletes values($1,$2),($1,$3),($4,$3)', [id(1),id(2),id(3),id(6)]);
  await db.query('insert into public.training_sessions values(1,$1,4)',[id(2)]);
  await db.query('insert into storage.objects values(1,$1)',[id(2)]);
  const existingPolicies = (await db.query("select * from pg_policies where schemaname='public' or (schemaname='storage' and cmd='SELECT') order by schemaname,tablename,policyname")).rows;
  const migration = fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260914101302_rider_feature_access_controls.sql'),'utf8');
  await db.exec(migration);
  assert.deepEqual((await db.query("select * from pg_policies where schemaname='public' or (schemaname='storage' and cmd='SELECT') order by schemaname,tablename,policyname")).rows,existingPolicies,'Existing public RLS and Storage read policies unchanged');
  assert.equal((await db.query('select count(*)::int n from private.rider_feature_access')).rows[0].n,0,'Migration does not disable anyone');
  await as(2);
  assert.deepEqual((await access()).map(r => [r.athlete_id,r.features_disabled]),[[id(2),false]]);
  await request('/rpc/test_feature_definer');
  await assert.rejects(()=>set(2,true), /Only a coach/);
  await assert.rejects(()=>db.query('insert into private.rider_feature_access(athlete_id,features_disabled,disabled_at) values($1,true,now())',[id(2)]),/permission denied/);
  await as(4); await assert.rejects(()=>set(2,true),/not linked/);
  await as(5); await assert.rejects(()=>set(2,true),/Only a coach/);
  await as(1);
  assert.deepEqual((await access()).map(r=>r.athlete_id).sort(),[id(1),id(2),id(3)]);
  await assert.rejects(()=>set(1,true),/not linked/);
  await assert.rejects(()=>set(5,true),/not linked/);
  await assert.rejects(()=>set(2,null),/enabled or disabled/);
  const disabled=(await set(2,true)).rows[0];
  assert.equal(disabled.features_disabled,true); assert.equal(disabled.disabled_by,id(1)); assert(disabled.disabled_at);
  await set(2,true);
  await as(2);
  assert.equal((await access())[0].features_disabled,true);
  for (const [endpoint,method] of [['/rpc/test_feature_definer','POST'],['/rpc/test_feature_definer','GET'],['/rpc/test_feature_definer','HEAD'],['/training_sessions','POST'],['/training_sessions','PATCH'],['/training_sessions','DELETE'],['/training_sessions','GET'],['/profiles','PATCH'],['/rpc/ensure_current_profile','POST'],['/rpc/set_rider_feature_access','POST'],['/graphql','POST'],['/rpc/record_my_app_open/extra','POST'],['','POST']]) {
    await assert.rejects(()=>request(endpoint,method),/You don't have access to this feature, contact your coach/,`${endpoint} ${method} denied`);
  }
  for (const endpoint of ['/rpc/get_rider_feature_access','rpc/get_rider_feature_access','/rest/v1/rpc/get_weekly_leaderboard','/rpc/record_my_app_open']) await request(endpoint);
  await request('/profiles','GET','select * from public.profiles where id=auth.uid()');
  await request('/profiles','HEAD');
  await request('/rpc/record_my_app_open','POST','select public.record_my_app_open()');
  const scores=await request('/rpc/get_weekly_leaderboard','POST','select * from public.get_weekly_leaderboard()');
  assert.equal(scores.rows.length,1,'Read-only dashboard leaderboard works through SECURITY DEFINER');
  // Simulate the Data API's hook-before-query execution boundary. Public-table
  // policies themselves stay unchanged; this does not claim Realtime read denial.
  const denied = /You don't have access to this feature, contact your coach/;
  await assert.rejects(()=>request('/training_sessions','POST',`insert into public.training_sessions values(2,'${id(2)}',5)`),denied);
  await assert.rejects(()=>request('/training_sessions','PATCH','update public.training_sessions set points=100'),denied);
  await assert.rejects(()=>request('/training_sessions','DELETE','delete from public.training_sessions'),denied);
  await assert.rejects(()=>request('/rpc/test_feature_definer','POST','select public.test_feature_definer()'),denied);
  assert.deepEqual((await db.query('select id,points from public.training_sessions')).rows,[{id:1,points:4}],'Denied API writes leave feature data unchanged');
  assert.equal((await db.query('select * from storage.objects')).rows.length,1,'Existing Storage read access unchanged');
  await assert.rejects(()=>db.query('insert into storage.objects values(2,$1)',[id(2)]),/row-level security/);
  assert.equal((await db.query('update storage.objects set owner_id=auth.uid() returning *')).rows.length,0);
  assert.equal((await db.query('delete from storage.objects returning *')).rows.length,0);
  await as(3); await request('/rpc/test_feature_definer'); assert.equal((await db.query('select * from storage.objects')).rows.length,1);
  await as(5); await request('/rpc/parent_feature');
  await as(1); await request('/rpc/coach_feature');
  const enabled=(await set(2,false)).rows[0]; assert.equal(enabled.features_disabled,false); assert.equal(enabled.disabled_at,null); assert.equal(enabled.disabled_by,null);
  await as(2); await request('/rpc/test_feature_definer','POST','select public.test_feature_definer()');
  assert.equal((await db.query('select * from public.training_sessions')).rows.length,2,'Existing data preserved and features work after enable');
  await as(6); await set(3,true); await set(3,false);
  await as(null,'anon'); await request('/profiles','GET'); await assert.rejects(access,/permission denied/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from private.rider_feature_access_audit where athlete_id=$1',[id(2)])).rows[0].n,2,'Audit records actual changes only');
  assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n,6,'No profile deletion');
  const hook=(await db.query("select rolconfig from pg_roles where rolname='authenticator'")).rows[0].rolconfig;
  assert(hook.includes('pgrst.db_pre_request=public.jkcrew_check_rider_feature_access'));
  for(const fn of ['private.set_rider_feature_access(uuid,boolean)','public.set_rider_feature_access(uuid,boolean)','public.get_rider_feature_access()']) assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') ok",[fn])).rows[0].ok,false);
  await db.close();
  console.log('PASS rider feature access: linked coach/admin controls, no self-enable, untouched accounts, reversible audit, dashboard access, RPC and REST gate, unchanged public RLS and Storage reads, blocked Storage writes, enabled riders and parents.');
})().catch(error=>{console.error(error);process.exit(1);});
