// FrequencyPicker.jsx — popup schedule builder, portal-positioned like DateInput
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { scheduleLabel } from '../scheduleUtils'

// ── Constants ─────────────────────────────────────────────────────────────────

const SCHEDULE_TYPES = [
  { value: 'weekly',      label: 'Weekly'      },
  { value: 'biweekly',    label: 'Every 2 Weeks'},
  { value: 'nth_weekday', label: 'Nth Weekday'  },
  { value: 'monthly',     label: 'Monthly'      },
  { value: 'quarterly',   label: 'Quarterly'    },
  { value: 'semi_annual', label: 'Semi-Annual'  },
  { value: 'annual',      label: 'Annual'       },
]

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES    = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December']
const DAY_NUMBERS    = [...Array.from({ length: 28 }, (_, i) => i + 1), 0]

function buildMonthWeeks(year, month) {
  const count    = new Date(year, month + 1, 0).getDate()
  const days     = Array.from({ length: count }, (_, i) => i + 1)
  const firstDow = new Date(year, month, 1).getDay()
  const padded   = [...Array(firstDow).fill(null), ...days]
  while (padded.length % 7 !== 0) padded.push(null)
  const weeks = []
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7))
  return weeks
}

// ── Default schedule builders ─────────────────────────────────────────────────

export function defaultSchedule(type) {
  switch (type) {
    case 'monthly':
    case 'twice_monthly':
    case 'custom_days':   return { type: 'monthly', days: [1] }
    case 'quarterly':     return { type: 'quarterly',   day: 1 }
    case 'semi_annual':   return { type: 'semi_annual',  day: 1 }
    case 'annual':        return { type: 'annual', month: 1, day: 1 }
    case 'nth_weekday':   return { type: 'nth_weekday', weekday: 0, weeks: [1] }
    case 'weekly':        return { type: 'weekly',   weekday: 1 }
    case 'biweekly':      return { type: 'biweekly', weekday: 1 }
    default:              return { type: 'monthly', days: [1] }
  }
}

// ── Module-level render helpers — must NOT be inside a component ─────────────
// Defined here so their identity is stable across renders; avoids React
// unmounting/remounting grids when parent state changes.

function renderDayGrid(selected, onToggle, multi) {
  return (
    <div className="sdp-grid" style={{ marginTop: 6 }}>
      {DAY_NUMBERS.map(d => {
        const sel = multi ? (selected || []).includes(d) : selected === d
        return (
          <button
            key={d}
            type="button"
            className={`drp-day sdp-day${sel ? ' drp-day--selected' : ''}`}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle(d) }}
            style={{ fontSize: '11px' }}
          >
            {d === 0 ? 'L' : d}
          </button>
        )
      })}
    </div>
  )
}

function renderWeekdayRow(selected, onSelect) {
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
      {WEEKDAY_LABELS.map((w, i) => (
        <button
          key={i}
          type="button"
          className={`drp-day sdp-day${selected === i ? ' drp-day--selected' : ''}`}
          onClick={e => { e.preventDefault(); e.stopPropagation(); onSelect(i) }}
          style={{ fontSize: '11px', flex: 1 }}
        >
          {w}
        </button>
      ))}
    </div>
  )
}

// ── Popup content ─────────────────────────────────────────────────────────────

