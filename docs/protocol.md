# Mage Duel – Network Protocol

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
pairing can never run ticks with one player still connecting. Queue entries are
dropped on cancel, disconnect, or joining any other room.

> **Clock rule:** every timestamp the client receives (`serverTime`, `endsAt`,
> `deadline`, `until`) is on the **server's** clock. The client estimates the
> offset with `ping_server` and compares against `serverNow()` — never against
> its own `Date.now()`. Mixing the two breaks wind-up telegraphs and the
> disconnect countdown on any machine whose clock differs from the server's.

---

## Client → Server Events

| Event | Payload | Description |
|---|---|---|
| `ping_server` | `clientTime: number` | Pings server to measure RTT and estimate server clock offset |
| `create_room` | `{ name: string }` | Host creates a room (callback: `{ ok: boolean, code?: string, error?: string }`) |
| `quick_duel` | `{ name: string, class: string }` | Enter matchmaking with no code (callback: `{ ok: boolean, waiting?: boolean, matched?: boolean, code?: string, error?: string }`) |
| `cancel_quick_duel` | `{}` | Leave the matchmaking queue |
| `join_room` | `{ code: string, name: string }` | Guest joins existing room by code (callback: `{ ok: boolean, code?: string, error?: string }`) |
| `cast` | `{ spell: string, source: "tap" \| "voice" \| "text" }` | Request to cast a spell |
| `rematch` | `{}` | Request rematch after a game ends |
| `leave_room` | `{}` | Intentionally leave or forfeit room |

---

## Server → Client Events

| Event | Payload | Description |
|---|---|---|
| `room_update` | `{ code, state: "waiting" \| "in_progress" \| "finished", players: [{ id, name, ready }] }` | Broadcasted on lobby player changes |
| `quick_match_found` | `{ code, token, opponent: { name, class } }` | Matchmaking paired you. Client joins via `join_room` with this `code` + `token`. |
| `quick_duel_cancelled` | `{}` | Confirms you left the matchmaking queue |
| `match_start` | `{ startsAt, p1: { id, name }, p2: { id, name } }` | Match starting countdown begun |
| `cast_started` | `{ id, caster, spell, endsAt }` | Wind-up started (visible to both players) |
| `cast_cancelled` | `{ caster, spell, reason: "interrupted" \| "stunned" }` | Wind-up cancelled |
| `hit` | `{ target, damage, rawDamage, blocked, perfect }` | Hit resolution |
| `heal` | `{ player, amount, newHp }` | Heal resolved |
| `block_started` | `{ player, endsAt }` | Block activated |
| `block_cooldown_reset` | `{ player }` | Block cooldown refreshed (when opponent casts Ultimate) |
| `stunned` | `{ player, until }` | Stun applied to player |
| `state_snapshot` | `{ snapshot: { [id]: { hp, mana, blockActive, stunned, windUp, cooldowns } }, serverTime }` | Broadcast every 100ms for reconciliation (`SNAPSHOT_INTERVAL_MS`). `cooldowns` values are remaining ms, so they need no clock conversion. |
| `rejected` | `{ spell, reason }` | Cast attempt failed (no mana, cooldown, stunned, etc.) |
| `match_end` | `{ winner: string, reason: string }` | Game ended (winner ID or "draw") |
| `opponent_disconnected` | `{ deadline }` | Opponent disconnected, countdown started |
| `opponent_reconnected` | `{}` | Opponent reconnected |
