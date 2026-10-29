// Exercise production renderers with synthetic records. No app accounts or data writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Production function exists: ${name}`);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const constants = ['XP_PROGRESSION_ENABLED', 'PAUSED_XP_NOTIFICATION_TYPES'].map(name => app.match(new RegExp(`^const ${name} = .*;$`, 'm'))[0]).join('\n');
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (actual, message) => { assert(actual, message); checks++; };
const noProgression = (html, message) => {
  ok(!/\bXP\b|\bPrestige\b|\bLevel\s*\d|\bXP level\b|class="(?:xp-panel|xp-coach-panel|level-badge|badges-accordion)|earned badges/i.test(html), message);
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const noOp = () => {};
const view = { innerHTML: '', addEventListener: noOp };
const doc = { querySelector: () => view, querySelectorAll: () => [] };
const fixture = {
  id: 'rider-fixture', athlete_id: 'rider-fixture', role: 'athlete', display_name: 'Rider Fixture',
  level: 18, xp_total: 8580, badges: [{ label: 'Old Badge', icon: 'STAR' }], earned_badges: [{ label: 'Old Badge', icon: 'STAR' }],
  weekly_points: 27, all_time_points: 321, daily_pb_seconds: 123, country_code: 'AU', weekly_wins: 2,
};
const context = vm.createContext({
  console, document: doc, escapeHtml, state: { profile: fixture, user: { id: fixture.id, email: 'fixture@example.test' }, publicAthleteId: fixture.id, notificationUnread: [] },
  client: { rpc: () => { throw Error('Retired XP must not request the backend'); }, from: () => { throw Error('Retired XP must not read the backend'); } },
  avatarHtml: () => '<span class="avatar">QA</span>', countryBadge: () => '', medalForRank: () => '<span class="rank-medal">1st</span>',
  countryFlag: () => '', countryNameFromCode: () => 'Australia', spinDirectionLabels: {}, socialLinksHtml: () => '', linesHtml: value => value || '',
  formatPbTime: value => String(value), leaderboardRankForRow: (_row, i) => i + 1, ghostModeLabelHtml: () => '',
  pointsReceiptAttributes: (id, scope = 'weekly') => `data-points-receipt="${id}" data-points-scope="${scope}"`,
  statCard: (title, value, suffix = '', note = '') => `<article><span>${title}</span><strong>${value} ${suffix}</strong><small>${note}</small></article>`,
  goalsReadonlyHtml: () => '', firstName: rider => rider.display_name.split(' ')[0], dateLabel: value => value,
  weeklyAttemptsHtml: () => '', assignmentGroups: () => '', dashboardItemsHtml: () => '', helpRequestsHtml: () => '', runPlansHtml: () => '',
  weekSummaryHtml: () => '', quoteSection: () => '', scoreRankingCard: points => `<strong>${points} pts</strong>`,
  getPublicAthleteProfile: async () => fixture, getPublicRiderBattleRecord: async () => ({ wins: 5, losses: 2, win_percent: 71 }),
  getLeaderboard: async () => [fixture], navigate: noOp,
});
const gates = ['levelBadgeHtml', 'levelBadgeImageUrl', 'xpProgressHtml', 'levelBadgesGridHtml', 'levelBadgesAccordionHtml', 'xpHistoryHtml', 'showProgressPopup', 'showAchievementCelebration', 'showLevelUpModal', 'showPrestigeCelebration', 'getXpSummary', 'getXpHistory', 'refreshOwnXpAfterAction', 'saveCoachXpAdjustment', 'isVisibleAppNotification', 'getAppNotifications'];
const renders = ['leaderRow', 'commandLeaderboardPreviewHtml', 'coachStudentPreviewHtml', 'coachStudentPreviewProfileHtml', 'coachParentPreviewHtml', 'coachParentPreviewTabHtml', 'coachParentPreviewProfileHtml', 'renderPublicAthleteProfile'];
vm.runInContext(constants + '\n' + [...gates, ...renders].map(extract).join('\n'), context);

(async () => {
  for (const name of ['levelBadgeHtml', 'levelBadgeImageUrl', 'xpProgressHtml', 'levelBadgesGridHtml', 'levelBadgesAccordionHtml', 'xpHistoryHtml']) {
    eq(context[name](fixture), '', `${name} produces no retired UI or asset URL`);
  }
  eq(await context.getXpSummary(fixture.id), null, 'XP summary does not query RPC or badges');
  eq(Array.from(await context.getXpHistory(fixture.id)), [], 'XP ledger is not fetched');
  eq(await context.refreshOwnXpAfterAction({ announceXp: true }), null, 'Trick actions no longer refresh or announce XP');
  let prevented = false;
  await context.saveCoachXpAdjustment({ preventDefault: () => { prevented = true; } });
  ok(prevented, 'Retired adjustment handler consumes old submits without writing');
  const originalDocument = context.document;
  context.document = new Proxy({}, { get: () => { throw Error('XP must not touch the page'); } });
  for (const kind of ['xp', 'badge', 'level', 'prestige']) {
    context.showProgressPopup({ kind });
    context.showAchievementCelebration({ kind });
    checks += 2;
  }
  context.showLevelUpModal(fixture); context.showPrestigeCelebration(fixture); checks += 2;
  context.document = originalDocument;
  for (const type of ['xp_earned', 'xp_awarded', 'xp_bonus', 'level_up', 'level_unlocked', 'badge_earned', 'badge_unlocked', 'prestige', 'prestige_earned', 'prestige_unlocked']) {
    eq(context.isVisibleAppNotification({ notification_type: type }), false, `Hide legacy ${type}`);
  }
  for (const type of ['weekly_challenge_completed', 'weekly_challenge_published', 'park_king_changed', 'rider_battle_result', 'leaderboard_overtaken', 'coach_message']) {
    eq(context.isVisibleAppNotification({ notification_type: type }), true, `Keep real ${type} alerts`);
  }
  eq(context.isVisibleAppNotification({ notification_type: 'achievement', payload: { kind: 'badge' } }), false, 'Generic badge achievement is hidden');
  eq(context.isVisibleAppNotification({ notification_type: 'achievement', payload: { celebration: 'weekly_challenge' } }), true, 'Generic weekly challenge achievement survives');
  const notificationRows = [{ id: 1, notification_type: 'level_up' }, { id: 2, notification_type: 'rider_battle_result' }];
  const queries = [];
  context.client = { from: table => {
    queries.push(table);
    const q = {};
    for (const method of ['select', 'eq', 'is', 'order', 'limit']) q[method] = () => q;
    q.not = (...args) => { queries.push(args); return q; };
    q.then = (resolve, reject) => Promise.resolve({ data: notificationRows }).then(resolve, reject);
    return q;
  }};
  eq(Array.from(await context.getAppNotifications(), item => item.id), [2], 'Notification feed retains real results and filters legacy XP');
  ok(queries.some(item => Array.isArray(item) && item[0] === 'notification_type' && item[1] === 'in'), 'Legacy notification types are excluded before the feed limit');
  context.client = { from: () => { throw Error('Unexpected profile query'); }, rpc: () => { throw Error('Unexpected profile RPC'); } };
  for (const scope of ['weekly_points', 'all_time_points']) {
    const html = context.leaderRow(fixture, 0, [fixture], scope);
    noProgression(html, `${scope} leaderboard omits XP and badges`);
    ok(html.includes(String(fixture[scope])) && html.includes('pts'), `${scope} points remain`);
    ok(html.includes('data-leader-uci="rider-fixture"'), `${scope} retains UCI rank host`);
    ok(html.includes('rank-medal'), `${scope} keeps ranking result medal`);
  }
  const preview = context.commandLeaderboardPreviewHtml([fixture]);
  noProgression(preview, 'Coach leaderboard omits XP and level');
  ok(preview.includes('27 pts'), 'Coach leaderboard keeps trick points');
  const data = { athlete: fixture, assignments: [], awards: [], assignmentAttempts: [], events: [], sessions: [], dashboardItems: [], runs: [], visibleFeedback: [],
    rank: 3, weeklyRow: fixture, leaderboard: [fixture], weeklyPercent: 50, completedWeekly: 5, weeklyItems: Array(10).fill({}) };
  for (const name of renders.filter(name => name.startsWith('coach'))) noProgression(context[name](data), `${name} has no XP, badges or levels`);
  await context.renderPublicAthleteProfile();
  noProgression(view.innerHTML, 'Public rider profile has no XP or badges');
  ok(view.innerHTML.includes('27 pts') && view.innerHTML.includes('5W — 2L'), 'Public profile retains points and battle record');
  // Actual profile renderer for every account role, including UCI linking and settings.
  Object.assign(context, {
    getPushNotificationState: async () => ({ supported: false, enabled: false, preferences: {} }),
    supportsPushNotifications: () => false, isCoachRole: role => ['coach', 'admin'].includes(role),
    getCoachRoster: async () => [], coachDailyPbSettingsHtml: () => '', goalsSection: () => '', bikeGarageTeaserHtml: () => '',
    pushNotificationSettingsHtml: () => '<section>Notifications</section>', normalizedTheme: () => 'dark', countryOptionsHtml: () => '',
    uciProfileLinkHtml: () => '<section>UCI ranking link</section>', bindGoalActions: noOp, bindUciProfileLink: noOp,
    updateOwnAvatar: noOp, saveOwnAvatar: noOp, applyTheme: noOp, togglePushNotifications: noOp, updateNotificationSoundPreference: noOp,
    sendTestNotification: noOp, updateProfile: noOp, updatePassword: noOp, saveCoachDailyPb: noOp, clearCoachDailyPb: noOp, signOutCurrentDevice: noOp,
    client: { from: table => { assert.equal(table, 'parent_athletes'); return { select: () => ({ eq: async () => ({ data: [] }) }) }; } },
  });
  vm.runInContext(extract('renderProfile'), context);
  for (const role of ['athlete', 'coach', 'admin', 'parent']) {
    context.state.profile = { ...fixture, role };
    await context.renderProfile();
    noProgression(view.innerHTML, `${role} profile settings omit XP and badges`);
    ok(view.innerHTML.includes('Save profile') && view.innerHTML.includes('Sign out'), `${role} retains account controls`);
  }
  // Validate the real score feedback separately: it must still show points and not query XP.
  let popup;
  context.showProgressPopup = options => { popup = options; };
  vm.runInContext(extract('showUpdatedWeeklyScore'), context);
  await context.showUpdatedWeeklyScore(1, 'Daily list');
  eq(popup.kind, 'score', 'Trick points still use score feedback');
  eq(popup.title, '+1 leaderboard point', 'Normal daily point is preserved');
  eq(popup.message, 'Daily list · Weekly score 27', 'Weekly total is preserved');
  // Statically check primary full-page paths that are covered by existing role integration tests.
  for (const name of ['renderAthleteHome', 'renderRestrictedRiderHome', 'renderParentHome', 'renderParentMore', 'renderStudentProfile', 'getCoachPreviewData']) {
    const code = extract(name);
    ok(!/getXpSummary|getXpHistory|xpProgressHtml|levelBadgesAccordionHtml|xp-coach-panel|\bXP\b/.test(code), `${name} has no active XP fetches or display`);
  }
  ok(extract('renderAthleteHome').includes('data-rider-health-home'), 'Normal rider Home has health replacement mount');
  ok(!extract('renderRestrictedRiderHome').includes('data-rider-health-home'), 'Restricted access Home has no health mount');
  ok(!extract('setupRealtimeSync').includes('"xp_ledger"'), 'No realtime subscriptions to the frozen XP ledger');
  console.log(`XP retirement UI: ${checks} checks passed (synthetic data, no production writes).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
