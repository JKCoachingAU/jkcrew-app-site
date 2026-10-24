import assert from 'node:assert/strict';
import { calendarEntries, parseDates, parseDetail, normalizeEvent, mergeEvents, fetchPublic, collectSchedule, validateSnapshot, safeUrl, semanticText, embeddedDocumentLinks } from '../tools/uci-schedule.mjs';
let passed=0;
const test=async(name,run)=>{await run();passed++;console.log(`ok ${name}`);};
const time='2026-10-24T12:00:00.000Z';
const entry={name:'Test Park',country:'GER',continentCode:'EUR',dates:'18 Jun - 20 Jun 2027',detailsLink:{url:'/competition-details/2027/BFR/80620'}};
const detail={competitionDetails:{name:'Test Park',dates:entry.dates,country:'Germany',venue:'Essen',competitionClass:'1 - Class 1',website:{url:'https://example.com/'}},schedule:{items:[{races:[{raceType:'Park',category:'Men Elite'},{raceType:'Park',category:'Women Elite'}]}]}};
const html=d=>`<div data-component="CompetitionDetailsModule" data-props="${JSON.stringify(d).replaceAll('&','&amp;').replaceAll('"','&quot;')}"></div>`;
const calendar=e=>({items:[{items:[{items:e}]}]});
const config={schemaVersion:1,verifiedAt:time,allowedHosts:['www.uci.org'],watchSources:[],events:[],eventOverrides:[],qualification:{status:'revision_pending',sourceUrl:'https://www.uci.org/rules'},announcements:[{id:'baseline',title:'Baseline rules',summary:'Verified baseline rules.',sourceUrl:'https://www.uci.org/rules',publishedAt:time,verifiedAt:time,notify:false}]};
const makeFetch=(overrides={})=>async url=>{
  if(overrides[url])return overrides[url]();
  if(url.includes('/calendar/upcoming'))return Response.json(calendar([entry]));
  if(url.includes('/calendar/past'))return Response.json(calendar([]));
  if(url.includes('/competition-details/'))return new Response(html(detail));
  if(url.includes('/news/listing'))return Response.json({items:[]});
  return new Response('missing',{status:404});
};
await test('dates parse ranges without local timezone conversion',()=>assert.deepEqual(parseDates('25 Aug - 04 Sep 2027'),{startDate:'2027-08-25',endDate:'2027-09-04'}));
await test('invalid and backwards dates reject',()=>{assert.throws(()=>parseDates('31 Feb 2027'));assert.throws(()=>parseDates('02 Sep - 01 Sep 2027'));assert.throws(()=>parseDates('30 Jan 2026'));});
await test('calendar deduplicates multi-day rows and excludes other years',()=>{const old={...entry,detailsLink:{url:'/competition-details/2026/BFR/1'}};assert.equal(calendarEntries(calendar([entry,entry,old])).length,1);});
await test('conflicting duplicate event fails instead of picking arbitrarily',()=>assert.throws(()=>calendarEntries(calendar([entry,{...entry,name:'Changed'}]))));
await test('structured detail decoding never executes HTML',()=>assert.equal(parseDetail(html(detail)).competitionDetails.name,'Test Park'));
await test('malformed detail fails closed',()=>assert.throws(()=>parseDetail('<html>temporary error</html>')));
await test('C1 includes both sporting nationalities but never claims Olympic points',()=>{const result=normalizeEvent(entry,detail,time);assert.deepEqual(result.eligibleNationalities,['GER','AUS']);assert.equal(result.classification,'C1');assert.equal(result.olympicQualification.status,'pending_rules');assert.equal(result.registration.deadline,null);});
await test('other nations nationals are excluded',()=>{assert.equal(normalizeEvent({...entry,country:'FRA'},{...detail,competitionDetails:{...detail.competitionDetails,competitionClass:'CN - National Championships'}},time),null);});
await test('national and continental eligibility uses sporting nationality',()=>{const cn=normalizeEvent(entry,{...detail,competitionDetails:{...detail.competitionDetails,competitionClass:'CN - National Championships'}},time);assert.deepEqual(cn.eligibleNationalities,['GER']);const cc=normalizeEvent({...entry,country:'AUS',continentCode:'OCE'},{...detail,competitionDetails:{...detail.competitionDetails,competitionClass:'CC - Continental Championships'}},time);assert.deepEqual(cc.eligibleNationalities,['AUS']);});
await test('Flatland and regional Games are not inferred eligible Park opportunities',()=>{assert.equal(normalizeEvent(entry,{...detail,schedule:{items:[{races:[{raceType:'Flatland'}]}]}},time),null);assert.equal(normalizeEvent(entry,{...detail,competitionDetails:{...detail.competitionDetails,competitionClass:'JR - Regional Games'}},time),null);});
await test('listing disappearance is review required, never cancellation',()=>{const old=normalizeEvent(entry,detail,time);const [next]=mergeEvents([], [old],{complete:true,checkedAt:time});assert.equal(next.status,'review_required');assert.equal(next.startDate,old.startDate);assert.equal(next.lastCheckedAt,old.lastCheckedAt);});
await test('failed refresh retains exact previous event',()=>{const old=normalizeEvent(entry,detail,time);assert.deepEqual(mergeEvents([],[old],{complete:false,checkedAt:time}),[old]);});
await test('verified changed fields get change history',()=>{const old=normalizeEvent(entry,detail,time);const [next]=mergeEvents([{...old,venue:'New venue'}],[old],{complete:true,checkedAt:time});assert.equal(next.changes[0].field,'venue');assert.equal(next.changes[0].previous,'Essen');});
await test('only explicit event cancellation marks cancelled',()=>{const event=normalizeEvent(entry,{...detail,competitionDetails:{...detail.competitionDetails,name:'Test Park — Cancelled'}},time);assert.equal(event.status,'cancelled');});
await test('source protocol, credentials and unapproved redirect are blocked',async()=>{assert.equal(safeUrl('javascript:alert(1)'),null);assert.equal(safeUrl('https://user:pass@www.uci.org/'),null);await assert.rejects(fetchPublic('https://www.uci.org/known',{attempts:1,allowedHosts:new Set(['www.uci.org']),fetchImpl:async()=>new Response('',{status:302,headers:{location:'https://127.0.0.1/admin'}})}),/outside/);});
await test('source response size is bounded',async()=>assert.rejects(fetchPublic('https://www.uci.org/known',{attempts:1,allowedHosts:new Set(['www.uci.org']),fetchImpl:async()=>new Response('large',{headers:{'content-length':String(9*1024*1024)}})}),/too large/));
await test('semantic hash excludes scripts/navigation',()=>assert.equal(semanticText('<main><nav>time1</nav><p>Rule one</p><script>dynamic()</script></main>'),'Rule one'));
const snapshot=await collectSchedule({config,fetchImpl:makeFetch(),now:new Date(time),attempts:1});
await test('full successful run sets actual complete calendar timestamp',()=>{assert.equal(snapshot.events.length,1);assert.equal(snapshot.refreshStatus,'ok');assert.equal(snapshot.lastSuccessfulCalendarCheckAt,time);assert.equal(snapshot.announcements[0].notify,false);});
await test('HTTP outage does not advance last successful calendar check or lose events',async()=>{const next=await collectSchedule({config,previous:snapshot,fetchImpl:async()=>new Response('offline',{status:503}),now:new Date('2026-10-31T12:00:00Z'),attempts:1});assert.equal(next.lastSuccessfulCalendarCheckAt,time);assert.equal(next.events[0].lastCheckedAt,time);assert.equal(next.refreshStatus,'partial');assert.equal(next.events.length,1);});
await test('changed qualification source creates review candidate without claiming revised rules',async()=>{
 const url='https://www.uci.org/rules';const c={...config,watchSources:[{url,kind:'qualification_news',title:'Official rules'}]};
 const first=await collectSchedule({config:c,fetchImpl:makeFetch({[url]:()=>new Response('<main>Old rules</main>')}),now:new Date(time),attempts:1});
 const next=await collectSchedule({config:c,previous:first,fetchImpl:makeFetch({[url]:()=>new Response('<main>New rules</main>')}),now:new Date('2026-10-31T12:00:00Z'),attempts:1});
 assert.equal(next.reviewCandidates.length,1);assert.equal(next.qualification.status,'revision_pending');assert.equal(next.announcements[0].notify,false);
 const again=await collectSchedule({config:c,previous:next,fetchImpl:makeFetch({[url]:()=>new Response('<main>New rules</main>')}),now:new Date('2026-11-01T12:00:00Z'),attempts:1});assert.equal(again.reviewCandidates.length,1);
});
await test('snapshot rejects dangerous event names and duplicate stable IDs',()=>{assert.throws(()=>validateSnapshot({...snapshot,events:[{...snapshot.events[0],name:'<img src=x>'}]}));assert.throws(()=>validateSnapshot({...snapshot,events:[snapshot.events[0],snapshot.events[0]]}));});
await test('unknown new qualification news is queued even on the first run',async()=>{
 const newsUrl='https://www.uci.org/api/news/listing?pageIndex=0&pageSize=50';const article='https://www.uci.org/pressrelease/new-la28-rules/newId';
 const next=await collectSchedule({config,fetchImpl:makeFetch({[newsUrl]:()=>Response.json({items:[{title:'BMX Freestyle LA28 qualification rules published',date:'2026-10-24T08:00:00Z',url:'/pressrelease/new-la28-rules/newId'}]}),[article]:()=>new Response('<main>Official new rules</main>')}),now:new Date(time),attempts:1});
 assert.equal(next.reviewCandidates.length,1);assert.equal(next.reviewCandidates[0].url,article);assert.equal(next.announcements[0].notify,false);
});
await test('first run fails closed if the official calendar is incomplete',async()=>assert.rejects(collectSchedule({config,fetchImpl:async()=>new Response('offline',{status:503}),now:new Date(time),attempts:1}),/Initial calendar/));
await test('malformed HTTP 200 calendar does not claim fresh success',async()=>{
 const url='https://www.uci.org/api/calendar/upcoming?discipline=BFR&year=2027';
 const next=await collectSchedule({config,previous:snapshot,fetchImpl:makeFetch({[url]:()=>Response.json({items:'broken'})}),now:new Date('2026-10-31T12:00:00Z'),attempts:1});
 assert.equal(next.lastSuccessfulCalendarCheckAt,time);assert.equal(next.sourceChecks.find(s=>s.url===url).status,'error');assert.equal(next.events.length,1);
});
await test('announced organiser identity absorbs its new UCI identity without duplicating it',()=>{
 const old=normalizeEvent(entry,detail,time);const current={...old,id:'organiser-2027-test',aliases:[old.id]};
 assert.equal(mergeEvents([current],[old],{complete:true,checkedAt:time}).length,1);
});
await test('unknown host-country marker does not discard the whole calendar',()=>assert.equal(calendarEntries(calendar([{...entry,country:'---'}])).length,1));
await test('snapshot rejects impossible dates from editorial configuration',()=>assert.throws(()=>validateSnapshot({...snapshot,events:[{...snapshot.events[0],startDate:'2027-02-31'}]})));
await test('UCI documents embedded in escaped JSON HTML are discovered without executing code',()=>{
 const doc='https://assets.ctfassets.net/space/file/LA28_BMX_Freestyle_Qualification.pdf';
 const input='<main><div data-props="'+JSON.stringify({html:'<a href="'+doc+'">BMX Freestyle</a>'}).replaceAll('"','&quot;')+'"></div></main>';
 assert.equal(embeddedDocumentLinks(input,'https://www.uci.org/',new Set(['assets.ctfassets.net']))[0].url,doc);
 assert.equal(embeddedDocumentLinks(input,'https://www.uci.org/',new Set(['www.uci.org'])).length,0);
});
await test('document discovery does not borrow a neighbouring item’s title',()=>{
 const docs=embeddedDocumentLinks(JSON.stringify([{title:'LA28 qualification webinar',url:'https://www.uci.org/Webinar.pdf'},{title:'2028 Q-Series qualification system',url:'https://www.uci.org/qualification.pdf'},{title:'BMX Racing regulations',url:'https://www.uci.org/part-VI.pdf'}]),'https://www.uci.org/',new Set(['www.uci.org']));
 assert.deepEqual(docs.map(d=>d.url),['https://www.uci.org/qualification.pdf']);
});
await test('committed source review resolves only the exact hash and survives refreshes',async()=>{
 const newsUrl='https://www.uci.org/api/news/listing?pageIndex=0&pageSize=50';const url='https://www.uci.org/new-bmx-rule';
 const feed=()=>Response.json({items:[{title:'BMX Freestyle qualification',date:time,url}]});
 const first=await collectSchedule({config,fetchImpl:makeFetch({[newsUrl]:feed,[url]:()=>new Response('<main>New rules</main>')}),now:new Date(time),attempts:1});
 const candidate=first.reviewCandidates[0];const reviewed={...config,reviewedSources:[{url,contentHash:candidate.contentHash,reviewedAt:time,outcome:'dismissed',note:'No eligibility or deadline change.'}]};
 const next=await collectSchedule({config:reviewed,previous:first,fetchImpl:makeFetch({[newsUrl]:feed,[url]:()=>new Response('<main>New rules</main>')}),now:new Date('2026-10-25T00:00:00Z'),attempts:1});
 assert.equal(next.reviewCandidates[0].status,'dismissed');
 const later=await collectSchedule({config:reviewed,previous:next,fetchImpl:makeFetch({[newsUrl]:feed,[url]:()=>new Response('<main>Changed again</main>')}),now:new Date('2026-10-26T00:00:00Z'),attempts:1});
 assert.equal(later.reviewCandidates.filter(c=>c.status==='pending').length,1);assert.notEqual(later.reviewCandidates.find(c=>c.status==='pending').id,candidate.id);
});
await test('document host/path hashes cannot masquerade as BMX Freestyle labels',()=>assert.equal(embeddedDocumentLinks('<a href="https://www.uci.org/randomBFRhash/Preliminary_provisions.pdf">Preliminary provisions</a>','https://www.uci.org/',new Set(['www.uci.org'])).length,0));
await test('a new organiser seed retains an already published UCI canonical ID',async()=>{
 const source='https://www.uci.org/organiser';const organiserId='organiser-2027-test';
 const seed={...snapshot.events[0],id:organiserId,uciId:null,sourceUrl:source,evidence:['Test Park'],matchUciName:'Test Park',sourceTitle:'Organiser announcement',status:'provisional'};
 const c={...config,events:[seed],watchSources:[{url:source,title:'Organiser',kind:'organiser'}]};
 const fetchImpl=makeFetch({[source]:()=>new Response('<main>Test Park</main>')});
 const next=await collectSchedule({config:c,previous:snapshot,fetchImpl,now:new Date('2026-10-25T00:00:00Z'),attempts:1});
 assert.equal(next.events.length,1);assert.equal(next.events[0].id,snapshot.events[0].id);assert(next.events[0].aliases.includes(organiserId));
 const again=await collectSchedule({config:c,previous:next,fetchImpl,now:new Date('2026-10-26T00:00:00Z'),attempts:1});
 assert.equal(again.events.length,1);assert.equal(again.events[0].id,snapshot.events[0].id);
});
await test('an existing organiser seed retains its canonical ID after UCI registration',async()=>{
 const source='https://www.uci.org/organiser';const organiserId='organiser-2027-test';
 const seed={...snapshot.events[0],id:organiserId,uciId:null,sourceUrl:source,evidence:['Test Park'],matchUciName:'Test Park',sourceTitle:'Organiser announcement',status:'provisional'};
 const previous={...snapshot,events:[seed]};
 const next=await collectSchedule({config:{...config,events:[seed],watchSources:[{url:source,title:'Organiser',kind:'organiser'}]},previous,fetchImpl:makeFetch({[source]:()=>new Response('<main>Test Park</main>')}),now:new Date('2026-10-25T00:00:00Z'),attempts:1});
 assert.equal(next.events.length,1);assert.equal(next.events[0].id,organiserId);assert(next.events[0].aliases.includes(snapshot.events[0].id));
});
await test('collector bounds match backend ingestion limits',()=>{
 assert.throws(()=>validateSnapshot({...snapshot,events:[{...snapshot.events[0],name:'x'.repeat(141)}]}),/event name/);
 assert.throws(()=>validateSnapshot({...snapshot,events:Array(501).fill(snapshot.events[0])}),/safety limit/);
 assert.throws(()=>validateSnapshot({...snapshot,announcements:Array(101).fill(snapshot.announcements[0])}),/safety limit/);
 assert.throws(()=>validateSnapshot({...snapshot,announcements:[{...snapshot.announcements[0],sourceUrl:'https://www.uci.org/'+ 'a'.repeat(1000)}]}),/official source/);
 assert.throws(()=>validateSnapshot({...snapshot,announcements:[{...snapshot.announcements[0],summary:'a'.repeat(1201)}]}),/metadata/);
});
console.log(`${passed} schedule importer checks passed`);
