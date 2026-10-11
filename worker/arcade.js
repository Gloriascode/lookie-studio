// Arcade public API client (https://platform.arcade.ai/v1). Every procedure is a JSON POST.
import { HttpError } from './http.js'

export class ArcadeError extends Error {
  constructor(status, procedure, message) {
    super(`Arcade ${procedure}: ${message}`)
    this.status = status
    this.procedure = procedure
  }
}

export async function arcade(env, procedure, body = {}) {
  if (!env.ARCADE_API_KEY) throw new HttpError(500, 'ARCADE_API_KEY is not configured')
  const res = await fetch(`${env.ARCADE_API_BASE}/${procedure}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.ARCADE_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': env.ARCADE_USER_AGENT || 'lookie-studio',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {}
  if (!res.ok) {
    const msg = data?.message ?? data?.error?.message ?? data?.error ?? text.slice(0, 300) ?? res.statusText
    throw new ArcadeError(res.status, procedure, typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
}

/** A fresh idempotency key for one logical request. */
export const requestId = (label) => `ls-${label}-${crypto.randomUUID()}`

// Categories rarely change: cache the list per isolate for 10 minutes.
let categoriesCache = null
export async function categoryByName(env, name) {
  if (!categoriesCache || Date.now() - categoriesCache.at > 10 * 60_000) {
    const { items } = await arcade(env, 'categories/list', {})
    categoriesCache = { at: Date.now(), items }
  }
  const lower = name.toLowerCase()
  return categoriesCache.items.find((c) => c.name.toLowerCase() === lower && c.world === 'print') ?? null
}

/** The default complete selection for a category (what categories/get fills in). */
export async function defaultSelections(env, categoryId) {
  const cat = await arcade(env, 'categories/get', { categoryId, selections: {} })
  return cat.selections
}

// Style models (models/list) for patterns/create's modelId; also stable, same cache policy.
let stylesCache = null
export async function listStyles(env) {
  if (!stylesCache || Date.now() - stylesCache.at > 10 * 60_000) {
    const { items } = await arcade(env, 'models/list', {})
    stylesCache = { at: Date.now(), items: items.map((m) => ({ id: m.modelId, name: m.name })) }
  }
  return stylesCache.items
}
