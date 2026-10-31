const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
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

// Serve static assets from /public and /shared
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));
app.use('/shared', express.static(path.join(__dirname, 'shared'), { etag: false, maxAge: 0 }));

const rooms = new Map();

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

function startMatch(room) {
  if (room.players.length !== 2) return;
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
    const events = tick(room.matchState, tickNow);

    for (const ev of events) {
      ev.serverTime = tickNow;
      if (ev.type === 'match_end') {
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
  }, 250);

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

      if (room.state === 'in_progress' && room.matchState) {
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
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'in_progress' || !room.matchState) return;

    const player = room.matchState.players[socket.id];
    if (!player) return;

    let spellId = data && data.spell ? String(data.spell).toLowerCase() : '';
    if (!SPELLS[spellId] && (data.text || data.chant)) {
      const detected = matchSpell(data.text || data.chant, player.spells);
      if (detected) spellId = detected;
    }

    if (!SPELLS[spellId]) {
      socket.emit('rejected', {
        player: socket.id,
        spell: spellId || data.text || 'unknown',
        reason: 'unknown_spell',
        serverTime: Date.now()
      });
      return;
    }

    const now = Date.now();
    const source = data.source || 'tap';

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