function PickerPopup({ schedule, onChange, onClose }) {
  // Normalise incoming schedule: monthly/twice_monthly/custom_days → { type:'monthly', days:[...] }
  const normalise = (s) => {
    if (!s) return defaultSchedule('monthly')
    if (s.type === 'twice_monthly') return { type: 'monthly', days: s.days || [1, 15] }
    if (s.type === 'custom_days')   return { type: 'monthly', days: s.days || [1] }
    if (s.type === 'monthly' && s.day != null && !s.days) return { type: 'monthly', days: [s.day] }
    return s
  }
  const [local, setLocal] = useState(() => normalise(schedule))
  const patch   = (fields) => setLocal(prev => ({ ...prev, ...fields }))
  const setType = (type)   => setLocal(defaultSchedule(type))

  const [calYear,  setCalYear]  = useState(() => new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(() => (local.month ?? 1) - 1)

  const shiftCal = (delta) => {
    const d = new Date(calYear, calMonth + delta, 1)
    setCalYear(d.getFullYear()); setCalMonth(d.getMonth())
  }

  const { type } = local

  // ── Derived "done" disabled state ─────────────────────────────────────────
  // twice_monthly needs exactly 2 days; custom_days needs at least 1
  const doneDisabled =
    (type === 'monthly'     && (local.days  || []).length < 1) ||
    (type === 'nth_weekday' && (local.weeks || []).length < 1)

  // ── Sub-fields ─────────────────────────────────────────────────────────────
  let subLabel   = null
  let subContent = null

  if (type === 'monthly') {
    const days = local.days || [1]
    const count = days.length
    subLabel = count <= 1 ? 'Day of Month — L = Last'
             : count === 2 ? 'Two Days — L = Last'
             : 'Days of Month — L = Last'
    subContent = renderDayGrid(
      days,
      d => {
        const next = days.includes(d)
          ? days.filter(x => x !== d)
          : [...days, d].sort((a, b) => (a === 0 ? 29 : a) - (b === 0 ? 29 : b))
        patch({ days: next })
      },
      true
    )
  }
  else if (type === 'weekly' || type === 'biweekly') {
    subLabel   = 'Day of Week'
    subContent = renderWeekdayRow(
      local.weekday ?? 1,
      weekday => patch({ weekday })
    )
  }
  else if (type === 'quarterly' || type === 'semi_annual') {
    subLabel   = 'Day of Month — L = Last'
    subContent = renderDayGrid(
      local.day ?? 1,
      day => patch({ day }),
      false
    )
  }
  else if (type === 'nth_weekday') {
    const weeks   = local.weeks   || [1]
    const weekday = local.weekday ?? 0
    const NTH_OPTS = [
      { value: 1, label: '1st' }, { value: 2, label: '2nd' },
      { value: 3, label: '3rd' }, { value: 4, label: '4th' },
      { value: 5, label: 'Last' },
    ]
    const toggleWeek = (n) => {
      const next = weeks.includes(n) ? weeks.filter(x => x !== n) : [...weeks, n].sort((a, b) => a - b)
      patch({ weeks: next })
    }
    subLabel = 'Which & Day of Week'
    subContent = (
      <>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {NTH_OPTS.map(o => (
            <button key={o.value} type="button"
              className={`drp-day sdp-day${weeks.includes(o.value) ? ' drp-day--selected' : ''}`}
              onClick={e => { e.preventDefault(); e.stopPropagation(); toggleWeek(o.value) }}
              style={{ fontSize: '10px', flex: 1 }}>
              {o.label}
            </button>
          ))}
        </div>
        {renderWeekdayRow(weekday, wd => patch({ weekday: wd }))}
      </>
    )
  }
  else if (type === 'annual') {
    const weeks       = buildMonthWeeks(calYear, calMonth)
    const selectedDay = local.day ?? 1
    const selectedMon = (local.month ?? 1) - 1
    subLabel   = 'Month & Day'
    subContent = (
      <>
        <div className="drp-header" style={{ marginBottom: 0 }}>
          <button type="button" className="drp-nav"
            onClick={e => { e.preventDefault(); shiftCal(-1) }}>‹</button>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            {MONTH_NAMES[calMonth]} {calYear}
          </span>
          <button type="button" className="drp-nav"
            onClick={e => { e.preventDefault(); shiftCal(1) }}>›</button>
        </div>
        <div className="drp-dow-header sdp-dow-header" style={{ marginTop: 6 }}>
          {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
            <div key={d} className="drp-day-label">{d}</div>
          ))}
        </div>
        <div className="sdp-grid">
          {weeks.map((week, wi) =>
            week.map((day, di) => {
              if (!day) return <div key={`e-${wi}-${di}`} className="drp-day drp-day--empty" />
              const isSel = calMonth === selectedMon && day === selectedDay
              return (
                <button
                  key={`${wi}-${di}`}
                  type="button"
                  className={`drp-day sdp-day${isSel ? ' drp-day--selected' : ''}`}
                  style={{ fontSize: '11px' }}
                  onClick={e => {
                    e.preventDefault(); e.stopPropagation()
                    patch({ month: calMonth + 1, day })
                  }}
                >
                  {day}
                </button>
              )
            })
          )}
        </div>
      </>
    )
  }

  // ── Handle Done — derive stored type from number of days selected ────────
  const handleDone = () => {
    if (type === 'monthly') {
      const days = local.days || []
      if (days.length === 1)      onChange({ type: 'monthly',       day: days[0] })
      else if (days.length === 2) onChange({ type: 'twice_monthly', days })
      else                        onChange({ type: 'custom_days',   days })
    } else {
      onChange(local)
    }
    onClose()
  }

  return (
    <div className="drp-popover sdp-popover"
      style={{ width: 264, padding: 14, paddingRight: 14 }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Type — dropdown */}
      <select
        value={local.type}
        onChange={e => setType(e.target.value)}
        style={{ width: '100%', fontSize: '13px', marginBottom: subContent ? 8 : 0 }}
      >
        {SCHEDULE_TYPES.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      {/* Sub-fields */}
      {subContent && (
        <>
          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>
            {subLabel}
          </div>
          {subContent}
        </>
      )}

      {/* Done */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          type="button"
          className="btn-primary"
          style={{ fontSize: '11px', padding: '4px 14px', opacity: doneDisabled ? 0.4 : 1, cursor: doneDisabled ? 'default' : 'pointer' }}
          disabled={doneDisabled}
          onClick={handleDone}
        >
          Done
        </button>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function FrequencyPicker({ value, onChange, mode = 'bills' }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  const current = value || defaultSchedule('monthly')

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
      const popoverH   = 360
      const spaceBelow = window.innerHeight - rect.bottom
      const top  = spaceBelow > popoverH ? rect.bottom + 6 : rect.top - popoverH - 6
      setPos({ top, left: rect.left })
    }
    setOpen(true)
  }

  return (
    <div ref={triggerRef} style={{ position: 'relative' }}>
      <div className="date-input-wrap" onClick={handleOpen}
        style={{ cursor: 'pointer', userSelect: 'none' }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
          style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M8 5v3.5l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className="date-input-val" style={{ fontSize: '13px' }}>
          {scheduleLabel(current)}
        </span>
      </div>

      {open && createPortal(
        <div ref={popoverRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
          <PickerPopup
            schedule={current}
            onChange={s => onChange(s)}
            onClose={() => setOpen(false)}
          />
        </div>,
        document.body
      )}
    </div>
  )
}