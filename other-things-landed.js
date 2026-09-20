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
    const riderSummary = `<span class="other-landed-rider-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="m17 5 2.6 7.4L27 15l-7.4 2.6L17 25l-2.6-7.4L7 15l7.4-2.6L17 5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m7 23 .9 2.1L10 26l-2.1.9L7 29l-.9-2.1L4 26l2.1-.9L7 23Z" fill="currentColor"/><path d="M25 4v5M22.5 6.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span><span class="other-landed-rider-copy"><span class="other-landed-rider-eyebrow">Beyond your list</span><strong>Other Things Landed</strong><small><b>+1 point</b> per trick after coach approval</small><span class="other-landed-count" data-other-count aria-live="polite"></span></span><span class="other-landed-caret" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
    element.innerHTML = `<details class="other-landed-panel panel${role === 'rider' ? ' other-landed-panel--rider' : ''}" data-other-landed-panel>
      <summary>${role === 'rider' ? riderSummary : '<span><strong>Other Things Landed</strong><small>Extra landings · coach approval · +1 point each</small></span><span class="other-landed-count" data-other-count aria-live="polite"></span><span class="other-landed-caret" aria-hidden="true">⌄</span>'}</summary>
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
  function mountCoachQueue({element, client, roster = [], isCurrent = () => true, onChanged = () => {}} = {}) {
    if (!element || !client?.from || !client?.rpc) throw new Error('A connected coach queue is required.');
    mounts.get(element)?.destroy();
    const riders = new Map(roster.filter(rider => rider?.id).map(rider => [String(rider.id), rider]));
    const athleteIds = [...riders.keys()];
    let destroyed = false, sequence = 0, loading = false, items = [], total = null, pageLimit = 30;
    let reviewBusy = null, reviewAttempt = null, retry = null;
    const current = () => !destroyed && element.isConnected && isCurrent();
    element.innerHTML = `<section class="other-landed-panel other-landed-coach-queue panel" aria-label="Other Things Landed reviews">
      <header class="other-landed-queue-head"><div class="other-landed-queue-identity"><span class="other-landed-queue-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="m17 5 2.6 7.4L27 15l-7.4 2.6L17 25l-2.6-7.4L7 15l7.4-2.6L17 5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6 23v6M3 26h6M25 3v5M22.5 5.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span><div><p class="other-landed-queue-eyebrow">Coach review</p><h2>Other Things Landed</h2></div></div>
        <button type="button" class="other-landed-queue-refresh" data-other-queue-refresh aria-label="Refresh Other Things Landed" title="Refresh landings"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13.5 4M4.4 13.9a8 8 0 0 0 13.5 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></header>
      <div class="other-landed-queue-meta"><p><strong>+1 point</strong> per approved landing</p><span class="other-landed-queue-count" data-other-queue-count aria-live="polite">Loading…</span></div>
      <div class="other-landed-queue-body"><div class="other-landed-status" role="status" aria-live="polite" data-other-queue-status></div>
        <button type="button" class="other-landed-retry" data-other-queue-retry hidden>Retry</button>
        <div class="other-landed-list" data-other-queue-list aria-label="Landings waiting for review"></div>
        <button type="button" class="other-landed-queue-more" data-other-queue-more hidden>Show more landings</button></div>
    </section>`;
    const list = element.querySelector('[data-other-queue-list]');
    const status = element.querySelector('[data-other-queue-status]');
    const count = element.querySelector('[data-other-queue-count]');
    const refreshButton = element.querySelector('[data-other-queue-refresh]');
    const retryButton = element.querySelector('[data-other-queue-retry]');
    const moreButton = element.querySelector('[data-other-queue-more]');
    function message(text, failure = false, retryAction = null) {
      if (!current()) return;
      status.textContent = text;status.classList.toggle('is-error', failure);
      retry = retryAction;retryButton.hidden = !retryAction;retryButton.disabled = !!reviewBusy;
    }
    function notify(payload) {
      if (!current()) return;
      try { Promise.resolve(onChanged(payload)).catch(() => {}); } catch (_) { /* A dashboard refresh cannot undo a saved review. */ }
    }
    function riderName(athleteId) { return riders.get(athleteId)?.display_name || 'Rider'; }
    function render() {
      if (!current()) return;
      count.textContent = total === null ? (loading ? 'Loading…' : 'Unavailable') : `${total} pending`;
      count.classList.toggle('is-empty', total === 0);
      refreshButton.disabled = loading || !!reviewBusy;
      retryButton.disabled = !!reviewBusy || loading;
      moreButton.hidden = total === null || items.length >= total;
      moreButton.disabled = loading || !!reviewBusy;
      moreButton.textContent = loading && items.length ? 'Loading…' : `Show more landings (${items.length} of ${total || 0})`;
      list.setAttribute('aria-busy', String(loading));
      list.innerHTML = items.map(item => `<article class="other-landed-item other-landed-queue-item is-pending" data-other-queue-item="${escape(item.id)}" data-athlete-id="${escape(item.athlete_id)}">
        <div class="other-landed-queue-content"><p class="other-landed-queue-rider">${escape(riderName(item.athlete_id))}</p><h3>${escape(item.trick_name)}</h3>
          ${item.note ? `<p class="other-landed-note">${escape(item.note)}</p>` : ''}
          <small>${item.venue ? `${escape(item.venue)} · ` : ''}<time datetime="${escape(item.submitted_at)}">${escape(date(item.submitted_at))}</time></small></div>
        <div class="other-landed-review-actions"><button type="button" class="other-landed-primary" data-other-queue-review="approved" aria-label="Approve ${escape(item.trick_name)} by ${escape(riderName(item.athlete_id))}, plus 1 point" ${reviewBusy ? 'disabled' : ''}>${reviewBusy === item.id ? 'Saving…' : 'Approve · +1'}</button><button type="button" data-other-queue-review="declined" aria-label="Decline ${escape(item.trick_name)} by ${escape(riderName(item.athlete_id))}" ${reviewBusy ? 'disabled' : ''}>Decline</button></div>
      </article>`).join('') || (total === 0 ? '<div class="other-landed-queue-empty"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m6 12 4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><div><strong>All caught up</strong><p>New landings will appear here.</p></div></div>' : '');
    }
    async function responseFor(request) {
      let timeout;
      const response = await Promise.race([Promise.resolve(request), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('The connection is taking too long. Please retry.')), 15000);
      })]).finally(() => clearTimeout(timeout));
      if (response?.error) throw response.error;
      if (!response || typeof response !== 'object') throw new Error('The response could not be confirmed. Please retry.');
      return response;
    }
    async function refresh({quiet = false} = {}) {
      if (!current() || loading || reviewBusy) return false;
      const request = ++sequence;loading = true;render();
      if (!quiet && !reviewAttempt) message(items.length ? 'Updating landings…' : 'Loading landings…');
      try {
        let next = [], nextTotal = 0;
        // Read the visible prefix again after every review. Offset-only loading
        // would skip a pending landing whenever an earlier row is approved.
        if (athleteIds.length) {
          do {
            const response = await responseFor(client.from('other_things_landed')
              .select('id,athlete_id,trick_name,note,venue,status,submitted_at', {count:'exact'})
              .in('athlete_id', athleteIds).eq('status', 'pending')
              .order('submitted_at', {ascending:true}).order('id', {ascending:true})
              .range(next.length, Math.min(next.length + 299, pageLimit - 1)));
            if (!current() || request !== sequence) return false;
            if (!Array.isArray(response.data) || !Number.isInteger(response.count) || response.count < 0) throw new Error('Landings could not be loaded. Please retry.');
            // RLS is authoritative; also refuse to display anything outside the
            // captured roster if the server returns an unexpected response.
            if (response.data.some(row => !row?.id || !riders.has(row.athlete_id) || row.status !== 'pending')) throw new Error('Landings could not be verified. Please refresh.');
            nextTotal = response.count;
            if (!response.data.length) break;
            const byId = new Map(next.map(row => [row.id, row]));
            response.data.forEach(row => byId.set(row.id, row));
            if (byId.size === next.length) break;
            next = [...byId.values()];
          } while (next.length < Math.min(pageLimit, nextTotal));
        }
        if (!current() || request !== sequence) return false;
        items = next;total = nextTotal;
        if (!reviewAttempt && (!quiet || status.classList.contains('is-error'))) message('');
        notify({kind:'refresh',pendingCount:total});
        return true;
      } catch (error) {
        if (!current() || request !== sequence) return false;
        if (error.code === '42501') {items = [];total = null;reviewAttempt = null;}
        if (!reviewAttempt) message(errorText(error), true, () => refresh());
        return false;
      } finally {
        if (current() && request === sequence) {loading = false;render();}
      }
    }
    async function review(attempt) {
      if (!current() || reviewBusy || !attempt || !riders.has(attempt.athleteId) || !['approved','declined'].includes(attempt.decision)) return;
      sequence++;loading = false;reviewBusy = attempt.id;reviewAttempt = attempt;render();message('Saving coach review…');
      let saved = false;
      try {
        const response = await responseFor(client.rpc('review_other_thing_landed', {p_submission_id:attempt.id,p_decision:attempt.decision}));
        if (!current()) return;
        const result = response.data, item = result?.item;
        if (item?.id !== attempt.id || item.athlete_id !== attempt.athleteId || !['approved','declined'].includes(item.status) || item.points !== (item.status === 'approved' ? 1 : 0)) throw new Error('The review could not be confirmed. Retry to check it safely.');
        if (items.some(row => row.id === attempt.id) && total !== null) total = Math.max(0, total - 1);
        items = items.filter(row => row.id !== attempt.id);reviewAttempt = null;saved = true;
        message(`${riderName(attempt.athleteId)} · ${item.trick_name || attempt.trickName}: ${result.already_reviewed ? 'already ' : ''}${item.status === 'approved' ? 'approved · +1 point.' : 'declined · 0 points.'}`);
        notify({kind:'review',athleteId:attempt.athleteId,submissionId:item.id,status:item.status,points:item.points,pendingCount:total,alreadyReviewed:result.already_reviewed === true});
      } catch (error) {
        if (current()) message(`${errorText(error)} Retry checks this same landing safely.`, true, () => review(attempt));
      } finally {
        reviewBusy = null;if (current()) render();
      }
      if (saved && current()) await refresh({quiet:true});
    }
    function onClick(event) {
      const target = event.target.closest('button');if (!target || !element.contains(target) || target.disabled) return;
      if (target.hasAttribute('data-other-queue-refresh')) refresh();
      if (target.hasAttribute('data-other-queue-retry')) retry?.();
      if (target.hasAttribute('data-other-queue-more') && !loading && !reviewBusy) {pageLimit += 30;refresh({quiet:true});}
      if (target.dataset.otherQueueReview) {
        const item = items.find(row => row.id === target.closest('[data-other-queue-item]')?.dataset.otherQueueItem);
        if (item) review({id:item.id,athleteId:item.athlete_id,trickName:item.trick_name,decision:target.dataset.otherQueueReview});
      }
    }
    function onWake() {if (document.visibilityState !== 'hidden') refresh({quiet:true});}
    element.addEventListener('click', onClick);window.addEventListener('focus', onWake);window.addEventListener('online', onWake);document.addEventListener('visibilitychange', onWake);
    const timer = setInterval(onWake, 30000);
    const handle = {refresh,ready:null,destroy() {
      if (destroyed) return;
      destroyed = true;sequence++;clearInterval(timer);element.removeEventListener('click', onClick);window.removeEventListener('focus', onWake);window.removeEventListener('online', onWake);document.removeEventListener('visibilitychange', onWake);element.replaceChildren();mounts.delete(element);
    }};
    mounts.set(element, handle);handle.ready = refresh();return handle;
  }
  globalThis.JKCrewOtherThingsLanded = Object.freeze({mount,mountCoachQueue});
})();
