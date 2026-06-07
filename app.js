const SUPABASE_URL = "https://soanwttlorlgdfrzbvtp.supabase.co";
const SUPABASE_KEY = "sb_publishable_Y93G0kTt_csEsNzDl9NFEA_0h5UElXh";
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
  sessionViewerSearch: "",
  sessionViewerOpenAthleteId: "",
  sessionViewerTimer: null,
  runBuilder: null,
  runPlaybackTimer: null,
  draggedRunPoint: null,
  draggedDailyId: null,
};

const athleteNav = [
  ["home", "Home"],
  ["session", "Session"],
  ["contests", "Contests"],
  ["board", "Board"],
  ["profile", "Profile"],
];
const coachNav = [
  ["command", "Command"],
  ["sessionViewer", "Session Viewer"],
  ["crew", "Students"],
  ["parents", "Parents"],
  ["board", "Board"],
  ["notes", "Notes"],
  ["profile", "Profile"],
];
const parentNav = [
  ["home", "Home"],
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
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
};
const weekStartIso = () => `${weekStartDate()}T00:00:00.000Z`;
const weekLabel = () => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Brisbane" }).format(new Date(`${weekStartDate()}T00:00:00+10:00`));
const messageFrom = (error) => error?.message || "Something went wrong. Please try again.";
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const isSafari = () => /safari/i.test(window.navigator.userAgent) && !/chrome|crios|android/i.test(window.navigator.userAgent);
const avatarUrl = (profile = {}) => profile.avatar?.dataUrl || "";
const firstName = (profile = {}) => String(profile.display_name || "This rider").split(/\s+/).filter(Boolean)[0] || "This rider";
const isCoachRole = (role) => ["coach", "admin"].includes(role);
const linesHtml = (value = "", emptyText = "Not added yet") => {
  const lines = String(value || "").split(/\n|,/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : `<p class="subcopy">${escapeHtml(emptyText)}</p>`;
};
const medalForRank = (row, index, total) => {
  if (index === 0 && Number(row.weekly_points || 0) > 0) return `<span class="rank-medal" title="Weekly leader">🏅</span>`;
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
    if (outcome === "accepted") notify("JKCREW is being installed.");
    return;
  }

  if (isIos()) {
    window.alert("To install JKCREW: tap the Share button, then choose Add to Home Screen.");
    return;
  }

  if (isSafari()) {
    window.alert("To install JKCREW in Safari: choose File, then Add to Dock.");
    return;
  }

  window.alert("To install JKCREW: open your browser menu and choose Install JKCREW or Add to Home Screen.");
}

function setLoading(label = "Loading") {
  const view = document.querySelector("#view");
  if (view) view.innerHTML = `<div class="loading">${escapeHtml(label)}...</div>`;
}

async function init() {
  const { data: { session } } = await client.auth.getSession();
  await handleSession(session);
  client.auth.onAuthStateChange(async (_event, nextSession) => {
    if (nextSession?.user?.id !== state.user?.id || !nextSession) await handleSession(nextSession);
  });
}

async function handleSession(session) {
  clearInterval(state.timer);
  state.session = session;
  state.user = session?.user || null;
  state.profile = null;
  state.activeTraining = null;
  state.attempts = [];
  if (!state.user) {
    renderAuth();
    return;
  }
  let { data, error } = await client.from("profiles").select("*").eq("id", state.user.id).maybeSingle();
  if (error || !data) {
    const { data: recovered, error: recoveryError } = await client.rpc("ensure_current_profile");
    if (recoveryError || !recovered) {
      renderAuth();
      notify("I could not load your JKCREW profile. Sign out and try once more.", "error");
      return;
    }
    data = recovered;
  }
  state.profile = data;
  state.view = isCoachRole(data.role) ? "command" : "home";
  renderShell();
  navigate(state.view);
}

