import type { GameState } from '../engine/types'
import { SHRINE_ID, livingMonsters, unitById } from '../engine/types'
import { HEROES } from '../data/heroes'
import { UNIT_FRAME } from '../spritemap'
import { displayName } from './labels'

const CLS_LABEL: Record<string, string> = {
  fighter: 'Dwarf Fighter',
  archer: 'Rogue Archer',
  mage: 'Rookie Mage',
  cleric: 'Battle Cleric',
}

let portraits: Record<number, string> = {}
const lastAction = new Map<string, string>()

export function setPortraits(p: Record<number, string>): void {
  portraits = p
  buildCards()
}

export function portraitFor(cls: string): string {
  return portraits[UNIT_FRAME[cls]] ?? ''
}

function buildCards(): void {
  const wrap = document.getElementById('hero-cards')!
  wrap.innerHTML = ''
  for (const h of HEROES) {
    const card = document.createElement('div')
    card.className = 'hero-card'
    card.id = `card-${h.id}`
    card.innerHTML = `
      <img src="${portraitFor(h.cls)}" alt="${h.name}" />
      <div class="info">
        <div class="nm"><span>${h.name}</span><span class="cls">${CLS_LABEL[h.cls] ?? h.cls}</span></div>
        <div class="bar hp"><i id="hp-${h.id}" style="width:100%"></i></div>
        <div class="nm"><span class="last" id="last-${h.id}">Ready.</span><span class="hpnum" id="hpnum-${h.id}">${h.maxHp}/${h.maxHp}</span></div>
        <div class="statline" id="stats-${h.id}"></div>
      </div>`
    wrap.appendChild(card)
  }
}

export function noteAction(unitId: string, text: string): void {
  lastAction.set(unitId, text)
}

export function updateHud(state: GameState): void {
  document.getElementById('wave-num')!.textContent = String(state.wave)
  document.getElementById('wave-total')!.textContent = String(state.totalWaves)
  document.getElementById('turn-num')!.textContent = String(state.turn)
  const shrine = unitById(state, SHRINE_ID)!
  document.getElementById('shrine-hp')!.textContent = `${shrine.hp}/${shrine.maxHp}`
  document.getElementById('shrine-bar')!.style.width = `${(100 * shrine.hp) / shrine.maxHp}%`
  for (const h of HEROES) {
    const u = unitById(state, h.id)
    if (!u) continue
    const card = document.getElementById(`card-${h.id}`)!
    card.classList.toggle('dead', !u.alive)
    const ratio = Math.max(0, u.hp / u.maxHp)
    const bar = document.getElementById(`hp-${h.id}`)!
    bar.style.width = `${ratio * 100}%`
    bar.className = ratio <= 0.3 ? 'critical' : ratio <= 0.65 ? 'hurt' : ''
    document.getElementById(`hpnum-${h.id}`)!.textContent = u.alive ? `${u.hp}/${u.maxHp}` : 'fallen'
    const last = document.getElementById(`last-${h.id}`)!
    last.textContent = u.alive ? (lastAction.get(h.id) ?? 'Ready.') : 'Has fallen…'
    // Base values are the truth; `boosts` only decides which numbers glow gold.
    const b = u.boosts ?? { attack: 0, defence: 0, move: 0 }
    document.getElementById(`stats-${h.id}`)!.innerHTML =
      `<span class="${b.attack ? 'up' : ''}">ATK <b>${u.attack.dmgMin}-${u.attack.dmgMax}</b></span>` +
      `<span class="${b.defence ? 'up' : ''}">DEF <b>${u.defence ?? 0}</b></span>` +
      `<span class="${b.move ? 'up' : ''}">MOV <b>${u.move}</b></span>`
  }
  updateHorde(state)
}

// The horde is listed monster by monster, not as a tally: the player needs to
// see WHICH enemy the party just wounded, and watch that specific bar drain.
function updateHorde(state: GameState): void {
  const list = document.getElementById('horde-list')
  if (!list) return
  const alive = livingMonsters(state)
  document.getElementById('horde-count')!.textContent = alive.length ? String(alive.length) : ''

  const quiet = list.querySelector('.quiet')
  if (!alive.length) {
    if (!quiet && !list.querySelector('.horde-row')) list.appendChild(stillness())
  } else if (quiet) {
    quiet.remove()
  }

  for (const m of alive) {
    let row = list.querySelector<HTMLElement>(`[data-id="${m.id}"]`)
    if (!row) {
      row = document.createElement('div')
      row.className = 'horde-row'
      row.dataset.id = m.id
      row.innerHTML = `
        <img src="${portraitFor(m.cls)}" alt="" />
        <span class="nm">${displayName(m)}</span>
        <div class="bar hp"><i></i></div>
        <span class="hpnum"></span>`
      list.appendChild(row)
    }
    setBar(row, m.hp, m.maxHp)
  }

  for (const row of list.querySelectorAll<HTMLElement>('.horde-row')) {
    const u = unitById(state, row.dataset.id!)
    if (!u || !u.alive) markSlain(row.dataset.id!)
  }
}

