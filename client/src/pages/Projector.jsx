import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { getProjectorInputs, saveProjectorInput, getProjection, updateLiability, getProjectorBounds } from '../api'
import { useAccounts } from '../hooks/useAccounts'
import { useAssets } from '../hooks/useAssets'
import { useLiabilities } from '../hooks/useLiabilities'
import { formatCurrency } from '../utils'
import { MonthPicker } from '../components/DateRangePicker'

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNT_COLORS = {
  'Checking':    '#3b82f6',
  'Savings':     '#22c55e',
  'Investment':  '#8b5cf6',
  'Retirement':  '#06b6d4',
  'Credit card': '#ef4444',
  'Loan':        '#f97316',
  'Other':       '#888888',
  'Virtual':     '#555555',
}

const ASSET_COLORS = {
  'Real Estate':     '#3b82f6',
  'Vehicle':         '#f59e0b',
  'Business':        '#22c55e',
  'Collectibles':    '#8b5cf6',
  'Crypto':          '#f97316',
  'Precious Metals': '#eab308',
  'Other':           '#888888',
}

const LIABILITY_COLORS = {
  'Mortgage':       '#ef4444',
  'Auto Loan':      '#f97316',
  'Student Loan':   '#ec4899',
  'Personal Loan':  '#8b5cf6',
  'Line of Credit': '#06b6d4',
  'Other':          '#888888',
}

const EQUITY_COLORS = {
  'Real Estate':     '#60a5fa',
  'Vehicle':         '#fcd34d',
  'Business':        '#4ade80',
  'Collectibles':    '#c084fc',
  'Crypto':          '#fb923c',
  'Precious Metals': '#fde047',
  'Other':           '#aaaaaa',
}

function seriesColor(s) {
  if (s.seriesType === 'account')   return ACCOUNT_COLORS[s.type]   || '#888'
  if (s.seriesType === 'asset')     return ASSET_COLORS[s.type]     || '#888'
  if (s.seriesType === 'equity')    return EQUITY_COLORS[s.type]    || '#aaa'
  if (s.seriesType === 'liability') return LIABILITY_COLORS[s.type] || '#888'
  return '#555'
}

// ── Month helpers ─────────────────────────────────────────────────────────────

function addMonths(yyyymm, n) {
  const [y, m] = yyyymm.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return d.toISOString().slice(0, 7)
}

function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

