const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { matchSpell, cleanText, levenshtein } = require('../shared/matcher');

describe('cleanText', () => {
  it('should lowercase, strip punctuation, and trim whitespace', () => {
    assert.equal(cleanText('  Eat FLAMES!!! '), 'eat flames');
    assert.equal(cleanText("Patch me up?"), 'patch me up');
    assert.equal(cleanText('Zap! 123'), 'zap 123');
  });
});

describe('levenshtein', () => {
  it('should calculate edit distance correctly', () => {
    assert.equal(levenshtein('zap', 'zap'), 0);
    assert.equal(levenshtein('zap', 'zapp'), 1);
    assert.equal(levenshtein('burn', 'born'), 1);
    assert.equal(levenshtein('nope', 'hope'), 1);
    assert.equal(levenshtein('nope', 'xyz'), 4);
  });
});

describe('matchSpell', () => {
  it('should match primary incantations across classes', () => {
    assert.equal(matchSpell('Nope!'), 'block');
    assert.equal(matchSpell('Patch me up!'), 'heal');
    assert.equal(matchSpell('Spit hot!'), 'fire_spark');
    assert.equal(matchSpell('Eat flames!'), 'fireball');
    assert.equal(matchSpell('Supernova boom!'), 'inferno_nova');
    assert.equal(matchSpell('Brain freeze!'), 'ice_shard');
    assert.equal(matchSpell('Chill out!'), 'blizzard_spear');
    assert.equal(matchSpell('Buzz off!'), 'zap');
    assert.equal(matchSpell('Shock therapy!'), 'thunder_strike');
    assert.equal(matchSpell('Rock on!'), 'pebble_shot');
    assert.equal(matchSpell('Eat dirt!'), 'boulder_smash');
    assert.equal(matchSpell('Begone!'), 'shadow_dart');
    assert.equal(matchSpell('Darkness rise!'), 'soul_drain');
  });

  it('should match aliases and common mishearings', () => {
    assert.equal(matchSpell('burn'), 'fireball');
    assert.equal(matchSpell('freeze'), 'blizzard_spear');
    assert.equal(matchSpell('medic'), 'heal');
    assert.equal(matchSpell('rub some dirt on it'), 'heal');
    assert.equal(matchSpell('supernova'), 'inferno_nova');
  });

  it('should match each spell by its official spell name', () => {
    const { SPELLS } = require('../shared/spells');
    for (const [sid, s] of Object.entries(SPELLS)) {
      assert.equal(matchSpell(s.name), sid, `Spell name "${s.name}" should match ${sid}`);
    }
  });

  it('should respect player available kit filtering', () => {
    // If frost mage says 'burn', it shouldn't match fireball if only frost spells available
    const frostKit = ['ice_shard', 'block', 'blizzard_spear', 'heal', 'absolute_zero'];
    assert.equal(matchSpell('burn', frostKit), null);
    assert.equal(matchSpell('chill out', frostKit), 'blizzard_spear');
  });
});
