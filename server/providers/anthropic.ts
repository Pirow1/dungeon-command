import Anthropic from '@anthropic-ai/sdk'
import type { JsonCall, Provider } from './types'

// NOTE: the TypeScript SDK takes `timeout` in MILLISECONDS (the Python SDK
// takes seconds) — 8000 here is 8s, matching the OpenAI adapter.
// Construct with no explicit apiKey so the SDK's own credential chain applies
// (ANTHROPIC_API_KEY, then ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile).
const hasCredential = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
const client = hasCredential ? new Anthropic({ timeout: 8000, maxRetries: 0 }) : null

// Haiku 4.5 rejects `output_config.effort` outright; the Sonnet 5 / Opus 5 tier
// accepts it and needs it, since those default to adaptive thinking (which we
// don't want on a latency-critical call). Low effort is the recommended way to
// hold those back — disabling thinking on Opus 5 has its own failure modes.
function supportsEffort(model: string): boolean {
  return !/^claude-haiku/.test(model)
}

function outputConfig(model: string, format?: Record<string, unknown>) {
  return {
    ...(format ? { format } : {}),
    ...(supportsEffort(model) ? { effort: 'low' } : {}),
  }
}

function describe(err: unknown, model: string): string {
  const e = err as Error
  if (err instanceof Anthropic.RateLimitError) return `rate limited: ${e.message}`
  if (err instanceof Anthropic.AuthenticationError) return `bad ANTHROPIC_API_KEY: ${e.message}`
  if (err instanceof Anthropic.NotFoundError) return `unknown model "${model}": ${e.message}`
  // APIConnectionError extends APIError in the TS SDK — check it first.
  if (err instanceof Anthropic.APIConnectionError) return `connection failed: ${e.message}`
  if (err instanceof Anthropic.APIError) return `api error: ${e.message}`
  return e.message
}

// Safety classifiers can decline a request (HTTP 200 + stop_reason "refusal"),
// so guard on stop_reason before touching content.
function readText(res: Anthropic.Message): string | null {
  if (res.stop_reason === 'refusal') return null
  const block = res.content.find((b) => b.type === 'text')
  return block && block.type === 'text' ? block.text : null
}

export const anthropicProvider: Provider = {
  name: 'anthropic',
  available: !!client,

  async json(model: string, call: JsonCall): Promise<string | null> {
    if (!client) return null
    try {
      const res = await client.messages.create({
        model,
        max_tokens: call.maxTokens,
        system: call.system,
        messages: [{ role: 'user', content: call.user }],
        output_config: outputConfig(model, { type: 'json_schema', schema: call.schema }),
      } as never)
      return readText(res as Anthropic.Message)
    } catch (err) {
      console.error(`[anthropic:${model}] ${describe(err, model)}`)
      return null
    }
  },

  async text(model, system, user, maxTokens): Promise<string | null> {
    if (!client) return null
    try {
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        ...(supportsEffort(model) ? { output_config: outputConfig(model) } : {}),
      } as never)
      return readText(res as Anthropic.Message)?.trim() || null
    } catch (err) {
      console.error(`[anthropic:${model}] ${describe(err, model)}`)
      return null
    }
  },
}
