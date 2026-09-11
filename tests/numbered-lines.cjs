const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const names = [
  'splitLineTricks', 'assignmentPresentation', 'assignmentLinesForEditor',
  'parseAssignmentLine', 'sessionViewerAssignmentEditor', 'saveSessionViewerAssignments',
  'sessionViewerAssignmentsForList', 'sessionViewerListContent'
];
const code = names.map(name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `${name} exists`);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
}).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));
const escapeHtml = (value = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const unescapeHtml = value => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#039;', "'").replaceAll('&amp;', '&');
const fields = html => [...html.matchAll(/<textarea\b[^>]*name="numberedLine"[^>]*>([\s\S]*?)<\/textarea>/g)].map(match => unescapeHtml(match[1]));
let saved, rpcName;
const c = {
  escapeHtml, categoryDisplayInfo: () => ({ label: 'Lines' }), categoryInfo: { lines: {} },
  state: { profile: { role: 'coach' }, user: { id: 'coach' }, selectedAthleteId: 'rider', sessionViewerRosterCache: [{ id: 'rider', country_code: 'AU' }] },
  FormData: class { constructor(form) { this.values = form.values; } getAll(name) { assert.equal(name, 'numberedLine'); return this.values; } },
  isCoachRole: role => role === 'coach', isAssignmentComplete: row => Boolean(row.progress?.completed_at),
  assignmentStatus: row => row.progress?.completed_at ? 'Done this week' : 'To do this week',
  setButtonBusy: () => () => {}, weekStartDate: () => '2026-09-07', weekStartDateForCountry: () => '2026-09-07',
  client: { rpc: async (name, args) => { rpcName = name; saved = plain(args); return {}; } },
  withTimeout: promise => promise, clearCoachCaches: () => {}, notify: () => {}, refreshSessionViewerLight: async () => {},
};
vm.createContext(c); vm.runInContext(code, c);
const sourceLines = [
  { id: 'line-1', athlete_id: 'rider', category: 'lines', trick_name: 'TRUCK BOX', notes: 'CAN CAN 10ft - NO HANDER FAT SPINE - FLAIR', progress: { completed_at: '2026-09-09' } },
  { id: 'line-2', athlete_id: 'rider', category: 'lines', trick_name: 'CANNON BALL BOX', notes: 'INDIAN AIR - OPPO AIR 10ft over copping - NO FOOT CAN FAT SPINE - ALLEYOOP TBOG', progress: {} },
  { id: 'line-3', athlete_id: 'rider', category: 'lines', trick_name: 'FLIP BOX -NO FOOT CAN FAT SPINE', notes: 'NO HANDER AIR - DOWNWHIP AIR', progress: { completed_at: '2026-09-09' } },
];
const expectedTitles = [
  'TRUCK BOX → CAN CAN 10ft → NO HANDER FAT SPINE → FLAIR',
  'CANNON BALL BOX → INDIAN AIR → OPPO AIR 10ft over copping → NO FOOT CAN FAT SPINE → ALLEYOOP TBOG',
  'FLIP BOX → NO FOOT CAN FAT SPINE → NO HANDER AIR → DOWNWHIP AIR',
];
const snapshot = plain(sourceLines);
(async () => {
  assert.deepEqual(plain(c.splitLineTricks(' X-UP 10FT | No-footer -> AIR - FLAIR- DOWNWHIP -SWITCH ')),
    ['X-UP 10FT', 'No-footer', 'AIR', 'FLAIR', 'DOWNWHIP', 'SWITCH'], 'Mixed separators preserve hyphens within trick names');
  assert.deepEqual(plain(c.splitLineTricks('→ | -> - ')), [], 'Empty separator runs do not invent steps');
  assert.deepEqual(sourceLines.map(row => plain(c.assignmentPresentation(row))), expectedTitles.map(title => ({ title, notes: '' })),
    'The actual three screenshot lines show every step, including the five-step line');
  for (const [trick_name, notes, title] of [
    ['TRUCK BOX', 'ALLEYOOP WHIP - TABLE 10FT - SUPERMAN FAT SPINE - 540 air', 'TRUCK BOX → ALLEYOOP WHIP → TABLE 10FT → SUPERMAN FAT SPINE → 540 air'],
    ['360 WHIP', 'SWITCH FLAIR - BAR AIR 10ft - DISCO FAT SPINE - FLAIR', '360 WHIP → SWITCH FLAIR → BAR AIR 10ft → DISCO FAT SPINE → FLAIR'],
  ]) assert.deepEqual(plain(c.assignmentPresentation({ category: 'lines', trick_name, notes })), { title, notes: '' },
    'The latest screenshot Lines 1 and 3 show all five tricks in the main label');
  const mixed = 'FLIP BOX- DOWNWHIP AIR → X-UP 10FT → 360 FAT SPINE → SWITCH DOWNWHIP AIR';
  const mixedExpected = 'FLIP BOX → DOWNWHIP AIR → X-UP 10FT → 360 FAT SPINE → SWITCH DOWNWHIP AIR';
  assert.deepEqual(plain(c.assignmentPresentation({ category: 'lines', trick_name: mixed, notes: 'Stay low - keep speed' })),
    { title: mixedExpected, notes: 'Stay low - keep speed' }, 'Mixed dash/arrow title is normalized while coaching notes stay separate');
  assert.deepEqual(plain(c.assignmentPresentation({ category: 'lines', trick_name: 'Manual | Barspin -> 180', notes: 'Stay low - keep speed' })),
    { title: 'Manual → Barspin → 180', notes: 'Stay low - keep speed' }, 'An explicit line does not absorb coaching advice');
  assert.deepEqual(plain(c.assignmentPresentation({ category: 'lines', trick_name: 'Manual', notes: 'Stay low' })),
    { title: 'Manual', notes: 'Stay low' }, 'A single coaching note is not treated as another trick');
  assert.deepEqual(plain(c.assignmentPresentation({ category: 'daily', trick_name: 'X-UP - Air', notes: 'Stay low - keep speed' })),
    { title: 'X-UP - Air', notes: 'Stay low - keep speed' }, 'Other training categories keep their presentation');
  const longSteps = Array.from({ length: 8 }, (_, index) => `Trick ${index + 1}`);
  assert.equal(c.assignmentPresentation({ category: 'lines', trick_name: longSteps[0], notes: longSteps.slice(1).join(' - ') }).title,
    longSteps.join(' → '), 'Longer legacy lines have no four-step display limit');

  const entry = { athlete: { id: 'rider' }, venue: '', assignments: sourceLines };
  const editorHtml = c.sessionViewerAssignmentEditor(entry, 'lines', sourceLines);
  assert.equal(fields(editorHtml).length, 3, 'Each complete line has its own editor field');
  for (const n of [1, 2, 3]) assert(editorHtml.includes(`Line ${n}`));
  assert(!editorHtml.includes('name="assignmentLines"'), 'The Lines editor does not share a multiline list field');
  assert(!/<details\b[^>]*\sopen(?:\s|>)/.test(editorHtml), 'The editor still starts closed');
  assert.deepEqual(fields(editorHtml), sourceLines.map(row => `${row.trick_name} - ${row.notes}`), 'Opening the editor preserves full stored names, notes and order');
  assert.equal(c.assignmentLinesForEditor(sourceLines), fields(editorHtml).join('\n'));
  assert.equal(fields(c.sessionViewerAssignmentEditor(entry, 'lines', [])).length, 3, 'A new sheet starts with three numbered boxes');
  assert.equal(fields(c.sessionViewerAssignmentEditor(entry, 'lines', [...sourceLines, sourceLines[0]])).length, 4, 'Additional existing lines remain editable');

  const rendered = c.sessionViewerListContent(entry, null, 'lines');
  for (const [index, title] of expectedTitles.entries()) {
    assert(rendered.includes(`<strong>${escapeHtml(title)}</strong>`), `Line ${index + 1} has its entire sequence in the main label`);
    assert(rendered.includes(`data-assignment-id="line-${index + 1}"`), 'Completion buttons retain their original assignment IDs');
  }
  assert(rendered.includes('Lines · 2/3 complete'), 'Display normalization preserves the actual completion state');
  assert.deepEqual(sourceLines, snapshot, 'Rendering and opening the editor do not mutate saved rows or progress');

  const save = async values => {
    saved = undefined;
    await c.saveSessionViewerAssignments({ preventDefault() {}, currentTarget: {
      values, dataset: { athleteId: 'rider', viewerAssignmentEditor: 'lines' }, querySelector: () => ({})
    } });
    assert(saved, 'Save submits through the real editor handler');
    assert.equal(rpcName, 'save_weekly_assignment_list');
    assert.equal(saved.p_athlete_id, 'rider'); assert.equal(saved.p_category, 'lines');
    return saved.p_assignments;
  };
  const result = await save(fields(editorHtml));
  assert.equal(result.length, 3);
  result.forEach((row, index) => {
    assert.equal(row.trick_name, sourceLines[index].trick_name, 'An unchanged save preserves the existing stored title used to retain completion');
    assert.equal(row.notes, sourceLines[index].notes, 'An unchanged save preserves the full sequence without truncation');
    assert.equal(row.sort_order, index, 'Line order survives saving');
    assert.equal(c.assignmentPresentation(row).title, expectedTitles[index]);
  });
  const secondEdit = c.sessionViewerAssignmentEditor(entry, 'lines', result);
  assert.deepEqual(fields(secondEdit), fields(editorHtml), 'All three complete lines survive an editor/save/editor round trip');
  const wrapped = fields(editorHtml).map((text, index) => index === 1 ? text.replace(' - OPPO', '\n - OPPO') : text);
  const wrappedResult = await save(wrapped);
  assert.equal(wrappedResult.length, 3, 'A visual newline within a field never becomes a fourth line');
  assert.deepEqual(wrappedResult, result, 'A newline inside a numbered box preserves the same complete run');
  const mixedResult = await save([mixed, ...fields(editorHtml).slice(1)]);
  assert.equal(mixedResult[0].trick_name, mixed, 'Saving a mixed-separator title leaves its stored identity unchanged');
  assert.equal(c.assignmentPresentation(mixedResult[0]).title, mixedExpected);
  assert.deepEqual(sourceLines, snapshot, 'Saving a copy of the fields does not mutate loaded assignment rows');
  if (process.env.JKCREW_NUMBERED_LINES_FIXTURE) fs.writeFileSync(process.env.JKCREW_NUMBERED_LINES_FIXTURE, rendered);
  console.log('PASS: complete five/eight-step lines, mixed separators and hyphenated tricks, coaching notes, unchanged completion IDs, three numbered editor fields, and real parser/save round trips without lost steps.');
})().catch(error => { console.error(error); process.exit(1); });
