import type { Action, GameState, MapDef } from '../engine/types'
import { SHRINE_ID, chebyshev, livingHeroes, livingMonsters, unitById } from '../engine/types'
import { HEROES } from '../data/heroes'

// Deterministic heuristic actors — used when the LLM fails, times out, or is
// disabled. The game is fully playable on these alone.

let cannedIdx = 0
function cannedLine(heroId: string): string {
  const hero = HEROES.find((h) => h.id === heroId)
  if (!hero) return ''
  cannedIdx++
  return hero.cannedLines[cannedIdx % hero.cannedLines.length]
}

export function fallbackPartyActions(state: GameState, withRadio = true): Action[] {
  const monsters = livingMonsters(state)
  return livingHeroes(state).map((h) => {
    if (h.heal) {
      const wounded = livingHeroes(state)
        .filter((a) => a.hp / a.maxHp < 0.6)
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]
      if (wounded) {
        return {
          unitId: h.id,
          type: 'heal' as const,
          targetId: wounded.id,
          radio: withRadio ? cannedLine(h.id) : undefined,
        }
      }
    }
    if (!monsters.length) return { unitId: h.id, type: 'defend' as const }
    let nearest = monsters[0]
    for (const m of monsters) {
      if (chebyshev(h.pos, m.pos) < chebyshev(h.pos, nearest.pos)) nearest = m
    }
    return {
      unitId: h.id,
      type: 'move_attack' as const,
      targetId: nearest.id,
      radio: withRadio ? cannedLine(h.id) : undefined,
    }
  })
}

export function fallbackMonsterActions(state: GameState): Action[] {
  const heroes = livingHeroes(state)
  const shrine = unitById(state, SHRINE_ID)
  return livingMonsters(state).map((m) => {
    // Orcs push the shrine; everyone else hunts the weakest reachable hero.
    if (m.cls === 'orc' && shrine?.alive) {
      return { unitId: m.id, type: 'move_attack' as const, targetId: SHRINE_ID }
    }
    if (!heroes.length) return { unitId: m.id, type: 'move_attack' as const, targetId: SHRINE_ID }
    let target = heroes[0]
    for (const h of heroes) {
      const better =
        h.hp / h.maxHp < target.hp / target.maxHp ||
        (h.hp / h.maxHp === target.hp / target.maxHp &&
          chebyshev(m.pos, h.pos) < chebyshev(m.pos, target.pos))
      if (better) target = h
    }
    return { unitId: m.id, type: 'move_attack' as const, targetId: target.id }
  })
}
