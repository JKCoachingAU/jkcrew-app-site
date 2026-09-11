const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function functionCode(name) {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `${name} exists`);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
}
const context = {
  Intl, Date,
  countryTimezones: { AU: 'Australia/Brisbane', CO: 'America/Bogota' },
  TRICKTIONARY_ALLOWED_CATEGORIES: new Set(['new', 'box', 'spine', 'air', 'hip']),
  TRICKTIONARY_CATEGORY_LABELS: { new: 'New Tricks', box: 'Box', spine: 'Spine', air: 'Air', hip: 'Hip' },
  categoryInfo: { daily: { label: 'Daily Tricks' }, lines: { label: 'Lines' }, dialled: { label: 'Dialled' } },
  PROFILE_SELECT: 'id,country_code',
};
vm.createContext(context);
vm.runInContext([
  'normalizeTrickKey', 'safeTricktionaryCategory', 'manualTricktionary', 'tricktionaryMeta',
  'resolveTricktionaryAlias', 'tricktionaryCategoryFromText', 'splitLineTricks', 'assignmentPresentation', 'tricktionaryLineComponents',
  'tricktionaryLandingDate', 'landedTricktionaryEntries', 'getTricktionaryPagedRows', 'getTricktionaryData',
].map(functionCode).join('\n'), context);
const aggregate = data => Array.from(context.landedTricktionaryEntries({ profile: { country_code: 'AU' }, ...data }));
const counts = data => Object.fromEntries(aggregate(data).map(entry => [entry.title, entry.count]));
const at = day => `2026-09-${day}T01:00:00Z`;
const assignment = (id, trick_name, category = 'daily', extra = {}) => ({ id, trick_name, category, ...extra });
const landing = (id, assignment_id, trick_name, category, day, extra = {}) => ({ id, assignment_id, trick_name, category, landed_at: at(day), landing_date: category === 'daily' ? `2026-09-${day}` : null, landed_count: 1, evidence_type: 'progress', ...extra });
const session = (id, trick_name, category, day, extra = {}) => ({ id, trick_name, category, created_at: at(day), status: 'landed', ...extra });

assert.deepEqual(counts({
  assignments: [assignment('daily', 'Barspin')],
  progress: [{ assignment_id: 'daily', progress_date: '2026-09-08', updated_at: at('08') }],
  landingHistory: [landing('daily:daily:07', 'daily', 'Barspin', 'daily', '07'), landing('daily:daily:08', 'daily', 'Barspin', 'daily', '08')],
  awards: [{ assignment_id: 'daily', award_key: 'daily-complete:Park:2026-09-08', points: 1, created_at: at('08') }, { assignment_id: 'daily', award_key: 'daily-under-20:Park:2026-09-08', points: 1, created_at: at('08') }],
  landedAttempts: [session('s1', 'Barspin', 'daily', '08'), session('s2', 'Barspin', 'daily', '08'), session('s3', 'Barspin', 'daily', '09'), session('s3', 'Barspin', 'daily', '09')],
}), { Barspin: 4 }, 'Daily dates accumulate; progress, history and two score bonuses do not duplicate session landings');

assert.deepEqual(counts({
  assignments: [assignment('d1', 'Barspin'), assignment('d2', 'Tailwhip')],
  awards: [{ assignment_id: 'd1', award_key: 'daily-complete:Park:2026-09-07', points: 1, created_at: at('07') }],
}), { Barspin: 1 }, 'A full-list award never invents landings for sibling assignments');

assert.deepEqual(counts({
  assignments: [assignment('p', 'Tailwhip', 'percentage')],
  landingHistory: [landing('percentage:p1', 'p', 'Tailwhip', 'percentage', '07', { evidence_type: 'percentage' }), landing('percentage:p2', 'p', 'Tailwhip', 'percentage', '07', { evidence_type: 'percentage' })],
  percentageAttempts: [
    { id: 'p1', assignment_id: 'p', landed: true, created_at: at('07') },
    { id: 'p2', assignment_id: 'p', landed: true, created_at: at('07') },
    { id: 'p3', assignment_id: 'p', landed: true, created_at: at('07') },
    { id: 'p4', assignment_id: 'p', landed: false, created_at: at('07') },
  ],
}), { Tailwhip: 3 }, 'Only landed percentage reps count and exact history/current ids deduplicate');
assert.deepEqual(counts({
  assignments: [assignment('p', 'Corrected percentage', 'percentage')],
  landingHistory: [
    landing('percentage:p1', 'p', 'Corrected percentage', 'percentage', '07', { evidence_type: 'revoked', landed_count: 0 }),
    landing('percentage:p2', 'p', 'Corrected percentage', 'percentage', '07', { evidence_type: 'percentage' }),
    landing('percentage:p3', 'p', 'Corrected percentage', 'percentage', '07', { evidence_type: 'percentage' }),
  ],
  percentageAttempts: ['p1', 'p2', 'p3'].map(id => ({ id, assignment_id: 'p', landed: true, created_at: at('07') })),
}), { 'Corrected percentage': 2 }, 'One revoked percentage rep excludes only its exact stale id, retaining the other same-day successes');

