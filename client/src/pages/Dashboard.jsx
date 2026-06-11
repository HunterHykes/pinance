import { useMemo, useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { useAccounts } from '../hooks/useAccounts'
import { useAssets } from '../hooks/useAssets'
import { useTransactions } from '../hooks/useTransactions'
import { useBudget } from '../hooks/useBudget'
import { useNetWorth } from '../hooks/useNetWorth'
import { useAccountPrefs, useSaveAccountPref, useInstitutionPrefs } from '../hooks/useAccountPrefs'
import { formatCurrency, formatDate, currentMonth, spendColor } from '../utils'

// Summary metric card
function MetricCard({ label, value, sub, subClass }) {
  return (
    <div className="card metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className={`metric-sub ${subClass || ''}`}>{sub}</div>}
    </div>
  )
}

// Single transaction row
function TxnRow({ txn }) {
  const isIncome   = txn.amount > 0
  const isTransfer = txn.source === 'transfer'
  return (
    <div className="txn-row">
      <div className="txn-info">
        <div className="txn-name">{txn.description}</div>
        <div className="txn-meta">{formatDate(txn.date)} · {txn.category}</div>
      </div>
      <div className={`txn-amount ${isIncome ? 'up' : isTransfer ? '' : 'down'}`}>
        {isIncome ? '+' : '-'}{formatCurrency(Math.abs(txn.amount))}
      </div>
    </div>
  )
}

// Budget progress bar row
function BudgetRow({ item }) {
  const spent = item.spent || 0
  const limit = item.monthly_limit || 0
  const pct   = limit > 0 ? Math.min(spent / limit, 1) * 100 : 0
  const color = spendColor(spent, limit)
  return (
    <div className="budget-row">
      <div className="budget-meta">
        <span className="budget-name">{item.category}</span>
        <span className="muted">{formatCurrency(spent)} / {formatCurrency(limit)}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}


// ── Account type → chart color ────────────────────────────────────────────────

const ACCOUNT_COLORS = {
  'Checking':    '#3b82f6',
  'Savings':     '#22c55e',
  'Investment':  '#8b5cf6',
  'Retirement':  '#06b6d4',
  'Credit card': '#ef4444',
  'Loan':        '#f97316',
  'Other':       '#888888',
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

const RANGES = ['1W', '1M', '3M', '6M', '1Y', '5Y', '10Y', 'ALL']

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#1f1f1f',
      border: '1px solid #2a2a2a',
      borderRadius: '8px',
      padding: '10px 14px',
      fontSize: '12px',
    }}>
      <div style={{ color: '#888', marginBottom: '6px' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', color: p.color, marginBottom: '2px' }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600, color: p.value >= 0 ? p.color : '#ef4444' }}>
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Stroke dash patterns ─────────────────────────────────────────────────────

const DASH_PATTERNS = {
  solid:  undefined,
  dashed: '6 3',
  dotted: '2 3',
}

// ── Inline legend popover ─────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#a3e635',
  '#e11d48', '#7c3aed', '#0ea5e9', '#84cc16', '#fb923c',
]

function hexToRgb(hex) {
  if (!hex) return { r: 59, g: 130, b: 246 }
  const h = hex.replace('#', '')
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) }
}
function rgbToHex({ r, g, b }) {
  return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('')
}

