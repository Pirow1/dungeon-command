import type { GameState, MapDef, Unit } from './types'
import { SHRINE_ID, chebyshev, keyOf, livingHeroes, livingMonsters, unitById } from './types'
import { reachable } from './pathfind'
import { hasLOS } from './los'

// Landmark-first, geometry-free state summary. gpt-5-nano reasons over NAMES
// (doors, shrine, unit ids); the engine turns names back into tiles and does
// every geometric computation itself.

function enemiesInRange(map: MapDef, state: GameState, u: Unit): string[] {
  const foes = u.side === 'party' ? livingMonsters(state) : livingHeroes(state)
  return foes
    .filter(
      (f) =>
        chebyshev(u.pos, f.pos) <= u.attack.range &&
        (u.attack.range <= 1 || hasLOS(map, u.pos, f.pos)),
    )
    .map((f) => f.id)
}

function reachableLandmarks(map: MapDef, state: GameState, u: Unit): string[] {
  const reach = reachable(map, state, u.pos, u.move, u.id)
  const out: string[] = []
  for (const l of map.landmarks) {
    if (l.key === 'shrine') continue
    if (reach.has(keyOf(l.pos))) out.push(l.key)
  }
  return out
}

function nearestEnemyOf(state: GameState, u: Unit): { id: string; dist: number } | undefined {
  const foes = u.side === 'party' ? livingMonsters(state) : livingHeroes(state)
  let best: { id: string; dist: number } | undefined
  for (const f of foes) {
    const d = chebyshev(u.pos, f.pos)
    if (!best || d < best.dist) best = { id: f.id, dist: d }
  }
  return best
}

// What a monster can do about the shrine this turn. Without this the monster
// brain is blind to the objective and only ever engages heroes.
function shrineHint(
  map: MapDef,
  state: GameState,
  u: Unit,
): { toShrine: string; canHitShrineNow: boolean; canReachShrineThisTurn: boolean } {
  const shrine = unitById(state, SHRINE_ID)!
  const canHitFrom = (from: { x: number; y: number }) =>
    chebyshev(from, shrine.pos) <= u.attack.range && (u.attack.range <= 1 || hasLOS(map, from, shrine.pos))
  const dist = chebyshev(u.pos, shrine.pos)
  const canHitNow = canHitFrom(u.pos)
  let canReach = canHitNow
  if (!canReach) {
    const reach = reachable(map, state, u.pos, u.move, u.id)
    for (const [, e] of reach) {
      if (canHitFrom(e.pos)) {
        canReach = true
        break
      }
    }
  }
  return {
    toShrine: canHitNow ? 'adjacent' : `${dist} tiles`,
    canHitShrineNow: canHitNow,
    canReachShrineThisTurn: canReach,
  }
}

function nearestLandmark(map: MapDef, u: Unit): string {
  let best = ''
  let bestD = Infinity
  for (const l of map.landmarks) {
    const d = chebyshev(u.pos, l.pos)
    if (d < bestD) {
      bestD = d
      best = l.key
    }
  }
  return bestD <= 1 ? `at ${best}` : `${bestD} tiles from ${best}`
}

export interface CompactState {
  turn: number
  wave: string
  shrineHp: string
  landmarks: string[]
  party: unknown[]
  monsters: unknown[]
}

export function summarize(map: MapDef, state: GameState): CompactState {
  const shrine = unitById(state, SHRINE_ID)!
  return {
    turn: state.turn,
    wave: `${state.wave} of ${state.totalWaves}`,
    shrineHp: `${shrine.hp}/${shrine.maxHp}`,
    landmarks: map.landmarks.map((l) => l.key),
    party: livingHeroes(state).map((u) => ({
      id: u.id,
      cls: u.cls,
      hp: `${u.hp}/${u.maxHp}`,
      where: nearestLandmark(map, u),
      canReachThisTurn: reachableLandmarks(map, state, u),
      enemiesInRangeNow: enemiesInRange(map, state, u),
      nearestEnemy: nearestEnemyOf(state, u) ?? 'none',
      ...(u.heal ? { canHeal: `${u.heal.amount} hp, range ${u.heal.range}` } : {}),
    })),
    monsters: livingMonsters(state).map((u) => {
      const shrine = shrineHint(map, state, u)
      return {
        id: u.id,
        cls: u.cls,
        hp: `${u.hp}/${u.maxHp}`,
        where: nearestLandmark(map, u),
        heroesInRangeNow: enemiesInRange(map, state, u),
        nearestHero: nearestEnemyOf(state, u) ?? 'none',
        toShrine: shrine.toShrine,
        canHitShrineNow: shrine.canHitShrineNow,
        canReachShrineThisTurn: shrine.canReachShrineThisTurn,
      }
    }),
  }
}
