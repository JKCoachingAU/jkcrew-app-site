import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const app = read("app.js");
const html = read("index.html");
const css = read("styles.css");
const serviceWorker = read("sw.js");
const rileyServiceWorker = read("riley-test/sw.js");
const manifestText = read("manifest.webmanifest");
const manifest = JSON.parse(manifestText);
const rileyManifestText = read("riley-test/manifest.webmanifest");
const rileyManifest = JSON.parse(rileyManifestText);
const eventMigration = read("supabase/migrations/20260827101827_share_events_keep_runs_private.sql");
const mergeEventMigration = read("supabase/migrations/20260827213000_merge_shared_events.sql");
const coachAttendanceMigration = read("supabase/migrations/20260827124538_coach_manage_event_attendance.sql");
const coachEventEditMigration = read("supabase/migrations/20260827233000_coach_edit_events_private_event_runs.sql");
const beenleighMigration = read("supabase/migrations/20260827220000_merge_beenleigh_locations.sql");
const notificationMigration = read("supabase/migrations/20260828090000_finish_notification_center_and_alerts.sql");
const dailyListNotificationMigration = read("supabase/migrations/20260829090000_notify_daily_list_completion_only.sql");
const dailyHypeMessageMigration = read("supabase/migrations/20260903111500_replace_daily_hype_messages.sql");
const perfectionistChallengeMigration = read("supabase/migrations/20260903114500_queue_perfectionist_weekly_challenge.sql");
const battleScoreMigration = read("supabase/migrations/20260830090000_persist_battle_scores_across_weekly_resets.sql");
const lifetimeXpBadgeMigration = read("supabase/migrations/20260830094500_keep_badges_on_lifetime_xp.sql");
const battlePointsMigration = read("supabase/migrations/20260830110000_choose_rider_battle_points.sql");
const coachBattleControlMigration = read("supabase/migrations/20260901220603_coach_battle_responses_and_archives.sql");
const coachEditedProposalMigration = read("supabase/migrations/20260902233712_coach_edit_and_approve_rider_sheet_proposals.sql");
const coachReplaceProposalMigration = read("supabase/migrations/20260903001700_replace_lists_on_rider_sheet_approval.sql");
const coachProposalBackupMigration = read("supabase/migrations/20260903003000_backup_progress_before_list_request_replacement.sql");
const eventCourseMigration = read("supabase/migrations/20260830114500_shared_event_course_photos.sql");
const eventCourseIndexMigration = read("supabase/migrations/20260830115000_index_event_course_photo_updater.sql");
const parentEventCourseMigration = read("supabase/migrations/20260830123000_parent_event_course_read_only.sql");
const parentEngagementMigration = read("supabase/migrations/20260830124500_parent_engagement_alerts.sql");
const parkKingLiveScoreMigration = read("supabase/migrations/20260831150239_fix_park_king_live_session_scores.sql");
const tricktionaryMergeMigration = read("supabase/migrations/20260903020000_merge_tricktionary_entries.sql");
const tricktionaryHardeningMigration = read("supabase/migrations/20260903023000_harden_tricktionary_updates.sql");
const tricktionaryPlacementMigration = read("supabase/migrations/20260903084025_tricktionary_subcategories_and_safe_delete.sql");
const tricktionaryCorrectiveMigration = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql") && name > "20260903084025_tricktionary_subcategories_and_safe_delete.sql")
  .map((name) => ({ name, contents: read(`supabase/migrations/${name}`) }))
  .find(({ contents }) => [
    "public.set_tricktionary_location",
    "public.set_tricktionary_hidden",
    "public.merge_tricktionary_entries_v2",
    "public.set_tricktionary_category",
    "public.merge_tricktionary_entries",
  ].every((functionName) => contents.includes(`create or replace function ${functionName}`))) || null;
const tricktionaryRenameMigration = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql") && name > "20260903085841_harden_tricktionary_compatibility.sql")
  .map((name) => ({ name, contents: read(`supabase/migrations/${name}`) }))
  .find(({ contents }) => contents.includes("create or replace function public.rename_tricktionary_entry")) || null;
const version = "2.14.51";

function functionBody(name) {
  const start = app.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const tail = app.slice(start + 10);
  const nextMatch = tail.match(/\n(?:async )?function /);
  const next = nextMatch ? start + 10 + nextMatch.index : -1;
  return app.slice(start, next === -1 ? app.length : next);
}

function sqlFunctionBody(sql, name) {
  const normalizedSql = String(sql || "").toLowerCase();
  const marker = `create or replace function public.${String(name).toLowerCase()}(`;
  const start = normalizedSql.indexOf(marker);
  assert.notEqual(start, -1, `Corrective migration must replace public.${name}`);
  const next = normalizedSql.indexOf("\ncreate or replace function ", start + marker.length);
  return normalizedSql.slice(start, next === -1 ? normalizedSql.length : next);
}

function bracedBlock(contents, marker, fromIndex = 0) {
  const start = contents.indexOf(marker, fromIndex);
  assert.notEqual(start, -1, `${marker} should exist`);
  const markerBrace = marker.lastIndexOf("{");
  const open = markerBrace === -1 ? contents.indexOf("{", start + marker.length) : start + markerBrace;
  assert.notEqual(open, -1, `${marker} should open a CSS block`);
  let depth = 0;
  for (let index = open; index < contents.length; index += 1) {
    if (contents[index] === "{") depth += 1;
    if (contents[index] === "}") depth -= 1;
    if (depth === 0) return contents.slice(open + 1, index);
  }
  assert.fail(`${marker} CSS block should close`);
}

