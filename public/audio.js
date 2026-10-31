// ─── AUDIO: SAMPLE BANK ─────────────────────────────────────────────────────
// Sample playback layer for Mage Duel. Records are fetched + decoded once, then
// replayed from memory; every call returns false when a sound is not available
// yet so the caller can fall back to its procedural synth. That fallback is what
// keeps the game audible on a cold cache, a blocked request, or an old browser.
//
// Sources and licences: /audio/CREDITS.md
(() => {
  const DIR = '/audio/';

  // name: [file, gain, loop]
  const BANK = {
    // Wind-ups. Held loops: the engine pitch-ramps them across the cast so the
    // rise ends exactly when the spell resolves, whatever the cast time is.
    charge_fire:    ['charge_fire.wav', 0.55, 1],
    charge_frost:   ['charge_frost.wav', 0.55, 1],
    charge_bolt:    ['charge_bolt.wav', 0.55, 1],
    charge_dark:    ['charge_dark.wav', 0.55, 1],
    charge_earth:   ['charge_earth.ogg', 0.5, 1],
    charge_arcane:  ['charge_arcane.ogg', 0.5, 1],

    // Impacts.
    hit_fire:       ['hit_fire.wav', 0.9],
    hit_frost:      ['hit_frost.wav', 0.8],
    hit_bolt:       ['hit_bolt.wav', 0.8],
    hit_earth:      ['earth_bong.wav', 0.95],
    hit_dark:       ['sub_boom.ogg', 0.9],

    // Projectile leaves the hand.
    launch_fire:    ['launch_fire.wav', 0.42],
    launch_frost:   ['launch_frost.wav', 0.4],
    launch_bolt:    ['launch_bolt.wav', 0.4],
    launch_earth:   ['launch_earth.ogg', 0.55],
    launch_dark:    ['launch_dark.ogg', 0.45],

    // Defence and utility.
    block:          ['block.wav', 0.75],
    field:          ['field.ogg', 0.5],
    clang:          ['clang.wav', 0.6],
    clink:          ['clink.wav', 0.5],
    parry:          ['parry.wav', 1.0],
    heal:           ['heal.wav', 0.7],
    drain:          ['drain.wav', 0.8],
    stun:           ['stun.ogg', 0.85],
    boom:           ['boom.ogg', 0.9],
    sub_boom:       ['sub_boom.ogg', 0.9],
    teleport:       ['teleport.wav', 0.5]
  };

  let ctx = null, dest = null, muted = false;
  let voices = 0;
  const MAX_VOICES = 24;
  const holds = new Set();   // live wind-up loops, so interrupts can cut them all

  // Keyed by file, not by sound name: two sounds can share one file (hit_dark
  // and sub_boom do), and that file should only ever be fetched and decoded once.
  const raw = new Map();    // file -> ArrayBuffer (fetched, not decoded)
  const buf = new Map();    // file -> AudioBuffer
  const bad = new Set();    // files that 404'd or failed to decode
  const fetching = new Set();
  let preloadStarted = false;

  function entry(name) { return BANK[name] || null; }
  function fileOf(name) { const e = BANK[name]; return e ? e[0] : null; }

  // Fetch only. Runs before any gesture, because we must not open an
  // AudioContext until the user has interacted.
  function fetchOne(name) {
    const file = fileOf(name);
    if (!file || buf.has(file) || bad.has(file) || fetching.has(file)) return;
    fetching.add(file);
    fetch(DIR + file)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then(ab => { raw.set(file, ab); })
      .catch(() => { bad.add(file); })
      .finally(() => { fetching.delete(file); });
  }

  function preload() {
    if (preloadStarted) return;
    preloadStarted = true;
    const names = Object.keys(BANK);
    // Four workers: the lobby stays snappy while ~1 MB streams in, and nothing
    // competes with the socket handshake.
    let next = 0;
    const worker = () => {
      if (next >= names.length) return;
      const name = names[next++];
      const file = fileOf(name);
      if (!file || bad.has(file) || buf.has(file)) return worker();
      fetch(DIR + file)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then(ab => { raw.set(file, ab); if (ctx) decodeOne(file); })
        .catch(() => { bad.add(file); })
        .then(() => { if (ctx) decodeOne(file); worker(); });
    };
    for (let k = 0; k < 4; k++) worker();
  }

  function attach(context, destination) {
    if (!context || ctx === context) { if (ctx) decodeAll(); return; }
    ctx = context;
    dest = destination || ctx.destination;
    decodeAll();
  }

  function decodeOne(file) {
    if (!file || !ctx || buf.has(file) || bad.has(file)) return false;
    const ab = raw.get(file);
    if (!ab) return false;
    let p;
    try { p = ctx.decodeAudioData(ab.slice(0)); } catch (e) { bad.add(file); return false; }
    if (p && p.then) {
      p.then(b => { buf.set(file, b); raw.delete(file); })
        .catch(() => { bad.add(file); });
    }
    return true;
  }

  function decodeAll() {
    for (const f of Array.from(raw.keys())) decodeOne(f);
  }

  function ready(name) { const f = fileOf(name); return !!f && buf.has(f); }

  // Round-robin priority: if we are already drowning in voices, drop the quiet
  // cosmetic sounds (launches) before the gameplay-critical ones.
  function canPlay(priority) {
    if (muted || !ctx || !dest) return false;
    if (voices >= MAX_VOICES) return priority >= 2;
    return true;
  }

  function play(name, opts) {
    const o = opts || {};
    const e = entry(name), file = fileOf(name);
    if (!e || !canPlay(o.priority || 1)) return false;
    if (!buf.has(file)) { if (raw.has(file)) decodeOne(file); else fetchOne(name); return false; }

    let src;
    try { src = ctx.createBufferSource(); } catch (err) { return false; }
    src.buffer = buf.get(file);
    if (o.rate) src.playbackRate.value = o.rate;

    const g = ctx.createGain();
    g.gain.value = (o.gain != null ? o.gain : e[1]) * (0.94 + Math.random() * 0.12);

    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      src.connect(p); p.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(dest);

    const now = ctx.currentTime;
    const start = now + (o.delay || 0);
    voices++;
    src.onended = () => { voices = Math.max(0, voices - 1); try { g.disconnect(); } catch (err) {} };
    try { src.start(start); } catch (err) { voices--; return false; }
    if (o.dur) { try { src.stop(start + o.dur); } catch (err) {} }
    return true;
  }

  // Sustained loop for a wind-up. `castSec` is the full cast time, so the pitch
  // ramp lands on the resolution of the spell rather than on the end of the
  // sample. Returns a handle, or null when the sample is not loaded.
  function hold(name, castSec) {
    const e = entry(name), file = fileOf(name);
    if (!e || !canPlay(2) || !buf.has(file)) { if (file && raw.has(file)) decodeOne(file); return null; }
    let src, g;
    try {
      src = ctx.createBufferSource();
      g = ctx.createGain();
    } catch (err) { return null; }

    src.buffer = buf.get(file);
    src.loop = true;
    const t = ctx.currentTime;
    const dur = Math.max(0.25, castSec);
    const end = t + dur;
    // Longer casts start lower and sweep further, so a 3s ultimate sounds
    // heavier than a 1s poke instead of merely longer.
    const r0 = dur > 2.2 ? 0.72 : 0.88;
    const r1 = dur > 2.2 ? 1.5 : 1.34;
    src.playbackRate.setValueAtTime(r0, t);
    src.playbackRate.linearRampToValueAtTime(r1, end);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(e[1] * 0.5, t + Math.min(0.18, dur * 0.2));
    g.gain.linearRampToValueAtTime(e[1], t + dur * 0.75);
    // The loop is bounded by its own cast: it fades out and stops exactly when
    // the spell resolves, so a resolved cast can never leave a droning loop
    // behind even if no one calls stop().
    g.gain.setValueAtTime(e[1], end - Math.min(0.12, dur * 0.3));
    g.gain.linearRampToValueAtTime(0.0001, end);

    src.connect(g); g.connect(dest);
    try { src.start(t); } catch (err) { return null; }
    try { src.stop(end + 0.02); } catch (err) {}
    voices++;
    let stopped = false;
    const handle = {
      stop(fadeSec) {
        if (stopped) return;
        stopped = true;
        const n = ctx.currentTime, f = Math.max(0.02, fadeSec || 0.07);
        try {
          g.gain.cancelScheduledValues(n);
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), n);
          g.gain.exponentialRampToValueAtTime(0.0001, n + f);
          src.stop(n + f + 0.02);
        } catch (err) {}
        holds.delete(handle);
      }
    };
    holds.add(handle);
    // `voices` is owned solely by onended: the node decrements exactly once
    // whether it ended by itself or was cut short, so repeated interrupts can
    // never drift the counter up and starve later sounds.
    src.onended = () => {
      holds.delete(handle);
      stopped = true;
      voices = Math.max(0, voices - 1);
    };
    return handle;
  }

  // Cut every wind-up loop at once (interrupt, stun, rejection, match end).
  function stopHolds(fadeSec) {
    Array.from(holds).forEach(h => { try { h.stop(fadeSec); } catch (e) {} });
    holds.clear();
  }

  function setMuted(next) {
    muted = !!next;
    if (muted && ctx) { /* let in-flight tails finish; nothing new starts */ }
  }

  // Diagnostics: used by the test harness to prove samples (not the synth) played.
  function status() {
    return {
      attached: !!ctx,
      muted,
      files: Object.keys(BANK).length,
      loaded: buf.size,
      fetched: raw.size,
      failed: Array.from(bad),
      missingLoad: Array.from(new Set(Object.keys(BANK).map(fileOf))).filter(f => !buf.has(f) && !bad.has(f)),
      voices
    };
  }

  window.AUDIO = {
    preload, attach, play, hold, ready, setMuted, status, stopHolds,
    names: () => Object.keys(BANK),
    url: name => (BANK[name] ? DIR + BANK[name][0] : null)
  };
})();
