// ─── SPELL MATCHER ───
// Dependency-free text matching for voice & typed incantations.
// Works in both Node.js and Browser environments.

const SPELL_ALIASES = {
  zap: [
    'zap', 'zapp', 'sap', 'zip', 'zep', 'cap', 'tap'
  ],
  block: [
    'nope', 'no', 'nop', 'know', 'nah', 'noup', 'shield', 'not today', 'block'
  ],
  fireball: [
    'eat flames', 'it flames', 'eat flame', 'burn', 'born', 'bern', 'flames', 'eat flash',
    'fireball', 'fire ball', 'flame', 'heat'
  ],
  lightning: [
    'thunder strike', 'thunderstrike', 'thunder strikes', 'under strike', 'thunder',
    'thunder struck', 'lightning', 'lightening', 'strike', 'shock'
  ],
  heal: [
    'moms soup', 'mums soup', 'mom soup', 'mama soup', "mom's soup", 'mum soup',
    'mom so', 'heal', 'soup', 'cure', 'restore'
  ],
  ultimate: [
    'final explosion', 'ultimate explosion', 'ultimate final explosion', 'final expo',
    'vinyl explosion', 'ultimate', 'explosion', 'kamehameha'
  ]
};

// Clean incoming speech text: lowercase, remove special characters, collapse whitespace
function cleanText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Compute simple Levenshtein distance for fuzzy typo tolerance on short words
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

// Match input text against spell aliases
// 1. Direct phrase inclusion (checking longer aliases first)
// 2. Word-by-word fuzzy match with 1 typo tolerance
function matchSpell(text) {
  const clean = cleanText(text);
  if (!clean) return null;

  // Flatten aliases with length sorting (longest alias first so 'eat flames' matches before 'flame')
  const allEntries = [];
  for (const [spellId, aliases] of Object.entries(SPELL_ALIASES)) {
    for (const alias of aliases) {
      allEntries.push({ spellId, alias: cleanText(alias) });
    }
  }
  allEntries.sort((a, b) => b.alias.length - a.alias.length);

  // Exact / substring check
  for (const entry of allEntries) {
    if (clean.includes(entry.alias)) {
      return entry.spellId;
    }
  }

  // Token fuzzy check (e.g., if heard word has 1 character transposition or typo)
  const words = clean.split(' ');
  for (const word of words) {
    if (word.length < 3) continue;
    for (const entry of allEntries) {
      // Only single-word aliases qualify for 1-distance fuzzy matching
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
  module.exports = { matchSpell, cleanText, levenshtein, SPELL_ALIASES };
}
if (typeof window !== 'undefined') {
  window.matchSpell = matchSpell;
  window.cleanText = cleanText;
  window.SPELL_ALIASES = SPELL_ALIASES;
}
