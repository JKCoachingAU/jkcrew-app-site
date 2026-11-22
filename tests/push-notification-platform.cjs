// Executes the shipped page settings and worker callbacks with synthetic
// notification events. No browser permission prompt or actual device push.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const vibratingTypes = [
  "list_request_sent", "list_request_approved", "video_review_requested", "video_review_returned",
  "event_run_planned", "rider_run_saved", "coach_run_saved", "leaderboard_overtaken",
  "coach_leaderboard_overtake", "uci_rankings_published", "notification_test",
];

async function verifyWorker(directory) {
  const handlers = new Map();
  const shown = [];
  const opened = [];
  const scope = "https://jkcrew.test/app/";
  const self = {
    location: new URL("sw.js", scope),
    addEventListener: (name, handler) => handlers.set(name, handler),
    registration: {
      scope,
      async showNotification(title, options) { shown.push({ title, options }); },
    },
    clients: {
      async matchAll() { return []; },
      async openWindow(url) { opened.push(url); },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(directory, "sw.js"), "utf8"), { self, URL });

  async function dispatch(name, event) {
    let waited;
    handlers.get(name)({ ...event, waitUntil(promise) { waited = promise; } });
    assert(waited, `${name} keeps the worker alive`);
    await waited;
  }

  for (const type of vibratingTypes) {
    const payload = {
      type, title: "Synthetic alert", body: "Synthetic update",
      notificationId: `${type}-fixture`, view: "contests", url: "./?push=contests",
    };
    await dispatch("push", { data: { json: () => payload } });
    const { title, options } = shown.at(-1);
    assert.equal(title, payload.title);
    assert.equal(options.body, payload.body);
    assert.deepEqual(Array.from(options.vibrate), [120, 70, 160], `${type} requests the short vibration pattern`);
    assert.equal(options.silent, false, `${type} permits default device sound`);
    assert.equal(options.tag, payload.notificationId);
    assert.equal(options.renotify, false);
    assert.equal(options.data.view, "contests");
  }

  for (const type of ["daily_hype", "crew_chat", "recovery_checkin_reminder", "uci_qualification_update"]) {
    await dispatch("push", { data: { json: () => ({ type }) } });
    const options = shown.at(-1).options;
    assert(!Object.hasOwn(options, "vibrate"), `${type} keeps its previous vibration behavior`);
    assert.equal(options.silent, false);
    assert.equal(options.renotify, type === "crew_chat");
    assert.equal(options.data.recoveryPage, type === "recovery_checkin_reminder" ? "today" : undefined);
  }

  await dispatch("push", { data: { json() { throw new SyntaxError("fixture"); }, text: () => "Plain update" } });
  assert.equal(shown.at(-1).options.body, "Plain update");
  assert(!Object.hasOwn(shown.at(-1).options, "vibrate"));

  await dispatch("push", { data: { json: () => ({ type: "uci_rankings_published", view: "board", url: "./?push=board" }) } });
  let closed = false;
  await dispatch("notificationclick", {
    notification: { data: shown.at(-1).options.data, close() { closed = true; } },
  });
  assert(closed);
  assert.deepEqual(opened, [`${scope}?push=board`], "Click opens the existing leaderboard route");
}

async function verifySettings(directory) {
  const app = fs.readFileSync(path.join(directory, "app.js"), "utf8");
  const start = app.indexOf("async function getPushNotificationState()");
  const end = app.indexOf("async function savePushPreferences(", start);
  assert(start >= 0 && end > start);
  const state = { user: { id: "synthetic-coach" }, profile: { role: "coach" } };
  let preferenceColumns;
  const context = vm.createContext({
    state,
    client: {
      from(table) {
        assert.equal(table, "push_preferences");
        return {
          select(columns) { preferenceColumns = columns; return this; },
          eq(field, id) { assert.equal(field, "user_id"); assert.equal(id, state.user.id); return this; },
          async maybeSingle() { return { data: { coach_rank_updates: false }, error: null }; },
        };
      },
    },
    navigator: { serviceWorker: {
      async getRegistration() {
        return { pushManager: { async getSubscription() { return {}; } } };
      },
    } },
    Notification: { permission: "granted" },
    supportsPushNotifications: () => true,
    isCoachRole: role => ["admin", "coach"].includes(role),
    notificationSoundEnabled: () => false,
    escapeHtml: value => String(value),
    document: {
      querySelector: selector => selector.includes("coach_rank_updates") ? { checked: false } : null,
    },
  });
  vm.runInContext(app.slice(start, end), context);
  const settings = await context.getPushNotificationState();
  assert(preferenceColumns.split(",").includes("coach_rank_updates"));
  assert.equal(settings.preferences.coach_rank_updates, false);
  const coachPage = context.pushNotificationSettingsHtml(settings);
  assert.match(coachPage, /data-push-preference="coach_rank_updates"\s*>/);
  assert.match(coachPage, /weekly UCI rankings/);
  assert.match(coachPage, /Your device controls background alert sounds and vibration/);
  assert.equal(context.currentPushPreferences().coach_rank_updates, false);

  state.profile.role = "athlete";
  const riderPage = context.pushNotificationSettingsHtml(settings);
  assert.doesNotMatch(riderPage, /weekly UCI rankings|coach_rank_updates/);
  assert(!Object.hasOwn(context.currentPushPreferences(), "coach_rank_updates"));
}

(async () => {
  const root = path.resolve(__dirname, "..");
  for (const directory of [root, path.join(root, "riley-test")]) {
    await verifyWorker(directory);
    await verifySettings(directory);
  }
  console.log("PASS: notification haptics, navigation and role-specific settings in both app entry points");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
