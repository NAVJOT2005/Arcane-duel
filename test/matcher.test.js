const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { matchSpell, cleanText, levenshtein } = require('../shared/matcher');

describe('cleanText', () => {
  it('should lowercase, strip punctuation, and trim whitespace', () => {
    assert.equal(cleanText('  Eat FLAMES!!! '), 'eat flames');
    assert.equal(cleanText("Mom's soup?"), 'mom s soup');
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
  it('should match primary incantations', () => {
    assert.equal(matchSpell('Zap!'), 'zap');
    assert.equal(matchSpell('Nope!'), 'block');
    assert.equal(matchSpell('Eat flames!'), 'fireball');
    assert.equal(matchSpell('Thunder strike!'), 'lightning');
    assert.equal(matchSpell("Mom's soup!"), 'heal');
    assert.equal(matchSpell('Final explosion!'), 'ultimate');
  });

  it('should match known aliases and common mishearings', () => {
    assert.equal(matchSpell('zapp'), 'zap');
    assert.equal(matchSpell('nah'), 'block');
    assert.equal(matchSpell('burn'), 'fireball');
    assert.equal(matchSpell('thunderstruck'), 'lightning');
    assert.equal(matchSpell('moms soup'), 'heal');
    assert.equal(matchSpell('ultimate explosion'), 'ultimate');
  });

  it('should tolerate surrounding words or exclamation', () => {
    assert.equal(matchSpell('I shout eat flames right now'), 'fireball');
    assert.equal(matchSpell('please nope please'), 'block');
    assert.equal(matchSpell('ready thunder strike go'), 'lightning');
  });

  it('should tolerate 1-typo on single words', () => {
    assert.equal(matchSpell('zep'), 'zap');
    assert.equal(matchSpell('bern'), 'fireball');
  });

  it('should return null for unrelated speech', () => {
    assert.equal(matchSpell('hello world'), null);
    assert.equal(matchSpell('what is the weather today'), null);
    assert.equal(matchSpell(''), null);
  });
});
