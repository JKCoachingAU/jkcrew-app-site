'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Sync = require('../live-run-sync.js');
const clone = value => structuredClone(value);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const dot = (n,more={}) => ({id:id(n),x:n*10,y:n*15,label:`Trick ${n}`,holdSeconds:1,travelSeconds:3,...more});
const base = () => ({title:'Final',venue:'Loganland',planType:'competition',notes:'',contestItemId:null,courseSource:'upload',imageDataUrl:'photo-A',view:{zoom:1},points:[dot(1),dot(2),dot(3)]});
let checks = 0;
function eq(a,b,message) { assert.deepEqual(a,b,message);checks++; }
function ok(value,message) {assert(value,message);checks++;}
function throws(fn,pattern) {assert.throws(fn,pattern);checks++;}
function merge(localEdit,remoteEdit) {const b=base(),l=clone(b),r=clone(b);localEdit(l);remoteEdit(r);return {b,l,r,...Sync.rebase(b,l,r)};}
function clean(result) {eq(result.conflicts,[]);eq(result.draft,result.sharedDraft);}

// Stable JSON equality and point identity without modifying caller state.
ok(Sync.equal({b:[1,{z:null}],a:2},{a:2,b:[1,{z:null}]}));
ok(!Sync.equal({value:null},{}));ok(!Sync.equal({value:undefined},{}));ok(!Sync.equal([1,2],[2,1]));
ok(!Sync.equal(0,'0'));ok(!Sync.equal(null,undefined));ok(Sync.equal({zero:-0},{zero:0}));
const original=[dot(1),{x:2,y:3},dot(1),dot(4,{extra:{keep:true}})];
const originals=clone(original),ensured=Sync.ensureIds(original);
eq(original,originals);eq(ensured[0],original[0]);eq(ensured[3],original[3]);eq(new Set(ensured.map(row=>row.id)).size,4);
ok(ensured.every(row=>/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(row.id)));
ensured[3].extra.keep=false;eq(original[3].extra.keep,true);
let generated=1;const browser={crypto:{randomUUID:()=>id(++generated)}};
vm.createContext(browser);vm.runInContext(fs.readFileSync(require.resolve('../live-run-sync.js'),'utf8'),browser);
ok(browser.JKLiveRunSync);eq(JSON.parse(JSON.stringify(browser.JKLiveRunSync.ensureIds([{x:1,y:1},dot(2)]))).map(row=>row.id),[id(3),id(2)],'Generated IDs cannot displace an existing later ID');
throws(()=>Sync.ensureIds([null]),/object/);throws(()=>Sync.diff({points:[dot(1),dot(1)]},base()),/unique/);throws(()=>Sync.diff({points:[{x:1,y:2}]},base()),/stable IDs/);

// Exact wire protocol: roots, full old/new point objects, anchor insertions.
const b=base(),l=clone(b);l.title='New title';l.points[0].label='Barspin';delete l.points[1].holdSeconds;l.points[2].note=null;l.points.splice(1,0,dot(4));
const patch=Sync.diff(b,l);eq(patch[0],{op:'set',key:'title',before:'Final',value:'New title'});
eq(patch.find(op=>op.op==='point'&&op.id===id(1)),{op:'point',id:id(1),before:dot(1),value:dot(1,{label:'Barspin'})});
eq(patch.find(op=>op.op==='insert'),{op:'insert',after:id(1),value:dot(4)});
ok(!Object.hasOwn(patch.find(op=>op.id===id(2)).value,'holdSeconds'));
ok(Object.hasOwn(patch.find(op=>op.id===id(3)).value,'note'));
const deleted=clone(b);deleted.points.splice(1,1);eq(Sync.diff(b,deleted),[{op:'delete',id:id(2),before:dot(2)}]);
eq(Sync.diff({points:[]},{points:[],title:'Hello'}),[{op:'set',key:'title',before:null,value:'Hello'}]);
eq(Sync.diff({points:[],title:'Hello'},{points:[]}),[{op:'set',key:'title',before:'Hello',value:null}]);
eq(Sync.diff({points:[],title:null},{points:[]}),[]);
const roots=['title','venue','planType','notes','contestItemId','courseSource','imageDataUrl','view'];
for(const key of roots){const changed=base();changed[key]=key==='view'?{zoom:2}:'changed';eq(Sync.diff(b,changed).map(op=>op.key),[key]);}
const reorder=clone(b);reorder.points.reverse();throws(()=>Sync.diff(b,reorder),/Reordering/);throws(()=>Sync.rebase(b,reorder,b),/Reordering/);
const replace=clone(b);replace.points=[dot(4),dot(2),dot(5),dot(3),dot(6)];
eq(Sync.diff(b,replace).filter(op=>op.op==='insert').map(op=>op.after),[null,id(2),id(3)]);
patch[1].value.label='Mutated op';eq(l.points[0].label,'Barspin','Wire operations never alias live draft objects');

