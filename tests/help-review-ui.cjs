const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const extract = name => { const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm')); assert(start >= 0); const text = app.slice(start); return text.slice(0, text.indexOf('\n}') + 2); };
const code = ['helpRequestsHtml', 'bindHelpRequestMedia', 'athleteHelpHasReply', 'athleteHelpStatusInfo', 'athleteReviewViewerHtml', 'openAthleteReviewViewer', 'closeAthleteReviewViewer'].map(extract).join('\n');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    for (const width of [375, 390, 768]) for (const role of ['parent', 'coach']) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="view" class="content"></main></body></html>');
      await page.addStyleTag({ content: css });
      await page.evaluate(({ code, role }) => {
        window.state = { user: { id: role }, profile: { role } };
        window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
        window.safeFileName = value => value; window.dateLabel = () => '21 Sept'; window.messageFrom = error => error.message;
        window.fetchCount = 0; window.released = []; window.failMedia = false; window.holdMedia = false; window.pendingMedia = null;
        window.releaseVideoReviewMedia = id => released.push(id);
        window.fetchHelpVideoMedia = async id => {
          fetchCount++;
          if (holdMedia) await new Promise(resolve => { pendingMedia = resolve; });
          if (failMedia) throw new Error('Connection lost. Try again.');
          return { video_data_url: 'data:video/mp4;base64,AAAA', coach_video_data_url: 'data:video/mp4;base64,BBBB' };
        };
        window.requests = [
          { id: 'legacy', status: 'replied', athlete_id: 'rider', question: 'Please check my barspin', coach_comment: 'Keep looking at the landing.' },
          { id: 'waiting', status: 'open', athlete_id: 'rider', question: 'My second clip', coach_comment: '' },
        ];
        requests.push(...Array.from({ length: 11 }, (_, i) => ({ id: `older-${i}`, status: 'replied', question: `Earlier clip ${i}`, coach_comment: 'Older feedback' })));
        window.eval(code);
        document.querySelector('#view').innerHTML = helpRequestsHtml(requests, role);
        bindHelpRequestMedia(requests);
      }, { code, role });
      assert.equal(await page.locator('[data-help-history-row]:visible').count(), 6);
      await page.locator('[data-help-show-more]').click();
      assert.equal(await page.locator('[data-help-history-row]:visible').count(), 12);
      await page.locator('[data-help-show-more]').click();
      assert.equal(await page.locator('[data-help-history-row]:visible').count(), 13);
      assert.equal(await page.locator('[data-help-show-more]:visible').count(), 0);
      assert.equal(await page.locator('video').count(), 0, 'No player or media download while browsing feedback');
      assert.equal(await page.evaluate(() => fetchCount), 0);
      assert((await page.locator('.help-list, #view').innerText()).includes('Keep looking at the landing.'));
      if (role === 'coach') await page.locator('#reply-legacy').fill('Unsent feedback draft');
      await page.locator('[data-open-help-review="legacy"]').click();
      await page.waitForSelector('#athlete-review-video');
      assert.equal(await page.evaluate(() => fetchCount), 1);
      assert.equal(await page.locator('#athlete-review-video').getAttribute('src'), 'data:video/mp4;base64,BBBB', 'Legacy reply is the initial playback source');
      await page.locator('[data-athlete-review-media="rider"]').click();
      assert.equal(await page.locator('#athlete-review-video').getAttribute('src'), 'data:video/mp4;base64,AAAA');
      assert.equal(await page.locator('[data-athlete-review-media="rider"]').textContent(), 'Rider clip');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#athlete-review-viewer-backdrop').count(), 0);
      assert.equal(await page.locator('video').count(), 0, 'Closing releases media element');
      assert.equal(await page.evaluate(() => released[0]), 'legacy');
      if (role === 'coach') assert.equal(await page.locator('#reply-legacy').inputValue(), 'Unsent feedback draft', 'Opening media preserves coach reply drafts');
      await page.evaluate(() => { failMedia = true; });
      await page.locator('[data-open-help-review="waiting"]').click();
      await page.waitForSelector('.coaching-viewer.is-error');
      assert((await page.locator('.coaching-viewer').innerText()).includes('Connection lost'));
      await page.locator('[data-close-athlete-review]').click();
      await page.evaluate(() => { failMedia = false; });
      await page.locator('[data-open-help-review="waiting"]').click();
      await page.waitForSelector('#athlete-review-video');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
      assert(overflow, `No modal horizontal overflow at ${width}px for ${role}`);
      await page.locator('[data-close-athlete-review]').click();
      await page.evaluate(() => { holdMedia = true; });
      await page.locator('[data-open-help-review="waiting"]').click();
      await page.locator('[data-close-athlete-review]').click();
      await page.evaluate(() => pendingMedia());
      await page.waitForTimeout(20);
      assert.equal(await page.locator('video').count(), 0, 'Cancel during media loading cannot resurrect player');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: parent/coach 375/390/768px metadata-only cards, legacy videos and tabs on demand, retained reply drafts, failure/reopen, cancel while loading, close resource cleanup, no page exceptions or horizontal overflow.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
