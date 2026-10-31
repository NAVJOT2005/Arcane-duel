// ─── GAME RULES & STATUS EFFECTS ───
// Pure functions of (state, action, time). Authoritative and testable.

const { SPELLS, PLAYER, CLASSES } = require('./spells');

// ─── State creation ───

function createMatch(p1Id, p2Id, now, p1Class = 'fire', p2Class = 'frost') {
  return {
    startedAt: now,
    winner: null,
    players: {
      [p1Id]: createPlayer(now, p1Class),
      [p2Id]: createPlayer(now, p2Class)
    },
    playerIds: [p1Id, p2Id]
  };
}

function createPlayer(now, mageClass = 'fire') {
  const chosenClass = CLASSES[mageClass] ? mageClass : 'fire';
  return {
    class: chosenClass,
    spells: CLASSES[chosenClass].spells,
    hp: PLAYER.maxHp,
    mana: PLAYER.startMana,
    lastManaUpdate: now,
    cooldowns: {},
    stunUntil: 0,
    blockUntil: 0,
    blockStartedAt: 0,
    windUp: null, // { spellId, endsAt, total }
    // Status effects system
    quickHitCount: 0,
    lastQuickHitAt: 0,
    burnUntil: 0,
    chillUntil: 0,
    tremorNextCast: false,
    blindUntil: 0,
    curseNextCast: false,
    stoneArmor: 0
  };
}

function opponentOf(state, playerId) {
  return state.playerIds.find(id => id !== playerId);
}

// Compute current mana with chill status reduction (50% slower if chilled)
function getMana(player, now) {
  const elapsed = (now - player.lastManaUpdate) / 1000;
  let rate = player.hp <= PLAYER.lowHpThreshold ? PLAYER.lowHpManaRegen : PLAYER.manaRegen;
  if (now < player.chillUntil) {
    rate *= 0.5; // Chilled reduces mana regen by 50%
  }
  const mana = Math.min(PLAYER.maxMana, player.mana + elapsed * rate);
  return Math.floor(mana * 10) / 10;
}

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

  // Verify player has access to this spell in their kit
  if (player.spells && !player.spells.includes(spellId)) {
    return { ok: false, reason: 'spell_not_in_kit' };
  }

  if (!spell.instant && player.windUp) return { ok: false, reason: 'already_casting' };

  // Calculate actual mana cost (Dark Curse adds +1 mana cost)
  flushMana(player, now);
  const actualCost = spell.cost + (player.curseNextCast ? 1 : 0);
  if (player.mana < actualCost) return { ok: false, reason: 'no_mana' };

  return { ok: true };
}

// ─── Cast execution ───

