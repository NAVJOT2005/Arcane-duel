const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createMatch, getMana, flushMana, canCast, tryCast, tick,
  isStunned, isBlocking, opponentOf, getSnapshot
} = require('../shared/rules');
const { SPELLS, PLAYER } = require('../shared/spells');

// Helper: create a match with predictable IDs
function setup(now = 1000) {
  return createMatch('p1', 'p2', now);
}

// ─── State creation ───

describe('createMatch', () => {
  it('should create two players with correct starting values', () => {
    const state = setup(1000);
    const p = state.players.p1;
    assert.equal(p.hp, 100);
    assert.equal(p.mana, 5);
    assert.equal(p.windUp, null);
    assert.equal(p.stunUntil, 0);
    assert.equal(p.blockUntil, 0);
  });
});

// ─── Mana ───

describe('mana', () => {
  it('should regenerate 1 per second at full HP', () => {
    const state = setup(0);
    // After 3 seconds, p1 should have 5 + 3 = 8 mana
    const mana = getMana(state.players.p1, 3000);
    assert.equal(mana, 8);
  });

  it('should cap at maxMana', () => {
    const state = setup(0);
    // After 10 seconds, mana should be capped at 10 (not 15)
    const mana = getMana(state.players.p1, 10000);
    assert.equal(mana, 10);
  });

  it('should regen faster when HP is low', () => {
    const state = setup(0);
    state.players.p1.hp = 20; // below threshold
    // After 2 seconds at 1.5/s: 5 + 3 = 8
    const mana = getMana(state.players.p1, 2000);
    assert.equal(mana, 8);
  });
});

// ─── Zap ───

describe('zap', () => {
  it('should deal 4 damage and cost 1 mana', () => {
    const state = setup(0);
    const events = tryCast(state, 'p1', 'zap', 0);
    assert.equal(state.players.p2.hp, 96);
    assert.equal(state.players.p1.mana, 4);
    const hit = events.find(e => e.type === 'hit');
    assert.ok(hit);
    assert.equal(hit.damage, 4);
  });

  it('should be blocked by an active Block', () => {
    const state = setup(0);
    tryCast(state, 'p2', 'block', 0); // p2 blocks
    const events = tryCast(state, 'p1', 'zap', 100); // p1 zaps
    assert.equal(state.players.p2.hp, 100); // no damage
    const hit = events.find(e => e.type === 'hit');
    assert.equal(hit.blocked, true);
    assert.equal(hit.damage, 0);
  });

  it('should be rejected when on cooldown', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'zap', 0);
    const events = tryCast(state, 'p1', 'zap', 500); // too soon
    const rej = events.find(e => e.type === 'rejected');
    assert.ok(rej);
    assert.equal(rej.reason, 'cooldown');
  });

  it('should work again after cooldown expires', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'zap', 0);
    const events = tryCast(state, 'p1', 'zap', 1600); // after 1.5s cooldown
    const hit = events.find(e => e.type === 'hit');
    assert.ok(hit);
  });

  it('should be rejected when not enough mana', () => {
    const state = setup(0);
    state.players.p1.mana = 0;
    state.players.p1.lastManaUpdate = 0;
    const events = tryCast(state, 'p1', 'zap', 0);
    const rej = events.find(e => e.type === 'rejected');
    assert.ok(rej);
    assert.equal(rej.reason, 'no_mana');
  });
});

// ─── Block ───

describe('block', () => {
  it('should last 1.5 seconds', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'block', 0);
    assert.ok(isBlocking(state.players.p1, 500));
    assert.ok(isBlocking(state.players.p1, 1400));
    assert.ok(!isBlocking(state.players.p1, 1600));
  });

  it('should cost 0 mana', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'block', 0);
    assert.equal(state.players.p1.mana, 5);
  });

  it('should have a cooldown of 4 seconds', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'block', 0);
    const events = tryCast(state, 'p1', 'block', 2000);
    const rej = events.find(e => e.type === 'rejected');
    assert.ok(rej);
    assert.equal(rej.reason, 'cooldown');
  });
});

// ─── Perfect Block ───

describe('perfect block', () => {
  it('should stun attacker when block starts within the window', () => {
    const state = setup(0);
    // p1 blocks at t=0, p1 gets zapped at t=100 (within 600ms window)
    tryCast(state, 'p1', 'block', 0);
    const events = tryCast(state, 'p2', 'zap', 100);
    const hit = events.find(e => e.type === 'hit');
    assert.equal(hit.perfect, true);
    assert.equal(hit.damage, 0);
    // p2 should be stunned
    const stun = events.find(e => e.type === 'stunned');
    assert.ok(stun);
    assert.equal(stun.player, 'p2');
    assert.ok(isStunned(state.players.p2, 200));
  });

  it('should NOT be perfect if block started too long ago', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'block', 0);
    // Zap at t=800, which is beyond the 600ms perfect window
    const events = tryCast(state, 'p2', 'zap', 800);
    const hit = events.find(e => e.type === 'hit');
    assert.equal(hit.blocked, true);
    assert.equal(hit.perfect, false);
    assert.equal(hit.damage, 0); // still blocked, just not perfect
  });
});

