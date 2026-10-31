// ─── GAME RULES ───
// Pure functions of (state, action, time). No timers, no network.
// The server calls these every tick. Tests call them with fake timestamps.

const { SPELLS, PLAYER } = require('./spells');

// ─── State creation ───

function createMatch(p1Id, p2Id, now) {
  return {
    startedAt: now,
    winner: null,
    players: {
      [p1Id]: createPlayer(now),
      [p2Id]: createPlayer(now)
    },
    // Ordered list of player IDs for iteration
    playerIds: [p1Id, p2Id]
  };
}

function createPlayer(now) {
  return {
    hp: PLAYER.maxHp,
    mana: PLAYER.startMana,
    lastManaUpdate: now,
    cooldowns: {},      // spellId -> timestamp when available again
    stunUntil: 0,
    blockUntil: 0,
    blockStartedAt: 0,  // when the current block was activated (for perfect block)
    windUp: null         // { spellId, endsAt } or null
  };
}

// ─── Helpers ───

function opponentOf(state, playerId) {
  return state.playerIds.find(id => id !== playerId);
}

// Compute current mana from last update time (lazy regen)
function getMana(player, now) {
  const elapsed = (now - player.lastManaUpdate) / 1000; // seconds
  const rate = player.hp <= PLAYER.lowHpThreshold
    ? PLAYER.lowHpManaRegen
    : PLAYER.manaRegen;
  const mana = Math.min(PLAYER.maxMana, player.mana + elapsed * rate);
  return Math.floor(mana * 10) / 10; // one decimal place
}

// Flush mana: compute current mana and update the timestamp
function flushMana(player, now) {
  player.mana = getMana(player, now);
  player.lastManaUpdate = now;
}

function isStunned(player, now) {
  return now < player.stunUntil;
}

function isBlocking(player, now) {
  return now < player.blockUntil;
}

function isOnCooldown(player, spellId, now) {
  return player.cooldowns[spellId] && now < player.cooldowns[spellId];
}

// ─── Cast validation ───

function canCast(state, playerId, spellId, now) {
  const player = state.players[playerId];
  const spell = SPELLS[spellId];
  if (!spell) return { ok: false, reason: 'unknown_spell' };
  if (state.winner) return { ok: false, reason: 'match_over' };
  if (isStunned(player, now)) return { ok: false, reason: 'stunned' };
  if (isOnCooldown(player, spellId, now)) return { ok: false, reason: 'cooldown' };

  // Can't start a wind-up if already winding up (but instant spells are OK)
  if (!spell.instant && player.windUp) return { ok: false, reason: 'already_casting' };

  // Mana check
  flushMana(player, now);
  if (player.mana < spell.cost) return { ok: false, reason: 'no_mana' };

  return { ok: true };
}

// ─── Cast execution ───
// Mutates state. Returns array of event objects.

function tryCast(state, playerId, spellId, now) {
  const check = canCast(state, playerId, spellId, now);
  if (!check.ok) {
    return [{ type: 'rejected', player: playerId, spell: spellId, reason: check.reason }];
  }

  const player = state.players[playerId];
  const spell = SPELLS[spellId];
  const events = [];

  // Spend mana
  flushMana(player, now);
  player.mana -= spell.cost;

  // Set cooldown
  if (spell.cooldown > 0) {
    player.cooldowns[spellId] = now + spell.cooldown;
  }

  if (spell.instant) {
    // ─── Instant spells ───
    if (spellId === 'block') {
      player.blockUntil = now + spell.duration;
      player.blockStartedAt = now;
      events.push({
        type: 'block_started',
        player: playerId,
        endsAt: player.blockUntil
      });
    } else if (spellId === 'zap') {
      const oppId = opponentOf(state, playerId);
      const hitEvents = applyDamage(state, oppId, spell.damage, true, now);
      events.push(...hitEvents);
    }
  } else {
    // ─── Wind-up spells ───
    const endsAt = now + spell.windUp;
    player.windUp = { spellId, endsAt };
    events.push({
      type: 'cast_started',
      caster: playerId,
      spell: spellId,
      endsAt
    });

    // Ultimate resets opponent's block cooldown so they always have counterplay
    if (spellId === 'ultimate') {
      const oppId = opponentOf(state, playerId);
      state.players[oppId].cooldowns.block = 0;
      events.push({
        type: 'block_cooldown_reset',
        player: oppId
      });
    }
  }

  return events;
}

// ─── Damage application ───
// blockable: whether this hit can be blocked (false for Lightning)

function applyDamage(state, targetId, damage, blockable, now) {
  const target = state.players[targetId];
  const events = [];
  let blocked = false;
  let perfect = false;
  let actualDamage = damage;

  if (blockable && isBlocking(target, now)) {
    blocked = true;
    // Perfect block: started blocking within the perfect block window
    const timeSinceBlock = now - target.blockStartedAt;
    if (timeSinceBlock <= PLAYER.perfectBlockWindow) {
      perfect = true;
      actualDamage = 0;
    } else {
      actualDamage = 0; // normal block absorbs fully
    }
  }

  // Apply damage
  if (actualDamage > 0) {
    target.hp = Math.max(0, target.hp - actualDamage);
  }

  events.push({
    type: 'hit',
    target: targetId,
    damage: actualDamage,
    rawDamage: damage,
    blocked,
    perfect
  });

  // Perfect block stuns the attacker
  if (perfect) {
    const attackerId = opponentOf(state, targetId);
    const attacker = state.players[attackerId];
    const stunTime = PLAYER.stunDuration;
    attacker.stunUntil = now + stunTime;

    // Cancel attacker's wind-up if any
    if (attacker.windUp) {
      events.push({
        type: 'cast_cancelled',
        caster: attackerId,
        spell: attacker.windUp.spellId,
        reason: 'stunned'
      });
      attacker.windUp = null;
    }

    events.push({
      type: 'stunned',
      player: attackerId,
      until: attacker.stunUntil
    });
  }

  // If target was winding up an interruptible spell, cancel it
  if (actualDamage > 0 && target.windUp) {
    const windUpSpell = SPELLS[target.windUp.spellId];
    if (windUpSpell.interruptible) {
      events.push({
        type: 'cast_cancelled',
        caster: targetId,
        spell: target.windUp.spellId,
        reason: 'interrupted'
      });

      // Refund mana for Ultimate
      if (target.windUp.spellId === 'ultimate') {
        target.mana = Math.min(PLAYER.maxMana, target.mana + SPELLS.ultimate.manaRefund);
      }

      target.windUp = null;
    }
  }

  return events;
}