function setBar(row: HTMLElement, hp: number, maxHp: number): void {
  const ratio = Math.max(0, hp / maxHp)
  const bar = row.querySelector<HTMLElement>('.bar > i')!
  bar.style.width = `${ratio * 100}%`
  bar.className = ratio <= 0.3 ? 'critical' : ratio <= 0.65 ? 'hurt' : ''
  row.querySelector('.hpnum')!.textContent = `${Math.max(0, hp)}/${maxHp}`
}

// Restarting a CSS animation needs the class off for a frame.
function flash(node: HTMLElement | null, cls: string): void {
  if (!node) return
  node.classList.remove(cls)
  void node.offsetWidth
  node.classList.add(cls)
  window.setTimeout(() => node.classList.remove(cls), 700)
}

function nodeFor(unitId: string): HTMLElement | null {
  if (unitId === SHRINE_ID) return document.getElementById('shrine-box')
  return (
    document.getElementById(`card-${unitId}`) ??
    document.querySelector<HTMLElement>(`#horde-list [data-id="${unitId}"]`)
  )
}

// The unit that just acted, lit on its card/row — so the sidebar shows the same
// exchange the map is animating.
export function pulseActor(unitId: string): void {
  flash(nodeFor(unitId), 'acting')
}

// The unit that just took the blow: bar drops live, mid-animation.
export function pulseTarget(unitId: string, hpAfter: number, maxHp: number, healed = false): void {
  const node = nodeFor(unitId)
  if (!node) return
  flash(node, healed ? 'mended' : 'hit')
  if (node.classList.contains('horde-row')) {
    setBar(node, hpAfter, maxHp)
  } else if (unitId === SHRINE_ID) {
    document.getElementById('shrine-hp')!.textContent = `${hpAfter}/${maxHp}`
    document.getElementById('shrine-bar')!.style.width = `${(100 * hpAfter) / maxHp}%`
  } else {
    const ratio = Math.max(0, hpAfter / maxHp)
    const bar = document.getElementById(`hp-${unitId}`)
    if (bar) {
      bar.style.width = `${ratio * 100}%`
      bar.className = ratio <= 0.3 ? 'critical' : ratio <= 0.65 ? 'hurt' : ''
      document.getElementById(`hpnum-${unitId}`)!.textContent = `${Math.max(0, hpAfter)}/${maxHp}`
    }
  }
}

// A chest just paid out: draw the eye to the statline that changed.
export function flashStat(unitId: string): void {
  flash(document.getElementById(`stats-${unitId}`), 'looted')
}

export function markSlain(unitId: string): void {
  const row = document.querySelector<HTMLElement>(`#horde-list [data-id="${unitId}"]`)
  if (!row || row.classList.contains('slain')) return
  row.classList.add('slain')
  window.setTimeout(() => {
    const list = row.parentElement
    row.remove()
    if (list && !list.children.length) list.appendChild(stillness())
  }, 600)
}

function stillness(): HTMLElement {
  const s = document.createElement('span')
  s.className = 'quiet'
  s.textContent = 'The halls are still.'
  return s
}

export type Phase = 'awaiting' | 'scrying' | 'heroes' | 'horde'

const PHASE_LABEL: Record<Phase, string> = {
  awaiting: 'YOUR COMMAND',
  scrying: 'THE ORB CLOUDS…',
  heroes: 'HEROES ACT',
  horde: 'THE HORDE STIRS',
}

export function setPhase(p: Phase): void {
  const chip = document.getElementById('phase-chip')!
  chip.className = p
  chip.textContent = PHASE_LABEL[p]
  const canOrder = p === 'awaiting'
  ;(document.getElementById('send-btn') as HTMLButtonElement).disabled = !canOrder
  ;(document.getElementById('ptt') as HTMLButtonElement).disabled = !canOrder
}

export function showBanner(text: string): void {
  const b = document.getElementById('banner')!
  b.textContent = text
  b.classList.remove('show')
  void b.offsetWidth // restart animation
  b.classList.add('show')
}

export function showEnd(state: GameState): void {
  const overlay = document.getElementById('end-overlay')!
  const title = document.getElementById('end-title')!
  const stats = document.getElementById('end-stats')!
  const victory = state.outcome === 'victory'
  title.textContent = victory ? 'THE SHRINE STANDS' : 'DARKNESS FALLS'
  title.className = victory ? '' : 'defeat'
  let mvp = ''
  let mvpDmg = -1
  for (const h of HEROES) {
    const d = state.stats.damageDealt[h.id] ?? 0
    if (d > mvpDmg) {
      mvpDmg = d
      mvp = h.name
    }
  }
  const kills = Object.entries(state.stats.kills)
    .filter(([id]) => HEROES.some((h) => h.id === id))
    .reduce((a, [, k]) => a + k, 0)
  stats.innerHTML = `Held for <b>${state.turn}</b> turns · <b>${kills}</b> monsters slain<br/>MVP: <b>${mvp}</b> (${mvpDmg} damage dealt)`
  overlay.classList.remove('hidden')
}
