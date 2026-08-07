import type { MapDef, Vec } from './types'
import { isWall } from './map'

// Bresenham line between tile centers; LOS is blocked if any intermediate
// tile (excluding both endpoints) is a wall.
export function lineBetween(a: Vec, b: Vec): Vec[] {
  const points: Vec[] = []
  let x0 = a.x
  let y0 = a.y
  const x1 = b.x
  const y1 = b.y
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    points.push({ x: x0, y: y0 })
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
  return points
}

export function hasLOS(map: MapDef, a: Vec, b: Vec): boolean {
  const line = lineBetween(a, b)
  for (let i = 1; i < line.length - 1; i++) {
    if (isWall(map, line[i])) return false
  }
  return true
}
