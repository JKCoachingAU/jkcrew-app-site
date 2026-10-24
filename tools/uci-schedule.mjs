#!/usr/bin/env node
// Public-source collector. It never turns a changed page into an Olympic rule or sends push.
// Reviewed editorial facts live in uci-schedule-sources.json; changes become review candidates.
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const YEAR = 2027;
export const CALENDAR_URL = 'https://www.uci.org/calendar/bmx-freestyle/4WGZkr6dpiPqaSTfbuTb2v?discipline=BFR';
const API = 'https://www.uci.org/api';
const MAX_BYTES = 8 * 1024 * 1024;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const clean = value => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const must = (condition, message) => { if (!condition) throw new Error(message); };
export const hash = value => createHash('sha256').update(value).digest('hex');
export function decodeHtml(value) {
  return String(value).replace(/&(?:quot|apos|amp|lt|gt|nbsp|#\d+|#x[0-9a-f]+);/gi, entity => {
    const named = { '&quot;':'"', '&apos;':"'", '&amp;':'&', '&lt;':'<', '&gt;':'>', '&nbsp;':' ' };
    if (named[entity]) return named[entity];
    const number = entity.startsWith('&#x') ? parseInt(entity.slice(3,-1),16) : parseInt(entity.slice(2,-1),10);
    return Number.isInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  });
}
export function semanticText(html) {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] || html;
  return clean(decodeHtml(main.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g,' ')));
}
export function embeddedDocumentLinks(html, baseUrl, allowedHosts) {
  // UCI places document tabs inside nested JSON/HTML attributes; no script execution is needed.
  let decoded=String(html);
  for(let i=0;i<4;i++) decoded=decodeHtml(decoded.replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replaceAll('\\/','/').replaceAll('\\"','"'));
  const documents=new Map();
  for(const match of decoded.matchAll(/(?:https:)?\/\/[^\s"'<>\\]+?\.pdf(?:\?[^\s"'<>\\]*)?/gi)) {
    const url=safeUrl(new URL(match[0],baseUrl).href,allowedHosts);
    const before=decoded.slice(Math.max(0,match.index-600),match.index);
    const after=decoded.slice(match.index+match[0].length,match.index+match[0].length+400);
    const jsonTitle=/["']title["']\s*:\s*["']([^"']+)["']\s*,\s*["']url["']\s*:\s*["']$/.exec(before)?.[1];
    const anchorTitle=/^["'][^>]*>([\s\S]{0,240}?)<\/a>/i.exec(after)?.[1];
    const title=clean(jsonTitle||semanticText(anchorTitle||''));
    // Use this document's own label, never text from the next item (e.g. an unrelated webinar).
    if(url && /freestyle|qualifier.series|q.series|6bis|BFR|BMF/i.test(`${new URL(url).pathname.split('/').at(-1)} ${title}`)) documents.set(url,title||'Official BMX Freestyle / LA28 document');
  }
  return [...documents].map(([url,title])=>({url,title}));
}
export function safeUrl(value, allowedHosts = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || (allowedHosts && !allowedHosts.has(url.hostname))) return null;
    return url.href;
  } catch { return null; }
}
export function parseDates(value, year = YEAR) {
  const pieces = clean(value).split(/\s+-\s+/);
  must(pieces.length <= 2, `Unrecognised UCI date range: ${value}`);
  const trailing = /\b(20\d{2})$/.exec(pieces.at(-1))?.[1];
  const dates = pieces.map(piece => {
    const match = /^(\d{1,2}) ([A-Za-z]{3})(?: (20\d{2}))?$/.exec(piece);
    must(match, `Unrecognised UCI date: ${piece}`);
    const month = MONTHS.indexOf(match[2]); const y = Number(match[3] || trailing);
    const date = `${y}-${String(month+1).padStart(2,'0')}-${match[1].padStart(2,'0')}`;
    must(month >= 0 && y === year && new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) === date, 'Invalid calendar date');
    return date;
  });
  must(dates[0] <= dates.at(-1), 'Calendar dates run backwards');
  return { startDate: dates[0], endDate: dates.at(-1) };
}
export function calendarEntries(document) {
  must(document && Array.isArray(document.items), 'UCI calendar format changed');
  const rows = new Map();
  for (const month of document.items) for (const day of month.items || []) for (const entry of day.items || []) {
    const link = entry.detailsLink?.url;
    if (!new RegExp(`^/competition-details/${YEAR}/BFR/\\d+$`).test(link || '')) continue;
    must(entry.name && /^(?:[A-Z]{3}|---)$/.test(entry.country || '') || (entry.name && !entry.country), 'UCI event identity is invalid');
    if (rows.has(link)) must(JSON.stringify(rows.get(link)) === JSON.stringify(entry), 'Conflicting duplicate calendar rows');
    rows.set(link, entry);
  }
  return [...rows.values()];
}
export function parseDetail(html) {
  const attributes = [...html.matchAll(/<[^>]+data-component=["']CompetitionDetailsModule["'][^>]*>/g)];
  must(attributes.length === 1, 'UCI event details unavailable');
  const props = /data-props="([^"]+)"/.exec(attributes[0][0]);
  must(props, 'UCI details format changed');
  const detail = JSON.parse(decodeHtml(props[1]));
  must(detail.competitionDetails?.name && Array.isArray(detail.schedule?.items), 'UCI detail schedule is invalid');
  return detail;
}
export function normalizeEvent(entry, detail, checkedAt) {
  const info = detail.competitionDetails;
  const races = detail.schedule.items.flatMap(item => item.races || []).filter(race => race.raceType === 'Park');
  if (!races.length) return null; // Flatland has a separate ranking and is not the Olympic discipline.
  let classification = clean(info.competitionClass).split(' - ')[0];
  if (classification === '1') classification = 'C1';
  if (classification === '2') classification = 'C2';
  must(['C1','C2','HC','CDM','CN','CC','CM','JR'].includes(classification), `Unknown UCI class: ${classification}`);
  let eligibleNationalities = ['GER','AUS'];
  let eligibilityNote = 'German and Australian sporting nationalities may enter, subject to the organiser’s licence, age, entry and capacity conditions. Entry is not guaranteed.';
  if (classification === 'CN') {
    if (!['GER','AUS'].includes(entry.country)) return null;
    eligibleNationalities = [entry.country];
    eligibilityNote = 'National-championship points require this country’s UCI sporting nationality. Federation selection and licence rules apply.';
  } else if (classification === 'CC') {
    eligibleNationalities = entry.continentCode === 'EUR' ? ['GER'] : entry.continentCode === 'OCE' ? ['AUS'] : [];
    if (!eligibleNationalities.length) return null;
    eligibilityNote = 'Continental-championship points require the relevant UCI sporting nationality. National-federation selection and entry rules apply.';
  } else if (classification === 'JR') {
    // Regional Games have bespoke nationality and selection rules; do not infer eligibility from the host continent.
    return null;
  } else if (classification === 'CM') eligibilityNote = 'German and Australian riders are eligible through their national federation, subject to selection and the published entry quotas.';
  const sourceUrl = `https://www.uci.org${entry.detailsLink.url}`;
  const id = `uci-bfr-${YEAR}-${entry.detailsLink.url.split('/').at(-1)}`;
  const cancelled = /\b(cancelled|canceled)\b/i.test(info.name) || info.status === 'Cancelled' || info.isCancelled === true;
  return {
    id, uciId: entry.detailsLink.url.split('/').at(-1), name: clean(info.name), ...parseDates(info.dates || entry.dates),
    venue: clean(info.venue || entry.venue || 'To be confirmed'), country: clean(info.country || entry.country || 'To be confirmed'),
    countryCode: clean(entry.country), discipline: 'Park', classification, classificationStatus: 'confirmed',
    status: cancelled ? 'cancelled' : 'confirmed', dateStatus: 'calendar_dates', eligibilityStatus: 'conditional',
    eligibleNationalities, categories: [...new Set(races.map(race => clean(race.category)))].sort(), eligibilityNote,
    registration: { status:'pending', url:safeUrl(info.website?.url), email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email?.title || '') ? info.email.title : null,
      deadline:null, note:'Entry form, deadline and the final 2027 technical guide have not been verified. The link/contact is the organiser listed by UCI.' },
    rankingPoints: { status:'uci_listed', note:'Listed on the UCI international calendar. Ranking points depend on the applicable UCI rules, eligible category and result; this is not confirmation of Olympic qualification points.' },
    olympicQualification: { status:'pending_rules', note:'Do not treat general UCI world-ranking points as direct LA28 qualification points. The revised BMX Freestyle pathway remains to be checked against the official rules.' },
    sourceUrl, sources:[{url:sourceUrl,title:'UCI event listing',checkedAt}], checkedAt,lastCheckedAt:checkedAt,lastVerifiedAt:checkedAt, changes:[],
  };
}

export async function fetchPublic(url, { fetchImpl = fetch, allowedHosts, attempts = 2 } = {}) {
  must(safeUrl(url, allowedHosts), 'Unapproved public source URL');
  let error;
  for (let attempt=0; attempt<attempts; attempt++) {
    try {
      let current = url;
      for (let redirects=0; redirects<4; redirects++) {
        const response = await fetchImpl(current,{redirect:'manual',headers:{Accept:'application/json,text/html,application/pdf','User-Agent':'JKCREW-official-calendar/1.0'},signal:AbortSignal.timeout(25000)});
        if ([301,302,303,307,308].includes(response.status)) {
          const next = new URL(response.headers.get('location'),current).href;
          must(safeUrl(next,allowedHosts), 'Source redirected outside the approved hosts'); current = next; continue;
        }
        must(response.ok, `Official source returned HTTP ${response.status}`);
        must(Number(response.headers.get('content-length') || 0) <= MAX_BYTES, 'Official source is too large');
        const reader = response.body.getReader(); const chunks=[]; let length=0;
        while (true) {
          const {done,value}=await reader.read(); if(done) break;
          length+=value.length; if(length>MAX_BYTES) { await reader.cancel(); throw new Error('Official source is too large'); } chunks.push(value);
        }
        must(length>0,'Official source is empty');
        const bytes=Buffer.concat(chunks); return {bytes,text:bytes.toString('utf8'),url:current,contentType:response.headers.get('content-type')||''};
      }
      throw new Error('Too many official-source redirects');
    } catch (e) {error=e; if(attempt+1<attempts) await new Promise(done=>setTimeout(done,350));}
  }
  throw error;
}
const compareFields=['name','startDate','endDate','venue','country','classification','categories','eligibleNationalities','status','registration'];
export function mergeEvents(current, previous = [], {complete=true,checkedAt}) {
  const old=new Map(previous.map(event=>[event.id,event])); const seen=new Set(); const merged=[];
  for(const event of current) {
    seen.add(event.id);for(const alias of event.aliases||[])seen.add(alias);
    const prior=old.get(event.id)||(event.aliases||[]).map(alias=>old.get(alias)).find(Boolean);
    event.changes=[...(prior?.changes || [])];
    if(prior) for(const field of compareFields) if(JSON.stringify(prior[field])!==JSON.stringify(event[field])) {
      event.changes.push({field,previous:prior[field]??null,current:event[field]??null,detectedAt:checkedAt});
    }
    event.changes=event.changes.slice(-30); merged.push(event);
  }
  for(const prior of previous) if(!seen.has(prior.id)) {
    if(!complete || !prior.uciId) merged.push({...prior});
    else merged.push({...prior,status:prior.status==='cancelled'?'cancelled':'review_required',listingMissingSince:prior.listingMissingSince||checkedAt,
      reviewNote:'This event is no longer in the latest UCI listing. Cancellation has not been confirmed. Existing calendar details are retained.'});
  }
  return merged.sort((a,b)=>(a.startDate||'9999').localeCompare(b.startDate||'9999')||a.name.localeCompare(b.name));
}
export function validateSnapshot(snapshot) {
  must(snapshot.schemaVersion===1 && snapshot.year===YEAR && Array.isArray(snapshot.events),'Unsupported schedule snapshot');
  must(Number.isFinite(Date.parse(snapshot.checkedAt)),'Invalid schedule check time');
  must(Array.isArray(snapshot.announcements) && snapshot.events.length<=500 && snapshot.announcements.length<=100,'Schedule exceeds safety limit');
  const ids=new Set();
  for(const event of snapshot.events) {
    must(/^[a-z0-9][a-z0-9-]{4,100}$/.test(event.id)&&!ids.has(event.id),'Invalid/duplicate schedule event ID');ids.add(event.id);
    must(clean(event.name).length>=3 && event.name.length<=140 && !/[<>]/.test(event.name),'Invalid event name');
    must(safeUrl(event.sourceUrl),'Invalid official event URL');
    must(['confirmed','provisional','cancelled','review_required'].includes(event.status),'Invalid event status');
    must(['confirmed','calendar_dates','provisional','pending','unconfirmed'].includes(event.dateStatus),'Invalid date status');
    must(Array.isArray(event.categories) && Array.isArray(event.sources) && event.sources.length>0 && event.sources.every(source=>safeUrl(source.url)),'Invalid event categories/sources');
    must(Array.isArray(event.eligibleNationalities)&&event.eligibleNationalities.every(n=>['GER','AUS'].includes(n)),'Invalid eligible nationality');
    for(const key of ['startDate','endDate']) {
      const value=event[key];
      must(value===null || (/^2027-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value),'Invalid event date');
    }
    must(event.startDate===null || (event.endDate && event.startDate<=event.endDate),'Invalid event range');
    must(event.olympicQualification?.status !== 'confirmed' || event.olympicQualification?.sourceUrl,'Olympic confirmation requires a reviewed rule source');
  }
  for(const announcement of snapshot.announcements){
    const source=safeUrl(announcement.sourceUrl);
    must(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{2,119}$/.test(announcement.id||'') && typeof announcement.title==='string' && announcement.title.length>=3 && announcement.title.length<=160 && typeof announcement.summary==='string' && announcement.summary.length>=3 && announcement.summary.length<=1200,'Invalid announcement metadata');
    must(source && /(^|\.)(uci\.org|olympics\.com|olympic\.org|la28\.org)$/.test(new URL(source).hostname) && Buffer.byteLength(announcement.sourceUrl)<=1000,'Invalid announcement official source');
    must(['verifiedAt','publishedAt'].every(key=>Number.isFinite(Date.parse(announcement[key])) && Date.parse(announcement[key])<=Date.parse(snapshot.checkedAt)+600000),'Invalid announcement evidence date');
  }
  return snapshot;
}

export async function collectSchedule({config,previous=null,fetchImpl=fetch,now=new Date(),attempts=2}={}) {
  must(config?.schemaVersion===1,'Official-source configuration is missing');
  const checkedAt=now.toISOString();
  const allowedHosts=new Set(config.allowedHosts);
  const sourceChecks=new Map((previous?.sourceChecks||[]).map(check=>[check.url,{...check}]));
  const candidates=new Map((previous?.reviewCandidates||[]).map(candidate=>[candidate.id,candidate]));
  const reviewedSources=new Map();
  for(const review of config.reviewedSources||[]){
    must(safeUrl(review.url,allowedHosts) && /^[a-f0-9]{64}$/.test(review.contentHash) && Number.isFinite(Date.parse(review.reviewedAt)) && ['dismissed','published'].includes(review.outcome),'Invalid reviewed source record');
    reviewedSources.set(`${review.url}:${review.contentHash}`,review);
  }
  function applyReview(candidate){
    const review=reviewedSources.get(`${candidate.url}:${candidate.contentHash}`);
    return review?{...candidate,status:review.outcome,reviewedAt:review.reviewedAt,reviewNote:clean(review.note).slice(0,1500)}:candidate;
  }
  let failures=0;const attemptedSources=new Set();
  async function read(url,kind,{review=false,title=url,baseline=false}={}) {
    attemptedSources.add(url);const old=sourceChecks.get(url);
    try {
      const result=await fetchPublic(url,{fetchImpl,allowedHosts,attempts});
      const contentHash=hash(result.contentType.includes('pdf')||url.endsWith('.pdf') ? result.bytes : `${semanticText(result.text)}\n${embeddedDocumentLinks(result.text,url,allowedHosts).map(d=>d.url).sort().join('\n')}`);
      sourceChecks.set(url,{url,title,kind,status:'ok',checkedAt,lastSuccessfulCheckAt:checkedAt,contentHash});
      if(review && ((old?.contentHash && old.contentHash!==contentHash) || (!old && !baseline))) {
        const id=`source-${hash(`${url}:${contentHash}`).slice(0,32)}`;
        candidates.set(id,{id,url,title,kind,contentHash,detectedAt:checkedAt,status:'pending',reason:old?'Official source content changed; the meaning and deadlines need verification.':'New official source found; verify its meaning before publishing any qualification claim or notification.'});
      }
      return {...result,contentHash};
    } catch(error) {
      failures++; sourceChecks.set(url,{...old,url,title,kind,status:'error',checkedAt,lastSuccessfulCheckAt:old?.lastSuccessfulCheckAt||null,error:clean(error.message).slice(0,200)}); throw error;
    }
  }
  function parseFailure(url,error){failures++;const old=sourceChecks.get(url);sourceChecks.set(url,{...old,status:'error',error:clean(error.message).slice(0,200),lastSuccessfulCheckAt:previous?.sourceChecks?.find(s=>s.url===url)?.lastSuccessfulCheckAt||null});}
  const current=[];let calendarComplete=true;const entries=new Map();
  for(const period of ['upcoming','past']) {
    const url=`${API}/calendar/${period}?discipline=BFR&year=${YEAR}`;
    try { const result=await read(url,'calendar'); const rows=calendarEntries(JSON.parse(result.text)); rows.forEach(row=>entries.set(row.detailsLink.url,row)); }
    catch(error) { calendarComplete=false;if(sourceChecks.get(url)?.status==='ok')parseFailure(url,error); }
  }
  // A blank successful response must never remove the entire published season.
  if(entries.size===0) calendarComplete=false;
  const queue=[...entries.values()];
  await Promise.all(Array.from({length:4},async()=>{
    while(queue.length){const entry=queue.shift();try{
      const result=await read(`https://www.uci.org${entry.detailsLink.url}`,'event');
      const event=normalizeEvent(entry,parseDetail(result.text),checkedAt);if(event)current.push(event);
    }catch(error){calendarComplete=false;const url=`https://www.uci.org${entry.detailsLink.url}`;if(sourceChecks.get(url)?.status==='ok')parseFailure(url,error);}}
  }));
  // Editorial organiser facts are only refreshed while their reviewed evidence still matches.
  const watchResults=new Map();
  for(const source of config.watchSources) {
    try{watchResults.set(source.url,await read(source.url,source.kind,{review:true,title:source.title,baseline:!previous}));}
    catch{/* Keep prior facts and expose the unsuccessful source check. */}
  }
  for(const seed of config.events) {
    const prior=previous?.events?.find(event=>event.id===seed.id || event.aliases?.includes(seed.id));
    const result=watchResults.get(seed.sourceUrl);
    const verified=Boolean(result && seed.evidence.every(pattern=>new RegExp(pattern,'i').test(semanticText(result.text))));
    const {evidence,...fields}=seed;
    const mappedId=current.find(event=>(prior?.uciId && event.uciId===prior.uciId) || (seed.matchUciName && new RegExp(seed.matchUciName,'i').test(event.name) && event.countryCode===seed.countryCode))?.id;
    if(mappedId){
      // Preserve whichever ID was published first: database/calendar links key off this ID.
      const i=current.findIndex(event=>event.id===mappedId);
      const published=prior || previous?.events?.find(event=>event.id===mappedId || event.uciId===current[i].uciId || event.aliases?.includes(mappedId));
      const id=published?.id||seed.id;
      const aliases=[...new Set([...(published?.aliases||[]),mappedId,seed.id])].filter(alias=>alias!==id).sort();
      current[i]={...current[i],id,aliases};continue;
    }
    if(prior?.uciId){
      current.push({...prior,...(calendarComplete?{status:'review_required',reviewNote:'The linked UCI event is no longer in the latest calendar. Last verified details are retained; cancellation is not confirmed.'}:{})});continue;
    }
    current.push({...fields,checkedAt:verified?checkedAt:prior?.checkedAt||config.verifiedAt,lastCheckedAt:result?checkedAt:prior?.lastCheckedAt||config.verifiedAt,
      lastVerifiedAt:verified?checkedAt:prior?.lastVerifiedAt||config.verifiedAt,status:verified?fields.status:'review_required',
      sources:[{url:seed.sourceUrl,title:seed.sourceTitle,checkedAt:result?checkedAt:prior?.lastCheckedAt||config.verifiedAt}],
      changes:[],...(!verified?{reviewNote:result?'The organiser page changed. Published details are retained pending review.':'The organiser source could not be checked. Last verified details are retained.'}:{})});
  }
  for(const override of config.eventOverrides || []) {
    const index=current.findIndex(event=>event.id===override.id);if(index<0)continue;
    const result=watchResults.get(override.sourceUrl); const matches=result?.contentHash===override.sourceHash;
    // Programme PDFs require a reviewed hash; automated text extraction must not guess chart dates.
    const old=previous?.events?.find(event=>event.id===override.id);
    if(matches) current[index]={...current[index],...override.fields,sources:[...current[index].sources,{url:override.sourceUrl,title:override.title,checkedAt}],lastVerifiedAt:checkedAt};
    else current[index]={...current[index],...(old?{startDate:old.startDate,endDate:old.endDate}:override.fields),status:'review_required',reviewNote:'The organiser’s detailed programme needs review. The last verified Park dates are retained.'};
  }
  // Poll UCI's public news listing, including generic cycling qualification announcements.
  for(let pageIndex=0;pageIndex<12;pageIndex++) {
    const url=`${API}/news/listing?pageIndex=${pageIndex}&pageSize=50`;
    try{
      const response=await read(url,'news_index'); const news=JSON.parse(response.text); must(Array.isArray(news.items),'UCI news format changed');
      let oldPage=true;
      for(const item of news.items){
        const publishedAt=Date.parse(item.date); if(publishedAt>=now.getTime()-60*86400000)oldPage=false;
        if(!/(bmx.freestyle|urban.cycling|(?:olympic|los.angeles|la.?28).*(?:qualif|quota)|qualif.*(?:olympic|la.?28))/i.test(item.title||''))continue;
        const articleUrl=safeUrl(new URL(item.url,'https://www.uci.org').href,allowedHosts);if(!articleUrl)continue;
        if(publishedAt<now.getTime()-60*86400000 && !sourceChecks.has(articleUrl))continue;
        try{await read(articleUrl,'qualification_news',{review:true,title:clean(item.title),baseline:config.watchSources.some(s=>s.url===articleUrl)});}catch{}
      }
      if(oldPage||news.items.length<50)break;
      if(pageIndex===11)parseFailure(url,new Error('UCI news pagination limit reached; further announcements need review')); 
    }catch(error){if(sourceChecks.get(url)?.status==='ok')parseFailure(url,error);break;}
  }
  // Hub document links reveal replacement PDFs, even when the surrounding announcement is unchanged.
  for(const source of config.watchSources.filter(s=>s.discoverDocuments)){
    const result=watchResults.get(source.url);if(!result)continue;
    const docs=new Map(embeddedDocumentLinks(result.text,source.url,allowedHosts).map(doc=>[doc.url,doc.title]));
    for(const [url,title] of [...docs].slice(0,20))try{await read(url,'qualification_document',{review:true,title,baseline:config.watchSources.some(s=>s.url===url)});}catch{}
  }
  must(previous || calendarComplete,'Initial calendar fetch incomplete; no snapshot published');
  const events=mergeEvents(current,previous?.events||[],{complete:calendarComplete,checkedAt});
  const qualification={...config.qualification,checkedAt:watchResults.has(config.qualification.sourceUrl)?checkedAt:previous?.qualification?.checkedAt||config.verifiedAt};
  return validateSnapshot({schemaVersion:1,year:YEAR,checkedAt,lastSuccessfulCalendarCheckAt:calendarComplete?checkedAt:previous?.lastSuccessfulCalendarCheckAt||null,
    refreshStatus:calendarComplete&&failures===0?'ok':'partial',calendarEventCount:entries.size,events,qualification,
    announcements:config.announcements,reviewCandidates:[...candidates.values()].map(applyReview),sourceChecks:[...sourceChecks.values()].filter(source=>attemptedSources.has(source.url)),
    sourceNotes:'Calendar fields refresh automatically from UCI. Organiser and qualification changes require evidence review before changing eligibility, Olympic rules or sending notifications.'});
}
export async function updateSchedule(output,options={}) {
  let previous=null;try{previous=JSON.parse(await readFile(output,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const config=options.config||JSON.parse(await readFile(new URL('../data/uci-schedule-sources.json',import.meta.url),'utf8'));
  const snapshot=await collectSchedule({...options,config,previous});
  must(snapshot.events.length>0,'Refusing to publish an empty schedule');
  await mkdir(dirname(output),{recursive:true});const temporary=`${output}.${process.pid}.tmp`;
  try{await writeFile(temporary,`${JSON.stringify(snapshot,null,2)}\n`);await rename(temporary,output);}finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return snapshot;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const output=resolve(process.argv[2]||'data/uci-schedule.json');const snapshot=await updateSchedule(output);console.log(JSON.stringify({output,events:snapshot.events.length,refreshStatus:snapshot.refreshStatus,checkedAt:snapshot.checkedAt,pendingReviews:snapshot.reviewCandidates.filter(c=>c.status==='pending').length}));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