function arrayConstantDeclaration(name) {
  const match = app.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[[\\s\\S]*?\\];`));
  assert(match, `${name} should exist`);
  return match[0];
}

for (const [name, contents] of Object.entries({ app, html, css, serviceWorker, manifestText })) {
  assert(!/2\.11\.(16|44|45|46)/.test(contents), `${name} contains a stale asset version`);
}
assert(html.includes(`app.js?v=${version}`), "HTML should load the current app bundle");
assert(html.includes("initial-scale=1.0, viewport-fit=cover"), "Installed iPads must expose their safe-area insets to the app shell");
assert(serviceWorker.includes('const CACHE_PREFIX = "jkcrew-shell-"'), "service worker should use the public cache namespace");
assert(serviceWorker.includes(`const RELEASE_VERSION = "${version}"`), "service worker cache should use the current version");
assert(serviceWorker.includes("silent: false"), "Background push should request the device's normal notification sound");
const approvedDailyHypeMessages = [
  "It’s 9am. Go do something useful with your bike.",
  "Warm up first. You’re not made of spare parts.",
  "Go ride. Watching BMX clips doesn’t count.",
  "Try the trick you’ve been avoiding.",
  "One clean trick is enough progress for today.",
  "Morning. Ride if you can.",
  "The app says you have tricks to do.",
  "One decent attempt would be a start.",
  "Today’s suggestion: BMX.",
  "Do a lap. Go from there.",
  "Today’s goal: fewer excuses and cleaner riding.",
  "Give it a proper attempt before saying it doesn’t work.",
  "Ride for twenty minutes and see what happens.",
  "Pick one thing and improve it.",
  "The trick probably isn’t going to fix itself.",
  "Make the easy tricks look good today.",
  "Your session isn’t going to start itself.",
  "No big speech today. Just go ride.",
  "The bike is still where you left it.",
  "Stop scrolling. Go ride.",
  "A short session still counts.",
  "Don’t rush the difficult stuff.",
  "Try something. Preferably something on your sheet.",
  "Go ride before you find another reason not to.",
  "You can stop reading now.",
  "Do some BMX today. That’s the whole message.",
  "Check your sheet. There’s probably something you’re avoiding.",
  "Less phone. More bike.",
  "It’s 9am. Apparently I have to remind you to ride.",
  "That’s the reminder. Off you go.",
];
assert.equal(approvedDailyHypeMessages.length, 30, "The approved morning rotation must contain exactly 30 messages");
for (const message of approvedDailyHypeMessages) {
  assert(dailyHypeMessageMigration.includes(`'${message}'`), `The morning rotation is missing: ${message}`);
}
assert(dailyHypeMessageMigration.includes("private.jkcrew_daily_hype_message"), "The scheduled sender must use the approved daily message rotation");
assert(dailyHypeMessageMigration.includes("coalesce(preference.daily_hype, true)"), "The approved morning messages must still honour each rider's daily-hype setting");
assert(dailyHypeMessageMigration.includes("time >= time '09:00'"), "Morning messages must not send before 9am in the rider's local timezone");
assert(dailyHypeMessageMigration.includes("time < time '09:10'"), "The 9am send window must remain bounded to prevent late reminders");
assert(dailyHypeMessageMigration.includes("on conflict (dedupe_key) do nothing"), "Morning messages must remain deduplicated per rider and day");
assert(!dailyHypeMessageMigration.includes("Coach JK says:"), "The old seven-message morning copy must not return");

const shellRenderer = functionBody("renderShell");
assert(functionBody("mountStartupPrompts").includes("!mountWhatsNewPrompt() && !mountBattleIntroPrompt()"), "What's New must appear before the older battle and push prompts");
assert(app.includes(`const RELEASE_VERSION = "${version}"`), "The app bundle must share the release version used by the service worker");
assert(functionBody("renderAuth").includes('id="forgot-password"'), "The sign-in screen needs a visible Forgot password entry point");
assert(functionBody("requestPasswordReset").includes("resetPasswordForEmail"), "Password recovery must send a Supabase reset email");
assert(functionBody("requestPasswordReset").includes("redirectTo: redirectUrl.href"), "Password recovery must return the rider to JKCREW");
assert(functionBody("init").includes('event === "PASSWORD_RECOVERY"'), "The app must detect Supabase password-recovery sessions");
assert(functionBody("init").includes('withTimeout(client.auth.getSession(), "Sign in check", 8000)'), "Startup session recovery must fail fast enough to leave login usable");
assert(functionBody("init").includes('if (event === "INITIAL_SESSION")'), "A delayed Supabase initial session must still resume the installed app");
assert(functionBody("init").includes("handleSessionOnce(nextSession)"), "Supabase auth events must open a recovered session without an app restart");
assert(functionBody("handleSessionOnce").includes("state.sessionHandlePromise !== sessionPromise"), "An older auth completion must not clear a newer session attempt");
const sessionHandlerStart = app.indexOf("async function handleSession(session)");
const sessionHandler = app.slice(sessionHandlerStart, app.indexOf("\nfunction authHeroMarkup", sessionHandlerStart));
assert(sessionHandler.indexOf("renderShell()") < sessionHandler.indexOf("setupRealtimeSync()"), "Realtime setup must never block a successful login from opening the app shell");
assert(sessionHandler.includes('void setupRealtimeSync().catch'), "A realtime connection failure must stay non-blocking after login");
assert(sessionHandler.includes('beginScreenLoading(loadingScreenCopy("account"), 240)'), "A slow profile load must show the branded JKCREW loading reassurance");
assert(sessionHandler.includes("cancelScreenLoading();"), "Signing in or out must invalidate an older screen loader");
assert(functionBody("renderAuth").includes("cancelScreenLoading();"), "The sign-in form must never be covered by a stale loading popup");
assert(functionBody("renderBootRecovery").includes("cancelScreenLoading();"), "The boot recovery controls must never be covered by a stale loading popup");
const authHandler = functionBody("handleAuth");
assert(authHandler.includes("client.auth.signInWithPassword({ email, password })"), "Login must use Supabase password auth");
assert(!authHandler.includes("retryNetworkRequest(\n        () => client.auth.signInWithPassword") && !authHandler.includes("retryNetworkRequest(\n      () => client.auth.signInWithPassword"), "Password grants must not be automatically repeated after an uncertain timeout");
assert(app.includes("loadingOverlayToken: 0"), "Overlapping screen loads need a token so an older request cannot hide a newer loader");
assert(functionBody("loadingScreenCopy").includes('contests: ["Loading events & runs"'), "The loading popup should describe the screen being prepared");
const loadingStart = functionBody("beginScreenLoading");
assert(loadingStart.includes("delayMs = 320"), "The branded loading popup must be delayed so fast screens do not flash");
assert(loadingStart.includes("app.inert = true"), "Loading screens must block taps and keyboard actions on controls underneath");
assert(loadingStart.includes('id = "screen-loading-overlay"'), "Slow screens need the shared branded loading popup");
assert(loadingStart.includes("Keep JKCREW open · almost there"), "The loader must reassure users not to exit the app");
assert(loadingStart.includes("taking a little longer"), "Very slow connections need a clear second-stage reassurance");
assert(loadingStart.includes('aria-atomic", "true'), "The slow-loading reassurance should be announced as one accessible status update");
assert(!loadingStart.includes('aria-label", copy.title'), "The loading popup text must remain available to assistive technology");
assert(functionBody("finishScreenLoading").includes("token !== state.loadingOverlayToken"), "An older screen response must not remove the current loading popup");
assert(functionBody("finishScreenLoading").includes("app.inert = false"), "The current screen must become interactive again after loading");
const cancelLoading = functionBody("cancelScreenLoading");
assert(cancelLoading.includes("state.loadingOverlayToken += 1"), "Cancelling a loader must invalidate every older async completion");
assert(cancelLoading.includes('querySelector("#screen-loading-overlay")?.remove()'), "Cancelling a loader must uncover auth and recovery screens immediately");
assert(cancelLoading.includes("app.inert = false"), "Cancelling a loader must restore the login or recovery controls");
assert(functionBody("setLoading").includes("return beginScreenLoading(copy)"), "Every normal screen navigation must use the branded loader");
assert(functionBody("setLoading").includes('class="loading" aria-hidden="true"'), "Only the delayed popup should announce loading status");
const navigationLoading = functionBody("navigate");
assert(navigationLoading.includes("const loadingToken = setLoading()"), "Navigation must retain its own loading token");
assert(navigationLoading.includes("finishScreenLoading(loadingToken)"), "Navigation must always dismiss its own loading popup");
assert(navigationLoading.includes("loadingToken !== state.loadingOverlayToken || state.view !== view"), "An older failed request must never replace a newer screen");
assert(navigationLoading.includes("mountStartupPrompts()"), "Update and notification prompts should wait until the first screen is ready");
assert(!functionBody("renderShell").includes("mountWhatsNewPrompt()"), "The app shell must not put an onboarding dialog underneath its own loader");
const athleteHome = functionBody("renderAthleteHome");
assert(athleteHome.includes("void secondaryDataPromise.then"), "Optional athlete-home details must hydrate without holding the full-screen loader open");
assert(css.includes(".screen-loading-overlay"), "The JKCREW loading popup needs its branded overlay styling");
assert(css.includes(".screen-loading-track"), "The loading popup needs the coloured JKCREW progress route");
assert(functionBody("updateRecoveredPassword").includes("client.auth.updateUser({ password })"), "The recovery screen must securely save the new Supabase password");
assert(functionBody("updateRecoveredPassword").includes("password !== confirmPassword"), "The recovery screen must verify both password entries match");
assert(app.includes('const WHATS_NEW_RELEASE_ID = "2026-08-notification-centre"'), "What's New needs a fresh notification-centre campaign key");
assert(serviceWorker.includes("await self.skipWaiting()"), "Service-worker installation must finish activation before the install event can end");
assert(serviceWorker.includes("await Promise.all(windows.map"), "Service-worker activation must wait for every open app window to be refreshed");
assert(serviceWorker.includes("await client.navigate(url.href)"), "Installed apps must navigate to the new version before activation completes");
assert(serviceWorker.includes('event.data?.type === "JKCREW_ACTIVATE_RELEASE"'), "The app must be able to activate a waiting release immediately");
assert(app.includes('navigator.serviceWorker.addEventListener("controllerchange"'), "An installed app must reload after its service-worker controller changes");
assert(app.includes('window.addEventListener("pageshow"'), "Returning to an installed app must check for a new release");
assert(app.includes('document.addEventListener("visibilitychange"'), "Resuming an installed app must check for a new release");
assert.equal(manifest.start_url, `./?jkcrew-version=${version}`, "Installed launches must request the current release URL");
assert.equal(manifest.orientation, "any", "Installed JKCREW must allow iPad portrait and landscape rotation");
assert.equal(rileyManifest.orientation, "any", "The Riley test install must allow iPad portrait and landscape rotation");
assert(functionBody("mountWhatsNewPrompt").includes("rememberBattleIntro()"), "The all-update prompt should prevent a duplicate battle onboarding popup");
assert(functionBody("mountWhatsNewPrompt").includes("mountPushSetupPrompt()"), "Notification setup should follow the What's New popup");
assert(app.includes('const NOTIFICATION_SOUND_KEY = "jkcrew-notification-sound:v1"'), "In-app notification sound needs a per-device preference");
assert(functionBody("notify").includes("playNotificationSound"), "General in-app notifications should request the JKCREW chime");
assert(functionBody("showProgressPopup").includes("playNotificationSound"), "XP, badge and score popups should request the JKCREW chime");
assert(functionBody("playNotificationSound").includes('document.visibilityState !== "visible"'), "In-app sound must stay silent while the app is hidden");
assert(functionBody("pushNotificationSettingsHtml").includes("notification-sound-toggle"), "Every role needs an in-app notification sound control");
assert(functionBody("renderShell").includes("notification-centre-bell"), "Every role needs the shared notification-centre bell");
assert(app.includes('["contests", "Contests"]'), "The parent navigation must include the Contests tab");
assert(functionBody("renderCurrentParentView").includes("contests: renderContests"), "Parent view switching must support Contests");
assert(functionBody("renderParentHome").includes('data-parent-open-view="contests"'), "Parent Home needs a direct Upcoming Events button");
assert(functionBody("renderParentHome").includes("parentEngagementAlertHtml"), "Parent Home needs a persistent inactivity/progress check-in card");
assert(functionBody("parentNextItemHtml").includes('toLowerCase() !== "event"'), "Parent Home training agenda must not duplicate the Contests event list");
assert(functionBody("renderParentCalendar").includes('toLowerCase() !== "event"'), "Parent Calendar must exclude competition events");
assert(functionBody("renderParentCalendar").includes('"Training", "schedule"'), "Parent Calendar should be presented as a training schedule");
assert(functionBody("recordMyAppOpen").includes('rpc("record_my_app_open")'), "The app must record a throttled signed-in activity timestamp");
assert(parentEngagementMigration.includes("last_app_opened_at"), "Parent engagement alerts need a dedicated app-open timestamp");
assert(parentEngagementMigration.includes("queue_parent_engagement_alerts"), "Parent inactivity and low-progress alerts need a scheduled queue function");
assert(parentEngagementMigration.includes("parent-engagement:"), "Parent engagement alerts must be deduplicated per parent, rider and week");
assert(parentEngagementMigration.includes("'sheet'"), "Parent engagement pushes must respect the existing sheet notification preference");
assert(app.includes('rpc(isLine ? "record_line_action_at_venue"'), "Rider and coach Line actions must preserve the selected venue");
assert(parkKingLiveScoreMigration.includes("'percentage', 'lines', 'bonus'"), "Park King scores must include Lines");
assert(!parkKingLiveScoreMigration.includes("session.ended_at is not null"), "Park King must update while a training session is live");
assert(parkKingLiveScoreMigration.includes("jkcrew_country_timezone"), "Detached Daily completion recovery must use the rider's local date");
assert(parentEventCourseMigration.includes("parent_athletes"), "Parent course access must require a linked rider relationship");
assert(!parentEventCourseMigration.includes("from public.run_plans"), "Parent course access must never query private run plans");
assert(functionBody("setupRealtimeSync").includes('table: "app_notifications"'), "New notifications must update unread badges in realtime");
assert(functionBody("refreshOwnXpAfterAction").includes("showPrestigeCelebration"), "Crossing the XP cycle must show the Prestige celebration");
assert(functionBody("archiveRunPlan").includes("showUndoToast"), "Archiving a private run needs a recoverable Undo action");
assert(!functionBody("pushNotificationSettingsHtml").includes("Crew Chat"), "Removed Crew Chat must not remain in notification settings");
assert(notificationMigration.includes("create table if not exists public.app_notifications"), "The persistent notification inbox table must be migrated");
assert(notificationMigration.includes("alter table public.app_notifications enable row level security"), "Notification history must have RLS enabled");
assert(notificationMigration.includes("grant update (read_at, archived_at)"), "Recipients may only update notification read/archive fields");
assert(notificationMigration.includes("send_my_test_notification"), "Profile settings need a secure notification pipeline test");
assert(notificationMigration.includes("weekly_challenge_complete_notification"), "Weekly challenge completion must create an alert");
assert(notificationMigration.includes("rider_battle_status_notification"), "Battle starts and declines must create alerts");
assert(notificationMigration.includes("event_run_saved_notification"), "New private event runs must alert the coach");
assert(dailyListNotificationMigration.includes("and progress.progress_date is distinct from new.progress_date"), "Daily alerts must wait until every trick in the location list is complete");
assert(dailyListNotificationMigration.includes("if not v_daily_list_complete then"), "Individual Daily ticks must exit without notifying the coach");
assert(dailyListNotificationMigration.includes("'daily_list_completed'"), "The final Daily tick must create one list-completion notification");
assert(dailyListNotificationMigration.includes("'trick_completed'"), "Non-Daily trick completion notifications must remain enabled");
assert(dailyListNotificationMigration.includes("daily-list-completed:"), "Daily completion notifications need a rider, venue and date dedupe key");

const localAssetReferences = [...html.matchAll(/(?:src|href)="(?!https?:)([^"#]+)"/g)]
  .map((match) => match[1].split("?")[0])
  .filter((file) => file && !file.startsWith("data:"));
for (const file of localAssetReferences) {
  assert(existsSync(join(root, file)), `HTML asset is missing: ${file}`);
}

for (const icon of manifest.icons || []) {
  const iconPath = icon.src.split("?")[0];
  assert(existsSync(join(root, iconPath)), `Manifest icon is missing: ${iconPath}`);
  assert(icon.src.endsWith(`v=${version}`), `Manifest icon is stale: ${icon.src}`);
}

const shellBlock = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || "";
const shellFiles = [...shellBlock.matchAll(/"\.\/([^"?]*)/g)].map((match) => match[1]).filter(Boolean);
for (const file of shellFiles) assert(existsSync(join(root, file)), `Service-worker asset is missing: ${file}`);

for (let level = 1; level <= 45; level += 1) {
  const badge = `icons/badges/level-${String(level).padStart(2, "0")}.png`;
  assert(existsSync(join(root, badge)), `Level badge is missing: ${badge}`);
}
assert(functionBody("levelBadgeImageUrl").includes("safeLevel > 45"), "Levels without supplied artwork need a safe text fallback");
assert(functionBody("getXpSummary").includes('.from("athlete_badges")'), "Badge loading must verify the permanent earned-badge ledger");
assert(functionBody("getXpSummary").includes("highestPersistedLevel"), "A saved badge level must not be replaced by a lower calculated level");
assert(lifetimeXpBadgeMigration.includes("public.level_for_xp(coalesce(profile.xp_total, 0))"), "Leaderboard badge levels must come from lifetime XP");
assert(functionBody("renderAthleteHome").includes("{ ...(leaderboardRow || {}), ...state.profile, weekly_points: weeklyPoints }"), "Athlete Home must not let score rows override permanent XP profile levels");
const normalizeXpSummaryForTest = new Function(`
  const XP_LEVEL_CAP = 50;
  const PRESTIGE_LEVEL = 51;
  ${functionBody("rawXpRequiredForLevel")}
  ${functionBody("localXpRequiredForLevel")}
  ${functionBody("localLevelFromXp")}
  ${functionBody("localLevelBadge")}
  ${functionBody("normalizeXpSummary")}
  return normalizeXpSummary;
`)();
const savedBadgeGrid = Array.from({ length: 50 }, (_item, index) => ({ level: index + 1, unlocked: index < 14 }));
const preservedBadgeSummary = normalizeXpSummaryForTest({ xp_total: 5030, level: 14, badges: savedBadgeGrid });
assert.equal(preservedBadgeSummary.level, 14, "A previously saved rider level must survive client-side normalization");
assert.equal(preservedBadgeSummary.badges, savedBadgeGrid, "The server badge grid must survive client-side normalization intact");
assert.equal(
  normalizeXpSummaryForTest({ xp_total: 0, level: 1, badges: [{ level: 7, unlocked: true }] }).level,
  7,
  "An earned badge ledger row must protect the rider from a visual badge reset",
);
assert.equal(
  normalizeXpSummaryForTest({ xp_total: 120425, level: 50, badges: [] }).prestige_rank,
  0,
  "Prestige must not reset the badge run until the Level 50 badge has actually been earned",
);
assert.equal(
  normalizeXpSummaryForTest({ xp_total: 120425, level: 50, badges: [{ level: 50, unlocked: true }] }).prestige_rank,
  1,
  "An earned Level 50 badge may begin the Prestige badge run",
);

assert(app.includes("sessionOpenAssignmentSections: new Set()"), "Rider Session must track open trick-list sections");
const assignmentGroupsBody = functionBody("assignmentGroups");
assert(assignmentGroupsBody.includes("state.sessionOpenAssignmentSections.has(sectionKey)"), "Rider Session lists must restore their open state after refresh");
assert(assignmentGroupsBody.includes('${open ? "open" : ""}'), "Rider Session accordions must render their saved open state");
assert((functionBody("renderSession").match(/bindSessionAssignmentAccordions\(\)/g) || []).length >= 2, "Every rider Session render path must bind accordion state");
assert(functionBody("recordAssignmentAction").includes("sessionOpenAssignmentSections.add(openSection)"), "Ticking a standard trick must preserve its open list");
assert(functionBody("recordPercentageAttempt").includes("sessionOpenAssignmentSections.add(openSection)"), "Updating a percentage trick must preserve its open list");
const navigateBody = functionBody("navigate");
assert(navigateBody.includes('if (view === "session")'), "Every fresh rider Session navigation must reset its accordion layout");
assert(!navigateBody.includes('view === "session" && previousView !== "session"'), "Re-tapping Session must restore the clean Daily-first layout");
const assignmentPresentationForTest = new Function(`${functionBody("assignmentPresentation")}; return assignmentPresentation;`)();
assert.deepEqual(
  assignmentPresentationForTest({ category: "lines", trick_name: "Manual", notes: "Barspin - 180" }),
  { title: "Manual → Barspin → 180", notes: "" },
  "A three-trick Line must display as one complete run",
);
assert.deepEqual(
  assignmentPresentationForTest({ category: "lines", trick_name: "Drop in", notes: "Box jump - Flair - Quarter land" }),
  { title: "Drop in → Box jump → Flair → Quarter land", notes: "" },
  "A four-trick Line must display as one complete run",
);
assert.deepEqual(
  assignmentPresentationForTest({ category: "lines", trick_name: "Manual", notes: "Stay low" }),
  { title: "Manual", notes: "Stay low" },
  "A two-part legacy Line must keep its coaching note instead of treating it as a run",
);
assert.deepEqual(
  assignmentPresentationForTest({ category: "lines", trick_name: "Manual → Barspin → 180", notes: "Stay low - keep speed" }),
  { title: "Manual → Barspin → 180", notes: "Stay low - keep speed" },
  "An already formatted Line must not turn a coaching note into extra steps",
);
for (const category of ["daily", "one_bang", "dialled", "percentage", "foam_pit", "bonus"]) {
  assert.deepEqual(
    assignmentPresentationForTest({ category, trick_name: "Barspin", notes: "Keep speed - land clean" }),
    { title: "Barspin", notes: "Keep speed - land clean" },
    `${category} notes must not be converted into Line steps`,
  );
}
const escapeHtmlForTest = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const assignmentListForTest = new Function(
  "orderedAssignments",
  "isAssignmentComplete",
  "assignmentPresentation",
  "assignmentStatus",
  "escapeHtml",
  "state",
  `${functionBody("assignmentList")}; return assignmentList;`,
)(
  (assignments) => assignments,
  () => false,
  assignmentPresentationForTest,
  () => "To do this week",
  escapeHtmlForTest,
  { profile: null },
);
const lineMarkupForTest = assignmentListForTest([
  { id: "line-1", category: "lines", trick_name: "Manual", notes: "<img onerror=bad> - 180" },
]);
assert(lineMarkupForTest.includes("<strong>Manual → &lt;img onerror=bad&gt; → 180</strong>"), "A complete Line must render in the primary label and escape every step");
assert(lineMarkupForTest.includes("<small>To do this week</small>"), "A Line must keep its completion state beneath the run");
assert(!lineMarkupForTest.includes("<small>To do this week ·"), "Continuation tricks must not be repeated as grey notes");
const assignmentListBody = functionBody("assignmentList");
assert(assignmentListBody.includes("assignmentPresentation(assignment)"), "Rider and parent sheet lists must show a complete Line sequence");
assert(assignmentListBody.includes("escapeHtml(presentation.title)"), "Line sequences must be escaped before rendering");
const viewerListBody = functionBody("sessionViewerListContent");
assert(viewerListBody.includes("assignmentPresentation(assignment)"), "Coach Session Viewer must show a complete Line sequence");
assert(viewerListBody.includes("escapeHtml(presentation.title)"), "Coach Line sequences must be escaped before rendering");
assert(functionBody("coachListRequestsHtml").includes("assignmentPresentation(item)"), "List Requests must show each Line as one run");
assert(functionBody("coachListRequestsHtml").includes("data-proposal-edit"), "Every pending List Request needs a visible coach edit action");
assert(functionBody("coachListRequestsHtml").includes("Save changes &amp; approve"), "The coach must be able to approve a corrected sheet in one step");
assert(functionBody("coachProposalEditorFields").includes("Array.from({ length: requiredCount },"), "Coach sheet editing must keep fixed numbered rows for every required trick");
assert(functionBody("editedCoachProposalPayload").includes("wrongCounts"), "Coach-edited sheets must enforce every exact category count before approval");
assert(functionBody("editedCoachProposalPayload").includes("focusRiderProposalProblem"), "An incomplete coach edit must move to the first missing trick");
assert(functionBody("reviewRiderSheetProposal").includes('rpc("review_edited_rider_sheet_proposal"'), "Edited List Requests must use the atomic coach-only approval RPC");
assert(functionBody("renderCoachCommand").includes("[data-proposal-edit-cancel]"), "Coach List Request edit controls must be interactive");
assert(functionBody("setCoachProposalEditMode").includes("input.defaultValue"), "Cancelling a coach List Request edit must discard unsaved field changes");
const proposalItemFromLineForTest = new Function(`${functionBody("riderProposalItemFromLine")}; return riderProposalItemFromLine;`)();
const proposalItemInputValueForTest = new Function(`${functionBody("riderProposalItemInputValue")}; return riderProposalItemInputValue;`)();
const editableLineForTest = proposalItemFromLineForTest("lines", "Manual - Barspin - 180");
assert.deepEqual(editableLineForTest, { category: "lines", trick_name: "Manual", notes: "Barspin - 180" }, "Coach edits must preserve a complete Line in the existing data shape");
assert.equal(proposalItemInputValueForTest(editableLineForTest), "Manual - Barspin - 180", "Opening and saving a Line editor must round-trip every trick");
class FakeProposalFormData {
  constructor(form) { this.values = form.values; }
  get(name) { return this.getAll(name)[0] || ""; }
  getAll(name) { return this.values[name] || []; }
}
const proposalRequirementsForTest = { daily: 10, one_bang: 5, dialled: 5, percentage: 3, lines: 3, bonus: 1 };
const proposalFormValuesForTest = { proposalTitle: ["Coach corrected lists"], proposalVenue: ["Loganland"] };
Object.entries(proposalRequirementsForTest).forEach(([category, count]) => {
  proposalFormValuesForTest[`proposalItems.${category}`] = Array.from({ length: count }, (_, index) => category === "lines" ? `Start ${index + 1} - Middle - Finish` : `${category} trick ${index + 1}`);
});
const editedCoachProposalPayloadForTest = new Function(
  "FormData", "riderProposalRequirements", "categoryInfo", "riderProposalItemFromLine", "focusRiderProposalProblem", "notify",
  `${functionBody("editedCoachProposalPayload")}; return editedCoachProposalPayload;`,
)(FakeProposalFormData, proposalRequirementsForTest, {}, proposalItemFromLineForTest, () => {}, () => {});
const editedPayloadForTest = editedCoachProposalPayloadForTest({
  values: proposalFormValuesForTest,
  querySelectorAll: () => [],
  querySelector: (selector) => selector === '[name="proposalVenue"]' ? { value: "Loganland", removeAttribute: () => {} } : null,
});
assert.equal(editedPayloadForTest.items.length, 27, "A valid coach correction must submit the complete 27-item weekly sheet");
assert.equal(editedPayloadForTest.items.filter((item) => item.category === "lines").length, 3, "A coach correction must retain exactly three Lines");
assert(coachEditedProposalMigration.includes("security definer"), "Edited sheet approval must use a protected server-side transaction");
assert(coachEditedProposalMigration.includes("for update"), "Edited sheet approval must lock the pending request against duplicate review");
assert(coachEditedProposalMigration.includes("rider_sheet_items_are_complete(p_items)"), "The database must revalidate the exact 27-item sheet after coach edits");
assert(coachEditedProposalMigration.includes("return public.review_rider_sheet_proposal("), "Edited approval must reuse the established assignment and notification path");
assert(coachEditedProposalMigration.includes("from public, anon"), "Anonymous users must never execute coach-edited approval");
assert(coachReplaceProposalMigration.includes("save_weekly_assignment_list("), "Approving a complete request must replace each applicable list instead of appending extra tricks");
assert(coachReplaceProposalMigration.includes("'daily', 'one_bang', 'dialled', 'percentage', 'lines', 'bonus'"), "List-request approval must replace all six rider-requested categories");
assert(coachReplaceProposalMigration.includes("Auto backup before rider-request approval"), "Replacing a requested list must keep an archived copy of the prior list");
assert(coachReplaceProposalMigration.includes("HOTBOX - Aus National Training Facility"), "List-request approval must not recreate the retired Hotbox duplicate venue");
assert(coachReplaceProposalMigration.includes("assignments_updated"), "The coach UI must receive the number of assignments saved by replacement approval");
assert(functionBody("reviewRiderSheetProposal").includes("const approving = decision === \"accepted\""), "Approve-as-sent and edited approval must share the safe replacement path");
assert(functionBody("reviewRiderSheetProposal").includes("result?.assignments_updated"), "Approval feedback must report replaced assignments rather than a misleading zero added");
assert(coachProposalBackupMigration.includes("private.rider_sheet_replacement_backups"), "Replaced List Request data needs a private recovery snapshot");
assert(coachProposalBackupMigration.includes("public.assignment_progress"), "List replacement must back up current completion rows");
assert(coachProposalBackupMigration.includes("public.assignment_attempts"), "List replacement must back up current attempt rows");
assert(coachProposalBackupMigration.includes("public.percentage_attempts"), "List replacement must back up current Percentage attempts");
assert(coachProposalBackupMigration.includes("public.assignment_point_awards"), "List replacement must back up point-award links");
assert(coachProposalBackupMigration.includes("public.xp_ledger"), "List replacement must back up XP-ledger links");
assert(coachProposalBackupMigration.includes("incoming.item->>'notes'"), "Changed Line steps must not inherit the old Line's completion state");
assert(coachProposalBackupMigration.includes("The corrected lists could not be saved at their exact required counts."), "List-request approval must verify exact active counts before acceptance");
assert(coachProposalBackupMigration.includes("Mark accepted last"), "The rider must only be notified after every replacement save succeeds");
assert(coachProposalBackupMigration.includes("Older cached coach clients"), "Legacy approve-as-sent calls must use the safe replacement path during rollout");
assert(functionBody("previousTrainingSheetsHtml").includes("assignmentPresentation(assignment)"), "Sheet history must show each Line as one run");
assert(functionBody("parentRecentActivityHtml").includes("assignmentPresentation(assignment).title"), "Parent activity must use the full Line label");
assert(functionBody("plannerCompletedStrip").includes("assignmentPresentation(assignment).title"), "Planner completion chips must use the full Line label");
assert(functionBody("sessionViewerAssignmentEditor").includes("Example: Manual - Barspin - 180"), "Coach Line editor must show the exact 3–4 trick run format");
assert(css.includes(".viewer-trick-row.viewer-attempt-row {\n  grid-template-columns: auto minmax(0, 1fr);"), "Coach Session Line labels must have a wrapping text column");
assert(functionBody("getWeeklyAssignments").includes('rpc("get_effective_weekly_assignments"'), "Rider schedules must load each location's latest saved Daily list");
const venueKeyForTest = (venue = "") => String(venue || "").trim();
const rawVenueIdentityKeyForTest = (venue = "") => venueKeyForTest(venue).normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const venueAliasesForTest = Object.freeze({ beenleighskatepark: "beenleigh", hotbox: "hotboxausnationaltrainingfacility" });
const canonicalVenueLabelsForTest = Object.freeze({ beenleigh: "Beenleigh", hotboxausnationaltrainingfacility: "HOTBOX - Aus National Training Facility" });
const venueIdentityKeyForTest = (venue = "") => venueAliasesForTest[rawVenueIdentityKeyForTest(venue)] || rawVenueIdentityKeyForTest(venue);
const venueLabelForTest = (venue = "") => canonicalVenueLabelsForTest[venueIdentityKeyForTest(venue)] || venueKeyForTest(venue) || "Default Daily List";
const dailyVenuesForTest = new Function("venueKey", "venueIdentityKey", "venueLabel", `${functionBody("dailyVenues")}; return dailyVenues;`)(venueKeyForTest, venueIdentityKeyForTest, venueLabelForTest);
assert.deepEqual(
  dailyVenuesForTest([
    { category: "daily", venue: "HOTBOX" },
    { category: "daily", venue: "Hotbox" },
    { category: "daily", venue: "Beenleigh Skate Park" },
    { category: "one_bang", venue: "Ignored" },
  ]),
  ["HOTBOX - Aus National Training Facility", "Beenleigh"],
  "Location selectors must merge the duplicate Hotbox and Beenleigh names under their requested labels",
);
const assignmentsForVenueForTest = new Function("venueIdentityKey", "rawVenueIdentityKey", `${functionBody("newestDailyListForVenue")}\n${functionBody("assignmentsForVenue")}; return assignmentsForVenue;`)(venueIdentityKeyForTest, rawVenueIdentityKeyForTest);
assert.equal(
  assignmentsForVenueForTest([
    { id: "older", category: "daily", venue: "Beenleigh", updated_at: "2026-08-26T01:00:00Z", sort_order: 1 },
    { id: "newer-1", category: "daily", venue: "Beenleigh Skate Park", updated_at: "2026-08-27T01:00:00Z", sort_order: 40 },
    { id: "newer-2", category: "daily", venue: "beenleigh-skate-park", updated_at: "2026-08-27T01:00:00Z", sort_order: 41 },
    { id: "other", category: "daily", venue: "Hotbox", updated_at: "2026-08-27T02:00:00Z", sort_order: 1 },
  ], "Beenleigh").length,
  2,
  "Opening Beenleigh must keep only that rider's most recently saved Daily list",
);
assert(functionBody("scheduleEditorHtml").includes("newestDailyListForVenue(assignments, venue)"), "Coach list editors must use the same newest Beenleigh list as the rider view");
assert(beenleighMigration.includes("when 'beenleighskatepark' then 'beenleigh'"), "The database must canonicalize both Beenleigh location names");
assert(beenleighMigration.includes("source_venue_key"), "Daily-list reads must keep enough source identity to select one newest list");
assert(beenleighMigration.includes("private.retired_coach_venue_backups"), "The removed duplicate coach location needs a private recovery backup");
assert(!beenleighMigration.includes("delete from public.weekly_trick_assignments"), "Merging Beenleigh must not delete historical rider tricks or linked progress");
const dailyVenueGroupsBody = functionBody("dailyVenueGroups");
assert(dailyVenueGroupsBody.includes("interactive ? (matchingVenues.length ? matchingVenues : venues.slice(0, 1)) : venues"), "Rider Session must show only the selected Daily location");
assert(dailyVenueGroupsBody.includes("const open = interactive ||"), "The selected rider Daily location must open automatically");
assert(dailyVenueGroupsBody.includes("complete}/${visibleAssignments.length}"), "Rider Daily counts must describe the visible selected location only");
assert(functionBody("renderSession").includes("assignmentGroups(assignments, true, state.profile, selectedVenue)"), "Rider Session must pass the chosen location into the Daily list");

const coachNavBody = app.match(/const coachNav = \[([\s\S]*?)\];/)?.[1] || "";
assert.equal((coachNavBody.match(/\["/g) || []).length, 6, "Coach mobile navigation must include live Challenge oversight");
for (const label of ["Command", "Session", "Riders", "Challenges", "Coach Tools", "More"]) {
  assert(coachNavBody.includes(`"${label}"`), `Coach navigation is missing ${label}`);
}

const parentNavBody = app.match(/const parentNav = \[([\s\S]*?)\];/)?.[1] || "";
assert.equal((parentNavBody.match(/\["/g) || []).length, 6, "Parent navigation must expose the six family views");
for (const label of ["Home", "Week", "Coaching", "Contests", "Calendar", "More"]) {
  assert(parentNavBody.includes(`"${label}"`), `Parent navigation is missing ${label}`);
}
assert(
  css.includes(".parent-shell .bottom-nav { grid-template-columns: repeat(6, minmax(0, 1fr)); }"),
  "Parent bottom navigation must use a six-column family layout",
);
for (const tone of ["aqua", "blue", "violet", "gold", "coral"]) {
  assert(css.includes(`--parent-${tone}:`), `Parent palette is missing ${tone}`);
}
assert(css.includes(".parent-shell .parent-child-card"), "Parent linked-rider cards should use the parent visual system");
assert(css.includes(".parent-shell .push-settings-card"), "Parent profile controls should use the parent visual system");
assert(!css.includes(".parent-shell .parent-readonly { pointer-events: none; }"), "Read-only parent content must still allow accordion navigation");
assert(functionBody("renderParentWeek").includes("assignmentGroups(assignments, false)"), "Parent weekly sheets must remain read-only");
const riderTricktionaryRenderer = functionBody("renderTricktionary");
const coachTricktionaryRenderer = functionBody("renderCoachTricktionary");
const parentTricktionaryRenderer = functionBody("renderParentTricktionary");
const sharedEditableTricktionaryCall = "tricktionaryBoardHtml(entries, data.attempts, { editable: true, profile: data.profile })";
assert(riderTricktionaryRenderer.includes(sharedEditableTricktionaryCall), "Riders must receive the exact shared editable Tricktionary board used by coaches");
assert(coachTricktionaryRenderer.includes(sharedEditableTricktionaryCall), "Coaches must receive the exact shared editable Tricktionary board used by riders");
assert(riderTricktionaryRenderer.includes("bindTricktionaryBoard"), "Rider Tricktionary drag, merge, move, and delete controls must be interactive");
assert(coachTricktionaryRenderer.includes("bindTricktionaryBoard"), "Coach Tricktionary drag, merge, move, and delete controls must be interactive");
assert(parentTricktionaryRenderer.includes("tricktionaryBoardHtml(entries, data.attempts, { profile: data.profile })"), "Parents must receive the shared Tricktionary layout in read-only mode");
assert(!parentTricktionaryRenderer.includes("editable: true"), "Parent Tricktionary must remain read-only");
assert(!parentTricktionaryRenderer.includes("bindTricktionaryBoard"), "Parent Tricktionary must not bind drag, merge, move, or delete actions");
assert(functionBody("getTricktionaryData").includes("getTricktionaryPagedRows"), "Tricktionary totals must load the complete paged history");
assert(!functionBody("getTricktionaryData").includes(".limit(400)"), "Tricktionary assignment totals must not stop at 400 rows");
assert(functionBody("landedTricktionaryEntries").includes("resolveTricktionaryAlias(sourceKey, meta.aliases)"), "Landed totals must roll up through the canonical trick name");
assert(functionBody("landedTricktionaryEntries").includes('trick.source === "merged"'), "Legacy synthetic merge markers must not add a fake landing");
assert(functionBody("attemptsByTrick").includes("resolveTricktionaryAlias"), "Attempt totals must roll up through the canonical trick name");
assert(functionBody("weeklyAttemptsHtml").includes("meta.aliases, meta.titles"), "Weekly attempt summaries must use merged names and totals");
const tricktionaryBoard = functionBody("tricktionaryBoardHtml");
assert(tricktionaryBoard.includes('<details class="tricktionary-zone tricktionary-category-accordion"'), "Box, Spine, Air, and Hip must be closed category dropdowns");
assert(!tricktionaryBoard.includes('<details open class="tricktionary-zone'), "Tricktionary category dropdowns must start closed");
assert(tricktionaryBoard.includes('class="tricktionary-subcategory"'), "Tricktionary areas must include their requested subcategory dropdowns");
assert(tricktionaryBoard.includes('data-tricktionary-drop-subcategory='), "Tricktionary subcategories must be direct drag-and-drop targets");
const tricktionaryBoxSubcategories = arrayConstantDeclaration("TRICKTIONARY_BOX_SUBCATEGORIES");
assert(/id:\s*"transfers"\s*,\s*label:\s*"Transfers"/.test(tricktionaryBoxSubcategories), "Box must expose a dedicated Transfers subcategory");
assert(/section\.id\s*===\s*"box"[\s\S]*?TRICKTIONARY_BOX_SUBCATEGORIES/.test(tricktionaryBoard), "The Box accordion must use its Transfers-aware subcategory list");
assert(functionBody("tricktionaryCardHtml").includes("data-delete-tricktionary-entry"), "Editable Tricktionary cards must include the small delete control");
const tricktionaryCardRenderer = new Function(`
  const TRICKTIONARY_ALLOWED_CATEGORIES = new Set(["new", "box", "spine", "air", "hip"]);
  const TRICKTIONARY_CATEGORY_LABELS = { new: "New Tricks", box: "Box", spine: "Spine", air: "Air", hip: "Hip" };
  const escapeHtml = (value) => String(value ?? "");
  ${functionBody("normalizeTrickKey")}
  ${functionBody("safeTricktionaryCategory")}
  ${functionBody("tricktionarySubcategory")}
  ${functionBody("tricktionaryCardHtml")}
  return tricktionaryCardHtml;
`)();
const tricktionaryCardFixture = { key: "truck driver", title: "Truck Driver", source: "Weekly sheet", count: 4, tricktionaryCategory: "spine", tricktionarySubcategory: "spins" };
const editableTricktionaryCard = tricktionaryCardRenderer(tricktionaryCardFixture, new Map(), true);
const readonlyTricktionaryCard = tricktionaryCardRenderer(tricktionaryCardFixture, new Map(), false);
assert(editableTricktionaryCard.includes('data-delete-tricktionary-entry="truck driver"'), "Editable rider and coach cards must render the red delete control");
assert(editableTricktionaryCard.includes('draggable="true"'), "Editable rider and coach cards must remain draggable");
assert(!readonlyTricktionaryCard.includes("data-delete-tricktionary-entry") && !readonlyTricktionaryCard.includes('draggable="true"'), "Read-only parent cards must render neither delete nor drag controls");
assert(editableTricktionaryCard.includes('class="tricktionary-rename-btn"') && editableTricktionaryCard.includes('data-rename-tricktionary-entry="truck driver"'), "Editable rider and coach cards must render a compact rename control for the canonical trick");
assert(!readonlyTricktionaryCard.includes("data-rename-tricktionary-entry") && !readonlyTricktionaryCard.includes("tricktionary-rename-btn"), "Read-only parent cards must never render the rename control");
assert(css.includes(".tricktionary-rename-btn"), "The compact Tricktionary rename control must have an app-native visual treatment");
const tricktionaryBoardRenderer = new Function(`
  ${arrayConstantDeclaration("TRICKTIONARY_SECTIONS")}
  ${arrayConstantDeclaration("TRICKTIONARY_STANDARD_SUBCATEGORIES")}
  ${tricktionaryBoxSubcategories}
  ${arrayConstantDeclaration("TRICKTIONARY_AIR_SUBCATEGORIES")}
  const TRICKTIONARY_CATEGORY_LABELS = Object.fromEntries(TRICKTIONARY_SECTIONS.map((section) => [section.id, section.label]));
  const TRICKTIONARY_ALLOWED_CATEGORIES = new Set(TRICKTIONARY_SECTIONS.map((section) => section.id));
  const escapeHtml = (value) => String(value ?? "");
  ${functionBody("normalizeTrickKey")}
  ${functionBody("safeTricktionaryCategory")}
  ${functionBody("manualTricktionary")}
  ${functionBody("tricktionaryMeta")}
  ${functionBody("resolveTricktionaryAlias")}
  ${functionBody("tricktionarySubcategory")}
  ${functionBody("attemptsByTrick")}
  ${functionBody("tricktionaryCardHtml")}
  ${functionBody("tricktionaryBoardHtml")}
  return tricktionaryBoardHtml;
`)();
const transfersBoardHtml = tricktionaryBoardRenderer([
  { key: "alleyoop transfer", title: "Alleyoop Transfer", source: "Weekly sheet", count: 3, tricktionaryCategory: "box" },
], [], { editable: true, profile: {} });
assert(transfersBoardHtml.includes('data-tricktionary-drop-subcategory="transfers"'), "Transfers must render as a direct Tricktionary drag-and-drop destination");
assert(transfersBoardHtml.includes('data-trick-subcategory="transfers"'), "Automatically classified Box transfers must render inside the Transfers destination");
const mergeTricktionaryBody = functionBody("mergeTricktionaryEntries");
assert(mergeTricktionaryBody.includes('rpc("merge_tricktionary_entries_v2"'), "Trick merges must atomically preserve their category and subcategory");
assert(!mergeTricktionaryBody.includes("crypto.randomUUID"), "Merging tricks must never create a new manual trick");
assert(!mergeTricktionaryBody.includes("count: 1"), "Merging tricks must never invent a landing");
const renameTricktionaryBody = functionBody("renameTricktionaryEntry");
assert(renameTricktionaryBody.includes('rpc("rename_tricktionary_entry"'), "Renaming a Tricktionary card must use one atomic Supabase RPC");
for (const parameter of ["p_athlete_id", "p_trick_key", "p_member_keys", "p_display_title", "p_category", "p_subcategory"]) {
  assert(renameTricktionaryBody.includes(parameter), `Atomic Tricktionary rename must send ${parameter}`);
}
assert(!renameTricktionaryBody.includes("crypto.randomUUID") && !renameTricktionaryBody.includes("add_manual_tricktionary_entry"), "Renaming must not create a replacement manual landing");
const coachManualTricktionaryBody = functionBody("coachManualTricktionaryPanel");
assert(coachManualTricktionaryBody.includes("meta.titles?.[canonicalKey]"), "Coach manual Tricktionary rows must display the renamed canonical title");
assert(coachManualTricktionaryBody.includes("trick.id || sourceTitle"), "Renamed manual rows must retain their stable removal identity");
const bindTricktionaryBody = functionBody("bindTricktionaryBoard");
assert(bindTricktionaryBody.includes('event.pointerType === "mouse"'), "Desktop native drag and touch pointer drag must not both process one gesture");
assert(bindTricktionaryBody.includes("if (!payload?.key || dropInFlight) return;"), "One physical Tricktionary drop must be rejected while another save is in flight");
assert(bindTricktionaryBody.includes("dropInFlight = true;") && bindTricktionaryBody.includes("dropInFlight = false;"), "Tricktionary mutations must bracket each save with a single-flight lock");
assert(bindTricktionaryBody.includes("updateTouchAutoScroll(event.clientY)"), "Touch dragging must edge-scroll so phone riders can reach off-screen categories");
assert(bindTricktionaryBody.includes("window.scrollBy(0, touchAutoScrollVelocity)") && bindTricktionaryBody.includes("requestAnimationFrame(runTouchAutoScroll)"), "Touch edge scrolling must move smoothly one animation frame at a time");
assert((bindTricktionaryBody.match(/stopTouchAutoScroll\(\);/g) || []).length >= 3, "Touch auto-scroll must stop on drag end, pointer up, and pointer cancellation");
assert(bindTricktionaryBody.includes('addEventListener("selectstart"'), "Editable Tricktionary boards must block accidental text highlighting");
assert(bindTricktionaryBody.includes('targetCard.classList.add("merge-target")'), "Mouse dragging over a trick must clearly show that landed totals will merge");
assert(/zone\.addEventListener\("dragover",[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);/.test(bindTricktionaryBody), "Nested subcategory dragover events must stop before the parent category handles the same gesture");
assert(/zone\.addEventListener\("drop",[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);/.test(bindTricktionaryBody), "Nested subcategory drops must stop before the parent category saves the same gesture again");
const firstTricktionaryRefresh = bindTricktionaryBody.indexOf("await refresh?.();");
const firstTricktionaryRestore = bindTricktionaryBody.indexOf("restoreTricktionaryViewState(viewState)");
assert(firstTricktionaryRefresh !== -1 && firstTricktionaryRestore > firstTricktionaryRefresh, "A Tricktionary drop must refresh once, then restore its saved view state");
const captureTricktionaryStateBody = functionBody("captureTricktionaryViewState");
const restoreTricktionaryStateBody = functionBody("restoreTricktionaryViewState");
assert(captureTricktionaryStateBody.includes("scrollX") && captureTricktionaryStateBody.includes("scrollY"), "Tricktionary refresh state must preserve both scroll axes");
assert(captureTricktionaryStateBody.includes(".tricktionary-category-accordion[open]") && captureTricktionaryStateBody.includes(".tricktionary-subcategory[open]"), "Tricktionary refresh state must remember both open category levels");
assert(restoreTricktionaryStateBody.includes("node.open = categories.has") && restoreTricktionaryStateBody.includes("node.open = subcategories.has"), "Tricktionary refresh must reopen both saved category levels");
assert(restoreTricktionaryStateBody.includes("window.scrollTo") && restoreTricktionaryStateBody.includes("requestAnimationFrame"), "Tricktionary refresh must restore scroll after the replacement DOM has laid out");
assert(bindTricktionaryBody.includes('data-delete-tricktionary-entry'), "The shared rider and coach board must wire its delete controls");
assert(bindTricktionaryBody.includes('data-rename-tricktionary-entry'), "The shared rider and coach board must wire its rename controls");
assert(bindTricktionaryBody.includes("renameTricktionaryEntry(athleteId, entry"), "The rename control must preserve and submit the selected card's canonical/member metadata");
assert(css.includes(".tricktionary-board.is-editable *"), "All text inside an editable Tricktionary must opt out of selection");
assert(css.includes("-webkit-touch-callout: none"), "iPhone Tricktionary dragging must suppress the text callout");
assert(css.includes(".tricktionary-subcategory.drag-over"), "Dragging over a subcategory must show a clear destination state");
assert(css.includes(".tricktionary-delete-btn"), "Tricktionary delete controls must have a compact red visual treatment");
const coarsePointerCss = [...css.matchAll(/@media\s*\(pointer:\s*coarse\)[^{]*\{/g)]
  .map((match) => bracedBlock(css, match[0], match.index))
  .join("\n");
const coarseDeleteStart = coarsePointerCss.indexOf(".tricktionary-delete-btn");
assert.notEqual(coarseDeleteStart, -1, "Coarse-pointer devices must receive a dedicated Tricktionary delete hit target");
const coarseDeleteCss = coarsePointerCss.slice(coarseDeleteStart, coarseDeleteStart + 700);
assert(/min-width:\s*44px/.test(coarseDeleteCss) && /min-height:\s*44px/.test(coarseDeleteCss), "The visible delete control may stay compact, but its phone and iPad hit target must be at least 44 by 44 pixels");
const desktopTricktionaryGrid = bracedBlock(css, ".tricktionary-category-grid");
assert(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(desktopTricktionaryGrid), "Desktop and iPad Tricktionary categories must retain the balanced two-column layout");
const mobileTricktionaryCss = bracedBlock(css, "@media (max-width: 780px)");
assert(/\.tricktionary-category-grid\s*\{\s*grid-template-columns:\s*1fr;\s*\}/.test(mobileTricktionaryCss), "Phone Tricktionary categories must collapse to one readable column");
assert(tricktionaryMergeMigration.includes("update public.profiles profile"), "The merge RPC must save aliases atomically on the rider profile");
assert(tricktionaryMergeMigration.includes("for update"), "Concurrent Tricktionary merges must lock the rider metadata row");
assert(tricktionaryMergeMigration.includes("public.coach_athletes"), "A coach may only merge Tricktionary entries for a linked rider");
assert(tricktionaryMergeMigration.includes("revoke all on function public.merge_tricktionary_entries"), "The merge RPC must not be executable by anonymous users");
assert(functionBody("moveTricktionaryEntry").includes('rpc("set_tricktionary_location"'), "Category and subcategory moves must save together through an atomic RPC");
const setTricktionaryHiddenBody = functionBody("setTricktionaryEntryHidden");
assert(setTricktionaryHiddenBody.includes('rpc("set_tricktionary_hidden"'), "One reversible helper must own Tricktionary tombstone changes");
assert(/p_hidden:\s*Boolean\(hidden\)/.test(setTricktionaryHiddenBody), "The reversible helper must pass both true and false tombstone states to Supabase");
assert(functionBody("hideTricktionaryEntry").includes("setTricktionaryEntryHidden(athleteId, trickKey, true)"), "Deleting a Tricktionary card must create a reversible tombstone");
assert(functionBody("restoreTricktionaryEntry").includes("setTricktionaryEntryHidden(athleteId, trickKey, false)"), "Undo must remove the Tricktionary tombstone");
assert(bindTricktionaryBody.includes("showUndoToast") && bindTricktionaryBody.includes("restoreTricktionaryEntry(athleteId, entry.key)"), "A successful delete must offer an Undo action that restores the same canonical card");
assert(functionBody("showUndoToast").includes(">Undo</button>"), "The reversible delete toast must expose an explicit Undo button");
assert(functionBody("saveManualTrick").includes('rpc("add_manual_tricktionary_entry"'), "Rider manual additions must preserve concurrent merges through an atomic RPC");
assert(functionBody("removeManualTrick").includes('rpc("remove_manual_tricktionary_entry"'), "Rider manual removals must be atomic");
assert(functionBody("saveCoachManualTrick").includes('rpc("add_manual_tricktionary_entry"'), "Coach manual additions must preserve concurrent rider changes");
assert(functionBody("removeCoachManualTrick").includes('rpc("remove_manual_tricktionary_entry"'), "Coach manual removals must be atomic");
assert(!app.includes("function saveTricktionaryProfileUpdate"), "Tricktionary edits must not use an unlocked whole-profile metadata overwrite");
assert(tricktionaryHardeningMigration.includes("create or replace function public.set_tricktionary_category"), "The category update RPC must ship with the app");
assert(tricktionaryHardeningMigration.includes("create or replace function public.add_manual_tricktionary_entry"), "The atomic manual-add RPC must ship with the app");
assert(tricktionaryHardeningMigration.includes("create or replace function public.remove_manual_tricktionary_entry"), "The atomic manual-remove RPC must ship with the app");
assert.equal((tricktionaryHardeningMigration.match(/for update;/g) || []).length, 3, "Every Tricktionary mutation RPC must lock the profile row");
assert(tricktionaryHardeningMigration.includes("revoke all on function public.set_tricktionary_category"), "Tricktionary mutation RPCs must not be anonymous");
assert(tricktionaryPlacementMigration.includes("create or replace function public.set_tricktionary_location"), "The category and subcategory placement RPC must ship with the app");
assert(tricktionaryPlacementMigration.includes("create or replace function public.set_tricktionary_hidden"), "The safe Tricktionary delete RPC must ship with the app");
assert(tricktionaryPlacementMigration.includes("create or replace function public.merge_tricktionary_entries_v2"), "The atomic merge-and-placement RPC must ship with the app");
assert.equal((tricktionaryPlacementMigration.match(/for update;/g) || []).length, 3, "Every new Tricktionary mutation RPC must lock the rider profile");
assert.equal((tricktionaryPlacementMigration.match(/security definer/g) || []).length, 3, "Every public Tricktionary mutation RPC must be security definer");
assert(tricktionaryPlacementMigration.includes("private.can_manage_tricktionary"), "Every new Tricktionary mutation must enforce rider or linked-coach access");
assert(tricktionaryPlacementMigration.includes("revoke all on function public.set_tricktionary_hidden"), "Anonymous users must not be able to hide Tricktionary entries");
assert(!/delete\s+from\s+public\.(weekly_trick_assignments|assignment_progress|assignment_attempts|assignment_point_awards|percentage_attempts)/i.test(tricktionaryPlacementMigration), "Tricktionary organisation and deletion must never remove training, points, or XP source rows");
assert(tricktionaryCorrectiveMigration, "A new corrective migration must harden the already-created Tricktionary RPCs instead of rewriting deployed migration history");
const tricktionaryCorrectiveSql = tricktionaryCorrectiveMigration?.contents || "";
const correctedLocationRpc = sqlFunctionBody(tricktionaryCorrectiveSql, "set_tricktionary_location");
const correctedHiddenRpc = sqlFunctionBody(tricktionaryCorrectiveSql, "set_tricktionary_hidden");
const correctedMergeRpc = sqlFunctionBody(tricktionaryCorrectiveSql, "merge_tricktionary_entries_v2");
for (const [label, body] of [["placement", correctedLocationRpc], ["hidden", correctedHiddenRpc], ["merge", correctedMergeRpc]]) {
  assert(/if\s+not\s+private\.can_manage_tricktionary\s*\(\s*v_user_id,\s*p_athlete_id\s*\)/.test(body), `Corrected Tricktionary ${label} RPC must reject an unauthorized or NULL rider through the shared access guard`);
}
const tricktionaryAccessGuard = tricktionaryHardeningMigration.toLowerCase().slice(
  tricktionaryHardeningMigration.toLowerCase().indexOf("create or replace function private.can_manage_tricktionary("),
  tricktionaryHardeningMigration.toLowerCase().indexOf("create or replace function public.set_tricktionary_category("),
);
assert(tricktionaryAccessGuard.includes("p_user_id is not null") && tricktionaryAccessGuard.includes("p_athlete_id is not null"), "The shared Tricktionary access guard must semantically reject NULL users and riders");
for (const [label, body] of [["placement", correctedLocationRpc], ["hidden", correctedHiddenRpc]]) {
  assert(/v_key\s+text\s*:=\s*lower\([\s\S]*?coalesce\(p_trick_key,\s*''\)/.test(body), `Corrected Tricktionary ${label} RPC must normalize NULL trick keys to the same rejected blank value`);
  assert(/char_length\s*\(\s*v_key\s*\)\s*<\s*1/.test(body), `Corrected Tricktionary ${label} RPC must reject NULL and blank normalized trick keys`);
  assert(/char_length\s*\(\s*v_key\s*\)\s*>\s*120/.test(body), `Corrected Tricktionary ${label} RPC must cap normalized trick keys at 120 characters`);
}
assert(/p_hidden\s+is\s+null/.test(correctedHiddenRpc), "Corrected delete RPC must require an explicit true or false hidden state");
assert(/v_display_title\s+text\s*:=\s*regexp_replace\([\s\S]*?coalesce\(p_display_title,\s*''\)/.test(correctedMergeRpc), "Corrected merge RPC must normalize a NULL display title to the same rejected blank value");
assert(/char_length\s*\(\s*v_display_title\s*\)\s*<\s*1/.test(correctedMergeRpc), "Corrected merge RPC must reject NULL and blank normalized display titles");
assert(/char_length\s*\(\s*v_display_title\s*\)\s*>\s*120/.test(correctedMergeRpc), "Corrected merge RPC must cap its display title at 120 characters");
assert(/coalesce\(cardinality\(p_source_keys\),\s*0\)\s*<\s*1/.test(correctedMergeRpc) && /coalesce\(cardinality\(p_target_keys\),\s*0\)\s*<\s*1/.test(correctedMergeRpc), "Corrected merge RPC must reject NULL and empty source or target arrays");
assert(/coalesce\(v_key,\s*''\)/.test(correctedMergeRpc) && /char_length\s*\(\s*v_normalized_key\s*\)\s*<\s*1/.test(correctedMergeRpc), "Corrected merge RPC must normalize and reject NULL or blank members inside either key array");
assert(/char_length\s*\(\s*v_normalized_key\s*\)\s*>\s*120/.test(correctedMergeRpc), "Corrected merge RPC must cap every normalized source and target key at 120 characters");
const correctedLegacyCategoryRpc = sqlFunctionBody(tricktionaryCorrectiveSql, "set_tricktionary_category");
const correctedLegacyMergeRpc = sqlFunctionBody(tricktionaryCorrectiveSql, "merge_tricktionary_entries");
assert(correctedLegacyCategoryRpc.includes("public.set_tricktionary_location("), "The legacy category RPC must delegate to the validated category-and-subcategory RPC");
assert(correctedLegacyMergeRpc.includes("public.merge_tricktionary_entries_v2("), "The legacy merge RPC must delegate to the validated merge-and-placement RPC");
assert(!correctedLegacyCategoryRpc.includes("update public.profiles") && !correctedLegacyMergeRpc.includes("update public.profiles"), "Legacy Tricktionary wrappers must not retain a second metadata mutation implementation");
assert(!/delete\s+from\s+public\.(weekly_trick_assignments|assignment_progress|assignment_attempts|assignment_point_awards|percentage_attempts)/i.test(tricktionaryCorrectiveSql), "Corrective Tricktionary SQL must preserve every historical landing, point, XP, and training row");
assert(tricktionaryRenameMigration, "A new migration must add atomic Tricktionary renaming without rewriting an already-deployed migration");
const tricktionaryRenameSql = tricktionaryRenameMigration?.contents || "";
const renameTricktionaryRpc = sqlFunctionBody(tricktionaryRenameSql, "rename_tricktionary_entry");
for (const parameter of ["p_athlete_id uuid", "p_trick_key text", "p_member_keys text[]", "p_display_title text", "p_category text", "p_subcategory text"]) {
  assert(renameTricktionaryRpc.includes(parameter), `Atomic rename SQL must accept ${parameter}`);
}
assert(renameTricktionaryRpc.includes("private.can_manage_tricktionary") && renameTricktionaryRpc.includes("for update"), "Atomic rename must enforce rider/linked-coach access and lock the profile metadata row");
assert(renameTricktionaryRpc.includes("update public.profiles") && renameTricktionaryRpc.includes("set tricktionary_meta"), "Atomic rename must save only the rider's canonical Tricktionary metadata");
for (const metadataMap of ["aliases", "titles", "categories", "subcategories", "hidden"]) {
  assert(renameTricktionaryRpc.includes(`'{${metadataMap}}'`) || renameTricktionaryRpc.includes(`-> '${metadataMap}'`), `Atomic rename must preserve and reconcile ${metadataMap} metadata`);
}
assert(!/(?:update|delete\s+from)\s+public\.(weekly_trick_assignments|assignment_progress|assignment_attempts|assignment_point_awards|percentage_attempts)/i.test(renameTricktionaryRpc), "Renaming a Tricktionary card must never rewrite or delete historical landings, attempts, points, or XP sources");
assert(tricktionaryRenameSql.includes("revoke all on function public.rename_tricktionary_entry") && tricktionaryRenameSql.includes("grant execute on function public.rename_tricktionary_entry"), "Atomic rename must be unavailable anonymously and executable by authenticated accounts");

const tricktionaryClassifier = new Function(`${functionBody("tricktionarySubcategory")}\nreturn tricktionarySubcategory;`)();
assert.equal(tricktionaryClassifier({ title: "Backflip 360" }, "box"), "flips", "Flip tricks take priority over spin numbers on Box, Spine, and Hip");
assert.equal(tricktionaryClassifier({ title: "360 whip" }, "spine"), "spins", "Rotation tricks belong in Spins");
assert.equal(tricktionaryClassifier({ title: "Alley-oop 360" }, "air"), "alleyoop", "Air alley-oops belong in Alleyoop even when they include a rotation");
assert.equal(tricktionaryClassifier({ title: "Ali oop flair" }, "air"), "alleyoop", "Common Ali oop spelling must still belong in Alleyoop");
assert.equal(tricktionaryClassifier({ title: "Flair 360" }, "air"), "flips", "Air Flairs belong in Flips");
assert.equal(tricktionaryClassifier({ title: "Backflip" }, "air"), "flips", "Air flip variants belong in Flips");
assert.equal(tricktionaryClassifier({ title: "540 air" }, "air"), "spins", "Air rotations belong in Spins");
assert.equal(tricktionaryClassifier({ title: "Alleyoop transfer" }, "box"), "transfers", "Box tricks containing Alleyoop must automatically belong in Transfers");
assert.equal(tricktionaryClassifier({ title: "Ali oop 360 backflip" }, "box"), "transfers", "Box Transfers must take priority over automatic spin and flip wording");
assert.equal(tricktionaryClassifier({ title: "Alleyoop 360", tricktionarySubcategory: "spins" }, "box"), "spins", "A saved rider or coach subcategory override must win over automatic Box transfer classification");
assert.equal(tricktionaryClassifier({ title: "Truck whip" }, "box"), "spins", "Box tricks containing Truck must belong in Spins");
assert.equal(tricktionaryClassifier({ title: "Truck Driver" }, "spine"), "spins", "Spine Truck Driver tricks must belong in Spins");
assert.equal(tricktionaryClassifier({ title: "truck-driver flip" }, "box"), "spins", "Truck rules must take priority over flip wording in Box and Spine");
assert.equal(tricktionaryClassifier({ title: "Truck Driver", tricktionarySubcategory: "other" }, "spine"), "other", "A rider or coach must be able to override an automatic subcategory by dragging");

const tricktionaryAggregationFactory = new Function(`
  const TRICKTIONARY_ALLOWED_CATEGORIES = new Set(["new", "box", "spine", "air", "hip"]);
  const TRICKTIONARY_CATEGORY_LABELS = { new: "New Tricks", box: "Box", spine: "Spine", air: "Air", hip: "Hip" };
  const categoryInfo = { manual: { label: "Manual add" } };
  ${functionBody("normalizeTrickKey")}
  ${functionBody("safeTricktionaryCategory")}
  ${functionBody("manualTricktionary")}
  ${functionBody("tricktionaryMeta")}
  ${functionBody("resolveTricktionaryAlias")}
  ${functionBody("tricktionaryCategoryFromText")}
  ${functionBody("landedTricktionaryEntries")}
  ${functionBody("attemptsByTrick")}
  return { landedTricktionaryEntries, attemptsByTrick, tricktionaryMeta };
`)();
const mergedFixture = {
  profile: {
    tricktionary_meta: {
      aliases: { "old backflip": "backflip", "back flip": "backflip" },
      titles: { backflip: "Backflip" },
      categories: { backflip: "box" },
      subcategories: { backflip: "spins" },
    },
    manual_tricktionary: [
      { id: "one", title: "Old Backflip", count: 4 },
      { id: "two", title: "Back Flip", count: 7 },
    ],
  },
  assignments: [], progress: [], awards: [], percentageAttempts: [],
};
const mergedEntries = tricktionaryAggregationFactory.landedTricktionaryEntries(mergedFixture);
assert.equal(mergedEntries.length, 1, "Two merged trick names must render as exactly one trick");
assert.equal(mergedEntries[0].count, 11, "Merged trick landings must sum without losing either source total");
assert.equal(mergedEntries[0].tricktionarySubcategory, "spins", "Saved Tricktionary subcategories must survive aggregation");
const staleAliasTombstoneEntries = tricktionaryAggregationFactory.landedTricktionaryEntries({
  ...mergedFixture,
  profile: { ...mergedFixture.profile, tricktionary_meta: { ...mergedFixture.profile.tricktionary_meta, hidden: { "old backflip": new Date().toISOString() } } },
});
assert.equal(staleAliasTombstoneEntries.length, 1, "A stale tombstone on one historical alias must not hide the resolved canonical card");
assert.equal(staleAliasTombstoneEntries[0].count, 11, "A stale alias tombstone must not remove only that source's landings from a merged total");
const renamedTricktionaryEntries = tricktionaryAggregationFactory.landedTricktionaryEntries({
  profile: {
    tricktionary_meta: {
      aliases: { "old alley oop": "alleyoop transfer" },
      titles: { "alleyoop transfer": "Alleyoop Transfer" },
      categories: { "alleyoop transfer": "box" },
      subcategories: { "alleyoop transfer": "transfers" },
    },
    manual_tricktionary: [{ id: "rename-history", title: "Old Alley Oop", count: 9 }],
  },
  assignments: [], progress: [], awards: [], percentageAttempts: [],
});
assert.equal(renamedTricktionaryEntries.length, 1, "Renaming a canonical Tricktionary card must not duplicate its historical entry");
assert.equal(renamedTricktionaryEntries[0].title, "Alleyoop Transfer", "Renamed Tricktionary history must display under the new canonical title");
assert.equal(renamedTricktionaryEntries[0].count, 9, "Renaming a Tricktionary card must preserve every historical landing");
assert.equal(renamedTricktionaryEntries[0].tricktionarySubcategory, "transfers", "Renaming a Tricktionary card must preserve its Box Transfers placement");
const hiddenEntries = tricktionaryAggregationFactory.landedTricktionaryEntries({
  ...mergedFixture,
  profile: { ...mergedFixture.profile, tricktionary_meta: { ...mergedFixture.profile.tricktionary_meta, hidden: { backflip: new Date().toISOString() } } },
});
assert.equal(hiddenEntries.length, 0, "A deleted Tricktionary card must disappear without changing its stored landing data");
const legacyMergedEntries = tricktionaryAggregationFactory.landedTricktionaryEntries({
  ...mergedFixture,
  profile: {
    tricktionary_meta: {},
    manual_tricktionary: [
      { id: "one", title: "Old Backflip", count: 4 },
      { id: "two", title: "Back Flip", count: 7 },
      { id: "bad-old-merge", title: "Backflip", count: 1, source: "merged", mergedFrom: ["Old Backflip", "Back Flip"] },
    ],
  },
});
assert.equal(legacyMergedEntries.length, 1, "Legacy synthetic merges must be repaired into one visible trick");
assert.equal(legacyMergedEntries[0].count, 11, "Legacy synthetic merges must not inflate the total with their fake +1 landing");
assert.equal(tricktionaryAggregationFactory.tricktionaryMeta({ tricktionary_meta: { aliases: { old: "middle", middle: "final" } } }).aliases.old, "middle", "Stored alias chains must remain available for resolution");
assert.equal(tricktionaryAggregationFactory.attemptsByTrick([{ trick_name: "Old" }, { trick_name: "Middle" }], { old: "middle", middle: "final" }, { final: "Final Trick" }).get("final").title, "Final Trick", "Merged attempts must use the canonical display name");
assert.equal(tricktionaryAggregationFactory.attemptsByTrick([{ trick_name: "Old" }, { trick_name: "Middle" }], { old: "middle", middle: "final" }, { final: "Final Trick" }).get("final").count, 2, "Merged attempt totals must combine");
const staleAliasAttemptTotals = tricktionaryAggregationFactory.attemptsByTrick(
  [{ trick_name: "Old" }, { trick_name: "Middle" }],
  { old: "final", middle: "final" },
  { final: "Final Trick" },
  { old: new Date().toISOString() },
);
assert.equal(staleAliasAttemptTotals.get("final")?.count, 2, "Attempt totals must ignore stale alias tombstones and filter only by the resolved canonical key");
assert.equal(tricktionaryAggregationFactory.attemptsByTrick([{ trick_name: "Old" }], { old: "final" }, { final: "Final Trick" }, { final: new Date().toISOString() }).size, 0, "Deleted Tricktionary cards must also disappear from the attempted-this-week summary");
assert.equal(tricktionaryAggregationFactory.attemptsByTrick([{ trick_name: "A" }, { trick_name: "B" }], { a: "b", b: "a" }).size, 1, "A legacy alias cycle must resolve deterministically to one card");
const mergedGroupEntries = tricktionaryAggregationFactory.landedTricktionaryEntries({
  profile: {
    tricktionary_meta: {
      aliases: { "a one": "group a", "a two": "group a", "b one": "group b", "b two": "group b", "group a": "final", "group b": "final" },
      titles: { final: "Final Combo" },
    },
    manual_tricktionary: [
      { id: "a1", title: "A One", count: 1 },
      { id: "a2", title: "A Two", count: 2 },
      { id: "b1", title: "B One", count: 3 },
      { id: "b2", title: "B Two", count: 4 },
    ],
  },
  assignments: [], progress: [], awards: [], percentageAttempts: [],
});
assert.equal(mergedGroupEntries.length, 1, "Merging two already-merged groups must leave one visible trick");
assert.equal(mergedGroupEntries[0].count, 10, "Merging two already-merged groups must preserve every landing");
assert(functionBody("coachManualTricktionaryPanel").includes('trick?.source === "merged"'), "Legacy fake merge markers must stay hidden from coach manual management");
assert(app.includes('parentAthleteId: ""'), "Parent screens must track the selected linked rider");
assert(functionBody("rememberParentAthleteId").includes("localStorage.setItem(parentSelectionStorageKey(), athleteId)"), "The selected child must persist per parent account");
assert(functionBody("getParentRiderContext").includes("storedParentAthleteId()"), "Every parent screen must restore the saved child selection");
for (const screen of ["renderParentHome", "renderParentWeek", "renderParentCoaching", "renderParentCalendar", "renderParentMore"]) {
  assert(functionBody(screen).includes("parentChildSwitcherHtml(context)"), `${screen} must include the shared child switcher`);
}
assert(functionBody("renderParentHome").includes("parentLatestCoachMessageHtml"), "Parent Home must prioritize the latest coach message");
assert(functionBody("renderParentHome").includes("parentNextItemHtml"), "Parent Home must show the next scheduled item");
assert(functionBody("renderParentHome").includes("parentLatestFeedbackHtml"), "Parent Home must surface the latest private feedback");
assert(functionBody("renderParentHome").includes("parentRecentActivityHtml"), "Parent Home must keep recent progress scannable");
const parentCoachingBody = functionBody("renderParentCoaching");
assert(parentCoachingBody.includes("getMyCoachMessages(20)"), "Parent Coaching must load private coach messages");
assert(parentCoachingBody.includes("getHelpRequests(context.selected.id)"), "Parent Coaching must load the selected rider's video feedback");
assert(!parentCoachingBody.includes("getCrewFeed"), "Parent Coaching must not include the public crew feed");
const parentCalendarBody = functionBody("renderParentCalendar");
assert(parentCalendarBody.includes("getDashboardItems(context.selected.id)"), "Parent Calendar must retain rider events and tasks");
assert(parentCalendarBody.includes('.from("training_sessions")'), "Parent Calendar must retain session history");
const parentMoreBody = functionBody("renderParentMore");
for (const source of ["getTricktionaryData", "getRunPlans", "getXpSummary", "getPushNotificationState"]) {
  assert(parentMoreBody.includes(source), `Parent More must retain ${source}`);
}
assert(app.includes('id="notification-centre-bell"'), "Every shell, including Parent, must include the shared notification bell");
assert(functionBody("showParentNotificationDrawer").includes("getMyCoachMessages(10)"), "Parent notification drawer must use existing coach-message data");
assert(functionBody("showParentNotificationDrawer").includes("getHelpRequests(context.selected.id)"), "Parent notification drawer must include returned video feedback");
assert(functionBody("showParentNotificationDrawer").includes("getDashboardItems(context.selected.id)"), "Parent notification drawer must include calendar updates");

const viewerTabs = app.match(/const sessionViewerListTabs = \[([\s\S]*?)\];/)?.[1] || "";
for (const tab of ["daily", "one_bang", "dialled", "lines", "percentage", "foam_pit", "bonus"]) {
  assert(viewerTabs.includes(`id: "${tab}"`), `Session Viewer is missing ${tab}`);
}
assert(viewerTabs.indexOf('id: "lines"') < viewerTabs.indexOf('id: "percentage"'), "Session Viewer must place Lines before Percentage Tricks");
assert(!/goals|contest_run/.test(viewerTabs), "Session Viewer should not expose Goals or Contest Run tabs");
assert(functionBody("sessionViewerPlanList").includes("viewer-list-tone-${tab.id}"), "Coach Session tabs must carry the rider category colours");

assert(
  app.includes('const shellClass = isCoachRole(role) ? "coach-shell" : role === "athlete" ? "rider-shell" : "parent-shell";'),
  "Each account experience must expose its own visual-system scope",
);
assert(app.includes('class="app-shell ${shellClass}"'), "The app shell must apply the scoped account experience");
for (const tone of ["aqua", "purple", "blue", "coral", "gold"]) {
  assert(css.includes(`--coach-${tone}:`), `Coach palette is missing ${tone}`);
  assert(css.includes(`.coach-shell .coach-tone-${tone}`), `Coach semantic class is missing ${tone}`);
}
assert(css.includes(".coach-shell .group-session-control"), "Coach Session Viewer should use the coach visual system");
assert(css.includes(".coach-shell .coach-hub-card"), "Coach tool cards should use the coach visual system");
assert(css.includes("--metric-ring-size: 72px"), "Coach dashboard metric values should share a fixed ring cell");
assert(css.includes("place-items: center"), "Coach circular controls should center their contents");

const planLoader = functionBody("getSessionViewerPlanData");
assert(!planLoader.includes('.from("run_plans")'), "Session Viewer should not fetch run plans");
assert(!planLoader.includes('.from("run_checklist_progress")'), "Session Viewer should not fetch run progress");
assert(planLoader.includes("cacheGet(cacheKey, 12000)"), "Session Viewer plan data should be short-term cached");
assert(planLoader.includes('rpc("get_coach_session_viewer_plan_data"'), "Session Viewer should use the combined bounded plan read");
assert(!planLoader.includes('.from("assignment_progress")'), "Session Viewer progress should not need another database round trip");

const sessionViewerRoster = functionBody("getSessionViewerRoster");
assert(sessionViewerRoster.includes('select("id,display_name,avatar,country_code")'), "Session Viewer should load compact rider profiles");
assert(!sessionViewerRoster.includes('.from("training_sessions")'), "Session Viewer roster should not load session history");

const activeGroupSession = functionBody("getActiveCoachGroupSession");
assert(!activeGroupSession.includes("coach_group_session_participants(id,"), "Session Viewer must not request a nonexistent participant id");
assert(!activeGroupSession.includes("daily_finish_seconds,created_at"), "Session Viewer must not request a nonexistent participant created_at");
assert(activeGroupSession.includes("training_session_id,joined_at"), "Session Viewer should request the participant table's real identity fields");

const sessionViewerRender = functionBody("renderSessionViewer");
assert(sessionViewerRender.includes("Promise.all(["), "Session Viewer should load roster and active session in parallel");
assert(sessionViewerRender.indexOf("document.querySelector(\"#view\").innerHTML") < sessionViewerRender.indexOf("refreshParkKingCard("), "Park King must not block the Session Viewer render");

const sessionViewerMigration = read("supabase/migrations/202607190345_combine_session_viewer_plan_reads.sql");
assert(sessionViewerMigration.includes("security definer"), "Combined Session Viewer read must enforce coach authorization");
assert(sessionViewerMigration.includes("from anon"), "Anonymous users must not execute the coach Session Viewer read");
assert(sessionViewerMigration.includes("not sources.has_current_daily"), "Missing current Daily lists should use the bounded visibility fallback");
assert(sessionViewerMigration.includes("assignment.category = 'daily'"), "Fallback must remain Daily-only to protect weekly point logic");

const latestDailyMigration = read("supabase/migrations/20260827021408_restore_latest_daily_lists_by_location.sql");
assert(latestDailyMigration.includes("get_effective_weekly_assignments"), "Riders need a protected effective weekly-plan read");
assert(latestDailyMigration.includes("weekly_trick_assignments_latest_daily_location_idx"), "Latest Daily location lookups need a supporting partial index");
assert(latestDailyMigration.includes("private.jkcrew_venue_key(assignment.venue)"), "Database lookups must use the canonical location identity");
assert(latestDailyMigration.includes("assignment.week_start <= allowed.requested_week_start"), "Daily location history must exclude future sheets");
assert(latestDailyMigration.includes("assignment.category <> 'daily'"), "Only current-week non-Daily categories may be returned");
assert(latestDailyMigration.includes("assignment.category = 'daily'"), "Latest-location fallback must remain Daily-only");
assert(!latestDailyMigration.includes("56 days"), "Saved Daily locations must not disappear because of an age cutoff");
assert(latestDailyMigration.includes("from public, anon"), "Anonymous users must not execute the effective rider or coach reads");
assert(functionBody("sessionViewerVenueOptions").includes("venueIdentityKey"), "Coach location filters must canonicalize saved venue names");
assert(functionBody("sessionViewerVenueTabs").includes("venueIdentityKey(option.value)"), "Coach location tabs must retain their canonical active location");

const plannerLinesConstraintMigration = read("supabase/migrations/20260827071737_allow_lines_in_weekly_assignment_plans.sql");
assert(
  plannerLinesConstraintMigration.includes("'lines'"),
  "Complete sheet saves must be able to archive the Lines category",
);
assert(
  plannerLinesConstraintMigration.includes("weekly_assignment_plans_category_check"),
  "The planner category constraint must be replaced explicitly",
);

const percentageContractMigration = read("supabase/migrations/202607190400_fix_percentage_and_session_viewer_contracts.sql");
assert(percentageContractMigration.includes("returns jsonb"), "Percentage venue wrapper must match the canonical JSON result");
assert(!percentageContractMigration.includes("returns table"), "Percentage venue wrapper must not declare the obsolete table result");

for (const name of [
  "recordViewerAssignmentAction",
  "recordViewerAssignmentAttempt",
  "recordViewerPercentageAttempt",
  "saveSessionViewerAssignments",
  "startViewerGroupSession",
  "addExtraRiderToGroupSession",
  "toggleViewerGroupSessionPause",
  "endViewerGroupSession",
  "finishViewerDailyTimer",
]) {
  const body = functionBody(name);
  assert(body.includes("withTimeout("), `${name} must protect network requests with a timeout`);
  assert(body.includes("finally"), `${name} must restore its busy state in finally`);
}
assert(functionBody("saveSessionViewerAssignments").includes("weekStartDateForCountry"), "Coach edits must use the rider's local week");

const battleMigration = read("supabase/migrations/20260827010000_release_all_users_battles_and_challenges.sql");
const battleContractMigration = read("supabase/migrations/20260827013000_finish_battle_release_contracts.sql");
assert(!battleMigration.includes("Riley Chen test account only"), "The production battle RPC must not retain the Riley-only guard");
assert(battleMigration.includes("weekly_rider_battle_participants"), "Team battles need normalized participant records");
assert(battleMigration.includes("battle_size between 1 and 3"), "Battle formats must be limited to 1v1, 2v2 and 3v3");
assert(battleMigration.includes("response = 'pending'"), "All selected riders must accept before a team battle starts");
assert(battleMigration.includes("maximum of 3 active battles"), "The three-active-battle limit must remain enforced in the database");
assert(battleMigration.includes("row level security"), "New battle and challenge tables must enable RLS");
assert(battleMigration.includes("'display_name', profile.display_name"), "Battle RPCs must return each participant's display name");
assert(battleMigration.includes("'avatar', profile.avatar"), "Battle RPCs must return each participant's profile picture");
assert(battleContractMigration.includes("'one_bang'"), "Weekly challenges must use the original One Bang category key");
assert(battleContractMigration.includes("'foam_pit'"), "Weekly challenges must use the original Foam Pit category key");
assert(perfectionistChallengeMigration.includes("'THE PERFECTIONIST'"), "The next weekly challenge must be THE PERFECTIONIST");
assert(perfectionistChallengeMigration.includes("'percentage_perfect'"), "The Perfectionist needs its own exact completion rule");
assert(perfectionistChallengeMigration.includes("having count(*) = 10"), "Each Perfectionist trick must contain all 10 Percentage attempts");
assert(perfectionistChallengeMigration.includes("bool_and(attempt.landed)"), "Every Percentage attempt must be landed for Perfectionist progress");
assert(perfectionistChallengeMigration.includes("group by assignment.week_start"), "Perfectionist progress must come from one weekly sheet");
assert(perfectionistChallengeMigration.includes("v_challenge.reward_points"), "Weekly challenge awards must use their configured reward");
assert(perfectionistChallengeMigration.includes("current_challenge.ends_at"), "The queued challenge must begin when the current challenge ends");
assert(perfectionistChallengeMigration.includes("'scheduled'"), "The Perfectionist must be queued rather than replacing the live challenge");
assert(perfectionistChallengeMigration.includes("private.activate_due_weekly_challenges"), "Queued challenges need an automatic activation path");
assert(perfectionistChallengeMigration.includes("after insert or update of status"), "Activating a queued challenge must send its rider notification");
assert(perfectionistChallengeMigration.includes("coalesce(v_challenge.reward_points, 5)::text"), "Completion notifications must show the configured reward");
const riderChallengeView = functionBody("renderChallenges");
assert(riderChallengeView.includes("weeklyChallenge?.reward_points || 5"), "The rider challenge card must display its configured reward");
assert(riderChallengeView.includes('weeklyChallenge?.completion_rule === "percentage_perfect"'), "The rider card must explain the Perfectionist rule");
assert(riderChallengeView.includes("Land all 10 attempts"), "The Perfectionist card must clearly explain 10/10 scoring");
assert(riderChallengeView.includes("+${challengeReward} leaderboard points"), "The completion popup must use the challenge reward instead of a hard-coded five");
assert(functionBody("battleRulesMarkup").includes("1v1, 2v2 or 3v3"), "Rider battle help must explain every team format");
const battleLoader = functionBody("getWeeklyRiderBattles");
assert(battleLoader.includes('rpc("get_my_rider_battles")'), "Battle identities must load through the limited participant RPC");
assert(!battleLoader.includes('challenger:profiles'), "Battle loading must not rely on profile joins hidden by rider RLS");
const battleFirstName = new Function(`${functionBody("battleParticipantFirstName")}; return battleParticipantFirstName;`)();
assert.equal(battleFirstName({ display_name: "Riley Chen" }), "Riley", "Battle cards should show riders' first names");
assert.equal(battleFirstName({ display_name: "Lars Kindermann" }), "Lars", "Opponent cards should show the opponent's first name");
assert.equal(battleFirstName({}), "Rider", "Missing identities need a safe fallback");
const battleIdentity = new Function("avatarUrl", `${functionBody("battleParticipantIdentity")}; return battleParticipantIdentity;`)((profile = {}) => profile.avatar?.dataUrl || "");
const larsAvatar = { dataUrl: "data:image/jpeg;base64,lars" };
assert.deepEqual(
  battleIdentity({ athlete_id: "lars" }, { athlete_id: "lars", display_name: "Lars Kindermann", avatar: larsAvatar }),
  { athlete_id: "lars", display_name: "Lars Kindermann", avatar: larsAvatar },
  "Battle cards should recover a missing RPC identity from the leaderboard",
);
assert.equal(battleIdentity({ athlete_id: "riley", display_name: "Riley Chen", avatar: {} }, {}).display_name, "Riley Chen", "Riders without a photo must keep their real name");
assert(functionBody("battleTeamHtml").includes("battleParticipantFirstName(participant)"), "Battle teams must render first names instead of generic labels");
assert(functionBody("battleTeamHtml").includes('avatarHtml(participant, "avatar")'), "Battle teams must render each participant's profile picture or initials fallback");
assert(functionBody("battleTeamHtml").includes("participant.battle_points ?? participant.weekly_points"), "Rider battle cards must use battle-window points instead of reset weekly points");
assert(functionBody("coachBattleTeamHtml").includes("participant.battle_points ?? participant.weekly_points"), "Coach battle cards must use battle-window points instead of reset weekly points");
assert(battleScoreMigration.includes("private.jkcrew_rider_battle_points"), "Battle scoring must use a private battle-window points helper");
assert(battleScoreMigration.includes("'battle_points', private.jkcrew_rider_battle_points"), "Battle RPCs must expose battle-window points to the app");
assert(battleScoreMigration.includes("sum(private.jkcrew_rider_battle_points"), "Battle settlement must decide winners from the full battle window");
assert(functionBody("weeklyBattleCardHtml").includes("battleParticipantFirstName(rivals[0])"), "Head-to-head copy must name the opposing rider");
assert(functionBody("renderChallenges").includes("hydrateRiderBattleIdentities(rawBattles, leaderboard)"), "Challenge cards must hydrate any missing participant identity safely");
const battleSelectionSizer = new Function(`${functionBody("riderBattleSelectionSize")}; return riderBattleSelectionSize;`)();
assert.equal(battleSelectionSizer(1, 0, 0), 1, "An empty rider battle should remain 1v1");
assert.equal(battleSelectionSizer(1, 1, 1), 2, "Adding one teammate should automatically grow the battle to 2v2");
assert.equal(battleSelectionSizer(1, 0, 2), 2, "Selecting two opponents should automatically grow the battle to 2v2");
assert.equal(battleSelectionSizer(1, 0, 3), 3, "Selecting three opponents should automatically grow the battle to 3v3");
assert.equal(battleSelectionSizer(1, 2, 3), 3, "Selecting two teammates and three opponents should grow the battle to 3v3");
assert.equal(battleSelectionSizer(3, 0, 1), 3, "An explicitly selected 3v3 format should remain selected while riders are added");
assert.equal(battleSelectionSizer(1, 99, 99), 3, "The battle format must remain capped at 3v3");
const riderBattlePicker = functionBody("updateRiderBattlePicker");
assert(riderBattlePicker.includes("opponentChecked.length >= 3"), "Riders must be able to select up to three opponents");
assert(riderBattlePicker.includes("teammateChecked.length >= 2"), "Riders must be able to select up to two teammates alongside themselves");
assert(!riderBattlePicker.includes("opponentChecked.length >= size"), "The current format must not block adding another opponent");
assert(!riderBattlePicker.includes("teammateTarget === 0"), "The initial 1v1 format must not block adding a teammate");
assert(riderBattlePicker.includes("sizeSelect.value = String(size)"), "Adding riders should automatically update the battle format");
assert(riderBattlePicker.includes("duplicate.checked = false"), "A rider selected for one team must be removed from the other team");
assert(riderBattlePicker.includes("teammateChecked.length === teammateTarget && opponentChecked.length === size"), "A battle request must require two complete equal teams");
assert(functionBody("renderChallenges").includes('addEventListener("input", updateRiderBattlePicker)'), "Mobile battle-format changes must update immediately");
const makeBattleCheckbox = (name, value) => ({ name, value, checked: false, disabled: false, matches: (selector) => selector === 'input[type="checkbox"]' });
const teammateInputs = [makeBattleCheckbox("teammateIds", "opponent-1"), makeBattleCheckbox("teammateIds", "teammate-1"), makeBattleCheckbox("teammateIds", "teammate-2"), makeBattleCheckbox("teammateIds", "teammate-3")];
const opponentInputs = [makeBattleCheckbox("opponentIds", "opponent-1"), makeBattleCheckbox("opponentIds", "opponent-2"), makeBattleCheckbox("opponentIds", "opponent-3"), makeBattleCheckbox("opponentIds", "opponent-4")];
const battleSizeControl = { name: "battleSize", value: "1" };
const teammateHelp = { textContent: "" };
const opponentHelp = { textContent: "" };
const sendBattleButton = { disabled: false, textContent: "" };
const battlePickerForm = {
  querySelector: (selector) => selector === '[name="battleSize"]' ? battleSizeControl : selector === "#send-rider-battle" ? sendBattleButton : null,
  querySelectorAll: (selector) => selector === '[name="teammateIds"]' ? teammateInputs : selector === '[name="opponentIds"]' ? opponentInputs : [],
};
const battlePickerDocument = { querySelector: (selector) => selector === "#battle-request-form" ? battlePickerForm : selector === "#teammate-count-help" ? teammateHelp : selector === "#opponent-count-help" ? opponentHelp : null };
const updateBattlePicker = new Function("document", `${functionBody("riderBattleSelectionSize")}\n${functionBody("updateRiderBattlePicker")}; return updateRiderBattlePicker;`)(battlePickerDocument);
updateBattlePicker();
assert(opponentInputs.every((input) => !input.disabled), "The initial 1v1 picker must leave extra opponents selectable");
opponentInputs[0].checked = true; updateBattlePicker({ target: opponentInputs[0] });
assert.equal(battleSizeControl.value, "1", "One selected opponent should remain 1v1");
assert.equal(opponentInputs[1].disabled, false, "A second opponent must remain selectable after the first");
opponentInputs[1].checked = true; updateBattlePicker({ target: opponentInputs[1] });
assert.equal(battleSizeControl.value, "2", "A second opponent must promote the picker to 2v2");
opponentInputs[2].checked = true; updateBattlePicker({ target: opponentInputs[2] });
assert.equal(battleSizeControl.value, "3", "A third opponent must promote the picker to 3v3");
assert.equal(opponentInputs[3].disabled, true, "The picker must stop at three selected opponents");
assert.equal(teammateInputs[0].disabled, true, "A selected opponent cannot also be chosen as a teammate");
teammateInputs[1].checked = true; updateBattlePicker({ target: teammateInputs[1] });
teammateInputs[2].checked = true; updateBattlePicker({ target: teammateInputs[2] });
assert.equal(teammateInputs[3].disabled, true, "The picker must stop at two selected teammates plus the current rider");
assert.equal(sendBattleButton.disabled, false, "A complete 3v3 selection must enable the battle request");
assert.equal(sendBattleButton.textContent, "Send 3v3 battle request", "The ready action must show the selected battle format");
const riderBattleRequest = functionBody("requestWeeklyRiderBattle");
assert(riderBattleRequest.includes("p_team_one: [state.user.id, ...teammateIds]"), "Rider battle requests must send the complete home team array");
assert(riderBattleRequest.includes("p_team_two: opponentIds"), "Rider battle requests must send every selected opponent");
assert(riderBattleRequest.includes('rpc("request_rider_battle_v2"'), "Riders must use the battle RPC that accepts a chosen point value");
assert(riderBattleRequest.includes("p_reward_points: rewardPoints"), "Rider battle requests must send the chosen point value");
assert(functionBody("showCoachBattleBuilder").includes('name="rewardPoints"'), "The coach battle builder must include a point selector");
assert(functionBody("showCoachBattleBuilder").includes('rpc("request_rider_battle_v2"'), "Coach-created battles must use the variable-point RPC");
assert(functionBody("weeklyBattleCardHtml").includes("battle.reward_points || 5"), "Rider battle cards must show the stored point value with a legacy fallback");
assert(functionBody("coachBattleCardHtml").includes("battle.reward_points || 5"), "Coach battle cards must show the stored point value with a legacy fallback");
assert(battlePointsMigration.includes("reward_points between 1 and 20"), "The database must restrict battle stakes to 1–20 points");
assert(battlePointsMigration.includes("p_reward_points integer default 5"), "Older clients must keep the five-point battle default");
assert(battlePointsMigration.includes("coalesce(p_reward_points, 0) not between 1 and 20"), "The battle RPC must validate point values server-side");
assert(battlePointsMigration.includes("reward_points, created_by"), "The chosen battle value must be persisted on the battle record");
assert(battleMigration.includes("cardinality(p_team_two) <> v_size"), "The database must enforce equal battle teams");
assert(battleMigration.includes("count(distinct chosen.rider_id)"), "The database must prevent duplicate riders across teams");
assert(battleMigration.includes("unnest(p_team_one)"), "The database must save every home-team rider");
assert(battleMigration.includes("unnest(p_team_two)"), "The database must save every opposing rider");
assert(functionBody("renderCoachBattleViewer").includes("coach-create-battle"), "Coach battle oversight needs a create-battle action");
assert(functionBody("renderCoachBattleViewer").includes("coach-create-weekly-challenge"), "Coaches need a weekly challenge builder");
const coachBattleViewerBody = functionBody("renderCoachBattleViewer");
assert(coachBattleViewerBody.includes("Battle <span>HQ</span>"), "Coach Challenges must use the approved Battle HQ hero");
assert(coachBattleViewerBody.includes("battle-hq-metrics"), "Battle HQ must expose live operational metrics");
assert(coachBattleViewerBody.includes("data-battle-hq-filter"), "Battle HQ must provide live status filters");
assert(coachBattleViewerBody.includes("battle-hq-search"), "Battle HQ must provide rider search");
assert(coachBattleViewerBody.includes("applyBattleFilters"), "Battle HQ filters and rider search must update the rendered cards");
assert(functionBody("coachBattleCardHtml").includes("data-battle-hq-riders"), "Battle cards must expose searchable rider names");
assert(css.includes(".battle-hq-hero") && css.includes(".battle-hq-metrics"), "Battle HQ must ship its approved neon hero and metric styling");
assert(css.includes(".battle-hq-section.tone-aqua") && css.includes(".battle-hq-section.tone-gold") && css.includes(".battle-hq-section.tone-violet"), "Battle HQ sections must use distinct live, waiting and finished colour treatments");
assert(riderChallengeView.includes("rider-challenges-head") && riderChallengeView.includes("rider-battle-arena"), "Student Challenges must use the colourful redesign surfaces");
assert(css.includes(".rider-challenges-head") && css.includes(".rider-battle-arena .battle-card.completed"), "Student Challenges must ship distinct hero, challenge and battle colours");
assert(functionBody("weeklyBattleCardHtml").includes("data-forfeit-battle"), "Live rider battles need a forfeit action");
assert(functionBody("forfeitWeeklyRiderBattle").includes('rpc("forfeit_rider_battle"'), "Rider forfeits must use the protected database RPC");
assert(functionBody("coachBattleCardHtml").includes("data-delete-coach-battle"), "Every coach battle card needs a delete action");
assert(functionBody("coachBattleCardHtml").includes('<details class="coach-battle-view-card'), "Each coach battle must render as a dropdown");
assert(functionBody("coachBattleCardHtml").includes('class="coach-battle-card-summary"'), "Closed battle rows must show a compact summary");
assert(!functionBody("coachBattleCardHtml").includes('<details open'), "Coach battle dropdowns must be closed by default");
assert(functionBody("coachBattleCardHtml").includes("teamOneScore") && functionBody("coachBattleCardHtml").includes("teamTwoScore"), "Closed battle rows must show the current score");
assert(functionBody("deleteCoachBattle").includes('rpc("delete_rider_battle"'), "Coach battle deletion must use the protected database RPC");
assert(functionBody("respondCoachRiderBattle").includes('rpc("coach_respond_rider_battle"'), "Coaches need a protected accept-on-behalf action");
assert(functionBody("setCoachBattleArchived").includes('rpc("set_rider_battle_archived"'), "Coaches need a protected battle archive action");
assert(functionBody("renderCoachBattleViewer").includes("coachArchivedBattleSection(archived)"), "Archived battles need a separate coach section");
assert(coachBattleControlMigration.includes("You can only respond for riders in your crew"), "Coach responses must be limited to linked riders");
assert(coachBattleControlMigration.includes("Only finished battles can be archived"), "Live and pending battles must not be archived");
assert(coachBattleControlMigration.includes("archived_at"), "Battle archives must preserve finished records instead of deleting them");
assert(!coachBattleControlMigration.includes("delete from public.leaderboard_point_adjustments"), "Archiving must never reverse battle points");
const battleControlMigration = read("supabase/migrations/20260827053000_daily_cleanup_and_battle_controls.sql");
assert(battleControlMigration.includes("private.retired_daily_assignment_backups"), "Removed duplicate Daily assignments need a private recovery archive");
assert(battleControlMigration.includes("lower(trim(assignment.venue)) in ('hotbox', 'default daily list')"), "Daily cleanup must target only the two exact duplicate location names");
assert(!battleControlMigration.includes("hotbox - aus national training facility')\n+on conflict"), "Daily cleanup must never select the Aus National Training Facility list");
assert(battleControlMigration.includes("create or replace function public.forfeit_rider_battle"), "Database must support rider forfeits");
assert(battleControlMigration.includes("create or replace function public.delete_rider_battle"), "Database must support coach battle deletion");
assert(battleControlMigration.includes("delete from public.leaderboard_point_adjustments"), "Deleting a completed battle must reverse its point transfer");
const retiredVenueMigration = read("supabase/migrations/20260827054000_retire_duplicate_coach_venues.sql");
assert(retiredVenueMigration.includes("private.retired_coach_venue_backups"), "Removed coach location buttons need a private recovery archive");
assert(retiredVenueMigration.includes("lower(trim(venue.name)) in ('hotbox', 'default daily list')"), "Coach location cleanup must target only the exact duplicate menu entries");
assert(functionBody("renderStudentProfile").includes("Edit current list"), "Coach rider profiles need a prominent current-list action");
assert(functionBody("renderStudentProfile").includes("Schedule next week's list"), "Coach rider profiles need a prominent next-week planner action");
assert(functionBody("renderStudentProfile").includes("compactStudentProfilePanels(view)"), "Coach rider profile tools should be collapsed into clean sections");
assert(functionBody("renderStudentProfile").includes("riderProfileSelectorHtml"), "Rider Profiles must open through a rider dropdown");
for (const removedProfileSection of ["XP history", "Point history", "Completion history", "Injury reports", "Waivers, forms & documents", "Private rider records", "parentUpdatePanel", "extraTricksSection"]) {
  assert(!functionBody("renderStudentProfile").includes(removedProfileSection), `Rider Profiles must remove ${removedProfileSection}`);
}
const coachCommandRender = functionBody("renderCoachCommand");
for (const commandMetric of ["Videos to Reply", "New Event Runs", "Active Battles"]) {
  assert(coachCommandRender.includes(commandMetric), `Coach Command is missing ${commandMetric}`);
}
assert(functionBody("getCoachCommandData").includes('from("trick_help_requests")'), "Coach Command must count unanswered Coach Help videos");
assert(functionBody("getCoachCommandData").includes('from("run_plans")'), "Coach Command must count event run plans");
assert(functionBody("getCoachCommandData").includes('get_coach_rider_battles_v2'), "Coach Command must count live battles");
const coachToolsRender = functionBody("renderCoachTools");
assert(coachToolsRender.includes("Sheet Scheduler"), "Coach Tools must rename Planner to Sheet Scheduler");
assert(!coachToolsRender.includes("command-section-heading"), "Coach Tools must remove the duplicate numbered shortcut section");
const sessionViewerBindings = functionBody("bindSessionViewerActions");
const sessionViewerGroupFilters = functionBody("sessionViewerGroupTabs");
const sessionViewerVenueFilters = functionBody("sessionViewerVenueTabs");
assert(sessionViewerRender.includes("viewer-group-tabs"), "Coach Session must use group filter tabs");
assert(sessionViewerRender.includes("viewer-venue-tabs"), "Coach Session must use location filter tabs");
assert(sessionViewerRender.includes("sessionViewerGroupTabs(started)"), "Coach Session must lock group filters with an active session");
assert(!sessionViewerRender.includes('<select id="viewer-group"'), "Coach Session must not fall back to a group dropdown");
assert(sessionViewerBindings.includes('querySelectorAll("[data-viewer-group]")'), "Coach Session must bind every group filter tab");
assert(sessionViewerBindings.includes("dataset.viewerGroup"), "Coach Session group tabs must update the selected group");
assert(sessionViewerGroupFilters.includes("viewer-filter-tab viewer-group-tab"), "Group filters must share the location filter styling");
assert(sessionViewerGroupFilters.includes("aria-pressed"), "Group filters must expose their selected state");
assert(sessionViewerVenueFilters.includes("viewer-filter-tab viewer-venue-tab"), "Location filters must use the shared filter styling");
assert(sessionViewerVenueFilters.includes("aria-pressed"), "Location filters must expose their selected state");
assert(css.includes(".viewer-group-filter,"), "Group and location filters must share the full-width layout");
assert(css.includes(".viewer-filter-tabs"), "Group and location filters must share a tab row");
assert(css.includes("overflow-x: auto"), "Session filter tabs must stay usable on narrow screens");
assert(functionBody("renderSessionViewer").includes("session-create-battle"), "Coach Session must create battles for the selected group");
assert(functionBody("renderSessionViewer").includes("sessionGroupBattlesHtml(groupBattles"), "Coach Session must show the compact group battle tab at the bottom");
const sessionGroupBattlesMarkup = functionBody("sessionGroupBattlesHtml");
assert(sessionGroupBattlesMarkup.includes('<details class="panel session-group-battles'), "Coach Session battles must stay minimised until the coach opens them");
assert(!sessionGroupBattlesMarkup.includes('<details open'), "Coach Session battles must be closed by default");
assert(sessionGroupBattlesMarkup.includes("session-battle-stats"), "Opening the coach Session battle tab must reveal live, waiting and rider statistics");
assert(sessionGroupBattlesMarkup.includes("battles.map(coachBattleCardHtml)"), "Opening the coach Session battle tab must reveal the full battle cards");
assert(sessionGroupBattlesMarkup.includes('id="session-create-battle"'), "The expanded group battle tab must retain the create-battle action");
assert(css.includes(".session-group-battles-summary"), "The compact coach Session battle tab needs dedicated styling");
assert(!functionBody("sessionViewerListContent").includes("data-viewer-assignment-attempt"), "Coach Session trick rows should remain one-tap without Attempt buttons");
const contestsRenderer = functionBody("renderContests");
assert(contestsRenderer.includes("getSharedUpcomingEventData()"), "Events & Runs must load the shared upcoming-event catalogue");
assert(contestsRenderer.includes("+ NEW PRIVATE RUN"), "Athlete Events & Runs must expose a clear private Run Builder action");
assert(contestsRenderer.includes("contestEventCardsHtml(events, runs, attendance, roster, viewOptions)"), "Events & Runs must render shared attendance, role-appropriate controls and private saved-run links");
assert(contestsRenderer.includes("runBuilderPanel([], { live: true, showRunList: false })"), "The live Run Builder must open inline without duplicating the saved-run library");
assert(contestsRenderer.includes("runPlansHtml(runs)"), "Athlete Contests must retain every saved run plan");
assert(!contestsRenderer.includes("runBuilderPanel(runs, { collapsed: true })"), "The released Run Builder must not remain buried in the old collapsed panel");
assert(!contestsRenderer.includes("contest-command"), "Events & Runs must not restore the old oversized Run Builder card");
assert(contestsRenderer.includes("Your private run plans"), "Saved run plans must sit in a clearly private section");
assert(contestsRenderer.includes("athlete-event-palette"), "Coach Events must use the rider Events colour system");
assert(contestsRenderer.includes("getCoachContestRunPlans"), "Coach Events must load linked riders' event runs through private run-plan RLS");
const contestCardsBody = functionBody("contestEventCardsHtml");
assert(contestCardsBody.includes("data-open-contest-event"), "Each event must open its attendee details");
assert(contestCardsBody.includes("data-toggle-contest-attendance"), "Riders must be able to join an existing shared event");
assert(contestCardsBody.includes("BUILD PRIVATE RUN"), "Each upcoming event must launch a private run plan");
assert(contestCardsBody.includes("contestEventFacesHtml(attendees)"), "Event cards must show who is attending at a glance");
assert(contestCardsBody.includes('draggable="true"'), "Coach event cards must support drag-to-merge");
assert(contestCardsBody.includes("data-select-event-merge"), "Touch devices need a two-tap event merge fallback");
assert(contestCardsBody.includes("data-toggle-coach-event-attendance"), "Coaches must be able to mark whether they are attending from the event card");
assert(contestCardsBody.includes("contest-event-actions contest-event-coach-actions"), "Coach event controls must inherit the rider event-card layout");
assert(contestCardsBody.includes("MANAGE EVENT"), "Coach event cards must expose event and rider attendance management");
assert(contestCardsBody.includes("viewerAthleteId"), "Parent event cards must calculate attendance for the selected child");
assert(contestCardsBody.includes("parentView"), "The shared event cards must support the read-only parent presentation");
const contestModalBody = functionBody("contestEventModalHtml");
assert(contestModalBody.includes("Who's going"), "Opening an event must show the attendee list");
assert(contestModalBody.includes("row.profile?.display_name"), "The attendee list must show rider names");
assert(contestModalBody.includes("contestEventCourseHtml(item, viewOptions)"), "Opening an event must show its shared course-photo control");
assert(contestModalBody.includes("Other riders cannot see your route, tricks, notes or private run photo"), "The event modal must explain run-plan privacy");
assert(contestModalBody.includes("coachEventAttendanceEditorHtml"), "The coach event modal must render the shared attendance editor");
assert(contestModalBody.includes("coachContestEventEditorHtml"), "The coach event modal must allow corrections to the shared event details");
assert(contestModalBody.includes("coachEventAttendeeRunActionHtml"), "Each linked rider attending an event must have a private run action");
assert(contestModalBody.includes('" · Your child"'), "Parent event details must identify their selected child");
assert(contestModalBody.includes("Rider routes, numbered dots, trick notes and private run photos are never shown"), "The parent event modal must preserve private run-plan boundaries");
assert(functionBody("coachEventAttendeeRunActionHtml").includes("VIEW RIDER'S RUN"), "An existing rider run must show View Rider's Run");
assert(functionBody("coachEventAttendeeRunActionHtml").includes("CREATE RUN"), "A rider without a plan must show Create Run");
assert(functionBody("openCoachEventRunModal").includes("bindRunPlaybackControls"), "Coach event run viewing must include the saved playback controls");
assert(functionBody("saveCoachContestEventEdit").includes('rpc("coach_update_contest_event"'), "Coach event edits must use the audited database endpoint");
assert(functionBody("saveCoachEventAttendance").includes("replaceCoachContestAttendance"), "Coach attendance saves must use the shared atomic attendance helper");
assert(functionBody("replaceCoachContestAttendance").includes('rpc("coach_replace_event_attendance"'), "Coach attendance changes must use one atomic database operation");
assert(coachAttendanceMigration.includes("security definer"), "Coach attendance updates must use a narrowly-authorized database operation");
assert(coachAttendanceMigration.includes("public.coach_athletes"), "A coach must only manage riders linked to their crew");
assert(coachAttendanceMigration.includes("private.event_attendance_audit"), "Coach event attendance edits need a private recovery audit");
assert(coachAttendanceMigration.includes("revoke all on function public.coach_replace_event_attendance(uuid, uuid[]) from public, anon"), "Anonymous users must not call the coach attendance endpoint");
assert(coachEventEditMigration.includes("private.event_edit_audit"), "Coach event corrections need a private recovery audit");
assert(coachEventEditMigration.includes("security invoker"), "The public event-edit endpoint must not itself bypass RLS");
assert(coachEventEditMigration.includes("You can only edit events created by riders in your crew"), "A coach must only correct events belonging to their crew");
assert(coachEventEditMigration.includes("link.athlete_id = run_plans.athlete_id"), "Coach run-plan writes must be restricted to linked riders");
assert(coachEventEditMigration.includes("revoke all on function public.coach_update_contest_event"), "Anonymous users must not call the event-edit endpoint");
const sharedEventSaveBody = functionBody("saveSharedContestEvent");
assert(sharedEventSaveBody.includes("normalizeContestEventTitle(item.title)"), "Creating an event must first reuse a matching shared event");
assert(sharedEventSaveBody.includes("contestEventDay(item.due_at)"), "Shared event matching must include its start day");
assert(sharedEventSaveBody.includes("setContestAttendance(sharedEvent.id, true)"), "The event creator must automatically be marked as attending");
assert(functionBody("toggleContestAttendance").includes("setContestAttendance"), "Attendance controls must update the shared attendee table");
assert(functionBody("bindCoachContestMergeActions").includes('addEventListener("drop"'), "Coach event cards must accept dragged duplicate events");
assert(functionBody("bindCoachContestMergeActions").includes("openContestMergeModal(source, target, attendance)"), "Dropping an event must open the merge review instead of changing data immediately");
assert(functionBody("contestMergeModalHtml").includes("Final event name"), "The coach must be able to edit the merged event name");
assert(functionBody("contestMergeModalHtml").includes("unique rider"), "The merge review must show the combined attendee count");
assert(functionBody("saveMergedContestEvent").includes('rpc("merge_contest_events"'), "Saving a merge must use the atomic database operation");
assert(mergeEventMigration.includes("insert into public.event_attendees"), "Event merges must combine attendee records");
assert(mergeEventMigration.includes("on conflict (event_id, athlete_id) do nothing"), "Event merges must deduplicate riders attending both events");
assert(mergeEventMigration.includes("update public.run_plans"), "Private run plans must be relinked to the surviving event");
assert(mergeEventMigration.includes("private.event_merge_audit"), "Event merges need a private recovery audit");
assert(mergeEventMigration.includes("Only coaches can merge events"), "The database must reject rider event merges");
assert(mergeEventMigration.includes("security invoker"), "The public merge endpoint must not bypass RLS itself");
assert(eventMigration.includes("create table if not exists public.event_attendees"), "The database must store shared event attendance separately");
assert(eventMigration.includes("alter table public.event_attendees enable row level security"), "Shared attendance must have RLS enabled");
assert(eventMigration.includes("athlete_id = (select auth.uid())"), "A rider must only change their own attendance");
assert(eventMigration.includes("function public.get_active_event_attendees"), "Attendee names and avatars must use a narrow authenticated endpoint");
assert(eventMigration.includes("revoke all on function public.get_active_event_attendees(uuid[]) from public, anon"), "Anonymous users must not access attendee identities");
assert(functionBody("getSharedUpcomingEventData").includes('rpc("get_active_event_attendees"'), "The event page must load confirmed rider names through the secure attendee endpoint");
assert(eventMigration.includes("dashboard_items_active_event_identity_idx"), "Duplicate active shared events must be prevented in the database");
assert(eventMigration.includes("due_at + interval '1 day'"), "Single-day events must remain visible until their day has ended");
assert(eventMigration.includes('drop policy if exists "Parents can view child run plans"'), "Run plans must remain private between the rider and linked coach");
const sharedEventDataBody = functionBody("getSharedUpcomingEventData");
assert(sharedEventDataBody.includes('.from("event_course_photos").select("event_id")'), "Event lists must load only course-photo availability, not the full image");
assert(!sharedEventDataBody.includes("image_data_url"), "Course images must remain lazy-loaded until View Course is pressed");
assert(functionBody("getEventCoursePhoto").includes('.select("event_id,image_data_url,updated_at")'), "View Course must load the selected event photo on demand");
const eventCourseCardBody = functionBody("contestEventCourseHtml");
assert(eventCourseCardBody.includes("VIEW COURSE"), "Events with a park image must expose View Course");
assert(eventCourseCardBody.includes("ADD COURSE PHOTO"), "Coaches must be able to add a missing course image");
assert(eventCourseCardBody.includes("if (coachView)"), "Only coach roles may receive the add-course control");
const eventCourseViewerBody = functionBody("eventCourseViewerHtml");
assert(eventCourseViewerBody.includes("COURSE PHOTO ONLY"), "The course viewer must clearly state its limited shared content");
assert(!eventCourseViewerBody.includes("runMapHtml"), "The shared course viewer must never render a rider route");
assert(!eventCourseViewerBody.includes("runPlaybackControlsHtml"), "The shared course viewer must never render private run playback");
const saveEventCourseBody = functionBody("saveEventCoursePhoto");
assert(saveEventCourseBody.includes("isCoachRole(state.profile?.role)"), "The client must reject rider course-photo writes");
assert(saveEventCourseBody.includes('.from("event_course_photos").upsert'), "Coach course-photo saves must target the shared event-photo table");
assert(eventCourseMigration.includes("create table if not exists public.event_course_photos"), "Shared course images need their own table outside run plans");
assert(eventCourseMigration.includes("alter table public.event_course_photos enable row level security"), "Shared course images must enforce RLS");
assert(eventCourseMigration.includes("grant select, insert, update, delete on public.event_course_photos to authenticated"), "Authenticated users need explicit course-photo table grants");
assert(eventCourseMigration.includes("profile.role in ('athlete', 'coach', 'admin')"), "Only signed-in riders and coaches may view event courses");
assert(eventCourseMigration.includes("Only coaches can merge events"), "Course-photo merge handling must retain coach-only event merging");
assert(eventCourseMigration.includes("source_course_photo"), "Event merges must audit the source course image");
assert(eventCourseMigration.includes("insert into public.event_course_photos"), "Event merges must preserve a course image on the surviving event");
assert(eventCourseIndexMigration.includes("event_course_photos_updated_by_idx"), "Shared course photos need an index for their uploader relationship");
assert(parentEventCourseMigration.includes("profile.role = 'parent'"), "Linked parent accounts must receive shared course-photo read access");
assert(parentEventCourseMigration.includes("link.parent_id = (select auth.uid())"), "Course-photo access must require a real parent-rider link");
assert(!parentEventCourseMigration.includes("for insert"), "Parents must not receive course-photo insert access");
assert(!parentEventCourseMigration.includes("for update"), "Parents must not receive course-photo update access");
assert(!parentEventCourseMigration.includes("public.run_plans"), "Parent course-photo access must remain separate from private run plans");
const parentContestsBody = functionBody("renderContests");
assert(parentContestsBody.includes("getParentRiderContext()"), "Parent Contests must respect the selected linked child");
assert(parentContestsBody.includes("Family event view · Read only"), "Parent Contests must clearly present read-only access");
assert(parentContestsBody.includes("Private rider run plans are not displayed"), "Parent Contests must not load private run plans");
const openRunBuilderBody = functionBody("openRunBuilder");
assert(openRunBuilderBody.includes("state.runBuilder ="), "Opening the Run Builder must initialise a new run");
assert(openRunBuilderBody.includes('stage: "route"'), "Every new Run Builder must open in the route-drawing step");
assert(openRunBuilderBody.includes('planType: eventTitle ? "competition" : "training"'), "Event launches must seed a competition run");
assert(openRunBuilderBody.includes("await getEventCoursePhoto(contestItemId)"), "Event run builders must automatically load the shared course photo");
assert(openRunBuilderBody.includes('imageDataUrl: coursePhoto?.image_data_url || ""'), "The saved event course must immediately populate the Run Builder map");
assert(openRunBuilderBody.includes("coursePhotoLoaded: Boolean(coursePhoto?.image_data_url)"), "The Run Builder must identify an automatically loaded event course");
assert(openRunBuilderBody.includes('scrollIntoView({ behavior: "smooth"'), "Opening the Run Builder must take the rider directly to it");
assert(functionBody("currentRunFormState").includes("coursePhotoLoaded: Boolean(state.runBuilder?.coursePhotoLoaded)"), "The loaded event-course state must survive Run Builder redraws");
assert(functionBody("currentRunFormState").includes("stage: runBuilderStage()"), "The active Run Builder step must survive local editor refreshes");
assert(functionBody("setRunBuilderPhoto").includes("coursePhotoLoaded: false"), "Choosing a different private photo must clear the event-course label");
const runBuilderMarkup = functionBody("runBuilderPanel");
for (const control of ['id="run-photo"', 'id="run-map"', "runBuilderStepsHtml(stage, points.length)", "runBuilderRouteEditorHtml", "runBuilderTrickEditorHtml", "runBuilderPlaybackEditorHtml", 'id="finish-run-builder"', "runPlaybackControlsHtml(points", "SAVE RUN TO CONTESTS", 'id="close-run-builder"']) {
  assert(runBuilderMarkup.includes(control), `Run Builder is missing ${control}`);
}
assert(functionBody("runBuilderStepsHtml").includes('"route", "01", "Draw route"'), "Run Builder must begin with drawing the route");
assert(functionBody("runBuilderStepsHtml").includes('"tricks", "02", "Add tricks"'), "Adding trick names must be the second step");
assert(functionBody("runBuilderStepsHtml").includes('"playback", "03", "Watch it back"'), "Playback must be the final planning step");
assert(functionBody("runBuilderStepsHtml").includes("index > activeIndex"), "Future Run Builder steps must stay locked until the current step is finished");
assert(functionBody("runBuilderRouteEditorHtml").includes("Add all tricks after the route is finished"), "Route drawing must stay separate from trick entry");
assert(functionBody("runBuilderTrickEditorHtml").includes("data-run-trick-index"), "The trick step must expose a numbered input for every dot");
assert(functionBody("runBuilderTrickEditorHtml").includes('enterkeyhint="${index === points.length - 1 ? "done" : "next"}"'), "iPad keyboards must offer Next while naming route dots and Done on the final dot");
assert(functionBody("runBuilderRouteEditorHtml").includes("data-selected-run-bend"), "Route drawing must retain the line-bend control");
for (const removedControl of ['id="run-venue"', 'id="run-type"', 'id="use-demo-run-park"']) {
  assert(!runBuilderMarkup.includes(removedControl), `Run Builder should not show ${removedControl}`);
}
assert(!runBuilderMarkup.includes("selected-run-note"), "Run Builder should not show a per-dot Run note field");
assert(runBuilderMarkup.includes('builder.coursePhotoLoaded ? "Event course loaded"'), "The Run Builder must confirm when it reused the event course");
assert(!runBuilderMarkup.toLowerCase().includes("obstacle"), "The visual Run Planner must not waste space on an obstacle selector");
assert(runBuilderMarkup.includes("finish on any number"), "The Run Planner must explain that any final dot can finish the run");
assert(runBuilderMarkup.includes("options.showRunList === false"), "The inline Run Builder must support a separate saved-run library");
assert(runBuilderMarkup.includes('stage === "playback"'), "Saving a run must only be available after playback is reached");
assert(runBuilderMarkup.includes("COMPLETE 3 STEPS TO SAVE"), "Earlier Run Builder steps must explain why Save is unavailable");
const runBuilderBindings = functionBody("bindRunBuilderActions");
for (const binding of ["setRunBuilderPhoto", "addRunBuilderPoint", "startRunPointDrag", "selectRunPoint", "setRunBuilderStage", "updateRunBuilderTrick", "advanceRunBuilderTrick", "updateSelectedRunPoint", "playFinishedRunBuilder", "bindRunPlaybackControls", "saveRunPlan", "closeRunBuilder"]) {
  assert(runBuilderBindings.includes(binding), `Run Builder must bind ${binding}`);
}
assert(!runBuilderMarkup.includes("fullscreenEditor"), "Run Builder must remain in the normal in-page layout");
assert(!runBuilderMarkup.includes("exit-run-builder-fullscreen"), "Run Builder must not show a full-screen exit control");
assert(!runBuilderBindings.includes("exitRunBuilderFullscreen"), "Run Builder must not bind removed full-screen controls");
const addRunPointBody = functionBody("addRunBuilderPoint");
const executableAddRunPointBody = addRunPointBody.replace("function addRunBuilderPoint", "async function addRunBuilderPoint");
assert(addRunPointBody.includes("state.runBuilder.points.push"), "Tapping the park must still add a route point");
assert(addRunPointBody.includes("await runBuilderRefreshView()"), "Adding a route point must refresh the in-page editor");
assert(addRunPointBody.includes('runBuilderStage() !== "route"'), "Map taps must add dots only during the route step");
assert(addRunPointBody.includes("state.runPointMapClickBlockUntil"), "A click retargeted after dragging must never add another dot");
assert(addRunPointBody.includes("event.clientY < rect.top"), "Letterboxed space outside the course image must never add an invisible route dot");
assert(addRunPointBody.includes("Math.max(0, Math.min(100"), "Saved route coordinates must stay inside the course image");
const runPointHarness = new Function(`
  let now = 100;
  let refreshes = 0;
  const state = { runBuilder: { imageDataUrl: "course", stage: "route", points: [], selectedPointIndex: -1 }, draggedRunPoint: null, runPointMapClickBlockUntil: 0 };
  const performance = { now: () => now };
  const stopRunPlayback = () => {};
  const runBuilderStage = () => state.runBuilder.stage;
  const currentRunFormState = () => ({ ...state.runBuilder });
  const runBuilderRefreshView = async () => { refreshes += 1; };
  ${executableAddRunPointBody}
  return { addRunBuilderPoint, state, setNow: (value) => { now = value; }, refreshes: () => refreshes };
`)();
const runPointEvent = {
  clientX: 50,
  clientY: 50,
  target: { closest: () => null },
  currentTarget: { querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }) },
};
runPointHarness.state.runPointMapClickBlockUntil = 200;
await runPointHarness.addRunBuilderPoint(runPointEvent);
assert.equal(runPointHarness.state.runBuilder.points.length, 0, "A click retargeted to the map after dragging must not add a dot");
runPointHarness.state.runPointMapClickBlockUntil = 0;
await runPointHarness.addRunBuilderPoint({
  ...runPointEvent,
  clientY: 10,
  currentTarget: { querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 20, width: 100, height: 80 }) }) },
});
assert.equal(runPointHarness.state.runBuilder.points.length, 0, "A tap in the map letterbox must not add a hidden dot");
await runPointHarness.addRunBuilderPoint(runPointEvent);
assert.equal(runPointHarness.state.runBuilder.points.length, 1, "A deliberate empty-map tap must add exactly one dot");
runPointHarness.state.runBuilder.stage = "tricks";
await runPointHarness.addRunBuilderPoint(runPointEvent);
assert.equal(runPointHarness.state.runBuilder.points.length, 1, "Entering tricks must lock the completed route against extra taps");
assert(!addRunPointBody.includes("enterRunBuilderFullscreen"), "The first route tap must not enter full screen");
assert(!app.includes("function enterRunBuilderFullscreen"), "Removed Run Builder full-screen entry logic must stay removed");
assert(!app.includes("function leaveRunBuilderFullscreen"), "Removed Run Builder full-screen exit logic must stay removed");
assert(!css.includes(".run-builder-fullscreen-editor"), "Removed full-screen planner layout must stay removed");
assert(!css.includes("run-builder-fullscreen-open"), "The planner must not lock the page for full-screen mode");
assert(css.includes("@media (min-width: 781px) and (max-width: 900px)"), "iPad portrait needs a dedicated full-width app shell");
assert(css.includes("@media (min-width: 700px) and (max-width: 1180px) and (orientation: portrait)"), "The Run Builder needs a portrait-tablet course-first layout");
assert(css.includes("scroll-margin-top: calc(90px + env(safe-area-inset-top))"), "Opening the Run Builder on iPad must leave its heading below the sticky header");
assert(css.includes("@media (display-mode: standalone) and (min-width: 700px) and (max-width: 900px)"), "Installed iPad portrait must keep the header below the status bar");
assert(css.includes("@media (pointer: coarse) and (min-width: 700px) and (max-width: 1180px)"), "Common iPad controls need tablet-specific touch targets");
assert(css.includes("max(18px, env(safe-area-inset-top))"), "iPad event modals must stay inside the installed-app safe area");
assert(css.includes(".nav-sub-btn,\n  summary"), "Nested coach navigation must retain an iPad-sized touch target");
assert(functionBody("advanceRunBuilderTrick").includes("nextInput.focus()"), "Pressing Next on an iPad keyboard must advance to the following trick");
const optimizedRunPhotoBody = functionBody("runPhotoToDataUrl");
assert(optimizedRunPhotoBody.includes("1800 / longestSide"), "Large run photos should be reduced to a screen-sized copy before saving");
assert(optimizedRunPhotoBody.includes('toDataURL("image/webp", 0.84)'), "Run photos should use efficient WebP encoding when it reduces size");
assert(functionBody("setRunBuilderPhoto").includes("runPhotoToDataUrl(file)"), "The Run Builder must use the optimized photo pipeline");
const runBuilderRefresh = functionBody("runBuilderRefreshView");
assert(runBuilderRefresh.includes("refreshMountedRunBuilder()"), "Run Builder edits must refresh only the mounted editor before considering a full page reload");
assert(runBuilderRefresh.indexOf("refreshMountedRunBuilder()") < runBuilderRefresh.indexOf("renderContests()"), "Local Run Builder edits must bypass Events and Supabase reloads");
const mountedRunBuilderRefresh = functionBody("refreshMountedRunBuilder");
assert(mountedRunBuilderRefresh.includes("currentImage"), "Local Run Builder refreshes must retain the already-decoded course photo");
assert(mountedRunBuilderRefresh.includes("bindRunBuilderActions(replacement)"), "The fast Run Builder refresh must restore controls only inside the replaced editor");
assert(functionBody("bindRunBuilderActions").includes("root = document"), "Run Builder bindings must support a local editor scope");
assert(functionBody("bindRunPlaybackControls").includes("root = document"), "Run playback bindings must not duplicate handlers outside a fast editor refresh");
assert(functionBody("runBuilderPanel").includes("preserveExistingImage"), "Run Builder markup must support decoded-image reuse during fast local refreshes");
const getRunPlansBody = functionBody("getRunPlans");
assert(getRunPlansBody.includes("cacheGet(cacheKey, 15000)"), "Run plans should be briefly cached during repeat renders");
assert(getRunPlansBody.includes("state.inFlight.get(cacheKey)"), "Duplicate in-flight run-plan requests should be shared");
const runMapMarkup = functionBody("runMapHtml");
assert(runMapMarkup.includes('decoding="async"'), "Run-plan photos should decode away from the critical rendering path");
assert(runMapMarkup.includes('loading="lazy"'), "Saved run-plan photos should load only when needed");
assert(runMapMarkup.includes("showPlayback && safePoints.length"), "Playback labels must stay hidden while the rider draws the route and enters tricks");
assert(runBuilderMarkup.includes('stage === "playback"'), "The Run Builder must only show playback UI during the final step");
const saveRunPlanBody = functionBody("saveRunPlan");
assert(saveRunPlanBody.includes('venue: String(state.runBuilder?.venue || "").trim()'), "Hidden event venue must still save with the private run");
assert(saveRunPlanBody.includes('state.runBuilder?.planType || (state.runBuilder?.contestItemId ? "competition" : "training")'), "Hidden run type must still be derived and saved automatically");
assert(!functionBody("addRunBuilderPoint").includes("window.prompt"), "Adding a run point must use the compact selected-dot editor, not a blocking prompt");
assert(functionBody("runPathBetween").includes("point.bend"), "Each route segment must support a rider-controlled curve");
assert(runBuilderMarkup.includes("run-bend-control-mobile"), "iPhone Run Builder must place a reachable bend control beside the map");
assert(functionBody("runBuilderRouteEditorHtml").includes("run-bend-control-sidebar"), "iPad and desktop Run Builder must keep the existing sidebar bend control");
assert(functionBody("dragRunPoint").includes("requestAnimationFrame"), "Run Builder dot dragging must be frame-synchronised for smooth touch movement");
assert(functionBody("updateRunBuilderMapDom").includes('setAttribute("d"'), "Dragging a dot must redraw only the affected route segments");
assert(functionBody("selectRunPoint").includes("runPointDragClickBlockUntil"), "Releasing a dragged dot must not trigger a second full editor render");
assert(functionBody("startRunPointDrag").includes("state.runPointMapClickBlockUntil"), "Touching a route dot must suppress the map add gesture");
assert(functionBody("stopRunPointDrag").includes("Always block that map click"), "Every marker release, including a long press, must suppress the following map click");
assert(functionBody("stopRunPointDrag").includes("state.runPointMapClickBlockUntil = performance.now() + 900"), "Releasing any marker gesture must refresh the map-click suppression window");
assert(css.includes(".run-bend-control-mobile input[type=\"range\"]::-webkit-slider-thumb"), "iPhone bend control needs a large touch-friendly slider thumb");
assert(css.includes(".run-builder-live .run-marker { width: 21px; height: 21px"), "Run Builder circles should stay visually small");
assert(css.includes('.run-builder-live .run-marker::before { content: ""; position: absolute; inset: -11px'), "Small Run Builder circles still need a forgiving invisible touch target");
const runPathForTest = new Function(`${functionBody("runPathBetween")}; return runPathBetween;`)();
assert.notEqual(runPathForTest({ x: 0, y: 0 }, { x: 50, y: 50, bend: 0 }), runPathForTest({ x: 0, y: 0 }, { x: 50, y: 50, bend: 60 }), "Changing a dot's bend must change the saved route curve");
assert(app.includes("const RUN_PLAYBACK_MAX_SECONDS = 60"), "Run playback must be capped at 60 seconds");
for (const playbackControl of ["data-run-play-toggle", "data-run-play-restart", "data-run-duration", "data-run-scrub"]) {
  assert(functionBody("runPlaybackControlsHtml").includes(playbackControl), `Run playback is missing ${playbackControl}`);
}
assert(functionBody("runPlaybackControlsHtml").includes('max="${RUN_PLAYBACK_MAX_SECONDS}"'), "The playback duration control must enforce the 60-second maximum");
assert(functionBody("runPlaybackControlsHtml").includes("data-run-duration-preset=\"${seconds}\""), "Playback must expose clear 15, 30, 45 and 60 second presets");
assert(functionBody("runMapHtml").includes("data-run-point-label"), "Saved trick names must be attached to every playback point");
assert(functionBody("runMapHtml").includes("data-run-playback-callout"), "Run playback must include a visible trick-name callout");
assert(functionBody("paintRunPlayback").includes("activeMarker.dataset.runPointLabel"), "Playback must show the active point's saved trick name");
assert(functionBody("toggleRunPlayback").includes("requestAnimationFrame"), "Run playback must animate continuously and support pause/resume");
assert(functionBody("playFinishedRunBuilder").includes('stage: "playback"'), "Finishing trick entry must open the playback step before starting the run");
assert(functionBody("playFinishedRunBuilder").includes("missingTrickIndex"), "Playback must identify the first unnamed route dot instead of silently skipping trick entry");
assert(functionBody("saveRunPlan").includes('runBuilderStage() !== "playback"'), "Pressing Enter must not bypass the route, trick and playback sequence");
const formatPlaybackForTest = new Function(`const RUN_PLAYBACK_MAX_SECONDS = 60; ${functionBody("formatRunPlaybackTime")}; return formatRunPlaybackTime;`)();
assert.equal(formatPlaybackForTest(60), "01:00", "The 60-second playback limit must display as 01:00");
assert(!functionBody("saveRunPlan").includes("points.length"), "Saving must not force a fixed number of run dots");
const runPointColourForTest = new Function(`${functionBody("runPointColor")}; return runPointColor;`)();
assert.equal(runPointColourForTest(1), runPointColourForTest(5), "Run points 1–5 must share one route colour");
assert.notEqual(runPointColourForTest(5), runPointColourForTest(6), "The route colour must change after point 5");
assert.equal(runPointColourForTest(6), runPointColourForTest(10), "Run points 6–10 must share the next route colour");
assert.notEqual(runPointColourForTest(10), runPointColourForTest(11), "The route colour must change again after point 10");
for (const selector of [".shared-events-panel", ".contest-event-card", ".contest-event-modal", ".contest-run-library", ".run-builder-live", ".visual-run-builder", ".run-playback-controls"]) {
  assert(css.includes(selector), `Contests release styling is missing ${selector}`);
}
const coachCommandBody = functionBody("renderCoachCommand");
const commandLeaderboardPreviewBody = functionBody("commandLeaderboardPreviewHtml");
assert(coachCommandBody.includes("getSharedUpcomingEventData()"), "Coach Command must load the same upcoming-event catalogue riders see");
assert(coachCommandBody.includes('commandMetricCard("Upcoming", upcoming, "Events to manage", { view: "contests" })'), "The coach Upcoming metric must open the event manager");
assert(commandLeaderboardPreviewBody.includes("rows.slice(0, 5)"), "Coach Command leaderboard preview must always stop at five riders");
assert(!commandLeaderboardPreviewBody.includes("matchMedia"), "Desktop Coach Command must not expand the leaderboard beyond five riders");
assert(coachCommandBody.includes('id="upcoming-events-section"'), "Coach Command must show its upcoming event panel directly on the dashboard");
assert(coachCommandBody.indexOf("commandLeaderboardPreviewHtml") < coachCommandBody.indexOf("coachSharedEventsSummaryHtml"), "Coach Command upcoming events must render below the leaderboard");
const coachSharedEventsSummaryBody = functionBody("coachSharedEventsSummaryHtml");
assert(coachSharedEventsSummaryBody.includes("Coach attending"), "Coach Command must show coach attendance state for shared events");
assert(coachSharedEventsSummaryBody.includes("events.slice(0, 4)"), "Desktop and iPad Coach Command must retain the existing four-event preview");
assert(coachSharedEventsSummaryBody.includes("events.slice(3)"), "The phone event dropdown must include every event after the first three");
assert(coachSharedEventsSummaryBody.includes("events.length > 3"), "Coach Command must omit the phone dropdown when three or fewer events exist");
assert(coachSharedEventsSummaryBody.includes("command-event-desktop-only") && coachSharedEventsSummaryBody.includes("command-event-mobile-overflow"), "Coach Command needs separate fourth-card and phone-overflow presentation hooks");
const coachSharedEventsSummaryRenderer = new Function(`
  const state = { user: { id: "coach-test" } };
  const contestEventAttendees = () => [];
  const contestEventFacesHtml = () => "";
  const escapeHtml = (value) => String(value ?? "");
  const dateLabel = (value) => String(value ?? "");
  ${functionBody("coachSharedEventsSummaryHtml")}
  return coachSharedEventsSummaryHtml;
`)();
const coachEventFixtures = Array.from({ length: 6 }, (_, index) => ({ id: `event-${index + 1}`, title: `Event ${index + 1}`, due_at: `2026-09-${String(index + 4).padStart(2, "0")}T08:00:00+10:00` }));
const sixEventSummary = coachSharedEventsSummaryRenderer(coachEventFixtures, []);
const phoneOverflowMarkup = sixEventSummary.slice(sixEventSummary.indexOf('<details class="command-event-mobile-overflow"'));
assert(sixEventSummary.includes("SHOW 3 MORE EVENTS"), "Six upcoming events must produce a correctly counted phone dropdown");
assert(phoneOverflowMarkup.includes("Event 4") && phoneOverflowMarkup.includes("Event 5") && phoneOverflowMarkup.includes("Event 6"), "The phone dropdown must contain every remaining upcoming event");
assert.equal((sixEventSummary.match(/command-event-desktop-only/g) || []).length, 1, "Only the desktop fourth preview card should be hidden on phones");
assert(coachSharedEventsSummaryRenderer(coachEventFixtures.slice(0, 4), []).includes("SHOW 1 MORE EVENT"), "The phone dropdown count must use singular wording for one remaining event");
assert(!coachSharedEventsSummaryRenderer(coachEventFixtures.slice(0, 3), []).includes("command-event-mobile-overflow"), "Three or fewer events must not render an empty phone dropdown");
const phoneEventRuleIndex = css.indexOf(".command-upcoming-events-panel .command-event-desktop-only");
const phoneEventMediaIndex = css.lastIndexOf("@media (max-width: 520px)", phoneEventRuleIndex);
const phoneEventsCss = bracedBlock(css, "@media (max-width: 520px)", phoneEventMediaIndex);
assert(css.includes(".command-event-mobile-overflow { display: none; }"), "The phone event dropdown must stay hidden on desktop and iPad");
assert(phoneEventsCss.includes(".command-upcoming-events-panel .command-event-desktop-only { display: none; }"), "Phones must remove the duplicate fourth desktop event from layout and accessibility");
assert(phoneEventsCss.includes(".command-event-mobile-overflow") && phoneEventsCss.includes("min-height: 56px"), "The phone event dropdown must provide a clear touch-sized disclosure bar");
assert(app.includes('["contests", "Events & Runs"]'), "Coach navigation must clearly expose Events & Runs");
for (const selector of [".contest-event-coach-actions", ".coach-event-attendance-editor", ".coach-shared-events-summary", ".run-playback-callout", ".run-playback-presets"]) {
  assert(css.includes(selector), `Coach events or playback styling is missing ${selector}`);
}

assert(app.includes('const RILEY_TEST_ACCOUNT_ID = "e230a5a6-68ad-4362-b410-b52f45f58e57"'), "The isolated Riley route must retain its immutable test account id");
assert(functionBody("handleSession(").includes("!isRileyTestRoute()"), "Riley should be routed to the isolated test path from the main app");
const riderSessionBody = functionBody("renderSession");
assert(!riderSessionBody.includes("getHelpRequests(state.user.id)"), "Private video Coaching must no longer clutter Rider Session");
assert(!riderSessionBody.includes("helpUploadSection"), "Rider Session must not embed the Coaching upload panel");
assert(!riderSessionBody.includes("bindHelpRequestForm"), "Rider Session must not bind the separate Coaching form");
assert(functionBody("athletePrimaryView").includes('view === "coaching" ? "home" : view'), "The Coaching page must keep Home selected in athlete navigation");
assert(app.includes("coaching: renderAthleteCoaching"), "All athlete accounts must be able to navigate to Coaching");
const athleteCoachingBody = functionBody("renderAthleteCoaching");
assert(athleteCoachingBody.includes('state.profile?.role !== "athlete"'), "Private Coaching must require an athlete account");
assert(athleteCoachingBody.includes("getAthleteHelpRequests(state.user.id)"), "Athlete Coaching must load a lightweight private inbox for the signed-in rider");
assert(!functionBody("getAthleteHelpRequests").includes("hydrateHelpRequestMediaUrls"), "The Coaching inbox must not sign or download every video before a rider opens one");
assert(!functionBody("getAthleteHelpRequests").includes(".limit("), "The Coaching inbox must not silently hide older private reviews");
assert(athleteCoachingBody.includes("rememberCoachingReplies(requests)"), "Opening Coaching must mark returned feedback seen on this device");
assert(athleteCoachingBody.includes("helpUploadSection(requests)"), "Athlete Coaching must render the focused upload composer");
assert(athleteCoachingBody.includes("athleteHelpReviewInboxHtml(requests, unreadIds)"), "Athlete Coaching must render the compact private review inbox");
assert(athleteCoachingBody.includes("bindHelpRequestForm()"), "Athlete Coaching must bind video uploads");
assert(athleteCoachingBody.includes("bindAthleteCoachingInbox(requests)"), "Athlete Coaching must bind its filters and focused viewer");
const helpUploadMarkup = functionBody("helpUploadSection");
assert(helpUploadMarkup.includes("Private coaching"), "The rider upload must identify its private audience");
assert(helpUploadMarkup.includes("Maximum 60 seconds and 50 MB"), "The rider upload must state its hosted limits");
for (const id of ['id="help-video"', 'id="help-video-preview"', 'id="help-video-meta"', 'id="help-question"']) {
  assert(helpUploadMarkup.includes(id), `The refined Coaching composer must preserve ${id}`);
}
assert(!helpUploadMarkup.includes("Private Riley"), "The live Coaching flow must not retain Riley-only wording");
assert(!helpUploadMarkup.includes("video-analysis-steps"), "The compact Coaching page must not restore the removed explainer section");
const athleteInboxMarkup = functionBody("athleteHelpReviewInboxHtml");
assert(!athleteInboxMarkup.includes("<video"), "Collapsed Coaching history must not render or preload video players");
assert(athleteInboxMarkup.includes('data-coaching-filter="waiting"'), "The Coaching inbox must filter waiting reviews");
assert(athleteInboxMarkup.includes('data-coaching-filter="returned"'), "The Coaching inbox must filter returned feedback");
assert(athleteInboxMarkup.includes("data-coaching-show-older"), "The Coaching inbox must keep older reviews available without an endless feed");
const athleteReviewRowMarkup = functionBody("athleteHelpReviewRowHtml");
assert(athleteReviewRowMarkup.includes('type="button"'), "Every Coaching history row must be a safe typed button");
assert(athleteReviewRowMarkup.includes('aria-expanded="false"'), "Every Coaching history row must expose its viewer state");
assert(athleteReviewRowMarkup.includes("escapeHtml(request.question"), "Coaching questions must be escaped in compact history rows");
const athleteViewerMarkup = functionBody("athleteReviewViewerHtml");
assert.equal((athleteViewerMarkup.match(/<video/g) || []).length, 1, "The focused Coaching viewer must contain no more than one video player");
assert(athleteViewerMarkup.includes("Coach feedback"), "The focused viewer must prioritise returned coach video");
assert(athleteViewerMarkup.includes("My clip"), "The focused viewer must retain the rider's original video");
const openAthleteViewerBody = functionBody("openAthleteReviewViewer");
assert(openAthleteViewerBody.includes("fetchHelpVideoMedia(request.id)"), "Opening a Coaching review must fetch only that request's private media");
assert(openAthleteViewerBody.includes("data-athlete-review-media"), "The focused viewer must switch between coach feedback and the rider clip");
const closeAthleteViewerBody = functionBody("closeAthleteReviewViewer");
assert(closeAthleteViewerBody.includes("video.pause()"), "Closing a Coaching review must stop playback");
assert(closeAthleteViewerBody.includes('video.removeAttribute("src")'), "Closing a Coaching review must detach private media");
assert(closeAthleteViewerBody.includes("releaseVideoReviewMedia(requestId)"), "Closing a Coaching review must clear cached signed media");
assert(functionBody("handleSession(").includes("closeAthleteReviewViewer()"), "Signing out or switching accounts must close any private Coaching review");
const athleteHomeBody = functionBody("renderAthleteHome");
assert(athleteHomeBody.includes("getHelpRequestSummaries(state.user.id)"), "Athlete Home must load lightweight Coaching reply status");
assert(athleteHomeBody.includes("getAthleteHomeLeaderboard()"), "Athlete Home must avoid the heavier profile-hydrated leaderboard path");
assert(athleteHomeBody.includes("getWeeklyAssignments(state.user.id, { includeAssignmentAttempts: false })"), "Athlete Home must skip detailed attempt history it does not display");
assert(!athleteHomeBody.includes("getRiderBattleHistory()"), "Athlete Home must not request the same battle payload twice");
assert(athleteHomeBody.includes('battle.status === "completed"'), "Athlete Home must derive battle history from its one battle response");
assert(athleteHomeBody.includes("athleteHomeRenderVersion"), "Background Home hydration must be guarded against stale renders");
assert(athleteHomeBody.includes('id="athlete-home-week"'), "Athlete Home must render its main dashboard before secondary weekly data finishes");
assert(athleteHomeBody.includes("athleteRunBuilderCtaHtml()"), "Athlete Home must display the live Run Builder action");
assert(athleteHomeBody.includes('navigate("contests")'), "The Home Run Builder action must open Contests");
assert(athleteHomeBody.includes("athleteCoachingCtaHtml(coachingRequests)"), "Athlete Home must display the video-help action");
assert(!athleteHomeBody.includes("rememberCoachingReplies(coachingRequests)"), "The Home notification badge must remain visible until the Coaching page actually opens");
const homeLeaderboardBody = functionBody("getAthleteHomeLeaderboard");
assert(homeLeaderboardBody.includes('client.rpc("get_weekly_leaderboard")'), "The lightweight Home leaderboard must use the existing leaderboard rules");
assert(!homeLeaderboardBody.includes('client.from("profiles")'), "The Home leaderboard must not perform a second profile-hydration query");
const weeklyAssignmentsBody = functionBody("getWeeklyAssignments");
assert(weeklyAssignmentsBody.includes("includeAssignmentAttempts = true"), "Detailed weekly assignment history must remain the default away from Home");
assert(weeklyAssignmentsBody.includes("Promise.resolve({ data: [], error: null })"), "The Home summary must be able to omit detailed assignment attempts safely");
const coachingCtaMarkup = functionBody("athleteCoachingCtaHtml");
assert(coachingCtaMarkup.includes("GET HELP — SEND VIDEO"), "Athlete Home must use the requested Coaching button label");
assert(coachingCtaMarkup.includes("unreadCoachingReplyCount(requests)"), "The Home Coaching button must calculate unseen replies");
assert(coachingCtaMarkup.includes("coaching-reply-badge"), "Returned coach feedback must create a notification badge on Home");
assert(functionBody("coachingReplySeenKey").includes("state.user?.id"), "Seen Coaching replies must be scoped to the signed-in rider");
assert(functionBody("rememberCoachingReplies").includes("localStorage.setItem"), "Seen Coaching replies must persist on the rider's device");
assert(functionBody("setupRealtimeSync").includes('"trick_help_requests"'), "Video request updates must arrive through realtime sync");
assert(functionBody("scheduleRealtimeRefresh").includes('state.view === "coaching"'), "Realtime coach replies must refresh the open Coaching screen");
assert(functionBody("scheduleRealtimeRefresh").includes('state.view === "videoReviews"'), "Realtime rider submissions must refresh the coach's open review inbox");
assert(app.includes('["home", "board", "command", "videoReviews"]'), "An open coach app must follow video-review push notifications into the review studio");
assert(css.includes(".athlete-coaching-cta"), "Athlete Home needs released Coaching-card styling");
assert(css.includes(".coaching-reply-badge"), "Athlete Home needs visible unread-reply badge styling");
for (const selector of [".coaching-composer-grid", ".coaching-review-row", ".coaching-review-status", ".coaching-viewer-backdrop", ".coaching-viewer-media"]) {
  assert(css.includes(selector), `Refined Coaching styling is missing ${selector}`);
}
const runBuilderCtaMarkup = functionBody("athleteRunBuilderCtaHtml");
assert(runBuilderCtaMarkup.includes("OPEN RUN BUILDER"), "Athlete Home must use an unmistakable Run Builder button label");
assert(css.includes(".athlete-run-builder-cta"), "Athlete Home needs released Run Builder-card styling");
const submitHelpRequestBody = functionBody("submitHelpRequest");
assert(submitHelpRequestBody.includes('state.profile?.role !== "athlete"'), "Video Coaching uploads must require an athlete account");
assert(submitHelpRequestBody.includes("RIDER_VIDEO_MAX_BYTES"), "Rider video upload must enforce the hosted file limit");
assert(submitHelpRequestBody.includes("RIDER_VIDEO_MAX_SECONDS"), "Rider video upload must enforce the clip duration limit");
assert(submitHelpRequestBody.includes('state.view === "coaching"'), "Successful Coaching uploads must refresh the Coaching page");
assert(submitHelpRequestBody.includes('button.textContent = "Send video to Coach JK"'), "Failed Coaching uploads must restore the refined send-button label");
assert(!submitHelpRequestBody.includes("RILEY"), "All linked athletes must be able to submit private videos");
assert(functionBody("uploadHelpVideoFile").includes("uploadHelpVideoResumable"), "Phone videos above 6MB must use resumable upload");
assert(functionBody("loadTusClient").includes("TUS_CLIENT_INTEGRITY"), "The pinned resumable uploader must verify its CDN integrity");
const coachReviewWorkspace = functionBody("coachReviewWorkspaceHtml");
assert(!coachReviewWorkspace.includes("Riley-only"), "The live coach review workspace must not retain canary wording");
assert(coachReviewWorkspace.includes("coach-review-canvas"), "Coach review must include an on-video drawing layer");
assert(coachReviewWorkspace.includes("[1, 0.5, 0.25, 0.125]"), "Coach review must include eighth-speed slow motion");
assert(coachReviewWorkspace.includes("data-help-reply"), "Coach review must preserve the existing private reply workflow");
assert(coachReviewWorkspace.includes("data-review-record-toggle"), "Every coach review must include voice-and-drawing recording controls");
assert(coachReviewWorkspace.includes('data-coach-analysis="1"'), "Private rider media must use the origin-clean analysis loader");
const coachReviewTestState = { videoReviewMedia: new Map(), videoReviewRecordedReplies: new Map(), videoReviewDrawEnabled: false, videoReviewDrawTool: "pen", videoReviewDrawColor: "#20e3c3" };
const renderCoachReviewWorkspace = new Function("state", "escapeHtml", "avatarHtml", "dateLabel", "videoSizeLabel", "videoReviewTimeLabel", "firstName", "COACH_REVIEW_RECORDING_MAX_SECONDS", `return (${coachReviewWorkspace});`)(
  coachReviewTestState,
  (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
  () => '<span class="avatar">RC</span>',
  () => "Today",
  () => "0.5 MB",
  (seconds = 0) => `0:${String(Math.floor(seconds)).padStart(2, "0")}`,
  (athlete = {}) => String(athlete.display_name || "Rider").split(/\s+/)[0],
  90,
);
const coachReviewRequest = { id: "review-1", athlete_id: "e230a5a6-68ad-4362-b410-b52f45f58e57", athlete: { display_name: "Riley Chen" }, status: "open", question: "Can’t <land> it", created_at: new Date().toISOString(), video_size_bytes: 520171 };
const unloadedCoachReview = renderCoachReviewWorkspace(coachReviewRequest);
assert(unloadedCoachReview.includes("Open review player"), "Every rider review must start with an intentional private-media load step");
assert(unloadedCoachReview.includes("Can’t &lt;land&gt; it"), "Rider questions must remain escaped in the coach workspace");
coachReviewTestState.videoReviewMedia.set("review-1", { video_url: "https://signed.example/video.mov" });
const signedOnlyCoachReview = renderCoachReviewWorkspace(coachReviewRequest);
assert(signedOnlyCoachReview.includes("Open review player"), "A signed URL alone must still offer authenticated Blob preparation for recording");
coachReviewTestState.videoReviewMedia.set("review-1", { video_url: "https://signed.example/video.mov", video_playback_url: "blob:private-video" });
const loadedCoachReview = renderCoachReviewWorkspace(coachReviewRequest);
assert(loadedCoachReview.includes('id="coach-review-video"'), "Loaded rider media must render in the analysis player");
assert(loadedCoachReview.includes('id="coach-review-canvas"'), "Loaded rider media must retain the drawing canvas");
assert(loadedCoachReview.includes(">Original</a>"), "Loaded rider media must offer a browser fallback for phone MOV files");
assert(loadedCoachReview.includes("Record voice + drawings"), "Loaded rider media must explain the combined review recording");
assert(loadedCoachReview.includes('class="coach-review-flow"'), "The review workspace must show the Watch, Coach and Send workflow");
assert(loadedCoachReview.includes('class="coach-review-tool-deck"'), "Playback speed and drawing controls must be grouped into a focused tool deck");
coachReviewTestState.videoReviewRecordedReplies.set("review-1", { file: { size: 2048 }, url: "blob:review", durationSeconds: 8 });
const recordedCoachReview = renderCoachReviewWorkspace(coachReviewRequest);
assert(recordedCoachReview.includes("Send review to Riley"), "A finished review must be previewable and sendable through the private reply form");
assert(recordedCoachReview.includes("Remove recording"), "A coach must be able to discard an unsent recording");
const coachReviewRender = functionBody("renderVideoReviews");
assert(coachReviewRender.includes("coachReviewWorkspaceHtml(activeRequest)"), "Every selected rider submission must use the full review studio");
assert(!coachReviewRender.includes("isRileyCoachVideoCanary"), "The full coach review studio must not be gated to a test rider");
assert(coachReviewRender.includes("coachReviewQueueItemHtml"), "Coach reviews must provide a selectable rider inbox");
assert(coachReviewRender.includes('class="video-review-hero"'), "Video Reviews must use the focused Review Cockpit header");
assert(coachReviewRender.includes("videoReviewFilterHtml(roster)"), "Queue filters must stay with the incoming clip list");
assert(coachReviewRender.includes("renderSerial !== state.videoReviewRenderSerial"), "Slow coach review reads must not overwrite a newer screen");
assert(coachReviewRender.includes("state.videoReviewRecording || state.videoReviewRecordingStarting"), "An in-flight review read must not replace a recorder that started while it was loading");
assert((coachReviewRender.match(/disableStaleCoachReviewRecordButton\(\)/g) || []).length >= 4, "Every queue, filter and search change must disable the outgoing workspace recorder immediately");
const coachReviewBindings = functionBody("bindCoachVideoReviewEditor");
assert(coachReviewBindings.includes("video.playbackRate"), "Coach review must bind slow-motion playback");
assert(coachReviewBindings.includes('canvas.addEventListener("pointerdown"'), "Coach review must bind touch and pointer drawing");
assert(coachReviewBindings.includes("video.videoWidth / video.videoHeight"), "Portrait and landscape videos must size the drawing layer from real media dimensions");
assert(coachReviewBindings.includes('canvas.addEventListener("pointercancel"'), "Canceled iPad drawing gestures must be handled separately");
assert(coachReviewBindings.includes("state.videoReviewDraftDrawing = null"), "Canceled drawing gestures must discard the unfinished stroke");
assert(coachReviewBindings.includes("recording.failure = new Error"), "A source-video decode failure must reject an active review instead of saving black frames");
const coachReplyBody = functionBody("replyToHelpRequest");
assert(coachReplyBody.includes("videoReviewRecordedReplies.get(requestId)"), "Recorded reviews must feed the existing private reply workflow");
assert(coachReplyBody.includes("selectCoachReplyVideoFile(selectedFile, recordedReply)"), "Coach replies must explicitly resolve manual versus recorded media");
const selectCoachReplyVideo = new Function(`${functionBody("selectCoachReplyVideoFile")}; return selectCoachReplyVideoFile;`)();
const recordedFileForTest = { size: 500, name: "recorded.webm" };
const manualFileForTest = { size: 600, name: "manual.mov" };
assert.equal(selectCoachReplyVideo({ size: 0 }, { file: recordedFileForTest }), recordedFileForTest, "An empty file input must use the recorded review");
assert.equal(selectCoachReplyVideo(manualFileForTest, { file: recordedFileForTest }), manualFileForTest, "A manually chosen replacement must override an unsent recorded review");
assert(coachReplyBody.includes("clearCoachRecordedReply(requestId)"), "Recorded review previews must clear only after the database commit");
assert(coachReplyBody.includes("Could not clean up failed coach video reply upload"), "Failed coach replies must clean up uploaded media");
assert(coachReplyBody.includes("upload?.path && !committed"), "A committed coach reply must never have its uploaded video deleted by a later render error");
assert(coachReplyBody.includes("previousCoachVideoPath"), "Replacing a coach reply must clean up the previous private video");
assert(coachReplyBody.includes('state.view === originatingView && originatingView === "videoReviews"'), "A completed upload must not replace a screen the coach navigated to");
assert(functionBody("fetchHelpVideoMedia").includes("_signedAt"), "Expired private video links must be refreshed instead of cached indefinitely");
assert(functionBody("prepareCoachReviewPlaybackMedia").includes(".download(media.video_storage_path)"), "Rider analysis must download the private clip through authenticated Storage before canvas capture");
assert(functionBody("prepareCoachReviewPlaybackMedia").includes("URL.createObjectURL(data)"), "Rider analysis must use an origin-clean local playback URL");
const revokedReviewUrls = [];
const releaseMediaState = { videoReviewMedia: new Map([["review-1", { video_playback_url: "blob:private-source" }]]) };
const releasePrivateMedia = new Function("state", "URL", `${functionBody("releaseVideoReviewMedia")}; return releaseVideoReviewMedia;`)(releaseMediaState, { revokeObjectURL: (url) => revokedReviewUrls.push(url) });
releasePrivateMedia("review-1");
assert.deepEqual(revokedReviewUrls, ["blob:private-source"], "Private source playback URLs must be revoked exactly once when released");
assert.equal(releaseMediaState.videoReviewMedia.size, 0, "Released private media must leave the in-memory cache");
const normalizeVideoMime = new Function(`${functionBody("baseVideoMimeType")}; return baseVideoMimeType;`)();
assert.equal(normalizeVideoMime("video/webm;codecs=vp8,opus"), "video/webm", "Recorded WebM codec parameters must be stripped before Storage upload");
assert.equal(normalizeVideoMime("VIDEO/MP4; codecs=avc1"), "video/mp4", "Recorded MP4 codec parameters must be stripped before Storage upload");
const recordingPaint = functionBody("paintCoachReviewRecordingFrame");
assert(recordingPaint.indexOf("context.drawImage(sourceVideo") < recordingPaint.indexOf("drawCoachReviewShape(context"), "The compositor must paint the rider video before live drawings");
const recordingStart = functionBody("startCoachReviewRecording");
assert(recordingStart.includes("navigator.mediaDevices.getUserMedia"), "Recording must request the coach microphone from a direct action");
assert(recordingStart.indexOf("requestId !== state.videoReviewActiveRequestId") < recordingStart.indexOf("state.videoReviewRecordingStarting = startAttempt"), "A stale workspace must be rejected before it can lock the recorder state");
assert(recordingStart.includes("state.videoReviewRecordingStarting = startAttempt"), "Recording startup must synchronously block stale queue renders");
assert(recordingStart.includes("state.videoReviewRenderSerial += 1"), "Recording startup must invalidate a coach review render that is already in flight");
assert(recordingStart.includes("video.isConnected"), "Recording startup must reject detached video controls after microphone permission");
assert(recordingStart.includes("clearTimeout(state.videoReviewSearchTimer)"), "Recording startup must cancel a pending search rerender");
assert(recordingStart.includes("outputCanvas.captureStream(30)"), "Recording must capture the composited review canvas");
assert(recordingStart.includes("new MediaStream([videoTrack, audioTrack])"), "Recording must combine one video track with the coach microphone");
assert(recordingStart.indexOf("context.drawImage(video") < recordingStart.indexOf("outputCanvas.captureStream(30)"), "Safari must receive a painted canvas frame before capture starts");
const recordingFinish = functionBody("finishCoachReviewRecording");
assert(recordingFinish.includes("baseVideoMimeType"), "Finished recordings must normalize parameterized browser MIME types");
assert(recordingFinish.includes("session.chunks.find((chunk) => chunk?.type)?.type"), "Default recorders must fall back to their emitted Blob MIME type");
assert(recordingFinish.includes("blob.size > COACH_VIDEO_MAX_BYTES"), "Finished recordings must retain the private 50MB limit");
assert(recordingFinish.includes("videoReviewRecordedReplies.set"), "Finished recordings must remain available for preview and retry");
const recordingCleanup = functionBody("cleanupCoachReviewRecordingSession");
assert(recordingCleanup.includes("stream?.getTracks?.().forEach((track) => track.stop())"), "Every microphone and canvas stream must stop during cleanup");
assert(recordingCleanup.includes("session.outputCanvas?.remove()"), "The off-screen recording canvas must be removed during cleanup");
assert(recordingCleanup.includes("window.clearTimeout(session.stopWatchdogId)"), "Recorder finalization watchdogs must be cleared during cleanup");
assert(functionBody("stopCoachReviewRecording").includes("session.stopWatchdogId = window.setTimeout"), "A missing MediaRecorder stop event must not leave the microphone active indefinitely");
const coachReviewReset = functionBody("resetVideoReviewPrivateState");
assert(coachReviewReset.includes("[...state.videoReviewMedia.keys()].forEach(releaseVideoReviewMedia)"), "Signing out or switching users must revoke private playback links");
assert(coachReviewReset.includes("[...state.videoReviewRecordedReplies.keys()].forEach(clearCoachRecordedReply)"), "Signing out or switching users must revoke unsent recorded previews");
assert(coachReviewReset.includes('state.videoReviewRider = "all"'), "Switching users must clear the previous coach's rider filter");
assert(coachReviewReset.includes('state.videoReviewSearch = ""'), "Switching users must clear the previous coach's private search text");
assert(coachReviewReset.includes("clearTimeout(state.videoReviewSearchTimer)"), "Switching users must stop a pending private-search render");
assert(functionBody("navigate").includes("state.videoReviewRecordedReplies.size > 0"), "Leaving Video Reviews must warn before discarding an unsent review");
assert(functionBody("navigate").includes("[...state.videoReviewMedia.keys()].forEach(releaseVideoReviewMedia)"), "Leaving Video Reviews must release downloaded private video Blobs");
assert(functionBody("navigate").includes('view === previousView && view === "videoReviews"'), "Re-clicking Video Reviews must not hide an active recorder behind a loading screen");
assert(app.includes('"videoReviews"]'), "Coach review links must be able to open the Video Reviews view directly");
assert(!functionBody("videoReviewCardHtml").includes("data-review-record-toggle"), "Legacy summary cards must not create a second review recorder");
assert(css.includes(".coach-review-recorder.is-recording"), "Active coach recording needs a clear visual state");
assert(css.includes(".coach-review-recording-canvas"), "The attached Safari recording canvas needs safe off-screen styling");
assert(css.includes(".video-review-hero"), "The Review Cockpit needs its dedicated visual hierarchy");
assert(css.includes(".coach-review-tool-deck"), "The Review Cockpit needs grouped analysis controls");
assert(app.includes('data-nav-group="${group.id}"'), "Coach sidebar groups need stable colour landmarks");
assert(css.includes('.sidebar-nav-group[data-nav-group="coachTools"]'), "Coach Tools needs its own sidebar colour");
assert(rileyServiceWorker.includes('const CACHE_PREFIX = "jkcrew-riley-shell-"'), "Riley test cache must not delete the production app cache");
const riderVideoMigration = read("supabase/migrations/20260827004923_harden_rider_video_analysis_canary.sql");
assert(riderVideoMigration.includes("file_size_limit = 52428800"), "Video bucket must match the hosted 50MB ceiling");
assert(riderVideoMigration.includes("allowed_mime_types"), "Video bucket must enforce media types");
assert(riderVideoMigration.includes('"Trick help video owners can delete"'), "Failed uploads need owner cleanup permission");
assert(riderVideoMigration.includes("ca.coach_id = trick_help_requests.coach_id"), "Rider requests must target their linked coach");
const coachingPushMigration = read("supabase/migrations/20260827182500_release_video_coaching_notifications.sql");
assert(coachingPushMigration.includes("video_review_requested"), "New rider videos must notify the linked coach");
assert(coachingPushMigration.includes("video_review_returned"), "Returned video reviews must notify the athlete");
assert(coachingPushMigration.includes("'./?push=coaching'"), "Returned review notifications must deep-link to athlete Coaching");
const contestRunMigration = read("supabase/migrations/20260827182700_link_run_plans_to_contests.sql");
assert(contestRunMigration.includes("contest_item_id"), "Saved runs must remain linked to their selected contest");
assert.equal(read("riley-test/app.js"), app, "Riley test path must use the same all-user app bundle");
assert.equal(read("riley-test/styles.css"), css, "Riley test path must use the same all-user styles");

const buttonsWithoutType = [...app.matchAll(/<button(?![^>]*\btype=)[^>]*>/g)].map((match) => match[0]);
assert.deepEqual(buttonsWithoutType, [], `Buttons need explicit types: ${buttonsWithoutType.join(", ")}`);
assert(css.includes("button:focus-visible"), "Keyboard focus styling should be present");
assert(css.includes("prefers-reduced-motion"), "Reduced-motion support should be present");
assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, "CSS braces should balance");

console.log("JKCREW smoke checks passed");
