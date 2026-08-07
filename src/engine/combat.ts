import type { GameState } from './types'

// mulberry32 — tiny seeded PRNG. State lives in GameState.rng so every run is
// reproducible from its seed (deterministic tests + replays).
export function nextFloat(state: GameState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0
  let t = state.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function randInt(state: GameState, min: number, max: number): number {
  return min + Math.floor(nextFloat(state) * (max - min + 1))
}

export function rollDamage(state: GameState, dmgMin: number, dmgMax: number, targetDefending: boolean): number {
  const raw = randInt(state, dmgMin, dmgMax)
  return targetDefending ? Math.max(1, Math.ceil(raw / 2)) : raw
}
