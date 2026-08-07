import type { GameEvent, GameState, MapDef, Vec } from './types'
import { keyOf, livingMonsters } from './types'
import { occupiedSet, isStandable } from './map'
import { distanceField } from './pathfind'
import { makeMonster } from '../data/monsters'
import { spawnChestForWave } from './chests'

export interface WaveSpawn {
  kind: string
  door: string // landmark key of the entry door
}

// Five waves, spread across the three doors so the player must split attention.
export const WAVES: WaveSpawn[][] = [
  [
    { kind: 'goblin', door: 'north_door' },
    { kind: 'goblin', door: 'north_door' },
    { kind: 'goblin', door: 'west_door' },
  ],
  [
    { kind: 'goblin', door: 'east_door' },
    { kind: 'goblin', door: 'east_door' },
    { kind: 'goblin', door: 'west_door' },
    { kind: 'skeleton', door: 'north_door' },
  ],
  [
    { kind: 'orc', door: 'north_door' },
    { kind: 'orc', door: 'west_door' },
    { kind: 'skeleton', door: 'east_door' },
    { kind: 'skeleton', door: 'west_door' },
  ],
  [
    { kind: 'orc', door: 'east_door' },
    { kind: 'orc', door: 'north_door' },
    { kind: 'goblin', door: 'north_door' },
    { kind: 'goblin', door: 'east_door' },
    { kind: 'goblin', door: 'west_door' },
  ],
  [
    { kind: 'demon', door: 'north_door' },
    { kind: 'goblin', door: 'west_door' },
    { kind: 'goblin', door: 'east_door' },
    { kind: 'goblin', door: 'west_door' },
    { kind: 'goblin', door: 'east_door' },
  ],
]

// Waves are meant to arrive one at a time: four heroes can beat four monsters,
// but stacked waves outnumber the party 2:1 in actions per turn and wipe it.
// The turn cap is only a pressure valve against a player who stalls forever.
export const MAX_TURNS_PER_WAVE = 6
export const BREATHER_HEAL = 4

function findSpawnTile(map: MapDef, state: GameState, door: string): Vec | undefined {
  const preferred = map.spawns[door] ?? []
  const occ = occupiedSet(state)
  for (const p of preferred) {
    if (isStandable(map, p) && !occ.has(keyOf(p))) return p
  }
  // Door tiles busy: walk outward from the first preferred tile.
  const origin = preferred[0]
  if (!origin) return undefined
  const field = distanceField(map, origin)
  let best: { pos: Vec; d: number } | undefined
  for (const [k, d] of field) {
    if (occ.has(k)) continue
    const [x, y] = k.split(',').map(Number)
    if (!isStandable(map, { x, y })) continue
    if (!best || d < best.d) best = { pos: { x, y }, d }
  }
  return best?.pos
}

export function shouldSpawnWave(state: GameState): boolean {
  if (state.wave >= state.totalWaves) return false
  if (state.wave === 0) return true
  return livingMonsters(state).length === 0 || state.turnsSinceWave >= MAX_TURNS_PER_WAVE
}

export function spawnWave(map: MapDef, state: GameState, events: GameEvent[]): void {
  const wave = WAVES[state.wave]
  if (!wave) return

  // Clearing a wave outright buys the party a breather — rewards decisive play
  // and keeps a long defence survivable without a full heal.
  if (state.wave > 0 && livingMonsters(state).length === 0) {
    for (const h of state.units) {
      if (!h.alive || h.side !== 'party' || h.isStructure) continue
      const amount = Math.min(BREATHER_HEAL, h.maxHp - h.hp)
      if (amount > 0) {
        h.hp += amount
        events.push({ type: 'heal', unitId: h.id, targetId: h.id, amount, hpAfter: h.hp })
      }
    }
  }

  state.wave++
  state.turnsSinceWave = 0
  const ids: string[] = []
  for (const spec of wave) {
    const tile = findSpawnTile(map, state, spec.door)
    if (!tile) continue
    const m = makeMonster(spec.kind, tile)
    state.units.push(m)
    ids.push(m.id)
  }
  events.push({ type: 'wave_spawned', wave: state.wave, unitIds: ids })
  // After the monsters are placed, so loot never lands under an arriving wave.
  spawnChestForWave(map, state, events)
}
