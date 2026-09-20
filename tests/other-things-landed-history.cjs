const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const context={Intl,Date,countryTimezones:{AU:'Australia/Brisbane'},TRICKTIONARY_ALLOWED_CATEGORIES:new Set(['new','box','spine','air','hip']),TRICKTIONARY_CATEGORY_LABELS:{new:'New Tricks',box:'Box',spine:'Spine',air:'Air',hip:'Hip'},categoryInfo:{other:{label:'Other Things Landed'}}};
vm.createContext(context);
for(const name of ['normalizeTrickKey','safeTricktionaryCategory','manualTricktionary','tricktionaryMeta','resolveTricktionaryAlias','tricktionaryCategoryFromText','splitLineTricks','assignmentPresentation','tricktionaryLineComponents','tricktionaryLandingDate','landedTricktionaryEntries']){
 const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0);const tail=app.slice(start);vm.runInContext(tail.slice(0,tail.indexOf('\n}')+2),context);
}
const history={id:'other-landed:submission-one',athlete_id:'rider',assignment_id:null,trick_name:'X-UP',notes:'',category:'other',venue:'Test park',landed_at:'2026-09-20T02:00:00Z',landing_date:'2026-09-20',landed_count:1,evidence_type:'coach_approved_other'};
const aggregate=data=>Array.from(context.landedTricktionaryEntries({profile:{country_code:'AU'},...data}));
const approved=aggregate({landingHistory:[history,history],awards:[{assignment_id:null,award_key:'other-landed:submission-one',points:1}]});
assert.equal(approved.length,1);assert.equal(approved[0].title,'X-UP');assert.equal(approved[0].count,1,'Duplicate fetches and the score receipt never duplicate the same landing');assert(approved[0].sources.has('Other Things Landed'));
assert.equal(aggregate({awards:[{assignment_id:null,award_key:'other-landed:submission-one',points:1}]}).length,0,'A score receipt alone never invents a landed trick');
assert.equal(aggregate({landingHistory:[history,{...history,id:'other-landed:submission-two'}]})[0].count,2,'Two separately reviewed landings keep their individual source IDs');
assert.equal(aggregate({landingHistory:[{...history,trick_name:'Backflip foam pit'}]}).length,0,'The existing foam exclusion still applies');
console.log('PASS: actual Tricktionary aggregation consumes approved extra landings, keeps source IDs, and does not double-count receipts or duplicate fetches.');
