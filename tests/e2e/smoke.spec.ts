import { expect, test } from '@playwright/test'

// Deterministic end-to-end smoke test. The /api/* routes are mocked with
// fixtures so the run is free, fast, and unaffected by LLM variance — the
// point is to prove the client wiring (order -> engine -> renderer -> HUD),
// not the model. Voice can't be automated; the text path is the stand-in.

const PARTY_FIXTURE = {
  actions: [
    { unitId: 'brannor', type: 'move_attack', targetId: 'goblin1', toLandmark: null, radio: 'Aye! Wee beasties!' },
    { unitId: 'sylvia', type: 'attack', targetId: 'goblin1', toLandmark: null, radio: 'Fine. Shooting.' },
    { unitId: 'pip', type: 'attack', targetId: 'goblin2', toLandmark: null, radio: 'S-sorry! Firebolt!' },
    { unitId: 'mira', type: 'defend', targetId: null, toLandmark: null, radio: 'The Light holds.' },
  ],
}

// goblin1 and goblin2 are the party fixture's targets and will usually be dead
// by the time the horde acts, so the taunt comes from goblin3 (untouched).
const MONSTER_FIXTURE = {
  actions: [
    { unitId: 'goblin1', type: 'move_attack', targetId: 'brannor' },
    { unitId: 'goblin2', type: 'move_attack', targetId: 'brannor' },
    { unitId: 'goblin3', type: 'move_attack', targetId: 'shrine' },
  ],
  taunt: { unitId: 'goblin3', text: 'Your shrine burns tonight!' },
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, mock: true, model: 'fixture' } }))
  await page.route('**/api/orders', (r) => r.fulfill({ json: PARTY_FIXTURE }))
  await page.route('**/api/monster-turn', (r) => r.fulfill({ json: MONSTER_FIXTURE }))
  await page.route('**/api/narrator', (r) => r.fulfill({ json: { text: 'The dark leans closer.' } }))
})

test('title screen presents the game and a way in', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#title-overlay h1')).toHaveText('DUNGEON COMMAND')
  await expect(page.locator('#start-btn')).toBeVisible()
  await expect(page.locator('.credits')).toContainText('Kenney')
})

test('a typed order runs a full turn: heroes act, horde answers, HUD updates', async ({ page }) => {
  await page.goto('/')
  await page.click('#start-btn')

  // Wave 1 is on the board and the party is alive.
  await expect(page.locator('#wave-num')).toHaveText('1')
  await expect(page.locator('.hero-card')).toHaveCount(4)
  // The horde is rostered monster by monster, each with its own bar.
  await expect(page.locator('#horde-list .horde-row')).toHaveCount(3)
  await expect(page.locator('#horde-list .horde-row').first()).toContainText('Goblin A')

  await page.fill('#order-input', 'Everyone attack the nearest goblin')
  await page.click('#send-btn')

  // The order is echoed back to the player immediately.
  await expect(page.locator('.chat-line.you')).toContainText('Everyone attack the nearest goblin')

  // Heroes speak in character, the horde taunts back.
  await expect(page.locator('.chat-line.party').first()).toBeVisible()
  await expect(page.locator('.chat-line.monster')).toContainText('shrine burns', { timeout: 30000 })

  // The turn completes and control returns to the player.
  await expect(page.locator('#phase-chip')).toHaveText('YOUR COMMAND', { timeout: 40000 })
  await expect(page.locator('#turn-num')).toHaveText('2')

  // Combat actually resolved: the horde roster shrank from three goblins.
  expect(await page.locator('#horde-list .horde-row').count()).toBeLessThan(3)

  // Each hero card shows the mechanical action that hero just took.
  await expect(page.locator('#last-brannor')).toContainText('Struck', { ignoreCase: true })
})

test('the chronicle keeps the record after the chatter has faded', async ({ page }) => {
  await page.goto('/')
  await page.click('#start-btn')
  await page.fill('#order-input', 'Everyone attack the nearest goblin')
  await page.click('#send-btn')
  await expect(page.locator('#phase-chip')).toHaveText('YOUR COMMAND', { timeout: 40000 })

  // The live feed clears itself so the map stays readable…
  await expect(page.locator('#chatter .chat-line')).toHaveCount(0, { timeout: 25000 })

  // …but nothing is lost: the order, the voices and every blow are on record.
  await page.click('#log-btn')
  await expect(page.locator('#log-panel')).toHaveClass(/open/)
  await expect(page.locator('#log-body .log-chapter').first()).toContainText('Wave 1')
  await expect(page.locator('#log-body .e-order')).toContainText('Everyone attack the nearest goblin')
  await expect(page.locator('#log-body .e-beat').first()).toContainText('Goblin A')
  await expect(page.locator('#log-body .e-beat .slain').first()).toBeVisible()

  // Filters narrow the chronicle to just the fighting.
  await page.click('#log-filters button[data-filter="battle"]')
  await expect(page.locator('#log-body .e-order')).toBeHidden()
  await expect(page.locator('#log-body .e-beat').first()).toBeVisible()
})

test('the game is fully playable with the LLM unavailable', async ({ page }) => {
  await page.route('**/api/orders', (r) => r.fulfill({ status: 502, json: { error: 'down' } }))
  await page.route('**/api/monster-turn', (r) => r.fulfill({ status: 502, json: { error: 'down' } }))
  await page.goto('/')
  await page.click('#start-btn')
  await page.fill('#order-input', 'attack')
  await page.click('#send-btn')

  // Heuristic actors take over: heroes still speak and the turn still advances.
  await expect(page.locator('.chat-line.party').first()).toBeVisible({ timeout: 30000 })
  await expect(page.locator('#phase-chip')).toHaveText('YOUR COMMAND', { timeout: 40000 })
  await expect(page.locator('#turn-num')).toHaveText('2')
})

test('debug panel drives the game to a victory screen', async ({ page }) => {
  await page.goto('/?debug=1')
  await page.click('#start-btn')
  await page.check('#dbg-fast')
  await page.check('#dbg-nollm')
  for (let i = 0; i < 10; i++) {
    await page.click('#dbg-buttons >> text=kill monsters')
    await page.waitForTimeout(900)
    if (await page.locator('#end-overlay:not(.hidden)').count()) break
  }
  await expect(page.locator('#end-title')).toHaveText('THE SHRINE STANDS')
  await expect(page.locator('#end-stats')).toContainText('MVP')
})
