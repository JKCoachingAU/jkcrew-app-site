/* Private video alongside the existing HD Run Builder. Signalling is authenticated;
   media travels directly between participants (or through configured TURN). */
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const terminal = new Set(['ended', 'cancelled', 'declined', 'missed']);
  const reasons = {ended:'Call ended',cancelled:'Call cancelled',declined:'Call declined',missed:'No answer'};
  function mount({client, userId, clientId, session, onSession, onEnd, onMessage, onDataState, isCurrent = () => true}) {
    let stopped = false, ended = false, suspended = false, pc = null, stream = null, remote = null, mediaBusy = false, qualityBusy = false;
    let dataChannel = null, dataOpen = false, signalsChannel = null, signalsConnected = false, signalWakeTimer = null;
    let lastPoll = 0, compactStatusSupported = true, lowData = !!navigator.connection?.saveData, optionsOpen = false, dockLeft = false;
    let makingOffer = false, ignoreOffer = false, settingAnswer = false, signalBusy = false, seq = 0, lastHeartbeat = 0;
    let current = session, status = 'Ringing…', error = '', muted = false, cameraOff = session.call_mode === 'audio', minimized = !!window.matchMedia?.('(max-width: 650px)').matches;
    let bootPromise = null;
    let lastRestart = 0, iceQueue = [], outgoing = [], transportBusy = false, booting = false;
    const polite = String(userId) > String(session.athlete_id === userId ? session.coach_id : session.athlete_id);
    const element = document.createElement('aside');
    element.className = 'run-call'; element.setAttribute('aria-label', 'Private live run call');
    const peerName = userId === session.athlete_id ? session.coach_name || 'Coach' : session.athlete_name || 'Rider';
    element.innerHTML = `<header><div><span class="run-call-dot"></span><strong>${escape(peerName)}</strong></div><button type="button" data-call="size" aria-label="Minimise video" aria-expanded="true">−</button></header>
      <div class="run-call-videos"><div class="run-call-remote"><video data-remote autoplay playsinline></video><span>${escape(peerName)}</span></div><div class="run-call-self"><video data-local autoplay playsinline muted></video><span>You</span></div></div>
      <p class="run-call-status" role="status" aria-live="polite"></p><p class="run-call-error" role="alert" hidden></p>
      <div class="run-call-controls"><button type="button" data-call="mic" aria-label="Mute microphone" aria-pressed="false">Mic on</button><button type="button" data-call="camera" aria-label="Turn camera off" aria-pressed="false">Camera on</button><button type="button" data-call="options" aria-label="Call options" aria-expanded="false">More</button><button type="button" data-call="end" class="run-call-end">End call</button></div>
      <div class="run-call-options" hidden><button type="button" data-call="quality" aria-pressed="false">Low data off</button><button type="button" data-call="audio">Audio only</button><button type="button" data-call="dock">Move video left</button></div>
      <div class="run-call-recovery" hidden><button type="button" data-call="retry">Retry camera / connection</button><button type="button" data-call="audio">Use audio only</button><button type="button" data-call="play">Play audio</button></div>`;
    document.body.append(element); document.body.classList.add("has-live-run-call");
    const localVideo = element.querySelector('[data-local]'), remoteVideo = element.querySelector('[data-remote]');
    const alive = () => !stopped && isCurrent();
    const active = () => alive() && !suspended && !ended;
    const videoConstraints = () => lowData ? {width:{ideal:320,max:320},height:{ideal:180,max:180},frameRate:{ideal:12,max:15},facingMode:'user'} : {width:{ideal:640},height:{ideal:360},frameRate:{ideal:24,max:30},facingMode:'user'};
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
      element.classList.toggle('is-docked-left', dockLeft);
      element.querySelector('.run-call-options').hidden = !optionsOpen || ended;
      element.querySelector('[data-call="options"]').setAttribute('aria-expanded', String(optionsOpen && !ended));
      const quality = element.querySelector('[data-call="quality"]');
      quality.textContent = `Low data ${lowData ? 'on' : 'off'}`; quality.setAttribute('aria-pressed', String(lowData)); quality.disabled = mediaBusy || qualityBusy || ended;
      element.querySelector('[data-call="dock"]').textContent = `Move video ${dockLeft ? 'right' : 'left'}`;
      element.querySelector('.run-call-status').textContent = status;
      const alert = element.querySelector('.run-call-error'); alert.textContent = error; alert.hidden = !error;
      element.querySelector('.run-call-recovery').hidden = !error || ended;
      element.querySelectorAll('[data-call="audio"], [data-call="retry"]').forEach(button => { button.disabled = mediaBusy || ended; });
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
    function setDataState(open) {
      if (dataOpen === open) return;
      dataOpen = open;
      try { onDataState?.(open); } catch { /* A workspace redraw cannot interrupt media cleanup. */ }
    }
    function validMessage(value, depth = 0) {
      if (depth > 12) return false;
      if (value == null || typeof value === 'string' || typeof value === 'boolean') return true;
      if (typeof value === 'number') return Number.isFinite(value);
      if (Array.isArray(value)) return value.every(item => validMessage(item, depth + 1));
      if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
      return Object.entries(value).every(([key, item]) => !['__proto__','prototype','constructor'].includes(key) && validMessage(item, depth + 1));
    }
    function serializeMessage(payload) {
      try {
        if (!payload || Array.isArray(payload) || typeof payload !== 'object' || !validMessage(payload)) return null;
        const text = JSON.stringify(payload);
        return new TextEncoder().encode(text).byteLength <= 4096 ? text : null;
      } catch { return null; }
    }
    function bindDataChannel(channel, peer) {
      if (!active() || pc !== peer || channel.label !== 'jkcrew-workspace' || (dataChannel && dataChannel !== channel)) { channel.close(); return; }
      dataChannel = channel;
      channel.onopen = () => { if (active() && pc === peer && dataChannel === channel) setDataState(true); };
      channel.onclose = () => { if (dataChannel === channel) { dataChannel = null; setDataState(false); } };
      channel.onerror = () => { if (dataChannel === channel) setDataState(false); };
      channel.onmessage = event => {
        if (!active() || pc !== peer || dataChannel !== channel || typeof event.data !== 'string' || new TextEncoder().encode(event.data).byteLength > 4096) return;
        try {
          const payload = JSON.parse(event.data);
          if (serializeMessage(payload) !== null) onMessage?.(payload);
        } catch { /* Ignore malformed peer messages; do not break the call. */ }
      };
      if (channel.readyState === 'open') setDataState(true);
    }
    function sendMessage(payload) {
      if (!active() || !dataOpen || dataChannel?.readyState !== 'open' || dataChannel.bufferedAmount > 65536) return false;
      const text = serializeMessage(payload); if (text === null) return false;
      try { dataChannel.send(text); return true; } catch { return false; }
    }
    function releaseMedia() {
      if (dataChannel) { dataChannel.onopen = dataChannel.onclose = dataChannel.onerror = dataChannel.onmessage = null; dataChannel.close(); dataChannel = null; }
      setDataState(false);
      if (pc) { pc.ontrack = pc.onicecandidate = pc.onnegotiationneeded = pc.onconnectionstatechange = pc.ondatachannel = null; pc.close(); pc = null; }
      for (const track of stream?.getTracks() || []) track.stop();
      stream = null; remote = null; localVideo.srcObject = null; remoteVideo.srcObject = null;
      outgoing = []; iceQueue = []; makingOffer = false; settingAnswer = false; ignoreOffer = false;
    }
    function update(next) {
      if (!alive() || !next) return;
      current = next;
      if (terminal.has(next.call_status)) {
        ended = true; status = reasons[next.call_status]; error = ''; releaseMedia();
      } else if (next.call_status === 'active') {
        if (!suspended && !pc && !booting) void boot();
      } else status = 'Ringing…';
      paint();
    }
    async function acquireMedia(audioOnly = false) {
      if (mediaBusy || !active()) return;
      mediaBusy = true; paint();
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone need a secure browser connection.');
        const next = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:audioOnly ? false : videoConstraints()});
        if (!active()) { next.getTracks().forEach(t => t.stop()); return; }
        for (const t of stream?.getTracks() || []) t.stop();
        stream = next; cameraOff = audioOnly;
        stream.getAudioTracks().forEach(track => { track.enabled = !muted; });
        localVideo.srcObject = stream;
        await localVideo.play().catch(() => {});
        if (!active() || stream !== next) return;
        const mediaPeer = pc;
        if (mediaPeer) {
          for (const kind of ['audio','video']) {
            if (!active() || pc !== mediaPeer || stream !== next) return;
            const sender = mediaPeer.getTransceivers().find(t => t.sender.track?.kind === kind || t.receiver.track?.kind === kind)?.sender;
            const track = next.getTracks().find(t => t.kind === kind) || null;
            if (sender) {
              await sender.replaceTrack(track);
              if (!active() || pc !== mediaPeer || stream !== next) return;
              const transceiver = mediaPeer.getTransceivers().find(t => t.sender === sender);
              if (track && transceiver && transceiver.direction !== 'sendrecv') transceiver.direction = 'sendrecv';
            } else if (track) mediaPeer.addTrack(track, next);
          }
        }
        await applyVideoQuality();
        if (active() && stream === next) error = '';
      } catch (e) {
        if (!active()) return;
        error = ['NotAllowedError','PermissionDeniedError'].includes(e.name)
          ? 'Camera or microphone permission was denied. Allow access in your browser, then retry. You can also try audio only.'
          : e.name === 'NotFoundError' ? 'No camera or microphone found. Connect a device or try audio only.'
          : e.name === 'NotReadableError' ? 'Your camera or microphone is in use. Close the other call, then retry.'
          : e.message || 'Media could not connect. Retry or use audio only.';
      } finally { mediaBusy = false; paint(); }
    }
    async function applyVideoQuality() {
      const qualityStream = stream, qualityPeer = pc, requestedLowData = lowData;
      const track = qualityStream?.getVideoTracks()[0];
      if (track) await track.applyConstraints(videoConstraints()).catch(() => {});
      if (!active() || stream !== qualityStream || pc !== qualityPeer || lowData !== requestedLowData) return;
      for (const sender of qualityPeer?.getSenders() || []) {
        if (!active() || stream !== qualityStream || pc !== qualityPeer || lowData !== requestedLowData) return;
        if (sender.track?.kind !== 'video') continue;
        const params = sender.getParameters();
        // Some browsers expose encodings only after negotiation. Capture constraints
        // still reduce traffic there; apply the sender cap again on connection.
        if (!params.encodings?.length) continue;
        for (const encoding of params.encodings) {
          encoding.maxBitrate = lowData ? 180000 : 850000;
          encoding.maxFramerate = lowData ? 15 : 30;
        }
        await sender.setParameters(params).catch(() => {});
      }
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
      if (!active() || booting || pc) return;
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
        if (!active()) return;
        const peer = pc = new RTCPeerConnection(config);
        remote = new MediaStream(); remoteVideo.srcObject = remote;
        peer.ondatachannel = event => bindDataChannel(event.channel, peer);
        peer.ontrack = event => {
          if (!alive() || peer !== pc) return;
          if (!remote.getTracks().some(t => t.id === event.track.id)) remote.addTrack(event.track);
          remoteVideo.play().catch(() => { if (active() && peer === pc) { error = 'Tap Play audio to hear the other participant.'; paint(); } });
        };
        peer.onicecandidate = event => { if (active() && peer === pc && event.candidate) void send('ice',event.candidate.toJSON()).catch(() => {}); };
        peer.onnegotiationneeded = async () => {
          try {
            if (!active() || peer !== pc) return;
            makingOffer = true; await peer.setLocalDescription();
            if (active() && peer === pc) await send(peer.localDescription.type,peer.localDescription.toJSON());
          }
          catch (e) { if (alive() && peer === pc) { error = 'Connecting was interrupted. Retry the connection.'; paint(); } }
          finally { makingOffer = false; }
        };
        peer.onconnectionstatechange = () => {
          if (peer !== pc || !alive()) return;
          const connection = peer.connectionState;
          status = connection === 'connected' ? 'Connected · your run saves separately' : connection === 'disconnected' ? 'Reconnecting… your run is kept' : connection === 'failed' ? 'Connection needs attention' : 'Connecting…';
          if (connection === 'connected') {
            void applyVideoQuality();
            if (!polite && !dataChannel) bindDataChannel(peer.createDataChannel('jkcrew-workspace', {ordered:true}), peer);
            if (dataChannel?.readyState === 'open') setDataState(true);
            if (/connect|network/i.test(error)) error = '';
          }
          if (connection === 'disconnected' || connection === 'failed' || connection === 'closed') setDataState(false);
          if (connection === 'failed') { error = 'Video could not connect on this network. Retry or try another network. A relay service may be needed.'; restart(); }
          paint();
        };
        if (!stream) await acquireMedia(cameraOff);
        if (!active() || peer !== pc) return;
        for (const track of stream?.getTracks() || []) if (!peer.getSenders().some(s => s.track === track)) peer.addTrack(track,stream);
        // Receive the other participant even when our own camera permission failed.
        if (!stream) { peer.addTransceiver('audio',{direction:'recvonly'}); peer.addTransceiver('video',{direction:'recvonly'}); }
        // One peer creates the channel, avoiding two competing collaboration streams.
        if (!polite) bindDataChannel(peer.createDataChannel('jkcrew-workspace', {ordered:true}), peer);
      } catch (e) { if (active()) { error = e.message || 'Video is unavailable in this browser.'; paint(); } }
      finally { booting = false; }
    }
    function restart() {
      if (pc && Date.now() - lastRestart > 10000) { lastRestart = Date.now(); pc.restartIce(); }
    }
    async function receive(message) {
      if (!pc || bootPromise) await boot();
      const peer = pc; if (!peer || !active()) return;
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
      if (!active() || peer !== pc) return;
      for (const candidate of iceQueue.splice(0)) await peer.addIceCandidate(candidate);
      if (description.type === 'offer') {
        if (!polite && !dataChannel) bindDataChannel(peer.createDataChannel('jkcrew-workspace', {ordered:true}), peer);
        await peer.setLocalDescription(); await send('answer',peer.localDescription.toJSON()); }
    }
    async function tick() {
      if (!active() || signalBusy) return;
      signalBusy = true;
      try {
        if (!navigator.onLine) { status = 'Offline · reconnecting when your network returns'; paint(); return; }
        if (Date.now() - lastHeartbeat > 15000) {
          const result = await request('heartbeat');
          if (!active()) return;
          lastHeartbeat = Date.now(); onSession?.(result.session); update(result.session);
        }
        if (!active()) return;
        if (current.call_status === 'active') {
          await drain();
          const result = await request('signals',{p_after:seq});
          if (!active()) return;
          onSession?.(result.session); update(result.session);
          for (const message of result.signals || []) { await receive(message); seq = Math.max(seq,Number(message.seq)); }
        } else {
          let result;
          try { result = await request(compactStatusSupported ? 'status' : 'heartbeat'); }
          catch (e) {
            if (!compactStatusSupported || !/unknown.*(?:action|call)|unsupported.*action|invalid.*action/i.test(e.message || '')) throw e;
            compactStatusSupported = false;
            result = await request('heartbeat');
            lastHeartbeat = Date.now();
          }
          if (active()) { onSession?.(result.session); update(result.session); }
        }
      } catch (e) { if (active()) {
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
      if (action === 'options') { optionsOpen = !optionsOpen; paint(); }
      if (action === 'dock') { dockLeft = !dockLeft; paint(); }
      if (action === 'quality' && !qualityBusy) {
        qualityBusy = true; lowData = !lowData; paint();
        try { await applyVideoQuality(); } finally { qualityBusy = false; paint(); }
      }
      if (action === 'mic') { muted = !muted; stream?.getAudioTracks().forEach(t => { t.enabled = !muted; }); paint(); }
      if (action === 'camera') {
        if (!stream?.getVideoTracks().length) await acquireMedia(false);
        else { cameraOff = !cameraOff; stream.getVideoTracks().forEach(t => { t.enabled = !cameraOff; }); }
        paint();
      }
      if (action === 'retry' || action === 'audio') {
        if (mediaBusy || !active()) return;
        const audioStream = stream, audioPeer = pc;
        if (action === 'audio' && audioStream?.getAudioTracks().length) {
          mediaBusy = true; paint();
          try {
            for (const track of audioStream.getVideoTracks()) {
              const sender = audioPeer?.getSenders().find(s => s.track === track);
              if (sender) await sender.replaceTrack(null).catch(() => {});
              // A hangup may clear the live stream while replaceTrack is pending.
              // Finish cleanup only on this captured stream, never a later call.
              audioStream.removeTrack(track); track.stop();
            }
            if (active() && stream === audioStream && pc === audioPeer) { cameraOff = true; error = ''; }
          } finally { mediaBusy = false; paint(); }
          if (!active() || stream !== audioStream || pc !== audioPeer) return;
        } else if (!stream || action === 'audio') await acquireMedia(action === 'audio');
        restart(); await tick();
      }
      if (action === 'play') { await remoteVideo.play().then(() => { error = ''; paint(); }).catch(() => {}); }
      if (action === 'end') { button.disabled = true; try { await onEnd?.(); } finally { if (alive()) button.disabled = false; } }
    };
    // Realtime only wakes the authenticated recipient's lightweight signal fetch.
    // Keep a bounded fallback for unavailable realtime, rather than polling SDP
    // or the course photo every 650 ms for the whole call.
    const wake = () => {
      if (!active() || signalWakeTimer) return;
      signalWakeTimer = setTimeout(() => { signalWakeTimer = null; lastPoll = Date.now(); void tick(); }, 100);
    };
    if (typeof client.channel === 'function') {
      try {
        signalsChannel = client.channel(`run-call-signals:${current.id}:${clientId}`)
          .on('postgres_changes', {event:'INSERT',schema:'public',table:'run_live_signals',filter:`recipient_id=eq.${userId}`}, payload => {
            if (payload.new?.session_id === current.id) wake();
          }).subscribe(state => { signalsConnected = state === 'SUBSCRIBED'; if (signalsConnected) wake(); });
      } catch { signalsConnected = false; }
    }
    const timer = setInterval(() => {
      const interval = current.call_status === 'ringing' ? 3000 : pc?.connectionState === 'connected' ? (signalsConnected ? 12000 : 5000) : 1000;
      if (Date.now() - lastPoll >= interval) { lastPoll = Date.now(); void tick(); }
    }, 500);
    const online = () => { lastHeartbeat = 0; lastPoll = Date.now(); restart(); void tick(); };
    const hide = () => { suspended = true; releaseMedia(); };
    const show = () => { if (!alive() || ended) return; suspended = false; lastHeartbeat = 0; lastPoll = Date.now(); update(current); if (current.call_status === 'ringing' && !stream) void acquireMedia(cameraOff); void tick(); };
    const visible = () => { if (!document.hidden && !suspended) online(); };
    window.addEventListener('online',online); window.addEventListener('pagehide',hide); window.addEventListener('pageshow',show); document.addEventListener('visibilitychange',visible);
    update(session);
    // Request media from the initiating/accepting action, before the peer connects.
    if (session.call_status === 'ringing') void acquireMedia(cameraOff);
    void tick();
    return {update, sendMessage, destroy() { stopped = true; clearInterval(timer); clearTimeout(signalWakeTimer); window.removeEventListener('online',online); window.removeEventListener('pagehide',hide); window.removeEventListener('pageshow',show); document.removeEventListener('visibilitychange',visible); if (signalsChannel) { try { Promise.resolve(client.removeChannel?.(signalsChannel) || signalsChannel.unsubscribe?.()).catch(() => {}); } catch {} signalsChannel = null; } releaseMedia(); element.remove(); if (!document.querySelector(".run-call")) document.body.classList.remove("has-live-run-call"); },
      inspect() { return {connectionState:pc?.connectionState || 'closed',localTracks:stream?.getTracks().filter(t => t.readyState === 'live').length || 0,remoteTracks:remote?.getTracks().length || 0,dataChannelState:dataChannel?.readyState || 'closed',lowData,ended}; }};
  }
  window.JKCrewLiveRunCall = {mount};
})();
