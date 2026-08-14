import type { Controller } from '../controller'
import type { GameScene } from '../scenes/GameScene'
import { fallbackPartyActions } from '../ai/fallback'
import { SHRINE_ID, livingHeroes, unitById } from '../engine/types'

// ?debug=1 — dev loop + voice-free demo insurance.
export function initDebug(controller: Controller, scene: GameScene): void {
  if (!new URLSearchParams(location.search).has('debug')) return
  const panel = document.getElementById('debug')!
  panel.classList.add('on')
  // The single gate for dev-only UI elsewhere — the Chronicle's Mind filter.
  document.body.classList.add('debug-mode')
  // Live state from the console (and from e2e): __dc.state.chests, __dc.state.units…
  ;(window as unknown as { __dc: Controller }).__dc = controller

  const btns = document.getElementById('dbg-buttons')!
  const mk = (label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = fn
    btns.appendChild(b)
  }

  mk('heuristic turn', () => controller.runActions(fallbackPartyActions(controller.state)))
  mk('all defend', () =>
    controller.runActions(livingHeroes(controller.state).map((h) => ({ unitId: h.id, type: 'defend' as const }))),
  )
  mk('rush north', () =>
    controller.runActions(
      livingHeroes(controller.state).map((h) => ({ unitId: h.id, type: 'move' as const, toLandmark: 'north_door' })),
    ),
  )
  mk('kill monsters', () => {
    for (const u of controller.state.units) {
      if (u.side === 'monsters') {
        u.hp = 0
        u.alive = false
      }
    }
    controller.runActions([])
  })
  mk('hurt shrine', () => {
    const s = unitById(controller.state, SHRINE_ID)!
    s.hp = Math.max(0, s.hp - 8)
    controller.runActions([])
  })
  // The only way to reach the end screen on demand: waves never run out, and
  // 'hurt shrine' only drains hp — checkEnd tests `alive`, which it never clears.
  mk('slay heroes', () => {
    for (const u of livingHeroes(controller.state)) {
      u.hp = 0
      u.alive = false
    }
    controller.runActions([])
  })

  document.getElementById('dbg-inject')!.addEventListener('click', () => {
    const raw = (document.getElementById('dbg-json') as HTMLTextAreaElement).value
    try {
      controller.runActions(JSON.parse(raw))
    } catch (e) {
      alert(`bad JSON: ${e}`)
    }
  })
  ;(document.getElementById('dbg-fast') as HTMLInputElement).addEventListener('change', (e) => {
    scene.setSpeed((e.target as HTMLInputElement).checked)
  })
  ;(document.getElementById('dbg-nollm') as HTMLInputElement).addEventListener('change', (e) => {
    controller.noLLM = (e.target as HTMLInputElement).checked
  })

  setInterval(() => {
    const s = controller.state
    if (!s) return
    document.getElementById('dbg-info')!.textContent =
      `turn=${s.turn} wave=${s.wave} outcome=${s.outcome} monsters=${s.units.filter((u) => u.alive && u.side === 'monsters').length}`
  }, 500)
}
