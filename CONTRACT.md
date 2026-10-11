# Lookie Studio — API contract

Worker: `worker/index.js` (Cloudflare Worker `lookie-studio`, bindings `DB` = D1, `BUCKET` = R2,
secret `ARCADE_API_KEY`, vars `ARCADE_API_BASE`, `ARCADE_USER_AGENT`). Static SPA is served by
Workers Assets; the worker runs first only for `/api/*` and `/files/*`.

All bodies are JSON unless noted. Errors: `{ error: string }` with a 4xx/5xx status.
Auth: `POST /api/auth/*` set an `HttpOnly; Secure; SameSite=Lax` cookie `ls_session` (30 days;
`Secure` is omitted on plain-http local dev so curl cookie jars work). Create routes return 201.
Arcade failures surface as 502 `{ error }`; Arcade rate limiting as 503 (retry shortly).
Routes marked 🔒 return 401 without a valid session.

## Shapes

```ts
Creator  = { id, email, name }
Shop     = { id, slug, name, tagline, url }               // url = `/s/${slug}`
Design   = { id, filename, imageUrl, referenceId, createdAt }
Pattern  = { id, designId|null, prompt, status: 'pending'|'succeeded'|'failed',
             imageUrl|null, thumbUrl|null, width|null, height|null, error|null,
             motif|null, colors: string[] /* #rrggbb */, styleId|null, createdAt }
Style    = { id, name }                                   // Arcade models/list
Product  = { id, slot, categoryName, status: 'pending'|'succeeded'|'failed', error|null,
             title|null, selectionLabel|null, unitPrice: { amount: string, currency } | null,
             imageUrl|null,                      // Arcade product mockup, copied to R2
             pattern: { id, imageUrl, thumbUrl } }
```
`imageUrl`/`thumbUrl` are same-origin `/files/<key>` URLs (copied into R2, never expiring Arcade links).

## Routes

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | /api/auth/signup | `{ email, password, name, shopName, slug }` | `{ creator, shop }` |
| POST | /api/auth/login | `{ email, password }` | `{ creator, shop }` |
| POST | /api/auth/logout | – | `{ ok: true }` |
| GET | /api/me | – | `{ creator, shop }` or 401 |
| PATCH 🔒 | /api/shop | `{ name?, tagline?, slug? }` | `{ shop }` (409 if slug taken) |
| GET | /api/shops | – | `{ shops: [Shop & { productCount, coverUrl|null }] }` (shops with ≥1 succeeded product) |
| GET | /api/shops/:slug | – | `{ shop, products: Product[] }` (succeeded products only) |
| POST | /api/shops/:slug/checkout | `{ lines: [{ productId, quantity }] }` | `{ checkoutUrl, checkoutId }` |
| GET 🔒 | /api/designs | – | `{ designs: Design[] }` |
| POST 🔒 | /api/designs | multipart: `file` (png/jpeg/webp ≤ 10 MB), `prompt?`, `variations?` (1–4, default 3), `motif?`, `colors?` (JSON array or comma list of #rrggbb), `styleId?` | `{ design, patterns: Pattern[] }` |
| GET 🔒 | /api/patterns | – | `{ patterns: Pattern[] }` (newest first; refreshes up to 3 pending jobs per call) |
| POST 🔒 | /api/patterns | `{ prompt?, designId?, motif?, colors?, styleId? }` (prompt or motif required) | `{ pattern }` (text-only or guided by an uploaded design) |
| GET | /api/styles | – | `{ styles: Style[] }` (Arcade style models, cached 10 min) |
| GET 🔒 | /api/shop/products | – | `{ products: Product[] }` (all statuses; refreshes pending) |
| POST 🔒 | /api/shop/products | `{ slot, patternId }` | `{ product }` (replaces the slot's current product; 400 for display-only slots like `rug`, 409 if the pattern isn't succeeded) |
| DELETE 🔒 | /api/shop/products/:slot | – | `{ ok: true }` |
| GET | /files/* | – | R2 object, `Cache-Control: public, max-age=31536000, immutable` |

`productId` in checkout lines is OUR product id; the worker maps it to the Arcade product id,
checks it belongs to that shop, and calls Arcade `checkouts/create` with `dropShip: true`
(required for single-quantity lines without a subscription).

## Arcade flow (worker side)

- Design upload: R2 put → `references/createUpload` → PUT bytes to `uploadUrl` with exactly
  `requiredHeaders` → `references/create` → `referenceId`. Then `variations` ×
  `patterns/create { prompt, referenceIds: [referenceId] }` with distinct layout prompts.
- Pattern refresh: `jobs/get`; on `succeeded`, `patterns/get` → fetch `imageUrl` + `thumbnailUrl`
  → R2 `patterns/<id>.png` / `patterns/<id>_thumb.<ext>`.
- Product: category id from `categories/list` by `SLOTS[slot].category` name → `categories/get
  { categoryId, selections: {} }` → `products/create { patternId, categoryId, selections, fit:
  { mode: 'fill' } }` → refresh via `jobs/get` → `products/get` (title, unitPrice, imageUrl → R2).
- Every Arcade call: `Authorization: Bearer ARCADE_API_KEY`, `User-Agent: ARCADE_USER_AGENT`,
  a unique `requestId`. `jobs/get` is rate limited (429 seen when polling every ~3 s): refresh at
  most 3 pending jobs per request and skip any polled in the last 4 s (`polled_at` column).
