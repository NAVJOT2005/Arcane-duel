# Arcane Duel – Network Protocol

Server is authoritative and controls state, timestamps, and game ticks.

All server messages include `serverTime: number` for clock synchronization.

## Matchmaking

A duel can start in two ways:

1. **Room code.** `create_room` → share the code → `join_room`.
2. **Quick Duel.** `quick_duel` queues you; when a second player searches, the
   server creates the room with both seats reserved and emits `quick_match_found`
   to both. Each client then calls `join_room` with its own `token`, so the rest of
   the match lifecycle (start, reconnect, rematch) is identical to a coded room.

A match only starts once both sockets are actually seated in the room, so a
pairing can never run ticks with one player still connecting. If that does not
happen within `MD_SEAT_WAIT_MS` (8s), the server emits `match_failed`, deletes the
room, and — for a Quick Duel — emits `quick_match_failed` and puts the connected
player back in the queue.

> **Clock rule:** every timestamp the client receives (`serverTime`, `endsAt`,
> `deadline`, `until`) is on the **server's** clock. The client estimates the
> offset with `ping_server` and compares against `serverNow()` — never against
> its own `Date.now()`. Mixing the two breaks wind-up telegraphs and the
> disconnect countdown on any machine whose clock differs from the server's.

---

## Sessions and resume

A seat is owned by a `token`, **not** by `socket.id`. `socket.id` changes on every
reconnect, so the server remaps the seat when a client presents its token.

- The client stores `{ code, token }` in `sessionStorage` (`md_session`) as soon as
  it is seated, and clears it on `match_end`, on leaving, or when the room is gone.
- On **every** `connect` — including the automatic reconnect after a transport
  drop or a page refresh — the client sends `join_room` with that token.
- The server answers a successful resume with `room_update`, plus `match_start`
  and an immediate `state_snapshot` if a duel is already in progress, so the whole
  screen can be rebuilt rather than showing an empty HUD.

Grace periods (all configurable, see *Configuration*):

| Situation | Behaviour |
|---|---|
| A waiting-room player drops | The seat is held for `MD_WAITING_ROOM_TTL_MS` (120s), then the room is deleted and any remaining player gets `match_failed { reason: "rival_left" }`. |
| A player drops mid-duel | Their own forfeit timer starts (`MD_FORFEIT_MS`, 30s). A rival's reconnect does not cancel it. |
| Both players are gone mid-duel | The first timer to expire ends the match; with nobody connected the room is deleted immediately. |
| Practice drops | The dummy room is held for `MD_PRACTICE_GRACE_MS` (60s) so a refresh resumes it, then reaped. |
| A duel ends | The room is kept for rematches for `MD_FINISHED_ROOM_TTL_MS` (300s), then reaped. |

---

## Client → Server Events

| Event | Payload | Description |
|---|---|---|
| `ping_server` | `clientTime: number` | Pings server to measure RTT and estimate server clock offset |
| `create_room` | `{ name: string, class: string }` | Host creates a room (callback: `{ ok, code?, token?, error? }`) |
| `quick_duel` | `{ name: string, class: string }` | Enter matchmaking with no code (callback: `{ ok, waiting?, matched?, code?, error? }`) |
| `cancel_quick_duel` | `{}` | Leave the matchmaking queue |
| `join_room` | `{ code: string, name?: string, class?: string, token?: string }` | Join a room by code, or resume a seat by token (callback: `{ ok, code?, token?, reconnected?, state?, error? }`) |
| `practice_mode` | `{ name: string, class: string }` | Start a solo dummy duel (callback: `{ ok, code?, token?, isPractice?, error? }`) |
| `select_class` | `{ class: string }` | Change class while the room is still waiting |
| `cast` | `{ spell: string, text?: string, source: "tap" \| "voice" \| "text" }` | Request to cast a spell |
| `player_move` | `{ x: number, z: number, rotY: number }` | Position/heading broadcast, rate-limited to ~30/s |
| `rematch` | `{}` | Request rematch after a game ends |
| `leave_room` | `{}` | Intentionally leave or forfeit room |

Errors from `join_room` are human-readable strings (`"Room not found"`,
`"That room is full."`, `"That duel has already started."`) so the client can show
them directly. Rate-limited events answer with an ack `{ ok: false, error:
"rate_limited" }` (or a `rejected` event for `cast`).

---

## Server → Client Events

