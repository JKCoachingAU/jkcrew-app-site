// Real PostgreSQL only: disposable databases over a /tmp Unix socket.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHarness, literal, json} = require('./helpers/local-postgres.cjs');
const h = createHarness('tricktionary_automation');
const migration = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const rider=id(1), coach=id(2), parent=id(3), stranger=id(4), otherCoach=id(5), otherParent=id(6), admin=id(7), disabled=id(8), missing=id(9);
const qjson = value => `${literal(JSON.stringify(value))}::jsonb`;
const rows = sql => json(h.batch(`select coalesce(jsonb_agg(t), '[]') from (${sql}) t;`));
const scalar = sql => Object.values(rows(sql)[0])[0];
const auth = (user, anonymous=false) => `do $$begin
  perform set_config('request.jwt.claim.sub', ${literal(user||'')}, true);
  perform set_config('request.jwt.claims', ${qjson({is_anonymous:anonymous})}::text, true);
end$$;`;
const gateway = (sql,user=rider,{role='authenticated',anonymous=false}={}) => h.batch(`begin; ${auth(user,anonymous)} set local role ${role}; ${sql}; commit;`).split('\n').filter(Boolean).at(-1);
const rpc = (sql,user,options) => JSON.parse(gateway(`select to_jsonb(${sql})`,user,options));
const getCatalog = (user=coach,athlete=null) => rpc(`public.get_tricktionary_catalog(${athlete?literal(athlete):'null'})`,user);
const saveSql = (key,title='Approved title',category='box',subcategory='spins',schema='public') => `${schema}.save_tricktionary_catalog_entry(${literal(key)},${literal(title)},${literal(category)},${subcategory===null?'null':literal(subcategory)})`;
const save = (key,user=coach,title='Approved title',category='box',subcategory='spins') => rpc(saveSql(key,title,category,subcategory),user);
const item = (key,category='box',subcategory='spins',expected_category=null,expected_subcategory=null) => ({key,category,subcategory,expected_category,expected_subcategory});
const applySql = (items,athlete=rider,schema='public') => `${schema}.apply_tricktionary_locations(${literal(athlete)},${qjson(items)})`;
const apply = (items,user=rider,athlete=rider) => rpc(applySql(items,athlete),user);
const addSql = (entry=id(100),title='Barspin',count=3,category='box',athlete=rider) => `public.add_manual_tricktionary_entry(${literal(athlete)},${literal(entry)},${literal(title)},${count},${literal(category)})`;
const profile = (athlete=rider) => rows(`select * from profiles where id=${literal(athlete)}`)[0];
const setMeta = (meta,athlete=rider) => h.batch(`update profiles set tricktionary_meta=${qjson(meta)} where id=${literal(athlete)};`);
const meta = () => profile().tricktionary_meta;
const historyTables = ['weekly_trick_assignments','assignment_progress','percentage_attempts','assignment_attempts','assignment_point_awards','xp_ledger','training_sessions','tricktionary_landing_history'];
const history = () => Object.fromEntries(historyTables.map(table => [table,rows(`select * from ${table} order by id`)]));
const clear = () => h.batch("delete from private.tricktionary_catalog; update profiles set tricktionary_meta='{}',manual_tricktionary='[]';");
let checks=0;
async function test(name,fn) { clear(); const before=history(); await fn(); assert.deepEqual(history(),before,'Historical landing, scoring, XP and training data must stay byte-for-byte unchanged'); checks++; console.log('PASS '+name); }

