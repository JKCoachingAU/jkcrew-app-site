const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../battle-rematches.js'),'utf8')+'\nglobalThis.rematches=JKCrewBattleRematches;',context);
const api=context.rematches;
for(let size=1;size<=6;size++)for(const count of [2,3]){
  const battle={id:'complete',status:'completed',battle_size:size,team_count:count,duration_days:4,reward_points:7,participants:Array.from({length:size*count},(_,i)=>({athlete_id:'r'+i,team_number:Math.floor(i/size)+1,is_winner:i<size}))};
  for(const own of [0,size*count-1]){
    const draft=api.draftFromBattle(battle,'r'+own);
    assert.equal(draft.size,size);assert.equal(draft.teamCount,count);assert.equal(draft.durationDays,4);assert.equal(draft.rewardPoints,7);
    assert(draft.teams[0].includes('r'+own));assert.equal(draft.teams[0][0],'r'+own);
    assert.equal(new Set(draft.teams.flat()).size,size*count);
    assert.deepEqual(Array.from(draft.teams,team=>Array.from(team).sort().join(',')).sort(),battle.participants.reduce((teams,person)=>{(teams[person.team_number-1]??=[]).push(person.athlete_id);return teams;},[]).map(team=>team.sort().join(',')).sort());
    assert(api.actionHtml(battle,'r'+own).includes('Rematch'));
  }
  assert(api.draftFromBattle(battle,'coach',true));assert.equal(api.draftFromBattle(battle,'outsider'),null);
  for(const status of ['pending','accepted','declined','cancelled'])assert.equal(api.actionHtml({...battle,status},'r0'),'');
  assert.equal(api.draftFromBattle({...battle,participants:battle.participants.slice(1)},'r0'),null);
}
const duplicate={status:'completed',battle_size:1,team_count:2,participants:[{athlete_id:'same',team_number:1},{athlete_id:'same',team_number:2}]};
assert.equal(api.draftFromBattle(duplicate,'same'),null);
const options={riders:[{athlete_id:'self',display_name:'Me',recent_training_points:20,active_battle_count:0},{athlete_id:'near',display_name:'Near',recent_training_points:18,active_battle_count:0},{athlete_id:'exact-busy',display_name:'Busy',recent_training_points:20,active_battle_count:3},{athlete_id:'far',display_name:'Far',recent_training_points:60,active_battle_count:0},{athlete_id:'zero',display_name:'Zero',recent_training_points:0,active_battle_count:0}]};
assert.equal(api.suggestedOpponent(options,'self').rider.athlete_id,'near');
assert(api.suggestedOpponent(options,'self').explanation.includes('Last 7 days'));
assert.equal(api.suggestedOpponent(options,'zero'),null);
assert.equal(api.suggestedOpponent(options,'self',[{status:'pending',participants:[{athlete_id:'self'},{athlete_id:'near'}]}]),null);
assert.equal(api.eligibility(['near'],options).length,0);
assert(api.eligibility(['gone'],options,[{athlete_id:'gone',display_name:'Previous rider'}])[0].includes('Previous rider is unavailable'));
assert(api.eligibility(['exact-busy'],options)[0].includes('3 active battles'));
console.log('PASS all12 formats, winner/loser/third-side rotation,18 participants, completed-only controls, malformed data, recent-only comparable suggestions and eligibility messages.');
