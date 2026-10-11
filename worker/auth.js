// Minimal creator auth: email + password (PBKDF2-SHA256), opaque session cookie.
// Only the SHA-256 of the session token is stored, so a DB leak doesn't leak sessions.
import { HttpError, json, now, readJson, uuid } from './http.js'

const COOKIE = 'ls_session'
const SESSION_MS = 30 * 24 * 3600 * 1000
const PBKDF2_ITERATIONS = 100_000
const RESERVED = new Set(['api', 'files', 's', 'studio', 'shop', 'admin'])
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

const enc = new TextEncoder()
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const randomHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)))
const sha256 = async (s) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)))
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256)
  return toHex(bits)
}

/** Constant-time comparison of two equal-length hex strings. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function validateSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new HttpError(400, 'Shop link must be 3–40 characters: lowercase letters, numbers and dashes')
  }
  if (RESERVED.has(slug)) throw new HttpError(400, 'That shop link is reserved')
  return slug
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

function sessionCookie(request, token, maxAge) {
  // `Secure` cookies are still accepted on http://localhost by browsers; curl needs https off.
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

export const creatorJson = (c) => (c ? { id: c.id, email: c.email, name: c.name } : null)
export const shopJson = (s) => (s ? { id: s.id, slug: s.slug, name: s.name, tagline: s.tagline, url: `/s/${s.slug}` } : null)

/** The signed-in creator (+ their shop) or null. */
export async function currentCreator(request, env) {
  const token = readCookie(request, COOKIE)
  if (!token) return null
  const row = await env.DB.prepare(
    `SELECT c.* FROM sessions s JOIN creators c ON c.id = s.creator_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first()
  if (!row) return null
  const shop = await env.DB.prepare('SELECT * FROM shops WHERE creator_id = ?').bind(row.id).first()
  return { creator: row, shop }
}

export async function requireCreator(request, env) {
  const me = await currentCreator(request, env)
  if (!me) throw new HttpError(401, 'Sign in to continue')
  if (!me.shop) throw new HttpError(500, 'Creator has no shop')
  return me
}

async function startSession(request, env, creatorId) {
  const token = randomHex(32)
  await env.DB.prepare('INSERT INTO sessions (token_hash, creator_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), creatorId, now() + SESSION_MS)
    .run()
  return sessionCookie(request, token, SESSION_MS / 1000)
}

const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')

export async function signup(request, env) {
  const body = await readJson(request)
  const email = normEmail(body.email)
  const name = String(body.name ?? '').trim()
  const shopName = String(body.shopName ?? '').trim()
  const password = String(body.password ?? '')
  const slug = validateSlug(String(body.slug ?? '').trim().toLowerCase())
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email')
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters')
  if (!name) throw new HttpError(400, 'Enter your name')
  if (!shopName) throw new HttpError(400, 'Enter a shop name')

  if (await env.DB.prepare('SELECT 1 FROM creators WHERE email = ?').bind(email).first()) {
    throw new HttpError(409, 'An account with that email already exists')
  }
  if (await env.DB.prepare('SELECT 1 FROM shops WHERE slug = ?').bind(slug).first()) {
    throw new HttpError(409, 'That shop link is taken')
  }

  const salt = randomHex(16)
  const creator = { id: uuid(), email, name, password_hash: await hashPassword(password, salt), salt, created_at: now() }
  const shop = { id: uuid(), creator_id: creator.id, slug, name: shopName, tagline: '', created_at: now() }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO creators (id, email, name, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      creator.id, creator.email, creator.name, creator.password_hash, creator.salt, creator.created_at,
    ),
    env.DB.prepare('INSERT INTO shops (id, creator_id, slug, name, tagline, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      shop.id, shop.creator_id, shop.slug, shop.name, shop.tagline, shop.created_at,
    ),
  ])
  const cookie = await startSession(request, env, creator.id)
  return json({ creator: creatorJson(creator), shop: shopJson(shop) }, { status: 201, headers: { 'Set-Cookie': cookie } })
}

export async function login(request, env) {
  const body = await readJson(request)
  const email = normEmail(body.email)
  const password = String(body.password ?? '')
  const creator = await env.DB.prepare('SELECT * FROM creators WHERE email = ?').bind(email).first()
  // Hash even when the email is unknown, so timing doesn't reveal which emails exist.
  const hash = await hashPassword(password, creator?.salt ?? '00'.repeat(16))
  if (!creator || !safeEqual(hash, creator.password_hash)) throw new HttpError(401, 'Wrong email or password')
  const shop = await env.DB.prepare('SELECT * FROM shops WHERE creator_id = ?').bind(creator.id).first()
  const cookie = await startSession(request, env, creator.id)
  // Opportunistic cleanup of this creator's expired sessions.
  await env.DB.prepare('DELETE FROM sessions WHERE creator_id = ? AND expires_at < ?').bind(creator.id, now()).run()
  return json({ creator: creatorJson(creator), shop: shopJson(shop) }, { headers: { 'Set-Cookie': cookie } })
}

export async function logout(request, env) {
  const token = readCookie(request, COOKIE)
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(request, '', 0) } })
}
