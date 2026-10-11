import { useState } from 'react'
import { api } from '../api'
import { appStore } from '../state/appStore'
import { SLUG_RE, slugify } from './format'
import { Link } from './router'

export function AuthCard() {
  const [tab, setTab] = useState('signup')
  const [form, setForm] = useState({ name: '', email: '', password: '', shopName: '', slug: '' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => {
    const v = e.target.value
    setForm((f) => {
      const next = { ...f, [k]: v }
      if (k === 'shopName' && !slugTouched) next.slug = slugify(v)
      return next
    })
  }

  const slugOk = SLUG_RE.test(form.slug)
  const signup = tab === 'signup'

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (signup && !slugOk) return setError('Your shop link needs 3–40 lowercase letters, numbers or dashes.')
    if (signup && form.password.length < 8) return setError('Use at least 8 characters for your password.')
    setBusy(true)
    try {
      const res = signup
        ? await api.signup(form)
        : await api.login({ email: form.email, password: form.password })
      appStore.set({ creator: res.creator, shop: res.shop })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center-stage">
      <section className="card auth" aria-labelledby="auth-title">
        <Link to="/" className="card__back">
          ← Back
        </Link>
        <h1 id="auth-title" className="card__title">
          {signup ? 'Open your studio' : 'Welcome back'}
        </h1>
        <p className="card__lede">
          {signup
            ? 'Upload your designs, turn them into patterns, and dress Lookie Studio with products people can buy.'
            : 'Sign in to keep designing your shop.'}
        </p>

        <div className="seg" role="tablist" aria-label="Account">
          <button type="button" role="tab" aria-selected={signup} className="seg__btn" onClick={() => setTab('signup')}>
            Create account
          </button>
          <button type="button" role="tab" aria-selected={!signup} className="seg__btn" onClick={() => setTab('login')}>
            Sign in
          </button>
        </div>

        <form className="form" onSubmit={submit} noValidate>
          {signup && (
            <label className="field">
              <span>Your name</span>
              <input value={form.name} onChange={set('name')} autoComplete="name" required />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete={signup ? 'new-password' : 'current-password'}
              minLength={signup ? 8 : undefined}
              required
            />
          </label>
          {signup && (
            <>
              <label className="field">
                <span>Shop name</span>
                <input value={form.shopName} onChange={set('shopName')} placeholder="Marigold Prints" required />
              </label>
              <label className="field">
                <span>Shop link</span>
                <div className={`slug-input${form.slug && !slugOk ? ' slug-input--bad' : ''}`}>
                  <span className="slug-input__prefix">/s/</span>
                  <input
                    value={form.slug}
                    onChange={(e) => {
                      setSlugTouched(true)
                      setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))
                    }}
                    aria-describedby="slug-hint"
                    spellCheck={false}
                    required
                  />
                </div>
                <small id="slug-hint" className={form.slug && !slugOk ? 'hint hint--bad' : 'hint'}>
                  {form.slug && !slugOk
                    ? '3–40 characters: lowercase letters, numbers, dashes.'
                    : form.slug
                      ? `Shoppers visit ${location.host}/s/${form.slug}`
                      : 'This is the link you share with shoppers.'}
                </small>
              </label>
            </>
          )}
          <p className="form__error" role="alert" aria-live="assertive">
            {error}
          </p>
          <button className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'One moment…' : signup ? 'Create my studio' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  )
}
