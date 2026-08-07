// Display names for the log and the HUD.
//
// Every goblin in the engine is called "Goblin" (the ids are goblin1, goblin2…),
// so "Brannor cleaves Goblin" tells the player nothing about WHICH goblin the
// party just committed to. A stable per-class letter fixes that: "Goblin A".

import type { Unit } from '../engine/types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Classes that only ever have one instance keep their bare name.
const UNIQUE = new Set(['demon', 'shrine'])

const assigned = new Map<string, string>()
const perClass = new Map<string, number>()

export function resetLabels(): void {
  assigned.clear()
  perClass.clear()
}

export function displayName(u: Pick<Unit, 'id' | 'name' | 'cls' | 'side'>): string {
  if (u.side !== 'monsters' || UNIQUE.has(u.cls)) return u.name
  let label = assigned.get(u.id)
  if (!label) {
    const n = (perClass.get(u.cls) ?? 0) + 1
    perClass.set(u.cls, n)
    label = `${u.name} ${LETTERS[(n - 1) % LETTERS.length]}`
    assigned.set(u.id, label)
  }
  return label
}
