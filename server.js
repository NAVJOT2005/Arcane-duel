const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const { createMatch, tryCast, tick, getSnapshot } = require('./shared/rules');
const { CLASSES, SPELLS } = require('./shared/spells');
const { matchSpell } = require('./shared/matcher');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Disable caching so both players/browser windows always get the newest version
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ─── Compressed static assets ───
// Three.js is served from this server instead of a CDN so a blocked CDN cannot
// leave players with a blank arena. That only makes sense if the transfer stays
// small: r128 is 603 kB raw and 149 kB gzipped, so the handful of text assets
// are gzipped once at startup and served from memory. No dependencies, and it
// leaves the Socket.IO routes alone by claiming only these exact paths.
const gzAssets = new Map();
function gzAsset(urlPath, file, type) {
  gzAssets.set(urlPath, { file: path.join(__dirname, file), type, raw: null, gz: null, mtime: 0 });
}
gzAsset('/', 'public/index.html', 'text/html; charset=utf-8');
gzAsset('/audio.js', 'public/audio.js', 'application/javascript; charset=utf-8');
gzAsset('/vendor/three.min.js', 'public/vendor/three.min.js', 'application/javascript; charset=utf-8');

// Recompress only when the file changed, so editing index.html still shows up
// on the next refresh while steady-state requests cost one stat() plus a write.
function loadAsset(asset) {
  let st;
  try { st = fs.statSync(asset.file); } catch (e) { return false; }
  if (asset.raw && st.mtimeMs === asset.mtime) return true;
  try {
    asset.raw = fs.readFileSync(asset.file);
    asset.gz = zlib.gzipSync(asset.raw, { level: 6 });
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
  if (wantsGzip) res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Length', body.length);
  res.status(200).end(req.method === 'HEAD' ? undefined : body);
});

// Serve static assets from /public and /shared
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));
app.use('/shared', express.static(path.join(__dirname, 'shared'), { etag: false, maxAge: 0 }));

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
    isOnline: !p.disconnectedAt
  }));
}

function broadcastRoomUpdate(room) {
  io.to(room.code).emit('room_update', {
    code: room.code,
    state: room.state,
    players: getRoomPlayerList(room),
    serverTime: Date.now()
  });
}

// Both sockets must actually be in the room before the tick loop starts, so a
// quick-duel pairing cannot begin while one player is still joining.
function allPlayersSeated(room) {
  return room.players.every(p => {
    if (p.isBot) return true;
    const s = io.sockets.sockets.get(p.id);
    return !!s && s.rooms.has(room.code);
  });
}

function startMatch(room) {
  if (room.players.length !== 2) return;
  if (!allPlayersSeated(room)) return;
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

  if (room.tickInterval) clearInterval(room.tickInterval);
  if (room.snapshotInterval) clearInterval(room.snapshotInterval);

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
        clearInterval(room.tickInterval);
        room.tickInterval = null;
        io.to(room.code).emit('match_end', ev);
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
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.tickInterval) clearInterval(room.tickInterval);
  if (room.snapshotInterval) clearInterval(room.snapshotInterval);
  if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
  rooms.delete(code);
}

