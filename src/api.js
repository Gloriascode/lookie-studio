// Thin client for the lookie-studio worker. See CONTRACT.md for shapes.
async function req(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: {} }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(path, init)
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null
  if (!res.ok) {
    const err = new Error(data?.error ?? `${method} ${path} failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  signup: (body) => req('POST', '/api/auth/signup', body),
  login: (body) => req('POST', '/api/auth/login', body),
  logout: () => req('POST', '/api/auth/logout'),
  me: () => req('GET', '/api/me'),
  updateShop: (body) => req('PATCH', '/api/shop', body),

  listShops: () => req('GET', '/api/shops'),
  getShop: (slug) => req('GET', `/api/shops/${encodeURIComponent(slug)}`),
  checkout: (slug, lines) => req('POST', `/api/shops/${encodeURIComponent(slug)}/checkout`, { lines }),

  listDesigns: () => req('GET', '/api/designs'),
  uploadDesign: (file, { prompt, variations, motif, colors, styleId } = {}) => {
    const form = new FormData()
    form.append('file', file)
    if (prompt) form.append('prompt', prompt)
    if (variations) form.append('variations', String(variations))
    if (motif) form.append('motif', motif)
    if (colors?.length) form.append('colors', JSON.stringify(colors))
    if (styleId) form.append('styleId', styleId)
    return req('POST', '/api/designs', form)
  },
  listPatterns: () => req('GET', '/api/patterns'),
  createPattern: (body) => req('POST', '/api/patterns', body),
  listStyles: () => req('GET', '/api/styles'),

  listProducts: () => req('GET', '/api/shop/products'),
  createProduct: (slot, patternId) => req('POST', '/api/shop/products', { slot, patternId }),
  deleteProduct: (slot) => req('DELETE', `/api/shop/products/${encodeURIComponent(slot)}`),
}
