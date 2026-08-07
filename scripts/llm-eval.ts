// LLM prompt-regression harness: fires canned orders at the live /api/orders
// endpoint and prints parsed actions + how many needed clamping.
// Usage: npm run llm:eval   (server must be running on :3001)
import { LEVEL1 } from '../src/data/level1'
import { initGame, resolvePartyTurn } from '../src/engine/turn'
import { summarize } from '../src/engine/summary'
import type { Action } from '../src/engine/types'

const BASE = process.env.EVAL_BASE ?? 'http://localhost:3001'

const ORDERS = [
  'Everyone attack the nearest goblin!',
  'Brannor hold the north door, Sylvia cover him from range',
  'Pip fall back to the shrine, Mira heal Pip',
  'All of you defend the shrine, let them come to us',
  'Sylvia and Pip focus fire the skeleton, Brannor charge west',
  'Retreat! Everyone back to the shrine room!',
  'Mira smite the closest monster, everyone else spread out to the doors',
  'uhh do something useful I guess',
  'Charge!!!',
  'Brannor go make friends with the goblins', // nonsense — should clamp gracefully
]

async function main() {
  const { state } = initGame(LEVEL1, 42)
  const summary = summarize(LEVEL1, state)
  let totalMs = 0
  for (const order of ORDERS) {
    const t0 = Date.now()
    const res = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order, state: summary }),
    })
    const ms = Date.now() - t0
    totalMs += ms
    if (!res.ok) {
      console.log(`✗ ${ms}ms  "${order}" -> HTTP ${res.status}`)
      continue
    }
    const data = (await res.json()) as { actions: Action[] }
    const heroCount = new Set(data.actions.map((a) => a.unitId)).size
    // Run through the real engine to count clamps (events prove legality).
    const clone = structuredClone(state)
    const events = resolvePartyTurn(LEVEL1, clone, data.actions)
    console.log(`✓ ${ms}ms  "${order}"`)
    for (const a of data.actions) {
      console.log(`    ${a.unitId}: ${a.type}${a.targetId ? ' -> ' + a.targetId : ''}${a.toLandmark ? ' @ ' + a.toLandmark : ''}  "${a.radio ?? ''}"`)
      if (a.reason) console.log(`        why: ${a.reason}`)
    }
    if (heroCount < 4) console.log(`    ⚠ only ${heroCount}/4 heroes ordered (engine clamps the rest)`)
    console.log(`    engine events: ${events.length}`)
  }
  console.log(`\navg latency: ${Math.round(totalMs / ORDERS.length)}ms`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
