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
  ["crew", "Crew"],
  ["board", "Board"],
  ["notes", "Notes"],
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
const weekStartIso = () => {
  const date = new Date();
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
};
const messageFrom = (error) => error?.message || "Something went wrong. Please try again.";
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const isSafari = () => /safari/i.test(window.navigator.userAgent) && !/chrome|crios|android/i.test(window.navigator.userAgent);

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
  const { data, error } = await client.from("profiles").select("*").eq("id", state.user.id).single();
  if (error) {
    renderAuth();
    notify("Your profile is still being prepared. Try signing in again.", "error");
    return;
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
          <div class="eyebrow">BMX progression, made visible</div>
          <h1>Ride.<br><em>Land.</em><br>Level up.</h1>
          <p>Track every session, turn landed tricks into points, climb the crew board, and keep coach feedback in one place.</p>
        </div>
        <div class="feature-strip"><span>Timed sessions</span><span>Live scoring</span><span>Coach notes</span><span>Crew leaderboard</span></div>
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
              <select id="role" name="role"><option value="athlete">Athlete</option><option value="coach">Coach</option></select>
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
  const nav = role === "coach" ? coachNav : athleteNav;
  const navHtml = nav.map(([id, label]) => `<button class="nav-btn" data-view="${id}">${label}</button>`).join("");
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">JK<span>CREW</span></div>
        <div class="role-pill">${escapeHtml(role)} account</div>
        <nav class="nav-list">${navHtml}</nav>
        <div class="sidebar-user"><strong>${escapeHtml(state.profile.display_name)}</strong><span>${escapeHtml(state.user.email)}</span></div>
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
    home: renderAthleteHome,
    session: renderSession,
    board: renderBoard,
    crew: renderCrew,
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

async function renderAthleteHome() {
  const [{ data: sessions, error }, leaderboard] = await Promise.all([
    client.from("training_sessions").select("*").eq("athlete_id", state.user.id).order("started_at", { ascending: false }).limit(12),
    getLeaderboard(),
  ]);
  if (error) throw error;
  const weekly = sessions.filter((session) => new Date(session.started_at) >= new Date(weekStartIso()));
  const weeklyPoints = weekly.reduce((sum, session) => sum + session.total_points, 0);
  const totalPoints = sessions.reduce((sum, session) => sum + session.total_points, 0);
  const rank = leaderboard.findIndex((row) => row.athlete_id === state.user.id) + 1;
  const recentHtml = sessions.length ? sessions.slice(0, 6).map((session) => `
    <div class="list-row"><div><strong>${session.ended_at ? "Completed session" : "Session in progress"}</strong><small>${dateLabel(session.started_at)}</small></div><div class="points">+${session.total_points}</div></div>`).join("") : `<div class="empty">No sessions yet. Start your first one.</div>`;
  const leadersHtml = leaderboard.length ? leaderboard.slice(0, 5).map((row, index) => leaderRow(row, index)) .join("") : `<div class="empty">The board is waiting for its first rider.</div>`;

  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Athlete dashboard</div><h1>Hey, <span>${escapeHtml(state.profile.display_name.split(" ")[0])}</span></h1><p>Your work lands here. Start a session, record tricks, and move up the crew board.</p></div><div class="actions"><button class="primary-btn" id="start-session-home">Start session</button></div></div>
    <section class="stats-grid">
      ${statCard("This week", weeklyPoints, "pts", `${weekly.length} sessions logged`)}
      ${statCard("Crew rank", rank || "-", "", `${leaderboard.length || 0} riders on board`)}
      ${statCard("Level", state.profile.level, "", "Keep stacking points")}
      ${statCard("All time", totalPoints, "pts", `${sessions.length} recent sessions`)}
    </section>
    <div class="two-col">
      <section class="panel"><div class="panel-head"><div class="panel-title">Recent sessions</div><div class="panel-meta">Latest activity</div></div><div class="session-list">${recentHtml}</div></section>
      <section class="panel"><div class="panel-head"><div class="panel-title">Crew board</div><button class="secondary-btn" data-go-board>Full board</button></div><div class="leaderboard">${leadersHtml}</div></section>
    </div>`;
  document.querySelector("#start-session-home").addEventListener("click", () => navigate("session"));
  document.querySelector("[data-go-board]").addEventListener("click", () => navigate("board"));
}

function statCard(label, value, unit, foot) {
  return `<article class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}${unit ? `<small>${escapeHtml(unit)}</small>` : ""}</div><div class="stat-foot">${escapeHtml(foot)}</div></article>`;
}

function leaderRow(row, index) {
  return `<div class="list-row leader-row ${row.athlete_id === state.user.id ? "me" : ""}">
    <div class="rank">#${index + 1}</div>
    <div class="person"><div class="avatar">${escapeHtml(initials(row.display_name))}</div><div class="person-name"><strong>${escapeHtml(row.display_name)}</strong><small>Level ${row.level} · ${row.session_count} sessions</small></div></div>
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

async function renderSession() {
  await loadActiveSession();
  if (!state.activeTraining) {
    document.querySelector("#view").innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Timed training</div><h1>Start a <span>session</span></h1><p>The clock starts when you do. Each landed trick scores from 1 to 5 points based on how quickly you land it.</p></div></div>
      <section class="session-hero"><div class="timer-label">Ready when you are</div><div class="timer">00:00</div><div class="score-guide"><span>&lt;3 min = 5pt</span><span>&lt;5 min = 4pt</span><span>&lt;7 min = 3pt</span><span>&lt;10 min = 2pt</span><span>10+ min = 1pt</span></div><div style="margin-top:24px"><button class="primary-btn" id="create-session">Start session</button></div></section>`;
    document.querySelector("#create-session").addEventListener("click", startSession);
    return;
  }
  state.trickStartedAt = Date.now();
  const attemptsHtml = state.attempts.length ? state.attempts.map((attempt) => `
    <div class="list-row"><div><strong>${escapeHtml(attempt.trick_name)}</strong><small>${escapeHtml(attempt.category)} · ${formatTime(attempt.duration_seconds || 0)}</small></div><div class="points">+${attempt.points}</div></div>`).join("") : `<div class="empty">Your landed tricks will appear here.</div>`;
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Session live</div><h1>Land the <span>next one</span></h1><p>The trick timer resets each time you record a landed trick.</p></div><div class="actions"><button class="danger-btn" id="end-session">End session</button></div></div>
    <section class="session-hero"><div class="timer-label">Current trick timer</div><div class="timer" id="trick-timer">00:00</div><div class="score-guide"><span>&lt;3 min = 5pt</span><span>&lt;5 min = 4pt</span><span>&lt;7 min = 3pt</span><span>&lt;10 min = 2pt</span><span>10+ min = 1pt</span></div></section>
    <section class="panel">
      <div class="panel-head"><div><div class="panel-title">Record landed trick</div><div class="panel-meta">Session total: ${state.activeTraining.total_points} pts</div></div></div>
      <form id="trick-form" class="trick-form">
        <div class="field"><label for="trick-name">Trick</label><input id="trick-name" name="trickName" required placeholder="e.g. Bunnyhop 180"></div>
        <div class="field"><label for="category">Category</label><select id="category" name="category"><option value="daily">Daily</option><option value="one_bang">One bang</option><option value="dialled">Dialled</option><option value="line">Line</option><option value="foam_pit">Foam pit</option></select></div>
        <button class="primary-btn" type="submit">Landed</button>
      </form>
    </section>
    <section class="panel"><div class="panel-head"><div class="panel-title">This session</div><div class="panel-meta">${state.attempts.length} landed</div></div><div class="attempt-list">${attemptsHtml}</div></section>`;
  document.querySelector("#trick-form").addEventListener("submit", recordTrick);
  document.querySelector("#end-session").addEventListener("click", endSession);
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
  const { data: links, error } = await client.from("coach_athletes").select("athlete_id").eq("coach_id", state.user.id);
  if (error) throw error;
  const ids = links.map((link) => link.athlete_id);
  if (!ids.length) return [];
  const [{ data: athletes, error: athleteError }, { data: sessions, error: sessionError }] = await Promise.all([
    client.from("profiles").select("*").in("id", ids).order("display_name"),
    client.from("training_sessions").select("*").in("athlete_id", ids).gte("started_at", weekStartIso()),
  ]);
  if (athleteError) throw athleteError;
  if (sessionError) throw sessionError;
  return athletes.map((athlete) => {
    const athleteSessions = sessions.filter((session) => session.athlete_id === athlete.id);
    return { ...athlete, weeklyPoints: athleteSessions.reduce((sum, session) => sum + session.total_points, 0), sessionCount: athleteSessions.length };
  });
}

async function renderCrew() {
  const [roster, { data: allAthletes, error }] = await Promise.all([
    getCoachRoster(),
    client.from("profiles").select("id, display_name, level").eq("role", "athlete").order("display_name"),
  ]);
  if (error) throw error;
  const linkedIds = new Set(roster.map((athlete) => athlete.id));
  const available = (allAthletes || []).filter((athlete) => !linkedIds.has(athlete.id));
  const rosterHtml = roster.length ? roster.map((athlete) => `
    <div class="list-row"><div class="person"><div class="avatar">${escapeHtml(initials(athlete.display_name))}</div><div class="person-name"><strong>${escapeHtml(athlete.display_name)}</strong><small>Level ${athlete.level} · ${athlete.sessionCount} sessions this week</small></div></div><div class="points">${athlete.weeklyPoints}<small> pts</small></div></div>`).join("") : `<div class="empty">No athletes linked yet. Add your first rider below.</div>`;
  const options = available.map((athlete) => `<option value="${athlete.id}">${escapeHtml(athlete.display_name)} · L${athlete.level}</option>`).join("");
  document.querySelector("#view").innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Coach dashboard</div><h1>Your <span>crew</span></h1><p>See the riders connected to you and track their weekly momentum.</p></div></div>
    <section class="stats-grid">${statCard("Athletes", roster.length, "", "Linked to your crew")}${statCard("Weekly points", roster.reduce((sum, athlete) => sum + athlete.weeklyPoints, 0), "pts", "Across your athletes")}${statCard("Sessions", roster.reduce((sum, athlete) => sum + athlete.sessionCount, 0), "", "Logged this week")}${statCard("Active", roster.filter((athlete) => athlete.sessionCount > 0).length, "", "Riders this week")}</section>
    <section class="panel"><div class="panel-head"><div class="panel-title">Crew roster</div><div class="panel-meta">${roster.length} athletes</div></div><div class="roster">${rosterHtml}</div></section>
    <section class="panel"><div class="panel-head"><div class="panel-title">Add an athlete</div><div class="panel-meta">They need an account first</div></div>
      ${available.length ? `<form id="add-athlete-form" class="trick-form"><div class="field"><label for="athlete-id">Available athletes</label><select id="athlete-id" name="athleteId">${options}</select></div><button class="primary-btn" type="submit">Add to crew</button></form>` : `<div class="empty">Every available athlete is already linked.</div>`}
    </section>`;
  document.querySelector("#add-athlete-form")?.addEventListener("submit", addAthlete);
}

async function addAthlete(event) {
  event.preventDefault();
  const athleteId = new FormData(event.currentTarget).get("athleteId");
  const { error } = await client.from("coach_athletes").insert({ coach_id: state.user.id, athlete_id: athleteId });
  if (error) return notify(messageFrom(error), "error");
  notify("Athlete added to your crew.");
  await renderCrew();
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
      <section class="panel profile-card"><div class="avatar profile-avatar">${escapeHtml(initials(state.profile.display_name))}</div><h2>${escapeHtml(state.profile.display_name)}</h2><div class="status-chip">${escapeHtml(state.profile.role)} · level ${state.profile.level}</div><p class="subcopy" style="margin-top:16px">${escapeHtml(state.user.email)}</p></section>
      <section class="panel"><div class="panel-head"><div class="panel-title">Account settings</div></div><form id="profile-form"><div class="field"><label for="profile-name">Display name</label><input id="profile-name" name="displayName" required value="${escapeHtml(state.profile.display_name)}"></div><button class="primary-btn wide" type="submit">Save profile</button></form><div style="height:10px"></div><button class="danger-btn wide" id="sign-out">Sign out</button></section>
    </div>`;
  document.querySelector("#profile-form").addEventListener("submit", updateProfile);
  document.querySelector("#sign-out").addEventListener("click", () => client.auth.signOut());
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
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.warn("JKCREW app launcher could not be registered.", error);
    }
  }
});
