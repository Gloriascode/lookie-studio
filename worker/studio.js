// Creator-only routes: shop settings, designs, patterns, products.
import { arcade, categoryByName, defaultSelections, requestId } from './arcade.js'
import { requireCreator, shopJson, validateSlug } from './auth.js'
import { HttpError, extFor, fileUrl, json, now, readJson, uuid } from './http.js'
import { completePattern, refreshPatterns, refreshProducts } from './jobs.js'
import { SLOT_BY_ID } from '../src/slots.js'

const MAX_UPLOAD = 10 * 1024 * 1024
const UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

// One design upload fans out into a few distinct takes on it.
const VARIATION_PROMPTS = [
  'Seamless repeating textile pattern inspired by this artwork: small, evenly scattered motifs on a soft ground',
  'Seamless repeating textile pattern inspired by this artwork: bold large-scale repeat with generous negative space',
  'Seamless repeating textile pattern inspired by this artwork: tonal two-colour block-print style',
  'Seamless repeating textile pattern inspired by this artwork: dense botanical all-over print',
]

// ── JSON shapes (CONTRACT.md) ────────────────────────────────────────────────

export const designJson = (d) => ({
  id: d.id,
  filename: d.filename,
  imageUrl: fileUrl(d.r2_key),
  referenceId: d.arcade_reference_id,
  createdAt: d.created_at,
})

export const patternJson = (p) => ({
  id: p.id,
  designId: p.design_id ?? null,
  prompt: p.prompt,
  status: p.status,
  imageUrl: fileUrl(p.image_key),
  thumbUrl: fileUrl(p.thumb_key),
  width: p.width ?? null,
  height: p.height ?? null,
  error: p.error ?? null,
  createdAt: p.created_at,
})

/** Row from PRODUCT_SELECT (shop_products joined with its pattern). */
export const productJson = (r) => ({
  id: r.id,
  slot: r.slot,
  categoryName: r.category_name,
  status: r.status,
  error: r.error ?? null,
  title: r.title ?? null,
  selectionLabel: r.selection_label ?? null,
  unitPrice: r.unit_price_json ? JSON.parse(r.unit_price_json) : null,
  imageUrl: fileUrl(r.image_key),
  pattern: { id: r.pattern_id, imageUrl: fileUrl(r.pattern_image_key), thumbUrl: fileUrl(r.pattern_thumb_key) },
})

export const PRODUCT_SELECT = `
  SELECT sp.*, p.image_key AS pattern_image_key, p.thumb_key AS pattern_thumb_key
  FROM shop_products sp JOIN patterns p ON p.id = sp.pattern_id`

// ── Shop ─────────────────────────────────────────────────────────────────────

export async function updateShop(request, env) {
  const { shop } = await requireCreator(request, env)
  const body = await readJson(request)
  const next = { ...shop }
  if (body.name !== undefined) {
    next.name = String(body.name).trim().slice(0, 80)
    if (!next.name) throw new HttpError(400, 'Shop name cannot be empty')
  }
  if (body.tagline !== undefined) next.tagline = String(body.tagline).trim().slice(0, 160)
  if (body.slug !== undefined && body.slug !== shop.slug) {
    next.slug = validateSlug(String(body.slug).trim().toLowerCase())
    const taken = await env.DB.prepare('SELECT 1 FROM shops WHERE slug = ? AND id != ?').bind(next.slug, shop.id).first()
    if (taken) throw new HttpError(409, 'That shop link is taken')
  }
  await env.DB.prepare('UPDATE shops SET name = ?, tagline = ?, slug = ? WHERE id = ?').bind(next.name, next.tagline, next.slug, shop.id).run()
  return json({ shop: shopJson(next) })
}

// ── Designs ──────────────────────────────────────────────────────────────────

export async function listDesigns(request, env) {
  const { creator } = await requireCreator(request, env)
  const { results } = await env.DB.prepare('SELECT * FROM designs WHERE creator_id = ? ORDER BY created_at DESC').bind(creator.id).all()
  return json({ designs: results.map(designJson) })
}

