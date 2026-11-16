// Exercise the production Daily timer card with synthetic training data only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const tail = app.slice(start);
  return tail.slice(0, tail.indexOf('\n}') + 2);
};
const code = ['latestDailyTime', 'dailySessionHubHtml'].map(extract).join('\n');
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"><div class="app-shell rider-shell" style="display:block"><main id="view" class="content" data-view="session"></main></div></div></body></html>');
    for (const file of ['styles.css', 'progress-sharing.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
    await page.evaluate(() => {
      window.state = { user: { id: 'rider' }, profile: { role: 'athlete', display_name: 'Test Rider', daily_pb_seconds: 3016 } };
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
      window.formatTime = value => {
        const seconds = Math.max(0, Math.floor(Number(value) || 0));
        return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      };
      window.formatPbTime = value => value == null ? '—' : formatTime(value);
      window.venueLabel = window.venueIdentityKey = window.dailyRpcVenue = value => value || '';
      window.dailyVenues = rows => [...new Set(rows.filter(row => row.category === 'daily').map(row => row.venue))];
      window.assignmentsForVenue = (rows, venue) => rows.filter(row => row.venue === venue);
      window.isAssignmentComplete = row => Boolean(row.complete);
      window.qaRows = [
        { id: 'daily-1', category: 'daily', venue: 'Loganland', trick_name: 'Manual', complete: true },
        { id: 'daily-2', category: 'daily', venue: 'Loganland', trick_name: '180', complete: false },
        { id: 'daily-3', category: 'daily', venue: 'The Village', trick_name: 'Air', complete: false },
      ];
      window.qaRunning = { id: 'running', daily_venue: 'Loganland', started_at: new Date(Date.now() - 72000).toISOString(), daily_completed_seconds: null };
      window.qaSaved = { ...qaRunning, id: 'saved', daily_completed_seconds: 67 };
    });
    // Use the actual progress button renderer, not a copy of its HTML.
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'progress-sharing.js'), 'utf8') });
    await page.addScriptTag({ content: code + '\nwindow.mountHub = mode => { document.querySelector("#view").innerHTML = dailySessionHubHtml(qaRows, "Loganland", mode === "running" ? qaRunning : mode === "saved" ? qaSaved : null); };' });

    for (const mode of ['ready', 'running', 'saved']) {
      await page.evaluate(mode => mountHub(mode), mode);
      assert.equal(await page.locator('#session-venue').inputValue(), 'Loganland', `${mode}: selected venue remains correct`);
      assert.equal(await page.locator('#session-venue option').count(), 2);
      assert.equal(await page.locator('.daily-session-hub > .daily-hub-actions').count(), 1, 'Actions are a dedicated row beneath the time summaries');
      assert.equal(await page.locator('.daily-hub-grid .daily-hub-actions').count(), 0, 'Actions cannot become a mismatched statistic column');
      assert.equal(await page.locator('.daily-hub-actions > button').count(), 2, 'One session action and one progress action');
      const progress = page.locator('[data-today-training-progress="rider"]');
      assert.equal(await progress.count(), 1, 'Actual progress hook remains available');
      assert.equal(await progress.getAttribute('data-progress-rider-name'), 'Test Rider');
      assert.equal(await page.locator('.daily-session-hub button button').count(), 0, 'No nested interactive controls');
      if (mode === 'ready') {
        assert.equal(await page.locator('#create-session').textContent(), 'Start Daily Tricks');
        assert.equal(await page.locator('.hub-timer.ready strong').textContent(), '00:00', 'Ready state is a time readout, not another Go action');
        assert(!/\bGO\b/.test(await page.locator('.daily-session-hub').innerText()));
        assert.equal(await page.locator('.session-time-chip strong').textContent(), 'Not finished today');
        assert.equal(await page.locator('.session-time-chip.is-pending').count(), 1, 'Pending time uses the compact status treatment');
      } else {
        assert.equal(await page.locator('#create-session').count(), 0);
        assert.equal(await page.locator('#finish-daily-tricks').textContent(), mode === 'saved' ? 'View Daily result' : 'Finish Daily Tricks');
        assert.match(await page.locator('#trick-timer').textContent(), /^\d{2}:\d{2}$/);
        if (mode === 'saved') assert.equal(await page.locator('#trick-timer').textContent(), '01:07');
      }
      assert.equal(await page.locator('.session-pb-chip').first().locator('strong').textContent(), '50:16');

      for (const width of [320, 390, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ['dark', 'light']) {
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          const layout = await page.locator('.daily-session-hub').evaluate(hub => {
            const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
            const actions = hub.querySelector('.daily-hub-actions');
            const buttons = [...actions.querySelectorAll('button')];
            return {
              overflow: document.documentElement.scrollWidth > innerWidth + 1,
              venue: rect(hub.querySelector('#session-venue')), timer: rect(hub.querySelector('.hub-timer')),
              tiles: [...hub.querySelectorAll('.session-pb-chip')].map(rect),
              actions: rect(actions), buttons: buttons.map(rect),
              clipped: buttons.some(button => button.scrollWidth > button.clientWidth + 1),
            };
          });
          assert.equal(layout.overflow, false, `${mode} ${width}px ${theme}: no horizontal overflow`);
          assert.equal(layout.clipped, false, `${mode} ${width}px ${theme}: complete action labels fit`);
          assert(layout.venue.bottom <= layout.timer.top + 1, 'Choose venue before the timer readout');
          assert.equal(layout.tiles.length, 2);
          assert(Math.abs(layout.tiles[0].height - layout.tiles[1].height) < 1.5, 'Daily PB and today summaries have equal height');
          assert(Math.abs(layout.tiles[0].top - layout.tiles[1].top) < 1.5, 'Time summaries align in one row');
          assert(layout.actions.top >= Math.max(...layout.tiles.map(tile => tile.bottom)) - 1, 'Actions follow the summaries');
          assert(layout.buttons.every(button => button.height >= 48), `${mode} ${width}px ${theme}: actions have usable tap targets: ${JSON.stringify(layout.buttons)}`);
          assert(Math.abs(layout.buttons[0].height - layout.buttons[1].height) < 1.5, 'Primary and secondary actions have equal height');
          if (width <= 600) {
            assert(layout.buttons.every(button => Math.abs(button.width - layout.actions.width) < 1.5), 'Mobile actions use the full card width');
            assert(layout.buttons[1].top >= layout.buttons[0].bottom, 'Mobile actions stack in a consistent order');
          } else {
            assert(Math.abs(layout.buttons[0].top - layout.buttons[1].top) < 1.5, 'Desktop actions form a balanced row');
          }
          if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `daily-hub-${mode}-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
        }
      }
    }
    assert.deepEqual(errors, [], 'No browser errors');
    assert.deepEqual(requests, [], 'No production requests');
    console.log('PASS: Daily hub ready/running/saved controls at 320/390/1024px in dark/light themes; venue-first order, equal time tiles, balanced action layout and actual progress-button hooks preserved.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
