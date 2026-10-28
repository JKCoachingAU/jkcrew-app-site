// Actual crown cards, refresh and realtime callbacks with synthetic data only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Actual function exists: ' + name);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const functions = ['parkCrownTitle', 'parkKingCardHtml', 'commandParkKingVenueList', 'parkKingForVenue', 'commandParkKingsAccordionHtml', 'renderCommandParkKingSelection', 'refreshParkKingCard', 'realtimeFilter', 'setupRealtimeSync'];
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR || '/tmp/jkcrew-park-crown-qa';
fs.mkdirSync(screenshotDir, { recursive: true });
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (actual, label) => { assert(actual, label); checks++; };
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    for (const width of [390, 1440]) for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 500 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div class="app-shell rider-shell" style="display:block"><main id="view" class="content" data-view="session"></main></div></body></html>`);
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
      await page.evaluate(() => {
        window.state = { user: { id: 'self' }, profile: { role: 'athlete' }, session: { access_token: 'synthetic' }, sessionSetupVersion: 1, view: 'home', parkKingRequestSerial: 0, selectedVenue: 'OASIS PARK' };
        window.qaHandlers = []; window.qaNotices = []; window.qaCelebrations = []; window.qaCachesCleared = [];
        window.qaCrown = { athlete_id: 'girl', display_name: 'Lara', crown_title: 'Queen', venue_name: 'OASIS PARK', points: 7 };
        window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        window.avatarHtml = row => `<span class="avatar park-king-avatar">${escapeHtml(row.display_name.slice(0, 2))}</span>`;
        window.venueKey = value => String(value || '').trim();
        window.venueLabel = value => value || 'Choose a park';
        window.venueIdentityKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        window.getParkKing = async () => structuredClone(qaCrown);
        window.cacheClear = value => qaCachesCleared.push(value);
        window.notify = value => qaNotices.push(value);
        window.showAchievementCelebration = value => qaCelebrations.push(value);
        window.riderRecoveryActive = window.riderFeaturesDisabled = window.riderFeatureAccessUnknown = window.isContestPrepProfile = () => false;
        window.realtimeVisibleAthleteIds = async () => ['self'];
        window.setupLiveRunDiscovery = () => {};
        window.contestPrepGroupId = 'contest_prep';
        window.refreshCommandParkKings = () => {};
        window.client = {
          realtime: { setAuth: () => {} },
          channel: () => { const channel = { on: (_event, filter, handler) => { qaHandlers.push({ filter, handler }); return channel; }, subscribe: () => {} }; return channel; },
        };
      });
      await page.addScriptTag({ content: functions.map(extract).join('\n') });
      for (const shell of ['rider', 'coach']) {
        await page.evaluate(shell => { document.querySelector('.app-shell').className = `app-shell ${shell}-shell`; document.querySelector('#view').dataset.view = shell === 'coach' ? 'sessionViewer' : 'session'; }, shell);
        for (const name of ['Kebe', 'mylee toohey', 'Ali', 'Kim Lea Müller', 'Lara', 'Romy King']) {
          await page.evaluate(name => { qaCrown.display_name = name; document.querySelector('#view').innerHTML = parkKingCardHtml(qaCrown, 'OASIS PARK', { id: 'crown', compact: true }); }, name);
          eq(await page.locator('.park-king-label span').textContent(), 'Queen of the Park', `${shell} ${name} Queen title`);
          eq(await page.locator('.park-king-rider small').textContent(), '7 park points', 'Crown wording preserves the score');
          ok(await page.locator('.park-king-card').evaluate(el => el.getBoundingClientRect().right <= window.innerWidth + 1), 'Card fits viewport');
          ok(await page.locator('.park-king-card').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Card content does not overflow');
        }
        await page.screenshot({ path: path.join(screenshotDir, `${shell}-${width}-${theme}.png`) });
      }
      await page.evaluate(() => { qaCrown.display_name = 'New display name'; document.querySelector('#view').innerHTML = parkKingCardHtml(qaCrown, 'OASIS PARK', { id: 'crown' }); });
      eq(await page.locator('.park-king-label span').textContent(), 'Queen of the Park', 'Renaming never changes account-backed crown title');
      for (const title of ['King', 'Queen', 'King']) {
        await page.evaluate(async title => { qaCrown.crown_title = title; await refreshParkKingCard('crown', 'OASIS PARK'); }, title);
        eq(await page.locator('.park-king-label span').textContent(), title + ' of the Park', 'Refreshed crown changes with its winner');
        eq(await page.locator('.park-king-rider small').textContent(), '7 park points', 'Refresh never changes reported points');
      }
      await page.evaluate(() => { qaCrown.crown_title = 'Queen'; qaCrown.display_name = '<img src=x onerror="window.injected=true">'; document.querySelector('#view').innerHTML = parkKingCardHtml(qaCrown, 'OASIS PARK'); });
      eq(await page.locator('.park-king-rider img').count(), 0, 'Champion name is escaped');
      eq(await page.evaluate(() => Boolean(window.injected)), false, 'Champion name cannot run markup');
      for (const loading of [true, false]) {
        await page.evaluate(loading => { document.querySelector('#view').innerHTML = parkKingCardHtml(null, 'OASIS PARK', { loading }); }, loading);
        eq(await page.locator('.park-king-label span').textContent(), 'Park crown', 'Empty and loading states do not guess a title');
      }
      await page.evaluate(() => {
        qaCrown.display_name = 'Lara';
        document.querySelector('#view').innerHTML = commandParkKingsAccordionHtml([{ category: 'daily', venue: 'OASIS PARK' }], [qaCrown]);
      });
      eq(await page.locator('summary strong').textContent(), 'Park Kings & Queens', 'Coach overview includes both titles');
      await page.locator('summary').click();
      eq(await page.locator('.park-king-label span').textContent(), 'Queen of the Park', 'Coach selected venue keeps Queen title');
      await page.evaluate(() => setupRealtimeSync());
      for (const title of ['Queen', 'King']) {
        await page.evaluate(title => {
          qaHandlers.find(entry => entry.filter.table === 'park_king_events').handler({ new: { athlete_id: 'other', display_name: 'Winner', venue_name: 'OASIS PARK', points: 8, crown_title: title } });
        }, title);
        eq(await page.evaluate(() => qaNotices.at(-1)), `Winner is the new ${title} of OASIS PARK with 8 park points.`, 'Other rider receives matching crown toast');
        await page.evaluate(title => {
          qaHandlers.find(entry => entry.filter.table === 'park_king_events').handler({ new: { athlete_id: 'self', display_name: 'Me', venue_name: 'OASIS PARK', points: 9, crown_title: title } });
        }, title);
        eq(await page.evaluate(() => qaCelebrations.at(-1).title), title + ' of OASIS PARK', 'Winning rider celebration has matching title');
      }
      eq(await page.evaluate(() => qaCachesCleared), Array(4).fill(['park-king:', 'park-kings:']).flat(), 'All crown events invalidate both existing caches');
      eq(errors, [], 'No browser errors');
      await page.close();
    }
    console.log(`Park crown UI: ${checks} checks passed (390/1440px, dark/light, rider/coach). Screenshots: ${screenshotDir}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