assert.deepEqual(counts({
  assignments: [assignment('d', 'Tuck', 'dialled', { target_reps: 3 })],
  progress: [{ assignment_id: 'd', completed_at: at('07'), streak_count: 1 }],
  landedAttempts: [session('s', 'Tuck', 'dialled', '07')],
}), { Tuck: 1 }, 'A single dialled tick is not multiplied by a target that was not performed');

assert.deepEqual(counts({ landingHistory: [landing('archived:1', 'removed', 'Newly recovered trick', 'one_bang', '07')] }), { 'Newly recovered trick': 1 }, 'Confirmed landings survive deletion or replacement of their original sheet');
assert.deepEqual(counts({ landingHistory: [landing('xp:x', 'removed', 'Recovered percentage trick', 'percentage', '07', { evidence_type: 'xp_percentage', landed_count: 7 })] }), { 'Recovered percentage trick': 7 }, 'Historical percentage evidence keeps its confirmed landed repetition count');

assert.deepEqual(counts({
  landingHistory: [
    landing('l1', 'line1', 'No-footer', 'lines', '07', { notes: 'Barspin - 360' }),
    landing('l2', 'line2', 'No-footer → Barspin → 360', 'lines', '08'),
  ],
}), { '360': 2, Barspin: 2, 'No-footer': 2 }, 'Both stored Line formats credit each named trick, preserving hyphenated trick names');
assert.deepEqual(counts({
  landingHistory: [landing('l1', 'line1', 'Manual', 'lines', '07', { notes: 'Barspin - 360' }), landing('l2', 'line2', 'Manual', 'lines', '07', { notes: 'Tailwhip - Tuck' }), landing('l3', 'line3', 'Barspin → Barspin → 180', 'lines', '07')],
}), { '180': 1, '360': 1, Barspin: 3, Manual: 2, Tailwhip: 1, Tuck: 1 }, 'Different Lines sharing their first trick retain the right components, including repeated tricks within one line');
assert.deepEqual(counts({
  assignments: [assignment('line', 'Manual', 'lines', { notes: 'Brand new trick - Another new trick' })],
  progress: [{ assignment_id: 'line', completed_at: at('07') }],
  landingHistory: [landing('assignment:line', 'line', 'Manual', 'lines', '07', { notes: 'Barspin - 360' })],
  awards: [{ assignment_id: 'line', award_key: 'lines:line', points: 2, created_at: at('07') }],
}), { '360': 1, Barspin: 1, Manual: 1 }, 'Editing a completed Line later does not turn its old completion into landings of the new tricks');
assert.deepEqual(counts({ landingHistory: [landing('l', 'line', 'Manual', 'lines', '07', { notes: 'Keep looking ahead' })] }), { Manual: 1 }, 'Free-form notes do not become invented tricks');
assert.deepEqual(counts({ landingHistory: [landing('l', 'line', '360 SWITCH DOWNY FAT SPINE | FLAIR BAR 10FT | TRIPLE TRUCK FAT SPINE', 'lines', '07')] }), { '360 SWITCH DOWNY FAT SPINE': 1, 'FLAIR BAR 10FT': 1, 'TRIPLE TRUCK FAT SPINE': 1 }, 'Explicit pipe-separated Lines credit each confirmed trick');
assert.deepEqual(counts({ landingHistory: [landing('l', 'line', 'CANNON BALL BOX', 'lines', '07', { notes: 'INDIAN AIR - OPPO AIR 10ft over coping - NO FOOT CAN FAT SPINE - ALLEYOOP TBOG' })] }), { 'ALLEYOOP TBOG': 1, 'CANNON BALL BOX': 1, 'INDIAN AIR': 1, 'NO FOOT CAN FAT SPINE': 1, 'OPPO AIR 10ft over coping': 1 }, 'Confirmed five-trick Lines retain every component');
assert.deepEqual(counts({ landingHistory: [landing('l', 'line', 'FLIP BOX -NO FOOT CAN FAT SPINE', 'lines', '07', { notes: 'NO HANDER AIR - DOWNWHIP AIR' })] }), { 'DOWNWHIP AIR': 1, 'FLIP BOX': 1, 'NO FOOT CAN FAT SPINE': 1, 'NO HANDER AIR': 1 }, 'A dash with spacing on only one side still separates older Line input');
assert.deepEqual(counts({ landingHistory: [landing('l', 'line', 'X-UP - Manual - Barspin', 'lines', '07', { notes: 'Keep looking ahead' })] }), { Barspin: 1, Manual: 1, 'X-UP': 1 }, 'A complete title sequence preserves X-UP and does not append ordinary notes');
assert.deepEqual(counts({ landingHistory: [landing('l', 'line', 'Manual - Barspin', 'lines', '07', { notes: 'Keep looking ahead' })] }), { 'Manual - Barspin': 1 }, 'A single prose note is not inferred as the third trick in an ambiguous title');
assert.deepEqual(counts({
  assignments: [assignment('x', 'Unticked', 'one_bang')],
  progress: [{ assignment_id: 'x', completed_at: null, updated_at: at('07') }],
  attempts: [{ assignment_id: 'x', trick_name: 'Only attempted' }],
  landedAttempts: [session('miss', 'Missed session trick', 'one_bang', '07', { status: 'missed' })],
  profile: { rider_extra_tricks: [{ title: 'Worked on', completed: true }] },
}), {}, 'Unticked, missed, generic attempts and Working On checkmarks are not landings');
assert.deepEqual(counts({
  assignments: [assignment('d', 'Corrected daily')],
  progress: [{ assignment_id: 'd', progress_date: '2026-09-07', updated_at: at('07') }],
  landingHistory: [landing('daily:d:07', 'd', 'Corrected daily', 'daily', '07', { evidence_type: 'revoked', landed_count: 0 }), landing('daily:d:06', 'd', 'Corrected daily', 'daily', '06')],
  awards: [{ assignment_id: 'd', award_key: 'daily-complete:Park:2026-09-07', points: 1, created_at: at('07') }],
  landedAttempts: [session('s', 'Corrected daily', 'daily', '07')],
}), { 'Corrected daily': 1 }, 'An explicit untick blocks stale same-day progress, awards and session evidence while retaining earlier dates');

