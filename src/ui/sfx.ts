// Plain HTMLAudio SFX. Deliberately not Phaser's audio manager: these fire from
// the DOM layer too (UI clicks), and a small pool avoids re-decoding per play.

const NAMES = [
  'melee',
  'arrow',
  'magic',
  'hit',
  'die',
  'heal',
  'defend',
  'shrine_hit',
  'wave',
  'door',
  'click',
] as const

export type SfxName = (typeof NAMES)[number]

const POOL_SIZE = 3
const VOLUMES: Partial<Record<SfxName, number>> = {
  melee: 0.45,
  arrow: 0.3,
  magic: 0.4,
  hit: 0.35,
  die: 0.5,
  heal: 0.35,
  defend: 0.3,
  shrine_hit: 0.55,
  wave: 0.5,
  door: 0.35,
  click: 0.25,
}

const pools = new Map<SfxName, HTMLAudioElement[]>()
const cursor = new Map<SfxName, number>()
let enabled = true

export function initSfx(): void {
  for (const name of NAMES) {
    const list: HTMLAudioElement[] = []
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(`/assets/audio/${name}.ogg`)
      a.preload = 'auto'
      a.volume = VOLUMES[name] ?? 0.4
      list.push(a)
    }
    pools.set(name, list)
    cursor.set(name, 0)
  }
}

export function setSfxEnabled(on: boolean): void {
  enabled = on
}

export function sfx(name: SfxName, rateJitter = true): void {
  if (!enabled) return
  const list = pools.get(name)
  if (!list) return
  const i = (cursor.get(name) ?? 0) % list.length
  cursor.set(name, i + 1)
  const a = list[i]
  try {
    a.currentTime = 0
    a.playbackRate = rateJitter ? 0.92 + Math.random() * 0.16 : 1
    void a.play().catch(() => {})
  } catch {
    /* autoplay policy — ignore */
  }
}
