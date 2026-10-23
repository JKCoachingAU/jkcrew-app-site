(() => {
  'use strict';
  const SYMPTOMS = [
    ['headache', 'Headache'], ['dizziness', 'Dizziness'], ['nausea', 'Nausea'],
    ['sensitivity', 'Sensitivity to light/noise'], ['brain_fog', 'Brain fog or concentration issues'],
    ['fatigue', 'Fatigue'], ['balance', 'Balance problems'], ['neck_pain', 'Neck pain'],
  ];
  const SLEEP = { normal: 'Normal', poor: 'Poor or interrupted', unusually_sleepy: 'Unusually sleepy' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const validRating = value => value !== '' && value !== null && value !== undefined && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 10;
  const dayLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Date unavailable';
  const timeLabel = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''; };
  const mounts = new Set(), drafts = new Map(), views = new Map();
  let accountId = null;
  window.addEventListener('beforeunload', event => {
    const unsaved = [...drafts.values()].some(value => value.dirty || value.attempt) || [...views.values()].some(value => value.pending || value.planDraft?.dirty || value.clearanceNote);
    if (unsaved) { event.preventDefault(); event.returnValue = ''; }
  });

  function cleanup({ clearDrafts = true } = {}) {
    [...mounts].forEach(handle => handle.destroy());
    if (clearDrafts) { drafts.clear(); views.clear(); accountId = null; }
  }

  function mount({ element, client, userId, athleteId = userId, displayName = 'Rider', isCurrent = () => true, onChanged = () => {}, onModeChanged = () => {}, onAccount = null, onMessageCoach = null, role = 'athlete' } = {}) {
    if (!element || !client?.rpc || !userId || !athleteId) throw new Error('A signed-in account and rider are required.');
    if (accountId && accountId !== userId) cleanup();
    accountId = userId;
    [...mounts].filter(handle => handle.element === element).forEach(handle => handle.destroy());
    const viewKey = `${userId}:${athleteId}:${role}`, remembered = views.get(viewKey) || {};
    let destroyed = false, sequence = 0, loading = false, busy = false, info = null, history = [], hasMore = false;
    let page = remembered.page || (role === 'coach' ? 'coach' : 'today'), statusText = '', statusError = false, retry = null, pending = remembered.pending || null;
    let editCheckin = remembered.editCheckin || false, editPlan = remembered.editPlan || false, modePrompt = false, confirmOff = false, clearanceNote = remembered.clearanceNote || '', planDraft = remembered.planDraft || null;
    let validationError = null;
    let conflict = remembered.conflict || false, conflictCompared = false, planConflict = remembered.planConflict || false, planCompared = false, detailId = null;
    function remember() { views.set(viewKey, { page, pending, editCheckin, editPlan, clearanceNote, planDraft, conflict, planConflict, episodeId: info?.episode?.id || remembered.episodeId }); }
    const current = () => !destroyed && element.isConnected && accountId === userId && isCurrent();
    const ownKey = () => `${userId}:${athleteId}:${info?.episode?.id || 'none'}:${info?.today_date || 'none'}`;
    const todayRecord = () => history.find(row => row.episode_id === info?.episode?.id && row.checkin_date === info?.today_date) || null;
    function newDraft() {
      const record = todayRecord();
      return { ratings: Object.fromEntries(SYMPTOMS.map(([key]) => [key, record?.ratings?.[key] === undefined ? '' : String(record.ratings[key])])), sleep: record?.sleep || '', notes: record?.notes || '', expectedVersion: Number(record?.version) || 0, dirty: false, attempt: null };
    }
    function draft() { const key = ownKey(); if (!drafts.has(key)) drafts.set(key, newDraft()); return drafts.get(key); }
    function notify(callback, data) { if (current()) { try { Promise.resolve(callback(data)).catch(() => {}); } catch (_) { /* The record remains saved if the surrounding view refresh fails. */ } } }
    function message(text, error = false, action = null) { validationError = null; statusText = text; statusError = error; retry = action; }
    function clearResolvedValidation() {
      const resolved = (validationError === 'ratings' && ratedCount() === 8) || (validationError === 'sleep' && Object.hasOwn(SLEEP, draft().sleep)) || (validationError === 'title' && planDraft?.title.trim()) || (validationError === 'clearance' && confirmOff && clearanceNote.trim());
      if (!resolved) return;
      message(''); const status = element.querySelector('.recovery-status');
      if (status) { status.textContent = ''; status.classList.remove('is-error'); status.setAttribute('role', 'status'); }
    }
    function failure(error) {
      if (error?.code === '40001') return 'This was updated on another device. Your unsaved answers are still here. Compare the latest saved entry before saving again.';
      if (error?.code === '42501') return 'You no longer have permission to change this recovery record. Refresh access or contact your coach.';
      if (error?.code === '22023') return error.message || 'Check the details and try again.';
      if (/JWT|token|session/i.test(error?.message || '')) return 'Your session needs refreshing. Your unsaved answers are still here; reconnect and try again.';
      return 'We couldn’t confirm that with the server. Your answers are still here. Check your connection and retry.';
    }
    async function rpc(name, args) {
      let timer;
      const response = await Promise.race([Promise.resolve().then(() => client.rpc(name, args)), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Connection timed out'), { unknownOutcome: true })), 15000); })]).finally(() => clearTimeout(timer));
      if (response?.error) throw response.error;
      const data = response?.data;
      if (!data || typeof data !== 'object' || data.athlete_id !== athleteId || !Array.isArray(data.checkins)) throw Object.assign(new Error('Response not confirmed'), { unknownOutcome: true });
      return data;
    }
    function applyInfo(data, { more = false } = {}) {
      const previousMode = info?.recovery_mode;
      const previousEpisode = info?.episode?.id || remembered.episodeId;
      info = data;
      if (more) { const rows = new Map(history.map(row => [row.id, row])); data.checkins.forEach(row => rows.set(row.id, row)); history = [...rows.values()]; }
      else history = data.checkins;
      history.sort((a, b) => String(b.checkin_date).localeCompare(String(a.checkin_date)) || String(b.created_at).localeCompare(String(a.created_at)));
      hasMore = data.has_more === true;
      if (previousEpisode && previousEpisode !== info.episode?.id) {
        [...drafts.keys()].filter(key => key.startsWith(`${userId}:${athleteId}:${previousEpisode}:`)).forEach(key => drafts.delete(key));
        pending = null; editCheckin = false; editPlan = false; planDraft = null; conflict = false; planConflict = false;
      }
      if (!draft().dirty && !draft().attempt) drafts.set(ownKey(), newDraft());
      if (previousMode !== undefined && previousMode !== info.recovery_mode) notify(onModeChanged, { athleteId, recoveryMode: info.recovery_mode, info });
    }
    async function refresh({ more = false, compare = false, comparePlan = false } = {}) {
      if (!current() || loading || busy) return false;
      loading = true; const request = ++sequence;
      if (!info) message('Loading your recovery view…');
      else if (compare || comparePlan) message('Checking the latest saved entry…');
      render();
      try {
        const before = more ? (info.next_before_date || history[history.length - 1]?.checkin_date) : null;
        const data = await rpc('get_rider_recovery', { p_athlete_id: athleteId, p_before_date: before });
        if (!current() || request !== sequence) return false;
        applyInfo(data, { more });
        if (comparePlan) { planCompared = true; message('Latest saved plan loaded. Review it alongside your draft before continuing.'); }
        else if (compare) { conflictCompared = true; message('Latest saved entry loaded. Your draft has not been replaced.'); }
        else if (pending) message('A previous save is not yet confirmed. Retry to check its result.', true, () => mutate(pending, pending.successText));
        else if (!conflict && !planConflict) message('');
        return true;
      } catch (error) {
        if (current() && request === sequence) {
          if (error.code === '42501') { info = null; history = []; pending = null; planDraft = null; clearanceNote = ''; conflict = false; planConflict = false; views.delete(viewKey); [...drafts.keys()].filter(key => key.startsWith(`${userId}:${athleteId}:`)).forEach(key => drafts.delete(key)); }
          message(failure(error), true, () => refresh({ compare, comparePlan }));
        }
        return false;
      } finally { if (current() && request === sequence) { loading = false; render(); } }
    }
    function heading(eyebrow, title, copy = '') { return `<header class="recovery-heading"><p class="recovery-eyebrow">${escape(eyebrow)}</p><h1>${title}</h1>${copy ? `<p>${copy}</p>` : ''}</header>`; }
    function toolbar() { return `<div class="recovery-toolbar"><span class="recovery-private">Private recovery record</span><button type="button" class="recovery-text-button" data-recovery-refresh ${loading || busy ? 'disabled' : ''}>${loading ? 'Refreshing…' : 'Refresh'}</button>${onAccount && role === 'athlete' ? '<button type="button" class="recovery-text-button" data-recovery-account>Sign out</button>' : ''}</div>`; }
    function navigation() { return `<nav class="recovery-nav" aria-label="Recovery navigation">${[['today', 'Check-in'], ['history', 'History'], ['plan', 'My plan'], ['support', 'Support']].map(([key, label]) => `<button type="button" data-recovery-page="${key}" aria-pressed="${page === key}" ${busy ? 'disabled' : ''}>${label}</button>`).join('')}</nav>`; }
    function total(ratings) { return SYMPTOMS.reduce((sum, [key]) => sum + Number(ratings[key]), 0); }
    function ratedCount() { return SYMPTOMS.filter(([key]) => validRating(draft().ratings[key])).length; }
    function recordHtml(record, { comparison = false } = {}) {
      return `<section class="recovery-record${comparison ? ' recovery-comparison' : ''}" aria-label="${comparison ? 'Latest saved entry for comparison' : 'Saved symptom check-in'}"><p class="recovery-eyebrow">${comparison ? 'Latest saved entry · Compare with your draft' : escape(dayLabel(record.checkin_date))}</p><dl class="recovery-ratings-summary">${SYMPTOMS.map(([key, label]) => `<div><dt>${label}</dt><dd>${escape(record.ratings?.[key])}/10</dd></div>`).join('')}</dl><div class="recovery-total"><span>Symptom total · tracker only</span><strong>${total(record.ratings)} /80</strong></div><p class="recovery-label">Sleep last night</p><p>${escape(SLEEP[record.sleep] || 'Not recorded')}</p>${record.notes ? `<p class="recovery-label">Notes / exercise response</p><p class="recovery-preserve-lines">${escape(record.notes)}</p>` : ''}<p class="recovery-small recovery-muted">Saved ${escape(timeLabel(record.updated_at || record.created_at))}</p></section>`;
    }
    function recoveryInactive() { return `${heading(displayName, 'Recovery <span>history.</span>', 'Your recovery records are kept here.')}<section class="recovery-card"><h2>Recovery mode is off</h2><p>Your coach controls the app view. Your previous check-ins and plans are preserved.</p><button type="button" class="recovery-button" data-recovery-page="history">View recovery history</button></section>`; }
    function checkinHtml() {
      if (!info.recovery_mode || !info.episode) return recoveryInactive();
      const data = draft(), record = todayRecord(), count = ratedCount(), locked = busy || !!data.attempt || conflict;
      const head = heading(`${displayName} · Recovery`, 'Daily <span>check-in.</span>', 'Let us know how you’re feeling.');
      if (record && !editCheckin && !data.dirty) return `${head}<section class="recovery-card recovery-accent"><div class="recovery-saved-heading" role="status"><span aria-hidden="true">✓</span><div><h2>Check-in saved</h2><p>${escape(dayLabel(record.checkin_date))}</p></div></div><p>Your authorised coach can review this check-in.</p>${recordHtml(record)}<button type="button" class="recovery-button" data-recovery-edit-checkin>Edit today’s check-in</button></section><p class="recovery-disclaimer">A check-in does not advance your recovery plan or clear you to ride.</p>`;
      return `${head}<form class="recovery-card recovery-accent recovery-form" data-recovery-checkin-form novalidate><div class="recovery-form-intro"><h2>How are you feeling today?</h2><p>0 = none · 10 = severe<br>Move each slider or enter a number, including 0.</p><span class="recovery-small" data-recovery-rated>${count} of 8 symptoms rated</span><p class="recovery-small">${escape(dayLabel(info.today_date))}</p></div><fieldset ${locked ? 'disabled' : ''}><legend class="recovery-sr-only">Today's symptom ratings</legend>${SYMPTOMS.map(([key, label]) => `<div class="recovery-rating" data-recovery-rating-row="${key}" data-rated="${validRating(data.ratings[key])}"><label for="recovery-${key}">${label}</label><div class="recovery-rating-controls"><input id="recovery-${key}" class="recovery-slider" type="range" min="0" max="10" step="1" data-recovery-range="${key}" value="${validRating(data.ratings[key]) ? data.ratings[key] : 0}" aria-valuetext="${validRating(data.ratings[key]) ? `${data.ratings[key]} out of 10` : 'Not rated'}"><span class="recovery-number"><input type="number" min="0" max="10" step="1" inputmode="numeric" required aria-label="${label} rating out of 10" placeholder="—" data-recovery-number="${key}" value="${escape(data.ratings[key])}"><span>/10</span></span></div></div>`).join('')}<div class="recovery-total"><span>Symptom total</span><strong data-recovery-total>${count === 8 ? total(data.ratings) : '—'} /80</strong></div><p class="recovery-small recovery-muted">This tracks your answers, not how ready you are to ride.</p><fieldset class="recovery-sleep"><legend>Sleep last night</legend>${Object.entries(SLEEP).map(([key, label]) => `<label><input type="radio" name="recovery-sleep" value="${key}" ${data.sleep === key ? 'checked' : ''}><span>${label}</span></label>`).join('')}</fieldset><label class="recovery-field-label" for="recovery-notes">Notes / exercise response <span>· Optional</span></label><textarea id="recovery-notes" name="notes" maxlength="1000" rows="3" placeholder="Any symptoms after activity? Anything else you want your coach to know?">${escape(data.notes)}</textarea></fieldset>${conflict ? `<div class="recovery-conflict"><p>Your draft is protected. Another saved version exists.</p><button class="recovery-button" type="button" data-recovery-compare ${loading ? 'disabled' : ''}>Compare latest saved entry</button>${conflictCompared && todayRecord() ? recordHtml(todayRecord(), { comparison: true }) : ''}${conflictCompared ? '<button class="recovery-button" type="button" data-recovery-keep-draft>Keep my draft and continue editing</button><button class="recovery-button" type="button" data-recovery-use-saved>Use the saved entry</button>' : ''}</div>` : ''}<button class="recovery-button recovery-primary" type="submit" ${locked ? 'disabled' : ''}>${busy ? 'Saving…' : record ? 'Update check-in' : 'Save check-in'}</button><p class="recovery-small recovery-muted">Private to you and your authorised coach. Your clinician’s advice guides your return.</p></form><button class="recovery-help-link" type="button" data-recovery-page="support">New or worsening symptoms? Get support</button>`;
    }
    function historyHtml() {
      return `${heading('Recovery · Private history', 'Your <span>check-ins.</span>', 'Review individual symptoms with your coach and clinician.')}<section class="recovery-card">${history.length ? `<div class="recovery-history-list">${history.map(row => `<details ${detailId === row.id ? 'open' : ''} data-recovery-history-id="${escape(row.id)}"><summary><span>${escape(dayLabel(row.checkin_date))}</span><span>${total(row.ratings)} /80</span></summary>${recordHtml(row)}</details>`).join('')}</div>` : '<h2>No check-ins yet</h2><p>Your saved entries will appear here by date.</p>'}${hasMore ? `<button type="button" class="recovery-button" data-recovery-more ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : 'Show older check-ins'}</button>` : ''}</section>`;
    }
    function planHtml() {
      const episode = info.episode;
      return `${heading('Recovery · My plan', 'Your recovery <span>plan.</span>', 'Follow the instructions agreed with your treating clinician.')}<section class="recovery-card recovery-accent"><p class="recovery-eyebrow">${escape(episode?.title || 'Return to riding')}</p>${episode?.plan_text ? `<div class="recovery-preserve-lines">${escape(episode.plan_text)}</div>` : '<h2>Plan details to be added</h2><p>Your coach has not added the written instructions yet. Keep following the plan provided by your treating clinician.</p>'}${episode?.clinician_approved ? '<p class="recovery-small">Clinician approval recorded by your coach.</p>' : '<p class="recovery-small">Clinician approval has not yet been recorded in the app.</p>'}${episode?.clinician_name ? `<p class="recovery-label">Treating clinician</p><p>${escape(episode.clinician_name)}</p>` : ''}${episode?.review_date ? `<p class="recovery-label">Next review</p><p>${escape(dayLabel(episode.review_date))}</p>` : ''}<p class="recovery-disclaimer">There is no automatic return date. A symptom total or completed check-in does not clear riding.</p></section>${(info.episodes || []).filter(row => row.id !== episode?.id).length ? `<section class="recovery-card"><h2>Previous recovery periods</h2>${info.episodes.filter(row => row.id !== episode?.id).map(row => `<p>${escape(row.title || 'Recovery plan')} · ${escape(timeLabel(row.started_at || row.created_at))}</p>`).join('')}</section>` : ''}`;
    }
    function supportHtml() {
      return `${heading('Recovery · Support', 'You’re still <span>crew.</span>', 'Support is part of the plan.')}<section class="recovery-card"><h2>Keep your coach in the loop</h2><p>Add a note to your check-in so your authorised coach can review it.</p><button type="button" class="recovery-button" data-recovery-page="today">Open today’s check-in</button>${onMessageCoach ? '<button type="button" class="recovery-button" data-recovery-message-coach>Contact coach</button>' : ''}<p class="recovery-small recovery-muted">Check-ins and coach messages are not monitored for emergencies.</p></section><section class="recovery-card"><h2>Your treating clinician</h2><p>${info.episode?.clinician_name ? escape(info.episode.clinician_name) : 'Use the contact details provided with your recovery plan.'}</p><p>Contact your clinician about new or worsening symptoms or questions about activities.</p></section><details class="recovery-urgent"><summary>When to get urgent help</summary><p>Seek emergency medical care for a worsening headache that does not go away, repeated vomiting, confusion, a seizure, weakness, or difficulty waking. Don’t wait for an app reply.</p><a href="https://www.cdc.gov/heads-up/signs-symptoms/index.html" target="_blank" rel="noopener noreferrer">Concussion danger signs · CDC</a></details>`;
    }
    function coachHtml() {
      const episode = info.episode;
      if (!info.can_manage) return '<section class="recovery-card"><h2>Recovery records unavailable</h2><p>Only this rider and their authorised coach can access these records.</p></section>';
      const plan = planDraft || { title: episode?.title || 'Return to riding', plan_text: episode?.plan_text || '', clinician_name: episode?.clinician_name || '', review_date: episode?.review_date || '', expectedVersion: episode?.plan_version || 0, clinician_approved: episode?.clinician_approved === true };
      return `${heading('Coach tools · Rider care', 'Recovery <span>mode.</span>', escape(displayName))}<section class="recovery-card recovery-accent"><div class="recovery-mode-row"><div><h2>Recovery view</h2><p>${info.recovery_mode ? 'On · Daily symptom check-in replaces training' : 'Off · Normal JKCREW app'}</p></div><button type="button" class="recovery-switch" role="switch" aria-checked="${info.recovery_mode === true}" aria-label="Recovery view for ${escape(displayName)}" data-recovery-toggle ${busy || pending ? 'disabled' : ''}><span></span></button></div><p>Training progress, saved runs and previous recovery records stay intact.</p>${modePrompt ? `<div class="recovery-confirm"><h3>${info.recovery_mode ? 'Restore the normal app?' : 'Turn recovery view on?'}</h3><p>${info.recovery_mode ? 'Record the appropriate clinician clearance before restoring riding and training access. Switching the app view is not medical clearance.' : 'This rider will see their symptom check-in, recovery plan, history and support. Training features and normal training alerts will be paused.'}</p>${info.recovery_mode ? `<label class="recovery-check"><input type="checkbox" data-recovery-clearance ${confirmOff ? 'checked' : ''}><span>Appropriate clinician clearance has been obtained.</span></label><label class="recovery-field-label" for="recovery-clearance-note">Clearance record</label><textarea id="recovery-clearance-note" maxlength="1000" rows="3" placeholder="Clinician, date and the activity level cleared…">${escape(clearanceNote)}</textarea>` : ''}<div class="recovery-actions"><button type="button" class="recovery-button recovery-primary" data-recovery-confirm-mode ${busy ? 'disabled' : ''}>${info.recovery_mode ? 'Restore normal app' : 'Enable recovery view'}</button><button type="button" class="recovery-button" data-recovery-cancel-mode ${busy ? 'disabled' : ''}>Cancel</button></div></div>` : ''}</section><section class="recovery-card"><p class="recovery-eyebrow">Private check-ins</p><h2>${history.length ? 'Latest check-in' : 'No check-ins yet'}</h2>${history.length ? recordHtml(history[0]) : '<p>The rider’s symptom ratings, sleep and notes will appear here after they save.</p>'}${history.length > 1 ? `<details class="recovery-older"><summary>Earlier check-ins (${history.length - 1})</summary>${history.slice(1).map(row => `<details><summary>${escape(dayLabel(row.checkin_date))}</summary>${recordHtml(row)}</details>`).join('')}</details>` : ''}${hasMore ? `<button type="button" class="recovery-button" data-recovery-more ${loading || busy ? 'disabled' : ''}>Show older check-ins</button>` : ''}</section><section class="recovery-card"><p class="recovery-eyebrow">Clinician-led plan</p><h2>${escape(episode?.title || 'Return to riding')}</h2>${episode ? `${editPlan && !episode.closed_at ? `<form data-recovery-plan-form class="recovery-form" novalidate><fieldset ${busy || pending || planConflict ? 'disabled' : ''}><label class="recovery-field-label" for="recovery-plan-title">Plan title</label><input id="recovery-plan-title" data-recovery-plan-key="title" maxlength="100" required value="${escape(plan.title)}"><label class="recovery-field-label" for="recovery-plan-text">Clinician’s written instructions</label><textarea id="recovery-plan-text" data-recovery-plan-key="plan_text" maxlength="12000" rows="8" placeholder="Paste the exact instructions from the treating clinician’s plan…">${escape(plan.plan_text)}</textarea><label class="recovery-field-label" for="recovery-clinician">Treating clinician · optional</label><input id="recovery-clinician" data-recovery-plan-key="clinician_name" maxlength="160" value="${escape(plan.clinician_name)}"><label class="recovery-field-label" for="recovery-review-date">Next review · optional</label><input id="recovery-review-date" data-recovery-plan-key="review_date" type="date" value="${escape(plan.review_date)}"><label class="recovery-check recovery-approval"><input type="checkbox" data-recovery-plan-approved ${plan.clinician_approved ? 'checked' : ''}><span>I have confirmed that the treating clinician has approved this plan.</span></label></fieldset><p class="recovery-small recovery-muted">Record the clinician’s instructions. The app does not create a medical plan or infer riding clearance.</p>${planConflict ? `<div class="recovery-conflict"><p>Your plan draft is protected. A newer version is saved.</p><button class="recovery-button" type="button" data-recovery-compare-plan ${loading ? 'disabled' : ''}>Review latest saved plan</button>${planCompared ? `<div class="recovery-comparison"><h3>${escape(episode.title)}</h3><p class="recovery-preserve-lines">${escape(episode.plan_text || 'No written instructions')}</p><p>Clinician: ${escape(episode.clinician_name || 'Not recorded')} · Approved: ${episode.clinician_approved ? 'Yes' : 'Not recorded'}</p><p>Next review: ${escape(dayLabel(episode.review_date))}</p></div><button class="recovery-button" type="button" data-recovery-keep-plan>Keep my draft and continue editing</button><button class="recovery-button" type="button" data-recovery-use-plan>Use the saved plan</button>` : ''}</div>` : ''}<div class="recovery-actions"><button class="recovery-button recovery-primary" type="submit" ${busy || pending || planConflict ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save plan'}</button><button class="recovery-button" type="button" data-recovery-close-plan ${busy ? 'disabled' : ''}>Close editor</button></div></form>` : `<div class="recovery-preserve-lines">${episode.plan_text ? escape(episode.plan_text) : 'Written plan not added yet. The rider is reminded to follow their clinician’s existing instructions.'}</div>${episode.closed_at ? '<p class="recovery-small recovery-muted">Read-only previous plan. Enabling recovery view starts a new recovery period.</p>' : '<button type="button" class="recovery-button" data-recovery-edit-plan>Edit recovery plan</button>'}`}` : '<p>Enable recovery view to open a new private recovery record. You can then add the approved plan.</p>'}</section>`;
    }
    function render() {
      if (!current()) return;
      remember();
      const status = `<div class="recovery-status ${statusError ? 'is-error' : ''}" role="${statusError ? 'alert' : 'status'}" aria-live="polite">${escape(statusText)}</div>${retry ? `<button class="recovery-button recovery-retry" data-recovery-retry type="button" ${busy || loading ? 'disabled' : ''}>${pending ? 'Retry to confirm save' : 'Retry'}</button>` : ''}`;
      element.innerHTML = `<div class="recovery-mode ${role === 'coach' ? 'recovery-coach' : 'recovery-athlete'}" data-recovery-root>${toolbar()}${role === 'athlete' && info ? navigation() : ''}${status}${info ? (role === 'coach' ? coachHtml() : ({ today: checkinHtml, history: historyHtml, plan: planHtml, support: supportHtml }[page] || checkinHtml)()) : `<section class="recovery-card"><h2>${loading ? 'Loading recovery…' : 'Recovery could not load'}</h2><p>${loading ? 'Your private plan and check-ins are loading.' : 'Your records are safe. Check your connection and retry.'}</p></section>`}</div>`;
    }
    async function mutate(operation, successText) {
      if (!current() || busy) return;
      ++sequence; loading = false; busy = true; operation.successText = successText; pending = operation; message('Saving…'); render();
      try {
        const data = await rpc(operation.name, operation.args);
        if (!current()) return;
        const existingDraft = drafts.get(ownKey());
        if (existingDraft && operation.name === 'save_recovery_checkin') { existingDraft.attempt = null; existingDraft.dirty = false; }
        pending = null; applyInfo(data); modePrompt = false; confirmOff = false; clearanceNote = '';
        conflict = false; conflictCompared = false; planConflict = false; planCompared = false;
        if (operation.name === 'save_recovery_checkin') { editCheckin = false; drafts.set(ownKey(), newDraft()); }
        if (operation.name === 'save_recovery_plan') { editPlan = false; planDraft = null; }
        message(successText); notify(onChanged, { athleteId, info });
      } catch (error) {
        if (!current()) return;
        const certain = ['40001', '22023', '42501'].includes(error.code);
        if (certain) { pending = null; if (drafts.has(ownKey())) draft().attempt = null; }
        if (error.code === '40001' && operation.name === 'save_recovery_checkin') { conflict = true; conflictCompared = false; message(failure(error), true); }
        else if (error.code === '40001' && operation.name === 'save_recovery_plan') { planConflict = true; planCompared = false; editPlan = true; message('This plan changed on another device. Review the saved plan before updating it.', true); }
        else if (error.code === '40001') { modePrompt = false; confirmOff = false; message('The app view changed on another device, or your previous save succeeded. Refresh to see the current setting.', true, () => refresh()); }
        else message(failure(error), true, certain ? null : () => mutate(operation, successText));
      } finally { busy = false; if (current()) render(); }
    }
    function saveCheckin() {
      if (!current() || busy || pending || conflict || !info?.recovery_mode || !info?.episode) return;
      const data = draft();
      if (ratedCount() !== 8) { message('Rate all eight symptoms from 0 to 10. Use 0 for none.', true); validationError = 'ratings'; render(); return; }
      if (!Object.hasOwn(SLEEP, data.sleep)) { message('Choose how you slept last night.', true); validationError = 'sleep'; render(); return; }
      const operation = { name: 'save_recovery_checkin', args: { p_episode_id: info.episode.id, p_checkin_date: info.today_date, p_ratings: Object.fromEntries(SYMPTOMS.map(([key]) => [key, Number(data.ratings[key])])), p_sleep: data.sleep, p_notes: data.notes.trim(), p_expected_version: data.expectedVersion, p_request_id: crypto.randomUUID() } };
      data.attempt = operation; mutate(operation, 'Check-in saved. Your coach can review it.');
    }
    function savePlan() {
      if (!current() || busy || pending || planConflict || !info?.can_manage || !info.episode || info.episode.closed_at) return;
      const data = planDraft;
      if (!data?.title?.trim()) { message('Add a title for this recovery plan.', true); validationError = 'title'; render(); return; }
      mutate({ name: 'save_recovery_plan', args: { p_episode_id: info.episode.id, p_expected_version: data.expectedVersion, p_title: data.title.trim(), p_plan_text: data.plan_text.trim(), p_clinician_name: data.clinician_name.trim(), p_review_date: data.review_date || null, p_clinician_approved: data.clinician_approved === true } }, 'Recovery plan saved.');
    }
    function onClick(event) {
      const button = event.target.closest('button'); if (!button || !element.contains(button) || button.disabled) return;
      if (button.dataset.recoveryPage && !busy) { page = button.dataset.recoveryPage; if (!pending && !conflict && !planConflict) message(''); render(); }
      else if (button.hasAttribute('data-recovery-refresh')) refresh();
      else if (button.hasAttribute('data-recovery-retry')) retry?.();
      else if (button.hasAttribute('data-recovery-more')) refresh({ more: true });
      else if (button.hasAttribute('data-recovery-edit-checkin')) { editCheckin = true; render(); }
      else if (button.hasAttribute('data-recovery-account')) onAccount?.();
      else if (button.hasAttribute('data-recovery-message-coach')) onMessageCoach?.();
      else if (button.hasAttribute('data-recovery-compare-plan')) refresh({ comparePlan: true });
      else if (button.hasAttribute('data-recovery-keep-plan') && planCompared) { planDraft.expectedVersion = info.episode.plan_version; planConflict = false; planCompared = false; message('Your draft is ready to edit. Saving will update the plan you just reviewed.'); render(); }
      else if (button.hasAttribute('data-recovery-use-plan') && planCompared) { planDraft = null; editPlan = false; planConflict = false; planCompared = false; message('Showing the latest saved plan.'); render(); }
      else if (button.hasAttribute('data-recovery-compare')) refresh({ compare: true });
      else if (button.hasAttribute('data-recovery-keep-draft') && conflictCompared) { draft().expectedVersion = Number(todayRecord()?.version) || 0; conflict = false; conflictCompared = false; message('Your draft is ready to edit. Saving will update the entry you just compared.'); render(); }
      else if (button.hasAttribute('data-recovery-use-saved') && conflictCompared) { drafts.set(ownKey(), newDraft()); conflict = false; editCheckin = false; message('Showing the latest saved check-in.'); render(); }
      else if (button.hasAttribute('data-recovery-toggle') && info?.can_manage) { modePrompt = !modePrompt; message(''); render(); }
      else if (button.hasAttribute('data-recovery-cancel-mode')) { modePrompt = false; confirmOff = false; clearanceNote = ''; render(); }
      else if (button.hasAttribute('data-recovery-confirm-mode') && info?.can_manage && !pending) {
        if (info.recovery_mode && (!confirmOff || !clearanceNote.trim())) { message('Record the clinician clearance and confirm it before restoring training access.', true); validationError = 'clearance'; render(); return; }
        mutate({ name: 'set_rider_recovery_mode', args: { p_athlete_id: athleteId, p_enabled: !info.recovery_mode, p_expected_version: info.mode_version, p_clearance_note: info.recovery_mode ? clearanceNote.trim() : '' } }, info.recovery_mode ? 'Normal app view restored. Recovery history is preserved.' : 'Recovery view enabled.');
      } else if (button.hasAttribute('data-recovery-edit-plan') && info.episode && !info.episode.closed_at) { const e = info.episode; planDraft = planDraft || { title: e.title || 'Return to riding', plan_text: e.plan_text || '', clinician_name: e.clinician_name || '', review_date: e.review_date || '', expectedVersion: e.plan_version || 0, clinician_approved: e.clinician_approved === true }; editPlan = true; render(); }
      else if (button.hasAttribute('data-recovery-close-plan')) { editPlan = false; render(); }
    }
    function onInput(event) {
      const input = event.target;
      if (!current() || busy || !info || input.matches(':disabled')) return;
      if (input.hasAttribute('data-recovery-number') || input.hasAttribute('data-recovery-range')) {
        const key = input.dataset.recoveryNumber || input.dataset.recoveryRange, data = draft(); data.ratings[key] = input.value; data.dirty = true;
        const row = input.closest('[data-recovery-rating-row]'), range = row.querySelector('[data-recovery-range]'), number = row.querySelector('[data-recovery-number]'), valid = validRating(input.value);
        row.dataset.rated = String(valid); if (input === range) number.value = input.value; else range.value = valid ? input.value : 0;
        range.setAttribute('aria-valuetext', valid ? `${input.value} out of 10` : 'Not rated');
        element.querySelector('[data-recovery-rated]').textContent = `${ratedCount()} of 8 symptoms rated`;
        element.querySelector('[data-recovery-total]').textContent = `${ratedCount() === 8 ? total(data.ratings) : '—'} /80`;
      } else if (input.id === 'recovery-notes') { draft().notes = input.value; draft().dirty = true; }
      else if (input.dataset.recoveryPlanKey && planDraft) { planDraft[input.dataset.recoveryPlanKey] = input.value; planDraft.dirty = true; }
      else if (input.id === 'recovery-clearance-note') clearanceNote = input.value;
      clearResolvedValidation();
    }
    function onChange(event) { if (!current() || busy || !info || event.target.matches(':disabled')) return; if (event.target.hasAttribute('data-recovery-plan-approved') && planDraft) { planDraft.clinician_approved = event.target.checked; planDraft.dirty = true; } else if (event.target.name === 'recovery-sleep') { draft().sleep = event.target.value; draft().dirty = true; } else if (event.target.hasAttribute('data-recovery-clearance')) confirmOff = event.target.checked; clearResolvedValidation(); }
    function onRangePointer(event) { if (event.target.hasAttribute('data-recovery-range')) onInput(event); }
    function onRangeKey(event) { if (event.target.hasAttribute('data-recovery-range') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { const input = event.target; setTimeout(() => { if (current() && input.isConnected) onInput({ target: input }); }, 0); } }
    function onSubmit(event) { event.preventDefault(); if (event.target.hasAttribute('data-recovery-checkin-form')) saveCheckin(); else if (event.target.hasAttribute('data-recovery-plan-form')) savePlan(); }
    function onToggle(event) { if (event.target.hasAttribute('data-recovery-history-id') && event.target.open) detailId = event.target.dataset.recoveryHistoryId; }
    function onVisible() { if (document.visibilityState !== 'hidden' && current() && !drafts.get(ownKey())?.dirty && !pending && !editPlan) refresh(); }
    element.addEventListener('click', onClick); element.addEventListener('input', onInput); element.addEventListener('change', onChange); element.addEventListener('submit', onSubmit); element.addEventListener('toggle', onToggle, true); element.addEventListener('pointerup', onRangePointer); element.addEventListener('keydown', onRangeKey);
    window.addEventListener('online', onVisible); document.addEventListener('visibilitychange', onVisible);
    const handle = { element, refresh, destroy() { if (destroyed) return; remember(); destroyed = true; ++sequence; element.removeEventListener('click', onClick); element.removeEventListener('input', onInput); element.removeEventListener('change', onChange); element.removeEventListener('submit', onSubmit); element.removeEventListener('toggle', onToggle, true); element.removeEventListener('pointerup', onRangePointer); element.removeEventListener('keydown', onRangeKey); window.removeEventListener('online', onVisible); document.removeEventListener('visibilitychange', onVisible); mounts.delete(handle); element.replaceChildren(); info = null; history = []; planDraft = null; pending = null; } };
    mounts.add(handle); render(); refresh(); return handle;
  }
  window.JKCRecovery = Object.freeze({
    mountAthlete: options => mount({ ...options, role: 'athlete' }),
    mountCoach: options => mount({ ...options, role: 'coach' }),
    cleanup,
  });
})();