| Event | Payload | Description |
|---|---|---|
| `room_update` | `{ code, state: "waiting" \| "in_progress" \| "finished", players: [{ id, name, class, rematchRequested, isOnline, isBot }] }` | Broadcast on lobby changes; `isOnline: false` means "seat held, reconnecting" |
| `quick_match_found` | `{ code, token, opponent: { name, class } }` | Matchmaking paired you. Client joins via `join_room` with this `code` + `token`. |
| `quick_duel_cancelled` | `{}` | Confirms you left the matchmaking queue |
| `quick_match_failed` | `{ code, reason, serverTime }` | Your Quick Duel partner never seated. You have been requeued. |
| `match_failed` | `{ code, reason: "seat_timeout" \| "rival_left", missing?, serverTime }` | The duel could not start or could not continue. Return to the menu. |
| `match_start` | `{ startsAt, p1: { id, name, class }, p2: { id, name, class } }` | Match started (also re-sent to a client that resumes mid-duel) |
| `cast_started` | `{ id, caster, spell, endsAt }` | Wind-up started (visible to both players) |
| `cast_cancelled` | `{ caster, spell, reason: "interrupted" \| "stunned" }` | Wind-up cancelled |
| `hit` | `{ target, damage, rawDamage, blocked, perfect }` | Hit resolution |
| `heal` | `{ player, amount, newHp }` | Heal resolved |
| `block_started` | `{ player, endsAt }` | Block activated |
| `block_cooldown_reset` | `{ player }` | Block cooldown refreshed (when opponent casts Ultimate) |
| `stunned` | `{ player, until }` | Stun applied to player |
| `mana_drained` | `{ target, amount }` | Zap streak passive drained mana |
| `status_applied` | `{ player, status, until? }` | `burn` \| `chill` \| `tremor` \| `blind` \| `curse` |
| `armor_gained` / `armor_absorbed` | `{ player, total }` / `{ target, amount, remaining }` | Earth Stone Armour |
| `state_snapshot` | `{ snapshot: { [id]: { class, hp, mana, blockActive, stunned, windUp, cooldowns, status } }, serverTime }` | Broadcast every 100ms for reconciliation (`SNAPSHOT_INTERVAL_MS`). `cooldowns` values are remaining ms, so they need no clock conversion. |
| `rejected` | `{ spell, reason }` | Cast attempt failed (no mana, cooldown, stunned, not_in_room, rate_limited, …) |
| `match_end` | `{ winner: string, reason: "kill" \| "opponent_left" \| "timeout_forfeit" \| "mutual_kill", serverTime }` | Game ended (winner ID or "draw") |
| `opponent_disconnected` | `{ player, name, deadline, serverTime }` | Opponent dropped; `deadline` is their forfeit time on the server clock |
| `opponent_reconnected` | `{ player, name, serverTime }` | Opponent reclaimed their seat |

---

## HTTP endpoints

| Path | Purpose |
|---|---|
| `GET /` | The game (HTML, `Cache-Control: no-store` so a deploy is always picked up) |
| `GET /healthz` | `{ ok, rooms, sockets, uptime, eventLoopP99ms }` — point an uptime pinger here |
| `GET /audio/*`, `/vendor/*`, `/shared/*` | Versioned with `?v=<build>`, served `immutable` for a year |

---

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `ALLOWED_ORIGINS` | *(same-origin)* | Comma-separated origins allowed by Socket.IO CORS |
| `MD_LOG` | on | `0` silences the structured event log |
| `MD_WAITING_ROOM_TTL_MS` | `120000` | Grace before an abandoned waiting room is deleted |
| `MD_FORFEIT_MS` | `30000` | Mid-duel disconnect forfeit timer (per player) |
| `MD_SEAT_WAIT_MS` | `8000` | How long `startMatch` retries before emitting `match_failed` |
| `MD_FINISHED_ROOM_TTL_MS` | `300000` | How long a finished room is kept for rematches |
| `MD_PRACTICE_GRACE_MS` | `60000` | How long a solo practice room survives a disconnect |
| `MD_MOVE_RATE` | `30` | Per-socket `player_move` limit (per second) |
| `MD_CAST_RATE` | `12` | Per-socket `cast` limit (per second) |
| `MD_CREATE_RATE` | `2` | Per-socket `create_room` limit (per second) |
| `MD_MAX_ROOMS_PER_IP` | `20` | Concurrent waiting rooms per address |
