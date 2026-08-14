import type { GameEvent, GameState, MapDef, Vec } from './types'
import { keyOf, livingMonsters } from './types'
import { occupiedSet, isStandable } from './map'
import { distanceField } from './pathfind'
import { makeMonster } from '../data/monsters'
import { spawnChestForWave } from './chests'
import { randInt } from './combat'

export interface WaveSpawn {
  kind: string
  door: string // landmark key of the entry door
}

// Endless mode: waves are generated, not authored. Each wave gets a threat
// budget that grows with the wave number, and is spent on monsters from a
// weighted pool. Cost is the balance lever — a demon eats a whole early wave.
export const MONSTER_COSTS: Record<string, number> = { goblin: 1, skeleton: 2, orc: 3, demon: 8 }

// Kinds enter the pool gradually so the opening waves teach one threat at a
// time: goblins rush, then archers punish standing still, then orcs go for the
// shrine, then the first demon.
export const MONSTER_UNLOCK: Record<string, number> = { goblin: 1, skeleton: 2, orc: 3, demon: 5 }

// Draw weights within the affordable pool — goblins stay the filler.
const SPAWN_WEIGHT: Record<string, number> = { goblin: 3, skeleton: 2, orc: 2, demon: 1 }

// The monster brain is ONE LLM call for the whole horde (server/llm.ts,
// maxTokens 3072). Past roughly a dozen monsters the structured response
// truncates, fails schema validation and silently drops to the heuristic
// fallback — so the board is hard-capped instead.
export const MAX_ALIVE = 10

export const MIN_WAVE = 2
export const BASE_BUDGET = 3
export const BUDGET_GROWTH = 1.5
export const BOSS_EVERY = 5

// Waves are meant to arrive one at a time: four heroes can beat four monsters,
// but stacked waves outnumber the party 2:1 in actions per turn and wipe it.
// The turn cap is only a pressure valve against a player who stalls forever.
export const MAX_TURNS_PER_WAVE = 6
export const BREATHER_HEAL = 4

// Orc doctrine sends them past the heroes straight at the shrine, so over an
// endless run the shrine bleeds permanently and every run ends the same way:
// shrine at zero, party still standing. Masonry mended between waves turns that
// from an unavoidable clock into something the player controls.
//
// Crucially this is NOT gated on clearing the wave, the way the party's breather
// is. Measured over 30 runs, a clear-only repair fired on 15% of waves: the
// shrine is untouched through wave 5 (nothing to mend) and from wave 7 a party
// under real pressure stops clearing outright — so the bonus switched off at
// exactly the point the shrine started dying. Some stone comes back every wave;
// clearing outright is worth more than double.
export const SHRINE_REPAIR_HELD = 2
export const SHRINE_REPAIR_CLEARED = 5

export interface WaveScaling {
  hpMult: number
  dmgBonus: number
}

// Monsters stay stock until the first demon, then thicken steadily. Healing is
// capped (Mira's 6, the breather's 4, chest heals) while this is not, so every
// run is guaranteed to end — which is what keeps the termination test honest.
export function scalingForWave(wave: number): WaveScaling {
  const tier = Math.max(0, wave - BOSS_EVERY)
  return { hpMult: 1 + 0.15 * tier, dmgBonus: Math.floor(tier / 3) }
}

// The opening is authored, not rolled. Randomised doors put all three goblins
// out past the party's reach about a third of the time, and a first order that
// connects with nothing is a terrible way to start a run. Variety begins at
// wave 2, which is where a run's shape actually forms.
const OPENING_WAVE: WaveSpawn[] = [
  { kind: 'goblin', door: 'north_door' },
  { kind: 'goblin', door: 'north_door' },
  { kind: 'goblin', door: 'west_door' },
]

