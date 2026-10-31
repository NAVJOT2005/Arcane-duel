// ─── SPELL MATCHER ───
// Dependency-free text matching for voice & typed incantations.
// Works in both Node.js and Browser environments.

const MATCHER_SPELLS = (typeof require !== 'undefined') ? require('./spells').SPELLS : (typeof window !== 'undefined' ? window.SPELLS : {});

function cleanText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = [];
  for (let i = 0; i <= b.length; i++) row[i] = i;

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      let val;
      if (a[i - 1] === b[j - 1]) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

// Build alias list automatically from SPELLS dictionary
function getSpellAliasEntries(spellsDict) {
  const dict = spellsDict || MATCHER_SPELLS;
  const entries = [];
  for (const [spellId, spell] of Object.entries(dict)) {
    if (spell.name) {
      entries.push({ spellId, alias: cleanText(spell.name) });
    }
    if (spell.incantation) {
      entries.push({ spellId, alias: cleanText(spell.incantation) });
    }
    if (Array.isArray(spell.aliases)) {
      for (const a of spell.aliases) {
        entries.push({ spellId, alias: cleanText(a) });
      }
    }
  }
  // Remove duplicates and sort longest aliases first
  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const key = e.spellId + ':' + e.alias;
    if (!seen.has(key) && e.alias) {
      seen.add(key);
      unique.push(e);
    }
  }
  unique.sort((a, b) => b.alias.length - a.alias.length);
  return unique;
}

function matchSpell(text, availableSpells) {
  const clean = cleanText(text);
  if (!clean) return null;

  const entries = getSpellAliasEntries(MATCHER_SPELLS);

  // Filter by player's active spell kit if provided
  const validEntries = availableSpells && availableSpells.length
    ? entries.filter(e => availableSpells.includes(e.spellId))
    : entries;

  // 1. Exact or Substring match
  // Whole-word match only: "no" must not match inside "know"/"snow".
  const padded = ' ' + clean + ' ';
  for (const entry of validEntries) {
    if (padded.includes(' ' + entry.alias + ' ')) {
      return entry.spellId;
    }
  }

  // 1b. Space-stripped match (e.g. "fire ball" -> "fireball", "ice shard" -> "iceshard")
  const cleanNoSpaces = clean.replace(/\s+/g, '');
  for (const entry of validEntries) {
    const aliasNoSpaces = entry.alias.replace(/\s+/g, '');
    // One direction only: heard text must CONTAIN the alias. The old reverse check
    // (alias contains heard) made fragments like "e" or "thun" cast spells.
    if (aliasNoSpaces.length >= 4 && cleanNoSpaces.includes(aliasNoSpaces)) {
      return entry.spellId;
    }
  }

  // 2. Stemmed token match (e.g. "blocking" -> "block", "healing" -> "heal", "sparks" -> "spark")
  const stem = w => w.replace(/(ing|ed|es|s)$/, '');
  const words = clean.split(' ');
  for (const word of words) {
    if (word.length < 3) continue;
    const ws = stem(word);
    for (const entry of validEntries) {
      if (!entry.alias.includes(' ')) {
        const es = stem(entry.alias);
        if (ws === es) {
          return entry.spellId;
        }
      }
    }
  }

  // 3. Adaptive fuzzy match token with typo tolerance (dist <= 2 for words >= 5 chars, dist <= 1 for >= 3)
  for (const word of words) {
    if (word.length < 3) continue;
    const ws = stem(word);
    for (const entry of validEntries) {
      if (!entry.alias.includes(' ')) {
        const es = stem(entry.alias);
        // Strict typo budget: short words must be (almost) exact, otherwise "shock"~"block", "tap"~"zap".
        // Real mishearings belong in the spell's aliases list, not in loose fuzzing.
        const L = entry.alias.length;
        const maxDist = L <= 3 ? 0 : (L < 8 ? 1 : 2);
        if (levenshtein(word, entry.alias) <= maxDist || levenshtein(ws, es) <= maxDist) {
          return entry.spellId;
        }
      }
    }
  }

  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { matchSpell, cleanText, levenshtein, getSpellAliasEntries };
}
if (typeof window !== 'undefined') {
  window.matchSpell = matchSpell;
  window.cleanText = cleanText;
  window.getSpellAliasEntries = getSpellAliasEntries;
}
