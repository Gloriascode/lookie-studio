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
/**
 * Copy a remote image into R2 under `base.<ext>`; returns the key or null.
 * `webp`: re-encode to WebP at this quality with the Images binding first. Arcade serves
 * lossless PNGs (1–2 MB for a 1024² pattern); as WebP they are ~10× smaller, and every pattern
 * in a room is downloaded by every visitor. Falls back to the original bytes if that fails.
 */
export async function copyToR2(env, url, base, { webp } = {}) {
  const res = await fetch(url)
  if (!res.ok) return null
  const type = (res.headers.get('content-type') ?? 'image/png').split(';')[0].trim()
  if (webp && env.IMAGES && type !== 'image/webp') {
    const bytes = await res.arrayBuffer()
    try {
      const out = await env.IMAGES.input(new Response(bytes).body).output({ format: 'image/webp', quality: webp })
      const key = `${base}.webp`
      // R2 needs a known length; the encoded WebP is small, so buffer it.
      await env.BUCKET.put(key, await out.response().arrayBuffer(), { httpMetadata: { contentType: 'image/webp' } })
      return key
    } catch (e) {
      console.error('webp conversion failed, keeping original', base, e?.message)
      const key = `${base}.${extFor(type)}`
      await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } })
      return key
    }
  }
  const key = `${base}.${extFor(type)}`
  await env.BUCKET.put(key, res.body, { httpMetadata: { contentType: type } })
  return key
}
