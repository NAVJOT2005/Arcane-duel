const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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
  it('should load in a browser after the spell definitions script', () => {
    const context = vm.createContext({ window: {} });
    for (const file of ['shared/spells.js', 'shared/matcher.js']) {
      vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    }
    assert.equal(context.window.matchSpell('Spit hot!', context.window.CLASSES.fire.spells), 'fire_spark');
  });

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

    const { CLASSES } = require('../shared/spells');
    const voiceMishearings = {
      fire: [['heat flames', 'fireball'], ['super nova boom', 'inferno_nova']],
      frost: [['chill', 'blizzard_spear'], ['subzero slam', 'absolute_zero']],
      lightning: [['shock strike', 'thunder_strike'], ['smite him', 'judgment_bolt']],
      earth: [['rock one', 'pebble_shot'], ['terror quake', 'cataclysm']],
      dark: [['dark dart', 'shadow_dart'], ['darkness rize', 'soul_drain'], ['black hole lunch', 'abyssal_void']]
    };
    for (const [mage, phrases] of Object.entries(voiceMishearings)) {
      for (const [phrase, expectedSpell] of phrases) {
        assert.equal(matchSpell(phrase, CLASSES[mage].spells), expectedSpell, `${mage} transcript "${phrase}"`);
      }
    }
  });

  it('should match each spell by its official spell name', () => {
    const { SPELLS } = require('../shared/spells');
    for (const [sid, s] of Object.entries(SPELLS)) {
      assert.equal(matchSpell(s.name), sid, `Spell name "${s.name}" should match ${sid}`);
    }
  });

  it('should not match partial fragments or reverse containment', () => {
    // Single letter "e" or fragments like "thun", "on" should NEVER trigger spells
    assert.equal(matchSpell('e'), null);
    assert.equal(matchSpell('thun'), null);
    assert.equal(matchSpell('on'), null);
    assert.equal(matchSpell('fi'), null);
    // "shock" must match zap/thunder_strike aliases, NOT block
    assert.notEqual(matchSpell('shock'), 'block');
    assert.equal(matchSpell('shock'), 'zap');
  });

  it('should respect player available kit filtering', () => {
    // If frost mage says 'burn', it shouldn't match fireball if only frost spells available
    const frostKit = ['ice_shard', 'block', 'blizzard_spear', 'heal', 'absolute_zero'];
    assert.equal(matchSpell('burn', frostKit), null);
    assert.equal(matchSpell('chill out', frostKit), 'blizzard_spear');
  });
});
