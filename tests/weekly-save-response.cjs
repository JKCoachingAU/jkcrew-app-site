// Use the real save lock and completion handler with held network reads and writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Production ${name} exists`);
  const tail = source.slice(start);
  return tail.slice(0, tail.indexOf('\n}') + 2);
};
const deferred = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};
const classes = (complete = false) => ({
  contains: () => complete,
  toggle: (_name, value) => { complete = value; },
});
const buttonFor = (category = 'one_bang', complete = false, assignmentId = 'trick-1') => {
  const status = { textContent: `${complete ? 'Done' : 'To do'} this week · Keep speed` };
  const row = { classList: classes(complete), querySelector: selector => selector === 'strong' ? { textContent: 'Barspin' } : status };
  return {
    dataset: { assignmentCategory: category, assignmentId, assignmentAction: complete ? 'unlanded' : 'landed' },
    classList: classes(complete), closest: selector => selector === '.assignment-row' ? row : null,
    attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
    isConnected: true, disabled: false, textContent: complete ? '✓' : '', status, row,
  };
};
const buttonEvent = currentTarget => ({ currentTarget, preventDefault() {}, stopPropagation() {} });
const checks = { reads: [], writes: [], scores: [], notices: [], cache: [], progress: [], daily: [] };
const syncLabel = { textContent: '' };
const fixture = {
  console,
  navigator: { onLine: true },
  document: { querySelector: () => ({ setAttribute() {}, querySelector: () => syncLabel }) },
  clearTimeout() {},
  withTimeout: promise => promise,
  state: {
    user: { id: 'rider-1' }, sessionSetupVersion: 1, view: 'session', loadingOverlayToken: 1,
    selectedVenue: 'The Village', sessionOpenAssignmentSections: new Set(), pendingAssignmentProgress: new Map(),
  },
  messageFrom: error => error.message,
  cacheClear: key => checks.cache.push(key),
  notify: (message, tone) => checks.notices.push({ message, tone }),
  refreshOwnXpAfterAction: async () => {},
  showUpdatedWeeklyScore: async (points, name) => checks.scores.push({ points, name }),
  requestRiderSessionRefresh: options => {
    const gate = deferred();
    checks.reads.push({ options, ...gate });
    return gate.promise;
  },
  renderAthleteHome: async () => checks.reads.push({ home: true }),
  refreshOpenTrainingProgress: id => checks.progress.push(id),
  recordDailyTrainingAction: (event, fromCoach) => checks.daily.push({ event, fromCoach }),
  client: {
    rpc(name, args) {
      const gate = deferred();
      checks.writes.push({ name, args: { ...args }, ...gate });
      return gate.promise;
    },
  },
};
vm.createContext(fixture);
vm.runInContext([
  'const progressSaveStates = new Map();',
  ...['progressSaveKey', 'setSyncStatus', 'saveProgressRpc', 'setPendingAssignmentProgress',
    'clearPendingAssignmentProgress', 'recordAssignmentAction'].map(extract),
].join('\n'), fixture);
const press = button => fixture.recordAssignmentAction(buttonEvent(button));
const receipt = (index, result) => checks.writes[index].release({ data: { assignment_id: checks.writes[index].args.p_assignment_id, ...result } });
const completeAt = '2026-11-22T01:00:00Z';
const tick = { completed_at: completeAt, points_awarded: 2, message: 'Trick landed' };
const untick = { completed_at: null, points_removed: 2, message: 'Trick unticked' };

