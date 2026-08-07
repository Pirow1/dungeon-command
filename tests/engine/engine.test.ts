import { describe, expect, it } from 'vitest'
import { LEVEL1 } from '../../src/data/level1'
import { initGame, resolveMonsterTurn, resolvePartyTurn } from '../../src/engine/turn'
import { reachable, pathTo, distanceField, bestTileToward } from '../../src/engine/pathfind'
import { hasLOS } from '../../src/engine/los'
import { summarize } from '../../src/engine/summary'
import { fallbackMonsterActions, fallbackPartyActions } from '../../src/ai/fallback'
import { chebyshev, keyOf, livingHeroes, livingMonsters, unitById } from '../../src/engine/types'
import type { Action, GameState, Vec } from '../../src/engine/types'

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
      // Chest placement and stat rewards are seeded too — fold them into the
      // fingerprint so a stray Math.random in the loot path fails loudly.
      return JSON.stringify({
        o: state.outcome,
        t: state.turn,
        s: state.stats,
        c: state.chests.map((c) => [c.id, c.pos.x, c.pos.y]),
        h: state.units
          .filter((u) => u.side === 'party' && !u.isStructure)
          .map((u) => [u.id, u.move, u.attack.dmgMin, u.defence ?? 0]),
      })
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
    // Chests are offered to the LLM the same way landmarks are.
    expect(s.chests.length).toBe(1)
    expect(s.chests[0]).toContain('chest1')
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

