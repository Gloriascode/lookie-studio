export function formatPrice(price, quantity = 1) {
  if (!price) return ''
  const amount = Number(price.amount) * quantity
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency || 'USD' }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${price.currency ?? ''}`.trim()
  }
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

export function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function shopUrl(slug) {
  return `${location.origin}/s/${slug}`
}
