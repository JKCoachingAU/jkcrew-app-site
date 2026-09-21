const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
let checks=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++;};
const photo='data:image/png;base64,photo-A', changed='data:image/png;base64,photo-B';
(async()=>{
 const calls=[],replies=[];
 const ctx={client:{rpc:async(name,args)=>{calls.push({name,args});const reply=replies.shift();return typeof reply==='function'?reply(name,args):reply;}},withTimeout:p=>p,document:{hidden:false}};
 vm.createContext(ctx);vm.runInContext('const liveRunLegacyRpc = new Set();'+extract('compactLiveRunRequest')+'\n'+extract('liveRunPollDue'),ctx);
 const l={},args={p_request_id:'stable-operation',p_ops:[{op:'set',key:'title',before:'a',value:'b'}]};
 const request=(holder=l)=>ctx.compactLiveRunRequest('live_run_edit',args,holder,'Editing');
 replies.push({data:{draft:{title:'a',imageDataUrl:photo},image_key:'key-A',image_omitted:false}});
 let r=await request();eq(calls.at(-1).args.p_image_key,null);eq(r.draft.imageDataUrl,photo);eq(l.imageCache.value,photo);
 replies.push({data:{draft:{title:'b'},image_key:'key-A',image_omitted:true}});
 r=await request();eq(calls.at(-1).args.p_image_key,'key-A');eq(r.draft.imageDataUrl,photo,'Matching cache restores photo for the unchanged merge algorithm');
 replies.push({data:{draft:{title:'b',imageDataUrl:changed},image_key:'key-B',image_omitted:false}});
 r=await request();eq(r.draft.imageDataUrl,changed);eq(l.imageCache.key,'key-B');
 // Cache ownership is per live session, never an unbounded global photo cache.
 replies.push({data:{draft:{title:'other',imageDataUrl:photo},image_key:'key-A',image_omitted:false}});
 await request({});eq(calls.at(-1).args.p_image_key,null,'A second call cannot advertise the first call photo');
 // In-flight requests must hydrate from exactly the cache offered by THAT read.
 let release;
 replies.push(()=>new Promise(resolve=>release=resolve));const pending=request();
 replies.push({data:{draft:{title:'new',imageDataUrl:photo},image_key:'key-A',image_omitted:false}});
 await request();eq(l.imageCache.key,'key-A');
 release({data:{draft:{title:'older response'},image_key:'key-B',image_omitted:true}});
 r=await pending;eq(r.draft.imageDataUrl,changed,'Out-of-order reply cannot borrow newer photo');
 replies.push({data:{draft:{title:'bad'},image_key:'unknown',image_omitted:true}});
 await assert.rejects(request,/photo needs to reload/);checks++;
 replies.push({data:{draft:{title:'missing'},image_key:'bad-full',image_omitted:false}});
 await assert.rejects(request,/photo could not be loaded/);checks++;
 const beforeNetwork=calls.length;
 replies.push({error:{code:'NETWORK',message:'Disconnected'}});await assert.rejects(request,e=>e.code==='NETWORK');checks++;
 eq(calls.length,beforeNetwork+1,'Network failure never retries a mutation with the legacy API');
 replies.push({error:{code:'42501',message:'Private'}});await assert.rejects(request,e=>e.code==='42501');checks++;
 replies.push({error:{code:'42883',message:'function other_internal_function does not exist'}});await assert.rejects(request,e=>e.code==='42883');checks++;
 // Rolling deployment falls back only when the actual new endpoint is missing.
 replies.push({error:{code:'PGRST202',message:'Could not find function public.live_run_edit_compact'}});
 replies.push({data:{draft:{title:'legacy',imageDataUrl:photo}}});r=await request();
 eq(r.draft.imageDataUrl,photo);eq(calls.at(-1).name,'live_run_edit');eq(calls.at(-1).args,args,'Fallback preserves exact receipt and operations');
 replies.push({data:{draft:{title:'legacy again',imageDataUrl:photo}}});await request();eq(calls.at(-1).name,'live_run_edit','Missing endpoint checked only once this page session');
 const visible={connected:true,lastPoll:10000};eq(ctx.liveRunPollDue(visible,14999),false);eq(ctx.liveRunPollDue(visible,15000),true);
 eq(ctx.liveRunPollDue({...visible,connected:false},12000),true,'Dropped subscription keeps a short fallback');
 eq(ctx.liveRunPollDue({...visible,lastPoll:0},10001),true,'Realtime invalidation refreshes on next 300ms tick');
 ctx.document.hidden=true;eq(ctx.liveRunPollDue({...visible,lastPoll:0},90000),false,'Hidden tab does not poll');ctx.document.hidden=false;
 let oldLast=0,newLast=0,oldCount=0,newCount=0;
 for(let now=100000;now<160000;now+=300){if(now-oldLast>900){oldLast=now;oldCount++;}if(ctx.liveRunPollDue({connected:true,lastPoll:newLast},now)){newLast=now;newCount++;}}
 eq(oldCount,50);eq(newCount,12);
 console.log(`PASS ${checks} client transport checks; identical 60-second idle timeline: ${oldCount} -> ${newCount} metadata polls, hidden tab 0, Realtime changes refresh on next tick. Photo changes, reordered ACKs, isolated caches and safe old-server fallback preserved.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
