# Mage Duel — Improvement Proposal

**Nothing in this document has been implemented.** Per project rules (ask before adding features), this is the idea list for you to choose from.

I read the current code before writing this, so the diagnoses below are about *your* build, not generic advice.

---

## 0. What I verified in the current build

| # | Observation | Where | Why it matters |
|---|---|---|---|
| 1 | **There is no audio at all.** Searching for `AudioContext`, `createOscillator`, `new Audio(` returns zero matches. | `public/index.html` | The pitch promises procedural chiptune + spell SFX. Silence is the single biggest gap between "demo" and "game". Also the cheapest latency-hiding tool we have (§3). |
| 2 | **The opponent teleports.** `oppPos.x = data.x` assigns the raw snapshot position. | `public/index.html:2022` | At 25 snapshots/sec with any RTT, the rival visibly snaps. Reads for blocking/aiming get muddy. |
| 3 | **Telegraph bars mix two clocks.** `p.windUp.endsAt > now` compares a **server** epoch timestamp against `Date.now()` on the **client**, with no offset applied. `serverTime` is sent on every event but never used. | `public/index.html:2210` | If the two machines' clocks differ, wind-up bars are wrong, absent, or permanently full. This is exactly the UI a parry depends on. **Bug, worth fixing regardless of any feature.** |
| 4 | **Snapshot/tick mismatch.** Tick = 50ms, snapshot = 250ms. | `server.js:129, 139` | Mana and HP step 4×/second; a 600ms parry window is quantized to 250ms of visual information. |
| 5 | **Single CDN dependency, no fallback.** Three.js r128 loaded from cdnjs; `new THREE.WebGLRenderer(...)` is unguarded. | `public/index.html:889, 918` | Blocked CDN, corporate proxy, or a device without WebGL = blank arena with no error message. r128 is also from 2021. |
| 6 | **Voice is Chromium/Safari-only.** Firefox ships no `SpeechRecognition`. | platform | The tap/keyboard path isn't a "fallback", it's half the playerbase. It needs first-class parity, not second-class. |
| 7 | **Movement has no reconciliation.** Fixed-interval `player_move` with raw position, no sequence numbers. | `public/index.html:2804` | If the server clamps or rejects a move, the client never learns and drifts. |

---

## 1. Fun — the levers worth pulling

The four I'd build on, and why:

- **Legible feedback** — Steve Swink, *Game Feel*: a game feels good when every action produces immediate, multi-channel, overstated feedback. Your rules are already good; the *presentation* is the bottleneck.
- **Learning a readable opponent** — Raph Koster, *A Theory of Fun*: fun is the brain mastering patterns. The patterns must be **visible**, or there's nothing to master.
- **Meaningful risk** — Jesse Schell, *The Art of Game Design* (lens of risk, lens of choice): decisions only feel good when they can go wrong.
- **Earned mastery** — David Sirlin, *Playing to Win*: the skill you want players to chase must be the loudest, most rewarded thing on screen.

### Tier A — Feel (cheap, big, low risk)

**A1. A real audio layer.** *(highest value item in this document)*
Per-element identity: fire crackle+boom, ice chime+tinkle, lightning crack, earth thud, dark sub-bass swell. Plus — and this is the design point, not decoration — **each spell gets a distinct telegraph sound**, with wind-ups playing a rising tone that peaks on impact. A 3s ultimate should be *audible* from the moment it starts.
Why: three feedback channels (sight, sound, motion) instead of one, and audio arrives **before** a 250ms-lagged bar, so it also compensates for latency. Needs an iOS unlock-on-first-tap and a mute button.

**A2. Parry spotlight.** A ~130ms hit-stop, a unique ringing sting, a color-inverted frame, and the attacker's silhouette flashing on the stun. Scale intensity by rarity (parried ultimate ≫ parried spark).
Why: the perfect block is your best mechanic and currently gets the same visual weight as a normal hit. Players chase what the game celebrates.

**A3. "Why not?" feedback next to the button.** Right now a rejected cast surfaces as floating text. Move it onto the rune itself: a cooldown dial that visibly fills, a mana cost that flashes red when unaffordable, a shake on a stunned attempt.
Why: the most common new-player frustration is "I pressed it and nothing happened". A per-button reason removes that entirely.

**A4. Interrupt celebration.** When you cancel a wind-up, the cancelling player should get an unmistakable "INTERRUPTED" beat. Currently the *victim* gets the feedback and the winner gets nothing.
Why: you're teaching a verb; reward the teacher's student.

### Tier B — Depth (retention driver)

**B1. Choose your ultimate at class select.** Two 10-mana options per class (e.g. Fire: Inferno Nova *or* a defensive Flame Wall). Cheap on rules, roughly doubles matchup variety, and adds a pre-match decision that's fun on its own.

**B2. Overcharge (push-your-luck).** Re-cast the same spell within a short window to overcharge it: more damage, longer wind-up, and a harsher interrupt penalty. This is the most reliable fun engine in games (press-your-luck) and it maps perfectly onto your existing wind-up/interrupt system.

**B3. Block becomes a decision, not a default.** Small mana-regen penalty while holding block. Right now block is 1.5s on a 4s cooldown with no cost, so "block when unsure" is nearly free and the mind-game flattens.

