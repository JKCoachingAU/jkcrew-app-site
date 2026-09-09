const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const names=['assignmentLinesForEditor','sessionViewerAssignmentEditor','saveSessionViewerAssignments'];
const code=names.map(name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2)}).join('\n');
let saved;
const c={escapeHtml:s=>String(s),categoryDisplayInfo:()=>({label:'Lines'}),categoryInfo:{lines:{}},state:{sessionViewerRosterCache:[{id:'r',country_code:'AU'}]},FormData:class{getAll(){return ['Manual - Barspin\n- 180','Tailwhip - Air - 360','Flip - Tuck - Transfer']}},setButtonBusy:()=>()=>{},parseAssignmentLine:(line,index)=>({trick_name:line,sort_order:index}),weekStartDateForCountry:()=> '2026-09-06',client:{rpc:async(name,args)=>{saved=args;return {}}},withTimeout:p=>p,clearCoachCaches:()=>{},notify:()=>{},refreshSessionViewerLight:async()=>{}};
vm.createContext(c);vm.runInContext(code,c);
(async()=>{
 const html=c.sessionViewerAssignmentEditor({athlete:{id:'r'},venue:''},'lines',[{trick_name:'Manual - Air - 180'}]);
 assert.equal((html.match(/name="numberedLine"/g)||[]).length,3);assert(html.includes('Line 1'));assert(html.includes('Line 3'));assert(!html.includes('name="assignmentLines"'));
 await c.saveSessionViewerAssignments({preventDefault(){},currentTarget:{dataset:{athleteId:'r',viewerAssignmentEditor:'lines'},querySelector:()=>({})}});
 assert.equal(saved.p_assignments.length,3);assert.equal(saved.p_assignments[0].trick_name,'Manual - Barspin - 180');
 console.log('PASS: three separate labelled fields; a newline within one field stays in the same run when saved.');
})().catch(e=>{console.error(e);process.exit(1)});
