import { describe, expect, it } from 'vitest'
import { LEVEL1 } from '../../src/data/level1'
import { initGame, resolveMonsterTurn, resolvePartyTurn } from '../../src/engine/turn'
import { reachable, pathTo, distanceField, bestTileToward } from '../../src/engine/pathfind'
import { hasLOS } from '../../src/engine/los'
import { isStandable } from '../../src/engine/map'
import { summarize } from '../../src/engine/summary'
import { fallbackMonsterActions, fallbackPartyActions } from '../../src/ai/fallback'
import { chebyshev, keyOf, livingHeroes, livingMonsters, unitById } from '../../src/engine/types'
import type { Action, GameState, Vec } from '../../src/engine/types'
import {
  MAX_ALIVE,
  MAX_TURNS_PER_WAVE,
  MONSTER_UNLOCK,
  scalingForWave,
  shouldSpawnWave,
} from '../../src/engine/waves'
import { MONSTER_DEFS, makeMonster } from '../../src/data/monsters'
import { rollChestReward } from '../../src/engine/chests'

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

  it('gives every direction a hall to aim at, and every landmark a standable tile', () => {
    const keys = LEVEL1.landmarks.map((l) => l.key)
    for (const hall of ['north_hall', 'south_hall', 'west_hall', 'east_hall']) {
      expect(keys).toContain(hall)
    }
    // A landmark on a wall would silently degrade every order that names it:
    // moveToward falls back to "closest reachable tile" and the hero drifts.
    // (The shrine landmark is the one tile heroes stand BESIDE, not on.)
    for (const l of LEVEL1.landmarks) {
      expect(LEVEL1.tiles[l.pos.y][l.pos.x]).not.toBe('wall')
      if (l.key !== 'shrine') expect(isStandable(LEVEL1, l.pos)).toBe(true)
    }
    // The halls sit off the doors, so "hold the west" is not "stand in the
    // monster entrance".
    const doors = LEVEL1.landmarks.filter((l) => l.key.endsWith('_door'))
    for (const hall of LEVEL1.landmarks.filter((l) => l.key.endsWith('_hall'))) {
      for (const d of doors) expect(chebyshev(hall.pos, d.pos)).toBeGreaterThan(1)
    }
  })

  it('routes a hero out of the walled shrine chamber to a hall it cannot reach directly', () => {
    const { state } = initGame(LEVEL1, 7)
    const hero = unitById(state, 'brannor')!
    const west = LEVEL1.landmarks.find((l) => l.key === 'west_hall')!
    const startDist = chebyshev(hero.pos, west.pos)
    // Several turns: the chamber only opens north and south, so the first leg
    // legitimately walks AWAY from a westward destination.
    for (let i = 0; i < 6; i++) {
      resolvePartyTurn(LEVEL1, state, [{ unitId: 'brannor', type: 'move', toLandmark: 'west_hall' }])
    }
    expect(chebyshev(hero.pos, west.pos)).toBeLessThan(startDist)
    expect(keyOf(hero.pos)).toBe(keyOf(west.pos))
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
      while (state.outcome === 'ongoing' && guard < 300) {
        resolvePartyTurn(LEVEL1, state, fallbackPartyActions(state, false))
        if (state.outcome === 'ongoing') {
          resolveMonsterTurn(LEVEL1, state, fallbackMonsterActions(state))
        }
        guard++
      }
      expect(guard).toBeLessThan(300)
      // There is nothing to win: the scaling curve outruns every source of
      // healing, so every run must end in defeat rather than stall forever.
      expect(state.outcome).toBe('defeat')
    }
  })

  it('same seed => identical outcome and stats (determinism)', () => {
    const run = (seed: number) => {
      const { state } = initGame(LEVEL1, seed)
      let guard = 0
      while (state.outcome === 'ongoing' && guard++ < 300) {
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

describe('endless waves', () => {
  // Drives the generator forward without playing: clears the board and runs a
  // no-op party turn, which is what triggers the next wave.
  const advanceTo = (state: GameState, wave: number) => {
    let guard = 0
    while (state.wave < wave && guard++ < 200) {
      for (const m of livingMonsters(state)) {
        m.hp = 0
        m.alive = false
      }
      resolvePartyTurn(LEVEL1, state, [])
    }
    return state
  }

  it('spawns wave 1 at init', () => {
    const { state } = initGame(LEVEL1)
    expect(state.wave).toBe(1)
    expect(livingMonsters(state).length).toBe(3)
  })

  it('never spawns a kind before its unlock wave', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = initGame(LEVEL1, seed)
      for (let wave = 1; wave <= 12; wave++) {
        advanceTo(state, wave)
        for (const m of livingMonsters(state)) {
          expect(MONSTER_UNLOCK[m.cls]).toBeLessThanOrEqual(wave)
        }
      }
    }
  })

  it('leads every fifth wave with a demon', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { state } = initGame(LEVEL1, seed)
      for (const wave of [5, 10, 15]) {
        advanceTo(state, wave)
        expect(livingMonsters(state).some((m) => m.cls === 'demon')).toBe(true)
      }
    }
  })

  it('keeps the board under the horde cap the monster LLM can answer for', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = initGame(LEVEL1, seed)
      for (let wave = 1; wave <= 20; wave++) {
        advanceTo(state, wave)
        expect(livingMonsters(state).length).toBeLessThanOrEqual(MAX_ALIVE)
      }
    }
  })

  it('holds a saturated board rather than stacking another wave on it', () => {
    const { state } = initGame(LEVEL1, 4)
    advanceTo(state, 3)
    // Board full and the stall timer expired: the wave must wait.
    while (livingMonsters(state).length < MAX_ALIVE) {
      state.units.push(makeMonster('goblin', { x: 1, y: 1 }))
    }
    state.turnsSinceWave = MAX_TURNS_PER_WAVE + 5
    expect(shouldSpawnWave(state)).toBe(false)
  })

  it('leaves monsters stock until the first demon, then thickens them', () => {
    expect(scalingForWave(5)).toEqual({ hpMult: 1, dmgBonus: 0 })
    const stock = makeMonster('goblin', { x: 1, y: 1 })
    const late = makeMonster('goblin', { x: 1, y: 1 }, scalingForWave(15))
    expect(late.maxHp).toBeGreaterThan(stock.maxHp)
    expect(late.hp).toBe(late.maxHp)
    expect(late.attack.dmgMin).toBeGreaterThan(stock.attack.dmgMin)
    // The stat block itself must never be written back to.
    expect(MONSTER_DEFS.goblin.hp).toBe(stock.maxHp)
  })

  it('calls one fallen hero back when a boss wave is cleared', () => {
    const { state } = initGame(LEVEL1, 6)
    advanceTo(state, 5)
    const pip = unitById(state, 'pip')!
    pip.hp = 0
    pip.alive = false

    for (const m of livingMonsters(state)) {
      m.hp = 0
      m.alive = false
    }
    const events = resolvePartyTurn(LEVEL1, state, [])

    const revived = events.filter((e) => e.type === 'unit_revived')
    expect(revived.length).toBe(1)
    expect(revived[0]).toMatchObject({ unitId: 'pip' })
    expect(unitById(state, 'pip')!.alive).toBe(true)
    // Half strength, plus the breather heal every survivor gets.
    expect(unitById(state, 'pip')!.hp).toBeGreaterThanOrEqual(Math.floor(pip.maxHp / 2))
    expect(unitById(state, 'pip')!.hp).toBeLessThan(pip.maxHp)
  })

  it('does not revive on an ordinary wave', () => {
    const { state } = initGame(LEVEL1, 6)
    advanceTo(state, 3)
    const pip = unitById(state, 'pip')!
    pip.hp = 0
    pip.alive = false
    for (const m of livingMonsters(state)) {
      m.hp = 0
      m.alive = false
    }
    const events = resolvePartyTurn(LEVEL1, state, [])
    expect(events.some((e) => e.type === 'unit_revived')).toBe(false)
    expect(unitById(state, 'pip')!.alive).toBe(false)
  })
})

