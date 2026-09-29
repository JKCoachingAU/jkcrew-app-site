/* Private, ephemeral coaching tools. This protocol never writes a run or awards points. */
(function (root) {
  'use strict';
  const LIMIT = 3600;
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(value);
  const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const compare = (a, b) => a.n - b.n || a.by.localeCompare(b.by);
  function create(options) {
    const { sessionId, userId, peerId, coachId, send, context, onChange = () => {}, onPlayback = () => {}, onSelection = () => {} } = options;
    const now = options.now || (() => performance.now());
    const token = options.token || (() => crypto.randomUUID());
    let connected = false, ready = false, epoch = '', peerEpoch = '', seq = 0, lastSeq = 0;
    let wanted = false, peerWanted = false, following = false, pointing = false, pointer = null, selection = null;
    let watch = null, counter = 0, lastPulse = 0, lastHello = 0, lastPing = 0, lastPointer = -Infinity;
    let pendingPing = null, latency = 0, status = '', lastContext = { ...context() }, destroyed = false;
    const snapshot = () => ({ connected, ready, wanted, peerWanted, following, pointing, pointer, selection,
      watching: Boolean(watch && wanted && peerWanted && ready), status, playback: watch ? position() : null });
    const changed = () => { if (!destroyed) onChange(snapshot()); };
    const packet = (kind, body = {}, handshake = false) => {
      if (!connected || destroyed || (!handshake && !ready)) return false;
      return send({ protocol: 'jk-run-companion', v: 1, session: sessionId, epoch, target: peerEpoch || null, seq: ++seq, kind, ...body }) === true;
    };
    function position() {
      if (!watch) return null;
      const seconds = Math.min(watch.duration, watch.seconds + (watch.playing ? Math.max(0, now() - watch.at) / 1000 : 0));
      return { seconds, duration: watch.duration, playing: watch.playing && seconds < watch.duration, stamp: watch.stamp };
    }
    function halt(message = '', tell = false) {
      const wasWatching = Boolean(watch);
      wanted = false; peerWanted = false; watch = null; status = message;
      if (tell) packet('watch', { wants: false, run: context().run });
      if (wasWatching) onPlayback({ stopped: true });
      changed();
    }
    function hello() { lastHello = now(); packet('hello', {}, true); }
    function startIfAgreed() {
      if (!wanted || !peerWanted || watch || !ready) return;
      if (userId === coachId) control({ seconds: 0, playing: false }, true);
    }
    function control(value, initial = false) {
      if (!ready || !wanted || !peerWanted || (!watch && !initial)) return false;
      const c = context(), duration = Math.min(LIMIT, Math.max(1, c.duration));
      if (!finite(value.seconds, 0, duration) || typeof value.playing !== 'boolean') return false;
      const stamp = { n: ++counter, by: userId };
      watch = { ...value, duration, stamp, run: c.run, at: now() };
      lastPulse = now();
      packet('playback', { ...value, duration, stamp, run: c.run });
      status = ''; onPlayback(position()); changed(); return true;
    }
    function receive(message) {
      if (destroyed || !connected || !message || typeof message !== 'object' || Array.isArray(message)) return false;
      // No HTML, image payloads, signalling, or draft operations are accepted here.
      if (JSON.stringify(message).length > 1800 || message.protocol !== 'jk-run-companion' || message.v !== 1 || message.session !== sessionId ||
          !validId(message.epoch) || !Number.isSafeInteger(message.seq) || message.seq < 1 || message.seq > 1e9) return false;
      if (message.kind === 'hello') {
        if (message.target && message.target !== epoch) return false;
        const newPeer = peerEpoch !== message.epoch;
        if (newPeer) { peerEpoch = message.epoch; lastSeq = 0; ready = false; halt('Connected · choose Watch together when ready'); }
        lastSeq = Math.max(lastSeq, message.seq);
        const becameReady = !ready && message.target === epoch;
        if (becameReady) ready = true;
        if (newPeer || becameReady || !message.target) hello();
        if (becameReady) { status = ''; packet('selection', { id: null, scene: context().scene }); changed(); }
        return true;
      }
      if (!['ping','pong','pointer','selection','watch','playback'].includes(message.kind)) return false;
      if (!ready || message.epoch !== peerEpoch || message.target !== epoch || message.seq <= lastSeq) return false;
      lastSeq = message.seq;
      const c = context();
      if (message.kind === 'ping' && validId(message.id)) return packet('pong', { id: message.id });
      if (message.kind === 'pong' && message.id === pendingPing?.id) {
        const rtt = now() - pendingPing.at; pendingPing = null;
        if (rtt >= 0 && rtt <= 5000) latency = rtt / 2;
        return true;
      }
      if (message.kind === 'pointer') {
        if (message.scene !== c.scene || !finite(message.x, 0, 100) || !finite(message.y, 0, 100)) return false;
        pointer = { x: message.x, y: message.y, expires: now() + 1800 }; changed(); return true;
      }
      if (message.kind === 'selection') {
        if (message.scene !== c.scene || (message.id !== null && (!validId(message.id) || !c.points.includes(message.id)))) return false;
        selection = message.id; changed();
        if (following && peerId === coachId && selection) onSelection(selection);
        return true;
      }
      if (message.kind === 'watch') {
        if (typeof message.wants !== 'boolean') return false;
        if (!message.wants) { halt(wanted || watch ? 'Watching independently' : ''); return true; }
        if (message.run !== c.run) { halt('Waiting for the same run to sync. Try Watch together again.', true); return false; }
        // A draft acknowledgement may land between presence ticks. Adopt the
        // matching invitation's current context now, or the next tick would
        // mistake this valid invitation for a watch of the previous route.
        if (lastContext.run !== c.run) {
          if (watch || wanted || peerWanted) halt('Run updated · choose Watch together to watch this version');
          if (lastContext.scene !== c.scene) { pointer = null; selection = null; pointing = false; }
          lastContext = { ...c };
        }
        peerWanted = true; status = ''; changed(); startIfAgreed(); return true;
      }
      if (message.kind === 'playback') {
        if (!wanted || !peerWanted || message.run !== c.run || !finite(message.duration, 1, LIMIT) || Math.abs(message.duration - c.duration) > .01 ||
            !finite(message.seconds, 0, message.duration) || typeof message.playing !== 'boolean' || !message.stamp ||
            message.stamp.by !== peerId || !Number.isSafeInteger(message.stamp.n) || message.stamp.n < 1 || message.stamp.n > 1e9) return false;
        counter = Math.max(counter, message.stamp.n);
        if (watch && compare(message.stamp, watch.stamp) < 0) return false;
        watch = { seconds: Math.min(message.duration, message.seconds + (message.playing ? latency / 1000 : 0)),
          duration: message.duration, playing: message.playing, stamp: message.stamp, run: c.run, at: now() };
        status = ''; onPlayback(position()); changed(); return true;
      }
      return false;
    }
    function tick() {
      if (destroyed) return;
      const c = context();
      if (lastContext.scene !== c.scene) { pointer = null; selection = null; pointing = false; changed(); }
      if (selection && !c.points.includes(selection)) { selection = null; changed(); }
      if (lastContext.run !== c.run && (watch || wanted || peerWanted)) halt('Run updated · choose Watch together to watch this version', true);
      lastContext = { ...c };
      if (pointer && pointer.expires <= now()) { pointer = null; changed(); }
      if (!connected) return;
      if (!ready) { if (now() - lastHello >= 1000) hello(); return; }
      if (now() - lastPing >= 5000) { lastPing = now(); pendingPing = { id: token(), at: now() }; packet('ping', { id: pendingPing.id }); }
      if (watch && watch.stamp.by === userId && now() - lastPulse >= 1000) {
        lastPulse = now(); const p = position(); packet('playback', { seconds:p.seconds, duration:p.duration, playing:p.playing, stamp:p.stamp, run:watch.run });
      }
    }
    return {
      receive, tick, inspect: snapshot,
      connect(value) {
        if (destroyed || connected === Boolean(value)) return;
        connected = Boolean(value); ready = false; pointing = false; pointer = null; selection = null; peerEpoch = ''; lastSeq = 0;
        halt(value ? 'Connecting coaching tools…' : 'Coaching tools reconnecting · playback paused');
        if (connected) { epoch = token(); seq = 0; hello(); }
        changed();
      },
      setPointing(value) { pointing = ready && Boolean(value); changed(); },
      point(x, y) {
        if (!pointing || !finite(x, 0, 100) || !finite(y, 0, 100) || now() - lastPointer < 80) return false;
        lastPointer = now(); return packet('pointer', { x, y, scene: context().scene });
      },
      select(id) { const c = context(); if (id !== null && (!validId(id) || !c.points.includes(id))) return false; return packet('selection', { id, scene:c.scene }); },
      follow(value) { following = userId !== coachId && Boolean(value); changed(); if (following && selection && peerId === coachId) onSelection(selection); },
      requestWatch(value) {
        if (!ready) return false;
        if (!value) { halt('Watching independently', true); return true; }
        if (!context().points.length) return false;
        wanted = true; lastContext = { ...context() }; status = ''; packet('watch', { wants:true, run:context().run }); changed(); startIfAgreed(); return true;
      },
      control,
      destroy() { if (destroyed) return; halt(); destroyed = true; connected = false; ready = false; pointer = null; selection = null; },
    };
  }
  root.JKLiveRunCompanion = Object.freeze({ create });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.JKLiveRunCompanion;
})(typeof window !== 'undefined' ? window : globalThis);