(async () => {
  const first = buttonFor();
  const saving = press(first);
  assert.equal(first.textContent, '✓', 'The click responds before the write returns');
  assert.equal(first.disabled, true);
  assert.equal(syncLabel.textContent, 'Saving…');
  assert.deepEqual(checks.writes[0].args, { p_assignment_id: 'trick-1', p_action: 'landed', p_venue: 'The Village' });
  assert.equal(checks.scores.length, 0);
  assert.equal(checks.reads.length, 0);

  const replacement = buttonFor('one_bang', true);
  // The mounted button can be replaced by an unrelated read while saving.
  await press(replacement);
  assert.equal(checks.writes.length, 1);
  assert.equal(fixture.state.pendingAssignmentProgress.get('trick-1').complete, true);
  assert.equal(replacement.textContent, '✓');
  assert.equal(checks.notices.length, 0);

  receipt(0, tick);
  await saving;
  assert.equal(first.disabled, false, 'A matching server acknowledgement unlocks the button before the read finishes');
  assert.equal(first.dataset.assignmentAction, 'unlanded');
  assert.equal(first.attributes['aria-label'], 'Untick trick');
  assert.equal(first.status.textContent, 'Done this week · Keep speed');
  assert.equal(syncLabel.textContent, 'Saved');
  assert.deepEqual(checks.scores, [{ points: 2, name: 'Barspin' }]);
  assert.equal(checks.notices.length, 0, 'One award only');
  assert.equal(checks.reads.length, 1, 'Refresh is still held');
  assert.equal(checks.reads[0].options.force, true);
  assert.equal(fixture.state.pendingAssignmentProgress.get('trick-1').complete, true);

  const undoing = press(first);
  assert.equal(checks.writes[1].args.p_action, 'unlanded', 'Fast next tap issues the exact inverse, once');
  receipt(1, untick);
  await undoing;
  assert.equal(first.dataset.assignmentAction, 'landed');
  assert.equal(first.textContent, '');
  assert.equal(first.disabled, false);
  assert.equal(checks.scores.length, 1);
  assert.deepEqual(checks.notices[0], { message: 'Trick unticked · -2 points.', tone: undefined });
  assert.equal(fixture.state.pendingAssignmentProgress.get('trick-1').complete, false);

  const failed = press(first);
  checks.writes[2].release({ error: Error('Save failed') });
  await failed;
  assert.equal(first.disabled, false);
  assert.equal(first.textContent, '');
  assert.equal(first.dataset.assignmentAction, 'landed');
  assert.equal(syncLabel.textContent, 'Save unconfirmed');
  assert.equal(fixture.state.pendingAssignmentProgress.has('trick-1'), false);
  assert.equal(checks.notices[1].message, 'Save failed');
  assert.equal(checks.scores.length, 1);

  const invalid = press(first);
  checks.writes[3].release({ data: { ...tick, assignment_id: 'other-rider-trick' } });
  await invalid;
  assert.equal(first.disabled, true, 'An unmatched reply does not unlock another submission before refresh');
  assert.equal(first.textContent, '');
  assert.equal(first.dataset.assignmentAction, 'landed');
  assert.equal(syncLabel.textContent, 'Save unconfirmed');
  assert.equal(checks.scores.length, 1);
  assert.equal(checks.notices[2].tone, 'error');

  const other = buttonFor('other', false, 'fundamental-1');
  const half = press(other);
  assert.equal(checks.writes[4].name, 'record_other_try_action');
  assert.equal(Object.hasOwn(checks.writes[4].args, 'p_venue'), false);
  receipt(4, { ...tick, points_awarded: 0, half_points_awarded: 0.5 });
  await half;
  assert.equal(other.disabled, false);
  assert.deepEqual(checks.scores[1], { points: 0.5, name: 'Barspin' });

  const lines = buttonFor('lines', false, 'line-1');
  const lineSave = press(lines);
  assert.equal(checks.writes[5].name, 'record_line_action_at_venue');
  receipt(5, { category: 'lines', points_awarded: 3, points_removed: 0, message: 'Line complete' });
  await lineSave;
  assert.equal(lines.disabled, true, 'Line completion still reconciles through its authoritative read');
  assert.equal(lines.dataset.assignmentAction, 'landed');
  assert.deepEqual(checks.scores[2], { points: 3, name: 'Barspin' });

  const linked = buttonFor('trick_links', false, 'trick-link');
  const linkedSave = press(linked);
  assert.equal(checks.writes[6].name, 'record_assignment_action_at_venue');
  receipt(6, tick);
  await linkedSave;
  assert.equal(linked.disabled, false);
  assert.equal(linked.dataset.assignmentAction, 'unlanded');

  for (const changed of ['navigation', 'setup', 'account', 'restriction']) {
    const button = buttonFor('dialled', false, `trick-${changed}`);
    const before = [checks.reads.length, checks.scores.length, checks.progress.length, checks.cache.length];
    const action = press(button);
    if (changed === 'navigation') fixture.state.loadingOverlayToken++;
    if (changed === 'setup') fixture.state.sessionSetupVersion++;
    if (changed === 'account') fixture.state.user = { id: 'new-rider' };
    if (changed === 'restriction') fixture.state.riderAccess = { features_disabled: true };
    receipt(checks.writes.length - 1, tick);
    await action;
    assert.equal(button.disabled, true, `No stale control repaint after changing ${changed}`);
    assert.deepEqual([checks.reads.length, checks.scores.length, checks.progress.length], before.slice(0, 3));
    assert.equal(checks.cache.length, before[3] + (['navigation', 'restriction'].includes(changed) ? 3 : 0));
  }
  fixture.state.riderAccess = null;
  const writes = checks.writes.length;
  await press(buttonFor('daily', false, 'daily-1'));
  assert.equal(checks.writes.length, writes);
  assert.equal(checks.daily.length, 1, 'Daily timers and bonuses use their existing separate save flow');
  checks.reads.forEach(read => read.release?.(true));
  console.log('PASS weekly save: server-ack release with reads held, correct rapid undo, no duplicate in-flight writes or award, error/unknown receipt, half/Lines/Links, current navigation and account, Daily routing');
})().catch(error => { console.error(error); process.exitCode = 1; });