// Disjoint root, dot and dot-property changes all survive together.
let result=merge(l=>l.title='Local title',r=>r.notes='Remote notes');clean(result);eq(result.draft.title,'Local title');eq(result.draft.notes,'Remote notes');
result=merge(l=>l.points[0].label='Local barspin',r=>r.points[1].label='Remote flair');clean(result);eq(result.draft.points.map(row=>row.label),['Local barspin','Remote flair','Trick 3']);
result=merge(l=>{l.points[0].x=24;l.points[0].holdSeconds=2;},r=>{r.points[0].label='Remote tailwhip';r.points[0].travelSeconds=6;});clean(result);eq(result.draft.points[0],dot(1,{x:24,holdSeconds:2,label:'Remote tailwhip',travelSeconds:6}));
result=merge(l=>l.points[0].isTrick=true,r=>r.points[0].customFutureProperty={valid:true});clean(result);eq(result.draft.points[0].isTrick,true);eq(result.draft.points[0].customFutureProperty,{valid:true});
result=merge(l=>delete l.points[0].label,r=>r.points[0].holdSeconds=2);clean(result);ok(!Object.hasOwn(result.draft.points[0],'label'));eq(result.draft.points[0].holdSeconds,2);
result=merge(l=>l.points[0].note=null,r=>r.points[0].travelSeconds=9);clean(result);ok(Object.hasOwn(result.draft.points[0],'note'));eq(result.draft.points[0].note,null);
result=merge(l=>l.points[0].note=null,r=>r.points[0].note='Remote note');eq(result.conflicts,[`points.${id(1)}.note`]);eq(result.draft.points[0].note,null);eq(result.sharedDraft.points[0].note,'Remote note');

// Same values converge; opposing values preserve both explicit choices and
// every disjoint local edit, including while resolving a different conflict.
result=merge(l=>{l.title='Same';l.points[0].label='Same';},r=>{r.title='Same';r.points[0].label='Same';});clean(result);
result=merge(l=>{l.title='Mine';l.notes='Local note';l.points[0].label='Local trick';l.points[1].x=33;},r=>{r.title='Theirs';r.points[0].label='Remote trick';r.points[2].y=77;});
eq(result.conflicts,['title',`points.${id(1)}.label`]);eq(result.draft.title,'Mine');eq(result.sharedDraft.title,'Theirs');eq(result.draft.points[0].label,'Local trick');eq(result.sharedDraft.points[0].label,'Remote trick');
for(const choice of [result.draft,result.sharedDraft]){eq(choice.notes,'Local note');eq(choice.points[1].x,33);eq(choice.points[2].y,77);}
result=merge(l=>{delete l.points[0].label;l.points[1].x=42;},r=>r.points[0].label=null);
eq(result.conflicts,[`points.${id(1)}.label`]);ok(!Object.hasOwn(result.draft.points[0],'label'));ok(Object.hasOwn(result.sharedDraft.points[0],'label'));eq(result.sharedDraft.points[0].label,null);eq(result.sharedDraft.points[1].x,42);
result=merge(l=>l.view={zoom:2},r=>r.view={zoom:3});eq(result.conflicts,['view']);eq(result.draft.view,{zoom:2});eq(result.sharedDraft.view,{zoom:3});

// Inserts share stable anchors and survive simultaneous additions.
result=merge(l=>l.points.splice(1,0,dot(4)),r=>r.points.splice(1,0,dot(5)));clean(result);eq(result.draft.points.map(row=>row.id),[id(1),id(4),id(5),id(2),id(3)]);
result=merge(l=>l.points.unshift(dot(4)),r=>r.points.unshift(dot(5)));clean(result);eq(result.draft.points.map(row=>row.id),[id(4),id(5),id(1),id(2),id(3)]);
result=merge(l=>l.points.splice(1,0,dot(4),dot(5)),r=>r.points.splice(1,0,dot(6)));clean(result);eq(result.draft.points.map(row=>row.id),[id(1),id(4),id(5),id(6),id(2),id(3)]);
result=merge(l=>l.points.splice(1,0,dot(4)),r=>r.points.splice(1,0,dot(4)));clean(result);eq(result.draft.points.filter(row=>row.id===id(4)).length,1);
result=merge(l=>l.points.splice(1,0,dot(4,{label:'Mine'})),r=>r.points.splice(1,0,dot(4,{label:'Theirs'})));eq(result.conflicts,[`points.${id(4)}`]);eq(result.draft.points[1].label,'Mine');eq(result.sharedDraft.points[1].label,'Theirs');
result=merge(l=>l.points.splice(2,0,dot(4),dot(5)),r=>r.points.splice(1,1));
eq(result.conflicts,[`points.${id(4)}.after`,`points.${id(5)}.after`]);eq(result.draft.points.map(row=>row.id),[id(1),id(4),id(5),id(3)]);eq(result.sharedDraft.points.map(row=>row.id),[id(1),id(3)]);
result=merge(l=>l.points.push(dot(4)),r=>r.points=[]);eq(result.conflicts,[`points.${id(4)}.after`]);eq(result.draft.points.map(row=>row.id),[id(4)]);eq(result.sharedDraft.points,[]);