function renderAuth(mode = "login", message = "") {
  app.innerHTML = `
    <div class="auth-page">
      <section class="auth-hero">
        <div class="auth-logo-lockup wordmark-lockup"><img src="icons/jkcoaching-wordmark.png?v=2.3.0" alt="JKCoaching logo"></div>
        <div class="hero-copy">
          <div class="eyebrow">JKCREW coaching academy</div>
          <h1>Crafting <em>champions,</em><br>shaping futures.</h1>
          <p>Weekly trick plans, private progress tracking, and coach feedback built for serious BMX progression.</p>
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
            <div class="auth-message">${escapeHtml(message)}</div>
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

  if (mode === "login") {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) renderAuth(mode, messageFrom(error));
    return;
  }

  const displayName = form.get("displayName").trim();
  const role = form.get("role");
  if (!displayName) {
    renderAuth(mode, "Please add a display name.");
    return;
  }
  const { data: signupData, error: signupError } = await client.functions.invoke("create-jkcrew-account", {
    body: { email, password, displayName, role, website: "" },
  });
  if (signupError || signupData?.error) {
    const signupMessage = signupData?.error || messageFrom(signupError);
    renderAuth(mode, signupMessage.includes("already") ? "An account with that email already exists. Try signing in." : signupMessage);
    return;
  }

  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    renderAuth("login", "Account created. Sign in with your new email and password.");
    return;
  }
  notify("Welcome to JKCREW. Your account is ready.");
}

function renderShell() {
  const role = state.profile.role;
  const nav = isCoachRole(role) ? coachNav : role === "parent" ? parentNav : athleteNav;
  const navIcons = { home: "⌂", session: "↗", contests: "🏆", crew: "✦", command: "◇", parents: "P", board: "#", profile: "●", notes: "✎" };
  const navHtml = nav.map(([id, label]) => `<button class="nav-btn" data-view="${id}"><span class="nav-icon">${navIcons[id] || "•"}</span><span>${label}</span></button>`).join("");
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">JK<span>CREW</span></div>
        <div class="role-pill">${escapeHtml(role)} account</div>
        <nav class="nav-list">${navHtml}</nav>
        <div class="sidebar-user">${avatarHtml(state.profile, "sidebar-avatar")}<strong>${escapeHtml(state.profile.display_name)}</strong><span>${escapeHtml(state.user.email)}</span></div>
      </aside>
      <div class="main-wrap">
        <header class="topbar">
          <div class="topbar-title"><span class="live-dot"></span>JKCREW live</div>
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
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  setLoading();
  const renders = {
    home: state.profile?.role === "parent" ? renderParentHome : renderAthleteHome,
    session: renderSession,
    command: renderCoachCommand,
    sessionViewer: renderSessionViewer,
    parents: renderParents,
    board: renderBoard,
    crew: isCoachRole(state.profile?.role) ? renderCrew : renderAthleteCrew,
    contests: renderContests,
    student: renderStudentProfile,
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

async function getLeaderboard() {
  const { data, error } = await client.rpc("get_weekly_leaderboard");
  if (error) throw error;
  return data || [];
}

async function getPublicAthleteProfile(athleteId) {
  const { data, error } = await client.rpc("get_public_athlete_profile", { p_athlete_id: athleteId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function getWeeklyAssignments(athleteId) {
  const [{ data, error }, { data: progress, error: progressError }, { data: awards, error: awardsError }, { data: percentageAttempts, error: percentageError }] = await Promise.all([
    client.from("weekly_trick_assignments").select("*").eq("athlete_id", athleteId).eq("week_start", weekStartDate()).order("sort_order", { ascending: true }),
    client.from("assignment_progress").select("*").eq("athlete_id", athleteId),
    client.from("assignment_point_awards").select("*").eq("athlete_id", athleteId).gte("created_at", weekStartIso()),
    client.from("percentage_attempts").select("*").eq("athlete_id", athleteId).order("attempt_number", { ascending: true }),
  ]);
  if (error) throw error;
  if (progressError) throw progressError;
  if (awardsError) throw awardsError;
  if (percentageError) throw percentageError;
  const progressById = new Map((progress || []).map((entry) => [entry.assignment_id, entry]));
  const attemptsById = new Map();
  (percentageAttempts || []).forEach((attempt) => {
    const entries = attemptsById.get(attempt.assignment_id) || [];
    entries.push(attempt);
    attemptsById.set(attempt.assignment_id, entries);
  });
  return {
    assignments: (data || []).filter((assignment) => categoryInfo[assignment.category]).map((assignment) => ({ ...assignment, progress: progressById.get(assignment.id) || null, percentageAttempts: attemptsById.get(assignment.id) || [] })),
    awards: awards || [],
    percentageAttempts: percentageAttempts || [],
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
  const [calendar, statusRows, dashboardItems, sessions, scheduleRows, awards, attendanceSessions] = await Promise.all([
    client.from("coach_calendar_events").select("*").eq("coach_id", state.user.id).gte("starts_at", new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString()).order("starts_at").limit(30),
    ids.length ? client.from("athlete_coach_status").select("*").eq("coach_id", state.user.id).in("athlete_id", ids) : { data: [], error: null },
    ids.length ? client.from("dashboard_items").select("*").in("owner_id", ids).gte("due_at", new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()).order("due_at", { ascending: true, nullsFirst: false }).limit(40) : { data: [], error: null },
    ids.length ? client.from("training_sessions").select("*").in("athlete_id", ids).gte("started_at", since).order("started_at", { ascending: false }) : { data: [], error: null },
    ids.length ? client.from("weekly_trick_assignments").select("id, athlete_id, category").in("athlete_id", ids).eq("week_start", weekStartDate()) : { data: [], error: null },
    ids.length ? client.from("assignment_point_awards").select("*").in("athlete_id", ids).gte("created_at", weekStartIso()) : { data: [], error: null },
    client.from("attendance_sessions").select("*, attendance_records(*)").eq("coach_id", state.user.id).order("session_date", { ascending: false }).limit(8),
  ]);
  [calendar, statusRows, dashboardItems, sessions, scheduleRows, awards, attendanceSessions].forEach((result) => { if (result.error) throw result.error; });
  return {
    calendar: calendar.data || [],
    statuses: statusRows.data || [],
    dashboardItems: dashboardItems.data || [],
    sessions: sessions.data || [],
    scheduleRows: scheduleRows.data || [],
    awards: awards.data || [],
    attendanceSessions: attendanceSessions.data || [],
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
    .eq("post_type", "leaderboard")
    .order("created_at", { ascending: true })
    .limit(60);
  if (error) throw error;
  const postIds = (posts || []).map((post) => post.id);
  const { data: reactions, error: reactionError } = postIds.length
    ? await client.from("crew_post_reactions").select("*").in("post_id", postIds)
    : { data: [], error: null };
  if (reactionError) throw reactionError;
  const reactionsByPost = (reactions || []).reduce((map, reaction) => {
    const list = map.get(reaction.post_id) || [];
    list.push(reaction);
    map.set(reaction.post_id, list);
    return map;
  }, new Map());
  return (posts || []).map((post) => ({ ...post, reactions: reactionsByPost.get(post.id) || [] }));
}

const boardReactionEmojis = ["🔥", "💪", "😂", "👏", "❤️", "🚲"];

const categoryInfo = {
  daily: { label: "Daily Tricks", description: "Same list all week · resets each day · full list = 1 point" },
  dialled: { label: "Dialled", description: "Tick each trick once landed · 2 points each" },
  one_bang: { label: "One Bangs", description: "Tick each trick once landed · 2 points each" },
  percentage: { label: "Percentage Tricks", description: "10 attempts · track landed percentage" },
  foam_pit: { label: "Foam Pit", description: "Practice only · no points awarded" },
};

const coachGroups = [
  ["monday", "Monday Team"],
  ["tuesday", "Tuesday Team"],
  ["wednesday", "Wednesday Team"],
  ["online", "Online Athletes"],
  ["private", "Private Lessons"],
  ["elite", "Elite Team"],
  ["beginner", "Beginner Team"],
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

function bindVenueSelector() {
  document.querySelector("#session-venue")?.addEventListener("change", (event) => {
    state.selectedVenue = event.target.value;
    renderSession();
  });
}

function bindDailyReorder() {
  let draggedId = "";
  document.querySelectorAll("[data-daily-row]").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      draggedId = row.dataset.dailyRow;
      event.dataTransfer.setData("text/plain", draggedId);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      row.classList.add("drag-over-row");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over-row"));
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      row.classList.remove("drag-over-row");
      const fromId = event.dataTransfer.getData("text/plain") || draggedId;
      const toId = row.dataset.dailyRow;
      if (!fromId || !toId || fromId === toId) return;
      await saveDailyDisplayOrder(fromId, toId);
    });
    row.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      state.draggedDailyId = row.dataset.dailyRow;
      row.classList.add("dragging");
      document.addEventListener("pointerup", finishDailyPointerReorder, { once: true });
    });
  });
}

async function finishDailyPointerReorder(event) {
  const fromId = state.draggedDailyId;
  document.querySelectorAll("[data-daily-row]").forEach((row) => row.classList.remove("dragging", "drag-over-row"));
  state.draggedDailyId = null;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-daily-row]");
  const toId = target?.dataset.dailyRow;
  if (!fromId || !toId || fromId === toId) return;
  await saveDailyDisplayOrder(fromId, toId);
}

async function saveDailyDisplayOrder(fromId, toId) {
  const rows = [...document.querySelectorAll("[data-daily-row]")].map((row) => row.dataset.dailyRow);
  const fromIndex = rows.indexOf(fromId);
  const toIndex = rows.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) return;
  rows.splice(toIndex, 0, rows.splice(fromIndex, 1)[0]);
  const dailyOrder = { ...(state.profile.daily_trick_order || {}), [dailyOrderKey(state.selectedVenue)]: rows };
  const { data, error } = await client.from("profiles").update({ daily_trick_order: dailyOrder, updated_at: new Date().toISOString() }).eq("id", state.user.id).select().single();
  if (error) return notify(messageFrom(error), "error");
  state.profile = data;
  notify("Daily Tricks order saved.");
  await renderSession();
}

function percentageSummary(assignment) {
  const attempts = assignment.percentageAttempts || [];
  const landed = attempts.filter((attempt) => attempt.landed).length;
  const percentage = attempts.length ? Math.round((landed / attempts.length) * 100) : 0;
  return { attempts: attempts.length, landed, missed: attempts.length - landed, percentage, complete: attempts.length >= 10 };
}

function percentageClass(value) {
  if (value < 50) return "result-red";
  if (value <= 70) return "result-yellow";
  return "result-green";
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
    return `
    <div class="list-row assignment-row ${isAssignmentComplete(assignment) ? "complete" : ""}" ${draggable ? `draggable="true" data-daily-row="${assignment.id}"` : ""}>
      <button class="assignment-check" type="button" aria-label="${label}" title="${label}" ${interactive ? `data-assignment-action="${action}" data-assignment-id="${assignment.id}"` : "disabled"}>${complete ? "✓" : ""}</button>
      <div><strong>${escapeHtml(assignment.trick_name)}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</div>
    </div>`;
  }).join("");
}

function percentageAssignmentList(assignments, emptyText = "No Percentage Tricks assigned.", interactive = false) {
  if (!assignments.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return assignments.map((assignment) => {
    const summary = percentageSummary(assignment);
    const attempts = Array.from({ length: 10 }, (_, index) => {
      const attempt = assignment.percentageAttempts?.[index];
      const label = attempt ? (attempt.landed ? "✓" : "×") : index + 1;
      const klass = attempt ? (attempt.landed ? "landed" : "missed") : "";
      return `<span class="attempt-dot ${klass}">${label}</span>`;
    }).join("");
    const result = summary.attempts ? `<span class="percentage-result ${percentageClass(summary.percentage)}">${summary.percentage}%</span>` : `<span class="percentage-result">0%</span>`;
    const controls = interactive && !summary.complete ? `<div class="percentage-actions"><button class="primary-btn compact-btn" data-percentage-action="true" data-assignment-id="${assignment.id}">Tick landed</button><button class="danger-btn compact-btn" data-percentage-action="false" data-assignment-id="${assignment.id}">X missed</button></div>` : "";
    return `<div class="percentage-card">
      <div class="percentage-card-head"><div><strong>${escapeHtml(assignment.trick_name)}</strong><small>${summary.landed} landed · ${summary.missed} missed · ${summary.attempts}/10 attempts</small></div>${result}</div>
      <div class="attempt-dots">${attempts}</div>
      ${controls}
    </div>`;
  }).join("");
}

function assignmentGroups(assignments, interactive = false) {
  return Object.entries(categoryInfo).map(([category, info]) => {
    const items = assignments.filter((assignment) => assignment.category === category);
    const list = category === "percentage"
      ? percentageAssignmentList(items, `No ${info.label.toLowerCase()} assigned.`, interactive)
      : assignmentList(items, `No ${info.label.toLowerCase()} assigned.`, interactive);
    return `<section class="assignment-group">
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
      <div>${heatChip(status.heat_status || "on_track")}<small>${escapeHtml(coachGroupLabel(athlete.groupName))} · ${escapeHtml(status.training_focus || "No focus set")}</small><p>${escapeHtml(alert)}</p></div>
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

function showreelHtml(profile = {}, editable = false) {
  const videos = showreelVideos(profile);
  const videoHtml = videos.length ? videos.map((video, index) => `
    <div class="showreel-tile">
      <video src="${escapeHtml(video.dataUrl)}" autoplay muted loop playsinline controls></video>
      ${editable ? `<button class="danger-btn compact-btn" type="button" data-remove-showreel="${index}">Remove</button>` : ""}
    </div>`).join("") : `<div class="empty compact-empty">No showreel videos yet.</div>`;
  return `<section class="panel showreel-panel">
    <div class="panel-head"><div><div class="panel-title">Showreel</div><div class="panel-meta">2-3 short BMX highlight clips</div></div></div>
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

async function renderAthleteHome() {
  const [{ data: sessions, error }, leaderboard, schedule, dashboardItems] = await Promise.all([
    client.from("training_sessions").select("*").eq("athlete_id", state.user.id).order("started_at", { ascending: false }).limit(12),
    getLeaderboard(),
    getWeeklyAssignments(state.user.id),
    getDashboardItems(state.user.id),
  ]);
  const { assignments, awards } = schedule;
  if (error) throw error;
  const weekly = sessions.filter((session) => new Date(session.started_at) >= new Date(weekStartIso()));
  const weeklyPoints = weekly.reduce((sum, session) => sum + session.total_points, 0);
  const totalPoints = sessions.reduce((sum, session) => sum + session.total_points, 0);
  const rank = leaderboard.findIndex((row) => row.athlete_id === state.user.id) + 1;
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
    ${activeSession ? `<section class="session-hero compact-session-hero"><div><div class="timer-label">Session timer · Daily point needs 20:00 or less</div><div class="timer compact-timer" id="trick-timer">00:00</div></div><div class="score-guide"><span>Session total: ${activeSession.total_points} pts</span></div></section>` : ""}
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
    const [{ assignments, awards }, helpRequests, dashboardItems, sessions, runs] = await Promise.all([
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

function leaderRow(row, index, rows = []) {
  const total = rows.length;
  const badge = medalForRank(row, index, total);
  const badges = earnedBadges(row.earned_badges).slice(0, 4).map((earned) => `<span title="${escapeHtml(earned.label)}">${escapeHtml(earned.icon)}</span>`).join("");
  return `<button class="list-row leader-row ${row.athlete_id === state.user.id ? "me" : ""}" type="button" data-public-athlete="${row.athlete_id}">
    <div class="rank">#${index + 1}</div>
    <div class="person">${avatarHtml(row)}<div class="person-name"><strong>${escapeHtml(row.display_name)} ${badge}</strong><small>Level ${row.level} · ${row.session_count} sessions</small>${badges ? `<div class="leader-badges">${badges}</div>` : ""}</div></div>
    <div class="points">${row.weekly_points}<small> pts</small></div>
  </button>`;
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
  const [{ assignments }, helpRequests] = await Promise.all([
    getWeeklyAssignments(state.user.id),
    getHelpRequests(state.user.id),
  ]);
  const selectedVenue = selectedVenueFor(assignments);
  const sessionAssignments = assignmentsForVenue(assignments, selectedVenue);
  await loadActiveSession();
  if (!state.activeTraining) {
    document.querySelector("#view").innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Private training plan</div><h1>Start a <span>session</span></h1><p>Your Daily Tricks stay the same all week and reset each day. Finish the full Daily list to earn its point.</p></div></div>
      ${venueSelectorHtml(assignments)}
      <section class="session-start-card">
        <div><div class="timer-label">Ready at ${escapeHtml(venueLabel(selectedVenue))}</div><div class="go-mark">GO</div><p>Start the live timer when you are chasing Daily Tricks points.</p></div>
        <button class="primary-btn start-session-btn" id="create-session">Start Session</button>
      </section>
      <section class="panel"><div class="panel-head"><div><div class="panel-title">This week's schedule</div><div class="panel-meta">Showing ${escapeHtml(venueLabel(selectedVenue))} Daily Tricks · timed Daily points need a live session</div></div></div>${assignmentGroups(sessionAssignments, true)}</section>
      ${extraTricksSection(state.profile, true)}
      ${helpUploadSection(helpRequests)}`;
    bindVenueSelector();
    bindExtraTrickActions();
    bindDailyReorder();
    document.querySelector("#create-session").addEventListener("click", startSession);
    document.querySelector("#help-request-form").addEventListener("submit", submitHelpRequest);
    document.querySelectorAll("[data-assignment-action]").forEach((button) => button.addEventListener("click", recordAssignmentAction));
    document.querySelectorAll("[data-percentage-action]").forEach((button) => button.addEventListener("click", recordPercentageAttempt));
    return;
  }
  state.trickStartedAt = new Date(state.activeTraining.started_at).getTime();
  const attemptsHtml = state.attempts.length ? state.attempts.map((attempt) => `
    <div class="list-row"><div><strong>${escapeHtml(attempt.trick_name)}</strong><small>${escapeHtml(attempt.category)} · ${formatTime(attempt.duration_seconds || 0)}</small></div><div class="points">+${attempt.points}</div></div>`).join("") : `<div class="empty">Your landed tricks will appear here.</div>`;
  document.querySelector("#view").innerHTML = `
    <section class="session-hero compact-session-hero"><div><div class="timer-label">Session time elapsed</div><div class="timer compact-timer" id="trick-timer">00:00</div></div><div class="score-guide"><span>Daily list = 1pt</span><span>One Bang = 2pt</span><span>Dialled = 2pt</span><span>Session total: ${state.activeTraining.total_points} pts</span></div></section>
    <div class="page-head"><div><div class="eyebrow">Session live</div><h1>Today's <span>plan</span></h1><p>Tap the circle next to each trick as you complete it.</p></div><div class="actions"><button class="danger-btn" id="end-session">End session</button></div></div>
    ${venueSelectorHtml(assignments)}
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Assigned schedule</div><div class="panel-meta">${escapeHtml(venueLabel(selectedVenue))} Daily Tricks · Week starting ${escapeHtml(weekLabel())}</div></div></div>${assignmentGroups(sessionAssignments, true)}</section>
    ${extraTricksSection(state.profile, true)}
    <section class="panel"><div class="panel-head"><div class="panel-title">This session</div><div class="panel-meta">${state.attempts.length} landed</div></div><div class="attempt-list">${attemptsHtml}</div></section>
    ${helpUploadSection(helpRequests)}`;
  bindVenueSelector();
  bindExtraTrickActions();
  bindDailyReorder();
  document.querySelector("#end-session").addEventListener("click", endSession);
  document.querySelector("#help-request-form").addEventListener("submit", submitHelpRequest);
  document.querySelectorAll("[data-assignment-action]").forEach((button) => button.addEventListener("click", recordAssignmentAction));
  document.querySelectorAll("[data-percentage-action]").forEach((button) => button.addEventListener("click", recordPercentageAttempt));
  updateTimer();
  state.timer = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const element = document.querySelector("#trick-timer");
  if (element) element.textContent = formatTime(Math.floor((Date.now() - state.trickStartedAt) / 1000));
}

