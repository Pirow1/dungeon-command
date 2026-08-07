import type { Action, GameEvent, GameState, MapDef, Unit } from './types'
import { SHRINE_ID, livingHeroes, livingMonsters, unitById } from './types'
import { resolveUnitAction } from './actions'
import { shouldSpawnWave, spawnWave, WAVES } from './waves'
import { HEROES } from '../data/heroes'
import { resetMonsterCounter } from '../data/monsters'

export const SHRINE_HP = 20
export const TOTAL_WAVES = WAVES.length

export function initGame(map: MapDef, seed = 1337): { state: GameState; events: GameEvent[] } {
  resetMonsterCounter()
  const shrineLandmark = map.landmarks.find((l) => l.key === 'shrine')!
  const shrine: Unit = {
    id: SHRINE_ID,
    name: 'The Shrine',
    cls: 'shrine',
    side: 'party',
    hp: SHRINE_HP,
    maxHp: SHRINE_HP,
    pos: { ...shrineLandmark.pos },
    move: 0,
    attack: { range: 0, dmgMin: 0, dmgMax: 0 },
    defending: false,
    alive: true,
    isStructure: true,
  }
  const heroes: Unit[] = HEROES.map((h, i) => ({
    ...h,
    attack: { ...h.attack },
    heal: h.heal ? { ...h.heal } : undefined,
    pos: { ...map.heroStarts[i] },
  }))
  const state: GameState = {
    turn: 1,
    wave: 0,
    totalWaves: TOTAL_WAVES,
    turnsSinceWave: 0,
    rng: seed | 0,
    units: [shrine, ...heroes],
    outcome: 'ongoing',
    stats: { damageDealt: {}, kills: {}, turns: 0 },
  }
  const events: GameEvent[] = []
  spawnWave(map, state, events) // wave 1 is on the board before the first order
  return { state, events }
}

export function checkEnd(state: GameState, events: GameEvent[]): void {
  if (state.outcome !== 'ongoing') return
  const shrine = unitById(state, SHRINE_ID)
  if (!shrine?.alive || livingHeroes(state).length === 0) {
    state.outcome = 'defeat'
    events.push({ type: 'game_over', outcome: 'defeat' })
    return
  }
  if (state.wave >= state.totalWaves && livingMonsters(state).length === 0) {
    state.outcome = 'victory'
    events.push({ type: 'game_over', outcome: 'victory' })
  }
}

// Party acts in fixed hero order (tank first). Missing/dead heroes clamp to
// a defensive hold so a partial LLM response still yields a full turn.
export function resolvePartyTurn(map: MapDef, state: GameState, actions: Action[]): GameEvent[] {
  const events: GameEvent[] = []
  if (state.outcome !== 'ongoing') return events
  for (const hero of HEROES) {
    const u = unitById(state, hero.id)
    if (!u?.alive) continue
    const a = actions.find((x) => x.unitId === hero.id) ?? { unitId: hero.id, type: 'defend' as const }
    resolveUnitAction(map, state, a, events)
    if (state.outcome !== 'ongoing') break
  }
  checkEnd(state, events)
  // A new wave arriving is resolved here — after the party acts, before the
  // monster brain thinks — so the monster LLM prompt always sees the full horde.
  if (state.outcome === 'ongoing' && shouldSpawnWave(state)) {
    spawnWave(map, state, events)
  }
  return events
}

export function resolveMonsterTurn(map: MapDef, state: GameState, actions: Action[]): GameEvent[] {
  const events: GameEvent[] = []
  if (state.outcome !== 'ongoing') return events
  for (const m of livingMonsters(state)) {
    const a = actions.find((x) => x.unitId === m.id) ?? { unitId: m.id, type: 'move_attack' as const }
    resolveUnitAction(map, state, a, events)
    if (state.outcome !== 'ongoing') break
  }
  state.turn++
  state.turnsSinceWave++
  state.stats.turns = state.turn
  checkEnd(state, events)
  return events
}
