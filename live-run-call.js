/* Private video alongside the existing HD Run Builder. Signalling is authenticated;
   media travels directly between participants (or through configured TURN). */
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const terminal = new Set(['ended', 'cancelled', 'declined', 'missed']);
  const reasons = {ended:'Call ended',cancelled:'Call cancelled',declined:'Call declined',missed:'No answer'};
  function mount({client, userId, clientId, session, onSession, onEnd, isCurrent = () => true}) {
    let stopped = false, ended = false, pc = null, stream = null, remote = null, mediaBusy = false;
    let makingOffer = false, ignoreOffer = false, settingAnswer = false, signalBusy = false, seq = 0, lastHeartbeat = 0;
    let current = session, status = 'Ringing…', error = '', muted = false, cameraOff = session.call_mode === 'audio', minimized = false;
    let bootPromise = null;
    let lastRestart = 0, iceQueue = [], outgoing = [], transportBusy = false, booting = false;
    const polite = String(userId) > String(session.athlete_id === userId ? session.coach_id : session.athlete_id);
    const element = document.createElement('aside');
    element.className = 'run-call'; element.setAttribute('aria-label', 'Private live run call');
    const peerName = userId === session.athlete_id ? session.coach_name || 'Coach' : session.athlete_name || 'Rider';
    element.innerHTML = `<header><div><span class="run-call-dot"></span><strong>${escape(peerName)}</strong></div><button type="button" data-call="size" aria-label="Minimise video" aria-expanded="true">−</button></header>
      <div class="run-call-videos"><div class="run-call-remote"><video data-remote autoplay playsinline></video><span>${escape(peerName)}</span></div><div class="run-call-self"><video data-local autoplay playsinline muted></video><span>You</span></div></div>
      <p class="run-call-status" role="status" aria-live="polite"></p><p class="run-call-error" role="alert" hidden></p>
      <div class="run-call-controls"><button type="button" data-call="mic" aria-label="Mute microphone" aria-pressed="false">Mic on</button><button type="button" data-call="camera" aria-label="Turn camera off" aria-pressed="false">Camera on</button><button type="button" data-call="end" class="run-call-end">End call</button></div>
      <div class="run-call-recovery" hidden><button type="button" data-call="retry">Retry camera / connection</button><button type="button" data-call="audio">Use audio only</button><button type="button" data-call="play">Play audio</button></div>`;
    document.body.append(element); document.body.classList.add("has-live-run-call");
    const localVideo = element.querySelector('[data-local]'), remoteVideo = element.querySelector('[data-remote]');
    const alive = () => !stopped && isCurrent();
    async function request(action, extra = {}) {
      let timeout;
      const {data, error: rpcError} = await Promise.race([client.rpc('live_run_call_action', {p_action:action, p_session_id:current.id, p_client_id:clientId, ...extra}),new Promise((_,reject) => { timeout = setTimeout(() => reject(new Error('Call request timed out')),12000); })]).finally(() => clearTimeout(timeout));
      if (rpcError) throw rpcError;
      return data;
    }
    function paint() {
      if (!alive()) return;
      element.classList.toggle('is-minimized', minimized);
      element.classList.toggle('is-ended', ended);
      element.querySelector('.run-call-status').textContent = status;
      const alert = element.querySelector('.run-call-error'); alert.textContent = error; alert.hidden = !error;
      element.querySelector('.run-call-recovery').hidden = !error || ended;
      for (const [name, off, text] of [['mic',muted,'Mic'],['camera',cameraOff,'Camera']]) {
        const button = element.querySelector(`[data-call="${name}"]`);
        button.textContent = `${text} ${off ? 'off' : 'on'}`;
        button.setAttribute('aria-pressed', String(off));
        button.setAttribute('aria-label', name === 'mic' ? `${off ? 'Unmute' : 'Mute'} microphone` : `Turn camera ${off ? 'on' : 'off'}`);
        button.disabled = ended || mediaBusy;
      }
      element.querySelector('[data-call="end"]').textContent = ended ? 'Close' : current.call_status === 'ringing' ? 'Cancel call' : 'End call';
      const size = element.querySelector('[data-call="size"]'); size.textContent = minimized ? '+' : '−';
      size.setAttribute('aria-expanded', String(!minimized)); size.setAttribute('aria-label', `${minimized ? 'Expand' : 'Minimise'} video`);
    }
    function releaseMedia() {
      if (pc) { pc.ontrack = pc.onicecandidate = pc.onnegotiationneeded = pc.onconnectionstatechange = null; pc.close(); pc = null; }
      for (const track of stream?.getTracks() || []) track.stop();
      stream = null; remote = null; localVideo.srcObject = null; remoteVideo.srcObject = null;
      outgoing = []; iceQueue = [];
    }
    function update(next) {
      if (!alive() || !next) return;
      current = next;
      if (terminal.has(next.call_status)) {
        ended = true; status = reasons[next.call_status]; error = ''; releaseMedia();
      } else if (next.call_status === 'active') {
        if (!pc && !booting) void boot();
      } else status = 'Ringing…';
      paint();
    }
    async function acquireMedia(audioOnly = false) {
      if (mediaBusy || !alive() || ended) return;
      mediaBusy = true; paint();
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone need a secure browser connection.');
        const next = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:audioOnly ? false : {width:{ideal:640},height:{ideal:360},frameRate:{ideal:24,max:30},facingMode:'user'}});
        if (!alive() || ended) { next.getTracks().forEach(t => t.stop()); return; }
        for (const t of stream?.getTracks() || []) t.stop();
        stream = next; cameraOff = audioOnly; muted = false; localVideo.srcObject = stream;
        await localVideo.play().catch(() => {});
        if (pc) {
          for (const kind of ['audio','video']) {
            const sender = pc.getSenders().find(s => s.track?.kind === kind);
            const track = stream.getTracks().find(t => t.kind === kind) || null;
            if (sender) await sender.replaceTrack(track); else if (track) pc.addTrack(track, stream);
          }
        }
        error = '';
      } catch (e) {
        error = ['NotAllowedError','PermissionDeniedError'].includes(e.name)
          ? 'Camera or microphone permission was denied. Allow access in your browser, then retry. You can also try audio only.'
          : e.name === 'NotFoundError' ? 'No camera or microphone found. Connect a device or try audio only.'
          : e.name === 'NotReadableError' ? 'Your camera or microphone is in use. Close the other call, then retry.'
          : e.message || 'Media could not connect. Retry or use audio only.';
      } finally { mediaBusy = false; paint(); }
    }
    async function send(kind, data) {
      if (!alive() || ended) return;
      outgoing.push({id:crypto.randomUUID(),kind,data});
      await drain();
    }
    async function drain() {
      if (transportBusy || !alive() || ended) return;
      transportBusy = true;
      try {
        while (outgoing.length && alive() && !ended) {
          const item = outgoing[0];
          await request('signal',{p_message_id:item.id,p_payload:{kind:item.kind,data:item.data}});
          if (outgoing[0] === item) outgoing.shift();
        }
      } finally { transportBusy = false; }
    }
    function boot() {
      if (bootPromise) return bootPromise;
      bootPromise = initializePeer().finally(() => { bootPromise = null; });
      return bootPromise;
    }
    async function initializePeer() {
      if (!alive() || ended || booting || pc) return;
      booting = true; status = 'Connecting audio and video…'; paint();
      try {
        let config = {iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
        if (client.functions?.invoke) {
          try {
            let deadline;
            const result = await Promise.race([client.functions.invoke('live-run-ice',{body:{sessionId:current.id,clientId}}),new Promise((_,reject) => { deadline = setTimeout(() => reject(new Error('Connection settings timed out')),6000); })]).finally(() => clearTimeout(deadline));
            if (!result.error && Array.isArray(result.data?.iceServers)) config = {iceServers:result.data.iceServers};
          } catch { /* Direct connections still work; the UI explains any failed connection. */ }
        }
        if (!alive() || ended) return;
        const peer = pc = new RTCPeerConnection(config);
        remote = new MediaStream(); remoteVideo.srcObject = remote;
        peer.ontrack = event => {
          if (!alive() || peer !== pc) return;
          if (!remote.getTracks().some(t => t.id === event.track.id)) remote.addTrack(event.track);
          remoteVideo.play().catch(() => { error = 'Tap Play audio to hear the other participant.'; paint(); });
        };
        peer.onicecandidate = event => { if (event.candidate) void send('ice',event.candidate.toJSON()).catch(() => {}); };
        peer.onnegotiationneeded = async () => {
          try { makingOffer = true; await peer.setLocalDescription(); await send(peer.localDescription.type,peer.localDescription.toJSON()); }
          catch (e) { if (alive() && peer === pc) { error = 'Connecting was interrupted. Retry the connection.'; paint(); } }
          finally { makingOffer = false; }
        };
        peer.onconnectionstatechange = () => {
          if (peer !== pc || !alive()) return;
          const connection = peer.connectionState;
          status = connection === 'connected' ? 'Connected · your run saves separately' : connection === 'disconnected' ? 'Reconnecting… your run is kept' : connection === 'failed' ? 'Connection needs attention' : 'Connecting…';
          if (connection === 'connected' && /connect|network/i.test(error)) error = '';
          if (connection === 'failed') { error = 'Video could not connect on this network. Retry or try another network. A relay service may be needed.'; restart(); }
          paint();
        };
        if (!stream) await acquireMedia(cameraOff);
        if (!alive() || ended || peer !== pc) return;
        for (const track of stream?.getTracks() || []) if (!peer.getSenders().some(s => s.track === track)) peer.addTrack(track,stream);
        // Receive the other participant even when our own camera permission failed.
        if (!stream) { peer.addTransceiver('audio',{direction:'recvonly'}); peer.addTransceiver('video',{direction:'recvonly'}); }
      } catch (e) { error = e.message || 'Video is unavailable in this browser.'; paint(); }
      finally { booting = false; }
    }
    function restart() {
      if (pc && Date.now() - lastRestart > 10000) { lastRestart = Date.now(); pc.restartIce(); }
    }
    async function receive(message) {
      if (!pc || bootPromise) await boot();
      const peer = pc; if (!peer || !alive() || ended) return;
      if (message.kind === 'ice') {
        if (ignoreOffer) return;
        if (!peer.remoteDescription) iceQueue.push(message.payload);
        else await peer.addIceCandidate(message.payload);
        return;
      }
      const description = message.payload;
      const ready = !makingOffer && (peer.signalingState === 'stable' || settingAnswer);
      ignoreOffer = !polite && description.type === 'offer' && !ready;
      if (ignoreOffer) { iceQueue = []; return; }
      settingAnswer = description.type === 'answer';
      try { await peer.setRemoteDescription(description); } finally { settingAnswer = false; }
      for (const candidate of iceQueue.splice(0)) await peer.addIceCandidate(candidate);
      if (description.type === 'offer') { await peer.setLocalDescription(); await send('answer',peer.localDescription.toJSON()); }
    }
    async function tick() {
      if (!alive() || ended || signalBusy) return;
      signalBusy = true;
      try {
        if (!navigator.onLine) { status = 'Offline · reconnecting when your network returns'; paint(); return; }
        if (Date.now() - lastHeartbeat > 15000) {
          const result = await request('heartbeat');
          if (!alive()) return;
          lastHeartbeat = Date.now(); onSession?.(result.session); update(result.session);
        }
        if (ended) return;
        if (current.call_status === 'active') {
          await drain();
          const result = await request('signals',{p_after:seq});
          if (!alive()) return;
          onSession?.(result.session); update(result.session);
          for (const message of result.signals || []) { await receive(message); seq = Math.max(seq,Number(message.seq)); }
        } else {
          const result = await request('get');
          if (alive()) { onSession?.(result.session); update(result.session); }
        }
      } catch (e) { if (alive()) {
        if (e.code === '42501' || /another tab|another.*device|not authorized|not available to|linked rider|feature.*disabled/i.test(e.message || '')) { ended = true; status = 'Call access ended'; error = e.message || 'Your coach can help you reconnect.'; releaseMedia(); }
        else status = 'Connection interrupted · retrying';
        paint();
      } }
      finally { signalBusy = false; }
    }
    element.onclick = async event => {
      const button = event.target.closest('[data-call]'); if (!button) return;
      const action = button.dataset.call;
      if (action === 'size') { minimized = !minimized; paint(); }
      if (action === 'mic') { muted = !muted; stream?.getAudioTracks().forEach(t => { t.enabled = !muted; }); paint(); }
      if (action === 'camera') {
        if (!stream?.getVideoTracks().length) await acquireMedia(false);
        else { cameraOff = !cameraOff; stream.getVideoTracks().forEach(t => { t.enabled = !cameraOff; }); }
        paint();
      }
      if (action === 'retry' || action === 'audio') { if (!stream || action === 'audio') await acquireMedia(action === 'audio'); restart(); await tick(); }
      if (action === 'play') { await remoteVideo.play().then(() => { error = ''; paint(); }).catch(() => {}); }
      if (action === 'end') { button.disabled = true; try { await onEnd?.(); } finally { if (alive()) button.disabled = false; } }
    };
    const timer = setInterval(() => { void tick(); },650);
    const online = () => { lastHeartbeat = 0; restart(); void tick(); };
    const hide = () => releaseMedia();
    window.addEventListener('online',online); window.addEventListener('pagehide',hide);
    update(session);
    // Request media from the initiating/accepting action, before the peer connects.
    if (session.call_status === 'ringing') void acquireMedia(cameraOff);
    void tick();
    return {update, destroy() { stopped = true; clearInterval(timer); window.removeEventListener('online',online); window.removeEventListener('pagehide',hide); releaseMedia(); element.remove(); if (!document.querySelector(".run-call")) document.body.classList.remove("has-live-run-call"); },
      inspect() { return {connectionState:pc?.connectionState || 'closed',localTracks:stream?.getTracks().filter(t => t.readyState === 'live').length || 0,remoteTracks:remote?.getTracks().length || 0,ended}; }};
  }
  window.JKCrewLiveRunCall = {mount};
})();
