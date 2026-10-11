// Public shopper routes: browse shops, view a shop, check out. No auth.
import { arcade, requestId } from './arcade.js'
import { shopJson } from './auth.js'
import { HttpError, fileUrl, json, readJson } from './http.js'
import { refreshProducts } from './jobs.js'
import { PRODUCT_SELECT, productJson } from './studio.js'

export async function listShops(request, env) {
  const { results } = await env.DB.prepare(
    `SELECT s.*, COUNT(sp.id) AS product_count, MAX(sp.image_key) AS cover_key
     FROM shops s JOIN shop_products sp ON sp.shop_id = s.id AND sp.status = 'succeeded'
     GROUP BY s.id ORDER BY MAX(sp.created_at) DESC LIMIT 100`,
  ).all()
  return json({ shops: results.map((s) => ({ ...shopJson(s), productCount: s.product_count, coverUrl: fileUrl(s.cover_key) })) })
}

async function shopBySlug(env, slug) {
  const shop = await env.DB.prepare('SELECT * FROM shops WHERE slug = ?').bind(String(slug).toLowerCase()).first()
  if (!shop) throw new HttpError(404, 'Shop not found')
  return shop
}

export async function getShop(request, env, ctx, slug) {
  const shop = await shopBySlug(env, slug)
  // Keep the shop fresh even when its creator isn't polling, without slowing shoppers down.
  ctx.waitUntil(refreshProducts(env, shop.id).catch((e) => console.error('getShop refresh', e)))
  const { results } = await env.DB.prepare(`${PRODUCT_SELECT} WHERE sp.shop_id = ? AND sp.status = 'succeeded' ORDER BY sp.created_at`)
    .bind(shop.id)
    .all()
  return json({ shop: shopJson(shop), products: results.map(productJson) })
}

export async function checkout(request, env, slug) {
  const shop = await shopBySlug(env, slug)
  const body = await readJson(request)
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw new HttpError(400, 'Your bag is empty')
  if (body.lines.length > 50) throw new HttpError(400, 'Too many items')

  // Merge duplicate lines, validate quantities.
  const qty = new Map()
  for (const line of body.lines) {
    const q = Number(line?.quantity)
    if (typeof line?.productId !== 'string' || !Number.isInteger(q) || q < 1 || q > 1000) throw new HttpError(400, 'Invalid line')
    qty.set(line.productId, (qty.get(line.productId) ?? 0) + q)
  }
  const ids = [...qty.keys()]
  const { results } = await env.DB.prepare(
    `SELECT id, arcade_product_id FROM shop_products WHERE shop_id = ? AND status = 'succeeded' AND id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(shop.id, ...ids)
    .all()
  if (results.length !== ids.length) throw new HttpError(409, 'Some items are no longer available — refresh the shop')

  const res = await arcade(env, 'checkouts/create', {
    requestId: requestId('checkout'),
    lines: results.map((r) => ({ productId: r.arcade_product_id, quantity: Math.min(1000, qty.get(r.id)) })),
    // Required for quantity-1 lines without an Arcade subscription (else 412).
    dropShip: true,
  })
  return json({ checkoutUrl: res.checkoutUrl, checkoutId: res.checkoutId })
}
