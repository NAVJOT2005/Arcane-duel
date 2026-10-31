#!/usr/bin/env node
// Two measurements the report needs:
//
//   1. N sequential create -> join -> start cycles, with a random 0-3s
//      disconnect injected on one side, reported as a success rate.
//   2. Event-loop delay (p99) with two active rooms and all four players
//      sending player_move at 60Hz, plus the snapshot traffic that implies.
//
//   node scripts/load.js                     # current server.js
//   node scripts/load.js --server <file>     # baseline comparison
//   CYCLES=20 node scripts/load.js           # shorter run
//
// The p99 number is the one that decides whether the Socket.IO heartbeat can be
// blamed for mid-match disconnects on a shared-CPU host.

const { sleep, startServer, healthz, connect, nextEvent, ack } = require('./lib/harness');

const argv = process.argv.slice(2);
const serverFile = argv.includes('--server') ? argv[argv.indexOf('--server') + 1] : 'server.js';
const CYCLES = Number(process.env.CYCLES || 50);
const CLASSES = ['fire', 'frost', 'lightning', 'earth', 'dark'];
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// match_start is emitted immediately after the join callback, so a listener
// attached after `await ack(...)` can miss it entirely. Trackers attach the
// listener the moment the socket exists, and survive reconnects.
function tracker() {
  let started = false;
  return {
    add(socket) { socket.on('match_start', () => { started = true; }); },
    wait(ms) {
      return new Promise((resolve) => {
        const deadline = Date.now() + ms;
        const iv = setInterval(() => {
          if (started) { clearInterval(iv); resolve(true); }
          else if (Date.now() > deadline) { clearInterval(iv); resolve(false); }
        }, 40);
      });
    }
  };
}

async function cycle(base, i) {
  const mode = i % 10; // 0-3: host blips, 4-6: guest blips, 7-9: clean
  const sockets = [];
  const hostSide = tracker();
  const guestSide = tracker();

  let host = connect(base);
  sockets.push(host); hostSide.add(host);
  const created = await ack(host, 'create_room', { name: `H${i}`, class: CLASSES[i % 5] });
  if (!created.ok) {
    sockets.forEach((s) => s.disconnect());
    return { ok: false, why: `create: ${created.error}` };
  }

  if (mode < 4) {
    host.disconnect();
    await sleep(rand(0, 3000));
    host = connect(base);
    sockets.push(host); hostSide.add(host);
    const resumed = await ack(host, 'join_room', { code: created.code, token: created.token, name: `H${i}`, class: CLASSES[i % 5] });
    if (!resumed.ok) {
      sockets.forEach((s) => s.disconnect());
      return { ok: false, why: `host resume: ${resumed.error}` };
    }
  }

  let guest = connect(base);
  sockets.push(guest); guestSide.add(guest);
  const joined = await ack(guest, 'join_room', { code: created.code, name: `G${i}`, class: CLASSES[(i + 2) % 5] });
  if (!joined.ok) {
    sockets.forEach((s) => s.disconnect());
    return { ok: false, why: `guest join: ${joined.error}` };
  }

  if (mode >= 4 && mode < 7) {
    guest.disconnect();
    await sleep(rand(0, 3000));
    guest = connect(base);
    sockets.push(guest); guestSide.add(guest);
    const resumed = await ack(guest, 'join_room', { code: created.code, token: joined.token, name: `G${i}`, class: CLASSES[(i + 2) % 5] });
    if (!resumed.ok) {
      sockets.forEach((s) => s.disconnect());
      return { ok: false, why: `guest resume: ${resumed.error}` };
    }
  }

  const [h, g] = await Promise.all([hostSide.wait(15000), guestSide.wait(15000)]);

  sockets.forEach((s) => { s.emit('leave_room'); s.disconnect(); });
  return { ok: h && g, why: h && g ? '' : `match_start host=${h} guest=${g}` };
}

