/* Official schedule facts are supplied by the server. No private rider data is cached here. */
(() => {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const text = (value, fallback = "Not yet confirmed") => typeof value === "string" && value.trim() ? value : fallback;
  const dateFormatter = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  function dateLabel(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return "To be confirmed";
    return dateFormatter.format(new Date(value));
  }
  function safeUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/i.test(url.hostname) || url.hostname.endsWith(".local")) return "";
      return url.href;
    } catch { return ""; }
  }
  function sourceLinks(sources) {
    return (Array.isArray(sources) ? sources : []).filter(source => safeUrl(source?.url)).map(source => `<a href="${escape(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escape(text(source.title, new URL(source.url).hostname.replace(/^www\./, "")))} <span aria-hidden="true">↗</span></a>`).join("");
  }
  function badge(label, tone = "neutral") { return `<span class="uci-schedule-badge is-${tone}">${escape(label)}</span>`; }
  function dateRange(event) {
    if (!event.startDate) return "Dates to be confirmed";
    return dateLabel(event.startDate) + (event.endDate && event.endDate !== event.startDate ? ` – ${dateLabel(event.endDate)}` : "");
  }
  function eventStatus(event) {
    if (event.status === "cancelled") return ["Cancelled", "danger"];
    if (event.status === "review_required") return ["Update under review", "warning"];
    if (event.status === "postponed") return ["Postponed", "warning"];
    if (event.status === "provisional" || event.dateStatus === "provisional") return ["Provisional", "warning"];
    if (event.status === "confirmed") return [event.dateStatus === "calendar_dates" ? "UCI calendar dates" : "Confirmed", "confirmed"];
    return ["Details pending", "warning"];
  }
  function errorMessage(error, operation) {
    if (["42501", "PGRST301", "PGRST302"].includes(error?.code) || /not authorized|unauthorized|jwt expired|sign in|permission denied/i.test(error?.message || "")) return "Your access could not be confirmed. Refresh the app and sign in again if needed.";
    if (operation === "save") return "We couldn’t confirm the save. Try again when you’re connected; retrying won’t add a duplicate.";
    if (operation === "subscribe") return "Your alert preference couldn’t be saved. Please try again.";
    return "The schedule couldn’t load. Check your connection and try again.";
  }
  function mount(root, options = {}) {
    if (!(root instanceof Element)) throw Error("A schedule container is required");
    let stopped = false, sequence = 0, data = null, loading = false, loadError = "", subscriptionBusy = false, subscriptionError = "";
    const pending = new Set(), errors = new Map(), messages = new Map();
    const filters = { search: "", status: "all", region: "all" };
    const timers = new Set();
    const active = () => !stopped && root.isConnected && (!options.isCurrent || options.isCurrent());
    const canManage = () => options.canManage === true && data?.canManage === true;
    const callback = (name, value) => { if (typeof options[name] === "function") options[name](value); };
    async function rpc(name, args) {
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Request timed out")), 18000); timers.add(timer); });
      try {
        const result = await Promise.race([Promise.resolve().then(() => options.client.rpc(name, args)), timeout]);
        if (result?.error) throw result.error;
        if (!result || result.data == null) throw Error("No response received");
        return result.data;
      } finally { clearTimeout(timer); timers.delete(timer); }
    }
    function shell() {
      root.classList.add("uci-schedule");
      root.innerHTML = `<header class="uci-schedule-heading">${options.onBack ? '<button type="button" class="uci-schedule-back" data-schedule-back>← Back</button>' : ""}<div class="eyebrow">${options.canManage ? "Coach tools" : "Competition planning"}</div><h1>UCI 2027 <span>Schedule</span></h1><p>Plan the season for our German and Australian BMX Freestyle Park riders.</p></header><div data-schedule-content></div>`;
      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("change", onInput);
    }
    function filteredEvents() {
      const search = filters.search.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return data.events.filter(event => {
        const words = [event.name, event.venue, event.country, event.countryCode, event.classification, ...(event.categories || [])].join(" ").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const status = filters.status;
        const confirmed = event.status === "confirmed" && event.dateStatus !== "provisional";
        const region = filters.region;
        return (!search || words.includes(search)) && (status === "all" || status === "confirmed" && confirmed || status === "provisional" && !confirmed && event.status !== "cancelled" || status === "added" && (event.alreadyAdded || event.matchingEventId || event.matchingEventCount > 1) || status === "changed" && (event.changes?.length || event.status === "cancelled" || event.status === "review_required" || event.syncStatus === "coach_edits")) && (region === "all" || region === "AUS" && event.countryCode === "AUS" || region === "GER" && ["GER", "DEU", "DE"].includes(event.countryCode) || region === "international" && !["AUS", "AU", "GER", "DEU", "DE"].includes(event.countryCode));
      }).sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999") || String(a.name).localeCompare(String(b.name)));
    }
    function registrationHtml(event) {
      const registration = event.registration || {};
      const url = safeUrl(registration.url);
      return `<div class="uci-schedule-registration"><strong>Registration</strong><p>${escape(text(registration.note, registration.status === "published" ? "Check the organiser’s entry requirements before registering." : "Entry details have not been announced."))}</p>${registration.deadline ? `<p class="uci-schedule-deadline">Entry deadline: ${escape(dateLabel(registration.deadline))}</p>` : ""}${url ? `<a class="uci-schedule-text-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Registration details ↗</a>` : ""}${registration.email ? `<p class="uci-schedule-contact">Contact: ${escape(registration.email)}</p>` : ""}</div>`;
    }
    function eventHtml(event) {
      const [status, tone] = eventStatus(event), isPending = pending.has(event.id), saved = event.alreadyAdded === true;
      const matched = !saved && !!event.matchingEventId, ambiguous = !saved && event.matchingEventCount > 1;
      const calendarId = event.existingEventId || event.matchingEventId;
      const sources = sourceLinks(event.sources);
      const changes = Array.isArray(event.changes) ? event.changes : [];
      const date = event.startDate && Number.isFinite(Date.parse(event.startDate)) ? new Date(event.startDate + "T12:00:00Z") : null;
      const cancelled = event.status === "cancelled";
      const undated = !event.startDate || !Number.isFinite(Date.parse(event.startDate));
      const classKnown = event.classificationStatus === "confirmed" && event.classification;
      const pointsKnown = event.rankingPoints?.status === "uci_listed";
      const olympicKnown = event.olympicQualification?.status === "confirmed";
      return `<article class="uci-schedule-event${cancelled ? " is-cancelled" : ""}" data-schedule-event="${escape(event.id)}">
        <div class="uci-schedule-event-heading"><div class="uci-schedule-date${date ? "" : " is-pending"}" aria-hidden="true"><span>${date ? escape(new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "UTC" }).format(date)) : "2027"}</span><strong>${date ? date.getUTCDate() : "TBC"}</strong></div><div><div class="uci-schedule-badges">${badge(status, tone)}${saved ? badge("Added to calendar", "confirmed") : matched ? badge("Already in calendar", "confirmed") : ambiguous ? badge("Calendar matches need review", "warning") : ""}</div><h2>${escape(event.name)}</h2><p class="uci-schedule-event-dates">${escape(dateRange(event))}</p>${event.dateNote ? `<p class="uci-schedule-date-note">${escape(event.dateNote)}</p>` : ""}</div></div>
        <dl class="uci-schedule-facts"><div><dt>Location</dt><dd>${escape([event.venue, event.country].filter(Boolean).join(" · ") || "Location to be confirmed")}</dd></div><div><dt>UCI classification</dt><dd>${escape(classKnown ? event.classification : text(event.classification, "Not confirmed"))}${!classKnown && event.classification ? ' <span class="uci-schedule-pending">· unconfirmed</span>' : ""}</dd></div><div><dt>Categories</dt><dd>${escape(event.categories?.length ? event.categories.join(" · ") : "Categories to be confirmed")}</dd></div></dl>
        <div class="uci-schedule-points"><div>${badge(pointsKnown ? "UCI ranking points" : "UCI points unconfirmed", pointsKnown ? "confirmed" : "warning")}<p>${escape(text(event.rankingPoints?.note, "The points available have not yet been verified."))}</p></div><div>${badge(olympicKnown ? "Olympic rules confirmed" : "Olympic eligibility pending", olympicKnown ? "confirmed" : "neutral")}<p>${escape(text(event.olympicQualification?.note, "Do not assume this event counts towards LA 2028 qualification."))}</p></div></div>
        <details class="uci-schedule-details"><summary>Eligibility, registration & sources <span aria-hidden="true">⌄</span></summary><div><strong>Rider eligibility</strong><p>${escape(text(event.eligibilityNote, "Eligible age groups, licences and nationality conditions are awaiting official confirmation."))}</p>${event.eligibilityStatus !== "confirmed" ? '<p class="uci-schedule-detail-note">Confirm eligibility with the organiser and your national federation before entering.</p>' : ""}${registrationHtml(event)}<div class="uci-schedule-sources"><strong>Official sources</strong>${sources || '<p>No official event link has been verified yet.</p>'}<small>Event last checked: ${escape(dateLabel(event.lastCheckedAt))}</small></div></div></details>
        ${changes.length ? `<div class="uci-schedule-change"><strong>Schedule updated</strong><ul>${changes.slice(0, 4).map(change => `<li>${escape(text(change.field, "Details"))}: ${escape(typeof change.previous === "string" ? change.previous : "previous details")} → ${escape(typeof change.current === "string" ? change.current : "updated details")}</li>`).join("")}</ul></div>` : ""}
        ${cancelled ? '<p class="uci-schedule-warning">Cancelled events remain visible so you can review any existing travel or calendar plans.</p>' : ""}
        ${event.reviewNote ? `<p class="uci-schedule-warning">${escape(event.reviewNote)}</p>` : ""}
        ${matched ? '<p class="uci-schedule-warning">This event is already in your calendar. Link official updates to the existing event while keeping its riders, courses and runs.</p>' : ""}
        ${ambiguous ? '<p class="uci-schedule-warning">More than one calendar event matches. Merge the duplicates in Events & Runs before linking official updates.</p>' : ""}
        ${saved && event.syncStatus === "coach_edits" ? '<p class="uci-schedule-warning">Your calendar has manual edits. Review the verified changes before updating those details.</p>' : ""}
        ${event.syncStatus === "removed" ? '<p class="uci-schedule-warning">The linked calendar event was removed. You can add it again.</p>' : ""}
        <div class="uci-schedule-event-status${errors.has(event.id) ? " is-error" : ""}" role="status">${escape(errors.get(event.id) || messages.get(event.id) || "")}</div>
        ${canManage() ? `<div class="uci-schedule-event-actions">${saved ? '<div class="uci-schedule-added"><span aria-hidden="true">✓</span> Already in Upcoming Events and Contests</div>' : `<button type="button" class="uci-schedule-button is-primary" data-schedule-add="${escape(event.id)}"${isPending || cancelled || undated || ambiguous ? " disabled" : ""}${isPending ? ' aria-busy="true"' : ""}>${isPending ? matched ? "Linking updates…" : "Adding event…" : cancelled ? "Event cancelled" : undated ? "Waiting for official dates" : ambiguous ? "Matching events need review" : errors.has(event.id) ? matched ? "Retry linking updates" : "Retry adding event" : matched ? "Already in Upcoming — Link updates" : '<span aria-hidden="true">＋</span> Add to Upcoming Events and Contests'}</button>`}${calendarId && options.onOpenEvent ? `<button type="button" class="uci-schedule-button is-secondary" data-schedule-open="${escape(event.id)}">View event <span aria-hidden="true">→</span></button>` : ""}</div>` : ""}
      </article>`;
    }
    function qualificationHtml() {
      const qualification = data.qualification || {};
      const announcements = Array.isArray(data.announcements) ? data.announcements : [];
      return `<section class="uci-schedule-qualification" aria-labelledby="uci-schedule-la28"><div class="uci-schedule-qualification-heading"><span class="uci-schedule-olympic-mark" aria-hidden="true">28</span><div><div class="eyebrow">Road to Los Angeles</div><h2 id="uci-schedule-la28">LA 2028 qualification</h2></div>${badge(qualification.status === "confirmed" ? "Official criteria published" : "Official rules being monitored", qualification.status === "confirmed" ? "confirmed" : "warning")}</div><p>${escape(text(qualification.summary, "We’re checking official announcements. UCI ranking points alone do not confirm Olympic qualification eligibility."))}</p>${qualification.rankingNote ? `<p>${escape(qualification.rankingNote)}</p>` : ""}<p class="uci-schedule-distinction"><strong>Ranking points ≠ Olympic qualification points.</strong> Each event’s Olympic status is shown separately. Only published UCI / IOC qualification rules can confirm what counts.</p><div class="uci-schedule-source-row">${sourceLinks(qualification.sources)}</div>${announcements.length ? `<details class="uci-schedule-announcements"><summary>Official updates <span>${announcements.length}</span></summary>${announcements.map(item => `<article><h3>${escape(item.title)}</h3><p>${escape(text(item.summary, "Official update available."))}</p>${item.impact ? `<p><strong>What it means for our riders:</strong> ${escape(item.impact)}</p>` : ""}${item.impactGermany ? `<p><strong>German riders:</strong> ${escape(item.impactGermany)}</p>` : ""}${item.impactAustralia ? `<p><strong>Australian riders:</strong> ${escape(item.impactAustralia)}</p>` : ""}${Array.isArray(item.deadlines) && item.deadlines.length ? `<p><strong>Deadlines:</strong> ${escape(item.deadlines.map(deadline => typeof deadline === "string" ? deadline : `${deadline.label || "Deadline"}${deadline.date ? ": " + dateLabel(deadline.date) : ""}`).join(" · "))}</p>` : ""}${safeUrl(item.sourceUrl || item.url) ? `<a href="${escape(safeUrl(item.sourceUrl || item.url))}" target="_blank" rel="noopener noreferrer">Read official announcement ↗</a>` : ""}<small>Verified ${escape(dateLabel(item.verifiedAt))}</small></article>`).join("")}</details>` : ""}</section>`;
    }
    function renderEvents() {
      if (!active() || !data) return;
      const events = filteredEvents();
      root.querySelector("[data-schedule-count]").textContent = `${events.length} ${events.length === 1 ? "event" : "events"}`;
      root.querySelector("[data-schedule-events]").innerHTML = events.length ? events.map(eventHtml).join("") : `<div class="uci-schedule-empty"><strong>${data.events.length ? "No events match these filters" : "The 2027 calendar is taking shape"}</strong><p>${data.events.length ? "Try another location, status or event name." : "New official announcements will appear here after they’re verified."}</p>${data.events.length ? '<button type="button" class="uci-schedule-button is-secondary" data-schedule-clear>Clear filters</button>' : ""}</div>`;
    }
    function render() {
      if (!active()) return;
      const content = root.querySelector("[data-schedule-content]");
      if (!data) {
        content.innerHTML = loadError ? `<div class="uci-schedule-empty is-error" role="alert"><strong>Schedule unavailable</strong><p>${escape(loadError)}</p><button class="uci-schedule-button is-primary" type="button" data-schedule-reload>Try again</button></div>` : '<div class="uci-schedule-loading" role="status"><span aria-hidden="true"></span>Loading the verified schedule…</div>';
        return;
      }
      const checked = Date.parse(data.checkedAt), stale = !Number.isFinite(checked) || Date.now() - checked > 8 * 86400000;
      const refresh = typeof data.refreshStatus === "object" && data.refreshStatus ? data.refreshStatus : { status: data.refreshStatus };
      const refreshProblem = ["failed", "partial", "blocked", "retrying", "review_required"].includes(refresh.status);
      const neverChecked = !Number.isFinite(checked);
      const refreshNote = text(refresh.message || refresh.note || data.refreshError, neverChecked ? "Awaiting the first verified refresh from official UCI and organiser sources." : refreshProblem ? "Some official sources could not be checked. Last verified event details are retained." : "Official UCI and organiser sources are checked weekly. Event status is kept separate from Olympic eligibility.");
      content.innerHTML = `<div class="uci-schedule-monitor"><div><strong>${neverChecked ? "Awaiting first verified refresh" : stale ? "Last verified schedule" : "Official source checks"}</strong><p>Last checked <time${data.checkedAt ? ` datetime="${escape(data.checkedAt)}"` : ""}>${neverChecked ? "Not checked yet" : escape(dateLabel(data.checkedAt))}</time>${stale && !neverChecked ? " · Update overdue" : ""}</p><small>${escape(refreshNote)}</small></div><button type="button" class="uci-schedule-button is-secondary" data-schedule-reload${loading || pending.size || subscriptionBusy ? " disabled" : ""}${loading ? ' aria-busy="true"' : ""}>${loading ? "Loading…" : "↻ Reload schedule"}</button></div>${loadError ? `<p class="uci-schedule-load-error" role="alert">${escape(loadError)} Your last loaded schedule is still shown.</p>` : ""}${qualificationHtml()}
        ${canManage() ? `<div class="uci-schedule-alerts"><div><strong>Qualification alerts</strong><p>Notify me about verified qualification criteria and significant changes. Device push permission is managed in your profile.</p></div><button class="uci-schedule-button is-secondary" type="button" role="switch" aria-checked="${data.notificationsEnabled === true}" data-schedule-alerts${subscriptionBusy ? ' disabled aria-busy="true"' : ""}>${subscriptionBusy ? "Saving…" : data.notificationsEnabled ? "Alerts on" : "Turn on alerts"}</button>${subscriptionError ? `<p class="uci-schedule-load-error" role="alert">${escape(subscriptionError)}</p>` : ""}</div>` : ""}
        <section aria-label="2027 events"><div class="uci-schedule-list-heading"><div><div class="eyebrow">Build your season</div><h2>Events & opportunities</h2></div><span data-schedule-count aria-live="polite"></span></div><div class="uci-schedule-filters"><label>Find event<input type="search" data-schedule-search placeholder="Event, location or category" value="${escape(filters.search)}" autocomplete="off"></label><label>Location<select data-schedule-region><option value="all">All locations</option><option value="AUS">Australia</option><option value="GER">Germany</option><option value="international">International</option></select></label><label>Status<select data-schedule-filter><option value="all">All events</option><option value="confirmed">Confirmed dates</option><option value="provisional">Provisional / pending</option><option value="changed">Changes & cancellations</option>${canManage() ? '<option value="added">Added to calendar</option>' : ""}</select></label></div><div class="uci-schedule-event-grid" data-schedule-events></div></section>`;
      root.querySelector("[data-schedule-region]").value = filters.region;
      root.querySelector("[data-schedule-filter]").value = filters.status;
      renderEvents();
    }
    async function load() {
      if (!active() || loading || pending.size || subscriptionBusy) return;
      const request = ++sequence;
      loading = true; loadError = ""; render();
      try {
        const next = await rpc("get_uci_2027_schedule");
        if (!active() || request !== sequence) return;
        if (!Array.isArray(next.events) || next.events.some(event => !event || typeof event.id !== "string" || !event.name || event.categories != null && !Array.isArray(event.categories))) throw Error("Invalid schedule");
        data = next;
        errors.clear(); messages.clear();
      } catch (error) { if (active() && request === sequence) loadError = errorMessage(error, "load"); }
      finally { if (active() && request === sequence) { loading = false; render(); } }
    }
    async function add(eventId) {
      if (!active() || !canManage() || loading || pending.has(eventId)) return;
      const item = data.events.find(event => event.id === eventId);
      if (!item || item.alreadyAdded || item.matchingEventCount > 1 || item.status === "cancelled" || !item.startDate || !Number.isFinite(Date.parse(item.startDate))) return;
      pending.add(eventId); errors.delete(eventId); messages.delete(eventId); renderEvents();
      const reloadButton = root.querySelector("[data-schedule-reload]"); if (reloadButton) reloadButton.disabled = true;
      try {
        const result = await rpc("add_uci_schedule_event", { p_event_id: eventId });
        if (!active()) return;
        if (!result.event_id) throw Error("Save not confirmed");
        item.existingEventId = result.event_id; item.alreadyAdded = true; item.syncStatus = result.sync_status || "current";
        messages.set(eventId, item.matchingEventId ? "Official updates linked to your existing calendar event." : result.already_added ? "This event was already in your calendar." : "Added to Upcoming Events and Contests.");
        callback("onEventAdded", { eventId: result.event_id, scheduleEventId: eventId });
      } catch (error) { if (active()) errors.set(eventId, errorMessage(error, "save")); }
      finally { pending.delete(eventId); if (active()) { renderEvents(); const button = root.querySelector("[data-schedule-reload]"); if (button) button.disabled = loading || pending.size > 0 || subscriptionBusy; } }
    }
    async function subscribe() {
      if (!active() || !canManage() || subscriptionBusy || loading) return;
      subscriptionBusy = true; subscriptionError = ""; render();
      try {
        const result = await rpc("subscribe_uci_schedule_updates", { p_enabled: data.notificationsEnabled !== true });
        if (!active()) return;
        if (typeof result.enabled !== "boolean") throw Error("Preference not confirmed");
        data.notificationsEnabled = result.enabled;
      } catch (error) { if (active()) subscriptionError = errorMessage(error, "subscribe"); }
      finally { subscriptionBusy = false; if (active()) render(); }
    }
    function onInput(event) {
      if (!active() || !data) return;
      let key;
      if (event.target.matches("[data-schedule-search]")) key = "search";
      else if (event.target.matches("[data-schedule-region]")) key = "region";
      else if (event.target.matches("[data-schedule-filter]")) key = "status";
      else return;
      // A blur change after an input event must not replace a button mid-click.
      if (filters[key] === event.target.value) return;
      filters[key] = event.target.value;
      renderEvents();
    }
    function onClick(event) {
      if (!active()) return;
      const button = event.target.closest("button");
      if (!button || !root.contains(button) || button.disabled) return;
      if (button.hasAttribute("data-schedule-back")) callback("onBack");
      else if (button.hasAttribute("data-schedule-reload")) void load();
      else if (button.hasAttribute("data-schedule-add")) void add(button.dataset.scheduleAdd);
      else if (button.hasAttribute("data-schedule-alerts")) void subscribe();
      else if (button.hasAttribute("data-schedule-open")) {
        const item = data?.events.find(item => item.id === button.dataset.scheduleOpen);
        if (item?.existingEventId || item?.matchingEventId) callback("onOpenEvent", item.existingEventId || item.matchingEventId);
      } else if (button.hasAttribute("data-schedule-clear")) { filters.search = ""; filters.region = "all"; filters.status = "all"; render(); }
    }
    shell(); void load();
    return Object.freeze({ reload: load, destroy() { stopped = true; sequence++; timers.forEach(clearTimeout); timers.clear(); root.removeEventListener("click", onClick); root.removeEventListener("input", onInput); root.removeEventListener("change", onInput); root.classList.remove("uci-schedule"); data = null; errors.clear(); messages.clear(); } });
  }
  window.UCI2027Schedule = Object.freeze({ mount });
})();
