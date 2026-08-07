// A provider is anything that can (a) return schema-constrained JSON and
// (b) return a line of plain text. Both adapters return `null` on any failure —
// the caller falls back to heuristics, so the game never stalls on an API.

export interface JsonCall {
  system: string
  user: string
  /** Schema name — some providers require a label for the response format. */
  schemaName: string
  /** Bare JSON Schema (no provider-specific wrapper). */
  schema: Record<string, unknown>
  maxTokens: number
}

export interface Provider {
  readonly name: 'openai' | 'anthropic'
  /** False when the provider's API key is absent — routing skips it. */
  readonly available: boolean
  /** Returns the raw JSON string, or null on failure. Validation is the caller's job. */
  json(model: string, call: JsonCall): Promise<string | null>
  text(model: string, system: string, user: string, maxTokens: number): Promise<string | null>
}