// ─── Stun ───

describe('stun', () => {
  it('should prevent casting while stunned', () => {
    const state = setup(0);
    state.players.p1.stunUntil = 1000;
    const events = tryCast(state, 'p1', 'zap', 500);
    const rej = events.find(e => e.type === 'rejected');
    assert.ok(rej);
    assert.equal(rej.reason, 'stunned');
  });

  it('should allow casting after stun expires', () => {
    const state = setup(0);
    state.players.p1.stunUntil = 1000;
    const events = tryCast(state, 'p1', 'zap', 1100);
    const hit = events.find(e => e.type === 'hit');
    assert.ok(hit);
  });
});

// ─── Fireball (wind-up) ───

describe('fireball', () => {
  it('should start a wind-up and not deal damage yet', () => {
    const state = setup(0);
    const events = tryCast(state, 'p1', 'fireball', 0);
    assert.equal(state.players.p2.hp, 100); // no damage yet
    const started = events.find(e => e.type === 'cast_started');
    assert.ok(started);
    assert.equal(started.spell, 'fireball');
    assert.equal(started.endsAt, 1500);
    assert.ok(state.players.p1.windUp);
  });

  it('should deal damage when wind-up resolves via tick', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'fireball', 0);
    const events = tick(state, 1500); // wind-up completes
    const hit = events.find(e => e.type === 'hit');
    assert.ok(hit);
    assert.equal(hit.damage, 18);
    assert.equal(state.players.p2.hp, 82);
  });

  it('should be blocked if opponent is blocking at resolve time', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'fireball', 0);
    tryCast(state, 'p2', 'block', 1000); // block before fireball lands
    const events = tick(state, 1500);
    const hit = events.find(e => e.type === 'hit');
    assert.equal(hit.blocked, true);
    assert.equal(hit.damage, 0);
  });

  it('should NOT be interruptible (Fireball survives a Zap)', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'fireball', 0);
    tryCast(state, 'p2', 'zap', 500); // zap the caster
    // Fireball is not interruptible, so wind-up continues
    assert.ok(state.players.p1.windUp);
    assert.equal(state.players.p1.windUp.spellId, 'fireball');
  });

  it('should reject when already winding up', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'fireball', 0);
    const events = tryCast(state, 'p1', 'fireball', 100);
    const rej = events.find(e => e.type === 'rejected');
    assert.ok(rej);
    assert.equal(rej.reason, 'already_casting');
  });

  it('should allow instant spells during wind-up', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'fireball', 0);
    // p1 should be able to block while fireball is winding up
    const events = tryCast(state, 'p1', 'block', 500);
    const blockEvent = events.find(e => e.type === 'block_started');
    assert.ok(blockEvent);
  });
});

// ─── Lightning ───

describe('lightning', () => {
  it('should ignore Block (unblockable)', () => {
    const state = setup(0);
    tryCast(state, 'p1', 'lightning', 0);
    tryCast(state, 'p2', 'block', 500);
    const events = tick(state, 1000);
    const hit = events.find(e => e.type === 'hit');
    assert.equal(hit.blocked, false);
    assert.equal(hit.damage, 7);
    assert.equal(state.players.p2.hp, 93);
  });
});

// ─── Heal ───

describe('heal', () => {
  it('should restore HP after wind-up completes', () => {
    const state = setup(0);
    state.players.p1.hp = 50;
    tryCast(state, 'p1', 'heal', 0);
    const events = tick(state, 2000);
    const healEvt = events.find(e => e.type === 'heal');
    assert.ok(healEvt);
    assert.equal(healEvt.amount, 20);
    assert.equal(state.players.p1.hp, 70);
  });

  it('should not heal above maxHp', () => {
    const state = setup(0);
    state.players.p1.hp = 95;
    tryCast(state, 'p1', 'heal', 0);
    tick(state, 2000);
    assert.equal(state.players.p1.hp, 100);
  });

  it('should be interrupted by taking damage', () => {
    const state = setup(0);
    state.players.p1.hp = 50;
    tryCast(state, 'p1', 'heal', 0);
    // p2 zaps p1 during wind-up
    const events = tryCast(state, 'p2', 'zap', 500);
    const cancel = events.find(e => e.type === 'cast_cancelled');
    assert.ok(cancel);
    assert.equal(cancel.spell, 'heal');
    assert.equal(cancel.reason, 'interrupted');
    assert.equal(state.players.p1.windUp, null);
  });
});

// ─── Ultimate ───

