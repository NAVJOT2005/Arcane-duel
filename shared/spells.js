// ─── SPELLS & MAGE CLASSES CONFIG ───
// All numbers, costs, damages, cooldowns, and class definitions live here.

const CLASSES = {
  fire: {
    name: 'Fire Mage',
    element: 'fire',
    robe: [96, 22, 36],
    trim: [218, 172, 76],
    hood: [64, 14, 26],
    crystalGlow: '242, 140, 50',
    crystalHex: 0xf2a541,
    spells: ['fire_spark', 'block', 'fireball', 'heal', 'inferno_nova'],
    desc: 'High burst damage. 3 Sparks ignite enemies for burn damage over time.'
  },
  frost: {
    name: 'Frost Mage',
    element: 'frost',
    robe: [26, 48, 92],
    trim: [170, 214, 232],
    hood: [18, 34, 68],
    crystalGlow: '90, 214, 232',
    crystalHex: 0x5ad6e8,
    spells: ['ice_shard', 'block', 'blizzard_spear', 'heal', 'absolute_zero'],
    desc: 'Control & disruption. 3 Shards chill enemies to halve their mana regen.'
  },
  lightning: {
    name: 'Lightning Mage',
    element: 'lightning',
    robe: [48, 22, 88],
    trim: [238, 214, 90],
    hood: [32, 14, 60],
    crystalGlow: '245, 220, 60',
    crystalHex: 0xf5dc3c,
    spells: ['zap', 'block', 'thunder_strike', 'heal', 'judgment_bolt'],
    desc: 'Rapid strikes & piercing. 3 Zaps drain 1 enemy mana. Thunder Strike bypasses block.'
  },
  earth: {
    name: 'Earth Mage',
    element: 'earth',
    robe: [36, 58, 32],
    trim: [180, 148, 96],
    hood: [24, 40, 20],
    crystalGlow: '110, 210, 80',
    crystalHex: 0x6ed250,
    spells: ['pebble_shot', 'block', 'boulder_smash', 'heal', 'cataclysm'],
    desc: 'Sturdy fortress. 3 Pebbles cause tremors (+0.8s cooldown on enemy next spell).'
  },
  dark: {
    name: 'Dark Mage',
    element: 'dark',
    robe: [20, 16, 32],
    trim: [168, 85, 247],
    hood: [12, 10, 22],
    crystalGlow: '168, 85, 247',
    crystalHex: 0xa855f7,
    spells: ['shadow_dart', 'block', 'soul_drain', 'heal', 'abyssal_void'],
    desc: 'Cursed sorcery. 3 Darts inflict Eclipse Blindness. Soul Drain steals 6 HP.'
  }
};