**B4. Make the comeback legible.** Keep the sub-30 HP mana surge, but *announce* it ("SURGE! +50% mana") and add a visible threshold effect. Hidden multipliers feel like luck; visible ones feel like a lifeline you earned (Schell's lens of fairness).

**B5. Sudden death as a spectacle.** Arena darkens, sky shifts, music/accent changes, both mages start visibly burning. Right now it's a 1 HP/s drip that players may not even notice.

### Tier C — Session & social (multiplayer-specific)

**C1. Quick Duel queue.** Pair any two waiting players instead of requiring a room code. Time-to-first-match is the #1 killer of browser multiplayer games — a code + "send this to a friend" is a lot of friction.

**C2. Best-of-3** with class re-pick between rounds. Gives a match an arc and makes a loss feel like a chapter instead of an ending.

**C3. Post-match insight card.** "3 casts lost to cooldown · best parry 180ms · you interrupted 2 ultimates." Turns a loss into a concrete next goal — this is Koster's "learning is the fun" made explicit, and it's derivable from events you already emit.

**C4. Modifier rounds.** "No ultimates", "sudden death from 60s", "double mana". Cheap variety that stretches five classes a long way.

### Tier D — Onboarding

**D1. Practice drills with explicit goals** ("interrupt a Fireball 3 times", "land 3 perfect blocks"). You already have a practice dummy; giving it objectives turns it into a tutorial that teaches the real verbs.

**D2. First-match coach marks** — one-line callouts the first time a wind-up, a parry window, and a blocked ultimate appear.

---

## 2. Works everywhere (browser & device)

| # | Change | Why |
|---|---|---|
| R1 | **Vendor Three.js locally**, pinned | Removes a third-party single point of failure and lets us upgrade off r128 |
| R2 | **WebGL capability gate** + try/catch around renderer init, plus `webglcontextlost`/`restored` handling | Today a no-WebGL device sees a blank page and no error |
| R3 | **Capability badges in the lobby** (voice / touch / keyboard) | Honest UI beats silent degradation, especially since voice is Chromium+Safari only |
| R4 | **Auto quality tiers** from measured frame time (particles, point lights, DPR) | A mid-range phone should not be running full effects and 25fps |
| R5 | **Mobile layout pass** — landscape nudge, thumb-zone rune cluster, HUD legibility at the fixed 320×180 upscale | Tap parity is the requirement; make it comfortable, not just present |
| R6 | **Audio unlock on first gesture** (iOS) | Required before A1 ships |
| R7 | **Reconnect UX**: auto-reconnect on tab-visible, clear "reconnecting…" state | You have server-side reconnect + 30s forfeit; the client side should feel seamless |

---

## 3. Latency — ordered by impact per hour of work

**L1. Use `serverTime` properly.** *(do this first — it's also bug #3)*
Measure the clock offset with the `ping_server` you already have, then drive **every** countdown (wind-up bar, cooldowns, block duration) from server time. Telegraphs become exact instead of 250ms-quantized, and clock skew stops breaking the parry UI.
*Roughly 1–2 hours, and it fixes a real bug.*

**L2. Local prediction for your own instant spells.** Spark/Zap/Block play their FX immediately; the server confirms or rejects; on reject, a visible "fizzle". Your own actions stop waiting on a round trip — the authoritative result is unchanged.
*(This is the standard FPS approach: predict cosmetically, never predict damage.)*

**L3. Interpolate the opponent.** Render the rival ~100ms in the past, lerping between the two most recent snapshots. This is the textbook fix (Gambetta's *Fast-Paced Multiplayer*, Valve's Source networking notes) and turns teleporting into smooth motion for one small function change.

**L4. Input buffering (~100ms).** A press landing in the tail of a cooldown fires when legal instead of being dropped. Removes "I definitely pressed it".

**L5. RTT-aware parry leniency.** Widen the perfect-block window by up to ~half the measured RTT, clamped, server-side. A 600ms timing skill is brutal on 150ms mobile latency; this makes it fair without changing the mechanic on low-ping connections.

**L6. Snapshots at 100ms** (or a lightweight per-player telegraph tick at 100ms). Two players per room — the bandwidth is negligible. 250ms is the weakest link in the whole experience.

**L7. Trust signals.** Real ping/quality pill in the HUD, `transports: ['websocket']` to skip the polling upgrade stall.

**Explicitly skipped:** rollback netcode. L1–L6 gets ~90% of the perceived responsiveness for ~10% of the effort. Revisit only if duels go competitive.

---

## 4. The two bugs I'd fix no matter what you pick

1. **Clock skew in telegraph rendering** (#3) — client compares server `endsAt` against its own `Date.now()`.
2. **No WebGL/CDN failure path** (#5) — a blank arena with no explanation.

---

## 5. Suggested sequence

| Slice | Contents | Effect |
|---|---|---|
| **1 — Responsiveness** | L1 clock fix, L6 snapshot rate, L3 opponent interpolation, L2 local prediction | The game stops feeling laggy. Fixes a real bug. |
| **2 — Feel** | A1 audio layer, A2 parry spotlight, A3 per-button "why not", R1/R2/R6 | The game starts feeling like a game. |
| **3 — Depth & reach** | One of B1–B4, C1 quick queue, R4/R5 device polish | Reasons to play a second match, on any device. |

**Deliberately not proposed:** accounts, cosmetics, ranked ladders, more classes, tournaments. None of them move fun-per-hour at this stage, and each is a week of work.

---

## 6. Decision needed

Tell me which tiers/slices you want and I'll build them in that order. My recommendation if you want the best fun-per-hour: **Slice 1, then A1 + A2, then C1**.