(async()=>{
  await h.adapter.exec(`
    create schema auth; create schema private; create role anon; create role authenticated; create role service_role;
    grant usage on schema public,auth,private to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table profiles(id uuid primary key,role text,display_name text,manual_tricktionary jsonb default '[]',tricktionary_meta jsonb default '{}',updated_at timestamptz default now());
    create table coach_athletes(coach_id uuid,athlete_id uuid);
    create table parent_athletes(parent_id uuid,athlete_id uuid,coach_id uuid);
    create table weekly_trick_assignments(id uuid primary key,athlete_id uuid,trick_name text);
    create table assignment_progress(id uuid primary key,landed integer);
    create table percentage_attempts(id uuid primary key,landed boolean);
    create table assignment_attempts(id uuid primary key,trick_name text);
    create table assignment_point_awards(id uuid primary key,points integer);
    create table xp_ledger(id uuid primary key,xp integer);
    create table training_sessions(id uuid primary key,total_points integer);
    create table tricktionary_landing_history(id uuid primary key,athlete_id uuid,trick_name text,landed_count integer);
    create table private.rider_feature_access(athlete_id uuid primary key,features_disabled boolean);
    alter table profiles enable row level security; alter table coach_athletes enable row level security; alter table parent_athletes enable row level security;
    grant select on profiles,coach_athletes,parent_athletes to authenticated;
    insert into profiles(id,role,display_name) values
      ('${rider}','athlete','Rider'),('${coach}','coach','Coach'),('${parent}','parent','Parent'),('${stranger}','athlete','Other rider'),
      ('${otherCoach}','coach','Other coach'),('${otherParent}','parent','Other parent'),('${admin}','admin','Admin'),('${disabled}','athlete','Disabled rider');
    insert into coach_athletes values('${coach}','${rider}'),('${otherCoach}','${stranger}');
    insert into parent_athletes values('${parent}','${rider}','${coach}'),('${otherParent}','${stranger}','${otherCoach}');
    insert into private.rider_feature_access values('${disabled}',true);
    insert into weekly_trick_assignments values('${id(900)}','${rider}','Barspin');
    insert into assignment_progress values('${id(901)}',11);
    insert into percentage_attempts values('${id(902)}',true);
    insert into assignment_attempts values('${id(903)}','Barspin');
    insert into assignment_point_awards values('${id(904)}',17);
    insert into xp_ledger values('${id(905)}',53);
    insert into training_sessions values('${id(906)}',29);
    insert into tricktionary_landing_history values('${id(907)}','${rider}','Barspin',11);
    create function private.reject_history_write() returns trigger language plpgsql as $$begin raise exception 'Unexpected write to %',tg_table_name; end$$;
    ${historyTables.map(table=>`create trigger history_read_only before insert or update or delete on ${table} for each statement execute function private.reject_history_write();`).join('\n')}
  `);
  for(const name of ['20260903023000_harden_tricktionary_updates.sql','20260903085841_harden_tricktionary_compatibility.sql','20260903090815_strict_tricktionary_legacy_categories.sql','20260903092151_box_transfers_and_tricktionary_rename.sql']) h.batch(migration(name));
  const access=migration('20260914101302_rider_feature_access_controls.sql');
  h.batch(access.slice(access.indexOf('create function private.rider_features_disabled(')).split('$$;')[0]+'$$;');
  h.batch('revoke all on function private.rider_features_disabled() from public,anon; grant execute on function private.rider_features_disabled() to authenticated;');
  // Reproduce the existing bug using the actual current production definition.
  setMeta({categories:{barspin:'spine'},subcategories:{barspin:'other'},titles:{barspin:'Chosen name'},hidden:{barspin:true}});
  rpc(addSql()); assert.equal(meta().categories.barspin,'box','Original manual add overwrites a deliberate Spine placement');
  h.batch("update profiles set manual_tricktionary='[]';");
  setMeta({categories:{barspin:'spine'},subcategories:{barspin:'other'},titles:{barspin:'Chosen name'},hidden:{barspin:true}});
  const before=profile(),beforeHistory=history();
  const oldAcl=scalar("select proacl::text from pg_proc where oid='public.add_manual_tricktionary_entry(uuid,uuid,text,integer,text)'::regprocedure");
  const tableAcl=rows("select n.nspname,c.relname,c.relacl::text,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname");
  h.batch(migration('20260928013458_tricktionary_approved_catalog_and_safe_automation.sql'));
  assert.deepEqual(profile(),before); assert.deepEqual(history(),beforeHistory); assert.deepEqual(getCatalog(),[]);
  assert.equal(scalar("select proacl::text from pg_proc where oid='public.add_manual_tricktionary_entry(uuid,uuid,text,integer,text)'::regprocedure"),oldAcl);
  assert.deepEqual(rows("select n.nspname,c.relname,c.relacl::text,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname"),tableAcl);
  console.log('PASS original overwrite reproduced; migration preserves existing data, RLS and grants'); checks++;

  await test('manual adds preserve explicit placement, aliases, subcategories and hidden/title choices, including retries',()=>{
    const original={aliases:{'old bar':'barspin'},categories:{barspin:'spine'},subcategories:{barspin:'other'},titles:{barspin:'Chosen name'},hidden:{barspin:true},unrelated:{preserve:true}};
    setMeta(original);
    const saved=rpc(addSql(id(100),'Old Bar',3,'box'));
    assert.equal(saved.tricktionaryCategory,'spine'); assert.deepEqual(meta(),original);
    assert.equal(profile().manual_tricktionary.length,1);
    const placed=rpc(`public.set_tricktionary_location('${rider}','barspin','hip','flips')`,coach);
    assert.equal(placed.category,'hip');
    const beforeRetry=profile();
    assert.deepEqual(rpc(addSql(id(100),' old   BAR ',3,'air')),saved);
    assert.deepEqual(profile(),beforeRetry,'Replay cannot change timestamps, counts or placement');
    assert.throws(()=>rpc(addSql(id(100),'Old Bar',4,'box')),/different details/);
    assert.throws(()=>rpc(addSql(id(101),'Old Bar',3,'box')),/already in/);
    assert.equal(scalar('select count(*) from private.tricktionary_catalog'),0,'Manual rider choices are never seeded into shared defaults');
  });
  await test('manual adds keep New and subcategory-only overrides and initialize only genuinely absent placement',()=>{
    for(const original of [{categories:{barspin:'new'}},{subcategories:{barspin:'spins'}}]) {
      h.batch("update profiles set manual_tricktionary='[]';"); setMeta(original);
      rpc(addSql()); assert.deepEqual(meta(),original);
    }
    h.batch("update profiles set manual_tricktionary='[]';"); setMeta({aliases:{'old bar':'barspin'}});
    rpc(addSql(id(100),'Old Bar',3,'spine'),coach);
    assert.equal(meta().categories.barspin,'spine'); assert.equal(profile().manual_tricktionary[0].source,'coach');
    assert.equal(meta().aliases['old bar'],'barspin');
  });
  await test('coach catalog is exact-name scoped, private and visible only to linked riders/parents',()=>{
    const approved=save('  BARSpin  ',coach,'  Barspin   On Box  ','box','spins');
    assert.deepEqual(approved,{source_key:'barspin',title:'Barspin On Box',category:'box',subcategory:'spins'});
    for(const [user,target] of [[coach,null],[coach,rider],[rider,null],[rider,rider],[parent,rider]]) assert.deepEqual(getCatalog(user,target),[approved]);
    for(const user of [stranger,otherCoach,admin]) assert.deepEqual(getCatalog(user),[]);
    for(const [user,target] of [[rider,stranger],[otherCoach,rider],[otherParent,rider],[parent,null]]) assert.throws(()=>getCatalog(user,target),/cannot view|crew/);
    assert.throws(()=>gateway('select * from private.tricktionary_catalog',coach),/permission denied/);
    assert.equal(gateway('select count(*) from profiles',coach),'0','Existing RLS remains closed');
    const before=rows('select * from private.tricktionary_catalog'); save('barspin',coach,'Barspin On Box');
    assert.deepEqual(rows('select * from private.tricktionary_catalog'),before,'Unchanged catalog retries preserve updated_at');
    assert.deepEqual(Object.keys(getCatalog(rider)[0]).sort(),['category','source_key','subcategory','title']);
  });
  await test('only coach/admin can approve or delete their own catalog, and conflict suppression avoids guessing',()=>{
    for(const user of [rider,parent,stranger]) {
      assert.throws(()=>save('barspin',user),/Only coaches/);
      assert.throws(()=>rpc("private.delete_tricktionary_catalog_entry('barspin')",user),/Only coaches/);
    }
    save('barspin'); save('barspin',otherCoach,'Other','hip','other');
    assert.equal(getCatalog(rider)[0].category,'box');
    h.batch(`insert into coach_athletes values('${otherCoach}','${rider}');`);
    assert.deepEqual(getCatalog(rider),[]); assert.deepEqual(getCatalog(parent,rider),[]);
    assert.equal(getCatalog(coach)[0].category,'box'); assert.equal(getCatalog(otherCoach)[0].category,'hip');
    save('barspin',otherCoach,'Agreed title','box','spins'); assert.equal(getCatalog(rider).length,1);
    assert.equal(rpc("public.delete_tricktionary_catalog_entry('barspin')",otherCoach),true);
    assert.equal(rpc("public.delete_tricktionary_catalog_entry('barspin')",otherCoach),false);
    assert.equal(getCatalog(coach).length,1,'Deleting another coach catalog never touches this coach');
    save('admin trick',admin); assert.equal(getCatalog(admin).length,1); assert.equal(getCatalog(coach).length,1);
    h.batch(`delete from coach_athletes where coach_id='${otherCoach}' and athlete_id='${rider}';`);
  });
  await test('catalog validates title/location combinations and caps both stored and returned entries',()=>{
    for(const [key,title,category,subcategory] of [['','Title','box','spins'],['a','', 'box','spins'],['x'.repeat(121),'Title','box','spins'],['a','Title','hip','transfers'],['a','Title','new','spins'],['a','Title','air',null],['a','Title','unknown','other']])
      assert.throws(()=>save(key,coach,title,category,subcategory),/valid|between/);
    save('box transfer',coach,'Box transfer','box','transfers'); save('unresolved',coach,'Unresolved','new',null);
    h.batch(`insert into private.tricktionary_catalog(coach_id,source_key,display_title,category,subcategory)
      select '${coach}','key '||i,'Title '||i,'box','spins' from generate_series(1,1998)i;`);
    assert.equal(getCatalog().length,2000);
    assert.throws(()=>save('too many'),/catalog is full/);
    save('key 1',coach,'Updated','air','alleyoop');
    assert.equal(getCatalog().find(e=>e.source_key==='key 1').category,'air');
  });
  await test('batch promotes only unresolved cards and preserves all explicit and stale preview choices',()=>{
    const original={aliases:{'old bar':'barspin'},categories:{barspin:'new',explicit:'hip',stale:'new'},subcategories:{explicit:'flips',partial:'other'},titles:{barspin:'Custom'},hidden:{barspin:true},other:{keep:true}};
    setMeta(original);
    const result=apply([item('old bar','box','spins','new'),item('fresh','spine','other'),item('explicit','box','spins','hip','flips'),item('stale'),item('partial')]);
    assert.equal(result.applied,2); assert.equal(result.unchanged,0);
    assert.deepEqual(result.skipped,[{key:'explicit',reason:'explicit_location'},{key:'stale',reason:'location_changed'},{key:'partial',reason:'explicit_location'}]);
    assert.deepEqual(result.items,[{key:'barspin',category:'box',subcategory:'spins'},{key:'fresh',category:'spine',subcategory:'other'}]);
    assert.deepEqual(meta().aliases,original.aliases); assert.deepEqual(meta().titles,original.titles); assert.deepEqual(meta().hidden,original.hidden); assert.deepEqual(meta().other,original.other);
    assert.equal(meta().categories.explicit,'hip'); assert.equal(meta().subcategories.explicit,'flips'); assert.equal(meta().categories.stale,'new');
    const before=profile();
    const retry=apply([item('old bar','box','spins','new'),item('fresh','spine','other')]);
    assert.equal(retry.applied,0); assert.equal(retry.unchanged,2); assert.deepEqual(profile(),before);
    assert.deepEqual(profile().manual_tricktionary,[]);
  });
  await test('batch validation is transactional, normalizes canonical keys and rejects aliases repeated in a batch',()=>{
    setMeta({aliases:{alias:'root'},categories:{keep:'hip'},subcategories:{keep:'other'}});
    const original=profile();
    const bads=[null,{},[{}],[{...item('a'),expected_category:undefined}],[{...item('a'),subcategory:3}],[item('')],[item('a','hip','transfers')],Array.from({length:201},(_,i)=>item('key'+i)),[item('root'),item('alias')],[item('one'),item('two','invalid','other')]];
    for(const bad of bads) { assert.throws(()=>apply(bad),/list|needs|valid|200|only once/); assert.deepEqual(profile(),original); }
    const result=apply([item('  ALIAS  ')],coach); assert.equal(result.items[0].key,'root');
    assert.equal(meta().categories.keep,'hip'); assert.equal(meta().subcategories.keep,'other');
    const current=profile(); assert.deepEqual(apply([]),{applied:0,unchanged:0,skipped:[],items:[]}); assert.deepEqual(profile(),current);
  });
  await test('batch accepts own riders, linked coaches and admins; parents and unrelated accounts cannot write',()=>{
    for(const user of [rider,coach,admin]) assert.equal(apply([item('trick '+user)],user).applied,1);
    for(const user of [parent,otherParent,otherCoach,stranger]) {
      assert.throws(()=>apply([item('blocked')],user),/own tricks|crew/);
      assert.throws(()=>rpc(applySql([item('blocked')],rider,'private'),user),/own tricks|crew/);
      assert.throws(()=>rpc(addSql(),user),/yourself|crew/);
    }
    assert.throws(()=>apply([item('blocked')],parent,parent),/own tricks|crew/,'Parent self ownership does not grant rider write rights');
  });
  await test('anonymous, missing and disabled callers cannot bypass helper or wrapper authorization',()=>{
    const calls=['public.get_tricktionary_catalog(null)','private.read_tricktionary_catalog(null)',saveSql('test'),saveSql('test','Title','box','spins','private'),
      "public.delete_tricktionary_catalog_entry('test')","private.delete_tricktionary_catalog_entry('test')",applySql([item('test')]),applySql([item('test')],rider,'private'),addSql()];
    for(const call of calls) {
      for(const user of ['',missing,disabled]) assert.throws(()=>rpc(call,user),/Sign in|contact your coach/);
      assert.throws(()=>rpc(call,coach,{anonymous:true}),/Sign in/);
      assert.throws(()=>rpc(call,'',{role:'anon'}),/permission denied/);
    }
  });
  await test('RPC grants are authenticated-only, wrappers invoker, helpers private and table writes closed',()=>{
    const signatures=['get_tricktionary_catalog(uuid)','save_tricktionary_catalog_entry(text,text,text,text)','delete_tricktionary_catalog_entry(text)','apply_tricktionary_locations(uuid,jsonb)'];
    for(const signature of signatures) {
      const fn=rows(`select prosecdef,proconfig from pg_proc where oid='public.${signature}'::regprocedure`)[0];
      assert.equal(fn.prosecdef,false); assert.deepEqual(fn.proconfig,['search_path=""']);
      assert.equal(scalar(`select has_function_privilege('anon','public.${signature}','execute')`),false);
      assert.equal(scalar(`select has_function_privilege('authenticated','public.${signature}','execute')`),true);
    }
    for(const privilege of ['select','insert','update','delete']) assert.equal(scalar(`select has_table_privilege('authenticated','private.tricktionary_catalog','${privilege}')`),false);
    assert.equal(scalar("select relrowsecurity from pg_class where oid='private.tricktionary_catalog'::regclass"),true);
    assert.equal(scalar("select has_function_privilege('authenticated','private.tricktionary_automation_role()','execute')"),false);
  });
  await test('a concurrent deliberate placement wins over a previously prepared batch',async()=>{
    const editor=h.connect('editor'),batch=h.connect('batch');
    await editor.query(`begin; ${auth(coach)} select 1 from profiles where id='${rider}' for update;`);
    const waiting=batch.query(`begin; ${auth(rider)} set local role authenticated; select ${applySql([item('barspin')])}; commit;`);
    await h.waitLock(batch);
    await editor.query(`set local role authenticated; select public.set_tricktionary_location('${rider}','barspin','hip','other'); commit;`);
    const result=json(await waiting); assert.equal(result.applied,0); assert.equal(result.skipped[0].reason,'explicit_location');
    assert.equal(meta().categories.barspin,'hip'); assert.equal(meta().subcategories.barspin,'other');
  });
  await test('simultaneous manual retries add landings once and concurrent catalog saves respect the cap',async()=>{
    const first=h.connect('manual_first'),second=h.connect('manual_second');
    await first.query(`begin; ${auth(rider)} select 1 from profiles where id='${rider}' for update;`);
    const pending=second.query(`begin; ${auth(rider)} set local role authenticated; select ${addSql()}; commit;`);
    await h.waitLock(second);
    const saved=json(await first.query(`set local role authenticated; select ${addSql()}; commit;`));
    assert.deepEqual(json(await pending),saved); assert.equal(profile().manual_tricktionary.length,1); assert.equal(profile().manual_tricktionary[0].count,3);
    h.batch(`insert into private.tricktionary_catalog(coach_id,source_key,display_title,category,subcategory)
      select '${coach}','key '||i,'Title '||i,'box','spins' from generate_series(1,1999)i;`);
    const a=h.connect('catalog_a'),b=h.connect('catalog_b');
    await a.query(`begin; ${auth(coach)} select 1 from profiles where id='${coach}' for update;`);
    const blocked=b.query(`begin; ${auth(coach)} set local role authenticated; select ${saveSql('last b')}; commit;`).then(value=>({value}),error=>({error}));
    await h.waitLock(b);
    await a.query(`set local role authenticated; select ${saveSql('last a')}; commit;`);
    assert.match((await blocked).error.message,/catalog is full/); assert.equal(getCatalog().length,2000);
  });
  console.log(`${checks} Tricktionary automation PostgreSQL regressions passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>h.close());
