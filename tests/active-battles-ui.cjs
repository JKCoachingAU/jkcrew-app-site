const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = process.env.JKCREW_TEST_ROOT || path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Actual ' + name + ' exists');
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const renderNames = [
  'battleParticipantTeamPoints', 'battleContributionsHtml', 'battleTeamNumbers',
  'battleFormatLabel', 'battleFormatOptionsHtml', 'parseBattleFormat', 'battlePrizePoints',
  'battleStakeSummary', 'battleTeamScore', 'battleParticipantFirstName', 'battleTeamHtml',
  'weeklyBattleCardHtml', 'riderHeadToHeadRecord', 'riderBattleRecord', 'riderBattleSelectionSize',
  'updateRiderBattlePicker', 'requestWeeklyRiderBattle', 'renderChallenges', 'scheduleRealtimeRefresh',
];
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
const serverEpoch = Date.parse('2026-09-28T02:00:00.000Z');
const deviceEpoch = serverEpoch + 2 * 86400000;
const errors = [], consoles = [];
let browser;
async function setup() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoles.push(message.text()); });
  // Production CSS/renderers only; every request is synthetic and all browser network is blocked.
  await page.route('**/*', route => route.abort());
  await page.clock.install({ time: deviceEpoch });
  await page.clock.pauseAt(deviceEpoch);
  await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"><div class="app-shell rider-shell" style="display:block"><main id="view" class="content" data-view="challenges"><section id="qa-feed"></section></main></div></div></body></html>');
  for (const file of ['styles.css', 'active-battles.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'active-battles.js'), 'utf8') });
  await page.evaluate(({ serverEpoch, deviceEpoch }) => {
    window.state = { user: { id: 'viewer' }, profile: { role: 'athlete' }, view: 'challenges', activeBattles: null, riderChallengesRenderVersion: 0 };
    window.qaCalls = []; window.qaRows = [];
    window.qaHold = false; window.qaRelease = null; window.qaError = false;
    window.qaAccess = true; window.qaVisible = true; window.qaOnline = true;
    window.qaOtherReads = { leaderboard: 0, battles: 0, challenge: 0 };
    window.qaPersonalHold = false; window.qaPersonalRelease = null;
    window.qaServerNow = () => serverEpoch + Date.now() - deviceEpoch;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => qaVisible ? 'visible' : 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !qaVisible });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => qaOnline });
    window.qaBattle = (id, sizes = [1, 1], options = {}) => ({
      id, starts_at: new Date(qaServerNow() - 3600000).toISOString(), ends_at: new Date(qaServerNow() + 3600000).toISOString(),
      duration_days: 3, reward_points: 7, battle_size: sizes[0], team_count: sizes.length, format: sizes.join('v'),
      participants: sizes.flatMap((size, index) => Array.from({ length: size }, (_, slot) => ({
        athlete_id: id + '-' + index + '-' + slot, display_name: id + ' Rider ' + (index + 1) + '.' + (slot + 1), team_number: index + 1,
        forfeited_at: null, battle_points: 999,
      }))),
      teams: sizes.map((size, index) => ({ team_number: index + 1, score: [37, 28, 31][index], forfeited: false })),
      ...options,
    });
    window.client = {
      rpc: async (name, args) => {
        qaCalls.push({ name, args });
        if (name !== 'get_active_rider_battles') throw Error('Unexpected RPC ' + name);
        const cursorIndex = args?.p_after_id ? qaRows.findIndex(row => row.id === args.p_after_id) + 1 : 0;
        const limit = args?.p_limit || 24;
        const rows = qaRows.slice(cursorIndex, cursorIndex + limit);
        const hasMore = cursorIndex + rows.length < qaRows.length;
        const last = rows.at(-1);
        const result = { data: { server_now: new Date(qaServerNow()).toISOString(), battles: structuredClone(rows), has_more: hasMore,
          next_cursor: hasMore ? { ends_at: last.ends_at, id: last.id } : null }, error: null };
        if (qaError) return { data: null, error: { message: 'Synthetic unavailable connection' } };
        if (qaHold) { qaHold = false; await new Promise(resolve => { qaRelease = resolve; }); }
        return result;
      },
      from: name => { throw Error('Unexpected table read ' + name); },
    };
    window.withTimeout = async promise => promise;
    window.riderFeaturesDisabled = () => !qaAccess;
    window.riderFeatureAccessUnknown = () => false;
    window.getLeaderboard = async () => { qaOtherReads.leaderboard++; return Array.from({ length: 8 }, (_, index) => ({ id: 'r' + index, athlete_id: 'r' + index, display_name: 'Personal Rider ' + index, weekly_points: index })); };
    window.getWeeklyRiderBattles = async () => { qaOtherReads.battles++; if (qaPersonalHold) { qaPersonalHold = false; await new Promise(resolve => { qaPersonalRelease = resolve; }); } return []; };
    window.getMyWeeklyChallenge = async () => { qaOtherReads.challenge++; return null; };
    window.hydrateRiderBattleIdentities = battles => battles;
    window.categoryInfo = {};
    window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    window.avatarHtml = rider => '<span class="avatar">' + escapeHtml(rider.display_name[0]) + '</span>';
    window.dateLabel = value => value || '';
    for (const name of ['notify', 'navigate', 'showBattleRulesModal', 'showAchievementCelebration', 'respondWeeklyRiderBattle', 'forfeitWeeklyRiderBattle', 'refreshOpenTrainingProgress']) window[name] = () => {};
    window.messageFrom = error => error.message;
    window.setButtonBusy = button => { button.disabled = true; return () => { button.disabled = false; }; };
  }, { serverEpoch, deviceEpoch });
  await page.addScriptTag({ content: renderNames.map(extract).join('\n') });
  return page;
}
async function mount(page) {
  await page.evaluate(() => {
    state.activeBattles?.destroy();
    document.querySelector('#qa-feed').innerHTML = JKCrewActiveBattles.sectionHtml();
    state.activeBattles = JKCrewActiveBattles.mount(document.querySelector('#qa-feed'), {
      client, userId: state.user.id, currentUser: () => state.user?.id,
      canAccess: () => qaAccess && state.view === 'challenges' && state.profile?.role === 'athlete', withTimeout,
    });
  });
}
const calls = page => page.evaluate(() => qaCalls.length);
const refresh = page => page.evaluate(() => state.activeBattles.refresh());
const advance = (page, milliseconds) => page.clock.runFor(milliseconds);
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    const page = await setup();
    await page.evaluate(() => {
      qaRows = [qaBattle('unequal', [2, 1]), qaBattle('three', [1, 1, 1]), qaBattle('large', [6, 6, 6])];
      qaRows[0].participants[0].athlete_id = 'viewer';
      qaRows[1].teams[1].score = qaRows[1].teams[0].score;
      qaRows[1].teams[2].forfeited = true; qaRows[1].teams[2].score = 0;
      qaRows[1].participants[2].forfeited_at = new Date(qaServerNow() - 1000).toISOString();
      qaRows[2].participants[0].display_name = '<img src=x onerror="window.qaInjected=true"> Morgan & O\'Brien';
      qaRows[2].participants[1].display_name = 'LongSurname'.repeat(20);
    });
    await mount(page);
    const feed = page.locator('#qa-feed');
    await page.waitForFunction(() => document.querySelector('#qa-feed').textContent.includes('unequal Rider'));
    assert.equal(await calls(page), 1, 'Initial feed uses one bounded summary RPC');
    assert.deepEqual(await page.evaluate(() => qaOtherReads), { leaderboard: 0, battles: 0, challenge: 0 });
    const initialCall = await page.evaluate(() => qaCalls[0]);
    assert.equal(initialCall.name, 'get_active_rider_battles');
    assert.equal(initialCall.args.p_limit, 12);
    for (const name of await page.evaluate(() => qaRows.flatMap(battle => battle.participants.map(person => person.display_name)))) {
      assert((await feed.innerText()).includes(name), 'Every competitor is present: ' + name);
    }
    assert.equal(await feed.locator('img').count(), 0, 'Names are escaped, never rendered as image markup');
    assert.equal(await page.evaluate(() => Boolean(window.qaInjected)), false);
    for (const format of ['2v1', '1v1v1', '6v6v6']) assert((await feed.innerText()).includes(format), 'Correct spectator format ' + format);
    assert.equal(await feed.locator('[data-active-battle-id=unequal]').getByText('Your battle', { exact: true }).count(), 1);
    assert.equal(await feed.locator('[data-active-battle-id=three]').getByText('Tied', { exact: true }).count(), 2, 'Tied leaders stay tied');
    assert.equal(await feed.locator('[data-active-battle-id=three] .team-3 .crew-live-score strong').textContent(), '0', 'Forfeited side shows the server supplied score');
    assert(!(await feed.innerText()).includes('999'), 'Canonical team scores are used instead of participant totals');
    assert.equal(await feed.locator('[data-forfeit-battle], [data-battle-response], [data-rematch-battle], form, input, select').count(), 0, 'Spectator cards contain no personal management controls');
    assert.equal(await feed.getByRole('button', { name: /accept|decline|forfeit|rematch|send/i }).count(), 0);
    for (const theme of ['dark', 'light']) for (const width of [320, 390, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), theme + ' spectators fit ' + width + 'px');
      const clipped = await feed.locator('*').evaluateAll(elements => elements.filter(element => {
        const style = getComputedStyle(element);
        return style.display !== 'inline' && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1 && style.overflowX !== 'auto' && style.overflowX !== 'scroll';
      }).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent.slice(0, 45), width: element.clientWidth, scroll: element.scrollWidth })));
      assert.deepEqual(clipped, [], 'Names and team scores stay inside their own cards at ' + width + 'px');
      const refreshLabelFits = await feed.locator('[data-active-battles-refresh]').evaluate(button => {
        const box = button.getBoundingClientRect(), style = getComputedStyle(button);
        const range = document.createRange(); range.selectNodeContents(button);
        const text = range.getBoundingClientRect();
        return text.left >= box.left + parseFloat(style.paddingLeft) - 1 && text.right <= box.right - parseFloat(style.paddingRight) + 1;
      });
      assert(refreshLabelFits, 'Refresh label retains its padding and is not clipped at ' + width + 'px');
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'active-battles-' + theme + '-' + width + '.png'), fullPage: true, animations: 'disabled' });
    }

    // A failed refresh preserves verified scores and makes stale information explicit.
    await page.evaluate(() => { qaError = true; });
    await refresh(page);
    assert((await feed.innerText()).includes('unequal Rider'), 'Refresh failure preserves prior cards');
    assert.match(await feed.innerText(), /stale|last (?:saved|update)|couldn.t refresh|out of date/i);
    const retry = feed.locator('[data-active-battles-refresh]');
    assert.equal(await retry.count(), 1, 'Failed refresh has a section-local retry');
    await page.evaluate(() => { qaError = false; qaRows[0].teams[0].score = 72; });
    await retry.click();
    await page.waitForFunction(() => document.querySelector('#qa-feed').textContent.includes('72'));
    assert(!(await feed.innerText()).includes('couldn’t refresh'), 'Successful retry restores current score status');

    // One in-flight request owns the refresh; subsequent ticks cannot duplicate it.
    await page.evaluate(() => { qaHold = true; window.qaFirstRefresh = state.activeBattles.refresh(); });
    await page.waitForFunction(() => Boolean(qaRelease));
    const whilePending = await calls(page);
    await page.evaluate(() => { void state.activeBattles.refresh(); void state.activeBattles.refresh(); });
    await advance(page, 21000);
    assert.equal(await calls(page), whilePending, 'Manual and timed refreshes share the same in-flight lock');
    await page.evaluate(async () => { qaRelease(); qaRelease = null; await qaFirstRefresh; });
    await refresh(page);
    assert.equal(await calls(page), whilePending + 1, 'Lock clears when the request finishes');

    // Visibility and connectivity pause work, then resume with a fresh read.
    for (const mode of ['hidden', 'offline']) {
      await page.evaluate(mode => {
        if (mode === 'hidden') { qaVisible = false; document.dispatchEvent(new Event('visibilitychange')); }
        else { qaOnline = false; window.dispatchEvent(new Event('offline')); }
      }, mode);
      const before = await calls(page);
      await advance(page, 41000);
      await refresh(page);
      assert.equal(await calls(page), before, mode + ' pauses background and explicit reads');
      await page.evaluate(mode => {
        if (mode === 'hidden') { qaVisible = true; document.dispatchEvent(new Event('visibilitychange')); }
        else { qaOnline = true; window.dispatchEvent(new Event('online')); }
      }, mode);
      await page.waitForFunction(before => qaCalls.length > before, before);
      assert.equal(await calls(page), before + 1, mode + ' recovery performs only one read');
    }
    await page.close();

    // Use server time for exact lifecycle boundaries even if the device is two days fast.
    const expiry = await setup();
    await expiry.evaluate(() => {
      const now = qaServerNow();
      qaRows = [
        qaBattle('starts-now', [1, 1], { starts_at: new Date(now).toISOString(), ends_at: new Date(now + 1000).toISOString() }),
        qaBattle('ended-now', [1, 1], { ends_at: new Date(now).toISOString() }),
        qaBattle('future', [1, 1], { starts_at: new Date(now + 60000).toISOString() }),
      ];
    });
    await mount(expiry);
    await expiry.waitForFunction(() => document.querySelector('#qa-feed').textContent.includes('starts-now Rider'));
    assert(!(await expiry.locator('#qa-feed').innerText()).includes('ended-now Rider'));
    assert(!(await expiry.locator('#qa-feed').innerText()).includes('future Rider'));
    await advance(expiry, 1001);
    assert(!(await expiry.locator('#qa-feed').innerText()).includes('starts-now Rider'), 'Card disappears at server expiry without waiting for settlement or network refresh');
    assert.match(await expiry.locator('#qa-feed').innerText(), /no active battles|no battles.*live/i);
    await expiry.close();

    // A second page is requested only after explicit user action, with the returned cursor.
    const paged = await setup();
    await paged.evaluate(() => { qaRows = Array.from({ length: 20 }, (_, index) => qaBattle('page-' + String(index).padStart(2, '0'))); });
    await mount(paged);
    await paged.waitForFunction(() => document.querySelector('#qa-feed').textContent.includes('page-11 Rider'));
    assert.equal(await calls(paged), 1);
    assert(!(await paged.locator('#qa-feed').innerText()).includes('page-12 Rider'));
    await paged.locator('#qa-feed').getByRole('button', { name: /more/i }).click();
    await paged.waitForFunction(() => document.querySelector('#qa-feed').textContent.includes('page-19 Rider'));
    assert.equal(await calls(paged), 2);
    assert.deepEqual(await paged.evaluate(() => qaCalls[1].args), {
      p_limit: 12, p_after_ends_at: await paged.evaluate(() => qaRows[11].ends_at), p_after_id: 'page-11',
    });
    assert.equal(await paged.locator('#qa-feed').getByRole('button', { name: /more/i }).count(), 0, 'No more button after the last page');
    assert(!(await paged.locator('#qa-feed').innerText()).includes('page-00 Rider'), 'Only the current bounded page remains in the DOM');
    await paged.locator('#qa-feed').getByRole('button', { name: /previous/i }).click();
    await paged.waitForFunction(() => document.querySelector('#qa-feed').textContent.includes('page-00 Rider'));
    assert.equal(await calls(paged), 3);
    assert.equal(await paged.locator('#qa-feed').getByText('page-00 Rider 1.1', { exact: true }).count(), 1, 'Previous restores the first page without duplicates');
    await paged.close();

    // Late responses from a detached instance or a different account must never paint.
    for (const reason of ['destroy', 'account', 'access']) {
      const stale = await setup();
      await stale.evaluate(() => { qaRows = [qaBattle('private-old')]; qaHold = true; });
      await mount(stale);
      await stale.waitForFunction(() => Boolean(qaRelease));
      await stale.evaluate(reason => {
        if (reason === 'destroy') { state.activeBattles.destroy(); document.querySelector('#qa-feed').innerHTML = 'Next view'; }
        if (reason === 'account') state.user = { id: 'different-user' };
        if (reason === 'access') qaAccess = false;
        qaRelease(); qaRelease = null;
      }, reason);
      await stale.evaluate(async () => { await Promise.resolve(); await Promise.resolve(); });
      assert(!(await stale.locator('#qa-feed').innerText()).includes('private-old Rider'), reason + ' invalidates the prior response');
      const before = await calls(stale);
      await advance(stale, 41000);
      await refresh(stale);
      assert.equal(await calls(stale), before, reason + ' stops future reads');
      await stale.close();
    }

    // Actual Challenges integration: spectator failures and refreshes leave the request form untouched.
    const integrated = await setup();
    await integrated.evaluate(async () => { qaRows = [qaBattle('crew-live')]; qaHold = true; await renderChallenges(); });
    assert.equal(await integrated.locator('#battle-request-form').count(), 1, 'The surrounding Challenges page does not await the feed');
    await integrated.click('#toggle-battle-rider-list');
    await integrated.selectOption('#rider-battle-size', '2v1');
    await integrated.check('[name=teammateIds][value=r0]');
    await integrated.check('[name=opponentIds][value=r1]');
    await integrated.fill('#battle-reward-points', '12');
    await integrated.selectOption('#battle-duration', '4');
    await integrated.evaluate(() => { window.qaOriginalForm = document.querySelector('#battle-request-form'); qaRelease(); qaRelease = null; });
    await integrated.waitForFunction(() => document.querySelector('#view').textContent.includes('crew-live Rider'));
    const priorReads = await integrated.evaluate(() => qaOtherReads);
    await integrated.evaluate(() => { qaRows[0].teams[0].score = 91; qaError = true; });
    await refresh(integrated);
    await integrated.evaluate(() => { qaError = false; scheduleRealtimeRefresh('synthetic-score-change'); });
    await advance(integrated, 1500);
    await integrated.waitForFunction(() => document.querySelector('#view').textContent.includes('91'));
    assert.deepEqual(await integrated.evaluate(() => qaOtherReads), priorReads, 'Spectator refresh does not reload leaderboard, own battles, or weekly challenge');
    assert(await integrated.evaluate(() => qaOriginalForm === document.querySelector('#battle-request-form')), 'Refresh preserves the actual form node');
    assert.equal(await integrated.inputValue('#rider-battle-size'), '2v1');
    assert.equal(await integrated.inputValue('#battle-reward-points'), '12');
    assert.equal(await integrated.inputValue('#battle-duration'), '4');
    assert(await integrated.locator('[name=teammateIds][value=r0]').isChecked());
    assert(await integrated.locator('[name=opponentIds][value=r1]').isChecked());
    assert(await integrated.locator('#battle-request-form').isVisible());
    await integrated.close();

    // A draft opened while a background personal-data read is pending also survives its commit.
    const openingRace = await setup();
    await openingRace.evaluate(async () => { qaRows = [qaBattle('opening-race')]; await renderChallenges(); });
    await openingRace.waitForFunction(() => document.querySelector('#view').textContent.includes('opening-race Rider'));
    await openingRace.evaluate(() => {
      window.qaPriorFeed = state.activeBattles; qaPersonalHold = true; scheduleRealtimeRefresh('hidden-form-refresh');
    });
    await advance(openingRace, 1500);
    await openingRace.waitForFunction(() => Boolean(qaPersonalRelease));
    await openingRace.click('#toggle-battle-rider-list');
    await openingRace.selectOption('#rider-battle-size', '1v2');
    await openingRace.check('[name=opponentIds][value=r2]');
    await openingRace.check('[name=opponentIds][value=r3]');
    await openingRace.fill('#battle-reward-points', '13');
    await openingRace.evaluate(() => { window.qaOpeningForm = document.querySelector('#battle-request-form'); qaPersonalRelease(); qaPersonalRelease = null; });
    await openingRace.evaluate(async () => { await Promise.resolve(); await Promise.resolve(); });
    assert(await openingRace.evaluate(() => qaOpeningForm === document.querySelector('#battle-request-form')), 'Opening a draft during a pending realtime read cancels its destructive commit');
    assert.equal(await openingRace.inputValue('#rider-battle-size'), '1v2');
    assert.equal(await openingRace.inputValue('#battle-reward-points'), '13');
    assert(await openingRace.locator('[name=opponentIds][value=r2]').isChecked());
    assert(await openingRace.locator('[name=opponentIds][value=r3]').isChecked());
    assert(await openingRace.evaluate(() => qaPriorFeed === state.activeBattles), 'Deferred personal refresh keeps the existing spectator instance alive');
    await openingRace.close();

    // Existing feed data/refresh must survive failure in the older personal-battle read.
    const personalFailure = await setup();
    await personalFailure.evaluate(async () => { qaRows = [qaBattle('still-live')]; await renderChallenges(); });
    await personalFailure.waitForFunction(() => document.querySelector('#view').textContent.includes('still-live Rider'));
    await personalFailure.evaluate(() => {
      window.qaPriorFeed = state.activeBattles;
      window.getWeeklyRiderBattles = async () => { throw Error('Synthetic personal battle read unavailable'); };
      scheduleRealtimeRefresh('personal-read-error');
    });
    await advance(personalFailure, 1500);
    assert(await personalFailure.evaluate(() => Boolean(state.activeBattles) && qaPriorFeed === state.activeBattles), 'Personal-data error preserves the current spectator controller');
    await personalFailure.evaluate(() => { qaRows[0].teams[0].score = 84; });
    await refresh(personalFailure);
    assert((await personalFailure.locator('#active-rider-battles').innerText()).includes('84'), 'Spectator remains refreshable after an unrelated read error');
    await personalFailure.close();

    // The initial unavailable state is recoverable without showing a false empty list.
    const unavailable = await setup();
    await unavailable.evaluate(() => { qaError = true; qaRows = [qaBattle('retry-restored')]; });
    await mount(unavailable);
    await unavailable.waitForFunction(() => document.querySelector('#qa-feed').textContent.includes('unavailable'));
    assert(!(await unavailable.locator('#qa-feed').innerText()).includes('No battles live right now'));
    await unavailable.evaluate(() => { qaError = false; });
    await unavailable.locator('[data-active-battles-refresh]').click();
    await unavailable.waitForFunction(() => document.querySelector('#qa-feed').textContent.includes('retry-restored Rider'));
    await unavailable.close();

    // Rapid leave/re-entry shares the outer #view; an older render cannot replace the newer one.
    const renderRace = await setup();
    await renderRace.evaluate(() => { qaPersonalHold = true; window.qaOldRender = renderChallenges(); });
    await renderRace.waitForFunction(() => Boolean(qaPersonalRelease));
    await renderRace.evaluate(async () => {
      state.view = 'home'; document.querySelector('#view').innerHTML = 'Other page';
      state.view = 'challenges'; await renderChallenges();
      window.qaNewestForm = document.querySelector('#battle-request-form');
      qaPersonalRelease(); qaPersonalRelease = null; await qaOldRender;
    });
    assert(await renderRace.evaluate(() => Boolean(qaNewestForm) && qaNewestForm === document.querySelector('#battle-request-form')), 'Late old Challenges render does not replace the newer form');
    await renderRace.close();

    const accountRace = await setup();
    await accountRace.evaluate(() => { qaPersonalHold = true; window.qaOldRender = renderChallenges(); });
    await accountRace.waitForFunction(() => Boolean(qaPersonalRelease));
    await accountRace.evaluate(async () => {
      state.user = { id: 'new-account' }; document.querySelector('#view').innerHTML = 'New account view';
      qaPersonalRelease(); qaPersonalRelease = null; await qaOldRender;
    });
    assert.equal(await accountRace.locator('#view').innerText(), 'New account view', 'Old account cannot paint Challenges after the account changes');
    await accountRace.close();

    assert.deepEqual(errors, [], 'No browser exceptions');
    assert.deepEqual(consoles, [], 'No browser console errors');
    console.log('PASS: Active Battles canonical scores, every rider/format, escaping, mobile/tablet dark/light layouts, bounded cursor pages, server-clock boundaries/expiry, stale/retry, single in-flight request, visible/online recovery, account/navigation/access guards, and draft-preserving actual Challenges/realtime integration, mid-refresh draft opening, and unrelated read failure isolation. All requests synthetic; no production writes.');
  } finally { await browser?.close(); }
})().catch(error => { console.error(error); process.exit(1); });
