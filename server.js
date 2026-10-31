const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createMatch, tryCast, tick, getSnapshot } = require('./shared/rules');
const { SPELLS } = require('./shared/spells');

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
//   players: [{ id: socket.id, name: string, rematchRequested: boolean }],
//   matchState: object | null,
//   tickInterval: Timer | null,
//   snapshotInterval: Timer | null,
//   disconnectTimers: Map<socketId, Timer>
// }
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous characters like I, O, 1, 0
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
    rematchRequested: !!p.rematchRequested
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

  room.matchState = createMatch(p1.id, p2.id, now);

  io.to(room.code).emit('match_start', {
    startsAt: now,
    p1: { id: p1.id, name: p1.name },
    p2: { id: p2.id, name: p2.name },
    serverTime: now
  });

  // Clear previous intervals if any
  if (room.tickInterval) clearInterval(room.tickInterval);
  if (room.snapshotInterval) clearInterval(room.snapshotInterval);

  // 50ms authoritative physics / rules tick
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

  // 250ms state snapshot for drift correction
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
  rooms.delete(code);
}

// ─── Socket Connection & Handlers ───
io.on('connection', (socket) => {
  let currentRoomCode = null;

  // Clock sync / latency ping
  socket.on('ping_server', (clientTime, callback) => {
    if (typeof callback === 'function') {
      callback({ serverTime: Date.now(), clientTime });
    }
  });

  // Create room
  socket.on('create_room', (data, callback) => {
    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage 1';
    const code = generateRoomCode();

    const room = {
      code,
      state: 'waiting',
      players: [{ id: socket.id, name, rematchRequested: false }],
      matchState: null,
      tickInterval: null,
      snapshotInterval: null
    };

    rooms.set(code, room);
    socket.join(code);
    currentRoomCode = code;

    if (typeof callback === 'function') {
      callback({ ok: true, code });
    }
    broadcastRoomUpdate(room);
  });

  // Join room
  socket.on('join_room', (data, callback) => {
    const code = (data && data.code ? String(data.code).trim().toUpperCase() : '');
    const name = (data && data.name ? String(data.name).trim().slice(0, 15) : '') || 'Mage 2';

    const room = rooms.get(code);
    if (!room) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Room not found' });
      return;
    }

    if (room.players.length >= 2) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Room is full' });
      return;
    }

    room.players.push({ id: socket.id, name, rematchRequested: false });
    socket.join(code);
    currentRoomCode = code;

    if (typeof callback === 'function') {
      callback({ ok: true, code });
    }

    broadcastRoomUpdate(room);

    // Auto start match when 2 players join
    if (room.players.length === 2 && room.state === 'waiting') {
      startMatch(room);
    }
  });

  // Cast spell
  socket.on('cast', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'in_progress' || !room.matchState) return;

    const spellId = data && data.spell ? String(data.spell).toLowerCase() : '';
    const now = Date.now();

    const events = tryCast(room.matchState, socket.id, spellId, now);
    for (const ev of events) {
      ev.serverTime = now;
      if (ev.type === 'rejected') {
        // Send rejection only to caster
        socket.emit('rejected', ev);
      } else {
        // Broadcast game events to room
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

    // If both players requested rematch, start new match
    if (room.players.length === 2 && room.players.every(p => p.rematchRequested)) {
      startMatch(room);
    }
  });

  // Leave room
  function handleLeave() {
    if (!currentRoomCode) return;
    const code = currentRoomCode;
    const room = rooms.get(code);
    currentRoomCode = null;
    socket.leave(code);

    if (!room) return;

    // Remove player
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      cleanupRoom(code);
    } else {
      // If match was in progress, remaining player wins by forfeit
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
  }

  socket.on('leave_room', handleLeave);
  socket.on('disconnect', handleLeave);
});

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mage Duel server running on port ${PORT}`);
});
