import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { getProjectorInputs, saveProjectorInput, getProjection, updateLiability, getProjectorBounds } from '../api'
import { useAccounts } from '../hooks/useAccounts'
import { useAssets } from '../hooks/useAssets'
import { useLiabilities } from '../hooks/useLiabilities'
import { formatCurrency } from '../utils'

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

function DualRangeSlider({ min, max, left, right, onChange, onCommit, months }) {
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
      {/* Date labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '13px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{fmtMonth(months[left])}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {monthsBetween(months[left], months[right])} months
        </span>
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{fmtMonth(months[right])}</span>
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

// Shared layout for the projection inputs cell — label left, input+suffix right, note below
function InputCell({ rows, note }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {row.label && (
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', width: '52px', flexShrink: 0 }}>
              {row.label}
            </span>
          )}
          {row.content}
        </div>
      ))}
      {note && <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', paddingTop: '1px' }}>{note}</span>}
    </div>
  )
}

function AccountInputRow({ account, input, currentBalance, onSave }) {
  const needsGrowth = ['Investment', 'Retirement', 'Savings', 'Checking'].includes(account.type)
  const isCC        = account.type === 'Credit card'
  const save = (patch) => onSave('account', account.id, { ...input, ...patch })

  const inputRows = []
  if (needsGrowth) inputRows.push({
    label: ['Investment','Retirement'].includes(account.type) ? 'Return' : 'Growth',
    content: <RateInput value={input?.growth_rate ?? null} onChange={v => save({ growth_rate: v })} />,
  })
  if (isCC) {
    inputRows.push({
      label: 'APR',
      content: <RateInput value={input?.apr ?? null} onChange={v => save({ apr: v })} />,
    })
    inputRows.push({
      label: 'Payment',
      content: (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <select value={input?.cc_payment_mode || 'full'}
            onChange={e => save({ cc_payment_mode: e.target.value })}
            style={{ fontSize: '12px', padding: '3px 6px', width: 'auto' }}>
            <option value="full">Pay in full</option>
            <option value="minimum">Minimum</option>
            <option value="fixed">Fixed $</option>
          </select>
          {(input?.cc_payment_mode === 'minimum' || input?.cc_payment_mode === 'fixed') && (
            <RateInput value={input?.cc_min_payment ?? null}
              onChange={v => save({ cc_min_payment: v })} suffix="$" placeholder="0" step="1" />
          )}
        </div>
      ),
    })
  }

  return (
    <div className="acct-tbl-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: ACCOUNT_COLORS[account.type] || '#888', flexShrink: 0, display: 'inline-block' }} />
        <div style={{ minWidth: 0 }}>
          <span className="budget-cat-name">{account.name}</span>
          <div className="budget-cat-sub">{account.type}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600,
        color: account.type === 'Credit card' ? 'var(--red)' : 'var(--text)' }}>
        {currentBalance != null ? formatCurrency(currentBalance) : '—'}
      </div>
      <InputCell rows={inputRows} note={needsGrowth ? 'cmpd. monthly' : null} />
    </div>
  )
}

function AssetInputRow({ asset, assetInput, linkedLiabilities, liabilityInputs, currentValues, onSave }) {
  const [expanded, setExpanded] = useState(false)
  const color       = ASSET_COLORS[asset.type] || '#888'
  const hasLinked   = linkedLiabilities.length > 0
  const saveAsset   = (patch) => onSave('asset', asset.id, { ...assetInput, ...patch })
  const saveLiab    = (liab, patch) => onSave('liability', liab.id, { ...liabilityInputs[liab.id], ...patch })

  // Equity = asset current value − sum of linked liability balances
  const assetVal  = currentValues?.assets?.[asset.id]
  const liabTotal = linkedLiabilities.reduce((s, l) => s + (currentValues?.liabilities?.[l.id] ?? l.balance), 0)
  const equity    = assetVal != null ? assetVal - liabTotal : null

  return (
    <>
      {/* Parent equity row */}
      <div className="acct-tbl-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <DotBtn color={color} expandable={hasLinked} expanded={expanded} onClick={() => setExpanded(e => !e)} />
          <div style={{ minWidth: 0 }}>
            <span className="budget-cat-name">{asset.name}{hasLinked ? ' (equity)' : ''}</span>
            <div className="budget-cat-sub">{asset.type}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600,
          color: equity != null && equity < 0 ? 'var(--red)' : 'var(--text)' }}>
          {equity != null ? formatCurrency(equity) : (assetVal != null ? formatCurrency(assetVal) : '—')}
        </div>
        <InputCell
          rows={[{ label: 'Appreciation', content: <RateInput value={assetInput?.growth_rate ?? null} onChange={v => saveAsset({ growth_rate: v })} /> }]}
          note="cmpd. monthly"
        />
      </div>

      {/* Expanded children */}
      {expanded && (
        <>
          {/* Asset child */}
          <div className="acct-tbl-row" style={{ paddingLeft: '2.5rem', background: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <DotBtn color={color} expandable={false} />
              <div style={{ minWidth: 0 }}>
                <span className="budget-cat-name" style={{ fontSize: '12px' }}>{asset.name}</span>
                <div className="budget-cat-sub">Asset value</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>
              {assetVal != null ? formatCurrency(assetVal) : '—'}
            </div>
            <div />
          </div>

          {/* Linked liability children */}
          {linkedLiabilities.map(liab => {
            const liabInput = liabilityInputs[liab.id] || {}
            const liabBal   = currentValues?.liabilities?.[liab.id] ?? liab.balance
            const hasTerms  = !!(liab.original_principal && liab.interest_rate && liab.loan_term_months)
            const lColor    = LIABILITY_COLORS[liab.type] || '#888'
            return (
              <div key={liab.id} className="acct-tbl-row" style={{ paddingLeft: '2.5rem', background: 'var(--bg-secondary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <DotBtn color={lColor} expandable={false} />
                  <div style={{ minWidth: 0 }}>
                    <span className="budget-cat-name" style={{ fontSize: '12px' }}>{liab.name}</span>
                    <div className="budget-cat-sub">{liab.type}{hasTerms ? ' · amortized' : ''}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: 'var(--red)' }}>
                  {formatCurrency(liabBal)}
                </div>
                {!hasTerms
                  ? <InputCell rows={[
                      { label: 'APR', content: <RateInput value={liabInput.apr ?? null} onChange={v => saveLiab(liab, { apr: v })} /> },
                    ]} />
                  : <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>amortized</div>
                }
              </div>
            )
          })}
        </>
      )}
    </>
  )
}

