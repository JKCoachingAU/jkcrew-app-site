(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(undefined, {day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}) : '';
  };
  const errorText = error => error?.message || 'Could not connect. Please try again.';
  const mounts = new WeakMap();
  function mount({element, client, athleteId, role = 'rider', venue = '', isCurrent = () => true, onChanged = () => {}} = {}) {
    if (!element || !client?.rpc || !athleteId) throw new Error('A rider and a connected host are required.');
    mounts.get(element)?.destroy();
    let destroyed = false, loaded = false, loading = false, sequence = 0, timer = null;
    let items = [], total = 0, info = null, submitBusy = false, submitAttempt = null, reviewBusy = null, retry = null;
    let drafts = [newDraft()];
    const current = () => !destroyed && element.isConnected && isCurrent();
    function newDraft() { return {id:crypto.randomUUID(),trick_name:'',note:''}; }
    element.innerHTML = `<details class="other-landed-panel panel" data-other-landed-panel>
      <summary><span><strong>Other Things Landed</strong><small>Extra landings · coach approval · +1 point each</small></span><span class="other-landed-count" data-other-count aria-live="polite"></span><span class="other-landed-caret" aria-hidden="true">⌄</span></summary>
      <div class="other-landed-body"><div class="other-landed-tools"><p>${role === 'coach' ? 'Review the tricks this rider says they landed.' : 'Landed something outside your list? Send it to your coach.'}</p><button type="button" data-other-refresh>Refresh</button></div>
      <div class="other-landed-status" role="status" aria-live="polite" data-other-status></div>
      <button class="other-landed-retry" type="button" data-other-retry hidden>Retry</button>
      <form data-other-form hidden><div data-other-drafts></div><div class="other-landed-form-actions"><button type="button" data-other-add>+ Add another trick</button><button type="submit" class="other-landed-primary" data-other-submit>Send to coach</button></div><small>No points are added until your coach approves.</small></form>
      <div data-other-list></div><button type="button" data-other-more hidden>Show older landings</button></div>
    </details>`;
    const panel = element.querySelector('[data-other-landed-panel]');
    const form = element.querySelector('[data-other-form]');
    const status = element.querySelector('[data-other-status]');
    const list = element.querySelector('[data-other-list]');
    const retryButton = element.querySelector('[data-other-retry]');
    function message(text, failure = false, retryAction = null) {
      if (!current()) return;
      status.textContent = text;
      status.classList.toggle('is-error', failure);
      retry = retryAction;
      retryButton.hidden = !retryAction;
    }
    function notify(payload) {
      if (!current()) return;
      try { Promise.resolve(onChanged({athleteId, ...payload})).catch(() => {}); } catch (_) { /* A cache refresh cannot undo a saved review. */ }
    }
    function renderDrafts() {
      element.querySelector('[data-other-drafts]').innerHTML = drafts.map((draft,index) => `<div class="other-landed-draft" data-other-draft="${draft.id}">
        <label>Trick ${index + 1}<input data-other-name required maxlength="120" autocomplete="off" value="${escape(draft.trick_name)}" placeholder="Name of the trick you landed"></label>
        <label>Short note <span>(optional)</span><input data-other-note maxlength="180" value="${escape(draft.note)}" placeholder="Anything your coach should know"></label>
        ${drafts.length > 1 ? '<button type="button" data-other-remove aria-label="Remove this unsent trick">Remove</button>' : ''}</div>`).join('');
      updateForm();
    }
    function updateForm() {
      const canSubmit = role === 'rider' && info?.can_submit === true;
      // Preserve a typed draft and its retry even if scoring is paused meanwhile.
      form.hidden = role !== 'rider' || (!canSubmit && !submitAttempt && !drafts.some(d => d.trick_name || d.note));
      form.querySelectorAll('input,[data-other-remove],[data-other-add]').forEach(control => { control.disabled = submitBusy || !!submitAttempt || !canSubmit; });
      const button = form.querySelector('[data-other-submit]');
      button.disabled = submitBusy || !!submitAttempt || !canSubmit;
      button.textContent = submitBusy ? 'Sending…' : 'Send to coach';
      element.querySelector('[data-other-add]').hidden = drafts.length >= 10;
    }
    function rowHtml(item) {
      const label = item.status === 'approved' ? 'Approved · +1 point' : item.status === 'declined' ? 'Declined · 0 points' : 'Pending';
      const pending = item.status === 'pending';
      return `<article class="other-landed-item is-${escape(item.status)}" data-other-item="${escape(item.id)}"><div class="other-landed-item-head"><strong>${escape(item.trick_name)}</strong><span class="other-landed-badge">${label}</span></div>
        ${item.note ? `<p class="other-landed-note">${escape(item.note)}</p>` : ''}
        <small>Submitted <time datetime="${escape(item.submitted_at)}">${escape(date(item.submitted_at))}</time>${item.venue ? ` · ${escape(item.venue)}` : ''}</small>
        ${pending ? '' : `<small>Reviewed by ${escape(item.reviewer_name || 'Coach')} · <time datetime="${escape(item.reviewed_at)}">${escape(date(item.reviewed_at))}</time></small>`}
        ${pending && role === 'coach' && info?.can_review ? `<div class="other-landed-review-actions"><button type="button" class="other-landed-primary" data-other-review="approved" ${reviewBusy || info.scoring_paused ? 'disabled' : ''}>${reviewBusy === item.id ? 'Saving…' : 'Approve · +1'}</button><button type="button" data-other-review="declined" ${reviewBusy ? 'disabled' : ''}>Decline</button></div>` : ''}</article>`;
    }
    function renderList() {
      const historyOpen = list.querySelector('[data-other-history]')?.open || false;
      const pending = items.filter(item => item.status === 'pending');
      const history = items.filter(item => item.status !== 'pending');
      list.innerHTML = `${pending.length ? `<div class="other-landed-list" aria-label="Pending landings">${pending.map(rowHtml).join('')}</div>` : '<p class="other-landed-empty">No landings waiting for review.</p>'}
        ${history.length ? `<details class="other-landed-history" data-other-history ${historyOpen ? 'open' : ''}><summary>Reviewed landings <span>${history.length}</span></summary><div class="other-landed-list">${history.map(rowHtml).join('')}</div></details>` : ''}`;
      element.querySelector('[data-other-count]').textContent = info?.pending_count ? `${info.pending_count} pending` : '';
      const more = element.querySelector('[data-other-more]');more.hidden = items.length >= total;more.disabled = loading;
    }
    async function call(name, args) {
      let timeout;
      const response = await Promise.race([Promise.resolve(client.rpc(name, args)),new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('The connection is taking too long. Please retry.')),15000);
      })]).finally(() => clearTimeout(timeout));
      if (response.error) throw response.error;
      if (!response.data || typeof response.data !== 'object') throw new Error('The saved response could not be confirmed. Please retry.');
      return response.data;
    }
    function merge(next) { const rows = new Map(items.map(row => [row.id,row]));next.forEach(row => rows.set(row.id,row));items = [...rows.values()]; }
    function invalidateRead() {sequence++;loading = false;element.querySelector('[data-other-refresh]').disabled = false;}
    async function refresh({more = false, quiet = false} = {}) {
      if (!current() || !panel.open || loading || submitBusy || reviewBusy) return;
      const request = ++sequence; loading = true;
      element.querySelector('[data-other-refresh]').disabled = true;
      if (!loaded && !quiet) message('Loading landings…');
      try {
        const result = await call('get_other_things_landed', {p_athlete_id:athleteId,p_limit:50,p_offset:more ? items.length : 0});
        if (!current() || request !== sequence) return;
        if (!Array.isArray(result.items)) throw new Error('Landings could not be loaded. Please retry.');
        if (more || quiet) merge(result.items); else items = result.items;
        info = result; total = Number(result.total_count) || 0; loaded = true;
        renderList();updateForm();
        if (submitAttempt && submitAttempt.every(entry => items.some(item => item.id === entry.id && item.trick_name === entry.trick_name && item.note === entry.note))) {
          completeSubmission();
        } else if (!submitAttempt && !reviewBusy) {
          message(result.scoring_paused ? 'Trick scoring is paused. New submissions and approvals are paused; saved landings are still here.' : '');
        }
      } catch (error) {
        if (!current() || request !== sequence) return;
        if (error.code === '42501') { items = [];info = null;list.innerHTML = '';form.hidden = true;element.querySelector('[data-other-count]').textContent = ''; }
        if (!quiet || !loaded || error.code === '42501') message(errorText(error), true, () => refresh());
      } finally {
        if (current() && request === sequence) { loading = false;element.querySelector('[data-other-refresh]').disabled = false;element.querySelector('[data-other-more]').disabled = false; }
      }
    }
    function completeSubmission() {
      submitAttempt = null;drafts = [newDraft()];renderDrafts();message('Sent to your coach. Waiting for review.');notify({status:'pending',points:0});
    }
    async function submit() {
      if (!current() || submitBusy || reviewBusy || (!submitAttempt && !info?.can_submit)) return;
      if (!submitAttempt) {
        if (!form.reportValidity()) return;
        const entries = drafts.map(d => ({id:d.id,trick_name:d.trick_name.trim(),note:d.note.trim()}));
        if (entries.some(d => !d.trick_name)) {message('Add a trick name before sending.',true);return;}
        submitAttempt = entries;
      }
      invalidateRead();submitBusy = true;updateForm();message('Sending to your coach…');
      try {
        const result = await call('submit_other_things_landed',{p_entries:submitAttempt,p_venue:venue});
        if (!current()) return;
        if (!Array.isArray(result.items) || result.items.length !== submitAttempt.length || !submitAttempt.every(entry => result.items.some(item => item.id === entry.id))) throw new Error('Your submission could not be confirmed. Retry to check it safely.');
        merge(result.items);info.pending_count = items.filter(item => item.status === 'pending').length;total = Math.max(total,items.length);completeSubmission();renderList();
      } catch (error) {
        if (current()) {
          // A PostgreSQL validation error rolled back the whole request. Let the
          // rider correct it; an unknown transport outcome must keep its IDs.
          if (error.code === '22023') {submitAttempt = null;message(errorText(error),true,submit);}
          else message(`${errorText(error)} Retry to confirm these same tricks safely.`,true,submit);
        }
      } finally { submitBusy = false;if (current()) updateForm(); }
    }
    async function review(id, decision) {
      if (!current() || reviewBusy || submitBusy || !info?.can_review) return;
      invalidateRead();reviewBusy = id;renderList();message('Saving coach review…');
      try {
        const result = await call('review_other_thing_landed',{p_submission_id:id,p_decision:decision});
        if (!current()) return;
        if (result.item?.id !== id || !['approved','declined'].includes(result.item?.status)) throw new Error('The review could not be confirmed. Please retry.');
        merge([result.item]);info.pending_count = items.filter(item => item.status === 'pending').length;
        message(`${result.already_reviewed ? 'Already reviewed. ' : ''}${result.item.status === 'approved' ? 'Approved · +1 point.' : 'Declined · 0 points.'}`);
        notify({status:result.item.status,points:result.item.points});
      } catch (error) { if (current()) message(errorText(error),true,() => review(id,decision)); }
      finally { reviewBusy = null;if (current()) renderList(); }
    }
    function onClick(event) {
      const target = event.target.closest('button');if (!target || !element.contains(target)) return;
      if (target.hasAttribute('data-other-refresh')) refresh();
      if (target.hasAttribute('data-other-more')) refresh({more:true});
      if (target.hasAttribute('data-other-retry')) retry?.();
      if (target.hasAttribute('data-other-add') && drafts.length < 10 && !submitBusy && !submitAttempt) {drafts.push(newDraft());renderDrafts();element.querySelector('[data-other-draft]:last-child input')?.focus();}
      if (target.hasAttribute('data-other-remove') && !submitBusy && !submitAttempt) {drafts = drafts.filter(d => d.id !== target.closest('[data-other-draft]')?.dataset.otherDraft);renderDrafts();}
      if (target.dataset.otherReview) review(target.closest('[data-other-item]')?.dataset.otherItem,target.dataset.otherReview);
    }
    function onInput(event) { const draft = drafts.find(d => d.id === event.target.closest('[data-other-draft]')?.dataset.otherDraft);if (draft) draft[event.target.hasAttribute('data-other-name') ? 'trick_name' : 'note'] = event.target.value; }
    function onSubmit(event) {event.preventDefault();submit();}
    function onToggle() {clearInterval(timer);timer = null;if (panel.open && current()) {refresh();timer = setInterval(() => {if (document.visibilityState !== 'hidden') refresh({quiet:true});},30000);}}
    function onFocus() {if (panel.open && !submitAttempt) refresh({quiet:true});}
    element.addEventListener('click',onClick);form.addEventListener('input',onInput);form.addEventListener('submit',onSubmit);panel.addEventListener('toggle',onToggle);window.addEventListener('focus',onFocus);
    renderDrafts();
    const handle = {refresh,destroy() {if (destroyed) return;destroyed = true;sequence++;clearInterval(timer);element.removeEventListener('click',onClick);form.removeEventListener('input',onInput);form.removeEventListener('submit',onSubmit);panel.removeEventListener('toggle',onToggle);window.removeEventListener('focus',onFocus);element.replaceChildren();mounts.delete(element);}};
    mounts.set(element,handle);return handle;
  }
  globalThis.JKCrewOtherThingsLanded = Object.freeze({mount});
})();
