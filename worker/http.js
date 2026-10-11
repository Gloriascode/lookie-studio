// Small HTTP helpers shared by the route modules.

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export const json = (data, init = {}) =>
  Response.json(data, { ...init, headers: { 'Cache-Control': 'no-store', ...(init.headers ?? {}) } })

export async function readJson(request) {
  try {
    const body = await request.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body
  } catch {}
  throw new HttpError(400, 'Expected a JSON object body')
}

export const now = () => Date.now()
export const uuid = () => crypto.randomUUID()

/** Same-origin URL for an R2 key (served by /files/*). */
export const fileUrl = (key) => (key ? `/files/${key}` : null)

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
export const extFor = (mediaType) => EXT[mediaType] ?? 'bin'

/**
 * Fetch a remote image and store it in R2. Returns the key, or null if the fetch failed.
 * `base` is the key without extension; the extension comes from the response content-type.
 */
export async function copyToR2(env, url, base) {
  const res = await fetch(url)
  if (!res.ok) return null
  const type = (res.headers.get('content-type') ?? 'image/png').split(';')[0].trim()
  const key = `${base}.${extFor(type)}`
  await env.BUCKET.put(key, res.body, { httpMetadata: { contentType: type } })
  return key
}
