/* Read-only coach list hints. History survives sheet replacement; no scoring writes. */
(function () {
  "use strict";
  const cache = new Map();
  const pending = new Map();
  const mounts = new WeakMap();
  const PAGE_SIZE = 400;
  const TTL = 5 * 60 * 1000;
  let account = "";
  let generation = 0;
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const shift = (date, days) => {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  function key(row, title = row.trick_name) {
    // Foam practice is not a landed park trick. Keep full Lines distinct from
    // individual tricks, and preserve named surfaces/directions (no fuzzy match).
    if (row.category === "foam_pit" || /\bfoam\b/i.test(`${row.trick_name || ""} ${row.notes || ""} ${row.venue || ""}`)) return "";
    const name = normalize(title);
    return name ? `${row.category === "lines" ? "line" : "trick"}:${name}` : "";
  }
  function marker(row, title) {
    const identity = key(row, title);
    if (!identity) return "";
    return `<span class="previous-week-landing" data-previous-week-marker="${escape(identity)}" hidden role="img" aria-label="Landed last week" title="Landed last week">✓</span>`;
  }
  function clear() {
    generation++;
    cache.clear();
    pending.clear();
    account = "";
  }
  async function load(options) {
    const { client, userId, athleteId, countryCode, weekStart, landingDate, present } = options;
    if (account !== userId) { clear(); account = userId; }
    const cacheKey = JSON.stringify([userId, athleteId, countryCode, weekStart]);
    const saved = cache.get(cacheKey);
    if (saved && Date.now() - saved.at < TTL) return saved.keys;
    if (pending.has(cacheKey)) return pending.get(cacheKey);
    const requestGeneration = generation;
    const previous = shift(weekStart, -7);
    const request = (async () => {
      const keys = new Set();
      for (let from = 0; ; from += PAGE_SIZE) {
        // A one-day UTC margin covers every supported rider timezone. Apply the
        // exact rider-local bounds below, giving explicit Daily dates priority.
        const query = client.from("tricktionary_landing_history")
          .select("id,athlete_id,trick_name,category,notes,venue,landed_at,landing_date,landed_count,evidence_type")
          .eq("athlete_id", athleteId).gt("landed_count", 0).neq("evidence_type", "revoked").neq("category", "foam_pit")
          .or(`and(landing_date.gte.${previous},landing_date.lt.${weekStart}),and(landing_date.is.null,landed_at.gte.${shift(previous, -1)}T00:00:00Z,landed_at.lt.${shift(weekStart, 1)}T00:00:00Z)`)
          .order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        let result;
        try { result = await query.abortSignal(controller.signal); }
        finally { clearTimeout(timer); }
        if (result.error) throw result.error;
        const rows = result.data || [];
        for (const row of rows) {
          if (row.athlete_id !== athleteId || !(Number(row.landed_count) > 0) || row.evidence_type === "revoked") continue;
          const date = landingDate(row.landed_at, { country_code: countryCode }, row.landing_date);
          if (date < previous || date >= weekStart) continue;
          const identity = key(row, present(row).title);
          if (identity) keys.add(identity);
        }
        if (rows.length < PAGE_SIZE) break;
      }
      if (account === userId && requestGeneration === generation) {
        if (cache.size >= 64) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { at: Date.now(), keys });
      }
      return keys;
    })();
    pending.set(cacheKey, request);
    try { return await request; }
    finally { if (pending.get(cacheKey) === request) pending.delete(cacheKey); }
  }
  async function mount(options) {
    const { root, userId, athleteId, weekStart, isCurrent = () => true } = options;
    if (!root || !userId || !athleteId || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return;
    const meta = root.querySelector(".viewer-list-meta");
    const markers = [...root.querySelectorAll("[data-previous-week-marker]")];
    if (!meta || !markers.length) return;
    const token = {};
    mounts.set(root, token);
    const current = () => root.isConnected && mounts.get(root) === token && isCurrent();
    let status = meta.querySelector(".previous-week-status");
    if (!status) { status = document.createElement("span"); status.className = "previous-week-status"; status.setAttribute("role", "status"); meta.append(status); }
    markers.forEach(marker => { marker.hidden = true; });
    status.textContent = "Checking last week…";
    try {
      const keys = await load(options);
      if (!current()) return;
      markers.forEach(marker => { marker.hidden = !keys.has(marker.dataset.previousWeekMarker); });
      status.innerHTML = '<span aria-hidden="true" class="previous-week-legend-tick">✓</span> Landed last week';
      status.title = "A green tick means a landing was recorded in the previous training week. No tick means no matching landing was recorded.";
    } catch {
      if (!current()) return;
      status.textContent = "Last week unavailable ";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => mount(options));
      status.append(retry);
    }
  }
  window.JKPreviousWeekLandings = { marker, mount, clear };
})();