function SeriesPopover({ series, currentColor, currentStyle, defaultColor, onSave, onClose }) {
  const [color,     setColor]     = useState(currentColor || defaultColor)
  const [lineStyle, setLineStyle] = useState(currentStyle || 'solid')
  const [colorMode, setColorMode] = useState('preset')
  const [rgb,       setRgb]       = useState(() => hexToRgb(currentColor || defaultColor))
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const updateRgb = (channel, val) => {
    const next = { ...rgb, [channel]: parseInt(val) }
    setRgb(next)
    setColor(rgbToHex(next))
  }

  const handleSave = () => { onSave({ color, line_style: lineStyle }); onClose() }
  const handleReset = () => { onSave({ color: null, line_style: 'solid' }); onClose() }

  return (
    <div className="series-popover" ref={ref}>
      <div className="series-popover-title">{series.name}</div>

      {/* Color tabs */}
      <div className="color-picker-tabs" style={{ marginBottom: '8px' }}>
        <button type="button" className={`color-tab${colorMode === 'preset' ? ' active' : ''}`} onClick={() => setColorMode('preset')}>Presets</button>
        <button type="button" className={`color-tab${colorMode === 'custom' ? ' active' : ''}`} onClick={() => setColorMode('custom')}>Custom RGB</button>
      </div>

      {colorMode === 'preset' && (
        <div className="color-picker" style={{ marginBottom: '10px' }}>
          {PRESET_COLORS.map(c => (
            <button key={c} type="button"
              className={`color-swatch${color === c ? ' selected' : ''}`}
              style={{ background: c }}
              onClick={() => { setColor(c); setRgb(hexToRgb(c)) }}
            />
          ))}
        </div>
      )}

      {colorMode === 'custom' && (
        <div className="color-picker-custom" style={{ marginBottom: '10px' }}>
          <div className="color-preview-row">
            <div className="color-preview-box" style={{ background: color }} />
            <span className="color-hex-label">{color}</span>
          </div>
          <div className="rgb-sliders">
            {[['r','R','#ef4444'],['g','G','#22c55e'],['b','B','#3b82f6']].map(([k,l,c]) => (
              <div key={k} className="rgb-row">
                <span className="rgb-label" style={{ color: c }}>{l}</span>
                <input type="range" min="0" max="255" value={rgb[k]} onChange={e => updateRgb(k, e.target.value)} className="rgb-slider" style={{ accentColor: c }} />
                <input type="number" min="0" max="255" value={rgb[k]} onChange={e => updateRgb(k, e.target.value)} className="rgb-number" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Line style */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Line style</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {[['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']].map(([val, label]) => (
            <button key={val} type="button"
              className={`color-tab${lineStyle === val ? ' active' : ''}`}
              onClick={() => setLineStyle(val)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <svg width="24" height="8" viewBox="0 0 24 8">
                <line x1="0" y1="4" x2="24" y2="4"
                  stroke="currentColor" strokeWidth="2"
                  strokeDasharray={val === 'dashed' ? '6 3' : val === 'dotted' ? '2 3' : undefined}
                />
              </svg>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
        <button type="button" className="btn-ghost" style={{ fontSize: '12px' }} onClick={handleReset}>Reset</button>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" className="btn-ghost" style={{ fontSize: '12px' }} onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" style={{ fontSize: '12px' }} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ── Net Worth Chart ───────────────────────────────────────────────────────────

function NetWorthChart() {
  const [range, setRange]           = useState('1M')
  const [hiddenSeries, setHidden]   = useState(new Set())
  const [editingSeries, setEditing] = useState(null) // account_id | null
  const { data, isLoading, isError } = useNetWorth(range)
  const { data: prefs = {} }         = useAccountPrefs()
  const { data: instPrefs = {} }     = useInstitutionPrefs()
  const savePref                     = useSaveAccountPref()

  const toggleSeries = (key) => {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const resolveColor = (s) => {
    if (s.seriesType === 'asset') return ASSET_COLORS[s.type] || '#888'
    // Institution color > account type default
    return instPrefs[s.institution]?.color || ACCOUNT_COLORS[s.type] || '#888'
  }
  const resolveDash  = (s) => {
    if (s.seriesType === 'asset') return DASH_PATTERNS['solid']
    const style = prefs[s.account_id]?.line_style || 'solid'
    // Default dashed for liabilities if no pref set
    if (!prefs[s.account_id] && (s.type === 'Credit card' || s.type === 'Loan')) return DASH_PATTERNS['dashed']
    return DASH_PATTERNS[style]
  }

  const chartData = useMemo(() => {
    if (!data?.dates?.length) return []
    return data.dates.map((date, i) => {
      const point = { date }
      point['Net Worth'] = data.netWorth[i]
      for (const s of data.series) point[s.name] = s.data[i]
      return point
    })
  }, [data])

  const formatTick = (dateStr) => {
    if (!dateStr) return ''
    const d = new Date(dateStr + 'T00:00:00')
    if (['5Y','10Y','ALL'].includes(range))
      return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    if (['6M','1Y'].includes(range))
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const formatYAxis = (v) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
      notation: 'compact', maximumFractionDigits: 1 }).format(v)

  const legendLineStyle = (s) => {
    const color = resolveColor(s)
    const style = s.seriesType === 'asset'
      ? 'solid'
      : prefs[s.account_id]?.line_style ||
        ((s.type === 'Credit card' || s.type === 'Loan') ? 'dashed' : 'solid')
    if (style === 'solid') return { background: color }
    const gap = style === 'dotted' ? '2px 3px' : '6px 3px'
    return { background: `repeating-linear-gradient(90deg,${color} 0 ${style === 'dotted' ? '2px' : '6px'},transparent 0 ${style === 'dotted' ? '5px' : '9px'})` }
  }

  if (isError) return (
    <div className="card">
      <p className="muted" style={{ fontSize: '13px' }}>Failed to load net worth data.</p>
    </div>
  )

  return (
    <div className="card" style={{ marginBottom: '1.75rem' }}>
      <div className="card-title" style={{ marginBottom: '1rem' }}>
        <span>Net Worth</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={range === r ? 'btn-range-active' : 'btn-range'}>{r}</button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="muted" style={{ fontSize: '13px' }}>Loading...</span>
        </div>
      ) : chartData.length === 0 ? (
        <div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="muted" style={{ fontSize: '13px' }}>No data yet — sync a bank account to start tracking.</span>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatTick}
                tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false}
                interval="preserveStartEnd" />
              <YAxis tickFormatter={formatYAxis}
                tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip content={<ChartTooltip />} />

              {!hiddenSeries.has('Net Worth') && (
                <Line type="monotone" dataKey="Net Worth"
                  stroke="#f0f0f0" strokeWidth={2.5} dot={false}
                  activeDot={{ r: 4, fill: '#f0f0f0' }} />
              )}
              {data.series
                .filter(s => s.seriesType !== 'account' || !prefs[s.account_id]?.is_hidden)
                .map(s => !hiddenSeries.has(s.name) && (
                  <Line key={s.account_id ?? `asset-${s.asset_id}`} type="monotone" dataKey={s.name}
                    stroke={resolveColor(s)} strokeWidth={1.5} dot={false}
                    activeDot={{ r: 3 }} strokeDasharray={resolveDash(s)} />
                ))}
            </LineChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #2a2a2a' }}>
            {/* Net worth — toggle only, no editor */}
            <button className="chart-legend-item"
              onClick={() => toggleSeries('Net Worth')}
              style={{ opacity: hiddenSeries.has('Net Worth') ? 0.35 : 1 }}>
              <span style={{ width: '20px', height: '2.5px', background: '#f0f0f0', borderRadius: '2px', flexShrink: 0 }} />
              <span>Net Worth</span>
            </button>

            {/* Account series — left click toggles, right click opens editor */}
            {data.series
              .filter(s => s.seriesType !== 'account' || !prefs[s.account_id]?.is_hidden)
              .map(s => {
              const seriesKey = s.seriesType === 'asset' ? `asset-${s.asset_id}` : s.account_id
              const isAsset   = s.seriesType === 'asset'
              return (
                <div key={seriesKey} style={{ position: 'relative' }}>
                  <button
                    className="chart-legend-item"
                    onClick={() => toggleSeries(s.name)}
                    onContextMenu={!isAsset ? (e => { e.preventDefault(); setEditing(seriesKey === editingSeries ? null : seriesKey) }) : undefined}
                    style={{ opacity: hiddenSeries.has(s.name) ? 0.35 : 1 }}
                    title={isAsset ? 'Left click to toggle' : 'Left click to toggle · Right click to customize'}
                  >
                    <span style={{ width: '20px', height: '2px', flexShrink: 0, borderRadius: '2px', ...legendLineStyle(s) }} />
                    <span>{s.seriesType === 'account' && prefs[s.account_id]?.display_name ? prefs[s.account_id].display_name : s.name}</span>
                    {!isAsset && <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: '1px' }}>⚙</span>}
                  </button>

                  {!isAsset && editingSeries === seriesKey && (
                    <SeriesPopover
                      series={s}
                      currentColor={prefs[s.account_id]?.color || null}
                      currentStyle={prefs[s.account_id]?.line_style || 'solid'}
                      defaultColor={instPrefs[s.institution]?.color || ACCOUNT_COLORS[s.type] || '#888'}
                      onSave={(pref) => savePref.mutate({ id: s.account_id, data: pref })}
                      onClose={() => setEditing(null)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Dashboard() {
  document.title = 'Pinance | Dashboard'
  const month = currentMonth()

  const { data: accounts = [],     isLoading: loadingAccounts }     = useAccounts()
  const { data: assetList = [],    isLoading: loadingAssets }        = useAssets()
  const { data: transactions = [], isLoading: loadingTransactions }  = useTransactions({ month })
  const { data: budget = [],       isLoading: loadingBudget }        = useBudget({ month })

  const metrics = useMemo(() => {
    const acctAssets  = accounts.filter(a => a.balance > 0).reduce((s, a) => s + a.balance, 0)
    const liabilities = accounts.filter(a => a.balance < 0).reduce((s, a) => s + a.balance, 0)
    const manualAssets = assetList.reduce((s, a) => s + a.value, 0)
    const netWorth    = acctAssets + liabilities + manualAssets
    const liquid      = accounts
      .filter(a => ['Checking', 'Savings'].includes(a.type))
      .reduce((s, a) => s + a.balance, 0)
    const invested    = accounts
      .filter(a => ['Investment', 'Retirement'].includes(a.type))
      .reduce((s, a) => s + a.balance, 0)
    const spent       = transactions
      .filter(t => t.amount < 0)
      .reduce((s, t) => s + Math.abs(t.amount), 0)
    const budgetTotal = budget.reduce((s, b) => s + b.monthly_limit, 0)
    const budgetDiff  = budgetTotal - spent

    return { netWorth, liquid, invested, spent, budgetTotal, budgetDiff, manualAssets }
  }, [accounts, assetList, transactions, budget])

  const recentTxns  = transactions.slice(0, 8)
  const topBudget   = budget.slice(0, 6)

  if (loadingAccounts || loadingAssets || loadingTransactions || loadingBudget) {
    return <div className="loading">Loading dashboard...</div>
  }

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          {/* <p className="page-sub">
            {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p> */}
        </div>
      </div>

      {/* Net Worth Chart */}
      <NetWorthChart />

      {/* Summary metrics */}
      <div className="section-label">Summary</div>
      <div className="grid-4" style={{ marginBottom: '1.75rem' }}>
        <MetricCard
          label="Net Worth"
          value={formatCurrency(metrics.netWorth)}
          sub={metrics.manualAssets > 0 ? `incl. ${formatCurrency(metrics.manualAssets)} in assets` : undefined}
        />
        <MetricCard
          label="Liquid Cash"
          value={formatCurrency(metrics.liquid)}
          sub="Checking + savings"
        />
        <MetricCard
          label="Invested"
          value={formatCurrency(metrics.invested)}
          sub="Brokerage + retirement"
        />
        <MetricCard
          label="Spent This Month"
          value={formatCurrency(metrics.spent)}
          sub={metrics.budgetDiff >= 0
            ? `${formatCurrency(metrics.budgetDiff)} under budget`
            : `${formatCurrency(Math.abs(metrics.budgetDiff))} over budget`}
          subClass={metrics.budgetDiff >= 0 ? 'up' : 'down'}
        />
      </div>

      {/* Accounts + Budget */}
      <div className="grid-2" style={{ marginBottom: '1.75rem' }}>
        <div className="card">
          <div className="card-title">
            <span>Accounts</span>
            <Link to="/accounts" className="btn-link" style={{ fontSize: '12px' }}>
              View all
            </Link>
          </div>
          {accounts.length === 0 ? (
            <p className="muted" style={{ fontSize: '13px' }}>
              No accounts yet.{' '}
              <Link to="/accounts" className="btn-link">Add one</Link>
            </p>
          ) : (
            accounts.slice(0, 6).map(acct => (
              <div key={acct.id} className="account-row">
                <div className="account-info">
                  <div className="account-name">{acct.name}</div>
                  <div className="account-sub">{acct.institution ? `${acct.institution} · ` : ''}{acct.type}</div>
                </div>
                <div className={`account-bal ${acct.balance < 0 ? 'down' : ''}`}>
                  {acct.balance < 0 ? '-' : ''}{formatCurrency(Math.abs(acct.balance))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <span>Budget — {new Date().toLocaleDateString('en-US', { month: 'long' })}</span>
            <Link to="/budget" className="btn-link" style={{ fontSize: '12px' }}>
              View all
            </Link>
          </div>
          {budget.length === 0 ? (
            <p className="muted" style={{ fontSize: '13px' }}>
              No budget categories yet.{' '}
              <Link to="/budget" className="btn-link">Set one up</Link>
            </p>
          ) : (
            topBudget.map(item => (
              <BudgetRow key={item.id} item={item} />
            ))
          )}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card">
        <div className="card-title">
          <span>Recent Transactions</span>
          <Link to="/transactions" className="btn-link" style={{ fontSize: '12px' }}>
            View all
          </Link>
        </div>
        {recentTxns.length === 0 ? (
          <p className="muted" style={{ fontSize: '13px' }}>
            No transactions this month.{' '}
            <Link to="/transactions" className="btn-link">Add one</Link>
          </p>
        ) : (
          recentTxns.map(txn => <TxnRow key={txn.id} txn={txn} />)
        )}
      </div>
    </div>
  )
}

export default Dashboard