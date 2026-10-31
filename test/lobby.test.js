// Socket-level regression tests for the lobby fixes in server.js.
//
// These drive a real server process with real Socket.IO clients, because every
// bug they cover lived in the interaction between the two (a socket drop, a
// reconnect with a token, a paired rival that never seats). The grace periods
// are shortened through the same env vars production reads.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, connect, ack, nextEvent, sleep, healthz } = require('../scripts/lib/harness');

const ENV = {
  MD_WAITING_ROOM_TTL_MS: '2500',
  MD_FINISHED_ROOM_TTL_MS: '1500',
  MD_FORFEIT_MS: '700',
  MD_SEAT_WAIT_MS: '700',
  MD_PRACTICE_GRACE_MS: '600'
};

// match_start can be broadcast before the join callback resolves, so listeners
// are attached the moment a socket exists rather than after an await.
function watcher(socket, event) {
  let seen = null;
  socket.on(event, (payload) => { if (!seen) seen = payload; });
  return {
    async wait(ms = 4000) {
      const deadline = Date.now() + ms;
      while (!seen && Date.now() < deadline) await sleep(25);
      return seen;
    }
  };
}

function cleanup(...sockets) {
  for (const s of sockets) {
    try { s.emit('leave_room'); s.disconnect(); } catch (e) { /* already gone */ }
  }
}

test('lobby resilience', async (t) => {
  const { child, url } = await startServer('server.js', ENV);
  t.after(() => child.kill());

  await t.test('a brief creator drop keeps the room and its seat', async () => {
    const host = connect(url);
    const created = await ack(host, 'create_room', { name: 'Host', class: 'fire' });
    assert.equal(created.ok, true);

    host.disconnect();
    await sleep(600);

    const host2 = connect(url);
    const resumed = await ack(host2, 'join_room', { code: created.code, token: created.token, name: 'Host', class: 'fire' });
    assert.equal(resumed.ok, true, 'the seat must survive a short socket drop');

    const guest = connect(url);
    const guestStarted = watcher(guest, 'match_start');
    const hostStarted = watcher(host2, 'match_start');
    const joined = await ack(guest, 'join_room', { code: created.code, name: 'Guest', class: 'frost' });
    assert.equal(joined.ok, true, 'the guest must still find the room');

    assert.ok(await guestStarted.wait(), 'guest never entered the duel');
    assert.ok(await hostStarted.wait(), 'host never entered the duel');
    cleanup(host2, guest);
  });

  await t.test('an abandoned waiting room is reaped after the grace period', async () => {
    const host = connect(url);
    const created = await ack(host, 'create_room', { name: 'Gone', class: 'fire' });
    host.disconnect();

    await sleep(Number(ENV.MD_WAITING_ROOM_TTL_MS) + 600);

    const guest = connect(url);
    const joined = await ack(guest, 'join_room', { code: created.code, name: 'Late', class: 'frost' });
    assert.equal(joined.ok, false);
    assert.match(String(joined.error), /not found/i);
    guest.disconnect();
  });

  await t.test('a paired rival that never seats fails fast instead of hanging', async () => {
    const a = connect(url);
    const queued = await ack(a, 'quick_duel', { name: 'A', class: 'fire' });
    assert.equal(queued.waiting, true);

    const b = connect(url);
    const found = watcher(a, 'quick_match_found');
    await ack(b, 'quick_duel', { name: 'B', class: 'frost' });
    const match = await found.wait();
    assert.ok(match && match.code, 'the pair was never created');

    b.disconnect(); // vanishes before it ever takes its seat
    const failure = watcher(a, 'match_failed');
    await ack(a, 'join_room', { code: match.code, token: match.token, name: 'A', class: 'fire' });

    const failed = await failure.wait(Number(ENV.MD_SEAT_WAIT_MS) + 2000);
    assert.ok(failed, 'the waiting player was never told the duel could not start');
    assert.equal(failed.reason, 'seat_timeout');
    a.disconnect();
  });

  await t.test('an absent player still forfeits when their rival reconnects', async () => {
    const host = connect(url);
    const created = await ack(host, 'create_room', { name: 'Host', class: 'fire' });
    const guest = connect(url);
    const hostStart = watcher(host, 'match_start');
    const guestStart = watcher(guest, 'match_start');
    const joined = await ack(guest, 'join_room', { code: created.code, name: 'Guest', class: 'frost' });
    assert.equal(joined.ok, true);
    assert.ok(await hostStart.wait(), 'match never started');
    assert.ok(await guestStart.wait(), 'match never started');

    host.disconnect();
    guest.disconnect();
    await sleep(150);

    const guest2 = connect(url);
    const resumed = await ack(guest2, 'join_room', { code: created.code, token: joined.token, name: 'Guest', class: 'frost' });
    assert.equal(resumed.ok, true);

    const endP = nextEvent(guest2, 'match_end', 3000);
    const end = await endP;
    assert.ok(end, 'the absent player never forfeited');
    assert.equal(end.reason, 'timeout_forfeit');
    assert.equal(end.winner, guest2.id);
    guest2.disconnect();
  });

  await t.test('practice rooms are released when the player leaves', async () => {
    const before = await healthz(url);
    const p = connect(url);
    const started = watcher(p, 'match_start');
    const practice = await ack(p, 'practice_mode', { name: 'Solo', class: 'frost' });
    assert.equal(practice.ok, true);
    assert.ok(await started.wait(), 'practice never started');

    p.emit('leave_room');
    await sleep(400);
    const after = await healthz(url);

    assert.equal(after.rooms, before.rooms, 'the practice room leaked');
    p.disconnect();
  });

  await t.test('healthz reports live counters', async () => {
    const body = await healthz(url);
    assert.equal(body.ok, true);
    assert.equal(typeof body.rooms, 'number');
    assert.equal(typeof body.sockets, 'number');
    assert.equal(typeof body.eventLoopP99ms, 'number');
  });
});
