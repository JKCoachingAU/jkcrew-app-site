const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const functions = ['renderSessionViewer', 'bindSessionViewerActions', 'sessionViewerVenueOptions', 'sessionViewerGroupTabs', 'sessionViewerVenueTabs', 'sessionViewerSnapshotHtml', 'showAddDailyLocation', 'groupSessionElapsedSeconds', 'updateGroupSessionTimerDom', 'getCoachVenues'];
const constants = app.slice(app.indexOf('const venueKey ='), app.indexOf('\n\nfunction avatarHtml', app.indexOf('const venueKey =')));
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR || '/tmp/jkcrew-daily-location-qa';
fs.mkdirSync(screenshotDir, { recursive: true });
let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    for (const width of [390, 1440]) for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 500, isMobile: width < 500 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view" class="content" data-view="sessionViewer"></main></div></div></body></html>`);
      await page.addStyleTag({ content: css });
      await page.evaluate(code => {
        window.state = { view: 'sessionViewer', user: { id: 'coach' }, profile: { role: 'coach' }, sessionViewerGroup: 'monday', sessionViewerVenue: 'LOGANLAND', sessionViewerSearch: '', sessionViewerSetupOpen: true, sessionViewerRenderVersion: 0, sessionViewerOpenAthleteId: '', sessionViewerActiveList: '', sessionViewerRosterCache: [], sessionViewerActiveSessionCache: null };
        window.coachGroups = [['monday', 'Monday Team'], ['tuesday', 'Tuesday Team']];
        window.contestPrepGroupId = 'contest_prep';
        window.qaRoster = coachGroups.map(([group, label]) => ({ id: group, display_name: `${label} rider`, country_code: 'AU', groupNames: [group] }));
        window.qaRows = new Map(qaRoster.map(rider => [rider.id, ['LOGANLAND', 'Beenleigh', 'THE VILLAGE', 'RAMP ATTACK', 'HOTBOX - Aus National Training Facility', 'PIZZEY SKATE PARK'].map((venue, index) => ({ id: `${rider.id}-${index}`, athlete_id: rider.id, category: 'daily', venue, trick_name: 'Manual', progress: {} }))]));
        window.qaVenues = ['LOGANLAND', 'Beenleigh', 'PIZZEY SKATE PARK'].map((name, index) => ({ id: `saved-${index}`, coach_id: 'coach', name, sort_order: index }));
        window.qaInserts = []; window.qaNotices = []; window.qaSession = null; window.qaHoldRead = false; window.qaHoldInsert = false; window.qaPendingReads = []; window.qaPendingInserts = []; window.qaFailRead = false; window.qaFailInsert = false; window.qaDuplicateInsert = false;
        window.getSessionViewerRoster = async () => qaRoster;
        window.getActiveCoachGroupSession = async () => qaSession;
        window.getSessionViewerPlanData = async () => ({ assignmentsByAthlete: qaRows, runsByAthlete: new Map(), runProgressByPlan: new Map() });
        window.withTimeout = promise => promise;
        window.client = {
          rpc: async name => { if (name !== 'get_coach_rider_battles_v2') throw Error(`Unexpected RPC ${name}`); return { data: [] }; },
          from: table => {
            if (table !== 'coach_venues') throw Error(`Unexpected table ${table}`);
            return {
              select: columns => { if (columns !== "*") throw Error("Unexpected venue read fields"); let owner; let orders = 0; const query = {
                eq: (field, value) => { if (field !== 'coach_id') throw Error('Owner filter missing'); owner = value; return query; },
                order: () => { if (++orders < 2) return query; const result = () => qaFailRead ? Promise.reject(Error('Connection unavailable')) : Promise.resolve({ data: qaVenues.filter(row => row.coach_id === owner).map(row => ({ ...row })) }); return qaHoldRead ? new Promise((resolve, reject) => qaPendingReads.push(() => result().then(resolve, reject))) : result(); },
              }; return query; },
              insert: row => { qaInserts.push({ ...row }); return { select: columns => { if (columns !== 'id,name,sort_order') throw Error('Unexpected saved fields'); return { single: () => {
                const result = () => {
                  if (qaFailInsert) return { error: { message: 'Connection unavailable' } };
                  const saved = { ...row, id: `saved-${qaVenues.length}` };
                  qaVenues.push(saved);
                  if (qaDuplicateInsert) { qaDuplicateInsert = false; return { error: { code: '23505', message: 'Already exists' } }; }
                  return { data: saved };
                };
                return qaHoldInsert ? new Promise(resolve => qaPendingInserts.push(() => resolve(result()))) : Promise.resolve(result());
              } }; } }; },
            };
          },
        };
        window.isCoachRole = role => ['coach', 'admin'].includes(role);
        window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        window.normalizeAssignmentProgress = (_row, progress) => progress;
        window.isAssignmentComplete = row => Boolean(row.progress?.completed_at);
        window.dailyVenues = rows => [...new Set(rows.map(row => row.venue))];
        window.assignmentsForVenue = (rows, venue) => rows.filter(row => row.venue === venue);
        window.coachGroupLabel = group => coachGroups.find(row => row[0] === group)?.[1] || group;
        window.groupLabelList = groups => groups.join(', ');
        window.formatTime = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        window.sessionViewerRiderCardHtml = entry => `<article class="panel" data-test-rider="${entry.athlete.id}">${entry.athlete.display_name} · ${escapeHtml(entry.venue)} · ${entry.daily.length} daily tricks</article>`;
        window.parkKingCardHtml = (_data, venue, options) => `<section id="${options.id}" class="panel">${escapeHtml(venue)}</section>`;
        window.sessionGroupBattlesHtml = () => '';
        window.notify = message => qaNotices.push(message);
        window.messageFrom = error => error.message;
        for (const name of ['refreshParkKingCard', 'bindCoachBattleControls', 'refreshSessionViewerLight', 'showCoachBattleBuilder', 'startViewerGroupSession', 'toggleViewerGroupSessionPause', 'endViewerGroupSession', 'addExtraRiderToGroupSession', 'finishViewerDailyTimer', 'recordViewerAssignmentAction', 'recordViewerAssignmentAttempt', 'recordViewerPercentageAttempt', 'selectViewerListTab', 'toggleViewerGoal', 'toggleViewerRunPoint', 'saveSessionViewerAssignments', 'bindTrainingProgressActions', 'mountDailyFeatures', 'navigate']) window[name] = () => {};
        (0, eval)(code);
      }, `${constants}\n${functions.map(extract).join('\n')}`);
      const open = async () => { await page.locator('#add-daily-location').click(); await page.waitForSelector('.daily-location-dialog[open]'); };
      const fill = name => page.locator('#new-daily-location').fill(name);
      const save = () => page.locator('.daily-location-dialog [type="submit"]').click();
      const closed = () => page.waitForFunction(() => !document.querySelector('.daily-location-dialog'));
      const ready = name => page.waitForFunction(name => Boolean([...document.querySelectorAll('[data-viewer-venue]')].find(el => el.dataset.viewerVenue === name)), name);
      await page.evaluate(() => renderSessionViewer());
      const add = page.locator('#add-daily-location');
      await add.scrollIntoViewIfNeeded();
      const box = await add.boundingBox();
      check(box.width === 44 && box.height === 44, `${width}/${theme}: square44 tap target`);
      check(await add.getAttribute('aria-label') === 'Add daily location', 'Accessible plus label');
      check(await add.evaluate(el => el.previousElementSibling?.dataset.viewerVenue === 'PIZZEY SKATE PARK'), 'Plus follows final park');
      await page.screenshot({ path: path.join(screenshotDir, `locations-${theme}-${width}.png`) });
      await open();
      check(await page.locator('#new-daily-location').evaluate(el => el === document.activeElement), 'Name gets focus');
      check(await page.locator('#new-daily-location').getAttribute('maxlength') === '80', 'Reasonable name limit');
      const dialogBox = await page.locator('.daily-location-dialog').boundingBox();
      check(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= width, 'Dialog fits viewport');
      await fill('  New   Park  ');
      await page.screenshot({ path: path.join(screenshotDir, `add-location-${theme}-${width}.png`) });
      await save(); await closed(); await ready('New Park');
      check(await page.evaluate(() => state.sessionViewerVenue === 'New Park'), 'New location selected');
      check(await page.locator('[data-viewer-venue="New Park"]').getAttribute('aria-pressed') === 'true', 'Selected location button');
      const writes = await page.evaluate(() => qaInserts);
      check(writes.length === 1 && writes[0].coach_id === 'coach' && writes[0].name === 'New Park' && writes[0].sort_order === 3, 'Only appended owner-scoped venue row');
      check(await page.locator('[data-test-rider="monday"]').textContent().then(text => text.includes('0 daily tricks')), 'New park starts without fabricated tricks');
      await page.locator('[data-viewer-group="tuesday"]').click(); await ready('New Park');
      check(await page.locator('[data-viewer-venue="New Park"]').count() === 1, 'Empty saved park survives group switch');
      await page.evaluate(async () => { state.sessionViewerVenue = ''; await renderSessionViewer(); });
      await ready('New Park');
      check(await page.locator('[data-viewer-venue="New Park"]').count() === 1, 'Empty saved park survives fresh render');
      await open(); await fill('new park'); await save(); await closed();
      check(await page.evaluate(() => qaInserts.length) === 1, 'Canonical duplicate avoids insert');
      await open(); await fill('Beenleigh Skate Park'); await save(); await closed();
      check(await page.evaluate(() => qaInserts.length === 1 && state.sessionViewerVenue === 'Beenleigh'), 'Existing alias reuses saved venue');
      await open(); await fill('!!!'); await save();
      check(await page.locator('.daily-location-error').isVisible(), 'Punctuation-only name rejected');
      check(await page.evaluate(() => qaInserts.length) === 1, 'Invalid name writes nothing');
      await page.keyboard.press('Escape'); await closed();
      check(await page.locator('#add-daily-location').evaluate(el => document.activeElement === el), 'Escape restores plus focus');

      // Slow saves reject repeated Enter/click submits.
      await open(); await fill('Double Tap Park');
      await page.evaluate(() => { qaHoldInsert = true; const form = document.querySelector('.daily-location-dialog form'); form.requestSubmit(); form.dispatchEvent(new Event('submit', { cancelable: true })); });
      await page.waitForFunction(() => qaPendingInserts.length === 1);
      check(await page.locator('.daily-location-dialog [type="submit"]').isDisabled(), 'Pending save feedback');
      check(await page.evaluate(() => qaInserts.filter(row => row.name === 'Double Tap Park').length === 1), 'Double submit writes once');
      await page.evaluate(() => { qaHoldInsert = false; qaPendingInserts.shift()(); }); await closed(); await ready('Double Tap Park');

      await open(); await fill('Retry Park'); await page.evaluate(() => { qaFailInsert = true; }); await save();
      await page.waitForFunction(() => !document.querySelector('.daily-location-error').hidden);
      check(await page.locator('#new-daily-location').inputValue() === 'Retry Park', 'Failed save retains input');
      check(await page.locator('.daily-location-dialog [type="submit"]').isEnabled(), 'Failed save enables retry');
      await page.evaluate(() => { qaFailInsert = false; }); await save(); await closed(); await ready('Retry Park');
      check(await page.evaluate(() => qaVenues.filter(row => row.name === 'Retry Park').length) === 1, 'Retry adds one location');
      await open(); await fill('Other Tab Park'); await page.evaluate(() => { qaDuplicateInsert = true; }); await save(); await closed(); await ready('Other Tab Park');
      check(await page.evaluate(() => qaVenues.filter(row => row.name === 'Other Tab Park').length) === 1, 'Unique conflict recovers confirmed saved row');

      // Cancel before prerequisite read finishes: no mutation.
      await open(); await fill('Cancelled Park'); await page.evaluate(() => { qaHoldRead = true; }); await save();
      await page.waitForFunction(() => qaPendingReads.length === 1);
      await page.locator('.daily-location-dialog [data-close-location]').last().click(); await closed();
      await page.evaluate(async () => { qaHoldRead = false; qaPendingReads.shift()(); await new Promise(resolve => setTimeout(resolve, 20)); });
      check(await page.evaluate(() => !qaInserts.some(row => row.name === 'Cancelled Park')), 'Cancel during read prevents insertion');
      await open(); await fill('Stale Account Park'); await page.evaluate(() => { qaHoldRead = true; }); await save();
      await page.waitForFunction(() => qaPendingReads.length === 1);
      await page.evaluate(async () => { state.user = { id: 'different-coach' }; qaHoldRead = false; qaPendingReads.shift()(); await new Promise(resolve => setTimeout(resolve, 20)); });
      check(await page.evaluate(() => !qaInserts.some(row => row.name === 'Stale Account Park')), 'Account switch during read prevents insertion');
      await page.keyboard.press('Escape'); await closed();
      await page.evaluate(() => { state.user = { id: 'coach' }; });

      await open(); await fill('Late Response Park'); await page.evaluate(() => { qaHoldInsert = true; window.qaBeforeLate = { venue: state.sessionViewerVenue, notices: qaNotices.length }; }); await save();
      await page.waitForFunction(() => qaPendingInserts.length === 1);
      await page.evaluate(async () => { state.view = 'command'; qaHoldInsert = false; qaPendingInserts.shift()(); await new Promise(resolve => setTimeout(resolve, 20)); });
      check(await page.evaluate(() => state.sessionViewerVenue === qaBeforeLate.venue && qaNotices.length === qaBeforeLate.notices), 'Late committed save cannot update a different view');
      await page.keyboard.press('Escape'); await closed();
      await page.evaluate(async () => { state.view = 'sessionViewer'; await renderSessionViewer(); }); await ready('Late Response Park');
      check(await page.locator('[data-viewer-venue="Late Response Park"]').count() === 1, 'Later refresh discovers a save completed after navigation');
      await page.evaluate(async () => { qaFailRead = true; await renderSessionViewer(); });
      check(await page.locator('[data-viewer-venue="PIZZEY SKATE PARK"]').count() === 1, 'Saved-location read failure leaves existing daily locations usable');
      await page.evaluate(() => { qaFailRead = false; state.profile.role = 'athlete'; showAddDailyLocation(); });
      check(await page.locator('.daily-location-dialog').count() === 0, 'Rider role cannot open coach location creator');
      await page.evaluate(() => { state.profile.role = 'coach'; });

      await page.evaluate(async () => { qaSession = { id: 'live', group_name: 'monday', venue: 'LOGANLAND', status: 'active', started_at: new Date().toISOString(), coach_group_session_participants: [{ athlete_id: 'monday' }] }; await renderSessionViewer(); });
      await open(); await fill('Next Session Park'); await save(); await closed(); await ready('Next Session Park');
      check(await page.evaluate(() => state.sessionViewerVenue === 'LOGANLAND'), 'Adding during active session retains live venue');
      check(await page.locator('[data-viewer-venue="Next Session Park"]').isDisabled(), 'New park obeys active-session location lock');
      check(await page.evaluate(() => qaNotices.at(-1).includes('after this session')), 'Active session explains next-session availability');
      await page.evaluate(async () => { qaSession = null; await renderSessionViewer(); }); await ready('Next Session Park');
      check(await page.locator('[data-viewer-venue="Next Session Park"]').isEnabled(), 'Saved park usable after session ends');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No viewport overflow');
      check(errors.length === 0, `No browser errors: ${errors.join(', ')}`);
      await page.close();
      console.log(`PASS locations ${theme} ${width}px`);
    }
  } finally { await browser.close(); }
  console.log(`PASS ${checks} location workflow checks`);
})().catch(error => { console.error(error); process.exit(1); });
