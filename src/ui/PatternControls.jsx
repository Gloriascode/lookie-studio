// Motif, palette and style for a new pattern. Shared by the prompt composer and the design
// upload. Arcade takes the palette (`colors`, up to 10) and style (`modelId`) as real fields;
// the motif is folded into the prompt by the worker.
import { useEffect, useId, useRef, useState } from 'react'
import { api } from '../api'

export const EMPTY_CONTROLS = { motif: '', colors: [], styleId: '' }
const MAX_COLORS = 10

/** Request fields for api.createPattern / api.uploadDesign (empty ones left out). */
export function controlsPayload({ motif, colors, styleId }) {
  return {
    motif: motif.trim() || undefined,
    colors: colors.length ? colors : undefined,
    styleId: styleId || undefined,
  }
}

const PRESETS = [
  { name: 'Garden', colors: ['#7d8f69', '#f3ead8', '#c4683f', '#2f4a3a'] },
  { name: 'Citrus', colors: ['#f2c14e', '#f78154', '#fdf6e3', '#4d9078'] },
  { name: 'Coastal', colors: ['#1d3557', '#a8dadc', '#f1faee', '#e9c46a'] },
  { name: 'Jewel', colors: ['#5b2a86', '#1b998b', '#f4d35e', '#9a031e'] },
  { name: 'Blush', colors: ['#f6d6d6', '#c97c8a', '#fffaf3', '#6b4e4e'] },
  { name: 'Ink', colors: ['#111827', '#f5f1e8', '#9ca3af'] },
]

// Styles change rarely: fetch once per page load and share between composers.
let stylesPromise = null
function useStyles() {
  const [styles, setStyles] = useState([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    stylesPromise ??= api.listStyles().then((r) => r.styles)
    stylesPromise
      .then((s) => live && setStyles([...s].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {
        stylesPromise = null
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [])
  return { styles, failed }
}

function Palette({ colors, onChange }) {
  const picker = useRef(null)
  // Refs, not state: the native `change` listener below outlives renders.
  const editing = useRef(null) // index being recoloured, 'new', or null
  const latest = useRef({ colors, onChange })
  latest.current = { colors, onChange }

  // React's onChange on <input type=color> fires on every drag step (it listens to `input`);
  // the native `change` event fires once, when the picker closes with a choice.
  useEffect(() => {
    const input = picker.current
    const onPicked = () => {
      const { colors, onChange } = latest.current
      const c = input.value.toLowerCase()
      const i = editing.current
      editing.current = null
      if (i === 'new') {
        if (!colors.includes(c) && colors.length < MAX_COLORS) onChange([...colors, c])
      } else if (i != null) {
        onChange(colors.map((x, j) => (j === i ? c : x)))
      }
    }
    input.addEventListener('change', onPicked)
    return () => input.removeEventListener('change', onPicked)
  }, [])

  function openPicker(index) {
    editing.current = index
    const input = picker.current
    input.value = index === 'new' ? colors.at(-1) ?? '#c4683f' : colors[index]
    try {
      input.showPicker()
    } catch {
      input.click()
    }
  }

  return (
    <div className="palette">
      <ul className="palette__chips" aria-label="Palette">
        {colors.map((c, i) => (
          <li key={`${c}-${i}`} className="palette__chip">
            <button type="button" className="palette__swatch" style={{ background: c }} aria-label={`Change colour ${c}`} title={c} onClick={() => openPicker(i)} />
            <button type="button" className="palette__remove" aria-label={`Remove ${c}`} onClick={() => onChange(colors.filter((_, j) => j !== i))}>
              ×
            </button>
          </li>
        ))}
        {colors.length < MAX_COLORS && (
          <li>
            <button type="button" className="palette__add" aria-label="Add a colour" onClick={() => openPicker('new')}>
              +
            </button>
          </li>
        )}
      </ul>
      <input
        ref={picker}
        type="color"
        className="palette__picker"
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="palette__presets" role="group" aria-label="Palette presets">
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="preset" onClick={() => onChange(p.colors)} title={p.colors.join(' ')}>
            <span className="preset__dots" aria-hidden="true">
              {p.colors.map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            {p.name}
          </button>
        ))}
        {colors.length > 0 && (
          <button type="button" className="link-btn" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * @param {{ value: typeof EMPTY_CONTROLS, onChange: (v: typeof EMPTY_CONTROLS) => void, collapsible?: boolean }} props
 * collapsible: tuck the controls behind a "Motif, palette & style" disclosure (compact layouts).
 */
export function PatternControls({ value, onChange, collapsible = false }) {
  const id = useId()
  const { styles, failed } = useStyles()
  const set = (patch) => onChange({ ...value, ...patch })
  const count = (value.motif.trim() ? 1 : 0) + (value.colors.length ? 1 : 0) + (value.styleId ? 1 : 0)

  const body = (
    <div className="controls">
      <label className="field">
        <span>Motif</span>
        <input
          value={value.motif}
          maxLength={200}
          onChange={(e) => set({ motif: e.target.value })}
          placeholder="e.g. lemons and leaves, songbirds, wild strawberries"
        />
      </label>
      <div className="field">
        <span id={`${id}-palette`}>Palette</span>
        <div aria-labelledby={`${id}-palette`}>
          <Palette colors={value.colors} onChange={(colors) => set({ colors })} />
        </div>
      </div>
      <label className="field">
        <span>Style</span>
        <select value={value.styleId} onChange={(e) => set({ styleId: e.target.value })} disabled={failed && !styles.length}>
          <option value="">{failed ? 'Styles unavailable — Arcade picks' : 'Any style (Arcade picks)'}</option>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )

  if (!collapsible) return body
  return (
    <details className="controls-disclosure" open={count > 0 || undefined}>
      <summary>
        Motif, palette & style
        {count > 0 && <span className="controls-disclosure__count">{count} set</span>}
      </summary>
      {body}
    </details>
  )
}

/** Small read-only summary for a pattern: palette dots + style name. */
export function PatternMeta({ pattern }) {
  const { styles } = useStyles()
  const style = pattern.styleId ? styles.find((s) => s.id === pattern.styleId)?.name ?? pattern.styleId : null
  if (!pattern.colors?.length && !style && !pattern.motif) return null
  return (
    <span className="pattern-meta">
      {pattern.colors?.length > 0 && (
        <span className="preset__dots" aria-label={`Palette ${pattern.colors.join(', ')}`}>
          {pattern.colors.map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
        </span>
      )}
      {(pattern.motif || style) && <span className="pattern-meta__text">{[pattern.motif, style].filter(Boolean).join(' · ')}</span>}
    </span>
  )
}
