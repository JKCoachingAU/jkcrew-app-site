/* Independent Daily Round 2. Eligibility, reveals and points are server-owned. */
(function (global) {
  'use strict';
  const instances = new Set();
  const observerReveals = new Set();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m13 2-8 12h6l-1 8 9-13h-6l1-7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function mount(element, options) {
    if (!element || !options?.client || !options.athleteId) throw new Error('Tier 2 requires a host, client and rider.');
    let disposed = false, busy = false, data = null, error = '', request = 0, reveal = false, resetTimer = null, eligible = false, refreshing = null, dialog = null, revealTimer = null;
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
    const reducedMotion = () => !!global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const canPresent = () => active() && document.visibilityState !== 'hidden' && !document.querySelector('.daily-finish-backdrop, dialog[open]');
    function focusList() {
      if (!active() || !data?.unlocked) return;
      options.onOpen?.(data);
      element.scrollIntoView?.({ block: 'start', behavior: reducedMotion() ? 'instant' : 'smooth' });
      const title = element.querySelector('h3');
      title?.setAttribute('tabindex', '-1'); title?.focus({ preventScroll: true });
      document.dispatchEvent(new CustomEvent('jkcrew:tier-two-opened'));
    }
    function closeReveal(showList = true) {
      clearTimeout(revealTimer);
      if (!dialog) return;
      const current = dialog; dialog = null;
      current.close?.(); current.remove();
      if (showList && active()) { reveal = !reducedMotion(); render(); focusList(); }
    }
    function celebrateUnlock() {
      if (!canPresent() || dialog) return false;
      dialog = document.createElement('dialog');
      dialog.className = 'daily-tier-two-unlock';
      dialog.setAttribute('aria-label', 'Tier 2 Unlocked');
      dialog.innerHTML = `<div class="daily-tier-two-unlock__halo" aria-hidden="true"></div><div class="daily-tier-two-unlock__sparks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><span class="daily-tier-two-unlock__symbol" aria-hidden="true">${icon}</span><p class="daily-tier-two-unlock__eyebrow">Daily Tricks · complete</p><h2>Tier 2<br><span>Unlocked</span></h2><p>You earned the next level.</p><div class="daily-tier-two-unlock__reward"><strong>+4 points</strong><span>when you land the whole new list</span></div><button type="button" data-tier-two-enter>Let’s go <span aria-hidden="true">↗</span></button>`;
      document.body.append(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); closeReveal(); });
      dialog.querySelector('[data-tier-two-enter]').onclick = () => closeReveal();
      dialog.showModal();
      revealTimer = setTimeout(() => closeReveal(), 2400);
      return true;
    }
    function claimObserverReveal() {
      // Coaches can enjoy the handoff on their screen without consuming the
      // rider's server-owned, once-per-day discovery on another device.
      const key = `jkcrew:tier-two-observer:${options.observerId}:${options.athleteId}:${data.local_date}`;
      if (observerReveals.has(key)) return false;
      try { if (global.localStorage.getItem(key)) return false; } catch (_) {}
      observerReveals.add(key);
      try { global.localStorage.setItem(key, 'seen'); } catch (_) {}
      return true;
    }

    function scheduleReset() {
      clearTimeout(resetTimer);
      if (data?.reset_at && !data.historical) {
        const delay = Date.parse(data.reset_at) - Date.now() + 500;
        if (delay > 0) resetTimer = setTimeout(() => refresh(), Math.min(delay, 2147483647));
      }
    }
    function render() {
      if (!active()) return;
      try {
      element.hidden = !data?.unlocked;
      if (element.hidden && error && (eligible || options.eligibleHint)) {
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
      } finally {
        options.onRender?.(data);
      }
    }
    async function refresh({ eligibleHint } = {}) {
      if (typeof eligibleHint === 'boolean') options.eligibleHint = eligibleHint;
      if (!active() || busy) return data;
      if (refreshing) return refreshing;
      const token = ++request;
      refreshing = (async () => {
        try {
          let next = await rpc('get_daily_tier_two', options.localDate ? { p_local_date: options.localDate } : {});
          if (!active() || token !== request || !next) return null;
          eligible = next.eligible === true;
          if (!next.unlocked && next.eligible && options.canEdit && !options.localDate) next = await rpc('unlock_daily_tier_two');
          if (!active() || token !== request || !next) return null;
          data = next; error = ''; scheduleReset();
          // Claim only when this rider can actually see the reveal. The atomic
          // server claim prevents refreshes, retries and other devices replaying it.
          if (options.canReveal && next.unlocked && !next.revealed_at && !next.completed_at && !next.historical && canPresent()) {
            const claimed = await rpc('claim_daily_tier_two_reveal');
            if (!active() || token !== request || !claimed) return null;
            data = claimed;
            render();
            if (claimed.reveal_claimed && canPresent()) { celebrateUnlock(); notify(claimed); }
          } else render();
          return data;
        } catch (failure) {
          if (active() && token === request) { error = failure.message; render(); options.onError?.(failure); }
          return null;
        }
      })();
      try { return await refreshing; } finally { refreshing = null; }
    }
    async function present({ celebrate = false } = {}) {
      // A read started before Daily confirmation may still return "locked".
      // Finish it, then read the newly saved eligibility for this handoff.
      if (refreshing) await refreshing;
      const result = await refresh();
      if (!active() || !result?.unlocked) return false;
      if (!dialog && celebrate && !options.canReveal && options.observerId && canPresent() && claimObserverReveal()) celebrateUnlock();
      if (!dialog) focusList();
      return true;
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
      else if (action === 'reveal' && options.canReveal) present();
      else if (action === 'complete' && canEdit()) mutate('complete_daily_tier_two');
    }
    function onChange(event) {
      const input = event.target.closest('[data-tier-two-item]');
      if (input && element.contains(input) && canEdit()) mutate('record_daily_tier_two_trick', { p_item_id: input.dataset.tierTwoItem, p_landed: input.checked });
    }
    const onVisible = () => { if (document.visibilityState !== 'hidden') refresh(); };
    const onDailyDismissed = () => { if (options.canReveal && !data?.revealed_at) refresh(); };
    element.hidden = true;
    element.addEventListener('click', onClick); element.addEventListener('change', onChange);
    document.addEventListener('visibilitychange', onVisible); document.addEventListener('jkcrew:daily-finish-dismissed', onDailyDismissed); global.addEventListener('focus', onVisible);
    const interval = setInterval(() => { if (document.visibilityState !== 'hidden' && active()) refresh(); }, 30000);
    const controller = {
      refresh, present, getState: () => data,
      destroy() {
        disposed = true; request += 1; clearInterval(interval); clearTimeout(resetTimer); closeReveal(false);
        element.removeEventListener('click', onClick); element.removeEventListener('change', onChange);
        document.removeEventListener('visibilitychange', onVisible); document.removeEventListener('jkcrew:daily-finish-dismissed', onDailyDismissed); global.removeEventListener('focus', onVisible);
        element.replaceChildren(); element.hidden = true; instances.delete(controller);
      }
    };
    instances.add(controller); controller.ready = refresh(); return controller;
  }
  function mountEditor(element, options) {
    let disposed = false, busy = false, loaded = false, custom = false, draft = '', savedRows = [], message = '', revision = 0, request = 0, saving = null;
    const active = () => !disposed && element.isConnected !== false && (!options.isCurrent || options.isCurrent());
    const readDraft = () => element.querySelector('[data-tier-two-template]')?.value ?? draft;
    const parse = text => text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const split = line.indexOf('|');
      return { trick_name: (split < 0 ? line : line.slice(0, split)).trim(), notes: split < 0 ? '' : line.slice(split + 1).trim() };
    });
    const textFor = rows => rows.map(item => `${item.trick_name}${item.notes ? ` | ${item.notes}` : ''}`).join('\n');
    const isDirty = () => JSON.stringify(parse(readDraft())) !== JSON.stringify(savedRows);
    const validateRows = rows => {
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > 20 || rows.some(item => typeof item?.trick_name !== 'string' || !item.trick_name.trim() || item.trick_name.length > 120 || typeof item.notes !== 'string' || item.notes.length > 180 || /[\u0000-\u001f\u007f]/.test(item.trick_name + item.notes))) {
        throw new Error('Add 1–20 tricks with names up to 120 characters and notes up to 180. To remove a custom list, choose Use Daily list.');
      }
      return rows.map(item => ({ trick_name: item.trick_name.trim(), notes: item.notes.trim() }));
    };
    const savedResponse = data => {
      if (!data || typeof data !== 'object' || typeof data.default_round !== 'boolean' || (data.default_round && data.items !== null)) throw new Error('The saved Tier 2 list could not be verified. Your edits are kept; please retry.');
      return data.default_round ? { items: [], custom: false } : { items: validateRows(data.items), custom: true };
    };
    const statusText = () => message || (isDirty() ? 'Unsaved changes · included when you save this Daily list or the full schedule.' : loaded ? custom ? 'Custom challenge active' : 'Default Daily round active' : 'Loading saved Tier 2…');
    function updateStatus() {
      const status = element.querySelector('[data-tier-two-editor-status]');
      if (status) status.textContent = statusText();
      const reset = element.querySelector('[data-tier-two-template-action="default"]');
      if (reset) reset.disabled = busy || (!custom && !isDirty());
    }
    function render() {
      if (!active()) return;
      const input = element.querySelector('[data-tier-two-template]');
      const focused = input === document.activeElement;
      const selection = focused ? [input.selectionStart, input.selectionEnd] : null;
      element.innerHTML = `<section class="daily-tier-two daily-tier-two--editor"><div class="daily-tier-two__header"><span class="daily-tier-two__symbol">${icon}</span><div><span class="daily-tier-two__eyebrow">Coach content</span><h3>Tier 2</h3></div></div><p>Unlocks after a full Daily finish. The default is a fresh round of the rider’s Daily tricks. Set a custom challenge below, or keep the default.</p><label class="daily-tier-two__editor-label">Custom tricks <span>One per line · up to 20. Optional notes after |</span><textarea data-tier-two-template rows="5" maxlength="6200" placeholder="Manual | Choose a comfortable distance&#10;Bunny hop" ${busy ? 'disabled' : ''}>${escape(draft)}</textarea></label><p class="daily-tier-two__muted">Changes apply to the next unlock. A round already unlocked today stays the same.</p><div class="daily-tier-two__editor-actions"><button class="daily-tier-two__finish" data-tier-two-template-action="save" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save Tier 2'}</button><button class="daily-tier-two__secondary" data-tier-two-template-action="default" type="button" ${busy || (!custom && !isDirty()) ? 'disabled' : ''}>Use Daily list</button></div><p role="status" data-tier-two-editor-status class="daily-tier-two__muted">${escape(statusText())}</p></section>`;
      updateStatus();
      if (focused && !busy) {
        const next = element.querySelector('[data-tier-two-template]');
        next.focus({ preventScroll: true }); next.setSelectionRange(...selection);
      }
    }
    async function call(name, params = {}) {
      if (!active()) throw new Error('The selected rider changed. Return to their list before saving.');
      let timeout;
      const response = await Promise.race([
        options.client.rpc(name, { p_athlete_id: options.athleteId, ...params }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('The connection is taking too long. Your edits are kept; please retry.')), options.timeoutMs || 15000); })
      ]).finally(() => clearTimeout(timeout));
      if (!active()) throw new Error('The selected rider changed. Return to their list to check the saved result.');
      if (response.error) throw new Error(response.error.message || 'Could not save the challenge.');
      return savedResponse(response.data);
    }
    async function refresh() {
      if (!active() || busy || isDirty()) return;
      const token = ++request, before = revision;
      try {
        const data = await call('get_daily_tier_two_template');
        if (!active() || token !== request) return;
        savedRows = data.items; custom = data.custom; loaded = true;
        // A delayed initial read must never replace a coach's new text.
        if (revision === before) { draft = textFor(savedRows); message = ''; render(); }
        else updateStatus();
      } catch (failure) { if (active() && token === request) { message = failure.message; updateStatus(); } }
    }
    async function saveIfDirty({ reset = false } = {}) {
      if (saving) return saving;
      if (!active()) throw new Error('The selected rider changed. Return to their list before saving.');
      draft = readDraft();
      if (!reset && !isDirty()) return false;
      const desired = reset ? null : parse(draft);
      try { if (desired) validateRows(desired); }
      catch (failure) { message = failure.message; updateStatus(); throw failure; }
      busy = true; message = ''; ++request; render();
      saving = (async () => {
        try {
          const expected = { items: desired || [], custom: !reset };
          const stored = await call('set_daily_tier_two_template', { p_items: desired });
          if (JSON.stringify(stored) !== JSON.stringify(expected)) throw new Error('The saved Tier 2 list does not match your edits. Please retry.');
          const verified = await call('get_daily_tier_two_template');
          if (JSON.stringify(verified) !== JSON.stringify(expected)) throw new Error('Tier 2 changed before it could be verified. Your edits are kept; please retry.');
          savedRows = verified.items; custom = verified.custom; loaded = true; draft = textFor(savedRows);
          message = 'Tier 2 saved. Ready for the next unlock.';
          return true;
        } catch (failure) { if (active()) message = failure.message; throw failure; }
        finally { busy = false; saving = null; if (active()) render(); }
      })();
      return saving;
    }
    function onInput(event) {
      if (!event.target.matches('[data-tier-two-template]') || !active() || busy) return;
      draft = event.target.value; revision++; message = ''; updateStatus();
    }
    function click(event) {
      const button = event.target.closest('[data-tier-two-template-action]');
      if (!button || !element.contains(button) || !active() || busy) return;
      event.preventDefault();
      void saveIfDirty({ reset: button.dataset.tierTwoTemplateAction === 'default' }).catch(() => {});
    }
    element.addEventListener('click', click); element.addEventListener('input', onInput);
    const controller = { refresh, isDirty, saveIfDirty, destroy() { disposed = true; request++; element.removeEventListener('click', click); element.removeEventListener('input', onInput); element.replaceChildren(); instances.delete(controller); } };
    render(); instances.add(controller); controller.ready = refresh(); return controller;
  }
  global.JKCrewDailyTierTwo = Object.freeze({ mount, mountEditor, destroyAll() { [...instances].forEach(instance => instance.destroy()); } });
})(window);
