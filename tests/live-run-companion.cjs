const assert = require('node:assert/strict');
const { create } = require('../live-run-companion.js');
let time = 0, token = 0, checks = 0;
const queue = [], delivered = [], output = {coach:[],rider:[]}, followed = [];
const contexts = {coach:{scene:'course',run:'route',points:['dot-a','dot-b'],duration:60},rider:{scene:'course',run:'route',points:['dot-a','dot-b'],duration:60}};
const peers = {};
for (const id of ['coach','rider']) peers[id] = create({ sessionId:'session', userId:id, peerId:id==='coach'?'rider':'coach', coachId:'coach',
  send:m => { queue.push({to:id==='coach'?'rider':'coach',m:structuredClone(m)}); return true; },
  context:() => contexts[id], now:() => time, token:() => `token-${++token}`, onPlayback:p => output[id].push(p), onSelection:p => followed.push([id,p]) });
function pump(){let loops=0;while(queue.length){assert(++loops<100,'Handshake cannot loop indefinitely');const next=queue.shift();delivered.push(next);peers[next.to].receive(next.m);}}
function check(test, text){assert(test,text);checks++;}
peers.coach.connect(true);peers.rider.connect(true);pump();
check(peers.coach.inspect().ready && peers.rider.inspect().ready,'Two separate peers complete handshake');
const originalContexts = structuredClone(contexts);
peers.coach.setPointing(true);check(peers.coach.point(25,75),'Explicit pointing sends one small message');pump();
check(peers.rider.inspect().pointer.x===25,'Remote pointer appears at photo coordinate');
check(!peers.coach.point(26,76),'Pointer packets throttled to at most 12.5 per second');
check(!peers.coach.point(-1,50) && !peers.coach.point(50,101),'Out-of-bounds coordinates rejected');
time+=1900;peers.rider.tick();check(!peers.rider.inspect().pointer,'Pointer fades without needing another packet');
peers.coach.select('dot-b');pump();check(peers.rider.inspect().selection==='dot-b','Remote selected dot is visible');
check(!followed.length,'Selection does not move peer unless they opt in');
peers.rider.follow(true);check(followed.at(-1)[1]==='dot-b','Follow coach applies current selected dot');
peers.coach.follow(true);check(!peers.coach.inspect().following,'Only rider follows coach');
peers.rider.follow(false);const beforeFollow=followed.length;peers.coach.select('dot-a');pump();check(followed.length===beforeFollow,'Follow coach can be switched off');
check(!peers.coach.select('unknown-dot'),'Unknown dot rejected');
peers.coach.requestWatch(true);pump();check(peers.rider.inspect().peerWanted && !peers.rider.inspect().watching,'Invitation cannot start playback without consent');
peers.rider.requestWatch(false);pump();check(!peers.coach.inspect().wanted,'Decline returns caller to independent playback');
peers.rider.requestWatch(true);pump();peers.coach.requestWatch(true);pump();
check(peers.coach.inspect().watching && peers.rider.inspect().watching,'Either participant can invite; both must agree');
peers.rider.control({seconds:12,playing:true});pump();time+=2000;
check(peers.coach.inspect().playback.seconds===14 && peers.rider.inspect().playback.seconds===14,'Both peers advance together independently of wall-clock offsets');
peers.coach.control({seconds:23,playing:false});pump();time+=1000;
check(peers.rider.inspect().playback.seconds===23 && !peers.rider.inspect().playback.playing,'Coach pause/scrub reaches rider');
check(!peers.rider.control({seconds:61,playing:false}),'Seek outside run duration rejected');
// Simultaneous requests converge by Lamport counter and stable participant id.
peers.coach.control({seconds:7,playing:true});peers.rider.control({seconds:31,playing:false});pump();
check(JSON.stringify(peers.coach.inspect().playback)===JSON.stringify(peers.rider.inspect().playback),'Concurrent playback actions converge deterministically');
const oldPacket=delivered.filter(x=>x.m.kind==='playback').at(-1);
check(!peers[oldPacket.to].receive(oldPacket.m),'Duplicate/out-of-order packet ignored');
peers.coach.control({seconds:59,playing:true});pump();time+=3000;
check(peers.rider.inspect().playback.seconds===60 && !peers.rider.inspect().playback.playing,'Playback stops exactly at run end');
// Controller sends a position heartbeat to correct drift after a background interval.
peers.coach.tick();pump();check(peers.rider.inspect().playback.seconds===60,'Position heartbeat corrects remote progress');
peers.rider.requestWatch(false);pump();check(!peers.coach.inspect().watching,'Either participant can return to independent playback');
peers.coach.requestWatch(true);pump();peers.rider.requestWatch(true);pump();
contexts.rider.run='new-route';peers.rider.tick();pump();check(!peers.coach.inspect().watching,'A route edit pauses shared playback without replacing draft');
peers.coach.requestWatch(true);pump();check(!peers.coach.inspect().wanted && peers.rider.inspect().status.includes('same run'),'Different route versions cannot play misleadingly together');
contexts.rider.run='route';peers.rider.tick();
peers.coach.requestWatch(true);pump();peers.rider.requestWatch(true);pump();peers.coach.control({seconds:10,playing:true});pump();
peers.coach.connect(false);peers.rider.connect(false);
check(!peers.coach.inspect().watching && !peers.rider.inspect().watching,'Network loss pauses shared playback on both devices');
peers.coach.connect(true);peers.rider.connect(true);pump();
check(peers.coach.inspect().ready && peers.rider.inspect().ready,'Tools reconnect with fresh connection epochs');
check(!peers[oldPacket.to].receive({...oldPacket.m,seq:9999}),'Packets from an old connection cannot replay');
check(!peers.coach.inspect().watching && !peers.rider.inspect().watching,'Reconnect never silently restarts playback');
const valid=delivered.filter(x=>x.to==='rider' && x.m.kind==='hello').at(-1).m;
check(!peers.rider.receive({...valid,session:'other-session'}),'Cross-session messages rejected');
check(!peers.rider.receive({...valid,v:99}),'Unknown protocol versions rejected');
check(!peers.rider.receive({...valid,extra:'x'.repeat(1900)}),'Oversized payload rejected');
assert.deepEqual(contexts,originalContexts);checks++;
check(delivered.every(x=>JSON.stringify(x.m).length<650),'All coaching traffic is metadata only, below 650 bytes in test');
// The authoritative route can arrive between the 250ms presence ticks.
// A matching invitation is already proof of the current route, not stale state.
contexts.coach.run = 'freshly-synced'; contexts.rider.run = 'freshly-synced';
peers.coach.requestWatch(true); pump();
check(peers.rider.inspect().peerWanted,'Invitation for a freshly synced route is offered immediately');
peers.rider.tick(); pump();
check(peers.rider.inspect().peerWanted && peers.coach.inspect().wanted,'Presence tick must not cancel a valid invitation accepted before its context catch-up');
peers.rider.requestWatch(true); pump();
check(peers.coach.inspect().watching && peers.rider.inspect().watching,'Fresh route starts shared playback without an arbitrary settling delay');
peers.coach.requestWatch(false); pump();
contexts.coach.run = 'route'; contexts.rider.run = 'route'; peers.coach.tick(); peers.rider.tick(); pump();
// Pending invitations and highlights recover cleanly as the course changes.
peers.coach.select('dot-b');pump();contexts.rider.points=['dot-a'];peers.rider.tick();
check(!peers.rider.inspect().selection,'Deleted points clear remote selection instead of highlighting the wrong dot');
contexts.rider.points=['dot-a','dot-b'];
peers.coach.requestWatch(true);peers.coach.requestWatch(false);pump();
check(!peers.coach.inspect().wanted && !peers.rider.inspect().peerWanted,'Immediate invite cancellation cannot leave a phantom incoming watch');
time+=100;peers.coach.setPointing(true);peers.coach.point(30,40);pump();contexts.rider.scene='replacement-course';peers.rider.tick();
check(!peers.rider.inspect().pointer,'Changing course clears a stale remote pointer immediately');
contexts.rider.scene='course';peers.rider.tick();
check(!peers.coach.point(Number.NaN,50) && !peers.coach.point(50,Infinity),'Non-finite pointer positions rejected');
peers.coach.destroy();peers.rider.destroy();check(!peers.rider.receive(valid),'No work or playback after destroy');
// Delayed transport and unrelated device clocks: estimate delay with round trips,
// never subtract one device's clock directly from another's.
let wall = 10000, n = 0;
const delayed = [], clients = {}, clocks = {coach:720000,rider:-130000};
for (const id of ['coach','rider']) clients[id] = create({sessionId:'latency-session',userId:id,peerId:id==='coach'?'rider':'coach',coachId:'coach',
  send:m=>{delayed.push({at:wall+100,to:id==='coach'?'rider':'coach',m:structuredClone(m)});return true;},
  context:()=>({scene:'photo',run:'route',points:['dot-a'],duration:60}),now:()=>wall+clocks[id],token:()=>`lag-${++n}`});
function drain(){let loops=0;while(delayed.length){assert(++loops<100);delayed.sort((a,b)=>a.at-b.at);const next=delayed.shift();wall=next.at;clients[next.to].receive(next.m);}}
clients.coach.connect(true);clients.rider.connect(true);drain();wall+=1000000;
clients.coach.tick();clients.rider.tick();drain();
clients.coach.requestWatch(true);drain();clients.rider.requestWatch(true);drain();
clients.coach.control({seconds:10,playing:true});drain();
check(Math.abs(clients.coach.inspect().playback.seconds-clients.rider.inspect().playback.seconds)<.01,'Round-trip compensation aligns playback despite clock offsets and 100ms one-way delay');
wall+=2500;clients.rider.control({seconds:22,playing:true});drain();
check(Math.abs(clients.coach.inspect().playback.seconds-clients.rider.inspect().playback.seconds)<.01,'Either participant can take playback control with latency compensation');
clients.coach.destroy();clients.rider.destroy();
console.log(`Live run companion: ${checks} checks passed across two isolated protocol peers.`);
