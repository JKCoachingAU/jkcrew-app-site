// Execute the real Session optional-read continuation against synthetic saved
// times. No SDK, network, accounts or production writes are involved.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const start=app.indexOf('  const loadOptionalSessionDetails = () => {',app.indexOf('async function renderSession('));
const end=app.indexOf('\n  const activeGesture = waitForSessionGesture();',start);
assert(start>0&&end>start,'Actual optional saved-time continuation exists');
const code=app.slice(start,end)+'\nloadOptionalSessionDetails();';
const now=Date.parse('2026-11-21T02:00:00Z'),RealDate=Date;
class FixedDate extends RealDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now}}
const saved=(venue,seconds,date='2026-11-21T01:00:00Z')=>({daily_venue:venue,daily_completed_seconds:seconds,daily_completed_at:date,started_at:date});
let checks=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++};
async function scenario(active,history,{initial='Checking saved time…',fail=false,leave=false}={}){
 let reads=0,current=true,release;
 const value={textContent:initial},chip={isConnected:true,querySelector:()=>value,classList:{toggle(){}}};
 const state={user:{id:'synthetic-rider'},profile:{country_code:'AU'},selectedVenue:'Oasis',activeTraining:active};
 const gate=new Promise(resolve=>{release=resolve});
 const query={};for(const method of ['select','eq','gte','order','limit'])query[method]=()=>query;
 query.then=(resolve,reject)=>{reads++;return (leave?gate:Promise.resolve()).then(()=>{if(fail)throw Error('Unavailable');return {data:history,error:null}}).then(resolve,reject)};
 const context=vm.createContext({state,userId:'synthetic-rider',selectedVenue:'Oasis',requestedVenueKey:'oasis',assignments:[],awards:[],contestPrepSession:true,forceParkKing:false,
  canApply:()=>current,Date:FixedDate,Promise,Math,countryTimezones:{AU:'Australia/Brisbane'},
  venueIdentityKey:value=>String(value||'').trim().toLowerCase(),dailyRpcVenue:value=>String(value||'').trim(),
  dateForTimezone:(zone,date=new FixedDate())=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:zone}).format(date),
  latestDailyTime:(active,latest)=>{const source=active?.daily_completed_seconds!=null?active:latest;return source?.daily_completed_seconds!=null?source.daily_completed_seconds+' seconds':'Not finished today'},
  getAthleteHomeVerifiedLeaderboard:async()=>[],document:{querySelector:selector=>selector.includes('.session-time-chip')?chip:null,getElementById:()=>null},
  client:{from:()=>query},window:{setTimeout:fn=>fn()},console:{warn(){}},
 });
 vm.runInContext(code,context);
 await new Promise(resolve=>setImmediate(resolve));
 if(leave){current=false;release();await new Promise(resolve=>setImmediate(resolve));}
 return {reads,text:value.textContent};
}
(async()=>{
 eq(await scenario(saved('Village',130),[saved('Oasis',90)]),{reads:1,text:'90 seconds'},'Another park’s active saved time cannot suppress the selected park history');
 eq(await scenario(saved('Oasis',130,'2026-11-20T01:00:00Z'),[]),{reads:1,text:'Not finished today'},'Yesterday’s active saved time cannot leave today’s history check pending');
 eq(await scenario(saved('Oasis',90),[],{initial:'90 seconds'}),{reads:0,text:'90 seconds'},'A verified saved time for this park today needs no duplicate history read');
 eq(await scenario(null,[saved('Village',130),saved('Oasis',85,'2026-11-20T01:00:00Z')]),{reads:1,text:'Not finished today'},'History excludes other parks and previous riding days');
 eq(await scenario(null,[],{fail:true}),{reads:1,text:'Time unavailable'},'A failed optional history read reports unavailable rather than remaining on Checking');
 eq(await scenario(null,[saved('Oasis',90)],{leave:true}),{reads:1,text:'Checking saved time…'},'Late saved-time history does not write into a view left by the rider');
 console.log('PASS: '+checks+' actual Session saved-time venue/day/read-isolation checks.');
})().catch(error=>{console.error(error);process.exitCode=1});
