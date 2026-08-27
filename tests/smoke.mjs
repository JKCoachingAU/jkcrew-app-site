import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
const version = "2.14.0";

function functionBody(name) {
  const start = app.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const tail = app.slice(start + 10);
  const nextMatch = tail.match(/\n(?:async )?function /);
  const next = nextMatch ? start + 10 + nextMatch.index : -1;
  return app.slice(start, next === -1 ? app.length : next);
}

for (const [name, contents] of Object.entries({ app, html, css, serviceWorker, manifestText })) {
  assert(!/2\.11\.(16|44|45|46)/.test(contents), `${name} contains a stale asset version`);
}
assert(html.includes(`app.js?v=${version}`), "HTML should load the current app bundle");
assert(serviceWorker.includes('const CACHE_PREFIX = "jkcrew-shell-"'), "service worker should use the public cache namespace");
assert(serviceWorker.includes(`const RELEASE_VERSION = "${version}"`), "service worker cache should use the current version");
assert(serviceWorker.includes("silent: false"), "Background push should request the device's normal notification sound");

const shellRenderer = functionBody("renderShell");
assert(shellRenderer.includes("!mountWhatsNewPrompt() && !mountBattleIntroPrompt()"), "What's New must appear before the older battle and push prompts");
assert(app.includes('const WHATS_NEW_RELEASE_ID = "2026-08-live-tools"'), "What's New needs the all-athlete live-tools campaign key");
assert(functionBody("mountWhatsNewPrompt").includes("rememberBattleIntro()"), "The all-update prompt should prevent a duplicate battle onboarding popup");
assert(functionBody("mountWhatsNewPrompt").includes("mountPushSetupPrompt()"), "Notification setup should follow the What's New popup");
assert(app.includes('const NOTIFICATION_SOUND_KEY = "jkcrew-notification-sound:v1"'), "In-app notification sound needs a per-device preference");
assert(functionBody("notify").includes("playNotificationSound"), "General in-app notifications should request the JKCREW chime");
assert(functionBody("showProgressPopup").includes("playNotificationSound"), "XP, badge and score popups should request the JKCREW chime");
assert(functionBody("playNotificationSound").includes('document.visibilityState !== "visible"'), "In-app sound must stay silent while the app is hidden");
assert(functionBody("pushNotificationSettingsHtml").includes("notification-sound-toggle"), "Every role needs an in-app notification sound control");

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

