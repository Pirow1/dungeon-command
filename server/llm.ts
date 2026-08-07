import { z } from 'zod'
import { MONSTER_SCHEMA, MONSTER_SYSTEM, NARRATOR_SYSTEM, ORDER_SCHEMA, ORDER_SYSTEM } from './prompts'
import type { JsonCall, Provider } from './providers/types'
import { openaiProvider } from './providers/openai'
import { anthropicProvider } from './providers/anthropic'

const MOCK = process.env.MOCK_LLM === '1'

// ---- per-call model routing -------------------------------------------------
// The three AI minds have different needs, so each gets its own model:
//   orders  — blocking on the player's turn; best instruction-following we can
//             afford inside ~2s. This is the call the judges actually see.
//   monster — latency is free (it runs behind the party animation), but doctrine
//             compliance matters, so it gets the same tier as orders.
//   narrator— one throwaway sentence, fire-and-forget; cheapest model.
// Any of these can be pointed at Claude by setting the env var to a claude-*
// model id; the provider is inferred from the id, so there is no second knob.

export type CallKind = 'orders' | 'monster' | 'narrator'

const MODELS: Record<CallKind, string> = {
  orders: process.env.ORDERS_MODEL ?? 'gpt-5-mini',
  monster: process.env.MONSTER_MODEL ?? 'gpt-5-mini',
  narrator: process.env.NARRATOR_MODEL ?? 'gpt-5-nano',
}

function providerFor(model: string): Provider {
  return model.startsWith('claude-') ? anthropicProvider : openaiProvider
}

export function llmStatus() {
  const routes = (Object.keys(MODELS) as CallKind[]).map((kind) => {
    const model = MODELS[kind]
    const provider = providerFor(model)
    return { kind, model, provider: provider.name, ready: MOCK || provider.available }
  })
  return {
    ok: MOCK || routes.some((r) => r.ready),
    mock: MOCK,
    // Kept for the existing client + eval harness, which read a single model.
    model: MODELS.orders,
    routes,
    providers: {
      openai: openaiProvider.available,
      anthropic: anthropicProvider.available,
    },
  }
}

// ---- validation -------------------------------------------------------------

const actionSchema = z.object({
  unitId: z.string(),
  type: z.enum(['move', 'move_attack', 'attack', 'heal', 'defend', 'wait']),
  targetId: z.string().nullish(),
  toLandmark: z.string().nullish(),
  radio: z.string().nullish(),
})

const ordersSchema = z.object({ actions: z.array(actionSchema) })
const monstersSchema = z.object({
  actions: z.array(actionSchema),
  taunt: z.object({ unitId: z.string(), text: z.string() }).nullish(),
})

const REPAIR_SUFFIX =
  '\n\nYour previous reply did not match the required JSON schema. Respond again with ONLY valid JSON matching it exactly.'

// One structured call with a single repair retry, provider-agnostic. Returns
// null on any failure — callers fall back to heuristics, so the game never
// stalls, whichever provider is behind the route.
async function structuredCall<T>(kind: CallKind, call: JsonCall, validator: z.ZodType<T>): Promise<T | null> {
  const model = MODELS[kind]
  const provider = providerFor(model)
  if (!provider.available) return null

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await provider.json(model, attempt === 0 ? call : { ...call, user: call.user + REPAIR_SUFFIX })
    if (!raw) continue
    try {
      const parsed = validator.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
      console.error(`[llm:${kind}] schema mismatch on attempt ${attempt + 1}`)
    } catch {
      console.error(`[llm:${kind}] unparseable JSON on attempt ${attempt + 1}`)
    }
  }
  return null
}

// ---- mock mode: deterministic canned-but-sensible responses ----------------

interface SummaryLike {
  party?: { id: string; nearestEnemy?: { id: string } | string }[]
  monsters?: { id: string; cls?: string; nearestHero?: { id: string } | string }[]
}

const MOCK_LINES: Record<string, string> = {
  brannor: "Aye! The wee beasties'll taste me axe!",
  sylvia: 'Sure. Arrows. My favorite chore.',
  pip: 'O-okay! F-firebolt incoming, sorry in advance!',
  mira: 'The Light walks with us.',
}

function mockOrders(state: SummaryLike) {
  return {
    actions: (state.party ?? []).map((p) => {
      const ne = typeof p.nearestEnemy === 'object' && p.nearestEnemy ? p.nearestEnemy.id : null
      return {
        unitId: p.id,
        type: ne ? ('move_attack' as const) : ('defend' as const),
        targetId: ne,
        toLandmark: null,
        radio: MOCK_LINES[p.id] ?? 'For the Order!',
      }
    }),
  }
}

function mockMonsters(state: SummaryLike) {
  return {
    actions: (state.monsters ?? []).map((m) => {
      const nh = typeof m.nearestHero === 'object' && m.nearestHero ? m.nearestHero.id : null
      return {
        unitId: m.id,
        type: 'move_attack' as const,
        targetId: m.cls === 'orc' ? 'shrine' : nh,
        toLandmark: null,
        radio: null,
      }
    }),
    taunt: null,
  }
}

// ---- public API ------------------------------------------------------------

export async function interpretOrders(order: string, state: unknown) {
  if (MOCK) return mockOrders(state as SummaryLike)
  return structuredCall(
    'orders',
    {
      system: ORDER_SYSTEM,
      user: `Order from the Archmagus: "${order}"\n\nGame state:\n${JSON.stringify(state)}`,
      schemaName: ORDER_SCHEMA.name,
      schema: ORDER_SCHEMA.schema as unknown as Record<string, unknown>,
      maxTokens: 2048,
    },
    ordersSchema,
  )
}

export async function monsterTurn(state: unknown) {
  if (MOCK) return mockMonsters(state as SummaryLike)
  return structuredCall(
    'monster',
    {
      system: MONSTER_SYSTEM,
      user: `Game state:\n${JSON.stringify(state)}`,
      schemaName: MONSTER_SCHEMA.name,
      schema: MONSTER_SCHEMA.schema as unknown as Record<string, unknown>,
      maxTokens: 2048,
    },
    monstersSchema,
  )
}

export async function narrate(context: string): Promise<string | null> {
  if (MOCK) return 'The dungeon holds its breath.'
  const model = MODELS.narrator
  const provider = providerFor(model)
  if (!provider.available) return null
  return provider.text(model, NARRATOR_SYSTEM, context, 300)
}
