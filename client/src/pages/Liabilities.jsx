import React, { useState, useMemo, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import {
  getLiabilities, createLiability, updateLiability, deleteLiability,
  getLiabilitySchedule, getBudget,
} from '../api'
import { formatCurrency, formatDate } from '../utils'
import RowMoreMenu from '../components/RowMoreMenu'
import LiabilityModal from '../components/LiabilityModal'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useAssets } from '../hooks/useAssets'

// ── Constants ─────────────────────────────────────────────────────────────────

const LIABILITY_TYPES = ['Mortgage', 'Auto Loan', 'Student Loan', 'Personal Loan', 'Line of Credit', 'Other']

const LIABILITY_COLORS = {
  'Mortgage':       '#ef4444',
  'Auto Loan':      '#f97316',
  'Student Loan':   '#ec4899',
  'Personal Loan':  '#8b5cf6',
  'Line of Credit': '#06b6d4',
  'Other':          '#888888',
}

function typeColor(type) { return LIABILITY_COLORS[type] || '#888888' }

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useLiabilities() {
  return useQuery({ queryKey: ['liabilities'], queryFn: () => getLiabilities().then(r => r.data) })
}

function useLiabilitySchedule(id) {
  return useQuery({
    queryKey: ['liability-schedule', id],
    queryFn:  () => getLiabilitySchedule(id).then(r => r.data),
    enabled:  !!id,
    retry:    false,
  })
}

function useBudgetCategories() {
  const month = new Date().toISOString().slice(0, 7)
  return useQuery({
    queryKey: ['budget', month],
    queryFn:  () => getBudget({ month }).then(r => r.data),
  })
}

function useCreateLiability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => createLiability(data).then(r => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['liabilities'] }),
  })
}

function useUpdateLiability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => updateLiability(id, data).then(r => r.data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['liabilities'] })
      qc.invalidateQueries({ queryKey: ['liability-schedule'] })
    },
  })
}

function useDeleteLiability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => deleteLiability(id).then(r => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['liabilities'] }),
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(decimal) {
  if (decimal == null) return '—'
  return (decimal * 100).toFixed(3) + '%'
}

function currentBal(liab) {
  return liab.current_balance ?? liab.balance
}

function fmtTerm(months) {
  if (!months) return '—'
  const years = months / 12
  return Number.isInteger(years) ? `${years} yr` : `${months} mo`
}

