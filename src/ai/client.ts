import type { Action, GameState } from '../engine/types'
import type { CompactState } from '../engine/summary'

// Thin fetch wrappers for the LLM proxy. Every call has a hard timeout; callers
// treat null as "use the heuristic fallback" — the game never stalls on the API.

const TIMEOUT_MS = 9000

async function post<T>(url: string, body: unknown): Promise<T | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface OrdersResponse {
  actions: Action[]
}

export interface MonsterResponse {
  actions: Action[]
  taunt?: { unitId: string; text: string } | null
}

export function fetchPartyActions(order: string, summary: CompactState): Promise<OrdersResponse | null> {
  return post<OrdersResponse>('/api/orders', { order, state: summary })
}

export function fetchMonsterActions(summary: CompactState): Promise<MonsterResponse | null> {
  return post<MonsterResponse>('/api/monster-turn', { state: summary })
}

export function fetchNarration(context: string): Promise<{ text: string } | null> {
  return post<{ text: string }>('/api/narrator', { context })
}

export function llmHealthy(): Promise<{ ok: boolean; mock: boolean } | null> {
  return fetch('/api/health')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
}

export type { GameState }
