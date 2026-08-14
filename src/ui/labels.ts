// Display names for the log and the HUD.
//
// Every goblin in the engine is called "Goblin" (the ids are goblin1, goblin2…),
// so "Brannor cleaves Goblin" tells the player nothing about WHICH goblin the
// party just committed to. A stable per-class letter fixes that: "Goblin A".

import type { GameState, MapDef, Unit } from '../engine/types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Classes that only ever have one instance keep their bare name. Demons are NOT
// unique in endless mode — a boss wave arrives every fifth wave and a slow clear
// can leave two on the board at once, so they take letters like everything else.
const UNIQUE = new Set(['shrine'])

const assigned = new Map<string, string>()
const perClass = new Map<string, number>()

export function resetLabels(): void {
  assigned.clear()
  perClass.clear()
}

// Where a hero is headed, for the "-> west hall" readout. A move takes several
// turns and its first leg can point the wrong way (the shrine chamber only
// opens north and south), so the destination has to be visible or the hero
// looks like it ignored the order.
export function destinationLabel(map: MapDef, state: GameState, key: string): string | undefined {
  const landmark = map.landmarks.find((l) => l.key === key)
  if (landmark) return landmark.label.replace(/^the /, '')
  if (state.chests.some((c) => c.id === key)) return `the ${key}`
  return undefined
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
