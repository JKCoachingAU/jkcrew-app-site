const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const dailyCompletion = fs.readFileSync(path.join(root, 'daily-completion.js'), 'utf8');
const extract = name => {
  const source = ['loadDailyFinishResults', 'dailyTrainingWithFinish'].includes(name) ? dailyCompletion : app;
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const rest = source.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const names = [
  'cacheGet', 'cacheSet', 'cacheClear', 'getWeeklyAssignments',
  'canRefreshRiderSession', 'requestRiderSessionRefresh',
  'bindRiderSessionRefreshEvents', 'riderSessionRefreshButtonHtml', 'bindRiderSessionRefreshButton',
  'renderSession', 'loadActiveSession', 'loadDailyFinishResults', 'dailyTrainingWithFinish', 'dailyVenues', 'newestDailyListForVenue', 'selectedVenueFor',
  'assignmentsForVenue', 'dailyVenueGroups', 'assignmentGroups',
  'extraTricks', 'extraTricksSection', 'bindExtraTrickActions',
  'rememberSessionExpansions', 'bindDailyVenueAccordions', 'bindSessionAssignmentAccordions',
  'setupRealtimeSync', 'realtimeFilter', 'realtimeRow', 'realtimeAthleteId',
  'isRelevantRealtimePayload', 'invalidateCachesForRealtime', 'invalidateSessionViewerData', 'scheduleRealtimeRefresh',
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="view"></main><div id="toast"></div></body></html>');
    await page.addStyleTag({ content: 'body{margin:0;min-height:1800px}#view{height:600px;overflow:auto}details{padding:12px}summary{min-height:48px}.qa-trick{padding:12px;min-height:24px}.page-head{min-height:80px}' });
    await page.evaluate(code => {
      window.qa = { revision: 1, calls: [], held: [], hold: false, fail: false, notices: [], channels: [], visible: true, online: true, access: true, activeSession: null, holdActive: false, activeHeld: [] };
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => qa.visible ? 'visible' : 'hidden' });
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => qa.online });
      window.state = {
        user: { id: 'rider' }, session: { access_token: 'synthetic-only' },
        profile: { id: 'rider', role: 'athlete', country_code: 'DE' }, view: 'session',
        loadingOverlayToken: 1, sessionRenderVersion: 0, sessionViewerDataVersion: 0,
        riderSessionRefresh: null, selectedVenue: 'AREA 51',
        sessionOpenDailyVenues: new Set(['AREA 51']), sessionOpenAssignmentSections: new Set(['one-bang']),
        cache: {}, inFlight: new Map(), activeTraining: null, attempts: [], timer: null,
      };
      window.qaRows = (revision = qa.revision) => [
        ...Array.from({ length: 14 }, (_, index) => ({ id: `area-${revision}-${index}`, athlete_id: 'rider', category: 'daily', venue: 'AREA 51', trick_name: `AREA 51 revision ${revision} trick ${index + 1}`, week_start: '2026-09-13', sort_order: index })),
        { id: 'other-park', athlete_id: 'rider', category: 'daily', venue: 'OTHER PARK', trick_name: 'Other park trick', week_start: '2026-09-13' },
        { id: `one-${revision}`, athlete_id: 'rider', category: 'one_bang', venue: '', trick_name: `New One Bang revision ${revision}`, week_start: '2026-09-13' },
      ];
      window.qaRelease = (index = 0) => { const [held] = qa.held.splice(index, 1); if (!held) throw Error('No held list read'); held.resolve(held.result); };
      window.client = {
        rpc: async (name, args) => {
          qa.calls.push({ name, args });
          if (name === 'ensure_current_week_assignments') return { error: null };
          if (name === 'get_daily_finish_results') return { data: [] };
          if (name !== 'get_effective_weekly_assignments') throw Error(`Unexpected RPC ${name}`);
          const result = qa.fail ? { error: Error('List fetch unavailable') } : { data: qaRows() };
          return qa.hold ? new Promise(resolve => qa.held.push({ resolve, result })) : result;
        },
        from: table => {
          const query = {};
          for (const method of ['select', 'eq', 'gte', 'order', 'limit', 'in', 'is']) query[method] = (...args) => { if (method === 'select') query.selection = args[0]; return query; };
          query.then = (resolve, reject) => {
            const activeRead = table === 'training_sessions' && query.selection === '*';
            const result = { data: activeRead && qa.activeSession ? [qa.activeSession] : [] };
            if (activeRead && qa.holdActive) return new Promise(done => qa.activeHeld.push(() => done(result))).then(resolve, reject);
            if (table === 'trick_attempts' && qa.holdAttempts) return new Promise(done => qa.attemptHeld.push(() => done({ data: [{ id: 'old-attempt' }] }))).then(resolve, reject);
            return Promise.resolve(result).then(resolve, reject);
          };
          return query;
        },
        realtime: { setAuth() {} },
        channel: name => {
          const channel = { name, handlers: [], on(kind, filter, callback) { channel.handlers.push({ kind, filter, callback }); return channel; }, subscribe(callback) { channel.status = callback; return channel; } };
          qa.channels.push(channel); return channel;
        },
      };
      window.getAthleteCountryCode = async () => 'DE';
      window.withTimeout = promise => promise;
      window.weekStartDateForCountry = () => '2026-09-13';
      window.normalizeAssignmentProgress = (_assignment, progress) => progress || {};
      window.reconcileAwardedProgress = (_assignment, progress) => progress;
      window.riderFeaturesDisabled = () => !qa.access;
      window.riderFeatureAccessUnknown = () => false;
      window.refreshRiderFeatureAccess = async () => qa.access;
      window.getLeaderboard = async () => [{ athlete_id: state.user?.id, weekly_points: 3 }];
      window.countryTimezones = { DE: 'Europe/Berlin' };
      window.dateForTimezone = () => '2026-09-15';
      window.venueIdentityKey = window.rawVenueIdentityKey = value => String(value || '').toLowerCase().replace(/\s+/g, '');
      window.venueKey = window.venueLabel = window.dailyRpcVenue = value => String(value || '');
      window.isContestPrepProfile = () => false;
      window.sessionStatBarHtml = () => '';
      window.weeklyCompletionPercent = () => 0;
      window.getParkKing = async () => null;
      window.dailySessionHubHtml = (_rows, venue) => `<div class="qa-selected-venue">${venue}</div><button id="create-session">Start daily timer</button>`;
      window.parkKingCardHtml = window.sheetRulesButtonHtml = () => '';
      window.dailyTierTwoHost = window.otherLandedHost = () => '';
      window.mountDailyFeatures = () => {};
      window.saveExtraTricks = async (tricks, message) => { (qa.extraSaves ||= []).push({ tricks: structuredClone(tricks), message }); };
      if (!crypto.randomUUID) crypto.randomUUID = () => 'synthetic-extra-trick';
      window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      window.categoryInfo = Object.fromEntries(['daily', 'one_bang', 'dialled', 'lines', 'percentage', 'foam_pit', 'bonus'].map(category => [category, { label: category, description: 'Training list' }]));
      window.categoryRewardLabels = {};
      window.categoryDisplayInfo = category => categoryInfo[category];
      window.isAssignmentComplete = () => false;
      window.assignmentList = window.percentageAssignmentList = items => items.map(item => `<div class="qa-trick" data-trick-id="${escapeHtml(item.id)}">${escapeHtml(item.trick_name)}</div>`).join('');
      window.notify = (message, tone) => { qa.notices.push({ message, tone }); document.querySelector('#toast').textContent = message; };
      window.messageFrom = error => error.message;
      window.setButtonBusy = (button, label) => {
        const text = button.textContent; button.textContent = label; button.disabled = true;
        return () => { button.textContent = text; button.disabled = false; };
      };
      window.realtimeVisibleAthleteIds = async () => ['rider'];
      window.isCoachRole = role => role === 'coach' || role === 'admin';
      for (const name of [
        'clearHelpVideoPreview', 'bindVenueSelector', 'bindDailyReorder',
        'startSession', 'recordAssignmentAction', 'recordPercentageAttempt', 'bindSessionQuickJumps',
        'bindSheetRulesButton', 'bindTrainingProgressActions', 'updateTimer', 'setupLiveRunDiscovery',
        'refreshNotificationCentre', 'refreshBoardChatUnread', 'refreshLiveRunInvites', 'refreshOpenTrainingProgress',
      ]) window[name] = () => {};
      qa.liveIntervals = new Set(); qa.timerUpdates = [];
      window.updateTimer = () => qa.timerUpdates.push(state.trickStartedAt);
      const originalSetInterval = window.setInterval.bind(window), originalClearInterval = window.clearInterval.bind(window);
      window.setInterval = (callback, delay, ...args) => {
        const id = originalSetInterval(callback, delay, ...args);
        if (callback === window.updateTimer) qa.liveIntervals.add(id);
        return id;
      };
      window.clearInterval = id => { qa.liveIntervals.delete(id); return originalClearInterval(id); };
      (0, eval)(code);
      bindRiderSessionRefreshEvents();
    }, names.map(extract).join('\n'));

    const readCount = () => page.evaluate(() => qa.calls.filter(call => call.name === 'get_effective_weekly_assignments').length);
    const waitIdle = () => page.waitForFunction(() => !state.riderSessionRefresh);
    const assertRevision = async revision => {
      await page.waitForFunction(revision => document.querySelector('[data-trick-id]')?.textContent.includes(`revision ${revision} `), revision);
      assert.equal(await page.locator('[data-daily-venue-list] [data-trick-id]').count(), 14, 'All 14 current AREA 51 tricks display');
      assert.equal(await page.locator('.qa-selected-venue').textContent(), 'AREA 51', 'Selected venue stays AREA 51');
      assert.equal(await page.locator('[data-daily-venue="AREA 51"]').getAttribute('open'), '', 'Explicitly opened daily venue stays open');
      assert.equal(await page.locator('[data-assignment-section="one-bang"]').getAttribute('open'), '', 'Explicitly opened weekly list stays open');
      assert.equal(await page.locator('[data-assignment-section="bonus"]').getAttribute('open'), null, 'Closed sections stay closed');
    };
    await page.evaluate(() => renderSession());
    await assertRevision(1);
    assert.equal(await page.locator('#rider-session-refresh').count(), 1, 'The Session page provides a visible refresh action');
    await page.evaluate(() => setupRealtimeSync());

    // The server changes while the existing page remains mounted. Each real
    // lifecycle binding must fetch the replacement list without re-navigation.
    for (const event of ['visibilitychange', 'focus', 'pageshow', 'online', 'SUBSCRIBED']) {
      const revision = await page.evaluate(() => ++qa.revision);
      const before = await readCount();
      await page.evaluate(event => {
        document.querySelector('#view').scrollTop = 270;
        window.scrollTo(0, 95);
        if (event === 'visibilitychange') document.dispatchEvent(new Event(event));
        else if (event === 'SUBSCRIBED') qa.channels.at(-1).status(event);
        else window.dispatchEvent(new Event(event));
      }, event);
      await assertRevision(revision); await waitIdle();
      assert.equal(await readCount(), before + 1, `${event}: one fresh list request`);
      const scroll = await page.evaluate(() => ({ view: document.querySelector('#view').scrollTop, page: scrollY }));
      assert.equal(scroll.view, 270, `${event}: inner Session scroll is preserved`);
      assert.equal(scroll.page, 95, `${event}: page scroll is preserved`);
    }

    // Reconnect callbacks from replaced channels must not refresh the page.
    const beforeOldChannel = await readCount();
    await page.evaluate(async () => { const old = qa.channels.at(-1); await setupRealtimeSync(); old.status('SUBSCRIBED'); });
    assert.equal(await readCount(), beforeOldChannel, 'Replaced realtime channels cannot trigger a list read');

    for (const guard of ['hidden', 'offline', 'other-view', 'coach', 'logged-out', 'disabled', 'unknown-access']) {
      const before = await readCount();
      await page.evaluate(guard => {
        qa.visible = guard !== 'hidden'; qa.online = guard !== 'offline'; qa.access = guard !== 'disabled';
        state.view = guard === 'other-view' ? 'home' : 'session';
        state.profile.role = guard === 'coach' ? 'coach' : 'athlete';
        state.user = guard === 'logged-out' ? null : { id: 'rider' };
        window.riderFeatureAccessUnknown = () => guard === 'unknown-access';
        return requestRiderSessionRefresh({ force: true });
      }, guard);
      assert.equal(await readCount(), before, `${guard}: no hidden or unauthorized list read`);
    }
    await page.evaluate(() => {
      qa.visible = qa.online = qa.access = true; state.view = 'session'; state.user = { id: 'rider' }; state.profile.role = 'athlete';
      window.riderFeatureAccessUnknown = () => false;
    });

    // A burst keeps one active read; wake/reconnect/manual requests arriving
    // during it coalesce into one trailing read of the latest data.
    const beforeBurst = await readCount();
    await page.evaluate(() => {
      qa.hold = true; qa.revision += 1;
      window.qaPendingRefresh = requestRiderSessionRefresh();
      window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('online'));
    });
    await page.waitForFunction(() => qa.held.length === 1);
    assert.equal(await readCount(), beforeBurst + 1, 'A resume event burst does not start parallel reads');
    const finalRevision = await page.evaluate(() => {
      ++qa.revision;
      document.querySelector('#rider-session-refresh').click();
      return qa.revision;
    });
    assert.equal(await page.locator('#rider-session-refresh').isDisabled(), true, 'Manual refresh shows pending state');
    await page.evaluate(() => qaRelease());
    await page.waitForFunction(() => qa.held.length === 1);
    assert.equal(await readCount(), beforeBurst + 2, 'Forced refresh queues one trailing fresh read');
    await page.evaluate(() => { qa.hold = false; qaRelease(); });
    await assertRevision(finalRevision); await waitIdle();
    assert.equal(await page.locator('#rider-session-refresh').isEnabled(), true, 'Refresh button becomes usable after success');

    for (const source of ['resume-during-read', 'realtime-during-read']) {
      const before = await readCount();
      await page.evaluate(() => { qa.hold = true; ++qa.revision; window.qaPendingRefresh = requestRiderSessionRefresh(); });
      await page.waitForFunction(() => qa.held.length === 1);
      const newestRevision = await page.evaluate(source => {
        if (source === 'resume-during-read') { qa.visible = false; document.dispatchEvent(new Event('visibilitychange')); }
        ++qa.revision;
        if (source === 'resume-during-read') { qa.visible = true; document.dispatchEvent(new Event('visibilitychange')); }
        else qa.channels.at(-1).handlers.find(handler => handler.filter.table === 'weekly_trick_assignments').callback({ new: { athlete_id: 'rider', category: 'daily' } });
        return qa.revision;
      }, source);
      await page.waitForFunction(() => state.riderSessionRefresh?.repeat === true);
      await page.evaluate(() => qaRelease());
      await page.waitForFunction(() => qa.held.length === 1);
      assert.equal(await readCount(), before + 2, `${source}: changes after the first read require exactly one trailing fetch`);
      await page.evaluate(() => { qa.hold = false; qaRelease(); });
      await assertRevision(newestRevision); await waitIdle();
    }

    // A read started for one screen/account cannot repaint another screen or
    // resurrect a restricted session. Exercise the actual renderer after await.
    for (const interruption of ['navigation', 'same-view-navigation', 'logout', 'account-switch', 'access-revoked']) {
      await page.evaluate(() => {
        state.view = 'session'; state.user = { id: 'rider' }; state.profile.role = 'athlete'; qa.access = true;
        qa.hold = true; ++qa.revision; window.qaPendingRefresh = requestRiderSessionRefresh({ force: true });
      });
      await page.waitForFunction(() => qa.held.length === 1);
      await page.evaluate(interruption => {
        if (interruption === 'navigation') { state.view = 'home'; ++state.loadingOverlayToken; }
        if (interruption === 'same-view-navigation') ++state.loadingOverlayToken;
        if (interruption === 'logout') state.user = null;
        if (interruption === 'account-switch') state.user = { id: 'different-rider' };
        if (interruption === 'access-revoked') qa.access = false;
        document.querySelector('#view').innerHTML = '<div id="destination" style="height:1600px">Current destination</div>';
        document.querySelector('#view').scrollTop = 123;
        qa.hold = false; qaRelease();
      }, interruption);
      await page.evaluate(() => qaPendingRefresh); await waitIdle();
      assert.equal(await page.locator('#destination').count(), 1, `${interruption}: stale data cannot overwrite current screen`);
      assert.equal(await page.locator('#view').evaluate(element => element.scrollTop), 123, `${interruption}: stale completion does not move current screen`);
    }

    for (const phase of ['active-session', 'session-attempts']) {
      await page.evaluate(phase => {
        state.view = 'session'; state.user = { id: 'rider' }; qa.access = true;
        qa.activeSession = { id: 'old-session', started_at: '2026-09-15T06:00:00Z' };
        qa.holdActive = phase === 'active-session'; qa.holdAttempts = phase === 'session-attempts'; qa.attemptHeld = [];
        window.qaPendingRefresh = requestRiderSessionRefresh({ force: true });
      }, phase);
      await page.waitForFunction(phase => phase === 'active-session' ? qa.activeHeld.length === 1 : qa.attemptHeld.length === 1, phase);
      await page.evaluate(phase => {
        state.user = { id: 'different-rider' }; ++state.loadingOverlayToken;
        state.activeTraining = { id: 'new-account-session' }; state.attempts = [{ id: 'new-account-attempt' }];
        document.querySelector('#view').innerHTML = '<div id="destination">New account session</div>';
        if (phase === 'active-session') qa.activeHeld.shift()(); else qa.attemptHeld.shift()();
      }, phase);
      await page.evaluate(() => qaPendingRefresh); await waitIdle();
      assert.deepEqual(await page.evaluate(() => ({ session: state.activeTraining.id, attempts: state.attempts.map(row => row.id) })),
        { session: 'new-account-session', attempts: ['new-account-attempt'] }, `${phase}: a previous account's delayed read cannot mutate active training state`);
      assert.equal(await page.locator('#destination').count(), 1, `${phase}: delayed session data does not repaint the new account`);
      await page.evaluate(() => { qa.holdActive = qa.holdAttempts = false; qa.activeSession = null; });
    }

    await page.evaluate(async () => {
      state.view = 'session'; state.user = { id: 'rider' }; qa.access = true;
      await requestRiderSessionRefresh({ force: true });
      qa.fail = true; document.querySelector('#rider-session-refresh').click();
    });
    await page.waitForFunction(() => qa.notices.some(item => /unavailable|refresh|load/i.test(item.message)));
    await waitIdle();
    assert.equal(await page.locator('#rider-session-refresh').isEnabled(), true, 'Failed read restores the manual action');
    const retryRevision = await page.evaluate(() => { qa.fail = false; ++qa.revision; document.querySelector('#rider-session-refresh').click(); return qa.revision; });
    await assertRevision(retryRevision); await waitIdle();

    // Exercise the actual Working On markup and submit binding. Background
    // refreshes must retain the unsaved live form without multiplying handlers.
    await page.evaluate(() => {
      document.querySelector('.extra-tricks-panel').open = true;
      const form = document.querySelector('#extra-trick-form');
      form.elements.title.value = 'Opposite manual'; form.elements.note.value = 'Keep eyes on the exit';
      form.elements.note.focus({ preventScroll: true }); form.elements.note.setSelectionRange(5, 9, 'backward');
      window.qaDraftNode = form; qa.extraSaves = [];
    });
    for (const draftView of ['ready', 'live', 'live-again']) {
      const draftRevision = await page.evaluate(draftView => {
        qa.activeSession = draftView.startsWith('live') ? { id: 'current-session', started_at: '2026-09-15T06:00:00Z', daily_completed_seconds: null } : null;
        ++qa.revision; window.dispatchEvent(new Event('online')); return qa.revision;
      }, draftView);
      await assertRevision(draftRevision); await waitIdle();
      assert.deepEqual(await page.evaluate(() => {
        const form = document.querySelector('#extra-trick-form'), field = form.elements.note;
        return { sameNode: form === qaDraftNode, title: form.elements.title.value, note: field.value, open: form.closest('details').open, focused: document.activeElement === field, start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection };
      }), { sameNode: true, title: 'Opposite manual', note: 'Keep eyes on the exit', open: true, focused: true, start: 5, end: 9, direction: 'backward' }, `${draftView} session: list refresh retains the Working On draft, caret, focus and open state`);
      if (draftView.startsWith('live')) {
        assert.deepEqual(await page.evaluate(() => ({ start: state.trickStartedAt, timerStart: qa.timerUpdates.at(-1), intervals: qa.liveIntervals.size })),
          { start: Date.parse('2026-09-15T06:00:00Z'), timerStart: Date.parse('2026-09-15T06:00:00Z'), intervals: 1 }, `${draftView}: refresh retains the persisted timer start and exactly one live timer`);
      }
    }
    await page.evaluate(() => document.querySelector('#extra-trick-form').requestSubmit());
    await page.waitForFunction(() => qa.extraSaves.length > 0);
    assert.equal(await page.evaluate(() => qa.extraSaves.length), 1, 'Retained form submits exactly once after repeated refreshes');
    assert.deepEqual(await page.evaluate(() => qa.extraSaves[0].tricks.map(({ title, note }) => ({ title, note }))),
      [{ title: 'Opposite manual', note: 'Keep eyes on the exit' }], 'The submitted draft contains the original unsaved values');
    await page.evaluate(() => { qa.activeSession = null; document.activeElement.blur(); });

    // Native details changes can occur before their queued toggle event runs.
    // The refresh must retain their actual state at the moment it replaces DOM.
    await page.evaluate(() => { qa.hold = true; window.qaPendingRefresh = requestRiderSessionRefresh({ force: true }); });
    await page.waitForFunction(() => qa.held.length === 1);
    await page.evaluate(() => {
      document.querySelector('[data-assignment-section="one-bang"]').open = false;
      document.querySelector('[data-assignment-section="bonus"]').open = true;
      qa.hold = false; qaRelease();
    });
    await page.evaluate(() => qaPendingRefresh); await waitIdle();
    assert.equal(await page.locator('[data-assignment-section="one-bang"]').getAttribute('open'), null, 'Closing a section during the read is preserved');
    assert.equal(await page.locator('[data-assignment-section="bonus"]').getAttribute('open'), '', 'Opening a section during the read is preserved');

    // An earlier read resolving last must not poison the cache or delete the
    // newer in-flight request. Verify cache behaviour outside the Session bypass.
    await page.evaluate(() => {
      state.view = 'home'; state.cache = {}; qa.hold = true; ++qa.revision;
      window.qaOlderRead = getWeeklyAssignments('rider');
    });
    await page.waitForFunction(() => qa.held.length === 1);
    const cacheRevision = await page.evaluate(() => { ++qa.revision; window.qaNewerRead = getWeeklyAssignments('rider', { force: true }); return qa.revision; });
    await page.waitForFunction(() => qa.held.length === 2);
    await page.evaluate(async () => { qaRelease(1); await qaNewerRead; qaRelease(0); await qaOlderRead; qa.hold = false; });
    const beforeCachedRead = await readCount();
    const cachedName = await page.evaluate(async () => (await getWeeklyAssignments('rider')).assignments[0].trick_name);
    assert(cachedName.includes(`revision ${cacheRevision} `), 'Late old response cannot replace a newer forced result in cache');
    assert.equal(await readCount(), beforeCachedRead, 'The latest forced result is retained in the ordinary cache');

    await page.evaluate(() => { state.cache = {}; qa.hold = true; ++qa.revision; window.qaOlderRead = getWeeklyAssignments('rider'); });
    await page.waitForFunction(() => qa.held.length === 1);
    await page.evaluate(() => { ++qa.revision; window.qaNewerRead = getWeeklyAssignments('rider', { force: true }); });
    await page.waitForFunction(() => qa.held.length === 2);
    await page.evaluate(async () => { qaRelease(0); await qaOlderRead; });
    const beforeSharedRead = await readCount();
    await page.evaluate(() => { window.qaSharedRead = getWeeklyAssignments('rider'); });
    assert.equal(await readCount(), beforeSharedRead, 'An old completion does not remove the newer in-flight request');
    await page.evaluate(async () => { qa.hold = false; qaRelease(); await Promise.all([qaNewerRead, qaSharedRead]); });
    assert.deepEqual(errors, [], 'No browser exceptions');
    assert.deepEqual(requests, [], 'Fixture never contacts production or another network');
    console.log('PASS: rider Session refresh on resume/focus/online/reconnect/manual action; coalescing and forced trailing read; venue, sections, scrolling and unsaved Working On draft preserved; one live timer retains its original start; navigation/account/access guards; failed-read recovery; newest-request cache ordering.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
