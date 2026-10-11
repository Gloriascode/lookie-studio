// lookie-studio worker: JSON API (/api/*) + R2 files (/files/*). Everything else is the SPA,
// served by Workers Assets (see wrangler.jsonc run_worker_first). Routes: CONTRACT.md.
import { ArcadeError } from './arcade.js'
import { creatorJson, currentCreator, login, logout, shopJson, signup } from './auth.js'
import { HttpError, json } from './http.js'
import { checkout, getShop, listShops } from './shop.js'
import {
  createPattern,
  createShopProduct,
  deleteShopProduct,
  getStyles,
  listDesigns,
  listPatterns,
  listShopProducts,
  updateShop,
  uploadDesign,
} from './studio.js'

async function serveFile(request, env, key) {
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 })
  const obj = await env.BUCKET.get(key, { onlyIf: request.headers })
  if (!obj) return new Response('Not found', { status: 404 })
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('ETag', obj.httpEtag)
  // Keys are content-addressed by row id and never rewritten.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('Access-Control-Allow-Origin', '*') // WebGL textures may load cross-origin in dev
  // `onlyIf` matched an If-None-Match: R2 returns the object without a body.
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers })
  return new Response(obj.body, { headers })
}

async function route(request, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const m = request.method

  if (path.startsWith('/files/')) {
    if (m !== 'GET' && m !== 'HEAD') return new Response('Method not allowed', { status: 405 })
    return serveFile(request, env, decodeURIComponent(path.slice('/files/'.length)))
  }

  // Auth
  if (path === '/api/auth/signup' && m === 'POST') return signup(request, env)
  if (path === '/api/auth/login' && m === 'POST') return login(request, env)
  if (path === '/api/auth/logout' && m === 'POST') return logout(request, env)
  if (path === '/api/me' && m === 'GET') {
    const me = await currentCreator(request, env)
    if (!me) throw new HttpError(401, 'Not signed in')
    return json({ creator: creatorJson(me.creator), shop: shopJson(me.shop) })
  }

  // Creator studio
  if (path === '/api/shop' && m === 'PATCH') return updateShop(request, env)
  if (path === '/api/designs' && m === 'GET') return listDesigns(request, env)
  if (path === '/api/designs' && m === 'POST') return uploadDesign(request, env)
  if (path === '/api/patterns' && m === 'GET') return listPatterns(request, env)
  if (path === '/api/patterns' && m === 'POST') return createPattern(request, env)
  if (path === '/api/styles' && m === 'GET') return getStyles(request, env)
  if (path === '/api/shop/products' && m === 'GET') return listShopProducts(request, env)
  if (path === '/api/shop/products' && m === 'POST') return createShopProduct(request, env, ctx)
  let match = path.match(/^\/api\/shop\/products\/([^/]+)$/)
  if (match && m === 'DELETE') return deleteShopProduct(request, env, decodeURIComponent(match[1]))

  // Public shop
  if (path === '/api/shops' && m === 'GET') return listShops(request, env)
  match = path.match(/^\/api\/shops\/([^/]+)$/)
  if (match && m === 'GET') return getShop(request, env, ctx, decodeURIComponent(match[1]))
  match = path.match(/^\/api\/shops\/([^/]+)\/checkout$/)
  if (match && m === 'POST') return checkout(request, env, decodeURIComponent(match[1]))

  throw new HttpError(404, 'Not found')
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx)
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status })
      if (e instanceof ArcadeError) {
        console.error(e.message)
        // Rate limited: tell the client to retry; anything else from Arcade is a bad gateway.
        const status = e.status === 429 ? 503 : 502
        return json({ error: e.status === 429 ? 'Arcade is busy — try again in a few seconds' : e.message }, { status })
      }
      console.error('Unhandled', e?.stack ?? e)
      return json({ error: 'Something went wrong' }, { status: 500 })
    }
  },
}
