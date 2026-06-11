import { useState, useRef, useEffect, useCallback } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  if (!hex) return { r: 59, g: 130, b: 246 }
  const h = hex.replace('#', '')
  if (h.length !== 6) return { r: 59, g: 130, b: 246 }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')
}

function isValidHex(str) {
  return /^#?[0-9a-fA-F]{6}$/.test(str.trim())
}

function normalizeHex(str) {
  const clean = str.trim().replace(/^#/, '')
  return '#' + clean.toLowerCase()
}

const PRESET_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#a3e635',
  '#e11d48', '#7c3aed', '#0ea5e9', '#84cc16', '#fb923c',
  '#64748b', '#10b981', '#f43f5e', '#6366f1', '#eab308',
]

// ── RGB Slider row ────────────────────────────────────────────────────────────

function RgbRow({ channel, label, color, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{
        fontSize: '11px', fontWeight: 700, width: '12px',
        flexShrink: 0, textAlign: 'center', color,
      }}>
        {label}
      </span>
      <input
        type="range" min="0" max="255"
        value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        style={{ flex: 1, height: '4px', cursor: 'pointer', accentColor: color }}
        className="rgb-slider"
      />
      <input
        type="number" min="0" max="255"
        value={value}
        onChange={e => {
          const v = parseInt(e.target.value)
          if (!isNaN(v)) onChange(Math.max(0, Math.min(255, v)))
        }}
        style={{ width: '48px', fontSize: '12px', padding: '3px 6px', textAlign: 'center' }}
        className="rgb-number"
      />
    </div>
  )
}

// ── Color picker dialog ───────────────────────────────────────────────────────

function ColorDialog({ value, onChange, onClose, anchorRef }) {
  const [rgb, setRgb]         = useState(() => hexToRgb(value))
  const [hexInput, setHexInput] = useState(value || '#3b82f6')
  const [hexError, setHexError] = useState(false)
  const dialogRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  // Position below anchor
  useEffect(() => {
    if (!anchorRef?.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const dialogH = 380
    const spaceBelow = window.innerHeight - r.bottom
    const top = spaceBelow >= dialogH ? r.bottom + 6 : r.top - dialogH - 6
    const left = Math.min(r.left, window.innerWidth - 272)
    setPos({ top, left })
  }, [anchorRef])

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (
        dialogRef.current && !dialogRef.current.contains(e.target) &&
        anchorRef?.current && !anchorRef.current.contains(e.target)
      ) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  const applyRgb = useCallback((newRgb) => {
    setRgb(newRgb)
    const hex = rgbToHex(newRgb)
    setHexInput(hex)
    setHexError(false)
    onChange(hex)
  }, [onChange])

  const handleRgbChannel = (channel, val) => {
    applyRgb({ ...rgb, [channel]: val })
  }

  const handleHexInput = (raw) => {
    setHexInput(raw)
    const clean = raw.trim()
    if (isValidHex(clean)) {
      const hex = normalizeHex(clean)
      setRgb(hexToRgb(hex))
      setHexError(false)
      onChange(hex)
    } else {
      setHexError(true)
    }
  }

  const handlePreset = (hex) => {
    setRgb(hexToRgb(hex))
    setHexInput(hex)
    setHexError(false)
    onChange(hex)
  }

  const handleClear = () => {
    onChange(null)
    onClose()
  }

  const currentHex = value || rgbToHex(rgb)

  return (
    <div
      ref={dialogRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: 264,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        zIndex: 9999,
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      {/* Preview + hex input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 'var(--radius-sm)',
          background: currentHex,
          border: '1px solid var(--border)',
          flexShrink: 0,
          transition: 'background 0.1s',
        }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Hex
          </label>
          <input
            type="text"
            value={hexInput}
            onChange={e => handleHexInput(e.target.value)}
            style={{
              fontFamily: 'monospace',
              fontSize: '13px',
              padding: '5px 8px',
              borderColor: hexError ? 'var(--red)' : undefined,
            }}
            spellCheck={false}
            maxLength={7}
          />
        </div>
      </div>

      {/* RGB sliders */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <RgbRow channel="r" label="R" color="#ef4444" value={rgb.r} onChange={v => handleRgbChannel('r', v)} />
        <RgbRow channel="g" label="G" color="#22c55e" value={rgb.g} onChange={v => handleRgbChannel('g', v)} />
        <RgbRow channel="b" label="B" color="#3b82f6" value={rgb.b} onChange={v => handleRgbChannel('b', v)} />
      </div>

      {/* Preset swatches */}
      <div>
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
          Presets
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => handlePreset(c)}
              style={{
                width: 22, height: 22,
                borderRadius: '50%',
                background: c,
                border: `2px solid ${currentHex === c ? 'var(--text)' : 'transparent'}`,
                cursor: 'pointer',
                padding: 0,
                transform: currentHex === c ? 'scale(1.15)' : 'scale(1)',
                transition: 'transform 0.1s, border-color 0.1s',
                flexShrink: 0,
              }}
              title={c}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px', borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          className="btn-ghost"
          style={{ fontSize: '12px', padding: '4px 8px', color: 'var(--red)' }}
          onClick={handleClear}
        >
          Clear
        </button>
        <button
          type="button"
          className="btn-primary"
          style={{ fontSize: '12px', padding: '4px 12px' }}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  )
}

// ── Main ColorPicker component ────────────────────────────────────────────────
// Renders a small color dot as the trigger. Click to open the dialog.

export default function ColorPicker({ value, onChange, hideLabel = false }) {
  const [open, setOpen] = useState(false)
  const dotRef = useRef(null)

  const displayColor = value || null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      {/* Dot trigger */}
      <button
        ref={dotRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        title={displayColor ? `Color: ${displayColor}` : 'No color — click to set'}
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: displayColor || 'transparent',
          border: `2px solid ${displayColor ? displayColor : 'var(--border)'}`,
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
          transition: 'transform 0.1s, box-shadow 0.1s',
          boxShadow: open ? '0 0 0 3px rgba(59,130,246,0.35)' : 'none',
          position: 'relative',
        }}
      >
        {/* Empty dot placeholder when no color */}
        {!displayColor && (
          <span style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: '14px', color: 'var(--text-tertiary)', lineHeight: 1,
          }}>+</span>
        )}
      </button>

      {/* Current hex display */}
      {!hideLabel && displayColor && (
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          {displayColor}
        </span>
      )}
      {!hideLabel && !displayColor && (
        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
          No color
        </span>
      )}

      {open && (
        <ColorDialog
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          anchorRef={dotRef}
        />
      )}
    </div>
  )
}