const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const { monitorEventLoopDelay } = require('perf_hooks');
const { createMatch, tryCast, tick, getSnapshot } = require('./shared/rules');
const { CLASSES, SPELLS } = require('./shared/spells');
const { matchSpell } = require('./shared/matcher');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Everything whose right value depends on the host, or that a test needs to
// shorten so it doesn't sleep for two real minutes, lives in one place.
function envInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

const CONFIG = {
  // How long a room with nobody seated in it survives. A phone that backgrounds
  // its tab, or a laptop switching Wi-Fi to cellular, drops its socket for a few
  // seconds. Deleting the room on that blip is exactly what produced "room not
  // available" for the guest, so the seat is held instead.
  waitingRoomTtl: envInt('MD_WAITING_ROOM_TTL_MS', 120000),
  // Finished rooms linger briefly so both players can still agree a rematch,
  // then are reaped (they used to live forever).
  finishedRoomTtl: envInt('MD_FINISHED_ROOM_TTL_MS', 300000),
  // A mid-match drop forfeits after this long, per player.
  forfeitMs: envInt('MD_FORFEIT_MS', 30000),
  // Solo practice has no rival to wait for, but a refresh should not throw the
  // session away: the dummy room is held this long, then reaped.
  practiceGraceMs: envInt('MD_PRACTICE_GRACE_MS', 60000),
  // How long startMatch keeps retrying to seat a paired opponent before it
  // gives up and tells both sides, instead of hanging silently.
  seatWaitMs: envInt('MD_SEAT_WAIT_MS', 8000),
  // Token buckets, per socket.
  moveRate: envInt('MD_MOVE_RATE', 30),
  castRate: envInt('MD_CAST_RATE', 12),
  createRate: envInt('MD_CREATE_RATE', 2),
  maxRoomsPerIp: envInt('MD_MAX_ROOMS_PER_IP', 20),
  logEnabled: process.env.MD_LOG !== '0'
};