io.on('connection', (socket) => {
  let currentRoomCode = null;

  socket.on('ping_server', (clientTime, callback) => {
    if (typeof callback === 'function') {
      callback({ serverTime: Date.now(), clientTime });
    }
  });

  // Create room with chosen mage class
  socket.on('create_room', (data, callback) => {
    dropFromQuickQueue(socket.id);
    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage 1';
    const mageClass = (data && data.class && CLASSES[data.class]) ? data.class : 'fire';
    const code = generateRoomCode();
    const token = crypto.randomUUID();

    const room = {
      code,
      state: 'waiting',
      players: [{ id: socket.id, token, name, class: mageClass, rematchRequested: false, disconnectedAt: null }],
      matchState: null,
      tickInterval: null,
      snapshotInterval: null,
      disconnectTimer: null,
      disconnectDeadline: null
    };

    rooms.set(code, room);
    socket.join(code);
    currentRoomCode = code;

    if (typeof callback === 'function') {
      callback({ ok: true, code, token });
    }
    broadcastRoomUpdate(room);
  });

  // Join or Reconnect to room with chosen class
  socket.on('join_room', (data, callback) => {
    dropFromQuickQueue(socket.id);
    const code = (data && data.code ? String(data.code).trim().toUpperCase() : '');
    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage 2';
    const mageClass = (data && data.class && CLASSES[data.class]) ? data.class : 'frost';
    const existingToken = data && data.token ? String(data.token) : null;

    const room = rooms.get(code);
    if (!room) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Room not found' });
      return;
    }

    let player = existingToken ? room.players.find(p => p.token === existingToken) : null;

    if (player) {
      const oldId = player.id;
      player.id = socket.id;
      player.disconnectedAt = null;

      if (room.matchState && room.matchState.players[oldId]) {
        room.matchState.players[socket.id] = room.matchState.players[oldId];
        delete room.matchState.players[oldId];
        room.matchState.playerIds = room.matchState.playerIds.map(id => id === oldId ? socket.id : id);
      }

      if (room.disconnectTimer) {
        clearTimeout(room.disconnectTimer);
        room.disconnectTimer = null;
        room.disconnectDeadline = null;
        io.to(code).emit('opponent_reconnected', {
          player: socket.id,
          name: player.name,
          serverTime: Date.now()
        });
      }

      socket.join(code);
      currentRoomCode = code;

      if (typeof callback === 'function') {
        callback({ ok: true, code, token: player.token, reconnected: true });
      }

      // Quick-duel rooms are created with both seats already reserved, so the
      // normal "second player arrived" trigger never fires for them.
      const alreadyRunning = room.state === 'in_progress' && !!room.matchState;
      if (!alreadyRunning && room.state === 'waiting' && room.players.length === 2 && allPlayersSeated(room)) {
        startMatch(room);
      }

      if (alreadyRunning) {
        const p1 = room.players[0];
        const p2 = room.players[1];
        socket.emit('match_start', {
          startsAt: room.matchState.startedAt,
          p1: { id: p1.id, name: p1.name, class: p1.class },
          p2: { id: p2.id, name: p2.name, class: p2.class },
          serverTime: Date.now()
        });
      }

      broadcastRoomUpdate(room);
      return;
    }

    if (room.players.length >= 2) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Room is full' });
      return;
    }

    const token = crypto.randomUUID();
    player = { id: socket.id, token, name, class: mageClass, rematchRequested: false, disconnectedAt: null };
    room.players.push(player);

    socket.join(code);
    currentRoomCode = code;

    if (typeof callback === 'function') {
      callback({ ok: true, code, token });
    }

    broadcastRoomUpdate(room);

    if (room.players.length === 2 && room.state === 'waiting') {
      startMatch(room);
    }
  });

  // Quick Duel: pair with any other waiting player, no room code required.
  socket.on('quick_duel', (data, callback) => {
    const done = typeof callback === 'function' ? callback : () => {};
    if (currentRoomCode) return done({ ok: false, error: 'already_in_room' });

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
      players: [
        { id: partner.socketId, token: tokenA, name: partner.name, class: partner.class, rematchRequested: false, disconnectedAt: null },
        { id: socket.id, token: tokenB, name, class: mageClass, rematchRequested: false, disconnectedAt: null }
      ],
      matchState: null,
      tickInterval: null,
      snapshotInterval: null,
      disconnectTimer: null,
      disconnectDeadline: null
    };
    rooms.set(code, room);

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
    dropFromQuickQueue(socket.id);
    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage';
    const mageClass = (data && data.class && CLASSES[data.class]) ? data.class : 'fire';
    const code = 'PRACTICE_' + socket.id.slice(0, 5);
    const token = crypto.randomUUID();

    const dummyClass = mageClass === 'frost' ? 'fire' : 'frost';
    const dummyId = 'dummy_' + socket.id;

    const p1 = { id: socket.id, token, name, class: mageClass, rematchRequested: false, disconnectedAt: null };
    const p2 = { id: dummyId, token: 'dummy_token', name: 'Training Dummy', class: dummyClass, rematchRequested: false, disconnectedAt: null, isBot: true };

    const room = {
      code,
      state: 'waiting',
      players: [p1, p2],
      matchState: null,
      tickInterval: null,
      snapshotInterval: null,
      isPractice: true
    };

    rooms.set(code, room);
    socket.join(code);
    currentRoomCode = code;

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
      startMatch(room);
    }
  });

  // Leave room
  socket.on('leave_room', () => {
    if (!currentRoomCode) return;
    const code = currentRoomCode;
    const room = rooms.get(code);
    currentRoomCode = null;
    socket.leave(code);

    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      cleanupRoom(code);
    } else {
      if (room.state === 'in_progress') {
        room.state = 'finished';
        if (room.tickInterval) clearInterval(room.tickInterval);
        if (room.snapshotInterval) clearInterval(room.snapshotInterval);
        io.to(code).emit('match_end', {
          winner: room.players[0].id,
          reason: 'opponent_left',
          serverTime: Date.now()
        });
      }
      broadcastRoomUpdate(room);
    }
  });

  socket.on('disconnect', () => {
    dropFromQuickQueue(socket.id);
    if (!currentRoomCode) return;
    const code = currentRoomCode;
    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.disconnectedAt = Date.now();

    if (room.state === 'in_progress') {
      const deadline = Date.now() + 30000;
      room.disconnectDeadline = deadline;

      io.to(code).emit('opponent_disconnected', {
        player: socket.id,
        name: player.name,
        deadline,
        serverTime: Date.now()
      });

      if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
      room.disconnectTimer = setTimeout(() => {
        const r = rooms.get(code);
        if (!r || r.state !== 'in_progress') return;

        const remainingPlayer = r.players.find(p => !p.disconnectedAt);
        r.state = 'finished';
        if (r.tickInterval) clearInterval(r.tickInterval);
        if (r.snapshotInterval) clearInterval(r.snapshotInterval);

        if (remainingPlayer) {
          io.to(code).emit('match_end', {
            winner: remainingPlayer.id,
            reason: 'timeout_forfeit',
            serverTime: Date.now()
          });
        }
        broadcastRoomUpdate(r);
      }, 30000);
    } else {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        cleanupRoom(code);
      } else {
        broadcastRoomUpdate(room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mage Duel 3D server running on port ${PORT}`);
});