const SPELLS = {
  // ─── Universal Spells (All classes) ───
  block: {
    name: 'Block',
    cost: 0,
    windUp: 0,
    cooldown: 4000,
    damage: 0,
    heal: 0,
    duration: 1500,
    blockable: false,
    interruptible: false,
    instant: true,
    element: 'arcane',
    incantation: 'Nope!',
    aliases: ['nope', 'no', 'nop', 'know', 'nah', 'noup', 'shield', 'sheeld', 'sheild', 'shild', 'not today', 'block', 'blok', 'blck', 'guard', 'defend', 'parry', 'lock', 'plock', 'block it', 'put up shield']
  },
  heal: {
    name: 'Heal',
    cost: 4,
    windUp: 2000,
    cooldown: 10000, // 10s cooldown to prevent dragging out matches
    damage: 0,
    heal: 20,
    blockable: false,
    interruptible: true, // interrupted by unblocked hits
    instant: false,
    element: 'arcane',
    incantation: 'Patch me up!',
    aliases: ['patch me up', 'not dead yet', 'patch me', 'rub some dirt on it', 'heal', 'heel', 'hil', 'hill', 'medic', 'bandaid', 'fix me', 'cure', 'recover', 'healing', 'heal me', 'help me']
  },

  // ─── Fire Mage Spells ───
  fire_spark: {
    name: 'Spark',
    cost: 1,
    windUp: 0,
    cooldown: 1500,
    damage: 4,
    heal: 0,
    blockable: true,
    interruptible: false,
    instant: true,
    element: 'fire',
    incantation: 'Spit hot!',
    aliases: ['spit hot', 'sparks', 'spark', 'sparc', 'spit fire', 'hot spark', 'fire spark', 'park', 'bark', 'spit out', 'spark shot']
  },
  fireball: {
    name: 'Fireball',
    cost: 3,
    windUp: 1500,
    cooldown: 0,
    damage: 18,
    heal: 0,
    blockable: true,
    interruptible: false,
    instant: false,
    element: 'fire',
    incantation: 'Eat flames!',
    aliases: ['eat flames', 'it flames', 'eat flame', 'burn', 'born', 'bern', 'flames', 'fireball', 'fire ball', 'fire bol', 'firebol', 'fire boll', 'flame ball', 'throw fire', 'eat the flames', 'heat flames', 'fire bowl']
  },
  inferno_nova: {
    name: 'Inferno Nova',
    cost: 10,
    windUp: 3000,
    cooldown: 0,
    damage: 50,
    chipDamage: 15,
    heal: 0,
    blockable: true,
    interruptible: true,
    instant: false,
    manaRefund: 5,
    element: 'fire',
    incantation: 'Supernova boom!',
    aliases: ['supernova boom', 'supernova', 'inferno nova', 'nova boom', 'final explosion', 'ultimate explosion', 'inferno', 'nova', 'super nova', 'super nova boom', 'inferno boom', 'inner nova']
  },

  // ─── Frost Mage Spells ───
  ice_shard: {
    name: 'Ice Shard',
    cost: 1,
    windUp: 0,
    cooldown: 1500,
    damage: 4,
    heal: 0,
    blockable: true,
    interruptible: false,
    instant: true,
    element: 'frost',
    incantation: 'Brain freeze!',
    aliases: ['brain freeze', 'ice shard', 'freeze shard', 'shard', 'shards', 'ice shards', 'cold shard', 'brain froze', 'ice shards']
  },
  blizzard_spear: {
    name: 'Blizzard Spear',
    cost: 3,
    windUp: 1500,
    cooldown: 0,
    // 20, not 16: at 16 the spear needed six clean hits to close a 100 HP
    // match against fire's five, which is why Frost sat at ~30% in simulation.
    damage: 20,
    heal: 0,
    blockable: true,
    interruptible: false,
    instant: false,
    element: 'frost',
    incantation: 'Chill out!',
    aliases: ['chill out', 'chill', 'chill it', 'freeze', 'freze', 'feeze', 'blizzard spear', 'blizzard', 'frost spear', 'cold snap', 'spear', 'speer', 'frost', 'ice spear']
  },
  absolute_zero: {
    name: 'Absolute Zero',
    cost: 10,
    windUp: 3000,
    cooldown: 0,
    damage: 50,
    chipDamage: 15,
    heal: 0,
    blockable: true,
    interruptible: true,
    instant: false,
    manaRefund: 5,
    element: 'frost',
    incantation: 'Sub zero slam!',
    aliases: ['sub zero slam', 'sub zero', 'absolute zero', 'zero slam', 'deep freeze', 'zero', 'subzero slam', 'super zero slam']
  },

  // ─── Lightning Mage Spells ───
  zap: {
    name: 'Zap',
    cost: 1,
    windUp: 0,
    cooldown: 1500,
    damage: 4,
    heal: 0,
    blockable: true,
    interruptible: false,
    instant: true,
    element: 'lightning',
    incantation: 'Buzz off!',
    aliases: ['buzz off', 'buzz', 'buzz out', 'zap', 'zapp', 'sap', 'zip', 'zep', 'jap', 'shock', 'shok', 'lightning', 'spark', 'zapped']
  },
  thunder_strike: {
    name: 'Thunder Strike',
    cost: 3,
    windUp: 1000,
    cooldown: 0,
    damage: 14,
    heal: 0,
    blockable: false, // Ignores block
    // Interruptible: an unblockable 14 damage spell that also ignored the
    // interrupt loop had no counterplay at all. It still ignores Block, but a
    // hit during the wind-up now cancels it (and refunds nothing).
    interruptible: true,
    instant: false,
    element: 'lightning',
    incantation: 'Shock therapy!',
    aliases: ['shock therapy', 'shock the rapy', 'thunder strike', 'thunderstrike', 'thunder strikes', 'thunder', 'thunder struck', 'strike', 'thunderstruck', 'shock strike']
  },
  judgment_bolt: {
    name: 'Judgment Bolt',
    cost: 10,
    windUp: 3000,
    cooldown: 0,
    damage: 50,
    chipDamage: 15,
    heal: 0,
    blockable: true,
    interruptible: true,
    instant: false,
    manaRefund: 5,
    element: 'lightning',
    incantation: 'Smite them!',
    aliases: ['smite them', 'smite him', 'smite', 'judgment bolt', 'judgement bolt', 'heavenly smite', 'judgment', 'judgement', 'bolt', 'smite the bolt']
  },

  // ─── Earth Mage Spells ───
  pebble_shot: {
    name: 'Pebble Shot',
    cost: 1,
    windUp: 0,
    cooldown: 1500,
    damage: 4,
    heal: 0,
    blockable: true,
    interruptible: false,
    instant: true,
    element: 'earth',
    incantation: 'Rock on!',
    aliases: ['rock on', 'rock one', 'rock won', 'pebble shot', 'pebble', 'pebbles', 'rock shot', 'pebble shoot']
  },
  boulder_smash: {
    name: 'Boulder Smash',
    cost: 3,
    windUp: 1500,
    cooldown: 0,
    // 17, not 18: Boulder also grants +8 Stone Armor per unblocked hit, so it
    // was strictly the best 3-mana signature and Earth led every matrix.
    damage: 17,
    heal: 0,
    blockable: true,
    interruptible: false,
    instant: false,
    element: 'earth',
    incantation: 'Eat dirt!',
    aliases: ['eat dirt', 'eat the dirt', 'heavy rock', 'boulder smash', 'bolder smash', 'boulder', 'rock smash', 'smash', 'eat dirt now']
  },
  cataclysm: {
    name: 'Cataclysm',
    cost: 10,
    windUp: 3000,
    cooldown: 0,
    damage: 50,
    chipDamage: 15,
    heal: 0,
    blockable: true,
    interruptible: true,
    instant: false,
    manaRefund: 5,
    element: 'earth',
    incantation: 'Terra quake!',
    aliases: ['terra quake', 'terra quakes', 'cataclysm', 'earthquake', 'ground slam', 'earth quake', 'quake', 'terra', 'terror quake']
  },

  // ─── Dark Mage Spells ───
  shadow_dart: {
    name: 'Shadow Dart',
    cost: 1,
    windUp: 0,
    cooldown: 1500,
    damage: 4,
    heal: 0,
    blockable: true,
    interruptible: false,
    instant: true,
    element: 'dark',
    incantation: 'Begone!',
    aliases: ['begone', 'shadow dart', 'be gone', 'be gone now', 'dark dart', 'dart', 'darts']
  },
  soul_drain: {
    name: 'Soul Drain',
    cost: 3,
    windUp: 1500,
    cooldown: 0,
    damage: 14,
    lifesteal: 6, // Heals caster for 6 HP on hit
    heal: 0,
    blockable: true,
    interruptible: false,
    instant: false,
    element: 'dark',
    incantation: 'Darkness rise!',
    aliases: ['darkness rise', 'darkness rises', 'soul drain', 'drain soul', 'darkness', 'darkness rize', 'drain', 'soul']
  },
  abyssal_void: {
    name: 'Abyssal Void',
    cost: 10,
    windUp: 3000,
    cooldown: 0,
    damage: 50,
    chipDamage: 15,
    heal: 0,
    blockable: true,
    interruptible: true,
    instant: false,
    manaRefund: 5,
    element: 'dark',
    incantation: 'Black hole plunge!',
    aliases: ['black hole plunge', 'black hole', 'abyssal void', 'void plunge', 'abyss', 'void', 'blackhole plunge', 'black hole lunch', 'abyssal boyd']
  }
};

const PLAYER = {
  maxHp: 100,
  maxMana: 10,
  startMana: 5,
  manaRegen: 1,
  lowHpThreshold: 30,
  lowHpManaRegen: 1.5,
  perfectBlockWindow: 600,
  stunDuration: 1000,
  ultimateStunDuration: 2000,
  suddenDeathTime: 120000,
  suddenDeathDps: 1
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CLASSES, SPELLS, PLAYER };
}
if (typeof window !== 'undefined') {
  window.CLASSES = CLASSES;
  window.SPELLS = SPELLS;
  window.PLAYER = PLAYER;
}
