(function (global) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const PAGE_SIZE = 12;
  const REFRESH_MS = 20000;

  function sectionHtml({ rider } = {}) {
    const parent = Boolean(rider?.id);
    const name = escape(rider?.display_name || 'Your child');
    return `<section id="active-rider-battles" class="crew-live-battles${parent ? ' parent-live-battles' : ''}" aria-labelledby="active-battles-title">
      <header class="crew-live-head"><div><div class="eyebrow">${parent ? "Your rider · Right now" : "The crew · Right now"}</div><h2 id="active-battles-title">Active <span>Battles</span></h2><p>${parent ? `${name}’s teams, scores and time remaining.` : "See who's going head to head."}</p></div><span class="crew-live-badge" data-active-battles-state>Connecting</span></header>
      <div class="crew-live-toolbar"><p data-active-battles-status role="status" aria-live="polite">Loading live matchups…</p><button class="secondary-btn compact-btn" type="button" data-active-battles-refresh aria-label="Refresh active battles">Refresh</button></div>
      <div class="crew-live-grid" data-active-battles-list aria-busy="true"></div>
      <nav class="crew-live-pages" aria-label="Active battles pages"><button class="secondary-btn compact-btn" type="button" data-active-battles-previous hidden>← Previous</button><span data-active-battles-page></span><button class="secondary-btn compact-btn" type="button" data-active-battles-more hidden>More battles →</button></nav>
    </section>`;
  }

  function cardHtml(battle, userId, { rider } = {}) {
    const participants = Array.isArray(battle.participants) ? battle.participants : [];
    const teams = (Array.isArray(battle.teams) ? battle.teams : []).slice(0, 3);
    const scores = teams.filter(team => !team.forfeited).map(team => number(team.score));
    const highest = Math.max(0, ...scores);
    const leaders = scores.filter(score => score === highest).length;
    const highlightId = rider?.id || userId;
    const mine = participants.some(member => member.athlete_id === highlightId);
    return `<article class="crew-live-match" data-active-battle-id="${escape(battle.id)}">
      <div class="crew-live-match-head"><strong>${escape(battle.format || teams.map(team => participants.filter(rider => Number(rider.team_number) === Number(team.team_number)).length).join('v'))}</strong>${mine ? `<span class="crew-live-mine">${rider ? 'Your child’s battle' : 'Your battle'}</span>` : '<span>Live matchup</span>'}<time data-active-battle-end="${escape(battle.ends_at)}" datetime="${escape(battle.ends_at)}"></time></div>
      <div class="crew-live-teams" style="--battle-sides:${teams.length}">${teams.map(team => {
        const roster = participants.filter(rider => Number(rider.team_number) === Number(team.team_number));
        const leading = !team.forfeited && highest > 0 && leaders === 1 && number(team.score) === highest;
        return `<section class="crew-live-team team-${number(team.team_number)}${leading ? ' is-leading' : ''}"><div class="crew-live-team-label"><span>Team ${number(team.team_number)}</span><small>${team.forfeited ? 'Forfeited' : leading ? 'Leading' : highest > 0 && leaders > 1 && number(team.score) === highest ? 'Tied' : ''}</small></div><div class="crew-live-score"><strong>${number(team.score)}</strong><span>pts</span></div><ul>${roster.map(member => `<li class="${member.forfeited_at ? 'is-forfeited' : ''}${rider && member.athlete_id === highlightId ? ' is-linked-child' : ''}"><span class="crew-live-initial" aria-hidden="true">${escape(String(member.display_name || 'Rider').trim().charAt(0).toUpperCase())}</span><span>${escape(member.display_name || 'Rider')}${rider && member.athlete_id === highlightId ? '<small>Your child</small>' : ''}${member.forfeited_at ? '<small>Forfeited</small>' : ''}</span></li>`).join('')}</ul></section>`;
      }).join('')}</div>
      <footer><span>${number(battle.reward_points)} pts per team</span><span>${rider ? "Reward settled after finish" : "Battle score"}</span></footer>
    </article>`;
  }

  function mount(host, options) {
    if (!host) return { refresh: async () => {}, destroy() {} };
    const { client, userId, currentUser, canAccess, rider } = options;
    const parent = Boolean(rider?.id);
    const name = escape(rider?.display_name || "Your child");
    const list = host.querySelector('[data-active-battles-list]');
    const status = host.querySelector('[data-active-battles-status]');
    const badge = host.querySelector('[data-active-battles-state]');
    const refreshButton = host.querySelector('[data-active-battles-refresh]');
    const more = host.querySelector('[data-active-battles-more]');
    const previous = host.querySelector('[data-active-battles-previous]');
    const pageLabel = host.querySelector('[data-active-battles-page]');
    let destroyed = false, pending = null, abort = null, timer = null;
    let rows = [], loaded = false, failed = false, accessDenied = false, signature = '', clockOffset = 0;
    let cursor = null, nextCursor = null, history = [], lastRead = 0, nextRead = 0;
    const valid = () => !destroyed && host.isConnected && currentUser() === userId && canAccess();
    const online = () => navigator.onLine !== false;
    const visible = () => document.visibilityState !== 'hidden';
    const serverNow = () => Date.now() + clockOffset;
    const currentRows = () => rows.filter(row => Date.parse(row.starts_at) <= serverNow() && Date.parse(row.ends_at) > serverNow());
    const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
    const setStatus = () => {
      const stale = !online() || failed;
      const count = currentRows().length;
      badge.classList.toggle('is-live', loaded && !stale && (!parent || count > 0));
      host.classList.toggle('is-empty', parent && loaded && !count && !failed);
      setText(badge, !online() ? 'Offline' : failed ? 'Update delayed' : loaded ? parent ? count ? 'In a battle' : 'No active battle' : 'Live' : 'Connecting');
      setText(status, !online() ? (loaded ? 'Offline · showing the last available scores.' : 'You’re offline. Reconnect to see live battles.')
        : pending ? (loaded ? 'Updating scores…' : 'Loading live matchups…')
        : accessDenied ? 'Battle access changed. Reopen Home to check your child’s link.'
        : failed ? (loaded ? 'Scores couldn’t refresh. Showing the last update — try Refresh.' : 'Battles couldn’t load. Tap Retry to try again.')
        : loaded ? `${currentRows().length} active ${currentRows().length === 1 ? 'battle' : 'battles'}${history.length || nextCursor ? ' on this page' : ''} · refreshes every 20 seconds` : 'Loading live matchups…');
      refreshButton.textContent = failed && !loaded ? 'Retry' : 'Refresh';
      refreshButton.setAttribute('aria-label', failed && !loaded ? 'Retry active battles' : 'Refresh active battles');
      refreshButton.disabled = Boolean(pending) || !online();
      previous.disabled = more.disabled = Boolean(pending) || !online();
      previous.hidden = history.length === 0;
      more.hidden = !nextCursor;
      pageLabel.textContent = history.length || nextCursor ? `Page ${history.length + 1}` : '';
      list.setAttribute('aria-busy', String(Boolean(pending)));
    };
    const paint = () => {
      const live = currentRows();
      const nextSignature = JSON.stringify([live, loaded, failed && !loaded, online(), history.length]);
      if (signature !== nextSignature) {
        signature = nextSignature;
        list.innerHTML = live.length ? live.map(row => cardHtml(row, userId, { rider })).join('') : loaded
          ? `<div class="crew-live-empty"><span aria-hidden="true">⚡</span><strong>${history.length ? 'No live battles left on this page' : failed || !online() ? 'No current battles in the last update' : parent ? `No active battles for ${name}` : 'No battles live right now'}</strong><p>${history.length ? 'Use Previous to see the earlier matchups.' : parent ? 'Their next live battle will appear here.' : 'Once a battle starts, everyone can follow it here.'}</p></div>`
          : failed || !online() ? `<div class="crew-live-empty"><strong>Live matchups are unavailable</strong><p>${parent ? 'Your child’s other home updates are still available.' : 'Your own battle controls are still below.'}</p></div>` : '<div class="crew-live-skeleton" aria-hidden="true"></div>';
      }
      host.querySelectorAll('[data-active-battle-end]').forEach(element => {
        const remaining = Math.max(0, Math.ceil((Date.parse(element.dataset.activeBattleEnd) - serverNow()) / 60000));
        const text = remaining >= 1440 ? `${Math.floor(remaining / 1440)}d ${Math.floor(remaining % 1440 / 60)}h left` : remaining >= 60 ? `${Math.floor(remaining / 60)}h ${remaining % 60}m left` : `${remaining}m left`;
        setText(element, text);
      });
      setStatus();
    };
    const refresh = (direction = 'refresh') => {
      if (!valid()) { destroy(); return Promise.resolve(); }
      if (pending) return pending;
      if (!online() || !visible()) { paint(); return Promise.resolve(); }
      const requestedCursor = direction === 'next' ? nextCursor : direction === 'previous' ? history.at(-1) : cursor;
      if (direction === 'next' && !nextCursor || direction === 'previous' && !history.length) return Promise.resolve();
      abort = new AbortController();
      const controller = abort;
      const startedAt = Date.now();
      // Defer query construction until the promise is installed, coalescing fast taps.
      pending = Promise.resolve().then(async () => {
        const params = { p_limit: PAGE_SIZE, p_after_ends_at: requestedCursor?.ends_at || null, p_after_id: requestedCursor?.id || null };
        if (parent) params.p_athlete_id = rider.id;
        let query = client.rpc(parent ? 'get_parent_active_rider_battles' : 'get_active_rider_battles', params);
        if (typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);
        const { data, error } = await options.withTimeout(query, 'Active battles', 15000);
        if (!valid()) return;
        if (error) {
          if (parent && ['42501', '401', '403', 'PGRST301'].includes(String(error.code || error.status))) {
            rows = []; loaded = false; accessDenied = true;
            cursor = null; nextCursor = null; history = [];
          }
          throw error;
        }
        if (parent && data?.athlete_id !== rider.id) throw Error('Mismatched rider response');
        if (!data || !Array.isArray(data.battles) || !Number.isFinite(Date.parse(data.server_now))) throw Error('Invalid battle response');
        clockOffset = Date.parse(data.server_now) - (startedAt + Date.now()) / 2;
        rows = data.battles.filter(battle => !parent || (Array.isArray(battle.participants) && battle.participants.some(member => member.athlete_id === rider.id))).slice(0, PAGE_SIZE);
        if (direction === 'next') history.push(cursor);
        else if (direction === 'previous') history.pop();
        cursor = requestedCursor;
        nextCursor = data.has_more && data.next_cursor?.ends_at && data.next_cursor?.id ? data.next_cursor : null;
        loaded = true; failed = false; accessDenied = false; lastRead = Date.now();
      }).catch(error => {
        if (!valid()) return;
        failed = true;
        // Never replace a good snapshot or a rider's form with a network error.
      }).finally(() => {
        controller.abort();
        pending = null; abort = null; nextRead = Date.now() + REFRESH_MS;
        if (valid()) paint();
      });
      paint();
      return pending;
    };
    const tick = () => {
      if (!valid()) { destroy(); return; }
      if (visible()) {
        paint();
        if (online() && Date.now() >= nextRead) void refresh();
      }
      timer = setTimeout(tick, 1000);
    };
    const resume = () => {
      if (!valid()) { destroy(); return; }
      paint();
      if (visible() && online() && Date.now() - lastRead >= 1000) void refresh();
    };
    const onRefresh = () => { void refresh(); };
    const onNext = () => { void refresh('next'); };
    const onPrevious = () => { void refresh('previous'); };
    function destroy() {
      if (destroyed) return;
      destroyed = true; clearTimeout(timer); abort?.abort(); rows = [];
      refreshButton.removeEventListener('click', onRefresh);
      more.removeEventListener('click', onNext); previous.removeEventListener('click', onPrevious);
      document.removeEventListener('visibilitychange', resume);
      global.removeEventListener('online', resume); global.removeEventListener('offline', resume);
      global.removeEventListener('pageshow', resume);
    }
    refreshButton.addEventListener('click', onRefresh);
    more.addEventListener('click', onNext); previous.addEventListener('click', onPrevious);
    document.addEventListener('visibilitychange', resume);
    global.addEventListener('online', resume); global.addEventListener('offline', resume);
    global.addEventListener('pageshow', resume);
    void refresh(); timer = setTimeout(tick, 1000);
    return { refresh, destroy };
  }

  global.JKCrewActiveBattles = { sectionHtml, mount };
})(window);
