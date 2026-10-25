/* Public UCI data only. Loaded on demand; never shares an app session or token. */
(() => {
  "use strict";
  const feedUrl = "https://raw.githubusercontent.com/JKCoachingAU/jkcrew-app-site/uci-rankings/rankings.json";
  const seedUrl = new URL("data/uci-rankings.json", document.currentScript?.src || window.location.href).href;
  const storageKey = "jkcrew-uci-rankings-v1";
  const refreshMs = 60 * 60 * 1000;
  let snapshot = null;
  let loadedAt = 0;
  let pending = null;
  let lastRefreshFailed = false;
  let notificationPending = false;

  function validate(data) {
    if (data?.schemaVersion !== 1 || !Number.isFinite(Date.parse(data.checkedAt)) || Date.parse(data.checkedAt) > Date.now() + 86400000) throw Error("Invalid ranking snapshot");
    for (const gender of ["men", "women"]) {
      const category = data.categories?.[gender];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(category?.rankingDate || "") || !Number.isFinite(Date.parse(category.rankingDate))) throw Error("Invalid ranking date");
      const source = new URL(category.sourceUrl);
      if (source.protocol !== "https:" || !["dataride.uci.org", "dataride.uci.ch", "www.uci.org"].includes(source.hostname)) throw Error("Invalid ranking source");
      if (!Array.isArray(category.rows) || !category.rows.length || category.rows.length > 5000) throw Error("Rankings unavailable");
      let rank = 0;
      for (const row of category.rows) {
        if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank < rank || typeof row.name !== "string" || !row.name.trim() || row.name.length > 200 || typeof row.nation !== "string" || row.nation.length > 10 || !Number.isFinite(row.points) || row.points < 0) throw Error("Invalid ranking row");
        rank = row.rank;
      }
    }
    return data;
  }

  function newest(candidate, previous) {
    if (!previous) return candidate;
    // A failed upstream refresh must never roll a category back to an older week.
    if (["men", "women"].some(key => candidate.categories[key].rankingDate < previous.categories[key].rankingDate)) return previous;
    return Date.parse(candidate.checkedAt) < Date.parse(previous.checkedAt) ? previous : candidate;
  }

  async function fetchSnapshot(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { credentials: "omit", cache: "no-store", signal: controller.signal, referrerPolicy: "no-referrer" });
      if (!response.ok) throw Error("Rankings temporarily unavailable");
      return validate(await response.json());
    } finally { clearTimeout(timeout); }
  }

  function restore() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey));
      if (!stored) return;
      snapshot = validate(stored.data);
      loadedAt = Number(stored.loadedAt) || 0;
      // A release adding event evidence should refresh old aggregate-only caches.
      if (!snapshot.eventBreakdowns) loadedAt = 0;
      if (loadedAt > Date.now()) loadedAt = 0;
    } catch { /* Storage may be blocked or contain a snapshot from an older release. */ }
  }

  function result(data, offline = lastRefreshFailed) {
    return { ...data, stale: offline || Date.now() - Date.parse(data.checkedAt) > 3 * 86400000 };
  }

  function peek() {
    if (!snapshot) restore();
    return snapshot ? result(snapshot) : null;
  }

  function published(data, offline = lastRefreshFailed) {
    // Navigation reads peek() after this signal; never dispatch during a load call.
    if (!notificationPending) {
      notificationPending = true;
      queueMicrotask(() => {
        notificationPending = false;
        window.dispatchEvent(new Event("jkcrew:uci-rankings-updated"));
      });
    }
    return result(data, offline);
  }

  async function load({ force = false } = {}) {
    if (pending) return pending;
    if (!snapshot) restore();
    if (!force && snapshot && Date.now() - loadedAt < refreshMs) return published(snapshot);
    pending = (async () => {
      try {
        const remote = await fetchSnapshot(feedUrl, 12000);
        const next = newest(remote, snapshot);
        const rolledBack = next !== remote;
        lastRefreshFailed = rolledBack;
        snapshot = next;
        loadedAt = Date.now();
        try { localStorage.setItem(storageKey, JSON.stringify({ data: snapshot, loadedAt })); } catch { /* In-memory cache still works. */ }
        return published(snapshot, rolledBack);
      } catch {
        lastRefreshFailed = true;
        if (!snapshot) {
          try { snapshot = await fetchSnapshot(seedUrl, 5000); } catch { /* Show retry UI if neither source is available. */ }
        }
        if (snapshot) return published(snapshot, true);
        throw Error("World rankings couldn’t load. Check your connection and try again.");
      } finally { pending = null; }
    })();
    return pending;
  }

  function findRider(data, uciId) {
    const id = String(uciId || "");
    if (!/^\d{11}$/.test(id)) return null;
    const matches = [];
    for (const categoryKey of ["men", "women"]) {
      const category = data?.categories?.[categoryKey];
      for (const row of category?.rows || []) {
        if (row.uciId === id) matches.push({ row, category, categoryKey });
      }
    }
    // Never guess from a nickname or choose an arbitrary duplicate identity.
    return matches.length === 1 ? matches[0] : null;
  }

  function findBreakdown(data, uciId) {
    const match = findRider(data, uciId);
    const item = data?.eventBreakdowns?.[String(uciId)];
    if (!match || !item || !["current", "stale", "unavailable"].includes(item.status)) return null;
    if (item.category !== match.categoryKey) return null;
    try {
      const source = new URL(item.sourceUrl);
      if (source.protocol !== "https:" || !["dataride.uci.org", "dataride.uci.ch", "www.uci.org"].includes(source.hostname) || source.username || source.password) return null;
      if (item.status === "unavailable") return { status: "unavailable", category: item.category, sourceUrl: source.href, events: [] };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.rankingDate) || !Number.isFinite(Date.parse(item.rankingDate))
          || item.rankingDate > match.category.rankingDate || !Number.isFinite(Date.parse(item.checkedAt))
          || Date.parse(item.checkedAt) > Date.now() + 86400000 || !Number.isFinite(item.totalPoints) || item.totalPoints < 0
          || !Array.isArray(item.events) || !item.events.length || item.events.length > 300) return null;
      if (item.status === "current" && (item.rankingDate !== match.category.rankingDate || item.totalPoints !== match.row.points)) return null;
      const ids = new Set();
      let counted = 0;
      const events = item.events.map(event => {
        if (!event || typeof event.id !== "string" || !event.id || event.id.length > 100 || ids.has(event.id)
            || typeof event.name !== "string" || !event.name.trim() || event.name.length > 300
            || !["counted", "outside_best_results"].includes(event.inclusion)
            || !Number.isFinite(event.points) || event.points < 0
            || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !Number.isFinite(Date.parse(event.date))
            || !["string", "number"].includes(typeof event.placing) || String(event.placing).length > 40
            || String(event.classCode || "").length > 30 || String(event.className || "").length > 100) throw Error("Invalid event evidence");
        ids.add(event.id);
        if (event.inclusion === "counted") counted += event.points;
        return { id: event.id, name: event.name, date: event.date, placing: event.placing, points: event.points,
          classCode: String(event.classCode || ""), className: String(event.className || ""), inclusion: event.inclusion };
      });
      if (Math.abs(counted - item.totalPoints) > .001) return null;
      return { status: data.stale && item.status === "current" ? "stale" : item.status, category: item.category,
        rankingDate: item.rankingDate, checkedAt: item.checkedAt, sourceUrl: source.href, totalPoints: item.totalPoints, events };
    } catch { return null; }
  }

  window.JKCUciRankings = Object.freeze({ load, peek, findRider, findBreakdown });
})();