function LiabilityInputRow({ liability, input, currentBalance, onSave, onLiabilityUpdate }) {
  const saveInput = (patch) => onSave('liability', liability.id, { ...input, ...patch })
  const color     = LIABILITY_COLORS[liability.type] || '#888'

  // Local state for loan term fields — saved on blur to liabilities table
  const [balance,    setBalance]    = useState(liability.balance != null ? String(liability.balance) : '')
  const [rate,       setRate]       = useState(liability.interest_rate != null ? String((liability.interest_rate * 100).toFixed(3)) : '')
  const [term,       setTerm]       = useState(liability.loan_term_months != null ? String(liability.loan_term_months) : '')
  const [origDate,   setOrigDate]   = useState(liability.origination_date || '')
  const [monthlyPmt, setMonthlyPmt] = useState(liability.monthly_payment != null ? String(liability.monthly_payment) : '')
  const [expanded,   setExpanded]   = useState(false)

  const saveTerms = () => {
    onLiabilityUpdate(liability.id, {
      name:               liability.name,
      type:               liability.type,
      balance:            parseFloat(balance) || liability.balance,
      asset_id:           liability.asset_id   || null,
      category_id:        liability.category_id || null,
      original_principal: liability.original_principal || null,
      interest_rate:      rate       ? parseFloat(rate) / 100    : null,
      loan_term_months:   term       ? parseInt(term)             : null,
      origination_date:   origDate   || null,
      monthly_payment:    monthlyPmt ? parseFloat(monthlyPmt)     : null,
      notes:              liability.notes || null,
    })
  }

  const hasTerms     = !!(liability.original_principal && liability.interest_rate && liability.loan_term_months)
  const isCreditLine = !hasTerms

  return (
    <div>
      {/* Main grid row */}
      <div className="acct-tbl-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
          <div style={{ minWidth: 0 }}>
            <span className="budget-cat-name">{liability.name}</span>
            <div className="budget-cat-sub">
              {liability.type}
              {hasTerms && <span style={{ color: 'var(--text-tertiary)', marginLeft: '6px' }}>· amortized</span>}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: 'var(--red)' }}>
          {formatCurrency(currentBalance ?? liability.balance)}
        </div>
        <InputCell
          rows={[
            ...(isCreditLine ? [
              { label: 'APR', content: <RateInput value={input?.apr ?? null} onChange={v => saveInput({ apr: v })} /> },
              { label: 'Payment', content: (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <select value={input?.cc_payment_mode || 'full'}
                    onChange={e => saveInput({ cc_payment_mode: e.target.value })}
                    style={{ fontSize: '12px', padding: '3px 6px', width: 'auto' }}>
                    <option value="full">Pay in full</option>
                    <option value="minimum">Minimum</option>
                    <option value="fixed">Fixed $</option>
                  </select>
                  {(input?.cc_payment_mode === 'minimum' || input?.cc_payment_mode === 'fixed') && (
                    <RateInput value={input?.cc_min_payment ?? null}
                      onChange={v => saveInput({ cc_min_payment: v })} suffix="$" placeholder="0" step="1" />
                  )}
                </div>
              )},
            ] : []),
            { label: '', content: (
              <button type="button" className="btn-ghost" style={{ fontSize: '11px', padding: '2px 8px' }}
                onClick={() => setExpanded(e => !e)}>
                {expanded ? '▲' : '▼'} terms
              </button>
            )},
          ]}
        />
      </div>

      {/* Expanded loan term fields */}
      {expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', padding: '10px 0 12px 16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', marginBottom: '6px' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Current balance ($)</label>
            <input type="number" value={balance} onChange={e => setBalance(e.target.value)}
              onBlur={saveTerms} step="0.01" min="0" style={{ fontSize: '12px' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Interest rate (APR %)</label>
            <input type="number" value={rate} onChange={e => setRate(e.target.value)}
              onBlur={saveTerms} step="0.001" min="0" max="100" style={{ fontSize: '12px' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Term (months)</label>
            <input type="number" value={term} onChange={e => setTerm(e.target.value)}
              onBlur={saveTerms} min="1" style={{ fontSize: '12px' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Origination date</label>
            <input type="date" value={origDate} onChange={e => setOrigDate(e.target.value)}
              onBlur={saveTerms} style={{ fontSize: '12px' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Monthly payment ($)</label>
            <input type="number" value={monthlyPmt} onChange={e => setMonthlyPmt(e.target.value)}
              onBlur={saveTerms} step="0.01" min="0" style={{ fontSize: '12px' }} />
          </div>
        </div>
      )}
    </div>
  )
}

function InputsPanel({ accounts, assets, liabilities, inputs, onSave, currentValues, onLiabilityUpdate }) {
  const [open,        setOpen]        = useState(false)
  const [activeSection, setActiveSection] = useState('accounts')

  const ccAccounts  = accounts.filter(a => a.type === 'Credit card')
  const growthAccts = accounts.filter(a => ['Investment','Retirement','Savings','Checking'].includes(a.type))
  const otherAccts  = accounts.filter(a => !['Credit card','Investment','Retirement','Savings','Checking'].includes(a.type))

  const sections = [
    { id: 'accounts', label: 'Accounts', count: accounts.length },
    { id: 'assets',   label: 'Assets',   count: assets.length },
    { id: 'liabilities', label: 'Liabilities', count: liabilities.length },
  ].filter(s => s.count > 0)

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: 0, color: 'var(--text)',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600 }}>Projection assumptions</span>
        <ChevronRight size={14} style={{
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
          color: 'var(--text-tertiary)',
        }} />
      </button>

      {open && (
        <div style={{ marginTop: '14px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.6 }}>
            Set growth rates, APRs, and payment modes for each entity. Leave blank to assume no growth / interest.
            Bills and income schedules are applied automatically based on their mapped accounts.
          </p>

          {/* Section tabs */}
          {sections.length > 1 && (
            <div className="budget-view-toggle" style={{ marginBottom: '12px', width: 'fit-content' }}>
              {sections.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`budget-view-btn${activeSection === s.id ? ' active' : ''}`}
                  onClick={() => setActiveSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {activeSection === 'accounts' && (
            <div className="card" style={{ padding: 0, '--dt-cols': 'minmax(0,1fr) 110px minmax(160px,220px)' }}>
              <div className="acct-tbl-header">
                <span className="col-header-label">Account</span>
                <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Current</span>
                <span className="col-header-label">Projection inputs</span>
              </div>
              {accounts.length === 0
                ? <p className="muted" style={{ padding: '1rem 1.5rem', fontSize: '13px' }}>No accounts.</p>
                : accounts.map(a => (
                    <AccountInputRow
                      key={a.id} account={a}
                      input={inputs[`account:${a.id}`]}
                      currentBalance={currentValues?.accounts?.[a.id]}
                      onSave={onSave}
                    />
                  ))
              }
            </div>
          )}

          {activeSection === 'assets' && (
            <div className="card" style={{ padding: 0, '--dt-cols': 'minmax(0,1fr) 110px minmax(180px,220px)' }}>
              <div className="acct-tbl-header">
                <span className="col-header-label">Asset</span>
                <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Current</span>
                <span className="col-header-label">Appreciation</span>
              </div>
              {assets.length === 0
                ? <p className="muted" style={{ padding: '1rem 1.5rem', fontSize: '13px' }}>No assets.</p>
                : assets.map(a => {
                    const linked = liabilities.filter(l => l.asset_id === a.id)
                    const liabInputMap = {}
                    linked.forEach(l => { liabInputMap[l.id] = inputs[`liability:${l.id}`] })
                    return (
                      <AssetInputRow
                        key={a.id}
                        asset={a}
                        assetInput={inputs[`asset:${a.id}`]}
                        linkedLiabilities={linked}
                        liabilityInputs={liabInputMap}
                        currentValues={currentValues}
                        onSave={onSave}
                      />
                    )
                  })
              }
            </div>
          )}

          {activeSection === 'liabilities' && (
            <div className="card" style={{ padding: 0, '--dt-cols': 'minmax(0,1fr) 110px minmax(200px,320px)' }}>
              <div className="acct-tbl-header">
                <span className="col-header-label">Liability</span>
                <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Current</span>
                <span className="col-header-label">Projection inputs</span>
              </div>
              {liabilities.length === 0
                ? <p className="muted" style={{ padding: '1rem 1.5rem', fontSize: '13px' }}>No liabilities.</p>
                : liabilities.map(l => (
                    <LiabilityInputRow
                      key={l.id} liability={l}
                      input={inputs[`liability:${l.id}`]}
                      currentBalance={currentValues?.liabilities?.[l.id]}
                      onSave={onSave}
                      onLiabilityUpdate={onLiabilityUpdate}
                    />
                  ))
              }
            </div>
          )}
        </div>
      )}
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
  // Left bound: earliest data month (from API), default 5yr back
  // Right bound: 30 years forward
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
  const todayDataIdx    = committedLeft <= todayIdx ? todayIdx - committedLeft : -1
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

      {/* Summary cards */}
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

      {/* Chart */}
      <div className="card">
        {/* Date range slider */}
        <DualRangeSlider
          min={0}
          max={allMonths.length - 1}
          left={leftIdx}
          right={rightIdx}
          months={allMonths}
          onChange={(l, r) => { setLeftIdx(l); setRightIdx(r) }}
          onCommit={(l, r) => { setCommittedLeft(l); setCommittedRight(r) }}
        />

        <div style={{ marginTop: '16px' }}>
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