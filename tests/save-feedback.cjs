const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const code=app.slice(app.indexOf('const progressSaveStates ='),app.indexOf('async function getAppNotifications'));
const label={textContent:''};const element={querySelector:()=>label,setAttribute:()=>{}};
let requests=0,resolve;
const c={state:{user:{id:'synthetic'}},navigator:{onLine:true},document:{querySelector:()=>element},clearTimeout:()=>{},client:{rpc:()=>{requests++;return new Promise(r=>resolve=r)}}};vm.createContext(c);vm.runInContext(code,c);
(async()=>{
 const pending=c.saveProgressRpc('record',{p_assignment_id:'one'});assert.equal(label.textContent,'Saving…');
 c.setSyncStatus('saved');assert.equal(label.textContent,'Saving…');assert(!code.includes('setTimeout'));
 resolve({data:{},error:null});await pending;assert.equal(label.textContent,'Saved');
 c.navigator.onLine=false;const offline=await c.saveProgressRpc('record',{p_assignment_id:'two'});assert(offline.error);assert.equal(requests,1);assert.equal(label.textContent,'Waiting for connection');
 c.navigator.onLine=true;c.setSyncStatus('saved');assert.equal(label.textContent,'Save unconfirmed');
 const retry=c.saveProgressRpc('record',{p_assignment_id:'two'});resolve({error:null});await retry;assert.equal(label.textContent,'Saved');
 c.client.rpc=async()=>{throw new Error('Network failed')};const failure=await c.saveProgressRpc('record',{p_assignment_id:'three'});assert(failure.error);assert.equal(label.textContent,'Save unconfirmed');
 console.log('PASS: no timer-based Saved, pending request stays Saving, offline attempts are not sent, reconnect retains failure, retry confirms saving and network errors are visible.');
})().catch(e=>{console.error(e);process.exit(1)});
