import OpenAI from 'openai'
import type { JsonCall, Provider } from './types'

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 8000, maxRetries: 0 })
  : null

export const openaiProvider: Provider = {
  name: 'openai',
  available: !!client,

  async json(model: string, call: JsonCall): Promise<string | null> {
    if (!client) return null
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: call.system },
          { role: 'user', content: call.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: call.schemaName, strict: true, schema: call.schema } as never,
        },
        // 'minimal' is valid for the gpt-5 family even if this SDK's types lag.
        reasoning_effort: 'minimal' as OpenAI.ReasoningEffort,
        max_completion_tokens: call.maxTokens,
      })
      return res.choices[0]?.message?.content ?? null
    } catch (err) {
      console.error(`[openai:${model}] ${(err as Error).message}`)
      return null
    }
  },

  async text(model, system, user, maxTokens): Promise<string | null> {
    if (!client) return null
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        reasoning_effort: 'minimal' as OpenAI.ReasoningEffort,
        max_completion_tokens: maxTokens,
      })
      return res.choices[0]?.message?.content?.trim() || null
    } catch (err) {
      console.error(`[openai:${model}] ${(err as Error).message}`)
      return null
    }
  },
}
