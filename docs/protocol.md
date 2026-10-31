# Mage Duel – Network Protocol

Server is authoritative and controls state, timestamps, and game ticks.

All server messages include `serverTime: number` for clock synchronization.

---

## Client → Server Events

| Event | Payload | Description |
|---|---|---|
| `ping_server` | `clientTime: number` | Pings server to measure RTT and estimate server clock offset |
| `create_room` | `{ name: string }` | Host creates a room (callback: `{ ok: boolean, code?: string, error?: string }`) |
| `join_room` | `{ code: string, name: string }` | Guest joins existing room by code (callback: `{ ok: boolean, code?: string, error?: string }`) |
| `cast` | `{ spell: string, source: "tap" \| "voice" \| "text" }` | Request to cast a spell |
| `rematch` | `{}` | Request rematch after a game ends |
| `leave_room` | `{}` | Intentionally leave or forfeit room |

---

## Server → Client Events

| Event | Payload | Description |
|---|---|---|
| `room_update` | `{ code, state: "waiting" \| "in_progress" \| "finished", players: [{ id, name, ready }] }` | Broadcasted on lobby player changes |
| `match_start` | `{ startsAt, p1: { id, name }, p2: { id, name } }` | Match starting countdown begun |
| `cast_started` | `{ id, caster, spell, endsAt }` | Wind-up started (visible to both players) |
| `cast_cancelled` | `{ caster, spell, reason: "interrupted" \| "stunned" }` | Wind-up cancelled |
| `hit` | `{ target, damage, rawDamage, blocked, perfect }` | Hit resolution |
| `heal` | `{ player, amount, newHp }` | Heal resolved |
| `block_started` | `{ player, endsAt }` | Block activated |
| `block_cooldown_reset` | `{ player }` | Block cooldown refreshed (when opponent casts Ultimate) |
| `stunned` | `{ player, until }` | Stun applied to player |
| `state_snapshot` | `{ snapshot: { [id]: { hp, mana, blockActive, stunned, windUp, cooldowns } }, serverTime }` | Broadcasted ~every 250ms for reconciliation |
| `rejected` | `{ spell, reason }` | Cast attempt failed (no mana, cooldown, stunned, etc.) |
| `match_end` | `{ winner: string, reason: string }` | Game ended (winner ID or "draw") |
| `opponent_disconnected` | `{ deadline }` | Opponent disconnected, countdown started |
| `opponent_reconnected` | `{}` | Opponent reconnected |
