const SUPABASE_URL = "https://soanwttlorlgdfrzbvtp.supabase.co";
const SUPABASE_KEY = "sb_publishable_Y93G0kTt_csEsNzDl9NFEA_0h5UElXh";
const GIPHY_API_KEY = String(window.JKCREW_CONFIG?.giphyApiKey || window.JKCREW_GIPHY_API_KEY || "").trim();
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const installButton = document.querySelector("#install-app");
let deferredInstallPrompt = null;
const state = {
  session: null,
  user: null,
  profile: null,
  view: "home",
  activeTraining: null,
  attempts: [],
  trickStartedAt: Date.now(),
  timer: null,
  selectedAthleteId: null,
  publicAthleteId: null,
  selectedVenue: "",
  sessionViewerGroup: "monday",
  sessionViewerVenue: "",
  sessionViewerSearch: "",
  sessionViewerOpenAthleteId: "",
  sessionViewerActiveList: "daily",
  sessionViewerTimer: null,
  sessionViewerClock: null,
  sessionViewerRosterCache: [],
  sessionViewerActiveSessionCache: null,
  runBuilder: null,
  runPlaybackTimer: null,
  draggedRunPoint: null,
  coachPlanVenue: "",
  boardLeaderboardView: "weekly",
  leaderboardFallbackNotified: false,
  videoReviewStatus: "all",
  videoReviewRider: "all",
  videoReviewSearch: "",
  videoReviewMedia: new Map(),
  realtimeChannel: null,
  syncRefreshTimer: null,
};

const athleteNav = [
  ["home", "Home"],
  ["session", "Session"],
  ["tricktionary", "My Tricktionary"],
  ["contests", "Contests"],
  ["board", "Board"],
  ["profile", "Profile"],
];
const coachNav = [
  ["command", "Command"],
  ["sessionViewer", "Session Viewer"],
  ["crew", "Students"],
  ["parents", "Parents"],
  ["videoReviews", "Video Reviews"],
  ["board", "Board"],
  ["profile", "Profile"],
];
const parentNav = [
  ["home", "Home"],
  ["tricktionary", "Tricktionary"],
  ["profile", "Profile"],
];

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const initials = (name = "JK") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "JK";
const dateLabel = (value) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const formatPbTime = (seconds) => Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? formatTime(Number(seconds)) : "-";
const parsePbSeconds = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return NaN;
  return (Number(match[1]) * 60) + Number(match[2]);
};
const brisbaneDateParts = (date = new Date()) => new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Brisbane",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
}).formatToParts(date).reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {});
const localDate = () => {
  const parts = brisbaneDateParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const weekStartDate = () => {
  const parts = brisbaneDateParts();
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
};
const weekStartIso = () => `${weekStartDate()}T00:00:00+10:00`;
const weekEndDate = () => new Date(new Date(weekStartIso()).getTime() + (6 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
const weekLabel = () => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Brisbane" }).format(new Date(`${weekStartDate()}T00:00:00+10:00`));
const messageFrom = (error) => {
  const message = error?.message || String(error || "");
  if (/522|timed out|timeout|failed to fetch|network|connection/i.test(message)) {
    return "JKCREW backend is not responding right now. Please try again in a minute.";
  }
  return message || "Something went wrong. Please try again.";
};
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const isSafari = () => /safari/i.test(window.navigator.userAgent) && !/chrome|crios|android/i.test(window.navigator.userAgent);
const avatarUrl = (profile = {}) => profile.avatar?.dataUrl || "";
const normalizedTheme = (value) => value === "light" ? "light" : "dark";
function applyTheme(value = "dark") {
  const theme = normalizedTheme(value);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f4f1ea" : "#050706");
  try {
    localStorage.setItem("jkcrew-theme", theme);
  } catch {
    // Theme still applies for this session if storage is blocked.
  }
}
const firstName = (profile = {}) => String(profile.display_name || "This rider").split(/\s+/).filter(Boolean)[0] || "This rider";
const isCoachRole = (role) => ["coach", "admin"].includes(role);
const linesHtml = (value = "", emptyText = "Not added yet") => {
  const lines = String(value || "").split(/\n|,/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : `<p class="subcopy">${escapeHtml(emptyText)}</p>`;
};
const medalForRank = (row, index, total, pointsKey = "weekly_points") => {
  const medals = ["🥇", "🥈", "🥉"];
  if (index >= 0 && index < 3 && Number(row[pointsKey] || 0) > 0) return `<span class="rank-medal" title="Top ${index + 1}">${medals[index]}</span>`;
  if (total > 1 && index === total - 1) return `<span class="rank-medal last-place" title="Last place">💩</span>`;
  return "";
};
const earnedBadges = (value) => Array.isArray(value) ? value : [];
const badgeChipHtml = (badge, className = "") => {
  if (!badge) return "";
  const icon = badge.icon || "★";
  const label = badge.label || badge;
  return `<span class="public-badge ${className}" title="${escapeHtml(badge.description || label)}"><span>${escapeHtml(icon)}</span>${escapeHtml(label)}</span>`;
};
const badgeStripHtml = (badges, emptyText = "No earned badges yet") => {
  const items = earnedBadges(badges);
  if (items.length) return items.map((badge) => badgeChipHtml(badge)).join("");
  return emptyText ? `<span class="public-badge muted-badge">${escapeHtml(emptyText)}</span>` : "";
};
const motivationalQuotes = [
  { quote: "Pressure is a privilege.", by: "Billie Jean King", role: "Tennis champion" },
  { quote: "Do not count the days. Make the days count.", by: "Muhammad Ali", role: "Boxing champion" },
  { quote: "You miss 100% of the shots you do not take.", by: "Wayne Gretzky", role: "Ice hockey champion" },
  { quote: "Hard work beats talent when talent fails to work hard.", by: "Tim Notke", role: "Coach" },
  { quote: "The more difficult the victory, the greater the happiness in winning.", by: "Pelé", role: "Football legend" },
  { quote: "I am building a fire, and every day I train, I add more fuel.", by: "Mia Hamm", role: "Football champion" },
  { quote: "I do not run away from a challenge because I am afraid.", by: "Nadia Comaneci", role: "Gymnastics champion" },
  { quote: "The key is not the will to win. It is the will to prepare to win.", by: "Bobby Knight", role: "Basketball coach" },
  { quote: "Excellence is the gradual result of always striving to do better.", by: "Pat Riley", role: "Basketball coach" },
  { quote: "I have failed over and over again. That is why I succeed.", by: "Michael Jordan", role: "Basketball champion" },
  { quote: "Everything negative is all an opportunity for me to rise.", by: "Kobe Bryant", role: "Basketball champion" },
  { quote: "I really think a champion is defined by not giving up.", by: "Serena Williams", role: "Tennis champion" },
  { quote: "I would like to be remembered as someone who was not afraid to do what she wanted.", by: "Simone Biles", role: "Gymnastics champion" },
  { quote: "The biggest sin in the world would be if I lost my love for the ocean.", by: "Laird Hamilton", role: "Big-wave surfer" },
  { quote: "Life is a lot like skateboarding.", by: "Tony Hawk", role: "Skateboarding legend" },
  { quote: "Winning means you are willing to go longer, work harder, and give more.", by: "Vince Lombardi", role: "Football coach" },
  { quote: "The difference between the impossible and the possible lies in determination.", by: "Tommy Lasorda", role: "Baseball coach" },
  { quote: "The harder the battle, the sweeter the victory.", by: "Les Brown", role: "Coach and speaker" },
  { quote: "A champion is afraid of losing. Everyone else is afraid of winning.", by: "Billie Jean King", role: "Tennis champion" },
  { quote: "It is not whether you get knocked down. It is whether you get up.", by: "Vince Lombardi", role: "Football coach" },
];
const randomQuote = () => motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
const defaultVenues = ["Pizzey", "Beenleigh", "Elanora", "Nerang", "RampFest", "Other / Custom Venue"];
const venueKey = (venue = "") => String(venue || "").trim();
const venueLabel = (venue = "") => venueKey(venue) || "Default Daily List";

function avatarHtml(profile = {}, className = "") {
  const image = avatarUrl(profile);
  const safeName = escapeHtml(profile.display_name || "Athlete");
  return image
    ? `<div class="avatar image-avatar ${className}"><img src="${escapeHtml(image)}" alt="${safeName} profile picture"></div>`
    : `<div class="avatar ${className}">${escapeHtml(initials(profile.display_name))}</div>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function safeFileName(value = "jkcrew-video") {
  const clean = String(value || "jkcrew-video").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "jkcrew-video";
}

function dataUrlVideoExtension(dataUrl = "") {
  const match = String(dataUrl).match(/^data:video\/([^;]+);/);
  const ext = (match?.[1] || "mp4").toLowerCase();
  return ext === "quicktime" ? "mov" : ext.replace(/[^a-z0-9]/g, "") || "mp4";
}

function downloadDataUrl(dataUrl, filename = "jkcrew-video") {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${safeFileName(filename)}.${dataUrlVideoExtension(dataUrl)}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function videoDurationSeconds(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration || 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video duration."));
    };
    video.src = url;
  });
}

function notify(message, type = "ok") {
  toast.textContent = message;
  toast.className = `toast show ${type === "error" ? "error" : ""}`;
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => { toast.className = "toast"; }, 3600);
}

function celebrate(message) {
  notify(message);
  const existing = document.querySelector(".success-burst");
  existing?.remove();
  const burst = document.createElement("div");
  burst.className = "success-burst";
  burst.innerHTML = `<strong>Daily Tricks Complete</strong><span>${escapeHtml(message)}</span>`;
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 4200);
}

function updateInstallButton() {
  installButton.classList.toggle("hidden", isStandalone());
}

async function installApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallButton();
    if (outcome === "accepted") notify("JK Coaching is being installed.");
    return;
  }

  if (isIos()) {
    window.alert("To install JK Coaching: tap the Share button, then choose Add to Home Screen.");
    return;
  }

  if (isSafari()) {
    window.alert("To install JK Coaching in Safari: choose File, then Add to Dock.");
    return;
  }

  window.alert("To install JK Coaching: open your browser menu and choose Install JK Coaching or Add to Home Screen.");
}

function setLoading(label = "Loading") {
  const view = document.querySelector("#view");
  if (view) view.innerHTML = `<div class="loading">${escapeHtml(label)}...</div>`;
}

function withTimeout(promise, label = "Request", ms = 6000) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out. Check your connection and try again.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function clearLocalAuthSession() {
  try {
    Object.keys(window.localStorage || {}).forEach((key) => {
      if (key.startsWith("sb-") || key.includes("supabase.auth")) localStorage.removeItem(key);
    });
  } catch (error) {
    console.warn("Unable to clear saved JKCREW session.", error);
  }
}

async function init() {
  renderAuth("login", "Checking JKCREW connection...");
  let session = null;
  try {
    const result = await withTimeout(client.auth.getSession(), "Sign in check", 4000);
    session = result.data?.session || null;
  } catch (error) {
    renderAuth("login", messageFrom(error));
    return;
  }
  await handleSession(session);
  client.auth.onAuthStateChange(async (_event, nextSession) => {
    if (nextSession?.user?.id !== state.user?.id || !nextSession) await handleSession(nextSession);
  });
}

function renderBootRecovery(message = "The app could not finish loading.") {
  app.innerHTML = `
    <div class="boot-screen boot-recovery">
      <div class="brand-mark boot-logo-mark"><img src="icons/jkc-logo.png?v=2.10.2" alt="JK Coaching logo"></div>
      <h1>JKCREW is having trouble loading</h1>
      <p>${escapeHtml(message)}</p>
      <div class="boot-actions">
        <button class="primary-btn" type="button" id="boot-retry">Try again</button>
        <button class="secondary-btn" type="button" id="boot-signout">Reset login on this device</button>
      </div>
    </div>`;
  document.querySelector("#boot-retry")?.addEventListener("click", () => window.location.reload());
  document.querySelector("#boot-signout")?.addEventListener("click", async () => {
    clearLocalAuthSession();
    window.location.reload();
  });
}

async function handleSession(session) {
  clearInterval(state.timer);
  teardownRealtimeSync();
  state.session = session;
  state.user = session?.user || null;
  state.profile = null;
  state.activeTraining = null;
  state.attempts = [];
  if (!state.user) {
    applyTheme("dark");
    renderAuth();
    return;
  }
  let { data, error } = await withTimeout(
    client.from("profiles").select("*").eq("id", state.user.id).maybeSingle(),
    "Profile load"
  );
  if (error || !data) {
    const { data: recovered, error: recoveryError } = await withTimeout(
      client.rpc("ensure_current_profile"),
      "Profile recovery"
    );
    if (recoveryError || !recovered) {
      renderBootRecovery("Your account is signed in, but your JKCREW profile did not load. Try again or sign out and back in.");
      notify(messageFrom(recoveryError || error || "Profile failed to load."), "error");
      return;
    }
    data = recovered;
  }
  state.profile = data;
  applyTheme(data.app_theme);
  state.view = isCoachRole(data.role) ? "command" : "home";
  setupRealtimeSync();
  renderShell();
  navigate(state.view);
}

function renderAuth(mode = "login", message = "") {
  app.innerHTML = `
    <div class="auth-page">
      <section class="auth-hero">
        <div class="auth-logo-stack">
          <div class="auth-logo-lockup badge-lockup"><img src="icons/jkc-logo.png?v=2.10.2" alt="JK Coaching badge"><span>JKCoaching</span></div>
          <div class="auth-logo-lockup wordmark-lockup"><img src="icons/jkcoaching-wordmark.png?v=2.10.2" alt="JKCoaching logo"></div>
        </div>
        <div class="hero-copy">
          <div class="eyebrow">JKCREW coaching academy</div>
          <h1>Crafting <em>talent,</em><br> shaping futures.</h1>
          <p>Weekly trick plans, attempt tracking, private progress history, and coach feedback built for serious BMX progression.</p>
        </div>
        <div class="feature-strip"><span>Weekly plans</span><span>Private progress</span><span>Coach feedback</span><span>Future focused</span></div>
      </section>
  <section class="auth-panel">
        <div class="auth-card">
          <div class="eyebrow">Welcome to JKCREW</div>
          <h2>${mode === "login" ? "Sign in" : "Join the crew"}</h2>
          <p class="subcopy">${mode === "login" ? "Pick up where you left off." : "Create your athlete or parent account."}</p>
          <div class="auth-tabs">
            <button class="auth-tab ${mode === "login" ? "active" : ""}" data-auth-mode="login">Sign in</button>
            <button class="auth-tab ${mode === "signup" ? "active" : ""}" data-auth-mode="signup">Create account</button>
          </div>
          <form id="auth-form">
            <div class="field ${mode === "signup" ? "" : "hidden"}">
              <label for="display-name">Display name</label>
              <input id="display-name" name="displayName" autocomplete="name" placeholder="Riley Chen">
            </div>
            <div class="field ${mode === "signup" ? "" : "hidden"}">
              <label for="role">Account type</label>
              <select id="role" name="role"><option value="athlete">Athlete</option><option value="parent">Parent viewer</option></select>
            </div>
            <div class="field">
              <label for="email">Email</label>
              <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com">
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" required minlength="8" autocomplete="${mode === "login" ? "current-password" : "new-password"}" placeholder="At least 8 characters">
            </div>
            <button class="primary-btn wide" type="submit">${mode === "login" ? "Enter JKCREW" : "Create my account"}</button>
            <div class="auth-message ${/backend|connection|timed out|responding/i.test(message) ? "auth-warning" : ""}">${escapeHtml(message)}</div>
          </form>
        </div>
      </section>
    </div>`;
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => renderAuth(button.dataset.authMode)));
  document.querySelector("#auth-form").addEventListener("submit", (event) => handleAuth(event, mode));
}

async function handleAuth(event, mode) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = form.get("email").trim();
  const password = form.get("password");
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = mode === "login" ? "Signing in..." : "Creating account...";

  try {
    if (mode === "login") {
      const { error } = await withTimeout(client.auth.signInWithPassword({ email, password }), "Sign in");
      if (error) renderAuth(mode, messageFrom(error));
      return;
    }

    const displayName = form.get("displayName").trim();
    const role = form.get("role");
    if (!displayName) {
      renderAuth(mode, "Please add a display name.");
      return;
    }
    const { data: signupData, error: signupError } = await withTimeout(
      client.functions.invoke("create-jkcrew-account", {
        body: { email, password, displayName, role, website: "" },
      }),
      "Create account"
    );
    if (signupError || signupData?.error) {
      const signupMessage = signupData?.error || messageFrom(signupError);
      renderAuth(mode, signupMessage.includes("already") ? "An account with that email already exists. Try signing in." : signupMessage);
      return;
    }

    const { error: signInError } = await withTimeout(client.auth.signInWithPassword({ email, password }), "Sign in");
    if (signInError) {
      renderAuth("login", "Account created. Sign in with your new email and password.");
      return;
    }
    notify("Welcome to JKCREW. Your account is ready.");
  } catch (error) {
    renderAuth(mode, messageFrom(error));
  }
}

function renderShell() {
  const role = state.profile.role;
  const nav = isCoachRole(role) ? coachNav : role === "parent" ? parentNav : athleteNav;
  const navIcons = { home: "⌂", session: "↗", tricktionary: "+", contests: "🏆", crew: "✦", command: "◇", parents: "P", videoReviews: "▣", board: "#", profile: "●", notes: "✎" };
  const navHtml = nav.map(([id, label]) => `<button class="nav-btn" data-view="${id}"><span class="nav-icon">${navIcons[id] || "•"}</span><span>${label}</span></button>`).join("");
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand logo-sidebar-brand"><img src="icons/jkc-logo.png?v=2.10.2" alt="JK Coaching logo"><span>JK Coaching</span></div>
        <div class="role-pill">${escapeHtml(role)} account</div>
        <nav class="nav-list">${navHtml}</nav>
        <div class="sidebar-user">${avatarHtml(state.profile, "sidebar-avatar")}<strong>${escapeHtml(state.profile.display_name)}</strong><span>${escapeHtml(state.user.email)}</span></div>
      </aside>
      <div class="main-wrap">
        <header class="topbar">
          <div class="topbar-title"><img class="topbar-logo" src="icons/jkc-logo.png?v=2.10.2" alt="">JKCREW live</div>
          <div class="topbar-meta">${new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" }).format(new Date())}</div>
        </header>
        <main id="view" class="content"></main>
      </div>
      <nav class="bottom-nav">${navHtml}</nav>
    </div>`;
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
}

async function navigate(view) {
  clearInterval(state.timer);
  if (state.sessionViewerTimer) {
    clearInterval(state.sessionViewerTimer);
    state.sessionViewerTimer = null;
  }
  if (state.sessionViewerClock) {
    clearInterval(state.sessionViewerClock);
    state.sessionViewerClock = null;
  }
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  setLoading();
  const renders = {
    home: state.profile?.role === "parent" ? renderParentHome : renderAthleteHome,
    session: renderSession,
    tricktionary: renderTricktionary,
    command: renderCoachCommand,
    sessionViewer: renderSessionViewer,
    parents: renderParents,
    videoReviews: renderVideoReviews,
    board: renderBoard,
    crew: isCoachRole(state.profile?.role) ? renderCrew : renderAthleteCrew,
    contests: renderContests,
    student: renderStudentProfile,
    studentPreview: () => renderCoachPreview("student"),
    parentPreview: () => renderCoachPreview("parent"),
    publicProfile: renderPublicAthleteProfile,
    notes: renderNotes,
    profile: renderProfile,
  };
  try {
    await renders[view]();
  } catch (error) {
    document.querySelector("#view").innerHTML = `<div class="empty">Could not load this screen.</div>`;
    notify(messageFrom(error), "error");
  }
}

function teardownRealtimeSync() {
  if (state.syncRefreshTimer) {
    clearTimeout(state.syncRefreshTimer);
    state.syncRefreshTimer = null;
  }
  if (state.realtimeChannel) {
    client.removeChannel(state.realtimeChannel).catch((error) => console.warn("Realtime channel cleanup failed", error));
    state.realtimeChannel = null;
  }
}

function setupRealtimeSync() {
  if (!state.user?.id || !state.session?.access_token) return;
  client.realtime.setAuth(state.session.access_token);
  const channel = client.channel(`jkcrew-progress-sync:${state.user.id}`);
  [
    "assignment_progress",
    "assignment_point_awards",
    "percentage_attempts",
    "assignment_attempts",
    "weekly_trick_assignments",
    "leaderboard_point_adjustments",
    "training_sessions",
    "coach_group_session_participants",
    "run_checklist_progress",
    "profiles",
  ].forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
      if (table === "profiles" && payload.new?.id === state.user.id) state.profile = { ...state.profile, ...payload.new };
      scheduleRealtimeRefresh(table);
    });
  });
  channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn("Realtime progress sync status:", status);
  });
  state.realtimeChannel = channel;
}

function scheduleRealtimeRefresh(reason = "sync") {
  if (!state.user?.id || !state.profile) return;
  if (state.syncRefreshTimer) clearTimeout(state.syncRefreshTimer);
  state.syncRefreshTimer = setTimeout(async () => {
    state.syncRefreshTimer = null;
    if (!state.user?.id || !state.profile) return;
    try {
      if (state.view === "session") await renderSession();
      else if (state.view === "sessionViewer") await refreshSessionViewerLight();
      else if (state.view === "board") await renderBoard();
      else if (state.view === "home") {
        if (state.profile.role === "parent") await renderParentHome();
        else if (state.profile.role === "athlete") await renderAthleteHome();
      } else if (state.view === "crew" && isCoachRole(state.profile.role)) {
        await renderCrew();
      } else if (state.view === "student" && state.selectedAthleteId) await renderStudentProfile();
      else if (state.view === "publicProfile" && state.publicAthleteId) await renderPublicAthleteProfile();
    } catch (error) {
      console.warn("Realtime refresh failed", reason, error);
    }
  }, 450);
}

async function getLeaderboard() {
  const { data, error } = await client.rpc("get_weekly_leaderboard");
  if (error) {
    console.error("Leaderboard RPC failed", error);
    return getLeaderboardFallback(error);
  }
  state.leaderboardFallbackNotified = false;
  const rows = data || [];
  const ids = rows.map((row) => row.athlete_id).filter(Boolean);
  if (!ids.length) return rows;
  const { data: profiles, error: profileError } = await client.from("profiles").select("id, daily_pb_seconds, manual_tricktionary").in("id", ids);
  if (profileError) console.warn("Leaderboard profile extras failed", profileError);
  const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
  return rows.map((row) => ({ ...row, daily_pb_seconds: row.daily_pb_seconds ?? byId.get(row.athlete_id)?.daily_pb_seconds ?? null }));
}

async function getLeaderboardFallback(cause) {
  const { data: profiles, error } = await client
    .from("profiles")
    .select("id, display_name, role, avatar_url, avatar, country_code, country_name, daily_pb_seconds")
    .eq("role", "athlete")
    .order("display_name", { ascending: true });
  if (error) {
    console.error("Leaderboard fallback failed", error);
    notify(messageFrom(cause || error), "error");
    return [];
  }

  const rows = (profiles || []).map((profile) => ({
    athlete_id: profile.id,
    display_name: profile.display_name || "Athlete",
    level: 1,
    avatar_url: profile.avatar_url || "",
    avatar: profile.avatar || {},
    country_code: profile.country_code || "",
    country_name: profile.country_name || "",
    weekly_points: 0,
    all_time_points: 0,
    session_count: 0,
    earned_badges: [],
    daily_pb_seconds: profile.daily_pb_seconds ?? null,
  }));

  if (!state.leaderboardFallbackNotified) {
    state.leaderboardFallbackNotified = true;
    notify("Leaderboard is temporarily using a safe fallback while scores reload.", "error");
  }
  return rows;
}

async function getPointHistory(athleteId) {
  const { data, error } = await client.rpc("get_point_history", { p_athlete_id: athleteId });
  if (error) throw error;
  return data || [];
}

async function getAssignmentAttempts(athleteId, sinceIso = weekStartIso()) {
  const { data, error } = await client.from("assignment_attempts").select("*").eq("athlete_id", athleteId).gte("attempted_at", sinceIso).order("attempted_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getTricktionaryData(athleteId) {
  const [profileResult, assignmentsResult, progressResult, attemptsResult, sessionsResult, awardsResult, percentageAttemptsResult] = await Promise.all([
    client.from("profiles").select("*").eq("id", athleteId).single(),
    client.from("weekly_trick_assignments").select("*").eq("athlete_id", athleteId).order("week_start", { ascending: false }).order("sort_order", { ascending: true }).limit(400),
    client.from("assignment_progress").select("*").eq("athlete_id", athleteId),
    client.from("assignment_attempts").select("*").eq("athlete_id", athleteId).order("attempted_at", { ascending: false }).limit(600),
    client.from("training_sessions").select("*").eq("athlete_id", athleteId).order("started_at", { ascending: false }).limit(60),
    client.from("assignment_point_awards").select("*").eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(600),
    client.from("percentage_attempts").select("*").eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(900),
  ]);
  [profileResult, assignmentsResult, progressResult, attemptsResult, sessionsResult, awardsResult, percentageAttemptsResult].forEach((result) => { if (result.error) throw result.error; });
  return {
    profile: profileResult.data,
    assignments: assignmentsResult.data || [],
    progress: progressResult.data || [],
    attempts: attemptsResult.data || [],
    sessions: sessionsResult.data || [],
    awards: awardsResult.data || [],
    percentageAttempts: percentageAttemptsResult.data || [],
  };
}

async function getPublicAthleteProfile(athleteId) {
  const { data, error } = await client.rpc("get_public_athlete_profile", { p_athlete_id: athleteId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function getWeeklyAssignments(athleteId) {
  if (state.user?.id) {
    const { error: rolloverError } = await client.rpc("ensure_current_week_assignments", {
      p_athlete_id: athleteId,
      p_week_start: weekStartDate(),
    });
    if (rolloverError && !/not allowed/i.test(rolloverError.message || "")) {
      throw rolloverError;
    }
  }
  const [{ data, error }, { data: progress, error: progressError }, { data: awards, error: awardsError }, { data: percentageAttempts, error: percentageError }, { data: assignmentAttempts, error: attemptError }] = await Promise.all([
    client.from("weekly_trick_assignments").select("*").eq("athlete_id", athleteId).eq("week_start", weekStartDate()).order("sort_order", { ascending: true }),
    client.from("assignment_progress").select("*").eq("athlete_id", athleteId),
    client.from("assignment_point_awards").select("*").eq("athlete_id", athleteId).gte("created_at", weekStartIso()),
    client.from("percentage_attempts").select("*").eq("athlete_id", athleteId).order("attempt_number", { ascending: true }),
    client.from("assignment_attempts").select("*").eq("athlete_id", athleteId).eq("week_start", weekStartDate()).order("attempted_at", { ascending: false }),
  ]);
  if (error) throw error;
  if (progressError) throw progressError;
  if (awardsError) throw awardsError;
  if (percentageError) throw percentageError;
  if (attemptError) throw attemptError;
  const progressById = new Map((progress || []).map((entry) => [entry.assignment_id, entry]));
  const attemptsById = new Map();
  (percentageAttempts || []).forEach((attempt) => {
    const entries = attemptsById.get(attempt.assignment_id) || [];
    entries.push(attempt);
    attemptsById.set(attempt.assignment_id, entries);
  });
  const assignmentAttemptsById = new Map();
  (assignmentAttempts || []).forEach((attempt) => {
    const entries = assignmentAttemptsById.get(attempt.assignment_id) || [];
    entries.push(attempt);
    assignmentAttemptsById.set(attempt.assignment_id, entries);
  });
  return {
    assignments: (data || []).filter((assignment) => categoryInfo[assignment.category]).map((assignment) => ({ ...assignment, progress: progressById.get(assignment.id) || null, percentageAttempts: attemptsById.get(assignment.id) || [], assignmentAttempts: assignmentAttemptsById.get(assignment.id) || [] })),
    awards: awards || [],
    percentageAttempts: percentageAttempts || [],
    assignmentAttempts: assignmentAttempts || [],
  };
}

async function getHelpRequests(athleteId) {
  const { data, error } = await client.from("trick_help_requests").select("*").eq("athlete_id", athleteId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getDashboardItems(athleteId) {
  const { data, error } = await client.from("dashboard_items").select("*").eq("owner_id", athleteId).order("completed", { ascending: true }).order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getCoachVenues() {
  const { data, error } = await client.from("coach_venues").select("*").eq("coach_id", state.user.id).order("sort_order", { ascending: true }).order("name");
  if (error) throw error;
  return data || [];
}

async function getCoachCommandData(roster = []) {
  const ids = roster.map((athlete) => athlete.id);
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 21).toISOString();
  const [calendar, statusRows, dashboardItems, sessions, scheduleRows, awards, assignmentAttempts, attendanceSessions, parentLinks, weeklySettings, weeklyNotifications, dismissedTasks] = await Promise.all([
    client.from("coach_calendar_events").select("*").eq("coach_id", state.user.id).gte("starts_at", new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString()).order("starts_at").limit(30),
    ids.length ? client.from("athlete_coach_status").select("*").eq("coach_id", state.user.id).in("athlete_id", ids) : { data: [], error: null },
    ids.length ? client.from("dashboard_items").select("*").in("owner_id", ids).gte("due_at", new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()).order("due_at", { ascending: true, nullsFirst: false }).limit(40) : { data: [], error: null },
    ids.length ? client.from("training_sessions").select("*").in("athlete_id", ids).gte("started_at", since).order("started_at", { ascending: false }) : { data: [], error: null },
    ids.length ? client.from("weekly_trick_assignments").select("id, athlete_id, category").in("athlete_id", ids).eq("week_start", weekStartDate()) : { data: [], error: null },
    ids.length ? client.from("assignment_point_awards").select("*").in("athlete_id", ids).gte("created_at", weekStartIso()) : { data: [], error: null },
    ids.length ? client.from("assignment_attempts").select("*").in("athlete_id", ids).eq("week_start", weekStartDate()).order("attempted_at", { ascending: false }) : { data: [], error: null },
    client.from("attendance_sessions").select("*, attendance_records(*)").eq("coach_id", state.user.id).order("session_date", { ascending: false }).limit(8),
    ids.length ? client.from("parent_athletes").select("*").eq("coach_id", state.user.id).in("athlete_id", ids) : { data: [], error: null },
    client.from("weekly_progress_notification_settings").select("*").eq("coach_id", state.user.id).maybeSingle(),
    ids.length ? client.from("weekly_progress_notifications").select("*").eq("coach_id", state.user.id).in("athlete_id", ids).eq("week_start", weekStartDate()).order("created_at", { ascending: false }) : { data: [], error: null },
    client.from("dismissed_coach_tasks").select("*").eq("coach_id", state.user.id).eq("week_start", weekStartDate()),
  ]);
  [calendar, statusRows, dashboardItems, sessions, scheduleRows, awards, assignmentAttempts, attendanceSessions, parentLinks, weeklySettings, weeklyNotifications, dismissedTasks].forEach((result) => { if (result.error) throw result.error; });
  return {
    calendar: calendar.data || [],
    statuses: statusRows.data || [],
    dashboardItems: dashboardItems.data || [],
    sessions: sessions.data || [],
    scheduleRows: scheduleRows.data || [],
    awards: awards.data || [],
    assignmentAttempts: assignmentAttempts.data || [],
    attendanceSessions: attendanceSessions.data || [],
    parentLinks: parentLinks.data || [],
    weeklySettings: weeklySettings.data || null,
    weeklyNotifications: weeklyNotifications.data || [],
    dismissedTasks: dismissedTasks.data || [],
  };
}

async function getStudentPrivateData(athleteId) {
  const [record, documents, injuries, attendance, runs] = await Promise.all([
    client.from("athlete_private_records").select("*").eq("coach_id", state.user.id).eq("athlete_id", athleteId).maybeSingle(),
    client.from("athlete_documents").select("*").eq("coach_id", state.user.id).eq("athlete_id", athleteId).order("created_at", { ascending: false }),
    client.from("injury_reports").select("*").eq("coach_id", state.user.id).eq("athlete_id", athleteId).order("injured_at", { ascending: false }).limit(8),
    client.from("attendance_records").select("*, attendance_sessions(*)").eq("coach_id", state.user.id).eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(8),
    client.from("run_plans").select("*").eq("athlete_id", athleteId).order("updated_at", { ascending: false }).limit(8),
  ]);
  [record, documents, injuries, attendance, runs].forEach((result) => { if (result.error) throw result.error; });
  return {
    record: record.data || {},
    documents: documents.data || [],
    injuries: injuries.data || [],
    attendance: attendance.data || [],
    runs: runs.data || [],
  };
}

async function getRunPlans(athleteId) {
  const { data, error } = await client.from("run_plans").select("*").eq("athlete_id", athleteId).order("updated_at", { ascending: false }).limit(12);
  if (error) throw error;
  return data || [];
}

async function getCrewFeed() {
  const { data, error } = await client.rpc("get_crew_feed");
  if (error) throw error;
  return data || [];
}

async function getBoardChat() {
  const { data: posts, error } = await client.from("crew_posts")
    .select("*, profiles:author_id(display_name, avatar)")
    .eq("post_type", "chat")
    .order("created_at", { ascending: true })
    .limit(60);
  if (error) throw error;
  const postIds = (posts || []).map((post) => post.id);
  const { data: reactions, error: reactionError } = postIds.length
    ? await client.from("crew_post_reactions").select("*").in("post_id", postIds)
    : { data: [], error: null };
  if (reactionError) throw reactionError;
  const reactionUserIds = [...new Set((reactions || []).map((reaction) => reaction.user_id).filter(Boolean))];
  const { data: reactionProfiles } = reactionUserIds.length
    ? await client.from("profiles").select("id, display_name, avatar").in("id", reactionUserIds)
    : { data: [] };
  const profileById = new Map((reactionProfiles || []).map((profile) => [profile.id, profile]));
  const reactionsByPost = (reactions || []).reduce((map, reaction) => {
    const list = map.get(reaction.post_id) || [];
    list.push({ ...reaction, profile: profileById.get(reaction.user_id) || null });
    map.set(reaction.post_id, list);
    return map;
  }, new Map());
  return (posts || []).map((post) => ({ ...post, reactions: reactionsByPost.get(post.id) || [] }));
}

const boardReactionEmojis = ["🔥", "💪", "😂", "👏", "❤️", "🚲"];
const allowedGifHosts = new Set(["media.giphy.com", "media0.giphy.com", "media1.giphy.com", "media2.giphy.com", "media3.giphy.com", "media4.giphy.com", "i.giphy.com", "media.tenor.com"]);
const canPostBoardChat = () => state.profile?.role === "athlete" || isCoachRole(state.profile?.role);
const giphyEndpoint = (path) => `https://api.giphy.com/v1/gifs/${path}`;
const giphyImageUrl = (gif, keys = ["fixed_width", "downsized_medium", "original"]) => {
  const images = gif?.images || {};
  return keys.map((key) => images[key]?.url).find(Boolean) || "";
};
const mapGiphyResult = (gif) => ({
  id: gif.id,
  label: gif.title || gif.slug || "Crew sticker",
  url: giphyImageUrl(gif, ["fixed_height", "downsized_medium", "original"]),
  preview: giphyImageUrl(gif, ["fixed_width_small", "fixed_height_small", "fixed_width", "downsized"]),
});
async function searchGiphyViaEdge(query = "", offset = 0) {
  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData?.session?.access_token || "";
  if (!accessToken) throw new Error("Sign in before searching stickers.");
  const response = await fetch(`${SUPABASE_URL}/functions/v1/search-jkcrew-giphy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "apikey": SUPABASE_KEY,
    },
    body: JSON.stringify({ query: String(query || "").trim(), offset }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.error || "Sticker search failed. Please try again.");
  return {
    gifs: Array.isArray(payload?.gifs) ? payload.gifs : [],
    hasMore: Boolean(payload?.hasMore),
  };
}
async function searchGiphy(query = "", offset = 0) {
  const trimmedQuery = String(query || "").trim();
  try {
    const edgeResults = await searchGiphyViaEdge(trimmedQuery, offset);
    if (edgeResults.gifs.length || !GIPHY_API_KEY) return edgeResults;
  } catch (edgeError) {
    if (!GIPHY_API_KEY) throw new Error(messageFrom(edgeError) || "Sticker search needs an API key before it can load the full sticker library.");
  }
  if (!GIPHY_API_KEY) throw new Error("Sticker search needs an API key before it can load the full sticker library.");
  const params = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    limit: "24",
    offset: String(Math.max(0, Number(offset || 0))),
    rating: "pg",
    lang: "en",
    bundle: "messaging_non_clips",
  });
  const endpoint = trimmedQuery ? "search" : "trending";
  if (trimmedQuery) params.set("q", trimmedQuery);
  const response = await fetch(`${giphyEndpoint(endpoint)}?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.meta?.msg || "Sticker search failed. Please try again.");
  const gifs = (payload.data || [])
    .map(mapGiphyResult)
    .filter((gif) => gif.url && gif.preview && normalizeGifUrl(gif.url) && normalizeGifUrl(gif.preview));
  const pagination = payload.pagination || {};
  const nextOffset = Number(pagination.offset || 0) + Number(pagination.count || gifs.length || 0);
  return {
    gifs,
    hasMore: nextOffset < Number(pagination.total_count || 0),
  };
}
const mentionToken = (name = "") => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const boardMentionableUsers = (rows = []) => rows
  .filter((row) => row.athlete_id && row.display_name && !row.isBenchmarkBot)
  .map((row) => ({ id: row.athlete_id, name: row.display_name, token: mentionToken(row.display_name), avatar: row.avatar || null }))
  .filter((row) => row.token);
const extractBoardMentions = (body = "", users = []) => {
  const lower = String(body).toLowerCase();
  return users
    .filter((user) => lower.includes(`@${user.token}`))
    .map((user) => ({ id: user.id, name: user.name, token: `@${user.token}` }));
};
const formatBoardMessageBody = (body = "", mentions = []) => {
  let html = escapeHtml(body);
  mentions.forEach((mention) => {
    if (!mention?.token || !mention?.id) return;
    const label = `@${mention.name || mention.token.replace(/^@/, "")}`;
    html = html.replace(new RegExp(escapeRegExp(escapeHtml(mention.token)), "gi"), `<button class="mention-link" type="button" data-mention-athlete="${escapeHtml(mention.id)}">${escapeHtml(label)}</button>`);
  });
  return html;
};
const normalizeGifUrl = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !allowedGifHosts.has(url.hostname)) return "";
    return url.href.slice(0, 900);
  } catch (_error) {
    return "";
  }
};
const containsGifUrl = (value = "") => /https?:\/\/\S*(?:\.gif|giphy\.com|tenor\.com|media\.tenor\.com|media\d?\.giphy\.com)\S*/i.test(String(value || ""));
const countryOptions = [
  ["", "Not set"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["JP", "Japan"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["NL", "Netherlands"],
  ["BE", "Belgium"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["SE", "Sweden"],
  ["NO", "Norway"],
  ["RU", "Russia"],
  ["DK", "Denmark"],
  ["FI", "Finland"],
  ["BR", "Brazil"],
  ["AR", "Argentina"],
  ["CL", "Chile"],
  ["ZA", "South Africa"],
  ["SG", "Singapore"],
  ["MY", "Malaysia"],
  ["TH", "Thailand"],
  ["ID", "Indonesia"],
  ["PH", "Philippines"],
];

function countryNameFromCode(code = "") {
  return countryOptions.find(([value]) => value === code)?.[1] || "";
}

function countryFlag(code = "") {
  const value = String(code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) return "";
  return value.split("").map((char) => String.fromCodePoint(127397 + char.charCodeAt(0))).join("");
}

function countryOptionsHtml(selectedCode = "") {
  return countryOptions.map(([code, label]) => `<option value="${code}" ${selectedCode === code ? "selected" : ""}>${code ? `${countryFlag(code)} ${label}` : label}</option>`).join("");
}

function countryBadge(profile = {}) {
  const flag = countryFlag(profile.country_code);
  if (!flag) return "";
  const label = profile.country_name || countryNameFromCode(profile.country_code) || profile.country_code;
  return `<span class="country-flag" title="${escapeHtml(label)}">${flag}</span>`;
}

async function getActiveCoachGroupSession() {
  const { data, error } = await client.from("coach_group_sessions")
    .select("*, coach_group_session_participants(*)")
    .eq("coach_id", state.user.id)
    .in("status", ["running", "paused"])
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function getSessionViewerPlanData(athleteIds = []) {
  if (!athleteIds.length) return { assignmentsByAthlete: new Map(), runsByAthlete: new Map(), runProgressByPlan: new Map() };
  const [{ data: assignments, error }, { data: progress, error: progressError }, { data: percentageAttempts, error: percentageError }, { data: assignmentAttempts, error: attemptError }, { data: runs, error: runsError }, { data: runProgress, error: runProgressError }] = await Promise.all([
    client.from("weekly_trick_assignments")
      .select("*")
      .in("athlete_id", athleteIds)
      .eq("week_start", weekStartDate())
      .order("sort_order", { ascending: true }),
    client.from("assignment_progress")
      .select("*")
      .in("athlete_id", athleteIds),
    client.from("percentage_attempts")
      .select("*")
      .in("athlete_id", athleteIds)
      .order("attempt_number", { ascending: true }),
    client.from("assignment_attempts")
      .select("*")
      .in("athlete_id", athleteIds)
      .eq("week_start", weekStartDate())
      .order("attempted_at", { ascending: false }),
    client.from("run_plans")
      .select("*")
      .in("athlete_id", athleteIds)
      .is("archived_at", null)
      .order("updated_at", { ascending: false }),
    client.from("run_checklist_progress")
      .select("*")
      .in("athlete_id", athleteIds),
  ]);
  if (error) throw error;
  if (progressError) throw progressError;
  if (percentageError) throw percentageError;
  if (attemptError) throw attemptError;
  if (runsError) throw runsError;
  if (runProgressError) throw runProgressError;
  const progressById = new Map((progress || []).map((entry) => [entry.assignment_id, entry]));
  const attemptsById = new Map();
  (percentageAttempts || []).forEach((attempt) => {
    const rows = attemptsById.get(attempt.assignment_id) || [];
    rows.push(attempt);
    attemptsById.set(attempt.assignment_id, rows);
  });
  const assignmentAttemptsById = new Map();
  (assignmentAttempts || []).forEach((attempt) => {
    const rows = assignmentAttemptsById.get(attempt.assignment_id) || [];
    rows.push(attempt);
    assignmentAttemptsById.set(attempt.assignment_id, rows);
  });
  const assignmentsByAthlete = new Map();
  (assignments || []).filter((assignment) => categoryInfo[assignment.category]).forEach((assignment) => {
    const rows = assignmentsByAthlete.get(assignment.athlete_id) || [];
    rows.push({ ...assignment, progress: progressById.get(assignment.id) || null, percentageAttempts: attemptsById.get(assignment.id) || [], assignmentAttempts: assignmentAttemptsById.get(assignment.id) || [] });
    assignmentsByAthlete.set(assignment.athlete_id, rows);
  });
  const runsByAthlete = new Map();
  (runs || []).forEach((run) => {
    const rows = runsByAthlete.get(run.athlete_id) || [];
    rows.push(run);
    runsByAthlete.set(run.athlete_id, rows);
  });
  const runProgressByPlan = new Map();
  (runProgress || []).forEach((row) => {
    const rows = runProgressByPlan.get(row.run_plan_id) || [];
    rows.push(row);
    runProgressByPlan.set(row.run_plan_id, rows);
  });
  return { assignmentsByAthlete, runsByAthlete, runProgressByPlan };
}

const categoryInfo = {
  daily: { label: "Daily Tricks", description: "Same list all week · resets each day · full list = 1 point" },
  dialled: { label: "Dialled", description: "Tick each trick once landed · 2 points each" },
  one_bang: { label: "One Bangs", description: "Tick each trick once landed · 2 points each" },
  percentage: { label: "Percentage Tricks", description: "10 attempts · 100%=3, 90%=2, 80%=1" },
  foam_pit: { label: "Foam Pit", description: "Practice only · no points awarded" },
  bonus: { label: "Bonus Tricks", description: "Gold challenge · 5 points each" },
};

const sessionViewerListTabs = [
  { id: "daily", label: "Daily Tricks" },
  { id: "one_bang", label: "One Bangs" },
  { id: "dialled", label: "Dialled" },
  { id: "percentage", label: "Percentage" },
  { id: "foam_pit", label: "Foam" },
  { id: "bonus", label: "Bonus Trick" },
  { id: "goals", label: "Goals" },
  { id: "contest_run", label: "Contest Run" },
];

const coachGroups = [
  ["monday", "Monday Team"],
  ["tuesday", "Tuesday Team"],
  ["wednesday", "Wednesday Team"],
  ["online", "Online Training"],
];
const heatStatuses = {
  on_track: { label: "On track", dot: "green", icon: "●" },
  needs_help: { label: "Needs help", dot: "yellow", icon: "●" },
  falling_behind: { label: "Falling behind", dot: "red", icon: "●" },
  injured: { label: "Injured / modified", dot: "blue", icon: "●" },
  competition_prep: { label: "Competition prep", dot: "purple", icon: "●" },
};
const heatOptions = () => Object.entries(heatStatuses).map(([value, info]) => `<option value="${value}">${info.label}</option>`).join("");

const dailyCompletionCount = (awards = []) => new Set(awards.filter((award) => award.award_key?.startsWith("daily:")).map((award) => String(award.award_key).slice(-10))).size;
const spinDirectionLabels = {
  "": "Not set",
  left: "Left spin",
  right: "Right spin",
  both: "Both ways",
  not_sure: "Not sure yet",
};

function dailyOrderKey(venue = "") {
  return `${weekStartDate()}:${venueKey(venue) || "default"}`;
}

function orderedAssignments(assignments = []) {
  if (state.profile?.role !== "athlete") return assignments;
  const order = state.profile.daily_trick_order?.[dailyOrderKey(state.selectedVenue)] || [];
  if (!Array.isArray(order) || !order.length) return assignments;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...assignments].sort((a, b) => {
    const aRank = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bRank = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    return aRank - bRank || a.sort_order - b.sort_order;
  });
}

function extraTricks(profile = state.profile) {
  return Array.isArray(profile?.rider_extra_tricks) ? profile.rider_extra_tricks : [];
}

function isAssignmentComplete(assignment) {
  if (assignment.category === "daily") return assignment.progress?.progress_date === localDate();
  if (assignment.category === "percentage") return (assignment.percentageAttempts || []).length >= 10;
  return Boolean(assignment.progress?.completed_at);
}

function assignmentStatus(assignment) {
  if (assignment.category === "daily") return isAssignmentComplete(assignment) ? "Done today" : "To do today";
  if (assignment.category === "percentage") {
    const summary = percentageSummary(assignment);
    return `${summary.attempts}/10 attempts${summary.attempts ? ` · ${summary.percentage}% landed` : ""}`;
  }
  return isAssignmentComplete(assignment) ? "Done this week" : "To do this week";
}

function dailyVenues(assignments = []) {
  const venues = [...new Set(assignments.filter((assignment) => assignment.category === "daily").map((assignment) => venueKey(assignment.venue)))];
  return venues.length ? venues : [""];
}

function selectedVenueFor(assignments = []) {
  const venues = dailyVenues(assignments);
  if (!venues.includes(state.selectedVenue)) state.selectedVenue = venues[0] || "";
  return state.selectedVenue;
}

function assignmentsForVenue(assignments = [], venue = "") {
  const selected = venueKey(venue);
  return assignments.filter((assignment) => assignment.category !== "daily" || venueKey(assignment.venue) === selected);
}

function venueSelectorHtml(assignments = []) {
  const venues = dailyVenues(assignments);
  const selected = selectedVenueFor(assignments);
  const options = venues.map((venue) => `<option value="${escapeHtml(venue)}" ${venue === selected ? "selected" : ""}>${escapeHtml(venueLabel(venue))}</option>`).join("");
  return `<section class="panel venue-panel">
    <div class="panel-head"><div><div class="panel-title">Training venue</div><div class="panel-meta">Choose the skate park for today's Daily Tricks</div></div></div>
    <div class="venue-select-wrap"><select id="session-venue">${options}</select></div>
  </section>`;
}

function sessionStatBarHtml({ points = 0, percent = 0, rank = 0 } = {}) {
  return `<section class="session-stat-bar panel">
    <article><span>Total points</span><strong>${Number(points || 0)}</strong></article>
    <article><span>Sheets completed</span><strong>${Number(percent || 0)}%</strong></article>
    <article><span>World ranking</span><strong>${rank ? `#${rank}` : "-"}</strong></article>
  </section>`;
}

function latestDailyTime(activeTraining = null, latestTraining = null) {
  const source = activeTraining?.daily_completed_seconds ? activeTraining : latestTraining;
  return source?.daily_completed_seconds ? formatPbTime(source.daily_completed_seconds) : "Not finished today";
}

function dailySessionHubHtml(assignments = [], selectedVenue = "", activeTraining = null, latestTraining = null) {
  const venues = dailyVenues(assignments);
  const options = venues.map((venue) => `<option value="${escapeHtml(venue)}" ${venue === selectedVenue ? "selected" : ""}>${escapeHtml(venueLabel(venue))}</option>`).join("");
  const selectedDaily = assignmentsForVenue(assignments.filter((assignment) => assignment.category === "daily"), selectedVenue);
  const dailyDone = selectedDaily.filter(isAssignmentComplete).length;
  const timerHtml = activeTraining
    ? `<div class="hub-timer"><span>Live timer</span><strong id="trick-timer">${formatTime(Math.floor((Date.now() - new Date(activeTraining.started_at).getTime()) / 1000))}</strong></div>`
    : `<div class="hub-timer ready"><span>Ready</span><strong>GO</strong></div>`;
  const actionHtml = activeTraining
    ? `<button class="danger-btn start-session-btn" id="end-session" type="button">End session</button>`
    : `<button class="primary-btn start-session-btn" id="create-session" type="button">Start session</button>`;
  return `<section class="panel daily-session-hub">
    <div class="daily-hub-main">
      <div>
        <div class="panel-title">Daily Tricks timer</div>
        <div class="panel-meta">${escapeHtml(venueLabel(selectedVenue))} · ${dailyDone}/${selectedDaily.length} complete today · full list within 20 minutes earns points</div>
      </div>
      ${timerHtml}
    </div>
    <div class="daily-hub-grid">
      <div class="field"><label for="session-venue">Venue</label><select id="session-venue">${options}</select></div>
      <div class="session-pb-chip"><span>Daily PB</span><strong>${formatPbTime(state.profile?.daily_pb_seconds)}</strong></div>
      <div class="session-pb-chip"><span>Today's time</span><strong>${latestDailyTime(activeTraining, latestTraining)}</strong></div>
      ${actionHtml}
    </div>
  </section>`;
}

function nextTrainingOptionsHtml() {
  return "";
}

function bindVenueSelector() {
  document.querySelector("#session-venue")?.addEventListener("change", (event) => {
    state.selectedVenue = event.target.value;
    renderSession();
  });
}

let dailyReorderDrag = null;

function dailyRowOrder() {
  return [...document.querySelectorAll("[data-daily-row]")].map((row) => row.dataset.dailyRow).filter(Boolean);
}

function bindDailyReorder() {
  document.querySelectorAll("[data-daily-row]").forEach((row) => {
    row.addEventListener("pointerdown", startDailyReorder);
  });
}

function startDailyReorder(event) {
  if (event.button && event.button !== 0) return;
  if (event.target.closest("button, a, input, select, textarea")) return;
  const row = event.currentTarget.closest("[data-daily-row]");
  if (!row) return;
  event.stopPropagation();
  dailyReorderDrag = {
    row,
    originalOrder: dailyRowOrder(),
    moved: false,
    armed: false,
    startX: event.clientX,
    startY: event.clientY,
    holdTimer: window.setTimeout(() => {
      if (!dailyReorderDrag || dailyReorderDrag.row !== row) return;
      dailyReorderDrag.armed = true;
      row.classList.remove("daily-reorder-pressing");
      row.classList.add("dragging");
      row.setPointerCapture?.(event.pointerId);
    }, 240),
  };
  row.classList.add("daily-reorder-pressing");
  document.addEventListener("pointermove", moveDailyReorder, { passive: false });
  document.addEventListener("pointerup", finishDailyReorder, { once: true });
  document.addEventListener("pointercancel", cancelDailyReorder, { once: true });
}

function moveDailyReorder(event) {
  if (!dailyReorderDrag) return;
  const { row, startX, startY } = dailyReorderDrag;
  if (!dailyReorderDrag.armed) {
    const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
    if (distance > 14) cancelDailyReorder();
    return;
  }
  event.preventDefault();
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-daily-row]");
  document.querySelectorAll("[data-daily-row].drag-over-row").forEach((element) => {
    if (element !== target) element.classList.remove("drag-over-row");
  });
  if (!target || target === row || target.parentElement !== row.parentElement) return;
  const targetRect = target.getBoundingClientRect();
  const placeBefore = event.clientY < targetRect.top + targetRect.height / 2;
  target.classList.add("drag-over-row");
  if (placeBefore) target.before(row);
  else target.after(row);
  dailyReorderDrag.moved = true;
}

async function finishDailyReorder() {
  const drag = dailyReorderDrag;
  clearDailyReorder();
  if (!drag?.armed || !drag?.moved) return;
  const nextOrder = dailyRowOrder();
  if (nextOrder.join("|") === drag.originalOrder.join("|")) return;
  await saveDailyDisplayOrder(nextOrder);
}

function cancelDailyReorder() {
  clearDailyReorder();
}

function clearDailyReorder() {
  if (dailyReorderDrag?.holdTimer) window.clearTimeout(dailyReorderDrag.holdTimer);
  document.removeEventListener("pointermove", moveDailyReorder);
  document.removeEventListener("pointerup", finishDailyReorder);
  document.removeEventListener("pointercancel", cancelDailyReorder);
  document.querySelectorAll("[data-daily-row]").forEach((row) => row.classList.remove("daily-reorder-pressing", "dragging", "drag-over-row"));
  dailyReorderDrag = null;
}

async function saveDailyDisplayOrder(rows = dailyRowOrder()) {
  if (!rows.length || !state.profile || !state.user?.id) return;
  const dailyOrder = { ...(state.profile.daily_trick_order || {}), [dailyOrderKey(state.selectedVenue)]: rows };
  state.profile = { ...state.profile, daily_trick_order: dailyOrder };
  const { error } = await client.from("profiles").update({ daily_trick_order: dailyOrder, updated_at: new Date().toISOString() }).eq("id", state.user.id);
  if (error) return notify(messageFrom(error), "error");
  notify("Daily Tricks order saved.");
}

function percentageSummary(assignment) {
  const attempts = assignment.percentageAttempts || [];
  const landed = attempts.filter((attempt) => attempt.landed).length;
  const percentage = attempts.length ? Math.round((landed / attempts.length) * 100) : 0;
  return { attempts: attempts.length, landed, missed: attempts.length - landed, percentage, complete: attempts.length >= 10 };
}

function percentageAttemptsByNumber(assignment) {
  return new Map((assignment.percentageAttempts || []).map((attempt) => [Number(attempt.attempt_number), attempt]));
}

function nextPercentageAttemptNumber(assignment) {
  const byNumber = percentageAttemptsByNumber(assignment);
  for (let index = 1; index <= 10; index += 1) {
    if (!byNumber.has(index)) return index;
  }
  return null;
}

function percentageClass(value) {
  if (value < 50) return "result-red";
  if (value <= 70) return "result-yellow";
  return "result-green";
}

function percentagePointsStatus(summary) {
  if (!summary.complete) return `Points unlock at 10/10 attempts · ${10 - summary.attempts} left`;
  if (summary.percentage === 100) return "3 points awarded";
  if (summary.percentage >= 90) return "2 points awarded";
  if (summary.percentage >= 80) return "1 point awarded";
  return "0 points awarded";
}

function assignmentList(assignments, emptyText = "No tricks assigned for this week yet.", interactive = false) {
  if (!assignments.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  const ordered = assignments.some((assignment) => assignment.category === "daily") ? orderedAssignments(assignments) : assignments;
  return ordered.map((assignment) => {
    const complete = isAssignmentComplete(assignment);
    const action = complete ? "unlanded" : "landed";
    const label = complete ? "Untick trick" : "Tick trick complete";
    const draggable = interactive && state.profile?.role === "athlete" && assignment.category === "daily";
    const metaParts = assignment.category === "daily"
      ? [assignment.notes].filter(Boolean)
      : [assignmentStatus(assignment), assignment.notes].filter(Boolean);
    const meta = metaParts.join(" · ");
    const attemptCount = assignment.assignmentAttempts?.length || 0;
    const attemptMeta = `<small class="attempt-count">${attemptCount ? `${attemptCount} attempt${attemptCount === 1 ? "" : "s"} logged` : "No attempts logged yet"}</small>`;
    const controls = interactive ? `
      <div class="assignment-actions">
        <button class="assignment-check" type="button" aria-label="${label}" title="${label}" data-assignment-action="${action}" data-assignment-id="${assignment.id}">${complete ? "✓" : ""}</button>
        <button class="attempt-btn ${attemptCount ? "attempted" : ""}" type="button" aria-label="Add one attempt for ${escapeHtml(assignment.trick_name)}" title="Add attempt" data-assignment-attempt="${assignment.id}"><span>Attempt</span>${attemptCount ? `<span class="attempt-pill">${attemptCount}</span>` : ""}</button>
      </div>` : `<span class="assignment-check">${complete ? "✓" : ""}</span>`;
    return `
    <div class="list-row assignment-row ${isAssignmentComplete(assignment) ? "complete" : ""}" ${draggable ? `data-daily-row="${assignment.id}" aria-label="Hold and drag ${escapeHtml(assignment.trick_name)} to reorder Daily Tricks"` : ""}>
      ${controls}
      <div><strong>${escapeHtml(assignment.trick_name)}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}${attemptMeta}</div>
    </div>`;
  }).join("");
}

function percentageAssignmentList(assignments, emptyText = "No Percentage Tricks assigned.", interactive = false) {
  if (!assignments.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return assignments.map((assignment) => {
    const summary = percentageSummary(assignment);
    const byNumber = percentageAttemptsByNumber(assignment);
    const attempts = Array.from({ length: 10 }, (_, index) => {
      const attemptNumber = index + 1;
      const attempt = byNumber.get(attemptNumber);
      const label = attempt ? (attempt.landed ? "✓" : "×") : index + 1;
      const klass = attempt ? (attempt.landed ? "landed" : "missed") : "";
      const title = attempt ? `Clear attempt ${attemptNumber}` : `Attempt ${attemptNumber} not recorded`;
      return interactive && attempt
        ? `<button class="attempt-dot ${klass}" type="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" data-assignment-id="${assignment.id}" data-percentage-attempt-number="${attemptNumber}" data-percentage-clear="true">${label}</button>`
        : `<span class="attempt-dot ${klass}">${label}</span>`;
    }).join("");
    const result = summary.attempts ? `<span class="percentage-result ${percentageClass(summary.percentage)}">${summary.percentage}%</span>` : `<span class="percentage-result">0%</span>`;
    const nextAttempt = nextPercentageAttemptNumber(assignment);
    const controls = interactive
      ? (nextAttempt ? `<div class="percentage-actions"><button class="primary-btn compact-btn" type="button" data-percentage-action="true" data-percentage-attempt-number="${nextAttempt}" data-assignment-id="${assignment.id}">Land attempt ${nextAttempt}</button><button class="danger-btn compact-btn" type="button" data-percentage-action="false" data-percentage-attempt-number="${nextAttempt}" data-assignment-id="${assignment.id}">Crash attempt ${nextAttempt}</button></div>` : `<small class="subcopy">Tap a filled circle to undo a mistake.</small>`)
      : "";
    return `<div class="percentage-card">
      <div class="percentage-card-head"><div><strong>${escapeHtml(assignment.trick_name)}</strong><small>${summary.landed} landed · ${summary.missed} missed · ${summary.attempts}/10 attempts · ${percentagePointsStatus(summary)}</small></div>${result}</div>
      <div class="attempt-dots">${attempts}</div>
      ${controls}
    </div>`;
  }).join("");
}

function dailyVenueGroups(assignments, interactive = false) {
  const dailyAssignments = assignments.filter((assignment) => assignment.category === "daily");
  const info = categoryInfo.daily;
  const venues = dailyVenues(dailyAssignments);
  const complete = dailyAssignments.filter(isAssignmentComplete).length;
  const body = venues.length ? venues.map((venue, index) => {
    const items = assignmentsForVenue(dailyAssignments, venue);
    const venueComplete = items.filter(isAssignmentComplete).length;
    const open = venueKey(venue) === venueKey(state.selectedVenue) || index === 0;
    return `<details class="daily-venue-accordion" ${open ? "open" : ""}>
      <summary><span><strong>${escapeHtml(venueLabel(venue))} Daily Tricks</strong><small>${venueComplete}/${items.length} complete today</small></span><span class="category-count">${venueComplete}/${items.length}</span></summary>
      <div class="assignment-list">${assignmentList(items, `No daily tricks assigned for ${venueLabel(venue)} yet.`, interactive)}</div>
    </details>`;
  }).join("") : `<div class="empty">No Daily Tricks assigned for this week yet.</div>`;
  return `<section class="assignment-group daily-venue-group">
    <div class="assignment-group-head"><div><div class="panel-title">${info.label}</div><div class="panel-meta">${info.description} · grouped by riding location</div></div><div class="category-count">${complete}/${dailyAssignments.length}</div></div>
    <div class="daily-venue-stack">${body}</div>
  </section>`;
}

function assignmentGroups(assignments, interactive = false) {
  return Object.entries(categoryInfo).map(([category, info]) => {
    if (category === "daily") return dailyVenueGroups(assignments, interactive);
    const items = assignments.filter((assignment) => assignment.category === category);
    const sectionKey = category === "one_bang" ? "one-bang" : category === "foam_pit" ? "foam" : category;
    const list = category === "percentage"
      ? percentageAssignmentList(items, `No ${info.label.toLowerCase()} assigned.`, interactive)
      : assignmentList(items, `No ${info.label.toLowerCase()} assigned.`, interactive);
    return `<section class="assignment-group ${category === "bonus" ? "bonus-assignment-group" : ""}" data-assignment-section="${sectionKey}">
      <div class="assignment-group-head"><div><div class="panel-title">${info.label}</div><div class="panel-meta">${info.description}</div></div><div class="category-count">${items.filter(isAssignmentComplete).length}/${items.length}</div></div>
      <div class="assignment-list">${list}</div>
    </section>`;
  }).join("");
}

function helpRequestsHtml(requests, mode = "athlete") {
  if (!requests.length) return `<div class="empty">No trick help videos yet.</div>`;
  return requests.map((request) => {
    const riderVideo = request.video_data_url ? `
      <video class="help-video" src="${escapeHtml(request.video_data_url)}" controls playsinline preload="metadata"></video>
      <div class="video-actions">
        <a class="secondary-btn compact-btn" href="${escapeHtml(request.video_data_url)}" target="_blank" rel="noopener">Open video</a>
        <a class="secondary-btn compact-btn" href="${escapeHtml(request.video_data_url)}" download="jkcrew-trick-video">Download</a>
      </div>` : `<div class="empty compact-empty">No video attached.</div>`;
    const coachVideo = request.coach_video_data_url ? `
      <video class="help-video" src="${escapeHtml(request.coach_video_data_url)}" controls playsinline preload="metadata"></video>
      <div class="video-actions">
        <a class="secondary-btn compact-btn" href="${escapeHtml(request.coach_video_data_url)}" target="_blank" rel="noopener">Open coach video</a>
        <a class="secondary-btn compact-btn" href="${escapeHtml(request.coach_video_data_url)}" download="jkcrew-coach-reply">Download</a>
      </div>` : "";
    const coachReply = request.coach_comment || request.coach_video_data_url
      ? `<div class="coach-reply"><strong>Coach reply</strong>${request.coach_comment ? `<p>${escapeHtml(request.coach_comment)}</p>` : ""}${coachVideo}</div>`
      : `<div class="panel-meta">Waiting for coach reply</div>`;
    const coachTools = mode === "coach" ? `
      <form class="reply-form" data-help-reply="${request.id}">
        <div class="field"><label for="reply-${request.id}">Written feedback</label><textarea id="reply-${request.id}" name="comment" placeholder="What should they fix?">${escapeHtml(request.coach_comment || "")}</textarea></div>
        <div class="field"><label for="reply-video-${request.id}">Optional video reply</label><input id="reply-video-${request.id}" name="video" type="file" accept="video/*"></div>
        <button class="primary-btn" type="submit">Send coach reply</button>
      </form>` : "";
    return `<article class="help-card">
      <div class="help-card-head"><div><strong>${escapeHtml(request.question || "Trick help request")}</strong><small>${dateLabel(request.created_at)} · ${escapeHtml(request.status)}</small></div></div>
      ${riderVideo}
      ${coachReply}
      ${coachTools}
    </article>`;
  }).join("");
}

function helpUploadSection(requests) {
  return `<section class="panel help-section">
    <div class="panel-head"><div><div class="panel-title">Need Help With A Trick?</div><div class="panel-meta">Upload a video and ask your coach what to fix</div></div></div>
    <form id="help-request-form" class="help-form">
      <div class="field"><label for="help-question">Short note or question</label><textarea id="help-question" name="question" required placeholder="I keep missing my barspin. What should I change?"></textarea></div>
      <div class="field"><label for="help-video">Trick video</label><input id="help-video" name="video" type="file" accept="video/*" required></div>
      <button class="primary-btn wide" type="submit">Submit to coach</button>
    </form>
    <div class="settings-divider"></div>
    <div class="panel-title">My coach feedback</div>
    <div class="help-list">${helpRequestsHtml(requests)}</div>
  </section>`;
}

function heatChip(status = "on_track", extra = "") {
  const info = heatStatuses[status] || heatStatuses.on_track;
  return `<span class="heat-chip ${info.dot}">${info.icon} ${escapeHtml(info.label)}${extra ? ` · ${escapeHtml(extra)}` : ""}</span>`;
}

function statusByAthlete(statuses = []) {
  return new Map(statuses.map((status) => [status.athlete_id, status]));
}

function coachGroupLabel(groupName = "monday") {
  return coachGroups.find(([id]) => id === groupName)?.[1] || "Monday Team";
}

function groupLabelList(groupNames = []) {
  const labels = [...new Set(groupNames.filter(Boolean))].map((groupName) => coachGroupLabel(groupName));
  return labels.length ? labels.join(", ") : "No group set";
}

function athleteAttention(athlete, data = {}) {
  const sessions = (data.sessions || []).filter((session) => session.athlete_id === athlete.id);
  const lastSession = sessions[0];
  const dailyAwards = (data.awards || []).filter((award) => award.athlete_id === athlete.id && award.award_key?.startsWith("daily:")).length;
  const weeklyAssignments = (data.scheduleRows || []).filter((assignment) => assignment.athlete_id === athlete.id);
  const weeklyNonDaily = weeklyAssignments.filter((assignment) => assignment.category !== "daily").length;
  const flags = [];
  if (!lastSession) flags.push("No training data for 21 days");
  if (sessions.length === 0) flags.push("Not recording sessions");
  if (dailyAwards === 0) flags.push("Daily Tricks not completed this week");
  if (weeklyAssignments.length === 0) flags.push("Needs a weekly plan");
  if (weeklyNonDaily >= 6 && sessions.length <= 1) flags.push("May be neglecting weekly tricks");
  return { lastSession, flags };
}

function daysAwayLabel(value) {
  const start = new Date(value);
  const today = new Date(`${localDate()}T00:00:00+10:00`);
  const target = new Date(start);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target - today) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `${days} days away`;
}

function eventGroupKey(event = {}) {
  const title = String(event.title || "").trim().toLowerCase().replace(/\s+/g, " ");
  const venue = String(event.venue || "").trim().toLowerCase().replace(/\s+/g, " ");
  const date = event.starts_at ? new Date(event.starts_at).toISOString().slice(0, 10) : "";
  return `${title}|${date}|${venue}`;
}

function groupCoachCalendarItems(events = [], roster = []) {
  const athletes = new Map(roster.map((athlete) => [athlete.id, athlete.display_name]));
  const grouped = new Map();
  events.forEach((event) => {
    const key = eventGroupKey(event);
    const entry = grouped.get(key) || {
      ...event,
      riderNames: [],
      riderIds: new Set(),
      eventIds: [],
      count: 0,
    };
    const riderName = event.athlete_id ? athletes.get(event.athlete_id) || "Rider" : "";
    if (riderName && !entry.riderIds.has(event.athlete_id)) {
      entry.riderNames.push(riderName);
      entry.riderIds.add(event.athlete_id);
    }
    entry.eventIds.push(event.id);
    entry.count += 1;
    if (!entry.ends_at && event.ends_at) entry.ends_at = event.ends_at;
    if (!entry.notes && event.notes) entry.notes = event.notes;
    grouped.set(key, entry);
  });
  return [...grouped.values()]
    .map((event) => ({ ...event, riderCount: event.riderNames.length || event.count, riderIds: undefined }))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

function calendarItemsHtml(events = [], roster = []) {
  if (!events.length) return `<div class="empty compact-empty">No coach calendar events yet.</div>`;
  const athletes = new Map(roster.map((athlete) => [athlete.id, athlete.display_name]));
  return events.slice(0, 10).map((event) => `
    <article class="calendar-card">
      <div class="calendar-date"><strong>${new Intl.DateTimeFormat("en-AU", { day: "2-digit" }).format(new Date(event.starts_at))}</strong><span>${new Intl.DateTimeFormat("en-AU", { month: "short" }).format(new Date(event.starts_at))}</span></div>
      <div><strong>${escapeHtml(event.title)}</strong><small>${dateLabel(event.starts_at)}${event.ends_at ? ` → ${dateLabel(event.ends_at)}` : ""} · ${daysAwayLabel(event.starts_at)} · ${escapeHtml(event.venue || "Venue TBC")}${event.attendance_status ? ` · ${escapeHtml(event.attendance_status)}` : ""}${event.payment_status ? ` · ${escapeHtml(event.payment_status)}` : ""}</small><p>${event.riderNames ? `${event.riderCount} rider${event.riderCount === 1 ? "" : "s"}: ${escapeHtml(event.riderNames.join(", ") || "Whole crew")}` : `${escapeHtml(event.athlete_id ? athletes.get(event.athlete_id) || "Rider" : event.group_name ? coachGroupLabel(event.group_name) : "Whole crew")}`}${event.notes ? ` · ${escapeHtml(event.notes)}` : ""}</p></div>
    </article>`).join("");
}

function combinedCoachCalendarItems(commandData = {}) {
  const calendarEvents = (commandData.calendar || []).map((event) => ({ ...event, source: "coach" }));
  const riderItems = (commandData.dashboardItems || [])
    .filter((item) => item.due_at)
    .map((item) => ({
      id: item.id,
      athlete_id: item.owner_id,
      group_name: "",
      title: item.title,
      starts_at: item.due_at,
      ends_at: item.end_at,
      venue: "",
      notes: item.details,
      source: item.item_type,
    }));
  return [...calendarEvents, ...riderItems].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

function coachCalendarForm(roster = []) {
  const athleteOptions = roster.map((athlete) => `<option value="${athlete.id}">${escapeHtml(athlete.display_name)}</option>`).join("");
  const groupOptions = coachGroups.map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("");
  return `<form id="coach-calendar-form" class="coach-calendar-form">
    <div class="field"><label for="calendar-title">Event name</label><input id="calendar-title" name="title" required placeholder="State titles, private lesson, group session..."></div>
    <div class="field"><label for="calendar-start">Start</label><input id="calendar-start" name="startsAt" type="datetime-local" required></div>
    <div class="field"><label for="calendar-end">Finish</label><input id="calendar-end" name="endsAt" type="datetime-local"></div>
    <div class="field"><label for="calendar-venue">Venue</label><input id="calendar-venue" name="venue" placeholder="Pizzey, Beenleigh..."></div>
    <div class="field"><label for="calendar-athlete">Rider</label><select id="calendar-athlete" name="athleteId"><option value="">Group / all riders</option>${athleteOptions}</select></div>
    <div class="field"><label for="calendar-group">Group</label><select id="calendar-group" name="groupName"><option value="">Whole crew</option>${groupOptions}</select></div>
    <div class="field"><label for="calendar-attendance">Attendance status</label><input id="calendar-attendance" name="attendanceStatus" placeholder="Confirmed, pending, absent..."></div>
    <div class="field"><label for="calendar-payment">Payment status</label><input id="calendar-payment" name="paymentStatus" placeholder="Paid, owing, included..."></div>
    <div class="field"><label for="calendar-notes">Notes</label><input id="calendar-notes" name="notes" placeholder="Payment, attendance, comp details..."></div>
    <button class="primary-btn" type="submit">Add event</button>
  </form>`;
}

function athleteOverviewHtml(roster = [], commandData = {}) {
  const statuses = statusByAthlete(commandData.statuses);
  return roster.map((athlete) => {
    const status = statuses.get(athlete.id) || {};
    const attention = athleteAttention(athlete, commandData);
    const alert = status.coach_alert || attention.flags[0] || "No urgent alert";
    return `<article class="overview-card">
      <button class="student-chip overview-person" data-open-student="${athlete.id}">${avatarHtml(athlete, "student-chip-avatar")}<span>${escapeHtml(athlete.display_name)}</span></button>
      <div>${heatChip(status.heat_status || "on_track")}<small>${escapeHtml(groupLabelList(athlete.groupNames || [athlete.groupName]))} · ${escapeHtml(status.training_focus || "No focus set")}</small><p>${escapeHtml(alert)}</p></div>
      <form class="heat-form" data-heat-athlete="${athlete.id}">
        <select name="heatStatus">${Object.entries(heatStatuses).map(([value, info]) => `<option value="${value}" ${(status.heat_status || "on_track") === value ? "selected" : ""}>${info.label}</option>`).join("")}</select>
        <input name="trainingFocus" value="${escapeHtml(status.training_focus || "")}" placeholder="Current focus">
        <button class="secondary-btn compact-btn" type="submit">Save</button>
      </form>
    </article>`;
  }).join("");
}

function attendanceForm(roster = []) {
  const groupOptions = coachGroups.map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("");
  const riderRows = roster.map((athlete) => `<label class="attendance-rider">${avatarHtml(athlete)}<span>${escapeHtml(athlete.display_name)}</span><select name="status:${athlete.id}"><option value="">Skip</option><option value="attended">Attended</option><option value="late">Late</option><option value="absent">Absent</option></select><label><input type="checkbox" name="owed:${athlete.id}"> Owes</label><label><input type="checkbox" name="paid:${athlete.id}"> Paid</label></label>`).join("");
  return `<form id="attendance-form" class="attendance-form">
    <div class="two-col-form">
      <div class="field"><label for="attendance-date">Date</label><input id="attendance-date" name="sessionDate" type="date" value="${escapeHtml(localDate())}" required></div>
      <div class="field"><label for="attendance-venue">Venue</label><input id="attendance-venue" name="venue" placeholder="Skate park"></div>
      <div class="field"><label for="attendance-group">Group</label><select id="attendance-group" name="groupName">${groupOptions}</select></div>
      <div class="field"><label for="attendance-total">Total entry cost paid</label><input id="attendance-total" name="totalEntryCost" type="number" step="0.01" min="0" placeholder="0.00"></div>
      <div class="field"><label for="attendance-cost">Cost per rider</label><input id="attendance-cost" name="costPerRider" type="number" step="0.01" min="0" placeholder="0.00"></div>
      <div class="field"><label for="attendance-notes">Session notes</label><input id="attendance-notes" name="notes" placeholder="Session notes"></div>
    </div>
    <div class="attendance-grid">${riderRows}</div>
    <button class="primary-btn wide" type="submit">Save attendance & reimbursements</button>
  </form>`;
}

function attendanceHistoryHtml(sessions = []) {
  if (!sessions.length) return `<div class="empty compact-empty">No attendance sessions recorded yet.</div>`;
  return sessions.map((session) => {
    const records = session.attendance_records || [];
    const owed = records.filter((record) => record.reimbursement_owed && !record.reimbursement_paid).length;
    return `<div class="list-row"><div><strong>${escapeHtml(session.venue || "Session")} · ${escapeHtml(coachGroupLabel(session.group_name))}</strong><small>${escapeHtml(session.session_date)} · ${records.length} riders · $${Number(session.total_entry_cost || 0).toFixed(2)} paid · ${owed} outstanding</small></div><span class="points">${records.filter((record) => record.status === "attended").length}</span></div>`;
  }).join("");
}

function commandAccordionSection(id, title, meta, body, open = false) {
  return `<details id="${escapeHtml(id)}" class="command-accordion" ${open ? "open" : ""}>
    <summary><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></span><span class="accordion-caret">Open</span></summary>
    <div class="command-accordion-body">${body}</div>
  </details>`;
}

function athleteNameMap(roster = []) {
  return new Map(roster.map((athlete) => [athlete.id, athlete.display_name]));
}

function currentWeekEvents(events = []) {
  const start = new Date(weekStartIso()).getTime();
  const end = start + (7 * 24 * 60 * 60 * 1000);
  return events.filter((event) => {
    const time = new Date(event.starts_at).getTime();
    return Number.isFinite(time) && time >= start && time < end;
  });
}

function highPriorityTasks(roster = [], commandData = {}, groupedCalendar = []) {
  const dismissedKeys = new Set((commandData.dismissedTasks || []).map((task) => task.task_key));
  const scheduleByAthlete = (commandData.scheduleRows || []).reduce((map, row) => {
    const rows = map.get(row.athlete_id) || [];
    rows.push(row);
    map.set(row.athlete_id, rows);
    return map;
  }, new Map());
  const notificationsByAthlete = (commandData.weeklyNotifications || []).reduce((map, row) => {
    const rows = map.get(row.athlete_id) || [];
    rows.push(row);
    map.set(row.athlete_id, rows);
    return map;
  }, new Map());
  const parentCounts = (commandData.parentLinks || []).reduce((map, link) => map.set(link.athlete_id, (map.get(link.athlete_id) || 0) + 1), new Map());
  const sheetTasks = roster.flatMap((athlete) => {
    const rows = scheduleByAthlete.get(athlete.id) || [];
    const tasks = [];
    if (!rows.length) tasks.push({ key: `sheet:${athlete.id}:missing`, type: "sheet", label: `${athlete.display_name} — sheet not updated this week`, athleteId: athlete.id, priority: "high" });
    else if (!rows.some((row) => row.category === "daily")) tasks.push({ key: `sheet:${athlete.id}:daily`, type: "sheet", label: `${athlete.display_name} — needs new Daily Tricks`, athleteId: athlete.id, priority: "high" });
    else if (!rows.some((row) => row.category === "dialled")) tasks.push({ key: `sheet:${athlete.id}:dialled`, type: "sheet", label: `${athlete.display_name} — Dialled tricks need review`, athleteId: athlete.id, priority: "medium" });
    return tasks;
  });
  const parentTasks = roster
    .filter((athlete) => parentCounts.get(athlete.id) && !notificationsByAthlete.get(athlete.id)?.some((row) => row.status === "sent"))
    .map((athlete) => ({ key: `parent:${athlete.id}:weekly-update`, type: "parent", label: `${athlete.display_name}'s parent — weekly update not sent`, athleteId: athlete.id, priority: "medium" }));
  const eventTasks = currentWeekEvents(groupedCalendar).slice(0, 5).map((event) => ({ key: `event:${event.eventIds?.join(",") || event.id || event.title}:${event.starts_at}`, type: "event", label: `${event.title} — ${event.riderCount || 0} rider${event.riderCount === 1 ? "" : "s"} attending`, target: "upcoming-events-section", priority: "low" }));
  return [...sheetTasks.slice(0, 6), ...parentTasks.slice(0, 5), ...eventTasks]
    .filter((task) => !dismissedKeys.has(task.key))
    .slice(0, 14);
}

function highPriorityTodoHtml(tasks = []) {
  const rows = tasks.length ? tasks.map((task) => `<div class="priority-task-row">
    <button class="priority-task ${task.priority}" type="button" ${task.athleteId ? `data-open-student="${task.athleteId}"` : ""} ${task.target ? `data-command-scroll="${task.target}"` : ""}>
      <span>${task.priority === "high" ? "!" : task.priority === "medium" ? "•" : "→"}</span>
      <strong>${escapeHtml(task.label)}</strong>
    </button>
    <button class="dismiss-task-btn" type="button" data-dismiss-task="${escapeHtml(task.key)}" aria-label="Remove ${escapeHtml(task.label)} from this week's to do list">×</button>
  </div>`).join("") : `<div class="empty compact-empty">No urgent coach tasks right now.</div>`;
  return `<section class="panel high-priority-panel"><div class="panel-head"><div><div class="panel-title">High Priority To Do List</div><div class="panel-meta">Private coach actions for this week</div></div></div><div class="priority-list">${rows}</div></section>`;
}

function commandNotificationsHtml(roster = [], commandData = {}, groupedCalendar = []) {
  const statuses = statusByAthlete(commandData.statuses);
  const attention = roster.flatMap((athlete) => {
    const flags = athleteAttention(athlete, commandData).flags;
    const coachAlert = statuses.get(athlete.id)?.coach_alert;
    return [...(coachAlert ? [coachAlert] : []), ...flags].slice(0, 2).map((flag) => ({ athleteId: athlete.id, label: `${athlete.display_name}: ${flag}`, type: "rider" }));
  });
  const events = currentWeekEvents(groupedCalendar).map((event) => ({ label: `${event.title}: ${daysAwayLabel(event.starts_at)}`, target: "upcoming-events-section", type: "event" }));
  const notifications = [...attention, ...events].slice(0, 16);
  if (!notifications.length) return `<div class="empty compact-empty">No private notifications right now.</div>`;
  return `<div class="notification-list">${notifications.map((item) => `<button class="notification-card" type="button" ${item.athleteId ? `data-open-student="${item.athleteId}"` : ""} ${item.target ? `data-command-scroll="${item.target}"` : ""}><span>${item.type === "event" ? "Event" : "Rider"}</span><strong>${escapeHtml(item.label)}</strong></button>`).join("")}</div>`;
}

function weeklyNotificationControlsHtml(commandData = {}) {
  const settings = commandData.weeklySettings || {};
  const history = commandData.weeklyNotifications || [];
  const sent = history.filter((row) => row.status === "sent").length;
  const drafts = history.filter((row) => row.status !== "sent").length;
  const historyRows = history.length ? history.slice(0, 8).map((row) => `<button class="notification-card" type="button" data-open-student="${escapeHtml(row.athlete_id)}">
    <span>${escapeHtml(row.status || "draft")} · ${escapeHtml(row.recipient_type || "summary")}</span>
    <strong>${escapeHtml(row.title || "Weekly progress summary")}</strong>
    <small>${escapeHtml(row.summary || "No summary text saved yet.")}</small>
  </button>`).join("") : `<div class="empty compact-empty">No weekly summaries created for this week yet.</div>`;
  return `<div class="weekly-notification-controls">
    <form id="weekly-notification-settings-form" class="weekly-settings-form">
      <label><input type="checkbox" name="enabled" ${settings.enabled !== false ? "checked" : ""}> Weekly summaries on</label>
      <label><input type="checkbox" name="parentSummaries" ${settings.parent_summaries_enabled !== false ? "checked" : ""}> Send to linked parents</label>
      <label><input type="checkbox" name="onlineSummaries" ${settings.online_rider_summaries_enabled !== false ? "checked" : ""}> Send to online riders</label>
      <label><input type="checkbox" name="inactiveSummaries" ${settings.inactive_rider_summaries_enabled ? "checked" : ""}> Include inactive riders</label>
      <div class="settings-callout">Scheduled target: Sunday 7:30pm Australia/Brisbane. History this week: ${sent} sent · ${drafts} drafts/previews.</div>
      <button class="primary-btn" type="submit">Save notification settings</button>
    </form>
    <div class="settings-divider"></div>
    <div class="weekly-preview-actions">
      <button class="secondary-btn" id="generate-weekly-previews" type="button">Preview this week's summaries</button>
      <small>Creates coach-reviewable summary drafts for linked parents and online riders. External push/email delivery can be connected after the sending channel is chosen.</small>
    </div>
    <div class="notification-list weekly-history-list">${historyRows}</div>
  </div>`;
}

function goalsSection(profile = {}) {
  const goals = Array.isArray(profile.goals) ? profile.goals : [];
  const openCount = goals.filter((goal) => !goal.completed).length;
  const rows = goals.length ? goals.map((goal) => `
    <div class="goal-row ${goal.completed ? "complete" : ""}" data-goal-id="${escapeHtml(goal.id)}">
      <button class="assignment-check goal-toggle" type="button" data-goal-toggle="${escapeHtml(goal.id)}" aria-label="${goal.completed ? "Mark goal active" : "Mark goal complete"}">${goal.completed ? "✓" : ""}</button>
      <input value="${escapeHtml(goal.title)}" data-goal-title="${escapeHtml(goal.id)}" aria-label="Goal title">
      <button class="secondary-btn compact-btn" type="button" data-goal-save="${escapeHtml(goal.id)}">Save</button>
      <button class="danger-btn compact-btn" type="button" data-goal-delete="${escapeHtml(goal.id)}">Delete</button>
    </div>`).join("") : `<div class="empty compact-empty">No goals yet. Add one thing you want to chase this week.</div>`;
  return `<section class="panel goals-panel">
    <div class="panel-head"><div><div class="panel-title">My Goals</div><div class="panel-meta">${openCount} active goals · keep your why in front of you</div></div></div>
    <form id="goal-form" class="goal-form"><input name="goal" required maxlength="120" placeholder="Land barspin clean, qualify for state titles..."><button class="primary-btn" type="submit">Add goal</button></form>
    <div class="goal-list">${rows}</div>
  </section>`;
}

function showreelVideos(profile = {}) {
  return Array.isArray(profile.showreel_videos) ? profile.showreel_videos.filter((video) => video?.dataUrl).slice(0, 3) : [];
}

const SHOWREEL_MAX_SECONDS = 30;
const SHOWREEL_MAX_BYTES = 36 * 1024 * 1024;

function showreelHtml(profile = {}, editable = false) {
  const videos = showreelVideos(profile);
  const videoHtml = videos.length ? videos.map((video, index) => `
    <div class="showreel-tile">
      <video src="${escapeHtml(video.dataUrl)}" autoplay muted loop playsinline controls preload="metadata"></video>
      ${editable ? `<button class="danger-btn compact-btn" type="button" data-remove-showreel="${index}">Remove</button>` : ""}
    </div>`).join("") : `<div class="empty compact-empty">No showreel videos yet.</div>`;
  return `<section class="panel showreel-panel">
    <div class="panel-head"><div><div class="panel-title">Showreel</div><div class="panel-meta">2-3 BMX highlight clips · max 30 seconds each</div></div></div>
    <div class="showreel-grid">${videoHtml}</div>
    ${editable ? `<div class="settings-divider"></div><form id="showreel-form" class="showreel-form"><input id="showreel-file" name="video" type="file" accept="video/*" hidden><button class="secondary-btn" type="button" id="choose-showreel">Upload showreel clip</button><small>${videos.length}/3 videos added</small></form>` : ""}
  </section>`;
}

function socialLinks(profile = {}) {
  const links = profile.social_links || {};
  return ["instagram", "tiktok", "youtube", "other"].map((key) => ({ key, url: String(links[key] || "").trim() })).filter((item) => item.url);
}

function socialLinksHtml(profile = {}) {
  const labels = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", other: "Other" };
  const links = socialLinks(profile);
  if (!links.length) return "";
  return `<section class="panel social-panel">
    <div class="panel-head"><div><div class="panel-title">Social links</div><div class="panel-meta">Riding content and highlights</div></div></div>
    <div class="social-links">${links.map((item) => `<a class="secondary-btn compact-btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(labels[item.key])}</a>`).join("")}</div>
  </section>`;
}

function quoteSection() {
  const item = randomQuote();
  return `<section class="panel quote-panel"><div class="eyebrow">Rider mindset</div><blockquote>“${escapeHtml(item.quote)}”</blockquote><small>${escapeHtml(item.by)}${item.role ? ` · ${escapeHtml(item.role)}` : ""}</small></section>`;
}

function normalizedGoals() {
  return Array.isArray(state.profile?.goals) ? [...state.profile.goals] : [];
}

async function saveGoals(goals, message = "Goals saved.") {
  const { data, error } = await client.from("profiles").update({ goals, updated_at: new Date().toISOString() }).eq("id", state.user.id).select().single();
  if (error) return notify(messageFrom(error), "error");
  state.profile = data;
  notify(message);
  await renderAthleteHome();
}

function bindGoalActions() {
  document.querySelector("#goal-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("goal") || "").trim();
    if (!title) return;
    const goals = normalizedGoals();
    goals.unshift({ id: crypto.randomUUID(), title: title.slice(0, 120), completed: false, createdAt: new Date().toISOString() });
    await saveGoals(goals, "Goal added.");
  });
  document.querySelectorAll("[data-goal-toggle]").forEach((button) => button.addEventListener("click", async () => {
    const goals = normalizedGoals().map((goal) => goal.id === button.dataset.goalToggle ? { ...goal, completed: !goal.completed } : goal);
    await saveGoals(goals, "Goal updated.");
  }));
  document.querySelectorAll("[data-goal-save]").forEach((button) => button.addEventListener("click", async () => {
    const input = document.querySelector(`[data-goal-title="${CSS.escape(button.dataset.goalSave)}"]`);
    const title = String(input?.value || "").trim();
    if (!title) return notify("Write the goal first.", "error");
    const goals = normalizedGoals().map((goal) => goal.id === button.dataset.goalSave ? { ...goal, title: title.slice(0, 120) } : goal);
    await saveGoals(goals, "Goal saved.");
  }));
  document.querySelectorAll("[data-goal-delete]").forEach((button) => button.addEventListener("click", async () => {
    const goals = normalizedGoals().filter((goal) => goal.id !== button.dataset.goalDelete);
    await saveGoals(goals, "Goal deleted.");
  }));
}

function extraTricksSection(profile = state.profile, editable = true) {
  const tricks = extraTricks(profile);
  const rows = tricks.length ? tricks.map((trick) => `
    <div class="goal-row extra-trick-row ${trick.completed ? "complete" : ""}" data-extra-trick-id="${escapeHtml(trick.id)}">
      <button class="assignment-check" type="button" ${editable ? `data-extra-toggle="${escapeHtml(trick.id)}"` : "disabled"} aria-label="${trick.completed ? "Mark extra trick active" : "Mark extra trick worked on"}">${trick.completed ? "✓" : ""}</button>
      <div class="extra-trick-copy"><strong>${escapeHtml(trick.title)}</strong><small>${escapeHtml(trick.note || "Personal practice · no points")}</small></div>
      ${editable ? `<button class="secondary-btn compact-btn" type="button" data-extra-edit="${escapeHtml(trick.id)}">Edit</button><button class="danger-btn compact-btn" type="button" data-extra-delete="${escapeHtml(trick.id)}">Delete</button>` : ""}
    </div>`).join("") : `<div class="empty compact-empty">No extra tricks yet. Add something you are personally working on.</div>`;
  return `<section class="panel extra-tricks-panel">
    <div class="panel-head"><div><div class="panel-title">Working On</div><div class="panel-meta">Personal tricks · no points · coach can view</div></div></div>
    ${editable ? `<form id="extra-trick-form" class="goal-form extra-trick-form"><input name="title" required maxlength="120" placeholder="New trick I am working on"><input name="note" maxlength="180" placeholder="Optional note"><button class="primary-btn" type="submit">Add</button></form>` : ""}
    <div class="goal-list">${rows}</div>
  </section>`;
}

async function saveExtraTricks(tricks, message = "Working On saved.") {
  const { data, error } = await client.from("profiles").update({ rider_extra_tricks: tricks, updated_at: new Date().toISOString() }).eq("id", state.user.id).select().single();
  if (error) return notify(messageFrom(error), "error");
  state.profile = data;
  notify(message);
  await renderSession();
}

function bindExtraTrickActions() {
  document.querySelector("#extra-trick-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;
    const tricks = extraTricks();
    tricks.unshift({ id: crypto.randomUUID(), title: title.slice(0, 120), note: String(form.get("note") || "").trim().slice(0, 180), completed: false, createdAt: new Date().toISOString() });
    await saveExtraTricks(tricks, "Extra trick added.");
  });
  document.querySelectorAll("[data-extra-toggle]").forEach((button) => button.addEventListener("click", async () => {
    const tricks = extraTricks().map((trick) => trick.id === button.dataset.extraToggle ? { ...trick, completed: !trick.completed } : trick);
    await saveExtraTricks(tricks, "Extra trick updated.");
  }));
  document.querySelectorAll("[data-extra-edit]").forEach((button) => button.addEventListener("click", async () => {
    const tricks = extraTricks();
    const trick = tricks.find((item) => item.id === button.dataset.extraEdit);
    if (!trick) return;
    const title = window.prompt("Extra trick name:", trick.title);
    if (!title) return;
    const note = window.prompt("Short note:", trick.note || "") || "";
    await saveExtraTricks(tricks.map((item) => item.id === trick.id ? { ...item, title: title.trim().slice(0, 120), note: note.trim().slice(0, 180) } : item), "Extra trick saved.");
  }));
  document.querySelectorAll("[data-extra-delete]").forEach((button) => button.addEventListener("click", async () => {
    await saveExtraTricks(extraTricks().filter((trick) => trick.id !== button.dataset.extraDelete), "Extra trick removed.");
  }));
}

function dashboardItemsHtml(items, editable = true) {
  if (!items.length) return `<div class="empty">No upcoming events or tasks yet.</div>`;
  return items.map((item) => `
    <div class="list-row dashboard-item ${item.completed ? "complete" : ""}">
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.item_type)}${dashboardDateLabel(item)}${item.details ? ` · ${escapeHtml(item.details)}` : ""}</small></div>
      ${editable ? `<div class="item-actions"><button class="secondary-btn compact-btn" data-toggle-item="${item.id}">${item.completed ? "Reopen" : "Done"}</button><button class="danger-btn compact-btn" data-delete-item="${item.id}">Delete</button></div>` : ""}
    </div>`).join("");
}

function dashboardDateLabel(item) {
  if (item.due_at && item.end_at) return ` · ${dateLabel(item.due_at)} → ${dateLabel(item.end_at)}`;
  if (item.due_at) return ` · Starts ${dateLabel(item.due_at)}`;
  if (item.end_at) return ` · Finishes ${dateLabel(item.end_at)}`;
  return "";
}

function dashboardItemForm(ownerId) {
  return `<form id="dashboard-item-form" class="dashboard-item-form" data-owner-id="${ownerId}">
    <div class="field"><label for="item-type">Type</label><select id="item-type" name="itemType"><option value="event">Event</option><option value="task">Important task</option></select></div>
    <div class="field"><label for="item-title">Title</label><input id="item-title" name="title" required placeholder="State titles, film homework, bike check..."></div>
    <div class="field"><label for="item-due">Start date / time</label><input id="item-due" name="dueAt" type="datetime-local"></div>
    <div class="field"><label for="item-end">Finish date / time</label><input id="item-end" name="endAt" type="datetime-local"></div>
    <div class="field"><label for="item-details">Details</label><input id="item-details" name="details" placeholder="Optional short note"></div>
    <button class="primary-btn" type="submit">Add</button>
  </form>`;
}

function dashboardTaskForm(ownerId) {
  return `<form id="dashboard-item-form" class="dashboard-item-form task-only-form" data-owner-id="${ownerId}">
    <input type="hidden" name="itemType" value="task">
    <div class="field"><label for="item-title">Task</label><input id="item-title" name="title" required placeholder="Bike check, film homework, message coach..."></div>
    <div class="field"><label for="item-due">Start date / time</label><input id="item-due" name="dueAt" type="datetime-local"></div>
    <div class="field"><label for="item-end">Finish date / time</label><input id="item-end" name="endAt" type="datetime-local"></div>
    <div class="field"><label for="item-details">Details</label><input id="item-details" name="details" placeholder="Optional short note"></div>
    <button class="primary-btn" type="submit">Add task</button>
  </form>`;
}

function weekSummaryHtml(assignments, awards) {
  const dailyDone = dailyCompletionCount(awards);
  const weeklyPercent = weeklyCompletionPercent(assignments, awards);
  const completedWeekly = assignments.filter((assignment) => assignment.category !== "daily" && isAssignmentComplete(assignment)).length;
  const weeklyTargets = assignments.filter((assignment) => assignment.category !== "daily").length;
  return `<section class="panel simple-summary">
    <div class="panel-head"><div><div class="panel-title">This week</div><div class="panel-meta">Clean progress snapshot</div></div><strong>${weeklyPercent}%</strong></div>
    <div class="progress-bar"><span style="width:${weeklyPercent}%"></span></div>
    <p>Daily Tricks completed ${dailyDone}/7 days. Weekly tricks completed ${completedWeekly}/${weeklyTargets || 0}.</p>
  </section>`;
}

function trickObstacleCategory(assignment = {}) {
  const text = `${assignment.trick_name || ""} ${assignment.notes || ""} ${assignment.venue || ""}`.toLowerCase();
  if (/\bbox\b|box jump|jump box/.test(text)) return "Box tricks";
  if (/\bspine\b/.test(text)) return "Spine tricks";
  if (/\bair\b|quarter|vert|flyout/.test(text)) return "Air tricks";
  if (/\bhip\b/.test(text)) return "Hip tricks";
  return "Other tricks";
}

function manualTricktionary(profile = {}) {
  return Array.isArray(profile.manual_tricktionary) ? profile.manual_tricktionary : [];
}

function coachManualTricktionaryPanel(athlete = {}) {
  const manual = manualTricktionary(athlete);
  const rows = manual.length ? manual.map((trick) => {
    const title = String(trick.title || trick.name || "").trim();
    if (!title) return "";
    const addedAt = trick.addedAt || trick.createdAt;
    const count = Math.max(1, Number(trick.count || trick.landedCount || 1));
    return `<div class="list-row">
      <div><strong>${escapeHtml(title)}</strong><small>Manual Tricktionary entry · ${count} landed${addedAt ? ` · Added ${escapeHtml(dateLabel(addedAt))}` : ""}</small></div>
      <button class="danger-btn compact-btn" type="button" data-coach-remove-manual-trick="${escapeHtml(trick.id || title)}">Remove</button>
    </div>`;
  }).filter(Boolean).join("") : `<div class="empty compact-empty">No manual Tricktionary tricks added yet.</div>`;
  return `<section class="panel">
    <div class="panel-head"><div><div class="panel-title">Tricktionary management</div><div class="panel-meta">Add landed tricks that were not captured on a weekly sheet</div></div></div>
    <form id="coach-manual-trick-form" class="goal-form extra-trick-form"><input name="title" required maxlength="120" placeholder="Add a landed trick for this rider"><input name="count" type="number" min="1" max="999" value="1" aria-label="Landed count"><button class="primary-btn" type="submit">+</button></form>
    <div class="goal-list">${rows}</div>
    <small class="form-note">Manual Tricktionary entries are visible to the rider, linked parents, and the public profile. They do not award points.</small>
  </section>`;
}

function landedTricktionaryEntries(data = {}) {
  const assignmentsById = new Map((data.assignments || []).map((assignment) => [assignment.id, assignment]));
  const progressByAssignment = new Map((data.progress || []).map((row) => [row.assignment_id, row]));
  const awardsByAssignment = (data.awards || []).reduce((map, award) => {
    if (!award.assignment_id) return map;
    const rows = map.get(award.assignment_id) || [];
    rows.push(award);
    map.set(award.assignment_id, rows);
    return map;
  }, new Map());
  const percentageByAssignment = (data.percentageAttempts || []).reduce((map, attempt) => {
    if (!attempt.assignment_id) return map;
    const rows = map.get(attempt.assignment_id) || [];
    rows.push(attempt);
    map.set(attempt.assignment_id, rows);
    return map;
  }, new Map());
  const byName = new Map();
  const countForAssignment = (assignment) => {
    if (assignment.category === "percentage") return 0;
    if (assignment.category === "dialled") return Number(assignment.target_reps || 3) || 3;
    return 1;
  };
  const addEntry = (assignment, count, landedAt, sourceOverride = "", manual = false, manualId = "") => {
    if (!assignment || !Number(count)) return;
    const key = String(assignment.trick_name || "").trim().toLowerCase();
    if (!key) return;
    const previous = byName.get(key) || {
      id: assignment.id || manualId || key,
      title: assignment.trick_name,
      sources: new Set(),
      category: assignment.category || "manual",
      obstacle: trickObstacleCategory(assignment),
      weekStart: assignment.week_start || "",
      landedAt,
      count: 0,
      manual,
      manualIds: [],
    };
    previous.count += Number(count);
    previous.sources.add(sourceOverride || categoryInfo[assignment.category]?.label || assignment.category || "Manual add");
    if (manual && manualId) previous.manualIds.push(manualId);
    if (!previous.landedAt || new Date(landedAt) > new Date(previous.landedAt)) previous.landedAt = landedAt;
    if (assignment.week_start && (!previous.weekStart || new Date(assignment.week_start) > new Date(previous.weekStart))) previous.weekStart = assignment.week_start;
    if (manual) previous.manual = true;
    byName.set(key, previous);
  };
  const countedAssignments = new Set();
  (data.assignments || []).forEach((assignment) => {
    const progress = progressByAssignment.get(assignment.id);
    const complete = assignment.category === "daily" ? Boolean(progress?.progress_date) : Boolean(progress?.completed_at);
    if (!complete || assignment.category === "percentage") return;
    const landedAt = progress?.completed_at || progress?.updated_at || assignment.updated_at || assignment.created_at;
    addEntry(assignment, countForAssignment(assignment), landedAt);
    countedAssignments.add(assignment.id);
  });
  awardsByAssignment.forEach((awards, assignmentId) => {
    if (countedAssignments.has(assignmentId)) return;
    const assignment = assignmentsById.get(assignmentId);
    if (!assignment || assignment.category === "percentage") return;
    const landedAt = awards[0]?.created_at || assignment.updated_at || assignment.created_at;
    addEntry(assignment, countForAssignment(assignment), landedAt);
    countedAssignments.add(assignmentId);
  });
  percentageByAssignment.forEach((attempts, assignmentId) => {
    const assignment = assignmentsById.get(assignmentId);
    if (!assignment) return;
    const landedAttempts = attempts.filter((attempt) => attempt.landed);
    if (!landedAttempts.length) return;
    const landedAt = landedAttempts[0]?.created_at || assignment.updated_at || assignment.created_at;
    addEntry(assignment, landedAttempts.length, landedAt, "Percentage landed reps");
  });
  manualTricktionary(data.profile).forEach((trick) => {
    const title = String(trick.title || trick.name || "").trim();
    if (!title) return;
    const count = Math.max(1, Number(trick.count || trick.landedCount || 1));
    addEntry({
      id: trick.id || title.toLowerCase(),
      trick_name: title,
      category: "manual",
      notes: trick.notes || "",
      week_start: "",
      updated_at: trick.addedAt || trick.createdAt || new Date().toISOString(),
    }, count, trick.addedAt || trick.createdAt || new Date().toISOString(), "Manual add", true, trick.id || title.toLowerCase());
  });
  return [...byName.values()].map((entry) => ({
    ...entry,
    source: [...entry.sources].join(", "),
    manualRemoveId: entry.manualIds[0] || "",
  })).sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

function attemptsByTrick(attempts = []) {
  return attempts.reduce((map, attempt) => {
    const key = String(attempt.trick_name || "").trim().toLowerCase();
    if (!key) return map;
    const entry = map.get(key) || { title: attempt.trick_name, count: 0 };
    entry.count += 1;
    map.set(key, entry);
    return map;
  }, new Map());
}

function tricktionaryEntriesHtml(entries = [], attempts = []) {
  const attemptMap = attemptsByTrick(attempts);
  if (!entries.length) return `<div class="empty compact-empty">No landed tricks in the Tricktionary yet.</div>`;
  return `<div class="tricktionary-grid">${entries.map((entry) => {
    const attemptCount = attemptMap.get(String(entry.title).toLowerCase())?.count || 0;
    const landedCount = Math.max(1, Number(entry.count || 1));
    return `<article class="tricktionary-card">
      <div class="tricktionary-card-main"><div><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.source)}${entry.weekStart ? ` · Latest week ${escapeHtml(entry.weekStart)}` : ""}</small></div><div class="tricktionary-count-badge"><strong>${landedCount}</strong><small>landed</small></div></div>
      <div class="tricktionary-card-meta"><span>${escapeHtml(entry.obstacle)}</span>${attemptCount ? `<span>Attempts: ${attemptCount}</span>` : ""}</div>
      ${entry.manual && state.profile?.id === entry.ownerId && entry.manualRemoveId ? `<button class="danger-btn compact-btn" type="button" data-remove-manual-trick="${escapeHtml(entry.manualRemoveId)}">Remove manual entry</button>` : ""}
    </article>`;
  }).join("")}</div>`;
}

function previousTrainingSheetsHtml(data = {}) {
  const attemptsByAssignment = (data.attempts || []).reduce((map, attempt) => {
    map.set(attempt.assignment_id, (map.get(attempt.assignment_id) || 0) + 1);
    return map;
  }, new Map());
  const progressByAssignment = new Map((data.progress || []).map((row) => [row.assignment_id, row]));
  const awardsByAssignment = (data.awards || []).reduce((map, award) => {
    const rows = map.get(award.assignment_id) || [];
    rows.push(award);
    map.set(award.assignment_id, rows);
    return map;
  }, new Map());
  const weeks = (data.assignments || []).reduce((map, assignment) => {
    const week = assignment.week_start || "Unknown week";
    const rows = map.get(week) || [];
    rows.push(assignment);
    map.set(week, rows);
    return map;
  }, new Map());
  if (!weeks.size) return `<details class="command-accordion"><summary><span><strong>Previous Training Sheets</strong><small>No previous sheets yet</small></span><span class="accordion-caret">Open</span></summary><div class="empty compact-empty">No previous training sheets saved yet.</div></details>`;
  const weekRows = [...weeks.entries()].map(([week, assignments]) => {
    const points = assignments.reduce((sum, assignment) => sum + (awardsByAssignment.get(assignment.id) || []).reduce((total, award) => total + Number(award.points || 0), 0), 0);
    const groups = ["Box tricks", "Spine tricks", "Air tricks", "Hip tricks", "Other tricks"].map((label) => {
      const rows = assignments.filter((assignment) => trickObstacleCategory(assignment) === label);
      if (!rows.length) return "";
      return `<div class="previous-sheet-group"><strong>${escapeHtml(label)}</strong>${rows.map((assignment) => {
        const done = Boolean(progressByAssignment.get(assignment.id)?.completed_at || (awardsByAssignment.get(assignment.id) || []).length);
        const attempts = attemptsByAssignment.get(assignment.id) || 0;
        return `<div class="list-row previous-sheet-row ${done ? "complete" : ""}"><div><strong>${escapeHtml(assignment.trick_name)}</strong><small>${escapeHtml(categoryInfo[assignment.category]?.label || assignment.category)} · ${done ? "Completed" : "Not completed"} · Attempts: ${attempts}${assignment.notes ? ` · ${escapeHtml(assignment.notes)}` : ""}</small></div><span class="assignment-check">${done ? "✓" : ""}</span></div>`;
      }).join("")}</div>`;
    }).filter(Boolean).join("");
    const dailyTotal = assignments.filter((assignment) => assignment.category === "daily").length;
    const dailyDone = assignments.filter((assignment) => assignment.category === "daily" && (progressByAssignment.get(assignment.id)?.completed_at || (awardsByAssignment.get(assignment.id) || []).length)).length;
    const venues = [...new Set(assignments.map((assignment) => venueLabel(assignment.venue)).filter(Boolean))].join(", ");
    return `<details class="previous-sheet-week">
      <summary><span><strong>Week ${escapeHtml(week)}</strong><small>${escapeHtml(venues || "Venue not set")} · ${dailyDone}/${dailyTotal} Daily · ${points} pts</small></span><span class="accordion-caret">Open</span></summary>
      <div class="previous-sheet-body">${groups}</div>
    </details>`;
  }).join("");
  return `<details class="command-accordion previous-sheets-accordion">
    <summary><span><strong>Previous Training Sheets</strong><small>${weeks.size} saved week${weeks.size === 1 ? "" : "s"} with completed and attempted tricks</small></span><span class="accordion-caret">Open</span></summary>
    <div class="previous-sheet-stack">${weekRows}</div>
  </details>`;
}

async function renderTricktionary() {
  if (state.profile?.role === "parent") return renderParentTricktionary();
  const data = await getTricktionaryData(state.user.id);
  state.profile = data.profile || state.profile;
  const entries = landedTricktionaryEntries(data).map((entry) => ({ ...entry, ownerId: state.user.id }));
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Progress history</div><h1>My <span>Tricktionary</span></h1><p>Your personal BMX trick library, built from landed training-sheet tricks plus manual history.</p></div></div>
    <section class="panel">
      <div class="panel-head"><div><div class="panel-title">Landed tricks</div><div class="panel-meta">${entries.length} tricks · Daily PB ${formatPbTime(data.profile.daily_pb_seconds)}</div></div></div>
      <form id="manual-trick-form" class="goal-form extra-trick-form"><input name="title" required maxlength="120" placeholder="Add a trick here"><input name="count" type="number" min="1" max="999" value="1" aria-label="Landed count"><button class="primary-btn" type="submit">+</button></form>
      ${tricktionaryEntriesHtml(entries, data.attempts)}
    </section>
    <section class="panel">
      <div class="panel-head"><div><div class="panel-title">Attempted this week</div><div class="panel-meta">Effort count without awarding points</div></div></div>
      ${weeklyAttemptsHtml(data.attempts.filter((attempt) => attempt.week_start === weekStartDate()))}
    </section>
    `;
  document.querySelector("#manual-trick-form")?.addEventListener("submit", saveManualTrick);
  document.querySelectorAll("[data-remove-manual-trick]").forEach((button) => button.addEventListener("click", removeManualTrick));
}

function weeklyAttemptsHtml(attempts = []) {
  const rows = [...attemptsByTrick(attempts).values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  if (!rows.length) return `<div class="empty compact-empty">No attempted tricks logged this week yet.</div>`;
  return `<div class="attempt-summary-list">${rows.map((row) => `<div class="list-row"><div><strong>${escapeHtml(row.title)}</strong><small>Attempted this week</small></div><span class="points">${row.count}</span></div>`).join("")}</div>`;
}

async function saveManualTrick(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const title = String(form.get("title") || "").trim();
  const count = Math.max(1, Number(form.get("count") || 1));
  if (!title) return;
  const current = manualTricktionary(state.profile);
  const manual_tricktionary = [{ id: crypto.randomUUID(), title: title.slice(0, 120), count, addedAt: new Date().toISOString() }, ...current];
  const { data, error } = await client.from("profiles").update({ manual_tricktionary, updated_at: new Date().toISOString() }).eq("id", state.user.id).select().single();
  if (error) return notify(messageFrom(error), "error");
  state.profile = data;
  notify("Trick added to your Tricktionary. No points were awarded.");
  await renderTricktionary();
}

async function removeManualTrick(event) {
  const id = event.currentTarget.dataset.removeManualTrick;
  const manual_tricktionary = manualTricktionary(state.profile).filter((trick) => trick.id !== id);
  const { data, error } = await client.from("profiles").update({ manual_tricktionary, updated_at: new Date().toISOString() }).eq("id", state.user.id).select().single();
  if (error) return notify(messageFrom(error), "error");
  state.profile = data;
  notify("Manual Tricktionary trick removed. Historical session data was kept.");
  await renderTricktionary();
}

async function renderParentTricktionary() {
  const { data: links, error } = await client.from("parent_athletes").select("athlete_id, relationship").eq("parent_id", state.user.id);
  if (error) throw error;
  if (!links?.length) {
    document.querySelector("#view").innerHTML = `<div class="page-head"><div><div class="eyebrow">Parent viewer</div><h1>Waiting to be <span>linked</span></h1><p>Your coach needs to link this account to a rider first.</p></div></div>`;
    return;
  }
  const sections = await Promise.all(links.map(async (link) => {
    const data = await getTricktionaryData(link.athlete_id);
    const entries = landedTricktionaryEntries(data);
    return `<section class="panel parent-child-card">
      <div class="panel-head"><div><div class="panel-title">${escapeHtml(data.profile.display_name)}'s Tricktionary</div><div class="panel-meta">${entries.length} landed tricks · Daily PB ${formatPbTime(data.profile.daily_pb_seconds)}</div></div></div>
      ${tricktionaryEntriesHtml(entries, data.attempts)}
      <div class="settings-divider"></div>
      <div class="panel-title">Attempted this week</div>
      ${weeklyAttemptsHtml(data.attempts.filter((attempt) => attempt.week_start === weekStartDate()))}
    </section>`;
  }));
  document.querySelector("#view").innerHTML = `<div class="page-head"><div><div class="eyebrow">Parent viewer</div><h1>Tricktionary <span>history</span></h1><p>Read-only landed tricks, attempts, and Daily PBs for linked riders. Previous training sheets live in Profile.</p></div></div>${sections.join("")}`;
}

async function renderAthleteHome() {
  const [{ data: sessions, error }, leaderboard, schedule, dashboardItems] = await Promise.all([
    client.from("training_sessions").select("*").eq("athlete_id", state.user.id).order("started_at", { ascending: false }).limit(12),
    getLeaderboard(),
    getWeeklyAssignments(state.user.id),
    getDashboardItems(state.user.id),
  ]);
  const { assignments, awards, assignmentAttempts } = schedule;
  if (error) throw error;
  const leaderboardRow = leaderboard.find((row) => row.athlete_id === state.user.id);
  const weeklyPoints = Number(leaderboardRow?.weekly_points || 0);
  const rank = leaderboardRow ? leaderboard.findIndex((row) => row.athlete_id === state.user.id) + 1 : 0;
  const dailyDone = dailyCompletionCount(awards);
  const weeklyPercent = weeklyCompletionPercent(assignments, awards);
  const openTasks = dashboardItems.filter((item) => item.item_type === "task" && !item.completed).length;
  const taskItems = dashboardItems.filter((item) => item.item_type === "task");
  const activeSession = await getActiveSession();
  if (activeSession) {
    state.activeTraining = activeSession;
    state.trickStartedAt = new Date(activeSession.started_at).getTime();
  }

  document.querySelector("#view").innerHTML = `
    <section class="athlete-scoreboard panel">
      <div class="scoreboard-person">${avatarHtml(state.profile, "score-avatar")}<div><div class="eyebrow">Athlete dashboard</div><h1>${escapeHtml(state.profile.display_name)}</h1><p>Your week at a glance. Trick lists live in the Session tab.</p></div></div>
      <div class="scoreboard-stats">
        ${statCard("World ranking", rank ? `#${rank}` : "-", "", `${leaderboard.length || 0} riders on board`)}
        ${statCard("This week", `${weeklyPercent}%`, "", `${weeklyPoints} pts earned`)}
        ${statCard("Important tasks", openTasks, "", "Open right now")}
      </div>
    </section>
    ${activeSession ? `<section class="session-hero compact-session-hero"><div><div class="timer-label">Session timer · Daily PB ${formatPbTime(state.profile.daily_pb_seconds)}</div><div class="timer compact-timer" id="trick-timer">00:00</div></div><div class="score-guide"><span>Session total: ${activeSession.total_points} pts</span><span>PB: ${formatPbTime(state.profile.daily_pb_seconds)}</span></div></section>` : ""}
    ${quoteSection()}
    ${weekSummaryHtml(assignments, awards)}
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Important tasks</div><div class="panel-meta">Events and run planner now live in Contests</div></div></div>
      ${dashboardItemsHtml(taskItems)}
      <div class="settings-divider"></div>
      ${dashboardTaskForm(state.user.id)}
    </section>
    ${goalsSection(state.profile)}`;
  bindGoalActions();
  bindDashboardItemActions(renderAthleteHome);
  if (activeSession) {
    updateTimer();
    state.timer = setInterval(updateTimer, 1000);
  }
}

function statCard(label, value, unit, foot) {
  return `<article class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}${unit ? `<small>${escapeHtml(unit)}</small>` : ""}</div><div class="stat-foot">${escapeHtml(foot)}</div></article>`;
}

function weeklyCompletionPercent(assignments, awards) {
  const dailyTarget = assignments.some((assignment) => assignment.category === "daily") ? 7 : 0;
  const dailyDone = dailyCompletionCount(awards);
  const weeklyItems = assignments.filter((assignment) => assignment.category !== "daily");
  const weeklyDone = weeklyItems.filter(isAssignmentComplete).length;
  const total = dailyTarget + weeklyItems.length;
  const done = Math.min(dailyDone, 7) + weeklyDone;
  return total ? Math.round((done / total) * 100) : 0;
}

async function renderParentHome() {
  const { data: links, error } = await client.from("parent_athletes").select("athlete_id, relationship").eq("parent_id", state.user.id);
  if (error) throw error;
  const ids = (links || []).map((link) => link.athlete_id);
  if (!ids.length) {
    document.querySelector("#view").innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Parent viewer</div><h1>Waiting to be <span>linked</span></h1><p>Your parent account is ready, but it is not connected to a rider yet.</p></div></div>
      <section class="panel parent-waiting-card">
        ${avatarHtml(state.profile, "profile-avatar")}
        <div>
          <div class="panel-title">Your account is waiting to be linked to your child's rider profile.</div>
          <p class="subcopy">Once your coach links your account, you'll be able to view your child's progress, goals, training plan, points, badges, and session history.</p>
        </div>
      </section>`;
    return;
  }
  const { data: athletes, error: athleteError } = await client.from("profiles").select("*").in("id", ids).order("display_name");
  if (athleteError) throw athleteError;
  const leaderboard = await getLeaderboard();
  const linkByAthlete = new Map((links || []).map((link) => [link.athlete_id, link]));
  const cards = await Promise.all((athletes || []).map(async (athlete) => {
    const [{ assignments, awards, assignmentAttempts }, helpRequests, dashboardItems, sessions, runs] = await Promise.all([
      getWeeklyAssignments(athlete.id),
      getHelpRequests(athlete.id),
      getDashboardItems(athlete.id),
      client.from("training_sessions").select("*").eq("athlete_id", athlete.id).order("started_at", { ascending: false }).limit(5).then((result) => {
        if (result.error) throw result.error;
        return result.data || [];
      }),
      getRunPlans(athlete.id),
    ]);
    const rank = leaderboard.findIndex((row) => row.athlete_id === athlete.id) + 1;
    const weeklyRow = leaderboard.find((row) => row.athlete_id === athlete.id);
    const percent = weeklyCompletionPercent(assignments, awards);
    const weeklyItems = assignments.filter((assignment) => assignment.category !== "daily");
    const completedWeekly = weeklyItems.filter(isAssignmentComplete).length;
    const sessionRows = sessions.length ? sessions.map((session) => `<div class="list-row"><div><strong>${dateLabel(session.started_at)}</strong><small>${session.ended_at ? `Ended ${dateLabel(session.ended_at)}` : "Session still live"}</small></div><span class="points">${session.total_points || 0}<small> pts</small></span></div>`).join("") : `<div class="empty compact-empty">No sessions recorded yet.</div>`;
    const visibleFeedback = helpRequests.filter((request) => request.coach_comment || request.coach_video_data_url);
    const relationship = linkByAthlete.get(athlete.id)?.relationship;
    return `<section class="panel parent-child-card">
      <div class="scoreboard-person">${avatarHtml(athlete, "score-avatar")}<div><div class="eyebrow">Read-only parent view${relationship ? ` · ${escapeHtml(relationship)}` : ""}</div><h1>${escapeHtml(athlete.display_name)}</h1><p>${escapeHtml(firstName(athlete))} completed ${percent}% of this week's BMX program.</p></div></div>
      <div class="scoreboard-stats">
        ${statCard("Weekly completion", `${percent}%`, "", "Program complete")}
        ${statCard("Daily Tricks", `${dailyCompletionCount(awards)}/7`, "", "This week")}
        ${statCard("Leaderboard", rank ? `#${rank}` : "-", "", `${weeklyRow?.weekly_points || 0} pts`)}
        ${statCard("Weekly tasks", `${completedWeekly}/${weeklyItems.length || 0}`, "", "Dialled, One Bangs, Percentage")}
      </div>
      <div class="weekly-notification">Weekly notification: ${escapeHtml(firstName(athlete))} completed ${percent}% of this week's BMX program.</div>
      <div class="settings-divider"></div>
      <div class="panel-title">Attempted this week</div>
      ${weeklyAttemptsHtml(assignmentAttempts || [])}
      ${goalsReadonlyHtml(athlete)}
      <div class="settings-divider"></div>
      <div class="panel-title">Badges & achievements</div>
      <div class="public-badges">${badgeStripHtml(athlete.badges)}</div>
      <div class="settings-divider"></div>
      <div class="panel-title">Training plan</div>
      <div class="parent-readonly">${assignmentGroups(assignments, false)}</div>
      <div class="settings-divider"></div>
      <div class="panel-title">Events & tasks</div>
      ${dashboardItemsHtml(dashboardItems, false)}
      <div class="settings-divider"></div>
      <div class="panel-title">Session progress</div>
      ${sessionRows}
      <div class="settings-divider"></div>
      <div class="panel-title">Run plans</div>
      ${runPlansHtml(runs)}
      <div class="settings-divider"></div>
      <div class="panel-title">Coach feedback</div>
      <div class="help-list">${helpRequestsHtml(visibleFeedback, "parent")}</div>
    </section>`;
  }));
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Parent viewer</div><h1>Linked <span>riders</span></h1><p>Read-only progress for the riders your coach has linked to this parent account.</p></div></div>
    ${cards.join("")}`;
}

function goalsReadonlyHtml(profile = {}) {
  const goals = Array.isArray(profile.goals) ? profile.goals : [];
  const rows = goals.length ? goals.map((goal) => `<div class="goal-row ${goal.completed ? "complete" : ""}"><span class="assignment-check">${goal.completed ? "✓" : ""}</span><div><strong>${escapeHtml(goal.title)}</strong><small>${goal.completed ? "Completed" : "In progress"}</small></div></div>`).join("") : `<div class="empty compact-empty">No goals added yet.</div>`;
  return `<section class="parent-readonly-section"><div class="panel-title">Goals</div><div class="goal-list">${rows}</div></section>`;
}

function leaderRow(row, index, rows = [], pointsKey = "weekly_points") {
  const realRows = rows.filter((entry) => !entry.isBenchmarkBot);
  const realIndex = realRows.findIndex((entry) => entry.athlete_id === row.athlete_id);
  const badge = !row.isBenchmarkBot ? medalForRank(row, realIndex, realRows.length, pointsKey) : "";
  const badges = earnedBadges(row.earned_badges).slice(0, 4).map((earned) => `<span title="${escapeHtml(earned.label)}">${escapeHtml(earned.icon)}</span>`).join("");
  const country = countryBadge(row);
  const meta = row.isBenchmarkBot ? `${row.benchmark_completion}% weekly benchmark · fake guide rider` : (row.daily_pb_seconds ? `PB Daily Time: ${formatPbTime(row.daily_pb_seconds)}` : "");
  const points = Number(row[pointsKey] ?? row.weekly_points ?? 0);
  const content = `
    <div class="rank">#${index + 1}</div>
    <div class="person">${avatarHtml(row)}<div class="person-name"><strong>${country}${escapeHtml(row.display_name)} ${badge}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}${badges ? `<div class="leader-badges">${badges}</div>` : ""}</div></div>
    <div class="points">${points}<small> pts</small></div>`;
  if (row.isBenchmarkBot) return `<article class="list-row leader-row benchmark-row">${content}</article>`;
  return `<button class="list-row leader-row ${row.athlete_id === state.user.id ? "me" : ""}" type="button" data-public-athlete="${row.athlete_id}">${content}</button>`;
}

function compactLeaderboardHtml(rows = [], pointsKey = "weekly_points") {
  if (!rows.length) return `<div class="empty">No athlete scores yet.</div>`;
  const topRows = rows.slice(0, 7);
  const extraRows = rows.slice(7);
  return `
    ${topRows.map((row, index) => leaderRow(row, index, rows, pointsKey)).join("")}
    ${extraRows.length ? `<details class="leaderboard-more"><summary>View Full Leaderboard <span>${extraRows.length} more</span></summary><div class="leaderboard-more-list">${extraRows.map((row, index) => leaderRow(row, index + 7, rows, pointsKey)).join("")}</div></details>` : ""}`;
}

function leaderboardWithBenchmark(rows = [], pointsKey = "weekly_points") {
  const realRows = rows.filter((row) => !row.isBenchmarkBot);
  const topPoints = Number(realRows[0]?.[pointsKey] || 0);
  const benchmarkPoints = topPoints > 2 ? Math.max(1, Math.min(topPoints - 1, Math.round(topPoints * 0.55))) : 0;
  const bot = {
    athlete_id: "__jkcrew_benchmark__",
    display_name: "Anonymous Rider",
    level: 1,
    avatar: {},
    country_code: "AU",
    country_name: "Australia",
    weekly_points: benchmarkPoints,
    all_time_points: benchmarkPoints,
    session_count: 3,
    earned_badges: [{ icon: "🎯", label: "55% guide" }],
    isBenchmarkBot: true,
    benchmark_completion: 55,
  };
  if (!realRows.length) return [bot];
  const output = [...realRows];
  const insertAt = topPoints > 0 ? output.findIndex((row) => Number(row[pointsKey] || 0) < benchmarkPoints) : output.length;
  output.splice(insertAt === -1 ? output.length : Math.max(1, insertAt), 0, bot);
  return output;
}

function pointsHelpHtml() {
  return `<details class="points-help">
    <summary aria-label="How points work">?</summary>
    <div>
      <strong>How Points Work</strong>
      <ul>
        <li>Daily Tricks: full list within the live timer = 1 point.</li>
        <li>One Bangs: 2 points each when landed.</li>
        <li>Dialled: 2 points each when landed.</li>
        <li>Bonus Tricks: 5 points each.</li>
        <li>First rider to finish Daily Tricks in a group session: 1 point.</li>
        <li>Percentage Tricks: 100% = 3, 90% = 2, 80% = 1, 70% and below = 0.</li>
        <li>Coaches can deduct points with a saved reason for behaviour or corrections.</li>
      </ul>
    </div>
  </details>`;
}

function pointHistoryHtml(rows = []) {
  if (!rows.length) return `<div class="empty compact-empty">No point history recorded yet.</div>`;
  return `<div class="point-history-list">${rows.slice(0, 24).map((row) => {
    const points = Number(row.points || 0);
    const label = points > 0 ? `+${points}` : `${points}`;
    const item = row.item || row.category || row.source || "Point change";
    const reason = row.reason ? `<small>${escapeHtml(row.reason)}</small>` : "";
    const coach = row.coach_name ? `<span>Coach: ${escapeHtml(row.coach_name)}</span>` : "";
    return `<div class="point-history-row ${points < 0 ? "negative" : "positive"}">
      <div><strong>${escapeHtml(item)}</strong><small>${dateLabel(row.event_at)} · ${escapeHtml(row.category || row.source || "points")}</small>${reason}</div>
      <div class="point-history-side"><span class="point-pill">${label} pts</span>${coach}</div>
    </div>`;
  }).join("")}</div>`;
}

function scoreAdjustmentPanel(rows = []) {
  if (!isCoachRole(state.profile?.role)) return "";
  const options = rows
    .filter((row) => !row.isBenchmarkBot)
    .map((row) => `<option value="${row.athlete_id}">${escapeHtml(row.display_name)} · ${Number(row.weekly_points || 0)} pts</option>`)
    .join("");
  if (!options) return "";
  return `<section class="panel score-adjust-panel">
    <div class="panel-head"><div><div class="panel-title">Coach point control</div><div class="panel-meta">Add points or deduct points for behaviour, cheating, or coach corrections.</div></div></div>
    <form id="score-adjust-form" class="score-adjust-form">
      <div class="field"><label for="adjust-athlete">Rider</label><select id="adjust-athlete" name="athleteId" required>${options}</select></div>
      <div class="field"><label for="adjust-action">Action</label><select id="adjust-action" name="action"><option value="add">Add points</option><option value="deduct">Deduct points</option></select></div>
      <div class="field"><label for="adjust-points">Points</label><input id="adjust-points" name="points" type="number" min="1" max="999" required placeholder="5"></div>
      <div class="field"><label for="adjust-reason">Reason</label><input id="adjust-reason" name="reason" maxlength="160" placeholder="Naughty, cheating, bonus effort..."></div>
      <button class="primary-btn" type="submit">Apply score change</button>
    </form>
    <form id="point-recalc-form" class="score-adjust-form point-recalc-form">
      <div class="field"><label for="recalc-athlete">Recalculate rider totals</label><select id="recalc-athlete" name="athleteId" required>${options}</select></div>
      <button class="secondary-btn" type="submit">Recalculate from point history</button>
    </form>
  </section>`;
}

async function loadActiveSession() {
  const { data, error } = await client.from("training_sessions").select("*").eq("athlete_id", state.user.id).is("ended_at", null).order("started_at", { ascending: false }).limit(1);
  if (error) throw error;
  state.activeTraining = data?.[0] || null;
  if (!state.activeTraining) {
    state.attempts = [];
    return;
  }
  const { data: attempts, error: attemptsError } = await client.from("trick_attempts").select("*").eq("session_id", state.activeTraining.id).order("created_at", { ascending: false });
  if (attemptsError) throw attemptsError;
  state.attempts = attempts || [];
}

async function getActiveSession() {
  const { data, error } = await client.from("training_sessions").select("*").eq("athlete_id", state.user.id).is("ended_at", null).order("started_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function renderSession() {
  const todayStartIso = new Date(`${localDate()}T00:00:00+10:00`).toISOString();
  const [schedule, helpRequests, leaderboard, todayTrainingResult] = await Promise.all([
    getWeeklyAssignments(state.user.id),
    getHelpRequests(state.user.id),
    getLeaderboard(),
    client.from("training_sessions").select("daily_completed_seconds,daily_completed_at,started_at").eq("athlete_id", state.user.id).gte("started_at", todayStartIso).order("started_at", { ascending: false }).limit(8),
  ]);
  const { assignments, awards } = schedule;
  const latestDailyTraining = (todayTrainingResult.data || []).find((session) => session.daily_completed_seconds) || null;
  const selectedVenue = selectedVenueFor(assignments);
  const sessionAssignments = assignmentsForVenue(assignments, selectedVenue);
  const boardRow = leaderboard.find((row) => row.athlete_id === state.user.id);
  const rank = leaderboard.findIndex((row) => row.athlete_id === state.user.id) + 1;
  const statBar = sessionStatBarHtml({
    points: boardRow?.weekly_points || 0,
    percent: weeklyCompletionPercent(assignments, awards),
    rank,
  });
  await loadActiveSession();
  if (!state.activeTraining) {
    document.querySelector("#view").innerHTML = `
      ${statBar}
      <div class="page-head"><div><div class="eyebrow">Private training plan</div><h1>Start a <span>session</span></h1><p>Your Daily Tricks stay the same all week and reset each day. Finish the full Daily list to earn its point.</p></div></div>
      ${dailySessionHubHtml(assignments, selectedVenue, null, latestDailyTraining)}
      ${assignmentGroups(sessionAssignments, true)}
      ${extraTricksSection(state.profile, true)}
      ${helpUploadSection(helpRequests)}`;
    bindVenueSelector();
    bindExtraTrickActions();
    bindDailyReorder();
    document.querySelector("#create-session").addEventListener("click", startSession);
    document.querySelector("#help-request-form").addEventListener("submit", submitHelpRequest);
    document.querySelectorAll("[data-assignment-action]").forEach((button) => button.addEventListener("click", recordAssignmentAction));
    document.querySelectorAll("[data-assignment-attempt]").forEach((button) => button.addEventListener("click", recordAssignmentAttempt));
    document.querySelectorAll("[data-percentage-action], [data-percentage-clear]").forEach((button) => button.addEventListener("click", recordPercentageAttempt));
    bindSessionQuickJumps();
    return;
  }
  state.trickStartedAt = new Date(state.activeTraining.started_at).getTime();
  const attemptsHtml = state.attempts.length ? state.attempts.map((attempt) => `
    <div class="list-row"><div><strong>${escapeHtml(attempt.trick_name)}</strong><small>${escapeHtml(attempt.category)} · ${formatTime(attempt.duration_seconds || 0)}</small></div><div class="points">+${attempt.points}</div></div>`).join("") : `<div class="empty">Your landed tricks will appear here.</div>`;
  document.querySelector("#view").innerHTML = `
    ${statBar}
    <div class="page-head"><div><div class="eyebrow">Session live</div><h1>Today's <span>plan</span></h1><p>Tap the circle next to each trick as you complete it.</p></div></div>
    ${dailySessionHubHtml(assignments, selectedVenue, state.activeTraining, latestDailyTraining)}
    ${assignmentGroups(sessionAssignments, true)}
    ${extraTricksSection(state.profile, true)}
    <section class="panel"><div class="panel-head"><div class="panel-title">This session</div><div class="panel-meta">${state.attempts.length} landed</div></div><div class="attempt-list">${attemptsHtml}</div></section>
    ${helpUploadSection(helpRequests)}`;
  bindVenueSelector();
  bindExtraTrickActions();
  bindDailyReorder();
  document.querySelector("#end-session").addEventListener("click", endSession);
  document.querySelector("#help-request-form").addEventListener("submit", submitHelpRequest);
  document.querySelectorAll("[data-assignment-action]").forEach((button) => button.addEventListener("click", recordAssignmentAction));
  document.querySelectorAll("[data-assignment-attempt]").forEach((button) => button.addEventListener("click", recordAssignmentAttempt));
  document.querySelectorAll("[data-percentage-action], [data-percentage-clear]").forEach((button) => button.addEventListener("click", recordPercentageAttempt));
  bindSessionQuickJumps();
  updateTimer();
  state.timer = setInterval(updateTimer, 1000);
}

function bindSessionQuickJumps() {
  document.querySelectorAll("[data-scroll-section]").forEach((button) => button.addEventListener("click", () => {
    const section = document.querySelector(`[data-assignment-section="${button.dataset.scrollSection}"]`);
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function updateTimer() {
  const element = document.querySelector("#trick-timer");
  if (element) element.textContent = formatTime(Math.floor((Date.now() - state.trickStartedAt) / 1000));
}

async function saveOwnDailyCompletionTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const previousPb = Number(state.profile?.daily_pb_seconds || 0);
  const isNewPb = !previousPb || value < previousPb;
  const profileUpdate = isNewPb
    ? { daily_pb_seconds: value, daily_pb_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    : { updated_at: new Date().toISOString() };
  if (state.activeTraining?.id) {
    await client.from("training_sessions").update({ daily_completed_seconds: value, daily_completed_at: new Date().toISOString() }).eq("id", state.activeTraining.id);
  }
  if (isNewPb) {
    const { data, error } = await client.from("profiles").update(profileUpdate).eq("id", state.user.id).select().single();
    if (!error && data) state.profile = data;
  }
  return { previousPb, isNewPb, seconds: value };
}

async function startSession() {
  const { error } = await client.from("training_sessions").insert({ athlete_id: state.user.id });
  if (error) return notify(messageFrom(error), "error");
  notify("Session started. Go land something.");
  await renderSession();
}

async function recordAssignmentAction(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  const row = button.closest(".assignment-row");
  const wasComplete = row?.classList.contains("complete");
  button.disabled = true;
  row?.classList.toggle("complete", !wasComplete);
  button.textContent = wasComplete ? "" : "✓";
  const { data, error } = await client.rpc("record_assignment_action", {
    p_assignment_id: button.dataset.assignmentId,
    p_action: button.dataset.assignmentAction,
  });
  if (error) {
    button.disabled = false;
    row?.classList.toggle("complete", Boolean(wasComplete));
    button.textContent = wasComplete ? "✓" : "";
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  const pointsNote = result.points_awarded ? ` · +${result.points_awarded} points` : result.points_removed ? ` · -${result.points_removed} points` : "";
  const message = `${result.message}${pointsNote}.`;
  if (result.category === "daily" && result.points_awarded > 0) {
    const completion = await saveOwnDailyCompletionTime(Math.floor((Date.now() - state.trickStartedAt) / 1000));
    celebrate(completion.isNewPb ? `New PB! ${formatPbTime(completion.seconds)}` : `${message} Completed today in ${formatPbTime(completion.seconds)}.`);
  } else notify(message);
  if (state.view === "home") await renderAthleteHome();
  else await renderSession();
}

async function recordAssignmentAttempt(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  const currentCount = Number(button.querySelector(".attempt-pill")?.textContent || 0);
  button.disabled = true;
  button.classList.add("attempted");
  button.innerHTML = `<span>Attempt</span><span class="attempt-pill">${currentCount + 1}</span>`;
  const { data, error } = await client.rpc("record_assignment_attempt", {
    p_assignment_id: button.dataset.assignmentAttempt,
  });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  notify(`${result?.trick_name || "Trick"} attempt saved · ${result?.attempt_count || 1} total.`);
  if (state.view === "home") await renderAthleteHome();
  else await renderSession();
}

async function recordPercentageAttempt(event) {
  const button = event.currentTarget;
  button.disabled = true;
  const clearAttempt = button.dataset.percentageClear === "true";
  const { data, error } = await client.rpc("set_percentage_attempt", {
    p_assignment_id: button.dataset.assignmentId,
    p_attempt_number: Number(button.dataset.percentageAttemptNumber || 1),
    p_landed: clearAttempt ? null : button.dataset.percentageAction === "true",
  });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  notify(clearAttempt ? `Attempt cleared. New result: ${result.percentage}%.` : (result.complete ? `Percentage complete: ${result.percentage}% · +${result.points_awarded || 0} points.` : `Attempt ${result.attempts}/10 saved. No points yet.`));
  if (state.view === "home") await renderAthleteHome();
  else await renderSession();
}

function bindDashboardItemActions(refresh) {
  document.querySelector("#dashboard-item-form")?.addEventListener("submit", (event) => saveDashboardItem(event, refresh));
  document.querySelectorAll("[data-toggle-item]").forEach((button) => button.addEventListener("click", (event) => toggleDashboardItem(event, refresh)));
  document.querySelectorAll("[data-delete-item]").forEach((button) => button.addEventListener("click", (event) => deleteDashboardItem(event, refresh)));
}

async function saveDashboardItem(event, refresh) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const dueAt = form.get("dueAt");
  const endAt = form.get("endAt");
  if (dueAt && endAt && new Date(endAt) < new Date(dueAt)) return notify("Finish date must be after the start date.", "error");
  const button = formElement.querySelector("button");
  button.disabled = true;
  button.textContent = "Adding...";
  const { error } = await client.from("dashboard_items").insert({
    owner_id: formElement.dataset.ownerId,
    created_by: state.user.id,
    item_type: form.get("itemType"),
    title: String(form.get("title") || "").trim(),
    details: String(form.get("details") || "").trim(),
    due_at: dueAt ? new Date(dueAt).toISOString() : null,
    end_at: endAt ? new Date(endAt).toISOString() : null,
  });
  if (error) {
    button.disabled = false;
    button.textContent = "Add";
    return notify(messageFrom(error), "error");
  }
  notify("Event/task added.");
  await refresh();
}

async function toggleDashboardItem(event, refresh) {
  const id = event.currentTarget.dataset.toggleItem;
  const row = event.currentTarget.closest(".dashboard-item");
  const completed = !row?.classList.contains("complete");
  const { error } = await client.from("dashboard_items").update({ completed, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return notify(messageFrom(error), "error");
  notify(completed ? "Marked complete." : "Reopened.");
  await refresh();
}

async function deleteDashboardItem(event, refresh) {
  const id = event.currentTarget.dataset.deleteItem;
  const { error } = await client.from("dashboard_items").delete().eq("id", id);
  if (error) return notify(messageFrom(error), "error");
  notify("Event/task deleted.");
  await refresh();
}

async function recordTrick(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const duration = Math.max(0, Math.floor((Date.now() - state.trickStartedAt) / 1000));
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  const { data, error } = await client.rpc("record_landed_trick", {
    p_session_id: state.activeTraining.id,
    p_trick_name: form.get("trickName"),
    p_category: form.get("category"),
    p_duration_seconds: duration,
  });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  const attempt = Array.isArray(data) ? data[0] : data;
  notify(`${attempt.trick_name} landed for ${attempt.points} points.`);
  await renderSession();
}

async function endSession() {
  const { error } = await client.from("training_sessions").update({ ended_at: new Date().toISOString() }).eq("id", state.activeTraining.id);
  if (error) return notify(messageFrom(error), "error");
  clearInterval(state.timer);
  notify("Session complete. Points locked in.");
  state.activeTraining = null;
  await navigate("home");
}

async function renderBoard() {
  const [rawLeaderboard, boardChat] = await Promise.all([getLeaderboard(), getBoardChat()]);
  const leaderboard = leaderboardWithBenchmark(rawLeaderboard, "weekly_points");
  const allTimeLeaderboard = leaderboardWithBenchmark([...rawLeaderboard].sort((a, b) => Number(b.all_time_points || 0) - Number(a.all_time_points || 0) || String(a.display_name || "").localeCompare(String(b.display_name || ""))), "all_time_points");
  const activeBoardView = state.boardLeaderboardView === "allTime" ? "allTime" : "weekly";
  const activeRows = activeBoardView === "allTime" ? allTimeLeaderboard : leaderboard;
  const activePointsKey = activeBoardView === "allTime" ? "all_time_points" : "weekly_points";
  const boardTitle = activeBoardView === "allTime" ? "All-time rankings" : "Weekly rankings";
  const boardMeta = activeBoardView === "allTime" ? "Total points since joining" : "Resets Sunday midnight";
  const mentionableUsers = boardMentionableUsers(rawLeaderboard);
  state.boardMentionableCache = mentionableUsers;
  const canPost = canPostBoardChat();
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">This week</div><h1>The <span>crew board</span></h1><p>Every landed trick moves the crew. The board resets at midnight every Sunday.</p></div><div class="actions">${pointsHelpHtml()}</div></div>
    ${scoreAdjustmentPanel(rawLeaderboard)}
    <section class="panel board-rankings-panel">
      <div class="panel-head board-rankings-head">
        <div><div class="panel-title">${boardTitle}</div><div class="panel-meta">${boardMeta}</div></div>
        <div class="board-view-toggle" role="tablist" aria-label="Leaderboard view">
          <button type="button" class="${activeBoardView === "weekly" ? "active" : ""}" data-board-view="weekly">Weekly</button>
          <button type="button" class="${activeBoardView === "allTime" ? "active" : ""}" data-board-view="allTime">All-time</button>
        </div>
        <div class="panel-meta">${activeRows.length} riders</div>
      </div>
      <div class="leaderboard">${compactLeaderboardHtml(activeRows, activePointsKey)}</div>
    </section>
    <section class="panel board-chat-panel">
      <div class="panel-head"><div><div class="panel-title">Crew chat</div><div class="panel-meta">Riders and coaches · team chat · reactions, mentions and safe stickers</div></div></div>
      <div class="board-chat-list">${boardChat.length ? boardChat.map(boardChatMessageHtml).join("") : `<div class="empty compact-empty">No crew chat yet. Start with a positive message.</div>`}</div>
      ${canPost ? boardChatComposerHtml(mentionableUsers) : `<div class="empty compact-empty">Crew chat is read-only for parent accounts.</div>`}
    </section>`;
  document.querySelectorAll("[data-public-athlete]").forEach((button) => button.addEventListener("click", openPublicAthleteProfile));
  document.querySelectorAll("[data-board-view]").forEach((button) => button.addEventListener("click", () => {
    state.boardLeaderboardView = button.dataset.boardView || "weekly";
    renderBoard();
  }));
  document.querySelector("#score-adjust-form")?.addEventListener("submit", submitScoreAdjustment);
  document.querySelector("#point-recalc-form")?.addEventListener("submit", submitPointRecalculation);
  document.querySelector("#board-chat-form")?.addEventListener("submit", submitBoardChat);
  document.querySelectorAll("[data-board-reaction]").forEach((button) => button.addEventListener("click", toggleBoardReaction));
  document.querySelectorAll("[data-mention-athlete]").forEach((button) => button.addEventListener("click", openMentionedAthleteProfile));
  bindBoardChatComposer(mentionableUsers);
}

async function submitScoreAdjustment(event) {
  event.preventDefault();
  if (!isCoachRole(state.profile?.role)) return notify("Only coaches can change scores.", "error");
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const athleteId = String(form.get("athleteId") || "");
  const action = String(form.get("action") || "add");
  const amount = Math.abs(Number(form.get("points") || 0));
  const reason = String(form.get("reason") || "").trim().slice(0, 160);
  if (!athleteId || !amount) return notify("Choose a rider and points amount.", "error");
  const signedPoints = action === "deduct" ? -amount : amount;
  if (signedPoints < 0 && !reason) return notify("Add a reason before deducting points.", "error");
  const button = formElement.querySelector("button");
  button.disabled = true;
  button.textContent = "Applying...";
  const { error } = await client.from("leaderboard_point_adjustments").insert({
    athlete_id: athleteId,
    coach_id: state.user.id,
    points: signedPoints,
    reason: reason || `${action === "deduct" ? "Deducted" : "Added"} by coach`,
    week_start: weekStartDate(),
  });
  if (error) {
    button.disabled = false;
    button.textContent = "Apply score change";
    return notify(messageFrom(error), "error");
  }
  if (signedPoints < 0) await createDeductionParentNotification(athleteId, amount, reason);
  notify(`${signedPoints > 0 ? "Added" : "Deducted"} ${amount} point${amount === 1 ? "" : "s"}.`);
  await renderBoard();
}

async function submitPointRecalculation(event) {
  event.preventDefault();
  if (!isCoachRole(state.profile?.role)) return notify("Only coaches can recalculate points.", "error");
  const form = new FormData(event.currentTarget);
  const athleteId = String(form.get("athleteId") || "");
  if (!athleteId) return notify("Choose a rider first.", "error");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Recalculating...";
  const { data, error } = await client.rpc("recalculate_athlete_points", { p_athlete_id: athleteId });
  if (error) {
    button.disabled = false;
    button.textContent = "Recalculate from point history";
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  notify(`Point audit: ${result?.weekly_points || 0} weekly · ${result?.all_time_points || 0} all-time · ${result?.point_events || 0} events.`);
  button.disabled = false;
  button.textContent = "Recalculate from point history";
}

async function createDeductionParentNotification(athleteId, amount, reason) {
  const [{ data: links, error: linksError }, { data: athlete, error: athleteError }] = await Promise.all([
    client.from("parent_athletes").select("parent_id").eq("coach_id", state.user.id).eq("athlete_id", athleteId),
    client.from("profiles").select("display_name").eq("id", athleteId).single(),
  ]);
  if (linksError || athleteError) {
    notify(`Score saved, but parent notification could not be prepared: ${messageFrom(linksError || athleteError)}`, "error");
    return;
  }
  if (!links?.length) return;
  const riderName = athlete?.display_name || "This rider";
  const rows = links.map((link) => ({
    coach_id: state.user.id,
    athlete_id: athleteId,
    recipient_type: "parent",
    recipient_id: link.parent_id,
    week_start: weekStartDate(),
    week_end: weekEndDate(),
    title: `${riderName} had points deducted`,
    summary: `Hi, ${riderName} had ${amount} point${amount === 1 ? "" : "s"} deducted today for behaviour during training. Reason: ${reason}. Please speak with them before the next session.`,
    status: "draft",
    stats: { type: "behaviour_deduction", points: -amount, reason },
    coach_notes: reason,
  }));
  const { error } = await client.from("weekly_progress_notifications").upsert(rows, {
    onConflict: "athlete_id,recipient_type,recipient_id,week_start",
  });
  if (error) notify(`Score saved, but parent notification could not be prepared: ${messageFrom(error)}`, "error");
}

function boardChatMessageHtml(post) {
  const author = post.profiles || {};
  const metadata = post.metadata || {};
  const authorName = metadata.author_name || author.display_name || (post.author_id === state.user?.id ? state.profile?.display_name : "") || "Crew member";
  const authorAvatar = metadata.avatar || author.avatar || null;
  const reactionsByEmoji = post.reactions.reduce((map, reaction) => {
    const list = map.get(reaction.reaction) || [];
    list.push(reaction);
    map.set(reaction.reaction, list);
    return map;
  }, new Map());
  const reactionHtml = boardReactionEmojis.map((emoji) => {
    const reactions = reactionsByEmoji.get(emoji) || [];
    const active = reactions.some((reaction) => reaction.user_id === state.user?.id);
    const people = reactions.map((reaction) => {
      const profile = reaction.profile || {};
      const name = profile.display_name || (reaction.user_id === state.user?.id ? state.profile?.display_name : "") || "Crew member";
      return `<span>${avatarHtml({ display_name: name, avatar: profile.avatar }, "reaction-avatar")}<strong>${escapeHtml(name)}</strong></span>`;
    }).join("");
    return `<span class="reaction-wrap"><button class="reaction-btn ${active ? "active" : ""}" type="button" data-board-reaction="${emoji}" data-post-id="${post.id}" aria-label="React ${emoji}">${emoji}${reactions.length ? `<span>${reactions.length}</span>` : ""}</button>${reactions.length ? `<span class="reaction-popover" role="tooltip">${people}</span>` : ""}</span>`;
  }).join("");
  const stickerUrl = normalizeGifUrl(metadata.sticker_url || metadata.gif_url || "");
  const stickerHtml = stickerUrl ? `<figure class="chat-sticker"><img src="${escapeHtml(stickerUrl)}" alt="${escapeHtml(metadata.sticker_label || metadata.gif_label || "Crew chat sticker")}" loading="lazy"></figure>` : "";
  const bodyHtml = post.body ? `<p>${formatBoardMessageBody(post.body, metadata.mentions || [])}</p>` : "";
  return `<article class="board-chat-message">
    ${avatarHtml({ display_name: authorName, avatar: authorAvatar })}
    <div class="board-chat-bubble"><div class="chat-line-meta"><strong>${escapeHtml(authorName)}</strong><small>${dateLabel(post.created_at)}</small></div>${bodyHtml}${stickerHtml}<div class="reaction-row">${reactionHtml}</div></div>
  </article>`;
}

function boardChatComposerHtml(mentionableUsers = []) {
  const suggestions = mentionableUsers.map((user) => `<button type="button" data-mention-pick="${escapeHtml(user.id)}" data-mention-token="${escapeHtml(user.token)}"><span>${avatarHtml({ display_name: user.name, avatar: user.avatar }, "reaction-avatar")}</span><strong>${escapeHtml(user.name)}</strong><small>@${escapeHtml(user.token)}</small></button>`).join("");
  return `<form id="board-chat-form" class="crew-post-form crew-chat-compose board-chat-compose">
    <div class="board-compose-shell">
      <button class="secondary-btn sticker-icon-btn" type="button" id="toggle-gif-picker" aria-label="Search stickers">Sticker</button>
      <div class="mention-field">
        <textarea id="board-message" name="body" maxlength="300" rows="1" placeholder="${isCoachRole(state.profile?.role) ? "Message the whole crew as coach..." : "Encourage the crew..."}"></textarea>
        <div id="board-mention-menu" class="mention-menu" hidden>${suggestions || `<div class="empty compact-empty">No riders to mention yet.</div>`}</div>
      </div>
      <button class="primary-btn board-send-btn" type="submit" data-send-board-chat>Send</button>
    </div>
    <div id="board-gif-picker" class="sticker-picker" hidden>
      <div class="gif-picker-head">
        <div><strong>Sticker search</strong><small>Search the safe sticker library</small></div>
        <div class="gif-search-row">
          <input id="board-gif-search" type="search" inputmode="search" placeholder="Search BMX, hype, fire...">
          <button class="secondary-btn compact-btn" type="button" id="board-gif-search-btn">Search</button>
        </div>
      </div>
      <div class="gif-results" id="board-gif-results"><div class="gif-results-status">Open Sticker search to load results.</div></div>
      <div class="empty compact-empty gif-no-results" id="board-gif-empty" hidden>No sticker results found for that search.</div>
    </div>
    <div id="board-gif-preview" class="chat-sticker-preview" hidden></div>
  </form>`;
}

async function submitBoardChat(event) {
  event.preventDefault();
  if (!canPostBoardChat()) return notify("Only riders and coaches can post in crew chat.", "error");
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const body = String(form.get("body") || "").trim();
  if (containsGifUrl(body)) return notify("Use the Sticker button instead of pasting sticker links.", "error");
  const gifUrl = normalizeGifUrl(formElement.dataset.gifUrl || "");
  if (!body && !gifUrl) return notify("Write a message or add a sticker first.", "error");
  const mentions = extractBoardMentions(body, state.boardMentionableCache || []);
  const button = formElement.querySelector("[data-send-board-chat]");
  button.disabled = true;
  button.textContent = "Sending...";
  const { error } = await client.from("crew_posts").insert({
    author_id: state.user.id,
    body,
    post_type: "chat",
    metadata: {
      author_name: state.profile?.display_name || state.user?.email || "Crew member",
      author_role: state.profile?.role || "member",
      avatar: state.profile?.avatar || null,
      sticker_url: gifUrl || null,
      sticker_label: gifUrl ? String(formElement.dataset.gifLabel || "Crew chat sticker").slice(0, 80) : null,
      mentions,
    },
  });
  if (error) {
    button.disabled = false;
    button.textContent = "Send";
    return notify(messageFrom(error), "error");
  }
  notify("Message posted.");
  await renderBoard();
}

function bindBoardChatComposer(mentionableUsers = []) {
  const form = document.querySelector("#board-chat-form");
  if (!form) return;
  const textarea = form.querySelector("#board-message");
  const menu = form.querySelector("#board-mention-menu");
  const gifPreview = form.querySelector("#board-gif-preview");
  const gifPicker = form.querySelector("#board-gif-picker");
  const gifSearch = form.querySelector("#board-gif-search");
  const gifSearchButton = form.querySelector("#board-gif-search-btn");
  const gifResults = form.querySelector("#board-gif-results");
  const gifEmpty = form.querySelector("#board-gif-empty");
  let gifSearchTimer = null;
  let gifSearchOffset = 0;
  let gifCurrentQuery = "";
  const showGifPreview = (url, label = "Crew chat sticker") => {
    const safeUrl = normalizeGifUrl(url);
    if (!safeUrl) {
      gifPreview.hidden = true;
      gifPreview.innerHTML = "";
      form.dataset.gifUrl = "";
      form.dataset.gifLabel = "";
      return;
    }
    form.dataset.gifUrl = safeUrl;
    form.dataset.gifLabel = label;
    gifPreview.hidden = false;
    gifPreview.innerHTML = `<span>Sticker ready</span><img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(label)}"><button class="secondary-btn compact-btn" type="button" id="clear-board-gif">Remove</button>`;
    gifPreview.querySelector("#clear-board-gif")?.addEventListener("click", () => showGifPreview("", ""));
  };
  const setGifStatus = (message, tone = "") => {
    if (!gifResults) return;
    gifResults.innerHTML = `<div class="gif-results-status ${tone}">${escapeHtml(message)}</div>`;
    if (gifEmpty) gifEmpty.hidden = true;
  };
  const gifResultButtonsHtml = (gifs = []) => gifs.map((gif) => `
      <button type="button" data-gif-url="${escapeHtml(gif.url)}" data-gif-label="${escapeHtml(gif.label)}">
        <img src="${escapeHtml(gif.preview)}" alt="${escapeHtml(gif.label)}" loading="lazy">
        <span>${escapeHtml(gif.label)}</span>
      </button>
    `).join("");
  const renderGifResults = (gifs = [], { append = false, hasMore = false } = {}) => {
    if (!gifResults) return;
    if (!gifs.length && !append) {
      gifResults.innerHTML = "";
      if (gifEmpty) gifEmpty.hidden = false;
      return;
    }
    if (gifEmpty) gifEmpty.hidden = true;
    const previousButtons = append
      ? [...gifResults.querySelectorAll("[data-gif-url]")].map((button) => button.outerHTML).join("")
      : "";
    const loadMore = hasMore ? `<button type="button" class="gif-load-more" data-gif-load-more>Load more stickers</button>` : "";
    gifResults.innerHTML = `${previousButtons}${gifResultButtonsHtml(gifs)}${loadMore}`;
  };
  const loadGiphyResults = async (query = "", append = false) => {
    if (!gifResults) return;
    const normalizedQuery = String(query || "").trim();
    if (!append || normalizedQuery !== gifCurrentQuery) {
      gifCurrentQuery = normalizedQuery;
      gifSearchOffset = 0;
    }
    if (append) {
      const loadMoreButton = gifResults.querySelector("[data-gif-load-more]");
      if (loadMoreButton) {
        loadMoreButton.disabled = true;
        loadMoreButton.textContent = "Loading...";
      }
    } else {
      setGifStatus("Searching stickers...");
    }
    try {
      const result = await searchGiphy(gifCurrentQuery, gifSearchOffset);
      gifSearchOffset += result.gifs.length;
      renderGifResults(result.gifs, { append, hasMore: result.hasMore });
    } catch (error) {
      setGifStatus(messageFrom(error), "error");
    }
  };
  const queueGiphySearch = () => {
    clearTimeout(gifSearchTimer);
    gifSearchTimer = setTimeout(() => loadGiphyResults(gifSearch?.value || ""), 360);
  };
  const refreshMentionMenu = () => {
    if (!textarea || !menu) return;
    const beforeCursor = textarea.value.slice(0, textarea.selectionStart || textarea.value.length);
    const match = beforeCursor.match(/(^|\s)@([a-z0-9]*)$/i);
    if (!match) {
      menu.hidden = true;
      return;
    }
    const term = match[2].toLowerCase();
    let visible = 0;
    menu.querySelectorAll("[data-mention-pick]").forEach((button) => {
      const token = button.dataset.mentionToken || "";
      const name = button.querySelector("strong")?.textContent?.toLowerCase() || "";
      const matched = token.includes(term) || name.includes(term);
      button.hidden = !matched;
      if (matched) visible += 1;
    });
    menu.hidden = visible === 0;
  };
  textarea?.addEventListener("input", refreshMentionMenu);
  textarea?.addEventListener("paste", (event) => {
    const clipboard = event.clipboardData;
    const text = clipboard?.getData("text") || "";
    const hasImageOrGif = [...(clipboard?.items || [])].some((item) => item.type === "image/gif" || item.type.startsWith("image/"));
    if (hasImageOrGif || containsGifUrl(text)) {
      event.preventDefault();
      notify("Use the Sticker button to search and add stickers.", "error");
    }
  });
  textarea?.addEventListener("blur", () => setTimeout(() => { if (menu) menu.hidden = true; }, 160));
  menu?.querySelectorAll("[data-mention-pick]").forEach((button) => button.addEventListener("click", () => {
    const token = button.dataset.mentionToken;
    const cursor = textarea.selectionStart || textarea.value.length;
    const beforeCursor = textarea.value.slice(0, cursor);
    const afterCursor = textarea.value.slice(cursor);
    const match = beforeCursor.match(/(^|\s)@([a-z0-9]*)$/i);
    if (!match || !token) return;
    const replacementStart = beforeCursor.length - match[0].length;
    textarea.value = `${beforeCursor.slice(0, replacementStart)}${match[1]}@${token} ${afterCursor}`;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = replacementStart + match[1].length + token.length + 2;
    menu.hidden = true;
  }));
  document.querySelector("#toggle-gif-picker")?.addEventListener("click", () => {
    gifPicker.hidden = !gifPicker.hidden;
    if (!gifPicker.hidden) {
      gifSearch?.focus();
      if (!gifResults?.querySelector("[data-gif-url]")) loadGiphyResults("");
    }
  });
  gifResults?.addEventListener("click", (event) => {
    if (event.target.closest("[data-gif-load-more]")) {
      loadGiphyResults(gifCurrentQuery, true);
      return;
    }
    const button = event.target.closest("[data-gif-url]");
    if (!button) return;
    showGifPreview(button.dataset.gifUrl, button.dataset.gifLabel || "Crew chat sticker");
    gifPicker.hidden = true;
  });
  gifSearch?.addEventListener("input", queueGiphySearch);
  gifSearch?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadGiphyResults(gifSearch.value || "");
    }
  });
  gifSearchButton?.addEventListener("click", () => loadGiphyResults(gifSearch?.value || ""));
}

async function toggleBoardReaction(event) {
  const button = event.currentTarget;
  const postId = button.dataset.postId;
  const reaction = button.dataset.boardReaction;
  if (!postId || !reaction) return;
  const active = button.classList.contains("active");
  button.disabled = true;
  const query = client.from("crew_post_reactions").delete().eq("post_id", postId).eq("user_id", state.user.id).eq("reaction", reaction);
  const { error } = active
    ? await query
    : await client.from("crew_post_reactions").insert({ post_id: postId, user_id: state.user.id, reaction });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  await renderBoard();
}

function openPublicAthleteProfile(event) {
  state.publicAthleteId = event.currentTarget.dataset.publicAthlete;
  navigate("publicProfile");
}

function openMentionedAthleteProfile(event) {
  state.publicAthleteId = event.currentTarget.dataset.mentionAthlete;
  navigate("publicProfile");
}

async function renderPublicAthleteProfile() {
  if (!state.publicAthleteId) return navigate("board");
  const profile = await getPublicAthleteProfile(state.publicAthleteId);
  if (!profile) {
    document.querySelector("#view").innerHTML = `<div class="empty">Could not find that rider profile.</div>`;
    return;
  }
  const badges = earnedBadges(profile.badges);
  let publicTricktionary = "";
  try {
    const trickData = await getTricktionaryData(state.publicAthleteId);
    const entries = landedTricktionaryEntries(trickData);
    publicTricktionary = `<details class="command-accordion public-tricktionary-dropdown">
      <summary><span><strong>Tricktionary</strong><small>${entries.length} public landed trick${entries.length === 1 ? "" : "s"}</small></span><span class="accordion-caret">Open</span></summary>
      ${tricktionaryEntriesHtml(entries, [])}
    </details>`;
  } catch (_error) {
    publicTricktionary = `<details class="command-accordion public-tricktionary-dropdown"><summary><span><strong>Tricktionary</strong><small>Not visible yet</small></span><span class="accordion-caret">Open</span></summary><div class="empty compact-empty">This rider's Tricktionary is not available publicly yet.</div></details>`;
  }
  const badgeHtml = [
    profile.is_weekly_winner ? `<span class="public-badge"><span>🏅</span>Weekly leader</span>` : "",
    profile.is_last_place ? `<span class="public-badge"><span>💩</span>Weekly last place</span>` : "",
    badgeStripHtml(badges, ""),
  ].filter(Boolean).join("");
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Public rider profile</div><h1>${escapeHtml(profile.display_name)} <span>#${profile.current_rank || "-"}</span></h1><p>Public rider info, medals, badges, and weekly points history.</p></div><button class="secondary-btn" id="back-to-board">Back to board</button></div>
    <section class="panel public-profile-card">
      ${avatarHtml(profile, "public-profile-avatar")}
      <div>
        <div class="eyebrow">Rider profile</div>
        <h2>${escapeHtml(profile.display_name)}</h2>
        <div class="public-badges">${badgeHtml || `<span class="public-badge muted-badge">No earned badges yet</span>`}</div>
      </div>
    </section>
    ${showreelHtml(profile)}
    ${socialLinksHtml(profile)}
    <section class="stats-grid public-profile-stats">
      ${statCard("Weekly points", profile.weekly_points || 0, "pts", `Current rank #${profile.current_rank || "-"}`)}
      ${statCard("Weekly wins", profile.weekly_wins || 0, "", "Leaderboard wins")}
      ${statCard("Country", profile.country_code ? `${countryFlag(profile.country_code)} ${profile.country_name || countryNameFromCode(profile.country_code)}` : "-", "", "Where they ride from")}
      ${statCard("Stance", profile.stance || "-", "", "Goofy or regular")}
      ${statCard("Spin", spinDirectionLabels[profile.spin_direction] || "-", "", "Natural direction")}
      ${statCard("Favourite trick", profile.favourite_trick || "-", "", "Rider pick")}
      ${statCard("Age", profile.age || "-", "", "Rider age")}
    </section>
    <section class="panel public-profile-details">
      <div class="public-detail"><div class="panel-title">Sponsors</div>${linesHtml(profile.sponsors, "No sponsors added yet.")}</div>
      <div class="public-detail"><div class="panel-title">Achievements</div>${linesHtml(profile.achievements, "No achievements added yet.")}</div>
    </section>
    ${publicTricktionary}`;
  document.querySelector("#back-to-board").addEventListener("click", () => navigate("board"));
}

async function renderAthleteCrew() {
  const [leaderboard, feed] = await Promise.all([getLeaderboard(), getCrewFeed()]);
  const leader = leaderboard[0];
  const orderedFeed = [...feed].reverse();
  const feedHtml = orderedFeed.length ? orderedFeed.map((item) => `
    <article class="feed-card chat-message ${item.author_id === state.user.id ? "mine" : ""} ${item.feed_type === "landed" ? "activity" : ""}">
      ${avatarHtml({ display_name: item.author_name, avatar: item.avatar })}
      <div class="chat-bubble"><strong>${escapeHtml(item.author_name || "JKCREW")}</strong><p>${escapeHtml(item.body)}${item.points ? ` · +${item.points} pts` : ""}</p><small>${dateLabel(item.created_at)}</small></div>
    </article>`).join("") : `<div class="empty">No crew activity yet.</div>`;
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Crew live</div><h1>JKCREW <span>feed</span></h1><p>Chat with the crew and see live notifications when someone moves up or lands a trick.</p></div></div>
    ${leader ? `<section class="panel leader-alert"><div class="live-dot"></div><div><div class="panel-title">Current leader: ${escapeHtml(leader.display_name)}</div><div class="panel-meta">${leader.weekly_points} points this week · new leaders show here</div></div></section>` : ""}
    <section class="panel crew-chat-panel">
      <div class="panel-head"><div><div class="panel-title">Group chat</div><div class="panel-meta">Newest messages stay at the bottom</div></div></div>
      <div class="feed-list chat-list" id="crew-chat-list">${feedHtml}</div>
      <form id="crew-post-form" class="crew-post-form crew-chat-compose"><textarea id="crew-message" name="body" required maxlength="500" rows="1" placeholder="Message the crew..."></textarea><button class="primary-btn" type="submit">Send</button></form>
    </section>`;
  document.querySelector("#crew-post-form").addEventListener("submit", submitCrewPost);
  requestAnimationFrame(() => {
    const list = document.querySelector("#crew-chat-list");
    if (list) list.scrollTop = list.scrollHeight;
  });
}

async function submitCrewPost(event) {
  event.preventDefault();
  const body = String(new FormData(event.currentTarget).get("body") || "").trim();
  if (!body) return notify("Write a message first.", "error");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Posting...";
  const { error } = await client.from("crew_posts").insert({
    author_id: state.user.id,
    body,
    post_type: "chat",
    metadata: {
      author_name: state.profile?.display_name || state.user?.email || "Crew member",
      author_role: state.profile?.role || "member",
      avatar: state.profile?.avatar || null,
    },
  });
  if (error) {
    button.disabled = false;
    button.textContent = "Post to Crew";
    return notify(messageFrom(error), "error");
  }
  notify("Posted to Crew.");
  await renderAthleteCrew();
}

async function renderContests() {
  const [items, runs] = await Promise.all([
    getDashboardItems(state.user.id),
    getRunPlans(state.user.id),
  ]);
  const events = items.filter((item) => item.item_type === "event");
  const upcoming = events.filter((item) => !item.due_at || new Date(item.end_at || item.due_at) >= new Date());
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Contests</div><h1>Events & <span>runs</span></h1><p>Plan competition lines, view upcoming contests, and keep old runs archived for later.</p></div></div>
    <section class="panel contests-overview">
      <div class="panel-head"><div><div class="panel-title">Upcoming events & contests</div><div class="panel-meta">${upcoming.length} upcoming · dates can include start and finish</div></div></div>
      ${dashboardItemsHtml(events, true)}
      <div class="settings-divider"></div>
      ${dashboardItemForm(state.user.id)}
    </section>
    ${runBuilderPanel(runs)}`;
  bindDashboardItemActions(renderContests);
  bindRunBuilderActions();
}

async function renderCoachCommand() {
  const roster = await getCoachRoster();
  if (!roster.length) {
    document.querySelector("#view").innerHTML = `<div class="page-head"><div><div class="eyebrow">Coach command centre</div><h1>No <span>riders</span></h1><p>Add students first, then this becomes your calendar, heat map, attendance, and parent-update hub.</p></div></div><div class="empty">No students linked yet.</div>`;
    return;
  }
  const commandData = await getCoachCommandData(roster);
  const attentionCount = roster.filter((athlete) => athleteAttention(athlete, commandData).flags.length).length;
  const injuredCount = commandData.statuses.filter((status) => status.heat_status === "injured").length;
  const calendarFeed = combinedCoachCalendarItems(commandData);
  const groupedCalendar = groupCoachCalendarItems(calendarFeed, roster);
  const upcoming = groupedCalendar.filter((event) => new Date(event.starts_at) >= new Date()).length;
  const priorityTasks = highPriorityTasks(roster, commandData, groupedCalendar);
  const teamSections = [
    commandAccordionSection("upcoming-events-section", "Upcoming Events", "Grouped by event, date and venue", `${calendarItemsHtml(groupedCalendar, roster)}<div class="settings-divider"></div><details class="coach-tool-details"><summary>Add coach calendar event</summary>${coachCalendarForm(roster)}</details>`),
    commandAccordionSection("rider-heat-map-section", "Rider Heat Map", "On track, needs help, injured or competition prep", `<div class="overview-list">${athleteOverviewHtml(roster, commandData)}</div>`),
    commandAccordionSection("parent-updates-section", "Parent Updates", "Weekly progress summaries and parent messages", `${weeklyNotificationControlsHtml(commandData)}<div class="settings-divider"></div><div class="empty compact-empty">Open a rider profile to generate or edit a parent update before sending.</div>`),
  ].join("");
  const adminSections = [
    commandAccordionSection("attendance-section", "Attendance", "Save attendance for group sessions", attendanceForm(roster)),
    commandAccordionSection("payments-section", "Payments / Reimbursements", "Attendance history and outstanding venue costs", attendanceHistoryHtml(commandData.attendanceSessions)),
    commandAccordionSection("injury-section", "Injury Reports", "Modified training and rider file shortcuts", `<div class="notification-list">${commandData.statuses.filter((status) => status.heat_status === "injured").map((status) => {
      const athlete = roster.find((entry) => entry.id === status.athlete_id);
      return `<button class="notification-card" type="button" data-open-student="${escapeHtml(status.athlete_id)}"><span>Injury</span><strong>${escapeHtml(athlete?.display_name || "Rider")} — modified training / injury</strong></button>`;
    }).join("") || `<div class="empty compact-empty">No injured / modified riders marked.</div>`}</div>`),
    commandAccordionSection("records-section", "Emergency Contacts / Waivers / Forms", "Open rider files to view private records", `<div class="notification-list">${roster.map((athlete) => `<button class="notification-card" type="button" data-open-student="${athlete.id}"><span>Rider file</span><strong>${escapeHtml(athlete.display_name)} — emergency contacts, waivers, forms</strong></button>`).join("")}</div>`),
    commandAccordionSection("settings-section", "Settings", "Coach account and app settings", `<button class="secondary-btn" data-view="profile" type="button">Open Coach Profile</button>`),
  ].join("");
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Coach command centre</div><h1>JKCoaching <span>HQ</span></h1><p>Calendar, rider heat map, attendance, reimbursements, and athlete alerts in one coach-only area.</p></div></div>
    ${highPriorityTodoHtml(priorityTasks)}
    <section class="stats-grid command-stats-grid">
      ${statCard("Students", roster.length, "", "In your crew")}
      ${statCard("Need attention", attentionCount, "", "Auto flags")}
      ${statCard("Upcoming", upcoming, "", "Grouped events")}
      ${statCard("Modified", injuredCount, "", "Injured / modified")}
    </section>
    <section class="coach-tools-row">
      <button class="coach-tool-card" data-view="sessionViewer"><strong>Session Viewer</strong><small>Open iPad group checklist</small></button>
      <button class="coach-tool-card" data-view="crew"><strong>Students</strong><small>Groups, profiles, programs</small></button>
      <button class="coach-tool-card" data-view="parents"><strong>Parents</strong><small>Linked viewer accounts</small></button>
      <button class="coach-tool-card" data-view="board"><strong>Leaderboard</strong><small>Rankings and rider chat</small></button>
    </section>
    <section class="command-section-group">
      <div class="command-section-heading"><span>01</span><div><strong>Team Management</strong><small>Upcoming events, rider heat map, and parent updates</small></div></div>
      <div class="command-accordion-stack compact-command-stack">${teamSections}</div>
    </section>
    <section class="command-section-group">
      <div class="command-section-heading"><span>02</span><div><strong>Admin & Records</strong><small>Attendance, payments, injuries, records, and settings</small></div></div>
      <div class="command-accordion-stack compact-command-stack">${adminSections}</div>
    </section>`;
  document.querySelector("#coach-calendar-form")?.addEventListener("submit", saveCoachCalendarEvent);
  document.querySelector("#attendance-form")?.addEventListener("submit", saveAttendanceSession);
  document.querySelector("#weekly-notification-settings-form")?.addEventListener("submit", saveWeeklyNotificationSettings);
  document.querySelector("#generate-weekly-previews")?.addEventListener("click", () => generateWeeklyNotificationPreviews(roster, commandData));
  document.querySelectorAll("[data-dismiss-task]").forEach((button) => button.addEventListener("click", dismissCoachTask));
  document.querySelectorAll(".heat-form").forEach((form) => form.addEventListener("submit", saveHeatStatus));
  document.querySelectorAll("#view [data-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  document.querySelectorAll("[data-open-student]").forEach((button) => button.addEventListener("click", () => {
    state.selectedAthleteId = button.dataset.openStudent;
    navigate("student");
  }));
  document.querySelectorAll("[data-command-scroll]").forEach((button) => button.addEventListener("click", () => {
    const target = document.querySelector(`#${button.dataset.commandScroll}`);
    if (!target) return notify("Could not find that command section.", "error");
    target.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

async function renderSessionViewer() {
  if (state.sessionViewerTimer) {
    clearInterval(state.sessionViewerTimer);
    state.sessionViewerTimer = null;
  }
  if (state.sessionViewerClock) {
    clearInterval(state.sessionViewerClock);
    state.sessionViewerClock = null;
  }
  const roster = await getCoachRoster();
  if (state.view !== "sessionViewer") return;
  if (!isCoachRole(state.profile?.role)) return navigate("home");
  if (!roster.length) {
    document.querySelector("#view").innerHTML = `<div class="page-head"><div><div class="eyebrow">Coach tool</div><h1>Session <span>Viewer</span></h1><p>Add students first, then you can manage group Daily Tricks from here.</p></div></div><div class="empty">No students linked yet.</div>`;
    return;
  }
  const activeGroupSession = await getActiveCoachGroupSession();
  state.sessionViewerRosterCache = roster;
  state.sessionViewerActiveSessionCache = activeGroupSession;
  if (activeGroupSession) {
    state.sessionViewerGroup = activeGroupSession.group_name || state.sessionViewerGroup;
    state.sessionViewerVenue = activeGroupSession.venue || state.sessionViewerVenue;
  }
  const groupOptions = coachGroups.map(([id, label]) => `<option value="${id}" ${state.sessionViewerGroup === id ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const search = state.sessionViewerSearch.toLowerCase().trim();
  const activeParticipantIds = new Set((activeGroupSession?.coach_group_session_participants || []).map((row) => row.athlete_id));
  const groupRoster = roster.filter((athlete) => (athlete.groupNames || [athlete.groupName]).includes(state.sessionViewerGroup) || activeParticipantIds.has(athlete.id));
  const filteredRoster = groupRoster.filter((athlete) => !search || athlete.display_name.toLowerCase().includes(search));
  if (!state.sessionViewerOpenAthleteId || !filteredRoster.some((athlete) => athlete.id === state.sessionViewerOpenAthleteId)) {
    state.sessionViewerOpenAthleteId = "";
  }
  const athleteIds = filteredRoster.map((athlete) => athlete.id);
  const { assignmentsByAthlete, runsByAthlete, runProgressByPlan } = await getSessionViewerPlanData(athleteIds);
  const schedules = filteredRoster.map((athlete) => {
    const allAssignments = assignmentsByAthlete.get(athlete.id) || [];
    const allDaily = allAssignments.filter((assignment) => assignment.category === "daily");
    const selectedVenue = state.sessionViewerVenue || dailyVenues(allDaily)[0] || "";
    const visibleDaily = assignmentsForVenue(allDaily, selectedVenue);
    const participant = activeGroupSession?.coach_group_session_participants?.find((row) => row.athlete_id === athlete.id);
    return { athlete, assignments: allAssignments, allDaily, daily: visibleDaily, venue: selectedVenue, participant, runs: runsByAthlete.get(athlete.id) || [], runProgressByPlan };
  });
  if (state.view !== "sessionViewer") return;
  if (!state.sessionViewerVenue) {
    const firstVenue = schedules.flatMap((entry) => dailyVenues(entry.allDaily)).find((venue) => venue !== undefined);
    state.sessionViewerVenue = firstVenue || "";
    schedules.forEach((entry) => {
      entry.venue = state.sessionViewerVenue;
      entry.daily = assignmentsForVenue(entry.allDaily, state.sessionViewerVenue);
    });
  }
  const venueOptions = sessionViewerVenueOptions(groupRoster, schedules);
  const started = Boolean(activeGroupSession);
  const cards = schedules.length ? schedules.map((entry) => {
    const { athlete, daily, venue, participant } = entry;
    const complete = daily.filter(isAssignmentComplete).length;
    const percent = daily.length ? Math.round((complete / daily.length) * 100) : 0;
    const isOpen = athlete.id === state.sessionViewerOpenAthleteId;
    const finish = participant?.daily_finish_seconds ? ` · Finished ${formatPbTime(participant.daily_finish_seconds)}` : "";
    const finishButton = activeGroupSession && !participant?.daily_finish_seconds ? `<button class="secondary-btn compact-btn finish-daily-btn" type="button" data-finish-daily-athlete="${athlete.id}">Finish Daily Tricks</button>` : "";
    return `<article class="viewer-rider-accordion ${isOpen ? "open" : ""}">
      <button class="viewer-rider-card ${isOpen ? "active" : ""}" type="button" data-viewer-athlete="${athlete.id}" aria-expanded="${isOpen}">
        <div class="viewer-card-head">${avatarHtml(athlete, "student-chip-avatar")}<div><strong>${escapeHtml(athlete.display_name)}</strong><small>${escapeHtml(venueLabel(venue))} · ${complete}/${daily.length} complete${finish}</small></div></div>
        <span class="accordion-caret">${isOpen ? "Close" : "Open"}</span>
        <div class="viewer-progress"><span style="width:${percent}%"></span></div>
      </button>
      ${finishButton}
      ${isOpen ? sessionViewerPlanList(entry, activeGroupSession) : ""}
    </article>`;
  }).join("") : `<div class="empty compact-empty">No riders match this group/search.</div>`;
  const idleCount = schedules.filter((entry) => !entry.participant?.last_activity_at).length;
  const availableExtras = started ? roster.filter((athlete) => !activeParticipantIds.has(athlete.id)) : [];
  const extraOptions = availableExtras.map((athlete) => `<option value="${athlete.id}">${escapeHtml(athlete.display_name)} · ${escapeHtml(groupLabelList(athlete.groupNames || [athlete.groupName]))}</option>`).join("");
  const extraRiderForm = started && availableExtras.length ? `
    <section class="panel extra-session-rider-panel">
      <form id="add-session-rider-form" class="trick-form">
        <div class="field"><label for="session-extra-athlete">One-off extra rider</label><select id="session-extra-athlete" name="athleteId">${extraOptions}</select></div>
        <button class="secondary-btn" type="submit">Add to this session</button>
      </form>
    </section>` : "";
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Live coach tool</div><h1>Group <span>Session</span></h1><p>Select a group and venue, start the timer, then riders tap their own name to tick their own Daily Tricks.</p></div><button class="secondary-btn" id="viewer-refresh">Refresh</button></div>
    <section class="panel group-session-control ${activeGroupSession?.status || "ready"}">
      <div class="group-timer-block"><div class="timer-label">${started ? `${escapeHtml(coachGroupLabel(activeGroupSession.group_name))} · ${escapeHtml(venueLabel(activeGroupSession.venue))}` : "Ready for group session"}</div><div class="group-session-timer" id="group-session-timer" data-started-at="${escapeHtml(activeGroupSession?.started_at || "")}" data-paused-at="${escapeHtml(activeGroupSession?.paused_at || "")}" data-paused-seconds="${Number(activeGroupSession?.total_paused_seconds || 0)}" data-status="${escapeHtml(activeGroupSession?.status || "ready")}">${started ? formatTime(groupSessionElapsedSeconds(activeGroupSession)) : "00:00"}</div><small>${started ? `${escapeHtml(activeGroupSession.status)} · ${schedules.length} riders · ${idleCount} not logged yet` : "Only coach/admin can start, pause, resume or end."}</small></div>
      <div class="group-session-actions">
        ${started ? `<button class="secondary-btn" id="pause-group-session" type="button">${activeGroupSession.status === "paused" ? "Resume" : "Pause"}</button><button class="danger-btn" id="end-group-session" type="button">End session</button>` : `<button class="primary-btn" id="start-group-session" type="button">Start session</button>`}
      </div>
    </section>
    <section class="panel session-viewer-controls">
      <div class="field"><label for="viewer-group">Group/session</label><select id="viewer-group" ${started ? "disabled" : ""}>${groupOptions}</select></div>
      <div class="field"><label for="viewer-venue">Venue/skate park</label><select id="viewer-venue" ${started ? "disabled" : ""}>${venueOptions}</select></div>
      <div class="field"><label for="viewer-search">Find rider</label><input id="viewer-search" value="${escapeHtml(state.sessionViewerSearch)}" placeholder="Search rider name"></div>
    </section>
    ${extraRiderForm}
    <section class="session-viewer-layout">
      <div class="viewer-accordion-panel"><div class="viewer-roster-head"><div class="panel-title">Riders in session</div><div class="panel-meta">${escapeHtml(coachGroupLabel(state.sessionViewerGroup))} · ${escapeHtml(venueLabel(state.sessionViewerVenue))}</div></div><div class="viewer-rider-grid viewer-accordion-list">${cards}</div></div>
    </section>`;
  bindSessionViewerActions();
  updateGroupSessionTimerDom();
  state.sessionViewerClock = setInterval(updateGroupSessionTimerDom, 1000);
}

function sessionViewerVenueOptions(groupRoster = [], schedules = []) {
  const venues = new Set();
  if (state.sessionViewerVenue) venues.add(state.sessionViewerVenue);
  schedules.forEach((entry) => entry.allDaily.forEach((assignment) => venues.add(venueKey(assignment.venue))));
  groupRoster.forEach(() => {});
  const values = [...venues].filter((venue) => venue !== undefined);
  if (!values.length) values.push(state.sessionViewerVenue || "");
  return values.map((venue) => `<option value="${escapeHtml(venue)}" ${venue === state.sessionViewerVenue ? "selected" : ""}>${escapeHtml(venueLabel(venue))}</option>`).join("");
}

function groupSessionElapsedSeconds(session) {
  if (!session?.started_at) return 0;
  const pausedBase = Number(session.total_paused_seconds || 0);
  const pausedNow = session.status === "paused" && session.paused_at ? Math.max(0, Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000)) : 0;
  return Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000) - pausedBase - pausedNow);
}

function updateGroupSessionTimerDom() {
  const timerElement = document.querySelector("#group-session-timer");
  if (!timerElement || !timerElement.dataset.startedAt) return;
  const pseudoSession = {
    started_at: timerElement.dataset.startedAt,
    paused_at: timerElement.dataset.pausedAt,
    total_paused_seconds: Number(timerElement.dataset.pausedSeconds || 0),
    status: timerElement.dataset.status,
  };
  timerElement.textContent = formatTime(groupSessionElapsedSeconds(pseudoSession));
}

function activeSessionViewerList() {
  return sessionViewerListTabs.some((tab) => tab.id === state.sessionViewerActiveList) ? state.sessionViewerActiveList : "daily";
}

function sessionViewerAssignmentsForList(entry, listId) {
  if (listId === "daily") return assignmentsForVenue(entry.assignments.filter((assignment) => assignment.category === "daily"), entry.venue);
  return entry.assignments.filter((assignment) => assignment.category === listId);
}

function sessionViewerPlanList(entry, activeGroupSession) {
  const activeList = activeSessionViewerList();
  const tabs = sessionViewerListTabs.map((tab) => {
    const count = sessionViewerListCount(entry, tab.id);
    return `<button class="viewer-list-tab ${tab.id === activeList ? "active" : ""}" type="button" data-viewer-list-tab="${tab.id}">${escapeHtml(tab.label)}<span>${count}</span></button>`;
  }).join("");
  return `<div class="viewer-inline-list">
    <div class="viewer-list-tabs" role="tablist" aria-label="Rider trick lists">${tabs}</div>
    ${sessionViewerListContent(entry, activeGroupSession, activeList)}
  </div>`;
}

function sessionViewerListCount(entry, listId) {
  if (listId === "goals") return Array.isArray(entry.athlete.goals) ? entry.athlete.goals.length : 0;
  if (listId === "contest_run") return sessionViewerActiveRun(entry)?.points?.length || 0;
  return sessionViewerAssignmentsForList(entry, listId).length;
}

function sessionViewerListContent(entry, activeGroupSession, listId) {
  if (listId === "goals") return sessionViewerGoalsList(entry);
  if (listId === "contest_run") return sessionViewerRunList(entry);
  const assignments = sessionViewerAssignmentsForList(entry, listId);
  const complete = assignments.filter(isAssignmentComplete).length;
  const isPaused = activeGroupSession?.status === "paused";
  const info = categoryInfo[listId] || { label: "Tricks", description: "" };
  const editor = isCoachRole(state.profile?.role) ? sessionViewerAssignmentEditor(entry, listId, assignments) : "";
  if (listId === "percentage") {
    const label = info.label;
    return `<div class="panel-meta viewer-list-meta">${escapeHtml(label)} · ${complete}/${assignments.length} complete${isPaused ? " · timer paused" : ""}</div>${editor}<div class="viewer-percentage-list">${percentageAssignmentList(assignments, "No Percentage Tricks assigned.", true)}</div>`;
  }
  const list = assignments.length ? assignments.map((assignment) => {
    const done = isAssignmentComplete(assignment);
    const attemptCount = assignment.assignmentAttempts?.length || 0;
    return `<div class="viewer-trick-row viewer-attempt-row ${done ? "complete" : ""} ${assignment.category === "bonus" ? "bonus-viewer-row" : ""}">
      <button class="assignment-check" type="button" data-viewer-assignment-action="${done ? "unlanded" : "landed"}" data-assignment-id="${assignment.id}" aria-label="${done ? "Untick landed" : "Mark landed"}">${done ? "✓" : ""}</button>
      <button class="attempt-btn ${attemptCount ? "attempted" : ""}" type="button" data-viewer-assignment-attempt="${assignment.id}" aria-label="Add one attempt"><span>Attempt</span>${attemptCount ? `<span class="attempt-pill">${attemptCount}</span>` : ""}</button>
      <span><strong>${escapeHtml(assignment.trick_name)}</strong><small>${escapeHtml(assignmentStatus(assignment))}${assignment.notes ? ` · ${escapeHtml(assignment.notes)}` : ""}${attemptCount ? ` · ${attemptCount} attempt${attemptCount === 1 ? "" : "s"}` : ""}</small></span>
    </div>`;
  }).join("") : `<div class="empty compact-empty">No ${escapeHtml(info.label)} assigned${listId === "daily" ? " for this venue" : ""}.</div>`;
  const label = listId === "daily" ? `${venueLabel(entry.venue)} Daily Tricks` : info.label;
  return `<div class="panel-meta viewer-list-meta">${escapeHtml(label)} · ${complete}/${assignments.length} complete${isPaused ? " · timer paused" : ""}</div>${editor}<div class="viewer-trick-list">${list}</div>`;
}

function assignmentLinesForEditor(assignments = []) {
  return assignments.map((assignment) => {
    const notes = assignment.notes ? ` - ${assignment.notes}` : "";
    return `${assignment.trick_name}${notes}`;
  }).join("\n");
}

function sessionViewerAssignmentEditor(entry, listId, assignments = []) {
  if (!categoryInfo[listId]) return "";
  const info = categoryInfo[listId];
  const helper = listId === "daily"
    ? `Editing ${venueLabel(entry.venue)} only. One trick per line.`
    : listId === "percentage"
      ? "Maximum 3 percentage tricks. One trick per line."
      : "One trick per line. Add notes after a dash.";
  return `<details class="viewer-edit-panel">
    <summary>Edit ${escapeHtml(listId === "daily" ? `${venueLabel(entry.venue)} Daily` : info.label)}</summary>
    <form class="viewer-assignment-editor" data-viewer-assignment-editor="${escapeHtml(listId)}" data-athlete-id="${escapeHtml(entry.athlete.id)}" data-venue="${escapeHtml(entry.venue || "")}">
      <div class="field">
        <label>${escapeHtml(helper)}</label>
        <textarea name="assignmentLines" rows="${listId === "daily" ? 7 : 5}" placeholder="Add tricks here...">${escapeHtml(assignmentLinesForEditor(assignments))}</textarea>
      </div>
      <button class="primary-btn compact-save-btn" type="submit">Save ${escapeHtml(info.label)}</button>
    </form>
  </details>`;
}

function sessionViewerGoalsList(entry) {
  const goals = Array.isArray(entry.athlete.goals) ? entry.athlete.goals : [];
  const complete = goals.filter((goal) => goal.completed).length;
  const list = goals.length ? goals.map((goal, index) => {
    const done = Boolean(goal.completed);
    return `<button class="viewer-trick-row ${done ? "complete" : ""}" type="button" data-viewer-goal-toggle="${escapeHtml(goal.id || "")}" data-goal-index="${index}" data-athlete-id="${entry.athlete.id}">
      <span class="assignment-check">${done ? "✓" : ""}</span>
      <span><strong>${escapeHtml(goal.title || "Goal")}</strong><small>${done ? "Completed" : "In progress"} · goals do not affect leaderboard points</small></span>
    </button>`;
  }).join("") : `<div class="empty compact-empty">No goals saved for this rider yet.</div>`;
  return `<div class="panel-meta viewer-list-meta">Goals · ${complete}/${goals.length} complete</div><div class="viewer-trick-list">${list}</div>`;
}

function sessionViewerActiveRun(entry) {
  return (entry.runs || []).find((run) => !run.archived_at && Array.isArray(run.points) && run.points.length) || (entry.runs || [])[0] || null;
}

function sessionViewerRunList(entry) {
  const run = sessionViewerActiveRun(entry);
  if (!run) return `<div class="panel-meta viewer-list-meta">Contest Run</div><div class="empty compact-empty">No saved contest run for this rider yet.</div>`;
  const progressRows = entry.runProgressByPlan?.get(run.id) || [];
  const completedIndexes = new Set(progressRows.filter((row) => row.completed).map((row) => Number(row.point_index)));
  const points = Array.isArray(run.points) ? run.points : [];
  const complete = points.filter((_point, index) => completedIndexes.has(index)).length;
  const list = points.length ? points.map((point, index) => {
    const done = completedIndexes.has(index);
    return `<button class="viewer-trick-row ${done ? "complete" : ""}" type="button" data-viewer-run-toggle="${run.id}" data-athlete-id="${entry.athlete.id}" data-run-point-index="${index}" data-run-completed="${done ? "true" : "false"}">
      <span class="assignment-check">${done ? "✓" : index + 1}</span>
      <span><strong>${escapeHtml(point.label || `Point ${index + 1}`)}</strong><small>${escapeHtml(run.title || "Contest run")} · no leaderboard points</small></span>
    </button>`;
  }).join("") : `<div class="empty compact-empty">This run has no tricks saved yet.</div>`;
  return `<div class="panel-meta viewer-list-meta">${escapeHtml(run.title || "Contest Run")} · ${complete}/${points.length} complete</div><div class="viewer-trick-list">${list}</div>`;
}

function bindSessionViewerActions() {
  document.querySelector("#viewer-refresh")?.addEventListener("click", () => renderSessionViewer());
  document.querySelector("#viewer-group")?.addEventListener("change", (event) => {
    state.sessionViewerGroup = event.target.value;
    state.sessionViewerVenue = "";
    state.sessionViewerOpenAthleteId = "";
    state.sessionViewerActiveList = "daily";
    renderSessionViewer();
  });
  document.querySelector("#viewer-venue")?.addEventListener("change", (event) => {
    state.sessionViewerVenue = event.target.value;
    state.sessionViewerOpenAthleteId = "";
    state.sessionViewerActiveList = "daily";
    renderSessionViewer();
  });
  document.querySelector("#viewer-search")?.addEventListener("input", (event) => {
    state.sessionViewerSearch = event.target.value;
    clearTimeout(state.sessionViewerSearchTimer);
    state.sessionViewerSearchTimer = setTimeout(() => renderSessionViewer(), 250);
  });
  document.querySelectorAll("[data-viewer-athlete]").forEach((button) => button.addEventListener("click", () => {
    state.sessionViewerOpenAthleteId = state.sessionViewerOpenAthleteId === button.dataset.viewerAthlete ? "" : button.dataset.viewerAthlete;
    refreshSessionViewerLight();
  }));
  document.querySelector("#start-group-session")?.addEventListener("click", startViewerGroupSession);
  document.querySelector("#pause-group-session")?.addEventListener("click", toggleViewerGroupSessionPause);
  document.querySelector("#end-group-session")?.addEventListener("click", endViewerGroupSession);
  document.querySelector("#add-session-rider-form")?.addEventListener("submit", addExtraRiderToGroupSession);
  document.querySelectorAll("[data-finish-daily-athlete]").forEach((button) => button.addEventListener("click", finishViewerDailyTimer));
  document.querySelectorAll("[data-viewer-assignment-action]").forEach((button) => button.addEventListener("click", recordViewerAssignmentAction));
  document.querySelectorAll("[data-viewer-assignment-attempt]").forEach((button) => button.addEventListener("click", recordViewerAssignmentAttempt));
  document.querySelectorAll("[data-percentage-action], [data-percentage-clear]").forEach((button) => button.addEventListener("click", recordViewerPercentageAttempt));
  document.querySelectorAll("[data-viewer-list-tab]").forEach((button) => button.addEventListener("click", selectViewerListTab));
  document.querySelectorAll("[data-viewer-goal-toggle]").forEach((button) => button.addEventListener("click", toggleViewerGoal));
  document.querySelectorAll("[data-viewer-run-toggle]").forEach((button) => button.addEventListener("click", toggleViewerRunPoint));
  document.querySelectorAll("[data-viewer-assignment-editor]").forEach((form) => form.addEventListener("submit", saveSessionViewerAssignments));
}

async function startViewerGroupSession() {
  const roster = await getCoachRoster();
  const athleteIds = roster.filter((athlete) => (athlete.groupNames || [athlete.groupName]).includes(state.sessionViewerGroup)).map((athlete) => athlete.id);
  if (!athleteIds.length) return notify("No riders in this group yet.", "error");
  const { data, error } = await client.rpc("start_coach_group_session", {
    p_group_name: state.sessionViewerGroup,
    p_venue: state.sessionViewerVenue || "",
    p_athlete_ids: athleteIds,
  });
  if (error) return notify(messageFrom(error), "error");
  const result = Array.isArray(data) ? data[0] : data;
  notify(`Group session started for ${result.participant_count || athleteIds.length} riders.`);
  state.sessionViewerOpenAthleteId = "";
  await renderSessionViewer();
}

async function addExtraRiderToGroupSession(event) {
  event.preventDefault();
  const session = await getActiveCoachGroupSession();
  if (!session) return notify("Start the group session first.", "error");
  const athleteId = new FormData(event.currentTarget).get("athleteId");
  if (!athleteId) return notify("Choose a rider to add.", "error");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Adding...";
  const { error } = await client.rpc("add_coach_group_session_rider", {
    p_group_session_id: session.id,
    p_athlete_id: athleteId,
  });
  if (error) {
    button.disabled = false;
    button.textContent = "Add to this session";
    return notify(messageFrom(error), "error");
  }
  notify("Rider added to this session only.");
  state.sessionViewerOpenAthleteId = athleteId;
  await renderSessionViewer();
}

async function toggleViewerGroupSessionPause() {
  const session = await getActiveCoachGroupSession();
  if (!session) return notify("No live group session to pause.", "error");
  const action = session.status === "paused" ? "resume" : "pause";
  const { error } = await client.rpc("update_coach_group_session", { p_group_session_id: session.id, p_action: action });
  if (error) return notify(messageFrom(error), "error");
  notify(action === "pause" ? "Group session paused." : "Group session resumed.");
  await renderSessionViewer();
}

async function endViewerGroupSession() {
  const session = await getActiveCoachGroupSession();
  if (!session) return notify("No live group session to end.", "error");
  const { error } = await client.rpc("update_coach_group_session", { p_group_session_id: session.id, p_action: "end" });
  if (error) return notify(messageFrom(error), "error");
  notify("Group session ended and saved.");
  state.sessionViewerOpenAthleteId = "";
  await renderSessionViewer();
}

async function finishViewerDailyTimer(event) {
  const button = event.currentTarget;
  const session = state.sessionViewerActiveSessionCache || await getActiveCoachGroupSession();
  if (!session) return notify("Start the group session first.", "error");
  const seconds = groupSessionElapsedSeconds(session);
  button.disabled = true;
  const { data, error } = await client.rpc("finish_group_session_daily", {
    p_group_session_id: session.id,
    p_athlete_id: button.dataset.finishDailyAthlete,
    p_seconds: seconds,
  });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  notify(result?.is_new_pb ? `New Daily PB saved: ${formatPbTime(result.daily_finish_seconds)}` : `Daily finish saved: ${formatPbTime(result?.daily_finish_seconds || seconds)}`);
  await renderSessionViewer();
}

async function recordViewerAssignmentAction(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  const row = button.closest(".viewer-trick-row");
  const wasComplete = row?.classList.contains("complete");
  button.disabled = true;
  row?.classList.toggle("complete", !wasComplete);
  button.textContent = wasComplete ? "" : "✓";
  const { data, error } = await client.rpc("record_assignment_action", {
    p_assignment_id: button.dataset.assignmentId,
    p_action: button.dataset.viewerAssignmentAction,
  });
  if (error) {
    button.disabled = false;
    row?.classList.toggle("complete", Boolean(wasComplete));
    button.textContent = wasComplete ? "✓" : "";
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  notify(result.message || "Trick progress updated.");
  await refreshSessionViewerLight();
}

async function recordViewerAssignmentAttempt(event) {
  const button = event.currentTarget;
  const currentCount = Number(button.querySelector(".attempt-pill")?.textContent || 0);
  button.disabled = true;
  button.classList.add("attempted");
  button.innerHTML = `<span>Attempt</span><span class="attempt-pill">${currentCount + 1}</span>`;
  const session = state.sessionViewerActiveSessionCache || await getActiveCoachGroupSession();
  const { data, error } = await client.rpc("record_assignment_attempt", {
    p_assignment_id: button.dataset.viewerAssignmentAttempt,
    p_group_session_id: session?.id || null,
  });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  notify(`${result?.trick_name || "Trick"} attempt saved · ${result?.attempt_count || 1} total.`);
  await refreshSessionViewerLight();
}

async function recordViewerPercentageAttempt(event) {
  const button = event.currentTarget;
  button.disabled = true;
  const clearAttempt = button.dataset.percentageClear === "true";
  const { data, error } = await client.rpc("set_percentage_attempt", {
    p_assignment_id: button.dataset.assignmentId,
    p_attempt_number: Number(button.dataset.percentageAttemptNumber || 1),
    p_landed: clearAttempt ? null : button.dataset.percentageAction === "true",
  });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  notify(clearAttempt ? `Attempt cleared. New result: ${result.percentage}%.` : (result.complete ? `Percentage complete: ${result.percentage}% · +${result.points_awarded || 0} points.` : `Attempt ${result.attempts}/10 saved. No points yet.`));
  await refreshSessionViewerLight();
}

function selectViewerListTab(event) {
  state.sessionViewerActiveList = event.currentTarget.dataset.viewerListTab || "daily";
  refreshSessionViewerLight();
}

async function saveSessionViewerAssignments(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const athleteId = formElement.dataset.athleteId;
  const listId = formElement.dataset.viewerAssignmentEditor;
  const venue = formElement.dataset.venue || "";
  if (!athleteId || !categoryInfo[listId]) return notify("Could not save that list.", "error");
  const button = formElement.querySelector("button");
  button.disabled = true;
  button.textContent = "Saving...";

  const editedLines = String(new FormData(formElement).get("assignmentLines") || "").split("\n")
    .map((line, index) => parseAssignmentLine(line.trim(), index, listId, listId === "daily" ? venue : ""))
    .filter(Boolean)
    .slice(0, listId === "percentage" ? 3 : undefined);

  const { error } = await client.rpc("save_weekly_assignment_list", {
    p_athlete_id: athleteId,
    p_week_start: weekStartDate(),
    p_category: listId,
    p_venue: listId === "daily" ? venue : "",
    p_assignments: editedLines,
  });
  if (error) {
    button.disabled = false;
    button.textContent = `Save ${categoryInfo[listId].label}`;
    return notify(messageFrom(error), "error");
  }
  notify(`${categoryInfo[listId].label} saved for this rider.`);
  await refreshSessionViewerLight();
}

async function toggleViewerGoal(event) {
  const button = event.currentTarget;
  const athleteId = button.dataset.athleteId;
  const goalIndex = Number(button.dataset.goalIndex);
  const roster = state.sessionViewerRosterCache.length ? state.sessionViewerRosterCache : await getCoachRoster();
  const athlete = roster.find((entry) => entry.id === athleteId);
  if (!athlete || !Array.isArray(athlete.goals) || !athlete.goals[goalIndex]) return notify("Could not find that goal.", "error");
  button.disabled = true;
  const goals = athlete.goals.map((goal, index) => index === goalIndex ? { ...goal, completed: !goal.completed, completedAt: !goal.completed ? new Date().toISOString() : null } : goal);
  const { data, error } = await client.from("profiles").update({ goals, updated_at: new Date().toISOString() }).eq("id", athleteId).select().single();
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  state.sessionViewerRosterCache = roster.map((entry) => entry.id === athleteId ? { ...entry, goals: data.goals || goals } : entry);
  notify("Goal progress updated.");
  await refreshSessionViewerLight();
}

async function toggleViewerRunPoint(event) {
  const button = event.currentTarget;
  const completed = button.dataset.runCompleted === "true";
  const payload = {
    athlete_id: button.dataset.athleteId,
    run_plan_id: button.dataset.viewerRunToggle,
    point_index: Number(button.dataset.runPointIndex),
    completed: !completed,
    updated_at: new Date().toISOString(),
  };
  button.disabled = true;
  const { error } = await client.from("run_checklist_progress").upsert(payload, { onConflict: "athlete_id,run_plan_id,point_index" });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  notify("Contest run progress updated.");
  await refreshSessionViewerLight();
}

async function refreshSessionViewerLight() {
  if (state.view !== "sessionViewer") return;
  const rosterGrid = document.querySelector(".viewer-rider-grid");
  if (!rosterGrid) return renderSessionViewer();
  const roster = state.sessionViewerRosterCache.length ? state.sessionViewerRosterCache : await getCoachRoster();
  const activeGroupSession = state.sessionViewerActiveSessionCache || await getActiveCoachGroupSession();
  const search = state.sessionViewerSearch.toLowerCase().trim();
  const activeParticipantIds = new Set((activeGroupSession?.coach_group_session_participants || []).map((row) => row.athlete_id));
  const filteredRoster = roster
    .filter((athlete) => (athlete.groupNames || [athlete.groupName]).includes(state.sessionViewerGroup) || activeParticipantIds.has(athlete.id))
    .filter((athlete) => !search || athlete.display_name.toLowerCase().includes(search));
  const { assignmentsByAthlete, runsByAthlete, runProgressByPlan } = await getSessionViewerPlanData(filteredRoster.map((athlete) => athlete.id));
  const schedules = filteredRoster.map((athlete) => {
    const allAssignments = assignmentsByAthlete.get(athlete.id) || [];
    const allDaily = allAssignments.filter((assignment) => assignment.category === "daily");
    const daily = assignmentsForVenue(allDaily, state.sessionViewerVenue);
    const participant = activeGroupSession?.coach_group_session_participants?.find((row) => row.athlete_id === athlete.id);
    return { athlete, assignments: allAssignments, allDaily, daily, venue: state.sessionViewerVenue, participant, runs: runsByAthlete.get(athlete.id) || [], runProgressByPlan };
  });
  rosterGrid.innerHTML = schedules.length ? schedules.map((entry) => {
    const { athlete, daily, venue, participant } = entry;
    const complete = daily.filter(isAssignmentComplete).length;
    const percent = daily.length ? Math.round((complete / daily.length) * 100) : 0;
    const isOpen = athlete.id === state.sessionViewerOpenAthleteId;
    const finish = participant?.daily_finish_seconds ? ` · Finished ${formatPbTime(participant.daily_finish_seconds)}` : "";
    const finishButton = activeGroupSession && !participant?.daily_finish_seconds ? `<button class="secondary-btn compact-btn finish-daily-btn" type="button" data-finish-daily-athlete="${athlete.id}">Finish Daily Tricks</button>` : "";
    return `<article class="viewer-rider-accordion ${isOpen ? "open" : ""}">
      <button class="viewer-rider-card ${isOpen ? "active" : ""}" type="button" data-viewer-athlete="${athlete.id}" aria-expanded="${isOpen}">
        <div class="viewer-card-head">${avatarHtml(athlete, "student-chip-avatar")}<div><strong>${escapeHtml(athlete.display_name)}</strong><small>${escapeHtml(venueLabel(venue))} · ${complete}/${daily.length} complete${finish}</small></div></div>
        <span class="accordion-caret">${isOpen ? "Close" : "Open"}</span>
        <div class="viewer-progress"><span style="width:${percent}%"></span></div>
      </button>
      ${finishButton}
      ${isOpen ? sessionViewerPlanList(entry, activeGroupSession) : ""}
    </article>`;
  }).join("") : `<div class="empty compact-empty">No riders match this group/search.</div>`;
  bindSessionViewerFastActions();
}

function bindSessionViewerFastActions() {
  document.querySelectorAll("[data-viewer-athlete]").forEach((button) => button.addEventListener("click", () => {
    state.sessionViewerOpenAthleteId = state.sessionViewerOpenAthleteId === button.dataset.viewerAthlete ? "" : button.dataset.viewerAthlete;
    refreshSessionViewerLight();
  }));
  document.querySelectorAll("[data-finish-daily-athlete]").forEach((button) => button.addEventListener("click", finishViewerDailyTimer));
  document.querySelectorAll("[data-viewer-assignment-action]").forEach((button) => button.addEventListener("click", recordViewerAssignmentAction));
  document.querySelectorAll("[data-viewer-assignment-attempt]").forEach((button) => button.addEventListener("click", recordViewerAssignmentAttempt));
  document.querySelectorAll("[data-percentage-action], [data-percentage-clear]").forEach((button) => button.addEventListener("click", recordViewerPercentageAttempt));
  document.querySelectorAll("[data-viewer-list-tab]").forEach((button) => button.addEventListener("click", selectViewerListTab));
  document.querySelectorAll("[data-viewer-goal-toggle]").forEach((button) => button.addEventListener("click", toggleViewerGoal));
  document.querySelectorAll("[data-viewer-run-toggle]").forEach((button) => button.addEventListener("click", toggleViewerRunPoint));
  document.querySelectorAll("[data-viewer-assignment-editor]").forEach((form) => form.addEventListener("submit", saveSessionViewerAssignments));
}

async function saveCoachCalendarEvent(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const startsAt = form.get("startsAt");
  const endsAt = form.get("endsAt");
  if (endsAt && new Date(endsAt) < new Date(startsAt)) return notify("Finish date must be after start date.", "error");
  const button = formElement.querySelector("button");
  button.disabled = true;
  button.textContent = "Adding...";
  const { error } = await client.from("coach_calendar_events").insert({
    coach_id: state.user.id,
    athlete_id: form.get("athleteId") || null,
    group_name: form.get("groupName") || "",
    title: String(form.get("title") || "").trim(),
    starts_at: new Date(startsAt).toISOString(),
    ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    venue: String(form.get("venue") || "").trim(),
    notes: String(form.get("notes") || "").trim(),
    attendance_status: String(form.get("attendanceStatus") || "").trim(),
    payment_status: String(form.get("paymentStatus") || "").trim(),
    event_type: "coach",
  });
  if (error) {
    button.disabled = false;
    button.textContent = "Add event";
    return notify(messageFrom(error), "error");
  }
  notify("Coach calendar event added.");
  await renderCoachCommand();
}

async function saveHeatStatus(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const athleteId = event.currentTarget.dataset.heatAthlete;
  const { error } = await client.from("athlete_coach_status").upsert({
    coach_id: state.user.id,
    athlete_id: athleteId,
    heat_status: form.get("heatStatus"),
    training_focus: String(form.get("trainingFocus") || "").trim(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "coach_id,athlete_id" });
  if (error) return notify(messageFrom(error), "error");
  notify("Rider heat status saved.");
  await renderCoachCommand();
}

async function dismissCoachTask(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!isCoachRole(state.profile?.role)) return notify("Only coaches can remove coach tasks.", "error");
  const taskKey = event.currentTarget.dataset.dismissTask;
  if (!taskKey) return;
  event.currentTarget.disabled = true;
  const { error } = await client.from("dismissed_coach_tasks").upsert({
    coach_id: state.user.id,
    task_key: taskKey,
    week_start: weekStartDate(),
    dismissed_at: new Date().toISOString(),
  }, { onConflict: "coach_id,task_key,week_start" });
  if (error) {
    event.currentTarget.disabled = false;
    return notify(messageFrom(error), "error");
  }
  notify("Removed from this week's to do list.");
  await renderCoachCommand();
}

async function saveWeeklyNotificationSettings(event) {
  event.preventDefault();
  if (!isCoachRole(state.profile?.role)) return notify("Only coaches can manage weekly notifications.", "error");
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Saving...";
  const { error } = await client.from("weekly_progress_notification_settings").upsert({
    coach_id: state.user.id,
    enabled: form.get("enabled") === "on",
    parent_summaries_enabled: form.get("parentSummaries") === "on",
    online_rider_summaries_enabled: form.get("onlineSummaries") === "on",
    inactive_rider_summaries_enabled: form.get("inactiveSummaries") === "on",
    send_day: 0,
    send_time: "19:30",
    timezone: "Australia/Brisbane",
    updated_at: new Date().toISOString(),
  }, { onConflict: "coach_id" });
  if (error) {
    button.disabled = false;
    button.textContent = "Save notification settings";
    return notify(messageFrom(error), "error");
  }
  notify("Weekly notification settings saved.");
  await renderCoachCommand();
}

async function generateWeeklyNotificationPreviews(roster = [], commandData = {}) {
  if (!isCoachRole(state.profile?.role)) return notify("Only coaches can preview weekly summaries.", "error");
  const settings = commandData.weeklySettings || {};
  if (settings.enabled === false) return notify("Weekly summaries are turned off. Turn them on first.", "error");
  const button = document.querySelector("#generate-weekly-previews");
  if (button) {
    button.disabled = true;
    button.textContent = "Creating previews...";
  }
  const weekStart = weekStartDate();
  const weekEnd = new Date(new Date(weekStartIso()).getTime() + (6 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  const parentLinksByAthlete = (commandData.parentLinks || []).reduce((map, link) => {
    const rows = map.get(link.athlete_id) || [];
    rows.push(link);
    map.set(link.athlete_id, rows);
    return map;
  }, new Map());
  const statuses = statusByAthlete(commandData.statuses || []);
  const rows = [];
  roster.forEach((athlete) => {
    const sessions = (commandData.sessions || []).filter((session) => session.athlete_id === athlete.id);
    const awards = (commandData.awards || []).filter((award) => award.athlete_id === athlete.id);
    const assignments = (commandData.scheduleRows || []).filter((assignment) => assignment.athlete_id === athlete.id);
    const attempts = (commandData.assignmentAttempts || []).filter((attempt) => attempt.athlete_id === athlete.id);
    const attemptRows = [...attemptsByTrick(attempts).values()].sort((a, b) => b.count - a.count).slice(0, 5);
    const attemptSummary = attemptRows.length ? ` Attempted this week: ${attemptRows.map((row) => `${row.title} (${row.count})`).join(", ")}.` : "";
    const venues = [...new Set(sessions.map((session) => session.venue).filter(Boolean))];
    const status = statuses.get(athlete.id)?.heat_status || "on_track";
    const statusLabel = heatStatuses[status]?.label || "On track";
    const dailyAwards = awards.filter((award) => award.award_key?.startsWith("daily:")).length;
    const oneBangAwards = awards.filter((award) => award.award_key?.includes("one")).length;
    const dialledAwards = awards.filter((award) => award.award_key?.includes("dial")).length;
    const goalsCompleted = Array.isArray(athlete.goals) ? athlete.goals.filter((goal) => goal.completed).length : 0;
    const badgesEarned = Array.isArray(athlete.badges) ? athlete.badges.length : 0;
    const pointsEarned = awards.reduce((sum, award) => sum + Number(award.points || 0), 0);
    const weeklyTasks = assignments.filter((assignment) => assignment.category !== "daily").length;
    const dailyTimes = sessions.map((session) => Number(session.daily_completed_seconds || 0)).filter(Boolean);
    const latestDailyTime = dailyTimes[0] || null;
    const summary = sessions.length
      ? `${firstName(athlete)} logged ${sessions.length} session${sessions.length === 1 ? "" : "s"}${venues.length ? ` at ${venues.join(", ")}` : ""}, completed ${dailyAwards} Daily Trick list${dailyAwards === 1 ? "" : "s"}, ${oneBangAwards} One Bangs, ${dialledAwards} Dialled tricks, ${goalsCompleted} goal${goalsCompleted === 1 ? "" : "s"}, and earned ${pointsEarned} points.${attemptSummary} Daily PB: ${formatPbTime(athlete.daily_pb_seconds)}${latestDailyTime ? `, latest Daily time: ${formatPbTime(latestDailyTime)}` : ""}. Status: ${statusLabel}. Next focus: ${statuses.get(athlete.id)?.training_focus || "keep building consistency and flow."}`
      : `${firstName(athlete)} has no training data recorded this week.${attemptSummary} Daily PB: ${formatPbTime(athlete.daily_pb_seconds)}. Status: ${statusLabel}. Suggested next focus: get one clean session logged and complete the Daily Tricks list.`;
    const base = {
      coach_id: state.user.id,
      athlete_id: athlete.id,
      week_start: weekStart,
      week_end: weekEnd,
      title: `${firstName(athlete)}'s Weekly BMX Training Update`,
      summary,
      status: "preview",
      stats: {
        sessions: sessions.length,
        venues,
        daily_lists_completed: dailyAwards,
        attempted_tricks: attemptRows,
        attempt_count: attempts.length,
        daily_pb_seconds: athlete.daily_pb_seconds || null,
        latest_daily_completed_seconds: latestDailyTime,
        daily_tricks_completed: awards.filter((award) => award.award_key?.startsWith("daily-trick:")).length,
        one_bangs_completed: oneBangAwards,
        dialled_completed: dialledAwards,
        goals_completed: goalsCompleted,
        badges_earned: badgesEarned,
        weekly_tasks_assigned: weeklyTasks,
        points_earned: pointsEarned,
        heat_status: status,
      },
      coach_notes: statuses.get(athlete.id)?.coach_alert || "",
    };
    if (settings.parent_summaries_enabled !== false) {
      (parentLinksByAthlete.get(athlete.id) || []).forEach((link) => rows.push({ ...base, recipient_type: "parent", recipient_id: link.parent_id }));
    }
    if (settings.online_rider_summaries_enabled !== false && (athlete.groupNames || [athlete.groupName]).includes("online")) {
      rows.push({ ...base, recipient_type: "rider", recipient_id: athlete.id });
    }
    if (settings.inactive_rider_summaries_enabled && !parentLinksByAthlete.get(athlete.id)?.length && !(athlete.groupNames || [athlete.groupName]).includes("online")) {
      rows.push({ ...base, recipient_type: "coach_preview", recipient_id: state.user.id });
    }
  });
  if (!rows.length) {
    if (button) {
      button.disabled = false;
      button.textContent = "Preview this week's summaries";
    }
    return notify("No linked parents or online riders need weekly summaries yet.", "error");
  }
  const { error } = await client.from("weekly_progress_notifications").upsert(rows, {
    onConflict: "athlete_id,recipient_type,recipient_id,week_start",
  });
  if (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "Preview this week's summaries";
    }
    return notify(messageFrom(error), "error");
  }
  notify(`Created ${rows.length} weekly summary preview${rows.length === 1 ? "" : "s"}.`);
  await renderCoachCommand();
}

async function saveAttendanceSession(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const rows = [];
  [...form.entries()].forEach(([key, value]) => {
    if (!key.startsWith("status:") || !value) return;
    const athleteId = key.slice("status:".length);
    rows.push({
      coach_id: state.user.id,
      athlete_id: athleteId,
      status: value,
      reimbursement_owed: form.get(`owed:${athleteId}`) === "on",
      reimbursement_paid: form.get(`paid:${athleteId}`) === "on",
    });
  });
  if (!rows.length) return notify("Choose at least one rider attendance status.", "error");
  const button = formElement.querySelector("button");
  button.disabled = true;
  button.textContent = "Saving...";
  const { data: session, error } = await client.from("attendance_sessions").insert({
    coach_id: state.user.id,
    session_date: form.get("sessionDate"),
    venue: String(form.get("venue") || "").trim(),
    group_name: form.get("groupName"),
    notes: String(form.get("notes") || "").trim(),
    total_entry_cost: Number(form.get("totalEntryCost") || 0),
    cost_per_rider: Number(form.get("costPerRider") || 0),
  }).select().single();
  if (error) {
    button.disabled = false;
    button.textContent = "Save attendance & reimbursements";
    return notify(messageFrom(error), "error");
  }
  const { error: recordError } = await client.from("attendance_records").insert(rows.map((row) => ({ ...row, attendance_session_id: session.id })));
  if (recordError) return notify(messageFrom(recordError), "error");
  notify("Attendance and reimbursement tracker saved.");
  await renderCoachCommand();
}

function privateRecordForm(record = {}) {
  return `<form id="private-record-form" class="private-record-form">
    <div class="two-col-form">
      <div class="field"><label for="emergency-name">Emergency contact name</label><input id="emergency-name" name="emergencyContactName" value="${escapeHtml(record.emergency_contact_name || "")}" placeholder="Parent / guardian"></div>
      <div class="field"><label for="emergency-phone">Emergency contact phone</label><input id="emergency-phone" name="emergencyContactPhone" value="${escapeHtml(record.emergency_contact_phone || "")}" placeholder="Phone number"></div>
      <div class="field"><label for="guardian-details">Parent / guardian details</label><textarea id="guardian-details" name="guardianDetails" placeholder="Names, emails, extra contacts...">${escapeHtml(record.guardian_details || "")}</textarea></div>
      <div class="field"><label for="medical-notes">Medical notes</label><textarea id="medical-notes" name="medicalNotes" placeholder="Allergies, conditions, medication...">${escapeHtml(record.medical_notes || "")}</textarea></div>
      <div class="field"><label for="injury-notes">Injury / modified training notes</label><textarea id="injury-notes" name="injuryNotes" placeholder="Current injuries or modified training...">${escapeHtml(record.injury_notes || "")}</textarea></div>
      <div class="field"><label for="waiver-notes">Waivers / permission notes</label><textarea id="waiver-notes" name="waiverNotes" placeholder="Waiver status, permission forms, reminders...">${escapeHtml(record.waiver_notes || "")}</textarea></div>
    </div>
    <button class="primary-btn wide" type="submit">Save private rider record</button>
  </form>`;
}

function documentsHtml(documents = []) {
  if (!documents.length) return `<div class="empty compact-empty">No waivers, forms or documents uploaded yet.</div>`;
  return documents.map((doc) => `<div class="list-row"><div><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.document_type)} · ${escapeHtml(doc.file_name || "Saved file")} · ${dateLabel(doc.created_at)}${doc.notes ? ` · ${escapeHtml(doc.notes)}` : ""}</small></div><a class="secondary-btn compact-btn" href="${escapeHtml(doc.file_data_url)}" target="_blank" rel="noopener">Open</a></div>`).join("");
}

function documentUploadForm() {
  return `<form id="document-form" class="coach-document-form">
    <div class="field"><label for="document-title">Document title</label><input id="document-title" name="title" required placeholder="Signed waiver, permission form..."></div>
    <div class="field"><label for="document-type">Type</label><select id="document-type" name="documentType"><option value="waiver">Waiver</option><option value="permission">Permission form</option><option value="medical">Medical form</option><option value="other">Other</option></select></div>
    <div class="field"><label for="document-file">Upload PDF / image</label><input id="document-file" name="file" type="file" accept="application/pdf,image/*" required></div>
    <div class="field"><label for="document-notes">Notes</label><input id="document-notes" name="notes" placeholder="Optional"></div>
    <button class="primary-btn" type="submit">Save file</button>
  </form>`;
}

function injuryReportsHtml(injuries = []) {
  if (!injuries.length) return `<div class="empty compact-empty">No injury reports saved.</div>`;
  return injuries.map((report) => `<article class="help-card"><div class="help-card-head"><div><strong>${escapeHtml(report.body_area || "Injury report")}</strong><small>${dateLabel(report.injured_at)} · ${escapeHtml(report.venue || "Venue not set")} · ${escapeHtml(report.severity || "Severity not set")}</small></div></div><p>${escapeHtml(report.what_happened || "No details added.")}</p><small>${report.guardian_contacted ? "Parent/guardian contacted" : "Parent/guardian not marked as contacted"} · Follow-up: ${escapeHtml(report.follow_up || "None added")}</small>${report.photo_data_url ? `<div class="video-actions"><a class="secondary-btn compact-btn" href="${escapeHtml(report.photo_data_url)}" target="_blank" rel="noopener">Open photo</a></div>` : ""}</article>`).join("");
}

function injuryReportForm(athlete = {}) {
  return `<form id="injury-form" class="injury-form">
    <div class="two-col-form">
      <div class="field"><label for="injury-time">Date / time</label><input id="injury-time" name="injuredAt" type="datetime-local" required></div>
      <div class="field"><label for="injury-venue">Venue</label><input id="injury-venue" name="venue" placeholder="Skate park"></div>
      <div class="field"><label for="body-area">Body area</label><input id="body-area" name="bodyArea" placeholder="Wrist, ankle, shoulder..."></div>
      <div class="field"><label for="severity">Severity</label><select id="severity" name="severity"><option value="minor">Minor</option><option value="moderate">Moderate</option><option value="serious">Serious</option></select></div>
      <div class="field"><label for="what-happened">What happened</label><textarea id="what-happened" name="whatHappened" placeholder="${escapeHtml(firstName(athlete))} fell attempting..."></textarea></div>
      <div class="field"><label for="first-aid">First aid given</label><textarea id="first-aid" name="firstAid" placeholder="Ice, rest, parent called..."></textarea></div>
      <div class="field"><label for="witnesses">Who was present</label><input id="witnesses" name="witnesses" placeholder="Coach, riders, parent..."></div>
      <div class="field"><label for="follow-up">Follow-up action</label><input id="follow-up" name="followUp" placeholder="Monitor, doctor, modified training..."></div>
      <div class="field"><label for="injury-photo">Optional photo</label><input id="injury-photo" name="photo" type="file" accept="image/*"></div>
      <label class="checkline"><input name="guardianContacted" type="checkbox"> Parent / guardian contacted</label>
    </div>
    <div class="field"><label for="injury-coach-notes">Coach notes</label><textarea id="injury-coach-notes" name="coachNotes" placeholder="Private coach notes..."></textarea></div>
    <button class="danger-btn wide" type="submit">Save injury report</button>
  </form>`;
}

function parentUpdatePanel(athlete, schedule, _dashboardItems = [], attendance = []) {
  return `<section class="panel parent-update-panel"><div class="panel-head"><div><div class="panel-title">Parent update button</div><div class="panel-meta">Generate, edit, then copy a parent message</div></div></div>
    <div class="two-col-form">
      <div class="field"><label for="parent-update-type">Message type</label><select id="parent-update-type"><option value="positive">Positive update</option><option value="progress">Progress update</option><option value="injury">Injury update</option><option value="behaviour">Behaviour update</option><option value="reminder">Reminder message</option><option value="term">Term report message</option></select></div>
      <div class="field"><label for="parent-next-focus">Next focus</label><input id="parent-next-focus" placeholder="Keeping speed through the park"></div>
    </div>
    <textarea id="parent-update-draft" class="parent-update-draft" placeholder="Generate a message, then edit it here..."></textarea>
    <div class="actions"><button class="primary-btn" id="generate-parent-update" type="button" data-athlete-name="${escapeHtml(athlete.display_name)}" data-completed="${schedule.assignments.filter(isAssignmentComplete).length}" data-total="${schedule.assignments.length}" data-attendance="${attendance[0]?.status || ""}">Generate update</button><button class="secondary-btn" id="copy-parent-update" type="button">Copy message</button></div>
  </section>`;
}

function runPointColor(pointNumber) {
  if (pointNumber >= 15) return "#ff4567";
  if (pointNumber >= 10) return "#25f68c";
  if (pointNumber >= 5) return "#f7d154";
  return "#39a7ff";
}

function runPathBetween(previous, point) {
  const dx = point.x - previous.x;
  const dy = point.y - previous.y;
  const bend = Math.max(4, Math.min(12, Math.hypot(dx, dy) * 0.18));
  const normalX = dy === 0 ? 0 : -dy / Math.hypot(dx, dy);
  const normalY = dx === 0 ? 0 : dx / Math.hypot(dx, dy);
  const c1x = previous.x + dx * 0.35 + normalX * bend;
  const c1y = previous.y + dy * 0.35 + normalY * bend;
  const c2x = previous.x + dx * 0.7 + normalX * bend;
  const c2y = previous.y + dy * 0.7 + normalY * bend;
  return `M ${previous.x} ${previous.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${point.x} ${point.y}`;
}

function runRouteSvg(points = []) {
  const safePoints = Array.isArray(points) ? points : [];
  if (safePoints.length < 2) return "";
  const lines = safePoints.slice(1).map((point, index) => {
    const previous = safePoints[index];
    const pointNumber = index + 2;
    return `<path data-run-segment="${pointNumber}" d="${runPathBetween(previous, point)}" stroke="${runPointColor(pointNumber)}" />`;
  }).join("");
  return `<svg class="run-line-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`;
}

function runMapHtml(imageDataUrl = "", points = [], title = "Run map", editable = false) {
  if (!imageDataUrl) return "";
  const safePoints = Array.isArray(points) ? points : [];
  const markers = safePoints.map((point, index) => {
    const pointNumber = index + 1;
    return `<button type="button" class="run-marker" ${editable ? `data-run-point-index="${index}"` : ""} style="left:${point.x}%;top:${point.y}%;--run-color:${runPointColor(pointNumber)}">${pointNumber}</button>`;
  }).join("");
  return `<div class="run-map-preview"><img src="${escapeHtml(imageDataUrl)}" alt="${escapeHtml(title)}">${runRouteSvg(safePoints)}${markers}</div>`;
}

function canEditRun(run = {}) {
  if (isCoachRole(state.profile?.role)) return run.coach_id === state.user.id;
  return run.created_by === state.user?.id;
}

function runBuilderRefreshView() {
  if (isCoachRole(state.profile?.role) && state.view === "student") return renderStudentProfile();
  if (state.view === "contests") return renderContests();
  return renderProfile();
}

function runPlansHtml(runs = []) {
  if (!runs.length) return `<div class="empty compact-empty">No saved run plans yet.</div>`;
  const activeRuns = runs.filter((run) => !run.archived_at);
  const archivedRuns = runs.filter((run) => run.archived_at);
  const card = (run) => `<article class="run-card ${run.archived_at ? "archived" : ""}"><div><strong>${escapeHtml(run.title)}</strong><small>${escapeHtml(run.venue || "Venue not set")} · ${escapeHtml(run.plan_type)} · ${dateLabel(run.updated_at || run.created_at)} · ${run.created_by === run.athlete_id ? "Rider-made" : "Coach-made"}${run.archived_at ? ` · Archived ${dateLabel(run.archived_at)}` : ""}</small></div>${runMapHtml(run.image_data_url, run.points, run.title)}<ol>${(Array.isArray(run.points) ? run.points : []).map((point) => `<li>${escapeHtml(point.label || "Point")}</li>`).join("")}</ol><div class="actions">${canEditRun(run) ? `<button class="secondary-btn compact-btn" type="button" data-edit-run="${run.id}">Edit this run</button>` : ""}${isCoachRole(state.profile?.role) && !run.archived_at ? `<button class="danger-btn compact-btn" type="button" data-archive-run="${run.id}">Archive</button>` : ""}<button class="secondary-btn compact-btn" type="button" data-play-run="${run.id}">Slow playback</button></div></article>`;
  return `${activeRuns.length ? activeRuns.map(card).join("") : `<div class="empty compact-empty">No active run plans yet.</div>`}${archivedRuns.length ? `<div class="settings-divider"></div><div class="panel-title">Archived runs</div>${archivedRuns.map(card).join("")}` : ""}`;
}

function runBuilderPanel(runs = []) {
  const builder = state.runBuilder || { points: [] };
  const points = builder.points || [];
  const submitLabel = builder.id ? "Save run changes" : "Save run plan";
  return `<section class="panel"><div class="panel-head"><div><div class="panel-title">Visual run builder</div><div class="panel-meta">Upload a park photo, tap points, name each trick, then save</div></div></div>
    <form id="run-builder-form" class="run-builder-form">
      <div class="two-col-form">
        <div class="field"><label for="run-title">Run title</label><input id="run-title" name="title" required value="${escapeHtml(builder.title || "")}" placeholder="Competition run, safe line..."></div>
        <div class="field"><label for="run-venue">Venue</label><input id="run-venue" name="venue" value="${escapeHtml(builder.venue || "")}" placeholder="Pizzey, Beenleigh..."></div>
        <div class="field"><label for="run-type">Run type</label><select id="run-type" name="planType"><option value="training" ${builder.planType === "training" ? "selected" : ""}>Training line</option><option value="competition" ${builder.planType === "competition" ? "selected" : ""}>Competition run</option><option value="safe" ${builder.planType === "safe" ? "selected" : ""}>Safe run</option><option value="high-risk" ${builder.planType === "high-risk" ? "selected" : ""}>High-risk run</option><option value="best-trick" ${builder.planType === "best-trick" ? "selected" : ""}>Best trick plan</option></select></div>
        <div class="field"><label for="run-photo">Park/course photo</label><input id="run-photo" name="photo" type="file" accept="image/*"></div>
      </div>
      <div id="run-map" class="run-map ${builder.imageDataUrl ? "" : "empty-map"}">${builder.imageDataUrl ? runMapHtml(builder.imageDataUrl, points, "Run builder map", true) : "Upload a photo, then tap the image to add start/trick points."}</div>
      <div class="run-builder-actions">${points.length ? `<button class="secondary-btn compact-btn" type="button" id="play-run-builder">Watch slow playback</button>` : ""}<span class="panel-meta">Drag numbers to move them. Edit labels below.</span></div>
      <div class="run-point-list editable-run-points">${points.length ? points.map((point, index) => `<div class="run-point-editor"><span class="public-badge" style="--run-color:${runPointColor(index + 1)}">${index + 1}</span><input value="${escapeHtml(point.label || "")}" data-run-label="${index}" aria-label="Point ${index + 1} label"><button class="secondary-btn compact-btn" type="button" data-run-up="${index}">↑</button><button class="secondary-btn compact-btn" type="button" data-run-down="${index}">↓</button><button class="danger-btn compact-btn" type="button" data-run-delete="${index}">Delete</button></div>`).join("") : `<span class="public-badge muted-badge">No points added yet</span>`}</div>
      <div class="field"><label for="run-notes">Notes</label><textarea id="run-notes" name="notes" placeholder="Run notes, risks, timing...">${escapeHtml(builder.notes || "")}</textarea></div>
      <div class="actions"><button class="secondary-btn" id="clear-run-builder" type="button">Clear points</button><button class="primary-btn" type="submit">${submitLabel}</button></div>
    </form>
    <div class="settings-divider"></div><div class="run-list">${runPlansHtml(runs)}</div>
  </section>`;
}

async function getCoachRoster() {
  const { data: links, error } = await client.from("coach_athletes").select("athlete_id, group_name").eq("coach_id", state.user.id);
  if (error) throw error;
  const ids = links.map((link) => link.athlete_id);
  if (!ids.length) return [];
  const [{ data: athletes, error: athleteError }, { data: sessions, error: sessionError }, { data: groupLinks, error: groupError }] = await Promise.all([
    client.from("profiles").select("*").in("id", ids).order("display_name"),
    client.from("training_sessions").select("*").in("athlete_id", ids).gte("started_at", weekStartIso()),
    client.from("coach_athlete_groups").select("athlete_id, group_name, membership_type").eq("coach_id", state.user.id).in("athlete_id", ids),
  ]);
  if (athleteError) throw athleteError;
  if (sessionError) throw sessionError;
  if (groupError) throw groupError;
  const groupByAthlete = new Map(links.map((link) => [link.athlete_id, link.group_name || "monday"]));
  const groupsByAthlete = (groupLinks || []).reduce((map, link) => {
    const groups = map.get(link.athlete_id) || [];
    if (!groups.includes(link.group_name)) groups.push(link.group_name);
    map.set(link.athlete_id, groups);
    return map;
  }, new Map());
  return athletes.map((athlete) => {
    const athleteSessions = sessions.filter((session) => session.athlete_id === athlete.id);
    const groupNames = groupsByAthlete.get(athlete.id) || [groupByAthlete.get(athlete.id) || "monday"];
    return { ...athlete, groupName: groupNames[0] || "monday", groupNames, weeklyPoints: athleteSessions.reduce((sum, session) => sum + session.total_points, 0), sessionCount: athleteSessions.length };
  });
}

async function getCoachLiveActivity(roster = []) {
  if (!isCoachRole(state.profile?.role) || !roster.length) return [];
  const athleteIds = roster.map((athlete) => athlete.id).filter(Boolean);
  const athleteById = new Map(roster.map((athlete) => [athlete.id, athlete]));
  const [{ data: awards, error: awardsError }, { data: sessions, error: sessionsError }] = await Promise.all([
    client.from("assignment_point_awards")
      .select("id, athlete_id, assignment_id, award_key, points, created_at")
      .in("athlete_id", athleteIds)
      .order("created_at", { ascending: false })
      .limit(18),
    client.from("training_sessions")
      .select("id, athlete_id, daily_completed_seconds, daily_completed_at")
      .in("athlete_id", athleteIds)
      .not("daily_completed_at", "is", null)
      .order("daily_completed_at", { ascending: false })
      .limit(10),
  ]);
  if (awardsError) console.warn("Coach live awards failed", awardsError);
  if (sessionsError) console.warn("Coach live sessions failed", sessionsError);

  const assignmentIds = [...new Set((awards || []).map((award) => award.assignment_id).filter(Boolean))];
  let assignmentById = new Map();
  if (assignmentIds.length) {
    const { data: assignments, error: assignmentsError } = await client.from("weekly_trick_assignments").select("id, category, trick_name, venue").in("id", assignmentIds);
    if (assignmentsError) console.warn("Coach live assignment labels failed", assignmentsError);
    assignmentById = new Map((assignments || []).map((assignment) => [assignment.id, assignment]));
  }

  const pointItems = (awards || []).map((award) => {
    const athlete = athleteById.get(award.athlete_id);
    const assignment = assignmentById.get(award.assignment_id) || {};
    const name = firstName(athlete || {});
    const category = assignment.category || "";
    const points = Number(award.points || 0);
    let text = points > 0 ? `${name} earned +${points} points` : `${name} had ${points} points adjusted`;
    if (award.award_key?.startsWith("daily:")) text = `${name} completed Daily Tricks${points ? ` · +${points}` : ""}`;
    else if (award.award_key?.startsWith("group-first-finish:")) text = `${name} finished Daily Tricks first in group · +${points}`;
    else if (category === "one_bang") text = `${name} earned +${points} from One Bangs${assignment.trick_name ? ` · ${assignment.trick_name}` : ""}`;
    else if (category === "dialled") text = `${name} completed Dialled${assignment.trick_name ? ` · ${assignment.trick_name}` : ""}`;
    else if (category === "percentage") text = `${name} earned +${points} from Percentage Tricks${assignment.trick_name ? ` · ${assignment.trick_name}` : ""}`;
    else if (category === "bonus") text = `${name} landed ${assignment.trick_name || "a bonus trick"} · +${points}`;
    return { id: `award-${award.id}`, text, at: award.created_at, type: category || "points" };
  });

  const sessionItems = (sessions || []).map((session) => {
    const athlete = athleteById.get(session.athlete_id);
    const seconds = Number(session.daily_completed_seconds || 0);
    return {
      id: `daily-${session.id}`,
      text: `${firstName(athlete || {})} finished Daily Tricks${seconds ? ` in ${formatPbTime(seconds)}` : ""}`,
      at: session.daily_completed_at,
      type: "daily",
    };
  });

  return [...pointItems, ...sessionItems]
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 7);
}

function coachLiveActivityHtml(items = []) {
  const rows = items.length ? items.map((item) => `
    <div class="coach-live-row">
      <span class="live-dot"></span>
      <div><strong>${escapeHtml(item.text)}</strong><small>${dateLabel(item.at)}</small></div>
    </div>`).join("") : `<div class="empty compact-empty">Live rider activity will show here.</div>`;
  return `<article class="coach-live-card">
    <div class="coach-live-head"><div><div class="stat-label">Live activity</div><strong>Coach feed</strong></div><span>Live</span></div>
    <div class="coach-live-list">${rows}</div>
  </article>`;
}

async function renderCrew() {
  const [roster, { data: allAthletes, error }] = await Promise.all([
    getCoachRoster(),
    client.from("profiles").select("id, display_name, level, avatar").eq("role", "athlete").order("display_name"),
  ]);
  if (error) throw error;
  const [commandData, liveActivity] = roster.length ? await Promise.all([
    getCoachCommandData(roster),
    getCoachLiveActivity(roster),
  ]) : [{ statuses: [] }, []];
  const statuses = statusByAthlete(commandData.statuses);
  const linkedIds = new Set(roster.map((athlete) => athlete.id));
  const available = (allAthletes || []).filter((athlete) => !linkedIds.has(athlete.id));
  const groupsHtml = coachGroups.map(([groupId, label]) => {
    const athletes = roster.filter((athlete) => (athlete.groupNames || [athlete.groupName]).includes(groupId));
    const students = athletes.length ? athletes.map((athlete) => {
      const status = statuses.get(athlete.id) || {};
      return `
      <div class="student-chip-wrap">
        <button class="student-chip" draggable="true" data-athlete-id="${athlete.id}" data-open-student="${athlete.id}">
          ${avatarHtml(athlete, "student-chip-avatar")}
          <span><strong>${escapeHtml(athlete.display_name)}</strong><small>${heatChip(status.heat_status || "on_track")} ${escapeHtml(status.training_focus || "No focus set")}</small></span>
        </button>
        ${(athlete.groupNames || [athlete.groupName]).length > 1 ? `<button class="remove-group-btn" type="button" data-remove-athlete-group="${athlete.id}" data-remove-group="${groupId}" aria-label="Remove ${escapeHtml(athlete.display_name)} from ${escapeHtml(label)}">×</button>` : ""}
      </div>`;
    }).join("") : `<div class="empty compact-empty">Drop students here.</div>`;
    return `<section class="group-column group-${groupId}" data-group="${groupId}"><div class="group-head"><div><div class="panel-title">${label}</div><div class="panel-meta">${athletes.length} student${athletes.length === 1 ? "" : "s"}</div></div></div><div class="group-list">${students}</div></section>`;
  }).join("");
  const options = available.map((athlete) => `<option value="${athlete.id}">${escapeHtml(athlete.display_name)} · L${athlete.level}</option>`).join("");
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Coach dashboard</div><h1>Training <span>groups</span></h1><p>Drag students between groups, or click a student to open their profile.</p></div></div>
    <section class="coach-dashboard-top">${statCard("Total students", roster.length, "", "Assigned to your crew")}${coachLiveActivityHtml(liveActivity)}</section>
    <section class="groups-grid">${groupsHtml}</section>
    <section class="panel"><div class="panel-head"><div class="panel-title">Add an athlete</div><div class="panel-meta">They need an account first</div></div>
      ${available.length ? `<form id="add-athlete-form" class="trick-form"><div class="field"><label for="athlete-id">Available athletes</label><select id="athlete-id" name="athleteId">${options}</select></div><button class="primary-btn" type="submit">Add to crew</button></form>` : `<div class="empty">Every available athlete is already linked.</div>`}
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Create a student profile</div><div class="panel-meta">Makes their private login and adds them to your crew</div></div></div>
      <form id="create-student-form" class="student-account-form">
        <div class="field"><label for="student-name">Student name</label><input id="student-name" name="displayName" required placeholder="Koby Carroll"></div>
        <div class="field"><label for="student-email">Student or parent email</label><input id="student-email" name="email" type="email" required placeholder="student@example.com"></div>
        <div class="field"><label for="student-password">Temporary password</label><input id="student-password" name="password" type="password" minlength="8" required placeholder="At least 8 characters"></div>
        <button class="primary-btn" type="submit">Create and add student</button>
      </form>
    </section>`;
  document.querySelector("#add-athlete-form")?.addEventListener("submit", addAthlete);
  document.querySelector("#create-student-form").addEventListener("submit", createStudent);
  document.querySelectorAll(".student-chip").forEach((chip) => {
    chip.addEventListener("dragstart", (event) => {
      chip.dataset.dragging = "true";
      event.dataTransfer.setData("text/plain", chip.dataset.athleteId);
    });
    chip.addEventListener("dragend", () => setTimeout(() => { chip.dataset.dragging = "false"; }, 0));
    chip.addEventListener("click", () => {
      if (chip.dataset.dragging === "true") return;
      state.selectedAthleteId = chip.dataset.athleteId;
      navigate("student");
    });
  });
  document.querySelectorAll("[data-group]").forEach((group) => {
    group.addEventListener("dragover", (event) => { event.preventDefault(); group.classList.add("drag-over"); });
    group.addEventListener("dragleave", () => group.classList.remove("drag-over"));
    group.addEventListener("drop", async (event) => {
      event.preventDefault();
      group.classList.remove("drag-over");
      const athleteId = event.dataTransfer.getData("text/plain");
      if (athleteId) await addAthleteToGroup(athleteId, group.dataset.group);
    });
  });
  document.querySelectorAll("[data-remove-athlete-group]").forEach((button) => button.addEventListener("click", () => removeAthleteFromGroup(button.dataset.removeAthleteGroup, button.dataset.removeGroup)));
}

async function addAthleteToGroup(athleteId, groupName) {
  const { error } = await client.from("coach_athlete_groups").upsert({
    coach_id: state.user.id,
    athlete_id: athleteId,
    group_name: groupName,
    membership_type: "weekly",
    updated_at: new Date().toISOString(),
  }, { onConflict: "coach_id,athlete_id,group_name" });
  if (error) return notify(messageFrom(error), "error");
  await client.from("coach_athletes").update({ group_name: groupName }).eq("coach_id", state.user.id).eq("athlete_id", athleteId);
  notify("Student added to group.");
  await renderCrew();
}

async function removeAthleteFromGroup(athleteId, groupName) {
  const { error } = await client.from("coach_athlete_groups").delete().eq("coach_id", state.user.id).eq("athlete_id", athleteId).eq("group_name", groupName);
  if (error) return notify(messageFrom(error), "error");
  const { data: remainingGroups } = await client
    .from("coach_athlete_groups")
    .select("group_name")
    .eq("coach_id", state.user.id)
    .eq("athlete_id", athleteId)
    .order("created_at", { ascending: true });
  if (remainingGroups?.[0]?.group_name) {
    await client.from("coach_athletes").update({ group_name: remainingGroups[0].group_name }).eq("coach_id", state.user.id).eq("athlete_id", athleteId);
  }
  notify("Student removed from that group.");
  await renderCrew();
}

async function getCoachPreviewData() {
  if (!isCoachRole(state.profile?.role)) {
    navigate("home");
    return null;
  }
  const roster = await getCoachRoster();
  if (!roster.length) return { roster, athlete: null };
  if (!state.selectedAthleteId || !roster.some((athlete) => athlete.id === state.selectedAthleteId)) state.selectedAthleteId = roster[0].id;
  const athlete = roster.find((entry) => entry.id === state.selectedAthleteId);
  const [schedule, leaderboard, dashboardItems, sessionsResult, helpRequests, runs] = await Promise.all([
    getWeeklyAssignments(athlete.id),
    getLeaderboard(),
    getDashboardItems(athlete.id),
    client.from("training_sessions").select("*").eq("athlete_id", athlete.id).order("started_at", { ascending: false }).limit(5),
    getHelpRequests(athlete.id),
    getRunPlans(athlete.id),
  ]);
  if (sessionsResult.error) throw sessionsResult.error;
  return { roster, athlete, schedule, leaderboard, dashboardItems, sessions: sessionsResult.data || [], helpRequests, runs };
}

async function renderCoachPreview(mode = "student") {
  const data = await getCoachPreviewData();
  if (!data) return;
  if (!data.athlete) {
    document.querySelector("#view").innerHTML = `<div class="page-head"><div><div class="eyebrow">Coach preview</div><h1>No <span>students</span></h1><p>Add a student first, then you can preview their Student View and Parent View.</p></div></div><div class="empty">No students linked yet.</div>`;
    return;
  }
  const { athlete, schedule, leaderboard, dashboardItems, sessions, helpRequests, runs } = data;
  const { assignments, awards } = schedule;
  const rank = leaderboard.findIndex((row) => row.athlete_id === athlete.id) + 1;
  const weeklyRow = leaderboard.find((row) => row.athlete_id === athlete.id);
  const weeklyPercent = weeklyCompletionPercent(assignments, awards);
  const weeklyItems = assignments.filter((assignment) => assignment.category !== "daily");
  const completedWeekly = weeklyItems.filter(isAssignmentComplete).length;
  const taskItems = dashboardItems.filter((item) => item.item_type === "task");
  const events = dashboardItems.filter((item) => item.item_type === "event");
  const visibleFeedback = helpRequests.filter((request) => request.coach_comment || request.coach_video_data_url);
  const previewBody = mode === "parent"
    ? coachParentPreviewHtml({ athlete, assignments, awards, assignmentAttempts, leaderboard, dashboardItems, sessions, runs, visibleFeedback, rank, weeklyRow, weeklyPercent, completedWeekly, weeklyItems })
    : coachStudentPreviewHtml({ athlete, assignments, awards, taskItems, events, sessions, rank, weeklyRow, weeklyPercent });
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Coach preview</div><h1>${mode === "parent" ? "Parent" : "Student"} <span>view</span></h1><p>You are previewing what ${escapeHtml(athlete.display_name)}'s ${mode === "parent" ? "linked parent/guardian" : "student"} experience looks like on a phone.</p></div><div class="actions"><button class="secondary-btn" data-view="student">Back to profile</button><button class="secondary-btn" data-preview-switch="${mode === "parent" ? "studentPreview" : "parentPreview"}">${mode === "parent" ? "Student View" : "Parent View"}</button></div></div>
    <section class="coach-preview-shell">
      <div class="phone-preview-frame">${previewBody}</div>
    </section>`;
  document.querySelectorAll("#view [data-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  document.querySelector("[data-preview-switch]")?.addEventListener("click", (event) => navigate(event.currentTarget.dataset.previewSwitch));
}

function coachStudentPreviewHtml({ athlete, assignments, awards, taskItems, events, sessions, rank, weeklyRow, weeklyPercent }) {
  const sessionRows = sessions.length ? sessions.map((session) => `<div class="list-row"><div><strong>${dateLabel(session.started_at)}</strong><small>${session.ended_at ? "Finished" : "Live"} · ${session.total_points || 0} pts</small></div></div>`).join("") : `<div class="empty compact-empty">No sessions yet.</div>`;
  return `<div class="phone-preview-content">
    <section class="athlete-scoreboard panel">
      <div class="scoreboard-person">${avatarHtml(athlete, "score-avatar")}<div><div class="eyebrow">Athlete dashboard</div><h1>${escapeHtml(athlete.display_name)}</h1><p>Your week at a glance. Trick lists live in the Session tab.</p></div></div>
      <div class="scoreboard-stats preview-stats">
        ${statCard("World ranking", rank ? `#${rank}` : "-", "", "Crew board")}
        ${statCard("This week", `${weeklyPercent}%`, "", `${weeklyRow?.weekly_points || 0} pts`)}
        ${statCard("Daily Tricks", `${dailyCompletionCount(awards)}/7`, "", "This week")}
      </div>
    </section>
    ${quoteSection()}
    ${weekSummaryHtml(assignments, awards)}
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Important tasks</div><div class="panel-meta">Student can edit their tasks</div></div></div>${dashboardItemsHtml(taskItems, false)}</section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Upcoming events</div><div class="panel-meta">Events live in Contests</div></div></div>${dashboardItemsHtml(events, false)}</section>
    ${goalsReadonlyHtml(athlete)}
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Session schedule preview</div><div class="panel-meta">Assigned tricks visible to this rider</div></div></div>${assignmentGroups(assignments, false)}</section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Recent sessions</div></div></div>${sessionRows}</section>
  </div>`;
}

function coachParentPreviewHtml({ athlete, assignments, awards, assignmentAttempts = [], dashboardItems, sessions, runs, visibleFeedback, rank, weeklyRow, weeklyPercent, completedWeekly, weeklyItems }) {
  const sessionRows = sessions.length ? sessions.map((session) => `<div class="list-row"><div><strong>${dateLabel(session.started_at)}</strong><small>${session.ended_at ? `Ended ${dateLabel(session.ended_at)}` : "Session still live"}</small></div><span class="points">${session.total_points || 0}<small> pts</small></span></div>`).join("") : `<div class="empty compact-empty">No sessions recorded yet.</div>`;
  const runRows = runs.filter((run) => !run.archived_at).length ? runs.filter((run) => !run.archived_at).map((run) => `<div class="list-row"><div><strong>${escapeHtml(run.title)}</strong><small>${escapeHtml(run.venue || "Venue not set")} · ${Array.isArray(run.points) ? run.points.length : 0} points</small></div></div>`).join("") : `<div class="empty compact-empty">No active run plans yet.</div>`;
  return `<div class="phone-preview-content">
    <section class="panel parent-child-card">
      <div class="scoreboard-person">${avatarHtml(athlete, "score-avatar")}<div><div class="eyebrow">Read-only parent view</div><h1>${escapeHtml(athlete.display_name)}</h1><p>${escapeHtml(firstName(athlete))} completed ${weeklyPercent}% of this week's BMX program.</p></div></div>
      <div class="scoreboard-stats preview-stats">
        ${statCard("Weekly completion", `${weeklyPercent}%`, "", "Program complete")}
        ${statCard("Daily Tricks", `${dailyCompletionCount(awards)}/7`, "", "This week")}
        ${statCard("Leaderboard", rank ? `#${rank}` : "-", "", `${weeklyRow?.weekly_points || 0} pts`)}
        ${statCard("Weekly tasks", `${completedWeekly}/${weeklyItems.length || 0}`, "", "Tracked items")}
      </div>
      <div class="weekly-notification">Weekly notification: ${escapeHtml(firstName(athlete))} completed ${weeklyPercent}% of this week's BMX program.</div>
      <div class="settings-divider"></div>
      <div class="panel-title">Attempted this week</div>
      ${weeklyAttemptsHtml(assignmentAttempts)}
      ${goalsReadonlyHtml(athlete)}
      <div class="settings-divider"></div>
      <div class="panel-title">Training plan</div>
      <div class="parent-readonly">${assignmentGroups(assignments, false)}</div>
      <div class="settings-divider"></div>
      <div class="panel-title">Events & tasks</div>
      ${dashboardItemsHtml(dashboardItems, false)}
      <div class="settings-divider"></div>
      <div class="panel-title">Session progress</div>
      ${sessionRows}
      <div class="settings-divider"></div>
      <div class="panel-title">Run plans</div>
      ${runRows}
      <div class="settings-divider"></div>
      <div class="panel-title">Coach feedback</div>
      <div class="help-list">${helpRequestsHtml(visibleFeedback, "parent")}</div>
    </section>
  </div>`;
}

async function renderParents() {
  if (!isCoachRole(state.profile?.role)) {
    await navigate("home");
    return;
  }
  const [roster, parentResult, linkResult] = await Promise.all([
    getCoachRoster(),
    client.from("profiles").select("id, display_name, email, phone, avatar, created_at").eq("role", "parent").order("display_name"),
    client.from("parent_athletes").select("*").eq("coach_id", state.user.id).order("created_at", { ascending: false }),
  ]);
  if (parentResult.error) throw parentResult.error;
  if (linkResult.error) throw linkResult.error;
  const parents = parentResult.data || [];
  const links = linkResult.data || [];
  const athleteById = new Map(roster.map((athlete) => [athlete.id, athlete]));
  const linksByParent = links.reduce((map, link) => {
    const rows = map.get(link.parent_id) || [];
    rows.push(link);
    map.set(link.parent_id, rows);
    return map;
  }, new Map());
  const parentOptions = parents.map((parent) => `<option value="${parent.id}">${escapeHtml(parent.display_name)}${parent.email ? ` · ${escapeHtml(parent.email)}` : ""}</option>`).join("");
  const athleteOptions = roster.map((athlete) => `<option value="${athlete.id}">${escapeHtml(athlete.display_name)} · ${escapeHtml(groupLabelList(athlete.groupNames || [athlete.groupName]))}</option>`).join("");
  const grouped = coachGroups.map(([groupId, label]) => {
    const athletes = roster.filter((athlete) => (athlete.groupNames || [athlete.groupName]).includes(groupId));
    const rows = athletes.length ? athletes.map((athlete) => {
      const athleteLinks = links.filter((link) => link.athlete_id === athlete.id);
      const parentNames = athleteLinks.length ? athleteLinks.map((link) => {
        const parent = parents.find((entry) => entry.id === link.parent_id);
        return parent ? `${parent.display_name}${link.relationship ? ` (${link.relationship})` : ""}` : "Parent";
      }).join(", ") : "No linked parents";
      return `<div class="list-row"><button class="student-chip compact-student-chip" data-open-student="${athlete.id}">${avatarHtml(athlete)}<span>${escapeHtml(athlete.display_name)}</span></button><small>${escapeHtml(parentNames)}</small></div>`;
    }).join("") : `<div class="empty compact-empty">No riders in this group.</div>`;
    return `<section class="group-column parent-group-column"><div class="group-head"><div><div class="panel-title">${escapeHtml(label)}</div><div class="panel-meta">${athletes.length} rider${athletes.length === 1 ? "" : "s"}</div></div></div><div class="group-list">${rows}</div></section>`;
  }).join("");
  const parentRows = parents.length ? parents.map((parent) => {
    const parentLinks = linksByParent.get(parent.id) || [];
    const linkedNames = parentLinks.map((link) => athleteById.get(link.athlete_id)?.display_name).filter(Boolean);
    const linkedChildren = parentLinks.length ? parentLinks.map((link) => {
      const athlete = athleteById.get(link.athlete_id);
      if (!athlete) return "";
      return `<span class="public-badge">${escapeHtml(athlete.display_name)}${link.relationship ? ` · ${escapeHtml(link.relationship)}` : ""}<button class="inline-remove" type="button" data-unlink-parent-global="${parent.id}" data-unlink-athlete-global="${athlete.id}" aria-label="Unlink ${escapeHtml(parent.display_name)} from ${escapeHtml(athlete.display_name)}">×</button></span>`;
    }).filter(Boolean).join("") : `<span class="public-badge muted-badge">Unlinked</span>`;
    return `<article class="parent-admin-card ${parentLinks.length ? "linked" : "unlinked"}">
      <div class="parent-card-top">
        <div class="person">${avatarHtml(parent, "student-chip-avatar")}<div class="person-name"><strong>${escapeHtml(parent.display_name)}</strong><small>${escapeHtml(parent.email || "No email saved")}</small>${parent.phone ? `<small>${escapeHtml(parent.phone)}</small>` : ""}<small>Joined ${dateLabel(parent.created_at)}</small></div></div>
        ${parentContactButtonsHtml(parent, linkedNames)}
      </div>
      <div class="parent-link-summary">
        <span class="status-chip ${parentLinks.length ? "" : "warning-chip"}">${parentLinks.length ? "Linked" : "Not linked yet"}</span>
        <div><strong>Linked to:</strong> <span>${parentLinks.length ? escapeHtml(linkedNames.join(", ")) : "Not linked yet"}</span></div>
      </div>
      <div class="parent-child-badges">${linkedChildren}</div>
    </article>`;
  }).join("") : `<div class="empty">No parent accounts yet. Parents can create their own account from the sign-up screen.</div>`;
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Coach admin</div><h1>Parent <span>accounts</span></h1><p>Parents are read-only viewer accounts. Link them to one or more riders when they are ready.</p></div></div>
    <section class="stats-grid">
      ${statCard("Parent accounts", parents.length, "", "Separate from athletes")}
      ${statCard("Linked", parents.filter((parent) => (linksByParent.get(parent.id) || []).length).length, "", "Ready to view")}
      ${statCard("Unlinked", parents.filter((parent) => !(linksByParent.get(parent.id) || []).length).length, "", "Waiting for coach")}
      ${statCard("Parent links", links.length, "", "Parent to rider connections")}
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Link parent to rider</div><div class="panel-meta">Supports multiple children per parent and multiple parents per rider</div></div></div>
      ${parents.length && roster.length ? `<form id="parent-admin-link-form" class="trick-form parent-link-form"><div class="field"><label for="admin-parent-id">Parent account</label><select id="admin-parent-id" name="parentId" required>${parentOptions}</select></div><div class="field"><label for="admin-athlete-ids">Rider/s</label><select id="admin-athlete-ids" name="athleteIds" multiple size="${Math.min(Math.max(roster.length, 3), 7)}" required>${athleteOptions}</select><small>Hold Command on Mac to choose more than one rider.</small></div><div class="field"><label for="admin-relationship">Relationship</label><input id="admin-relationship" name="relationship" placeholder="Mum, Dad, guardian..."></div><button class="primary-btn" type="submit">Link account</button></form>` : `<div class="empty compact-empty">Create at least one parent account and one rider first.</div>`}
    </section>
    <section class="panel parent-accounts-panel">
      <details class="parent-account-accordion">
        <summary><div><div class="panel-title">All parent accounts</div><div class="panel-meta">Name, contact details, linked riders, status and date joined</div></div><span>Open</span></summary>
        <div class="parent-admin-list">${parentRows}</div>
      </details>
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Parents by training group</div><div class="panel-meta">Quick scan by Monday, Tuesday, Wednesday and online groups</div></div></div><div class="groups-grid">${grouped}</div></section>`;
  document.querySelector("#parent-admin-link-form")?.addEventListener("submit", linkParentFromAdmin);
  document.querySelectorAll("[data-unlink-parent-global]").forEach((button) => button.addEventListener("click", unlinkParentFromAdmin));
  document.querySelectorAll("[data-copy-parent-contact]").forEach((button) => button.addEventListener("click", copyParentContact));
  document.querySelectorAll("[data-open-student]").forEach((button) => button.addEventListener("click", () => {
    state.selectedAthleteId = button.dataset.openStudent;
    navigate("student");
  }));
}

function parentContactButtonsHtml(parent = {}, linkedNames = []) {
  const email = String(parent.email || "").trim();
  const phone = String(parent.phone || "").trim();
  const phoneHref = phone.replace(/[^\d+]/g, "");
  const contactText = [
    parent.display_name || "Parent",
    email ? `Email: ${email}` : "",
    phone ? `Phone: ${phone}` : "",
    linkedNames.length ? `Linked to: ${linkedNames.join(", ")}` : "Linked to: Not linked yet",
  ].filter(Boolean).join("\n");
  const encodedText = encodeURIComponent(contactText);
  return `<div class="parent-contact-actions">
    ${phoneHref ? `<a class="secondary-btn compact-btn" href="tel:${escapeHtml(phoneHref)}">Call</a><a class="secondary-btn compact-btn" href="sms:${escapeHtml(phoneHref)}">Text</a>` : ""}
    ${email ? `<a class="secondary-btn compact-btn" href="mailto:${escapeHtml(email)}">Email</a>` : ""}
    <button class="secondary-btn compact-btn" type="button" data-copy-parent-contact="${escapeHtml(encodedText)}">Copy</button>
  </div>`;
}

async function copyParentContact(event) {
  const text = decodeURIComponent(event.currentTarget.dataset.copyParentContact || "");
  if (!text) return notify("No contact details to copy.", "error");
  await navigator.clipboard.writeText(text);
  notify("Parent contact details copied.");
}

async function createStudent(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Creating...";
  const { data, error } = await client.functions.invoke("create-jkcrew-account", {
    body: {
      email: form.get("email").trim(),
      password: form.get("password"),
      displayName: form.get("displayName").trim(),
      role: "athlete",
      website: "",
    },
  });
  if (error || data?.error) {
    button.disabled = false;
    button.textContent = "Create and add student";
    return notify(data?.error || messageFrom(error), "error");
  }
  const { error: linkError } = await client.from("coach_athletes").insert({ coach_id: state.user.id, athlete_id: data.userId });
  if (linkError) return notify(messageFrom(linkError), "error");
  await client.from("coach_athlete_groups").upsert({ coach_id: state.user.id, athlete_id: data.userId, group_name: "monday", membership_type: "weekly" }, { onConflict: "coach_id,athlete_id,group_name" });
  notify("Student profile created and added to your crew.");
  state.selectedAthleteId = data.userId;
  await navigate("student");
}

async function addAthlete(event) {
  event.preventDefault();
  const athleteId = new FormData(event.currentTarget).get("athleteId");
  const { error } = await client.from("coach_athletes").insert({ coach_id: state.user.id, athlete_id: athleteId });
  if (error) return notify(messageFrom(error), "error");
  await client.from("coach_athlete_groups").upsert({ coach_id: state.user.id, athlete_id: athleteId, group_name: "monday", membership_type: "weekly" }, { onConflict: "coach_id,athlete_id,group_name" });
  notify("Athlete added to your crew.");
  await renderCrew();
}

async function deleteSelectedAthlete(athlete) {
  if (!state.selectedAthleteId || !athlete?.display_name) return;
  const confirmed = window.prompt(`This permanently deletes ${athlete.display_name}'s JKCREW account and saved app data.\n\nType DELETE to confirm.`);
  if (confirmed !== "DELETE") return notify("Delete cancelled.");
  const button = document.querySelector("#delete-student-account");
  button.disabled = true;
  button.textContent = "Deleting...";
  const { data, error } = await client.functions.invoke("delete-jkcrew-user", {
    body: { userId: state.selectedAthleteId },
  });
  if (error || data?.error) {
    button.disabled = false;
    button.textContent = `Delete ${athlete.display_name}`;
    return notify(data?.error || messageFrom(error), "error");
  }
  notify(`${athlete.display_name} was deleted.`);
  state.selectedAthleteId = null;
  await navigate("crew");
}

async function renderStudentProfile() {
  const roster = await getCoachRoster();
  if (!roster.length) {
    document.querySelector("#view").innerHTML = `<div class="page-head"><div><div class="eyebrow">Student profile</div><h1>No <span>students</span></h1><p>Add an athlete first, then you can set their weekly tricks.</p></div></div><div class="empty">No students linked yet.</div>`;
    return;
  }
  if (!state.selectedAthleteId || !roster.some((athlete) => athlete.id === state.selectedAthleteId)) state.selectedAthleteId = roster[0].id;
  const athlete = roster.find((entry) => entry.id === state.selectedAthleteId);
  const [schedule, { data: templates, error: templateError }, { data: parentLinks, error: parentLinkError }, { data: parentProfiles, error: parentProfileError }, helpRequests, dashboardItems, coachVenues, privateData, pointHistory] = await Promise.all([
    getWeeklyAssignments(athlete.id),
    client.from("coach_schedule_templates").select("*").eq("coach_id", state.user.id).ilike("student_name", athlete.display_name).limit(1),
    client.from("parent_athletes").select("parent_id, relationship, created_at").eq("coach_id", state.user.id).eq("athlete_id", athlete.id),
    client.from("profiles").select("id, display_name, email, phone, avatar, created_at").eq("role", "parent").order("display_name"),
    getHelpRequests(athlete.id),
    getDashboardItems(athlete.id),
    getCoachVenues(),
    getStudentPrivateData(athlete.id),
    getPointHistory(athlete.id),
  ]);
  const { assignments, awards } = schedule;
  if (templateError) throw templateError;
  if (parentLinkError) throw parentLinkError;
  if (parentProfileError) throw parentProfileError;
  const template = templates?.[0] || null;
  const athleteGroups = athlete.groupNames || [athlete.groupName || "monday"];
  const groupCheckboxes = coachGroups.map(([groupId, label]) => `<label class="group-checkbox"><input type="checkbox" name="groupNames" value="${groupId}" ${athleteGroups.includes(groupId) ? "checked" : ""}> <span>${escapeHtml(label)}</span></label>`).join("");
  const linkByParent = new Map((parentLinks || []).map((link) => [link.parent_id, link]));
  const linkedParentIds = new Set((parentLinks || []).map((link) => link.parent_id));
  const linkedParents = (parentProfiles || []).filter((parent) => linkedParentIds.has(parent.id));
  const availableParents = (parentProfiles || []).filter((parent) => !linkedParentIds.has(parent.id));
  const parentOptions = availableParents.map((parent) => `<option value="${parent.id}">${escapeHtml(parent.display_name)}${parent.email ? ` · ${escapeHtml(parent.email)}` : ""}</option>`).join("");
  const linkedParentsHtml = linkedParents.length ? linkedParents.map((parent) => `
    <div class="list-row parent-link-row">
      <div class="person">${avatarHtml(parent)}<div class="person-name"><strong>${escapeHtml(parent.display_name)}</strong><small>${escapeHtml(parent.email || "No email saved")}${parent.phone ? ` · ${escapeHtml(parent.phone)}` : ""} · ${escapeHtml(linkByParent.get(parent.id)?.relationship || "Guardian")} · Linked</small></div></div>
      <button class="danger-btn compact-btn" data-unlink-parent="${parent.id}">Unlink</button>
    </div>
  `).join("") : `<div class="empty">No parent viewers linked yet.</div>`;
  const savedVenueNames = coachVenues.map((venue) => venue.name).filter(Boolean);
  const baseVenueNames = savedVenueNames.length ? savedVenueNames : defaultVenues;
  const venueNames = [...new Set([...baseVenueNames, ...assignments.filter((assignment) => assignment.category === "daily").map((assignment) => venueLabel(assignment.venue))])];
  const selectedPlanVenueIndex = Math.max(0, venueNames.findIndex((venue) => venueKey(venue) === venueKey(state.coachPlanVenue || "")));
  const venueOptions = venueNames.map((venue, venueIndex) => {
    const count = assignments.filter((assignment) => assignment.category === "daily" && venueLabel(assignment.venue) === venue).length;
    return `<option value="${venueIndex}" ${venueIndex === selectedPlanVenueIndex ? "selected" : ""}>${escapeHtml(venue)} · ${count} trick${count === 1 ? "" : "s"}</option>`;
  }).join("");
  const dailyVenueEditors = venueNames.map((venue, venueIndex) => {
    const venueDailyCount = assignments.filter((assignment) => assignment.category === "daily" && venueLabel(assignment.venue) === venue).length;
    const assignmentText = assignments.filter((assignment) => assignment.category === "daily" && venueLabel(assignment.venue) === venue).map((assignment) => {
      const notes = assignment.notes ? ` - ${assignment.notes}` : "";
      return `${assignment.trick_name}${notes}`;
    }).join("\n");
    return `<div class="schedule-editor compact-schedule-editor venue-edit-panel compact-venue-editor ${venueIndex === selectedPlanVenueIndex ? "active" : ""}" data-venue-panel="${venueIndex}">
      <div class="schedule-editor-head compact-venue-head"><div><div class="panel-title">${escapeHtml(venue)} Daily Tricks</div><div class="panel-meta">Venue-specific list · one trick or line per row</div></div><div class="category-count">${venueDailyCount}</div></div>
      <div class="compact-venue-editor-grid">
        <div class="field venue-name-field"><label for="daily-venue-name-${venueIndex}">Venue name</label><input id="daily-venue-name-${venueIndex}" name="dailyVenueName:${venueIndex}" value="${escapeHtml(venue)}" placeholder="Skate park name"></div>
        <div class="field venue-tricks-field"><label for="assignment-daily-${venueIndex}">Daily tricks for this venue</label><textarea id="assignment-daily-${venueIndex}" name="dailyVenueTricks:${venueIndex}" placeholder="Add daily tricks here...">${escapeHtml(assignmentText)}</textarea></div>
      </div>
    </div>`;
  }).join("");
  const customVenueEditor = `<details class="coach-tool-details custom-venue-editor compact-custom-venue">
    <summary>Add another venue</summary>
    <div class="two-col-form">
      <div class="field"><label for="custom-daily-venue">Venue name</label><input id="custom-daily-venue" name="customDailyVenue" placeholder="New skate park name"></div>
      <div class="field"><label for="custom-daily-list">Daily tricks</label><textarea id="custom-daily-list" name="customDaily" placeholder="One trick per line"></textarea></div>
    </div>
  </details>`;
  const otherCategoryEditor = Object.entries(categoryInfo).filter(([category]) => category !== "daily").map(([category, info]) => {
    const assignmentText = assignments.filter((assignment) => assignment.category === category).map((assignment) => {
      const notes = assignment.notes ? ` - ${assignment.notes}` : "";
      return `${assignment.trick_name}${notes}`;
    }).join("\n");
    return planAccordionSection(info.label, `${assignments.filter((assignment) => assignment.category === category).length} assigned · ${info.description}`, `<div class="schedule-editor compact-schedule-editor">
      <div class="schedule-editor-head"><div><div class="panel-title">${info.label}</div><div class="panel-meta">${info.description}</div></div><div class="category-count">${assignments.filter((assignment) => assignment.category === category).length}</div></div>
      <div class="field"><label for="assignment-${category}">One trick or line per row</label><textarea id="assignment-${category}" name="${category}" placeholder="Add ${info.label.toLowerCase()} here...">${escapeHtml(assignmentText)}</textarea></div>
    </div>`, category === "one_bang" || category === "dialled");
  }).join("");
  const categoryEditor = `<div class="plan-accordion-stack">
    ${planAccordionSection("Venue-Specific Daily Tricks", "Select one riding location, then edit its Daily Tricks", `<div class="compact-venue-planner">
      <div class="compact-venue-controls">
        <div class="field compact-location-field"><label for="daily-venue-select">Riding location</label><select id="daily-venue-select" name="selectedDailyVenueIndex">${venueOptions}</select></div>
        <div class="compact-editor-tip">Only one location is open at a time. Rename the venue, add tricks, then save the full schedule.</div>
      </div>
      <div class="venue-edit-panels">${dailyVenueEditors}</div>
      ${customVenueEditor}
    </div>`, true)}
    ${otherCategoryEditor}
  </div>`;
  const dailyDone = dailyCompletionCount(awards);

  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Student profile</div><h1>${escapeHtml(athlete.display_name)} <span>L${athlete.level}</span></h1><p>Manage this athlete's picture, group, weekly tricks, and live progress.</p></div><div class="actions">${template ? `<button class="primary-btn" id="import-monday-plan">Load Monday plan</button>` : ""}<button class="secondary-btn" data-preview-view="studentPreview" type="button">Student View</button><button class="secondary-btn" data-preview-view="parentPreview" type="button">Parent View</button><button class="secondary-btn" id="back-to-students">All students</button></div></div>
    <section class="panel athlete-profile-hero">
      ${avatarHtml(athlete, "profile-avatar-large")}
      <div><div class="panel-title">${escapeHtml(athlete.display_name)}</div><div class="panel-meta">${escapeHtml(groupLabelList(athleteGroups))} · Daily Tricks completed this week: ${dailyDone}/7 · ${escapeHtml(spinDirectionLabels[athlete.spin_direction] || "Spin not set")}${athlete.favourite_trick ? ` · Favourite: ${escapeHtml(athlete.favourite_trick)}` : ""}</div></div>
      <form id="avatar-form" class="avatar-form"><input id="avatar-file" name="avatar" type="file" accept="image/*" hidden><button class="secondary-btn" type="button" id="choose-avatar">Upload / change picture</button><button class="danger-btn" type="button" id="remove-avatar">Remove picture</button></form>
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Rider profile details</div><div class="panel-meta">Visible on their public rider profile</div></div></div>
      <form id="coach-athlete-profile-form" class="two-col-form">
        <div class="field"><label for="coach-athlete-spin">Spin Direction</label><select id="coach-athlete-spin" name="spinDirection"><option value="" ${!athlete.spin_direction ? "selected" : ""}>Not set</option><option value="left" ${athlete.spin_direction === "left" ? "selected" : ""}>Left spin</option><option value="right" ${athlete.spin_direction === "right" ? "selected" : ""}>Right spin</option><option value="both" ${athlete.spin_direction === "both" ? "selected" : ""}>Both ways</option><option value="not_sure" ${athlete.spin_direction === "not_sure" ? "selected" : ""}>Not sure yet</option></select></div>
        <div class="field"><label for="coach-athlete-favourite">Favourite Trick</label><input id="coach-athlete-favourite" name="favouriteTrick" maxlength="120" value="${escapeHtml(athlete.favourite_trick || "")}" placeholder="Favourite BMX trick"></div>
        <div class="field"><label for="coach-athlete-country">Country</label><select id="coach-athlete-country" name="countryCode">${countryOptionsHtml(athlete.country_code || "")}</select></div>
        <div class="field group-checkbox-field"><label>Training groups</label><div class="group-checkbox-grid">${groupCheckboxes}</div><small>Riders can be in more than one weekly group.</small></div>
        <button class="primary-btn" type="submit">Save rider details</button>
      </form>
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Current weekly tricks</div><div class="panel-meta">Week starting ${escapeHtml(weekLabel())}</div></div></div>${assignmentGroups(assignments)}</section>
    ${extraTricksSection(athlete, false)}
    ${coachManualTricktionaryPanel(athlete)}
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Student Plan Builder</div><div class="panel-meta">Open the section you need · one trick or line per row · notes after a dash</div></div></div>
      <form id="assignment-form">${categoryEditor}<button class="primary-btn wide" type="submit">Save complete schedule</button></form>
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Linked Parents / Guardians</div><div class="panel-meta">Parents are read-only linked viewers, not athlete accounts</div></div></div>
      <div class="parent-links">${linkedParentsHtml}</div>
      ${availableParents.length ? `<form id="link-parent-form" class="trick-form parent-link-form"><div class="field"><label for="parent-id">Available parent accounts</label><select id="parent-id" name="parentId">${parentOptions}</select></div><div class="field"><label for="parent-relationship">Relationship</label><input id="parent-relationship" name="relationship" placeholder="Mum, Dad, guardian..."></div><button class="primary-btn" type="submit">Link parent</button></form>` : `<div class="empty compact-empty">No unlinked parent accounts available. Parents can create one from the sign-up screen.</div>`}
    </section>
    ${parentUpdatePanel(athlete, schedule, dashboardItems, privateData.attendance)}
    <section class="panel coach-private-panel"><div class="panel-head"><div><div class="panel-title">Private rider records</div><div class="panel-meta">Coach/admin only · emergency contacts, medical notes, waivers and permissions</div></div></div>${privateRecordForm(privateData.record)}</section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Waivers, forms & documents</div><div class="panel-meta">Private coach-only file area</div></div></div>${documentsHtml(privateData.documents)}<div class="settings-divider"></div>${documentUploadForm()}</section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Injury reports</div><div class="panel-meta">Quick phone-friendly report saved to the rider file</div></div></div>${injuryReportsHtml(privateData.injuries)}<div class="settings-divider"></div>${injuryReportForm(athlete)}</section>
    ${runBuilderPanel(privateData.runs)}
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Events & important tasks</div><div class="panel-meta">Visible on this athlete's Home page</div></div></div>
      ${dashboardItemsHtml(dashboardItems)}
      <div class="settings-divider"></div>
      ${dashboardItemForm(athlete.id)}
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Completion history</div><div class="panel-meta">Daily Tricks: ${dailyDone}/7 this week · ${assignments.filter((assignment) => assignment.category !== "daily" && isAssignmentComplete(assignment)).length} weekly tasks complete</div></div></div>
      ${assignmentGroups(assignments)}
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Point history</div><div class="panel-meta">Earned points, deductions, session bonuses and coach changes</div></div></div>
      ${pointHistoryHtml(pointHistory)}
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Trick help videos</div><div class="panel-meta">Open rider submissions and reply with written or video feedback</div></div></div>
      <div class="help-list">${helpRequestsHtml(helpRequests, "coach")}</div>
    </section>
    <section class="panel danger-zone"><div class="panel-head"><div><div class="panel-title">Delete student account</div><div class="panel-meta">Removes this rider from JKCREW, including their login and saved app data.</div></div></div>
      <button class="danger-btn wide" id="delete-student-account" type="button">Delete ${escapeHtml(athlete.display_name)}</button>
    </section>`;
  document.querySelector("#back-to-students").addEventListener("click", () => navigate("crew"));
  document.querySelectorAll("[data-preview-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.previewView)));
  document.querySelector("#import-monday-plan")?.addEventListener("click", () => importScheduleTemplate(template));
  document.querySelector("#assignment-form").addEventListener("submit", saveWeeklyAssignments);
  document.querySelector("#daily-venue-select")?.addEventListener("change", (event) => {
    const selectedIndex = event.currentTarget.value;
    const selectedPanel = document.querySelector(`[data-venue-panel="${selectedIndex}"]`);
    state.coachPlanVenue = selectedPanel?.querySelector(`[name="dailyVenueName:${selectedIndex}"]`)?.value || "";
    document.querySelectorAll("[data-venue-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.venuePanel === selectedIndex);
    });
  });
  document.querySelector("#coach-athlete-profile-form").addEventListener("submit", saveCoachAthleteProfile);
  document.querySelector("#coach-manual-trick-form")?.addEventListener("submit", saveCoachManualTrick);
  document.querySelectorAll("[data-coach-remove-manual-trick]").forEach((button) => button.addEventListener("click", removeCoachManualTrick));
  document.querySelector("#link-parent-form")?.addEventListener("submit", linkParentAccount);
  document.querySelector("#private-record-form").addEventListener("submit", savePrivateRecord);
  document.querySelector("#document-form").addEventListener("submit", saveAthleteDocument);
  document.querySelector("#injury-form").addEventListener("submit", saveInjuryReport);
  document.querySelector("#generate-parent-update").addEventListener("click", generateParentUpdate);
  document.querySelector("#copy-parent-update").addEventListener("click", copyParentUpdate);
  bindRunBuilderActions();
  document.querySelectorAll("[data-unlink-parent]").forEach((button) => button.addEventListener("click", unlinkParentAccount));
  document.querySelectorAll("[data-help-reply]").forEach((form) => form.addEventListener("submit", replyToHelpRequest));
  bindDashboardItemActions(renderStudentProfile);
  document.querySelector("#choose-avatar").addEventListener("click", () => document.querySelector("#avatar-file").click());
  document.querySelector("#avatar-file").addEventListener("change", updateAthleteAvatar);
  document.querySelector("#remove-avatar").addEventListener("click", () => saveAthleteAvatar(null));
  document.querySelector("#delete-student-account").addEventListener("click", () => deleteSelectedAthlete(athlete));
}

function parseAssignmentLine(line, index, category, venue = "") {
  const [left, ...noteParts] = line.split(" - ");
  const note = noteParts.join(" - ").trim();
  const trickName = left.trim();
  if (!trickName) return null;
  const targetReps = category === "dialled" ? 3 : category === "percentage" ? 10 : 1;
  return {
    coach_id: state.user.id,
    athlete_id: state.selectedAthleteId,
    week_start: weekStartDate(),
    trick_name: trickName.slice(0, 120),
    category,
    venue: category === "daily" ? venueKey(venue).slice(0, 80) : "",
    target_reps: targetReps,
    notes: note.slice(0, 500),
    sort_order: index,
  };
}

function dailyVenueRowsFromForm(form) {
  const rows = [...form.entries()]
    .filter(([key]) => key.startsWith("dailyVenueName:"))
    .map(([key, value]) => {
      const index = key.slice("dailyVenueName:".length);
      return {
        index,
        name: String(value || "").trim().slice(0, 80),
        tricks: String(form.get(`dailyVenueTricks:${index}`) || ""),
      };
    })
    .filter((row) => row.name);
  const customVenue = String(form.get("customDailyVenue") || "").trim().slice(0, 80);
  if (customVenue) rows.push({ index: "custom", name: customVenue, tricks: String(form.get("customDaily") || "") });
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function planAccordionSection(title, meta, body, open = false) {
  return `<details class="plan-accordion" ${open ? "open" : ""}>
    <summary><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></span><span class="accordion-caret">Open</span></summary>
    <div class="plan-accordion-body">${body}</div>
  </details>`;
}

async function saveCoachVenueNames(rows) {
  const venues = rows.map((row, index) => ({
    coach_id: state.user.id,
    name: row.name,
    sort_order: index,
  }));
  const { error: deleteError } = await client.from("coach_venues").delete().eq("coach_id", state.user.id);
  if (deleteError) throw deleteError;
  if (!venues.length) return;
  const { error } = await client.from("coach_venues").insert(venues);
  if (error) throw error;
}

async function saveWeeklyAssignments(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const selectedVenueIndex = String(form.get("selectedDailyVenueIndex") || "0");
  state.coachPlanVenue = String(form.get(`dailyVenueName:${selectedVenueIndex}`) || "").trim();
  const dailyVenueRows = dailyVenueRowsFromForm(form);
  const dailyAssignments = dailyVenueRows.flatMap((row, venueIndex) => String(row.tricks || "").split("\n")
    .map((line, index) => parseAssignmentLine(line.trim(), (venueIndex * 100) + index, "daily", row.name))
    .filter(Boolean));
  const otherAssignments = Object.keys(categoryInfo).filter((category) => category !== "daily").flatMap((category, categoryIndex) => String(form.get(category) || "").split("\n")
    .slice(0, category === "percentage" ? 3 : undefined)
    .map((line, index) => parseAssignmentLine(line.trim(), 1000 + (categoryIndex * 100) + index, category))
    .filter(Boolean));
  const assignments = [...dailyAssignments, ...otherAssignments].map((assignment, index) => ({ ...assignment, sort_order: index }));
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Saving...";
  const { error } = await client.rpc("save_weekly_assignments", {
    p_athlete_id: state.selectedAthleteId,
    p_week_start: weekStartDate(),
    p_assignments: assignments,
    p_venues: dailyVenueRows.map((row) => ({ name: row.name })),
  });
  if (error) {
    notify(messageFrom(error), "error");
    return renderStudentProfile();
  }

  notify("Weekly schedule saved for this student.");
  await renderStudentProfile();
}

async function saveCoachAthleteProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const groupNames = form.getAll("groupNames").filter(Boolean);
  if (!groupNames.length) return notify("Choose at least one training group.", "error");
  const countryCode = String(form.get("countryCode") || "");
  const { error } = await client.from("profiles").update({
    spin_direction: form.get("spinDirection") || "",
    favourite_trick: String(form.get("favouriteTrick") || "").trim().slice(0, 120),
    country_code: countryCode,
    country_name: countryNameFromCode(countryCode),
    updated_at: new Date().toISOString(),
  }).eq("id", state.selectedAthleteId);
  if (error) return notify(messageFrom(error), "error");
  const { error: deleteError } = await client.from("coach_athlete_groups").delete().eq("coach_id", state.user.id).eq("athlete_id", state.selectedAthleteId);
  if (deleteError) return notify(messageFrom(deleteError), "error");
  const rows = groupNames.map((groupName) => ({
    coach_id: state.user.id,
    athlete_id: state.selectedAthleteId,
    group_name: groupName,
    membership_type: "weekly",
  }));
  const { error: groupError } = await client.from("coach_athlete_groups").insert(rows);
  if (groupError) return notify(messageFrom(groupError), "error");
  await client.from("coach_athletes").update({ group_name: groupNames[0] }).eq("coach_id", state.user.id).eq("athlete_id", state.selectedAthleteId);
  notify("Rider profile details saved.");
  await renderStudentProfile();
}

async function selectedCoachAthleteProfile() {
  if (!isCoachRole(state.profile?.role) || !state.selectedAthleteId) return null;
  const roster = await getCoachRoster();
  return roster.find((athlete) => athlete.id === state.selectedAthleteId) || null;
}

async function saveCoachManualTrick(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const title = String(form.get("title") || "").trim();
  const count = Math.max(1, Number(form.get("count") || 1));
  if (!title) return;
  const athlete = await selectedCoachAthleteProfile();
  if (!athlete) return notify("Choose a rider before adding to their Tricktionary.", "error");
  const current = manualTricktionary(athlete);
  const exists = current.some((trick) => String(trick.title || trick.name || "").trim().toLowerCase() === title.toLowerCase());
  if (exists) return notify("That trick is already in this rider's manual Tricktionary.", "error");
  const manual_tricktionary = [{
    id: crypto.randomUUID(),
    title: title.slice(0, 120),
    count,
    addedAt: new Date().toISOString(),
    addedBy: state.user.id,
    source: "coach",
  }, ...current];
  const { error } = await client.from("profiles").update({ manual_tricktionary, updated_at: new Date().toISOString() }).eq("id", athlete.id);
  if (error) return notify(messageFrom(error), "error");
  notify("Trick added to the rider's Tricktionary. No points were awarded.");
  await renderStudentProfile();
}

async function removeCoachManualTrick(event) {
  const removeId = event.currentTarget.dataset.coachRemoveManualTrick;
  const athlete = await selectedCoachAthleteProfile();
  if (!athlete || !removeId) return notify("Choose a rider before changing their Tricktionary.", "error");
  const manual_tricktionary = manualTricktionary(athlete).filter((trick) => {
    const id = trick.id || String(trick.title || trick.name || "").trim();
    return id !== removeId;
  });
  const { error } = await client.from("profiles").update({ manual_tricktionary, updated_at: new Date().toISOString() }).eq("id", athlete.id);
  if (error) return notify(messageFrom(error), "error");
  notify("Manual Tricktionary trick removed. Historical session data was kept.");
  await renderStudentProfile();
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();
    reader.onload = () => { image.src = reader.result; };
    reader.onerror = reject;
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 360;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    image.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function updateAthleteAvatar(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return notify("Choose an image under 8MB.", "error");
  try {
    const dataUrl = await imageFileToDataUrl(file);
    await saveAthleteAvatar(dataUrl);
  } catch (_error) {
    notify("Could not read that image. Try another photo.", "error");
  }
}

async function saveAthleteAvatar(dataUrl) {
  const avatar = dataUrl ? { dataUrl, updatedAt: new Date().toISOString() } : {};
  const { error } = await client.from("profiles").update({ avatar, updated_at: new Date().toISOString() }).eq("id", state.selectedAthleteId);
  if (error) return notify(messageFrom(error), "error");
  notify(dataUrl ? "Profile picture updated." : "Profile picture removed.");
  await renderStudentProfile();
}

async function importScheduleTemplate(template) {
  const assignments = Object.keys(categoryInfo).flatMap((category, categoryIndex) => String(template[category] || "").split("\n")
    .slice(0, category === "percentage" ? 3 : undefined)
    .map((line, index) => parseAssignmentLine(line.trim(), (categoryIndex * 100) + index, category))
    .filter(Boolean))
    .map((assignment, index) => ({ ...assignment, sort_order: index }));
  const { error: scheduleError } = await client.rpc("save_weekly_assignments", {
    p_athlete_id: state.selectedAthleteId,
    p_week_start: weekStartDate(),
    p_assignments: assignments,
    p_venues: null,
  });
  if (scheduleError) return notify(messageFrom(scheduleError), "error");
  if (template.coach_note) {
    const { error } = await client.from("coach_notes").insert({ coach_id: state.user.id, athlete_id: state.selectedAthleteId, note: template.coach_note });
    if (error) return notify(messageFrom(error), "error");
  }
  notify("Monday plan loaded into this student profile.");
  await renderStudentProfile();
}

async function linkParentAccount(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const parentId = form.get("parentId");
  if (!parentId || !state.selectedAthleteId) return notify("Unable to link account. Please check the selected parent and rider.", "error");
  const { error } = await client.from("parent_athletes").upsert({
    parent_id: parentId,
    athlete_id: state.selectedAthleteId,
    coach_id: state.user.id,
    relationship: String(form.get("relationship") || "").trim().slice(0, 80),
    updated_at: new Date().toISOString(),
  }, { onConflict: "parent_id,athlete_id" });
  if (error) return notify(`Unable to link account. ${messageFrom(error)}`, "error");
  notify("Parent account linked successfully.");
  await renderStudentProfile();
}

async function linkParentFromAdmin(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const parentId = String(form.get("parentId") || "");
  const athleteIds = form.getAll("athleteIds").map((id) => String(id || "")).filter(Boolean);
  const button = formElement.querySelector("button[type=submit]");
  if (!parentId || !athleteIds.length) return notify("Unable to link account. Please check the selected parent and rider.", "error");
  button.disabled = true;
  button.textContent = "Linking...";
  const rows = athleteIds.map((athleteId) => ({
    parent_id: parentId,
    athlete_id: athleteId,
    coach_id: state.user.id,
    relationship: String(form.get("relationship") || "").trim().slice(0, 80),
    updated_at: new Date().toISOString(),
  }));
  const { error } = await client.from("parent_athletes").upsert(rows, { onConflict: "parent_id,athlete_id" });
  if (error) {
    button.disabled = false;
    button.textContent = "Link account";
    return notify(`Unable to link account. ${messageFrom(error)}`, "error");
  }
  notify(athleteIds.length === 1 ? "Parent account linked successfully." : `Parent account linked successfully to ${athleteIds.length} riders.`);
  await renderParents();
}

async function unlinkParentAccount(event) {
  const parentId = event.currentTarget.dataset.unlinkParent;
  const { error } = await client.from("parent_athletes")
    .delete()
    .eq("coach_id", state.user.id)
    .eq("athlete_id", state.selectedAthleteId)
    .eq("parent_id", parentId);
  if (error) return notify(messageFrom(error), "error");
  notify("Parent viewer unlinked.");
  await renderStudentProfile();
}

async function unlinkParentFromAdmin(event) {
  const parentId = event.currentTarget.dataset.unlinkParentGlobal;
  const athleteId = event.currentTarget.dataset.unlinkAthleteGlobal;
  const { error } = await client.from("parent_athletes")
    .delete()
    .eq("coach_id", state.user.id)
    .eq("athlete_id", athleteId)
    .eq("parent_id", parentId);
  if (error) return notify(messageFrom(error), "error");
  notify("Parent account unlinked.");
  await renderParents();
}

async function savePrivateRecord(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const { error } = await client.from("athlete_private_records").upsert({
    coach_id: state.user.id,
    athlete_id: state.selectedAthleteId,
    emergency_contact_name: String(form.get("emergencyContactName") || "").trim(),
    emergency_contact_phone: String(form.get("emergencyContactPhone") || "").trim(),
    guardian_details: String(form.get("guardianDetails") || "").trim(),
    medical_notes: String(form.get("medicalNotes") || "").trim(),
    injury_notes: String(form.get("injuryNotes") || "").trim(),
    waiver_notes: String(form.get("waiverNotes") || "").trim(),
    permission_notes: String(form.get("waiverNotes") || "").trim(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "coach_id,athlete_id" });
  if (error) return notify(messageFrom(error), "error");
  notify("Private rider record saved.");
  await renderStudentProfile();
}

async function saveAthleteDocument(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const file = form.get("file");
  if (!file?.size) return notify("Choose a document or image first.", "error");
  if (file.size > 12 * 1024 * 1024) return notify("Choose a file under 12MB.", "error");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const fileDataUrl = await fileToDataUrl(file);
    const { error } = await client.from("athlete_documents").insert({
      coach_id: state.user.id,
      athlete_id: state.selectedAthleteId,
      document_type: form.get("documentType"),
      title: String(form.get("title") || "").trim(),
      file_name: file.name,
      file_data_url: fileDataUrl,
      notes: String(form.get("notes") || "").trim(),
    });
    if (error) throw error;
    notify("Private document saved.");
    await renderStudentProfile();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Save file";
    notify(messageFrom(error), "error");
  }
}

async function saveInjuryReport(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const file = form.get("photo");
  if (file?.size > 8 * 1024 * 1024) return notify("Choose an injury photo under 8MB.", "error");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const photo = file?.size ? await fileToDataUrl(file) : "";
    const { error } = await client.from("injury_reports").insert({
      coach_id: state.user.id,
      athlete_id: state.selectedAthleteId,
      injured_at: new Date(form.get("injuredAt")).toISOString(),
      venue: String(form.get("venue") || "").trim(),
      what_happened: String(form.get("whatHappened") || "").trim(),
      body_area: String(form.get("bodyArea") || "").trim(),
      severity: form.get("severity"),
      first_aid: String(form.get("firstAid") || "").trim(),
      witnesses: String(form.get("witnesses") || "").trim(),
      guardian_contacted: form.get("guardianContacted") === "on",
      follow_up: String(form.get("followUp") || "").trim(),
      coach_notes: String(form.get("coachNotes") || "").trim(),
      photo_data_url: photo,
    });
    if (error) throw error;
    await client.from("athlete_coach_status").upsert({ coach_id: state.user.id, athlete_id: state.selectedAthleteId, heat_status: "injured", updated_at: new Date().toISOString() }, { onConflict: "coach_id,athlete_id" });
    notify("Injury report saved and rider marked modified/injured.");
    await renderStudentProfile();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Save injury report";
    notify(messageFrom(error), "error");
  }
}

function generateParentUpdate(event) {
  const button = event.currentTarget;
  const name = button.dataset.athleteName || "your rider";
  const first = name.split(/\s+/)[0] || name;
  const type = document.querySelector("#parent-update-type").value;
  const focus = document.querySelector("#parent-next-focus").value.trim() || "keeping the next session focused and consistent";
  const completed = button.dataset.completed || "0";
  const total = button.dataset.total || "0";
  const templates = {
    positive: `Hey! ${first} had a solid session today. They completed ${completed}/${total} weekly items and brought good energy. Next focus is ${focus}. Super proud of the effort.`,
    progress: `Hey! Quick progress update for ${first}: they are sitting at ${completed}/${total} completed items this week. The next focus is ${focus}. We will keep building this step by step.`,
    injury: `Hey, just letting you know ${first} had an injury/modified training note added today. Current plan is ${focus}. I will keep monitoring and adjust training as needed.`,
    behaviour: `Hey! Behaviour update for ${first}: today we focused on staying locked in, listening quickly, and keeping the session productive. Next focus is ${focus}.`,
    reminder: `Hey! Reminder for ${first}: please check upcoming tasks/events in JKCREW. Next focus is ${focus}.`,
    term: `Hey! Term report snapshot for ${first}: they completed ${completed}/${total} tracked weekly items recently. Main next focus is ${focus}. Thanks for supporting the process.`,
  };
  document.querySelector("#parent-update-draft").value = templates[type] || templates.positive;
}

async function copyParentUpdate() {
  const text = document.querySelector("#parent-update-draft").value.trim();
  if (!text) return notify("Generate or write a message first.", "error");
  await navigator.clipboard.writeText(text);
  notify("Parent update copied.");
}

function bindRunBuilderActions() {
  document.querySelector("#run-photo")?.addEventListener("change", setRunBuilderPhoto);
  document.querySelector("#run-map")?.addEventListener("click", addRunBuilderPoint);
  document.querySelectorAll("[data-run-point-index]").forEach((marker) => marker.addEventListener("pointerdown", startRunPointDrag));
  document.querySelector("#clear-run-builder")?.addEventListener("click", clearRunBuilder);
  document.querySelector("#play-run-builder")?.addEventListener("click", () => playRunPreview(document.querySelector("#run-map .run-map-preview")));
  document.querySelector("#run-builder-form")?.addEventListener("submit", saveRunPlan);
  document.querySelectorAll("[data-run-label]").forEach((input) => input.addEventListener("input", updateRunPointLabel));
  document.querySelectorAll("[data-run-up]").forEach((button) => button.addEventListener("click", moveRunPoint));
  document.querySelectorAll("[data-run-down]").forEach((button) => button.addEventListener("click", moveRunPoint));
  document.querySelectorAll("[data-run-delete]").forEach((button) => button.addEventListener("click", deleteRunPoint));
  document.querySelectorAll("[data-edit-run]").forEach((button) => button.addEventListener("click", editRunPlan));
  document.querySelectorAll("[data-archive-run]").forEach((button) => button.addEventListener("click", archiveRunPlan));
  document.querySelectorAll("[data-play-run]").forEach((button) => button.addEventListener("click", () => playRunPreview(button.closest(".run-card")?.querySelector(".run-map-preview"))));
}

function currentRunFormState() {
  const form = document.querySelector("#run-builder-form");
  if (!form) return {};
  const data = new FormData(form);
  return {
    id: state.runBuilder?.id || null,
    title: String(data.get("title") || state.runBuilder?.title || "").trim(),
    venue: String(data.get("venue") || state.runBuilder?.venue || "").trim(),
    planType: data.get("planType") || state.runBuilder?.planType || "training",
    notes: String(data.get("notes") || state.runBuilder?.notes || "").trim(),
    points: state.runBuilder?.points || [],
    imageDataUrl: state.runBuilder?.imageDataUrl || "",
  };
}

async function setRunBuilderPhoto(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return notify("Choose a park photo under 8MB.", "error");
  state.runBuilder = { ...currentRunFormState(), imageDataUrl: await fileToDataUrl(file), points: state.runBuilder?.points || [] };
  await runBuilderRefreshView();
}

async function addRunBuilderPoint(event) {
  if (!state.runBuilder?.imageDataUrl || event.target.closest(".run-marker")) return;
  const map = event.currentTarget.querySelector(".run-map-preview") || event.currentTarget;
  const rect = map.getBoundingClientRect();
  const x = Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10;
  const y = Math.round(((event.clientY - rect.top) / rect.height) * 1000) / 10;
  const label = window.prompt("Name this point or trick:", state.runBuilder.points.length ? `Trick ${state.runBuilder.points.length}` : "Start");
  if (!label) return;
  state.runBuilder = { ...currentRunFormState(), points: state.runBuilder.points || [] };
  state.runBuilder.points.push({ x, y, label: label.slice(0, 80) });
  await runBuilderRefreshView();
}

function updateRunBuilderMapDom() {
  const preview = document.querySelector("#run-map .run-map-preview");
  if (!preview || !state.runBuilder?.points) return;
  const currentSvg = preview.querySelector(".run-line-overlay");
  const nextSvg = runRouteSvg(state.runBuilder.points);
  if (currentSvg) currentSvg.outerHTML = nextSvg;
  else preview.insertAdjacentHTML("beforeend", nextSvg);
  preview.querySelectorAll("[data-run-point-index]").forEach((marker) => {
    const index = Number(marker.dataset.runPointIndex);
    const point = state.runBuilder.points[index];
    if (!point) return;
    marker.style.left = `${point.x}%`;
    marker.style.top = `${point.y}%`;
    marker.style.setProperty("--run-color", runPointColor(index + 1));
  });
}

function startRunPointDrag(event) {
  if (!state.runBuilder?.points) return;
  event.preventDefault();
  event.stopPropagation();
  state.draggedRunPoint = Number(event.currentTarget.dataset.runPointIndex);
  event.currentTarget.setPointerCapture?.(event.pointerId);
  document.addEventListener("pointermove", dragRunPoint);
  document.addEventListener("pointerup", stopRunPointDrag, { once: true });
}

function dragRunPoint(event) {
  const index = state.draggedRunPoint;
  if (!Number.isInteger(index) || !state.runBuilder?.points?.[index]) return;
  const map = document.querySelector("#run-map .run-map-preview");
  if (!map) return;
  const rect = map.getBoundingClientRect();
  const x = Math.max(0, Math.min(100, Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10));
  const y = Math.max(0, Math.min(100, Math.round(((event.clientY - rect.top) / rect.height) * 1000) / 10));
  state.runBuilder.points[index] = { ...state.runBuilder.points[index], x, y };
  updateRunBuilderMapDom();
}

function stopRunPointDrag() {
  document.removeEventListener("pointermove", dragRunPoint);
  state.draggedRunPoint = null;
}

function updateRunPointLabel(event) {
  const index = Number(event.currentTarget.dataset.runLabel);
  if (!state.runBuilder?.points?.[index]) return;
  state.runBuilder.points[index] = { ...state.runBuilder.points[index], label: event.currentTarget.value.slice(0, 80) };
}

async function moveRunPoint(event) {
  const up = event.currentTarget.dataset.runUp;
  const down = event.currentTarget.dataset.runDown;
  const index = Number(up ?? down);
  const nextIndex = up !== undefined ? index - 1 : index + 1;
  if (!state.runBuilder?.points?.[index] || !state.runBuilder.points[nextIndex]) return;
  state.runBuilder = { ...currentRunFormState(), points: [...state.runBuilder.points] };
  [state.runBuilder.points[index], state.runBuilder.points[nextIndex]] = [state.runBuilder.points[nextIndex], state.runBuilder.points[index]];
  await runBuilderRefreshView();
}

async function deleteRunPoint(event) {
  const index = Number(event.currentTarget.dataset.runDelete);
  if (!state.runBuilder?.points?.[index]) return;
  state.runBuilder = { ...currentRunFormState(), points: state.runBuilder.points.filter((_point, pointIndex) => pointIndex !== index) };
  await runBuilderRefreshView();
}

function playRunPreview(preview) {
  if (!preview) return;
  clearTimeout(state.runPlaybackTimer);
  const markers = [...preview.querySelectorAll(".run-marker")];
  const segments = [...preview.querySelectorAll("[data-run-segment]")];
  if (!markers.length) return;
  markers.forEach((marker) => marker.classList.remove("play-active", "play-done"));
  segments.forEach((segment) => segment.classList.remove("play-active", "play-done"));
  let index = 0;
  const step = () => {
    markers.forEach((marker, markerIndex) => {
      marker.classList.toggle("play-active", markerIndex === index);
      marker.classList.toggle("play-done", markerIndex < index);
    });
    segments.forEach((segment, segmentIndex) => {
      segment.classList.toggle("play-active", segmentIndex === index - 1);
      segment.classList.toggle("play-done", segmentIndex < index - 1);
    });
    index += 1;
    if (index <= markers.length) state.runPlaybackTimer = setTimeout(step, 850);
  };
  step();
}

async function clearRunBuilder() {
  state.runBuilder = null;
  await runBuilderRefreshView();
}

async function editRunPlan(event) {
  const runId = event.currentTarget.dataset.editRun;
  const athleteId = isCoachRole(state.profile.role) ? state.selectedAthleteId : state.user.id;
  const runs = await getRunPlans(athleteId);
  const run = runs.find((item) => item.id === runId);
  if (!run || !canEditRun(run)) return notify("You can only edit runs you created.", "error");
  state.runBuilder = {
    id: run.id,
    title: run.title,
    venue: run.venue,
    planType: run.plan_type,
    notes: run.notes,
    imageDataUrl: run.image_data_url,
    points: Array.isArray(run.points) ? run.points : [],
  };
  await runBuilderRefreshView();
}

async function archiveRunPlan(event) {
  const runId = event.currentTarget.dataset.archiveRun;
  const { error } = await client.from("run_plans").update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", runId).eq("coach_id", state.user.id);
  if (error) return notify(messageFrom(error), "error");
  notify("Run archived. It is saved for later.");
  await runBuilderRefreshView();
}

async function saveRunPlan(event) {
  event.preventDefault();
  if (!state.runBuilder?.imageDataUrl) return notify("Upload a park photo first.", "error");
  const form = new FormData(event.currentTarget);
  const isCoach = isCoachRole(state.profile.role);
  const athleteId = isCoach ? state.selectedAthleteId : state.user.id;
  const coachId = isCoach ? state.user.id : await getLinkedCoachIdForCurrentAthlete();
  const payload = {
    coach_id: coachId,
    athlete_id: athleteId,
    title: String(form.get("title") || "").trim(),
    venue: String(form.get("venue") || "").trim(),
    plan_type: form.get("planType"),
    image_data_url: state.runBuilder.imageDataUrl,
    points: state.runBuilder.points || [],
    notes: String(form.get("notes") || "").trim(),
    updated_at: new Date().toISOString(),
  };
  const query = state.runBuilder.id
    ? client.from("run_plans").update(payload).eq("id", state.runBuilder.id)
    : client.from("run_plans").insert({ ...payload, created_by: state.user.id });
  const { error } = await query;
  if (error) return notify(messageFrom(error), "error");
  state.runBuilder = null;
  notify("Run plan saved.");
  await runBuilderRefreshView();
}

async function getLinkedCoachIdForCurrentAthlete() {
  const { data, error } = await client.from("coach_athletes").select("coach_id").eq("athlete_id", state.user.id).limit(1);
  if (error) throw error;
  return data?.[0]?.coach_id || null;
}

async function submitHelpRequest(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const video = form.get("video");
  const question = String(form.get("question") || "").trim();
  if (!video?.size) return notify("Upload a trick video first.", "error");
  if (video.size > 24 * 1024 * 1024) return notify("Choose a video under 24MB for now.", "error");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Uploading...";
  try {
    const coachId = await getLinkedCoachIdForCurrentAthlete();
    if (!coachId) throw new Error("Ask your coach to add you to their crew first.");
    const videoDataUrl = await fileToDataUrl(video);
    const { error } = await client.from("trick_help_requests").insert({
      athlete_id: state.user.id,
      coach_id: coachId,
      question,
      video_data_url: videoDataUrl,
    });
    if (error) throw error;
    notify("Video sent to your coach.");
    await renderAthleteHome();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Submit to coach";
    notify(messageFrom(error), "error");
  }
}

async function replyToHelpRequest(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const file = form.get("video");
  const comment = String(form.get("comment") || "").trim();
  if (!comment && !file?.size) return notify("Add a written reply, video reply, or both.", "error");
  if (file?.size > 24 * 1024 * 1024) return notify("Choose a video under 24MB for now.", "error");
  const button = formElement.querySelector("button");
  button.disabled = true;
  button.textContent = "Sending...";
  try {
    const update = {
      coach_comment: comment || null,
      status: "replied",
      replied_at: new Date().toISOString(),
    };
    if (file?.size) update.coach_video_data_url = await fileToDataUrl(file);
    const { data, error } = await client.from("trick_help_requests")
      .update(update)
      .eq("id", formElement.dataset.helpReply)
      .select("id, status");
    if (error) throw error;
    if (!data?.length) throw new Error("Unable to save feedback for this video. Check the rider is still linked to your coach account.");
    state.videoReviewMedia.delete(formElement.dataset.helpReply);
    notify("Coach feedback sent to rider.");
    if (state.view === "videoReviews") await renderVideoReviews();
    else await renderStudentProfile();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Send coach reply";
    notify(messageFrom(error), "error");
  }
}

async function getCoachVideoReviews() {
  if (!isCoachRole(state.profile?.role)) return { roster: [], requests: [] };
  const roster = await getCoachRoster();
  const athleteIds = roster.map((athlete) => athlete.id);
  if (!athleteIds.length) return { roster, requests: [] };
  const { data, error } = await client.from("trick_help_requests")
    .select("id, athlete_id, coach_id, question, coach_comment, status, created_at, replied_at")
    .in("athlete_id", athleteIds)
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) throw error;
  const byAthlete = new Map(roster.map((athlete) => [athlete.id, athlete]));
  return {
    roster,
    requests: (data || []).map((request) => ({ ...request, athlete: byAthlete.get(request.athlete_id) || null })),
  };
}

function videoReviewFilterHtml(roster = []) {
  const riderOptions = roster.map((athlete) => `<option value="${athlete.id}" ${state.videoReviewRider === athlete.id ? "selected" : ""}>${escapeHtml(athlete.display_name)}</option>`).join("");
  return `<section class="panel video-review-filters">
    <div class="field"><label for="video-review-status">Status</label><select id="video-review-status"><option value="all" ${state.videoReviewStatus === "all" ? "selected" : ""}>All requests</option><option value="new" ${state.videoReviewStatus === "new" ? "selected" : ""}>New / waiting</option><option value="replied" ${state.videoReviewStatus === "replied" ? "selected" : ""}>Replied</option><option value="reviewed" ${state.videoReviewStatus === "reviewed" ? "selected" : ""}>Reviewed</option></select></div>
    <div class="field"><label for="video-review-rider">Rider</label><select id="video-review-rider"><option value="all" ${state.videoReviewRider === "all" ? "selected" : ""}>All riders</option>${riderOptions}</select></div>
    <div class="field"><label for="video-review-search">Search</label><input id="video-review-search" value="${escapeHtml(state.videoReviewSearch)}" placeholder="Trick, question, rider..."></div>
  </section>`;
}

function videoReviewCardHtml(request) {
  const athlete = request.athlete || { display_name: "Unknown rider", avatar: null };
  const status = request.status || "new";
  const media = state.videoReviewMedia.get(request.id) || {};
  const saveName = `${athlete.display_name || "rider"}-${dateLabel(request.created_at)}-trick-video`;
  const riderVideo = media.video_data_url ? `
    <video class="help-video" src="${escapeHtml(media.video_data_url)}" controls playsinline preload="metadata"></video>
    <div class="video-actions">
      <a class="secondary-btn compact-btn" href="${escapeHtml(media.video_data_url)}" target="_blank" rel="noopener">Open video</a>
      <button class="secondary-btn compact-btn" type="button" data-save-help-video="${request.id}" data-save-name="${escapeHtml(saveName)}">Save video</button>
    </div>` : `<div class="video-lazy-box" data-help-video-slot="${request.id}">
      <div><strong>Student video attached</strong><small>Load only when you want to watch it, or save it straight away.</small></div>
      <div class="video-actions">
        <button class="secondary-btn compact-btn" type="button" data-load-help-video="${request.id}">Load video</button>
        <button class="secondary-btn compact-btn" type="button" data-save-help-video="${request.id}" data-save-name="${escapeHtml(saveName)}">Save video</button>
      </div>
    </div>`;
  const coachVideo = media.coach_video_data_url ? `<video class="help-video" src="${escapeHtml(media.coach_video_data_url)}" controls playsinline preload="metadata"></video>` : "";
  const coachReply = request.coach_comment || coachVideo || status === "replied"
    ? `<div class="coach-reply"><strong>Coach reply saved</strong>${request.coach_comment ? `<p>${escapeHtml(request.coach_comment)}</p>` : ""}${coachVideo}${!coachVideo && status === "replied" ? `<small>Video reply saved. Load this request's media to view it.</small>` : ""}</div>`
    : "";
  const reviewed = status === "reviewed";
  return `<article class="video-review-card help-card">
    <div class="video-review-top">
      <div class="person">${avatarHtml(athlete)}<div class="person-name"><strong>${escapeHtml(athlete.display_name)}</strong><small>${dateLabel(request.created_at)} · ${escapeHtml(status)}</small></div></div>
      <button class="secondary-btn compact-btn" type="button" data-open-student="${escapeHtml(request.athlete_id)}">Open rider</button>
    </div>
    <div class="help-card-head"><div><strong>${escapeHtml(request.question || "Trick help request")}</strong><small>${escapeHtml(status === "reviewed" ? "Marked reviewed" : "Awaiting / reply status")}</small></div></div>
    ${riderVideo}
    ${coachReply}
    <form class="reply-form" data-help-reply="${request.id}">
      <div class="field"><label for="central-reply-${request.id}">Written feedback</label><textarea id="central-reply-${request.id}" name="comment" placeholder="What should they fix?">${escapeHtml(request.coach_comment || "")}</textarea></div>
      <div class="field"><label for="central-reply-video-${request.id}">Optional video reply</label><input id="central-reply-video-${request.id}" name="video" type="file" accept="video/*"></div>
      <button class="primary-btn" type="submit">Send coach reply</button>
    </form>
    <button class="secondary-btn compact-btn" type="button" data-mark-help-reviewed="${request.id}" ${reviewed ? "disabled" : ""}>${reviewed ? "Reviewed" : "Mark reviewed"}</button>
  </article>`;
}

async function renderVideoReviews() {
  if (!isCoachRole(state.profile?.role)) return navigate("home");
  const { roster, requests } = await getCoachVideoReviews();
  const search = state.videoReviewSearch.toLowerCase().trim();
  const filtered = requests.filter((request) => {
    const status = request.status || "new";
    const statusMatch = state.videoReviewStatus === "all"
      || (state.videoReviewStatus === "new" && !["replied", "reviewed"].includes(status))
      || status === state.videoReviewStatus;
    const riderMatch = state.videoReviewRider === "all" || request.athlete_id === state.videoReviewRider;
    const haystack = `${request.question || ""} ${request.athlete?.display_name || ""} ${status}`.toLowerCase();
    return statusMatch && riderMatch && (!search || haystack.includes(search));
  });
  const newCount = requests.filter((request) => !["replied", "reviewed"].includes(request.status || "new")).length;
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Coach tools</div><h1>Video <span>Reviews</span></h1><p>All rider trick-help videos in one coach-only inbox.</p></div></div>
    <section class="stats-grid">
      ${statCard("New", newCount, "", "Waiting")}
      ${statCard("Total", requests.length, "", "Submissions")}
      ${statCard("Riders", new Set(requests.map((request) => request.athlete_id)).size, "", "With videos")}
    </section>
    ${videoReviewFilterHtml(roster)}
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Review inbox</div><div class="panel-meta">${filtered.length} visible video${filtered.length === 1 ? "" : "s"}</div></div></div>
      <div class="video-review-list">${filtered.length ? filtered.map(videoReviewCardHtml).join("") : `<div class="empty compact-empty">No videos match those filters.</div>`}</div>
    </section>`;
  document.querySelector("#video-review-status")?.addEventListener("change", (event) => {
    state.videoReviewStatus = event.target.value;
    renderVideoReviews();
  });
  document.querySelector("#video-review-rider")?.addEventListener("change", (event) => {
    state.videoReviewRider = event.target.value;
    renderVideoReviews();
  });
  document.querySelector("#video-review-search")?.addEventListener("input", (event) => {
    state.videoReviewSearch = event.target.value;
    clearTimeout(state.videoReviewSearchTimer);
    state.videoReviewSearchTimer = setTimeout(() => renderVideoReviews(), 250);
  });
  document.querySelectorAll("[data-open-student]").forEach((button) => button.addEventListener("click", () => {
    state.selectedAthleteId = button.dataset.openStudent;
    navigate("student");
  }));
  document.querySelectorAll("[data-help-reply]").forEach((form) => form.addEventListener("submit", replyToHelpRequest));
  document.querySelectorAll("[data-load-help-video]").forEach((button) => button.addEventListener("click", loadHelpVideo));
  document.querySelectorAll("[data-save-help-video]").forEach((button) => button.addEventListener("click", saveHelpVideo));
  document.querySelectorAll("[data-mark-help-reviewed]").forEach((button) => button.addEventListener("click", markHelpReviewed));
}

async function fetchHelpVideoMedia(requestId) {
  const cached = state.videoReviewMedia.get(requestId);
  if (cached?.video_data_url || cached?.coach_video_data_url) return cached;
  const { data, error } = await client.from("trick_help_requests")
    .select("id, video_data_url, coach_video_data_url")
    .eq("id", requestId)
    .limit(1);
  if (error) throw error;
  if (!data?.length) throw new Error("Could not load that video. Check the rider is still linked to your coach account.");
  const media = {
    video_data_url: data[0].video_data_url || "",
    coach_video_data_url: data[0].coach_video_data_url || "",
  };
  state.videoReviewMedia.set(requestId, media);
  return media;
}

async function loadHelpVideo(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Loading...";
  try {
    const media = await fetchHelpVideoMedia(button.dataset.loadHelpVideo);
    if (!media.video_data_url) notify("No student video found for this request.", "error");
    await renderVideoReviews();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Load video";
    notify(messageFrom(error), "error");
  }
}

async function saveHelpVideo(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Saving...";
  try {
    const media = await fetchHelpVideoMedia(button.dataset.saveHelpVideo);
    if (!media.video_data_url) throw new Error("No student video found for this request.");
    downloadDataUrl(media.video_data_url, button.dataset.saveName || "jkcrew-trick-video");
    button.disabled = false;
    button.textContent = originalText;
    notify("Video saved.");
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    notify(messageFrom(error), "error");
  }
}

async function markHelpReviewed(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  button.disabled = true;
  const { data, error } = await client.from("trick_help_requests")
    .update({ status: "reviewed" })
    .eq("id", button.dataset.markHelpReviewed)
    .select("id, status");
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  if (!data?.length) {
    button.disabled = false;
    return notify("Unable to mark reviewed. Check the rider is still linked to your coach account.", "error");
  }
  notify("Video marked reviewed.");
  await renderVideoReviews();
}

async function renderNotes() {
  const roster = await getCoachRoster();
  if (!roster.length) {
    document.querySelector("#view").innerHTML = `<div class="page-head"><div><div class="eyebrow">Private coach tools</div><h1>Coach <span>notes</span></h1><p>Notes are private to you.</p></div></div><div class="empty">Add an athlete to your crew before writing notes.</div>`;
    return;
  }
  if (!state.selectedAthleteId || !roster.some((athlete) => athlete.id === state.selectedAthleteId)) state.selectedAthleteId = roster[0].id;
  const { data: notes, error } = await client.from("coach_notes").select("*").eq("coach_id", state.user.id).eq("athlete_id", state.selectedAthleteId).order("created_at", { ascending: false });
  if (error) throw error;
  const options = roster.map((athlete) => `<option value="${athlete.id}" ${athlete.id === state.selectedAthleteId ? "selected" : ""}>${escapeHtml(athlete.display_name)}</option>`).join("");
  const notesHtml = notes.length ? notes.map((note) => `<article class="note"><p>${escapeHtml(note.note)}</p><small>${dateLabel(note.created_at)}</small></article>`).join("") : `<div class="empty">No private notes for this athlete yet.</div>`;
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Private coach tools</div><h1>Coach <span>notes</span></h1><p>Only you can see the notes you write here.</p></div></div>
    <div class="two-col">
      <section class="panel"><div class="panel-head"><div class="panel-title">Notes</div><div class="field" style="margin:0"><select id="note-athlete">${options}</select></div></div><div class="notes-list">${notesHtml}</div></section>
      <section class="panel"><div class="panel-head"><div class="panel-title">Add note</div></div><form id="note-form"><div class="field"><label for="note-text">Private note</label><textarea id="note-text" name="note" required placeholder="Focus for next session..."></textarea></div><button class="primary-btn wide" type="submit">Save note</button></form></section>
    </div>`;
  document.querySelector("#note-athlete").addEventListener("change", (event) => { state.selectedAthleteId = event.target.value; renderNotes(); });
  document.querySelector("#note-form").addEventListener("submit", addNote);
}

async function addNote(event) {
  event.preventDefault();
  const note = new FormData(event.currentTarget).get("note").trim();
  const { error } = await client.from("coach_notes").insert({ coach_id: state.user.id, athlete_id: state.selectedAthleteId, note });
  if (error) return notify(messageFrom(error), "error");
  notify("Private note saved.");
  await renderNotes();
}

function coachDailyPbSettingsHtml(roster = []) {
  const options = roster.length
    ? roster.map((athlete) => `<option value="${athlete.id}">${escapeHtml(athlete.display_name)} · PB ${formatPbTime(athlete.daily_pb_seconds)}</option>`).join("")
    : `<option value="">No linked riders yet</option>`;
  return `<section class="panel coach-pb-panel">
    <div class="panel-head"><div><div class="panel-title">Daily PB repair</div><div class="panel-meta">Coach-only manual fix for accidental Daily Tricks times</div></div></div>
    <form id="coach-daily-pb-form" class="compact-admin-form">
      <div class="field"><label for="coach-pb-athlete">Rider</label><select id="coach-pb-athlete" name="athleteId" required>${options}</select></div>
      <div class="field"><label for="coach-pb-time">Daily PB time</label><input id="coach-pb-time" name="dailyPb" placeholder="1:24 or 84 seconds" inputmode="numeric"></div>
      <div class="actions compact-actions"><button class="primary-btn" type="submit">Save PB</button><button class="secondary-btn" type="button" id="clear-daily-pb">Clear PB</button></div>
    </form>
    <p class="subcopy">Leave the time blank or use Clear PB if a mistaken time should be removed.</p>
  </section>`;
}

async function saveCoachDailyPb(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const athleteId = form.get("athleteId");
  const seconds = parsePbSeconds(form.get("dailyPb"));
  if (!athleteId) return notify("Choose a rider first.", "error");
  if (Number.isNaN(seconds)) return notify("Use a time like 1:24, or type total seconds like 84.", "error");
  const button = formElement.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  const { data, error } = await client.rpc("set_athlete_daily_pb", {
    p_athlete_id: athleteId,
    p_seconds: seconds,
  });
  if (error) {
    button.disabled = false;
    button.textContent = "Save PB";
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  notify(result?.daily_pb_seconds ? `Daily PB saved: ${formatPbTime(result.daily_pb_seconds)}.` : "Daily PB cleared.");
  await renderProfile();
}

async function clearCoachDailyPb(event) {
  const formElement = event.currentTarget.closest("form");
  const athleteId = new FormData(formElement).get("athleteId");
  if (!athleteId) return notify("Choose a rider first.", "error");
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = "Clearing...";
  const { error } = await client.rpc("set_athlete_daily_pb", {
    p_athlete_id: athleteId,
    p_seconds: null,
  });
  if (error) {
    event.currentTarget.disabled = false;
    event.currentTarget.textContent = "Clear PB";
    return notify(messageFrom(error), "error");
  }
  notify("Daily PB cleared.");
  await renderProfile();
}

async function renderProfile() {
  let trainingHistorySection = "";
  let coachPbSection = "";
  try {
    if (state.profile.role === "athlete") {
      const historyData = await getTricktionaryData(state.user.id);
      trainingHistorySection = `<section class="panel"><div class="panel-head"><div><div class="panel-title">Training history</div><div class="panel-meta">Previous sheets moved here from Tricktionary</div></div></div>${previousTrainingSheetsHtml(historyData)}</section>`;
    } else if (state.profile.role === "parent") {
      const { data: links, error } = await client.from("parent_athletes").select("athlete_id, relationship").eq("parent_id", state.user.id);
      if (error) throw error;
      const sections = await Promise.all((links || []).map(async (link) => {
        const historyData = await getTricktionaryData(link.athlete_id);
        return `<div class="parent-history-block"><div class="panel-title">${escapeHtml(historyData.profile.display_name)}'s training history</div>${previousTrainingSheetsHtml(historyData)}</div>`;
      }));
      trainingHistorySection = sections.length ? `<section class="panel"><div class="panel-head"><div><div class="panel-title">Linked rider training history</div><div class="panel-meta">Read-only previous sheets for your linked child/rider</div></div></div>${sections.join("")}</section>` : "";
    }
  } catch (error) {
    trainingHistorySection = `<section class="panel"><div class="empty compact-empty">Training history could not load: ${escapeHtml(messageFrom(error))}</div></section>`;
  }
  if (isCoachRole(state.profile?.role)) {
    try {
      coachPbSection = coachDailyPbSettingsHtml(await getCoachRoster());
    } catch (error) {
      coachPbSection = `<section class="panel"><div class="empty compact-empty">Daily PB repair could not load: ${escapeHtml(messageFrom(error))}</div></section>`;
    }
  }
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Your account</div><h1>Profile & <span>settings</span></h1><p>Update the name shown across JKCREW or sign out.</p></div></div>
    <div class="profile-grid">
      <section class="panel profile-card">${avatarHtml(state.profile, "profile-avatar")}<h2>${escapeHtml(state.profile.display_name)}</h2><div class="status-chip">${escapeHtml(state.profile.role)} · level ${state.profile.level}</div><p class="subcopy" style="margin-top:16px">${escapeHtml(state.user.email)}</p></section>
      <section class="panel">
        <div class="panel-head"><div class="panel-title">Account settings</div></div>
        <form id="own-avatar-form" class="avatar-settings"><input id="own-avatar-file" name="avatar" type="file" accept="image/*" hidden><button class="secondary-btn" type="button" id="choose-own-avatar">Upload / change my picture</button><button class="danger-btn" type="button" id="remove-own-avatar">Remove picture</button></form>
        <div class="settings-divider"></div>
        ${state.profile.role === "athlete" ? `${showreelHtml(state.profile, true)}<div class="settings-divider"></div>` : ""}
        <form id="profile-form">
          <div class="field"><label for="profile-theme">Display mode</label><select id="profile-theme" name="appTheme"><option value="dark" ${normalizedTheme(state.profile.app_theme) === "dark" ? "selected" : ""}>Dark mode</option><option value="light" ${normalizedTheme(state.profile.app_theme) === "light" ? "selected" : ""}>Light mode</option></select></div>
          <div class="field"><label for="profile-name">Display name</label><input id="profile-name" name="displayName" required value="${escapeHtml(state.profile.display_name)}"></div>
          <div class="field"><label for="profile-phone">Phone number</label><input id="profile-phone" name="phone" type="tel" value="${escapeHtml(state.profile.phone || "")}" placeholder="Optional"></div>
          ${state.profile.role === "athlete" ? `
            <div class="two-col-form">
              <div class="field"><label for="profile-stance">Stance</label><select id="profile-stance" name="stance"><option value="">Not set</option><option value="regular" ${state.profile.stance === "regular" ? "selected" : ""}>Regular</option><option value="goofy" ${state.profile.stance === "goofy" ? "selected" : ""}>Goofy</option></select></div>
              <div class="field"><label for="profile-age">Age</label><input id="profile-age" name="age" type="number" min="3" max="99" value="${state.profile.age || ""}" placeholder="Age"></div>
            </div>
            <div class="field"><label for="profile-country">Country</label><select id="profile-country" name="countryCode">${countryOptionsHtml(state.profile.country_code || "")}</select></div>
            <div class="two-col-form">
              <div class="field"><label for="profile-spin-direction">Spin Direction</label><select id="profile-spin-direction" name="spinDirection"><option value="" ${!state.profile.spin_direction ? "selected" : ""}>Not set</option><option value="left" ${state.profile.spin_direction === "left" ? "selected" : ""}>Left spin</option><option value="right" ${state.profile.spin_direction === "right" ? "selected" : ""}>Right spin</option><option value="both" ${state.profile.spin_direction === "both" ? "selected" : ""}>Both ways</option><option value="not_sure" ${state.profile.spin_direction === "not_sure" ? "selected" : ""}>Not sure yet</option></select></div>
              <div class="field"><label for="profile-favourite-trick">Favourite Trick</label><input id="profile-favourite-trick" name="favouriteTrick" maxlength="120" value="${escapeHtml(state.profile.favourite_trick || "")}" placeholder="Barspin, flair, 360..."></div>
            </div>
            <div class="field"><label for="profile-sponsors">Sponsors</label><textarea id="profile-sponsors" name="sponsors" placeholder="One sponsor per line">${escapeHtml(state.profile.sponsors || "")}</textarea></div>
            <div class="field"><label for="profile-achievements">Achievements</label><textarea id="profile-achievements" name="achievements" placeholder="Competition wins, landed tricks, milestones...">${escapeHtml(state.profile.achievements || "")}</textarea></div>
            <div class="two-col-form">
              <div class="field"><label for="profile-instagram">Instagram</label><input id="profile-instagram" name="instagram" type="url" value="${escapeHtml(state.profile.social_links?.instagram || "")}" placeholder="https://instagram.com/..."></div>
              <div class="field"><label for="profile-tiktok">TikTok</label><input id="profile-tiktok" name="tiktok" type="url" value="${escapeHtml(state.profile.social_links?.tiktok || "")}" placeholder="https://tiktok.com/@..."></div>
            </div>
            <div class="two-col-form">
              <div class="field"><label for="profile-youtube">YouTube</label><input id="profile-youtube" name="youtube" type="url" value="${escapeHtml(state.profile.social_links?.youtube || "")}" placeholder="https://youtube.com/..."></div>
              <div class="field"><label for="profile-other">Other link</label><input id="profile-other" name="other" type="url" value="${escapeHtml(state.profile.social_links?.other || "")}" placeholder="Website or sponsor profile"></div>
            </div>
            <div class="badge-lock-note">Achievement badges are earned through training progress and cannot be edited by riders.</div>
          ` : ""}
          <button class="primary-btn wide" type="submit">Save profile</button>
        </form>
        <div class="settings-divider"></div>
        <form id="password-form">
          <div class="field"><label for="new-password">New password</label><input id="new-password" name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="At least 8 characters"></div>
          <div class="field"><label for="confirm-password">Confirm password</label><input id="confirm-password" name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required placeholder="Type it again"></div>
          <button class="secondary-btn wide" type="submit">Change password</button>
        </form>
        <div class="settings-divider"></div>
        <button class="danger-btn wide" id="sign-out">Sign out</button>
      </section>
    </div>
    ${coachPbSection}
    ${trainingHistorySection}
    ${state.profile.role === "athlete" ? `<section class="panel"><div class="panel-head"><div><div class="panel-title">Competition run planner</div><div class="panel-meta">Run planning now lives in Contests.</div></div></div><button class="primary-btn" type="button" id="open-contests-from-profile">Open Contests</button></section>` : ""}`;
  document.querySelector("#choose-own-avatar").addEventListener("click", () => document.querySelector("#own-avatar-file").click());
  document.querySelector("#own-avatar-file").addEventListener("change", updateOwnAvatar);
  document.querySelector("#remove-own-avatar").addEventListener("click", () => saveOwnAvatar(null));
  document.querySelector("#choose-showreel")?.addEventListener("click", () => document.querySelector("#showreel-file").click());
  document.querySelector("#showreel-file")?.addEventListener("change", addShowreelVideo);
  document.querySelectorAll("[data-remove-showreel]").forEach((button) => button.addEventListener("click", removeShowreelVideo));
  document.querySelector("#open-contests-from-profile")?.addEventListener("click", () => navigate("contests"));
  document.querySelector("#profile-theme")?.addEventListener("change", (event) => applyTheme(event.target.value));
  document.querySelector("#profile-form").addEventListener("submit", updateProfile);
  document.querySelector("#password-form").addEventListener("submit", updatePassword);
  document.querySelector("#coach-daily-pb-form")?.addEventListener("submit", saveCoachDailyPb);
  document.querySelector("#clear-daily-pb")?.addEventListener("click", clearCoachDailyPb);
  document.querySelector("#sign-out").addEventListener("click", () => client.auth.signOut());
}

async function updateOwnAvatar(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return notify("Choose an image under 8MB.", "error");
  try {
    const dataUrl = await imageFileToDataUrl(file);
    await saveOwnAvatar(dataUrl);
  } catch (_error) {
    notify("Could not read that image. Try another photo.", "error");
  }
}

async function saveOwnAvatar(dataUrl) {
  const avatar = dataUrl ? { dataUrl, updatedAt: new Date().toISOString() } : {};
  const { data, error } = await client.from("profiles").update({ avatar, updated_at: new Date().toISOString() }).eq("id", state.user.id).select().single();
  if (error) return notify(messageFrom(error), "error");
  state.profile = data;
  notify(dataUrl ? "Your profile picture was updated." : "Your profile picture was removed.");
  renderShell();
  navigate("profile");
}

async function saveOwnProfileMedia(update, message) {
  const { data, error } = await client.from("profiles").update({ ...update, updated_at: new Date().toISOString() }).eq("id", state.user.id).select().single();
  if (error) return notify(messageFrom(error), "error");
  state.profile = data;
  notify(message);
  renderShell();
  navigate("profile");
}

async function addShowreelVideo(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (file.size > SHOWREEL_MAX_BYTES) {
    event.currentTarget.value = "";
    return notify("Choose a showreel clip under 36MB. Short 30 second clips work best on phones.", "error");
  }
  const current = showreelVideos(state.profile);
  if (current.length >= 3) {
    event.currentTarget.value = "";
    return notify("You can add up to 3 showreel videos.", "error");
  }
  try {
    const duration = await videoDurationSeconds(file);
    if (duration > SHOWREEL_MAX_SECONDS + 0.5) {
      event.currentTarget.value = "";
      return notify("Showreel clips can be up to 30 seconds. Please trim this video and upload again.", "error");
    }
    const dataUrl = await fileToDataUrl(file);
    current.push({ id: crypto.randomUUID(), dataUrl, name: file.name, durationSeconds: Math.round(duration), addedAt: new Date().toISOString() });
    await saveOwnProfileMedia({ showreel_videos: current }, "Showreel video added.");
  } catch (_error) {
    notify("Could not read that video. Try another short clip.", "error");
  } finally {
    event.currentTarget.value = "";
  }
}

async function removeShowreelVideo(event) {
  const index = Number(event.currentTarget.dataset.removeShowreel);
  const videos = showreelVideos(state.profile).filter((_video, videoIndex) => videoIndex !== index);
  await saveOwnProfileMedia({ showreel_videos: videos }, "Showreel video removed.");
}

async function updateProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const displayName = form.get("displayName").trim();
  const updates = {
    display_name: displayName,
    phone: String(form.get("phone") || "").trim().slice(0, 40),
    app_theme: normalizedTheme(form.get("appTheme")),
    updated_at: new Date().toISOString(),
  };
  if (state.profile.role === "athlete") {
    const age = Number(form.get("age"));
    const countryCode = String(form.get("countryCode") || "");
    updates.stance = form.get("stance") || "";
    updates.spin_direction = form.get("spinDirection") || "";
    updates.favourite_trick = String(form.get("favouriteTrick") || "").trim().slice(0, 120);
    updates.age = Number.isFinite(age) && age > 0 ? age : null;
    updates.country_code = countryCode;
    updates.country_name = countryNameFromCode(countryCode);
    updates.sponsors = String(form.get("sponsors") || "").trim();
    updates.achievements = String(form.get("achievements") || "").trim();
    updates.social_links = {
      instagram: String(form.get("instagram") || "").trim(),
      tiktok: String(form.get("tiktok") || "").trim(),
      youtube: String(form.get("youtube") || "").trim(),
      other: String(form.get("other") || "").trim(),
    };
  }
  const { data, error } = await client.from("profiles").update(updates).eq("id", state.user.id).select().single();
  if (error) return notify(messageFrom(error), "error");
  state.profile = data;
  applyTheme(data.app_theme);
  notify("Profile updated.");
  renderShell();
  navigate("profile");
}

async function updatePassword(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = form.get("password");
  const confirmPassword = form.get("confirmPassword");
  if (password !== confirmPassword) return notify("Passwords do not match.", "error");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Changing...";
  const { error } = await client.auth.updateUser({ password });
  if (error) {
    button.disabled = false;
    button.textContent = "Change password";
    return notify(messageFrom(error), "error");
  }
  event.currentTarget.reset();
  button.disabled = false;
  button.textContent = "Change password";
  notify("Password changed.");
}

init().catch((error) => {
  renderBootRecovery(messageFrom(error));
  notify(messageFrom(error), "error");
});

installButton.addEventListener("click", installApp);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallButton();
  notify("JK Coaching installed. You can launch it from your apps.");
});
window.addEventListener("load", async () => {
  updateInstallButton();
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");
      await registration.update();
    } catch (error) {
      console.warn("JKCREW app launcher could not be registered.", error);
    }
  }
});
