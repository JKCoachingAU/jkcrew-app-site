const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const start = app.indexOf('async function refreshCoachBattleScores()');
assert(start >= 0, 'Actual score refresh exists');
const rest = app.slice(start);
const source = 'let battleScoreRefreshRunning = false;\n' + rest.slice(0, rest.indexOf('\n}') + 2);
let renders = 0, modal = false, focused = false, hold = false, reject = false, release;
const context = {
  state: { view: 'battleViewer', profile: { role: 'coach' } }, isCoachRole: role => role === 'coach',
  document: { visibilityState: 'visible', activeElement: { matches: () => focused }, querySelector: () => modal },
  renderCoachBattleViewer: async () => {
    renders += 1;
    if (reject) throw Error('Read failed');
    if (hold) await new Promise(resolve => { release = resolve; });
  },
};
vm.createContext(context); vm.runInContext(source, context);
(async () => {
  await context.refreshCoachBattleScores(); assert.equal(renders, 1);
  for (const mode of ['modal', 'hidden', 'other-view', 'rider', 'focused-input']) {
    modal = mode === 'modal'; focused = mode === 'focused-input';
    context.document.visibilityState = mode === 'hidden' ? 'hidden' : 'visible';
    context.state.view = mode === 'other-view' ? 'student' : 'battleViewer';
    context.state.profile.role = mode === 'rider' ? 'athlete' : 'coach';
    await context.refreshCoachBattleScores();
    assert.equal(renders, 1, `${mode} suppresses background refresh`);
  }
  modal = focused = false; context.document.visibilityState = 'visible';
  context.state.view = 'battleViewer'; context.state.profile.role = 'coach';
  hold = true;
  const first = context.refreshCoachBattleScores();
  await context.refreshCoachBattleScores();
  assert.equal(renders, 2, 'An in-flight refresh prevents overlapping requests');
  release(); await first; hold = false;
  await context.refreshCoachBattleScores(); assert.equal(renders, 3, 'Completion allows the next refresh');
  reject = true;
  await assert.rejects(context.refreshCoachBattleScores(), /Read failed/);
  reject = false;
  await context.refreshCoachBattleScores(); assert.equal(renders, 5, 'A failed read releases the refresh lock');
  console.log('PASS: coach-only visible-page refresh, modal/input guards, no overlapping requests, and retry after read failure. Page-state preservation is covered by coach-challenges.cjs.');
})().catch(error => { console.error(error); process.exit(1); });
