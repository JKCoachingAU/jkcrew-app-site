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
const version = "2.13.6";

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
assert.equal((parentNavBody.match(/\["/g) || []).length, 3, "Parent navigation must keep three items");
for (const label of ["Home", "Tricktionary", "Profile"]) {
  assert(parentNavBody.includes(`"${label}"`), `Parent navigation is missing ${label}`);
}
assert(
  css.includes(".parent-shell .bottom-nav {\n  grid-template-columns: repeat(3, minmax(0, 1fr));"),
  "Parent bottom navigation must remain a three-column layout",
);
for (const tone of ["aqua", "blue", "violet", "gold", "coral"]) {
  assert(css.includes(`--parent-${tone}:`), `Parent palette is missing ${tone}`);
}
assert(css.includes(".parent-shell .parent-child-card"), "Parent linked-rider cards should use the parent visual system");
assert(css.includes(".parent-shell .push-settings-card"), "Parent profile controls should use the parent visual system");
assert(!css.includes(".parent-shell .parent-readonly { pointer-events: none; }"), "Read-only parent content must still allow accordion navigation");
assert(functionBody("renderParentHome").includes("assignmentGroups(assignments, false)"), "Parent schedules must remain read-only");
assert(!functionBody("renderParentTricktionary").includes("editable: true"), "Parent Tricktionary must remain read-only");

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
assert(app.includes('const RILEY_VIDEO_ANALYSIS_TEST_ACCOUNT_ID = "e230a5a6-68ad-4362-b410-b52f45f58e57"'), "Video Analysis canary must use Riley's immutable account id");
assert(app.includes('state.profile?.role === "athlete"'), "Video Analysis canary must require an athlete profile");
assert(functionBody("handleSession(").includes("!isRileyTestRoute()"), "Riley should be routed to the isolated test path from the main app");
const riderSessionBody = functionBody("renderSession");
assert(riderSessionBody.includes("isRileyVideoAnalysisTester()"), "Rider Session must gate Video Analysis to Riley");
assert(riderSessionBody.includes("getHelpRequests(state.user.id)"), "Riley Session must load private video-review history");
assert.equal((riderSessionBody.match(/\$\{videoAnalysisSection\}/g) || []).length, 2, "Both idle and active Rider Session layouts must place Video Analysis at the bottom");
assert.equal((riderSessionBody.match(/bindHelpRequestForm\(\)/g) || []).length, 2, "Both Rider Session layouts must bind Video Analysis uploads");
assert(functionBody("helpUploadSection").includes("Private Riley test · not live for other riders"), "The canary must identify itself clearly");
assert(functionBody("submitHelpRequest").includes("VIDEO_ANALYSIS_TEST_MAX_BYTES"), "Rider video upload must enforce the hosted file limit");
assert(functionBody("submitHelpRequest").includes("VIDEO_ANALYSIS_TEST_MAX_SECONDS"), "Rider video upload must enforce the clip duration limit");
assert(functionBody("submitHelpRequest").includes('state.view === "session"'), "Successful Session uploads must keep the rider on Session");
assert(functionBody("uploadHelpVideoFile").includes("uploadHelpVideoResumable"), "Phone videos above 6MB must use resumable upload");
assert(functionBody("loadTusClient").includes("TUS_CLIENT_INTEGRITY"), "The pinned resumable uploader must verify its CDN integrity");
assert(rileyServiceWorker.includes('const CACHE_PREFIX = "jkcrew-riley-shell-"'), "Riley test cache must not delete the production app cache");
const videoCanaryMigration = read("supabase/migrations/20260827004923_harden_rider_video_analysis_canary.sql");
assert(videoCanaryMigration.includes("file_size_limit = 52428800"), "Video bucket must match the hosted 50MB ceiling");
assert(videoCanaryMigration.includes("allowed_mime_types"), "Video bucket must enforce media types");
assert(videoCanaryMigration.includes('"Trick help video owners can delete"'), "Failed uploads need owner cleanup permission");
assert(videoCanaryMigration.includes("ca.coach_id = trick_help_requests.coach_id"), "Rider requests must target their linked coach");
assert.equal(read("riley-test/app.js"), app, "Riley test path must use the same all-user app bundle");
assert.equal(read("riley-test/styles.css"), css, "Riley test path must use the same all-user styles");

const buttonsWithoutType = [...app.matchAll(/<button(?![^>]*\btype=)[^>]*>/g)].map((match) => match[0]);
assert.deepEqual(buttonsWithoutType, [], `Buttons need explicit types: ${buttonsWithoutType.join(", ")}`);
assert(css.includes("button:focus-visible"), "Keyboard focus styling should be present");
assert(css.includes("prefers-reduced-motion"), "Reduced-motion support should be present");
assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, "CSS braces should balance");

console.log("JKCREW smoke checks passed");
