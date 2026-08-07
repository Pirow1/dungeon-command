// Core data model. This module (and everything in src/engine) is pure TypeScript:
// no Phaser, no DOM, no network. The engine is the single source of truth for rules.

export interface Vec {
  x: number
  y: number
}

export type Side = 'party' | 'monsters'

export type UnitClass =
  | 'fighter'
  | 'archer'
  | 'mage'
  | 'cleric'
  | 'shrine'
  | 'goblin'
  | 'skeleton'
  | 'orc'
  | 'demon'

export interface AttackProfile {
  range: number // 1 = melee (4-neighbor adjacency by chebyshev<=1)
  dmgMin: number
  dmgMax: number
}

export interface Unit {
  id: string
  name: string
  cls: UnitClass
  side: Side
  hp: number
  maxHp: number
  pos: Vec
  move: number
  attack: AttackProfile
  heal?: { range: number; amount: number } // cleric only
  defending: boolean
  alive: boolean
  isStructure?: boolean // the shrine: cannot move/act, but can be attacked
  personality?: string // one-line, used in LLM prompts
}

export type ActionType = 'move' | 'move_attack' | 'attack' | 'heal' | 'defend' | 'wait'

// An action as requested for one unit (possibly by the LLM — treat as untrusted).
export interface Action {
  unitId: string
  type: ActionType
  to?: Vec
  toLandmark?: string
  targetId?: string
  radio?: string
}

export type TileKind = 'floor' | 'wall' | 'door' | 'shrine'

export interface Landmark {
  key: string // e.g. 'north_door'
  label: string // e.g. 'the north door'
  pos: Vec
}

export interface MapDef {
  width: number
  height: number
  tiles: TileKind[][] // [y][x]
  landmarks: Landmark[]
  spawns: Record<string, Vec[]> // door key -> spawn tiles just inside
  heroStarts: Vec[]
}

export type Outcome = 'ongoing' | 'victory' | 'defeat'

export interface GameStats {
  damageDealt: Record<string, number>
  kills: Record<string, number>
  turns: number
}

export interface GameState {
  turn: number // player turn counter, starts at 1
  wave: number // last spawned wave (0 = none yet)
  totalWaves: number
  turnsSinceWave: number
  rng: number // mulberry32 state — seeded, advances deterministically
  units: Unit[]
  outcome: Outcome
  stats: GameStats
}

// Ordered, renderable record of everything that happened during a resolve step.
export type GameEvent =
  | { type: 'unit_moved'; unitId: string; path: Vec[] }
  | { type: 'unit_attacked'; unitId: string; targetId: string; ranged: boolean }
  | { type: 'damage'; targetId: string; amount: number; hpAfter: number }
  | { type: 'heal'; unitId: string; targetId: string; amount: number; hpAfter: number }
  | { type: 'unit_died'; unitId: string }
  | { type: 'defend'; unitId: string }
  | { type: 'chatter'; unitId: string; name: string; text: string; kind: 'party' | 'monster' }
  | { type: 'wave_spawned'; wave: number; unitIds: string[] }
  | { type: 'shrine_damaged'; amount: number; hpAfter: number }
  | { type: 'game_over'; outcome: Outcome }

export const SHRINE_ID = 'shrine'

export function keyOf(p: Vec): string {
  return `${p.x},${p.y}`
}

export function manhattan(a: Vec, b: Vec): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

// Range checks use Chebyshev distance so diagonal-adjacent melee feels fair on screen.
export function chebyshev(a: Vec, b: Vec): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

export function unitById(state: GameState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id)
}

export function livingUnits(state: GameState, side?: Side): Unit[] {
  return state.units.filter((u) => u.alive && (!side || u.side === side))
}

export function livingHeroes(state: GameState): Unit[] {
  return state.units.filter((u) => u.alive && u.side === 'party' && !u.isStructure)
}

export function livingMonsters(state: GameState): Unit[] {
  return state.units.filter((u) => u.alive && u.side === 'monsters')
}
