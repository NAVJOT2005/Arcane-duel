#!/usr/bin/env node
// Headless class-balance simulation over the real rules engine.
//
//   node scripts/sim.js                          # current shared/spells.js
//   SPELLS_FILE=.tmp-check/spells-baseline.js node scripts/sim.js
//   node scripts/sim.js --matches 80 --json out.json
//
// Everything runs through createMatch/tryCast/tick with a virtual clock, so the
// numbers here are the numbers the server would produce for the same inputs. A
// bot only ever sees the same snapshot data a client sees: HP, mana, the rival's
// wind-up (telegraph), cooldowns and status tags.
//
// Policies model the ways real players play, because a single policy flatters
// whichever class it happens to suit:
//   reactive  times blocks against the telegraph (the intended skill loop)
//   turtle    blocks early and often, heals a lot
//   heavy     rarely blocks, spends everything on signature + ultimate
//   spark     quick spells only, blocks reactively
//   noblock   never blocks at all
//
// Matches are deterministic per pairing (seeded RNG), so a before/after run only
// differs by the spell table you point it at.

const path = require('path');

// Allows the same script to grade a different spell table: the rules module
// resolves './spells' through the require cache, so pre-seeding that entry is
// enough and neither file has to be edited.
if (process.env.SPELLS_FILE) {
  const spellsPath = require.resolve('../shared/spells');
  const alt = require(path.resolve(process.env.SPELLS_FILE));
  require.cache[spellsPath] = { id: spellsPath, filename: spellsPath, loaded: true, exports: alt };
}

const { createMatch, tryCast, tick, canCast, getMana, isBlocking } = require('../shared/rules');
const { SPELLS, CLASSES, PLAYER } = require('../shared/spells');

const STEP_MS = 50;
const MAX_MS = 240000;

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const MATCHES = argOf('--matches', 60);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const CLASS_KEYS = Object.keys(CLASSES);

// ─── RNG ──────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = (rng, lo, hi) => lo + rng() * (hi - lo);

// ─── Bot policies ─────────────────────────────────────────────────────────────
const POLICIES = {
  reactive: { blocks: true, earlyBlock: 0.3, healBelow: 45, useUlt: true, useSignature: true, quickEvery: true },
  turtle: { blocks: true, earlyBlock: 0.95, healBelow: 65, useUlt: false, useSignature: true, quickEvery: false },
  heavy: { blocks: true, earlyBlock: 0.55, healBelow: 28, useUlt: true, useSignature: true, quickEvery: false },
  spark: { blocks: true, earlyBlock: 0.2, healBelow: 40, useUlt: false, useSignature: false, quickEvery: true },
  noblock: { blocks: false, earlyBlock: 0, healBelow: 35, useUlt: true, useSignature: true, quickEvery: true }
};
const POLICY_KEYS = Object.keys(POLICIES);

// A bot decides on a fixed cadence from what a client could know: its own mana
// and cooldowns, the rival's HP, and the rival's visible wind-up.
function decide(bot, state, meId, oppId, now, cast) {
  const me = state.players[meId];
  const opp = state.players[oppId];
  const pol = bot.policy;
  const rng = bot.rng;
  const kit = me.spells;
  const quick = kit[0], sig = kit[2], heal = kit[3], ult = kit[4];
  const ready = (id) => canCast(state, meId, id, now).ok;
  const mana = getMana(me, now);

  // 1. Defend. The wind-up is public, so this is the block/parry loop.
  if (pol.blocks && opp.windUp && !isBlocking(me, now) && ready('block')) {
    const elapsed = now - (opp.windUp.endsAt - opp.windUp.total);
    const remaining = opp.windUp.endsAt - now;
    if (elapsed >= bot.react && remaining <= 620 && remaining > 0) {
      cast('block');
      return;
    }
    if (elapsed >= bot.react && remaining <= 1500 && rng() < pol.earlyBlock) {
      cast('block');
      return;
    }
  }

  // 2. Heal, but never into an obvious interrupt.
  if (me.hp < pol.healBelow && ready(heal) && (!opp.windUp || me.hp < 22)) {
    cast(heal);
    return;
  }

  // 3. Ultimate when it is affordable; the 3s wind-up is the risk it takes.
  if (pol.useUlt && mana >= SPELLS[ult].cost && ready(ult)) {
    cast(ult);
    return;
  }

  // 4. Signature spell.
  if (pol.useSignature && mana >= SPELLS[sig].cost && ready(sig)) {
    cast(sig);
    return;
  }

  // 5. Quick spell, the only thing that also works mid wind-up.
  if ((pol.quickEvery || mana >= SPELLS[sig].cost) && mana >= SPELLS[quick].cost && ready(quick)) {
    cast(quick);
  }
}

