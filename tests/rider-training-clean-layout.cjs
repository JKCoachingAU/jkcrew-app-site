// Render the actual weekly-list and Working On disclosures with synthetic training only.
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
  ...['assignmentList', 'dailyVenueGroups', 'assignmentGroups', 'extraTricksSection'].map(extract),
].join('\n');
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
const channels = color => {
  const values = color.match(/[\d.]+/g).slice(0, 3).map(Number);
  return color.startsWith('color(srgb') ? values.map(value => value * 255) : values;
};
const neutral = color => {
  const [red, green, blue] = channels(color);
  return Math.max(red, green, blue) - Math.min(red, green, blue) <= 36;
};
const colourDistance = (first, second) => Math.max(...channels(first).map((value, index) => Math.abs(value - channels(second)[index])));

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
      window.state = {
        profile: { role: 'athlete', rider_extra_tricks: [
          { id: 'personal-active', title: 'Opposite manual', note: 'Keep a steady line', completed: false },
          { id: 'personal-done', title: 'Smooth transition', note: '', completed: true },
        ] },
        sessionOpenDailyVenues: new Set(), sessionOpenAssignmentSections: new Set(),
      };
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
      window.extraTricks = (profile = state.profile) => profile.rider_extra_tricks || [];
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
    await page.addScriptTag({ content: code + '\nwindow.categoryDisplayInfo = category => categoryInfo[category]; document.querySelector("#view").innerHTML = assignmentGroups(qaRows, true, state.profile, "Loganland") + extraTricksSection(state.profile);' });
    assert.equal(await page.locator('.assignment-group').count(), 9, 'Every existing list category remains available');
    assert.deepEqual(await page.locator('.assignment-group > .assignment-group-head .panel-title').allTextContents(), [
      'Daily Tricks', 'One Bangs', 'Dialled', 'Trick Links', 'Lines', 'Percentage Tricks', 'Foam Pit', 'Fundamental Skills', 'Bonus TricksGold trick',
    ], 'Fundamental Skills follows Foam Pit and precedes Bonus Tricks');
    assert.match(await page.locator('[data-assignment-section="other"] .panel-title').textContent(), /Fundamental Skills/);
    assert.match(await page.locator('[data-assignment-section="other"] .category-reward-pill').textContent(), /0\.5/);
    const workingOn = page.locator('.extra-tricks-panel');
    assert.equal(await workingOn.locator('.panel-title').textContent(), 'Working On');
    assert.equal(await workingOn.locator('.working-on-copy small').textContent(), 'Personal practice · no points');
    assert.equal(await workingOn.locator('.working-on-count').textContent(), '1 active', 'Working On counts only unfinished personal tricks');
    assert.equal(await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.innerHTML = extraTricksSection({ role: 'athlete', rider_extra_tricks: [] });
      return fixture.querySelector('.working-on-count').textContent;
    }), 'Add tricks', 'Empty Working On gives a clear add prompt');

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
            const countStyle = getComputedStyle(count);
            const dot = getComputedStyle(title, '::before');
            return {
              background: style.backgroundColor, image: style.backgroundImage, border: style.borderTopColor,
              borderWidth: parseFloat(style.borderTopWidth), shadow: style.boxShadow,
              title: getComputedStyle(title).color, reward: getComputedStyle(reward).color,
              count: countStyle.color, countBackground: countStyle.backgroundColor,
              countBorderWidth: parseFloat(countStyle.borderTopWidth), countShadow: countStyle.boxShadow,
              dot: { colour: dot.backgroundColor, width: parseFloat(dot.width), height: parseFloat(dot.height), radius: dot.borderRadius },
            };
          }),
          neutralChipSurface: getComputedStyle(view.querySelector('.daily-venue-accordion')).backgroundColor,
          star: getComputedStyle(view.querySelector('.bonus-assignment-group'), '::after').content,
          workingOn: (() => {
            const panel = view.querySelector('.extra-tricks-panel');
            const summary = panel.querySelector('.working-on-summary');
            const icon = summary.querySelector('.working-on-icon');
            const count = summary.querySelector('.working-on-count');
            const caret = summary.querySelector('.accordion-caret');
            const rect = summary.getBoundingClientRect();
            const panelStyle = getComputedStyle(panel);
            return {
              width: rect.width, panelWidth: panel.getBoundingClientRect().width, height: rect.height,
              image: panelStyle.backgroundImage, shadow: panelStyle.boxShadow,
              title: getComputedStyle(summary.querySelector('.panel-title')).color,
              children: summary.children.length, buttons: summary.querySelectorAll('button').length,
              iconWidth: icon.getBoundingClientRect().width, iconHeight: icon.getBoundingClientRect().height,
              countHeight: count.getBoundingClientRect().height, countFont: parseFloat(getComputedStyle(count).fontSize),
              countBackground: getComputedStyle(count).backgroundColor,
              caretWidth: caret.getBoundingClientRect().width,
              overflow: summary.scrollWidth > summary.clientWidth + 1,
            };
          })(),
        }));
        assert.equal(layout.overflow, false, `${width}px ${theme}: no horizontal overflow`);
        assert.equal(new Set(layout.groups.map(group => group.background)).size, 1, `${width}px ${theme}: categories share one calm card surface`);
        assert.equal(new Set(layout.groups.map(group => group.title)).size, 1, `${width}px ${theme}: category headings share one ink colour`);
        assert(layout.groups.every(group => group.image === 'none' && group.shadow === 'none'), `${width}px ${theme}: no category gradients or glows`);
        assert(layout.groups.every(group => group.borderWidth <= 1.5 && neutral(group.border)), `${width}px ${theme}: subtle neutral category borders`);
        assert(layout.groups.every(group => neutral(group.title) && neutral(group.reward)), `${width}px ${theme}: headings and point labels keep neutral ink`);
        assert(new Set(layout.groups.map(group => group.count)).size >= 8, `${width}px ${theme}: count chips retain distinct soft category accents`);
        assert(layout.groups.every(group => group.count !== group.title && group.countBorderWidth <= 1.5 && group.countShadow === 'none'), `${width}px ${theme}: count accents stay small and flat`);
        assert(layout.groups.every(group => colourDistance(group.countBackground, layout.neutralChipSurface) <= 20), `${width}px ${theme}: count backgrounds have only a slight colour tint`);
        assert(new Set(layout.groups.map(group => group.dot.colour)).size >= 8, `${width}px ${theme}: small category dots provide colour landmarks`);
        assert(layout.groups.every(group => group.dot.width > 0 && group.dot.width <= 7 && group.dot.height === group.dot.width && group.dot.radius === '50%'), `${width}px ${theme}: category colour is limited to a small round dot`);
        assert(['none', 'normal', '""'].includes(layout.star), `${width}px ${theme}: no oversized bonus star`);
        assert(Math.abs(layout.workingOn.width - layout.workingOn.panelWidth) <= 2, `${width}px ${theme}: Working On has a full-width click target`);
        assert(layout.workingOn.height >= 64 && layout.workingOn.height <= 80, `${width}px ${theme}: Working On stays a compact single bar`);
        assert.equal(layout.workingOn.children, 4, `${width}px ${theme}: summary has one text block plus three small adornments`);
        assert.equal(layout.workingOn.buttons, 0, `${width}px ${theme}: summary keeps one native disclosure target`);
        assert(layout.workingOn.iconWidth <= 32 && layout.workingOn.iconHeight <= 32 && layout.workingOn.caretWidth <= 24, `${width}px ${theme}: Working On icon and caret stay small`);
        assert(layout.workingOn.countHeight <= 30 && layout.workingOn.countFont <= 11, `${width}px ${theme}: active count is a small chip`);
        assert(colourDistance(layout.workingOn.countBackground, layout.neutralChipSurface) <= 20, `${width}px ${theme}: Working On has only a slight lavender count tint`);
        assert(neutral(layout.workingOn.title) && layout.workingOn.image === 'none' && layout.workingOn.shadow === 'none', `${width}px ${theme}: Working On keeps neutral ink and a flat surface`);
        assert.equal(layout.workingOn.overflow, false, `${width}px ${theme}: Working On controls fit inside the bar`);
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
    assert.equal(await workingOn.getAttribute('open'), null, 'Working On starts collapsed');
    await workingOn.locator(':scope > summary').click();
    assert.equal(await workingOn.getAttribute('open'), '', 'Working On opens with its summary');
    assert.equal(await workingOn.locator('.extra-trick-row').count(), 2, 'Actual personal-trick rows render when expanded');
    assert.equal(await workingOn.locator('#extra-trick-form input[name="title"][required]').count(), 1, 'Add form keeps its required trick field');
    assert.equal(await workingOn.locator('#extra-trick-form input[name="note"]').count(), 1, 'Add form keeps its optional note');
    assert.equal(await workingOn.locator('#extra-trick-form button[type="submit"]').textContent(), 'Add');
    for (const id of ['personal-active', 'personal-done']) {
      const row = workingOn.locator(`[data-extra-trick-id="${id}"]`);
      assert.equal(await row.locator(`[data-extra-toggle="${id}"]`).count(), 1, 'Personal trick retains its toggle hook');
      assert.equal(await row.locator(`[data-extra-edit="${id}"]`).textContent(), 'Edit', 'Personal trick retains its edit hook');
      assert.equal(await row.locator(`[data-extra-delete="${id}"]`).textContent(), 'Delete', 'Personal trick retains its delete hook');
    }
    assert.equal(await workingOn.locator('.extra-trick-row.complete [data-extra-toggle="personal-done"]').textContent(), '✓', 'Completed personal trick keeps its check');
    await workingOn.locator(':scope > summary').press('Enter');
    assert.equal(await workingOn.getAttribute('open'), null, 'Working On closes with Enter');
    await page.setViewportSize({ width: 320, height: 900 });
    await workingOn.locator(':scope > summary').press('Space');
    assert.equal(await workingOn.getAttribute('open'), '', 'Working On opens with Space');
    assert.equal(await workingOn.locator('#extra-trick-form').isVisible(), true, 'Keyboard expansion exposes the add form');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Expanded Working On fits at 320px');
    await workingOn.locator(':scope > summary').press('Space');
    assert.equal(await workingOn.getAttribute('open'), null, 'Working On closes with Space');
    assert.deepEqual(errors, [], 'No browser errors');
    assert.deepEqual(requests, [], 'The fixture makes no production requests');
    console.log('PASS: clean weekly-list cards and compact Working On bar at 320/390/1024px in dark/light themes; subtle category accents, Fundamental Skills half-point label, native disclosures and personal-trick form/edit/delete hooks preserved. No production data used.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
