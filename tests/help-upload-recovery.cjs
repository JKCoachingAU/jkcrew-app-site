const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const app = fs.readFileSync(process.env.JKCREW_TEST_APP_SOURCE || path.join(__dirname, '../app.js'), 'utf8');
const code = ['helpUploadDraftSignature', 'isDefinitiveHelpWriteError', 'submitHelpRequest'].map(name => {
  const start = app.search(new RegExp('(?:async )?function ' + name + '\\('));
  const rest = app.slice(start); return rest.slice(0, rest.indexOf('\n}') + 2);
}).join('\n');
let uploads = 0, inserts = 0, removals = 0, renderFails = false, uploadFails = false, insertFails = false, hold, renders = 0;
const notifications = [];
const button = { disabled: false, textContent: '', isConnected: true };
const form = { dataset: {}, resetCount: 0, querySelector: () => button, reset() { this.resetCount++; } };
const context = {
  console: { warn() {} }, crypto: require('node:crypto').webcrypto,
  withTimeout: promise => Promise.resolve(promise), readHelpWriteReceipt: async () => null,
  state: { user: { id: 'rider' }, profile: { role: 'athlete' }, view: 'coaching' },
  FormData: class { get(key) { return key === 'video' ? { size: 100, name: 'clip.mp4' } : 'My clip question'; } },
  supportedHelpVideoFile: () => true, RIDER_VIDEO_MAX_BYTES: 1000, RIDER_VIDEO_MAX_SECONDS: 60,
  videoDurationSeconds: async () => { if (hold) await hold; return 5; },
  getLinkedCoachIdForCurrentAthlete: async () => 'coach',
  uploadHelpVideoFile: async () => { uploads++; if (uploadFails) throw Error('Upload interrupted'); return { path: 'rider/clip.mp4', fileName: 'clip.mp4', mimeType: 'video/mp4', size: 100 }; },
  client: { from: () => ({ insert: async () => { inserts++; return { error: insertFails ? Object.assign(Error('Insert denied'), { status: 403 }) : null }; } }), storage: { from: () => ({ remove: async () => { removals++; return {}; } }) } },
  TRICK_HELP_VIDEO_BUCKET: 'trick-help-videos',
  invalidateHelpRequestData() {}, clearHelpVideoPreview() {},
  renderAthleteCoaching: async () => { renders++; if (renderFails) throw Error('Refresh failed'); },
  renderAthleteHome: async () => { renders++; },
  notify: (message, type) => notifications.push({ message, type }), messageFrom: error => error.message,
};
vm.createContext(context); vm.runInContext(code, context);
const event = () => ({ preventDefault() {}, currentTarget: form });
(async () => {
  // A committed DB row must never lose its uploaded video because a later read fails.
  renderFails = true;
  await context.submitHelpRequest(event());
  assert.equal(inserts, 1); assert.equal(uploads, 1);
  assert.equal(removals, 0, 'Post-save render failure must not delete the committed video');
  assert.equal(form.resetCount, 1, 'Committed form cleared so retry cannot duplicate saved submission');
  assert(notifications.some(n => n.message.includes('Your video was sent')));
  assert.equal(button.disabled, false);
  renderFails = false; let release;
  hold = new Promise(resolve => { release = resolve; });
  const first = context.submitHelpRequest(event()), second = context.submitHelpRequest(event());
  release(); await Promise.all([first, second]); hold = null;
  assert.equal(inserts, 2, 'Repeated submit while checking/uploading creates only one row');
  assert.equal(uploads, 2);
  uploadFails = true;
  await context.submitHelpRequest(event()); assert.equal(form.resetCount, 2, 'Unsent upload draft retained on failure'); assert.equal(button.disabled, false);
  uploadFails = false; insertFails = true;
  await context.submitHelpRequest(event()); assert.equal(removals, 1, 'An explicitly rejected insert cleans only its uncommitted upload'); assert.equal(form.resetCount, 2);
  insertFails = false; await context.submitHelpRequest(event());
  assert.equal(inserts, 4); assert.equal(form.resetCount, 3, 'Retry succeeds and clears committed draft');
  assert.notEqual(form.dataset.submitting, 'true', 'Submit lock always released');
  context.state.profile.role = 'parent'; await context.submitHelpRequest(event()); assert.equal(inserts, 4, 'Parent account cannot submit rider video');
  context.state.profile.role = 'athlete';
  const beforeNavigationRenders = renders, beforeNavigationInserts = inserts;
  hold = new Promise(resolve => { release = resolve; });
  const navigatingUpload = context.submitHelpRequest(event());
  context.state.view = 'session'; release(); await navigatingUpload; hold = null;
  assert.equal(inserts, beforeNavigationInserts + 1);
  assert.equal(renders, beforeNavigationRenders, 'Upload completion does not replace a screen the rider navigated to');
  context.state.view = 'coaching'; const beforeSwitchInserts = inserts;
  hold = new Promise(resolve => { release = resolve; });
  const switchingUpload = context.submitHelpRequest(event());
  context.state.user.id = 'another-rider'; release(); await switchingUpload; hold = null;
  assert.equal(inserts, beforeSwitchInserts, 'Account change while validating clip cannot save against another rider');
  console.log('PASS: confirmed-save refresh failure retains video, duplicate submit guard, failed upload/insert preserves draft, retry, and athlete-only upload.');
})().catch(error => { console.error(error); process.exit(1); });
