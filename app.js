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
};

const athleteNav = [
  ["home", "Home"],
  ["session", "Session"],
  ["board", "Board"],
  ["profile", "Profile"],
];
const coachNav = [
  ["crew", "Students"],
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
const localDate = () => new Date().toLocaleDateString("en-CA");
const weekStartIso = () => {
  const date = new Date();
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
};
const weekStartDate = () => weekStartIso().slice(0, 10);
const weekLabel = () => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(new Date(weekStartIso()));
const messageFrom = (error) => error?.message || "Something went wrong. Please try again.";
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const isSafari = () => /safari/i.test(window.navigator.userAgent) && !/chrome|crios|android/i.test(window.navigator.userAgent);
const avatarUrl = (profile = {}) => profile.avatar?.dataUrl || "";
const firstName = (profile = {}) => String(profile.display_name || "This rider").split(/\s+/).filter(Boolean)[0] || "This rider";

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
  state.view = data.role === "coach" ? "crew" : "home";
  renderShell();
  navigate(state.view);
}

function renderAuth(mode = "login", message = "") {
  app.innerHTML = `
    <div class="auth-page">
      <section class="auth-hero">
        <div class="auth-logo">JK<span>CREW</span></div>
        <div class="hero-copy">
          <div class="eyebrow">JKCREW coaching academy</div>
          <h1>Crafting <em>champions,</em><br>creating futures.</h1>
          <p>Weekly trick plans, private progress tracking, and coach feedback built for serious BMX progression.</p>
        </div>
        <div class="feature-strip"><span>Weekly plans</span><span>Private progress</span><span>Coach feedback</span><span>Future focused</span></div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <div class="eyebrow">Welcome to JKCREW</div>
          <h2>${mode === "login" ? "Sign in" : "Join the crew"}</h2>
          <p class="subcopy">${mode === "login" ? "Pick up where you left off." : "Create your athlete or coach account."}</p>
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
              <select id="role" name="role"><option value="athlete">Athlete</option><option value="parent">Parent viewer</option><option value="coach">Coach</option></select>
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
  const nav = role === "coach" ? coachNav : role === "parent" ? parentNav : athleteNav;
  const navHtml = nav.map(([id, label]) => `<button class="nav-btn" data-view="${id}">${label}</button>`).join("");
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
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  setLoading();
  const renders = {
    home: state.profile?.role === "parent" ? renderParentHome : renderAthleteHome,
    session: renderSession,
    board: renderBoard,
    crew: renderCrew,
    student: renderStudentProfile,
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

const categoryInfo = {
  daily: { label: "Daily Tricks", description: "Same list all week · resets each day · full list = 1 point" },
  dialled: { label: "Dialled", description: "Tick each trick once landed · 2 points each" },
  one_bang: { label: "One Bangs", description: "Tick each trick once landed · 2 points each" },
  percentage: { label: "Percentage Tricks", description: "10 attempts · track landed percentage" },
};

const coachGroups = [
  ["monday", "Monday Team"],
  ["tuesday", "Tuesday Team"],
  ["wednesday", "Wednesday Team"],
  ["online", "Online Athletes"],
];

const dailyCompletionCount = (awards = []) => new Set(awards.filter((award) => award.award_key?.startsWith("daily:")).map((award) => award.award_key)).size;

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
  return assignments.map((assignment, index) => `
    <div class="list-row assignment-row ${isAssignmentComplete(assignment) ? "complete" : ""}">
      <button class="assignment-check" type="button" ${interactive && !isAssignmentComplete(assignment) ? `data-assignment-action="landed" data-assignment-id="${assignment.id}"` : "disabled"}>${isAssignmentComplete(assignment) ? "✓" : ""}</button>
      <div><strong>${escapeHtml(assignment.trick_name)}</strong><small>${escapeHtml(assignmentStatus(assignment))}${assignment.notes ? ` · ${escapeHtml(assignment.notes)}` : ""}</small></div>
    </div>`).join("");
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
    const coachReply = request.coach_comment || request.coach_video_data_url
      ? `<div class="coach-reply"><strong>Coach reply</strong>${request.coach_comment ? `<p>${escapeHtml(request.coach_comment)}</p>` : ""}${request.coach_video_data_url ? `<video class="help-video" src="${escapeHtml(request.coach_video_data_url)}" controls></video>` : ""}</div>`
      : `<div class="panel-meta">Waiting for coach reply</div>`;
    const coachTools = mode === "coach" ? `
      <form class="reply-form" data-help-reply="${request.id}">
        <div class="field"><label for="reply-${request.id}">Written feedback</label><textarea id="reply-${request.id}" name="comment" placeholder="What should they fix?">${escapeHtml(request.coach_comment || "")}</textarea></div>
        <div class="field"><label for="reply-video-${request.id}">Optional video reply</label><input id="reply-video-${request.id}" name="video" type="file" accept="video/*"></div>
        <button class="primary-btn" type="submit">Send coach reply</button>
      </form>` : "";
    return `<article class="help-card">
      <div class="help-card-head"><div><strong>${escapeHtml(request.question || "Trick help request")}</strong><small>${dateLabel(request.created_at)} · ${escapeHtml(request.status)}</small></div></div>
      ${request.video_data_url ? `<video class="help-video" src="${escapeHtml(request.video_data_url)}" controls></video>` : ""}
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

async function renderAthleteHome() {
  const [{ data: sessions, error }, leaderboard, schedule, helpRequests] = await Promise.all([
    client.from("training_sessions").select("*").eq("athlete_id", state.user.id).order("started_at", { ascending: false }).limit(12),
    getLeaderboard(),
    getWeeklyAssignments(state.user.id),
    getHelpRequests(state.user.id),
  ]);
  const { assignments, awards } = schedule;
  if (error) throw error;
  const weekly = sessions.filter((session) => new Date(session.started_at) >= new Date(weekStartIso()));
  const weeklyPoints = weekly.reduce((sum, session) => sum + session.total_points, 0);
  const totalPoints = sessions.reduce((sum, session) => sum + session.total_points, 0);
  const rank = leaderboard.findIndex((row) => row.athlete_id === state.user.id) + 1;
  const dailyDone = dailyCompletionCount(awards);
  const completedWeekly = assignments.filter((assignment) => assignment.category !== "daily" && isAssignmentComplete(assignment)).length;
  const weeklyTargets = assignments.filter((assignment) => assignment.category !== "daily").length;
  const activeSession = await getActiveSession();
  if (activeSession) {
    state.activeTraining = activeSession;
    state.trickStartedAt = new Date(activeSession.started_at).getTime();
  }

  document.querySelector("#view").innerHTML = `
    <section class="athlete-scoreboard panel">
      <div class="scoreboard-person">${avatarHtml(state.profile, "score-avatar")}<div><div class="eyebrow">Athlete dashboard</div><h1>${escapeHtml(state.profile.display_name)}</h1><p>Your points and trick progress for this week.</p></div></div>
      <div class="scoreboard-stats">
        ${statCard("This week", weeklyPoints, "pts", `${weekly.length} sessions`)}
        ${statCard("Daily Tricks", `${dailyDone}/7`, "", "Completed this week")}
        ${statCard("Weekly tricks", `${completedWeekly}/${weeklyTargets}`, "", "Dialled + One Bangs")}
        ${statCard("Crew rank", rank || "-", "", `${leaderboard.length || 0} riders`)}
      </div>
    </section>
    ${activeSession ? `<section class="session-hero compact-session-hero"><div><div class="timer-label">Session timer · Daily point needs 20:00 or less</div><div class="timer compact-timer" id="trick-timer">00:00</div></div><div class="score-guide"><span>Session total: ${activeSession.total_points} pts</span></div></section>` : `<div class="actions home-actions"><button class="primary-btn" id="start-session-home">Start session</button></div>`}
    <section class="panel"><div class="panel-head"><div><div class="panel-title">My trick list</div><div class="panel-meta">Private · week starting ${escapeHtml(weekLabel())}</div></div></div>${assignmentGroups(assignments, true)}</section>
    ${helpUploadSection(helpRequests)}`;
  document.querySelectorAll("[data-assignment-action]").forEach((button) => button.addEventListener("click", recordAssignmentAction));
  document.querySelectorAll("[data-percentage-action]").forEach((button) => button.addEventListener("click", recordPercentageAttempt));
  document.querySelector("#start-session-home")?.addEventListener("click", startSession);
  document.querySelector("#help-request-form").addEventListener("submit", submitHelpRequest);
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
  const { data: links, error } = await client.from("parent_athletes").select("athlete_id").eq("parent_id", state.user.id);
  if (error) throw error;
  const ids = (links || []).map((link) => link.athlete_id);
  if (!ids.length) {
    document.querySelector("#view").innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Parent viewer</div><h1>Linked <span>athletes</span></h1><p>Your coach has not linked a rider to this parent account yet.</p></div></div>
      <div class="empty">Ask the coach to link your parent account to your child's athlete profile.</div>`;
    return;
  }
  const { data: athletes, error: athleteError } = await client.from("profiles").select("*").in("id", ids).order("display_name");
  if (athleteError) throw athleteError;
  const cards = await Promise.all((athletes || []).map(async (athlete) => {
    const [{ assignments, awards }, helpRequests] = await Promise.all([
      getWeeklyAssignments(athlete.id),
      getHelpRequests(athlete.id),
    ]);
    const percent = weeklyCompletionPercent(assignments, awards);
    return `<section class="panel parent-child-card">
      <div class="scoreboard-person">${avatarHtml(athlete, "score-avatar")}<div><div class="eyebrow">Read-only parent view</div><h1>${escapeHtml(athlete.display_name)}</h1><p>${escapeHtml(athlete.display_name.split(" ")[0])} completed ${percent}% of this week's BMX program.</p></div></div>
      <div class="scoreboard-stats">${statCard("Weekly completion", `${percent}%`, "", "Program complete")}${statCard("Daily Tricks", `${dailyCompletionCount(awards)}/7`, "", "This week")}</div>
      <div class="weekly-notification">Weekly notification: ${escapeHtml(firstName(athlete))} completed ${percent}% of this week's BMX program.</div>
      <div class="parent-readonly">${assignmentGroups(assignments, false)}</div>
      <div class="settings-divider"></div>
      <div class="panel-title">Coach feedback</div>
      <div class="help-list">${helpRequestsHtml(helpRequests.filter((request) => request.coach_comment || request.coach_video_data_url), "parent")}</div>
    </section>`;
  }));
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Parent viewer</div><h1>Weekly <span>program</span></h1><p>Read-only progress for your linked athlete.</p></div></div>
    ${cards.join("")}`;
}

function leaderRow(row, index) {
  return `<div class="list-row leader-row ${row.athlete_id === state.user.id ? "me" : ""}">
    <div class="rank">#${index + 1}</div>
    <div class="person">${avatarHtml(row)}<div class="person-name"><strong>${escapeHtml(row.display_name)}</strong><small>Level ${row.level} · ${row.session_count} sessions</small></div></div>
    <div class="points">${row.weekly_points}<small> pts</small></div>
  </div>`;
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
  const { assignments } = await getWeeklyAssignments(state.user.id);
  await loadActiveSession();
  if (!state.activeTraining) {
    document.querySelector("#view").innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Private training plan</div><h1>Start a <span>session</span></h1><p>Your Daily Tricks stay the same all week and reset each day. Finish the full Daily list to earn its point.</p></div></div>
      <section class="panel"><div class="panel-head"><div><div class="panel-title">This week's schedule</div><div class="panel-meta">Only you and your coach can see this</div></div></div>${assignmentGroups(assignments)}</section>
      <section class="session-hero"><div class="timer-label">Ready when you are</div><div class="timer">GO</div><div class="score-guide"><span>Daily list = 1pt</span><span>One Bang = 2pt</span><span>Dialled = 2pt</span></div><div style="margin-top:24px"><button class="primary-btn" id="create-session">Start session</button></div></section>`;
    document.querySelector("#create-session").addEventListener("click", startSession);
    return;
  }
  state.trickStartedAt = new Date(state.activeTraining.started_at).getTime();
  const attemptsHtml = state.attempts.length ? state.attempts.map((attempt) => `
    <div class="list-row"><div><strong>${escapeHtml(attempt.trick_name)}</strong><small>${escapeHtml(attempt.category)} · ${formatTime(attempt.duration_seconds || 0)}</small></div><div class="points">+${attempt.points}</div></div>`).join("") : `<div class="empty">Your landed tricks will appear here.</div>`;
  document.querySelector("#view").innerHTML = `
    <section class="session-hero compact-session-hero"><div><div class="timer-label">Session time elapsed</div><div class="timer compact-timer" id="trick-timer">00:00</div></div><div class="score-guide"><span>Daily list = 1pt</span><span>One Bang = 2pt</span><span>Dialled = 2pt</span><span>Session total: ${state.activeTraining.total_points} pts</span></div></section>
    <div class="page-head"><div><div class="eyebrow">Session live</div><h1>Today's <span>plan</span></h1><p>Tap the circle next to each trick as you complete it.</p></div><div class="actions"><button class="danger-btn" id="end-session">End session</button></div></div>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Assigned schedule</div><div class="panel-meta">Week starting ${escapeHtml(weekLabel())}</div></div></div>${assignmentGroups(assignments, true)}</section>
    <section class="panel"><div class="panel-head"><div class="panel-title">This session</div><div class="panel-meta">${state.attempts.length} landed</div></div><div class="attempt-list">${attemptsHtml}</div></section>`;
  document.querySelector("#end-session").addEventListener("click", endSession);
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
  notify(`${result.message}${result.points_awarded ? ` · +${result.points_awarded} points` : ""}.`);
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
  const leaderboard = await getLeaderboard();
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">This week</div><h1>The <span>crew board</span></h1><p>Every landed trick moves the crew. The board resets its weekly view each Monday.</p></div></div>
    <section class="panel"><div class="panel-head"><div class="panel-title">Weekly rankings</div><div class="panel-meta">${leaderboard.length} riders</div></div><div class="leaderboard">${leaderboard.length ? leaderboard.map(leaderRow).join("") : `<div class="empty">No athlete scores yet.</div>`}</div></section>`;
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
  const linkedIds = new Set(roster.map((athlete) => athlete.id));
  const available = (allAthletes || []).filter((athlete) => !linkedIds.has(athlete.id));
  const groupsHtml = coachGroups.map(([groupId, label]) => {
    const athletes = roster.filter((athlete) => athlete.groupName === groupId);
    const students = athletes.length ? athletes.map((athlete) => `
      <button class="student-chip" draggable="true" data-athlete-id="${athlete.id}" data-open-student="${athlete.id}">
        ${avatarHtml(athlete, "student-chip-avatar")}
        <span>${escapeHtml(athlete.display_name)}</span>
      </button>`).join("") : `<div class="empty compact-empty">Drop students here.</div>`;
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

async function renderStudentProfile() {
  const roster = await getCoachRoster();
  if (!roster.length) {
    document.querySelector("#view").innerHTML = `<div class="page-head"><div><div class="eyebrow">Student profile</div><h1>No <span>students</span></h1><p>Add an athlete first, then you can set their weekly tricks.</p></div></div><div class="empty">No students linked yet.</div>`;
    return;
  }
  if (!state.selectedAthleteId || !roster.some((athlete) => athlete.id === state.selectedAthleteId)) state.selectedAthleteId = roster[0].id;
  const athlete = roster.find((entry) => entry.id === state.selectedAthleteId);
  const [schedule, { data: templates, error: templateError }, { data: parentLinks, error: parentLinkError }, { data: parentProfiles, error: parentProfileError }, helpRequests] = await Promise.all([
    getWeeklyAssignments(athlete.id),
    client.from("coach_schedule_templates").select("*").eq("coach_id", state.user.id).ilike("student_name", athlete.display_name).limit(1),
    client.from("parent_athletes").select("parent_id").eq("coach_id", state.user.id).eq("athlete_id", athlete.id),
    client.from("profiles").select("id, display_name, avatar").eq("role", "parent").order("display_name"),
    getHelpRequests(athlete.id),
  ]);
  const { assignments, awards } = schedule;
  if (templateError) throw templateError;
  if (parentLinkError) throw parentLinkError;
  if (parentProfileError) throw parentProfileError;
  const template = templates?.[0] || null;
  const linkedParentIds = new Set((parentLinks || []).map((link) => link.parent_id));
  const linkedParents = (parentProfiles || []).filter((parent) => linkedParentIds.has(parent.id));
  const availableParents = (parentProfiles || []).filter((parent) => !linkedParentIds.has(parent.id));
  const parentOptions = availableParents.map((parent) => `<option value="${parent.id}">${escapeHtml(parent.display_name)}</option>`).join("");
  const linkedParentsHtml = linkedParents.length ? linkedParents.map((parent) => `
    <div class="list-row parent-link-row"><div class="person">${avatarHtml(parent)}<div class="person-name"><strong>${escapeHtml(parent.display_name)}</strong><small>Read-only viewer</small></div></div><button class="danger-btn compact-btn" data-unlink-parent="${parent.id}">Unlink</button></div>
  `).join("") : `<div class="empty">No parent viewers linked yet.</div>`;
  const categoryEditor = Object.entries(categoryInfo).map(([category, info]) => {
    const assignmentText = assignments.filter((assignment) => assignment.category === category).map((assignment) => {
      const notes = assignment.notes ? ` - ${assignment.notes}` : "";
      return `${assignment.trick_name}${notes}`;
    }).join("\n");
    return `<div class="schedule-editor">
      <div class="schedule-editor-head"><div><div class="panel-title">${info.label}</div><div class="panel-meta">${info.description}</div></div><div class="category-count">${assignments.filter((assignment) => assignment.category === category).length}</div></div>
      <div class="field"><label for="assignment-${category}">One trick or line per row</label><textarea id="assignment-${category}" name="${category}" placeholder="Add ${info.label.toLowerCase()} here...">${escapeHtml(assignmentText)}</textarea></div>
    </div>`;
  }).join("");
  const dailyDone = dailyCompletionCount(awards);

  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Student profile</div><h1>${escapeHtml(athlete.display_name)} <span>L${athlete.level}</span></h1><p>Manage this athlete's picture, group, weekly tricks, and live progress.</p></div><div class="actions">${template ? `<button class="primary-btn" id="import-monday-plan">Load Monday plan</button>` : ""}<button class="secondary-btn" id="back-to-students">All students</button></div></div>
    <section class="panel athlete-profile-hero">
      ${avatarHtml(athlete, "profile-avatar-large")}
      <div><div class="panel-title">${escapeHtml(athlete.display_name)}</div><div class="panel-meta">${coachGroups.find(([id]) => id === athlete.groupName)?.[1] || "Monday Team"} · Daily Tricks completed this week: ${dailyDone}/7</div></div>
      <form id="avatar-form" class="avatar-form"><input id="avatar-file" name="avatar" type="file" accept="image/*" hidden><button class="secondary-btn" type="button" id="choose-avatar">Upload / change picture</button><button class="danger-btn" type="button" id="remove-avatar">Remove picture</button></form>
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Current weekly tricks</div><div class="panel-meta">Week starting ${escapeHtml(weekLabel())}</div></div></div>${assignmentGroups(assignments)}</section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Edit this week's schedule</div><div class="panel-meta">One trick or line per row · notes after a dash</div></div></div>
      <form id="assignment-form">${categoryEditor}<button class="primary-btn wide" type="submit">Save complete schedule</button></form>
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Parent viewer accounts</div><div class="panel-meta">Parents are read-only linked viewers, not athlete accounts</div></div></div>
      <div class="parent-links">${linkedParentsHtml}</div>
      ${availableParents.length ? `<form id="link-parent-form" class="trick-form parent-link-form"><div class="field"><label for="parent-id">Available parent accounts</label><select id="parent-id" name="parentId">${parentOptions}</select></div><button class="primary-btn" type="submit">Link parent</button></form>` : `<div class="empty compact-empty">No unlinked parent accounts available. Parents can create one from the sign-up screen.</div>`}
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Completion history</div><div class="panel-meta">Daily Tricks: ${dailyDone}/7 this week · ${assignments.filter((assignment) => assignment.category !== "daily" && isAssignmentComplete(assignment)).length} weekly tasks complete</div></div></div>
      ${assignmentGroups(assignments)}
    </section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Trick help videos</div><div class="panel-meta">Open rider submissions and reply with written or video feedback</div></div></div>
      <div class="help-list">${helpRequestsHtml(helpRequests, "coach")}</div>
    </section>`;
  document.querySelector("#back-to-students").addEventListener("click", () => navigate("crew"));
  document.querySelector("#import-monday-plan")?.addEventListener("click", () => importScheduleTemplate(template));
  document.querySelector("#assignment-form").addEventListener("submit", saveWeeklyAssignments);
  document.querySelector("#link-parent-form")?.addEventListener("submit", linkParentAccount);
  document.querySelectorAll("[data-unlink-parent]").forEach((button) => button.addEventListener("click", unlinkParentAccount));
  document.querySelectorAll("[data-help-reply]").forEach((form) => form.addEventListener("submit", replyToHelpRequest));
  document.querySelector("#choose-avatar").addEventListener("click", () => document.querySelector("#avatar-file").click());
  document.querySelector("#avatar-file").addEventListener("change", updateAthleteAvatar);
  document.querySelector("#remove-avatar").addEventListener("click", () => saveAthleteAvatar(null));
}

