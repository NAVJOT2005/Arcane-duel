#!/usr/bin/env node
// Reproduces the reported lobby/connection bugs end to end, over real
// Socket.IO connections, against a real server process.
//
//   node scripts/repro.js                  # current server.js
//   node scripts/repro.js --server <file>  # e.g. the pre-fix baseline
//
// Each scenario prints PASS/FAIL with the evidence it actually observed. The
// timing knobs are shortened through env vars so the whole run takes seconds
// instead of minutes; the production values are the defaults in server.js.

const { sleep, startServer, roomCount, connect, nextEvent, ack } = require('./lib/harness');

const argv = process.argv.slice(2);
const serverFile = argv.includes('--server') ? argv[argv.indexOf('--server') + 1] : 'server.js';

// Long enough for the 5s drop in scenario 1 to fall inside the grace window,
// short enough that the reap scenario does not dominate the run.
const TTL_MS = 7000;
const SEAT_MS = 1600;
const FORFEIT_MS = 1500;

const startEnv = {
  MD_WAITING_ROOM_TTL_MS: String(TTL_MS),
  MD_FINISHED_ROOM_TTL_MS: String(TTL_MS),
  MD_SEAT_WAIT_MS: String(SEAT_MS),
  MD_FORFEIT_MS: String(FORFEIT_MS)
};

async function matchesStarted(a, b, ms = 5000) {
  const [ma, mb] = await Promise.all([nextEvent(a, 'match_start', ms), nextEvent(b, 'match_start', ms)]);
  return !!ma && !!mb;
}