assert(app.includes("sessionOpenAssignmentSections: new Set()"), "Rider Session must track open trick-list sections");
const assignmentGroupsBody = functionBody("assignmentGroups");
assert(assignmentGroupsBody.includes("state.sessionOpenAssignmentSections.has(sectionKey)"), "Rider Session lists must restore their open state after refresh");
assert(assignmentGroupsBody.includes('${open ? "open" : ""}'), "Rider Session accordions must render their saved open state");
assert((functionBody("renderSession").match(/bindSessionAssignmentAccordions\(\)/g) || []).length >= 2, "Every rider Session render path must bind accordion state");
assert(functionBody("recordAssignmentAction").includes("sessionOpenAssignmentSections.add(openSection)"), "Ticking a standard trick must preserve its open list");
assert(functionBody("recordPercentageAttempt").includes("sessionOpenAssignmentSections.add(openSection)"), "Updating a percentage trick must preserve its open list");
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
assert(functionBody("previousTrainingSheetsHtml").includes("assignmentPresentation(assignment)"), "Sheet history must show each Line as one run");
assert(functionBody("parentRecentActivityHtml").includes("assignmentPresentation(assignment).title"), "Parent activity must use the full Line label");
assert(functionBody("plannerCompletedStrip").includes("assignmentPresentation(assignment).title"), "Planner completion chips must use the full Line label");
assert(functionBody("sessionViewerAssignmentEditor").includes("Example: Manual - Barspin - 180"), "Coach Line editor must show the exact 3–4 trick run format");
assert(css.includes(".viewer-trick-row.viewer-attempt-row {\n  grid-template-columns: auto minmax(0, 1fr);"), "Coach Session Line labels must have a wrapping text column");
assert(functionBody("getWeeklyAssignments").includes('rpc("get_effective_weekly_assignments"'), "Rider schedules must load each location's latest saved Daily list");
const venueKeyForTest = (venue = "") => String(venue || "").trim();
const venueIdentityKeyForTest = (venue = "") => venueKeyForTest(venue).normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const dailyVenuesForTest = new Function("venueKey", "venueIdentityKey", `${functionBody("dailyVenues")}; return dailyVenues;`)(venueKeyForTest, venueIdentityKeyForTest);
assert.deepEqual(
  dailyVenuesForTest([
    { category: "daily", venue: "HOTBOX" },
    { category: "daily", venue: "Hotbox" },
    { category: "daily", venue: "Beenleigh Skate Park" },
    { category: "one_bang", venue: "Ignored" },
  ]),
  ["HOTBOX", "Beenleigh Skate Park"],
  "Location selectors must combine harmless spelling/case variants without losing saved lists",
);
const assignmentsForVenueForTest = new Function("venueIdentityKey", `${functionBody("assignmentsForVenue")}; return assignmentsForVenue;`)(venueIdentityKeyForTest);
assert.equal(
  assignmentsForVenueForTest([
    { category: "daily", venue: "Beenleigh Skate Park" },
    { category: "daily", venue: "beenleigh-skate-park" },
    { category: "daily", venue: "Hotbox" },
  ], "BEENLEIGH SKATE PARK").length,
  2,
  "Opening a location must show its canonically matching saved Daily list",
);
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
assert.equal((parentNavBody.match(/\["/g) || []).length, 5, "Parent navigation must expose the five family views");
for (const label of ["Home", "Week", "Coaching", "Calendar", "More"]) {
  assert(parentNavBody.includes(`"${label}"`), `Parent navigation is missing ${label}`);
}
assert(
  css.includes(".parent-shell .bottom-nav { grid-template-columns: repeat(5, minmax(0, 1fr)); }"),
  "Parent bottom navigation must use a five-column family layout",
);
for (const tone of ["aqua", "blue", "violet", "gold", "coral"]) {
  assert(css.includes(`--parent-${tone}:`), `Parent palette is missing ${tone}`);
}
assert(css.includes(".parent-shell .parent-child-card"), "Parent linked-rider cards should use the parent visual system");
assert(css.includes(".parent-shell .push-settings-card"), "Parent profile controls should use the parent visual system");
assert(!css.includes(".parent-shell .parent-readonly { pointer-events: none; }"), "Read-only parent content must still allow accordion navigation");
assert(functionBody("renderParentWeek").includes("assignmentGroups(assignments, false)"), "Parent weekly sheets must remain read-only");
assert(!functionBody("renderParentTricktionary").includes("editable: true"), "Parent Tricktionary must remain read-only");
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
assert(app.includes('id="parent-notification-bell"'), "Parent shell must include a notification bell");
assert(functionBody("showParentNotificationDrawer").includes("getMyCoachMessages(10)"), "Parent notification drawer must use existing coach-message data");
assert(functionBody("showParentNotificationDrawer").includes("getHelpRequests(context.selected.id)"), "Parent notification drawer must include returned video feedback");
assert(functionBody("showParentNotificationDrawer").includes("getDashboardItems(context.selected.id)"), "Parent notification drawer must include calendar updates");

const viewerTabs = app.match(/const sessionViewerListTabs = \[([\s\S]*?)\];/)?.[1] || "";
for (const tab of ["daily", "one_bang", "dialled", "lines", "percentage", "foam_pit", "bonus"]) {
  assert(viewerTabs.includes(`id: "${tab}"`), `Session Viewer is missing ${tab}`);
}
assert(!/goals|contest_run/.test(viewerTabs), "Session Viewer should not expose Goals or Contest Run tabs");

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
assert(battleMigration.includes("cardinality(p_team_two) <> v_size"), "The database must enforce equal battle teams");
assert(battleMigration.includes("count(distinct chosen.rider_id)"), "The database must prevent duplicate riders across teams");
assert(battleMigration.includes("unnest(p_team_one)"), "The database must save every home-team rider");
assert(battleMigration.includes("unnest(p_team_two)"), "The database must save every opposing rider");
assert(functionBody("renderCoachBattleViewer").includes("coach-create-battle"), "Coach battle oversight needs a create-battle action");
assert(functionBody("renderCoachBattleViewer").includes("coach-create-weekly-challenge"), "Coaches need a weekly challenge builder");
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
assert(functionBody("renderSessionViewer").includes("Active challenges in this group"), "Coach Session must show group challenges at the bottom");
assert(!functionBody("sessionViewerListContent").includes("data-viewer-assignment-attempt"), "Coach Session trick rows should remain one-tap without Attempt buttons");
const contestsRenderer = functionBody("renderContests");
assert(contestsRenderer.includes("+ BUILD A RUN"), "Athlete Contests must expose a prominent Run Builder action");
assert(contestsRenderer.includes("OPEN RUN BUILDER"), "Athlete Contests must include a second visible Run Builder entry");
assert(contestsRenderer.includes("contestEventCardsHtml(upcoming, runs)"), "Athlete Contests must show upcoming event run-plan actions and saved-run links");
assert(contestsRenderer.includes("runBuilderPanel([], { live: true, showRunList: false })"), "The live Run Builder must open inline without duplicating the saved-run library");
assert(contestsRenderer.includes("runPlansHtml(runs)"), "Athlete Contests must retain every saved run plan");
assert(!contestsRenderer.includes("runBuilderPanel(runs, { collapsed: true })"), "The released Run Builder must not remain buried in the old collapsed panel");
assert(functionBody("contestEventCardsHtml").includes("BUILD RUN PLAN"), "Every upcoming contest must be able to launch its own run plan");
const openRunBuilderBody = functionBody("openRunBuilder");
assert(openRunBuilderBody.includes("state.runBuilder ="), "Opening the Run Builder must initialise a new run");
assert(openRunBuilderBody.includes('planType: eventTitle ? "competition" : "training"'), "Event launches must seed a competition run");
assert(openRunBuilderBody.includes('scrollIntoView({ behavior: "smooth"'), "Opening the Run Builder must take the rider directly to it");
const runBuilderMarkup = functionBody("runBuilderPanel");
for (const control of ['id="run-photo"', 'id="run-map"', "PREVIEW FULL RUN", 'data-run-label="${index}"', "SAVE RUN TO CONTESTS", 'id="close-run-builder"']) {
  assert(runBuilderMarkup.includes(control), `Run Builder is missing ${control}`);
}
assert(runBuilderMarkup.includes("options.showRunList === false"), "The inline Run Builder must support a separate saved-run library");
const runBuilderBindings = functionBody("bindRunBuilderActions");
for (const binding of ["setRunBuilderPhoto", "addRunBuilderPoint", "startRunPointDrag", "playRunPreview", "saveRunPlan", "closeRunBuilder"]) {
  assert(runBuilderBindings.includes(binding), `Run Builder must bind ${binding}`);
}
const runPointColourForTest = new Function(`${functionBody("runPointColor")}; return runPointColor;`)();
assert.equal(runPointColourForTest(1), runPointColourForTest(5), "Run points 1–5 must share one route colour");
assert.notEqual(runPointColourForTest(5), runPointColourForTest(6), "The route colour must change after point 5");
assert.equal(runPointColourForTest(6), runPointColourForTest(10), "Run points 6–10 must share the next route colour");
assert.notEqual(runPointColourForTest(10), runPointColourForTest(11), "The route colour must change again after point 10");
for (const selector of [".contest-command", ".contest-event-card", ".contest-run-library", ".run-builder-live"]) {
  assert(css.includes(selector), `Contests release styling is missing ${selector}`);
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
assert(athleteCoachingBody.includes("getHelpRequests(state.user.id)"), "Athlete Coaching must load the signed-in rider's private history");
assert(athleteCoachingBody.includes("rememberCoachingReplies(requests)"), "Opening Coaching must mark returned feedback seen on this device");
assert(athleteCoachingBody.includes("helpUploadSection(requests)"), "Athlete Coaching must render the upload and feedback history");
assert(athleteCoachingBody.includes("bindHelpRequestForm()"), "Athlete Coaching must bind video uploads");
const helpUploadMarkup = functionBody("helpUploadSection");
assert(helpUploadMarkup.includes("Private coaching"), "The rider upload must identify its private audience");
assert(helpUploadMarkup.includes("Maximum 60 seconds and 50 MB"), "The rider upload must state its hosted limits");
assert(!helpUploadMarkup.includes("Private Riley"), "The live Coaching flow must not retain Riley-only wording");
assert(!helpUploadMarkup.includes("video-analysis-steps"), "The compact Coaching page must not restore the removed explainer section");
const athleteHomeBody = functionBody("renderAthleteHome");
assert(athleteHomeBody.includes("getHelpRequestSummaries(state.user.id)"), "Athlete Home must load lightweight Coaching reply status");
assert(athleteHomeBody.includes("athleteCoachingCtaHtml(coachingRequests)"), "Athlete Home must display the video-help action");
assert(athleteHomeBody.indexOf("rememberCoachingReplies(coachingRequests)") < athleteHomeBody.indexOf('navigate("coaching")'), "Opening Coaching must record visible replies before navigation");
const coachingCtaMarkup = functionBody("athleteCoachingCtaHtml");
assert(coachingCtaMarkup.includes("GET HELP — SEND VIDEO"), "Athlete Home must use the requested Coaching button label");
assert(coachingCtaMarkup.includes("unreadCoachingReplyCount(requests)"), "The Home Coaching button must calculate unseen replies");
assert(coachingCtaMarkup.includes("coaching-reply-badge"), "Returned coach feedback must create a notification badge on Home");
assert(functionBody("coachingReplySeenKey").includes("state.user?.id"), "Seen Coaching replies must be scoped to the signed-in rider");
assert(functionBody("rememberCoachingReplies").includes("localStorage.setItem"), "Seen Coaching replies must persist on the rider's device");
assert(functionBody("setupRealtimeSync").includes('"trick_help_requests"'), "Video request updates must arrive through realtime sync");
assert(functionBody("scheduleRealtimeRefresh").includes('state.view === "coaching"'), "Realtime coach replies must refresh the open Coaching screen");
assert(css.includes(".athlete-coaching-cta"), "Athlete Home needs released Coaching-card styling");
assert(css.includes(".coaching-reply-badge"), "Athlete Home needs visible unread-reply badge styling");
const submitHelpRequestBody = functionBody("submitHelpRequest");
assert(submitHelpRequestBody.includes('state.profile?.role !== "athlete"'), "Video Coaching uploads must require an athlete account");
assert(submitHelpRequestBody.includes("RIDER_VIDEO_MAX_BYTES"), "Rider video upload must enforce the hosted file limit");
assert(submitHelpRequestBody.includes("RIDER_VIDEO_MAX_SECONDS"), "Rider video upload must enforce the clip duration limit");
assert(submitHelpRequestBody.includes('state.view === "coaching"'), "Successful Coaching uploads must refresh the Coaching page");
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
assert(unloadedCoachReview.includes("Load private video"), "Every rider review must start with an intentional private-media load step");
assert(unloadedCoachReview.includes("Can’t &lt;land&gt; it"), "Rider questions must remain escaped in the coach workspace");
coachReviewTestState.videoReviewMedia.set("review-1", { video_url: "https://signed.example/video.mov" });
const signedOnlyCoachReview = renderCoachReviewWorkspace(coachReviewRequest);
assert(signedOnlyCoachReview.includes("Load private video"), "A signed URL alone must still offer authenticated Blob preparation for recording");
coachReviewTestState.videoReviewMedia.set("review-1", { video_url: "https://signed.example/video.mov", video_playback_url: "blob:private-video" });
const loadedCoachReview = renderCoachReviewWorkspace(coachReviewRequest);
assert(loadedCoachReview.includes('id="coach-review-video"'), "Loaded rider media must render in the analysis player");
assert(loadedCoachReview.includes('id="coach-review-canvas"'), "Loaded rider media must retain the drawing canvas");
assert(loadedCoachReview.includes("Open original"), "Loaded rider media must offer a browser fallback for phone MOV files");
assert(loadedCoachReview.includes("Voice + video + drawings"), "Loaded rider media must explain the combined review recording");
coachReviewTestState.videoReviewRecordedReplies.set("review-1", { file: { size: 2048 }, url: "blob:review", durationSeconds: 8 });
const recordedCoachReview = renderCoachReviewWorkspace(coachReviewRequest);
assert(recordedCoachReview.includes("Send recorded review to Riley"), "A finished review must be previewable and sendable through the private reply form");
assert(recordedCoachReview.includes("Remove recording"), "A coach must be able to discard an unsent recording");
const coachReviewRender = functionBody("renderVideoReviews");
assert(coachReviewRender.includes("coachReviewWorkspaceHtml(activeRequest)"), "Every selected rider submission must use the full review studio");
assert(!coachReviewRender.includes("isRileyCoachVideoCanary"), "The full coach review studio must not be gated to a test rider");
assert(coachReviewRender.includes("coachReviewQueueItemHtml"), "Coach reviews must provide a selectable rider inbox");
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