function parseAssignmentLine(line, index, category) {
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
    target_reps: targetReps,
    notes: note.slice(0, 500),
    sort_order: index,
  };
}

async function saveWeeklyAssignments(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const assignments = Object.keys(categoryInfo).flatMap((category, categoryIndex) => String(form.get(category) || "").split("\n")
    .slice(0, category === "percentage" ? 3 : undefined)
    .map((line, index) => parseAssignmentLine(line.trim(), (categoryIndex * 100) + index, category))
    .filter(Boolean));
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Saving...";

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
  const parentId = new FormData(event.currentTarget).get("parentId");
  const { error } = await client.from("parent_athletes").insert({
    parent_id: parentId,
    athlete_id: state.selectedAthleteId,
    coach_id: state.user.id,
  });
  if (error) return notify(messageFrom(error), "error");
  notify("Parent viewer linked to this athlete.");
  await renderStudentProfile();
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
        <form id="profile-form"><div class="field"><label for="profile-name">Display name</label><input id="profile-name" name="displayName" required value="${escapeHtml(state.profile.display_name)}"></div><button class="primary-btn wide" type="submit">Save profile</button></form>
        <div class="settings-divider"></div>
        <form id="password-form">
          <div class="field"><label for="new-password">New password</label><input id="new-password" name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="At least 8 characters"></div>
          <div class="field"><label for="confirm-password">Confirm password</label><input id="confirm-password" name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required placeholder="Type it again"></div>
          <button class="secondary-btn wide" type="submit">Change password</button>
        </form>
        <div class="settings-divider"></div>
        <button class="danger-btn wide" id="sign-out">Sign out</button>
      </section>
    </div>`;
  document.querySelector("#choose-own-avatar").addEventListener("click", () => document.querySelector("#own-avatar-file").click());
  document.querySelector("#own-avatar-file").addEventListener("change", updateOwnAvatar);
  document.querySelector("#remove-own-avatar").addEventListener("click", () => saveOwnAvatar(null));
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

async function updateProfile(event) {
  event.preventDefault();
  const displayName = new FormData(event.currentTarget).get("displayName").trim();
  const { data, error } = await client.from("profiles").update({ display_name: displayName, updated_at: new Date().toISOString() }).eq("id", state.user.id).select().single();
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
