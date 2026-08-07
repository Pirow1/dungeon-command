// The Chronicle: the permanent record behind the chatter feed.
//
// Chatter lines fade after a few seconds so the map stays readable. Everything
// that scrolls past there is also written here, grouped by wave and turn, so
// the player can always go back and read how the fight actually went.

import type { Beat } from './beat'
import { beatHtml, beatText } from './beat'
import { portraitFor } from './hud'
import { sfx } from './sfx'

export type LogKind = 'order' | 'party' | 'monster' | 'narrator' | 'beat' | 'system'

export interface LogEntry {
  kind: LogKind
  who?: string
  cls?: string
  text: string
  html?: string
  wave: number
  turn: number
}

const entries: LogEntry[] = []
let wave = 1
let turn = 1
let headerKey = ''
let open = false
let unread = 0

const el = (id: string) => document.getElementById(id)!
const bodyEl = () => el('log-body')

export function setChapter(nextWave: number, nextTurn: number): void {
  wave = nextWave
  turn = nextTurn
}

export function historyEntries(): readonly LogEntry[] {
  return entries
}

// -- writing ---------------------------------------------------------------

function append(entry: LogEntry): void {
  entries.push(entry)
  const body = bodyEl()
  const empty = body.querySelector('.log-empty')
  if (empty) empty.remove()

  const key = `${entry.wave}/${entry.turn}`
  if (key !== headerKey) {
    headerKey = key
    const h = document.createElement('div')
    h.className = 'log-chapter'
    h.innerHTML = `<span>Wave ${entry.wave}</span><i></i><span>Turn ${entry.turn}</span>`
    body.appendChild(h)
  }

  const pinned = body.scrollHeight - body.scrollTop - body.clientHeight < 60
  const row = document.createElement('div')
  row.className = `log-entry e-${entry.kind}`
  row.innerHTML = entry.html ?? renderPlain(entry)
  body.appendChild(row)
  if (pinned || !open) body.scrollTop = body.scrollHeight

  if (!open) {
    unread++
    const badge = el('log-badge')
    badge.textContent = unread > 99 ? '99+' : String(unread)
    badge.classList.remove('hidden')
    el('log-btn').classList.add('nudge')
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

function renderPlain(entry: LogEntry): string {
  const src = entry.cls ? portraitFor(entry.cls) : ''
  const img = src ? `<img src="${src}" alt="" />` : ''
  const who = entry.who ? `<b class="who">${escapeHtml(entry.who)}</b>` : ''
  return `${img}${who}<span class="txt">${escapeHtml(entry.text)}</span>`
}

export function logLine(kind: Exclude<LogKind, 'beat'>, text: string, who?: string, cls?: string): void {
  append({ kind, who, cls, text, wave, turn })
}

export function logBeat(b: Beat): void {
  append({ kind: 'beat', text: beatText(b), html: beatHtml(b), wave, turn })
}

export function resetHistory(): void {
  entries.length = 0
  headerKey = ''
  unread = 0
  wave = 1
  turn = 1
  bodyEl().innerHTML = '<div class="log-empty">The chronicle is empty. Give an order.</div>'
  el('log-badge').classList.add('hidden')
}

// -- panel -----------------------------------------------------------------

export function isHistoryOpen(): boolean {
  return open
}

export function toggleHistory(force?: boolean): void {
  open = force ?? !open
  el('log-panel').classList.toggle('open', open)
  el('log-btn').classList.toggle('active', open)
  if (open) {
    unread = 0
    el('log-badge').classList.add('hidden')
    el('log-btn').classList.remove('nudge')
    const body = bodyEl()
    body.scrollTop = body.scrollHeight
  }
  sfx('click')
}

function setFilter(f: string): void {
  bodyEl().className = `f-${f}`
  for (const b of document.querySelectorAll('#log-filters button')) {
    b.classList.toggle('on', (b as HTMLElement).dataset.filter === f)
  }
}

export function initHistory(): void {
  resetHistory()
  setFilter('all')
  el('log-btn').addEventListener('click', () => toggleHistory())
  el('log-close').addEventListener('click', () => toggleHistory(false))
  for (const b of document.querySelectorAll('#log-filters button')) {
    b.addEventListener('click', () => setFilter((b as HTMLElement).dataset.filter!))
  }
  window.addEventListener('keydown', (e) => {
    if (document.activeElement?.id === 'order-input') return
    if (e.key === 'h' || e.key === 'H') toggleHistory()
    else if (e.key === 'Escape' && open) toggleHistory(false)
  })
}