function fmtMonth(yyyymm) {
  if (!yyyymm) return ''
  const [y, m] = yyyymm.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[m - 1]} ${y}`
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useProjectorBounds() {
  return useQuery({
    queryKey: ['projector-bounds'],
    queryFn:  () => getProjectorBounds().then(r => r.data),
  })
}

function useSaveLiability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => updateLiability(id, data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['liabilities'] })
      qc.invalidateQueries({ queryKey: ['projection'] })
    },
  })
}

function useProjectorInputs() {
  return useQuery({
    queryKey: ['projector-inputs'],
    queryFn:  () => getProjectorInputs().then(r => r.data),
  })
}

function useSaveProjectorInput() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ type, id, data }) => saveProjectorInput(type, id, data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['projector-inputs'] })
      qc.invalidateQueries({ queryKey: ['projection'] })
    },
  })
}

function useProjection(from, to, enabled) {
  return useQuery({
    queryKey: ['projection', from, to],
    queryFn:  () => getProjection({ from, to }).then(r => r.data),
    enabled:  enabled && !!from && !!to,
    staleTime: 30 * 1000,
  })
}

// ── Dual range slider ─────────────────────────────────────────────────────────
// min/max are integer indices into the months array.
// Returns [leftIdx, rightIdx].

function DualRangeSlider({ min, max, left, right, onChange, onCommit, months, fromPicker, toPicker }) {
  const trackRef = useRef(null)
  const pending  = useRef({ left, right })

  // Keep pending in sync with controlled props
  useEffect(() => { pending.current = { left, right } }, [left, right])

  const pct = (idx) => ((idx - min) / (max - min)) * 100

  const idxFromClientX = useCallback((clientX) => {
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(min + ratio * (max - min))
  }, [min, max])

  const onMouseDown = (handle) => (e) => {
    e.preventDefault()
    const move = (ev) => {
      const idx = idxFromClientX(ev.clientX)
      let l = pending.current.left, r = pending.current.right
      if (handle === 'left')  l = Math.min(idx, r - 1)
      else                    r = Math.max(idx, l + 1)
      pending.current = { left: l, right: r }
      onChange(l, r)
    }
    const up = () => {
      onCommit(pending.current.left, pending.current.right)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onTouchStart = (handle) => (e) => {
    const move = (ev) => {
      const touch = ev.touches[0]
      const idx   = idxFromClientX(touch.clientX)
      let l = pending.current.left, r = pending.current.right
      if (handle === 'left')  l = Math.min(idx, r - 1)
      else                    r = Math.max(idx, l + 1)
      pending.current = { left: l, right: r }
      onChange(l, r)
    }
    const end = () => {
      onCommit(pending.current.left, pending.current.right)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
    }
    window.addEventListener('touchmove', move)
    window.addEventListener('touchend', end)
  }

  const leftPct  = pct(left)
  const rightPct = pct(right)

  return (
    <div style={{ padding: '8px 12px 4px' }}>
      {/* Date labels — rendered as MonthPickers when provided, else plain text */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span>{fromPicker ?? <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>{fmtMonth(months[left])}</span>}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {monthsBetween(months[left], months[right])} months
        </span>
        <span>{toPicker ?? <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>{fmtMonth(months[right])}</span>}</span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        style={{
          position: 'relative',
          height: '4px',
          background: 'var(--border)',
          borderRadius: '2px',
          margin: '10px 0',
          userSelect: 'none',
        }}
      >
        {/* Filled range */}
        <div style={{
          position: 'absolute',
          left: `${leftPct}%`,
          width: `${rightPct - leftPct}%`,
          height: '100%',
          background: 'var(--accent)',
          borderRadius: '2px',
        }} />

        {/* Left thumb */}
        <div
          onMouseDown={onMouseDown('left')}
          onTouchStart={onTouchStart('left')}
          style={{
            position: 'absolute',
            left: `${leftPct}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 16, height: 16,
            borderRadius: '50%',
            background: 'var(--accent)',
            border: '2px solid var(--bg-card)',
            cursor: 'grab',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
            zIndex: 2,
          }}
        />

        {/* Right thumb */}
        <div
          onMouseDown={onMouseDown('right')}
          onTouchStart={onTouchStart('right')}
          style={{
            position: 'absolute',
            left: `${rightPct}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 16, height: 16,
            borderRadius: '50%',
            background: 'var(--accent)',
            border: '2px solid var(--bg-card)',
            cursor: 'grab',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
            zIndex: 2,
          }}
        />
      </div>

      {/* Min/max labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
        <span>{fmtMonth(months[min])}</span>
        <span>{fmtMonth(months[max])}</span>
      </div>
    </div>
  )
}

// ── Inputs panel — per entity ─────────────────────────────────────────────────

function RateInput({ label, value, onChange, suffix = '%', step = '0.1', min = '0', placeholder = '0.0' }) {
  const [local, setLocal] = useState(value != null ? String(value) : '')

  useEffect(() => {
    setLocal(value != null ? String(value) : '')
  }, [value])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {label && <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>}
      <input
        type="number"
        value={local}
        min={min}
        step={step}
        placeholder={placeholder}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => {
          const v = parseFloat(local)
          onChange(isNaN(v) ? null : v)
        }}
        style={{ width: '64px', fontSize: '12px', padding: '4px 6px', textAlign: 'right' }}
      />
      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', flexShrink: 0 }}>{suffix}</span>
    </div>
  )
}

// Dot-chevron expand button — same pattern as Assets page
// ── Unified projection table constants ────────────────────────────────────────
const PROJ_COLS = 'minmax(0,1fr) 100px 80px 90px 90px minmax(120px,160px)'
const hdrStyle  = { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-tertiary)' }

function SectionDivider({ label }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: PROJ_COLS, gap: '12px', padding: '6px 1.5rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
      <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-tertiary)', gridColumn: '1 / -1' }}>{label}</span>
    </div>
  )
}

function ProjectionRow({ dotColor, name, sub, currentVal, valColor, input, onSave, onLiabilityUpdate, liability }) {
  const save  = (patch) => onSave({ ...input, ...patch })
  const isCC  = sub?.includes('Credit card') || sub?.includes('credit line')
  const isLiab = !!liability
  const hasTerms = isLiab && !!(liability.original_principal && liability.interest_rate && liability.loan_term_months)

  // Local liability terms state
  const [expanded,   setExpanded]   = useState(false)
  const [balance,    setBalance]    = useState(liability?.balance != null ? String(liability.balance) : '')
  const [rate,       setRate]       = useState(liability?.interest_rate != null ? String((liability.interest_rate * 100).toFixed(3)) : '')
  const [term,       setTerm]       = useState(liability?.loan_term_months != null ? String(liability.loan_term_months) : '')
  const [origDate,   setOrigDate]   = useState(liability?.origination_date || '')
  const [monthlyPmt, setMonthlyPmt] = useState(liability?.monthly_payment != null ? String(liability.monthly_payment) : '')

  const saveTerms = () => {
    if (!onLiabilityUpdate || !liability) return
    onLiabilityUpdate(liability.id, {
      name: liability.name, type: liability.type,
      balance: parseFloat(balance) || liability.balance,
      asset_id: liability.asset_id || null, category_id: liability.category_id || null,
      original_principal: liability.original_principal || null,
      interest_rate: rate ? parseFloat(rate) / 100 : null,
      loan_term_months: term ? parseInt(term) : null,
      origination_date: origDate || null,
      monthly_payment: monthlyPmt ? parseFloat(monthlyPmt) : null,
      notes: liability?.notes || null,
    })
  }

  const rateVal    = input?.growth_rate ?? input?.apr ?? null
  const rateChange = (v) => {
    if (input?.apr !== undefined || isCC || isLiab) save({ apr: v })
    else save({ growth_rate: v })
  }

  return (
    <>
      <div className="acct-tbl-row" style={{ padding: '5px 1.5rem', alignItems: 'center' }}>
        {/* Name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
          <div style={{ minWidth: 0 }}>
            <span className="budget-cat-name">{name}</span>
            {sub && <div className="budget-cat-sub">{sub}{hasTerms && <span style={{ color: 'var(--text-tertiary)', marginLeft: '4px' }}>· amortized</span>}</div>}
          </div>
        </div>
        {/* Current */}
        <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: valColor || 'var(--text)' }}>
          {currentVal != null ? formatCurrency(currentVal) : '—'}
        </div>
        {/* Rate */}
        {hasTerms
          ? <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>amortized</div>
          : <RateInput value={rateVal} onChange={rateChange} />
        }
        {/* Period — Monthly / Annual */}
        {hasTerms
          ? <div />
          : <select value={input?.rate_period || 'annual'} onChange={e => save({ rate_period: e.target.value })}
              style={{ fontSize: '12px', padding: '3px 6px' }}>
              <option value="annual">Annual</option>
              <option value="quarterly">Quarterly</option>
              <option value="monthly">Monthly</option>
            </select>
        }
        {/* Compounding — Simple / Compound */}
        {hasTerms
          ? <div />
          : <select value={input?.compounding || 'compound'} onChange={e => save({ compounding: e.target.value })}
              style={{ fontSize: '12px', padding: '3px 6px' }}>
              <option value="compound">Compound</option>
              <option value="simple">Simple</option>
            </select>
        }
        {/* Payment / Mode */}
        <div>
          {isCC && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <select value={input?.cc_payment_mode || 'full'} onChange={e => save({ cc_payment_mode: e.target.value })}
                style={{ fontSize: '12px', padding: '3px 6px', width: 'auto' }}>
                <option value="full">Pay in full</option>
                <option value="minimum">Minimum</option>
                <option value="fixed">Fixed $</option>
              </select>
              {(input?.cc_payment_mode === 'minimum' || input?.cc_payment_mode === 'fixed') && (
                <RateInput value={input?.cc_min_payment ?? null} onChange={v => save({ cc_min_payment: v })} suffix="$" placeholder="0" step="1" />
              )}
            </div>
          )}
          {isLiab && !isCC && !hasTerms && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <select value={input?.cc_payment_mode || 'full'} onChange={e => save({ cc_payment_mode: e.target.value })}
                style={{ fontSize: '12px', padding: '3px 6px', width: 'auto' }}>
                <option value="full">Pay in full</option>
                <option value="minimum">Minimum</option>
                <option value="fixed">Fixed $</option>
              </select>
            </div>
          )}
          {isLiab && (
            <button type="button" className="btn-ghost" style={{ fontSize: '11px', padding: '2px 8px', marginTop: isCC || !hasTerms ? '4px' : '0' }}
              onClick={() => setExpanded(e => !e)}>
              {expanded ? '▲' : '▼'} terms
            </button>
          )}
        </div>
      </div>

      {/* Expanded liability terms */}
      {expanded && isLiab && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', padding: '10px 1.5rem 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Current balance ($)</label>
            <input type="number" value={balance} onChange={e => setBalance(e.target.value)} onBlur={saveTerms} step="0.01" min="0" style={{ fontSize: '12px' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Interest rate (APR %)</label>
            <input type="number" value={rate} onChange={e => setRate(e.target.value)} onBlur={saveTerms} step="0.001" min="0" max="100" style={{ fontSize: '12px' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Term (months)</label>
            <input type="number" value={term} onChange={e => setTerm(e.target.value)} onBlur={saveTerms} min="1" style={{ fontSize: '12px' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Origination date</label>
            <input type="date" value={origDate} onChange={e => setOrigDate(e.target.value)} onBlur={saveTerms} style={{ fontSize: '12px' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Monthly payment ($)</label>
            <input type="number" value={monthlyPmt} onChange={e => setMonthlyPmt(e.target.value)} onBlur={saveTerms} step="0.01" min="0" style={{ fontSize: '12px' }} />
          </div>
        </div>
      )}
    </>
  )
}

function InputsPanel({ accounts, assets, liabilities, inputs, onSave, currentValues, onLiabilityUpdate }) {
  const handleSave = (type, id, data) => onSave(type, id, data)

  const hasAny = accounts.length > 0 || assets.length > 0 || liabilities.length > 0
  if (!hasAny) return null

  return (
    <div style={{ marginTop: '1.75rem' }}>
      <div className="section-label" style={{ marginBottom: '10px' }}>Projection assumptions</div>
      <div className="card" style={{ padding: 0, '--dt-cols': PROJ_COLS }}>
        {/* Header */}
        <div className="acct-tbl-header" style={{ position: 'relative', top: 'unset', padding: '6px 1.5rem' }}>
          {['Name', 'Balance', 'APR', 'Period', 'Interest Type', 'Payment / Mode'].map((h, i) => (
            <div key={i} style={{ ...hdrStyle, justifyContent: i === 1 ? 'flex-end' : 'flex-start', display: 'flex', alignItems: 'center' }}>{h}</div>
          ))}
        </div>

        {/* Accounts */}
        {accounts.length > 0 && <SectionDivider label="Accounts" />}
        {accounts.map(a => (
          <ProjectionRow
            key={`account:${a.id}`}
            dotColor={ACCOUNT_COLORS[a.type] || '#888'}
            name={a.name}
            sub={a.type}
            currentVal={currentValues?.accounts?.[a.id]}
            valColor={a.type === 'Credit card' ? 'var(--red)' : undefined}
            input={inputs[`account:${a.id}`] || {}}
            onSave={(data) => handleSave('account', a.id, data)}
          />
        ))}

        {/* Assets */}
        {assets.length > 0 && <SectionDivider label="Assets" />}
        {assets.map(a => {
          const liabTotal = liabilities.filter(l => l.asset_id === a.id).reduce((s, l) => s + (currentValues?.liabilities?.[l.id] ?? l.balance), 0)
          const assetVal  = currentValues?.assets?.[a.id]
          const equity    = assetVal != null ? assetVal - liabTotal : null
          return (
            <ProjectionRow
              key={`asset:${a.id}`}
              dotColor={ASSET_COLORS[a.type] || '#888'}
              name={a.name}
              sub={a.type}
              currentVal={equity ?? assetVal}
              valColor={equity != null && equity < 0 ? 'var(--red)' : undefined}
              input={inputs[`asset:${a.id}`] || {}}
              onSave={(data) => handleSave('asset', a.id, data)}
            />
          )
        })}

        {/* Liabilities */}
        {liabilities.length > 0 && <SectionDivider label="Liabilities" />}
        {liabilities.map(l => (
          <ProjectionRow
            key={`liability:${l.id}`}
            dotColor={LIABILITY_COLORS[l.type] || '#888'}
            name={l.name}
            sub={l.type}
            currentVal={currentValues?.liabilities?.[l.id] ?? l.balance}
            valColor="var(--red)"
            input={inputs[`liability:${l.id}`] || {}}
            onSave={(data) => handleSave('liability', l.id, data)}
            onLiabilityUpdate={onLiabilityUpdate}
            liability={l}
          />
        ))}
      </div>
    </div>
  )
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────

function ProjectorTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  // Dedupe: for each base name show only the non-null value (hist takes priority)
  const seen = new Map()
  for (const p of payload) {
    if (p.value == null) continue
    const baseName = p.name.replace(/ \(proj\)$/, '')
    if (!seen.has(baseName) || !p.name.endsWith('(proj)')) {
      seen.set(baseName, { color: p.color, value: p.value, proj: p.name.endsWith('(proj)') })
    }
  }
  const entries = [...seen.entries()].sort((a, b) => Math.abs(b[1].value) - Math.abs(a[1].value))
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: '12px',
    }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: '6px' }}>{fmtMonth(label)}</div>
      {entries.map(([name, { color, value, proj }]) => (
        <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', color, marginBottom: '2px' }}>
          <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: proj ? 0.75 : 1 }}>
            {name}{proj ? ' *' : ''}
          </span>
          <span style={{ fontWeight: 600 }}>
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value)}
          </span>
        </div>
      ))}
      {entries.some(([, v]) => v.proj) && (
        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>* projected</div>
      )}
    </div>
  )
}

// ── Legend ────────────────────────────────────────────────────────────────────

function ProjectorLegend({ series, hidden, onToggle, today }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
      {/* Net worth */}
      <button
        className="chart-legend-item"
        onClick={() => onToggle('__networth__')}
        style={{ opacity: hidden.has('__networth__') ? 0.35 : 1 }}
      >
        <span style={{ width: 20, height: 2.5, background: '#f0f0f0', borderRadius: 2, flexShrink: 0 }} />
        <span>Net Worth</span>
      </button>

      {series.map(s => {
        const key   = `${s.seriesType}:${s.id}`
        const color = seriesColor(s)
        return (
          <button
            key={key}
            className="chart-legend-item"
            onClick={() => onToggle(key)}
            style={{ opacity: hidden.has(key) ? 0.35 : 1 }}
          >
            <span style={{ width: 20, height: 2, flexShrink: 0, borderRadius: 2, background: color }} />
            <span>{s.name}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Projector() {
  document.title = 'Pinance | Projector'
  const today = new Date().toISOString().slice(0, 7)

  const { data: accounts    = [] } = useAccounts()
  const { data: assets      = [] } = useAssets()
  const { data: liabilities = [] } = useLiabilities()
  const { data: inputs = {}      } = useProjectorInputs()
  const saveInput                  = useSaveProjectorInput()
  const saveLiability              = useSaveLiability()

  const { data: bounds } = useProjectorBounds()

  // ── Build the full possible month range ───────────────────────────────────
  // ── Build the full possible month range ───────────────────────────────────
  const PROJECTION_MONTHS = 360  // 30 years

  const allMonths = useMemo(() => {
    const earliest  = bounds?.earliest || addMonths(today, -60)
    const histStart = earliest <= today ? earliest : addMonths(today, -1)
    const months    = []
    let cur = histStart
    const end = addMonths(today, PROJECTION_MONTHS)
    while (cur <= end) { months.push(cur); cur = addMonths(cur, 1) }
    return months
  }, [today, bounds?.earliest])

  const todayIdx = useMemo(() =>
    allMonths.indexOf(today) !== -1 ? allMonths.indexOf(today) : 0
  , [allMonths, today])

  const [leftIdx,  setLeftIdx]  = useState(0)
  const [rightIdx, setRightIdx] = useState(0)

  // Committed state — only updates on drag release (triggers the query)
  const [committedLeft,  setCommittedLeft]  = useState(0)
  const [committedRight, setCommittedRight] = useState(0)

  // Once allMonths resolves, set default right to today+24
  useEffect(() => {
    if (todayIdx > 0 && rightIdx === 0) {
      setRightIdx(Math.min(todayIdx + 24, allMonths.length - 1))
      setCommittedRight(Math.min(todayIdx + 24, allMonths.length - 1))
    }
  }, [todayIdx, allMonths.length])

  const fromMonth = allMonths[committedLeft]
  const toMonth   = allMonths[committedRight]

  // Snap slider thumbs when MonthPicker changes a bound
  const handleFromMonthChange = (yyyymm) => {
    const idx = allMonths.indexOf(yyyymm)
    if (idx === -1) return
    const clamped = Math.min(idx, committedRight - 1)
    setLeftIdx(clamped); setCommittedLeft(clamped)
  }
  const handleToMonthChange = (yyyymm) => {
    const idx = allMonths.indexOf(yyyymm)
    if (idx === -1) return
    const clamped = Math.max(idx, committedLeft + 1)
    setRightIdx(clamped); setCommittedRight(clamped)
  }

  // ── Fetch projection ──────────────────────────────────────────────────────
  const { data: projData, isLoading } = useProjection(
    fromMonth, toMonth,
    accounts.length > 0 || assets.length > 0 || liabilities.length > 0
  )

  // ── Hidden series ─────────────────────────────────────────────────────────
  const [hidden, setHidden] = useState(new Set())
  const toggleHidden = (key) => {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Build chart data ──────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!projData?.months) return []
    return projData.months.map((month, i) => {
      const isHist = month <= today
      const point  = { month }
      const nw = projData.netWorth[i]
      // today month appears on BOTH lines — solid ends here, dashed starts here
      if (isHist)              point['nw_hist'] = nw
      if (month >= today)      point['nw_proj'] = nw
      for (const s of (projData.series || [])) {
        const key = `${s.seriesType}:${s.id}`
        if (isHist)         point[`${key}_hist`] = s.data[i]
        if (month >= today) point[`${key}_proj`] = s.data[i]
      }
      return point
    })
  }, [projData, today])

  const formatYAxis = (v) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v)

  const xTickFormatter = useCallback((v) => {
    if (!v) return ''
    const [y, m] = v.split('-').map(Number)
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return chartData.length <= 36
      ? `${months[m-1]} '${String(y).slice(2)}`
      : `'${String(y).slice(2)}`
  }, [chartData.length])

  const tickInterval = Math.max(1, Math.floor((chartData.length) / 10))

  // ── Current values for the panel — latest actual value in selected range ─
  const currentValues = useMemo(() => {
    if (!projData?.months || !projData?.series) return null
    const result = { accounts: {}, assets: {}, liabilities: {} }
    for (const s of projData.series) {
      // Find last non-null history value (month <= today)
      let lastVal = null
      for (let i = 0; i < projData.months.length; i++) {
        if (projData.months[i] > today) break
        if (s.data[i] != null) lastVal = s.data[i]
      }
      if (lastVal == null) continue
      if (s.seriesType === 'account')  result.accounts[s.id]     = lastVal
      if (s.seriesType === 'asset' || s.seriesType === 'equity')
                                        result.assets[s.id]      = lastVal
      if (s.seriesType === 'liability') result.liabilities[s.id] = Math.abs(lastVal)
    }
    return result
  }, [projData, today])

  const handleLiabilityUpdate = useCallback((id, data) => {
    saveLiability.mutate({ id, data })
  }, [saveLiability])

  const handleSave = useCallback((type, id, data) => {
    saveInput.mutate({ type, id, data })
  }, [saveInput])

  // ── Net worth summary ─────────────────────────────────────────────────────
  const finalNetWorth   = projData?.netWorth?.[projData.netWorth.length - 1]
  const todayDataIdx    = todayIdx >= committedLeft && todayIdx <= committedRight ? todayIdx - committedLeft : -1
  const currentNetWorth = todayDataIdx >= 0 ? (projData?.netWorth?.[todayDataIdx] ?? null) : null
  const netWorthDelta   = finalNetWorth != null && currentNetWorth != null
    ? finalNetWorth - currentNetWorth
    : null

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projector</h1>
          <p className="page-sub">Model your financial future based on current bills, income, and growth rates</p>
        </div>
      </div>

      {/* Chart — first, matching Dashboard layout */}
      <div className="card" style={{ marginBottom: '1.75rem' }}>
        {/* Date range slider — labels are clickable MonthPickers */}
        <DualRangeSlider
          min={0}
          max={allMonths.length - 1}
          left={leftIdx}
          right={rightIdx}
          months={allMonths}
          onChange={(l, r) => { setLeftIdx(l); setRightIdx(r) }}
          onCommit={(l, r) => { setCommittedLeft(l); setCommittedRight(r) }}
          fromPicker={<MonthPicker value={fromMonth || today} onChange={handleFromMonthChange} hideArrows />}
          toPicker={<MonthPicker value={toMonth || today} onChange={handleToMonthChange} hideArrows />}
        />

        <div>
          {isLoading ? (
            <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
              Building projection…
            </div>
          ) : !projData || chartData.length === 0 ? (
            <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
              No data available. Add accounts, assets, or liabilities to get started.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tickFormatter={xTickFormatter}
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={false} tickLine={false}
                  interval={tickInterval}
                />
                <YAxis
                  tickFormatter={formatYAxis}
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={false} tickLine={false}
                  width={64}
                />
                <Tooltip content={<ProjectorTooltip />} />

                {/* Today reference line */}
                {allMonths[todayIdx] >= fromMonth && allMonths[todayIdx] <= toMonth && (
                  <ReferenceLine
                    x={today}
                    stroke="var(--text-tertiary)"
                    strokeDasharray="4 3"
                    label={{ value: 'Today', position: 'insideTopRight', fontSize: 10, fill: 'var(--text-tertiary)' }}
                  />
                )}

                {/* Net worth — solid history, dashed projection */}
                {!hidden.has('__networth__') && <>
                  <Line key="nw_hist" type="monotone" dataKey="nw_hist" name="Net Worth"
                    stroke="#f0f0f0" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls legendType="none" />
                  <Line key="nw_proj" type="monotone" dataKey="nw_proj" name="Net Worth (proj)"
                    stroke="#f0f0f0" strokeWidth={2.5} strokeDasharray="6 3" dot={false} activeDot={{ r: 4 }} connectNulls legendType="none" />
                </>}

                {/* Per-entity lines — solid history, dashed projection */}
                {(projData?.series || []).map(s => {
                  const key   = `${s.seriesType}:${s.id}`
                  const color = seriesColor(s)
                  if (hidden.has(key)) return null
                  return [
                    <Line key={`${key}_hist`} type="monotone" dataKey={`${key}_hist`} name={s.name}
                      stroke={color} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }}
                      connectNulls legendType="none" />,
                    <Line key={`${key}_proj`} type="monotone" dataKey={`${key}_proj`} name={`${s.name} (proj)`}
                      stroke={color} strokeWidth={1.5} strokeDasharray="6 3" dot={false} activeDot={{ r: 3 }}
                      connectNulls legendType="none" />,
                  ]
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {projData?.series && (
          <ProjectorLegend
            series={projData.series}
            hidden={hidden}
            onToggle={toggleHidden}
            today={today}
          />
        )}
      </div>

      {/* Summary cards — below chart, matching Dashboard pattern */}
      {projData && (
        <div className="grid-4" style={{ marginBottom: '1.75rem' }}>
          <div className="card metric-card">
            <div className="metric-label">Current Net Worth</div>
            <div className="metric-value">{currentNetWorth != null ? formatCurrency(currentNetWorth) : '—'}</div>
          </div>
          <div className="card metric-card">
            <div className="metric-label">Projected Net Worth</div>
            <div className="metric-value" style={{ color: (finalNetWorth ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {finalNetWorth != null ? formatCurrency(finalNetWorth) : '—'}
            </div>
            <div className="metric-sub">{fmtMonth(toMonth)}</div>
          </div>
          <div className="card metric-card">
            <div className="metric-label">Projected change</div>
            <div className={`metric-value ${(netWorthDelta ?? 0) >= 0 ? 'up' : 'down'}`}>
              {netWorthDelta != null ? `${netWorthDelta >= 0 ? '+' : ''}${formatCurrency(netWorthDelta)}` : '—'}
            </div>
          </div>
          <div className="card metric-card">
            <div className="metric-label">Projection span</div>
            <div className="metric-value">{monthsBetween(today, toMonth)}</div>
            <div className="metric-sub">months forward</div>
          </div>
        </div>
      )}

      {/* Projection assumptions panel */}
      {(accounts.length > 0 || assets.length > 0 || liabilities.length > 0) && (
        <InputsPanel
          accounts={accounts}
          assets={assets}
          liabilities={liabilities}
          inputs={inputs}
          onSave={handleSave}
          currentValues={currentValues}
          onLiabilityUpdate={handleLiabilityUpdate}
        />
      )}
    </div>
  )
}