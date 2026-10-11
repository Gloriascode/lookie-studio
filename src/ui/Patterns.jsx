import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { appStore, useApp } from '../state/appStore'
import { EMPTY_CONTROLS, PatternControls, controlsPayload } from './PatternControls'

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

/** Merge fresh patterns into the store, newest first, without duplicates. */
export function mergePatterns(incoming) {
  const byId = new Map(appStore.get().patterns.map((p) => [p.id, p]))
  for (const p of incoming) byId.set(p.id, p)
  appStore.set({ patterns: [...byId.values()].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)) })
}

export function PatternTile({ pattern, selected, onSelect, size = 'md' }) {
  const ready = pattern.status === 'succeeded' && (pattern.thumbUrl || pattern.imageUrl)
  const label =
    pattern.status === 'pending'
      ? 'Pattern in progress'
      : pattern.status === 'failed'
        ? 'Pattern failed'
        : [pattern.motif && `Motif: ${pattern.motif}`, pattern.prompt].filter(Boolean).join(' — ') || 'Pattern'
  const body = (
    <>
      {ready ? (
        <img src={pattern.thumbUrl || pattern.imageUrl} alt="" loading="lazy" decoding="async" />
      ) : pattern.status === 'failed' ? (
        <span className="tile__note">Couldn’t weave this one</span>
      ) : (
        <span className="tile__note tile__note--pending">Weaving…</span>
      )}
    </>
  )
  const cls = `tile tile--${size} tile--${pattern.status}${selected ? ' tile--selected' : ''}`
  if (!onSelect || !ready)
    return (
      <div className={cls} title={label} role="img" aria-label={label}>
        {body}
      </div>
    )
  return (
    <button type="button" className={cls} title={label} aria-label={label} aria-pressed={selected} onClick={() => onSelect(pattern)}>
      {body}
    </button>
  )
}

export function UploadDesign() {
  const [file, setFile] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [variations, setVariations] = useState(3)
  const [controls, setControls] = useState(EMPTY_CONTROLS)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef()
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => fileUrl && URL.revokeObjectURL(fileUrl), [fileUrl])

  function pick(f) {
    setError(null)
    if (!f) return
    if (!ACCEPT.includes(f.type)) return setError('Use a PNG, JPEG or WebP image.')
    if (f.size > MAX_BYTES) return setError('That file is over 10 MB.')
    setFile(f)
  }

  async function submit(e) {
    e.preventDefault()
    if (!file) return setError('Choose an image first.')
    setBusy(true)
    setError(null)
    try {
      const res = await api.uploadDesign(file, { prompt: prompt.trim() || undefined, variations, ...controlsPayload(controls) })
      appStore.set({ designs: [res.design, ...appStore.get().designs] })
      mergePatterns(res.patterns)
      setFile(null)
      setPrompt('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="upload" onSubmit={submit}>
      <div
        className={`drop${drag ? ' drop--over' : ''}${file ? ' drop--has' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          pick(e.dataTransfer.files?.[0])
        }}
      >
        <input
          ref={input}
          id="design-file"
          type="file"
          accept={ACCEPT.join(',')}
          className="visually-hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {file ? (
          <div className="drop__file">
            <img src={fileUrl} alt="" />
            <div>
              <strong>{file.name}</strong>
              <button type="button" className="link-btn" onClick={() => input.current.click()}>
                Choose another
              </button>
            </div>
          </div>
        ) : (
          <label htmlFor="design-file" className="drop__label">
            <span className="drop__icon" aria-hidden="true">
              ↑
            </span>
            <strong>Upload a design</strong>
            <span>Drop an image or click to browse · PNG, JPEG, WebP up to 10 MB</span>
          </label>
        )}
      </div>
      <label className="field">
        <span>Direction (optional)</span>
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. airy botanical repeat, muted sage" />
      </label>
      <PatternControls value={controls} onChange={setControls} collapsible />
      <div className="upload__row">
        <label className="field field--inline">
          <span>Variations</span>
          <select value={variations} onChange={(e) => setVariations(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button className="btn btn--primary" disabled={busy || !file}>
          {busy ? 'Uploading…' : 'Make patterns'}
        </button>
      </div>
      <p className="form__error" role="alert">
        {error}
      </p>
    </form>
  )
}

export function PromptComposer({ compact = false, onCreated }) {
  const designs = useApp((s) => s.designs)
  const [prompt, setPrompt] = useState('')
  const [designId, setDesignId] = useState('')
  const [controls, setControls] = useState(EMPTY_CONTROLS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!prompt.trim() && !controls.motif.trim()) return setError('Describe the pattern you want, or give it a motif.')
    setBusy(true)
    setError(null)
    try {
      const { pattern } = await api.createPattern({
        prompt: prompt.trim() || undefined,
        designId: designId || undefined,
        ...controlsPayload(controls),
      })
      mergePatterns([pattern])
      setPrompt('')
      onCreated?.(pattern)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={`composer${compact ? ' composer--compact' : ''}`} onSubmit={submit}>
      <label className="field">
        <span>New pattern from a prompt</span>
        <textarea
          rows={compact ? 2 : 3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Hand-drawn lemons on a cream ground, loose watercolor, tossed layout"
        />
      </label>
      <PatternControls value={controls} onChange={setControls} collapsible={compact} />
      <div className="upload__row">
        {designs.length > 0 && (
          <label className="field field--inline field--grow">
            <span>Guided by</span>
            <select value={designId} onChange={(e) => setDesignId(e.target.value)}>
              <option value="">No design</option>
              {designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn" disabled={busy}>
          {busy ? 'Starting…' : 'Create pattern'}
        </button>
      </div>
      <p className="form__error" role="alert">
        {error}
      </p>
    </form>
  )
}

export function PatternsTab() {
  const patterns = useApp((s) => s.patterns)
  const pending = patterns.filter((p) => p.status === 'pending').length
  return (
    <div className="tab-body">
      <UploadDesign />
      <PromptComposer />
      <div className="section-head">
        <h3>Your patterns</h3>
        <span className="muted" aria-live="polite">
          {pending ? `${pending} weaving…` : `${patterns.length}`}
        </span>
      </div>
      {patterns.length === 0 ? (
        <p className="empty">Patterns you make appear here. Upload a design or describe one above.</p>
      ) : (
        <div className="grid">
          {patterns.map((p) => (
            <PatternTile key={p.id} pattern={p} />
          ))}
        </div>
      )}
    </div>
  )
}