const results = [];
function record(name, pass, evidence) {
  results.push({ name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${evidence}`);
}

// ── 1. Creator's socket blips for 5s, then rejoins with its token ────────────
// Old behaviour: the waiting room is deleted the instant the socket drops, so
// the rejoin and the guest both get "Room not found".
async function creatorBlip(base) {
  const host = connect(base);
  const created = await ack(host, 'create_room', { name: 'Host', class: 'fire' });
  host.disconnect();
  await sleep(5000);

  const host2 = connect(base);
  const resume = await ack(host2, 'join_room', { code: created.code, token: created.token, name: 'Host', class: 'fire' });
  const guest = connect(base);
  const joined = await ack(guest, 'join_room', { code: created.code, name: 'Guest', class: 'frost' });
  const started = joined.ok ? await matchesStarted(host2, guest) : false;

  [host2, guest].forEach((s) => s.disconnect());
  record('creator drops 5s, rejoins with token, guest joins',
    resume.ok && joined.ok && started,
    `resume ok=${resume.ok} (${resume.error || 'seated'}), guest join ok=${joined.ok} (${joined.error || 'seated'}), match_start=${started}`);
}

// ── 2. Guest joins while the creator is still reconnecting ──────────────────
async function guestJoinsDuringReconnect(base) {
  const host = connect(base);
  const created = await ack(host, 'create_room', { name: 'Host', class: 'fire' });
  host.disconnect();

  const guest = connect(base);
  const joined = await ack(guest, 'join_room', { code: created.code, name: 'Guest', class: 'frost' });
  if (!joined.ok) {
    guest.disconnect();
    return record('guest joins during creator reconnect', false,
      `guest join failed: ${joined.error} (room was gone, so nothing could wait for the creator)`);
  }

  await sleep(700);
  const host2 = connect(base);
  const resume = await ack(host2, 'join_room', { code: created.code, token: created.token, name: 'Host', class: 'fire' });
  const started = resume.ok ? await matchesStarted(host2, guest, 5000) : false;
  const failed = await nextEvent(guest, 'match_failed', 100);

  guest.disconnect(); host2.disconnect();
  record('guest joins during creator reconnect', started || !!failed,
    `guest seated=${joined.ok}, creator resumed=${resume.ok}, match_start=${started}, match_failed=${!!failed}${failed ? ' (' + failed.reason + ')' : ''}`);
}

// ── 3. Nobody comes back to a waiting room ──────────────────────────────────
// The room must survive the grace period (so a 5s drop is harmless) and be
// reaped afterwards (so it does not leak).
async function waitingRoomGraceAndReap(base) {
  // Let leftovers from the earlier scenarios time out first, so the counts here
  // describe only the room this test creates.
  await sleep(TTL_MS + 700);
  const before = await roomCount(base);
  const host = connect(base);
  const created = await ack(host, 'create_room', { name: 'Host', class: 'fire' });
  host.disconnect();

  await sleep(Math.floor(TTL_MS / 3));
  const during = await roomCount(base);

  await sleep(TTL_MS + 500);
  const after = await roomCount(base);

  const guest = connect(base);
  const joined = await ack(guest, 'join_room', { code: created.code, name: 'Guest', class: 'frost' });
  guest.disconnect();

  record('waiting room survives the grace window, then is reaped',
    during === before + 1 && after === before && !joined.ok,
    `rooms before=${before}, ${Math.round(TTL_MS / 3)}ms in=${during}, ${TTL_MS + 500}ms later=${after}, late join ok=${joined.ok}`);
}

// ── 4. Both players drop mid-match, one comes back ─────────────────────────
// Old behaviour: one shared timer, so the returning player's reconnect cancels
// the absent player's forfeit and the match hangs forever.
async function bothDropThenOneReturns(base) {
  const host = connect(base);
  const created = await ack(host, 'create_room', { name: 'Host', class: 'fire' });
  const guest = connect(base);
  const joined = await ack(guest, 'join_room', { code: created.code, name: 'Guest', class: 'frost' });
  if (!joined.ok) { host.disconnect(); guest.disconnect(); return record('both drop mid-match, one returns', false, `could not start a match: ${joined.error}`); }
  if (!(await matchesStarted(host, guest))) { host.disconnect(); guest.disconnect(); return record('both drop mid-match, one returns', false, 'match never started'); }

  host.disconnect();
  guest.disconnect();
  await sleep(250);

  const guest2 = connect(base);
  const resume = await ack(guest2, 'join_room', { code: created.code, token: joined.token, name: 'Guest', class: 'frost' });
  const end = await nextEvent(guest2, 'match_end', FORFEIT_MS + 2500);

  const returningId = guest2.id; // cleared by disconnect()
  guest2.disconnect();
  record('both drop mid-match, one returns: absent player still forfeits',
    resume.ok && !!end && end.reason === 'timeout_forfeit' && end.winner === returningId,
    `resumed=${resume.ok}, match_end=${end ? `${end.reason} winner=${end.winner === returningId ? 'returning player' : 'NOT the returning player (' + end.winner + ' vs ' + returningId + ')'}` : 'none within ' + (FORFEIT_MS + 2500) + 'ms'}`);
}

// ── 5. Quick Duel partner vanishes between pairing and seating ─────────────
// This is the silent startMatch early-return: the room has two seats, one
// socket never arrives, and nobody is told anything.
async function quickDuelGhostPartner(base) {
  const a = connect(base);
  const first = await ack(a, 'quick_duel', { name: 'A', class: 'fire' });
  if (!first.waiting) { a.disconnect(); return record('Quick Duel partner vanishes before seating', false, 'first player was not queued'); }

  const b = connect(base);
  const foundA = nextEvent(a, 'quick_match_found', 4000);
  await ack(b, 'quick_duel', { name: 'B', class: 'frost' });
  const match = await foundA;
  if (!match) { a.disconnect(); b.disconnect(); return record('Quick Duel partner vanishes before seating', false, 'no pairing'); }

  b.disconnect(); // vanishes before it ever seats

  const failedP = nextEvent(a, 'match_failed', SEAT_MS + 3000);
  const quickFailedP = nextEvent(a, 'quick_match_failed', SEAT_MS + 3000);
  const joined = await ack(a, 'join_room', { code: match.code, token: match.token, name: 'A', class: 'fire' });
  const failed = await failedP;
  const quickFailed = await quickFailedP;

  await sleep(200);
  const rooms = await roomCount(base);
  a.disconnect();

  record('Quick Duel partner vanishes before seating', joined.ok && (!!failed || !!quickFailed) && (rooms === null || rooms === 0),
    `joined=${joined.ok}, match_failed=${failed ? failed.reason : 'none'}, quick_match_failed=${!!quickFailed}, rooms left=${rooms === null ? 'n/a' : rooms}`);
}

// ── 6. Practice room is deleted when the player leaves ─────────────────────
async function practiceRoomLeak(base) {
  const before = await roomCount(base);
  const p = connect(base);
  // Listen before the ack: the server announces the match as soon as it seats,
  // which can beat the callback's promise continuation.
  const matchP = nextEvent(p, 'match_start', 4000);
  const started = await ack(p, 'practice_mode', { name: 'Solo', class: 'frost' });
  const match = await matchP;
  p.emit('leave_room');
  await sleep(400);
  const after = await roomCount(base);

  // A leaked practice room still accepts a join after its only human left.
  const back = connect(base);
  const rejoin = await ack(back, 'join_room', { code: started.code, token: started.token, name: 'Solo', class: 'frost' });
  back.disconnect();
  p.disconnect();
  await sleep(300);
  const afterDisconnect = await roomCount(base);

  const known = after !== null && before !== null;
  record('practice room is released on leave',
    !!match && !rejoin.ok && (!known || (after === before && afterDisconnect === before)),
    `match_start=${!!match}, rooms after leave=${after === null ? 'n/a' : after} (baseline ${before === null ? 'n/a' : before}), stale room accepted rejoin=${rejoin.ok}`);
}

async function main() {
  console.log(`\nReproducing against: ${serverFile}\n`);
  const { child, url } = await startServer(serverFile, startEnv);
  try {
    await creatorBlip(url);
    await guestJoinsDuringReconnect(url);
    await waitingRoomGraceAndReap(url);
    await bothDropThenOneReturns(url);
    await quickDuelGhostPartner(url);
    await practiceRoomLeak(url);
  } finally {
    child.kill();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} scenarios passed`);
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((err) => { console.error(err); process.exit(2); });
