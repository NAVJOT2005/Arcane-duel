# Mage Duel – Network Protocol

> Draft — will be filled in on Day 3 when multiplayer is implemented.

## Client → Server

| Event | Payload | When |
|-------|---------|------|
| `create_room` | `{ name }` | Player creates a new room |
| `join_room` | `{ code, name }` | Player joins with a room code |
| `cast` | `{ spell, source }` | Player attempts to cast (source: "tap", "voice", "text") |
| `rematch` | `{}` | Player wants to play again |
| `leave` | `{}` | Player leaves the room |

## Server → Client

| Event | Payload | Notes |
|-------|---------|-------|
| `room_created` | `{ code }` | Room code to share |
| `room_update` | `{ players }` | Lobby state |
| `match_start` | `{ startsAt }` | Countdown begins |
| `cast_started` | `{ id, caster, spell, endsAt }` | Wind-up started (both see it) |
| `cast_cancelled` | `{ id, reason }` | Wind-up interrupted |
| `hit` | `{ id, target, damage, blocked, perfect }` | Damage resolved |
| `block_started` | `{ player, endsAt }` | Block active |
| `stunned` | `{ player, until }` | Stun applied |
| `state` | `{ hp, mana, cooldowns }` | Snapshot every ~250ms |
| `rejected` | `{ spell, reason }` | Cast failed (no mana, cooldown, etc.) |
| `match_end` | `{ winner, reason }` | Game over |
| `opponent_disconnected` | `{ deadline }` | 30s countdown |

All server events include `serverTime` for clock sync.