async function startSession() {
  const { error } = await client.from("training_sessions").insert({ athlete_id: state.user.id });
  if (error) return notify(messageFrom(error), "error");
  notify("Session started. Go land something.");
  await renderSession();
}

async function recordAssignmentAction(event) {
  const button = event.currentTarget;
  button.disabled = true;
  const { data, error } = await client.rpc("record_assignment_action", {
    p_assignment_id: button.dataset.assignmentId,
    p_action: button.dataset.assignmentAction,
  });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  const pointsNote = result.points_awarded ? ` · +${result.points_awarded} points` : result.points_removed ? ` · -${result.points_removed} points` : "";
  const message = `${result.message}${pointsNote}.`;
  if (result.category === "daily" && result.points_awarded > 0) celebrate(message);
  else notify(message);
  if (state.view === "home") await renderAthleteHome();
  else await renderSession();
}

async function recordPercentageAttempt(event) {
  const button = event.currentTarget;
  button.disabled = true;
  const { data, error } = await client.rpc("record_percentage_attempt", {
    p_assignment_id: button.dataset.assignmentId,
    p_landed: button.dataset.percentageAction === "true",
  });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  notify(`Percentage attempt saved: ${result.percentage}%.`);
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
  const [leaderboard, boardChat] = await Promise.all([getLeaderboard(), getBoardChat()]);
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">This week</div><h1>The <span>crew board</span></h1><p>Every landed trick moves the crew. The board resets its weekly view each Monday.</p></div></div>
    <section class="panel"><div class="panel-head"><div class="panel-title">Weekly rankings</div><div class="panel-meta">${leaderboard.length} riders</div></div><div class="leaderboard">${leaderboard.length ? leaderboard.map(leaderRow).join("") : `<div class="empty">No athlete scores yet.</div>`}</div></section>
    <section class="panel board-chat-panel">
      <div class="panel-head"><div><div class="panel-title">Rider chat</div><div class="panel-meta">Team-only text chat · no DMs, photos, videos or files</div></div></div>
      <div class="board-chat-list">${boardChat.length ? boardChat.map(boardChatMessageHtml).join("") : `<div class="empty compact-empty">No rider chat yet. Start with a positive message.</div>`}</div>
      ${state.profile?.role === "athlete" ? `<form id="board-chat-form" class="crew-post-form crew-chat-compose board-chat-compose"><textarea id="board-message" name="body" required maxlength="300" rows="1" placeholder="Encourage the crew..."></textarea><button class="primary-btn" type="submit">Send</button></form>` : `<div class="empty compact-empty">Rider chat is read-only for coach/parent accounts.</div>`}
    </section>`;
  document.querySelectorAll("[data-public-athlete]").forEach((button) => button.addEventListener("click", openPublicAthleteProfile));
  document.querySelector("#board-chat-form")?.addEventListener("submit", submitBoardChat);
  document.querySelectorAll("[data-board-reaction]").forEach((button) => button.addEventListener("click", toggleBoardReaction));
}

function boardChatMessageHtml(post) {
  const author = post.profiles || {};
  const reactionsByEmoji = post.reactions.reduce((map, reaction) => {
    const list = map.get(reaction.reaction) || [];
    list.push(reaction.user_id);
    map.set(reaction.reaction, list);
    return map;
  }, new Map());
  const reactionHtml = boardReactionEmojis.map((emoji) => {
    const users = reactionsByEmoji.get(emoji) || [];
    const active = users.includes(state.user?.id);
    return `<button class="reaction-btn ${active ? "active" : ""}" type="button" data-board-reaction="${emoji}" data-post-id="${post.id}" aria-label="React ${emoji}">${emoji}${users.length ? `<span>${users.length}</span>` : ""}</button>`;
  }).join("");
  return `<article class="board-chat-message">
    ${avatarHtml({ display_name: author.display_name || "Rider", avatar: author.avatar })}
    <div class="board-chat-bubble"><div class="chat-line-meta"><strong>${escapeHtml(author.display_name || "Rider")}</strong><small>${dateLabel(post.created_at)}</small></div><p>${escapeHtml(post.body)}</p><div class="reaction-row">${reactionHtml}</div></div>
  </article>`;
}

async function submitBoardChat(event) {
  event.preventDefault();
  if (state.profile?.role !== "athlete") return notify("Only riders can post in rider chat.", "error");
  const formElement = event.currentTarget;
  const body = String(new FormData(formElement).get("body") || "").trim();
  if (!body) return notify("Write a message first.", "error");
  const button = formElement.querySelector("button");
  button.disabled = true;
  button.textContent = "Sending...";
  const { error } = await client.from("crew_posts").insert({ author_id: state.user.id, body, post_type: "leaderboard" });
  if (error) {
    button.disabled = false;
    button.textContent = "Send";
    return notify(messageFrom(error), "error");
  }
  notify("Message posted.");
  await renderBoard();
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

async function renderPublicAthleteProfile() {
  if (!state.publicAthleteId) return navigate("board");
  const profile = await getPublicAthleteProfile(state.publicAthleteId);
  if (!profile) {
    document.querySelector("#view").innerHTML = `<div class="empty">Could not find that rider profile.</div>`;
    return;
  }
  const badges = earnedBadges(profile.badges);
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
      ${statCard("Stance", profile.stance || "-", "", "Goofy or regular")}
      ${statCard("Spin", spinDirectionLabels[profile.spin_direction] || "-", "", "Natural direction")}
      ${statCard("Favourite trick", profile.favourite_trick || "-", "", "Rider pick")}
      ${statCard("Age", profile.age || "-", "", "Rider age")}
    </section>
    <section class="panel public-profile-details">
      <div class="public-detail"><div class="panel-title">Sponsors</div>${linesHtml(profile.sponsors, "No sponsors added yet.")}</div>
      <div class="public-detail"><div class="panel-title">Achievements</div>${linesHtml(profile.achievements, "No achievements added yet.")}</div>
    </section>`;
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
  const { error } = await client.from("crew_posts").insert({ author_id: state.user.id, body, post_type: "chat" });
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
  const recentSessions = commandData.sessions.slice(0, 5);
  const sessionRows = recentSessions.length ? recentSessions.map((session) => {
    const athlete = roster.find((entry) => entry.id === session.athlete_id);
    return `<div class="list-row"><div><strong>${escapeHtml(athlete?.display_name || "Rider")}</strong><small>${dateLabel(session.started_at)} · ${session.ended_at ? "finished" : "live"} · ${Number(session.total_points || 0)} pts</small></div><span class="points">${session.ended_at ? "done" : "live"}</span></div>`;
  }).join("") : `<div class="empty compact-empty">No recent sessions recorded.</div>`;
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Coach command centre</div><h1>JKCoaching <span>HQ</span></h1><p>Calendar, rider heat map, attendance, reimbursements, and athlete alerts in one coach-only area.</p></div></div>
    <section class="stats-grid">
      ${statCard("Students", roster.length, "", "In your crew")}
      ${statCard("Need attention", attentionCount, "", "Auto flags")}
      ${statCard("Upcoming", upcoming, "", "Grouped events")}
      ${statCard("Modified", injuredCount, "", "Injured / modified")}
    </section>
    <section class="coach-tools-row">
      <button class="coach-tool-card" data-view="sessionViewer"><strong>Session Viewer</strong><small>Open iPad group checklist</small></button>
      <button class="coach-tool-card" data-view="crew"><strong>Students</strong><small>Groups, profiles, programs</small></button>
      <button class="coach-tool-card" data-view="board"><strong>Leaderboard</strong><small>Rankings and rider chat</small></button>
      <button class="coach-tool-card" data-view="notes"><strong>Coach Notes</strong><small>Private records and planning</small></button>
    </section>
    <section class="coach-command-grid clean-command-grid">
      <section class="panel command-calendar"><div class="panel-head"><div><div class="panel-title">Upcoming events & contests</div><div class="panel-meta">Grouped by event, date and venue</div></div></div>${calendarItemsHtml(groupedCalendar, roster)}</section>
      <section class="panel command-overview"><div class="panel-head"><div><div class="panel-title">Athlete activity & heat map</div><div class="panel-meta">Quick scan for support, injuries and comp prep</div></div></div><div class="overview-list">${athleteOverviewHtml(roster, commandData)}</div></section>
    </section>
    <section class="coach-command-grid clean-command-grid">
      <section class="panel"><div class="panel-head"><div><div class="panel-title">Session management</div><div class="panel-meta">Recent activity plus the live group viewer</div></div><button class="secondary-btn compact-btn" data-view="sessionViewer">Open viewer</button></div><div class="attempt-list">${sessionRows}</div></section>
      <section class="panel"><div class="panel-head"><div><div class="panel-title">Coach tools</div><div class="panel-meta">Add events and save attendance when needed</div></div></div><details class="coach-tool-details"><summary>Add coach calendar event</summary>${coachCalendarForm(roster)}</details><details class="coach-tool-details"><summary>Attendance & reimbursements</summary>${attendanceForm(roster)}<div class="settings-divider"></div>${attendanceHistoryHtml(commandData.attendanceSessions)}</details></section>
    </section>`;
  document.querySelector("#coach-calendar-form").addEventListener("submit", saveCoachCalendarEvent);
  document.querySelector("#attendance-form")?.addEventListener("submit", saveAttendanceSession);
  document.querySelectorAll(".heat-form").forEach((form) => form.addEventListener("submit", saveHeatStatus));
  document.querySelectorAll(".coach-tool-card[data-view], .panel-head [data-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  document.querySelectorAll("[data-open-student]").forEach((button) => button.addEventListener("click", () => {
    state.selectedAthleteId = button.dataset.openStudent;
    navigate("student");
  }));
}

async function renderSessionViewer() {
  if (state.sessionViewerTimer) {
    clearInterval(state.sessionViewerTimer);
    state.sessionViewerTimer = null;
  }
  const roster = await getCoachRoster();
  if (state.view !== "sessionViewer") return;
  if (!isCoachRole(state.profile?.role)) return navigate("home");
  if (!roster.length) {
    document.querySelector("#view").innerHTML = `<div class="page-head"><div><div class="eyebrow">Coach tool</div><h1>Session <span>Viewer</span></h1><p>Add students first, then you can manage group Daily Tricks from here.</p></div></div><div class="empty">No students linked yet.</div>`;
    return;
  }
  const groupOptions = coachGroups.map(([id, label]) => `<option value="${id}" ${state.sessionViewerGroup === id ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const search = state.sessionViewerSearch.toLowerCase().trim();
  const groupRoster = roster.filter((athlete) => athlete.groupName === state.sessionViewerGroup);
  const filteredRoster = groupRoster.filter((athlete) => !search || athlete.display_name.toLowerCase().includes(search));
  if (!state.sessionViewerOpenAthleteId || !filteredRoster.some((athlete) => athlete.id === state.sessionViewerOpenAthleteId)) {
    state.sessionViewerOpenAthleteId = filteredRoster[0]?.id || "";
  }
  const schedules = await Promise.all(filteredRoster.map(async (athlete) => {
    const { assignments } = await getWeeklyAssignments(athlete.id);
    const daily = assignments.filter((assignment) => assignment.category === "daily");
    const selectedVenue = dailyVenues(daily)[0] || "";
    const visibleDaily = assignmentsForVenue(daily, selectedVenue);
    return { athlete, daily: visibleDaily, venue: selectedVenue };
  }));
  if (state.view !== "sessionViewer") return;
  const openSchedule = schedules.find((entry) => entry.athlete.id === state.sessionViewerOpenAthleteId);
  const cards = schedules.length ? schedules.map(({ athlete, daily, venue }) => {
    const complete = daily.filter(isAssignmentComplete).length;
    const percent = daily.length ? Math.round((complete / daily.length) * 100) : 0;
    return `<button class="viewer-rider-card ${athlete.id === state.sessionViewerOpenAthleteId ? "active" : ""}" type="button" data-viewer-athlete="${athlete.id}">
      <div class="viewer-card-head">${avatarHtml(athlete, "student-chip-avatar")}<div><strong>${escapeHtml(athlete.display_name)}</strong><small>${escapeHtml(venueLabel(venue))} · ${complete}/${daily.length} complete</small></div></div>
      <div class="viewer-progress"><span style="width:${percent}%"></span></div>
    </button>`;
  }).join("") : `<div class="empty compact-empty">No riders match this group/search.</div>`;
  const openList = openSchedule ? sessionViewerDailyList(openSchedule) : `<div class="empty">Choose a rider to view their Daily Tricks.</div>`;
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Coach tool</div><h1>Session <span>Viewer</span></h1><p>Open this on an iPad, choose a group, and tick Daily Tricks for multiple riders from one screen.</p></div><button class="secondary-btn" id="viewer-refresh">Refresh</button></div>
    <section class="panel session-viewer-controls">
      <div class="field"><label for="viewer-group">Group/session</label><select id="viewer-group">${groupOptions}</select></div>
      <div class="field"><label for="viewer-search">Find rider</label><input id="viewer-search" value="${escapeHtml(state.sessionViewerSearch)}" placeholder="Search rider name"></div>
    </section>
    <section class="session-viewer-layout">
      <div class="viewer-rider-grid">${cards}</div>
      <section class="panel viewer-detail-panel">${openList}</section>
    </section>`;
  bindSessionViewerActions();
  state.sessionViewerTimer = setInterval(() => {
    if (state.view === "sessionViewer") renderSessionViewer();
  }, 7000);
}

function sessionViewerDailyList(entry) {
  const { athlete, daily, venue } = entry;
  const complete = daily.filter(isAssignmentComplete).length;
  const list = daily.length ? daily.map((assignment) => {
    const done = isAssignmentComplete(assignment);
    return `<button class="viewer-trick-row ${done ? "complete" : ""}" type="button" data-viewer-assignment-action="${done ? "unlanded" : "landed"}" data-assignment-id="${assignment.id}">
      <span class="assignment-check">${done ? "✓" : ""}</span>
      <span><strong>${escapeHtml(assignment.trick_name)}</strong>${assignment.notes ? `<small>${escapeHtml(assignment.notes)}</small>` : ""}</span>
    </button>`;
  }).join("") : `<div class="empty compact-empty">No Daily Tricks assigned for this venue.</div>`;
  return `<div class="viewer-detail-head">${avatarHtml(athlete, "student-chip-avatar")}<div><div class="panel-title">${escapeHtml(athlete.display_name)}</div><div class="panel-meta">${escapeHtml(venueLabel(venue))} Daily Tricks · ${complete}/${daily.length} complete today</div></div></div><div class="viewer-trick-list">${list}</div>`;
}

function bindSessionViewerActions() {
  document.querySelector("#viewer-refresh")?.addEventListener("click", () => renderSessionViewer());
  document.querySelector("#viewer-group")?.addEventListener("change", (event) => {
    state.sessionViewerGroup = event.target.value;
    state.sessionViewerOpenAthleteId = "";
    renderSessionViewer();
  });
  document.querySelector("#viewer-search")?.addEventListener("input", (event) => {
    state.sessionViewerSearch = event.target.value;
    clearTimeout(state.sessionViewerSearchTimer);
    state.sessionViewerSearchTimer = setTimeout(() => renderSessionViewer(), 250);
  });
  document.querySelectorAll("[data-viewer-athlete]").forEach((button) => button.addEventListener("click", () => {
    state.sessionViewerOpenAthleteId = button.dataset.viewerAthlete;
    renderSessionViewer();
  }));
  document.querySelectorAll("[data-viewer-assignment-action]").forEach((button) => button.addEventListener("click", recordViewerAssignmentAction));
}

async function recordViewerAssignmentAction(event) {
  const button = event.currentTarget;
  button.disabled = true;
  const { data, error } = await client.rpc("record_assignment_action", {
    p_assignment_id: button.dataset.assignmentId,
    p_action: button.dataset.viewerAssignmentAction,
  });
  if (error) {
    button.disabled = false;
    return notify(messageFrom(error), "error");
  }
  const result = Array.isArray(data) ? data[0] : data;
  notify(result.message || "Daily Tricks progress updated.");
  await renderSessionViewer();
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
  const [{ data: athletes, error: athleteError }, { data: sessions, error: sessionError }] = await Promise.all([
    client.from("profiles").select("*").in("id", ids).order("display_name"),
    client.from("training_sessions").select("*").in("athlete_id", ids).gte("started_at", weekStartIso()),
  ]);
  if (athleteError) throw athleteError;
  if (sessionError) throw sessionError;
  const groupByAthlete = new Map(links.map((link) => [link.athlete_id, link.group_name || "monday"]));
  return athletes.map((athlete) => {
    const athleteSessions = sessions.filter((session) => session.athlete_id === athlete.id);
    return { ...athlete, groupName: groupByAthlete.get(athlete.id) || "monday", weeklyPoints: athleteSessions.reduce((sum, session) => sum + session.total_points, 0), sessionCount: athleteSessions.length };
  });
}

async function renderCrew() {
  const [roster, { data: allAthletes, error }] = await Promise.all([
    getCoachRoster(),
    client.from("profiles").select("id, display_name, level, avatar").eq("role", "athlete").order("display_name"),
  ]);
  if (error) throw error;
  const commandData = roster.length ? await getCoachCommandData(roster) : { statuses: [] };
  const statuses = statusByAthlete(commandData.statuses);
  const linkedIds = new Set(roster.map((athlete) => athlete.id));
  const available = (allAthletes || []).filter((athlete) => !linkedIds.has(athlete.id));
  const groupsHtml = coachGroups.map(([groupId, label]) => {
    const athletes = roster.filter((athlete) => athlete.groupName === groupId);
    const students = athletes.length ? athletes.map((athlete) => {
      const status = statuses.get(athlete.id) || {};
      return `
      <button class="student-chip" draggable="true" data-athlete-id="${athlete.id}" data-open-student="${athlete.id}">
        ${avatarHtml(athlete, "student-chip-avatar")}
        <span><strong>${escapeHtml(athlete.display_name)}</strong><small>${heatChip(status.heat_status || "on_track")} ${escapeHtml(status.training_focus || "No focus set")}</small></span>
      </button>`;
    }).join("") : `<div class="empty compact-empty">Drop students here.</div>`;
    return `<section class="group-column" data-group="${groupId}"><div class="group-head"><div><div class="panel-title">${label}</div><div class="panel-meta">${athletes.length} student${athletes.length === 1 ? "" : "s"}</div></div></div><div class="group-list">${students}</div></section>`;
  }).join("");
  const options = available.map((athlete) => `<option value="${athlete.id}">${escapeHtml(athlete.display_name)} · L${athlete.level}</option>`).join("");
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Coach dashboard</div><h1>Training <span>groups</span></h1><p>Drag students between groups, or click a student to open their profile.</p></div></div>
    <section class="stats-grid single-stat">${statCard("Total students", roster.length, "", "Assigned to your crew")}</section>
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
      if (athleteId) await moveAthleteGroup(athleteId, group.dataset.group);
    });
  });
}

async function moveAthleteGroup(athleteId, groupName) {
  const { error } = await client.from("coach_athletes").update({ group_name: groupName }).eq("coach_id", state.user.id).eq("athlete_id", athleteId);
  if (error) return notify(messageFrom(error), "error");
  notify("Student moved.");
  await renderCrew();
}

async function renderParents() {
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
  const athleteOptions = roster.map((athlete) => `<option value="${athlete.id}">${escapeHtml(athlete.display_name)} · ${escapeHtml(coachGroupLabel(athlete.groupName))}</option>`).join("");
  const grouped = coachGroups.map(([groupId, label]) => {
    const athletes = roster.filter((athlete) => athlete.groupName === groupId);
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
    const linkedChildren = parentLinks.length ? parentLinks.map((link) => {
      const athlete = athleteById.get(link.athlete_id);
      if (!athlete) return "";
      return `<span class="public-badge">${escapeHtml(athlete.display_name)}${link.relationship ? ` · ${escapeHtml(link.relationship)}` : ""}<button class="inline-remove" type="button" data-unlink-parent-global="${parent.id}" data-unlink-athlete-global="${athlete.id}" aria-label="Unlink ${escapeHtml(parent.display_name)} from ${escapeHtml(athlete.display_name)}">×</button></span>`;
    }).filter(Boolean).join("") : `<span class="public-badge muted-badge">Unlinked</span>`;
    return `<article class="parent-admin-card ${parentLinks.length ? "linked" : "unlinked"}">
      <div class="person">${avatarHtml(parent, "student-chip-avatar")}<div class="person-name"><strong>${escapeHtml(parent.display_name)}</strong><small>${escapeHtml(parent.email || "No email saved")}${parent.phone ? ` · ${escapeHtml(parent.phone)}` : ""}</small><small>Joined ${dateLabel(parent.created_at)}</small></div></div>
      <div class="parent-status-row"><span class="status-chip">${parentLinks.length ? "linked" : "unlinked"}</span><div class="parent-child-badges">${linkedChildren}</div></div>
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
    <section class="panel"><div class="panel-head"><div><div class="panel-title">All parent accounts</div><div class="panel-meta">Name, email, phone, linked riders, status and date joined</div></div></div><div class="parent-admin-list">${parentRows}</div></section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Parents by training group</div><div class="panel-meta">Quick scan by Monday, Tuesday, Wednesday and online groups</div></div></div><div class="groups-grid">${grouped}</div></section>`;
  document.querySelector("#parent-admin-link-form")?.addEventListener("submit", linkParentFromAdmin);
  document.querySelectorAll("[data-unlink-parent-global]").forEach((button) => button.addEventListener("click", unlinkParentFromAdmin));
  document.querySelectorAll("[data-open-student]").forEach((button) => button.addEventListener("click", () => {
    state.selectedAthleteId = button.dataset.openStudent;
    navigate("student");
  }));
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
  notify("Student profile created and added to your crew.");
  state.selectedAthleteId = data.userId;
  await navigate("student");
}

async function addAthlete(event) {
  event.preventDefault();
  const athleteId = new FormData(event.currentTarget).get("athleteId");
  const { error } = await client.from("coach_athletes").insert({ coach_id: state.user.id, athlete_id: athleteId });
  if (error) return notify(messageFrom(error), "error");
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
  const [schedule, { data: templates, error: templateError }, { data: parentLinks, error: parentLinkError }, { data: parentProfiles, error: parentProfileError }, helpRequests, dashboardItems, coachVenues, privateData] = await Promise.all([
    getWeeklyAssignments(athlete.id),
    client.from("coach_schedule_templates").select("*").eq("coach_id", state.user.id).ilike("student_name", athlete.display_name).limit(1),
    client.from("parent_athletes").select("parent_id, relationship, created_at").eq("coach_id", state.user.id).eq("athlete_id", athlete.id),
    client.from("profiles").select("id, display_name, email, phone, avatar, created_at").eq("role", "parent").order("display_name"),
    getHelpRequests(athlete.id),
    getDashboardItems(athlete.id),
    getCoachVenues(),
    getStudentPrivateData(athlete.id),
  ]);
  const { assignments, awards } = schedule;
  if (templateError) throw templateError;
  if (parentLinkError) throw parentLinkError;
  if (parentProfileError) throw parentProfileError;
  const template = templates?.[0] || null;
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
  const dailyVenueEditors = venueNames.map((venue, venueIndex) => {
    const assignmentText = assignments.filter((assignment) => assignment.category === "daily" && venueLabel(assignment.venue) === venue).map((assignment) => {
      const notes = assignment.notes ? ` - ${assignment.notes}` : "";
      return `${assignment.trick_name}${notes}`;
    }).join("\n");
    return `<div class="schedule-editor">
      <div class="schedule-editor-head"><div><div class="panel-title">${escapeHtml(venue)} Daily Tricks</div><div class="panel-meta">Venue-specific list for ${escapeHtml(venue)}</div></div><div class="category-count">${assignments.filter((assignment) => assignment.category === "daily" && venueLabel(assignment.venue) === venue).length}</div></div>
      <div class="two-col-form venue-name-row">
        <div class="field"><label for="daily-venue-name-${venueIndex}">Venue name</label><input id="daily-venue-name-${venueIndex}" name="dailyVenueName:${venueIndex}" value="${escapeHtml(venue)}" placeholder="Skate park name"></div>
        <div class="field"><label for="assignment-daily-${venueIndex}">Daily tricks for this venue</label><textarea id="assignment-daily-${venueIndex}" name="dailyVenueTricks:${venueIndex}" placeholder="Add daily tricks here...">${escapeHtml(assignmentText)}</textarea></div>
      </div>
    </div>`;
  }).join("");
  const customVenueEditor = `<div class="schedule-editor custom-venue-editor">
    <div class="schedule-editor-head"><div><div class="panel-title">Custom Venue Daily Tricks</div><div class="panel-meta">Add another skate park if this rider trains somewhere else</div></div></div>
    <div class="two-col-form">
      <div class="field"><label for="custom-daily-venue">Venue name</label><input id="custom-daily-venue" name="customDailyVenue" placeholder="New skate park name"></div>
      <div class="field"><label for="custom-daily-list">Daily tricks</label><textarea id="custom-daily-list" name="customDaily" placeholder="One trick per line"></textarea></div>
    </div>
  </div>`;
  const otherCategoryEditor = Object.entries(categoryInfo).filter(([category]) => category !== "daily").map(([category, info]) => {
    const assignmentText = assignments.filter((assignment) => assignment.category === category).map((assignment) => {
      const notes = assignment.notes ? ` - ${assignment.notes}` : "";
      return `${assignment.trick_name}${notes}`;
    }).join("\n");
    return `<div class="schedule-editor">
      <div class="schedule-editor-head"><div><div class="panel-title">${info.label}</div><div class="panel-meta">${info.description}</div></div><div class="category-count">${assignments.filter((assignment) => assignment.category === category).length}</div></div>
      <div class="field"><label for="assignment-${category}">One trick or line per row</label><textarea id="assignment-${category}" name="${category}" placeholder="Add ${info.label.toLowerCase()} here...">${escapeHtml(assignmentText)}</textarea></div>
    </div>`;
  }).join("");
  const categoryEditor = `<div class="venue-editor-grid">${dailyVenueEditors}${customVenueEditor}</div>${otherCategoryEditor}`;
  const dailyDone = dailyCompletionCount(awards);

  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Student profile</div><h1>${escapeHtml(athlete.display_name)} <span>L${athlete.level}</span></h1><p>Manage this athlete's picture, group, weekly tricks, and live progress.</p></div><div class="actions">${template ? `<button class="primary-btn" id="import-monday-plan">Load Monday plan</button>` : ""}<button class="secondary-btn" id="back-to-students">All students</button></div></div>
    <section class="panel athlete-profile-hero">
      ${avatarHtml(athlete, "profile-avatar-large")}
      <div><div class="panel-title">${escapeHtml(athlete.display_name)}</div><div class="panel-meta">${coachGroups.find(([id]) => id === athlete.groupName)?.[1] || "Monday Team"} · Daily Tricks completed this week: ${dailyDone}/7 · ${escapeHtml(spinDirectionLabels[athlete.spin_direction] || "Spin not set")}${athlete.favourite_trick ? ` · Favourite: ${escapeHtml(athlete.favourite_trick)}` : ""}</div></div>
      <form id="avatar-form" class="avatar-form"><input id="avatar-file" name="avatar" type="file" accept="image/*" hidden><button class="secondary-btn" type="button" id="choose-avatar">Upload / change picture</button><button class="danger-btn" type="button" id="remove-avatar">Remove picture</button></form>
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Rider profile details</div><div class="panel-meta">Visible on their public rider profile</div></div></div>
      <form id="coach-athlete-profile-form" class="two-col-form">
        <div class="field"><label for="coach-athlete-spin">Spin Direction</label><select id="coach-athlete-spin" name="spinDirection"><option value="" ${!athlete.spin_direction ? "selected" : ""}>Not set</option><option value="left" ${athlete.spin_direction === "left" ? "selected" : ""}>Left spin</option><option value="right" ${athlete.spin_direction === "right" ? "selected" : ""}>Right spin</option><option value="both" ${athlete.spin_direction === "both" ? "selected" : ""}>Both ways</option><option value="not_sure" ${athlete.spin_direction === "not_sure" ? "selected" : ""}>Not sure yet</option></select></div>
        <div class="field"><label for="coach-athlete-favourite">Favourite Trick</label><input id="coach-athlete-favourite" name="favouriteTrick" maxlength="120" value="${escapeHtml(athlete.favourite_trick || "")}" placeholder="Favourite BMX trick"></div>
        <button class="primary-btn" type="submit">Save rider details</button>
      </form>
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Current weekly tricks</div><div class="panel-meta">Week starting ${escapeHtml(weekLabel())}</div></div></div>${assignmentGroups(assignments)}</section>
    ${extraTricksSection(athlete, false)}
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Edit this week's schedule</div><div class="panel-meta">One trick or line per row · notes after a dash</div></div></div>
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
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Trick help videos</div><div class="panel-meta">Open rider submissions and reply with written or video feedback</div></div></div>
      <div class="help-list">${helpRequestsHtml(helpRequests, "coach")}</div>
    </section>
    <section class="panel danger-zone"><div class="panel-head"><div><div class="panel-title">Delete student account</div><div class="panel-meta">Removes this rider from JKCREW, including their login and saved app data.</div></div></div>
      <button class="danger-btn wide" id="delete-student-account" type="button">Delete ${escapeHtml(athlete.display_name)}</button>
    </section>`;
  document.querySelector("#back-to-students").addEventListener("click", () => navigate("crew"));
  document.querySelector("#import-monday-plan")?.addEventListener("click", () => importScheduleTemplate(template));
  document.querySelector("#assignment-form").addEventListener("submit", saveWeeklyAssignments);
  document.querySelector("#coach-athlete-profile-form").addEventListener("submit", saveCoachAthleteProfile);
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
  const dailyVenueRows = dailyVenueRowsFromForm(form);
  const dailyAssignments = dailyVenueRows.flatMap((row, venueIndex) => String(row.tricks || "").split("\n")
    .map((line, index) => parseAssignmentLine(line.trim(), (venueIndex * 100) + index, "daily", row.name))
    .filter(Boolean));
  const otherAssignments = Object.keys(categoryInfo).filter((category) => category !== "daily").flatMap((category, categoryIndex) => String(form.get(category) || "").split("\n")
    .slice(0, category === "percentage" ? 3 : undefined)
    .map((line, index) => parseAssignmentLine(line.trim(), 1000 + (categoryIndex * 100) + index, category))
    .filter(Boolean));
  const assignments = [...dailyAssignments, ...otherAssignments];
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Saving...";

  try {
    await saveCoachVenueNames(dailyVenueRows);
  } catch (error) {
    notify(messageFrom(error), "error");
    return renderStudentProfile();
  }

  const { error: deleteError } = await client
    .from("weekly_trick_assignments")
    .delete()
    .eq("coach_id", state.user.id)
    .eq("athlete_id", state.selectedAthleteId)
    .eq("week_start", weekStartDate());
  if (deleteError) {
    notify(messageFrom(deleteError), "error");
    return renderStudentProfile();
  }

  if (assignments.length) {
    const { error: insertError } = await client.from("weekly_trick_assignments").insert(assignments);
    if (insertError) {
      notify(messageFrom(insertError), "error");
      return renderStudentProfile();
    }
  }

  notify("Weekly schedule saved for this student.");
  await renderStudentProfile();
}

async function saveCoachAthleteProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const { error } = await client.from("profiles").update({
    spin_direction: form.get("spinDirection") || "",
    favourite_trick: String(form.get("favouriteTrick") || "").trim().slice(0, 120),
    updated_at: new Date().toISOString(),
  }).eq("id", state.selectedAthleteId);
  if (error) return notify(messageFrom(error), "error");
  notify("Rider profile details saved.");
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
    .filter(Boolean));
  const { error: deleteError } = await client.from("weekly_trick_assignments").delete()
    .eq("coach_id", state.user.id).eq("athlete_id", state.selectedAthleteId).eq("week_start", weekStartDate());
  if (deleteError) return notify(messageFrom(deleteError), "error");
  if (assignments.length) {
    const { error } = await client.from("weekly_trick_assignments").insert(assignments);
    if (error) return notify(messageFrom(error), "error");
  }
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
    const { error } = await client.from("trick_help_requests")
      .update(update)
      .eq("id", formElement.dataset.helpReply)
      .eq("coach_id", state.user.id);
    if (error) throw error;
    notify("Coach feedback sent to rider.");
    await renderStudentProfile();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Send coach reply";
    notify(messageFrom(error), "error");
  }
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

