// Render the actual weekly-list disclosure cards with synthetic training only.
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
const constant = name => {
  const start = app.indexOf(`const ${name} = `);
  assert(start >= 0, `Actual ${name} exists`);
  return app.slice(start, app.indexOf('\n};', start) + 3);
};
const code = [
  constant('categoryInfo'), constant('categoryRewardLabels'),
  ...['assignmentList', 'dailyVenueGroups', 'assignmentGroups'].map(extract),
].join('\n');
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
const neutral = color => {
  const [red, green, blue] = color.match(/[\d.]+/g).slice(0, 3).map(Number);
  return Math.max(red, green, blue) - Math.min(red, green, blue) <= 36;
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"><div class="app-shell rider-shell" style="display:block"><main id="view" class="content" data-view="session"></main></div></div></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.evaluate(() => {
      window.state = { profile: { role: 'athlete' }, sessionOpenDailyVenues: new Set(), sessionOpenAssignmentSections: new Set() };
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
      window.venueLabel = value => value || 'Park';
      window.venueIdentityKey = value => String(value || '').toLowerCase();
      window.dailyVenues = rows => [...new Set(rows.map(row => row.venue))];
      window.assignmentsForVenue = (rows, venue) => rows.filter(row => row.venue === venue);
      window.orderedAssignments = rows => rows;
      window.isAssignmentComplete = row => Boolean(row.progress?.completed_at);
      window.assignmentPresentation = row => ({ title: row.trick_name, notes: row.notes || '' });
      window.assignmentStatus = row => isAssignmentComplete(row) ? 'Landed this week' : 'To do this week';
      window.percentageAssignmentList = rows => '<div class="percentage-card">' + rows.map(row => escapeHtml(row.trick_name)).join('') + '</div>';
      window.qaRows = [
        { id: 'daily', category: 'daily', venue: 'Loganland', trick_name: 'Manual' },
        { id: 'fundamental-todo', category: 'other', trick_name: 'Pump and carry speed' },
        { id: 'fundamental-done', category: 'other', trick_name: 'Controlled bunny hop', progress: { completed_at: '2026-11-16T10:00:00Z' } },
        { id: 'one-bang', category: 'one_bang', trick_name: 'Barspin' },
        { id: 'dialled', category: 'dialled', trick_name: '180' },
        { id: 'link', category: 'trick_links', trick_name: 'Manual → 180' },
        { id: 'line', category: 'lines', trick_name: 'Manual → Barspin → Air' },
        { id: 'percentage', category: 'percentage', trick_name: 'Tailwhip' },
        { id: 'foam', category: 'foam_pit', trick_name: 'Flip' },
        { id: 'bonus', category: 'bonus', trick_name: 'Opposite barspin' },
      ];
    });
    await page.addScriptTag({ content: code + '\nwindow.categoryDisplayInfo = category => categoryInfo[category]; document.querySelector("#view").innerHTML = assignmentGroups(qaRows, true, state.profile, "Loganland");' });
    assert.equal(await page.locator('.assignment-group').count(), 9, 'Every existing list category remains available');
    assert.deepEqual(await page.locator('.assignment-group > .assignment-group-head .panel-title').allTextContents(), [
      'Daily Tricks', 'One Bangs', 'Dialled', 'Trick Links', 'Lines', 'Percentage Tricks', 'Foam Pit', 'Fundamental Skills', 'Bonus TricksGold trick',
    ], 'Fundamental Skills follows Foam Pit and precedes Bonus Tricks');
    assert.match(await page.locator('[data-assignment-section="other"] .panel-title').textContent(), /Fundamental Skills/);
    assert.match(await page.locator('[data-assignment-section="other"] .category-reward-pill').textContent(), /0\.5/);

    for (const width of [320, 390, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        const layout = await page.locator('#view').evaluate(view => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          groups: [...view.querySelectorAll('.assignment-group')].map(group => {
            const style = getComputedStyle(group);
            const title = group.querySelector('.panel-title');
            const reward = group.querySelector('.category-reward-pill');
            const count = group.querySelector('.category-count');
            return { background: style.backgroundColor, image: style.backgroundImage, border: style.borderTopColor, borderWidth: parseFloat(style.borderTopWidth), shadow: style.boxShadow, title: getComputedStyle(title).color, reward: getComputedStyle(reward).color, count: getComputedStyle(count).color };
          }),
          star: getComputedStyle(view.querySelector('.bonus-assignment-group'), '::after').content,
        }));
        assert.equal(layout.overflow, false, `${width}px ${theme}: no horizontal overflow`);
        assert.equal(new Set(layout.groups.map(group => group.background)).size, 1, `${width}px ${theme}: categories share one calm card surface`);
        assert.equal(new Set(layout.groups.map(group => group.title)).size, 1, `${width}px ${theme}: category headings share one ink colour`);
        assert(layout.groups.every(group => group.image === 'none' && group.shadow === 'none'), `${width}px ${theme}: no category gradients or glows`);
        assert(layout.groups.every(group => group.borderWidth <= 1.5 && neutral(group.border)), `${width}px ${theme}: subtle neutral category borders`);
        assert(layout.groups.every(group => neutral(group.title) && neutral(group.reward) && neutral(group.count)), `${width}px ${theme}: headings, reward labels and counts stay neutral`);
        assert(['none', 'normal', '""'].includes(layout.star), `${width}px ${theme}: no oversized bonus star`);
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `rider-training-clean-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      }
    }

    await page.setViewportSize({ width: 390, height: 900 });
    const skills = page.locator('[data-assignment-section="other"]');
    assert.equal(await skills.getAttribute('open'), null, 'Weekly lists start collapsed');
    await skills.locator(':scope > summary').click();
    assert.equal(await skills.getAttribute('open'), '', 'Fundamental Skills disclosure opens');
    assert.equal(await skills.locator('.assignment-row').count(), 2);
    const complete = skills.locator('[data-assignment-id="fundamental-done"]');
    const incomplete = skills.locator('[data-assignment-id="fundamental-todo"]');
    assert.equal(await complete.textContent(), '✓', 'Completed trick keeps its tick');
    assert.equal(await complete.getAttribute('data-assignment-action'), 'unlanded', 'Completed trick retains undo');
    const completedBackground = await complete.evaluate(element => getComputedStyle(element).backgroundColor);
    const incompleteBackground = await incomplete.evaluate(element => getComputedStyle(element).backgroundColor);
    assert.notEqual(completedBackground, incompleteBackground, 'Landed tricks remain visually distinct');
    await skills.locator(':scope > summary').press('Enter');
    assert.equal(await skills.getAttribute('open'), null, 'Disclosure closes with keyboard');
    await page.locator('.daily-venue-accordion > summary').click();
    assert.equal(await page.locator('.daily-venue-accordion[open] .assignment-row').count(), 1, 'Daily venue disclosure still shows tricks');
    assert.deepEqual(errors, [], 'No browser errors');
    assert.deepEqual(requests, [], 'The fixture makes no production requests');
    console.log('PASS: clean neutral weekly-list cards at 320/390/1024px in dark/light themes; Fundamental Skills half-point label, native disclosures and completed-trick controls preserved. No production data used.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
