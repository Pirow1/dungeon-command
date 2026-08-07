import type { ChestStat, GameEvent, GameState, MapDef, Unit, Vec } from './types'
import { chebyshev, keyOf } from './types'
import { isStandable, occupiedSet } from './map'
import { randInt } from './combat'

// Loot chests: one per wave, claimed by ENDING a move on the tile. The reward is
// a permanent +1 to one stat, for the opening hero only.
//
// Every random draw here runs off the seeded state RNG, never Math.random — the
// determinism test replays a whole game from a seed and compares stats.

const CHEST_STATS: ChestStat[] = ['attack', 'defence', 'move']

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

// Called with a hero's FINAL position after its action resolves, so walking over
// a chest mid-path never claims it — you have to stop on it.
export function checkChestPickup(state: GameState, unit: Unit, events: GameEvent[]): void {
  if (!unit.alive || unit.side !== 'party' || unit.isStructure) return
  const i = state.chests.findIndex((c) => c.pos.x === unit.pos.x && c.pos.y === unit.pos.y)
  if (i < 0) return
  const [chest] = state.chests.splice(i, 1)
  const stat = CHEST_STATS[randInt(state, 0, CHEST_STATS.length - 1)]
  applyBoost(unit, stat)
  events.push({ type: 'chest_opened', chestId: chest.id, unitId: unit.id, stat, pos: { ...chest.pos } })
}

export function applyBoost(unit: Unit, stat: ChestStat): void {
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
