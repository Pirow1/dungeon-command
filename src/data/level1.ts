import type { MapDef, TileKind, Vec, Landmark } from '../engine/types'

// The Shrine of Emberdeep. 20x13. ASCII legend:
//   # wall   . floor   D door tile (monsters enter here)   O shrine
//   1-4 hero start positions
// Three approaches: north corridor, east hall, west hall — all lead to the shrine room.
const ASCII = [
  '#########DD#########',
  '#...#......#...#...#',
  '#...#..........#...#',
  '#.###..##..##..###.#',
  '#......#....#......#',
  '#..##..#.13.#..##..#',
  'D......#.O..#......D',
  '#..##..#.24.#..##..#',
  '#......#....#......#',
  '#.###..##..##..###.#',
  '#...#..........#...#',
  '#...#....#.....#...#',
  '####################',
]

function parse(): MapDef {
  const height = ASCII.length
  const width = ASCII[0].length
  const tiles: TileKind[][] = []
  const heroStarts: Vec[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]
  const doorTiles: Vec[] = []
  let shrine: Vec = { x: 10, y: 6 }

  for (let y = 0; y < height; y++) {
    const row: TileKind[] = []
    for (let x = 0; x < width; x++) {
      const ch = ASCII[y][x]
      if (ch === '#') row.push('wall')
      else if (ch === 'D') {
        row.push('door')
        doorTiles.push({ x, y })
      } else if (ch === 'O') {
        row.push('shrine')
        shrine = { x, y }
      } else {
        row.push('floor')
        if (ch >= '1' && ch <= '4') heroStarts[Number(ch) - 1] = { x, y }
      }
    }
    tiles.push(row)
  }

  const north = doorTiles.filter((d) => d.y === 0)
  const west = doorTiles.find((d) => d.x === 0)!
  const east = doorTiles.find((d) => d.x === width - 1)!

  const landmarks: Landmark[] = [
    { key: 'shrine', label: 'the shrine', pos: shrine },
    { key: 'north_door', label: 'the north door', pos: { x: north[0].x, y: 1 } },
    { key: 'west_door', label: 'the west door', pos: { x: 1, y: west.y } },
    { key: 'east_door', label: 'the east door', pos: { x: width - 2, y: east.y } },
    { key: 'shrine_room', label: 'the shrine room', pos: { x: shrine.x - 1, y: shrine.y } },
  ]

  const spawns: Record<string, Vec[]> = {
    north_door: north.map((d) => ({ x: d.x, y: 1 })),
    west_door: [{ x: 1, y: west.y }],
    east_door: [{ x: width - 2, y: east.y }],
  }

  return { width, height, tiles, landmarks, spawns, heroStarts }
}

export const LEVEL1: MapDef = parse()
