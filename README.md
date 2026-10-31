# Arcane Duel

Two mages, one arena, incantations spoken into a microphone or tapped on screen.
Server-authoritative, real-time, no build step.

- **Live:** https://arcane-duel-hll7.onrender.com/
- **Local:** `npm install && npm start` → http://localhost:3000

## How to play, in three lines

1. **Drain your rival's HP to 0** before they drain yours; after two minutes the arena
   turns lethal and both mages bleed 1 HP/s.
2. **Mana is the real health bar.** You start at 5/10 and regenerate 1/s (1.5/s at
   30 HP or below). Quick spell 1 · signature 3 · heal 4 · ultimate 10.
3. **Block is free and has a 4s cooldown.** Block within 0.6s of impact for a
   **perfect block**: no damage, the attacker is stunned and their cast is cancelled.

Signature and ultimate spells have a visible wind-up. Land any unblocked hit during
an interruptible one and it is cancelled, so timing beats raw damage.

## Joining a duel

- **Quick Duel** — pairs you with the next mage searching. No code needed. If nobody
  turns up within 15s the client offers the training dummy instead.
- **Room code** — create a room, share the 4-letter code (or the invite link), rival
  joins from PLAY with the code.
- **Solo Practice** — an endless training dummy with unlimited mana, for rehearsing
  wind-ups and parry timing.

Your seat is held by a token: a dropped connection or a page refresh rejoins the same
duel within the grace period instead of losing it.

## Controls

| Action | Default |
|---|---|
| Move | `W A S D` |
| Aim | Mouse / touch drag |
| Cast | `1` `4` `Space` … (rebindable in **Settings → Controls**), tap a spell card, or say the incantation |
| Block | bound key or the Block card |
| Duel menu | `Esc` |

All bindings, aim sensitivity, screen shake, scanlines, pixel smoothing, voice
language/accent and SFX volume live in **Settings** and persist on the device. The
**How to Play** screen (Codex) documents every mechanic.

## Architecture

```
public/index.html   single-file client: Three.js arena, HUD, menus, voice + tap casting
public/audio.js     sample bank with a procedural synth fallback
shared/rules.js     pure rules engine: createMatch / tryCast / tick / getSnapshot
shared/spells.js    every spell, class and player number
shared/matcher.js   voice/text spell matching (aliases + typo budget)
server.js           Express + Socket.IO: rooms, matchmaking, authoritative ticks
```

The server owns all timers: a 50ms tick advances the rules engine, a 100ms snapshot
reconciles clients. Clients send intents (`cast`, `player_move`) and never decide
outcomes. Room lifecycle, grace periods and rate limits live in `server.js`; the
protocol (including the resume path) is documented in [docs/protocol.md](docs/protocol.md).

## Tests and scripts

```bash
npm test                    # rules + matcher + lobby regression tests (node --test)
node scripts/repro.js       # plays the reported connection bugs over real sockets, PASS/FAIL
node scripts/load.js        # 50 create→join→start cycles + event-loop p99 under load
node scripts/sim.js         # class-balance simulation over the real rules engine
```

`scripts/repro.js` and `scripts/load.js` accept `--server <file>` so the same checks
can be run against an older server build for a before/after comparison.
`SPELLS_FILE=<file> node scripts/sim.js` grades an alternative spell table, which is
how balance changes are compared without editing the shipped numbers.

## Deploying (Render)

The service runs `npm start` on the port in `PORT`. There is no `render.yaml`, so the
settings live in the Render dashboard:

- **Instance count must stay at 1.** Rooms are in an in-memory `Map`; with two
  instances a code would only exist on the instance that created it.
- **Free instances sleep after idle.** A restart wipes every room, so an existing
  code becomes "not found" — the client now says so and offers a new room instead of
  hanging. Point an uptime pinger (UptimeRobot, cron-job.org, or render's health
  check) at `GET /healthz` every 5–10 minutes to keep it awake and to watch
  `eventLoopP99ms`.
- Set `ALLOWED_ORIGINS=https://arcane-duel-hll7.onrender.com` to pin Socket.IO CORS
  to the deployed origin; without it the server reflects the request origin.

## Built with AI

This project is written with an AI coding agent (Codebuff) working from the author's
designs and reviews: the rules engine and protocol were written test-first, the
client's look was iterated against a reference mock-up, and the connection bugs were
fixed by reproducing them with socket-level scripts before changing any code. Every
change lands with `npm test` green and, where behaviour is networking-related, a
script in `scripts/` that shows the before/after.
