// Production coach approval, aggregate owner screen, signup and team settings.
// Transport is synthetic; no live accounts, profile data or database writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const tail = app.slice(start); return tail.slice(0, tail.indexOf('\n}') + 2);
};
const functions = ['authHeroMarkup', 'renderAuth', 'handleAuth', 'beginAuthFormRequest', 'showAuthFormMessage', 'signupInviteMessage', 'signupErrorMessage', 'isTransientRequestError', 'setButtonBusy', 'coachAccountBlocked', 'refreshCoachAccountAccess', 'renderCoachApprovalScreen', 'startCoachApprovalWatch', 'handleSession', 'renderShell', 'navigate', 'renderTeams', 'setCoachAccountAccess'];
const screenshots = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  let checks = 0;
  const eq = (a, b, why) => { assert.deepEqual(a, b, why); checks++; }, ok = (a, why) => { assert(a, why); checks++; };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div></body></html>');
    for (const file of ['styles.css', 'team-access.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
    await page.evaluate(() => {
      window.app = document.querySelector('#app');
      window.state = { user: { id: 'owner', email: 'owner@example.test' }, profile: { role: 'coach', is_platform_owner: true }, view: 'teams', sessionSetupVersion: 1, inFlight: new Map(), cache: {}, notificationUnread: [], athleteHomeRenderVersion: 0, sessionRenderVersion: 0, sessionViewerDataVersion: 0, authEventVersion: 0 };
      window.qa = { calls: [], notices: [], navigations: [], featureLoads: [], access: { approval_status: 'pending', team: { id: 'team-a', name: 'Team A', country_code: 'DE', role: 'coach' }, coaches: [], can_invite: false }, error: '', hold: false, profile: { id: 'coach-a', display_name: 'Coach A', role: 'coach', is_platform_owner: false } };
      window.qaOverview = { total_coaches: 3, total_students: 20, country_totals: [{ country_code: 'AU', country_name: 'Australia', coach_count: 1, student_count: 18 }, { country_code: 'DE', country_name: 'Germany', coach_count: 2, student_count: 2 }], coaches: [
        { coach_id: 'owner', display_name: 'Owner Coach', email: 'owner@example.test', approval_status: 'approved', account_status: 'active', team_role: 'head_coach', team_name: 'Owner team', student_count: 18, country_name: 'Australia' },
        { coach_id: 'coach-a', display_name: 'Coach <img src=x onerror=alert(1)> A', email: 'coach-a@example.test', approval_status: 'pending', account_status: 'active', team_role: 'head_coach', team_name: 'Private Team A', student_count: 2, country_name: 'Germany', students: [{ name: 'PRIVATE CHILD MUST NEVER RENDER' }] },
        { coach_id: 'coach-b', display_name: 'Coach B with a very long name for mobile layout', approval_status: 'suspended', account_status: 'active', team_role: 'assistant_coach', student_count: 0, country_name: 'Germany' },
      ] };
      window.client = {
        async rpc(name, args = {}) {
          qa.calls.push({ name, args: structuredClone(args) });
          if (qa.hold) await new Promise(resolve => { window.qaRelease = resolve; });
          if (qa.error) return { error: { message: qa.error } };
          if (name === 'get_platform_coach_overview') return { data: structuredClone(qaOverview) };
          if (name === 'set_coach_access') { if (qa.unconfirmedAccess) return { data: { approval_status: args.p_status } }; qaOverview.coaches.find(row => row.coach_id === args.p_coach_id).approval_status = args.p_status; return { data: { coach_id: args.p_coach_id, approval_status: args.p_status } }; }
          if (name === 'get_my_team_access') return { data: structuredClone(qa.access) };
          if (name === 'create_team_coach_invite') return { data: { code: 'TEAM-TEST-INVITE', expires_at: '2026-12-31T10:00:00Z', role: args.p_role } };
          if (name === 'create_team_registration_invite') return { data: { code: 'MEMBER-TEST-INVITE', expires_at: '2026-12-31T10:00:00Z', role: args.p_role } };
          if (name === 'join_team_registration') return { data: { status: 'registered', role: state.profile.role, team_id: 'team-a' } };
          if (name === 'join_team_coach') { qa.access.team = { id: 'team-b', name: 'Invited team', country_name: 'Australia', role: args.p_requested_role }; return { data: { status: 'active', approval_status: qa.access.approval_status, team: qa.access.team, role: args.p_requested_role } }; }
          throw Error(`Unexpected RPC ${name}`);
        },
        from(table) { qa.calls.push({ table }); assertOwnTable(table); const query = { select() { return query; }, eq(field, value) { if (field === 'id' && value !== qa.profile.id) throw Error('Foreign profile read'); return query; }, async maybeSingle() { return { data: structuredClone(qa.profile) }; } }; return query; },
        functions: { async invoke(name, options) { qa.calls.push({ edge: name, body: structuredClone(options.body) }); return { data: { error: 'Synthetic signup stop after payload verification' } }; } },
        auth: { async signOut() { return {}; } },
      };
      window.assertOwnTable = table => { if (table !== 'profiles') throw Error('Unexpected private data read: ' + table); };
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      window.isCoachRole = role => ['coach', 'admin'].includes(role);
      window.withTimeout = promise => promise;
      window.retryNetworkRequest = action => action();
      window.messageFrom = window.authErrorMessage = error => error?.message || String(error || 'Error');
      window.notify = (message, kind) => qa.notices.push({ message, kind });
      window.countryOptions = [['AU', 'Australia'], ['DE', 'Germany']];
      window.countryOptionsHtml = () => '<option value="AU">Australia</option><option value="DE">Germany</option>';
      window.PROFILE_SELECT = 'id,role,is_platform_owner'; window.RILEY_TEST_ACCOUNT_ID = 'unrelated-fixture';
      window.coachNav = [['command', 'Command'], ['teams', 'Teams'], ['profile', 'Profile']];
      window.coachNavGroups = coachNav.map(([id, label]) => ({ id, label, icon: '+', links: [[id, label]] }));
      window.primaryNavButtonHtml = ([id, label]) => `<button data-view="${id}">${label}</button>`;
      window.navNotificationBadge = () => ''; window.avatarHtml = () => '';
      window.riderRecoveryActive = window.riderFeaturesDisabled = window.riderFeatureAccessUnknown = () => false;
      for (const name of ['cancelScreenLoading', 'teardownRealtimeSync', 'applyTheme', 'dismissDailyFinishForNavigation', 'closeTrainingProgressViews', 'closeJkcYard', 'closeAthleteReviewViewer', 'closeContestEventModal', 'closeEventCourseViewer', 'resetVideoReviewPrivateState', 'setSyncStatus', 'showNotificationDrawer', 'loadRiderUciNavigation', 'refreshNotificationCentre', 'refreshBoardChatUnread', 'startRiderFeatureAccessWatch']) window[name] = () => {};
      window.cacheClear = () => { state.cache = {}; };
      window.beginScreenLoading = () => 1; window.finishScreenLoading = () => true; window.loadingScreenCopy = () => ({});
      window.refreshRiderFeatureAccess = async () => true;
      window.recordMyAppOpen = () => qa.featureLoads.push('app-open');
      window.setupRealtimeSync = async () => { qa.featureLoads.push('realtime'); };
      window.renderBootRecovery = message => { app.textContent = message; };
      window.setInterval = callback => { window.qaWatch = callback; return 1; }; window.clearInterval = () => {};
      window.mountOwnerFixture = () => { state.user = { id: 'owner', email: 'owner@example.test' }; state.profile = { role: 'coach', is_platform_owner: true }; state.view = 'teams'; app.innerHTML = '<div class="app-shell coach-shell" style="display:block"><main id="view" class="content" data-view="teams"></main></div>'; };
    });
    await page.addScriptTag({ content: functions.map(extract).join('\n') + '\nwindow.actualNavigate = navigate;' });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'team-access.js'), 'utf8') });

    await page.evaluate(async () => { mountOwnerFixture(); await renderTeams(); });
    eq(await page.locator('[data-coach-account]').count(), 3, 'Owner sees coach account rows and aggregate counts');
    eq(await page.locator('[data-coach-account="owner"] button').count(), 0, 'Owner cannot suspend or approve their own account');
    eq(await page.locator('[data-coach-account="coach-a"] img').count(), 0, 'Coach account text is escaped');
    ok(!(await page.locator('#view').textContent()).includes('PRIVATE CHILD'), 'Owner view never renders student detail fields');
    eq(await page.evaluate(() => qa.calls), [{ name: 'get_platform_coach_overview', args: {} }], 'Teams fetches only aggregate coach overview, never profiles or student tables');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        eq(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px ${theme}: owner overview fits`);
        ok(await page.locator('[data-set-coach-access]').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 44)), 'Owner access controls have touch targets');
        if (screenshots && [390, 1440].includes(width)) await page.screenshot({ path: path.join(screenshots, `owner-coach-approval-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      }
    }
    await page.evaluate(() => { qa.unconfirmedAccess = true; });
    await page.locator('[data-set-coach-access="coach-a"][data-coach-access-status="approved"]').click();
    await page.waitForFunction(() => qa.notices.some(row => row.message.includes('could not be confirmed')));
    eq(await page.locator('[data-coach-account="coach-a"] [data-approval-status]').getAttribute('data-approval-status'), 'pending', 'Unconfirmed RPC result cannot claim that access was approved');
    ok(!(await page.evaluate(() => qa.notices)).some(row => row.message === 'Coach access approved.'), 'An error-free but malformed approval response never shows success');
    await page.evaluate(() => { qa.unconfirmedAccess = false; qa.error = 'Access update rejected'; });
    await page.locator('[data-set-coach-access="coach-a"][data-coach-access-status="approved"]').click();
    await page.waitForFunction(() => qa.notices.some(row => row.message === 'Access update rejected'));
    eq(await page.locator('[data-coach-account="coach-a"] [data-approval-status]').getAttribute('data-approval-status'), 'pending', 'Failed approval does not claim access was granted');
    await page.evaluate(() => { qa.error = ''; qa.hold = true; });
    await page.locator('[data-set-coach-access="coach-a"][data-coach-access-status="approved"]').click();
    await page.waitForFunction(() => typeof qaRelease === 'function');
    ok(await page.locator('[data-coach-account="coach-a"] button').evaluateAll(buttons => buttons.every(button => button.disabled)), 'Approval remains locked during the server write');
    await page.evaluate(() => { qa.hold = false; qaRelease(); });
    await page.waitForFunction(() => document.querySelector('[data-coach-account="coach-a"] [data-approval-status]')?.dataset.approvalStatus === 'approved');
    eq(await page.evaluate(() => qa.calls.filter(call => call.name === 'set_coach_access').at(-1).args), { p_coach_id: 'coach-a', p_status: 'approved' }, 'Approve uses the guarded owner RPC');
    await page.locator('[data-set-coach-access="coach-a"][data-coach-access-status="suspended"]').click();
    await page.waitForFunction(() => document.querySelector('[data-coach-account="coach-a"] [data-approval-status]')?.dataset.approvalStatus === 'suspended');
    await page.evaluate(() => { mountOwnerFixture(); qa.hold = true; document.querySelector('#view').textContent = 'New account screen'; window.staleOwnerLoad = renderTeams(); });
    await page.waitForFunction(() => typeof qaRelease === 'function');
    await page.evaluate(async () => { state.user.id = 'other-account'; state.profile.is_platform_owner = false; qa.hold = false; qaRelease(); await staleOwnerLoad; });
    eq(await page.locator('#view').textContent(), 'New account screen', 'Late owner overview cannot paint after an account switch');
    for (const role of ['coach', 'admin', 'parent', 'athlete']) {
      const result = await page.evaluate(async role => { qa.calls.length = 0; state.profile = { role, is_platform_owner: false }; window.navigate = view => qa.navigations.push(view); await renderTeams(); return qa.calls; }, role);
      eq(result, [], `${role}: direct Teams access performs no data reads without owner rights`);
    }

    await page.evaluate(() => { state.user = null; state.profile = null; renderAuth('signup'); });
    await page.locator('#role').selectOption('coach');
    ok(await page.locator('#coach-signup-fields').isVisible(), 'Coach signup exposes explicit team setup');
    ok((await page.locator('#coach-signup-fields').textContent()).includes('platform-owner approval'), 'Signup explains approval before access');
    const coachSignupCode = 'AB12'.repeat(8);
    for (const role of ['head_coach', 'coach', 'assistant_coach']) {
      await page.locator('#coach-team-role').selectOption(role);
      eq(await page.locator('#coach-team-name').isVisible(), role === 'head_coach', 'Only a head coach creates a named team');
      eq(await page.locator('#coach-invite-code').isVisible(), role !== 'head_coach', 'Other coaches require an explicit invitation');
      await page.locator('#display-name').fill('Signup Coach'); await page.locator('#email').fill('coach@example.test'); await page.locator('#password').fill('fixture-password'); await page.locator('#coach-country').selectOption('DE');
      if (role === 'head_coach') await page.locator('#coach-team-name').fill('Team Germany'); else await page.locator('#coach-invite-code').fill(coachSignupCode);
      await page.evaluate(async () => { await handleAuth({ preventDefault() {}, currentTarget: document.querySelector('#auth-form') }, 'signup'); });
      const body = await page.evaluate(() => qa.calls.filter(call => call.edge).at(-1).body);
      eq([body.role, body.countryCode, body.countryName, body.teamRole, body.teamName, body.inviteCode], ['coach', 'DE', 'Germany', role, role === 'head_coach' ? 'Team Germany' : '', role === 'head_coach' ? '' : coachSignupCode], 'Coach signup sends explicit role/team/invite fields to the Edge function');
    }
    await page.locator('#role').selectOption('athlete');
    eq(await page.locator('#coach-signup-fields input, #coach-signup-fields select').evaluateAll(inputs => inputs.every(input => input.disabled)), true, 'Hidden coach fields cannot affect athlete signup');
    const memberSignupCode = 'EF34'.repeat(8);
    for (const role of ['athlete', 'parent']) {
      await page.locator('#role').selectOption(role);
      ok(await page.locator('#member-team-code').isVisible(), `${role}: signup offers a private team invite code`);
      await page.locator('#member-team-code').fill(memberSignupCode);
      await page.evaluate(async () => { await handleAuth({ preventDefault() {}, currentTarget: document.querySelector('#auth-form') }, 'signup'); });
      const body = await page.evaluate(() => qa.calls.filter(call => call.edge).at(-1).body);
      eq([body.role, body.inviteCode, body.teamRole], [role, memberSignupCode, undefined], 'Family signup sends the invitation without self-selecting a coaching role');
    }

    await page.evaluate(async () => {
      state.user = { id: 'coach-a' }; state.profile = qa.profile; state.session = { user: state.user }; state.coachAccountAccess = null; qa.calls.length = 0; qa.featureLoads.length = 0; window.navigate = actualNavigate;
      await handleSession(state.session);
    });
    eq(await page.locator('.coach-approval-page').count(), 1, 'Actual session bootstrap stops on the pending approval page');
    eq(await page.evaluate(() => qa.featureLoads), [], 'Pending login does not open features, record activity or start realtime');
    eq(await page.evaluate(() => qa.calls.map(call => call.name || call.table)), ['profiles', 'get_my_team_access'], 'Pending login reads only its own profile and access metadata');
    for (const status of ['pending', 'suspended', 'unknown']) {
      await page.evaluate(async status => { qa.access.approval_status = status; state.coachAccessCheckedAt = 0; state.coachAccountAccess = null; qa.calls.length = 0; await actualNavigate('teams'); }, status);
      eq(await page.locator('.coach-approval-page').count(), 1, `${status}: direct navigation fails closed`);
      eq(await page.evaluate(() => qa.calls.map(call => call.name || call.table)), ['get_my_team_access'], 'Blocked navigation cannot call team or feature APIs');
    }
    await page.evaluate(async () => { qa.error = 'Offline'; state.coachAccountAccess = null; await actualNavigate('command'); });
    ok((await page.locator('.coach-approval-card').textContent()).includes('Check your coach access'), 'Approval verification failure stays on a recoverable access page');
    await page.evaluate(() => { qa.error = ''; qa.access.approval_status = 'approved'; window.navigate = view => { qa.featureLoads.push('navigate:' + view); }; });
    await page.locator('#coach-approval-retry').click();
    await page.waitForFunction(() => qa.featureLoads.includes('navigate:command'));
    ok((await page.evaluate(() => qa.featureLoads)).includes('realtime'), 'Only verified approval restarts the full authenticated bootstrap');
    eq(await page.locator('.sidebar [data-view="teams"], .bottom-nav [data-view="teams"]').count(), 0, 'Approved ordinary coach has no Teams navigation');
    await page.evaluate(async () => { state.coachAccountAccess = { approval_status: 'pending' }; qa.access.approval_status = 'pending'; qa.featureLoads.length = 0; startCoachApprovalWatch(); await qaWatch(); });
    eq(await page.evaluate(() => qa.featureLoads), [], 'Periodic checks do not unlock an account that is still pending');
    await page.evaluate(async () => { qa.access.approval_status = 'approved'; await qaWatch(); });
    ok((await page.evaluate(() => qa.featureLoads)).includes('navigate:command'), 'Periodic approval check reopens the workspace only after verified approval');
    await page.evaluate(() => { state.profile.is_platform_owner = true; renderShell(); });
    ok(await page.locator('.sidebar [data-view="teams"], .bottom-nav [data-view="teams"]').count() >= 2, 'Owner gets Teams in sidebar and bottom navigation');

    await page.evaluate(async () => { app.innerHTML = '<main id="team-host" class="panel coach-team-access"></main>'; state.user = { id: 'coach-a' }; qa.access = { approval_status: 'pending', team: { name: 'Own pending team', role: 'head_coach' }, coaches: [{ display_name: 'MUST NOT SHOW' }], can_invite: true }; await JKCTeamAccess.mount({ element: document.querySelector('#team-host'), client, userId: state.user.id, currentUser: () => state.user?.id, withTimeout }); });
    eq(await page.locator('[data-team-invite-form], [data-team-join-form], .team-access-coaches').count(), 0, 'Pending team metadata never exposes coach lists or membership controls');
    await page.evaluate(async () => { qa.access.approval_status = 'approved'; qa.access.coaches = [{ display_name: 'Team Head', role: 'head_coach' }]; await JKCTeamAccess.mount({ element: document.querySelector('#team-host'), client, userId: state.user.id, currentUser: () => state.user?.id, withTimeout }); });
    await page.locator('#team-invite-role').selectOption('assistant_coach');
    await page.locator('[data-team-invite-form] button').click();
    await page.waitForFunction(() => document.querySelector('#team-created-code')?.value === 'TEAM-TEST-INVITE');
    eq(await page.evaluate(() => qa.calls.filter(call => call.name === 'create_team_coach_invite').at(-1).args), { p_role: 'assistant_coach' }, 'Head coach creates a role-specific invite code');
    ok((await page.locator('[data-team-invite-result]').textContent()).includes('Every coach still needs platform-owner approval'), 'Invitation does not promise automatic app approval');
    for (const role of ['athlete', 'parent']) {
      await page.locator('#team-registration-role').selectOption(role);
      await page.locator('[data-team-registration-form] button').click();
      await page.waitForFunction(() => document.querySelector('#team-created-code')?.value === 'MEMBER-TEST-INVITE');
      eq(await page.evaluate(() => qa.calls.filter(call => call.name === 'create_team_registration_invite').at(-1).args), { p_role: role }, 'Approved coach creates a role-specific family signup code');
      ok((await page.locator('[data-team-invite-result]').textContent()).includes('Parent-to-child links are managed separately'), 'Parent code never claims to grant arbitrary child access');
    }
    await page.evaluate(async () => { qa.access.team.role = 'coach'; qa.access.can_invite = false; await JKCTeamAccess.mount({ element: document.querySelector('#team-host'), client, userId: state.user.id, currentUser: () => state.user?.id, withTimeout }); });
    eq(await page.locator('[data-team-invite-form]').count(), 0, 'Ordinary coaches cannot create invitations');
    await page.locator('.team-access-join > summary').click(); await page.locator('#team-join-code').fill('KEEP-ON-ERROR');
    await page.evaluate(() => { qa.error = 'Invite rejected'; }); await page.locator('[data-team-join-form] button').click();
    await page.waitForFunction(() => document.querySelector('[data-team-feedback]')?.textContent === 'Invite rejected');
    eq(await page.locator('#team-join-code').inputValue(), 'KEEP-ON-ERROR', 'Rejected join preserves the invite code for correction');
    await page.evaluate(() => { qa.error = ''; }); await page.locator('#team-join-role').selectOption('assistant_coach'); await page.locator('[data-team-join-form] button').click();
    await page.waitForFunction(() => document.querySelector('.team-access-summary')?.textContent.includes('Invited team'));
    eq(await page.evaluate(() => qa.calls.filter(call => call.name === 'join_team_coach').at(-1).args), { p_code: 'KEEP-ON-ERROR', p_requested_role: 'assistant_coach' }, 'Joining requires the explicit invite code and requested role');
    await page.evaluate(() => { qa.hold = true; document.querySelector('#team-host').textContent = 'New account'; window.lateTeamLoad = JKCTeamAccess.mount({ element: document.querySelector('#team-host'), client, userId: state.user.id, currentUser: () => state.user?.id, withTimeout }); });
    await page.waitForFunction(() => typeof qaRelease === 'function');
    await page.evaluate(async () => { state.user.id = 'different-account'; qa.hold = false; qaRelease(); await lateTeamLoad; });
    ok(!(await page.locator('#team-host').textContent()).includes('Team Head'), 'Late team metadata cannot render another account’s coach list');
    for (const role of ['athlete', 'parent']) {
      await page.evaluate(async role => { state.user = { id: 'family-account' }; state.profile = { role }; qa.calls.length = 0; await JKCTeamAccess.mount({ element: document.querySelector('#team-host'), client, userId: state.user.id, profileRole: role, currentUser: () => state.user?.id, withTimeout }); }, role);
      eq(await page.evaluate(() => qa.calls), [], 'Existing family invitation form loads no coach metadata or private roster');
      await page.locator('#member-team-join-code').fill('KEEP-ON-ERROR');
      await page.evaluate(() => { qa.error = 'Invitation not valid for this account'; }); await page.locator('[data-member-team-join-form] button').click();
      await page.waitForFunction(() => document.querySelector('[data-team-feedback]')?.textContent === 'Invitation not valid for this account');
      eq(await page.locator('#member-team-join-code').inputValue(), 'KEEP-ON-ERROR', 'Failed admission keeps the family invite code');
      await page.evaluate(() => { qa.error = ''; }); await page.locator('[data-member-team-join-form] button').click();
      await page.waitForFunction(() => document.querySelector('[data-team-feedback]')?.textContent.startsWith('Team joined.'));
      eq(await page.evaluate(() => qa.calls.filter(call => call.name === 'join_team_registration').at(-1).args), { p_code: 'KEEP-ON-ERROR' }, 'Existing family admission sends only the code, never a chosen role or child ID');
    }
    eq(errors, [], 'No uncaught browser errors');
    console.log(`Coach approval UI: ${checks} checks passed; actual signup, owner aggregate approval controls, pending bootstrap/navigation gates and explicit team invitations. Synthetic data only.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
