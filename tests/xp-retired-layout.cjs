// Render the changed coach widgets with real CSS and synthetic riders only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const start = app.indexOf('function commandLeaderboardPreviewHtml(');
const rest = app.slice(start);
const renderer = rest.slice(0, rest.indexOf('\n}') + 2);
const summary = app.match(/<section class="student-profile-summary"[\s\S]*?<\/section>/)[0];
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div class="app-shell coach-shell" style="display:block"><main id="view" class="content"></main></div></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.evaluate(({ renderer, summary }) => {
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      window.avatarHtml = () => '<span class="avatar">RF</span>';
      window.leaderboardRankForRow = (_row, i) => i + 1;
      window.pointsReceiptAttributes = () => 'role="button" tabindex="0" aria-label="View points receipt"';
      (0, eval)(renderer);
      window.athlete = { id: 'rider-fixture' }; window.weeklyRow = { weekly_points: 27 };
      window.dailyDone = 3; window.completedWeekly = 12; window.assignedWeekly = 20;
      const rows = [{ athlete_id: 'rider-fixture', display_name: 'Rider with a deliberately long fixture display name', weekly_points: 27 }, { athlete_id: 'rider-2', display_name: 'Rider Two', weekly_points: 12345 }];
      document.querySelector('#view').innerHTML = '<section class="panel"><h2>Weekly leaderboard</h2>' + commandLeaderboardPreviewHtml(rows) + '</section>' + (0, eval)('`' + summary + '`');
    }, { renderer, summary });
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(() => {
        const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, width: r.width }; };
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          rows: [...document.querySelectorAll('.command-leader-row')].map(row => ({ row: rect(row), points: rect(row.querySelector('.command-points')) })),
          summary: [...document.querySelectorAll('.student-profile-summary article')].map(rect), text: document.querySelector('#view').innerText };
      });
      assert(layout.scrollWidth <= width + 1, `${width}px: no horizontal overflow`);
      for (const { row, points } of layout.rows) {
        assert(points.right <= row.right + 1 && points.left >= row.left, `${width}px: points fit in coach leaderboard row`);
        assert(points.width > 0, `${width}px: points remain visible`);
      }
      assert.equal(layout.summary.length, 3, `${width}px: three useful stats remain`);
      assert(layout.summary.every(card => Math.abs(card.top - layout.summary[0].top) <= 1), `${width}px: summary is one balanced row`);
      assert(!/\bXP\b|\bLevel\b/.test(layout.text), `${width}px: retired labels are absent`);
    }
    assert.deepEqual(errors, [], 'No browser errors');
    console.log('XP retirement layout: passed at 320, 390, 768 and 1280px. No production traffic.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
