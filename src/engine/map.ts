import type { GameState, MapDef, Vec } from './types'
import { keyOf } from './types'

export function inBounds(map: MapDef, p: Vec): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height
}

export function isWall(map: MapDef, p: Vec): boolean {
  return !inBounds(map, p) || map.tiles[p.y][p.x] === 'wall'
}

// A tile you can stand on: in bounds, not a wall, not the shrine pedestal.
export function isStandable(map: MapDef, p: Vec): boolean {
  if (!inBounds(map, p)) return false
  const t = map.tiles[p.y][p.x]
  return t === 'floor' || t === 'door'
}

// Tiles occupied by living units (they block movement).
export function occupiedSet(state: GameState, ignoreUnitId?: string): Set<string> {
  const s = new Set<string>()
  for (const u of state.units) {
    if (!u.alive) continue
    if (u.id === ignoreUnitId) continue
    if (u.isStructure) continue // shrine tile already unwalkable via tile kind
    s.add(keyOf(u.pos))
  }
  return s
}

export function landmarkPos(map: MapDef, key: string): Vec | undefined {
  return map.landmarks.find((l) => l.key === key)?.pos
}
