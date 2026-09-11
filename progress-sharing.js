/* JKCrew private progress and user-initiated image sharing.
 * Loaded before app.js; state/client are accessed only when an action runs.
 * Public hooks: trainingProgressButtonHtml, bindTrainingProgressActions,
 * openTodayTrainingProgress, refreshOpenTrainingProgress,
 * showTrainingSharePreview({ dailyResult | todayProgress }).
 */
// Release decision: retain the reviewed share-card implementation but make
// every UI and direct export entry unavailable until separately approved.
const TRAINING_SHARE_CARDS_ENABLED = false;

(() => {
  "use strict";
  let progressView = null;
  let shareView = null;
  const text = (value, max = 240) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
  const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const number = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const appState = () => typeof state === "undefined" ? null : state;
  const userId = () => appState()?.user?.id || "";
  const canView = athleteId => {
    const current = appState();
    return Boolean(current?.user?.id && athleteId && ((current.profile?.role === "athlete" && athleteId === current.user.id) || ["coach", "admin"].includes(current.profile?.role)));
  };
  const categoryNames = { daily: "Daily Tricks", daily_tricks: "Daily Tricks", one_bangs: "One Bangs", one_bang: "One Bangs", dialled: "Dialled", lines: "Lines", bonus: "Bonus Tricks", percentage: "Percentage Tricks", foam: "Foam Pit", foam_pit: "Foam Pit", extra: "Extra tricks" };
  const categoryLabel = category => categoryNames[category] || text(category).replace(/_/g, " ") || "Training";
  const secondsLabel = value => {
    if (number(value) === null || Number(value) < 0) return "—";
    const tenths = Math.round(Number(value) * 10);
    return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}${tenths % 10 ? `.${tenths % 10}` : ""}`;
  };
  const metricLabel = value => number(value) === null ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const dayLabel = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "Today's training";
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  };
  const privateTrickTitle = (item, category) => {
    if (category === "lines" && typeof assignmentPresentation === "function") {
      // The private summary follows the app’s existing legacy Line display.
      // Notes can include private feedback: never use this title for exports.
      return text(assignmentPresentation({ category: "lines", trick_name: text(item.trick_name), notes: text(item.notes, 1200) }).title, 640);
    }
    return text(item.trick_name, 240);
  };

  // This is the only data sent to the canvas. Do not spread a profile, run,
  // coaching record or raw RPC response into a share model.
  function dailyShareData(result = {}) {
    return {
      riderName: text(result.rider_name, 90) || "Rider",
      seconds: number(result.seconds), completionPoints: number(result.completion_points),
      previousPb: result.pb_comparable === true ? number(result.previous_pb_seconds) : null, pbSeconds: result.pb_comparable === true ? number(result.pb_seconds) : null,
      newPb: result.pb_comparable === true && result.is_new_pb === true, firstPb: result.pb_comparable === true && result.is_first_pb === true,
      weeklyScore: number(result.weekly_score), rank: number(result.rank_number),
      completedAt: text(result.completed_at, 40), localDate: text(result.local_date, 10),
      venue: text(result.venue, 120), legacy: result.legacy === true,
    };
  }

  function completedCategoryData(progress, titleForItem) {
    return (Array.isArray(progress.completed_categories) ? progress.completed_categories : []).map(category => {
      const seen = new Set();
      const items = (Array.isArray(category.items) ? category.items : []).filter(item => {
        const key = text(item.id, 120) || text(item.trick_name, 240);
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
      }).map(item => ({ name: titleForItem(item, category.category) })).filter(item => item.name);
      return { key: text(category.category, 50), label: categoryLabel(category.category), items };
    }).filter(category => category.items.length);
  }

  function todayShareData(progress = {}) {
    // Exports accept structured trick names only. A legacy Line may look shorter
    // in the image because freeform notes must never enter the share model.
    const categories = completedCategoryData(progress, item => text(item.trick_name, 640));
    return {
      riderName: text(progress.rider_name, 90) || "Rider", localDate: text(progress.local_date, 10),
      timezone: text(progress.timezone, 90), dailyResults: (Array.isArray(progress.daily_results) ? progress.daily_results : []).map(dailyShareData),
      categories, todayPoints: number(progress.today_points), todayXp: number(progress.today_xp), weeklyScore: number(progress.weekly_score),
    };
  }

  function buildTrainingShareData(input = {}) {
    if (!TRAINING_SHARE_CARDS_ENABLED) return null;
    if (input.dailyResult) return { kind: "daily", daily: dailyShareData(input.dailyResult) };
    if (input.todayProgress) return { kind: "today", today: todayShareData(input.todayProgress) };
    throw new Error("Choose a saved result or today's progress to share.");
  }

  function trainingProgressButtonHtml(athleteId = userId(), riderName = "") {
    if (!canView(athleteId)) return "";
    return `<button type="button" class="training-progress-trigger" data-today-training-progress="${html(athleteId)}" data-progress-rider-name="${html(riderName)}"><span aria-hidden="true">↗</span><span>Today's Progress</span></button>`;
  }

  function bindTrainingProgressActions(root = document) {
    root.querySelectorAll("[data-today-training-progress]").forEach(button => {
      button.onclick = () => openTodayTrainingProgress({ athleteId: button.dataset.todayTrainingProgress, riderName: button.dataset.progressRiderName });
    });
  }

  function createDialog(className, title, onClose) {
    const dialog = document.createElement("dialog");
    dialog.className = `training-progress-dialog ${className}`;
    dialog.setAttribute("aria-label", title);
    document.body.append(dialog);
    document.documentElement.classList.add("training-progress-open");
    dialog.addEventListener("close", () => {
      dialog.remove();
      onClose?.();
      if (!document.querySelector(".training-progress-dialog[open]")) document.documentElement.classList.remove("training-progress-open");
    }, { once: true });
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    return dialog;
  }

  function progressBodyHtml(raw) {
    const data = { ...todayShareData(raw), categories: completedCategoryData(raw, privateTrickTitle) };
    const results = data.dailyResults;
    const completed = data.categories.reduce((sum, category) => sum + category.items.length, 0);
    const improvements = (Array.isArray(raw.improvements) ? raw.improvements : []).filter(item => item.type === "daily_pb" && number(item.seconds) !== null && (number(item.previous_pb_seconds) === null || Number(item.seconds) < Number(item.previous_pb_seconds)));
    const goal = raw.next_goal && typeof raw.next_goal === "object" ? raw.next_goal : null;
    return `<div class="training-progress-date">${html(dayLabel(data.localDate))}${data.timezone ? `<span>${html(data.timezone.replace(/_/g, " "))}</span>` : ""}</div>
      <div class="training-progress-stats"><div><strong>${metricLabel(data.todayPoints)}</strong><span>Points earned today</span></div><div><strong>${metricLabel(data.todayXp)}</strong><span>XP earned today</span></div></div>
      ${data.weeklyScore !== null ? `<p class="training-progress-weekly">Weekly score <strong>${metricLabel(data.weeklyScore)}</strong></p>` : ""}
      ${raw.xp_attribution === "partial" ? `<p class="training-progress-note">Today’s full XP total is unavailable because earlier rewards were adjusted today.</p>` : (data.todayPoints === null || data.todayXp === null) ? `<p class="training-progress-note">Only rewards that can be attributed to today are shown.</p>` : ""}
      <section class="training-progress-daily"><div class="training-progress-section-title"><h3>Daily Tricks</h3><span>${results.length ? "Time locked in" : "No finish recorded today"}</span></div>
      ${results.length ? results.map(result => `<div class="training-progress-daily-result"><div><strong>${secondsLabel(result.seconds)}</strong><span>${html(result.venue || "Daily Tricks time")}</span></div><div><b>${result.completionPoints === null ? "—" : `+${metricLabel(result.completionPoints)}`}</b><span>Completion points</span></div>${result.newPb ? `<p class="training-progress-pb">${result.firstPb ? "FIRST PERSONAL BEST" : "NEW PERSONAL BEST"}</p>` : ""}${result.legacy ? `<p class="training-progress-note">Previously saved time. ${result.completionPoints === null ? "Completion points couldn't be attributed to this result. " : ""}A compatible PB comparison is unavailable.</p>` : ""}</div>`).join("") : `<p>Your saved Daily Tricks result will appear here when you confirm a finish.</p>`}</section>
      <section class="training-progress-completions"><div class="training-progress-section-title"><h3>Completed today</h3><span>${completed} ${completed === 1 ? "completion" : "completions"}</span></div>
        ${data.categories.length ? data.categories.map(category => `<article class="training-progress-category"><header><h4>${html(category.label)}</h4><span>${category.items.length}</span></header><ul>${category.items.map(item => `<li><span aria-hidden="true">✓</span>${html(item.name)}</li>`).join("")}</ul></article>`).join("") : `<p class="training-progress-empty">Your next landed trick starts today's progress. Come back whenever you like.</p>`}
      </section>
      ${improvements.length ? `<section class="training-progress-improvements"><h3>Personal progress</h3>${improvements.map(item => `<p><strong>Daily Tricks PB${item.venue ? ` · ${html(text(item.venue))}` : ""}</strong><span>${secondsLabel(item.seconds)}${number(item.previous_pb_seconds) === null ? " · first compatible personal best" : ` · previous best ${secondsLabel(item.previous_pb_seconds)}`}</span></p>`).join("")}</section>` : ""}
      ${goal?.trick_name ? `<section class="training-progress-goal"><span>Next goal</span><strong>${html(categoryLabel(goal.category))} · ${html(privateTrickTitle(goal, goal.category))}</strong>${goal.description ? `<p>${html(text(goal.description))}</p>` : ""}</section>` : ""}
      <p class="training-progress-note">Every visit today counts. Keep riding and check back as you progress.</p>`;
  }

  async function loadProgress(view) {
    const request = ++view.request;
    const body = view.dialog.querySelector("[data-progress-body]");
    const refresh = view.dialog.querySelector("[data-progress-refresh]");
    const share = view.dialog.querySelector("[data-progress-preview]");
    refresh.disabled = true;
    if (share) share.disabled = true;
    body.setAttribute("aria-busy", "true");
    view.dialog.querySelector("[data-progress-status]").textContent = view.data ? "Updating today's progress…" : "Loading your recorded progress…";
    try {
      const { data, error } = await client.rpc("get_today_training_progress", { p_athlete_id: view.athleteId });
      if (progressView !== view || request !== view.request || userId() !== view.userId) return;
      if (error) throw error;
      if (!data || data.athlete_id !== view.athleteId) throw new Error("Progress is not available for this rider.");
      view.data = data;
      const top = view.dialog.scrollTop;
      body.innerHTML = progressBodyHtml(data);
      view.dialog.querySelector("[data-progress-name]").textContent = text(data.rider_name, 90) || view.riderName || "Rider";
      view.dialog.querySelector("[data-progress-status]").textContent = "Updated just now";
      view.dialog.scrollTop = top;
      if (share) share.disabled = false;
    } catch (error) {
      if (progressView !== view || request !== view.request || userId() !== view.userId) return;
      if (error?.code === "42501" || [401, 403].includes(Number(error?.status))) {
        view.data = null;
        body.innerHTML = `<p class="training-progress-empty">Progress is no longer available for this rider.</p>`;
        view.dialog.querySelector("[data-progress-status]").textContent = "You need access to this rider to view their progress.";
        return;
      }
      // A failed refresh leaves the previously visible summary labelled as old;
      // it is never substituted with zero rewards or a success celebration.
      view.dialog.querySelector("[data-progress-status]").textContent = view.data ? "Couldn't update. This is your previous summary — tap Refresh to retry." : "Couldn't load progress. Check your connection, then tap Refresh.";
      if (!view.data) body.innerHTML = `<p class="training-progress-empty">Your recorded training is safe. Try again when you're connected.</p>`;
    } finally {
      if (progressView === view && request === view.request) {
        refresh.disabled = false;
        body.removeAttribute("aria-busy");
      }
    }
  }

  async function openTodayTrainingProgress({ athleteId = userId(), riderName = "" } = {}) {
    if (!canView(athleteId)) return;
    if (progressView) progressView.dialog.close();
    const view = { athleteId, riderName: text(riderName, 90), userId: userId(), request: 0, data: null, dialog: null };
    const dialog = createDialog("training-today-dialog", "Today's Progress", () => {
      view.request++;
      if (progressView === view) progressView = null;
    });
    view.dialog = dialog;
    progressView = view;
    dialog.innerHTML = `<header class="training-progress-header"><div><span class="training-progress-eyebrow">JKCREW · Training</span><h2>Today's <em>Progress</em></h2><p data-progress-name>${html(view.riderName || "Rider")}</p></div><button type="button" class="training-progress-close" data-progress-close aria-label="Close today's progress">×</button></header><div class="training-progress-tools"><p role="status" data-progress-status>Loading your recorded progress…</p><button type="button" class="training-progress-button small" data-progress-refresh>↻ Refresh</button></div><div data-progress-body></div><footer class="training-progress-footer">${TRAINING_SHARE_CARDS_ENABLED ? `<button type="button" class="training-progress-button accent" data-progress-preview disabled>Share / Save Image <span aria-hidden="true">↗</span></button>` : ""}<button type="button" class="training-progress-button" data-progress-continue>Keep riding</button></footer>`;
    dialog.querySelector("[data-progress-close]").onclick = () => dialog.close();
    dialog.querySelector("[data-progress-continue]").onclick = () => dialog.close();
    dialog.querySelector("[data-progress-refresh]").onclick = () => loadProgress(view);
    const preview = dialog.querySelector("[data-progress-preview]");
    if (preview) preview.onclick = () => {
      if (view.data && view.userId === userId()) showTrainingSharePreview({ todayProgress: view.data });
    };
    dialog.showModal();
    await loadProgress(view);
  }

  function refreshOpenTrainingProgress(athleteId) {
    if ((progressView && userId() !== progressView.userId) || (shareView && userId() !== shareView.userId)) {
      closeTrainingProgressViews(); return Promise.resolve();
    }
    const view = progressView;
    if (!view || (athleteId && view.athleteId !== athleteId)) return Promise.resolve();
    if (userId() !== view.userId) { view.dialog.close(); return Promise.resolve(); }
    return loadProgress(view);
  }

  function closeTrainingProgressViews() {
    shareView?.dialog.close();
    progressView?.dialog.close();
  }

  function wrapCanvasText(context, value, width, maxLines = 2) {
    const words = text(value, 500).split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      if (line && context.measureText(`${line} ${word}`).width > width) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    const result = lines.slice(0, maxLines);
    if (lines.length > maxLines && result.length) result[result.length - 1] += "…";
    return result.map(value => {
      if (context.measureText(value).width <= width) return value;
      let short = value;
      while (short.length && context.measureText(`${short}…`).width > width) short = short.slice(0, -1);
      return `${short}…`;
    });
  }

  function drawTrainingShareCard(model) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1440;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preview is unavailable on this device.");
    const daily = model.kind === "daily";
    const data = daily ? model.daily : model.today;
    const accent = daily && data.newPb ? "#f7d154" : "#20e3c3";
    const display = '"Barlow Condensed", Arial, sans-serif';
    const body = '"Barlow", Arial, sans-serif';
    const write = (value, x, y, size = 30, color = "#eff5f3", weight = 600, family = body) => {
      context.font = `${weight} ${size}px ${family}`;
      context.fillStyle = color; context.fillText(String(value), x, y);
    };
    const lines = (value, x, y, width, size = 36, color, limit = 2, weight = 600) => {
      context.font = `${weight} ${size}px ${body}`;
      const wrapped = wrapCanvasText(context, value, width, limit);
      wrapped.forEach((line, index) => write(line, x, y + index * size * 1.22, size, color, weight));
      return wrapped.length * size * 1.22;
    };
    context.fillStyle = "#07100f"; context.fillRect(0, 0, 1080, 1440);
    const glow = context.createRadialGradient(950, 90, 0, 950, 90, 950);
    glow.addColorStop(0, daily && data.newPb ? "#444021" : "#163e3c"); glow.addColorStop(1, "#07100f");
    context.fillStyle = glow; context.fillRect(0, 0, 1080, 1440);
    context.strokeStyle = "#203631"; context.lineWidth = 1;
    for (let x = 54; x < 1080; x += 108) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 1440); context.stroke(); }
    context.globalAlpha = 0.32;
    context.strokeStyle = accent; context.lineWidth = 3;
    context.beginPath(); context.moveTo(790, 0); context.lineTo(690, 235); context.lineTo(940, 390); context.lineTo(1030, 250); context.lineTo(1080, 275); context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = accent; context.fillRect(64, 58, 9, 48);
    write("JKCREW", 91, 100, 58, "#f6faf8", 900, display);
    write("TRAINING / PROGRESSION", 64, 144, 22, "#b1c6bf", 700);
    write(dayLabel(data.localDate), 64, 204, 25, "#a8bdb7", 500);
    const nameHeight = lines(data.riderName, 64, 270, 930, 50, "#f5f8f6", 2, 800);
    let y = 286 + nameHeight;
    write(daily ? "DAILY TRICKS" : "TODAY'S PROGRESS", 64, y + 32, 37, accent, 800, display);
    y += 74;
    if (daily) {
      write(secondsLabel(data.seconds), 56, y + 156, 180, "#f8fbf9", 900, display);
      write("RECORDED COMPLETION TIME", 68, y + 202, 24, "#adc2b9", 700);
      y += 266;
      if (data.newPb) {
        context.fillStyle = accent; context.fillRect(64, y - 40, 952, 78);
        write(data.firstPb ? "FIRST PERSONAL BEST" : "NEW PERSONAL BEST", 88, y + 11, 46, "#142117", 900, display);
        y += 104;
      }
      const personalBest = data.pbSeconds ?? (data.newPb ? data.seconds : null);
      const stats = [[data.completionPoints === null ? "—" : `+${metricLabel(data.completionPoints)}`, "Completion points"], [metricLabel(data.weeklyScore), "Weekly score"]];
      stats.forEach(([value, label], index) => {
        context.fillStyle = "#142420"; context.fillRect(64 + index * 486, y, 466, 155);
        write(value, 90 + index * 486, y + 75, 68, "#f4faf7", 800, display);
        write(label, 90 + index * 486, y + 122, 25, "#bdd0c7", 500);
      });
      y += 220;
      if (personalBest !== null) write(`Personal best  ${secondsLabel(personalBest)}`, 66, y, 34, "#d3e3db", 600);
      if (data.previousPb !== null && data.newPb && !data.firstPb) write(`Previous best  ${secondsLabel(data.previousPb)}`, 66, y + 54, 28, "#a4bcb0", 500);
      if (data.rank !== null && data.rank > 0) write(`Leaderboard #${metricLabel(data.rank)}`, 66, y + 110, 30, accent, 700);
    } else {
      const metrics = [[metricLabel(data.todayPoints), "POINTS TODAY"], [metricLabel(data.todayXp), "XP TODAY"]];
      metrics.forEach(([value, label], index) => {
        write(value, 60 + index * 486, y + 105, 128, "#f7fbf8", 900, display);
        write(label, 66 + index * 486, y + 150, 24, "#b7ccc3", 700);
      });
      y += 202;
      if (data.dailyResults.length) {
        context.fillStyle = "#19362d"; context.fillRect(64, y, 952, 90);
        const result = data.dailyResults[0];
        write("DAILY TRICKS", 88, y + 39, 23, accent, 700);
        write(`${secondsLabel(result.seconds)} · ${result.completionPoints === null ? "—" : `+${metricLabel(result.completionPoints)}`} completion pts`, 88, y + 73, 30, "#eff7f3", 700);
        y += 128;
      }
      const total = data.categories.reduce((sum, category) => sum + category.items.length, 0);
      write(`${total} COMPLETIONS`, 66, y, 30, accent, 800, display);
      y += 44;
      let visible = 0;
      // Give each completed category a place before showing another item from
      // the same category, so a long Daily list cannot hide untimed training.
      const allItems = [];
      const maxItems = Math.max(0, ...data.categories.map(category => category.items.length));
      for (let index = 0; index < maxItems; index++) {
        for (const category of data.categories) {
          if (category.items[index]) allItems.push({ name: category.items[index].name, category: category.label });
        }
      }
      for (const item of allItems) {
        if (y > 1200) break;
        context.fillStyle = accent; context.beginPath(); context.arc(75, y + 3, 5, 0, 2 * Math.PI); context.fill();
        const used = lines(item.name, 98, y + 13, 905, 31, "#eff6f1", 2, 600);
        write(item.category, 98, y + used + 13, 21, "#a3b9af", 500);
        y += used + 52; visible++;
      }
      if (total > visible) write(`+ ${total - visible} more completed`, 98, Math.min(y, 1260), 25, "#b8cfc2", 600);
      if (!total) lines("Keep showing up. Your next landed trick starts the story.", 66, y + 30, 900, 42, "#cde1d6", 3, 600);
    }
    context.fillStyle = "#07100f"; context.fillRect(0, 1320, 1080, 120);
    context.strokeStyle = "#355046"; context.lineWidth = 2; context.beginPath(); context.moveTo(64, 1320); context.lineTo(1016, 1320); context.stroke();
    write("CRAFTING TALENT. SHAPING FUTURES.", 64, 1382, 25, "#a6beb1", 700);
    write("JK", 940, 1390, 50, accent, 900, display);
    return canvas;
  }

  async function showTrainingSharePreview(input = {}) {
    if (!TRAINING_SHARE_CARDS_ENABLED) return;
    const owner = userId();
    if (!owner) return;
    const source = input.dailyResult || input.todayProgress;
    if (!source || !canView(source.athlete_id)) return;
    if (shareView) shareView.dialog.close();
    const model = buildTrainingShareData(input);
    const current = { userId: owner, dialog: null, url: null, file: null, busy: false };
    const dialog = createDialog("training-share-dialog", "Preview training image", () => {
      if (current.url) URL.revokeObjectURL(current.url);
      if (shareView === current) shareView = null;
    });
    current.dialog = dialog; shareView = current;
    dialog.innerHTML = `<header class="training-progress-header"><div><span class="training-progress-eyebrow">JKCREW · Share card</span><h2>Make it <em>yours.</em></h2><p>Preview your training image</p></div><button type="button" class="training-progress-close" data-share-close aria-label="Close image preview">×</button></header><div class="training-share-image" data-share-image aria-busy="true"><p>Creating your image…</p></div><p class="training-share-privacy">Your name and training results are included. Private coaching feedback, contact details and run plans stay private.</p><p role="status" class="training-share-status" data-share-status></p><footer class="training-progress-footer"><button type="button" class="training-progress-button accent" data-share-native disabled>Share image <span aria-hidden="true">↗</span></button><button type="button" class="training-progress-button" data-share-save disabled>Save Image ↓</button></footer>`;
    dialog.querySelector("[data-share-close]").onclick = () => dialog.close();
    dialog.showModal();
    try {
      const canvas = drawTrainingShareCard(model);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Couldn't create this image.")), "image/png"));
      if (shareView !== current || userId() !== owner) return;
      current.url = URL.createObjectURL(blob);
      const filename = `jkcrew-${model.kind === "daily" ? "daily-tricks" : "todays-progress"}.png`;
      current.file = new File([blob], filename, { type: "image/png" });
      const image = document.createElement("img");
      image.src = current.url; image.alt = `${model.kind === "daily" ? "Daily Tricks result" : "Today's Progress"} card for ${model.kind === "daily" ? model.daily.riderName : model.today.riderName}`;
      image.width = 1080; image.height = 1440;
      const preview = dialog.querySelector("[data-share-image]");
      preview.replaceChildren(image); preview.removeAttribute("aria-busy");
      dialog.querySelectorAll("[data-share-native], [data-share-save]").forEach(button => { button.disabled = false; });
      const status = dialog.querySelector("[data-share-status]");
      const download = () => {
        if (current.userId !== userId() || !current.url) return;
        const anchor = document.createElement("a");
        anchor.href = current.url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
        status.textContent = "Image download started. You can save it to Photos or Files.";
      };
      dialog.querySelector("[data-share-save]").onclick = download;
      dialog.querySelector("[data-share-native]").onclick = async () => {
        if (current.busy || current.userId !== userId()) return;
        // The File is prepared before this click, preserving the transient user
        // activation that Safari requires for native file sharing.
        let fileSharingAvailable = false;
        try { fileSharingAvailable = Boolean(navigator.share && navigator.canShare?.({ files: [current.file] })); } catch {}
        if (!fileSharingAvailable) { download(); return; }
        current.busy = true;
        const button = dialog.querySelector("[data-share-native]"); button.disabled = true;
        try { await navigator.share({ files: [current.file], title: "JKCREW training" }); status.textContent = "Share sheet closed."; }
        catch (error) {
          if (error.name === "AbortError") status.textContent = "Sharing cancelled. Your preview is still here.";
          else status.textContent = "Sharing isn't available right now. Tap Save Image to download your card.";
        } finally { current.busy = false; button.disabled = false; }
      };
    } catch (error) {
      if (shareView !== current) return;
      dialog.querySelector("[data-share-image]").innerHTML = `<p>Couldn't create the image. Close this preview and try again.</p>`;
      dialog.querySelector("[data-share-image]").removeAttribute("aria-busy");
    }
  }

  // A returning tab may cross the rider's local midnight. Re-query the server;
  // never add a fixed 24 hours or reuse yesterday's cached totals.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshOpenTrainingProgress();
  });
  window.addEventListener("focus", () => { void refreshOpenTrainingProgress(); });
  Object.assign(window, { trainingProgressButtonHtml, bindTrainingProgressActions, openTodayTrainingProgress, refreshOpenTrainingProgress, closeTrainingProgressViews, showTrainingSharePreview, buildTrainingShareData });
})();
