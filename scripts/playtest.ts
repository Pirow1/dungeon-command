// Balance harness: plays full games against the real LLM endpoints using a
// scripted "competent commander" order list, and reports win rate + turn counts.
// Usage: npm run playtest [-- games]
import { LEVEL1 } from '../src/data/level1'
import { initGame, resolveMonsterTurn, resolvePartyTurn } from '../src/engine/turn'
import { summarize } from '../src/engine/summary'
import { fallbackMonsterActions, fallbackPartyActions } from '../src/ai/fallback'
import { livingHeroes, livingMonsters, unitById, SHRINE_ID } from '../src/engine/types'
import type { Action, GameState } from '../src/engine/types'

const BASE = process.env.EVAL_BASE ?? 'http://localhost:3001'
const USE_LLM = process.env.NO_LLM !== '1'

// What a reasonably smart player would say, given the state.
function commanderOrder(state: GameState): string {
  const shrine = unitById(state, SHRINE_ID)!
  const wounded = livingHeroes(state).filter((h) => h.hp / h.maxHp < 0.5)
  if (shrine.hp < shrine.maxHp * 0.5) {
    return 'The shrine is being smashed! Everyone converge on the shrine and kill whatever is hitting it.'
  }
  if (wounded.length) {
    return `Mira heal ${wounded[0].name} right now. Everyone else hold the shrine chokepoints and shoot anything in range.`
  }
  if (livingMonsters(state).length > 5) {
    return 'Too many of them — fall back to the shrine room, Brannor plug the north gap, Sylvia and Pip shoot from behind him, Mira stay near the shrine.'
  }
  return 'Brannor charge the nearest monster, Sylvia and Pip pick off anything at range, Mira stay by the shrine.'
}

async function post(path: string, body: unknown): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

async function playOne(seed: number) {
  const { state } = initGame(LEVEL1, seed)
  let guard = 0
  let llmFailures = 0
  while (state.outcome === 'ongoing' && guard++ < 60) {
    let partyActions: Action[]
    if (USE_LLM) {
      const res = await post('/api/orders', { order: commanderOrder(state), state: summarize(LEVEL1, state) })
      if (res?.actions?.length) partyActions = res.actions
      else {
        llmFailures++
        partyActions = fallbackPartyActions(state)
      }
    } else {
      partyActions = fallbackPartyActions(state)
    }
    resolvePartyTurn(LEVEL1, state, partyActions)
    if (state.outcome !== 'ongoing') break

    let monsterActions: Action[]
    if (USE_LLM) {
      const res = await post('/api/monster-turn', { state: summarize(LEVEL1, state) })
      if (res?.actions?.length) monsterActions = res.actions
      else {
        llmFailures++
        monsterActions = fallbackMonsterActions(state)
      }
    } else {
      monsterActions = fallbackMonsterActions(state)
    }
    resolveMonsterTurn(LEVEL1, state, monsterActions)
  }
  const shrine = unitById(state, SHRINE_ID)!
  return {
    outcome: state.outcome,
    turns: state.turn,
    wave: state.wave,
    shrineHp: shrine.hp,
    heroesAlive: livingHeroes(state).length,
    llmFailures,
  }
}

async function main() {
  const games = Number(process.argv[2] ?? 3)
  const results = []
  for (let i = 0; i < games; i++) {
    const r = await playOne(100 + i)
    results.push(r)
    console.log(
      `game ${i + 1}: ${r.outcome.toUpperCase()} after ${r.turns} turns (wave ${r.wave}) — shrine ${r.shrineHp}/20, heroes ${r.heroesAlive}/4, llm failures ${r.llmFailures}`,
    )
  }
  const wins = results.filter((r) => r.outcome === 'victory').length
  console.log(`\nwin rate: ${wins}/${games}  ·  avg turns ${(results.reduce((a, r) => a + r.turns, 0) / games).toFixed(1)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
