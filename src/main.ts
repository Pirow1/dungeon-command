import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { GameScene } from './scenes/GameScene'
import { Controller } from './controller'
import * as hud from './ui/hud'
import { initVoice, primeMicPermission } from './ui/voice'
import { initDebug } from './ui/debug'
import { initHistory, toggleHistory } from './ui/history'
import { llmHealthy } from './ai/client'
import { initSfx, setSfxEnabled, sfx } from './ui/sfx'
import { CELL } from './spritemap'
import { LEVEL1 } from './data/level1'

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: LEVEL1.width * CELL,
  height: LEVEL1.height * CELL,
  backgroundColor: '#0b0a12',
  pixelArt: true,
  roundPixels: true,
  // If the page loads in a hidden/background tab, rAF never fires and Phaser
  // would never boot — fall back to the setTimeout loop in that case.
  fps: document.hidden ? { forceSetTimeOut: true, target: 30 } : undefined,
  scene: [BootScene, GameScene],
})

game.events.on('scene-ready', (scene: GameScene) => {
  hud.setPortraits(scene.registry.get('portraits'))
  const controller = new Controller(scene)

  const submit = (text: string) => {
    const t = text.trim()
    if (t) void controller.submitOrder(t)
  }

  // Text path (always available; doubles as the demo fallback).
  const input = document.getElementById('order-input') as HTMLInputElement
  const send = () => {
    submit(input.value)
    input.value = ''
  }
  document.getElementById('send-btn')!.addEventListener('click', send)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send()
  })

  // Voice path.
  initVoice({
    onInterim: () => {},
    onFinal: (text) => {
      document.getElementById('transcript')!.textContent = text
      submit(text)
    },
  })

  // Title flow: request the mic from the title screen, never mid-game.
  const title = document.getElementById('title-overlay')!
  document.getElementById('start-btn')!.addEventListener('click', async () => {
    initSfx() // first gesture — browsers unlock audio here
    sfx('click')
    title.classList.add('hidden')
    await primeMicPermission()
    controller.newGame()
  })
  ;(document.getElementById('sound-toggle') as HTMLInputElement).addEventListener('change', (e) => {
    setSfxEnabled((e.target as HTMLInputElement).checked)
  })

  document.getElementById('again-btn')!.addEventListener('click', () => {
    document.getElementById('end-overlay')!.classList.add('hidden')
    location.reload()
  })

  // The chronicle outlives the run: the end screen is exactly when a player
  // wants to read back how it went.
  initHistory()
  document.getElementById('chronicle-btn')!.addEventListener('click', () => toggleHistory(true))

  initDebug(controller, scene)

  // Surface LLM availability quietly in the console (and force heuristics if
  // down). Retries a few times — the API process may still be booting.
  const checkHealth = async (attempt = 0): Promise<void> => {
    const h = await llmHealthy()
    if (h?.ok) {
      controller.noLLM = false
      if (h.mock) console.info('[dungeon-command] MOCK_LLM active')
      return
    }
    controller.noLLM = true
    if (attempt < 5) {
      setTimeout(() => void checkHealth(attempt + 1), 2000)
    } else {
      console.warn('[dungeon-command] LLM proxy unreachable — running on heuristic actors')
    }
  }
  void checkHealth()
})
