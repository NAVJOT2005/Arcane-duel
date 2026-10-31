const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createMatch, getMana, canCast, tryCast, tick,
  isStunned, isBlocking, getSnapshot
} = require('../shared/rules');
const { SPELLS, PLAYER, CLASSES } = require('../shared/spells');

function setup(now = 1000, c1 = 'fire', c2 = 'frost') {
  return createMatch('p1', 'p2', now, c1, c2);
}

describe('createMatch & Classes', () => {
  it('should initialize players with chosen mage classes and their 5 spells', () => {
    const state = setup(0, 'fire', 'dark');
    assert.equal(state.players.p1.class, 'fire');
    assert.equal(state.players.p1.spells.length, 5);
    assert.ok(state.players.p1.spells.includes('fireball'));
    assert.ok(state.players.p1.spells.includes('heal'));
    assert.ok(state.players.p1.spells.includes('block'));

    assert.equal(state.players.p2.class, 'dark');
    assert.ok(state.players.p2.spells.includes('shadow_dart'));
    assert.ok(state.players.p2.spells.includes('soul_drain'));
  });

  it('should reject casting a spell not belonging to that class kit', () => {
    const state = setup(0, 'fire', 'frost');
    // p1 is fire mage, shouldn't be able to cast ice_shard
    const events = tryCast(state, 'p1', 'ice_shard', 0);
    assert.equal(events[0].type, 'rejected');
    assert.equal(events[0].reason, 'spell_not_in_kit');
  });
});

describe('Heal Cooldown (Nerf verification)', () => {
  it('should enforce 10s cooldown on Heal', () => {
    const state = setup(0, 'fire', 'frost');
    state.players.p1.hp = 50;
    tryCast(state, 'p1', 'heal', 0);
    // tick to complete 2s windup
    tick(state, 2000);
    assert.equal(state.players.p1.hp, 70);

    // Try casting heal again at 5s (before 10s cd expires)
    const events = tryCast(state, 'p1', 'heal', 5000);
    assert.equal(events[0].type, 'rejected');
    assert.equal(events[0].reason, 'cooldown');

    // After 10s from cast (t=10500)
    state.players.p1.mana = 10;
    state.players.p1.lastManaUpdate = 10500;
    const okEvents = tryCast(state, 'p1', 'heal', 10500);
    assert.equal(okEvents[0].type, 'cast_started');
  });
});

describe('Class Status Effects', () => {
  it('Fire Mage: 3 Sparks trigger Ignite burn status', () => {
    const state = setup(0, 'fire', 'frost');
    tryCast(state, 'p1', 'fire_spark', 0);
    tryCast(state, 'p1', 'fire_spark', 1600);
    const evs3 = tryCast(state, 'p1', 'fire_spark', 3200);
    const burn = evs3.find(e => e.type === 'status_applied' && e.status === 'burn');
    assert.ok(burn);
    assert.ok(state.players.p2.burnUntil > 3200);

    // Verify burn ticks
    const tickEvs = tick(state, 4000);
    const tickDmg = tickEvs.find(e => e.type === 'burn_tick');
    assert.ok(tickDmg);
  });

  it('Frost Mage: 3 Ice Shards trigger Chilled status halving mana regen', () => {
    const state = setup(0, 'frost', 'fire');
    tryCast(state, 'p1', 'ice_shard', 0);
    tryCast(state, 'p1', 'ice_shard', 1600);
    const evs3 = tryCast(state, 'p1', 'ice_shard', 3200);
    const chill = evs3.find(e => e.type === 'status_applied' && e.status === 'chill');
    assert.ok(chill);

    // Target mana regen should be 0.5 per sec instead of 1.0
    state.players.p2.mana = 0;
    state.players.p2.lastManaUpdate = 3200;
    const manaAfter1s = getMana(state.players.p2, 4200);
    assert.equal(manaAfter1s, 0.5);
  });

  it('Dark Mage: Soul Drain damages and heals caster for 6 HP', () => {
    const state = setup(0, 'dark', 'fire');
    state.players.p1.hp = 80;
    tryCast(state, 'p1', 'soul_drain', 0);
    const evs = tick(state, 1500);
    const healEv = evs.find(e => e.type === 'heal' && e.player === 'p1');
    assert.ok(healEv);
    assert.equal(healEv.amount, 6);
    assert.equal(state.players.p1.hp, 86);
  });

  it('Dark Mage: 3 Shadow Darts blind opponent only, not the caster', () => {
    const state = setup(0, 'dark', 'fire');
    tryCast(state, 'p1', 'shadow_dart', 0);
    tryCast(state, 'p1', 'shadow_dart', 1600);
    const evs3 = tryCast(state, 'p1', 'shadow_dart', 3200);
    const blindEv = evs3.find(e => e.type === 'status_applied' && e.status === 'blind');
    assert.ok(blindEv, 'Should emit status_applied blind event');
    assert.equal(blindEv.player, 'p2', 'Blind status must target opponent p2, not caster p1');
    assert.ok(state.players.p2.blindUntil > 3200, 'Opponent p2 should have blind timer set');
    assert.equal(state.players.p1.blindUntil, 0, 'Caster p1 should NOT have blind timer set');

    const snap = getSnapshot(state, 3500);
    assert.equal(snap.p2.status.blind, true, 'Opponent status should show blind: true');
    assert.equal(snap.p1.status.blind, false, 'Caster status should show blind: false');
  });

  it('Earth Mage: Boulder Smash grants Stone Armor barrier', () => {
    const state = setup(0, 'earth', 'fire');
    tryCast(state, 'p1', 'boulder_smash', 0);
    tick(state, 1500);
    assert.equal(state.players.p1.stoneArmor, 8);

    // Opponent hits for 4 damage -> should be absorbed by stone armor
    const hitEvs = tryCast(state, 'p2', 'fire_spark', 2000);
    const armorEv = hitEvs.find(e => e.type === 'armor_absorbed');
    assert.ok(armorEv);
    assert.equal(armorEv.amount, 4);
    assert.equal(state.players.p1.hp, 100); // No HP lost
    assert.equal(state.players.p1.stoneArmor, 4);
  });
});
