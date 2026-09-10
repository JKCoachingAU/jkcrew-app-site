const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const names=['runTiming','runTimedPosition','runPlaybackDefaultSeconds','rememberRunEdit','restoreRunEdit','duplicateCurrentRun','deleteSelectedRunPoint'];
const code=names.map(name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2)}).join('\n');
const c={liveRun:null,structuredClone,state:{runBuilder:{id:'original',athleteId:'rider',points:[{x:0,travelSeconds:10},{x:50,holdSeconds:7,travelSeconds:12},{x:100}],selectedPointIndex:1}},document:{querySelector:()=>null},runBuilderRefreshView:async()=>{},stopRunPlayback:()=>{},notify:()=>{}};
c.currentRunFormState=()=>({...c.state.runBuilder});vm.createContext(c);vm.runInContext('let runUndoStack=[],runRedoStack=[];'+code,c);
(async()=>{
 const timing=c.runTiming(c.state.runBuilder.points);assert.equal(c.runPlaybackDefaultSeconds(c.state.runBuilder.points),29);
 assert.equal(c.runTimedPosition(timing,5/29),.5);assert.equal(c.runTimedPosition(timing,12/29),1);assert.equal(c.runTimedPosition(timing,23/29),1.5);assert.equal(c.runTimedPosition(timing,1),2);
 c.rememberRunEdit();c.state.runBuilder.points[1].x=75;await c.restoreRunEdit({currentTarget:{dataset:{runHistory:'undo'}}});assert.equal(c.state.runBuilder.points[1].x,50);
 await c.restoreRunEdit({currentTarget:{dataset:{runHistory:'redo'}}});assert.equal(c.state.runBuilder.points[1].x,75);
 await c.deleteSelectedRunPoint();assert.equal(c.state.runBuilder.points.length,2);await c.restoreRunEdit({currentTarget:{dataset:{runHistory:'undo'}}});assert.equal(c.state.runBuilder.points.length,3);assert.equal(c.state.runBuilder.points[1].holdSeconds,7);
 await c.duplicateCurrentRun({currentTarget:{dataset:{runCopy:'Finals'}}});assert.equal(c.state.runBuilder.id,null);assert.equal(c.state.runBuilder.title,'Finals');assert.equal(c.state.runBuilder.athleteId,'rider');assert.equal(c.state.runBuilder.points[1].travelSeconds,12);
 await c.restoreRunEdit({currentTarget:{dataset:{runHistory:'undo'}}});assert.equal(c.state.runBuilder.id,null);
 console.log('PASS: travel/hold timing, exact total, moving/deleting undo-redo, separate named copies and rider ownership.');
})().catch(e=>{console.error(e);process.exit(1)});
