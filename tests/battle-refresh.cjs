const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const source=app.slice(app.indexOf('let battleScoreRefreshRunning ='),app.indexOf('async function renderCoachBattleViewer()'));
let renders=0,modal=false,scrolled=false;
const card={dataset:{battleId:'battle'},open:true};
const search={value:'Felix',dispatchEvent(){}};
const filter={dataset:{battleHqFilter:'accepted'},click(){}};
const view={querySelectorAll:s=>s.includes('data-battle-hq-filter')?[filter]:[card],querySelector:s=>s.includes('search')?search:filter};
const context={state:{view:'battleViewer',profile:{role:'coach'}},isCoachRole:r=>r==='coach',document:{visibilityState:'visible',activeElement:{matches:()=>false},querySelector:s=>s==='#view'?view:modal},window:{scrollY:200,scrollTo:(x,y)=>{scrolled=y===200}},Event:class{},renderCoachBattleViewer:async()=>{renders++;card.open=false;search.value=''}};
vm.createContext(context);vm.runInContext(source,context);
(async()=>{
 await context.refreshCoachBattleScores();assert.equal(renders,1);assert(card.open);assert.equal(search.value,'Felix');assert(scrolled);
 modal=true;await context.refreshCoachBattleScores();assert.equal(renders,1);
 modal=false;context.document.visibilityState='hidden';await context.refreshCoachBattleScores();assert.equal(renders,1);
 context.document.visibilityState='visible';context.state.view='student';await context.refreshCoachBattleScores();assert.equal(renders,1);
 console.log('PASS: battle score refresh preserves expanded cards, search and scroll; skips other screens, hidden tabs and open builders.');
})().catch(e=>{console.error(e);process.exit(1)});