function playMatch(classA, classB, policyA, policyB, seed) {
  const rng = mulberry32(seed);
  const state = createMatch('A', 'B', 0, classA, classB);
  const bots = {
    A: { policy: POLICIES[policyA], react: rand(rng, 170, 330), next: rand(rng, 0, 100), rng },
    B: { policy: POLICIES[policyB], react: rand(rng, 170, 330), next: rand(rng, 0, 100), rng }
  };

  const ids = ['A', 'B'];
  const other = (id) => (id === 'A' ? 'B' : 'A');
  const cast = (id, spellId, now) => {
    const events = tryCast(state, id, spellId, now);
    for (const ev of events) if (ev.type === 'match_end') state.winner = ev.winner;
  };

  let now = 0;
  while (now < MAX_MS && !state.winner) {
    now += STEP_MS;
    for (const id of ids) {
      const bot = bots[id];
      if (now < bot.next) continue;
      bot.next = now + rand(rng, 90, 150);
      decide(bot, state, id, other(id), now, (spellId) => cast(id, spellId, now));
    }
    tick(state, now);
  }

  return { winner: state.winner || 'timeout', ms: now };
}

// ─── Runs ─────────────────────────────────────────────────────────────────────
function classMatrix(matches) {
  // reaction-time bots only, so the matrix shows class strength without policy
  // luck; seats are swapped by running both orders.
  const matrix = {};
  for (const a of CLASS_KEYS) {
    matrix[a] = {};
    for (const b of CLASS_KEYS) {
      if (a === b) { matrix[a][b] = null; continue; }
      let wins = 0, draws = 0;
      for (let i = 0; i < matches; i++) {
        const r = playMatch(a, b, 'reactive', 'reactive', 1000 + i * 31 + CLASS_KEYS.indexOf(a) * 977 + CLASS_KEYS.indexOf(b) * 131);
        if (r.winner === 'A') wins++;
        else if (r.winner !== 'B') draws++;
      }
      matrix[a][b] = { wins, losses: matches - wins - draws, draws, rate: wins / matches };
    }
  }
  return matrix;
}

function overallRates(matches) {
  const stats = {};
  for (const c of CLASS_KEYS) stats[c] = { wins: 0, games: 0, draws: 0 };

  for (const a of CLASS_KEYS) {
    for (const b of CLASS_KEYS) {
      if (a === b) continue;
      for (let i = 0; i < matches; i++) {
        // Rotate policies so each class meets every playstyle, including the
        // mismatched pairs (reactor vs no-block, etc).
        const pa = POLICY_KEYS[(i + CLASS_KEYS.indexOf(a)) % POLICY_KEYS.length];
        const pb = POLICY_KEYS[(i * 3 + CLASS_KEYS.indexOf(b)) % POLICY_KEYS.length];
        const r = playMatch(a, b, pa, pb, 5000 + i * 17 + CLASS_KEYS.indexOf(a) * 101 + CLASS_KEYS.indexOf(b) * 7);
        stats[a].games++;
        stats[b].games++;
        if (r.winner === 'A') { stats[a].wins++; stats[b].draws += 0; }
        else if (r.winner === 'B') stats[b].wins++;
        else { stats[a].draws++; stats[b].draws++; }
      }
    }
  }

  const out = {};
  for (const c of CLASS_KEYS) {
    const s = stats[c];
    out[c] = { winRate: s.wins / s.games, draws: s.draws / s.games, games: s.games };
  }
  return out;
}

// ─── Report ───────────────────────────────────────────────────────────────────
const started = Date.now();
const overall = overallRates(MATCHES);
const matrix = classMatrix(Math.max(10, Math.round(MATCHES * 0.66)));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nClass balance simulation — ${MATCHES} matches per ordered pairing, 5 policies, seats swapped\n`);

console.log(pad('CLASS', 12) + pad('WIN RATE', 12) + 'DRAWS');
for (const c of CLASS_KEYS) {
  const v = overall[c];
  const flag = v.winRate < 0.4 || v.winRate > 0.6 ? '  <-- outside 40-60%' : '';
  console.log(pad(CLASSES[c].name, 12) + pad(`${(v.winRate * 100).toFixed(1)}%`, 12) + `${(v.draws * 100).toFixed(1)}%${flag}`);
}

console.log('\nHead-to-head win rate (row beats column), reactive-blocking bots:\n');
console.log(pad('', 12) + CLASS_KEYS.map(c => pad(c.slice(0, 8), 10)).join(''));
for (const a of CLASS_KEYS) {
  let line = pad(a.slice(0, 11), 12);
  for (const b of CLASS_KEYS) {
    const cell = matrix[a][b];
    line += pad(cell ? `${(cell.rate * 100).toFixed(0)}%` : '—', 10);
  }
  console.log(line);
}

console.log(`\nSimulated in ${((Date.now() - started) / 1000).toFixed(1)}s`);

if (jsonOut) {
  require('fs').writeFileSync(jsonOut, JSON.stringify({ overall, matrix, matches: MATCHES }, null, 2));
  console.log(`Wrote ${jsonOut}`);
}
