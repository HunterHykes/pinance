import { useState, useRef, useEffect } from 'react'

const MONTHS = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                      'Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa']

function isoDate(y, m, d) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}

function parseIso(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function startOfDay(date) {
  const d = new Date(date); d.setHours(0,0,0,0); return d
}

function buildWeeks(startYear, startMonth, numMonths) {
  const days = []
  for (let mi = 0; mi < numMonths; mi++) {
    const d = new Date(startYear, startMonth + mi, 1)
    const y = d.getFullYear()
    const m = d.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    for (let day = 1; day <= daysInMonth; day++) {
      days.push({ iso: isoDate(y, m, day), day, month: m, year: y })
    }
  }
  const firstDow = new Date(days[0].year, days[0].month, 1).getDay()
  const padded = [...Array(firstDow).fill(null), ...days]
  while (padded.length % 7 !== 0) padded.push(null)
  const weeks = []
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7))
  return weeks
}

// ── DateRangePicker popover ───────────────────────────────────────────────────

export function DateRangePicker({ from, to, onChange, onClose }) {
  const today = new Date()
  const [startYear,  setStartYear]  = useState(() => new Date(today.getFullYear(), today.getMonth() - 2, 1).getFullYear())
  const [startMonth, setStartMonth] = useState(() => new Date(today.getFullYear(), today.getMonth() - 2, 1).getMonth())
  const VISIBLE_MONTHS = 6
  const [selecting, setSelecting] = useState(null)
  const [hoverDate, setHoverDate] = useState(null)
  const ref = useRef(null)

  const shiftMonths = (delta) => {
    const d = new Date(startYear, startMonth + delta, 1)
    setStartYear(d.getFullYear())
    setStartMonth(d.getMonth())
  }

  const handleDayClick = (iso) => {
    if (!selecting) {
      setSelecting(iso)
      setHoverDate(iso)
    } else {
      const a = selecting < iso ? selecting : iso
      const b = selecting < iso ? iso : selecting
      setSelecting(null)
      setHoverDate(null)
      onChange({ from: a, to: b })
      onClose()
    }
  }

  const handleMonthClick = (year, month) => {
    const from = isoDate(year, month, 1)
    const to   = isoDate(year, month, new Date(year, month + 1, 0).getDate())
    setSelecting(null)
    setHoverDate(null)
    onChange({ from, to })
    onClose()
  }

  const handleDayHover = (iso) => { if (selecting) setHoverDate(iso) }

  const displayFrom = selecting
    ? (hoverDate ? (selecting < hoverDate ? selecting : hoverDate) : selecting)
    : from
  const displayTo = selecting
    ? (hoverDate ? (selecting < hoverDate ? hoverDate : selecting) : null)
    : to

  const fmtShort = (iso) => {
    if (!iso) return '—'
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m-1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const weeks = buildWeeks(startYear, startMonth, VISIBLE_MONTHS)
  const shownMonths = new Set()

  return (
    <div className="drp-popover" ref={ref}>
      <div className="drp-header">
        <button type="button" className="drp-nav" onClick={() => shiftMonths(-3)}>‹</button>
        <div className="drp-range-display">
          <span className={displayFrom ? 'drp-range-val' : 'drp-range-placeholder'}>{fmtShort(displayFrom)}</span>
          <span className="drp-range-sep">–</span>
          <span className={displayTo ? 'drp-range-val' : 'drp-range-placeholder'}>{fmtShort(displayTo)}</span>
        </div>
        <button type="button" className="drp-nav" onClick={() => shiftMonths(3)}>›</button>
      </div>

      <div className="drp-dow-header">
        <div className="drp-month-label-col" />
        {DAYS.map(d => <div key={d} className="drp-day-label">{d}</div>)}
      </div>

      <div className="drp-calendars">
        {weeks.map((week, wi) => {
          let label = null
          let labelMonth = null, labelYear = null
          for (const cell of week) {
            if (!cell) continue
            const key = `${cell.year}-${cell.month}`
            if (!shownMonths.has(key)) {
              shownMonths.add(key)
              label = `${MONTHS[cell.month].slice(0,3)} ${String(cell.year).slice(2)}`
              labelMonth = cell.month
              labelYear  = cell.year
              break
            }
          }

          return (
            <div key={wi} className="drp-week" style={{ padding: '2px 0' }}>
              <div className="drp-month-label-col">
                {label && (
                  <button
                    type="button"
                    className="drp-month-label-btn"
                    onClick={() => handleMonthClick(labelYear, labelMonth)}
                    title={`Select all of ${MONTHS[labelMonth]}`}
                  >
                    {label}
                  </button>
                )}
              </div>
              {week.map((cell, di) => {
                if (!cell) return <div key={di} className="drp-day drp-day--empty" />
                const { iso, day } = cell
                const dayD     = startOfDay(parseIso(iso))
                const dispFrom = parseIso(displayFrom)
                const dispTo   = parseIso(displayTo)
                const isFrom   = displayFrom === iso
                const isTo     = displayTo   === iso
                const inRange  = dispFrom && dispTo &&
                  dayD > startOfDay(dispFrom) && dayD < startOfDay(dispTo)
                let cls = 'drp-day'
                if (isFrom || isTo) cls += ' drp-day--selected'
                else if (inRange)   cls += ' drp-day--in-range'
                if (day === 1)      cls += ' drp-day--month-start'
                return (
                  <button
                    key={iso}
                    type="button"
                    className={cls}
                    onClick={() => handleDayClick(iso)}
                    onMouseEnter={() => handleDayHover(iso)}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="drp-footer">
        {selecting && (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Click a second date to complete the range
          </span>
        )}
        <button type="button" className="btn-ghost" style={{ fontSize: '12px', marginLeft: 'auto' }}
          onClick={() => { onChange({ from: null, to: null }); setSelecting(null); onClose() }}>
          Clear
        </button>
      </div>
    </div>
  )
}

// ── DateRangeTrigger ──────────────────────────────────────────────────────────
// Rendered below the page title. Clicking opens the full range picker popover.

export function DateRangeTrigger({ from, to, onChange, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fmtShort = (iso) => {
    if (!iso) return ''
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m-1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className={`drp-trigger-wrap ${className}`} ref={ref}>
      <div className="page-date-range" onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>
          <rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className="page-date-input">{fmtShort(from) || 'Start'}</span>
        <span style={{ color: 'var(--text-tertiary)' }}>–</span>
        <span className="page-date-input">{fmtShort(to) || 'End'}</span>
      </div>
      {open && (
        <DateRangePicker
          from={from} to={to}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

// ── PageDateRangeTrigger ──────────────────────────────────────────────────────
// Matches the MonthPicker visual style for the Transactions page header:
//   ‹  Jun 1 – Jun 30, 2026  ›
// ‹ / › step backward/forward by one month.
// Clicking the label opens the full DateRangePicker popover.
//
// Props:
//   from, to  — ISO date strings ("YYYY-MM-DD")
//   onChange  — called with { from, to }

export function PageDateRangeTrigger({ from, to, onChange, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Step the entire range by one month
  const stepMonth = (delta) => {
    if (!from) return
    const d = new Date(from + 'T00:00:00')
    d.setMonth(d.getMonth() + delta)
    const y = d.getFullYear()
    const m = d.getMonth()
    const newFrom = `${y}-${String(m + 1).padStart(2,'0')}-01`
    const lastDay = new Date(y, m + 1, 0).getDate()
    const newTo   = `${y}-${String(m + 1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
    onChange({ from: newFrom, to: newTo })
  }

  // Format the displayed label
  const fmtLabel = () => {
    if (!from && !to) return 'All time'
    const fmt = (iso) => {
      if (!iso) return '…'
      const [y, m, d] = iso.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      // If same year as the other end (or only date), omit year on the first
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    if (!to) return fmt(from)
    // If range is a full calendar month, show "Month YYYY"
    const [fy, fm] = from.split('-').map(Number)
    const [ty, tm] = to.split('-').map(Number)
    if (fy === ty && fm === tm) {
      const lastDay = new Date(fy, fm, 0).getDate()
      if (from === `${fy}-${String(fm).padStart(2,'0')}-01` &&
          to   === `${fy}-${String(fm).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`) {
        return new Date(fy, fm - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      }
    }
    // Otherwise show short range
    const [y1, m1, d1] = from.split('-').map(Number)
    const [y2, m2, d2] = to.split('-').map(Number)
    const sameYear = y1 === y2
    const left  = new Date(y1, m1-1, d1).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
    const right = new Date(y2, m2-1, d2).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${left} – ${right}`
  }

  const navBtnStyle = {
    fontFamily:  'inherit',
    fontSize:    '18px',
    fontWeight:  300,
    lineHeight:  1,
    color:       'var(--text-secondary)',
    background:  'none',
    border:      'none',
    outline:     'none',
    cursor:      'pointer',
    padding:     '0 3px',
    transition:  'color 0.12s',
    userSelect:  'none',
  }

  return (
    <div className={`drp-trigger-wrap ${className}`} ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>

      {/* ‹ previous month */}
      <button type="button" style={navBtnStyle} onClick={() => stepMonth(-1)}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        aria-label="Previous month">
        ‹
      </button>

      {/* Label — click to open popover */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          fontFamily:  'inherit',
          fontSize:    '22px',
          fontWeight:  700,
          color:       'var(--text)',
          background:  'transparent',
          border:      'none',
          cursor:      'pointer',
          padding:     '0',
          whiteSpace:  'nowrap',
          transition:  'opacity 0.15s',
          lineHeight:  1.1,
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '0.7' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        aria-label="Pick date range"
      >
        {fmtLabel()}
      </button>

      {/* › next month */}
      <button type="button" style={navBtnStyle} onClick={() => stepMonth(1)}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        aria-label="Next month">
        ›
      </button>

      {open && (
        <DateRangePicker
          from={from} to={to}
          onChange={(val) => { onChange(val); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

// ── MonthPicker ───────────────────────────────────────────────────────────────
// Compact  ‹ Month YYYY ›  control for single-month pages.
//
// The ‹ and › buttons step by one month without opening anything.
// Clicking the month label opens a year + month grid popover for
// jumping to any month directly.
//
// Props:
//   value    — "YYYY-MM" string
//   onChange — called with new "YYYY-MM" string

export function MonthPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // selMonth is 1-based (from the YYYY-MM string)
  const [selYear, selMonth] = value.split('-').map(Number)

  // viewYear drives the popover's year header independently
  const [viewYear, setViewYear] = useState(selYear)
  useEffect(() => { setViewYear(selYear) }, [selYear])

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Arrow buttons: step one calendar month, no popover
  const stepMonth = (delta) => {
    const d = new Date(selYear, selMonth - 1 + delta, 1)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    onChange(`${d.getFullYear()}-${mm}`)
  }

  // Grid selection (monthIndex is 0-based)
  const handleSelect = (monthIndex) => {
    const mm = String(monthIndex + 1).padStart(2, '0')
    onChange(`${viewYear}-${mm}`)
    setOpen(false)
  }

  const displayLabel = `${MONTHS[selMonth - 1]} ${selYear}`

  const navBtnStyle = {
    fontFamily:  'inherit',
    fontSize:    '18px',
    fontWeight:  300,
    lineHeight:  1,
    color:       'var(--text-secondary)',
    background:  'none',
    border:      'none',
    outline:     'none',
    cursor:      'pointer',
    padding:     '0 3px',
    transition:  'color 0.12s',
    userSelect:  'none',
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>

      {/* ‹ previous month */}
      <button
        type="button"
        onClick={() => stepMonth(-1)}
        style={navBtnStyle}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        aria-label="Previous month"
      >
        ‹
      </button>

      {/* Month/year label — click to open grid */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          fontFamily:  'inherit',
          fontSize:    '22px',
          fontWeight:  700,
          color:       'var(--text)',
          background:  'transparent',
          border:      'none',
          cursor:      'pointer',
          padding:     '0',
          whiteSpace:  'nowrap',
          transition:  'opacity 0.15s',
          lineHeight:  1.1,
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '0.7' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        aria-label="Select month"
      >
        {displayLabel}
      </button>

      {/* › next month */}
      <button
        type="button"
        onClick={() => stepMonth(1)}
        style={navBtnStyle}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        aria-label="Next month"
      >
        ›
      </button>

      {/* Month grid popover */}
      {open && (
        <div
          className="drp-popover"
          style={{ width: '260px', padding: '14px', top: 'calc(100% + 6px)', left: '0' }}
        >
          {/* Year navigation */}
          <div className="drp-header" style={{ marginBottom: '12px' }}>
            <button type="button" className="drp-nav" onClick={() => setViewYear(y => y - 1)}>‹</button>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
              {viewYear}
            </span>
            <button type="button" className="drp-nav" onClick={() => setViewYear(y => y + 1)}>›</button>
          </div>

          {/* 4-column month grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
            {MONTHS_SHORT.map((label, i) => {
              const isSelected = viewYear === selYear && (i + 1) === selMonth
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelect(i)}
                  style={{
                    fontFamily:   'inherit',
                    fontSize:     '12px',
                    fontWeight:   isSelected ? 600 : 400,
                    padding:      '7px 4px',
                    borderRadius: 'var(--radius-sm)',
                    border:       'none',
                    background:   isSelected ? 'var(--accent)' : 'transparent',
                    color:        isSelected ? '#fff' : 'var(--text-secondary)',
                    cursor:       'pointer',
                    transition:   'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.background = 'var(--bg-secondary)'; e.currentTarget.style.color = 'var(--text)' } }}
                  onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {/* Footer: jump to current month */}
          <div className="drp-footer" style={{ marginTop: '12px', paddingTop: '10px' }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: '12px', marginLeft: 'auto' }}
              onClick={() => {
                onChange(new Date().toISOString().slice(0, 7))
                setOpen(false)
              }}
            >
              This month
            </button>
          </div>
        </div>
      )}
    </div>
  )
}