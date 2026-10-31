// ─── SPELL MATCHER ───
// Dependency-free text matching for voice & typed incantations.
// Works in both Node.js and Browser environments.

const { SPELLS } = require ? require('./spells') : window;

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
  const dict = spellsDict || (typeof SPELLS !== 'undefined' ? SPELLS : {});
  const entries = [];
  for (const [spellId, spell] of Object.entries(dict)) {
    if (spell.incantation) {
      entries.push({ spellId, alias: cleanText(spell.incantation) });
    }
    if (Array.isArray(spell.aliases)) {
      for (const a of spell.aliases) {
        entries.push({ spellId, alias: cleanText(a) });
      }
    }
  }
  // Sort longest aliases first
  entries.sort((a, b) => b.alias.length - a.alias.length);
  return entries;
}

function matchSpell(text, availableSpells) {
  const clean = cleanText(text);
  if (!clean) return null;

  const entries = getSpellAliasEntries(typeof SPELLS !== 'undefined' ? SPELLS : null);

  // Filter by player's active spell kit if provided
  const validEntries = availableSpells && availableSpells.length
    ? entries.filter(e => availableSpells.includes(e.spellId))
    : entries;

  // 1. Exact or Substring match
  for (const entry of validEntries) {
    if (clean.includes(entry.alias)) {
      return entry.spellId;
    }
  }

  // 2. Fuzzy match token with 1 typo tolerance
  const words = clean.split(' ');
  for (const word of words) {
    if (word.length < 3) continue;
    for (const entry of validEntries) {
      if (!entry.alias.includes(' ')) {
        const dist = levenshtein(word, entry.alias);
        if (dist <= 1) {
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
