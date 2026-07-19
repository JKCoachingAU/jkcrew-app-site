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
const manifestText = read("manifest.webmanifest");
const manifest = JSON.parse(manifestText);
const version = "2.11.51";

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
assert(serviceWorker.includes(`jkcrew-shell-v${version}`), "service worker cache should use the current version");

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

const coachNavBody = app.match(/const coachNav = \[([\s\S]*?)\];/)?.[1] || "";
assert.equal((coachNavBody.match(/\["/g) || []).length, 5, "Coach mobile navigation must have five items");
for (const label of ["Command", "Session", "Riders", "Coach Tools", "More"]) {
  assert(coachNavBody.includes(`"${label}"`), `Coach navigation is missing ${label}`);
}

const viewerTabs = app.match(/const sessionViewerListTabs = \[([\s\S]*?)\];/)?.[1] || "";
for (const tab of ["daily", "one_bang", "dialled", "percentage", "foam_pit", "bonus"]) {
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

const buttonsWithoutType = [...app.matchAll(/<button(?![^>]*\btype=)[^>]*>/g)].map((match) => match[0]);
assert.deepEqual(buttonsWithoutType, [], `Buttons need explicit types: ${buttonsWithoutType.join(", ")}`);
assert(css.includes("button:focus-visible"), "Keyboard focus styling should be present");
assert(css.includes("prefers-reduced-motion"), "Reduced-motion support should be present");
assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, "CSS braces should balance");

console.log("JKCREW smoke checks passed");
