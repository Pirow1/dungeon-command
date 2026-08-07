import type { GameState, MapDef, Vec } from './types'
import { keyOf } from './types'
import { isStandable, occupiedSet } from './map'

export interface ReachEntry {
  pos: Vec
  cost: number
  parent?: string
}

export type ReachMap = Map<string, ReachEntry>

const DIRS: Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]

// BFS flood-fill of standable, unoccupied tiles within `budget` steps.
// The origin tile is always included (cost 0).
export function reachable(
  map: MapDef,
  state: GameState,
  from: Vec,
  budget: number,
  ignoreUnitId?: string,
): ReachMap {
  const occ = occupiedSet(state, ignoreUnitId)
  const out: ReachMap = new Map()
  const startKey = keyOf(from)
  out.set(startKey, { pos: from, cost: 0 })
  const queue: Vec[] = [from]
  while (queue.length) {
    const cur = queue.shift()!
    const curEntry = out.get(keyOf(cur))!
    if (curEntry.cost >= budget) continue
    for (const d of DIRS) {
      const next = { x: cur.x + d.x, y: cur.y + d.y }
      const nk = keyOf(next)
      if (out.has(nk)) continue
      if (!isStandable(map, next)) continue
      if (occ.has(nk)) continue
      out.set(nk, { pos: next, cost: curEntry.cost + 1, parent: keyOf(cur) })
      queue.push(next)
    }
  }
  return out
}

// Reconstruct path (excluding start tile) to a tile present in the reach map.
export function pathTo(reach: ReachMap, dest: Vec): Vec[] {
  const path: Vec[] = []
  let k: string | undefined = keyOf(dest)
  while (k) {
    const e = reach.get(k)
    if (!e) return []
    if (e.parent === undefined) break
    path.push(e.pos)
    k = e.parent
  }
  return path.reverse()
}

// Unbounded BFS distance field from a goal (ignoring units), used to walk
// toward far-away targets: pick the reachable tile that minimizes distance-to-goal.
export function distanceField(map: MapDef, goal: Vec): Map<string, number> {
  const dist = new Map<string, number>()
  dist.set(keyOf(goal), 0)
  const queue: Vec[] = [goal]
  while (queue.length) {
    const cur = queue.shift()!
    const d = dist.get(keyOf(cur))!
    for (const dir of DIRS) {
      const next = { x: cur.x + dir.x, y: cur.y + dir.y }
      const nk = keyOf(next)
      if (dist.has(nk)) continue
      if (!isStandable(map, next)) continue
      dist.set(nk, d + 1)
      queue.push(next)
    }
  }
  return dist
}

// Best tile in `reach` by distance field (closest to goal), tiebreak lowest cost.
export function bestTileToward(reach: ReachMap, field: Map<string, number>): Vec | undefined {
  let best: { pos: Vec; d: number; cost: number } | undefined
  for (const [k, e] of reach) {
    const d = field.get(k)
    if (d === undefined) continue
    if (!best || d < best.d || (d === best.d && e.cost < best.cost)) {
      best = { pos: e.pos, d, cost: e.cost }
    }
  }
  return best?.pos
}