// Composes the NEXT wave (state.wave is still the last one spawned). Every draw
// runs off the seeded state RNG, never Math.random — a seed must replay exactly.
export function generateWave(map: MapDef, state: GameState): WaveSpawn[] {
  const wave = state.wave + 1
  if (wave === 1) return OPENING_WAVE.map((s) => ({ ...s }))
  let budget = Math.round(BASE_BUDGET + BUDGET_GROWTH * (wave - 1))
  // Never push the board past the LLM cap: a wave arriving on top of survivors
  // is trimmed, not skipped.
  const sizeCap = Math.max(MIN_WAVE, MAX_ALIVE - livingMonsters(state).length)
  const kinds: string[] = []

  if (wave % BOSS_EVERY === 0) {
    // The guaranteed boss is half-price. At full cost it eats the whole early
    // budget and wave 5 arrives smaller than wave 4 — the milestone reads as a
    // lull instead of an escalation. Demons rolled from the pool below still
    // pay full freight.
    kinds.push('demon')
    budget = Math.max(0, budget - Math.ceil(MONSTER_COSTS.demon / 2))
  }

  while (kinds.length < sizeCap) {
    const pool: string[] = []
    for (const kind of Object.keys(MONSTER_COSTS)) {
      if (MONSTER_UNLOCK[kind] > wave) continue
      if (MONSTER_COSTS[kind] > budget) continue
      for (let i = 0; i < SPAWN_WEIGHT[kind]; i++) pool.push(kind)
    }
    if (!pool.length) break // budget spent below the cheapest kind
    const pick = pool[randInt(state, 0, pool.length - 1)]
    kinds.push(pick)
    budget -= MONSTER_COSTS[pick]
  }
  // A wave that spends its whole budget on one demon still needs bodies.
  while (kinds.length < MIN_WAVE) kinds.push('goblin')

  // Doors are drawn per monster: the same wave number never arrives the same
  // way twice, so the player cannot memorise a lane.
  const doors = Object.keys(map.spawns).sort()
  return kinds.map((kind) => ({ kind, door: doors[randInt(state, 0, doors.length - 1)] }))
}

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
  if (state.wave === 0) return true
  const living = livingMonsters(state).length
  if (living === 0) return true
  // Stall-breaker, but never at the cost of blowing past the horde cap.
  return state.turnsSinceWave >= MAX_TURNS_PER_WAVE && living < MAX_ALIVE
}

// Beating a boss wave calls one hero back from the dead at half strength. Without
// it a single early loss makes the rest of the run a foregone conclusion; with it
// the run has a rhythm — hold to the demon, kill it, get someone back.
function reviveFallenHero(map: MapDef, state: GameState, events: GameEvent[]): void {
  // First fallen in units order, i.e. tank-first — deterministic, no RNG spend.
  const fallen = state.units.find((u) => u.side === 'party' && !u.isStructure && !u.alive)
  if (!fallen) return

  let pos: Vec | undefined
  const occ = occupiedSet(state)
  if (isStandable(map, fallen.pos) && !occ.has(keyOf(fallen.pos))) {
    pos = { ...fallen.pos }
  } else {
    // Corpse tile taken: step out to the nearest free standable tile.
    const field = distanceField(map, fallen.pos)
    let best: { pos: Vec; d: number } | undefined
    for (const [k, d] of field) {
      if (occ.has(k)) continue
      const [x, y] = k.split(',').map(Number)
      if (!isStandable(map, { x, y })) continue
      if (!best || d < best.d) best = { pos: { x, y }, d }
    }
    pos = best?.pos
  }
  if (!pos) return // nowhere to stand: the board is packed, skip the revive

  fallen.alive = true
  fallen.hp = Math.max(1, Math.floor(fallen.maxHp / 2))
  fallen.defending = false
  fallen.pos = pos
  events.push({ type: 'unit_revived', unitId: fallen.id, hp: fallen.hp, pos: { ...pos } })
}

export function spawnWave(map: MapDef, state: GameState, events: GameEvent[]): void {
  // Both rewards below are for clearing the board outright. Letting the turn cap
  // drag the next wave in earns nothing — decisive play is the whole point.
  const cleared = state.wave > 0 && livingMonsters(state).length === 0

  if (cleared && state.wave % BOSS_EVERY === 0) {
    reviveFallenHero(map, state, events)
  }

  // Clearing a wave outright buys the party a breather — rewards decisive play
  // and keeps a long defence survivable without a full heal. The shrine mends
  // every wave regardless (see the constants above), just far more when the
  // board was cleared. A `heal` event aimed at the shrine already renders — the
  // HUD special-cases its bar — so nothing downstream needs to change.
  if (state.wave > 0) {
    for (const h of state.units) {
      if (!h.alive || h.side !== 'party') continue
      const cap = h.isStructure
        ? cleared
          ? SHRINE_REPAIR_CLEARED
          : SHRINE_REPAIR_HELD
        : cleared
          ? BREATHER_HEAL
          : 0
      const amount = Math.min(cap, h.maxHp - h.hp)
      if (amount > 0) {
        h.hp += amount
        events.push({ type: 'heal', unitId: h.id, targetId: h.id, amount, hpAfter: h.hp })
      }
    }
  }

  // Composed before the counter moves: generateWave reads state.wave + 1.
  const wave = generateWave(map, state)
  state.wave++
  state.turnsSinceWave = 0
  const scaling = scalingForWave(state.wave)
  const ids: string[] = []
  for (const spec of wave) {
    const tile = findSpawnTile(map, state, spec.door)
    if (!tile) continue
    const m = makeMonster(spec.kind, tile, scaling)
    state.units.push(m)
    ids.push(m.id)
  }
  events.push({ type: 'wave_spawned', wave: state.wave, unitIds: ids })
  // After the monsters are placed, so loot never lands under an arriving wave.
  spawnChestForWave(map, state, events)
}