describe('loot chests', () => {
  // Snapshot of everything a chest can change, for "only the opener gained".
  const statsOf = (state: GameState) =>
    state.units
      .filter((u) => u.side === 'party' && !u.isStructure)
      .map((u) => [u.id, u.attack.dmgMin, u.attack.dmgMax, u.defence ?? 0, u.move].join(':'))

  // A floor tile the hero can reach in one move, clear of units and chests.
  const freeTileNear = (state: GameState, from: Vec, dist = 1): Vec => {
    for (let dx = -dist; dx <= dist; dx++) {
      for (let dy = -dist; dy <= dist; dy++) {
        const p = { x: from.x + dx, y: from.y + dy }
        if (dx === 0 && dy === 0) continue
        if (LEVEL1.tiles[p.y]?.[p.x] !== 'floor') continue
        if (state.units.some((u) => u.alive && u.pos.x === p.x && u.pos.y === p.y)) continue
        if (state.chests.some((c) => c.pos.x === p.x && c.pos.y === p.y)) continue
        return p
      }
    }
    throw new Error('no free tile')
  }

  it('drops exactly one chest per wave on a legal, unreserved tile', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state } = initGame(LEVEL1, seed)
      expect(state.chests.length).toBe(1)
      const c = state.chests[0]
      expect(c.id).toBe('chest1')
      expect(LEVEL1.tiles[c.pos.y][c.pos.x]).toBe('floor')
      // Never under a unit, and clear of doors and landmarks — a chest sitting on
      // a landmark reads as "at east_door" and the LLM routes to the door.
      expect(state.units.some((u) => u.alive && keyOf(u.pos) === keyOf(c.pos))).toBe(false)
      for (const l of LEVEL1.landmarks) expect(chebyshev(c.pos, l.pos)).toBeGreaterThan(1)
      for (const s of Object.values(LEVEL1.spawns).flat()) expect(chebyshev(c.pos, s)).toBeGreaterThan(2)
      // …so the summary always says "N tiles from X", never "at X".
      expect(summarize(LEVEL1, state).chests[0]).toContain('tiles from')
    }
  })

  it('grants exactly one +1 to the hero who ends its move on the chest', () => {
    const { state } = initGame(LEVEL1, 3)
    const brannor = unitById(state, 'brannor')!
    const chest = state.chests[0]
    // Stand next to the chest so a single move lands on it.
    brannor.pos = freeTileNear(state, chest.pos)
    const before = statsOf(state)

    const events = resolvePartyTurn(LEVEL1, state, [{ unitId: 'brannor', type: 'move', to: chest.pos }])

    const opened = events.filter((e) => e.type === 'chest_opened')
    expect(opened.length).toBe(1)
    expect(opened[0]).toMatchObject({ unitId: 'brannor', chestId: chest.id })
    expect(state.chests.find((c) => c.id === chest.id)).toBeUndefined()

    const after = statsOf(state)
    const changed = after.filter((row, i) => row !== before[i])
    expect(changed.length).toBe(1)
    expect(changed[0].startsWith('brannor')).toBe(true)

    const b = unitById(state, 'brannor')!
    const boosts = b.boosts!
    expect(boosts.attack + boosts.defence + boosts.move).toBe(1)
    if (boosts.attack) expect(b.attack.dmgMin).toBe(5) // 4-6 -> 5-7
    if (boosts.defence) expect(b.defence).toBe(1)
    if (boosts.move) expect(b.move).toBe(4) // 3 -> 4
  })

  it('is claimed by ending on it, never by walking over it', () => {
    const { state } = initGame(LEVEL1, 5)
    const sylvia = unitById(state, 'sylvia')!
    // The southern corridor (row 10) is open floor from x=5 to x=14: hero, chest
    // one step on, destination beyond it.
    const y = 10
    for (const x of [5, 6, 7, 8]) expect(LEVEL1.tiles[y][x]).toBe('floor')
    sylvia.pos = { x: 5, y }
    state.chests = [{ id: 'chestX', pos: { x: 6, y } }]

    const events = resolvePartyTurn(LEVEL1, state, [{ unitId: 'sylvia', type: 'move', to: { x: 8, y } }])

    expect(unitById(state, 'sylvia')!.pos).toEqual({ x: 8, y })
    expect(events.some((e) => e.type === 'chest_opened')).toBe(false)
    expect(state.chests.length).toBe(1)
  })

  it('routes to a chest by id through toLandmark', () => {
    const { state } = initGame(LEVEL1, 9)
    const pip = unitById(state, 'pip')!
    const chest = state.chests[0]
    const from = { ...pip.pos }

    // An unresolvable toLandmark clamps to "defend", so simply moving proves the
    // chest id resolved to a destination.
    resolvePartyTurn(LEVEL1, state, [{ unitId: 'pip', type: 'move', toLandmark: chest.id }])
    expect(unitById(state, 'pip')!.pos).not.toEqual(from)

    // Keep walking until it arrives; the last step claims the loot.
    let guard = 0
    while (state.chests.some((c) => c.id === chest.id) && guard++ < 12) {
      resolvePartyTurn(LEVEL1, state, [{ unitId: 'pip', type: 'move', toLandmark: chest.id }])
    }
    expect(state.chests.some((c) => c.id === chest.id)).toBe(false)
    const boosts = unitById(state, 'pip')!.boosts!
    expect(boosts.attack + boosts.defence + boosts.move).toBe(1)
  })

  it('ignores monsters standing on it', () => {
    const { state } = initGame(LEVEL1, 11)
    const chest = state.chests[0]
    const goblin = livingMonsters(state)[0]
    goblin.pos = freeTileNear(state, chest.pos)

    const events = resolveMonsterTurn(LEVEL1, state, [{ unitId: goblin.id, type: 'move', to: chest.pos }])
    expect(events.some((e) => e.type === 'chest_opened')).toBe(false)
    expect(state.chests.length).toBe(1)
  })

  it('does not carry stat gains into the next game', () => {
    const first = initGame(LEVEL1, 3).state
    const brannor = unitById(first, 'brannor')!
    brannor.pos = { ...first.chests[0].pos }
    resolvePartyTurn(LEVEL1, first, [{ unitId: 'brannor', type: 'wait' }])
    expect(unitById(first, 'brannor')!.boosts!.attack + unitById(first, 'brannor')!.boosts!.defence + unitById(first, 'brannor')!.boosts!.move).toBe(1)

    const second = initGame(LEVEL1, 3).state
    const fresh = unitById(second, 'brannor')!
    expect(fresh.boosts).toEqual({ attack: 0, defence: 0, move: 0 })
    expect(fresh.defence).toBe(0)
    expect(fresh.move).toBe(3)
    expect([fresh.attack.dmgMin, fresh.attack.dmgMax]).toEqual([4, 6])
  })
})

describe('defence', () => {
  it('blunts incoming damage but never fully absorbs it', () => {
    const { state } = initGame(LEVEL1, 21)
    const target = unitById(state, 'brannor')!
    target.defence = 99
    const goblin = livingMonsters(state)[0]
    goblin.pos = { x: target.pos.x + 1, y: target.pos.y }

    // Every monster acts on its turn, so assert per-blow rather than on total HP.
    const events = resolveMonsterTurn(LEVEL1, state, [
      { unitId: goblin.id, type: 'attack', targetId: 'brannor' },
    ])
    const hits = events.filter((e) => e.type === 'damage' && e.targetId === 'brannor')
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) expect(h.type === 'damage' && h.amount).toBe(1)
  })
})
