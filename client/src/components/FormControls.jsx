// FormControls.jsx — shared form input components
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

// ── CurrencyInput ─────────────────────────────────────────────────────────────
// Always displays a fully formatted value ("1,234.56") — both focused and
// blurred. Commas are allowed while typing and stripped before the numeric
// string is passed to onChange. Callers receive a plain numeric string
// (e.g. "1234.56") and should use parseFloat() before sending to the API.
// No spinner arrows (suppressed via .currency-input CSS class).

export function CurrencyInput({ value, onChange, placeholder = '0.00', required, style, inputStyle, className }) {
  // Format a raw numeric string to always show two decimal places + commas.
  const format = (v) => {
    if (v === '' || v == null) return ''
    const n = parseFloat(String(v).replace(/,/g, ''))
    if (isNaN(n)) return v
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const [display, setDisplay] = useState(() => format(value))

  // Keep display in sync when value changes externally (e.g. modal reset).
  // Only reformat if the numeric value actually changed to avoid clobbering
  // in-progress typing.
  const prevValue = useRef(value)
  if (value !== prevValue.current) {
    prevValue.current = value
    const formatted = format(value)
    if (formatted !== display) setDisplay(formatted)
  }

  const handleChange = (e) => {
    const raw = e.target.value
    // Allow digits, a single decimal point, and commas while typing
    const cleaned = raw.replace(/[^0-9.,]/g, '')
    // Prevent more than one decimal point
    const parts = cleaned.replace(/,/g, '').split('.')
    const numeric = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned.replace(/,/g, '')
    setDisplay(cleaned)
    onChange(numeric)
  }

  const handleBlur = () => {
    // On blur, reformat to canonical "1,234.56" form
    setDisplay(format(value))
  }

  return (
    <div className="currency-input-wrap" style={style}>
      <span className="currency-symbol">$</span>
      <input
        type="text"
        inputMode="decimal"
        className={`currency-input${className ? ' ' + className : ''}`}
        value={display}
        placeholder={placeholder}
        required={required}
        style={inputStyle}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    </div>
  )
}

// ── SingleDatePicker ──────────────────────────────────────────────────────────
// Custom calendar popover styled identically to DateRangePicker.
// Shows one month at a time; ‹/› navigate months; clicking a day selects it.

const MONTHS_LONG  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December']
const DAYS_SHORT   = ['Su','Mo','Tu','We','Th','Fr','Sa']

function buildMonthWeeks(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = []
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ iso: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d })
  }
  const firstDow = new Date(year, month, 1).getDay()
  const padded = [...Array(firstDow).fill(null), ...days]
  while (padded.length % 7 !== 0) padded.push(null)
  const weeks = []
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7))
  return weeks
}

function SingleDatePicker({ value, onChange, onClose }) {
  const today = new Date()
  const initial = value ? (() => { const [y,m] = value.split('-').map(Number); return { year: y, month: m-1 } })()
                        : { year: today.getFullYear(), month: today.getMonth() }
  const [year,  setYear]  = useState(initial.year)
  const [month, setMonth] = useState(initial.month)

  const shiftMonth = (delta) => {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  const weeks = buildMonthWeeks(year, month)

  const todayIso = today.toISOString().slice(0, 10)

  return (
    <div className="drp-popover sdp-popover">
      {/* Header */}
      <div className="drp-header">
        <button type="button" className="drp-nav" onClick={() => shiftMonth(-1)}>‹</button>
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
          {MONTHS_LONG[month]} {year}
        </span>
        <button type="button" className="drp-nav" onClick={() => shiftMonth(1)}>›</button>
      </div>

      {/* Day-of-week header */}
      <div className="drp-dow-header sdp-dow-header">
        {DAYS_SHORT.map(d => <div key={d} className="drp-day-label">{d}</div>)}
      </div>

      {/* Calendar grid */}
      <div className="sdp-grid">
        {weeks.map((week, wi) =>
          week.map((cell, di) => {
            if (!cell) return <div key={`e-${wi}-${di}`} className="drp-day drp-day--empty" />
            const isSelected = cell.iso === value
            const isToday    = cell.iso === todayIso
            let cls = 'drp-day sdp-day'
            if (isSelected) cls += ' drp-day--selected'
            if (isToday && !isSelected) cls += ' sdp-day--today'
            return (
              <button
                key={cell.iso}
                type="button"
                className={cls}
                onClick={() => { onChange(cell.iso); onClose() }}
              >
                {cell.day}
              </button>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="drp-footer">
        <button type="button" className="btn-ghost" style={{ fontSize: '12px' }}
          onClick={() => { onChange(''); onClose() }}>
          Clear
        </button>
        <button type="button" className="btn-ghost" style={{ fontSize: '12px', marginLeft: 'auto' }}
          onClick={() => { onChange(todayIso); onClose() }}>
          Today
        </button>
      </div>
    </div>
  )
}

// ── DateInput ─────────────────────────────────────────────────────────────────
// Styled single-date trigger. Popover is rendered via createPortal at fixed
// position so it escapes overflow:hidden/auto scroll containers (e.g. modals).

export function DateInput({ value, onChange, required, placeholder = 'Select date' }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!triggerRef.current?.contains(e.target) && !popoverRef.current?.contains(e.target))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => {
    if (open) { setOpen(false); return }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      // Prefer opening below; if too close to bottom, open above
      const spaceBelow = window.innerHeight - rect.bottom
      const popoverH   = 320 // approximate height
      const top = spaceBelow > popoverH
        ? rect.bottom + 6
        : rect.top - popoverH - 6
      setPos({ top, left: rect.left })
    }
    setOpen(true)
  }

  const fmtDisplay = (iso) => {
    if (!iso) return null
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div ref={triggerRef} style={{ position: 'relative' }}>
      <div className="date-input-wrap" onClick={handleOpen}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>
          <rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className={value ? 'date-input-val' : 'date-input-placeholder'}>
          {fmtDisplay(value) || placeholder}
        </span>
        {required && (
          <input type="text" required value={value || ''} readOnly tabIndex={-1}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
        )}
      </div>
      {open && createPortal(
        <div ref={popoverRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
          <SingleDatePicker value={value} onChange={onChange} onClose={() => setOpen(false)} />
        </div>,
        document.body
      )}
    </div>
  )
}