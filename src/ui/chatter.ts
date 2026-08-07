import { portraitFor } from './hud'
import { UNIT_FRAME } from '../spritemap'
import type { Beat } from './beat'
import { beatHtml } from './beat'
import * as history from './history'

const MAX_LINES = 7
const TYPE_MS = 16 // per character
const HOLD_MS = 5000 // how long a finished line stays before it starts to fade
const FADE_MS = 600 // must match the chatOut animation in index.html
const STAGGER_MS = 320 // minimum gap between two lines leaving, so they go one at a time

const timers = new Set<number>()
// Lines expire oldest-first and never at the same moment: each new line's exit
// is pushed past the previous one's, even when a whole party speaks in a burst.
let lastExit = 0

function later(fn: () => void, ms: number): void {
  const id = window.setTimeout(() => {
    timers.delete(id)
    fn()
  }, ms)
  timers.add(id)
}

function scheduleExit(line: HTMLElement, typeMs: number): void {
  const now = Date.now()
  const at = Math.max(now + typeMs + HOLD_MS, lastExit + STAGGER_MS)
  lastExit = at
  later(() => {
    line.classList.add('fading')
    later(() => line.remove(), FADE_MS)
  }, at - now)
}

function addLine(kind: string, html: string): HTMLElement {
  const wrap = document.getElementById('chatter')!
  const line = document.createElement('div')
  line.className = `chat-line ${kind}`
  line.innerHTML = html
  wrap.appendChild(line)
  while (wrap.children.length > MAX_LINES) wrap.removeChild(wrap.firstChild!)
  return line
}

function push(kind: string, who: string, text: string, portraitCls?: string, typewriter = true): void {
  const img = portraitCls && UNIT_FRAME[portraitCls] !== undefined ? `<img src="${portraitFor(portraitCls)}" alt=""/>` : ''
  const line = addLine(kind, `${img}<span class="who">${who}:</span><span class="txt"></span>`)

  const txt = line.querySelector('.txt') as HTMLElement
  if (!typewriter || document.hidden) {
    txt.textContent = text
    scheduleExit(line, 0)
    return
  }
  scheduleExit(line, text.length * TYPE_MS)
  let i = 0
  const tick = () => {
    i++
    txt.textContent = text.slice(0, i)
    if (i < text.length) setTimeout(tick, TYPE_MS)
  }
  tick()
}

export function heroSays(name: string, cls: string, text: string): void {
  push('party', name, text, cls)
  history.logLine('party', text, name, cls)
}

export function monsterSays(name: string, cls: string, text: string): void {
  push('monster', name, text, cls)
  history.logLine('monster', text, name, cls)
}

export function narratorSays(text: string): void {
  push('narrator', 'The Orb', text, undefined)
  history.logLine('narrator', text, 'The Orb')
}

export function youSaid(text: string): void {
  push('you', 'Archmagus', text, undefined, false)
  history.logLine('order', text, 'Archmagus')
}

// A blow landing, keyed to the moment of impact on screen.
export function beatHappened(b: Beat): void {
  const line = addLine(`beat ${b.actorSide === 'party' ? 'by-party' : 'by-horde'}`, beatHtml(b))
  scheduleExit(line, 0)
  history.logBeat(b)
}

export function clearChatter(): void {
  for (const id of timers) clearTimeout(id)
  timers.clear()
  lastExit = 0
  document.getElementById('chatter')!.innerHTML = ''
}
