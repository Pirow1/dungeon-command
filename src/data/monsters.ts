import type { Unit, UnitClass } from '../engine/types'

export interface MonsterDef {
  cls: UnitClass
  name: string
  hp: number
  move: number
  attack: { range: number; dmgMin: number; dmgMax: number }
  doctrine: string // fed to the monster-brain LLM
  color: number
}

export const MONSTER_DEFS: Record<string, MonsterDef> = {
  goblin: {
    cls: 'goblin',
    name: 'Goblin',
    hp: 6,
    move: 4,
    attack: { range: 1, dmgMin: 2, dmgMax: 3 },
    doctrine: 'Goblins swarm the weakest, most wounded hero. Cowardly and vicious.',
    color: 0x8bc34a,
  },
  skeleton: {
    cls: 'skeleton',
    name: 'Skeleton Archer',
    hp: 8,
    move: 3,
    attack: { range: 5, dmgMin: 2, dmgMax: 4 },
    doctrine: 'Skeleton archers keep their distance and shoot from range.',
    color: 0xbdbdbd,
  },
  orc: {
    cls: 'orc',
    name: 'Orc Brute',
    hp: 14,
    move: 3,
    attack: { range: 1, dmgMin: 3, dmgMax: 5 },
    doctrine: 'Orc brutes ignore heroes when possible and smash the shrine.',
    color: 0x795548,
  },
  demon: {
    cls: 'demon',
    name: 'Ashmaw the Demon',
    hp: 30,
    move: 3,
    attack: { range: 2, dmgMin: 4, dmgMax: 7 },
    doctrine: 'Ashmaw the demon lord hunts the strongest hero and taunts constantly.',
    color: 0xe53935,
  },
}

let monsterCounter = 0

// `scaling` comes from the wave number (see scalingForWave). It is applied at
// build time and never written back to MONSTER_DEFS — the defs are the stock
// stat line for every run, and a mutated def would leak across games.
export function makeMonster(
  kind: string,
  pos: { x: number; y: number },
  scaling?: { hpMult: number; dmgBonus: number },
): Unit {
  const def = MONSTER_DEFS[kind]
  monsterCounter++
  const hp = Math.round(def.hp * (scaling?.hpMult ?? 1))
  const bonus = scaling?.dmgBonus ?? 0
  return {
    id: `${kind}${monsterCounter}`,
    name: def.name,
    cls: def.cls,
    side: 'monsters',
    hp,
    maxHp: hp,
    pos: { ...pos },
    move: def.move,
    attack: {
      ...def.attack,
      dmgMin: def.attack.dmgMin + bonus,
      dmgMax: def.attack.dmgMax + bonus,
    },
    defending: false,
    alive: true,
  }
}

export function resetMonsterCounter(): void {
  monsterCounter = 0
}
