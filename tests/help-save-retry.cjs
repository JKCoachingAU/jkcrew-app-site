// Exercise the production upload/save handlers with server responses lost after
// commit. No accounts, media or database rows are created outside this fixture.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.env.JKCREW_TEST_APP_SOURCE || path.join(__dirname, '../app.js'), 'utf8');
const names = ['helpUploadDraftSignature', 'isDefinitiveHelpWriteError', 'readHelpWriteReceipt', 'submitHelpRequest', 'replyToHelpRequest'];
const code = names.map(name => {
  const start = source.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert(start >= 0, `Missing ${name}`);
  const rest = source.slice(start); return rest.slice(0, rest.indexOf('\n}') + 2);
}).join('\n');
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
const networkError = () => new TypeError('Failed to fetch');
const deniedError = () => Object.assign(Error('Permission denied'), { code: '42501', status: 403 });
function fixture(role = 'athlete') {
  const f = { uploads: [], inserts: [], updates: [], removals: [], notifications: [], rows: new Map(), writeModes: [], readFailures: [], resets: 0, renders: 0, renderFails: false, file: { name: 'clip.mp4', size: 100, type: 'video/mp4', lastModified: 1 }, text: 'Please check this trick', requestId: 'request-1' };
  const button = { textContent: 'Send feedback', disabled: false, isConnected: true };
  const form = { dataset: role === 'coach' ? { helpReply: f.requestId } : {}, querySelector: () => button, reset: () => { f.resets++; }, isConnected: true };
  const state = { user: { id: role === 'coach' ? 'coach-1' : 'rider-1' }, profile: { role }, view: role === 'coach' ? 'videoReviews' : 'coaching', videoReviewRecordedReplies: new Map() };
  if (role === 'coach') f.rows.set(f.requestId, { id: f.requestId, athlete_id: 'rider-1', coach_id: 'coach-1', video_storage_path: 'rider/source.mp4', coach_video_storage_path: 'coach/previous.mp4', coach_comment: 'Previous feedback', status: 'replied', replied_at: '2026-09-20T02:00:00+00:00' });
  async function save(kind, payload, filters = []) {
    const mode = f.writeModes.shift() || 'ok';
    (kind === 'insert' ? f.inserts : f.updates).push({ ...payload });
    if (f.writeGate) await f.writeGate;
    if (mode === 'denied') return { data: null, error: deniedError() };
    if (mode === 'noCommitLost') return { data: null, error: networkError() };
    const id = kind === 'insert' ? payload.id : filters.find(([key]) => key === 'id')[1];
    const row = f.rows.get(id);
    if (kind === 'insert' && row) return { data: null, error: { code: '23505', message: 'Duplicate ID' } };
    if (mode === 'concurrent') {
      Object.assign(row, { replied_at: '2026-09-22T01:00:00+00:00', coach_comment: 'Another device already saved', coach_video_storage_path: 'coach/other-device.mp4' });
      return { data: [], error: null };
    }
    if (kind === 'update') {
      const expected = filters.find(([key]) => key === 'replied_at')[1];
      if (!row || (expected === null ? row.replied_at != null : Date.parse(expected) !== Date.parse(row.replied_at))) return { data: [], error: null };
    }
    f.rows.set(id, { ...row, ...payload, ...(payload.replied_at ? { replied_at: payload.replied_at.replace('Z', '+00:00') } : {}) });
    if (mode === 'commitLostReceiptOffline') f.readFailures.push(networkError());
    if (mode === 'commitLostReceiptDenied') f.readFailures.push(deniedError());
    if (mode === 'commitThrown') throw networkError();
    if (mode.startsWith('commitLost')) return { data: null, error: networkError() };
    return { data: [{ id, status: payload.status || 'open' }], error: null };
  }
  class Query {
    constructor() { this.filters = []; }
    select() { return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    is(key, value) { return this.eq(key, value); }
    insert(payload) { return save('insert', payload); }
    update(payload) { this.payload = payload; return this; }
    async maybeSingle() {
      if (f.readFailures.length) throw f.readFailures.shift();
      const id = this.filters.find(([key]) => key === 'id')[1];
      const row = f.rows.get(id); return { data: row ? { ...row } : null, error: null };
    }
    then(resolve, reject) { return save('update', this.payload, this.filters).then(resolve, reject); }
  }
  const context = {
    console: { warn() {} }, state, crypto: require('node:crypto').webcrypto,
    FormData: class { constructor() { this.file = f.file; this.text = f.text; } get(key) { return key === 'video' ? this.file : this.text; } },
    withTimeout: promise => Promise.resolve(promise),
    client: { from: () => new Query(), storage: { from: () => ({ remove: async paths => {
      for (const object of paths) {
        assert(![...f.rows.values()].some(row => row.video_storage_path === object || row.coach_video_storage_path === object), `Tried to delete referenced video: ${object}`);
        f.removals.push(object);
      }
      return { error: null };
    } }) } },
    supportedHelpVideoFile: () => true, RIDER_VIDEO_MAX_BYTES: 1000, COACH_VIDEO_MAX_BYTES: 1000, RIDER_VIDEO_MAX_SECONDS: 60, TRICK_HELP_VIDEO_BUCKET: 'videos',
    videoDurationSeconds: async () => { if (f.durationGate) await f.durationGate; return 5; }, getLinkedCoachIdForCurrentAthlete: async () => 'coach-1',
    uploadHelpVideoFile: async file => { const upload = { path: `${state.user.id}/upload-${f.uploads.length + 1}.mp4`, fileName: file.name, size: file.size, mimeType: file.type }; f.uploads.push(upload); return upload; },
    selectCoachReplyVideoFile: (selected, recorded) => selected?.size ? selected : recorded?.file || null,
    invalidateHelpRequestData() {}, clearHelpVideoPreview() {}, releaseVideoReviewMedia() {}, clearCoachRecordedReply: id => state.videoReviewRecordedReplies.delete(id),
    renderAthleteCoaching: async () => { f.renders++; if (f.renderFails) throw Error('List refresh failed'); }, renderAthleteHome() {},
    renderVideoReviews: async () => { f.renders++; if (f.renderFails) throw Error('List refresh failed'); }, renderStudentProfile() {},
    notify: (message, type) => f.notifications.push({ message, type }), messageFrom: error => error.message,
  };
  vm.createContext(context); vm.runInContext(code, context);
  Object.assign(f, { state, form, button, submit: () => context[role === 'coach' ? 'replyToHelpRequest' : 'submitHelpRequest']({ preventDefault() {}, currentTarget: form }) });
  return f;
}
(async () => {
  for (const mode of ['commitLost', 'commitThrown']) {
    const f = fixture(); f.writeModes.push(mode); await f.submit();
    equal(f.rows.size, 1, 'Lost acknowledgement still has one rider request');
    equal(f.removals.length, 0, 'Committed rider media remains available');
    equal(f.resets, 1, 'Receipt confirms save without asking rider to upload again');
    equal(f.button.disabled, false, 'Lost acknowledgement never leaves disabled submit');
  }
  for (const mode of ['commitLostReceiptOffline', 'commitLostReceiptDenied']) {
    const f = fixture(); f.writeModes.push(mode); await f.submit();
    equal(f.resets, 0, 'Unavailable receipt retains draft and transaction');
    equal(f.removals.length, 0, 'Unavailable receipt never deletes possibly saved media');
    f.readFailures.push(deniedError()); await f.submit();
    equal(f.removals.length, 0, 'A later read denial is not evidence that the earlier write failed');
    await f.submit();
    equal(f.inserts.length, 1, 'Retry confirms original row without inserting another');
    equal(f.uploads.length, 1, 'Retry reuses uploaded clip');
    equal(f.resets, 1, 'Successful receipt eventually clears draft');
  }
  {
    const f = fixture(); f.writeModes.push('noCommitLost'); await f.submit(); await f.submit();
    equal(f.inserts.length, 2, 'Uncommitted write can retry');
    equal(f.inserts[0].id, f.inserts[1].id, 'Retry carries stable idempotency UUID');
    equal(f.rows.size, 1, 'Retry creates exactly one request');
    equal(f.uploads.length, 1, 'Uncommitted retry does not reupload video');
    equal(f.removals.length, 0, 'Unknown response retains reusable upload');
  }
  {
    const f = fixture(); f.writeModes.push('denied'); await f.submit();
    equal(f.removals.length, 1, 'Definitively rejected first write cleans only unreferenced object');
    equal(f.resets, 0, 'Rejected upload preserves user input');
    await f.submit(); equal(f.rows.size, 1, 'Rejected upload remains retryable');
  }
  {
    const f = fixture(); let release; f.durationGate = new Promise(resolve => { release = resolve; });
    const first = f.submit(), duplicate = f.submit(); f.text = 'New unsent question'; release(); await Promise.all([first, duplicate]);
    equal(f.inserts.length, 1, 'Repeated taps while processing cannot duplicate request');
    equal(f.resets, 0, 'Typing while upload runs does not erase new input');
    equal(f.renders, 0, 'New draft is not replaced by async list rendering');
    await f.submit(); equal(f.rows.size, 2, 'A genuinely new draft can still be sent afterward');
  }
  for (const mode of ['commitLost', 'commitThrown', 'commitLostReceiptOffline']) {
    const f = fixture('coach'); f.writeModes.push(mode); await f.submit();
    if (mode.endsWith('Offline')) {
      equal(f.removals.length, 0, 'Uncertain coach save retains old and new media until confirmed');
      await f.submit();
    }
    equal(f.updates.length, 1, 'Coach lost acknowledgement retry does not update twice');
    equal(f.uploads.length, 1, 'Coach reply uploads once');
    equal(f.rows.get(f.requestId).coach_video_storage_path, f.uploads[0].path, 'Saved reply references intact new video');
    equal(f.removals, ['coach/previous.mp4'], 'Only obsolete, confirmed-replaced coach video removed');
    equal(f.button.disabled, false, 'Coach submit control recovers');
  }
  {
    const f = fixture('coach'); f.file = null; await f.submit();
    equal(f.uploads.length, 0, 'Text-only feedback needs no upload');
    equal(f.removals.length, 0, 'Text-only feedback preserves existing coach video');
    equal(f.rows.get(f.requestId).coach_video_storage_path, 'coach/previous.mp4', 'Existing coach attachment retained');
  }
  {
    const f = fixture('coach'); f.renderFails = true; await f.submit(); await f.submit();
    equal(f.updates.length, 1, 'Failed screen refresh cannot duplicate confirmed coach write');
    equal(f.uploads.length, 1, 'Failed screen refresh cannot reupload coach clip');
  }
  {
    const f = fixture('coach'); f.writeModes.push('concurrent'); await f.submit();
    equal(f.rows.get(f.requestId).coach_comment, 'Another device already saved', 'Concurrent edit not silently overwritten');
    equal(f.removals.length, 0, 'Conflict keeps draft upload for retry');
    equal(f.button.disabled, false, 'Conflict remains recoverable');
    await f.submit(); equal(f.uploads.length, 1, 'Explicit retry reuses preserved draft');
    equal(f.rows.get(f.requestId).coach_comment, 'Another device already saved', 'Retry does not silently accept the other device revision');
    equal(f.updates.length, 1, 'Conflicting retry is stopped before another update');
  }
  {
    const f = fixture('coach'); f.writeModes.push('commitLostReceiptOffline'); await f.submit();
    const originalDraftPath = f.uploads[0].path;
    Object.assign(f.rows.get(f.requestId), { replied_at: '2026-09-23T01:00:00+00:00', coach_comment: 'Newer feedback from another device', coach_video_storage_path: 'coach/newer.mp4' });
    await f.submit();
    equal(f.updates.length, 1, 'Lost ACK then intervening reply never causes a second update');
    equal(f.rows.get(f.requestId).coach_comment, 'Newer feedback from another device', 'Intervening reply is not overwritten with older draft');
    equal(f.form._helpReplySubmission.upload.path, originalDraftPath, 'Conflicting draft and uploaded media retained');
    equal(f.removals.length, 0, 'Unknown prior outcome never deletes media during conflict');
    equal(f.notifications.at(-1).type, 'error', 'Coach receives an explicit conflict message');
  }
  {
    const f = fixture('coach'); f.writeModes.push('denied'); await f.submit();
    equal(f.removals, ['coach-1/upload-1.mp4'], 'Rejected review removes only its new unreferenced media');
    equal(f.rows.get(f.requestId).coach_video_storage_path, 'coach/previous.mp4', 'Rejected review preserves original attachment');
  }
  console.log(`PASS: ${checks} help-save retry checks (lost responses, stable UUIDs, draft/media preservation, review concurrency, text-only replies).`);
})().catch(error => { console.error(error); process.exit(1); });