/** Upload bytes to Arcade as a reference image; returns the referenceId. */
async function createReference(env, bytes, mediaType) {
  const up = await arcade(env, 'references/createUpload', { requestId: requestId('upload'), mediaType, byteLength: bytes.byteLength })
  const put = await fetch(up.uploadUrl, { method: up.method ?? 'PUT', headers: up.requiredHeaders, body: bytes })
  if (!put.ok) throw new HttpError(502, `Reference upload failed (${put.status})`)
  const ref = await arcade(env, 'references/create', { requestId: requestId('ref'), uploadId: up.uploadId })
  return ref.referenceId
}

/** Start a patterns/create job and insert its row. */
async function startPattern(env, creatorId, { prompt, designId = null, referenceId = null }) {
  const row = { id: uuid(), creator_id: creatorId, design_id: designId, prompt, status: 'pending', created_at: now() }
  const job = await arcade(env, 'patterns/create', {
    requestId: requestId('pattern'),
    prompt,
    ...(referenceId ? { referenceIds: [referenceId] } : {}),
  })
  row.arcade_job_id = job.jobId
  await env.DB.prepare(
    'INSERT INTO patterns (id, creator_id, design_id, prompt, arcade_job_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(row.id, creatorId, designId, prompt, job.jobId, 'pending', row.created_at)
    .run()
  // Rare, but a job can come back already finished.
  if (job.status === 'succeeded' && job.result?.patternId) {
    await completePattern(env, row, job.result.patternId)
    return { ...row, ...(await env.DB.prepare('SELECT * FROM patterns WHERE id = ?').bind(row.id).first()) }
  }
  if (job.status === 'failed') {
    await env.DB.prepare(`UPDATE patterns SET status = 'failed', error = ? WHERE id = ?`).bind(job.error?.message ?? 'failed', row.id).run()
    return { ...row, status: 'failed', error: job.error?.message ?? 'failed' }
  }
  return row
}

const cleanPrompt = (p) => String(p ?? '').trim().slice(0, 500)
const combine = (base, extra) => (extra ? `${base}. ${extra}` : base).slice(0, 1000)

export async function uploadDesign(request, env) {
  const { creator } = await requireCreator(request, env)
  let form
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'Expected multipart/form-data')
  }
  const file = form.get('file')
  if (!file || typeof file === 'string') throw new HttpError(400, 'Attach an image as `file`')
  if (!UPLOAD_TYPES.has(file.type)) throw new HttpError(415, 'Upload a PNG, JPEG or WebP image')
  if (file.size > MAX_UPLOAD) throw new HttpError(413, 'Images must be 10 MB or smaller')
  const extra = cleanPrompt(form.get('prompt'))
  const variations = Math.max(1, Math.min(4, parseInt(form.get('variations') ?? '3', 10) || 3))

  const bytes = await file.arrayBuffer()
  const id = uuid()
  const key = `designs/${id}.${extFor(file.type)}`
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: file.type } })
  const referenceId = await createReference(env, bytes, file.type)

  const design = {
    id,
    creator_id: creator.id,
    filename: String(file.name || 'design').slice(0, 200),
    r2_key: key,
    media_type: file.type,
    arcade_reference_id: referenceId,
    created_at: now(),
  }
  await env.DB.prepare(
    'INSERT INTO designs (id, creator_id, filename, r2_key, media_type, arcade_reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(design.id, design.creator_id, design.filename, design.r2_key, design.media_type, design.arcade_reference_id, design.created_at)
    .run()

  const patterns = []
  for (let i = 0; i < variations; i++) {
    patterns.push(await startPattern(env, creator.id, { prompt: combine(VARIATION_PROMPTS[i], extra), designId: id, referenceId }))
  }
  return json({ design: designJson(design), patterns: patterns.map(patternJson) }, { status: 201 })
}

// ── Patterns ─────────────────────────────────────────────────────────────────

export async function listPatterns(request, env) {
  const { creator } = await requireCreator(request, env)
  await refreshPatterns(env, creator.id)
  const { results } = await env.DB.prepare('SELECT * FROM patterns WHERE creator_id = ? ORDER BY created_at DESC').bind(creator.id).all()
  return json({ patterns: results.map(patternJson) })
}

