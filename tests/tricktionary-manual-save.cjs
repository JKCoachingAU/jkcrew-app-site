// Exercise the shipped form handlers with deferred network results and real timeouts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const functionSource = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const handlers = functionSource('const manualTrickSaveForms = new WeakMap();', '\nasync function removeManualTrick(')
  + functionSource('async function saveCoachManualTrick(', '\nasync function removeCoachManualTrick(');
const helpers = functionSource('function withTimeout(', '\nconst wait =');
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };
const element = () => ({disabled:false,textContent:'+',attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}});
function harness({coach=false,title='Barspin Box',count='3',timeout=1000}={}) {
  const button=element(),inputs=[element(),element()],form={...element(),isConnected:true,values:{title,count},
    querySelector:()=>button,querySelectorAll:()=>inputs};
  const calls=[],notices=[],clears=[],renders=[];
  let nextId=0;
  const control={rpc:async()=>({error:null}),profile:async()=>({id:'rider',manual_tricktionary:[]}),refresh:async()=>{}};
  const context={WeakMap,Map,JSON,Number,String,Error,Promise,FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key];}},
    setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,timeout)),clearTimeout,
    crypto:{randomUUID:()=>`entry-${++nextId}`},
    state:{user:{id:coach?'coach':'rider'},profile:{role:coach?'coach':'athlete'},selectedAthleteId:coach?'rider':null,
      sessionSetupVersion:1,view:coach?'student':'tricktionary',loadingOverlayToken:2},
    isCoachRole:role=>['coach','admin'].includes(role),
    normalizeTrickKey:title=>String(title).trim().toLowerCase().replace(/\s+/g,' '),
    tricktionaryCategoryFromText:title=>title.includes('Foam')?'foam':'box',
    manualTricktionary:profile=>profile.manual_tricktionary,
    selectedCoachAthleteProfile:()=>control.profile(),
    client:{rpc:(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return control.rpc(name,args);}},
    cacheClear:key=>clears.push(key),notify:(text,type)=>notices.push({text,type}),messageFrom:error=>error.message||String(error),
    renderTricktionary:async()=>{renders.push('rider');await control.refresh();},
    renderStudentProfile:async()=>{renders.push('coach');await control.refresh();},
  };
  vm.createContext(context); vm.runInContext(helpers+handlers,context);
  let prevented=0;
  const submit=()=>context[coach?'saveCoachManualTrick':'saveManualTrick']({currentTarget:form,preventDefault(){prevented++;}});
  const restored=()=>{assert.equal(button.disabled,false);assert.equal(button.textContent,'+');assert.equal(form.attributes['aria-busy'],undefined);assert(inputs.every(input=>input.disabled===false));};
  return {context,form,button,inputs,calls,notices,clears,renders,control,submit,restored,get prevented(){return prevented;}};
}
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
  await test('rider double taps issue one write and keep the form locked through refresh',async()=>{
    const h=harness(),save=deferred(),refresh=deferred();h.control.rpc=()=>save.promise;h.control.refresh=()=>refresh.promise;
    const first=h.submit();await h.submit();assert.equal(h.calls.length,1);assert.equal(h.prevented,2);
    assert.equal(h.button.disabled,true);assert(h.inputs.every(input=>input.disabled));assert.equal(h.form.attributes['aria-busy'],'true');
    save.resolve({error:null});await new Promise(setImmediate);assert.deepEqual(h.renders,['rider']);
    await h.submit();assert.equal(h.calls.length,1,'Refresh remains within the in-flight lock');
    refresh.resolve();await first;h.restored();assert.deepEqual(h.clears,['roster']);assert.match(h.notices[0].text,/No points were awarded/);
  });
  await test('network failures preserve inputs and reuse the same ID for normalized payload retries',async()=>{
    const h=harness();h.control.rpc=async()=>({error:{message:'Connection lost'}});
    await h.submit();h.restored();assert.equal(h.form.values.title,'Barspin Box');assert.equal(h.form.values.count,'3');
    assert.equal(h.renders.length,0);assert.equal(h.clears.length,0);assert.match(h.notices[0].text,/Connection lost/);
    h.form.values.title='  BARSPIN   BOX  ';h.control.rpc=async()=>({error:null});await h.submit();
    assert.equal(h.calls[0].args.p_entry_id,h.calls[1].args.p_entry_id);assert.equal(h.calls[1].args.p_title,'BARSPIN BOX');h.restored();
  });
  await test('changed form payloads get new IDs while returning to a failed payload retains its ID',async()=>{
    const h=harness();h.control.rpc=async()=>{throw Error('Network unavailable');};
    await h.submit();h.form.values.count='4';await h.submit();h.form.values.count='3';await h.submit();
    assert.notEqual(h.calls[0].args.p_entry_id,h.calls[1].args.p_entry_id);assert.equal(h.calls[0].args.p_entry_id,h.calls[2].args.p_entry_id);h.restored();
  });
  await test('a timed-out save can retry safely and its late response cannot update the page twice',async()=>{
    const h=harness({timeout:10}),late=deferred();h.control.rpc=()=>late.promise;
    await h.submit();h.restored();assert.match(h.notices[0].text,/timed out/);assert.equal(h.form.values.title,'Barspin Box');
    h.control.rpc=async()=>({error:null});await h.submit();assert.equal(h.calls[0].args.p_entry_id,h.calls[1].args.p_entry_id);
    const notices=h.notices.length;late.resolve({error:null});await new Promise(setImmediate);
    assert.equal(h.renders.length,1);assert.equal(h.notices.length,notices);h.restored();
  });
  await test('coach duplicate-title checks stay intact and exceptions release the form lock',async()=>{
    const h=harness({coach:true});h.control.profile=async()=>({id:'rider',manual_tricktionary:[{id:'existing',title:'barspin box',count:9}]});
    await h.submit();assert.equal(h.calls.length,0);assert.match(h.notices[0].text,/already in this rider/);h.restored();
    h.control.profile=async()=>{throw Error('Could not load rider');};await h.submit();assert.equal(h.calls.length,0);h.restored();
    h.control.profile=async()=>({id:'rider',manual_tricktionary:[]});await h.submit();assert.equal(h.calls.length,1);assert.deepEqual(h.renders,['coach']);h.restored();
  });
  await test('coach retry recognizes its own committed entry after an uncertain response',async()=>{
    const h=harness({coach:true});h.control.rpc=async()=>({error:{message:'Request timed out'}});await h.submit();
    const id=h.calls[0].args.p_entry_id;
    h.control.profile=async()=>({id:'rider',manual_tricktionary:[{id,title:'Barspin Box',count:3}]});
    h.control.rpc=async()=>({error:null});await h.submit();assert.equal(h.calls.length,2);assert.equal(h.calls[1].args.p_entry_id,id);h.restored();
  });
  await test('changing rider or session while coach lookup is pending prevents the write',async()=>{
    for(const change of [h=>{h.context.state.selectedAthleteId='different';},h=>{h.context.state.sessionSetupVersion++;},h=>{h.form.isConnected=false;}]) {
      const h=harness({coach:true}),lookup=deferred();h.control.profile=()=>lookup.promise;
      const task=h.submit();change(h);lookup.resolve({id:'rider',manual_tricktionary:[]});await task;
      assert.equal(h.calls.length,0);assert.equal(h.notices.length,0);assert.equal(h.renders.length,0);h.restored();
    }
  });
  await test('stale save responses never refresh or notify another account, session, view or selected rider',async()=>{
    for(const coach of [false,true]) for(const change of [
      h=>{h.context.state.user.id='different';},h=>{h.context.state.sessionSetupVersion++;},h=>{h.context.state.view='home';},
      h=>{h.context.state.loadingOverlayToken++;},h=>{h.form.isConnected=false;},h=>{h.context.state.profile.role='parent';},
      ...(coach?[h=>{h.context.state.selectedAthleteId='different';}]:[]),
    ]) {
      const h=harness({coach}),save=deferred();h.control.rpc=()=>save.promise;
      const task=h.submit();await new Promise(setImmediate);assert.equal(h.calls.length,1);change(h);save.resolve({error:null});await task;
      assert.equal(h.notices.length,0);assert.equal(h.renders.length,0);assert.equal(h.clears.length,0);h.restored();
    }
  });
  await test('successful writes followed by refresh failure retry the refresh without another write',async()=>{
    const h=harness();h.control.refresh=async()=>{throw Error('Refresh failed');};await h.submit();
    assert.equal(h.calls.length,1);assert.match(h.notices.at(-1).text,/Trick saved. Refresh/);h.restored();
    h.control.refresh=async()=>{};await h.submit();assert.equal(h.calls.length,1);assert.equal(h.renders.length,2);h.restored();
  });
  await test('invalid roles, counts, names and foam entries cannot issue manual writes',async()=>{
    for(const update of [h=>{h.context.state.profile.role='parent';},h=>{h.context.state.user=null;},h=>{h.form.values.count='0';},
      h=>{h.form.values.count='2.5';},h=>{h.form.values.count='1000';},h=>{h.form.values.count='NaN';},h=>{h.form.values.title='x'.repeat(121);},h=>{h.form.values.title='Foam flip';}]) {
      const h=harness();update(h);await h.submit();assert.equal(h.calls.length,0);assert.equal(h.renders.length,0);h.restored();
    }
  });
  console.log(`${checks} manual Tricktionary save regressions passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
