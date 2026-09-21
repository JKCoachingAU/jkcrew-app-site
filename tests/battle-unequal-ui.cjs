const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const names = [
  'battleParticipantTeamPoints', 'battleContributionsHtml', 'battleTeamNumbers',
  'battleFormatLabel', 'battleFormatOptionsHtml', 'parseBattleFormat',
  'battlePrizePoints', 'battleStakeSummary', 'battleTeamScore',
  'battleParticipantFirstName', 'battleTeamHtml', 'weeklyBattleCardHtml',
  'coachBattleTeamHtml', 'coachBattleCardHtml', 'riderHeadToHeadRecord',
  'riderBattleRecord', 'riderBattleSelectionSize', 'updateRiderBattlePicker',
  'requestWeeklyRiderBattle', 'coachBattleRiderSelect', 'showCoachBattleBuilder',
  'renderChallenges',
];
const extracted = names.map(name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
}).join('\n');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // The production rendering and submit handlers run against synthetic data only.
    await page.route('**/*', route => route.abort());
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><html data-theme="dark"><body><div id="app"><div class="app-shell rider-shell" style="display:block"><main id="view"></main></div></div></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.addScriptTag({ content: `
      const state = { user: { id: 'r0' }, profile: { role: 'athlete' } };
      const roster = Array.from({length: 8}, (_, i) => ({id: 'r' + i, athlete_id: 'r' + i, display_name: 'Test Rider ' + i, weekly_points: i * 2}));
      window.requests = []; window.notices = []; window.holdRequest = false; window.failRequest = false;
      const client = {rpc: async (name, args) => {
        requests.push({name, args});
        if (holdRequest) { holdRequest = false; await new Promise(resolve => window.releaseRequest = resolve); }
        if (failRequest) { failRequest = false; return {error: {message: 'Connection unavailable. Try again.'}}; }
        return {};
      }};
      const getLeaderboard = async () => roster, getWeeklyRiderBattles = async () => [], getMyWeeklyChallenge = async () => null;
      const hydrateRiderBattleIdentities = battles => battles, categoryInfo = {}, notify = message => notices.push(message), messageFrom = error => error.message;
      const avatarHtml = rider => '<span class="avatar">' + rider.display_name.slice(-1) + '</span>';
      const escapeHtml = value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
      const dateLabel = value => value || '', navigate = () => {}, showBattleRulesModal = () => {}, showAchievementCelebration = () => {}, respondWeeklyRiderBattle = () => {}, forfeitWeeklyRiderBattle = () => {}, renderCoachBattleViewer = () => {};
      const setButtonBusy = button => {const label = button.textContent; button.disabled = true; return () => {button.disabled = false; button.textContent = label;};};
      ${extracted}
      window.openRider = async () => {state.user.id = 'r0'; state.profile.role = 'athlete'; document.querySelector('.app-shell').className = 'app-shell rider-shell'; await renderChallenges(); document.querySelector('#toggle-battle-rider-list').click();};
      window.openCoach = () => {state.user.id = 'coach'; state.profile.role = 'coach'; document.querySelector('.app-shell').className = 'app-shell coach-shell'; showCoachBattleBuilder(roster, async () => {});};
    ` });

    for (const [format, own, other] of [['2v1', 2, 1], ['1v2', 1, 2]]) {
      await page.evaluate(() => openRider());
      await page.selectOption('#rider-battle-size', format);
      assert.equal(await page.locator('#rider-battle-third-team').isVisible(), false);
      assert.equal(await page.locator('[name=thirdTeamIds]:enabled').count(), 0);
      if (own === 2) await page.check('[name=teammateIds][value=r1]');
      else assert.equal(await page.locator('[name=teammateIds]:enabled').count(), 0, 'Solo rider cannot add a teammate');
      const opponents = own === 2 ? ['r2'] : ['r1', 'r2'];
      for (const id of opponents) await page.check('[name=opponentIds][value=' + id + ']');
      assert.equal(await page.inputValue('#rider-battle-size'), format, 'Adding riders preserves unequal sides');
      assert.equal(await page.locator('[name=opponentIds]:enabled:not(:checked)').count(), 0, 'No extra opponent can silently expand the format');
      assert.equal(await page.locator('[name=teammateIds]:enabled:not(:checked)').count(), 0);
      assert((await page.locator('#rider-battle-prize-help').innerText()).includes('per team'), 'Unequal stake is described per side, not per rider');
      await page.click('#send-rider-battle');
      assert.deepEqual(await page.evaluate(() => requests.at(-1)), {
        name: 'request_rider_battle_v3', args: {
          p_team_one: own === 2 ? ['r0', 'r1'] : ['r0'], p_team_two: opponents,
          p_team_three: [], p_duration_days: 7, p_reward_points: 5,
        },
      });
    }

    // Hidden third-side selections and a removed teammate must not leak into a request.
    await page.evaluate(() => openRider());
    await page.selectOption('#rider-battle-size', '2v2v2');
    for (const [name, ids] of [['teammateIds', ['r1']], ['opponentIds', ['r2', 'r3']], ['thirdTeamIds', ['r4', 'r5']]]) {
      for (const id of ids) await page.check('[name=' + name + '][value=' + id + ']');
    }
    await page.selectOption('#rider-battle-size', '2v1');
    assert.equal(await page.locator('[name=opponentIds]:checked').count(), 1);
    assert.equal(await page.locator('[name=thirdTeamIds]:checked').count(), 0);
    await page.selectOption('#rider-battle-size', '1v2');
    assert.equal(await page.locator('[name=teammateIds]:checked').count(), 0);
    await page.check('[name=opponentIds][value=r3]');
    assert(await page.locator('#send-rider-battle').isEnabled());
    await page.click('#send-rider-battle');
    assert.deepEqual((await page.evaluate(() => requests.at(-1))).args.p_team_one, ['r0']);
    assert.deepEqual((await page.evaluate(() => requests.at(-1))).args.p_team_two, ['r2', 'r3']);
    assert.deepEqual((await page.evaluate(() => requests.at(-1))).args.p_team_three, []);

    await page.evaluate(() => openRider());
    await page.selectOption('#rider-battle-size', '2v1');
    await page.check('[name=teammateIds][value=r1]');
    await page.check('[name=opponentIds][value=r2]');
    const beforeDuplicate = await page.evaluate(() => requests.length);
    await page.evaluate(async () => {
      const form = document.querySelector('#battle-request-form');
      form.querySelector('[name=opponentIds][value=r2]').checked = false;
      const duplicate = form.querySelector('[name=opponentIds][value=r1]'); duplicate.disabled = false; duplicate.checked = true;
      await requestWeeklyRiderBattle({preventDefault() {}, currentTarget: form});
    });
    assert.equal(await page.evaluate(() => requests.length), beforeDuplicate, 'Duplicate across unequal sides is rejected');
    assert.match(await page.evaluate(() => notices.at(-1)), /only appear once/);
    await page.evaluate(() => {
      document.querySelector('[name=opponentIds][value=r1]').checked = false;
      document.querySelector('[name=opponentIds][value=r2]').checked = true; updateRiderBattlePicker();
      holdRequest = true; failRequest = true;
      const form = document.querySelector('#battle-request-form');
      form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
      form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await page.waitForFunction(() => Boolean(window.releaseRequest));
    assert.equal(await page.evaluate(() => requests.length), beforeDuplicate + 1, 'Rapid submit sends one rider request');
    assert(await page.locator('#send-rider-battle').isDisabled());
    await page.evaluate(() => {releaseRequest(); delete window.releaseRequest;});
    await page.waitForFunction(() => !document.querySelector('#send-rider-battle').disabled);
    assert.equal(await page.inputValue('#rider-battle-size'), '2v1');
    assert.equal(await page.locator('[name=teammateIds][value=r1]').isChecked(), true, 'Failed request preserves selections');
    await page.click('#send-rider-battle');
    assert.equal(await page.evaluate(() => requests.length), beforeDuplicate + 2, 'Failed rider request can retry');

    for (const [format, teams] of [['2v1', [['r0', 'r1'], ['r2']]], ['1v2', [['r0'], ['r1', 'r2']]]]) {
      await page.evaluate(() => openCoach());
      await page.selectOption('#coach-battle-size', format);
      assert.equal(await page.locator('#coach-battle-builder-form select[name$=Rider]:enabled').count(), 3);
      for (const [index, team] of ['One', 'Two'].entries()) {
        const selects = page.locator('[name=team' + team + 'Rider]:enabled');
        assert.equal(await selects.count(), teams[index].length);
        for (let slot = 0; slot < teams[index].length; slot++) await selects.nth(slot).selectOption(teams[index][slot]);
      }
      assert.equal(await page.locator('#coach-battle-selection-status').innerText(), '3 of 3 riders selected');
      assert((await page.locator('#coach-battle-prize-help').innerText()).includes('per team'));
      for (const width of [320, 390, 1024]) {
        await page.setViewportSize({width, height: 844});
        assert(await page.locator('#coach-battle-builder-modal').evaluate(modal => modal.scrollWidth <= modal.clientWidth + 1), format + ' fits ' + width + 'px');
      }
      await page.locator('#coach-battle-builder-form button[type=submit]').click();
      assert.deepEqual((await page.evaluate(() => requests.at(-1))).args, {
        p_team_one: teams[0], p_team_two: teams[1], p_team_three: [], p_duration_days: 7, p_reward_points: 5,
      });
      assert.equal(await page.locator('#coach-battle-builder-modal').count(), 0);
    }

    await page.evaluate(() => openCoach());
    await page.selectOption('#coach-battle-size', '2v2v2');
    for (const [team, ids] of [['One', ['r0', 'r1']], ['Two', ['r2', 'r3']], ['Three', ['r4', 'r5']]]) {
      for (let i = 0; i < ids.length; i++) await page.locator('[name=team' + team + 'Rider]:enabled').nth(i).selectOption(ids[i]);
    }
    await page.selectOption('#coach-battle-size', '1v2');
    assert.equal(await page.locator('#coach-battle-builder-form').evaluate(form => [...new FormData(form).keys()].filter(key => key.endsWith('Rider')).length), 3, 'Inactive coach seats are excluded from form data');
    await page.locator('#coach-battle-builder-form button[type=submit]').click();
    assert.deepEqual((await page.evaluate(() => requests.at(-1))).args, {p_team_one: ['r0'], p_team_two: ['r2', 'r3'], p_team_three: [], p_duration_days: 7, p_reward_points: 5});

    await page.evaluate(() => openCoach());
    await page.selectOption('#coach-battle-size', '2v1');
    await page.locator('[name=teamOneRider]:enabled').nth(0).selectOption('r0');
    await page.locator('[name=teamOneRider]:enabled').nth(1).selectOption('r1');
    await page.locator('[name=teamTwoRider]:enabled').selectOption('r0');
    const coachBefore = await page.evaluate(() => requests.length);
    await page.locator('#coach-battle-builder-form button[type=submit]').click();
    assert.equal(await page.evaluate(() => requests.length), coachBefore);
    assert.match(await page.evaluate(() => notices.at(-1)), /only appear once/);
    await page.locator('[name=teamTwoRider]:enabled').selectOption('r2');
    await page.evaluate(() => {
      holdRequest = true; failRequest = true;
      const form = document.querySelector('#coach-battle-builder-form');
      form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
      form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await page.waitForFunction(() => Boolean(window.releaseRequest));
    assert.equal(await page.evaluate(() => requests.length), coachBefore + 1, 'Rapid submit sends one coach request');
    await page.evaluate(() => {releaseRequest(); delete window.releaseRequest;});
    await page.waitForFunction(() => !document.querySelector('#coach-battle-builder-form button[type=submit]').disabled);
    assert.equal(await page.locator('#coach-battle-builder-modal').count(), 1, 'Failed coach request keeps builder open');
    assert.equal(await page.inputValue('[name=teamTwoRider]:enabled'), 'r2');
    await page.locator('#coach-battle-builder-form button[type=submit]').click();
    assert.equal(await page.evaluate(() => requests.length), coachBefore + 2, 'Failed coach request can retry');

    for (const format of ['2v1', '1v2']) for (const width of [320, 390, 1024]) {
      await page.setViewportSize({width, height: 844});
      await page.evaluate(format => {
        const sizes = format.split('v').map(Number);
        let rider = 0;
        window.battle = {id: 'unequal', status: 'accepted', battle_size: sizes[0], team_count: 2, reward_points: 5, participants: sizes.flatMap((size, index) => Array.from({length: size}, () => ({...roster[rider++], team_number: index + 1, response: 'accepted', battle_points: 4})))};
        state.user.id = 'r0';
        const view = document.querySelector('#view');
        view.innerHTML = weeklyBattleCardHtml(battle) + coachBattleCardHtml(battle);
        view.querySelector('details').open = true;
      }, format);
      assert.equal(await page.evaluate(() => battleFormatLabel(battle)), format);
      assert.match(await page.locator('.battle-format-chip').innerText(), new RegExp('^' + format, 'i'));
      assert.match(await page.locator('.coach-battle-summary-format').innerText(), new RegExp('^' + format, 'i'));
      const stakeCopy = await page.evaluate(() => battleStakeSummary(battle));
      assert.match(stakeCopy, /5 points per team/);
      assert.match(stakeCopy, /solo gains or loses 5/);
      assert.match(stakeCopy, /2[–-]3 each/, 'Five-point pair stake uses whole points without gaining or losing an extra point');
      assert.equal(await page.locator('.battle-head-to-head > span').textContent(), 'Team battle', 'Pair versus solo is never labelled individual head-to-head');
      assert.equal(await page.locator('.battle-team-avatars .avatar').count(), 6, 'Both cards contain exactly three riders');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Unequal cards fit ' + width + 'px');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: 2v1 and 1v2 rider/coach exact teams, no silent expansion, hidden-seat exclusion, per-team stakes, duplicate prevention, rapid-submit guards, recoverable failures, correct card labels and 320/390/1024px layouts. No production requests.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