describe('stats', () => {
  it('records damage taken as well as dealt', () => {
    const { state } = initGame(LEVEL1, 21)
    const target = unitById(state, 'brannor')!
    const goblin = livingMonsters(state)[0]
    goblin.pos = { x: target.pos.x + 1, y: target.pos.y }

    // The whole horde acts on its turn, so tally the blows that actually landed
    // on Brannor rather than assuming only the named goblin reached him.
    const events = resolveMonsterTurn(LEVEL1, state, [
      { unitId: goblin.id, type: 'attack', targetId: 'brannor' },
    ])
    const landed = events
      .filter((e) => e.type === 'damage' && e.targetId === 'brannor')
      .reduce((a, e) => a + (e.type === 'damage' ? e.amount : 0), 0)
    expect(landed).toBeGreaterThan(0)
    expect(state.stats.damageTaken['brannor']).toBe(landed)
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
    expect(opened[0].type === 'chest_opened' && opened[0].reward).toMatchObject({ kind: 'stat', amount: 1 })
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

  it('pays out richer the deeper the run goes', () => {
    const { state } = initGame(LEVEL1, 13)
    const hero = unitById(state, 'brannor')!
    // Wounded, so heal rolls are not converted away by the low-value guard.
    hero.hp = 4

    const sample = (wave: number) => {
      state.wave = wave
      const kinds = new Set<string>()
      for (let i = 0; i < 60; i++) {
        const r = rollChestReward(state, hero)
        kinds.add(r.kind === 'heal' ? 'heal' : `stat${r.amount}`)
      }
      return kinds
    }

    // Early: nothing but the original +1. Later: bigger stats and healing.
    expect([...sample(2)]).toEqual(['stat1'])
    expect(sample(6).has('heal')).toBe(true)
    expect(sample(6).has('stat2')).toBe(false)
    const deep = sample(10)
    expect(deep.has('stat2')).toBe(true)
    expect(deep.has('stat1')).toBe(false)
  })

  it('never hands a heal to a hero with nothing to heal', () => {
    const { state } = initGame(LEVEL1, 17)
    const hero = unitById(state, 'brannor')!
    state.wave = 14 // deepest tier: half the pool is a full heal
    hero.hp = hero.maxHp
    for (let i = 0; i < 40; i++) {
      expect(rollChestReward(state, hero).kind).toBe('stat')
    }
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
