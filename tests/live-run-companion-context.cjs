const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../app.js'),'utf8');
function extract(name) { const start=app.indexOf(`function ${name}(`); assert(start>=0,name); const s=app.slice(start);return s.slice(0,s.indexOf('\n}')+2); }
const context={state:{runBuilder:{contestItemId:'event',imageDataUrl:'data:image/png;base64,photo',points:[]}},runPlaybackDefaultSeconds:()=>60};
vm.createContext(context);
vm.runInContext(`let liveRun={};\n${extract('liveRunFingerprint')}\n${extract('liveRunCompanionContext')}`,context);
const fingerprint=points=>{context.state.runBuilder.points=points;return vm.runInContext('liveRunCompanionContext()',context);};
const authored=[{id:'a',x:10,y:20,label:'Start',view:{scale:1,x:0,y:0}},{id:'b',label:'Barspin',x:30,y:40,holdSeconds:2,travelSeconds:4}];
const jsonb=[{view:{y:0,x:0,scale:1},label:'Start',y:20,x:10,id:'a'},{travelSeconds:4,holdSeconds:2,y:40,x:30,label:'Barspin',id:'b'}];
assert.equal(fingerprint(authored).run,fingerprint(jsonb).run,'Equivalent locally-authored / jsonb-sorted point objects must agree on shared playback context');
assert.notEqual(fingerprint(authored).run,fingerprint([...jsonb].reverse()).run,'Route ordering remains meaningful');
assert.notEqual(fingerprint(authored).run,fingerprint(jsonb.map(p=>p.id==='b'?{...p,holdSeconds:3}:p)).run,'Changed trick timing pauses old playback');
const originalScene=fingerprint(authored).scene;
context.state.runBuilder.imageDataUrl='data:image/png;base64,different-photo';
assert.notEqual(originalScene,fingerprint(authored).scene,'Changed course has a different pointer context');
console.log('PASS: shared playback context canonicalises jsonb keys while preserving route order, timing and course changes.');
