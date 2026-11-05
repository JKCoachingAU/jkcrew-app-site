(function () {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = cents => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
  const dateLabel = date => /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")) : "Date to confirm";
  const relevant = row => row.session_kind === "additional" || row.park_fee_cents > 0;
  const cost = row => (row.park_fee_cents || 0) + (row.session_kind === "additional" ? row.extra_fee_cents || 0 : 0);
  const unknown = row => row.session_kind === "additional" && row.extra_fee_cents == null;
  const amount = rows => money(rows.reduce((sum, row) => sum + cost(row), 0)) + (rows.some(unknown) ? " + TBC" : "");

  function mount(root, { athlete, loadPage, isActive = () => true } = {}) {
    if (!root) return;
    let busy = false, generation = 0;
    const current = () => root.isConnected && isActive();
    const heading = () => `<header class="psc-heading"><div><span class="psc-eyebrow">Sessions & fees</span><h2>${esc(athlete?.display_name || "Your rider")}’s session costs</h2></div><button type="button" data-cost-refresh${busy ? " disabled" : ""} aria-label="Refresh session costs">${busy ? "Loading…" : "↻ Refresh"}</button></header>`;
    const rowHtml = row => `<li class="psc-session"><div><strong>${esc(row.venue)}</strong><span>${dateLabel(row.session_date)}${row.start_time ? ` · ${esc(row.start_time.slice(0, 5))}` : ""}${row.block_name ? ` · ${esc(row.block_name)}` : ""}</span><span class="psc-tags"><b>${row.session_kind === "additional" ? "Extra session" : "Regular session"} · ${row.session_completed ? "Completed" : "Planned"}</b>${row.invoice_status === "invoiced" ? "<b>Already invoiced</b>" : ""}</span></div><dl>${row.session_kind === "additional" ? `<div><dt>Extra session</dt><dd>${row.extra_fee_cents == null ? "Price TBC" : money(row.extra_fee_cents)}</dd></div>` : ""}${row.park_fee_cents > 0 ? `<div><dt>Park entry${row.park_fee_allocation === "shared" ? " share" : ""}</dt><dd>${money(row.park_fee_cents)}</dd></div><small>${row.park_fee_paid_by_coach ? "Paid by coach" : "Planned · coach payment not recorded"}</small>` : ""}</dl></li>`;
    const listHtml = rows => `<ul class="psc-sessions">${rows.map(rowHtml).join("")}</ul>`;
    function render(rows) {
      const items = rows.filter(relevant);
      const extras = items.filter(row => row.session_kind === "additional");
      const completed = extras.filter(row => row.session_completed).length;
      const paid = items.filter(row => row.park_fee_paid_by_coach && row.park_fee_cents > 0);
      const upcoming = items.filter(row => row.invoice_status !== "invoiced");
      const invoiced = items.filter(row => row.invoice_status === "invoiced");
      const groups = new Map();
      for (const row of upcoming) {
        const key = row.invoice_date || "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      root.innerHTML = `<section class="psc-card" aria-label="Session costs" aria-busy="false">${heading()}
        <div class="psc-metrics"><div><small>Extra sessions completed</small><strong data-cost-completed>${completed}</strong><span>${extras.length - completed} planned</span></div><div><small>Entry paid by coach</small><strong data-cost-paid>${money(paid.reduce((sum, row) => sum + row.park_fee_cents, 0))}</strong><span>${paid.length} ${paid.length === 1 ? "entry" : "entries"} recorded</span></div><div><small>Expected extras & entry</small><strong data-cost-expected>${amount(upcoming)}</strong><span>Not yet marked invoiced</span></div></div>
        <p class="psc-note">AUD · Recorded extras and park entry only. Regular lesson fees are not included. Planned costs can change.</p>
        ${items.length ? `<div class="psc-invoices"><h3>Expected invoices</h3>${groups.size ? [...groups.keys()].sort((a, b) => a ? b ? a.localeCompare(b) : -1 : 1).map(key => {
          const group = groups.get(key);
          const ordered = group.slice().sort((a, b) => a.session_date.localeCompare(b.session_date) || a.id.localeCompare(b.id));
          return `<details class="psc-invoice"><summary><span><strong>${key ? `Invoice expected · ${dateLabel(key)}` : "Invoice date to confirm"}</strong><small>${group.length} ${group.length === 1 ? "session" : "sessions"}${group.some(unknown) ? " · extra-session price to confirm" : ""}</small></span><b>${amount(group)}</b><i aria-hidden="true">⌄</i></summary>${listHtml(ordered)}</details>`;
        }).join("") : '<p class="psc-empty">No extra sessions or entry fees awaiting an invoice.</p>'}</div>${invoiced.length ? `<details class="psc-invoice psc-history"><summary><span><strong>Already invoiced</strong><small>${invoiced.length} recorded ${invoiced.length === 1 ? "session" : "sessions"}</small></span><i aria-hidden="true">⌄</i></summary>${listHtml(invoiced)}</details>` : ""}` : '<p class="psc-empty">No extra sessions or park entry fees recorded yet. They’ll appear here when your coach adds them.</p>'}
      </section>`;
    }
    async function refresh() {
      if (!current() || busy) return;
      busy = true;
      const version = ++generation;
      root.innerHTML = `<section class="psc-card" aria-label="Session costs" aria-busy="true">${heading()}<p class="psc-empty" role="status">Loading recorded sessions and fees…</p></section>`;
      try {
        // Totals are displayed only after every page has arrived. No private data
        // is persisted locally, and this card never polls in the background.
        const rows = [], seen = new Set();
        let snapshot = null;
        for (let page = 0; page < 20; page++) {
          const result = await loadPage(rows.length);
          if (!current() || version !== generation) return;
          if (!result || !Array.isArray(result.sessions) || typeof result.hasMore !== "boolean") throw new Error("Invalid session response");
          if (typeof result.snapshot !== "string" || !result.snapshot.trim()
              || (snapshot !== null && result.snapshot !== snapshot)) throw new Error("Sessions changed while loading");
          snapshot = result.snapshot;
          for (const row of result.sessions) {
            if (!row?.id || seen.has(row.id)) throw new Error("Sessions changed while loading");
            if (!Number.isSafeInteger(row.park_fee_cents) || row.park_fee_cents < 0 || row.park_fee_cents > 1000000
                || (row.extra_fee_cents != null && (!Number.isSafeInteger(row.extra_fee_cents) || row.extra_fee_cents < 0 || row.extra_fee_cents > 1000000))) throw new Error("Invalid fee response");
            seen.add(row.id); rows.push(row);
          }
          if (!result.hasMore) { busy = false; render(rows); return; }
          if (!result.sessions.length) throw new Error("Incomplete session response");
        }
        throw new Error("Too many session records");
      } catch (_) {
        if (!current() || version !== generation) return;
        busy = false;
        root.innerHTML = `<section class="psc-card" aria-label="Session costs" aria-busy="false">${heading()}<p class="psc-error" role="alert">Session costs couldn’t be loaded. Check your connection and try Refresh. No totals are shown until all records are available.</p></section>`;
      } finally { busy = false; }
    }
    root.addEventListener("click", event => { if (event.target.closest("[data-cost-refresh]") && current()) void refresh(); });
    return { ready: refresh(), refresh };
  }
  window.JKCParentSessionCosts = { mount };
})();
