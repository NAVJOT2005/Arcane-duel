// ─── SPELL & PLAYER CONFIG ───
// All game balance numbers live here. Tune these, not the logic.
// Times are in milliseconds.

const SPELLS = {
  zap: {
    name: 'Zap',
    cost: 1,
    windUp: 0,          // instant
    cooldown: 1500,
    damage: 4,
    heal: 0,
    blockable: true,
    interruptible: false,
    instant: true,
    incantation: 'Zap!',
    aliases: ['zap', 'zapp', 'sap', 'zip', 'zep', 'cap']
  },
  block: {
    name: 'Block',
    cost: 0,
    windUp: 0,          // instant
    cooldown: 4000,
    damage: 0,
    heal: 0,
    duration: 1500,     // how long the shield lasts
    blockable: false,
    interruptible: false,
    instant: true,
    incantation: 'Nope!',
    aliases: ['nope', 'no', 'nop', 'know', 'nah', 'noup']
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
    incantation: 'Eat flames!',
    aliases: ['eat flames', 'it flames', 'eat flame', 'burn', 'born', 'bern', 'flames', 'eat flash']
  },
  lightning: {
    name: 'Lightning',
    cost: 3,
    windUp: 1000,
    cooldown: 0,
    damage: 7,
    heal: 0,
    blockable: false,   // ignores Block — counter to turtling
    interruptible: false,
    instant: false,
    incantation: 'Thunder strike!',
    aliases: ['thunder strike', 'thunderstrike', 'thunder strikes', 'under strike', 'thunder', 'thunder struck']
  },
  heal: {
    name: 'Heal',
    cost: 4,
    windUp: 2000,
    cooldown: 0,
    damage: 0,
    heal: 20,
    blockable: false,
    interruptible: true, // any unblocked damage cancels it
    instant: false,
    incantation: "Mom's soup!",
    aliases: ['moms soup', 'mums soup', 'mom soup', 'mama soup', "mom's soup", 'mum soup', 'mom so']
  },
  ultimate: {
    name: 'Ultimate',
    cost: 10,           // full mana
    windUp: 3000,
    cooldown: 0,
    damage: 50,
    heal: 0,
    chipDamage: 15,     // damage that goes through a normal Block
    blockable: true,    // but only partially (chip damage still applies)
    interruptible: true,
    instant: false,
    manaRefund: 5,      // refunded if interrupted
    incantation: 'Final explosion!',
    aliases: ['final explosion', 'ultimate explosion', 'ultimate final explosion', 'final expo', 'vinyl explosion']
  }
};

const PLAYER = {
  maxHp: 100,
  maxMana: 10,
  startMana: 5,
  manaRegen: 1,           // per second
  lowHpThreshold: 30,     // below this HP, regen increases
  lowHpManaRegen: 1.5,    // regen rate when low HP
  perfectBlockWindow: 600,// ms before hit: block started in this window = perfect
  stunDuration: 1000,     // ms stunned after perfect block
  ultimateStunDuration: 2000, // ms stunned after perfect-blocking an Ultimate
  suddenDeathTime: 120000,// ms before sudden death kicks in
  suddenDeathDps: 1       // HP lost per second during sudden death
};

// Don't let people add 'tap' as a zap alias — it would conflict with tap input
// The matcher should check longer aliases first to avoid partial matches.

if (typeof module !== 'undefined') {
  module.exports = { SPELLS, PLAYER };
}
