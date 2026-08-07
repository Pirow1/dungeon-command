import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { interpretOrders, llmStatus, monsterTurn, narrate } from './llm'

const app = express()
app.use(express.json({ limit: '256kb' }))

app.get('/api/health', (_req, res) => {
  res.json(llmStatus())
})

app.post('/api/orders', async (req, res) => {
  const { order, state } = req.body ?? {}
  if (typeof order !== 'string' || !state) {
    res.status(400).json({ error: 'order and state required' })
    return
  }
  const result = await interpretOrders(order.slice(0, 500), state)
  if (!result) {
    res.status(502).json({ error: 'llm unavailable' })
    return
  }
  res.json(result)
})

app.post('/api/monster-turn', async (req, res) => {
  const { state } = req.body ?? {}
  if (!state) {
    res.status(400).json({ error: 'state required' })
    return
  }
  const result = await monsterTurn(state)
  if (!result) {
    res.status(502).json({ error: 'llm unavailable' })
    return
  }
  res.json(result)
})

app.post('/api/narrator', async (req, res) => {
  const { context } = req.body ?? {}
  const text = await narrate(String(context ?? '').slice(0, 400))
  if (!text) {
    res.status(502).json({ error: 'llm unavailable' })
    return
  }
  res.json({ text })
})

// Production: serve the built client.
const dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(dirname, '..', 'dist')
app.use(express.static(dist))

// Deliberately NOT process.env.PORT — dev tooling injects that for the Vite
// process; the API owns its own variable.
const port = Number(process.env.API_PORT ?? 3001)
app.listen(port, () => {
  const s = llmStatus()
  console.log(`[dungeon-command] api on :${port} — model=${s.model} mock=${s.mock} key=${s.ok ? 'yes' : 'MISSING'}`)
})
