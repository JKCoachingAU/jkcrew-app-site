// Actual points popup and weekly-completion handler, with synthetic transport only.
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
const code = [
  app.match(/^const XP_PROGRESSION_ENABLED = .*;$/m)[0],
  ...['showProgressPopup', 'showUpdatedWeeklyScore', 'refreshOwnXpAfterAction', 'progressSaveKey', 'recordAssignmentAction'].map(extract),
].join('\n');
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  let checks = 0;
  const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const ok = (value, message) => { assert(value, message); checks++; };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="view" style="padding:32px"><h1>Today’s training</h1><p>Training progress and weekly points.</p><div id="fixture-list"></div></main><div id="toast" class="toast"></div><button id="under-popup" style="position:fixed;inset:auto 0 0;width:100%;height:100%;opacity:0;z-index:1" aria-label="Continue training"></button><nav id="fixture-nav" style="position:fixed;inset:auto 0 0;height:90px;border-top:1px solid var(--line);background:var(--surface);display:grid;place-items:center">Session</nav></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.evaluate(() => {
      window.state = { user: { id: 'points-rider' }, profile: { role: 'athlete' }, view: 'session', selectedVenue: 'Loganland', sessionOpenAssignmentSections: new Set() };
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
      window.mode = { total: 27, error: null, leaderboardError: false, leaderboardHold: false, missingRow: false, points: 2, halfPoints: 0 };
      window.notifications = []; window.sounds = []; window.rpcCalls = []; window.leaderboardCalls = 0; window.leaderboardOptions = []; window.pendingProgress = new Map(); window.renderCalls = 0;
      window.playNotificationSound = kind => sounds.push(kind);
      window.notify = (message, tone = 'ok') => notifications.push({ message, tone });
      window.messageFrom = error => error.message;
      window.getAthleteHomeVerifiedLeaderboard = async options => {
        leaderboardCalls++;
        leaderboardOptions.push(options);
        const viewerId = state.user.id, total = mode.total;
        if (mode.leaderboardHold) await new Promise(resolve => { window.releaseLeaderboard = resolve; });
        if (mode.leaderboardError) throw Error('Synthetic leaderboard offline');
        return mode.missingRow ? [] : [{ athlete_id: viewerId, weekly_points: total }];
      };
      window.getXpSummary = () => { throw Error('XP must remain retired'); };
      window.normalizeXpSummary = () => { throw Error('XP must remain retired'); };
      window.levelBadgeHtml = () => { throw Error('Badges must remain retired'); };
      window.setSyncStatus = window.cacheClear = window.refreshOpenTrainingProgress = () => {};
      window.setPendingAssignmentProgress = (id, complete) => pendingProgress.set(id, complete);
      window.clearPendingAssignmentProgress = id => pendingProgress.delete(id);
      window.progressSaveStates = new Map();
      window.withTimeout = promise => promise;
      window.requestRiderSessionRefresh = window.renderAthleteHome = async () => { renderCalls++; };
      window.saveProgressRpc = async (name, args) => {
        rpcCalls.push({ name, args });
        if (mode.saveHold) await new Promise(resolve => { window.releaseSave = resolve; });
        if (mode.error) return { error: { message: mode.error } };
        return { data: { assignment_id: args.p_assignment_id, completed_at: args.p_action === 'landed' ? '2026-11-22T01:00:00Z' : null, message: args.p_action === 'landed' ? 'Trick completed' : 'Completion removed', points_awarded: args.p_action === 'landed' ? mode.points : 0, half_points_awarded: args.p_action === 'landed' ? mode.halfPoints : 0, points_removed: args.p_action === 'unlanded' ? mode.points : 0 } };
      };
      window.underClicks = 0;
      document.querySelector('#under-popup').addEventListener('click', () => underClicks++);
      // Keep expiry timers deterministic while retaining the production RAF animation.
      window.popupTimers = [];
      window.setTimeout = (callback, delay) => { popupTimers.push({ callback, delay }); return popupTimers.length; };
    });
    await page.addScriptTag({ content: code + `
      window.clearPopups = () => { document.querySelectorAll('.progress-popup-stack').forEach(stack => stack.remove()); popupTimers.length = 0; };
      window.mountAction = (action = 'landed', category = 'one_bang') => {
        document.querySelector('#fixture-list').innerHTML = '<div class="assignment-row ' + (action === 'unlanded' ? 'complete' : '') + '"><strong>Barspin &amp; tailwhip</strong><button type="button" data-assignment-id="points-assignment" data-assignment-action="' + action + '" data-assignment-category="' + category + '">' + (action === 'unlanded' ? '✓' : '') + '</button></div>';
        document.querySelector('[data-assignment-action]').addEventListener('click', event => { window.pendingRecord = recordAssignmentAction(event); });
      };
    ` });

    for (const width of [320, 390, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(async theme => {
          clearPopups(); document.documentElement.dataset.theme = theme;
          document.querySelector('#under-popup').focus();
          mode.total = 27;
          await showUpdatedWeeklyScore(2, 'Barspin → Tailwhip');
          mode.total = 27.5;
          await showUpdatedWeeklyScore(0.5, 'Fundamental skill');
          mode.total = 32.5;
          await showUpdatedWeeklyScore(5, 'Opposite barspin');
        }, theme);
        await page.waitForFunction(() => [...document.querySelectorAll('.score-popup')].every(popup => popup.classList.contains('show')));
        await page.waitForFunction(() => [...document.querySelectorAll('.score-popup')].every(popup => popup.getAnimations().length === 0));
        eq(await page.locator('.score-popup-points strong').allTextContents(), ['+2', '+0.5', '+5'], `${width}px ${theme}: show exact individual awards`);
        eq(await page.locator('.score-popup-total b').allTextContents(), ['27 pts', '27.5 pts', '32.5 pts'], `${width}px ${theme}: show confirmed weekly totals`);
        eq(await page.locator('.score-popup-trick').allTextContents(), ['Barspin → Tailwhip', 'Fundamental skill', 'Opposite barspin'], `${width}px ${theme}: show the actual trick names`);
        eq(await page.locator('.score-popup .progress-popup-xp').count(), 0, `${width}px ${theme}: no giant PTS disk or XP marker`);
        eq(await page.locator('.score-popup-stack').getAttribute('aria-live'), 'polite', 'Awards are announced politely');
        eq(await page.locator('.score-popup-stack').getAttribute('aria-relevant'), 'additions', 'Expired awards are not re-announced');
        eq(await page.locator('.score-popup[aria-atomic="true"]').count(), 3, 'Each award is announced as one unit');
        eq(await page.evaluate(() => document.activeElement.id), 'under-popup', 'Awards do not steal focus');
        const layout = await page.locator('.score-popup-stack').evaluate(stack => {
          const bounds = stack.getBoundingClientRect();
          const colour = getComputedStyle(stack.querySelector('.score-popup')).backgroundColor;
          return {
            left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
            viewport: innerWidth, height: innerHeight, pointerEvents: getComputedStyle(stack).pointerEvents,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            cards: [...stack.children].map(popup => ({
              width: popup.getBoundingClientRect().width, height: popup.getBoundingClientRect().height,
              overflow: popup.scrollWidth > popup.clientWidth + 1,
              titleTransform: getComputedStyle(popup.querySelector('.score-popup-trick')).textTransform,
              titleSize: parseFloat(getComputedStyle(popup.querySelector('.score-popup-trick')).fontSize),
              amountSize: parseFloat(getComputedStyle(popup.querySelector('.score-popup-points strong')).fontSize),
              iconWidth: popup.querySelector('.score-popup-status svg').getBoundingClientRect().width,
              background: colour,
            })),
          };
        });
        ok(layout.left >= 10 && layout.right <= width - 10 && layout.top >= 0 && layout.bottom <= layout.height, `${width}px ${theme}: stack stays inside the screen`);
        eq(layout.overflow, false, `${width}px ${theme}: no page overflow`);
        eq(layout.pointerEvents, 'none', 'Points feedback never blocks training controls');
        ok(layout.cards.every(card => card.height >= 100 && card.height <= 130 && !card.overflow), `${width}px ${theme}: cards stay compact without clipping`);
        ok(layout.cards.every(card => card.titleTransform === 'none' && card.titleSize <= 16 && card.amountSize >= 28 && card.iconWidth <= 16), `${width}px ${theme}: clear hierarchy with prominent points and a small icon`);
        if (width <= 900) ok(layout.bottom <= layout.height - 112, `${width}px ${theme}: awards sit above bottom navigation`);
        else ok(layout.right > width - 30 && layout.top < 100, `${width}px ${theme}: desktop awards sit at top-right`);
        const underBefore = await page.evaluate(() => underClicks);
        await page.mouse.click(layout.left + 20, layout.top + 20);
        eq(await page.evaluate(() => underClicks), underBefore + 1, 'A native tap passes through the nonblocking card');
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `points-feedback-${width}-${theme}.png`), animations: 'disabled' });
      }
    }

    await page.evaluate(() => { clearPopups(); for (let points = 1; points <= 8; points++) showProgressPopup({ kind: 'score', pointsChange: points, trickName: 'Rapid saved award', weeklyTotal: 40 + points }); });
    eq(await page.locator('.score-popup-points strong').allTextContents(), ['+6', '+7', '+8'], 'Rapid saved awards keep only the latest three cards without merging their values');
    await page.setViewportSize({ width: 390, height: 480 });
    await page.evaluate(() => { clearPopups(); for (let points = 1; points <= 3; points++) showProgressPopup({ kind: 'score', pointsChange: points, trickName: 'Saved award', weeklyTotal: 40 + points }); });
    ok(await page.locator('.score-popup-stack').evaluate(stack => stack.getBoundingClientRect().top >= 16), 'Short mobile screens also keep the stack within the viewport');
    await page.setViewportSize({ width: 390, height: 844 });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await page.locator('.score-popup').first().evaluate(popup => ({ transition: getComputedStyle(popup).transitionProperty, duration: getComputedStyle(popup).transitionDuration, animation: getComputedStyle(popup).animationName }));
    eq(reduced.transition, 'none', 'Reduced motion removes the pop transition');
    eq(reduced.animation, 'none', 'Reduced motion has no secondary animation');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await page.evaluate(async () => {
      clearPopups();
      const before = leaderboardCalls;
      for (const points of [0, NaN, Infinity, -Infinity]) await showUpdatedWeeklyScore(points, 'Invalid reward');
      for (const kind of ['xp', 'badge', 'level', 'prestige']) showProgressPopup({ kind });
      window.invalidQueries = leaderboardCalls - before;
    });
    eq(await page.locator('.progress-popup').count(), 0, 'Zero, invalid and retired XP rewards do not render');
    eq(await page.evaluate(() => invalidQueries), 0, 'Invalid awards do not query the leaderboard');
    await page.evaluate(() => {
      showProgressPopup({ kind: 'daily', title: 'Daily complete', message: 'Original daily feedback' });
      showProgressPopup({ kind: 'score', pointsChange: -0.5, trickName: 'Skill unticked', weeklyTotal: 26.5 });
    });
    eq(await page.locator('.daily-popup .progress-popup-xp').textContent(), '✓', 'Existing Daily feedback remains unchanged');
    eq(await page.locator('.progress-popup-stack:not(.score-popup-stack) .daily-popup').count(), 1, 'Daily feedback keeps its original independent stack');
    eq(await page.locator('.score-popup.is-adjustment .score-popup-points strong').textContent(), '-0.5', 'Adjustments retain their exact sign and fraction');

    await page.evaluate(async () => {
      clearPopups(); mode.leaderboardError = true;
      await showUpdatedWeeklyScore(0.5, '<img src=x onerror=alert(1)>');
      mode.leaderboardError = false;
    });
    eq(await page.locator('.score-popup-points strong').textContent(), '+0.5', 'A saved reward survives a leaderboard-only refresh failure');
    eq(await page.locator('.score-popup-total').textContent(), 'Points saved', 'Unavailable totals are never invented');
    eq(await page.locator('.score-popup-trick').textContent(), '<img src=x onerror=alert(1)>', 'Trick names remain escaped text');
    eq(await page.locator('.score-popup img').count(), 0, 'Trick names cannot inject media or handlers');
    await page.evaluate(async () => { clearPopups(); mode.missingRow = true; await showUpdatedWeeklyScore(2, 'Saved trick'); mode.missingRow = false; });
    eq(await page.locator('.score-popup-total').textContent(), 'Points saved', 'A missing leaderboard row never displays an incorrect zero total');

    await page.evaluate(async () => {
      clearPopups(); mode.leaderboardHold = true; mode.total = 35; window.scoreReturned = false;
      await showUpdatedWeeklyScore(2, 'Instant saved reward'); scoreReturned = true;
    });
    eq(await page.locator('.score-popup-points strong').textContent(), '+2', 'Confirmed points render while the leaderboard request is still pending');
    eq(await page.locator('.score-popup-total').textContent(), 'Points saved', 'Pending leaderboard does not block reward acknowledgement');
    eq(await page.evaluate(() => scoreReturned), true, 'Score feedback resolves without waiting for the leaderboard');
    await page.evaluate(async () => { mode.leaderboardHold = false; releaseLeaderboard(); await Promise.resolve(); });
    await page.waitForFunction(() => document.querySelector('.score-popup-total b')?.textContent === '35 pts');
    eq(await page.locator('.score-popup').count(), 1, 'Verified total updates the same live card without a second popup');
    await page.evaluate(async () => {
      clearPopups(); mode.leaderboardHold = true; mode.total = 99;
      await showUpdatedWeeklyScore(0.5, 'Original account reward');
      state.user.id = 'different-account'; mode.leaderboardHold = false; releaseLeaderboard(); await Promise.resolve();
    });
    eq(await page.locator('.score-popup-total').textContent(), 'Points saved', 'A late total cannot paint after an account switch');
    for (const changed of ['sessionSetupVersion', 'loadingOverlayToken']) {
      await page.evaluate(async changed => {
        clearPopups(); state.user.id = 'points-rider'; mode.leaderboardHold = true; mode.total = 99;
        await showUpdatedWeeklyScore(0.5, 'Saved on an earlier screen');
        state[changed] = (state[changed] || 0) + 1;
        mode.leaderboardHold = false; releaseLeaderboard(); await Promise.resolve();
      }, changed);
      eq(await page.locator('.score-popup-total').textContent(), 'Points saved', `A late total cannot paint after changing ${changed}`);
    }
    await page.evaluate(async () => {
      clearPopups(); state.user.id = 'points-rider'; mode.leaderboardHold = true;
      await showUpdatedWeeklyScore(2, 'Expired card');
      clearPopups(); mode.leaderboardHold = false; releaseLeaderboard(); await Promise.resolve();
    });
    eq(await page.locator('.score-popup').count(), 0, 'A late total cannot recreate a removed reward card');

    // Saved positive weekly actions produce one feedback card; failed/undo/no-award paths retain their original notices.
    await page.evaluate(async () => {
      clearPopups(); notifications.length = 0; mode.points = 2; mode.halfPoints = 0; mode.total = 29; mountAction();
      document.querySelector('[data-assignment-action]').click(); await pendingRecord;
    });
    eq(await page.locator('.score-popup-points strong').textContent(), '+2', 'Successful action uses the actual server points award');
    eq(await page.locator('.score-popup-total b').textContent(), '29 pts', 'Successful action uses the confirmed weekly score');
    eq(await page.evaluate(() => notifications), [], 'A saved positive completion has no duplicate generic toast');
    await page.evaluate(async () => {
      clearPopups(); notifications.length = 0; mode.leaderboardHold = true; window.rendersBeforeDelayedScore = renderCalls; mountAction();
      document.querySelector('[data-assignment-action]').click(); await pendingRecord;
    });
    eq(await page.locator('.score-popup-points strong').textContent(), '+2', 'Saved handler acknowledges points even when its leaderboard refresh is slow');
    eq(await page.evaluate(() => renderCalls - rendersBeforeDelayedScore), 1, 'Saved handler repaints training without waiting for the weekly total');
    await page.evaluate(async () => { mode.leaderboardHold = false; releaseLeaderboard(); await Promise.resolve(); });
    await page.evaluate(async () => {
      clearPopups(); notifications.length = 0; mode.points = 0; mode.halfPoints = 0.5; mode.total = 29.5; mountAction('landed', 'other');
      document.querySelector('[data-assignment-action]').click(); await pendingRecord;
    });
    eq(await page.locator('.score-popup-points strong').textContent(), '+0.5', 'Fundamental Skills preserve their server half-point award');
    eq(await page.evaluate(() => notifications), [], 'Half-point completion also has one feedback card');
    await page.evaluate(async () => {
      clearPopups(); notifications.length = 0; mode.error = 'Connection interrupted'; mountAction();
      document.querySelector('[data-assignment-action]').click(); await pendingRecord;
    });
    eq(await page.locator('.score-popup').count(), 0, 'Failed writes never celebrate points');
    eq(await page.evaluate(() => notifications), [{ message: 'Connection interrupted', tone: 'error' }], 'Failed writes still show their error');
    eq(await page.locator('[data-assignment-action]').isEnabled(), true, 'Failed write remains retryable');
    eq(await page.locator('.assignment-row.complete').count(), 0, 'Failed write rolls back its optimistic tick');
    await page.evaluate(async () => {
      clearPopups(); notifications.length = 0; mode.error = null; mode.points = 2; mode.halfPoints = 0; mountAction('unlanded');
      document.querySelector('[data-assignment-action]').click(); await pendingRecord;
    });
    eq(await page.locator('.score-popup').count(), 0, 'Undo does not show a positive reward card');
    ok((await page.evaluate(() => notifications[0].message)).includes('-2 points'), 'Undo retains its point-removal notice');
    await page.evaluate(async () => {
      clearPopups(); notifications.length = 0; mode.points = 0; mountAction();
      document.querySelector('[data-assignment-action]').click(); await pendingRecord;
    });
    eq(await page.locator('.score-popup').count(), 0, 'No-award completion does not invent a reward');
    eq(await page.evaluate(() => notifications.length), 1, 'No-award completion keeps its ordinary status notice');

    for (const changed of ['account', 'session']) {
      await page.evaluate(async changed => {
        clearPopups(); notifications.length = 0; mode.points = 2; mode.saveHold = true;
        window.beforeStaleSaveRenders = renderCalls;
        mountAction(); document.querySelector('[data-assignment-action]').click();
        if (changed === 'account') state.user.id = 'next-rider';
        else state.sessionSetupVersion = (state.sessionSetupVersion || 0) + 1;
        mode.saveHold = false; releaseSave(); await pendingRecord;
        state.user.id = 'points-rider';
      }, changed);
      eq(await page.locator('.score-popup').count(), 0, `An old save cannot reveal a trick after a ${changed} change`);
      eq(await page.evaluate(() => notifications.length), 0, 'An old save cannot send a toast into the new session');
      eq(await page.evaluate(() => renderCalls - beforeStaleSaveRenders), 0, 'An old save cannot repaint the new account');
    }

    await page.evaluate(() => { clearPopups(); showProgressPopup({ kind: 'score', pointsChange: 2, trickName: 'Expiry check', weeklyTotal: 31.5 }); });
    eq(await page.evaluate(() => popupTimers.map(timer => timer.delay)), [3200], 'Score feedback keeps a brief automatic lifetime');
    await page.evaluate(() => { popupTimers.shift().callback(); popupTimers.shift().callback(); });
    eq(await page.locator('.score-popup-stack').count(), 0, 'Expired awards remove their empty stack');
    eq(errors, [], 'No browser errors');
    eq(requests, [], 'Synthetic feedback tests make no production requests');
    ok(await page.evaluate(() => leaderboardOptions.every(options => options?.force === true)), 'Weekly totals force a fresh verified lean summary after a successful save');
    console.log(`Points feedback UI: ${checks} checks passed at 320/390/1024px in dark/light themes, including exact fractions, reduced motion and saved/failed/undo actions. No production writes.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
