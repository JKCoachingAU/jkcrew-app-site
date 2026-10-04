const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const weeklyCategories = ['dialled', 'one_bang', 'foam', 'foam_pit', 'bonus', 'percentage', 'lines'];
const today = '2026-10-04';
const completedAt = `${today}T02:00:00Z`;

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

for (const entry of ['app.js', 'riley-test/app.js']) {
  const source = fs.readFileSync(path.join(root, entry), 'utf8');
  const extractFunction = name => {
    const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
    assert(start >= 0, `${entry}: actual ${name} exists`);
    const tail = source.slice(start);
    const end = tail.indexOf('\n}');
    assert(end >= 0, `${entry}: ${name} closes`);
    return tail.slice(0, end + 2);
  };
  const extractConstant = name => {
    const match = source.match(new RegExp(`^const ${name} = .+;$`, 'm'));
    assert(match, `${entry}: actual ${name} exists`);
    return match[0];
  };
  const clock = { date: today };
  const state = {
    profile: { country_code: 'AU' },
    pendingAssignmentProgress: new Map(),
    pendingPercentageAttempts: new Map(),
  };
  // Only country/date lookup and application state are supplied by the fixture.
  // Completion filtering, daily resets, optimistic progress and percentage
  // attempt deduplication all use the shipped implementation.
  const context = vm.createContext({ state, dateForCountryCode: () => clock.date });
  vm.runInContext([
    ...['completionCategories', 'completionAssignments', 'PENDING_PROGRESS_TTL_MS'].map(extractConstant),
    ...['assignmentLocalDate', 'pendingAssignmentState', 'percentageAttemptsByNumber', 'isAssignmentComplete', 'weeklyCompletionPercent'].map(extractFunction),
    'this.helpers = { completionAssignments, isAssignmentComplete, weeklyCompletionPercent };',
  ].join('\n'), context, { filename: entry });
  const { completionAssignments, isAssignmentComplete, weeklyCompletionPercent } = context.helpers;
  const weekly = (category, complete, id = category) => ({
    id, category,
    progress: { completed_at: complete ? completedAt : null },
    percentageAttempts: category === 'percentage'
      ? Array.from({ length: complete ? 10 : 9 }, (_, index) => ({ attempt_number: index + 1, landed: false }))
      : [],
  });
  const daily = (id, complete, venue = 'AREA 51') => ({
    id, category: 'daily', venue,
    progress: { progress_date: complete ? today : null, completed_at: complete ? completedAt : null },
  });
  const dailyAwards = freezeDeep(Array.from({ length: 7 }, (_, index) => ({
    assignment_id: `daily-${index}`, points: 2,
    award_key: `daily-complete:2026-09-${21 + index}`,
    created_at: completedAt,
  })));
  let checks = 0;
  const check = (label, assignments, expectedDone, expectedTotal, expectedPercent, awards = []) => {
    const before = JSON.stringify({ assignments, awards });
    freezeDeep(assignments);
    freezeDeep(awards);
    const included = completionAssignments(assignments);
    assert.equal(included.length, expectedTotal, `${entry}: ${label}: weekly denominator`);
    assert.equal(included.filter(isAssignmentComplete).length, expectedDone, `${entry}: ${label}: weekly numerator`);
    assert.equal(weeklyCompletionPercent(assignments, awards), expectedPercent, `${entry}: ${label}: completion percentage`);
    assert.equal(JSON.stringify({ assignments, awards }), before, `${entry}: ${label}: inputs remain unchanged`);
    checks += 1;
  };

  const halfDone = [weekly('one_bang', true), weekly('dialled', false)];
  check('one of two weekly items complete', halfDone, 1, 2, 50);
  check('incomplete Daily cannot lower weekly completion', [weekly('lines', true), daily('unfinished', false)], 1, 1, 100);
  check('completed Daily cannot raise weekly completion', [weekly('lines', false), daily('finished', true)], 0, 1, 0);
  for (const count of [1, 14, 60]) {
    for (const complete of [false, true]) {
      const dailies = Array.from({ length: count }, (_, index) => daily(`daily-${index}`, complete, `Park ${index % 4}`));
      check(`${count} ${complete ? 'completed' : 'incomplete'} Daily items across venues`, [...halfDone, ...dailies], 1, 2, 50, dailyAwards);
    }
  }
  check('Daily awards do not count as weekly completions', halfDone, 1, 2, 50, dailyAwards);
  check('completed Daily only', [daily('daily-only', true)], 0, 0, 0, dailyAwards);
  check('incomplete Daily only', [daily('daily-only', false)], 0, 0, 0);
  check('empty sheet', [], 0, 0, 0, dailyAwards);

  const resetDaily = daily('midnight-daily', true);
  assert.equal(isAssignmentComplete(resetDaily), true, `${entry}: Daily is complete before its date resets`);
  check('before Daily date reset', [...halfDone, resetDaily], 1, 2, 50, dailyAwards);
  clock.date = '2026-10-05';
  assert.equal(isAssignmentComplete(resetDaily), false, `${entry}: Daily is incomplete after its date resets`);
  check('after Daily date reset', [...halfDone, resetDaily], 1, 2, 50, dailyAwards);
  clock.date = today;
  state.pendingAssignmentProgress.set(resetDaily.id, { complete: false, time: Date.now() });
  check('optimistic Daily reset', [...halfDone, resetDaily], 1, 2, 50, dailyAwards);
  state.pendingAssignmentProgress.set(resetDaily.id, { complete: true, time: Date.now() });
  check('optimistic Daily completion', [...halfDone, resetDaily], 1, 2, 50, dailyAwards);
  state.pendingAssignmentProgress.clear();

  const allWeekly = weeklyCategories.map(category => weekly(category, true));
  assert.deepEqual(Array.from(completionAssignments(allWeekly), row => row.category), weeklyCategories, `${entry}: all established weekly categories remain eligible`);
  check('all weekly categories complete', [...allWeekly, daily('unfinished', false)], 7, 7, 100);
  for (const completedCategory of weeklyCategories) {
    check(`only ${completedCategory} complete`, weeklyCategories.map(category => weekly(category, category === completedCategory)), 1, 7, 14);
  }

  const percentage = weekly('percentage', false);
  check('nine percentage attempts remain incomplete', [percentage], 0, 1, 0);
  check('duplicate percentage attempt does not become a tenth attempt', [{
    ...percentage, percentageAttempts: [...percentage.percentageAttempts, { attempt_number: 9, landed: true }],
  }], 0, 1, 0);
  check('ten percentage attempts complete even when all missed', [weekly('percentage', true)], 1, 1, 100);
  state.pendingPercentageAttempts.set('percentage:10', { attemptNumber: 10, landed: false, time: Date.now() });
  check('pending tenth percentage attempt counts', [percentage, daily('unfinished', false)], 1, 1, 100);
  state.pendingPercentageAttempts.clear();

  console.log(`${entry}: ${checks} weekly completion checks passed`);
}
