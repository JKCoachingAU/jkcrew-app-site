const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function extract(name) {
  const start = app.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const text = app.slice(start);
  return text.slice(0, text.indexOf('\n}') + 2);
}
const source = ['liveRunCompanionPlaybackTarget','applyLiveRunCompanionPlayback','stopRunPlayback','disconnectLiveRun'].map(extract).join('\n');
let checks = 0;
for (const mode of ['fullscreen-leave', 'fullscreen-signout', 'inline-leave', 'unrelated-fullscreen']) {
  const cancelled = [], cleared = [], resources = [], button = {textContent:'PAUSE'};
  const controls = {
    isConnected:true,
    closest(selector) {
      if (selector === '#run-builder-live') return mode === 'inline-leave' ? {} : null;
      if (selector === '.run-fullscreen-playback') return mode === 'inline-leave' ? null : {dataset:{liveSessionId:mode === 'unrelated-fullscreen' ? 'other-session' : 'active-session'}};
      return null;
    },
    classList:{remove:value=>resources.push(value)},
    querySelector:()=>button,
  };
  const fixture = { state:{user:mode === 'fullscreen-signout' ? null : {id:'coach'},runPlaybackTimer:91,runPlayback:{controls},runBuilder:{liveSessionId:'active-session'}},
    window:{cancelAnimationFrame:id=>cancelled.push(id)},clearInterval:id=>cleared.push(id),document:{removeEventListener:()=>{}},
    client:{removeChannel:()=>resources.push('channel')},paintRunPlayback:()=>{}, console,
  };
  vm.createContext(fixture);
  vm.runInContext(`let liveRun = {session:{id:'active-session'},timer:10,companionTimer:11,channel:{},
    companion:{destroy:()=>applyLiveRunCompanionPlayback({stopped:true})},media:{destroy:()=>{}}};\n${source}\ndisconnectLiveRun();`, fixture);
  if (mode === 'unrelated-fullscreen') {
    assert.deepEqual(cancelled, [], 'Teardown cannot stop playback from another run');
    assert(fixture.state.runPlayback, 'Unrelated playback is preserved');
  } else {
    assert.deepEqual(cancelled, [91], `${mode}: animation frame cancelled once`);
    assert.equal(fixture.state.runPlayback, null, `${mode}: playback cleared`);
    assert.equal(fixture.state.runPlaybackTimer, null, `${mode}: no frame retained`);
    assert.equal(button.textContent, 'RESUME', `${mode}: playing control resets`);
  }
  assert.deepEqual(cleared, [10,11], `${mode}: collaboration timers released`);
  assert(!('liveSessionId' in fixture.state.runBuilder), `${mode}: draft kept without live attachment`);
  assert(resources.includes('channel'), `${mode}: channel released`);
  checks++;
}
console.log(`PASS: ${checks} live playback teardown scenarios (fullscreen leave/sign-out, inline, unrelated run).`);