// Deletion versus editing always offers an explicit decision.
result=merge(l=>l.points.splice(1,1),r=>r.points[0].label='Remote label');clean(result);eq(result.draft.points.map(row=>row.id),[id(1),id(3)]);eq(result.draft.points[0].label,'Remote label');
result=merge(l=>l.points.splice(1,1),r=>r.points.splice(1,1));clean(result);eq(result.draft.points.length,2);
result=merge(l=>{l.points.splice(1,1);l.notes='Local note';},r=>r.points[1].label='Remote edit');eq(result.conflicts,[`points.${id(2)}`]);eq(result.draft.points.map(row=>row.id),[id(1),id(3)]);eq(result.sharedDraft.points[1].label,'Remote edit');eq(result.sharedDraft.notes,'Local note');
result=merge(l=>{l.points[1].label='Local edit';l.title='Local title';},r=>r.points.splice(1,1));eq(result.conflicts,[`points.${id(2)}`]);eq(result.draft.points[1].label,'Local edit');eq(result.sharedDraft.points.map(row=>row.id),[id(1),id(3)]);eq(result.sharedDraft.title,'Local title');

// A pending local change after an ACK is based on the acknowledged snapshot,
// not the pre-request draft, and never overwrites an unrelated remote update.
const sent=base();sent.points[0].label='Sent value';const pending=clone(sent);pending.points[0].label='Further typing';pending.points.push(dot(4));const acknowledged=clone(sent);acknowledged.points[1].label='Remote other dot';
result=Sync.rebase(sent,pending,acknowledged);clean(result);eq(result.draft.points[0].label,'Further typing');eq(result.draft.points[1].label,'Remote other dot');eq(result.draft.points[3].id,id(4));
const pendingInsertBase=clone(sent);pendingInsertBase.points.push(dot(4));const pendingInsertLocal=clone(pendingInsertBase);pendingInsertLocal.points[3].label='Edit after insert';const pendingInsertRemote=clone(pendingInsertBase);pendingInsertRemote.title='Remote title';
result=Sync.rebase(pendingInsertBase,pendingInsertLocal,pendingInsertRemote);clean(result);eq(result.draft.points[3].label,'Edit after insert');eq(result.draft.title,'Remote title');

// Course replacement is atomic; old-photo routes never merge into a new photo.
const changeCourse=l=>{l.imageDataUrl='photo-B';l.contestItemId='event-B';l.courseSource='event';l.points=[];l.view={zoom:1};};
result=merge(changeCourse,()=>{});clean(result);eq(result.draft.imageDataUrl,'photo-B');eq(result.draft.points,[]);
result=merge(l=>{changeCourse(l);l.notes='Local notes';},r=>r.points[0].label='Remote trick');ok(result.conflicts.includes('course'));eq(result.draft.imageDataUrl,'photo-B');eq(result.draft.points,[]);eq(result.sharedDraft.imageDataUrl,'photo-A');eq(result.sharedDraft.points[0].label,'Remote trick');eq(result.sharedDraft.notes,'Local notes');
result=merge(changeCourse,r=>r.notes='Remote notes');ok(result.conflicts.includes('course'),'Exact global version detects even a remote note before course replacement');eq(result.draft.notes,'Remote notes');eq(result.sharedDraft.notes,'Remote notes');eq(result.sharedDraft.imageDataUrl,'photo-A');
result=merge(l=>{l.points[0].label='Local old-photo edit';l.notes='Local notes';},changeCourse);ok(result.conflicts.includes('course'));eq(result.draft.imageDataUrl,'photo-A');eq(result.draft.points[0].label,'Local old-photo edit');eq(result.sharedDraft.imageDataUrl,'photo-B');eq(result.sharedDraft.points,[]);eq(result.sharedDraft.notes,'Local notes');
result=merge(l=>l.notes='Local notes',changeCourse);clean(result);eq(result.draft.imageDataUrl,'photo-B');eq(result.draft.points,[]);eq(result.draft.notes,'Local notes');
result=merge(l=>l.view={zoom:2},changeCourse);ok(result.conflicts.includes('course'));eq(result.draft.imageDataUrl,'photo-A');eq(result.draft.view,{zoom:2});eq(result.sharedDraft.imageDataUrl,'photo-B');
result=merge(l=>{changeCourse(l);l.notes='Local notes';},changeCourse);clean(result);eq(result.draft.notes,'Local notes');

// Inputs and returned alternatives never share mutable references.
const immutableBase=base(),immutableLocal=clone(immutableBase),immutableRemote=clone(immutableBase);immutableLocal.points[0].label='Local';immutableRemote.points[1].label='Remote';
const copies=[immutableBase,immutableLocal,immutableRemote].map(clone);result=Sync.rebase(immutableBase,immutableLocal,immutableRemote);eq([immutableBase,immutableLocal,immutableRemote],copies);
result.draft.points[1].label='Mutated result';eq(immutableRemote.points[1].label,'Remote');eq(result.sharedDraft.points[1].label,'Remote');
// Browser and Node exports run the same algorithm without any app dependencies.
eq(JSON.parse(JSON.stringify(browser.JKLiveRunSync.diff(base(),base()))),[]);
console.log(`PASS: ${checks} live run sync checks for stable IDs, wire operations, concurrent edits, explicit conflict choices, anchors, route barriers, ACK rebasing and immutability.`);
