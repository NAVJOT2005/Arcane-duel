const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const { createMatch, tryCast, tick, getSnapshot } = require('./shared/rules');
const { SPELLS } = require('./shared/spells');
const { matchSpell } = require('./shared/matcher');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve static assets from /public and /shared
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// ─── Room State Management ───
// Map<code, Room>
// Room: {
//   code: string,
//   state: 'waiting' | 'in_progress' | 'finished',
//   players: [{ id: socket.id, token: string, name: string, rematchRequested: boolean, disconnectedAt: number|null }],
//   matchState: object | null,
//   tickInterval: Timer | null,
//   snapshotInterval: Timer | null,
//   disconnectTimer: Timer | null,
//   disconnectDeadline: number | null
// }
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

  // Clear disconnect timers if any
  if (room.disconnectTimer) {
    clearTimeout(room.disconnectTimer);
    room.disconnectTimer = null;
    room.disconnectDeadline = null;
  }

  room.matchState = createMatch(p1.id, p2.id, now);

  io.to(room.code).emit('match_start', {
    startsAt: now,
    p1: { id: p1.id, name: p1.name },
    p2: { id: p2.id, name: p2.name },
    serverTime: now
  });

  if (room.tickInterval) clearInterval(room.tickInterval);
  if (room.snapshotInterval) clearInterval(room.snapshotInterval);

  // 50ms authoritative tick
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

  // 250ms snapshot sync
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

// ─── Socket Connection & Handlers ───
io.on('connection', (socket) => {
  let currentRoomCode = null;
  let playerToken = null;

  // Latency & clock sync
  socket.on('ping_server', (clientTime, callback) => {
    if (typeof callback === 'function') {
      callback({ serverTime: Date.now(), clientTime });
    }
  });

  // Create room
  socket.on('create_room', (data, callback) => {
    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage 1';
    const code = generateRoomCode();
    const token = crypto.randomUUID();

    const room = {
      code,
      state: 'waiting',
      players: [{ id: socket.id, token, name, rematchRequested: false, disconnectedAt: null }],
      matchState: null,
      tickInterval: null,
      snapshotInterval: null,
      disconnectTimer: null,
      disconnectDeadline: null
    };

    rooms.set(code, room);
    socket.join(code);
    currentRoomCode = code;
    playerToken = token;

    if (typeof callback === 'function') {
      callback({ ok: true, code, token });
    }
    broadcastRoomUpdate(room);
  });

  // Join or Reconnect to room
  socket.on('join_room', (data, callback) => {
    const code = (data && data.code ? String(data.code).trim().toUpperCase() : '');
    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage 2';
    const existingToken = data && data.token ? String(data.token) : null;

    const room = rooms.get(code);
    if (!room) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Room not found' });
      return;
    }

    // Check if player is reconnecting with token
    let player = existingToken ? room.players.find(p => p.token === existingToken) : null;

    if (player) {
      // Reconnection
      const oldId = player.id;
      player.id = socket.id;
      player.disconnectedAt = null;

      // Update matchState if match is active
      if (room.matchState && room.matchState.players[oldId]) {
        room.matchState.players[socket.id] = room.matchState.players[oldId];
        delete room.matchState.players[oldId];
        room.matchState.playerIds = room.matchState.playerIds.map(id => id === oldId ? socket.id : id);
      }

      // Clear disconnect countdown if running
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
      playerToken = player.token;

      if (typeof callback === 'function') {
        callback({ ok: true, code, token: player.token, reconnected: true });
      }

      // If reconnected to in-progress game, send immediate match context
      if (room.state === 'in_progress' && room.matchState) {
        const p1 = room.players[0];
        const p2 = room.players[1];
        socket.emit('match_start', {
          startsAt: room.matchState.startedAt,
          p1: { id: p1.id, name: p1.name },
          p2: { id: p2.id, name: p2.name },
          serverTime: Date.now()
        });
      }

      broadcastRoomUpdate(room);
      return;
    }

    // Normal join as new player
    if (room.players.length >= 2) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Room is full' });
      return;
    }

    const token = crypto.randomUUID();
    player = { id: socket.id, token, name, rematchRequested: false, disconnectedAt: null };
    room.players.push(player);

    socket.join(code);
    currentRoomCode = code;
    playerToken = token;

    if (typeof callback === 'function') {
      callback({ ok: true, code, token });
    }

    broadcastRoomUpdate(room);

    if (room.players.length === 2 && room.state === 'waiting') {
      startMatch(room);
    }
  });

  // Cast spell
  socket.on('cast', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'in_progress' || !room.matchState) return;

    let spellId = data && data.spell ? String(data.spell).toLowerCase() : '';
    if (!SPELLS[spellId] && (data.text || data.chant)) {
      const detected = matchSpell(data.text || data.chant);
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

  // Rematch request
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

  // Leave room intentionally (instant forfeit)
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

  // Disconnect / drop handling (30s grace window)
  socket.on('disconnect', () => {
    if (!currentRoomCode) return;
    const code = currentRoomCode;
    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.disconnectedAt = Date.now();

    // If match was in progress, grant a 30s reconnect window before awarding forfeit win
    if (room.state === 'in_progress') {
      const deadline = Date.now() + 30000;
      room.disconnectDeadline = deadline;

      io.to(code).emit('opponent_disconnected', {
        player: socket.id,
        name: player.name,
        deadline,
        serverTime: Date.now()
      });

      // Schedule forfeit after 30 seconds if player hasn't reconnected
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
      // If still in lobby and left, clean up
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        cleanupRoom(code);
      } else {
        broadcastRoomUpdate(room);
      }
    }
  });
});

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mage Duel server running on port ${PORT}`);
});