describe('ultimate', () => {
  it('should cost 10 mana (full bar)', () => {
    const state = setup(0);
    state.players.p1.mana = 10;
    state.players.p1.lastManaUpdate = 0;
    tryCast(state, 'p1', 'ultimate', 0);
    assert.equal(state.players.p1.mana, 0);
  });

  it('should be rejected with less than 10 mana', () => {
    const state = setup(0);
    // Starting mana is 5, not enough
    const events = tryCast(state, 'p1', 'ultimate', 0);
    const rej = events.find(e => e.type === 'rejected');
    assert.ok(rej);
    assert.equal(rej.reason, 'no_mana');
  });

  it('should deal 50 damage unblocked', () => {
    const state = setup(0);
    state.players.p1.mana = 10;
    state.players.p1.lastManaUpdate = 0;
    tryCast(state, 'p1', 'ultimate', 0);
    const events = tick(state, 3000);
    const hit = events.find(e => e.type === 'hit');
    assert.equal(hit.damage, 50);
    assert.equal(state.players.p2.hp, 50);
  });

  it('should deal chip damage (15) through a normal Block', () => {
    const state = setup(0);
    state.players.p1.mana = 10;
    state.players.p1.lastManaUpdate = 0;
    tryCast(state, 'p1', 'ultimate', 0);
    tryCast(state, 'p2', 'block', 2000); // block well before
    const events = tick(state, 3000);
    const hit = events.find(e => e.type === 'hit');
    assert.equal(hit.damage, 15);
    assert.equal(hit.blocked, true);
    assert.equal(hit.perfect, false);
    assert.equal(state.players.p2.hp, 85);
  });

  it('should deal 0 damage through a perfect Block and stun for 2s', () => {
    const state = setup(0);
    state.players.p1.mana = 10;
    state.players.p1.lastManaUpdate = 0;
    tryCast(state, 'p1', 'ultimate', 0);
    // p2 blocks just before impact (within 600ms window)
    tryCast(state, 'p2', 'block', 2500);
    const events = tick(state, 3000);
    const hit = events.find(e => e.type === 'hit');
    assert.equal(hit.damage, 0);
    assert.equal(hit.perfect, true);
    const stun = events.find(e => e.type === 'stunned');
    assert.ok(stun);
    assert.equal(stun.player, 'p1');
    assert.equal(stun.until, 3000 + PLAYER.ultimateStunDuration);
  });

  it('should reset opponent block cooldown when cast starts', () => {
    const state = setup(0);
    state.players.p1.mana = 10;
    state.players.p1.lastManaUpdate = 0;
    // p2 blocks first (putting it on cooldown)
    tryCast(state, 'p2', 'block', 0);
    assert.ok(state.players.p2.cooldowns.block > 0);
    // p1 casts ultimate — should reset p2's block cooldown
    tryCast(state, 'p1', 'ultimate', 100);
    assert.equal(state.players.p2.cooldowns.block, 0);
  });

  it('should be interruptible and refund 5 mana', () => {
    const state = setup(0);
    state.players.p1.mana = 10;
    state.players.p1.lastManaUpdate = 0;
    tryCast(state, 'p1', 'ultimate', 0);
    assert.equal(state.players.p1.mana, 0);
    // p2 zaps p1 during wind-up
    const events = tryCast(state, 'p2', 'zap', 1000);
    const cancel = events.find(e => e.type === 'cast_cancelled');
    assert.ok(cancel);
    assert.equal(cancel.reason, 'interrupted');
    assert.equal(state.players.p1.mana, 5); // refunded
  });
});

// ─── Sudden death ───

describe('sudden death', () => {
  it('should drain HP after 120 seconds', () => {
    const state = setup(0);
    // Tick at exactly 120s
    tick(state, 120000);
    // Each tick at 50ms drains 0.05 HP
    assert.ok(state.players.p1.hp < 100);
    assert.ok(state.players.p2.hp < 100);
  });

  it('should not drain HP before 120 seconds', () => {
    const state = setup(0);
    tick(state, 119999);
    assert.equal(state.players.p1.hp, 100);
  });
});

// ─── Win condition ───

describe('win condition', () => {
  it('should declare winner when opponent reaches 0 HP', () => {
    const state = setup(0);
    state.players.p2.hp = 3;
    tryCast(state, 'p1', 'zap', 0); // 4 damage kills
    const events = tick(state, 0);
    assert.equal(state.winner, 'p1');
    const end = events.find(e => e.type === 'match_end');
    assert.ok(end);
    assert.equal(end.winner, 'p1');
  });

  it('should not allow casts after match ends', () => {
    const state = setup(0);
    state.winner = 'p1';
    const events = tryCast(state, 'p2', 'zap', 0);
    const rej = events.find(e => e.type === 'rejected');
    assert.ok(rej);
    assert.equal(rej.reason, 'match_over');
  });
});

// ─── Snapshot ───

describe('getSnapshot', () => {
  it('should return HP, mana, and status for both players', () => {
    const state = setup(0);
    const snap = getSnapshot(state, 1000);
    assert.ok(snap.p1);
    assert.ok(snap.p2);
    assert.equal(snap.p1.hp, 100);
    assert.equal(snap.p1.mana, 6); // 5 + 1s regen
  });
});
