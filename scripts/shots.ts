// Dev tool: drive the game in a real headed-ish browser and capture screenshots
// at each phase. Usage: npx tsx scripts/shots.ts  (dev server must be running)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const OUT = process.env.SHOT_DIR ?? 'shots'
const BASE = process.env.BASE_URL ?? 'http://localhost:5173'

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[console error]', m.text())
  })
  await page.goto(`${BASE}/?debug=1`)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/1-title.png` })

  await page.click('#start-btn')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/2-board.png` })

  await page.fill('#order-input', 'Brannor hold the north gap, Sylvia and Pip shoot anything that comes through, Mira stay on the shrine')
  await page.click('#send-btn')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/3-scrying.png` })
  await page.waitForFunction(() => document.getElementById('phase-chip')!.textContent === 'YOUR COMMAND', { timeout: 40000 })
  await page.screenshot({ path: `${OUT}/4-after-turn.png` })

  // Hover a hero to show the movement overlay.
  const box = await page.locator('#game canvas').boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 48)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/5-hover-range.png` })
  }

  // Fast-forward to the end screen with the debug controls.
  await page.check('#dbg-fast')
  for (let i = 0; i < 8; i++) {
    await page.click('#dbg-buttons >> text=kill monsters')
    await page.waitForTimeout(1200)
    const done = await page.evaluate(() => !document.getElementById('end-overlay')!.classList.contains('hidden'))
    if (done) break
  }
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/6-victory.png` })

  await browser.close()
  console.log(`screenshots written to ${OUT}/`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
