# Audio credits

Every file in this folder comes from a free-licensed pack. Nothing here was paid
for and nothing requires an account to re-download.

| File | Original sound | Source | Author | Licence |
|---|---|---|---|---|
| `charge_fire` | `Loop_Fantasy SFX Pack Vol 1_Fireball_Hold` | [JC Sounds – Fantasy SFX Pack Vol 1](https://opengameart.org/content/jc-sounds-fantasy-sfx-pack-vol-1) | JC Sounds | **CC BY 4.0** |
| `charge_frost` | `Loop_..._Ice Spell_Hold` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `charge_bolt` | `Loop_..._Electric Spell_Hold` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `charge_dark` | `Loop_Fantasy Pack Vol 1_Dark Necromancy Chant_01` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `hit_fire` | `Single_..._Fireball Impact_01` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `hit_frost` | `Single_..._Ice Shard  Projectile_Impact_01` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `hit_bolt` | `Single_..._Electric Spell_Hit_01` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `launch_fire` | `Single_..._Fireball Launch_01` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `launch_frost` | `Single_..._Ice Shard Projectile_Launch_01` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `launch_bolt` | `Single_..._Electric Spell_Launch_01` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `block` | `Single_..._Magic Shield_Activation_01` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `clang` | `Single_..._Heavy Sword_Hit_Metal_01` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `heal` | `Single_..._Healing Chime_01` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `drain` | `Seq_..._Mana Drain_Start` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `teleport` | `Single_..._Teleport_In` | JC Sounds | JC Sounds | **CC BY 4.0** |
| `boom`, `sub_boom`, `stun`, `launch_dark`, `field` | `explosionCrunch_000`, `lowFrequency_explosion_000`, `impactMetal_000`, `laserRetro_000`, `forceField_000` | [Kenney – Sci-Fi Sounds](https://opengameart.org/content/sci-fi-sounds) | Kenney | **CC0** |
| `earth_bong`, `parry`, `clink` | `bong1.wav`, `bing1.wav`, `clink3.wav` | [Metal Impact Sounds](https://opengameart.org/content/metal-impact-sounds) | yughues | **CC0** |
| `charge_earth`, `charge_arcane` | `magical_3.ogg`, `magical_1.ogg` | [Magic Spell SFX](https://opengameart.org/content/magic-spell-sfx) | artisticdude | **CC0** |
| `launch_earth` | `qubodupshovelSpell3.ogg` | [Shovel Spell](https://opengameart.org/content/shovel-spell) | qubodup | **CC BY 3.0** |

CC BY 4.0 (JC Sounds) and CC BY 3.0 (qubodup) require attribution; the game credits
them on the How to Play screen. No file here is share-alike, so the game's own code
carries no audio-derived licence obligation.

## How these files were produced

The packs ship 44.1 kHz audio, often stereo, often several seconds long. A browser
game cannot afford to download that, so each file used here is a trimmed,
mono, 22.05 kHz 16-bit PCM WAV:

- mixed to mono,
- leading silence removed (12 ms pre-roll kept so transients are not clipped),
- capped to the duration the game actually needs,
- peak-normalised to −1 dBFS so packs recorded at different levels sit together,
- 4 ms fade-in / 18 ms fade-out to stop clicks.

The four `charge_*` files derived from JC's `Loop_*_Hold` sources keep only a 6 ms
declick fade, because the game loops them for the length of a wind-up.

`.ogg` files were copied untouched — they were already small enough (13–59 kB).

Total: 26 files, ~1.2 MB. Every one is loaded in the background after first paint;
playback falls back to the procedural synth in `public/index.html` when a file has
not arrived yet, so the game is never silent and never blocks on audio.
