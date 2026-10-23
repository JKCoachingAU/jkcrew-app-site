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
      if (loadedAt > Date.now()) loadedAt = 0;
    } catch { /* Storage may be blocked or contain a snapshot from an older release. */ }
  }

  function result(data, offline = lastRefreshFailed) {
    return { ...data, stale: offline || Date.now() - Date.parse(data.checkedAt) > 3 * 86400000 };
  }

  async function load({ force = false } = {}) {
    if (pending) return pending;
    if (!snapshot) restore();
    if (!force && snapshot && Date.now() - loadedAt < refreshMs) return result(snapshot);
    pending = (async () => {
      try {
        const remote = await fetchSnapshot(feedUrl, 12000);
        const next = newest(remote, snapshot);
        const rolledBack = next !== remote;
        lastRefreshFailed = rolledBack;
        snapshot = next;
        loadedAt = Date.now();
        try { localStorage.setItem(storageKey, JSON.stringify({ data: snapshot, loadedAt })); } catch { /* In-memory cache still works. */ }
        return result(snapshot, rolledBack);
      } catch {
        lastRefreshFailed = true;
        if (!snapshot) {
          try { snapshot = await fetchSnapshot(seedUrl, 5000); } catch { /* Show retry UI if neither source is available. */ }
        }
        if (snapshot) return result(snapshot, true);
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

  window.JKCUciRankings = Object.freeze({ load, findRider });
})();