function fmtMonthYear(dateStr) {
  if (!dateStr) return '—'
  const [y, m] = dateStr.slice(0, 7).split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// ── Dot button ────────────────────────────────────────────────────────────────

function DotBtn({ color, expandable, expanded, onClick }) {
  return (
    <button
      className={'budget-dot-btn' + (expandable ? ' budget-dot-btn--expandable' : '')}
      style={{ background: color, flexShrink: 0 }}
      onClick={expandable ? onClick : undefined}
    >
      {expandable && (
        <svg className={'dot-chevron' + (expanded ? ' dot-chevron--open' : '')}
          width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1.5 3L4 5.5L6.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ paid, total, remaining, overpaid = 0, color = 'var(--green)', height = 8 }) {
  const paidPct     = total > 0 ? Math.min(100, (paid     / total) * 100) : 0
  const overpaidPct = total > 0 ? Math.min(100 - paidPct, (overpaid / total) * 100) : 0
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '12px', fontWeight: 500 }}>
        <span style={{ color: 'var(--green)' }}>{formatCurrency(paid)}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{formatCurrency(total)}</span>
      </div>
      <div style={{ height, background: 'var(--border)', borderRadius: height / 2, overflow: 'hidden', display: 'flex' }}>
        <div style={{ height: '100%', width: `${paidPct}%`, background: color, borderRadius: `${height/2}px 0 0 ${height/2}px`, transition: 'width .4s ease', flexShrink: 0 }} />
        {overpaidPct > 0 && (
          <div style={{ height: '100%', width: `${overpaidPct}%`, background: 'var(--accent)', transition: 'width .4s ease', flexShrink: 0 }} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
        <span>
          {paid > 0 ? `${((paid / total) * 100).toFixed(1)}% paid` : 'No payments yet'}
          {overpaid > 0 && <span style={{ color: 'var(--accent)', marginLeft: '6px' }}>+{formatCurrency(overpaid)} extra principal</span>}
        </span>
        <span>{formatCurrency(remaining)} remaining</span>
      </div>
    </div>
  )
}

// ── Summary metric card ───────────────────────────────────────────────────────

function MetricCard({ label, value, sub, valueColor }) {
  return (
    <div className="card metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={valueColor ? { color: valueColor } : {}}>{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  )
}

// ── Schedule table ────────────────────────────────────────────────────────────
// Default view: past 12 months of actual/missed rows only.
// Expand to show all past rows, then optionally future rows too.

function ScheduleTable({ schedule, currentBalance, originalPrincipal }) {
  const DEFAULT_PAST_WINDOW = 12

  const past   = schedule.filter(p => !p.is_future)
  const future = schedule.filter(p => p.is_future)

  const [showAllPast,   setShowAllPast]   = useState(false)
  const [showFuture,    setShowFuture]    = useState(false)

  const visiblePast   = showAllPast ? past : past.slice(-DEFAULT_PAST_WINDOW)
  const hiddenPast    = past.length - visiblePast.length

  // Future: show first 12 by default when expanded
  const FUTURE_WINDOW  = 12
  const visibleFuture  = showFuture
    ? (future.length > FUTURE_WINDOW ? future.slice(0, FUTURE_WINDOW) : future)
    : []
  const hiddenFuture   = future.length - FUTURE_WINDOW

  const rows = [...visiblePast, ...visibleFuture]

  // Footer totals — actual rows only
  const actualRows    = past.filter(p => p.is_actual)
  const totalActualAmt  = actualRows.reduce((s, p) => s + p.amount, 0)
  const totalPrincipal  = actualRows.reduce((s, p) => s + p.principal, 0)
  const totalExtra      = actualRows.reduce((s, p) => s + (p.extra_principal || 0), 0)
  const totalInterest   = actualRows.reduce((s, p) => s + p.interest, 0)

  if (rows.length === 0 && past.length === 0) return (
    <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
      <p className="muted" style={{ fontSize: '13px' }}>No payment data available.</p>
    </div>
  )

  return (
    <div className="card" style={{ padding: 0, '--dt-cols': '90px minmax(0,1fr) 90px 90px 90px 90px 110px' }}>
      <div className="acct-tbl-header">
        <span className="col-header-label">Date</span>
        <span className="col-header-label">Description</span>
        <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Payment</span>
        <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Principal</span>
        <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Extra</span>
        <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Interest</span>
        <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Balance</span>
      </div>

      {/* Show more past rows */}
      {hiddenPast > 0 && (
        <div style={{ padding: '8px 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
          <button className="btn-ghost" style={{ fontSize: '12px' }} onClick={() => setShowAllPast(true)}>
            ▲ Show {hiddenPast} earlier payment{hiddenPast !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Payment rows */}
      {rows.map((row, i) => {
        const isActual  = row.is_actual
        const isFuture  = row.is_future
        const isMissed  = row.is_missed
        return (
          <div key={i} className="acct-tbl-row" style={{ opacity: isFuture ? 0.5 : 1, background: isMissed ? 'rgba(239,68,68,0.04)' : undefined }}>
            <div style={{ fontSize: '12px', color: isFuture ? 'var(--text-tertiary)' : 'var(--text-secondary)' }}>{fmtMonthYear(row.date)}</div>
            <div style={{ minWidth: 0 }}>
              {isFuture ? (
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Projected</span>
              ) : isMissed ? (
                <span style={{ fontSize: '12px', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertCircle size={11} /> No transaction matched
                </span>
              ) : (
                <span style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                  {row.description || '—'}
                </span>
              )}
            </div>
            <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: isActual ? 500 : 400, color: isFuture ? 'var(--text-tertiary)' : 'var(--text)' }}>{formatCurrency(row.amount)}</div>
            <div style={{ textAlign: 'right', fontSize: '13px', color: 'var(--green)', fontWeight: isActual ? 500 : 400 }}>{formatCurrency(row.principal)}</div>
            <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: isActual ? 500 : 400, color: row.extra_principal > 0.005 ? 'var(--accent)' : 'var(--text-tertiary)' }}>
              {row.extra_principal > 0.005 ? `+${formatCurrency(row.extra_principal)}` : '—'}
            </div>
            <div style={{ textAlign: 'right', fontSize: '13px', color: 'var(--red)', fontWeight: isActual ? 500 : 400 }}>{formatCurrency(row.interest)}</div>
            <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: isFuture ? 'var(--text-tertiary)' : 'var(--text)' }}>{formatCurrency(row.balance)}</div>
          </div>
        )
      })}

      {/* Show / hide future projected rows */}
      {future.length > 0 && (
        <div style={{ padding: '10px 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
          {!showFuture ? (
            <button className="btn-ghost" style={{ fontSize: '12px' }} onClick={() => setShowFuture(true)}>
              ▼ Show {future.length} projected payment{future.length !== 1 ? 's' : ''}
            </button>
          ) : (
            <>
              {hiddenFuture > 0 && (
                <button className="btn-ghost" style={{ fontSize: '12px', marginRight: '12px' }}
                  onClick={() => {
                    // show all future — replace visibleFuture logic by toggling a separate state
                    setShowFuture('all')
                  }}>
                  ▼ Show {hiddenFuture} more
                </button>
              )}
              <button className="btn-ghost" style={{ fontSize: '12px' }} onClick={() => setShowFuture(false)}>
                ▲ Hide projected
              </button>
            </>
          )}
        </div>
      )}

      {/* Footer: totals + current balance */}
      <div className="tbl-footer-row">
        <span className="footer-label">Total paid</span>
        <div />
        <span className="footer-value" style={{ textAlign: 'right' }}>
          {formatCurrency(totalActualAmt)}
        </span>
        <span className="footer-value footer-value--up" style={{ textAlign: 'right' }}>
          {formatCurrency(totalPrincipal)}
        </span>
        <span className="footer-value" style={{ textAlign: 'right', color: totalExtra > 0.005 ? 'var(--accent)' : 'var(--text-tertiary)' }}>
          {totalExtra > 0.005 ? `+${formatCurrency(totalExtra)}` : '—'}
        </span>
        <span className="footer-value footer-value--down" style={{ textAlign: 'right' }}>
          {formatCurrency(totalInterest)}
        </span>
        {/* Current balance — the authoritative figure written back to the DB */}
        <span className="footer-value" style={{ textAlign: 'right', color: 'var(--red)' }}>
          {currentBalance != null ? formatCurrency(currentBalance) : '—'}
        </span>
      </div>
    </div>
  )
}

// ── Chart constants ───────────────────────────────────────────────────────────

const CHART_SERIES = [
  { key: 'actual_principal',    color: '#3b82f6', dash: 'solid',  axis: 'mo'  },
  { key: 'actual_interest',     color: '#ef4444', dash: 'solid',  axis: 'mo'  },
  { key: 'actual_balance',      color: '#f59e0b', dash: 'solid',  axis: 'bal' },
  { key: 'proj_principal',      color: '#3b82f6', dash: 'dashed', axis: 'mo'  },
  { key: 'proj_interest',       color: '#ef4444', dash: 'dashed', axis: 'mo'  },
  { key: 'proj_balance',        color: '#f59e0b', dash: 'dashed', axis: 'bal' },
  { key: 'sched_principal',     color: '#3b82f6', dash: 'dotted', axis: 'mo'  },
  { key: 'sched_interest',      color: '#ef4444', dash: 'dotted', axis: 'mo'  },
  { key: 'sched_balance',       color: '#888888', dash: 'dotted', axis: 'bal' },
  { key: 'interest_saved',      color: '#22c55e', dash: 'solid',  axis: 'sav' },
]

const CROSSOVER_KEYS = { sched: 'crossover_sched', current: 'crossover_current', projPayoff: 'proj_payoff' }

const LEGEND_GRID = [
  ['Principal', 'Actual',    'actual_principal'],
  ['Interest',  'Actual',    'actual_interest' ],
  ['Balance',   'Actual',    'actual_balance'  ],
  ['Principal', 'Projected', 'proj_principal'  ],
  ['Interest',  'Projected', 'proj_interest'   ],
  ['Balance',   'Projected', 'proj_balance'    ],
  ['Principal', 'Scheduled', 'sched_principal' ],
  ['Interest',  'Scheduled', 'sched_interest'  ],
  ['Balance',   'Scheduled', 'sched_balance'   ],
]

const X_RANGES = [
  { label: 'YTD',   months: 'ytd' },
  { label: '1Y',    months: 12    },
  { label: '5Y',    months: 60    },
  { label: '10Y',   months: 120   },
  { label: '15Y',   months: 180   },
  { label: '20Y',   months: 240   },
  { label: '25Y',   months: 300   },
  { label: '30Y',   months: 360   },
  { label: 'Total', months: null  },
]

function strokeDashArray(dash) {
  if (dash === 'dashed') return '6 3'
  if (dash === 'dotted') return '2 3'
  return undefined
}

// ── Principal vs Interest chart ───────────────────────────────────────────────

function PrincipalInterestChart({ schedule, liability }) {
  const [hidden, setHidden] = React.useState(new Set())
  const [xRange, setXRange] = React.useState('Total')

  const toggleSeries = (key) => setHidden(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const theoreticalByMonth = React.useMemo(() => {
    const { original_principal: P, interest_rate: annualRate, loan_term_months: n, origination_date, monthly_payment: storedPayment } = liability
    if (!P || !annualRate || !n || !origination_date) return {}
    const r   = annualRate / 12
    const pmt = storedPayment || (r > 0 ? P * r * Math.pow(1+r, n) / (Math.pow(1+r, n) - 1) : P / n)
    const map = {}
    let bal = P
    for (let i = 0; i < n && bal > 0.005; i++) {
      const d = new Date(origination_date + 'T00:00:00')
      d.setMonth(d.getMonth() + i + 1)
      const ym     = d.toISOString().slice(0, 7)
      const intAmt = bal * r
      const prin   = Math.max(0, Math.min(pmt - intAmt, bal))
      bal = Math.max(0, bal - prin)
      map[ym] = { principal: parseFloat(prin.toFixed(2)), interest: parseFloat(intAmt.toFixed(2)), balance: parseFloat(bal.toFixed(2)) }
    }
    return map
  }, [liability])

  const fullData = React.useMemo(() => {
    const { interest_rate: annualRate, monthly_payment: storedPayment, original_principal: P, loan_term_months: n, origination_date } = liability
    if (!P || !n || !origination_date) return []
    const r   = (annualRate || 0) / 12
    const pmt = storedPayment || (r > 0 ? P * r * Math.pow(1+r, n) / (Math.pow(1+r, n) - 1) : P / n)

    // Index actual schedule rows by month
    const actualByMonth = {}
    for (const row of schedule) {
      if (row.is_actual) actualByMonth[row.month] = row
    }

    // Seed projected balance from last actual payment
    const lastActual = [...schedule].filter(r => r.is_actual).pop()
    let projBal = lastActual ? lastActual.balance : null

    let theoreticalIntCum = 0, actualIntCum = 0

    // Walk theoreticalByMonth — always covers the full n-month term,
    // so the chart extends to payoff regardless of where actual data ends
    const months = Object.keys(theoreticalByMonth).sort()
    return months.map(ym => {
      const th        = theoreticalByMonth[ym]
      const schedPrin = th.principal
      const schedInt  = th.interest
      const schedBal  = th.balance
      theoreticalIntCum += schedInt

      const actual = actualByMonth[ym]
      let actPrin = null, actInt = null, actBal = null
      if (actual) {
        actPrin = parseFloat(actual.principal.toFixed(2))
        actInt  = parseFloat(actual.interest.toFixed(2))
        actBal  = parseFloat(actual.balance.toFixed(2))
        actualIntCum += actual.interest
        projBal = actual.balance
      }

      let projPrin = null, projInt = null, projBalOut = null
      if (!actual && projBal !== null && projBal > 0.005) {
        const intAmt = projBal * r
        const prin   = Math.max(0, Math.min(pmt - intAmt, projBal))
        projBal      = Math.max(0, projBal - prin)
        projPrin     = parseFloat(prin.toFixed(2))
        projInt      = parseFloat(intAmt.toFixed(2))
        projBalOut   = parseFloat(projBal.toFixed(2))
      }

      const saved = actual
        ? parseFloat(Math.max(0, theoreticalIntCum - actualIntCum).toFixed(2))
        : null

      return {
        label:            ym,
        actual_principal: actPrin,
        actual_interest:  actInt,
        actual_balance:   actBal,
        proj_principal:   projPrin,
        proj_interest:    projInt,
        proj_balance:     projBalOut,
        sched_principal:  schedPrin,
        sched_interest:   schedInt,
        sched_balance:    schedBal,
        interest_saved:   saved,
      }
    })
  }, [schedule, theoreticalByMonth, liability])

  const schedCrossover   = React.useMemo(() => fullData.find(d => d.sched_principal > d.sched_interest), [fullData])
  const currentCrossover = React.useMemo(() => fullData.find(d => d.proj_principal !== null && d.proj_principal > d.proj_interest), [fullData])
  const projPayoff   = React.useMemo(() => [...fullData].reverse().find(d => d.proj_balance !== null && d.proj_balance <= 0.5) || null, [fullData])
  const schedPayoff  = React.useMemo(() => [...fullData].reverse().find(d => d.sched_balance !== null && d.sched_balance <= 0.5) || null, [fullData])

  const data = React.useMemo(() => {
    const range = X_RANGES.find(r => r.label === xRange)
    if (range?.months === 'ytd') {
      const currentYM = new Date().toISOString().slice(0, 7)
      const ytdStart  = `${parseInt(currentYM.slice(0, 4))}-01`
      return fullData.filter(d => d.label >= ytdStart && d.label <= currentYM)
    }
    if (!range || range.months === null) {
      return fullData
    }
    return fullData.slice(0, range.months)
  }, [fullData, xRange])

  const inView = (label) => data.some(d => d.label === label)
  const fmtK   = (v) => v == null ? '' : `$${(v / 1000).toFixed(1)}k`
  const tickInterval = Math.max(1, Math.floor(data.length / 8))

  const moAxisMax = React.useMemo(() => {
    const { interest_rate: annualRate, monthly_payment: storedPayment, original_principal: P, loan_term_months: n } = liability
    const r = (annualRate || 0) / 12
    const pmt = storedPayment || (r > 0 ? P * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1) : P/n)
    return parseFloat((pmt * 2.5).toFixed(0))
  }, [liability])

  const xTickFormatter = React.useCallback((v) => {
    const [y, m] = v.split('-')
    if (data.length <= 24) { const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${months[parseInt(m)-1]} '${y.slice(2)}` }
    return `'${y.slice(2)}`
  }, [data.length])

  const latestSaved = React.useMemo(() => {
    const last = [...fullData].reverse().find(d => d.interest_saved !== null)
    return last?.interest_saved ?? 0
  }, [fullData])

  const COLS = ['Principal', 'Interest', 'Balance', 'Crossover']
  const ROWS = ['Actual', 'Projected', 'Scheduled']

  const gridLookup = {}
  for (const [col, row, key] of LEGEND_GRID) {
    const s = CHART_SERIES.find(s => s.key === key)
    if (s) gridLookup[`${row}|${col}`] = { ...s, key, label: col }
  }

  const LegendPill = ({ s }) => {
    const off     = hidden.has(s.key)
    const color   = off ? 'var(--border)' : s.color
    const svgDash = s.dash === 'dashed' ? '5 3' : s.dash === 'dotted' ? '1.5 2.5' : undefined
    return (
      <button type="button" onClick={() => toggleSeries(s.key)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 9px', borderRadius: '20px', fontSize: '11px', cursor: 'pointer', border: `1px solid ${off ? 'var(--border)' : s.color}`, background: off ? 'transparent' : `${s.color}18`, color: off ? 'var(--text-tertiary)' : 'var(--text-secondary)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
        <svg width="22" height="10" viewBox="0 0 22 10" style={{ flexShrink: 0 }}>
          <line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth={s.dash === 'solid' ? 2.5 : 2} strokeDasharray={svgDash} strokeLinecap="round" />
        </svg>
        {s.label}
      </button>
    )
  }

  // Keys belonging to each row — used for row-level toggle
  const ROW_KEYS = {
    Actual:    ['actual_principal', 'actual_interest', 'actual_balance'],
    Projected: ['proj_principal', 'proj_interest', 'proj_balance', CROSSOVER_KEYS.current],
    Scheduled: ['sched_principal', 'sched_interest', 'sched_balance', CROSSOVER_KEYS.sched],
    Other:     ['interest_saved', CROSSOVER_KEYS.projPayoff],
  }

  const isRowOff = (row) => ROW_KEYS[row].every(k => hidden.has(k))

  const toggleRow = (row) => {
    const keys = ROW_KEYS[row]
    const allOff = keys.every(k => hidden.has(k))
    setHidden(prev => {
      const next = new Set(prev)
      if (allOff) keys.forEach(k => next.delete(k))
      else        keys.forEach(k => next.add(k))
      return next
    })
  }

  const RowLabel = ({ row }) => {
    const off = isRowOff(row)
    return (
      <button
        type="button"
        onClick={() => toggleRow(row)}
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
          fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: off ? 'var(--text-tertiary)' : 'var(--text-secondary)',
          opacity: off ? 0.5 : 1, transition: 'opacity 0.15s, color 0.15s',
        }}
        title={`Toggle all ${row} series`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
          <rect x="1" y="1" width="10" height="10" rx="2"
            fill={off ? 'transparent' : 'var(--text-tertiary)'}
            stroke="var(--text-tertiary)" strokeWidth="1.5" />
          {!off && <path d="M3 6l2.5 2.5L9 3.5" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
        </svg>
        {row}
      </button>
    )
  }

  // Keys belonging to each column — used for column-level toggle
  const COL_KEYS = {
    Principal: ['actual_principal', 'proj_principal', 'sched_principal'],
    Interest:  ['actual_interest',  'proj_interest',  'sched_interest', 'interest_saved'],
    Balance:   ['actual_balance',   'proj_balance',   'sched_balance'],
    Crossover: [CROSSOVER_KEYS.sched, CROSSOVER_KEYS.current, CROSSOVER_KEYS.projPayoff],
  }

  const isColOff = (col) => COL_KEYS[col].every(k => hidden.has(k))

  const toggleCol = (col) => {
    const keys = COL_KEYS[col]
    const allOff = keys.every(k => hidden.has(k))
    setHidden(prev => {
      const next = new Set(prev)
      if (allOff) keys.forEach(k => next.delete(k))
      else        keys.forEach(k => next.add(k))
      return next
    })
  }

  const ColLabel = ({ col }) => {
    const off = isColOff(col)
    return (
      <button
        type="button"
        onClick={() => toggleCol(col)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
          fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: off ? 'var(--text-tertiary)' : 'var(--text-secondary)',
          opacity: off ? 0.5 : 1, transition: 'opacity 0.15s, color 0.15s', width: '100%',
        }}
        title={`Toggle all ${col} series`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
          <rect x="1" y="1" width="10" height="10" rx="2"
            fill={off ? 'transparent' : 'var(--text-tertiary)'}
            stroke="var(--text-tertiary)" strokeWidth="1.5" />
          {!off && <path d="M3 6l2.5 2.5L9 3.5" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
        </svg>
        {col}
      </button>
    )
  }

  const CustomLegend = () => (
    <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border)', marginTop: '8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(4, 1fr)', gap: '5px', alignItems: 'center' }}>
        {/* Header row — top-left corner empty, then one ColLabel per column */}
        <div />
        {COLS.map(col => <ColLabel key={col} col={col} />)}

        {/* Actual / Projected / Scheduled rows */}
        {ROWS.map(row => (
          <React.Fragment key={row}>
            <RowLabel row={row} />
            {COLS.map(col => {
              if (col === 'Crossover') {
                if (row === 'Scheduled') {
                  const key = CROSSOVER_KEYS.sched, off = hidden.has(key)
                  const date = schedCrossover ? fmtMonthYear(schedCrossover.label + '-01') : null
                  return (
                    <div key={`${row}|${col}`} style={{ display: 'flex', justifyContent: 'center' }}>
                      <button type="button" onClick={() => toggleSeries(key)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 9px', borderRadius: '20px', fontSize: '11px', cursor: 'pointer', border: `1px solid ${off ? 'var(--border)' : '#a855f7'}`, background: off ? 'transparent' : '#a855f718', color: off ? 'var(--text-tertiary)' : 'var(--text-secondary)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                        <svg width="10" height="14" viewBox="0 0 10 14" style={{ flexShrink: 0 }}><line x1="5" y1="1" x2="5" y2="13" stroke={off ? 'var(--border)' : '#a855f7'} strokeWidth="2" strokeDasharray="1.5 2" strokeLinecap="round" /></svg>
                        {date || '—'}
                      </button>
                    </div>
                  )
                }
                if (row === 'Projected') {
                  const key = CROSSOVER_KEYS.current, off = hidden.has(key)
                  const date = currentCrossover ? fmtMonthYear(currentCrossover.label + '-01') : null
                  return (
                    <div key={`${row}|${col}`} style={{ display: 'flex', justifyContent: 'center' }}>
                      <button type="button" onClick={() => toggleSeries(key)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 9px', borderRadius: '20px', fontSize: '11px', cursor: 'pointer', border: `1px solid ${off ? 'var(--border)' : '#a855f7'}`, background: off ? 'transparent' : '#a855f718', color: off ? 'var(--text-tertiary)' : 'var(--text-secondary)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                        <svg width="10" height="14" viewBox="0 0 10 14" style={{ flexShrink: 0 }}><line x1="5" y1="1" x2="5" y2="13" stroke={off ? 'var(--border)' : '#a855f7'} strokeWidth="2" strokeDasharray="4 2" strokeLinecap="round" /></svg>
                        {date || '—'}
                      </button>
                    </div>
                  )
                }
                return <div key={`${row}|${col}`} />
              }
              const s = gridLookup[`${row}|${col}`]
              return s ? (
                <div key={`${row}|${col}`} style={{ display: 'flex', justifyContent: 'center' }}><LegendPill s={s} /></div>
              ) : <div key={`${row}|${col}`} />
            })}
          </React.Fragment>
        ))}

        {/* Other row */}
        <RowLabel row="Other" />
        <div />
        {/* Interest Saved pill — Interest column */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <LegendPill s={{ key: 'interest_saved', color: '#22c55e', dash: 'solid', label: 'Saved' }} />
        </div>
        <div />
        {/* Projected payoff pill — Crossover column */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {projPayoff ? (() => {
            const key = CROSSOVER_KEYS.projPayoff
            const off = hidden.has(key)
            const date = fmtMonthYear(projPayoff.label + '-01')
            return (
              <button type="button" onClick={() => toggleSeries(key)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 9px', borderRadius: '20px', fontSize: '11px', cursor: 'pointer', border: `1px solid ${off ? 'var(--border)' : '#22c55e'}`, background: off ? 'transparent' : '#22c55e18', color: off ? 'var(--text-tertiary)' : 'var(--text-secondary)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                <svg width="10" height="14" viewBox="0 0 10 14" style={{ flexShrink: 0 }}>
                  <line x1="5" y1="1" x2="5" y2="13" stroke={off ? 'var(--border)' : '#22c55e'} strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" />
                </svg>
                {date}
              </button>
            )
          })() : <div />}
        </div>
      </div>
    </div>
  )

  return (
    <div className="card" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <span style={{ fontSize: '13px', fontWeight: 500 }}>Monthly Principal vs Interest</span>
        </div>
        <div className="budget-view-toggle">
          {X_RANGES.map(r => (
            <button key={r.label} type="button" className={`budget-view-btn${xRange === r.label ? ' active' : ''}`} onClick={() => setXRange(r.label)}>{r.label}</button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 4, right: 48, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={xTickFormatter} interval={tickInterval} />
          <YAxis yAxisId="mo" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={fmtK} width={42} domain={[0, moAxisMax]} />
          <YAxis yAxisId="bal" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={fmtK} width={42} />
          <YAxis yAxisId="sav" orientation="right" tick={false} width={0} axisLine={false} />
          <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '12px' }} labelStyle={{ color: 'var(--text-secondary)', marginBottom: '4px' }} labelFormatter={v => fmtMonthYear(v + '-01')} formatter={(val, name) => val == null ? null : [formatCurrency(val), name]} />
          {CHART_SERIES.map(s => (
            <Line key={s.key} yAxisId={s.axis} type="monotone" dataKey={s.key} name={s.key.replace(/_/g, ' ')} stroke={s.color} strokeWidth={s.dash === 'solid' ? 2.5 : 1.5} strokeDasharray={strokeDashArray(s.dash)} dot={false} connectNulls={false} hide={hidden.has(s.key)} />
          ))}
          {schedCrossover && inView(schedCrossover.label) && !hidden.has(CROSSOVER_KEYS.sched) && (
            <ReferenceLine yAxisId="mo" x={schedCrossover.label} stroke="#a855f7" strokeDasharray="1.5 2.5" label={{ value: '⊕', position: 'insideTopRight', fontSize: 10, fill: '#a855f7' }} />
          )}
          {currentCrossover && inView(currentCrossover.label) && currentCrossover.label !== schedCrossover?.label && !hidden.has(CROSSOVER_KEYS.current) && (
            <ReferenceLine yAxisId="mo" x={currentCrossover.label} stroke="#a855f7" strokeDasharray="5 3" label={{ value: '⊕', position: 'insideTopRight', fontSize: 10, fill: '#a855f7' }} />
          )}
          {projPayoff && inView(projPayoff.label) && !hidden.has(CROSSOVER_KEYS.projPayoff) && (
            <ReferenceLine yAxisId="bal" x={projPayoff.label} stroke="#22c55e" strokeDasharray="6 3"
              label={{ value: '✓', position: 'insideTopLeft', fontSize: 11, fill: '#22c55e' }} />
          )}
          {schedPayoff && inView(schedPayoff.label) && !hidden.has('sched_balance') && (
            <ReferenceLine yAxisId="bal" x={schedPayoff.label} stroke="var(--text-tertiary)" strokeDasharray="2 3" label={{ value: '✓', position: 'insideTopLeft', fontSize: 11, fill: 'var(--text-tertiary)' }} />
          )}
        </LineChart>
      </ResponsiveContainer>

      <CustomLegend />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
        {latestSaved > 0.5
          ? <span>Interest saved vs scheduled: <span style={{ color: '#22c55e', fontWeight: 500 }}>{formatCurrency(latestSaved)}</span></span>
          : <span />
        }
        <span>Left: monthly · Right: balance</span>
      </div>
    </div>
  )
}

// ── Detail view ───────────────────────────────────────────────────────────────

function LiabilityDetail({ liability, onBack, onEdit, categories }) {
  const [showSchedule, setShowSchedule] = useState(true)
  const [showChart,    setShowChart]    = useState(true)

  const { data: scheduleData, isLoading, error } = useLiabilitySchedule(liability.id)

  // After the schedule loads, the server has already written the updated balance
  // back to the DB. Invalidate liabilities so the list reflects the new value.
  const qc = useQueryClient()
  useEffect(() => {
    if (scheduleData) {
      qc.invalidateQueries({ queryKey: ['liabilities'] })
    }
  }, [scheduleData, qc])

  const hasLoanTerms = !!(liability.original_principal && liability.interest_rate &&
    liability.loan_term_months && liability.origination_date)

  const linkedCategory = categories?.find(c => c.id === liability.category_id)
  const color = typeColor(liability.type)

  // Current balance: from schedule summary if available, else fall back to liability field
  const currentBalance = scheduleData?.summary?.current_balance ?? currentBal(liability)

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn-ghost" style={{ padding: '6px 10px' }} onClick={onBack}><ArrowLeft size={14} /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
            <div>
              <h1 className="page-title" style={{ marginBottom: 0 }}>{liability.name}</h1>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {liability.type}
                {liability.interest_rate ? ` · ${fmtPct(liability.interest_rate)} APR` : ''}
                {linkedCategory ? ` · Tracking "${linkedCategory.category}"` : ' · No category linked'}
              </span>
            </div>
          </div>
        </div>
        <button className="btn-ghost" onClick={() => onEdit(liability)}>Edit</button>
      </div>

      {!hasLoanTerms && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--amber)' }}>
          <AlertCircle size={14} />
          Loan terms incomplete — add principal, interest rate, term, and origination date to enable amortization tracking.
        </div>
      )}

      {!liability.category_id && (
        <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--accent)' }}>
          <AlertCircle size={14} />
          No transaction category linked — edit this liability and select a category to match actual payments.
        </div>
      )}

      {hasLoanTerms && scheduleData && (
        <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
          <MetricCard label="Current Balance" value={formatCurrency(scheduleData.summary.current_balance)} sub={scheduleData.summary.payment_count > 0 ? `after ${scheduleData.summary.payment_count} matched payments` : 'no payments matched yet'} valueColor="var(--red)" />
          <MetricCard label="Principal Paid" value={formatCurrency(scheduleData.summary.principal_paid)} sub={`of ${formatCurrency(scheduleData.summary.original_principal)}`} valueColor="var(--green)" />
          <MetricCard label="Interest Paid" value={formatCurrency(scheduleData.summary.interest_paid)} sub={`${formatCurrency(scheduleData.summary.interest_remaining)} remaining`} valueColor="var(--red)" />
          <MetricCard label="Payoff Date" value={fmtMonthYear(scheduleData.summary.payoff_date)} sub={`${scheduleData.summary.months_remaining} payments left`} />
        </div>
      )}

      {hasLoanTerms && scheduleData && (() => {
        const s = scheduleData.summary
        const theoreticalPaid = (() => {
          const r = liability.interest_rate / 12, n = liability.loan_term_months, P = s.original_principal
          const elapsed = scheduleData.summary.payment_count
          if (r > 0) return Math.min(P, P - Math.max(0, P * (Math.pow(1+r,n) - Math.pow(1+r,elapsed)) / (Math.pow(1+r,n) - 1)))
          return Math.min(P, P * elapsed / n)
        })()
        const overpaid = Math.max(0, s.principal_paid - theoreticalPaid)
        return (
          <div className="card" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>Payoff Progress</span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{s.payment_count} of {scheduleData.schedule.length} payments ({((s.payment_count / scheduleData.schedule.length) * 100).toFixed(1)}%)</span>
            </div>
            <ProgressBar paid={s.principal_paid} total={s.original_principal} remaining={scheduleData.summary.current_balance} overpaid={overpaid} />
            <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 500 }}>Total cost breakdown</div>
              {(() => {
                const totalCost    = s.original_principal + s.total_interest
                const principalPct = (s.original_principal / totalCost * 100).toFixed(1)
                const interestPct  = (s.total_interest     / totalCost * 100).toFixed(1)
                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '12px', fontWeight: 500 }}>
                      <span style={{ color: 'var(--accent)' }}>{formatCurrency(s.original_principal)}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{formatCurrency(totalCost)}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${principalPct}%`, background: 'var(--accent)', transition: 'width .4s' }} />
                      <div style={{ width: `${interestPct}%`, background: 'var(--red)', transition: 'width .4s' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      <span style={{ color: 'var(--accent)' }}>■ Principal {formatCurrency(s.original_principal)} ({principalPct}%)</span>
                      <span style={{ color: 'var(--red)' }}>■ Total interest {formatCurrency(s.total_interest)} ({interestPct}%)</span>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        )
      })()}

      {hasLoanTerms && scheduleData && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600 }}>Loan Analysis</h2>
            <button className="btn-ghost" style={{ fontSize: '12px' }} onClick={() => setShowChart(s => !s)}>{showChart ? 'Hide' : 'Show'}</button>
          </div>
          {showChart && <PrincipalInterestChart schedule={scheduleData.schedule} liability={liability} />}
        </>
      )}

      {hasLoanTerms && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600 }}>Payment History &amp; Projection</h2>
            <button className="btn-ghost" style={{ fontSize: '12px' }} onClick={() => setShowSchedule(s => !s)}>{showSchedule ? 'Hide' : 'Show'}</button>
          </div>
          {showSchedule && (
            isLoading ? (
              <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>Building schedule…</div>
            ) : error ? (
              <div className="card" style={{ padding: '1.25rem 1.5rem', color: 'var(--amber)', fontSize: '13px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <AlertCircle size={14} /> {error.response?.data?.error || 'Could not load schedule'}
              </div>
            ) : scheduleData ? (
              <ScheduleTable
                schedule={scheduleData.schedule}
                currentBalance={scheduleData.summary.current_balance}
                originalPrincipal={scheduleData.summary.original_principal}
              />
            ) : null
          )}
        </>
      )}

      {!hasLoanTerms && (
        <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            {[['Current Balance', formatCurrency(currentBalance), 'var(--red)'], ['Type', liability.type, null], ['Notes', liability.notes || '—', null]].map(([label, value, color]) => (
              <div key={label}>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '3px' }}>{label}</div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: color || 'var(--text)' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Master list ───────────────────────────────────────────────────────────────

function LiabilityList({ liabilities, onSelect, onEdit, onDelete, onAdd }) {
  const totalBalance = liabilities.reduce((s, l) => s + currentBal(l), 0)

  const byType = LIABILITY_TYPES.reduce((acc, t) => {
    const items = liabilities.filter(l => l.type === t)
    if (items.length) acc[t] = items
    return acc
  }, {})
  liabilities.forEach(l => {
    if (!LIABILITY_TYPES.includes(l.type) && !byType[l.type]) {
      byType[l.type] = liabilities.filter(x => x.type === l.type)
    }
  })

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Liabilities</h1></div>
        <button className="btn-primary" onClick={onAdd}>+ Add liability</button>
      </div>

      <div className="grid-4" style={{ marginBottom: '1.75rem' }}>
        <MetricCard label="Total Liabilities" value={formatCurrency(totalBalance)} sub={`${liabilities.length} liabilit${liabilities.length !== 1 ? 'ies' : 'y'}`} valueColor="var(--red)" />
        <MetricCard label="With Loan Terms" value={liabilities.filter(l => l.original_principal && l.interest_rate).length} sub="amortization enabled" />
        <MetricCard label="Tracked by Category" value={liabilities.filter(l => l.category_id).length} sub="matched to transactions" />
        <MetricCard label="Types" value={Object.keys(byType).length} sub="liability categories" />
      </div>

      {liabilities.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ fontSize: '13px' }}>No liabilities yet. <button className="btn-link" onClick={onAdd}>Add one</button></p>
        </div>
      ) : (
        Object.entries(byType).map(([type, items]) => {
          const color     = typeColor(type)
          const typeTotal = items.reduce((s, l) => s + currentBal(l), 0)
          return (
            <div key={type} style={{ marginBottom: '1.5rem' }}>
              <div className="asset-type-header">
                <div className="asset-type-header-left">
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
                  {type}
                </div>
                <div className="asset-type-header-right">
                  <span className="asset-type-total" style={{ color: 'var(--red)' }}>-{formatCurrency(typeTotal)}</span>
                </div>
              </div>

              <div className="card" style={{ padding: 0, '--dt-cols': 'minmax(0,1fr) minmax(90px,110px) 55px 60px minmax(110px,130px) 36px' }}>
                <div className="acct-tbl-header">
                  <span className="col-header-label">Liability</span>
                  <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Principal</span>
                  <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Term</span>
                  <span className="col-header-label">APR</span>
                  <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Balance</span>
                  <div />
                </div>

                {items.map(liab => (
                  <div key={liab.id} className="acct-tbl-row" style={{ cursor: 'pointer' }} onClick={() => onSelect(liab)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <DotBtn color={color} expandable={false} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {liab.name}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
                        </div>
                        {liab.notes && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{liab.notes}</div>}
                        {!liab.category_id && <div style={{ fontSize: '11px', color: 'var(--amber)' }}>No category linked</div>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--text-secondary)' }}>{liab.original_principal ? formatCurrency(liab.original_principal) : '—'}</div>
                    <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--text-secondary)' }}>{fmtTerm(liab.loan_term_months)}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>{liab.interest_rate ? fmtPct(liab.interest_rate) : '—'}</div>
                    <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: 'var(--red)' }}>-{formatCurrency(currentBal(liab))}</div>
                    <RowMoreMenu items={[
                      { label: 'Edit', onClick: () => onEdit(liab) },
                      { label: 'Delete', danger: true, onClick: () => onDelete(liab.id) },
                    ]} />
                  </div>
                ))}

                <div className="tbl-footer-row">
                  <div /><div /><div /><div />
                  <span className="footer-value footer-value--down" style={{ textAlign: 'right' }}>-{formatCurrency(typeTotal)}</span>
                  <div />
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Liabilities() {
  const [selectedLiability, setSelectedLiability] = useState(null)
  const [showModal,          setShowModal]         = useState(false)
  const [editingLiability,   setEditingLiability]  = useState(null)

  const location = useLocation()
  const { data: liabilities = [], isLoading } = useLiabilities()
  const { data: budgetRows  = [] }            = useBudgetCategories()
  const { data: assets      = [] }            = useAssets()

  useEffect(() => {
    if (location.state?.selectId && liabilities.length > 0) {
      const target = liabilities.find(l => l.id === location.state.selectId)
      if (target) setSelectedLiability(target)
    }
  }, [location.state?.selectId, liabilities])

  const createMut = useCreateLiability()
  const updateMut = useUpdateLiability()
  const deleteMut = useDeleteLiability()

  const syncedSelected = useMemo(() => {
    if (!selectedLiability) return null
    return liabilities.find(l => l.id === selectedLiability.id) || null
  }, [selectedLiability, liabilities])

  if (isLoading) return <div className="loading">Loading…</div>

  const handleSave = async (form) => {
    try {
      if (editingLiability) await updateMut.mutateAsync({ id: editingLiability.id, data: form })
      else                   await createMut.mutateAsync(form)
      setShowModal(false)
      setEditingLiability(null)
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this liability? Its balance history will be removed.')) return
    await deleteMut.mutateAsync(id)
    if (selectedLiability?.id === id) setSelectedLiability(null)
  }

  const openEdit = (liab) => { setEditingLiability(liab); setShowModal(true) }
  const openAdd  = ()     => { setEditingLiability(null); setShowModal(true) }

  return (
    <div>
      {syncedSelected ? (
        <LiabilityDetail
          liability={syncedSelected}
          categories={budgetRows}
          onBack={() => setSelectedLiability(null)}
          onEdit={openEdit}
        />
      ) : (
        <LiabilityList
          liabilities={liabilities}
          onSelect={setSelectedLiability}
          onEdit={openEdit}
          onDelete={handleDelete}
          onAdd={openAdd}
        />
      )}

      {showModal && (
        <LiabilityModal
          initial={editingLiability}
          assets={assets}
          categories={budgetRows}
          onClose={() => { setShowModal(false); setEditingLiability(null) }}
          onSave={handleSave}
          loading={createMut.isPending || updateMut.isPending}
        />
      )}
    </div>
  )
}