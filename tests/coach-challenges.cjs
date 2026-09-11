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
const names = [...new Set([
  'getCoachWeeklyChallenges', 'coachWeeklyChallengeHtml', 'renderCoachBattleViewer', 'refreshCoachBattleScores',
  'coachArchivedBattleSection', 'coachBattleSection', 'coachBattleCardHtml', 'coachBattleTeamHtml',
  'battleTeamNumbers', 'battleTeamScore', 'battleFormatLabel', 'battlePrizePoints', 'battleParticipantFirstName', 'battleContributionsHtml',
  ...[...app.matchAll(/^(?:async )?function ((?:coachWeekly|coachChallenge|captureCoachBattle|restoreCoachBattle)\w*)\(/gm)].map(match => match[1])
])];
const code = 'let battleScoreRefreshRunning = false;\n' + names.map(extract).join('\n');
async function install(page, theme) {
  await page.route('**/*', route => route.abort());
  await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view" class="content" data-view="battleViewer"></main></div></div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.evaluate(source => {
    window.state = { view: 'battleViewer', user: { id: 'coach' }, profile: { role: 'coach' }, coachBattleRenderVersion: 0 };
    window.qaCalls = []; window.qaReadError = ''; window.qaHoldBattles = false; window.qaPendingBattles = [];
    const today = Date.now(), date = offset => new Date(today + offset * 86400000).toISOString();
    window.qaRoster = [
      { id: 'r1', display_name: 'Felix Stokes', groupName: 'monday', groupNames: ['monday', 'tuesday'] },
      { id: 'r2', display_name: 'Lars Kindermann', groupName: 'tuesday' },
      { id: 'r3', display_name: 'Romy', groupName: 'wednesday', groupNames: ['wednesday'] },
      { id: 'r4', display_name: 'Invited Rider', groupName: 'trial_team', groupNames: ['trial_team'] },
      { id: 'r5', display_name: 'Default Group Only', groupName: 'tuesday', groupNames: ['tuesday'] },
    ];
    window.qaMemberships = [
      { coach_id: 'coach', athlete_id: 'r1', group_name: 'monday' },
      { coach_id: 'coach', athlete_id: 'r1', group_name: 'tuesday' },
      { coach_id: 'coach', athlete_id: 'r2', group_name: 'tuesday' },
      { coach_id: 'coach', athlete_id: 'r4', group_name: 'trial_team' },
      { coach_id: 'other-coach', athlete_id: 'r3', group_name: 'tuesday' },
    ];
    window.qaChallenges = [
      { id: 'active', title: 'Line Ladder', description: 'Complete three clean lines', category: 'lines', completion_rule: 'category_count', target_count: 3, reward_points: 7, audience_group: 'tuesday', status: 'active', starts_at: date(-1), ends_at: date(3) },
      { id: 'expired', title: 'Expired challenge', category: 'bonus', target_count: 1, reward_points: 5, audience_group: null, status: 'active', starts_at: date(-8), ends_at: date(-1) },
      { id: 'future', title: 'Next week target', description: 'Land your next bonus trick', category: 'bonus', completion_rule: 'category_count', target_count: 1, reward_points: 9, audience_group: null, status: 'scheduled', starts_at: date(4), ends_at: date(11) },
    ];
    window.qaCompletions = [
      { id: 'completion-1', challenge_id: 'active', athlete_id: 'r1', awarded_at: date(-0.5) },
      { id: 'completion-1', challenge_id: 'active', athlete_id: 'r1', awarded_at: date(-0.5) },
      { id: 'wrong-group', challenge_id: 'active', athlete_id: 'r3', awarded_at: date(-0.5) },
      { id: 'unlinked', challenge_id: 'active', athlete_id: 'outsider', awarded_at: date(-0.5) },
      { id: 'old-challenge', challenge_id: 'expired', athlete_id: 'r2', awarded_at: date(-2) },
    ];
    const battle = (id, status, label, archived = false) => ({
      id, status, duration_days: 4, reward_points: 7, battle_size: 1, team_count: 2,
      created_at: date(-1), starts_at: date(-1), ends_at: date(3), archived_at: archived ? date(-0.5) : null,
      participants: [{ athlete_id: `${id}-a`, display_name: label, team_number: 1, response: 'accepted', battle_points: 8, is_winner: status === 'completed' }, { athlete_id: `${id}-b`, display_name: 'Opposing Rider', team_number: 2, response: 'accepted', battle_points: 5 }]
    });
    window.qaBattles = [
      battle('live-felix', 'accepted', 'Current Felix'), battle('live-lars', 'accepted', 'Current Lars'), battle('waiting-romy', 'pending', 'Waiting Romy'),
      ...Array.from({ length: 25 }, (_, index) => battle(`finished-${index + 1}`, index === 24 ? 'declined' : 'completed', `Historical Rider ${index + 1}`)),
      battle('archive-one', 'completed', 'Archived Champion One', true), battle('archive-two', 'completed', 'Archived Champion Two', true),
    ];
    qaBattles[0].battle_size = 3;
    qaBattles[0].participants.push(...Array.from({ length: 4 }, (_, index) => ({ athlete_id: `long-${index}`, display_name: `Very Long Rider Name ${index + 1}`, team_number: index < 2 ? 1 : 2, response: 'accepted', battle_points: index + 2 })));
    class Query {
      constructor(table) { this.table = table; this.ops = []; }
      select(value) { this.ops.push(['select', value]); return this; }
      in(field, values) { this.ops.push(['in', field, values]); return this; }
      eq(field, value) { this.ops.push(['eq', field, value]); return this; }
      gte(field, value) { this.ops.push(['gte', field, value]); return this; }
      gt(field, value) { this.ops.push(['gt', field, value]); return this; }
      lte(field, value) { this.ops.push(['lte', field, value]); return this; }
      order(field, options) { this.ops.push(['order', field, options]); return this; }
      limit(value) { this.ops.push(['limit', value]); return this; }
      range(from, to) { this.ops.push(['range', from, to]); return this; }
      async then(resolve, reject) {
        try {
          qaCalls.push({ type: 'read', table: this.table, ops: this.ops });
          if (qaReadError === this.table) return resolve({ data: null, error: { message: 'Temporary connection error' } });
          let rows = structuredClone({ weekly_challenges: qaChallenges, weekly_challenge_completions: qaCompletions, coach_athlete_groups: qaMemberships }[this.table]);
          for (const [op, field, value] of this.ops) {
            if (op === 'in') rows = rows.filter(row => value.includes(row[field]));
            if (op === 'eq') rows = rows.filter(row => row[field] === value);
            if (op === 'gte') rows = rows.filter(row => row[field] >= value);
            if (op === 'gt') rows = rows.filter(row => row[field] > value);
            if (op === 'lte') rows = rows.filter(row => row[field] <= value);
            if (op === 'order') rows.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (value?.ascending === false ? -1 : 1));
            if (op === 'limit') rows = rows.slice(0, field);
            if (op === 'range') rows = rows.slice(field, value + 1);
          }
          return resolve({ data: rows, error: null });
        } catch (error) { return reject(error); }
      }
      insert() { throw Error('Unexpected write'); } update() { throw Error('Unexpected write'); }
      upsert() { throw Error('Unexpected write'); } delete() { throw Error('Unexpected write'); }
    }
    window.client = {
      from: table => { if (!['weekly_challenges', 'weekly_challenge_completions', 'coach_athlete_groups'].includes(table)) throw Error(`Unexpected table ${table}`); return new Query(table); },
      rpc: async (name, args) => {
        qaCalls.push({ type: 'rpc', name, args });
        if (name !== 'get_coach_rider_battles_v2') throw Error(`Unexpected RPC ${name}`);
        const data = structuredClone(qaBattles);
        return qaHoldBattles ? new Promise(resolve => qaPendingBattles.push({ resolve, data })) : { data, error: null };
      }
    };
    window.getCoachRoster = async () => structuredClone(qaRoster);
    window.isCoachRole = role => role === 'coach' || role === 'admin';
    window.escapeHtml = (value = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    window.avatarHtml = (rider, className) => `<span class="${className || 'avatar'}" style="display:grid;place-items:center;background:#173f42;flex:none">${escapeHtml(rider.display_name.slice(0, 1))}</span>`;
    window.dateLabel = value => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
    window.categoryInfo = { lines: { label: 'Lines' }, bonus: { label: 'Bonus Trick' }, percentage: { label: 'Percentage' } };
    window.categoryDisplayInfo = category => categoryInfo[category] || { label: category };
    window.coachGroups = [['monday', 'Monday Team'], ['tuesday', 'Tuesday Team'], ['wednesday', 'Wednesday Team']];
    window.coachGroupLabel = value => coachGroups.find(row => row[0] === value)?.[1] || 'Monday Team';
    window.messageFrom = error => error?.message || String(error);
    window.withTimeout = promise => promise;
    window.navigate = view => { state.view = view; };
    window.bindCoachBattleControls = () => {};
    window.showCoachBattleBuilder = window.showWeeklyChallengeBuilder = () => {};
    (0, eval)(source);
  }, code);
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    for (const width of [320, 390, 1024]) for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 500, isMobile: width < 500 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await install(page, theme);
      let summary = await page.evaluate(() => getCoachWeeklyChallenges(qaRoster));
      assert.equal(summary.active?.id, 'active', 'Only an active challenge within its date window is current');
      assert.equal(summary.eligibleCount, 2, 'Audience uses actual own-coach memberships, excluding synthesized roster defaults and other-coach links');
      assert.equal(summary.completedRiders.length, 1, 'Duplicate, other-group and unlinked completion rows do not inflate progress');
      assert.equal(summary.completedRiders[0].id || summary.completedRiders[0].athlete_id, 'r1');
      assert(summary.upcoming.some(row => row.id === 'future'), 'A future scheduled challenge is available');
      assert(!summary.upcoming.some(row => row.id === 'expired'));
      const challengeRead = await page.evaluate(() => qaCalls.find(call => call.table === 'weekly_challenges'));
      assert(challengeRead.ops.some(op => op[0] === 'in' && op[1] === 'status' && op[2].includes('active') && op[2].includes('scheduled')));
      assert(challengeRead.ops.some(op => op[0] === 'gte' && op[1] === 'ends_at'));
      assert(challengeRead.ops.some(op => op[0] === 'order' && op[1] === 'starts_at'));
      const membershipRead = await page.evaluate(() => qaCalls.find(call => call.table === 'coach_athlete_groups'));
      assert(membershipRead.ops.some(op => op[0] === 'eq' && op[1] === 'coach_id' && op[2] === 'coach'));
      assert(membershipRead.ops.some(op => op[0] === 'eq' && op[1] === 'group_name' && op[2] === 'tuesday'));
      assert(membershipRead.ops.some(op => op[0] === 'in' && op[1] === 'athlete_id'), 'Audience membership reads are constrained to this roster');
      const completionsRead = await page.evaluate(() => qaCalls.find(call => call.table === 'weekly_challenge_completions'));
      assert(completionsRead.ops.some(op => ['eq', 'in'].includes(op[0]) && op[1] === 'challenge_id'), 'Completion reads are scoped to the active challenge');
      await page.evaluate(() => { qaChallenges[0].audience_group = 'trial_team'; });
      summary = await page.evaluate(() => getCoachWeeklyChallenges(qaRoster));
      assert.equal(summary.eligibleCount, 1);
      const unknownHtml = await page.evaluate(async () => coachWeeklyChallengeHtml(await getCoachWeeklyChallenges(qaRoster)));
      assert(unknownHtml.includes('trial_team'), 'Unknown audience labels remain exact instead of becoming Monday Team');
      await page.evaluate(() => { qaChallenges[0].audience_group = 'tuesday'; });

      await page.evaluate(() => renderCoachBattleViewer());
      assert.equal(await page.locator('.coach-challenges-page').count(), 1);
      assert.equal(await page.locator('details[open]').count(), 0, 'Fresh entry starts with history and challenge disclosures closed');
      assert.equal(await page.locator('.battle-hq-results .battle-hq-card').count(), 3, 'Current list contains live and pending battles only');
      assert.equal(await page.locator('#coach-battle-history .battle-hq-card').count(), 27, 'Every returned finished and archived battle is retained beyond twenty');
      assert.equal(await page.locator('#coach-battle-history [data-battle-id="finished-25"]').count(), 1);
      assert.equal(await page.locator('[data-battle-hq-filter="completed"]').count(), 0, 'Finished battles belong in their separate history');
      assert((await page.locator('[data-battle-hq-filter="all"]').innerText()).includes('Current'));
      assert((await page.locator('.coach-challenges-page').innerText()).includes('Line Ladder'));
      assert((await page.locator('.coach-challenges-page').innerText()).match(/7\s*(?:point|pts)/i), 'Challenge reward is the stored seven points');

      await page.screenshot({ path: `/tmp/jkcrew-coach-challenges-${width}-${theme}-closed.png`, fullPage: true });
      const history = page.locator('#coach-battle-history');
      await history.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
      assert(await history.evaluate(element => element.open), 'History supports keyboard expansion');
      const archive = page.locator('.coach-battle-archive');
      await archive.locator(':scope > summary').click();
      await page.locator('#coach-challenge-riders > summary').click();
      await page.locator('#coach-challenge-upcoming > summary').click();
      await page.locator('[data-battle-id="live-felix"] > summary').click();
      await page.locator('[data-battle-id="archive-one"] > summary').click();
      await page.locator('[data-battle-hq-filter="accepted"]').click();
      await page.locator('#battle-hq-search').fill('Felix');
      assert.equal(await page.locator('.battle-hq-results .battle-hq-card:not([hidden])').count(), 1);
      assert(await page.locator('#coach-battle-history .battle-hq-card').evaluateAll(cards => cards.every(card => !card.hidden)), 'Current filters never hide history');
      await page.locator('#battle-history-search').fill('Archived');
      assert.equal(await page.locator('#coach-battle-history .battle-hq-card:not([hidden])').count(), 2, 'History search includes the archive');
      assert.equal(await page.locator('.battle-hq-results .battle-hq-card:not([hidden])').count(), 1, 'History search never changes current filters');
      await page.evaluate(() => { window.qaOldPage = document.querySelector('.coach-challenges-page'); });
      await page.locator('#refresh-coach-battles').click();
      await page.waitForFunction(() => !qaOldPage.isConnected && document.querySelector('#battle-hq-search')?.value === 'Felix' && document.querySelector('#coach-battle-history')?.open);
      for (const selector of ['#coach-battle-history', '.coach-battle-archive', '#coach-challenge-riders', '#coach-challenge-upcoming', '[data-battle-id="live-felix"]', '[data-battle-id="archive-one"]']) {
        assert(await page.locator(selector).evaluate(element => element.open), `${selector} stays expanded after refresh`);
      }
      assert.equal(await page.locator('#battle-history-search').inputValue(), 'Archived');
      assert(await page.locator('[data-battle-hq-filter="accepted"]').evaluate(element => element.classList.contains('active')));
      await page.locator('h1').click();
      await page.evaluate(() => refreshCoachBattleScores());
      assert(await history.evaluate(element => element.open), 'Automatic score refresh uses the same preservation behavior');
      assert.equal(await page.locator('#battle-hq-search').inputValue(), 'Felix');

      // Changes made while the network read is pending must win at paint time.
      await page.evaluate(() => { qaHoldBattles = true; window.qaDelayedRender = renderCoachBattleViewer(); });
      await page.waitForFunction(() => qaPendingBattles.length === 1);
      await history.locator(':scope > summary').click();
      await page.locator('[data-battle-hq-filter="pending"]').click();
      await page.locator('#battle-hq-search').fill('Romy');
      await page.evaluate(async () => { const read = qaPendingBattles.shift(); read.resolve({ data: read.data }); qaHoldBattles = false; await qaDelayedRender; });
      assert.equal(await history.evaluate(element => element.open), false, 'Closing during a read remains closed');
      assert.equal(await page.locator('#battle-hq-search').inputValue(), 'Romy');
      assert(await page.locator('[data-battle-hq-filter="pending"]').evaluate(element => element.classList.contains('active')));
      assert.equal(await page.locator('.battle-hq-results .battle-hq-card:not([hidden])').count(), 1);

      // The newest score read wins; a response after navigation cannot repaint.
      await page.evaluate(() => { qaHoldBattles = true; qaBattles[0].participants[0].battle_points = 12; window.qaOlder = renderCoachBattleViewer(); });
      await page.waitForFunction(() => qaPendingBattles.length === 1);
      await page.evaluate(() => { qaBattles[0].participants[0].battle_points = 100; window.qaNewer = renderCoachBattleViewer(); });
      await page.waitForFunction(() => qaPendingBattles.length === 2);
      await page.evaluate(async () => { const read = qaPendingBattles.pop(); read.resolve({ data: read.data }); await qaNewer; });
      const newestScore = await page.locator('[data-battle-id="live-felix"] .coach-battle-summary-matchup small').textContent();
      assert(newestScore.includes('105–14 pts'));
      await page.evaluate(async () => { const read = qaPendingBattles.shift(); read.resolve({ data: read.data }); await qaOlder; });
      assert.equal(await page.locator('[data-battle-id="live-felix"] .coach-battle-summary-matchup small').textContent(), newestScore, 'An older score read cannot overwrite the latest result');
      await page.evaluate(() => { window.qaLeaving = renderCoachBattleViewer(); });
      await page.waitForFunction(() => qaPendingBattles.length === 1);
      const beforeLeaving = await page.locator('#view').innerHTML();
      await page.evaluate(async () => { state.view = 'command'; const read = qaPendingBattles.shift(); read.resolve({ data: read.data }); await qaLeaving; state.view = 'battleViewer'; qaHoldBattles = false; });
      assert.equal(await page.locator('#view').innerHTML(), beforeLeaving, 'A late response after leaving the page cannot repaint it');

      for (const table of ['weekly_challenge_completions', 'coach_athlete_groups', 'weekly_challenges']) {
        await page.evaluate(table => { qaReadError = table; }, table);
        const failure = await page.evaluate(() => getCoachWeeklyChallenges(qaRoster));
        assert(table === 'weekly_challenges' ? failure.error : failure.completionError, 'Read failure remains explicit');
        await page.evaluate(() => renderCoachBattleViewer());
        assert.equal(await page.locator('.battle-hq-results .battle-hq-card').count(), 3, 'Challenge failures never block battle rendering');
        assert.equal(await page.locator('#coach-weekly-progress').count(), 0, 'Unavailable completion or membership data is never displayed as zero progress');
        assert((await page.locator('.coach-challenges-page').innerText()).match(/unavailable|could not|couldn't|retry|couldn’t|unable|load/i), 'The page explains unavailable challenge information');
      }
      await page.evaluate(async () => { qaReadError = ''; document.querySelector('#view').innerHTML = ''; await renderCoachBattleViewer(); });
      assert.equal(await page.locator('details[open]').count(), 0, 'A fresh page has no stale expansion state');
      assert.equal(await page.locator('#battle-hq-search').inputValue(), '');
      assert.equal(await page.locator('#battle-history-search').inputValue(), '');
      const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth, view: document.querySelector('#view').scrollWidth, viewWidth: document.querySelector('#view').clientWidth }));
      assert(overflow.page <= width + 1 && overflow.view <= overflow.viewWidth + 1, `No ${theme} ${width}px horizontal overflow: ${JSON.stringify(overflow)}`);
      await history.locator(':scope > summary').click(); await archive.locator(':scope > summary').click();
      await page.locator('[data-battle-id="archive-one"] > summary').click();
      const expandedOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
      assert(expandedOverflow, 'Expanded history also fits the screen');
      await page.evaluate(async () => {
        qaChallenges = [{ ...qaChallenges[0], title: 'Perfectionist', description: 'Land every attempt on your three Percentage tricks.', category: 'percentage', completion_rule: 'percentage_perfect', target_count: 3, reward_points: 10, audience_group: null }];
        qaCompletions = []; qaBattles = qaBattles.filter(battle => !['accepted', 'pending'].includes(battle.status));
        document.querySelector('#view').innerHTML = ''; await renderCoachBattleViewer();
      });
      assert((await page.locator('.coach-weekly-card').innerText()).includes('3 percentage tricks at 10/10'), 'Perfectionist explains the actual perfect-set target');
      assert.equal(await page.locator('.coach-challenge-reward').textContent(), '+10 pts');
      assert.equal(await page.locator('#coach-weekly-progress').getAttribute('value'), '0', 'A successful read with no recorded completions can show verified zero');
      assert.equal(await page.locator('details[open]').count(), 0);
      assert.equal(await page.locator('.battle-hq-results .battle-hq-card').count(), 0);
      assert(await page.locator('#coach-current-battles-empty').isVisible(), 'No active battles shows a clear empty state');
      assert.equal(await page.locator('#coach-challenge-upcoming').count(), 0, 'No invented upcoming challenge');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/jkcrew-coach-challenges-${width}-${theme}-perfectionist.png`, fullPage: true });
      assert(await page.evaluate(() => qaCalls.every(call => call.type === 'read' || call.name === 'get_coach_rider_battles_v2')), 'Viewing challenges never awards points or writes to the backend');
      assert.deepEqual(errors, [], `No ${theme} ${width}px browser errors`);
      console.log(`PASS ${width}px ${theme}: accurate read-only challenge audience/completions, isolated errors, separate current/history filters, all finished results, preserved refresh state and responsive layout.`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