async function renderProfile() {
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
          <div class="field"><label for="profile-name">Display name</label><input id="profile-name" name="displayName" required value="${escapeHtml(state.profile.display_name)}"></div>
          <div class="field"><label for="profile-phone">Phone number</label><input id="profile-phone" name="phone" type="tel" value="${escapeHtml(state.profile.phone || "")}" placeholder="Optional"></div>
          ${state.profile.role === "athlete" ? `
            <div class="two-col-form">
              <div class="field"><label for="profile-stance">Stance</label><select id="profile-stance" name="stance"><option value="">Not set</option><option value="regular" ${state.profile.stance === "regular" ? "selected" : ""}>Regular</option><option value="goofy" ${state.profile.stance === "goofy" ? "selected" : ""}>Goofy</option></select></div>
              <div class="field"><label for="profile-age">Age</label><input id="profile-age" name="age" type="number" min="3" max="99" value="${state.profile.age || ""}" placeholder="Age"></div>
            </div>
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
    ${state.profile.role === "athlete" ? `<section class="panel"><div class="panel-head"><div><div class="panel-title">Competition run planner</div><div class="panel-meta">Run planning now lives in Contests.</div></div></div><button class="primary-btn" type="button" id="open-contests-from-profile">Open Contests</button></section>` : ""}`;
  document.querySelector("#choose-own-avatar").addEventListener("click", () => document.querySelector("#own-avatar-file").click());
  document.querySelector("#own-avatar-file").addEventListener("change", updateOwnAvatar);
  document.querySelector("#remove-own-avatar").addEventListener("click", () => saveOwnAvatar(null));
  document.querySelector("#choose-showreel")?.addEventListener("click", () => document.querySelector("#showreel-file").click());
  document.querySelector("#showreel-file")?.addEventListener("change", addShowreelVideo);
  document.querySelectorAll("[data-remove-showreel]").forEach((button) => button.addEventListener("click", removeShowreelVideo));
  document.querySelector("#open-contests-from-profile")?.addEventListener("click", () => navigate("contests"));
  document.querySelector("#profile-form").addEventListener("submit", updateProfile);
  document.querySelector("#password-form").addEventListener("submit", updatePassword);
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
  if (file.size > 18 * 1024 * 1024) return notify("Choose a short video under 18MB.", "error");
  const current = showreelVideos(state.profile);
  if (current.length >= 3) return notify("You can add up to 3 showreel videos.", "error");
  try {
    const dataUrl = await fileToDataUrl(file);
    current.push({ id: crypto.randomUUID(), dataUrl, name: file.name, addedAt: new Date().toISOString() });
    await saveOwnProfileMedia({ showreel_videos: current }, "Showreel video added.");
  } catch (_error) {
    notify("Could not read that video. Try another short clip.", "error");
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
    updated_at: new Date().toISOString(),
  };
  if (state.profile.role === "athlete") {
    const age = Number(form.get("age"));
    updates.stance = form.get("stance") || "";
    updates.spin_direction = form.get("spinDirection") || "";
    updates.favourite_trick = String(form.get("favouriteTrick") || "").trim().slice(0, 120);
    updates.age = Number.isFinite(age) && age > 0 ? age : null;
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
  app.innerHTML = `<div class="boot-screen"><div class="brand-mark">JK<span>CREW</span></div><p>Could not load the app.</p></div>`;
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
  notify("JKCREW installed. You can launch it from your apps.");
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