function tryCast(state, playerId, spellId, now) {
  const check = canCast(state, playerId, spellId, now);
  if (!check.ok) {
    return [{ type: 'rejected', player: playerId, spell: spellId, reason: check.reason }];
  }

  const player = state.players[playerId];
  const spell = SPELLS[spellId];
  const events = [];

  // Deduct mana (incorporating curse if active)
  flushMana(player, now);
  const cost = spell.cost + (player.curseNextCast ? 1 : 0);
  player.mana = Math.max(0, player.mana - cost);
  if (player.curseNextCast) {
    player.curseNextCast = false;
    events.push({ type: 'curse_consumed', player: playerId });
  }

  // Set cooldown (Tremor adds +800ms to next spell cooldown)
  let cd = spell.cooldown;
  if (player.tremorNextCast && cd > 0) {
    cd += 800;
    player.tremorNextCast = false;
    events.push({ type: 'tremor_consumed', player: playerId });
  }
  if (cd > 0) {
    player.cooldowns[spellId] = now + cd;
  }

  if (spell.instant) {
    if (spellId === 'block') {
      player.blockUntil = now + spell.duration;
      player.blockStartedAt = now;
      events.push({
        type: 'block_started',
        player: playerId,
        endsAt: player.blockUntil
      });
    } else {
      // Instant Quick attack (Spark, Ice Shard, Zap, Pebble Shot, Shadow Dart)
      const oppId = opponentOf(state, playerId);
      const hitEvents = applyDamage(state, oppId, spell.damage, spell.blockable, now, spellId, playerId);
      events.push(...hitEvents);
    }
  } else {
    // Wind-up spells (Heal, Signature spells, Ultimates)
    const endsAt = now + spell.windUp;
    player.windUp = { spellId, endsAt, total: spell.windUp };
    events.push({
      type: 'cast_started',
      caster: playerId,
      spell: spellId,
      endsAt
    });

    // Ultimate resets opponent block cooldown for fair anime counterplay
    if (spell.cost === 10) {
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

// ─── Damage & Status Effects Application ───

function applyDamage(state, targetId, damage, blockable, now, spellId, attackerId) {
  const target = state.players[targetId];
  const attacker = state.players[attackerId];
  const events = [];
  let blocked = false;
  let perfect = false;
  let actualDamage = damage;

  if (blockable && isBlocking(target, now)) {
    blocked = true;
    const timeSinceBlock = now - target.blockStartedAt;
    if (timeSinceBlock <= PLAYER.perfectBlockWindow) {
      perfect = true;
      actualDamage = 0;
    } else {
      actualDamage = 0;
    }
  }

  // Stone Armor absorb (Earth Mage mechanic)
  if (actualDamage > 0 && target.stoneArmor > 0) {
    const absorbed = Math.min(target.stoneArmor, actualDamage);
    target.stoneArmor -= absorbed;
    actualDamage -= absorbed;
    events.push({ type: 'armor_absorbed', target: targetId, amount: absorbed, remaining: target.stoneArmor });
  }

  // Apply HP damage
  if (actualDamage > 0) {
    target.hp = Math.max(0, target.hp - actualDamage);
  }

  events.push({
    type: 'hit',
    target: targetId,
    attacker: attackerId,
    spell: spellId,
    damage: actualDamage,
    rawDamage: damage,
    blocked,
    perfect
  });

  // ─── Perfect block reflection & stun ───
  if (perfect && attackerId) {
    const stunTime = PLAYER.stunDuration;
    attacker.stunUntil = now + stunTime;

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

  // ─── Status Effects on Unblocked Hits ───
  if (!blocked && actualDamage > 0) {
    // 1. Interrupt interruptible spells
    if (target.windUp) {
      const windUpSpell = SPELLS[target.windUp.spellId];
      if (windUpSpell && windUpSpell.interruptible) {
        events.push({
          type: 'cast_cancelled',
          caster: targetId,
          spell: target.windUp.spellId,
          reason: 'interrupted'
        });
        if (windUpSpell.manaRefund) {
          target.mana = Math.min(PLAYER.maxMana, target.mana + windUpSpell.manaRefund);
        }
        target.windUp = null;
      }
    }

    // 2. Quick Spell 3-Hit Threshold Passive
    const quickSpells = ['fire_spark', 'ice_shard', 'zap', 'pebble_shot', 'shadow_dart'];
    if (spellId && quickSpells.includes(spellId)) {
      if (now - attacker.lastQuickHitAt > 6000) {
        attacker.quickHitCount = 0; // Reset streak if over 6s since last hit
      }
      attacker.quickHitCount += 1;
      attacker.lastQuickHitAt = now;

      if (attacker.quickHitCount >= 3) {
        attacker.quickHitCount = 0;
        // Trigger Element Passive
        if (spellId === 'fire_spark') {
          target.burnUntil = now + 2500;
          events.push({ type: 'status_applied', player: targetId, status: 'burn', until: target.burnUntil });
        } else if (spellId === 'ice_shard') {
          target.chillUntil = now + 2500;
          events.push({ type: 'status_applied', player: targetId, status: 'chill', until: target.chillUntil });
        } else if (spellId === 'zap') {
          flushMana(target, now);
          target.mana = Math.max(0, target.mana - 1);
          events.push({ type: 'mana_drained', target: targetId, amount: 1 });
        } else if (spellId === 'pebble_shot') {
          target.tremorNextCast = true;
          events.push({ type: 'status_applied', player: targetId, status: 'tremor' });
        } else if (spellId === 'shadow_dart') {
          target.blindUntil = now + 2000;
          events.push({ type: 'status_applied', player: targetId, status: 'blind', until: target.blindUntil });
        }
      }
    }

    // 3. Signature Spell Effects
    if (spellId === 'soul_drain') {
      // Dark Mage life steal
      attacker.hp = Math.min(PLAYER.maxHp, attacker.hp + 6);
      events.push({ type: 'heal', player: attackerId, amount: 6, newHp: attacker.hp });
      target.curseNextCast = true;
      events.push({ type: 'status_applied', player: targetId, status: 'curse' });
    } else if (spellId === 'boulder_smash') {
      // Earth Mage stone barrier
      attacker.stoneArmor = Math.min(16, attacker.stoneArmor + 8);
      events.push({ type: 'armor_gained', player: attackerId, total: attacker.stoneArmor });
    }
  }

  return events;
}

// ─── Tick ───

function tick(state, now) {
  if (state.winner) return [];
  const events = [];

  for (const pid of state.playerIds) {
    const player = state.players[pid];

    // Burn Damage-over-time (2 dmg every 800ms)
    if (player.burnUntil > now) {
      if (!player.lastBurnTickAt || now - player.lastBurnTickAt >= 800) {
        player.lastBurnTickAt = now;
        player.hp = Math.max(0, player.hp - 2);
        events.push({ type: 'burn_tick', player: pid, damage: 2, hp: player.hp });
      }
    }

    // Resolve completed wind-ups
    if (player.windUp && now >= player.windUp.endsAt) {
      const spellId = player.windUp.spellId;
      const spell = SPELLS[spellId];
      player.windUp = null;

      if (spellId === 'heal') {
        const healed = Math.min(spell.heal, PLAYER.maxHp - player.hp);
        player.hp += healed;
        events.push({
          type: 'heal',
          player: pid,
          amount: healed,
          newHp: player.hp
        });
      } else {
        const oppId = opponentOf(state, pid);

        // Check if Ultimate finisher
        if (spell.cost === 10) {
          const opp = state.players[oppId];
          if (opp.blockUntil > now) {
            const timeSinceBlock = now - opp.blockStartedAt;
            if (timeSinceBlock <= PLAYER.perfectBlockWindow) {
              events.push({
                type: 'hit',
                target: oppId,
                damage: 0,
                rawDamage: spell.damage,
                blocked: true,
                perfect: true
              });
              player.stunUntil = now + PLAYER.ultimateStunDuration;
              events.push({
                type: 'stunned',
                player: pid,
                until: player.stunUntil
              });
            } else {
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
          // Normal wind-up spell (Fireball, Blizzard Spear, Boulder Smash, Soul Drain, etc.)
          const hitEvents = applyDamage(state, oppId, spell.damage, spell.blockable, now, spellId, pid);
          events.push(...hitEvents);
        }
      }
    }
  }

  // Sudden death: after 120s, both lose 1 HP/s
  const elapsed = now - state.startedAt;
  if (elapsed >= PLAYER.suddenDeathTime) {
    const hpLoss = PLAYER.suddenDeathDps * 0.05;
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

// ─── State snapshot ───

function getSnapshot(state, now) {
  const snap = {};
  for (const pid of state.playerIds) {
    const p = state.players[pid];
    snap[pid] = {
      class: p.class,
      hp: Math.round(p.hp * 10) / 10,
      mana: Math.round(getMana(p, now) * 10) / 10,
      blockActive: isBlocking(p, now),
      stunned: isStunned(p, now),
      windUp: p.windUp ? { spell: p.windUp.spellId, endsAt: p.windUp.endsAt } : null,
      cooldowns: {},
      status: {
        burn: p.burnUntil > now,
        chill: p.chillUntil > now,
        tremor: p.tremorNextCast,
        blind: p.blindUntil > now,
        curse: p.curseNextCast,
        armor: p.stoneArmor
      }
    };
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
