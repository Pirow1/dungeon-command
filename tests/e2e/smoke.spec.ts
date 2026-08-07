import { expect, test } from '@playwright/test'

// Deterministic end-to-end smoke test. The /api/* routes are mocked with
// fixtures so the run is free, fast, and unaffected by LLM variance — the
// point is to prove the client wiring (order -> engine -> renderer -> HUD),
// not the model. Voice can't be automated; the text path is the stand-in.

const PARTY_FIXTURE = {
  actions: [
    { unitId: 'brannor', type: 'move_attack', targetId: 'goblin1', toLandmark: null, radio: 'Aye! Wee beasties!', reason: 'goblin1 is the closest threat' },
    { unitId: 'sylvia', type: 'attack', targetId: 'goblin1', toLandmark: null, radio: 'Fine. Shooting.', reason: 'clear line of sight on goblin1' },
    { unitId: 'pip', type: 'attack', targetId: 'goblin2', toLandmark: null, radio: 'S-sorry! Firebolt!', reason: 'firebolt one-shots a goblin' },
    { unitId: 'mira', type: 'defend', targetId: null, toLandmark: null, radio: 'The Light holds.', reason: 'holding the shrine, nobody wounded yet' },
  ],
}

// goblin1 and goblin2 are the party fixture's targets and will usually be dead
// by the time the horde acts, so the taunt comes from goblin3 (untouched).
const MONSTER_FIXTURE = {
  actions: [
    { unitId: 'goblin1', type: 'move_attack', targetId: 'brannor', reason: 'swarm the dwarf holding the line' },
    { unitId: 'goblin2', type: 'move_attack', targetId: 'brannor', reason: 'two on one finishes him faster' },
    { unitId: 'goblin3', type: 'move_attack', targetId: 'shrine', reason: 'shrine is undefended from the west' },
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
  await page.locator('#horde-list .horde-row').first().waitFor()
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

  // Reasoning is dev-only: recorded, but neither filter nor rows are offered.
  await expect(page.locator('#log-filters button[data-filter="mind"]')).toBeHidden()
  await expect(page.locator('#log-body .e-debug').first()).toBeHidden()
})

test('the Mind filter exposes why each unit acted, in debug mode only', async ({ page }) => {
  await page.goto('/?debug=1')
  await page.click('#start-btn')
  await page.locator('#horde-list .horde-row').first().waitFor()
  await page.fill('#order-input', 'Everyone attack the nearest goblin')
  await page.click('#send-btn')
  await expect(page.locator('#phase-chip')).toHaveText('YOUR COMMAND', { timeout: 40000 })

  await page.click('#log-btn')
  // Still hidden under All — the Mind filter is the only way in.
  await expect(page.locator('#log-body .e-debug').first()).toBeHidden()

  await page.click('#log-filters button[data-filter="mind"]')
  await expect(page.locator('#log-body .e-debug').first()).toBeVisible()
  await expect(page.locator('#log-body')).toContainText('goblin1 is the closest threat')
  // Both sides reason, not just the party.
  await expect(page.locator('#log-body')).toContainText('shrine is undefended from the west')
  // …and the story rows step aside while Mind is active.
  await expect(page.locator('#log-body .e-beat').first()).toBeHidden()
})

test('a hero who ends a move on a chest gains a stat', async ({ page }) => {
  await page.goto('/?debug=1')
  await page.click('#start-btn')
  await page.locator('#horde-list .horde-row').first().waitFor()

  // Stand Brannor on the wave-1 chest and take a turn. Walking him there would
  // cost up to eight turns depending on where the chest rolled; the "you must
  // END a move on it" rule is covered by the engine tests. What this test is
  // for is the chain from the engine event through to the HUD.
  const before = await page.locator('#stats-brannor').innerText()
  await page.evaluate(() => {
    const s = (window as any).__dc.state
    const brannor = s.units.find((u: any) => u.id === 'brannor')
    brannor.pos = { ...s.chests[0].pos }
  })
  await page.fill('#dbg-json', JSON.stringify([{ unitId: 'brannor', type: 'wait' }]))
  await page.click('#dbg-inject')
  await expect(page.locator('#phase-chip')).toHaveText('YOUR COMMAND', { timeout: 40000 })
  expect(await page.evaluate(() => (window as any).__dc.state.chests.length)).toBe(0)

  await expect(page.locator('#stats-brannor')).not.toHaveText(before)
  await expect(page.locator('#stats-brannor .up')).toHaveCount(1)
  await expect(page.locator('#log-body')).toContainText('opens a chest')
})

test('the game is fully playable with the LLM unavailable', async ({ page }) => {
  await page.route('**/api/orders', (r) => r.fulfill({ status: 502, json: { error: 'down' } }))
  await page.route('**/api/monster-turn', (r) => r.fulfill({ status: 502, json: { error: 'down' } }))
  await page.goto('/')
  await page.click('#start-btn')
  // The start button primes the microphone before dealing the board; ordering
  // before that lands drops the order.
  await page.locator('#horde-list .horde-row').first().waitFor()
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
