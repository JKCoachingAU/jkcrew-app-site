/* Independent Daily Round 2. Eligibility, reveals and points are server-owned. */
(function (global) {
  'use strict';
  const instances = new Set();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m13 2-8 12h6l-1 8 9-13h-6l1-7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function mount(element, options) {
    if (!element || !options?.client || !options.athleteId) throw new Error('Tier 2 requires a host, client and rider.');
    let disposed = false, busy = false, data = null, error = '', request = 0, reveal = false, resetTimer = null;
    const active = () => !disposed && element.isConnected !== false && (!options.isCurrent || options.isCurrent());
    const canEdit = () => !!options.canEdit && !data?.historical;
    const rpc = async (name, args = {}) => {
      if (!active()) return null;
      let timeout;
      const result = await Promise.race([
        options.client.rpc(name, { p_athlete_id: options.athleteId, ...args }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('The connection is taking too long. Please retry.')), options.timeoutMs || 15000); })
      ]).finally(() => clearTimeout(timeout));
      if (!active()) return null;
      if (result.error) throw new Error(result.error.message || 'Could not save Round 2. Try again.');
      if (!result.data || typeof result.data !== 'object' || typeof result.data.unlocked !== 'boolean') throw new Error('The saved response could not be confirmed. Please retry.');
      return result.data;
    };
    const notify = value => { try { Promise.resolve(options.onChange?.(value)).catch(() => {}); } catch (_) {} };
    function scheduleReset() {
      clearTimeout(resetTimer);
      if (data?.reset_at && !data.historical) {
        const delay = Date.parse(data.reset_at) - Date.now() + 500;
        if (delay > 0) resetTimer = setTimeout(() => refresh(), Math.min(delay, 2147483647));
      }
    }
    function render() {
      if (!active()) return;
      element.hidden = !data?.unlocked;
      if (element.hidden && error && options.eligibleHint) {
        element.hidden = false;
        element.innerHTML = `<section class="daily-tier-two" aria-label="Daily Tier 2"><h3>Tier 2</h3><div class="daily-tier-two__error" role="alert">${escape(error)} <button type="button" data-tier-two-action="refresh">Retry</button></div></section>`;
        return;
      }
      if (element.hidden) { element.innerHTML = ''; return; }
      const focusKey = element.contains(document.activeElement) ? document.activeElement?.dataset?.tierTwoFocus : null;
      const done = !!data.completed_at, total = Number(data.total_count) || 0, count = Number(data.completed_count) || 0;
      const closed = options.canReveal && !data.revealed_at && !done;
      element.innerHTML = `<section class="daily-tier-two${reveal ? ' daily-tier-two--reveal' : ''}${done ? ' daily-tier-two--complete' : ''}" aria-label="Daily Tier 2" aria-busy="${busy}">
        ${reveal ? '<div class="daily-tier-two__particles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' : ''}
        <div class="daily-tier-two__header"><span class="daily-tier-two__symbol">${icon}</span><div><span class="daily-tier-two__eyebrow">${closed ? 'A little extra. Just unlocked.' : 'Daily · Tier 2'}</span><h3>${done ? 'Tier 2 complete' : closed || reveal ? 'Tier 2 Unlocked' : 'Tier 2'}</h3></div><span class="daily-tier-two__reward">${done ? '+4 earned' : '+4 points'}</span></div>
        ${closed ? `<p>You finished your Daily list. There’s one more round waiting for you.</p><button class="daily-tier-two__open" data-tier-two-action="reveal" data-tier-two-focus="reveal" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Opening…' : 'Open Tier 2'}<span aria-hidden="true">↗</span></button>` : `
          <p class="daily-tier-two__intro">${data.source === 'daily_round_two' ? 'Round 2: land your Daily tricks once more. A fresh round, at your own pace.' : 'Your coach’s extra challenge. Land each trick at your own pace.'} ${done ? '' : 'Complete the whole round to earn 4 points in total.'}</p>
          <div class="daily-tier-two__progress"><span>${count} of ${total} landed</span><span>${done ? 'Saved for today' : data.historical ? 'Saved round' : 'Resets with your Daily list'}</span><progress value="${count}" max="${Math.max(total, 1)}" aria-label="Round 2 tricks landed">${count}/${total}</progress></div>
          ${data.scoring_paused && !done ? '<p class="daily-tier-two__notice">Scoring is paused. Contact your coach before continuing.</p>' : ''}
          <div class="daily-tier-two__list">${(data.items || []).map((item, index) => `<label class="daily-tier-two__trick${item.landed ? ' is-landed' : ''}" style="--tier-index:${Math.min(index, 10)}"><input type="checkbox" data-tier-two-item="${escape(item.id)}" data-tier-two-focus="${escape(item.id)}" ${item.landed ? 'checked' : ''} ${busy || done || !canEdit() || (data.scoring_paused && !item.landed) ? 'disabled' : ''}><span class="daily-tier-two__tick" aria-hidden="true">${item.landed ? '✓' : String(index + 1).padStart(2, '0')}</span><span><strong>${escape(item.trick_name)}</strong>${item.notes ? `<small>${escape(item.notes)}</small>` : ''}</span></label>`).join('')}</div>
          ${canEdit() && !done ? `<button class="daily-tier-two__finish" type="button" data-tier-two-action="complete" data-tier-two-focus="complete" ${busy || count !== total || !total || data.scoring_paused ? 'disabled' : ''}>${busy ? 'Saving…' : 'Complete round · +4'}<span aria-hidden="true">✓</span></button>` : ''}
          ${done ? '<p class="daily-tier-two__saved" role="status">All done. Your 4 points are saved.</p>' : ''}`}
        ${error ? `<div class="daily-tier-two__error" role="alert">${escape(error)} <button type="button" data-tier-two-action="refresh">Retry</button></div>` : ''}
        <span class="daily-tier-two__sr" role="status" aria-live="polite">${done ? 'Tier 2 completed. Four points earned.' : reveal ? 'Tier 2 unlocked. Your extra challenge is ready.' : ''}</span>
      </section>`;
      if (focusKey) {
        const target = [...element.querySelectorAll('[data-tier-two-focus]')].find(node => node.dataset.tierTwoFocus === focusKey);
        (target || (focusKey === 'reveal' ? element.querySelector('[data-tier-two-item]') : null))?.focus({ preventScroll: true });
      }
      reveal = false;
    }
    async function refresh({ eligibleHint } = {}) {
      if (typeof eligibleHint === 'boolean') options.eligibleHint = eligibleHint;
      if (!active() || busy) return data;
      const token = ++request;
      try {
        let next = await rpc('get_daily_tier_two', options.localDate ? { p_local_date: options.localDate } : {});
        if (!active() || token !== request || !next) return null;
        if (!next.unlocked && next.eligible && options.canEdit && !options.localDate) next = await rpc('unlock_daily_tier_two');
        if (!active() || token !== request || !next) return null;
        data = next; error = ''; scheduleReset(); render(); return data;
      } catch (failure) {
        if (active() && token === request) { error = failure.message; render(); options.onError?.(failure); }
        return null;
      }
    }
    async function mutate(name, args = {}) {
      if (!active() || busy) return;
      busy = true; error = ''; request += 1; render();
      try {
        const next = await rpc(name, args);
        if (!active() || !next) return;
        data = next;
        reveal = next.reveal_claimed === true && !global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        scheduleReset(); notify(next);
      } catch (failure) { if (active()) error = failure.message; }
      finally { busy = false; if (active()) render(); }
    }
    function onClick(event) {
      const button = event.target.closest('[data-tier-two-action]');
      if (!button || !element.contains(button)) return;
      const action = button.dataset.tierTwoAction;
      if (action === 'refresh') refresh();
      else if (action === 'reveal' && options.canReveal) mutate('claim_daily_tier_two_reveal');
      else if (action === 'complete' && canEdit()) mutate('complete_daily_tier_two');
    }
    function onChange(event) {
      const input = event.target.closest('[data-tier-two-item]');
      if (input && element.contains(input) && canEdit()) mutate('record_daily_tier_two_trick', { p_item_id: input.dataset.tierTwoItem, p_landed: input.checked });
    }
    const onVisible = () => { if (document.visibilityState !== 'hidden') refresh(); };
    element.hidden = true;
    element.addEventListener('click', onClick); element.addEventListener('change', onChange);
    document.addEventListener('visibilitychange', onVisible); global.addEventListener('focus', onVisible);
    const interval = setInterval(() => { if (document.visibilityState !== 'hidden' && active()) refresh(); }, 30000);
    const controller = {
      refresh, getState: () => data,
      destroy() {
        disposed = true; request += 1; clearInterval(interval); clearTimeout(resetTimer);
        element.removeEventListener('click', onClick); element.removeEventListener('change', onChange);
        document.removeEventListener('visibilitychange', onVisible); global.removeEventListener('focus', onVisible);
        element.replaceChildren(); element.hidden = true; instances.delete(controller);
      }
    };
    instances.add(controller); controller.ready = refresh(); return controller;
  }
  function mountEditor(element, options) {
    let disposed = false, busy = false, rows = [], message = '', custom = false;
    const active = () => !disposed && element.isConnected !== false && (!options.isCurrent || options.isCurrent());
    const escapeRows = () => rows.map(item => `${item.trick_name}${item.notes ? ` | ${item.notes}` : ''}`).join('\n');
    function render() {
      if (!active()) return;
      element.innerHTML = `<section class="daily-tier-two daily-tier-two--editor"><div class="daily-tier-two__header"><span class="daily-tier-two__symbol">${icon}</span><div><span class="daily-tier-two__eyebrow">Coach content</span><h3>Daily Round 2</h3></div></div><p>Unlocks after a full Daily finish. The default is a fresh round of the rider’s Daily tricks. Set a custom challenge below, or keep the default.</p><label class="daily-tier-two__editor-label">Custom tricks <span>One per line · up to 20. Optional notes after |</span><textarea data-tier-two-template rows="5" maxlength="6200" placeholder="Manual | Choose a comfortable distance&#10;Bunny hop" ${busy ? 'disabled' : ''}>${escape(escapeRows())}</textarea></label><p class="daily-tier-two__muted">Changes apply to the next unlock. A round already unlocked today stays the same.</p><div class="daily-tier-two__editor-actions"><button class="daily-tier-two__finish" data-tier-two-template-action="save" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save custom round'}</button><button class="daily-tier-two__secondary" data-tier-two-template-action="default" type="button" ${busy || !custom ? 'disabled' : ''}>Use Daily list</button></div><p role="status" class="daily-tier-two__muted">${escape(message || (custom ? 'Custom challenge active' : 'Default Daily round active'))}</p></section>`;
    }
    async function call(name, params = {}) {
      let timeout;
      const response = await Promise.race([
        options.client.rpc(name, { p_athlete_id: options.athleteId, ...params }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('The connection is taking too long. Please retry.')), options.timeoutMs || 15000); })
      ]).finally(() => clearTimeout(timeout));
      if (response.error) throw new Error(response.error.message || 'Could not save the challenge.');
      return response.data;
    }
    async function refresh() {
      if (!active() || busy) return;
      try { const data = await call('get_daily_tier_two_template'); if (active()) { rows = data.items || []; custom = !data.default_round; render(); } }
      catch (failure) { if (active()) { message = failure.message; render(); } }
    }
    async function click(event) {
      const button = event.target.closest('[data-tier-two-template-action]');
      if (!button || !element.contains(button) || !active() || busy) return;
      const text = element.querySelector('[data-tier-two-template]').value;
      rows = text.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const split = line.indexOf('|'); return { trick_name: (split < 0 ? line : line.slice(0, split)).trim(), notes: split < 0 ? '' : line.slice(split + 1).trim() }; });
      busy = true; message = ''; render();
      try { const data = await call('set_daily_tier_two_template', { p_items: button.dataset.tierTwoTemplateAction === 'default' ? null : rows }); if (active()) { rows = data.items || []; custom = !data.default_round; message = 'Challenge saved.'; } }
      catch (failure) { if (active()) message = failure.message; }
      finally { busy = false; if (active()) render(); }
    }
    element.addEventListener('click', click);
    const controller = { refresh, destroy() { disposed = true; element.removeEventListener('click', click); element.replaceChildren(); instances.delete(controller); } };
    instances.add(controller); controller.ready = refresh(); return controller;
  }
  global.JKCrewDailyTierTwo = Object.freeze({ mount, mountEditor, destroyAll() { [...instances].forEach(instance => instance.destroy()); } });
})(window);