// ─── Tick ───
// Called every ~50ms by the server. Resolves completed wind-ups,
// checks sudden death and win conditions.

function tick(state, now) {
  if (state.winner) return [];
  const events = [];

  for (const pid of state.playerIds) {
    const player = state.players[pid];

    // Resolve completed wind-ups
    if (player.windUp && now >= player.windUp.endsAt) {
      const spell = SPELLS[player.windUp.spellId];
      const spellId = player.windUp.spellId;
      player.windUp = null;

      if (spellId === 'heal') {
        // Heal: add HP
        const healed = Math.min(spell.heal, PLAYER.maxHp - player.hp);
        player.hp += healed;
        events.push({
          type: 'heal',
          player: pid,
          amount: healed,
          newHp: player.hp
        });
      } else {
        // Damage spell: hit the opponent
        const oppId = opponentOf(state, pid);

        if (spellId === 'ultimate') {
          // Ultimate: chip damage through block, full damage otherwise
          const opp = state.players[oppId];
          if (opp.blockUntil > now) {
            // Check perfect block
            const timeSinceBlock = now - opp.blockStartedAt;
            if (timeSinceBlock <= PLAYER.perfectBlockWindow) {
              // Perfect block: 0 damage, stun attacker for longer
              events.push({
                type: 'hit',
                target: oppId,
                damage: 0,
                rawDamage: spell.damage,
                blocked: true,
                perfect: true
              });
              // Stun the attacker (longer for Ultimate)
              player.stunUntil = now + PLAYER.ultimateStunDuration;
              if (player.windUp) {
                events.push({
                  type: 'cast_cancelled',
                  caster: pid,
                  spell: player.windUp.spellId,
                  reason: 'stunned'
                });
                player.windUp = null;
              }
              events.push({
                type: 'stunned',
                player: pid,
                until: player.stunUntil
              });
            } else {
              // Normal block: chip damage
              opp.hp = Math.max(0, opp.hp - spell.chipDamage);
              events.push({
                type: 'hit',
                target: oppId,
                damage: spell.chipDamage,
                rawDamage: spell.damage,
                blocked: true,
                perfect: false
              });
            }
          } else {
            // No block: full damage
            opp.hp = Math.max(0, opp.hp - spell.damage);
            events.push({
              type: 'hit',
              target: oppId,
              damage: spell.damage,
              rawDamage: spell.damage,
              blocked: false,
              perfect: false
            });
          }
        } else {
          // Normal damage spell (Fireball, Lightning)
          const hitEvents = applyDamage(state, oppId, spell.damage, spell.blockable, now);
          events.push(...hitEvents);
        }
      }
    }
  }

  // Sudden death: after 120s, both lose 1 HP/s
  const elapsed = now - state.startedAt;
  if (elapsed >= PLAYER.suddenDeathTime) {
    const hpLoss = PLAYER.suddenDeathDps * 0.05; // per tick (50ms)
    for (const pid of state.playerIds) {
      state.players[pid].hp = Math.max(0, state.players[pid].hp - hpLoss);
    }
  }

  // Check for winner
  const dead = state.playerIds.filter(pid => state.players[pid].hp <= 0);
  if (dead.length === 2) {
    state.winner = 'draw';
    events.push({ type: 'match_end', winner: 'draw', reason: 'mutual_kill' });
  } else if (dead.length === 1) {
    const winner = state.playerIds.find(pid => state.players[pid].hp > 0);
    state.winner = winner;
    events.push({ type: 'match_end', winner, reason: 'kill' });
  }

  return events;
}

// ─── State snapshot (for sending to clients) ───

function getSnapshot(state, now) {
  const snap = {};
  for (const pid of state.playerIds) {
    const p = state.players[pid];
    snap[pid] = {
      hp: Math.round(p.hp * 10) / 10,
      mana: Math.round(getMana(p, now) * 10) / 10,
      blockActive: isBlocking(p, now),
      stunned: isStunned(p, now),
      windUp: p.windUp ? { spell: p.windUp.spellId, endsAt: p.windUp.endsAt } : null,
      cooldowns: {}
    };
    // Include cooldown remaining for each spell
    for (const [sid, until] of Object.entries(p.cooldowns)) {
      if (until > now) {
        snap[pid].cooldowns[sid] = until - now;
      }
    }
  }
  return snap;
}

module.exports = {
  createMatch,
  createPlayer,
  opponentOf,
  getMana,
  flushMana,
  isStunned,
  isBlocking,
  isOnCooldown,
  canCast,
  tryCast,
  tick,
  getSnapshot,
  applyDamage
};
