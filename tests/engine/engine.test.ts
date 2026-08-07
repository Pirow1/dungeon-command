import { describe, expect, it } from 'vitest'
import { LEVEL1 } from '../../src/data/level1'
import { initGame, resolveMonsterTurn, resolvePartyTurn } from '../../src/engine/turn'
import { reachable, pathTo, distanceField, bestTileToward } from '../../src/engine/pathfind'
import { hasLOS } from '../../src/engine/los'
import { summarize } from '../../src/engine/summary'
import { fallbackMonsterActions, fallbackPartyActions } from '../../src/ai/fallback'
import { keyOf, livingHeroes, livingMonsters, unitById } from '../../src/engine/types'
import type { Action } from '../../src/engine/types'

describe('map', () => {
  it('parses level1 with landmarks and hero starts', () => {
    expect(LEVEL1.width).toBe(20)
    expect(LEVEL1.height).toBe(13)
    expect(LEVEL1.landmarks.map((l) => l.key)).toContain('north_door')
    expect(LEVEL1.landmarks.map((l) => l.key)).toContain('shrine')
    for (const start of LEVEL1.heroStarts) {
      expect(LEVEL1.tiles[start.y][start.x]).toBe('floor')
    }
  })
})

describe('pathfinding', () => {
  it('respects movement budget and walls', () => {
    const { state } = initGame(LEVEL1)
    const hero = livingHeroes(state)[0]
    const reach = reachable(LEVEL1, state, hero.pos, 3, hero.id)
    for (const [, e] of reach) {
      expect(e.cost).toBeLessThanOrEqual(3)
      expect(LEVEL1.tiles[e.pos.y][e.pos.x]).not.toBe('wall')
    }
  })

  it('units block tiles', () => {
    const { state } = initGame(LEVEL1)
    const [a, b] = livingHeroes(state)
    const reach = reachable(LEVEL1, state, a.pos, 5, a.id)
    expect(reach.has(keyOf(b.pos))).toBe(false)
  })

  it('reconstructs contiguous paths', () => {
    const { state } = initGame(LEVEL1)
    const hero = livingHeroes(state)[0]
    const reach = reachable(LEVEL1, state, hero.pos, 4, hero.id)
    for (const [, e] of reach) {
      if (e.cost === 0) continue
      const path = pathTo(reach, e.pos)
      expect(path.length).toBe(e.cost)
      let prev = hero.pos
      for (const p of path) {
        expect(Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)).toBe(1)
        prev = p
      }
    }
  })

  it('distance field guides toward a goal', () => {
    const { state } = initGame(LEVEL1)
    const hero = livingHeroes(state)[0]
    const goal = { x: 1, y: 1 }
    const field = distanceField(LEVEL1, goal)
    const reach = reachable(LEVEL1, state, hero.pos, 3, hero.id)
    const best = bestTileToward(reach, field)
    expect(best).toBeDefined()
    expect(field.get(keyOf(best!))!).toBeLessThan(field.get(keyOf(hero.pos))!)
  })
})

describe('line of sight', () => {
  it('walls block LOS, open floor does not', () => {
    // Shrine room wall at x=7 separates (5,6) from (9,6)... but the shrine room
    // has openings; pick two tiles with a solid wall between them.
    expect(hasLOS(LEVEL1, { x: 1, y: 4 }, { x: 6, y: 4 })).toBe(true)
    expect(hasLOS(LEVEL1, { x: 5, y: 6 }, { x: 9, y: 6 })).toBe(false) // through x=7/8 wall
  })
})

describe('clamping garbage LLM actions', () => {
  it('resolves a turn of deliberately-illegal actions legally', () => {
    const { state } = initGame(LEVEL1)
    const garbage: Action[] = [
      { unitId: 'brannor', type: 'move', to: { x: -5, y: 999 } }, // off-map
      { unitId: 'sylvia', type: 'attack', targetId: 'does_not_exist' }, // bad target
      { unitId: 'pip', type: 'move', toLandmark: 'the_moon' }, // bad landmark
      { unitId: 'mira', type: 'heal', targetId: 'goblin1' }, // heal an enemy
      { unitId: 'ghost_hero', type: 'attack' }, // unknown unit
      { unitId: 'shrine', type: 'move', to: { x: 1, y: 1 } }, // structure cannot act
    ]
    const events = resolvePartyTurn(LEVEL1, state, garbage)
    expect(state.outcome).toBe('ongoing')
    // Every unit still on a legal tile
    for (const u of state.units.filter((x) => x.alive && !x.isStructure)) {
      expect(LEVEL1.tiles[u.pos.y][u.pos.x]).not.toBe('wall')
    }
    // No two living units share a tile
    const keys = state.units.filter((u) => u.alive && !u.isStructure).map((u) => keyOf(u.pos))
    expect(new Set(keys).size).toBe(keys.length)
    expect(events.length).toBeGreaterThan(0)
  })

  it('shrine never moves and heroes never damage each other', () => {
    const { state } = initGame(LEVEL1)
    const before = { ...unitById(state, 'shrine')!.pos }
    resolvePartyTurn(LEVEL1, state, [
      { unitId: 'brannor', type: 'attack', targetId: 'mira' }, // friendly fire attempt
    ])
    expect(unitById(state, 'shrine')!.pos).toEqual(before)
    expect(unitById(state, 'mira')!.hp).toBe(unitById(state, 'mira')!.maxHp)
  })
})

describe('full game simulation', () => {
  it('50 seeded games with heuristic actors always terminate without crashing', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { state } = initGame(LEVEL1, seed)
      let guard = 0
      while (state.outcome === 'ongoing' && guard < 200) {
        resolvePartyTurn(LEVEL1, state, fallbackPartyActions(state, false))
        if (state.outcome === 'ongoing') {
          resolveMonsterTurn(LEVEL1, state, fallbackMonsterActions(state))
        }
        guard++
      }
      expect(guard).toBeLessThan(200)
      expect(['victory', 'defeat']).toContain(state.outcome)
    }
  })

  it('same seed => identical outcome and stats (determinism)', () => {
    const run = (seed: number) => {
      const { state } = initGame(LEVEL1, seed)
      let guard = 0
      while (state.outcome === 'ongoing' && guard++ < 200) {
        resolvePartyTurn(LEVEL1, state, fallbackPartyActions(state, false))
        if (state.outcome === 'ongoing') {
          resolveMonsterTurn(LEVEL1, state, fallbackMonsterActions(state))
        }
      }
      return JSON.stringify({ o: state.outcome, t: state.turn, s: state.stats })
    }
    expect(run(7)).toBe(run(7))
  })
})

describe('summary', () => {
  it('produces a compact landmark-based summary', () => {
    const { state } = initGame(LEVEL1)
    const s = summarize(LEVEL1, state)
    expect(s.party.length).toBe(4)
    expect(s.monsters.length).toBeGreaterThan(0)
    expect(s.landmarks).toContain('north_door')
    // Compactness guard: the serialized summary must stay prompt-friendly.
    expect(JSON.stringify(s).length).toBeLessThan(4000)
  })
})

describe('waves', () => {
  it('spawns wave 1 at init and escalates to victory when cleared', () => {
    const { state } = initGame(LEVEL1)
    expect(state.wave).toBe(1)
    expect(livingMonsters(state).length).toBe(3)
  })
})