async function cycles(base) {
  let ok = 0;
  const failures = [];
  for (let i = 0; i < CYCLES; i++) {
    const r = await cycle(base, i);
    if (r.ok) ok++;
    else failures.push(`#${i} (${i % 10 < 4 ? 'host blip' : i % 10 < 7 ? 'guest blip' : 'clean'}): ${r.why}`);
    await sleep(60);
  }
  return { ok, total: CYCLES, failures };
}

async function load(base) {
  const rooms = [];
  for (let r = 0; r < 2; r++) {
    const host = connect(base);
    const hs = tracker(); hs.add(host);
    const created = await ack(host, 'create_room', { name: `LH${r}`, class: 'fire' });
    const guest = connect(base);
    const gs = tracker(); gs.add(guest);
    const joined = await ack(guest, 'join_room', { code: created.code, name: `LG${r}`, class: 'frost' });
    const started = created.ok && joined.ok ? await Promise.all([hs.wait(8000), gs.wait(8000)]) : [false, false];
    if (!started[0] || !started[1]) {
      host.disconnect(); guest.disconnect();
      return { ok: false, why: `room ${r} did not start` };
    }
    rooms.push([host, guest]);
  }

  const idle = await healthz(base);

  // Snapshot traffic: what one client actually receives per second.
  let snapBytes = 0, snapCount = 0;
  const probe = rooms[0][0];
  const onSnap = (d) => { snapBytes += Buffer.byteLength(JSON.stringify(d)); snapCount++; };
  probe.on('state_snapshot', onSnap);

  // 60Hz movement from all four players, exactly like a browser tab.
  let moves = 0;
  const timers = [];
  for (const pair of rooms) {
    for (const s of pair) {
      timers.push(setInterval(() => {
        moves++;
        s.emit('player_move', { x: Math.sin(moves / 20) * 8, z: Math.cos(moves / 30) * 4, rotY: 0 });
      }, 16));
    }
  }

  await sleep(12000);
  const busy = await healthz(base);

  timers.forEach(clearInterval);
  probe.off('state_snapshot', onSnap);
  rooms.flat().forEach((s) => { s.emit('leave_room'); s.disconnect(); });

  return {
    ok: true,
    idleP99: idle ? idle.eventLoopP99ms : null,
    busyP99: busy ? busy.eventLoopP99ms : null,
    rooms: busy ? busy.rooms : null,
    sockets: busy ? busy.sockets : null,
    moveMessages: moves,
    snapshotsPerSecond: +(snapCount / 12).toFixed(1),
    snapshotBytesPerSecond: Math.round(snapBytes / 12)
  };
}

async function main() {
  console.log(`\nLoad/cycles against: ${serverFile}\n`);
  const { child, url } = await startServer(serverFile, { MD_LOG: '0' });
  try {
    const c = await cycles(url);
    const pct = ((c.ok / c.total) * 100).toFixed(0);
    console.log(`Sequential create->join->start cycles: ${c.ok}/${c.total} (${pct}%)`);
    for (const f of c.failures.slice(0, 12)) console.log(`  FAILED ${f}`);
    if (c.failures.length > 12) console.log(`  ...and ${c.failures.length - 12} more`);

    const l = await load(url);
    if (!l.ok) {
      console.log(`\nLoad test could not run: ${l.why}`);
    } else {
      console.log('\n2 rooms / 4 players, 60Hz player_move for 12s:');
      console.log(`  event-loop p99: idle=${l.idleP99 === null ? 'n/a' : l.idleP99 + 'ms'}  under load=${l.busyP99 === null ? 'n/a (no /healthz)' : l.busyP99 + 'ms'}`);
      console.log(`  rooms=${l.rooms === null ? 'n/a' : l.rooms}  sockets=${l.sockets === null ? 'n/a' : l.sockets}`);
      console.log(`  client sent ${l.moveMessages} moves; receives ${l.snapshotsPerSecond} snapshots/s (${l.snapshotBytesPerSecond} B/s)`);
    }
  } finally {
    child.kill();
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