assert.deepEqual(counts({
  profile: { tricktionary_meta: { aliases: { 'old name': 'new name' }, titles: { 'new name': 'Renamed trick' }, hidden: { hidden: true } }, manual_tricktionary: [{ id: 'manual', title: 'Old Name', count: 4 }] },
  landingHistory: [landing('x1', 'one', 'Old Name', 'one_bang', '07'), landing('x2', 'two', 'Hidden', 'one_bang', '07'), landing('x3', 'three', 'Foam flair', 'foam_pit', '07')],
}), { 'Renamed trick': 5 }, 'Manual history stays additive, renamed aliases combine, deliberate deletions and foam stay excluded');
assert.deepEqual(counts({
  profile: { tricktionary_meta: { hidden: { 'manual → barspin → 360': true } } },
  landingHistory: [landing('line', 'line', 'Manual → Barspin → 360', 'lines', '07')],
}), {}, 'Splitting a historical Line does not bypass deliberate deletion of that Line card');
assert.deepEqual(counts({
  profile: { tricktionary_meta: { aliases: { 'manual → barspin → 360': 'competition line' }, titles: { 'competition line': 'Competition Line' } }, manual_tricktionary: [{ id: 'manual', title: 'Competition Line', count: 3 }] },
  landingHistory: [landing('line', 'line', 'Manual → Barspin → 360', 'lines', '07')],
}), { 'Competition Line': 4 }, 'An intentionally renamed or merged full-Line card keeps its existing canonical organisation and additive manual history');
assert.equal(context.tricktionaryLandingDate('2026-09-08T01:00:00Z', { country_code: 'CO' }), '2026-09-07', 'Daily source matching uses the rider local date');

async function queryChecks() {
  const calls = [];
  const pages = Array.from({ length: 801 }, (_, i) => ({ id: String(i), status: 'landed' }));
  const query = name => {
    const q = {};
    for (const operation of ['select', 'eq', 'order', 'limit']) q[operation] = (...args) => { calls.push([name, operation, ...args]); return q; };
    q.single = async () => ({ data: { id: 'rider' } });
    q.range = async (from, to) => { calls.push([name, 'range', from, to]); return { data: name === 'trick_attempts' || name === 'get_tricktionary_landing_history' ? pages.slice(from, to + 1) : [] }; };
    q.then = resolve => resolve({ data: [] });
    return q;
  };
  context.client = { from: query, rpc: (name, args) => { calls.push([name, 'rpc', args]); return query(name); } };
  const data = await context.getTricktionaryData('rider');
  assert.equal(data.landingHistory.length, 801);
  assert.equal(data.landedAttempts.length, 801);
  assert(calls.some(call => call[0] === 'trick_attempts' && call[1] === 'eq' && call[2] === 'status' && call[3] === 'landed'));
  assert(calls.some(call => call[0] === 'get_tricktionary_landing_history' && call[1] === 'range' && call[2] === 800));
  context.client.rpc = () => ({ order: () => ({ range: async () => ({ error: new Error('History unavailable') }) }) });
  await assert.rejects(context.getTricktionaryData('rider'), /History unavailable/, 'Missing history must surface an error, not a misleading incomplete library');
}
queryChecks().then(() => console.log('PASS: Tricktionary source coverage, daily history, safe deduplication, line components, corrections and paged reads.')).catch(error => { console.error(error); process.exitCode = 1; });
