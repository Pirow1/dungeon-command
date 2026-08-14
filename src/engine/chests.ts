import type { ChestReward, ChestStat, GameEvent, GameState, MapDef, Unit, Vec } from './types'
import { chebyshev, keyOf } from './types'
import { isStandable, occupiedSet } from './map'
import { randInt } from './combat'

// Loot chests: one per wave, claimed by ENDING a move on the tile. The reward
// goes to the opening hero only.
//
// Every random draw here runs off the seeded state RNG, never Math.random — the
// determinism test replays a whole game from a seed and compares stats.

const CHEST_STATS: ChestStat[] = ['attack', 'defence', 'move']

// Rewards keep pace with the waves. Early chests are pure stat growth; from the
// middle of a run the pool turns toward healing, because by then attrition —
// not raw power — is what ends the party. Deep runs can hand back a full bar.
const HEAL_MIN_WORTH = 4 // a heal on a near-full hero reads as a broken chest

// Chests keep their distance from doors (a monster entrance is a cruel place for
// loot) and from landmarks — the summary describes a chest by its nearest
// landmark, and a chest sitting ON one reads as "chest1 - at east_door", which
// invites the model to route to the door instead of the chest.
const LANDMARK_CLEARANCE = 1
const SPAWN_CLEARANCE = 2

function isReserved(map: MapDef, state: GameState, p: Vec): boolean {
  for (const l of map.landmarks) {
    if (chebyshev(p, l.pos) <= LANDMARK_CLEARANCE) return true
  }
  for (const list of Object.values(map.spawns)) {
    for (const s of list) {
      if (chebyshev(p, s) <= SPAWN_CLEARANCE) return true
    }
  }
  return state.chests.some((c) => keyOf(c.pos) === keyOf(p))
}

export function spawnChestForWave(map: MapDef, state: GameState, events: GameEvent[]): void {
  const occupied = occupiedSet(state)
  const candidates: Vec[] = []
  // Scanned in a fixed order so the candidate list — and therefore the pick —
  // depends only on the RNG.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const p = { x, y }
      if (map.tiles[y][x] !== 'floor') continue // 'door' is standable but reserved
      if (!isStandable(map, p)) continue
      if (occupied.has(keyOf(p))) continue
      if (isReserved(map, state, p)) continue
      candidates.push(p)
    }
  }
  if (!candidates.length) return
  const pos = candidates[randInt(state, 0, candidates.length - 1)]
  const chest = { id: `chest${state.wave}`, pos: { ...pos } }
  state.chests.push(chest)
  events.push({ type: 'chest_spawned', chestId: chest.id, pos: { ...chest.pos } })
}

function rollStat(state: GameState, amount: 1 | 2): ChestReward {
  return { kind: 'stat', stat: CHEST_STATS[randInt(state, 0, CHEST_STATS.length - 1)], amount }
}

// Rolled at open time, not spawn time, so the tier follows the wave the player
// actually reached the chest on.
export function rollChestReward(state: GameState, opener: Unit): ChestReward {
  const wave = state.wave
  const d10 = randInt(state, 1, 10)
  let reward: ChestReward
  if (wave <= 3) {
    reward = rollStat(state, 1)
  } else if (wave <= 7) {
    reward = d10 <= 7 ? rollStat(state, 1) : { kind: 'heal', amount: 8 }
  } else if (wave <= 11) {
    reward = d10 <= 6 ? rollStat(state, 2) : { kind: 'heal', amount: 10 }
  } else {
    reward = d10 <= 5 ? rollStat(state, 2) : { kind: 'heal', amount: opener.maxHp }
  }
  // A heal worth almost nothing feels like the chest cheated you.
  if (reward.kind === 'heal' && opener.maxHp - opener.hp < HEAL_MIN_WORTH) {
    reward = rollStat(state, wave >= 8 ? 2 : 1)
  }
  return reward
}

// Called with a hero's FINAL position after its action resolves, so walking over
// a chest mid-path never claims it — you have to stop on it.
export function checkChestPickup(state: GameState, unit: Unit, events: GameEvent[]): void {
  if (!unit.alive || unit.side !== 'party' || unit.isStructure) return
  const i = state.chests.findIndex((c) => c.pos.x === unit.pos.x && c.pos.y === unit.pos.y)
  if (i < 0) return
  const [chest] = state.chests.splice(i, 1)
  const reward = rollChestReward(state, unit)
  applyReward(unit, reward)
  events.push({ type: 'chest_opened', chestId: chest.id, unitId: unit.id, reward, pos: { ...chest.pos } })
}

export function applyReward(unit: Unit, reward: ChestReward): void {
  if (reward.kind === 'heal') {
    unit.hp = Math.min(unit.maxHp, unit.hp + reward.amount)
    return
  }
  // Stepped one at a time so the display-only `boosts` tally stays a true count
  // of the points a hero is carrying.
  for (let i = 0; i < reward.amount; i++) applyStatPoint(unit, reward.stat)
}

function applyStatPoint(unit: Unit, stat: ChestStat): void {
  if (stat === 'attack') {
    unit.attack.dmgMin += 1
    unit.attack.dmgMax += 1
  } else if (stat === 'defence') {
    unit.defence = (unit.defence ?? 0) + 1
  } else {
    unit.move += 1
  }
  if (unit.boosts) unit.boosts[stat] += 1
}