export async function createPattern(request, env) {
  const { creator } = await requireCreator(request, env)
  const body = await readJson(request)
  const prompt = cleanPrompt(body.prompt)
  if (!prompt) throw new HttpError(400, 'Describe the pattern you want')
  let referenceId = null
  let designId = null
  if (body.designId) {
    const design = await env.DB.prepare('SELECT * FROM designs WHERE id = ? AND creator_id = ?').bind(body.designId, creator.id).first()
    if (!design) throw new HttpError(404, 'Design not found')
    designId = design.id
    referenceId = design.arcade_reference_id
  }
  const row = await startPattern(env, creator.id, { prompt, designId, referenceId })
  return json({ pattern: patternJson(row) }, { status: 201 })
}

// ── Products ─────────────────────────────────────────────────────────────────

export async function listShopProducts(request, env) {
  const { shop } = await requireCreator(request, env)
  await refreshProducts(env, shop.id)
  const { results } = await env.DB.prepare(`${PRODUCT_SELECT} WHERE sp.shop_id = ? ORDER BY sp.created_at DESC`).bind(shop.id).all()
  return json({ products: results.map(productJson) })
}

export async function createShopProduct(request, env, ctx) {
  const { creator, shop } = await requireCreator(request, env)
  const body = await readJson(request)
  const slot = SLOT_BY_ID[body.slot]
  if (!slot) throw new HttpError(400, 'Unknown product slot')
  if (!slot.category) throw new HttpError(400, `${slot.label} is display-only and can't be sold yet`)
  const pattern = await env.DB.prepare('SELECT * FROM patterns WHERE id = ? AND creator_id = ?').bind(body.patternId, creator.id).first()
  if (!pattern) throw new HttpError(404, 'Pattern not found')
  if (pattern.status !== 'succeeded' || !pattern.arcade_pattern_id) throw new HttpError(409, 'That pattern is not ready yet')

  // Record the product as pending first. Arcade's products/create can take over a minute just
  // to hand back a job id, and the row must exist (and show "creating") the whole time.
  const id = uuid()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM shop_products WHERE shop_id = ? AND slot = ?').bind(shop.id, slot.id),
    env.DB.prepare(
      // category_id is filled in once Arcade's category lookup returns.
      `INSERT INTO shop_products (id, shop_id, slot, pattern_id, category_id, category_name, status, created_at)
       VALUES (?, ?, ?, ?, '', ?, 'pending', ?)`,
    ).bind(id, shop.id, slot.id, pattern.id, slot.category, now()),
  ])

  const start = startProductJob(env, id, slot, pattern)
  // Keep the Arcade call alive if the creator navigates away mid-request. If it is cut off
  // anyway, refreshProducts fails rows that never got a job id (see STALE_START_MS).
  ctx.waitUntil(start.catch(() => {}))
  await start.catch(() => {})

  const row = await env.DB.prepare(`${PRODUCT_SELECT} WHERE sp.id = ?`).bind(id).first()
  return json({ product: productJson(row) }, { status: 201 })
}

async function startProductJob(env, id, slot, pattern) {
  try {
    const category = await categoryByName(env, slot.category)
    if (!category) throw new HttpError(502, `Arcade has no "${slot.category}" category`)
    const selections = await defaultSelections(env, category.categoryId)
    const job = await arcade(env, 'products/create', {
      requestId: requestId('product'),
      patternId: pattern.arcade_pattern_id,
      categoryId: category.categoryId,
      selections,
      // The garden's products come in many aspect ratios; fill covers the product with the repeat.
      fit: { mode: 'fill' },
    })
    const failed = job.status === 'failed'
    await env.DB.prepare(
      `UPDATE shop_products SET arcade_job_id = ?, arcade_product_id = ?, category_id = ?, category_name = ?, status = ?, error = ?
       WHERE id = ?`,
    )
      .bind(
        job.jobId, job.result?.productId ?? null, category.categoryId, category.name,
        failed ? 'failed' : 'pending', failed ? (job.error?.message ?? 'Product creation failed') : null, id,
      )
      .run()
  } catch (e) {
    console.error('startProductJob', id, e?.message)
    await env.DB.prepare(`UPDATE shop_products SET status = 'failed', error = ? WHERE id = ?`)
      .bind(e instanceof HttpError ? e.message : 'Arcade could not start this product. Try again.', id)
      .run()
    throw e
  }
}

export async function deleteShopProduct(request, env, slotId) {
  const { shop } = await requireCreator(request, env)
  await env.DB.prepare('DELETE FROM shop_products WHERE shop_id = ? AND slot = ?').bind(shop.id, slotId).run()
  return json({ ok: true })
}