// ─── LOGGING ─────────────────────────────────────────────────────────────────
// Structured, one line per event, greppable on Render: `MD_LOG=0` silences it.
function log(event, fields) {
  if (!CONFIG.logEnabled) return;
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] ${event}${fields ? ' ' + JSON.stringify(fields) : ''}`);
}

// Why rooms die is invisible in production without this: p99 event-loop delay is
// what turns a 50ms tick into a heartbeat timeout.
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();
function eventLoopP99() {
  return Math.round((eventLoop.percentile(99) || 0) / 1e6);
}

const app = express();
const server = http.createServer(app);

// Same-origin by default, so a stray page cannot drive the game; set
// ALLOWED_ORIGINS=https://arcane-duel.onrender.com to pin the deployed origin.
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const io = new Server(server, {
  cors: { origin: allowedOrigins.length ? allowedOrigins : true },
  // The defaults are 25s ping / 20s timeout. A free shared-CPU instance stalls
  // for seconds during GC and snapshot bursts, and a 20s budget was close enough
  // to that to matter. We ping a little more often and allow 30s to answer; the
  // measured p99 is published at /healthz so this stays honest.
  pingInterval: 20000,
  pingTimeout: 30000,
  maxHttpBufferSize: 1e5,
  // A reconnect within 30s restores the socket's rooms automatically. The app
  // does not rely on it (join_room with a token is authoritative) but it makes
  // the common tab-switch case seamless.
  connectionStateRecovery: { maxDisconnectionDuration: 30000, skipMiddlewares: true }
});

function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function setImmutable(res) {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
}

// HTML must never be cached (it is the only thing that names the current build).
// Audio, three.js and the shared modules are content-versioned with ?v=<ASSET_V>,
// so they can be cached for a year instead of re-downloading 1.2 MB per visit.
app.use((req, res, next) => {
  const p = req.path;
  if (p.startsWith('/audio/') || p.startsWith('/shared/') || p.startsWith('/vendor/')) setImmutable(res);
  else setNoStore(res);
  next();
});

// ─── HEALTH ──────────────────────────────────────────────────────────────────
// Point a free uptime pinger (UptimeRobot, cron-job.org, Render's own health
// check) at this every 5-10 minutes to keep a sleeping free instance awake.
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    sockets: io.sockets.sockets.size,
    uptime: Math.round(process.uptime()),
    eventLoopP99ms: eventLoopP99()
  });
});

// ─── Compressed static assets ───
// Three.js is served from this server instead of a CDN so a blocked CDN cannot
// leave players with a blank arena. That only makes sense if the transfer stays
// small: r128 is 603 kB raw and 149 kB gzipped, so the handful of text assets
// are gzipped once at startup and served from memory. No dependencies, and it
// leaves the Socket.IO routes alone by claiming only these exact paths.
// Text assets get a cache version derived from what is on disk, so a deploy
// invalidates them without hashing filenames. Audio samples and three.js are
// immutable under a given version, which is what makes the long TTL safe.
function contentVersion() {
  const h = crypto.createHash('sha1');
  const add = (f) => {
    try { const st = fs.statSync(f); h.update(`${path.basename(f)}:${st.size}:${st.mtimeMs}`); } catch (e) { /* optional */ }
  };
  for (const dir of ['public/audio', 'shared', 'public/vendor']) {
    try { for (const f of fs.readdirSync(path.join(__dirname, dir))) add(path.join(__dirname, dir, f)); }
    catch (e) { /* missing dir is not fatal */ }
  }
  add(path.join(__dirname, 'public/audio.js'));
  return h.digest('hex').slice(0, 8);
}
const ASSET_V = contentVersion();

const gzAssets = new Map();
function gzAsset(urlPath, file, type, rewrite) {
  gzAssets.set(urlPath, { file: path.join(__dirname, file), type, raw: null, gz: null, mtime: 0, rewrite });
}
gzAsset('/', 'public/index.html', 'text/html; charset=utf-8', (html) => html
  .replace('src="/audio.js"', `src="/audio.js?v=${ASSET_V}"`)
  .replace('src="/shared/spells.js"', `src="/shared/spells.js?v=${ASSET_V}"`)
  .replace('src="/shared/matcher.js"', `src="/shared/matcher.js?v=${ASSET_V}"`)
  .replace('<head>', `<head>\n<script>window.__ASSET_V="${ASSET_V}";</script>`));
gzAsset('/audio.js', 'public/audio.js', 'application/javascript; charset=utf-8');
gzAsset('/vendor/three.min.js', 'public/vendor/three.min.js', 'application/javascript; charset=utf-8');

// Recompress only when the file changed, so editing index.html still shows up
// on the next refresh while steady-state requests cost one stat() plus a write.
function loadAsset(asset) {
  let st;
  try { st = fs.statSync(asset.file); } catch (e) { return false; }
  if (asset.raw && st.mtimeMs === asset.mtime) return true;
  try {
    let raw = fs.readFileSync(asset.file);
    if (asset.rewrite) raw = Buffer.from(asset.rewrite(raw.toString('utf8')), 'utf8');
    asset.raw = raw;
    asset.gz = zlib.gzipSync(raw, { level: 6 });
    asset.mtime = st.mtimeMs;
    return true;
  } catch (e) {
    return false;
  }
}
for (const a of gzAssets.values()) if (!loadAsset(a)) console.warn('[static] missing', a.file);

app.get(['/', '/audio.js', '/vendor/three.min.js'], (req, res) => {
  const asset = gzAssets.get(req.path);
  if (!asset || !loadAsset(asset)) return res.status(404).end();
  const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = wantsGzip ? asset.gz : asset.raw;
  res.setHeader('Content-Type', asset.type);
  res.setHeader('Vary', 'Accept-Encoding');
  // The HTML names the current build, so only it must stay fresh.
  if (asset.type.startsWith('text/html')) setNoStore(res); else setImmutable(res);
  if (wantsGzip) res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Length', body.length);
  res.status(200).end(req.method === 'HEAD' ? undefined : body);
});

// Versioned assets (the HTML appends ?v=ASSET_V) can be cached for a year;
// anything else in /public keeps revalidating.
app.use('/audio', express.static(path.join(__dirname, 'public/audio'), { etag: false, maxAge: '365d', immutable: true }));
app.use('/vendor', express.static(path.join(__dirname, 'public/vendor'), { etag: false, maxAge: '365d', immutable: true }));
app.use('/shared', express.static(path.join(__dirname, 'shared'), { etag: false, maxAge: '365d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

const rooms = new Map();

// Players waiting for an opponent without a room code. Time-to-first-match is
// the main thing that kills browser multiplayer, so this removes the whole
// "send this code to a friend" step.
const quickQueue = [];

function dropFromQuickQueue(socketId) {
  for (let i = quickQueue.length - 1; i >= 0; i--) {
    if (quickQueue[i].socketId === socketId) quickQueue.splice(i, 1);
  }
}

// State reconciliation rate. The server tick (50ms) is authoritative either way;
// this only controls how often clients re-sync. At 250ms the wind-up telegraph
// lagged badly, which made timing a parry guesswork rather than reading.
const SNAPSHOT_INTERVAL_MS = 100;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let attempts = 0; attempts < 1000; attempts++) {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (!rooms.has(code)) return code;
  }
  return 'MD' + Math.floor(10 + Math.random() * 89);
}

function getRoomPlayerList(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    class: p.class || 'fire',
    rematchRequested: !!p.rematchRequested,
    isOnline: !p.disconnectedAt,
    isBot: !!p.isBot
  }));
}

function roomUpdatePayload(room) {
  return {
    code: room.code,
    state: room.state,
    players: getRoomPlayerList(room),
    serverTime: Date.now()
  };
}

function broadcastRoomUpdate(room) {
  io.to(room.code).emit('room_update', roomUpdatePayload(room));
}

// ─── RATE LIMITING ───────────────────────────────────────────────────────────
// Token buckets per socket. Movement is legitimately bursty, casting is not:
// 30 moves/s is about what a client at 60Hz sends, so honest clients never see
// this, while a loop that floods the event loop gets cut off instead of starving
// everyone else's tick.
function allowRate(socket, kind, perSecond, burst) {
  const buckets = socket.data.buckets || (socket.data.buckets = {});
  const capacity = burst || perSecond;
  const now = Date.now();
  const b = buckets[kind] || (buckets[kind] = { tokens: capacity, at: now });
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * perSecond);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function roomsForIp(ip) {
  let n = 0;
  for (const room of rooms.values()) if (room.ip === ip && room.state === 'waiting') n++;
  return n;
}

// ─── ROOM LIFECYCLE ──────────────────────────────────────────────────────────
function stopMatchLoops(room) {
  if (room.tickInterval) { clearInterval(room.tickInterval); room.tickInterval = null; }
  if (room.snapshotInterval) { clearInterval(room.snapshotInterval); room.snapshotInterval = null; }
}

function clearForfeit(player) {
  if (player.forfeitTimer) clearTimeout(player.forfeitTimer);
  player.forfeitTimer = null;
  player.forfeitDeadline = null;
}

function clearWaitingCleanup(room) {
  if (room.waitingTimer) clearTimeout(room.waitingTimer);
  room.waitingTimer = null;
}

function clearSeatCheck(room) {
  if (room.seatTimer) clearTimeout(room.seatTimer);
  if (room.seatPoll) clearInterval(room.seatPoll);
  room.seatTimer = null;
  room.seatPoll = null;
  room.seatDeadline = null;
}

function clearIdleCleanup(room) {
  if (room.idleTimer) clearTimeout(room.idleTimer);
  room.idleTimer = null;
}

// Used by practice rooms (and anything else with nobody to notify): after the
// grace window the room and its tick loop are released.
function scheduleIdleCleanup(room, ms, reason) {
  clearIdleCleanup(room);
  room.idleTimer = setTimeout(() => {
    room.idleTimer = null;
    if (rooms.get(room.code) !== room) return;
    cleanupRoom(room.code, reason || 'idle_ttl');
  }, ms);
  if (room.idleTimer.unref) room.idleTimer.unref();
}

function cleanupRoom(code, reason) {
  const room = rooms.get(code);
  if (!room) return;
  stopMatchLoops(room);
  clearSeatCheck(room);
  clearWaitingCleanup(room);
  clearIdleCleanup(room);
  if (room.finishedTimer) clearTimeout(room.finishedTimer);
  if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
  room.finishedTimer = null;
  room.disconnectTimer = null;
  for (const p of room.players) clearForfeit(p);
  rooms.delete(code);
  log('room.deleted', { code, reason: reason || 'unknown', state: room.state, left: rooms.size });
}

// A finished room is kept just long enough for a rematch, then reaped. Before
// this, finished rooms were never deleted at all.
function scheduleFinishedCleanup(room) {
  if (room.finishedTimer) clearTimeout(room.finishedTimer);
  room.finishedTimer = setTimeout(() => {
    room.finishedTimer = null;
    cleanupRoom(room.code, 'finished_ttl');
  }, CONFIG.finishedRoomTtl);
  if (room.finishedTimer.unref) room.finishedTimer.unref();
}

// ─── SEATING ────────────────────────────────────────────────────────────────
// Both sockets must actually be in the room before the tick loop starts, so a
// quick-duel pairing cannot begin while one player is still joining.
function isSeated(room, player) {
  if (player.isBot) return true;
  const s = io.sockets.sockets.get(player.id);
  return !!s && s.rooms.has(room.code);
}

function seatStatus(room) {
  const notSeated = room.players.filter(p => !isSeated(room, p));
  return { ready: notSeated.length === 0, notSeated };
}

function allPlayersSeated(room) {
  return seatStatus(room).ready;
}

// startMatch used to return silently when a seat was not ready. That silence was
// the "creator stuck on the room-code screen" bug: nobody retried, nobody was
// told. Now it retries for a bounded window and then reports a real failure.
function armSeatCheck(room) {
  if (room.seatTimer || room.seatPoll) return;
  room.seatDeadline = Date.now() + CONFIG.seatWaitMs;
  room.seatTimer = setTimeout(() => failSeating(room), CONFIG.seatWaitMs);
  if (room.seatTimer.unref) room.seatTimer.unref();
  room.seatPoll = setInterval(() => {
    if (rooms.get(room.code) !== room || room.state !== 'waiting') { clearSeatCheck(room); return; }
    if (allPlayersSeated(room)) { clearSeatCheck(room); startMatch(room); }
  }, 250);
  if (room.seatPoll.unref) room.seatPoll.unref();
}

function failSeating(room) {
  if (rooms.get(room.code) !== room) return;
  if (room.state !== 'waiting' || allPlayersSeated(room)) { clearSeatCheck(room); return; }
  clearSeatCheck(room);
  const missing = seatStatus(room).notSeated.map(p => p.name);
  log('match.start.failed', { code: room.code, reason: 'seat_timeout', missing, quick: !!room.quick });

  io.to(room.code).emit('match_failed', {
    code: room.code,
    reason: 'seat_timeout',
    missing,
    serverTime: Date.now()
  });

  // A Quick Duel partner who never seated is our problem, not the waiting
  // player's: put whoever is still here back in the queue instead of dead-ending
  // them on a room that can never start.
  if (room.quick) {
    for (const p of room.players) {
      const s = io.sockets.sockets.get(p.id);
      if (!s) continue;
      s.emit('quick_match_failed', { code: room.code, reason: 'partner_seat_timeout', serverTime: Date.now() });
      if (!quickQueue.some(q => q.socketId === p.id)) {
        quickQueue.push({ socketId: p.id, name: p.name, class: p.class, at: Date.now() });
      }
    }
  }

  cleanupRoom(room.code, 'seat_timeout');
}

function startMatch(room) {
  if (room.players.length !== 2) {
    log('match.start.blocked', { code: room.code, reason: 'seat_count', players: room.players.length });
    return false;
  }
  const seats = seatStatus(room);
  if (!seats.ready) {
    log('match.start.waiting_for_seats', {
      code: room.code,
      waitingFor: seats.notSeated.map(p => ({ name: p.name, offline: !!p.disconnectedAt }))
    });
    armSeatCheck(room);
    return false;
  }

  clearSeatCheck(room);
  clearWaitingCleanup(room);
  for (const p of room.players) clearForfeit(p);

  room.state = 'in_progress';
  const now = Date.now();
  const p1 = room.players[0];
  const p2 = room.players[1];

  p1.rematchRequested = false;
  p2.rematchRequested = false;

  if (room.disconnectTimer) {
    clearTimeout(room.disconnectTimer);
    room.disconnectTimer = null;
    room.disconnectDeadline = null;
  }

  const c1 = p1.class && CLASSES[p1.class] ? p1.class : 'fire';
  const c2 = p2.class && CLASSES[p2.class] ? p2.class : 'frost';

  room.matchState = createMatch(p1.id, p2.id, now, c1, c2);

  io.to(room.code).emit('match_start', {
    startsAt: now,
    p1: { id: p1.id, name: p1.name, class: c1 },
    p2: { id: p2.id, name: p2.name, class: c2 },
    serverTime: now
  });

  log('match.start', { code: room.code, p1: p1.name, p2: p2.name, c1, c2, quick: !!room.quick, practice: !!room.isPractice });

  stopMatchLoops(room);

  room.tickInterval = setInterval(() => {
    if (!room.matchState || room.state !== 'in_progress') return;
    const tickNow = Date.now();

    // Solo Practice Mode: Rapid mana regen & infinite dummy HP
    if (room.isPractice && room.matchState) {
      const dummyId = 'dummy_' + p1.id;
      const dummy = room.matchState.players[dummyId];
      if (dummy && dummy.hp <= 20) {
        dummy.hp = 100;
      }
      const human = room.matchState.players[p1.id];
      if (human && human.mana < 10) {
        human.mana = Math.min(10, human.mana + 0.2); // generous mana regen in practice
      }
    }

    const events = tick(room.matchState, tickNow);

    for (const ev of events) {
      ev.serverTime = tickNow;
      if (ev.type === 'match_end') {
        if (room.isPractice) {
          const dummyId = 'dummy_' + p1.id;
          if (room.matchState.players[dummyId]) room.matchState.players[dummyId].hp = 100;
          room.matchState.winner = null;
          continue;
        }
        room.state = 'finished';
        stopMatchLoops(room);
        for (const p of room.players) clearForfeit(p);
        io.to(room.code).emit('match_end', ev);
        log('match.end', { code: room.code, winner: ev.winner, reason: ev.reason });
        scheduleFinishedCleanup(room);
      } else {
        io.to(room.code).emit(ev.type, ev);
      }
    }
  }, 50);

  room.snapshotInterval = setInterval(() => {
    if (!room.matchState || room.state !== 'in_progress') return;
    const snapNow = Date.now();
    const snapshot = getSnapshot(room.matchState, snapNow);
    io.to(room.code).emit('state_snapshot', {
      snapshot,
      serverTime: snapNow
    });
  }, SNAPSHOT_INTERVAL_MS);

  broadcastRoomUpdate(room);
  return true;
}

// Ends a match from outside the rules engine (forfeit, leave, abandonment).
function endMatch(room, { winner, reason, detail }) {
  stopMatchLoops(room);
  room.state = 'finished';
  for (const p of room.players) clearForfeit(p);

  const listeners = room.players.filter(p => !p.disconnectedAt && io.sockets.sockets.get(p.id));
  log('match.end', { code: room.code, winner, reason, listeners: listeners.length });

  if (!listeners.length) {
    // Nobody can be told, and nothing can be won: holding the room open would
    // just leak it (the old code left it in the Map forever).
    cleanupRoom(room.code, reason || 'abandoned');
    return;
  }

  io.to(room.code).emit('match_end', { winner, reason, detail, serverTime: Date.now() });
  broadcastRoomUpdate(room);
  scheduleFinishedCleanup(room);
}

// Per-player forfeit. The old single room.disconnectTimer meant one player's
// reconnect cancelled the other player's forfeit, so an absent player never
// lost and the match hung forever.
function scheduleForfeit(room, player) {
  clearForfeit(player);
  player.forfeitDeadline = Date.now() + CONFIG.forfeitMs;
  player.forfeitTimer = setTimeout(() => {
    player.forfeitTimer = null;
    const live = rooms.get(room.code);
    if (live !== room || room.state !== 'in_progress') return;
    if (!player.disconnectedAt) return; // they came back in time
    const rival = room.players.find(p => p !== player && !p.isBot);
    endMatch(room, {
      winner: rival ? rival.id : null,
      reason: 'timeout_forfeit',
      detail: { absent: player.name }
    });
  }, CONFIG.forfeitMs);
  if (player.forfeitTimer.unref) player.forfeitTimer.unref();
}

// A waiting room whose creator dropped is held open so the drop survives the
// reconnect. Only when the grace period runs out is it reaped -- and whoever is
// still sitting there is told, rather than left on a screen that can never move.
function scheduleWaitingCleanup(room) {
  if (room.waitingTimer) return;
  room.waitingTimer = setTimeout(() => {
    room.waitingTimer = null;
    const live = rooms.get(room.code);
    if (live !== room || room.state !== 'waiting') return;
    if (!room.players.some(p => p.disconnectedAt)) return; // nobody is actually gone
    log('room.grace_expired', { code: room.code });
    io.to(room.code).emit('match_failed', {
      code: room.code,
      reason: 'rival_left',
      serverTime: Date.now()
    });
    cleanupRoom(room.code, 'waiting_ttl');
  }, CONFIG.waitingRoomTtl);
  if (room.waitingTimer.unref) room.waitingTimer.unref();
}

io.on('connection', (socket) => {
  let currentRoomCode = null;
  socket.data.buckets = {};

  log('socket.connect', { id: socket.id, transport: socket.conn.transport.name });

  socket.on('ping_server', (clientTime, callback) => {
    if (typeof callback === 'function') {
      callback({ serverTime: Date.now(), clientTime });
    }
  });

  // Create room with chosen mage class
  socket.on('create_room', (data, callback) => {
    const done = typeof callback === 'function' ? callback : () => {};
    if (!allowRate(socket, 'create', CONFIG.createRate, 4)) {
      log('rate.limited', { event: 'create_room', id: socket.id });
      return done({ ok: false, error: 'rate_limited' });
    }
    if (currentRoomCode && rooms.has(currentRoomCode)) return done({ ok: false, error: 'already_in_room' });
    if (roomsForIp(socket.handshake.address) >= CONFIG.maxRoomsPerIp) {
      log('room.cap', { ip: socket.handshake.address });
      return done({ ok: false, error: 'too_many_rooms' });
    }

    dropFromQuickQueue(socket.id);
    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage 1';
    const mageClass = (data && data.class && CLASSES[data.class]) ? data.class : 'fire';
    const code = generateRoomCode();
    const token = crypto.randomUUID();

    const room = {
      code,
      state: 'waiting',
      quick: false,
      isPractice: false,
      ip: socket.handshake.address,
      createdAt: Date.now(),
      players: [{ id: socket.id, token, name, class: mageClass, rematchRequested: false, disconnectedAt: null }],
      matchState: null,
      tickInterval: null,
      snapshotInterval: null,
      disconnectTimer: null,
      disconnectDeadline: null,
      seatTimer: null,
      seatPoll: null,
      waitingTimer: null,
      finishedTimer: null
    };

    rooms.set(code, room);
    socket.join(code);
    currentRoomCode = code;
    log('room.created', { code, name, class: mageClass, rooms: rooms.size });

    if (typeof callback === 'function') {
      callback({ ok: true, code, token });
    }
    broadcastRoomUpdate(room);
  });

  // Join or Reconnect to room with chosen class
  socket.on('join_room', (data, callback) => {
    const done = typeof callback === 'function' ? callback : () => {};
    dropFromQuickQueue(socket.id);
    const code = (data && data.code ? String(data.code).trim().toUpperCase() : '');
    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage 2';
    const mageClass = (data && data.class && CLASSES[data.class]) ? data.class : 'frost';
    const existingToken = data && data.token ? String(data.token) : null;

    const room = rooms.get(code);
    if (!room) {
      log('room.join.not_found', { code, token: !!existingToken });
      return done({ ok: false, error: 'Room not found' });
    }

    let player = existingToken ? room.players.find(p => p.token === existingToken) : null;

    if (player) {
      // ── Resume path ── The seat is claimed by token, not by socket id, so a
      // reconnect that produced a new id restores the same player.
      const oldId = player.id;
      player.id = socket.id;
      player.disconnectedAt = null;
      clearForfeit(player);
      clearWaitingCleanup(room);
      clearIdleCleanup(room);

      if (room.matchState && room.matchState.players[oldId]) {
        room.matchState.players[socket.id] = room.matchState.players[oldId];
        delete room.matchState.players[oldId];
        room.matchState.playerIds = room.matchState.playerIds.map(id => id === oldId ? socket.id : id);
      }

      socket.join(code);
      currentRoomCode = code;
      log('room.join.resume', { code, name: player.name, state: room.state, oldId, newId: socket.id });

      done({ ok: true, code, token: player.token, reconnected: true, state: room.state });

      io.to(code).emit('opponent_reconnected', {
        player: socket.id,
        name: player.name,
        serverTime: Date.now()
      });

      // The whole screen is rebuilt from these, so a resumed duel does not sit
      // blank until the next snapshot.
      if (room.state === 'in_progress' && room.matchState) {
        const p1 = room.players[0];
        const p2 = room.players[1];
        socket.emit('match_start', {
          startsAt: room.matchState.startedAt,
          p1: { id: p1.id, name: p1.name, class: p1.class },
          p2: { id: p2.id, name: p2.name, class: p2.class },
          serverTime: Date.now()
        });
        socket.emit('state_snapshot', {
          snapshot: getSnapshot(room.matchState, Date.now()),
          serverTime: Date.now()
        });
      } else if (room.state === 'waiting' && room.players.length >= 2) {
        startMatch(room);
      }

      broadcastRoomUpdate(room);
      return;
    }

    if (room.state !== 'waiting') {
      log('room.join.state_rejected', { code, state: room.state });
      return done({ ok: false, error: 'That duel has already started.' });
    }

    if (room.players.length >= 2) {
      return done({ ok: false, error: 'That room is full.' });
    }

    const token = crypto.randomUUID();
    player = { id: socket.id, token, name, class: mageClass, rematchRequested: false, disconnectedAt: null };
    room.players.push(player);

    socket.join(code);
    currentRoomCode = code;
    log('room.join', { code, name, class: mageClass, players: room.players.length });

    if (typeof callback === 'function') {
      callback({ ok: true, code, token, state: room.state });
    }

    broadcastRoomUpdate(room);

    if (room.players.length === 2) {
      // startMatch retries and reports failure on its own if the host's socket
      // is mid-reconnect, so this is never a silent no-op.
      startMatch(room);
    }
  });

  // Quick Duel: pair with any other waiting player, no room code required.
  socket.on('quick_duel', (data, callback) => {
    const done = typeof callback === 'function' ? callback : () => {};
    if (!allowRate(socket, 'quick', 2, 4)) return done({ ok: false, error: 'rate_limited' });
    if (currentRoomCode && rooms.has(currentRoomCode)) return done({ ok: false, error: 'already_in_room' });

    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage';
    const mageClass = (data && data.class && CLASSES[data.class]) ? data.class : 'fire';

    dropFromQuickQueue(socket.id);

    // Take the oldest partner who is still connected and still waiting.
    let partner = null;
    while (quickQueue.length) {
      const cand = quickQueue.shift();
      if (cand.socketId === socket.id) continue;
      if (!io.sockets.sockets.get(cand.socketId)) continue;
      partner = cand;
      break;
    }

    if (!partner) {
      quickQueue.push({ socketId: socket.id, name, class: mageClass, at: Date.now() });
      return done({ ok: true, waiting: true, position: quickQueue.length });
    }

    const code = generateRoomCode();
    const tokenA = crypto.randomUUID();
    const tokenB = crypto.randomUUID();

    const room = {
      code,
      state: 'waiting',
      quick: true,
      isPractice: false,
      ip: socket.handshake.address,
      createdAt: Date.now(),
      players: [
        { id: partner.socketId, token: tokenA, name: partner.name, class: partner.class, rematchRequested: false, disconnectedAt: null },
        { id: socket.id, token: tokenB, name, class: mageClass, rematchRequested: false, disconnectedAt: null }
      ],
      matchState: null,
      tickInterval: null,
      snapshotInterval: null,
      disconnectTimer: null,
      disconnectDeadline: null,
      seatTimer: null,
      seatPoll: null,
      waitingTimer: null,
      finishedTimer: null
    };
    rooms.set(code, room);
    log('quick.paired', { code, a: partner.name, b: name });

    // If a paired client never actually seats (it dropped while the pairing was
    // in flight), this arms the retry that ends in quick_match_failed + requeue
    // instead of leaving the other player on a room that can never start.
    armSeatCheck(room);

    // Each side joins with its own token, exactly like a code-based room.
    const payloadA = { code, token: tokenA, opponent: { name, class: mageClass }, serverTime: Date.now() };
    const payloadB = { code, token: tokenB, opponent: { name: partner.name, class: partner.class }, serverTime: Date.now() };
    io.to(partner.socketId).emit('quick_match_found', payloadA);
    socket.emit('quick_match_found', payloadB);
    done({ ok: true, matched: true, code });
  });

  socket.on('cancel_quick_duel', () => {
    dropFromQuickQueue(socket.id);
    socket.emit('quick_duel_cancelled', { serverTime: Date.now() });
  });

  // Solo Practice Arena (Instantly duel a training dummy with rapid mana regen)
  socket.on('practice_mode', (data, callback) => {
    const done = typeof callback === 'function' ? callback : () => {};
    if (!allowRate(socket, 'practice', 2, 4)) return done({ ok: false, error: 'rate_limited' });
    if (currentRoomCode && rooms.has(currentRoomCode)) return done({ ok: false, error: 'already_in_room' });

    dropFromQuickQueue(socket.id);
    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage';
    const mageClass = (data && data.class && CLASSES[data.class]) ? data.class : 'fire';
    // The random suffix keeps two attempts from the same tab (or a reconnect)
    // from colliding on one code and orphaning the first room. Everything is
    // upper-cased because join_room normalises codes to upper case, and a
    // mixed-case practice code could never be resumed.
    const code = 'PRACTICE_' + socket.id.slice(0, 5).toUpperCase() + Math.floor(Math.random() * 90 + 10);
    const token = crypto.randomUUID();

    const dummyClass = mageClass === 'frost' ? 'fire' : 'frost';
    const dummyId = 'dummy_' + socket.id;

    const p1 = { id: socket.id, token, name, class: mageClass, rematchRequested: false, disconnectedAt: null };
    const p2 = { id: dummyId, token: 'dummy_token', name: 'Training Dummy', class: dummyClass, rematchRequested: false, disconnectedAt: null, isBot: true };

    const room = {
      code,
      state: 'waiting',
      quick: false,
      isPractice: true,
      ip: socket.handshake.address,
      createdAt: Date.now(),
      players: [p1, p2],
      matchState: null,
      tickInterval: null,
      snapshotInterval: null,
      disconnectTimer: null,
      disconnectDeadline: null,
      seatTimer: null,
      seatPoll: null,
      waitingTimer: null,
      finishedTimer: null
    };

    rooms.set(code, room);
    socket.join(code);
    currentRoomCode = code;
    log('practice.created', { code, name, class: mageClass });

    if (typeof callback === 'function') {
      callback({ ok: true, code, token, isPractice: true });
    }

    startMatch(room);
  });

  // Switch class in waiting lobby
  socket.on('select_class', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'waiting') return;
    const player = room.players.find(p => p.id === socket.id);
    if (player && data && data.class && CLASSES[data.class]) {
      player.class = data.class;
      broadcastRoomUpdate(room);
    }
  });

  // Cast spell
  socket.on('cast', (data) => {
    if (!allowRate(socket, 'cast', CONFIG.castRate, 16)) {
      socket.emit('rejected', {
        player: socket.id,
        spell: (data && (data.spell || data.text || data.chant)) || 'unknown',
        reason: 'rate_limited',
        serverTime: Date.now()
      });
      return;
    }
    if (!currentRoomCode) {
      socket.emit('rejected', {
        player: socket.id,
        spell: (data && (data.spell || data.text || data.chant)) || 'unknown',
        reason: 'not_in_room',
        serverTime: Date.now()
      });
      return;
    }
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'in_progress' || !room.matchState) {
      socket.emit('rejected', {
        player: socket.id,
        spell: (data && (data.spell || data.text || data.chant)) || 'unknown',
        reason: 'match_not_in_progress',
        serverTime: Date.now()
      });
      return;
    }

    const player = room.matchState.players[socket.id];
    if (!player) {
      socket.emit('rejected', {
        player: socket.id,
        spell: (data && (data.spell || data.text || data.chant)) || 'unknown',
        reason: 'player_not_found',
        serverTime: Date.now()
      });
      return;
    }

    let spellId = data && data.spell ? String(data.spell).toLowerCase() : '';
    if (!SPELLS[spellId] && data && (data.text || data.chant)) {
      const detected = matchSpell(data.text || data.chant, player.spells);
      if (detected) spellId = detected;
    }

    if (!SPELLS[spellId]) {
      socket.emit('rejected', {
        player: socket.id,
        spell: spellId || (data && (data.text || data.chant)) || 'unknown',
        reason: 'unknown_spell',
        serverTime: Date.now()
      });
      return;
    }

    const now = Date.now();
    const source = (data && data.source) || 'tap';

    const events = tryCast(room.matchState, socket.id, spellId, now);
    for (const ev of events) {
      ev.serverTime = now;
      ev.source = source;
      if (ev.type === 'rejected') {
        socket.emit('rejected', ev);
      } else {
        io.to(room.code).emit(ev.type, ev);
      }
    }
  });

  // Move player in 3D arena
  socket.on('player_move', (data) => {
    // A client at 60Hz sends ~60/s, and the arena only needs 30/s to look smooth
    // for the rival. Dropping the excess is what keeps a flood of moves from
    // starving the 50ms tick on a shared-CPU host.
    if (!allowRate(socket, 'move', CONFIG.moveRate, CONFIG.moveRate)) return;
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'in_progress' || !data) return;
    // Broadcast movement directly to opponent (expanded arena bounds)
    socket.to(room.code).emit('opponent_moved', {
      id: socket.id,
      x: typeof data.x === 'number' ? Math.max(-18, Math.min(18, data.x)) : 0,
      z: typeof data.z === 'number' ? Math.max(-11, Math.min(11, data.z)) : 0,
      rotY: typeof data.rotY === 'number' ? data.rotY : 0
    });
  });

  // Rematch
  socket.on('rematch', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'finished') return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.rematchRequested = true;
    }

    broadcastRoomUpdate(room);

    if (room.players.length === 2 && room.players.every(p => p.rematchRequested)) {
      log('match.rematch', { code: room.code });
      startMatch(room);
    }
  });

  // Leave room
  socket.on('leave_room', () => {
    const code = currentRoomCode;
    currentRoomCode = null;
    if (!code) return;
    const room = rooms.get(code);
    socket.leave(code);
    if (!room) return;

    // Practice rooms have no rival to notify, so they are simply dropped. They
    // used to survive every exit and every disconnect (the dummy kept the room
    // non-empty), which leaked one room per practice session for the life of the
    // process.
    if (room.isPractice) {
      cleanupRoom(code, 'practice_leave');
      return;
    }

    room.players = room.players.filter(p => p.id !== socket.id);
    log('room.leave', { code, name: room.players.length ? 'guest' : 'host', remaining: room.players.length });

    if (!room.players.length) {
      cleanupRoom(code, 'empty_after_leave');
      return;
    }

    if (room.state === 'in_progress') {
      // The winner is the player who is still here -- not players[0], which was
      // the person who just quit whenever they happened to be first in the list.
      endMatch(room, { winner: room.players[0].id, reason: 'opponent_left' });
      return;
    }

    broadcastRoomUpdate(room);
  });

  socket.on('disconnect', (reason) => {
    dropFromQuickQueue(socket.id);
    log('socket.disconnect', { id: socket.id, reason, room: currentRoomCode || null });
    if (!currentRoomCode) return;

    const code = currentRoomCode;
    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    // No player means a reconnect already remapped this seat to a newer socket;
    // treating the old socket's disconnect as a drop would mark the fresh one
    // offline and start a spurious forfeit.
    if (!player) return;

    player.disconnectedAt = Date.now();

    if (room.isPractice) {
      // Held briefly so a refresh can reclaim the dummy fight; the tick loop
      // keeps running for one mage and is released when the timer fires.
      log('practice.player_offline', { code, graceMs: CONFIG.practiceGraceMs });
      scheduleIdleCleanup(room, CONFIG.practiceGraceMs, 'practice_grace_expired');
      return;
    }

    if (room.state === 'in_progress') {
      scheduleForfeit(room, player);
      io.to(code).emit('opponent_disconnected', {
        player: player.id,
        name: player.name,
        deadline: player.forfeitDeadline,
        serverTime: Date.now()
      });
      log('match.player_offline', { code, name: player.name, reason, forfeitInMs: CONFIG.forfeitMs });
      broadcastRoomUpdate(room);
      return;
    }

    if (room.state === 'waiting') {
      // The seat is HELD, not removed: this is the fix for both "room not
      // available" (the room vanished on a blip) and "creator stuck on the room
      // code screen" (the room needed to still be there when they came back).
      scheduleWaitingCleanup(room);
      log('room.player_offline', { code, name: player.name, ttlMs: CONFIG.waitingRoomTtl });
      broadcastRoomUpdate(room);
      return;
    }

    // Finished: keep the room for a rematch, unless everybody has gone.
    if (room.players.every(p => p.disconnectedAt)) cleanupRoom(code, 'all_offline');
  });
});

// A slow tick is the upstream cause of heartbeat timeouts, so it is reported
// when it actually happens instead of being inferred from player complaints.
setInterval(() => {
  const p99 = eventLoopP99();
  if (p99 > 50) log('perf.event_loop_lag', { p99ms: p99, rooms: rooms.size, sockets: io.sockets.sockets.size });
}, 30000).unref();

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => {
    log('server.listen', {
      port: PORT,
      assetVersion: ASSET_V,
      origins: allowedOrigins.length ? allowedOrigins : 'same-origin',
      waitingRoomTtl: CONFIG.waitingRoomTtl,
      forfeitMs: CONFIG.forfeitMs
    });
  });
}

// Exported so the lobby can be driven in-process by the tests in test/.
module.exports = { app, server, io, rooms, quickQueue, CONFIG, startMatch, seatStatus };
