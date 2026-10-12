import { useEffect, useState } from 'react'
import { api } from '../api'
import { Link, navigate } from './router'

function ShopList({ onBack }) {
  const [shops, setShops] = useState(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    api
      .listShops()
      .then((r) => setShops(r.shops))
      .catch(() => setError(true))
  }, [])

  return (
    <>
      <button type="button" className="card__back" onClick={onBack}>
        ← Back
      </button>
      <h1 className="card__title">Shops in the garden</h1>
      {error ? (
        <p className="empty">Couldn’t load shops. Try again in a moment.</p>
      ) : shops == null ? (
        <p className="muted" aria-live="polite">
          Loading shops…
        </p>
      ) : shops.length === 0 ? (
        <div className="empty">
          <p>No shops have opened yet.</p>
          <Link to="/studio" className="btn btn--primary">
            Open the first one
          </Link>
        </div>
      ) : (
        <ul className="shop-list">
          {shops.map((s) => (
            <li key={s.id}>
              <Link to={`/s/${s.slug}`} className="shop-list__item">
                <span className="shop-list__cover">{s.coverUrl && <img src={s.coverUrl} alt="" />}</span>
                <span className="shop-list__text">
                  <strong>{s.name}</strong>
                  {s.tagline && <small>{s.tagline}</small>}
                </span>
                <span className="muted">{s.productCount} item{s.productCount === 1 ? '' : 's'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export function Landing() {
  const [browsing, setBrowsing] = useState(false)
  return (
    <div className="center-stage center-stage--landing">
      <section className="card landing" aria-labelledby={browsing ? undefined : 'landing-title'}>
        {browsing ? (
          <ShopList onBack={() => setBrowsing(false)} />
        ) : (
          <>
            <span className="eyebrow">Lookie Studio</span>
            <h1 id="landing-title" className="card__title card__title--xl">
              A sunlit studio, dressed in your prints.
            </h1>
            <p className="card__lede">Wander a sunlit conservatory and a quiet bedroom dressed in creators’ prints and shop what you love, or open your own studio and make both rooms yours.</p>
            <div className="choices">
              <button type="button" className="choice" onClick={() => setBrowsing(true)}>
                <span className="choice__kicker">Shop</span>
                <strong>Browse the rooms</strong>
                <span>Pillows, linens and curtains made to order from independent designers.</span>
              </button>
              <button type="button" className="choice choice--accent" onClick={() => navigate('/studio')}>
                <span className="choice__kicker">Create</span>
                <strong>Open your studio</strong>
                <span>Upload designs, turn them into patterns, and sell them on real products.</span>
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
