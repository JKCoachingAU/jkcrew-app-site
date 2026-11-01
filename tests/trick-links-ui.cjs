// Exercise production renderers/parsers/handlers. Only data transport and unrelated
// page refresh dependencies are fixtures; database scoring has separate SQL tests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const constant = (name, close = '\n};') => {
  const start = app.indexOf(`const ${name} = `);
  assert(start >= 0, `Actual ${name} exists`);
  return app.slice(start, app.indexOf(close, start) + close.length);
};
const names = [
  'profileGroupNames', 'isContestPrepProfile', 'categoryDisplayInfo',
  'splitLineTricks', 'parseTrickLinkInput', 'assignmentPresentation', 'assignmentLinesForEditor', 'parseAssignmentLine',
  'pendingAssignmentState', 'setPendingAssignmentProgress', 'clearPendingAssignmentProgress',
  'percentageAttemptsByNumber', 'isAssignmentComplete', 'assignmentStatus', 'reconcileAwardedProgress',
  'weeklyCompletionPercent', 'assignmentList', 'assignmentGroups', 'percentageAssignmentList',
  'sessionViewerAssignmentsForList', 'sessionViewerAssignmentEditor', 'sessionViewerListContent',
  'sessionViewerRiderCountersHtml', 'activeSessionViewerList', 'sessionViewerTabsForEntry',
  'sessionViewerListCount', 'sessionViewerPlanList', 'saveSessionViewerAssignments',
  'recordAssignmentAction', 'setButtonBusy',
  'trickLinksProposalEditorHtml', 'optionalTrickLinksFromForm', 'riderProposalItemFromLine',
  'riderProposalItemInputValue', 'coachProposalEditorFields', 'editedCoachProposalPayload',
  'submitTrickRequest', 'generateWeeklyNotificationPreviews',
];
const code = [
  'const PENDING_PROGRESS_TTL_MS = 120000; const contestPrepGroupId = "contest_prep";',
  ...['categoryInfo', 'categoryRewardLabels', 'contestPrepCategoryInfo', 'riderProposalRequirements', 'trickRequestCategoryLabels'].map(name => constant(name)),
  constant('sessionViewerListTabs', '\n];'),
  app.match(/^const completionCategories = .*;$/m)[0],
  app.match(/^const completionAssignments = .*;$/m)[0],
  ...names.map(extract),
].join('\n');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  let checks = 0;
  const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const ok = (actual, message) => { assert(actual, message); checks++; };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"><div class="app-shell" style="display:block"><main id="view" class="content" data-view="session"></main></div></div></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.evaluate(() => {
      window.state = {
        user: { id: 'rider' }, profile: { role: 'athlete' }, view: 'session', selectedAthleteId: 'rider',
        selectedVenue: 'Park', sessionOpenAssignmentSections: new Set(['trick_links']),
        pendingAssignmentProgress: new Map(), pendingPercentageAttempts: new Map(),
        sessionViewerOpenAthleteId: 'rider', sessionViewerActiveList: 'trick_links',
        sessionViewerRosterCache: [{ id: 'rider', country_code: 'AU' }],
      };
      window.rows = [
        { id: 'pair-1', athlete_id: 'rider', category: 'trick_links', trick_name: 'X-UP -> No-footer', notes: 'Keep speed', progress: {} },
        { id: 'pair-2', athlete_id: 'rider', category: 'trick_links', trick_name: 'Barspin → Tailwhip', notes: '', progress: { completed_at: '2026-10-28T10:00:00Z' } },
      ];
      window.entry = { athlete: { id: 'rider', display_name: 'Test Rider', country_code: 'AU' }, venue: 'Park', assignments: rows };
      window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
      window.isCoachRole = role => role === 'coach';
      window.weekStartDate = window.weekStartDateForCountry = () => '2026-10-26';
      window.venueLabel = value => value || 'Park';
      window.assignmentLocalDate = () => '2026-10-29';
      window.assignmentsForVenue = (items, venue) => items.filter(item => item.venue === venue);
      window.otherLandedHost = window.dailyVenueGroups = () => '';
      window.messages = []; window.calls = []; window.scoreFeedback = []; window.refreshes = 0;
      window.mode = { error: null, hold: false };
      window.notify = (message, tone) => messages.push({ message, tone });
      window.messageFrom = error => error.message;
      window.withTimeout = promise => promise;
      window.clearCoachCaches = window.cacheClear = window.setSyncStatus = window.refreshOpenTrainingProgress = () => {};
      window.refreshOwnXpAfterAction = async () => {};
      window.showUpdatedWeeklyScore = async (points, trickName) => scoreFeedback.push({ points, trickName });
      window.refreshSessionViewerLight = async () => { refreshes++; };
      window.client = { rpc: async (name, args) => {
        calls.push({ name, args: structuredClone(args) });
        if (mode.hold) await new Promise(resolve => { window.release = resolve; });
        return { data: null, error: mode.error };
      } };
      window.saveProgressRpc = async (name, args) => {
        calls.push({ name, args: structuredClone(args) });
        if (mode.hold) await new Promise(resolve => { window.release = resolve; });
        if (mode.error) return { error: mode.error };
        const item = rows.find(row => row.id === args.p_assignment_id);
        item.progress = args.p_action === 'landed' ? { completed_at: '2026-10-29T12:00:00Z' } : {};
        return { data: { message: args.p_action === 'landed' ? 'Trick Link completed' : 'Completion removed', points_awarded: args.p_action === 'landed' ? 2 : 0, points_removed: args.p_action === 'unlanded' ? 2 : 0 } };
      };
    });
    await page.addScriptTag({ content: code + `
      window.mountRider = () => {
        state.view = 'session'; state.profile = {role: 'athlete'}; state.user = {id: 'rider'};
        document.querySelector('#view').dataset.view = 'session';
        document.querySelector('.app-shell').classList.remove('coach-shell');
        document.querySelector('#view').innerHTML = assignmentGroups(rows, true, state.profile, 'Park');
        document.querySelectorAll('[data-assignment-action]').forEach(button => button.addEventListener('click', event => { window.pending = recordAssignmentAction(event); }));
      };
      window.renderSession = window.renderAthleteHome = async () => mountRider();
      window.mountCoach = () => {
        state.view = 'sessionViewer'; state.profile = {role: 'coach'}; state.user = {id: 'coach'};
        document.querySelector('#view').dataset.view = 'sessionViewer';
        document.querySelector('.app-shell').classList.add('coach-shell');
        document.querySelector('#view').innerHTML = '<article class="viewer-rider-accordion open">' + sessionViewerRiderCountersHtml(entry) + sessionViewerPlanList(entry, null) + '</article>';
        document.querySelector('[data-viewer-assignment-editor]').addEventListener('submit', event => { window.pending = saveSessionViewerAssignments(event); });
      };
      mountRider();
    ` });

    eq(await page.evaluate(() => parseAssignmentLine('X-UP->No-footer - Keep speed - flow', 3, 'trick_links')),
      { coach_id: 'rider', athlete_id: 'rider', week_start: '2026-10-26', trick_name: 'X-UP → No-footer', category: 'trick_links', venue: '', target_reps: 1, notes: 'Keep speed - flow', sort_order: 3 },
      'A pair stays one assignment, normalized without splitting hyphenated names or notes');
    eq(await page.evaluate(() => parseAssignmentLine('', 0, 'trick_links')), null, 'Blank editor rows do not create links');
    for (const [input, expectedName, expectedNotes] of [
      ['Barspin - Tailwhip', 'Barspin → Tailwhip', ''],
      ['X-UP - No-footer', 'X-UP → No-footer', ''],
      ['Barspin | Tailwhip', 'Barspin → Tailwhip', ''],
      ['Barspin\nTailwhip', 'Barspin → Tailwhip', ''],
      ['  Barspin -> Tailwhip  ', 'Barspin → Tailwhip', ''],
      ['Barspin → Tailwhip - Keep speed - stay low', 'Barspin → Tailwhip', 'Keep speed - stay low'],
      ['Barspin | Tailwhip - Keep speed', 'Barspin → Tailwhip', 'Keep speed'],
    ]) {
      const parsed = await page.evaluate(input => parseAssignmentLine(input, 0, 'trick_links'), input);
      eq([parsed.trick_name, parsed.notes, parsed.target_reps], [expectedName, expectedNotes, 1], `Coach pair syntax saves as one complete link: ${input}`);
    }
    const oversized = `${'A'.repeat(116)} → Tailwhip`;
    eq(await page.evaluate(text => parseAssignmentLine(text, 0, 'trick_links').trick_name, oversized), oversized,
      'Oversized input reaches server validation intact instead of silently cutting off the second trick');
    eq(await page.evaluate(() => categoryDisplayInfo('trick_links', { groupNames: ['contest_prep'] }).description),
      'Land 2 tricks back to back · 2 points per completed link', 'Contest Prep still describes the two-point reward');
    eq(await page.evaluate(() => weeklyCompletionPercent([...rows, { category: 'daily', progress: { progress_date: '2026-10-29' } }], [])), 50,
      'Weekly completion counts complete pairs once and continues to exclude Daily rows');
    eq(await page.evaluate(() => isAssignmentComplete({ ...rows[0], progress: { landed_count: 1 } })), false,
      'One component or a landing count does not complete the pair');
    eq(await page.evaluate(() => reconcileAwardedProgress(rows[0], null, [{ points: 2, created_at: '2026-10-28T10:00:00Z' }]).completed_at),
      '2026-10-28T10:00:00Z', 'A saved two-point award can restore existing completion when loading progress');
    eq(await page.locator('[data-assignment-section="trick_links"] .assignment-row').count(), 2, 'Rider sees one row per pair');
    eq(await page.locator('[data-assignment-section="trick_links"] .category-reward-pill').textContent(), '2 pts per link');
    eq(await page.locator('[data-assignment-section="trick_links"] .category-count').innerText(), '1/2');

    await page.evaluate(() => { mode.hold = true; const button = document.querySelector('[data-assignment-id="pair-1"]'); button.click(); button.click(); });
    await page.waitForFunction(() => typeof window.release === 'function');
    eq(await page.evaluate(() => calls.length), 1, 'Two rapid native taps submit only one completion');
    ok(await page.locator('[data-assignment-id="pair-1"]').isDisabled(), 'Completion disables the control while saving');
    eq(await page.evaluate(() => calls[0]), { name: 'record_assignment_action_at_venue', args: { p_assignment_id: 'pair-1', p_action: 'landed', p_venue: 'Park' } },
      'Trick Links use standard server scoring, not three-point Lines scoring');
    await page.evaluate(() => { mode.hold = false; release(); }); await page.evaluate(() => pending);
    eq(await page.locator('[data-assignment-section="trick_links"] .category-count').innerText(), '2/2', 'Saved completion refreshes the section');
    eq(await page.evaluate(() => scoreFeedback), [{ points: 2, trickName: 'X-UP → No-footer' }], 'Two-point server response appears in score feedback');
    eq(await page.locator('[data-assignment-id="pair-1"]').getAttribute('data-assignment-action'), 'unlanded', 'Saved pair has an undo action');
    await page.locator('[data-assignment-id="pair-1"]').click(); await page.evaluate(() => pending);
    eq(await page.locator('[data-assignment-section="trick_links"] .category-count').innerText(), '1/2', 'Undo returns the pair to incomplete');
    await page.evaluate(() => { mode.error = { message: 'Connection interrupted. Please retry.' }; });
    await page.locator('[data-assignment-id="pair-1"]').click(); await page.evaluate(() => pending);
    eq(await page.locator('[data-assignment-id="pair-1"]').innerText(), '', 'Failed save rolls back optimistic completion');
    ok(await page.locator('[data-assignment-id="pair-1"]').isEnabled(), 'Failed completion remains retryable');
    eq(await page.evaluate(() => state.pendingAssignmentProgress.has('pair-1')), false, 'Failed completion does not leave stale pending progress');

    await page.evaluate(() => { mode.error = null; calls.length = 0; mountCoach(); });
    eq(await page.locator('[data-viewer-list-tab="trick_links"]').count(), 1, 'Coach has a Trick Links tab');
    eq(await page.locator('[data-viewer-counter="trick_links"] strong').innerText(), '1/2', 'Coach counter counts pairs');
    eq(await page.locator('.viewer-line-number').allTextContents(), ['Link 1', 'Link 2']);
    await page.locator('.viewer-edit-panel > summary').click();
    const editors = page.locator('[data-viewer-assignment-editor="trick_links"] textarea[name="numberedLink"]');
    eq(await editors.count(), 3, 'Trick Links use three numbered boxes, like Lines');
    eq(await page.locator('[data-viewer-assignment-editor="trick_links"] textarea[name="assignmentLines"]').count(), 0,
      'The coach editor no longer presents pairs as one ambiguous bulk textarea');
    eq(await editors.evaluateAll(fields => fields.map(field => field.value)), ['X-UP -> No-footer - Keep speed', 'Barspin → Tailwhip', ''],
      'Opening numbered boxes preserves saved pair identities and notes');
    const editor = editors.nth(0);
    const save = page.locator('[data-viewer-assignment-editor="trick_links"] button[type="submit"]');
    await editor.fill('Barspin - Tailwhip');
    await editors.nth(1).fill('X-UP\nNo-footer');
    await save.click(); await page.evaluate(() => pending);
    eq(await page.evaluate(() => calls[0].name), 'save_weekly_assignment_list');
    eq(await page.evaluate(() => calls[0].args.p_category), 'trick_links');
    eq(await page.evaluate(() => calls[0].args.p_assignments.map(row => [row.trick_name, row.target_reps, row.notes])),
      [['Barspin → Tailwhip', 1, ''], ['X-UP → No-footer', 1, '']], 'A spaced-dash pair and two-line pair save as two complete assignments, skipping the spare box');
    eq(await page.evaluate(() => refreshes), 1, 'Successful save refreshes the viewer');
    const firstSaved = await page.evaluate(() => calls[0].args.p_assignments);
    await page.evaluate(saved => { entry.assignments = saved; mountCoach(); }, firstSaved);
    await page.locator('.viewer-edit-panel > summary').click();
    eq(await editors.evaluateAll(fields => fields.map(field => field.value)), ['Barspin → Tailwhip', 'X-UP → No-footer', ''],
      'Reopening a saved numbered editor restores both full pairs');
    const invalidInput = 'Barspin → Tailwhip → 180';
    await editor.fill(invalidInput);
    await editors.nth(1).fill('Manual');
    await page.evaluate(() => { mode.error = { message: 'Trick Links must contain exactly two tricks separated by →.' }; });
    await save.click(); await page.evaluate(() => pending);
    eq(await editor.inputValue(), invalidInput, 'Backend pair-validation errors preserve every typed row');
    eq(await editors.nth(1).inputValue(), 'Manual', 'A single-trick box remains available to correct after validation failure');
    eq(await page.evaluate(() => refreshes), 1, 'Failed edit does not replace the typed editor with old data');
    eq(await page.evaluate(() => messages.at(-1).tone), 'error');
    ok(await save.isEnabled(), 'Validation errors restore Save');
    eq(await save.getAttribute('aria-busy'), null, 'Validation failure clears loading feedback');
    await editor.fill('Manual | 180 - Keep speed');
    await editors.nth(1).fill('');
    await page.evaluate(() => { mode.error = null; });
    await save.click(); await page.evaluate(() => pending);
    eq(await page.evaluate(() => calls.at(-1).args.p_assignments[0].trick_name), 'Manual → 180', 'Corrected pair can be retried successfully');
    eq(await page.evaluate(() => calls.at(-1).args.p_assignments[0].notes), 'Keep speed', 'Retry keeps coaching notes separate from the two tricks');

    // Real coach proposal fields and payload must preserve optional links while
    // leaving all six existing required list sizes unchanged.
    await page.evaluate(() => {
      window.proposalItems = Object.entries(riderProposalRequirements).flatMap(([category, count]) =>
        Array.from({ length: count }, (_, index) => ({ category, trick_name: `${category} ${index + 1}`, notes: '' })));
      proposalItems.push({ category: 'trick_links', trick_name: 'X-UP → No-footer', notes: 'Keep speed - flow' },
        { category: 'trick_links', trick_name: 'Barspin → Tailwhip', notes: 'Eyes ahead <not markup>' });
      window.mountProposal = items => {
        document.querySelector('#view').innerHTML = '<form id="qa-proposal"><input name="proposalTitle" value="Park week"><input name="proposalVenue" value="Park">' + coachProposalEditorFields({ id: 'proposal-1', items }) + '</form>';
      };
      mountProposal(proposalItems);
    });
    const proposalLinks = page.locator('[name="proposalTrickLinks"]');
    eq(await proposalLinks.count(), 1, 'Coach whole-sheet review includes one optional links editor');
    eq(await proposalLinks.inputValue(), 'X-UP → No-footer - Keep speed - flow\nBarspin → Tailwhip - Eyes ahead <not markup>',
      'Review editor preserves both pair titles and full coaching notes');
    eq(await page.locator('#qa-proposal not, #qa-proposal markup').count(), 0, 'Notes remain escaped text inside the editor');
    const fullProposal = await page.evaluate(() => editedCoachProposalPayload(document.querySelector('#qa-proposal')));
    eq(fullProposal.items.length, 29, 'Optional pairs are appended to the original 27 required rows');
    eq(fullProposal.items, await page.evaluate(() => proposalItems), 'Unchanged coach review preserves every existing row and optional pair');
    await proposalLinks.fill('X-UP->No-footer - Stay low\n\nManual → 180');
    const editedProposal = await page.evaluate(() => editedCoachProposalPayload(document.querySelector('#qa-proposal')));
    eq(editedProposal.items.slice(-2), [
      { category: 'trick_links', trick_name: 'X-UP → No-footer', notes: 'Stay low' },
      { category: 'trick_links', trick_name: 'Manual → 180', notes: '' },
    ], 'Coach edits normalize arrows and skip blank optional rows');
    await page.evaluate(items => mountProposal(items), editedProposal.items);
    eq(await page.evaluate(() => editedCoachProposalPayload(document.querySelector('#qa-proposal'))), editedProposal,
      'Edited optional pairs survive a complete review/editor/payload round trip');
    await proposalLinks.fill('');
    eq((await page.evaluate(() => editedCoachProposalPayload(document.querySelector('#qa-proposal')))).items.length, 27,
      'Trick Links are optional and do not make old full-sheet requests incomplete');

    // Execute the actual individual request handler, intercepting inserts only.
    await page.evaluate(() => {
      state.profile = { role: 'athlete' }; state.user = { id: 'rider' };
      window.inserts = []; window.requestError = null; window.requestRefreshes = 0;
      window.getLinkedCoachIdForCurrentAthlete = async () => 'coach';
      window.nextWeekStartDate = () => '2026-11-02';
      window.renderAthleteHome = async () => { requestRefreshes++; };
      client.from = table => ({ insert: async payload => { inserts.push({ table, payload }); return { error: requestError }; } });
      document.querySelector('#view').innerHTML = '<form id="qa-request"><input name="trickName"><input name="category" value="trick_links"><input name="venue" value="Park"><textarea name="notes">Keep speed</textarea><button type="submit">Send request</button></form>';
      document.querySelector('#qa-request').addEventListener('submit', event => { window.pending = submitTrickRequest(event); });
    });
    for (const invalid of ['Manual', '→ Tailwhip', 'Barspin →', 'Barspin → Tailwhip → 180', oversized]) {
      await page.locator('[name="trickName"]').fill(invalid);
      await page.locator('#qa-request button').click(); await page.evaluate(() => pending);
      eq(await page.evaluate(() => inserts.length), 0, `Invalid individual pair is not sent: ${invalid.slice(0, 30)}`);
      eq(await page.locator('[name="trickName"]').inputValue(), invalid, 'Validation preserves the request input');
      ok(await page.locator('#qa-request button').isEnabled(), 'Local validation does not leave Sending stuck');
    }
    await page.locator('[name="trickName"]').fill('  X-UP->No-footer  ');
    await page.evaluate(() => { requestError = { message: 'Connection interrupted. Please retry.' }; });
    await page.locator('#qa-request button').click(); await page.evaluate(() => pending);
    eq(await page.locator('[name="trickName"]').inputValue(), '  X-UP->No-footer  ', 'Transport failure preserves the original request text');
    ok(await page.locator('#qa-request button').isEnabled(), 'Failed request can be retried');
    await page.evaluate(() => { requestError = null; });
    await page.locator('#qa-request button').click(); await page.evaluate(() => pending);
    eq(await page.evaluate(() => inserts.at(-1)), { table: 'trick_requests', payload: {
      athlete_id: 'rider', coach_id: 'coach', target_week_start: '2026-11-02', venue: 'Park', category: 'trick_links', trick_name: 'X-UP → No-footer', notes: 'Keep speed',
    } }, 'Valid request reaches the coach with normalized pair and unchanged category');
    eq(await page.evaluate(() => requestRefreshes), 1, 'Only a successful request refreshes the home screen');

    // Weekly report values must come from earned awards, not unloaded progress.
    const summary = await page.evaluate(async () => {
      state.user = { id: 'coach' }; state.profile = { role: 'coach' };
      window.weekStartIso = () => '2026-10-26T00:00:00Z';
      window.statusByAthlete = () => new Map(); window.attemptsByTrick = () => new Map();
      window.heatStatuses = {}; window.isDailyCompletionAward = () => false;
      window.firstName = athlete => athlete.display_name; window.formatPbTime = () => '—';
      window.renderCoachCommand = async () => {}; window.qaSummary = null;
      client.from = table => ({ upsert: async payload => { window.qaSummary = { table, payload }; return { error: null }; } });
      await generateWeeklyNotificationPreviews([{ id: 'rider', display_name: 'Alex', groupNames: ['online'] }], {
        sessions: [{ athlete_id: 'rider', venue: 'Park' }],
        scheduleRows: [{ athlete_id: 'rider', category: 'trick_links' }, { athlete_id: 'rider', category: 'trick_links' }],
        awards: [
          { athlete_id: 'rider', award_key: 'trick_links:pair-1', assignment_id: 'pair-1', points: 2 },
          { athlete_id: 'rider', award_key: 'trick_links:pair-1-copy', assignment_id: 'pair-1', points: 2 },
          { athlete_id: 'other-rider', award_key: 'trick_links:other', assignment_id: 'other', points: 2 },
        ],
      });
      return qaSummary;
    });
    eq(summary.table, 'weekly_progress_notifications');
    eq(summary.payload[0].stats.trick_links_completed, 1, 'Weekly summary counts distinct earned pair awards for the selected rider');
    ok(summary.payload[0].summary.includes('1 Trick Links'), 'Summary prose includes the award-derived link count');

    for (const role of ['athlete', 'coach', 'parent']) {
      await page.evaluate(role => {
        if (role === 'coach') return mountCoach();
        mountRider();
        if (role === 'parent') {
          state.profile = { role: 'parent' };
          document.querySelector('#view').innerHTML = '<div class="parent-readonly">' + assignmentGroups(rows, false) + '</div>';
        }
      }, role);
      if (role === 'parent') {
        eq(await page.locator('[data-assignment-section="trick_links"] .assignment-row').count(), 2, 'Linked parent sees both full pairs');
        eq(await page.locator('[data-assignment-action], [data-viewer-assignment-action], form').count(), 0, 'Parent progress contains no editing or scoring controls');
      }
      if (role === 'coach') await page.locator('.viewer-edit-panel > summary').click();
      for (const theme of ['dark', 'light']) for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        const layout = await page.evaluate(() => {
          const target = document.querySelector('[data-viewer-counter="trick_links"], [data-assignment-section="trick_links"]');
          const rect = target.getBoundingClientRect();
          const clippedEditor = [...document.querySelectorAll('textarea[name="numberedLink"]')].some(field => {
            const box = field.getBoundingClientRect(); return box.width <= 0 || box.left < -1 || box.right > innerWidth + 1;
          });
          return { overflow: document.documentElement.scrollWidth > innerWidth + 1, clippedEditor, left: rect.left, right: rect.right, width: innerWidth };
        });
        ok(!layout.overflow && !layout.clippedEditor && layout.left >= -1 && layout.right <= layout.width + 1, `${role} ${theme} at ${width}px keeps Trick Links and its numbered editor within the viewport`);
      }
    }
    eq(errors, [], 'All tested role/layout/action journeys have no browser errors');
    console.log(`PASS: ${checks} Trick Links checks: real pair parsing, weekly completion and award summaries, coach save/retry, optional whole-sheet proposal round trips, single-request validation, parent read-only rendering, rider completion/undo/error recovery/double-tap, and 320/390px dark/light layouts. Backend transport is synthetic; scoring and pair validation are covered by SQL regression tests.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
