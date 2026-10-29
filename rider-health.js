/* Private wearable summary. Provider tokens and readings never enter browser storage. */
(() => {
  'use strict';
  const mounts = new Set();
  // OAuth returns an opaque one-use ticket, never tokens or health readings.
  // Remove it before the rest of the app starts; keep it only in this page's memory.
  let completionTicket = '', completionReceivedAt = 0, callbackFailed = false;
  try {
    const callback = new URL(window.location.href);
    const fragment = new URLSearchParams(callback.hash.slice(1));
    if (callback.searchParams.get('health') === 'error') { callbackFailed = true; callback.searchParams.delete('health'); history.replaceState(history.state, '', callback); }
    if (fragment.has('whoop_complete')) {
      const ticket = fragment.get('whoop_complete') || '';
      if (/^[a-f0-9]{64}$/.test(ticket)) { completionTicket = ticket; completionReceivedAt = Date.now(); }
      fragment.delete('whoop_complete'); callback.hash = fragment.toString();
      callback.searchParams.delete('health'); history.replaceState(history.state, '', callback);
    }
  } catch (_) { /* No provider credentials are read from a URL. */ }

  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const date = value => { const d = new Date(value || ''); return Number.isFinite(d.getTime()) ? d : null; };
  const time = value => date(value)?.toLocaleString(undefined, {day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}) || 'Time unavailable';
  const valueLabel = value => finite(value) === null ? '—' : Number(value).toLocaleString(undefined, {maximumFractionDigits:1});
  const duration = value => finite(value) === null ? '—' : `${Math.floor(Math.round(Number(value)) / 60)}h ${String(Math.round(Number(value)) % 60).padStart(2,'0')}m`;
  const HEART = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.4 4.6a5.5 5.5 0 0 0-7.8 0L12 5.2l-.6-.6a5.5 5.5 0 0 0-7.8 7.8L12 21l8.4-8.6a5.5 5.5 0 0 0 0-7.8Z" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h5l2-4 3 8 2-4h6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function cleanup() { [...mounts].forEach(handle => handle.destroy()); }
  function mount({element, client, userId, isCurrent = () => true, navigate = url => window.location.assign(url)} = {}) {
    if (!element || !client?.functions?.invoke || !userId) return {destroy() {}};
    cleanup();
    let destroyed = false, sequence = 0, busy = false, info = null, status = '', error = false, devicesOpen = false, selected = 'whoop', confirmDisconnect = false, lastFocus = null;
    const current = () => !destroyed && element.isConnected && isCurrent();
    const setMessage = (message, failed = false) => { status = message; error = failed; };
    function metric(label, value, unit, colour, observed) {
      return `<div class="rider-health-metric ${colour}"><dt>${escape(label)}</dt><dd>${escape(value)}${value !== '—' && unit ? `<small>${escape(unit)}</small>` : ''}</dd>${observed ? `<span>${escape(time(observed))}</span>` : ''}</div>`;
    }
    function readings() {
      const s = info?.summary;
      if (!s) return `<div class="rider-health-empty"><strong>${info?.connection === 'connected' ? 'Waiting for your first readings' : 'Your health, in one place'}</strong><p>${info?.connection === 'connected' ? 'Sync your WHOOP in its app, then refresh here.' : 'Connect a supported device to see sleep, heart rate and recovery.'}</p></div>`;
      const observed = s.metric_observed_at || {};
      const stale = !date(s.synced_at) || Date.now() - date(s.synced_at).getTime() > 24 * 60 * 60 * 1000;
      return `<p class="rider-health-source">WHOOP · ${stale ? 'Last saved readings' : 'Latest readings'}<span>Synced ${escape(time(s.synced_at))}</span></p><dl class="rider-health-metrics">${metric('Sleep', duration(s.sleep_minutes), '', 'sleep', observed.sleep)}${metric('Resting heart rate', valueLabel(s.resting_heart_rate_bpm), 'bpm', 'heart', observed.recovery)}${metric('HRV · RMSSD', valueLabel(s.hrv_rmssd_ms), 'ms', 'hrv', observed.recovery)}${metric('WHOOP recovery', valueLabel(s.recovery_percent), '%', 'recovery', observed.recovery)}</dl>${finite(s.strain) !== null ? `<p class="rider-health-strain">WHOOP day strain <strong>${escape(valueLabel(s.strain))}<span> / 21</span></strong>${observed.strain ? `<span>${escape(time(observed.strain))}</span>` : ''}</p>` : ''}`;
    }
    function devicePanel() {
      let body;
      if (selected === 'apple') body = '<p>Apple Health needs an iPhone app connection. Direct syncing isn’t available in JKCREW yet.</p>';
      else if (selected === 'garmin') body = '<p>Garmin syncing needs an approved Garmin integration. It isn’t available in JKCREW yet.</p>';
      else if (!info) body = '<p>Check your connection and retry to see WHOOP availability.</p>';
      else if (info.connection === 'connected' || info.connection === 'reconnect_required') body = `<p>${info.connection === 'reconnect_required' ? 'WHOOP needs your permission again before new readings can sync.' : 'Your WHOOP is connected. Readings update when you open Home or tap Refresh, after your device has synced with WHOOP.'}</p>${info.connection === 'reconnect_required' && info.availability === 'ready' ? '<button type="button" class="rider-health-button primary" data-health-action="connect">Reconnect WHOOP</button>' : ''}${confirmDisconnect ? '<p>Disconnect WHOOP and remove its saved health summary from JKCREW?</p><div class="rider-health-actions"><button type="button" class="rider-health-button" data-health-action="cancel-disconnect">Keep connected</button><button type="button" class="rider-health-button danger" data-health-action="disconnect">Disconnect & remove</button></div>' : '<button type="button" class="rider-health-text" data-health-action="confirm-disconnect">Disconnect WHOOP</button>'}`;
      else if (info.availability !== 'ready') body = '<p>WHOOP isn’t available yet. Your coach needs to finish the connection setup before you can link your device.</p>';
      else body = '<p>Share sleep, resting heart rate, HRV, recovery and strain with JKCREW. You can disconnect and remove these readings here anytime.</p><button type="button" class="rider-health-button primary" data-health-action="connect">Connect WHOOP <span aria-hidden="true">↗</span></button>';
      return `<details class="rider-health-devices" ${devicesOpen ? 'open' : ''}><summary>${info?.connection === 'connected' ? 'Manage device' : 'Choose a device'}<span aria-hidden="true">⌄</span></summary><div class="rider-health-providers" role="group" aria-label="Health device"><button type="button" data-health-provider="apple" aria-pressed="${selected === 'apple'}">Apple Health</button><button type="button" data-health-provider="whoop" aria-pressed="${selected === 'whoop'}">WHOOP</button><button type="button" data-health-provider="garmin" aria-pressed="${selected === 'garmin'}">Garmin</button></div><div class="rider-health-provider-detail">${body}</div><p class="rider-health-private">Only you can see your health summary.</p></details>`;
    }
    function render() {
      if (!current()) return;
      const focus = element.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focus?.dataset?.healthAction ? ['data-health-action', focus.dataset.healthAction] : focus?.dataset?.healthProvider ? ['data-health-provider', focus.dataset.healthProvider] : lastFocus;
      element.innerHTML = `<section class="rider-health-card" aria-label="Health summary"><header><div class="rider-health-heading"><span class="rider-health-icon">${HEART}</span><div><span class="rider-health-eyebrow">Your wellbeing</span><h2>Health summary</h2></div></div>${info?.connection === 'connected' ? '<button type="button" class="rider-health-text" data-health-action="refresh">↻ Refresh</button>' : `<span class="rider-health-connection">${info ? 'Not connected' : error ? 'Unavailable' : 'Checking…'}</span>`}</header>${readings()}<p class="rider-health-status ${error ? 'is-error' : ''}" role="${error ? 'alert' : 'status'}">${escape(status)}</p>${error ? '<button type="button" class="rider-health-text" data-health-action="retry">Retry</button>' : ''}${devicePanel()}</section>`;
      element.querySelector('section').setAttribute('aria-busy', String(busy));
      element.querySelectorAll('button').forEach(button => { button.disabled = busy; });
      const details = element.querySelector('details');
      details.ontoggle = () => { if (current() && element.contains(details)) devicesOpen = details.open; };
      element.querySelectorAll('[data-health-provider]').forEach(button => button.onclick = () => { selected = button.dataset.healthProvider; devicesOpen = true; confirmDisconnect = false; render(); });
      element.querySelectorAll('[data-health-action]').forEach(button => button.onclick = () => {
        const action = button.dataset.healthAction;
        if (action === 'confirm-disconnect' || action === 'cancel-disconnect') { confirmDisconnect = action === 'confirm-disconnect'; devicesOpen = true; render(); }
        else run(action === 'retry' ? 'status' : action);
      });
      if (focusKey) element.querySelector(`[${focusKey[0]}="${focusKey[1]}"]`)?.focus({preventScroll:true});
      lastFocus = busy ? focusKey : null;
    }
    async function request(action) {
      let timer;
      try {
        const result = await Promise.race([client.functions.invoke('health-whoop', {body:action === 'complete' ? {action, ticket:completionTicket} : {action}}), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 20000); })]);
        if (result?.error) throw result.error;
        if (!result?.data || result.data.provider !== 'whoop') throw new Error('unconfirmed');
        return result.data;
      } finally { clearTimeout(timer); }
    }
    async function run(action) {
      if (!current() || busy) return;
      if (completionTicket && Date.now() - completionReceivedAt >= 5 * 60 * 1000) completionTicket = '';
      if (action === 'status' && completionTicket) action = 'complete';
      busy = true; const requestId = ++sequence;
      setMessage(action === 'status' ? 'Checking your device…' : action === 'connect' ? 'Opening WHOOP…' : action === 'disconnect' ? 'Disconnecting WHOOP…' : 'Refreshing your readings…'); render();
      try {
        let result = await request(action);
        if (!current() || requestId !== sequence) return;
        if (action === 'complete') completionTicket = '';
        if (action === 'connect' && result.connection === 'connected' && !result.authorization_url) {
          info = result; setMessage('WHOOP is already connected.');
        } else if (action === 'connect') {
          const target = new URL(result.authorization_url);
          if (target.origin !== 'https://api.prod.whoop.com' || target.pathname !== '/oauth/oauth2/auth') throw new Error('invalid-redirect');
          navigate(target.href); setMessage('Continue in WHOOP to authorise the connection.');
        } else {
          info = result;
          if (['status', 'complete'].includes(action) && info.connection === 'connected' && info.availability === 'ready' && (info.sync_due === true || (info.sync_due === undefined && (!date(info.summary?.synced_at) || Date.now() - date(info.summary.synced_at).getTime() >= 15 * 60 * 1000)))) {
            result = await request('refresh');
            if (!current() || requestId !== sequence) return;
            info = result;
          }
          if (action === 'disconnect') {
            if (info.connection !== 'disconnected' || info.summary !== null) throw new Error('disconnect-unconfirmed');
            confirmDisconnect = false; setMessage(info.message || 'WHOOP disconnected. Saved readings removed.');
          }
          else if (info.connection === 'reconnect_required') { devicesOpen = true; setMessage('Reconnect WHOOP to update your readings.', true); }
          else setMessage(info.message || (info.connection === 'connected' && action === 'refresh' ? 'Showing the latest available readings.' : ''));
          if (callbackFailed) { callbackFailed = false; devicesOpen = true; setMessage('WHOOP connection wasn’t completed. You can try again.', true); }
        }
      } catch (failure) {
        if ([400,410].includes(Number(failure?.context?.status || failure?.status))) completionTicket = '';
        if (current() && [401, 403].includes(Number(failure?.context?.status || failure?.status))) { info = null; confirmDisconnect = false; setMessage('Sign in again to check your private health connection.', true); }
        else if (current() && requestId === sequence) setMessage(action === 'disconnect' ? 'Couldn’t confirm the disconnect. Retry to check your device connection.' : info?.summary ? 'Couldn’t update. These are your last saved readings. Please retry.' : 'Couldn’t check your health connection. Please retry.', true);
      } finally { if (current() && requestId === sequence) { busy = false; render(); } }
    }
    const handle = {destroy() { if (destroyed) return; destroyed = true; sequence++; info = null; element.replaceChildren(); mounts.delete(handle); }, refresh() { return run('status'); }};
    mounts.add(handle); render(); run('status'); return handle;
  }
  window.JKCRiderHealth = Object.freeze({mount,cleanup});
})();
