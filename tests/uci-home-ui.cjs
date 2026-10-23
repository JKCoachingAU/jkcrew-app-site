// Actual UCI Home UI with isolated public-feed fixtures; no production accounts or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Production function exists: ' + name);
  const rest = app.slice(start), end = rest.indexOf('\n}');
  assert(end >= 0, 'Production function ends: ' + name);
  return rest.slice(0, end + 2);
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const errors = [];
  let checks = 0;
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const ok = (actual, label) => { assert(actual, label); checks++; };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url() === 'http://jkcrew.test/'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div class="app-shell rider-shell" style="display:block"><main id="view" class="content" data-view="home"><div id="athlete-home-uci"></div></main></div></body></html>' })
      : route.abort());
    await page.goto('http://jkcrew.test/');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'uci-rankings.js'), 'utf8') });
    await page.evaluate(() => {
      window.state = { user: { id: 'rider-one' }, profile: null, view: 'home', boardLeaderboardView: 'weekly', boardUciSearch: '' };
      window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      window.qa = { calls: [], navigations: [], fail: false, stale: false, hold: false, pending: [], generation: 0 };
      window.navigate = view => { qa.navigations.push(view); state.view = view; };
      window.qaSnapshot = {
        schemaVersion: 1, checkedAt: '2026-10-23T04:56:38.276Z', categories: {
          men: { rankingDate: '2026-10-20', sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/156', rows: [
            { uciId: '10000000001', name: 'KINDERMANN Lars', nation: 'GER', rank: 13, points: 2610, change: 2 },
            { uciId: '10000000002', name: 'UNRELATED Sam', nation: 'AUS', rank: 71, points: 217, change: -3 },
          ] },
          women: { rankingDate: '2026-10-20', sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/157', rows: [
            { uciId: '10000000003', name: 'NORRIS Alirah', nation: 'AUS', rank: 18, points: 1985, change: -1 },
          ] },
        },
      };
      const findRider = window.JKCUciRankings.findRider;
      window.JKCUciRankings = { findRider, load: async options => {
        qa.calls.push(options || {});
        const snapshot = { ...structuredClone(qaSnapshot), stale: qa.stale };
        if (qa.hold) await new Promise(resolve => qa.pending.push(resolve));
        if (qa.fail) throw Error('Synthetic public feed failure');
        return snapshot;
      } };
      window.qaRender = async (uciId = '10000000001', displayName = 'My nickname') => {
        state.view = 'home'; qa.generation++;
        const generation = qa.generation, userId = state.user.id;
        state.profile = { id: userId, role: 'athlete', display_name: displayName, uci_id: uciId };
        document.querySelector('#view').innerHTML = '<div id="athlete-home-uci"></div>';
        const view = document.querySelector('#view');
        return loadAthleteUciHome(view, state.profile, () => state.view === 'home' && state.user.id === userId && qa.generation === generation && document.querySelector('#view') === view);
      };
    });
    await page.addScriptTag({ content: ['boardUciSourceUrl', 'boardUciDate', 'boardUciSearchText', 'athleteUciCardHtml', 'loadAthleteUciHome', 'uciProfileLinkHtml', 'bindUciProfileLink', 'saveUciProfileLink'].map(extract).join('\n') });

    eq(await page.evaluate(() => athleteUciCardHtml({ display_name: 'KINDERMANN Lars' }, qaSnapshot)), '', 'A familiar display name alone never fabricates a UCI identity');
    await page.evaluate(() => qaRender(''));
    eq(await page.locator('.home-uci-card').count(), 0, 'Unlinked riders keep their current homepage');
    eq(await page.evaluate(() => qa.calls.length), 0, 'Unlinked riders make no ranking download');

    await page.evaluate(() => qaRender());
    let text = await page.locator('.home-uci-card').innerText();
    ok(text.includes('#13'), 'Home shows the official UCI rank, not a filtered row number');
    ok(/2[,.]?610/.test(text), 'Home shows UCI points');
    ok(/Men/.test(text), 'Home identifies the official Men category');
    ok(text.includes('20 Oct 2026'), 'Official ranking date is visible');
    await page.locator('[data-home-uci-board]').click();
    eq(await page.evaluate(() => [qa.navigations.at(-1), state.boardLeaderboardView, state.boardUciSearch]), ['board', 'uciMen', 'KINDERMANN Lars'], 'Ranking opens the matching leaderboard and rider');

    await page.evaluate(() => qaRender('10000000003', 'Ali'));
    text = await page.locator('.home-uci-card').innerText();
    ok(text.includes('#18') && /Women/.test(text), 'A linked nickname resolves to the exact Women UCI identity');
    await page.locator('[data-home-uci-board]').click();
    eq(await page.evaluate(() => [state.boardLeaderboardView, state.boardUciSearch]), ['uciWomen', 'NORRIS Alirah'], 'Women card links to the correct list');

    await page.evaluate(() => qaRender('19999999999', 'KINDERMANN Lars'));
    text = await page.locator('#athlete-home-uci').innerText();
    ok(!text.includes('#13') && !text.includes('#0'), 'An absent explicit ID never falls back to a matching name or rank zero');
    ok(/not|unavailable|rank/i.test(text), 'Absent ID has an understandable state');

    await page.evaluate(() => { qa.stale = true; return qaRender(); });
    text = await page.locator('.home-uci-card').innerText();
    ok(text.includes('#13') && /last available|could not|couldn.t|cached|confirm|older/i.test(text), 'Cached rank remains visible with an update warning');
    await page.evaluate(() => { qa.stale = false; });
    await page.locator('[data-home-uci-retry]').click();
    await page.waitForFunction(() => qa.calls.at(-1)?.force === true);
    ok(await page.locator('.home-uci-card').innerText().then(value => value.includes('#13')), 'Refresh keeps the verified ranking available');

    await page.evaluate(() => { qa.fail = true; return qaRender(); });
    ok(await page.locator('[data-home-uci-retry]').isVisible(), 'Feed failure offers an explicit retry');
    ok(!(await page.locator('#athlete-home-uci').innerText()).includes('#0'), 'Feed failure never claims zero world ranking');
    const beforeRetry = await page.evaluate(() => qa.calls.length);
    await page.evaluate(() => {
      qa.fail = false; qa.hold = true;
      const retry = document.querySelector('[data-home-uci-retry]'); retry.click(); retry.click();
    });
    await page.waitForFunction(count => qa.calls.length > count, beforeRetry);
    eq(await page.evaluate(() => qa.calls.length), beforeRetry + 1, 'Rapid retry taps produce one pending request');
    await page.evaluate(() => { qa.hold = false; qa.pending.splice(0).forEach(resolve => resolve()); });
    await page.waitForFunction(() => document.querySelector('#athlete-home-uci').textContent.includes('#13'));

    for (const theme of ['dark', 'light']) for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const overflow = await page.locator('.home-uci-card').evaluate(card => [...card.querySelectorAll('*'), card].filter(node => {
        const style = getComputedStyle(node);
        return style.display !== 'inline' && node.clientWidth && node.scrollWidth > node.clientWidth + 2 && !['auto', 'scroll'].includes(style.overflowX);
      }).map(node => ({ tag: node.tagName, class: node.className, width: node.clientWidth, content: node.scrollWidth })));
      eq(overflow, [], theme + ' homepage card fits ' + width + 'px');
      for (const button of await page.locator('.home-uci-card button').all()) ok((await button.boundingBox()).height >= 44, 'Card controls retain 44px tap targets');
      if (process.env.JKCREW_SCREENSHOT_DIR && [390, 1440].includes(width)) {
        fs.mkdirSync(process.env.JKCREW_SCREENSHOT_DIR, { recursive: true });
        await page.locator('.home-uci-card').screenshot({ path: path.join(process.env.JKCREW_SCREENSHOT_DIR, 'uci-home-' + theme + '-' + width + '.png') });
      }
    }

    for (const transition of ['navigate', 'account', 'render']) {
      await page.evaluate(() => { qa.hold = true; window.qaInFlight = qaRender(); });
      await page.waitForFunction(() => qa.pending.length > 0);
      await page.evaluate(transition => {
        if (transition === 'navigate') state.view = 'profile';
        if (transition === 'account') state.user = { id: 'another-rider' };
        if (transition === 'render') qa.generation++;
        document.querySelector('#view').innerHTML = '<p id="new-view">New screen stays here</p>';
        qa.hold = false; qa.pending.splice(0).forEach(resolve => resolve());
        return qaInFlight;
      }, transition);
      eq(await page.locator('#view').innerText(), 'New screen stays here', transition + ' makes an old ranking response inert');
    }

    await page.evaluate(() => { qaSnapshot.categories.men.rows[0].name = '<img src=x onerror="window.injected=true">'; return qaRender(); });
    eq(await page.locator('.home-uci-card img').count(), 0, 'Official names cannot inject markup into Home');
    eq(await page.evaluate(() => Boolean(window.injected)), false, 'Untrusted feed text does not execute');

    await page.evaluate(() => {
      qaSnapshot.categories.men.rows[0].name = 'KINDERMANN Lars';
      window.qaWrite = { calls: [], fail: false, held: false, pending: [], caches: [] };
      window.isCoachRole = role => ['coach', 'admin'].includes(role);
      window.withTimeout = promise => promise;
      window.messageFrom = error => error.message;
      window.cacheClear = key => qaWrite.caches.push(key);
      window.client = { from(table) {
        const call = { table, update: null, filters: [], select: '' };
        const query = {
          update(value) { call.update = structuredClone(value); return query; },
          eq(key, value) { call.filters.push([key, value]); return query; },
          select(value) { call.select = value; return query; },
          async single() {
            qaWrite.calls.push(structuredClone(call));
            if (qaWrite.held) await new Promise(resolve => qaWrite.pending.push(resolve));
            if (qaWrite.fail) return { data: null, error: new Error('Synthetic temporary save failure') };
            return { data: { id: call.filters.find(([key]) => key === 'id')[1], uci_id: call.update.uci_id }, error: null };
          },
        }; return query;
      } };
      window.qaLink = (role = 'athlete', viewerId = 'rider-one', targetId = 'rider-one', uciId = '') => {
        state.user = { id: viewerId }; state.profile = { id: viewerId, role, uci_id: '' };
        state.selectedAthleteId = role === 'athlete' ? null : targetId; state.view = role === 'athlete' ? 'profile' : 'student';
        const target = { id: targetId, role: 'athlete', display_name: 'Fixture Rider', uci_id: uciId };
        document.querySelector('#view').innerHTML = uciProfileLinkHtml(target);
        bindUciProfileLink(document.querySelector('#view'), target);
      };
      window.qaSubmit = targetId => saveUciProfileLink({ preventDefault() {}, currentTarget: document.querySelector('[data-uci-profile-form]') }, targetId || state.user.id);
    });
    const feedback = () => page.locator('[data-uci-link-feedback]').innerText();
    const saveLink = () => page.getByRole('button', { name: 'Save UCI link', exact: true }).click();
    const waitSave = () => page.waitForFunction(() => !document.querySelector('[data-uci-profile-form]').dataset.saving);

    await page.evaluate(() => qaLink());
    await page.locator('[data-uci-rider-search]').fill('Lars Kindermann');
    await page.locator('[data-uci-choice="10000000001"]').waitFor();
    eq(await page.locator('[data-uci-choice]').count(), 1, 'Search accepts first/last names in either order');
    await page.locator('[data-uci-choice="10000000001"]').click();
    eq(await page.locator('[name="uciId"]').inputValue(), '10000000001', 'Selecting a result copies the stable UCI ID');
    await saveLink(); await waitSave();
    eq(await page.evaluate(() => qaWrite.calls.at(-1)), { table: 'profiles', update: { uci_id: '10000000001' }, filters: [['id', 'rider-one']], select: 'id,uci_id' }, 'Own profile saves only UCI ID to the current rider');
    eq(await page.evaluate(() => state.profile.uci_id), '10000000001', 'Successful own save updates Home profile identity');
    ok((await feedback()).includes('KINDERMANN Lars'), 'Saved confirmation identifies the linked rider');

    await page.evaluate(() => qaLink('coach', 'coach-one', 'rider-two'));
    await page.locator('[data-uci-rider-search]').fill('Alirah');
    await page.locator('[data-uci-choice="10000000003"]').click();
    await saveLink(); await waitSave();
    eq(await page.evaluate(() => qaWrite.calls.at(-1).filters), [['id', 'rider-two']], 'Coach saves the selected rider instead of their own profile');
    eq(await page.evaluate(() => state.profile.uci_id), '', 'Coach identity remains unchanged');
    ok(await page.evaluate(() => qaWrite.caches.includes('roster') && qaWrite.caches.includes('session-viewer-roster:')), 'Successful links invalidate relevant cached rider summaries');

    await page.evaluate(() => { qaLink(); qaWrite.fail = true; });
    await page.locator('[name="uciId"]').fill('10000000001');
    await saveLink(); await waitSave();
    ok(/couldn.t save/i.test(await feedback()), 'Backend error is visible');
    eq(await page.locator('[name="uciId"]').inputValue(), '10000000001', 'Failed save retains rider selection');
    ok(await page.getByRole('button', { name: 'Save UCI link', exact: true }).isEnabled(), 'Failed save releases the button for retry');
    await page.evaluate(() => { qaWrite.fail = false; }); await saveLink(); await waitSave();
    ok((await feedback()).includes('Linked to'), 'Retry succeeds without re-entering the choice');

    let writes = await page.evaluate(() => qaWrite.calls.length);
    await page.locator('[name="uciId"]').fill('123'); await page.evaluate(() => qaSubmit());
    eq(await page.evaluate(() => qaWrite.calls.length), writes, 'Invalid ID format cannot write');
    ok((await feedback()).includes('11-digit'), 'Invalid ID explains the expected format');
    await page.locator('[name="uciId"]').fill('19999999999'); await saveLink(); await waitSave();
    eq(await page.evaluate(() => qaWrite.calls.length), writes, 'A valid-shaped but unlisted ID cannot be linked');

    await page.locator('[name="uciId"]').fill('10000000001');
    await page.evaluate(() => { qa.hold = true; window.qaSaveOne = qaSubmit(); window.qaSaveTwo = qaSubmit(); });
    await page.waitForFunction(() => qa.pending.length === 1);
    ok(await page.locator('[name="uciId"]').isDisabled(), 'Selection is locked while its save is pending');
    await page.evaluate(async () => { qa.hold = false; qa.pending.splice(0).forEach(resolve => resolve()); await Promise.all([qaSaveOne, qaSaveTwo]); });
    eq(await page.evaluate(() => qaWrite.calls.length), writes + 1, 'Repeated submissions perform one profile write');

    const callsBeforeClear = await page.evaluate(() => qa.calls.length);
    await page.locator('[name="uciId"]').fill(''); await saveLink(); await waitSave();
    eq(await page.evaluate(() => qaWrite.calls.at(-1).update), { uci_id: null }, 'Rider can remove their link');
    eq(await page.evaluate(() => qa.calls.length), callsBeforeClear, 'Removing a link works without downloading UCI data');

    for (const transition of ['account', 'selected-rider', 'detached']) {
      await page.evaluate(() => { qaLink('coach', 'coach-one', 'rider-two', '10000000003'); qa.hold = true; window.qaSavePending = qaSubmit('rider-two'); });
      await page.waitForFunction(() => qa.pending.length === 1);
      writes = await page.evaluate(() => qaWrite.calls.length);
      await page.evaluate(async transition => {
        if (transition === 'account') state.user.id = 'different-coach';
        if (transition === 'selected-rider') state.selectedAthleteId = 'rider-three';
        if (transition === 'detached') document.querySelector('#view').innerHTML = '<p>Another page</p>';
        qa.hold = false; qa.pending.splice(0).forEach(resolve => resolve()); await qaSavePending;
      }, transition);
      eq(await page.evaluate(() => qaWrite.calls.length), writes, transition + ' prevents a write after validation became stale');
    }

    await page.evaluate(() => qaLink('athlete', 'rider-one', 'rider-two', '10000000003'));
    writes = await page.evaluate(() => qaWrite.calls.length);
    await page.evaluate(() => qaSubmit('rider-two'));
    eq(await page.evaluate(() => qaWrite.calls.length), writes, 'Rider cannot save another rider link through this action');

    await page.evaluate(() => { qaLink(); qa.hold = true; });
    await page.locator('[data-uci-rider-search]').fill('Lars');
    await page.waitForFunction(() => qa.pending.length === 1);
    await page.locator('[data-uci-rider-search]').fill('');
    await page.evaluate(() => { qa.hold = false; qa.pending.splice(0).forEach(resolve => resolve()); });
    eq(await page.locator('[data-uci-choice]').count(), 0, 'Late search cannot re-populate results after the rider clears the query');

    eq(errors, [], 'No browser exceptions');
    console.log('PASS: ' + checks + ' UCI homepage/profile checks (ID identity, categories, points/date, no-ID loading, stale/error recovery, retry/save deduplication, responsive themes, scoped profile writes and account/view races).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
