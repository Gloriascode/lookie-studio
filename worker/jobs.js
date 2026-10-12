// Pending Arcade jobs (patterns + products) are refreshed lazily: whenever a list endpoint is
// read, up to MAX_PER_REQUEST stale jobs are polled. jobs/get is rate limited, so each row is
// "claimed" by bumping polled_at first (a conditional UPDATE), which also stops two concurrent
// requests from polling the same job.
import { arcade, ArcadeError } from './arcade.js'
import { copyToR2, now } from './http.js'

const MAX_PER_REQUEST = 3
const MIN_POLL_GAP_MS = 4000

async function claim(env, table, id) {
  const t = now()
  const res = await env.DB.prepare(`UPDATE ${table} SET polled_at = ? WHERE id = ? AND polled_at < ?`)
    .bind(t, id, t - MIN_POLL_GAP_MS)
    .run()
  return res.meta.changes === 1
}

/** jobs/get, treating rate limits and transient errors as "still running". */
async function pollJob(env, jobId) {
  try {
    return await arcade(env, 'jobs/get', { jobId })
  } catch (e) {
    if (e instanceof ArcadeError && (e.status === 429 || e.status >= 500)) return null
    throw e
  }
}

const shortError = (e) => String(e?.message ?? e).slice(0, 500)

/** Finish a pattern whose job succeeded: fetch the pattern and copy its images into R2. */
export async function completePattern(env, row, arcadePatternId) {
  const p = await arcade(env, 'patterns/get', { patternId: arcadePatternId })
  const [imageKey, thumbKey] = await Promise.all([
    copyToR2(env, p.imageUrl, `patterns/${row.id}`, { webp: 88 }),
    copyToR2(env, p.thumbnailUrl, `patterns/${row.id}_thumb`),
  ])
  if (!imageKey) throw new Error('Could not download the pattern image')
  await env.DB.prepare(
    `UPDATE patterns SET status = 'succeeded', arcade_pattern_id = ?, image_key = ?, thumb_key = ?, width = ?, height = ?, error = NULL WHERE id = ?`,
  )
    .bind(arcadePatternId, imageKey, thumbKey ?? imageKey, p.width, p.height, row.id)
    .run()
}

export async function refreshPatterns(env, creatorId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM patterns WHERE creator_id = ? AND status = 'pending' AND arcade_job_id IS NOT NULL AND polled_at < ?
     ORDER BY polled_at ASC LIMIT ?`,
  )
    .bind(creatorId, now() - MIN_POLL_GAP_MS, MAX_PER_REQUEST)
    .all()

  await Promise.all(
    results.map(async (row) => {
      if (!(await claim(env, 'patterns', row.id))) return
      try {
        const job = await pollJob(env, row.arcade_job_id)
        if (!job || job.status === 'running') return
        if (job.status === 'failed' || !job.result?.patternId) {
          await env.DB.prepare(`UPDATE patterns SET status = 'failed', error = ? WHERE id = ?`)
            .bind(job.error?.message ?? 'Pattern generation failed', row.id)
            .run()
          return
        }
        await completePattern(env, row, job.result.patternId)
      } catch (e) {
        // A permanent API error (4xx) fails the pattern; anything else is retried next poll.
        if (e instanceof ArcadeError && e.status < 500 && e.status !== 429) {
          await env.DB.prepare(`UPDATE patterns SET status = 'failed', error = ? WHERE id = ?`).bind(shortError(e), row.id).run()
        } else console.error('refreshPatterns', row.id, shortError(e))
      }
    }),
  )
}

/** Finish a product whose job succeeded: read title/price and copy the mockup into R2. */
async function completeProduct(env, row, arcadeProductId) {
  const p = await arcade(env, 'products/get', { productId: arcadeProductId, quantity: 1 })
  const imageUrl = p.images?.[0]?.url ?? p.imageUrl
  const imageKey = imageUrl ? await copyToR2(env, imageUrl, `products/${row.id}`, { webp: 85 }) : null
  await env.DB.prepare(
    `UPDATE shop_products SET status = 'succeeded', arcade_product_id = ?, title = ?, selection_label = ?, unit_price_json = ?,
       image_key = COALESCE(?, image_key), error = NULL WHERE id = ?`,
  )
    .bind(arcadeProductId, p.title ?? null, p.selectionLabel ?? null, p.unitPrice ? JSON.stringify(p.unitPrice) : null, imageKey, row.id)
    .run()
}

/**
 * Refresh pending products for a shop, plus succeeded ones whose price was unavailable
 * (products/get returns unitPrice: null while pricing is not ready).
 */
// A product row whose Arcade job never started (request cut off before products/create
// returned) is failed after this long so the creator can retry.
const STALE_START_MS = 5 * 60_000

export async function refreshProducts(env, shopId) {
  await env.DB.prepare(
    `UPDATE shop_products SET status = 'failed', error = 'Arcade did not start this product. Try again.'
     WHERE shop_id = ? AND status = 'pending' AND arcade_job_id IS NULL AND created_at < ?`,
  )
    .bind(shopId, now() - STALE_START_MS)
    .run()
  const { results } = await env.DB.prepare(
    `SELECT * FROM shop_products
     WHERE shop_id = ? AND polled_at < ?
       AND ((status = 'pending' AND arcade_job_id IS NOT NULL) OR (status = 'succeeded' AND unit_price_json IS NULL))
     ORDER BY polled_at ASC LIMIT ?`,
  )
    .bind(shopId, now() - MIN_POLL_GAP_MS, MAX_PER_REQUEST)
    .all()

  await Promise.all(
    results.map(async (row) => {
      if (!(await claim(env, 'shop_products', row.id))) return
      try {
        if (row.status === 'succeeded') return await completeProduct(env, row, row.arcade_product_id)
        const job = await pollJob(env, row.arcade_job_id)
        if (!job || job.status === 'running') return
        if (job.status === 'failed' || !job.result?.productId) {
          await env.DB.prepare(`UPDATE shop_products SET status = 'failed', error = ? WHERE id = ?`)
            .bind(job.error?.message ?? 'Product creation failed', row.id)
            .run()
          return
        }
        await completeProduct(env, row, job.result.productId)
      } catch (e) {
        if (e instanceof ArcadeError && e.status < 500 && e.status !== 429) {
          await env.DB.prepare(`UPDATE shop_products SET status = 'failed', error = ? WHERE id = ?`).bind(shortError(e), row.id).run()
        } else console.error('refreshProducts', row.id, shortError(e))
      }
    }),
  )
}
