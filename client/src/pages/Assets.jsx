import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useAssets, useCreateAsset, useUpdateAsset, useDeleteAsset } from '../hooks/useAssets'
import { useLiabilities, useCreateLiability, useUpdateLiability, useDeleteLiability } from '../hooks/useLiabilities'
import { formatCurrency } from '../utils'
import RowMoreMenu from '../components/RowMoreMenu'
import LiabilityModal from '../components/LiabilityModal'

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_ASSET_TYPES = ['Real Estate', 'Vehicle', 'Business', 'Collectibles', 'Crypto', 'Precious Metals', 'Other']
const LIABILITY_TYPES     = ['Mortgage', 'Auto Loan', 'Student Loan', 'Personal Loan', 'Line of Credit', 'Other']

const ASSET_COLORS = {
  'Real Estate': '#3b82f6', 'Vehicle': '#f59e0b', 'Business': '#22c55e',
  'Collectibles': '#8b5cf6', 'Crypto': '#f97316', 'Precious Metals': '#eab308', 'Other': '#888888',
}
const LIABILITY_COLORS = {
  'Mortgage': '#ef4444', 'Auto Loan': '#f97316', 'Student Loan': '#ec4899',
  'Personal Loan': '#8b5cf6', 'Line of Credit': '#06b6d4', 'Other': '#888888',
}
const EXTRA_PALETTE = ['#10b981', '#6366f1', '#ec4899', '#14b8a6', '#84cc16', '#a78bfa', '#f43f5e', '#0ea5e9']

function currentBal(liab) {
  return liab.current_balance ?? liab.balance
}

function typeColor(type) {
  if (ASSET_COLORS[type]) return ASSET_COLORS[type]
  let hash = 0
  for (const ch of type) hash = ((hash * 31) + ch.charCodeAt(0)) & 0xffff
  return EXTRA_PALETTE[hash % EXTRA_PALETTE.length]
}

// ── Dot button ────────────────────────────────────────────────────────────────

function DotBtn({ color, expandable, expanded, onClick }) {
  return (
    <button
      className={'budget-dot-btn' + (expandable ? ' budget-dot-btn--expandable' : '')}
      style={{ background: color, flexShrink: 0 }}
      onClick={expandable ? onClick : undefined}
      aria-label={expandable ? (expanded ? 'Collapse' : 'Expand') : undefined}
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

// ── Footer Add button ─────────────────────────────────────────────────────────
// Sits in the 36px actions column. Opens a small dropdown: "Add asset" / "Add liability".

function FooterAddButton({ onAddAsset, onAddLiability }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
      <button
        className="btn-ghost"
        style={{ padding: '4px 6px', fontSize: '16px', lineHeight: 1, fontWeight: 400 }}
        onClick={() => setOpen(o => !o)}
        title="Add asset or liability"
      >
        +
      </button>
      {open && (
        <div className="txn-filter-dropdown" style={{ left: 'auto', right: 0, minWidth: '140px' }}>
          <div className="txn-filter-option" onClick={() => { setOpen(false); onAddAsset() }}>
            Add asset
          </div>
          <div className="txn-filter-option" onClick={() => { setOpen(false); onAddLiability() }}>
            Add liability
          </div>
        </div>
      )}
    </div>
  )
}

// ── Equity row ────────────────────────────────────────────────────────────────
// The top-level row in each type section. Name comes from the primary asset
// (or from the liability if standalone). Expanded by default.

function EquityRow({
  name, color, equity, expanded, onToggle,
  assetValue, linkedLiabilities,
  asset, liability,       // asset xor liability (for standalone rows)
  onEditAsset, onDeleteAsset,
  onEditLiability, onDeleteLiability,
}) {
  const navigate    = useNavigate()
  const hasChildren = !!(asset || (linkedLiabilities && linkedLiabilities.length > 0) || liability)
  const isNegative  = equity < 0

  // Build more-menu for the equity row itself
  const moreItems = asset
    ? [
        { label: 'Edit asset', onClick: () => onEditAsset(asset) },
        { label: 'Delete asset', danger: true, onClick: () => onDeleteAsset(asset.id) },
      ]
    : liability
    ? [
        { label: 'Edit liability', onClick: () => onEditLiability(liability) },
        { label: 'Delete liability', danger: true, onClick: () => onDeleteLiability(liability.id) },
      ]
    : []

  return (
    <>
      {/* Equity (parent) row */}
      <div className="acct-tbl-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <DotBtn color={color} expandable={hasChildren} expanded={expanded} onClick={onToggle} />
          <div style={{ minWidth: 0 }}>
            <span className="budget-cat-name">{name}</span>
          </div>
        </div>
        <div style={{
          textAlign: 'right', fontSize: '13px', fontWeight: 700,
          color: isNegative ? 'var(--red)' : 'var(--green)',
        }}>
          {isNegative ? '-' : ''}{formatCurrency(Math.abs(equity))}
        </div>
        <RowMoreMenu items={moreItems} />
      </div>

      {/* Children — only shown when expanded */}
      {expanded && (
        <>
          {/* Asset child row */}
          {asset && (
            <div className="acct-tbl-row" style={{ paddingLeft: '3rem', background: 'var(--bg-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <DotBtn color={color} expandable={false} />
                <div style={{ minWidth: 0 }}>
                  <span className="budget-cat-name">{asset.name}</span>
                  {asset.notes && <div className="budget-cat-sub">{asset.notes}</div>}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>
                {formatCurrency(asset.value)}
              </div>
              <RowMoreMenu items={[
                { label: 'Edit', onClick: () => onEditAsset(asset) },
                { label: 'Delete', danger: true, onClick: () => onDeleteAsset(asset.id) },
              ]} />
            </div>
          )}

          {/* Linked liability child rows */}
          {linkedLiabilities && linkedLiabilities.map(liab => (
            <div key={liab.id} className="acct-tbl-row" style={{ paddingLeft: '3rem', background: 'var(--bg-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <DotBtn color={LIABILITY_COLORS[liab.type] || '#888'} expandable={false} />
                <div
                  style={{ minWidth: 0, cursor: 'pointer' }}
                  onClick={() => navigate('/liabilities', { state: { selectId: liab.id } })}
                >
                  <span className="budget-cat-name" style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {liab.name}
                    <ExternalLink size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
                  </span>
                  <div className="budget-cat-sub">
                    {liab.type}{liab.interest_rate ? ` · ${(liab.interest_rate * 100).toFixed(2)}% APR` : ''}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: 'var(--red)' }}>
                -{formatCurrency(currentBal(liab))}
              </div>
              <RowMoreMenu items={[
                { label: 'Edit', onClick: () => onEditLiability(liab) },
                { label: 'Delete', danger: true, onClick: () => onDeleteLiability(liab.id) },
              ]} />
            </div>
          ))}

          {/* Standalone liability child (no asset) */}
          {liability && !asset && (
            <div className="acct-tbl-row" style={{ paddingLeft: '3rem', background: 'var(--bg-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <DotBtn color={LIABILITY_COLORS[liability.type] || '#888'} expandable={false} />
                <div
                  style={{ minWidth: 0, cursor: 'pointer' }}
                  onClick={() => navigate('/liabilities', { state: { selectId: liability.id } })}
                >
                  <span className="budget-cat-name" style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {liability.name}
                    <ExternalLink size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
                  </span>
                  {liability.notes && <div className="budget-cat-sub">{liability.notes}</div>}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: 'var(--red)' }}>
                -{formatCurrency(currentBal(liability))}
              </div>
              <RowMoreMenu items={[
                { label: 'Edit', onClick: () => onEditLiability(liability) },
                { label: 'Delete', danger: true, onClick: () => onDeleteLiability(liability.id) },
              ]} />
            </div>
          )}
        </>
      )}
    </>
  )
}

// ── Asset type section ────────────────────────────────────────────────────────

function AssetTypeSection({
  type, assets, linkedLiabMap, standaloneLiabs,
  expandedRows, onToggle,
  onEditAsset, onDeleteAsset,
  onEditLiability, onDeleteLiability,
  onAdd,
}) {
  const color = typeColor(type)

  // Build equity rows: one per asset (with linked liabilities), then standalone liabilities of this type
  const equityRows = []

  for (const asset of assets) {
    const linked = linkedLiabMap[asset.id] || []
    const totalLiab = linked.reduce((s, l) => s + currentBal(l), 0)
    const equity    = asset.value - totalLiab
    equityRows.push({
      key:      `asset-${asset.id}`,
      name:     asset.name,
      color,
      equity,
      asset,
      linkedLiabilities: linked,
      liability: null,
    })
  }

  for (const liab of standaloneLiabs) {
    const equity = -currentBal(liab)
    equityRows.push({
      key:      `liab-${liab.id}`,
      name:     liab.name,
      color:    LIABILITY_COLORS[liab.type] || '#888',
      equity,
      asset:    null,
      linkedLiabilities: [],
      liability: liab,
    })
  }

  const totalEquity = equityRows.reduce((s, r) => s + r.equity, 0)

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      {/* Type header — name + color dot only, no total (moved to footer) */}
      <div className="asset-type-header">
        <div className="asset-type-header-left">
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
          {type}
        </div>
      </div>

      {equityRows.length === 0 ? (
        <div className="card" style={{ border: '1px dashed var(--border)', background: 'transparent', padding: '14px 1.5rem' }}>
          <p className="muted" style={{ fontSize: '13px' }}>
            No {type} entries yet.{' '}
            <button className="btn-link" onClick={() => onAdd(type, 'asset')}>Add one</button>
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, '--dt-cols': 'minmax(0,1fr) minmax(100px,130px) 36px' }}>
          {/* Column headers */}
          <div className="acct-tbl-header">
            <span className="col-header-label">Equity</span>
            <span className="col-header-label" style={{ justifyContent: 'flex-end' }}>Value</span>
            <div />
          </div>

          {/* Equity rows */}
          {equityRows.map(row => (
            <EquityRow
              key={row.key}
              name={row.name}
              color={row.color}
              equity={row.equity}
              expanded={expandedRows.has(row.key)}
              onToggle={() => onToggle(row.key)}
              asset={row.asset}
              linkedLiabilities={row.linkedLiabilities}
              liability={row.liability}
              onEditAsset={onEditAsset}
              onDeleteAsset={onDeleteAsset}
              onEditLiability={onEditLiability}
              onDeleteLiability={onDeleteLiability}
            />
          ))}

          {/* Footer: Total Equity + Add button */}
          <div className="tbl-footer-row">
            <span className="footer-label">Total Equity</span>
            <span
              className="footer-value"
              style={{
                textAlign: 'right',
                color: totalEquity >= 0 ? 'var(--green)' : 'var(--red)',
              }}
            >
              {totalEquity < 0 ? '-' : ''}{formatCurrency(Math.abs(totalEquity))}
            </span>
            <FooterAddButton
              onAddAsset={() => onAdd(type, 'asset')}
              onAddLiability={() => onAdd(type, 'liability')}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add type input ────────────────────────────────────────────────────────────

function AddTypeInput({ onAdd, onCancel }) {
  const [value, setValue] = useState('')
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  const commit = () => { const name = value.trim(); if (name) onAdd(name); else onCancel() }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem' }}>
      <input
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel() }}
        placeholder="Asset type name (e.g. Art Collection)"
        style={{ flex: 1, padding: '6px 10px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '13px' }}
      />
      <button className="btn-primary" style={{ padding: '6px 14px', fontSize: '13px' }} onClick={commit}>Add</button>
      <button className="btn-ghost" style={{ padding: '6px 10px', fontSize: '13px' }} onClick={onCancel}>Cancel</button>
    </div>
  )
}

// ── Asset modal ───────────────────────────────────────────────────────────────

function AssetModal({ initial, defaultType, allTypes, onClose, onSave, loading }) {
  const [form, setForm] = useState(initial || { name: '', type: defaultType || allTypes[0] || '', value: '', notes: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">{initial ? 'Edit asset' : 'Add asset'}</h3>
        <form
          onSubmit={e => { e.preventDefault(); onSave({ ...form, value: parseFloat(form.value) }) }}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div className="form-group">
            <label>Asset name</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Primary residence" required autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group">
              <label>Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}>
                {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Current value ($)</label>
              <input type="number" value={form.value} onChange={e => set('value', e.target.value)} placeholder="0.00" step="0.01" min="0" required />
            </div>
          </div>
          <div className="form-group">
            <label>Notes (optional)</label>
            <input type="text" value={form.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Any extra details..." />
          </div>
          <div className="modal-btns">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Add dropdown (header button) ──────────────────────────────────────────────

function AddDropdown({ onAddAsset, onAddLiability, onAddType }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn-primary" onClick={() => setOpen(o => !o)}>+ Add ▾</button>
      {open && (
        <div className="txn-filter-dropdown" style={{ right: 0, left: 'auto', minWidth: '170px' }}>
          <div className="txn-filter-option" onClick={() => { setOpen(false); onAddAsset() }}>Add asset</div>
          <div className="txn-filter-option" onClick={() => { setOpen(false); onAddLiability() }}>Add liability</div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <div className="txn-filter-option" onClick={() => { setOpen(false); onAddType() }}>Add asset type</div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Assets() {
  const [showAssetModal,     setShowAssetModal]     = useState(false)
  const [showLiabilityModal, setShowLiabilityModal] = useState(false)
  const [editingAsset,       setEditingAsset]       = useState(null)
  const [editingLiability,   setEditingLiability]   = useState(null)
  const [defaultAssetType,   setDefaultAssetType]   = useState(null)
  const [defaultLiabType,    setDefaultLiabType]    = useState(null)
  const [customTypes,        setCustomTypes]        = useState([])
  const [addingType,         setAddingType]         = useState(false)
  // All equity rows start expanded
  const [expandedRows, setExpandedRows] = useState(() => new Set(['__all__']))

  const { data: assets      = [], isLoading: aLoading } = useAssets()
  const { data: liabilities = [], isLoading: lLoading } = useLiabilities()
  const createAsset     = useCreateAsset()
  const updateAsset     = useUpdateAsset()
  const deleteAsset     = useDeleteAsset()
  const createLiability = useCreateLiability()
  const updateLiability = useUpdateLiability()
  const deleteLiability = useDeleteLiability()

  if (aLoading || lLoading) return <div className="loading">Loading...</div>

  // Build lookup maps
  const linkedLiabMap = {}
  const standaloneLiabs = []
  for (const l of liabilities) {
    if (l.asset_id) {
      linkedLiabMap[l.asset_id] = linkedLiabMap[l.asset_id] || []
      linkedLiabMap[l.asset_id].push(l)
    } else {
      standaloneLiabs.push(l)
    }
  }

  // Metrics
  const totalAssets      = assets.reduce((s, a) => s + a.value, 0)
  const totalLiabilities = liabilities.reduce((s, l) => s + currentBal(l), 0)
  const totalEquity      = totalAssets - totalLiabilities

  // All asset types (default + in-use + custom)
  const assetTypesInUse = [...new Set(assets.map(a => a.type))]
  const allAssetTypes   = [
    ...DEFAULT_ASSET_TYPES,
    ...assetTypesInUse.filter(t => !DEFAULT_ASSET_TYPES.includes(t)),
    ...customTypes.filter(t => !DEFAULT_ASSET_TYPES.includes(t) && !assetTypesInUse.includes(t)),
  ]

  // Types that have at least one asset or custom entry
  const liabTypesInUse = [...new Set(standaloneLiabs.map(l => l.type))]

  // Build per-type sections: combine asset types with standalone liability types
  const allSectionTypes = [
    ...allAssetTypes,
    ...liabTypesInUse.filter(t => !allAssetTypes.includes(t)),
  ]

  const assetsByType   = allSectionTypes.reduce((acc, t) => ({ ...acc, [t]: assets.filter(a => a.type === t) }), {})
  const standLiabsByType = allSectionTypes.reduce((acc, t) => ({ ...acc, [t]: standaloneLiabs.filter(l => l.type === t) }), {})

  // Only show types that have at least one entry
  const visibleTypes = allSectionTypes.filter(t =>
    (assetsByType[t]?.length > 0) ||
    (standLiabsByType[t]?.length > 0) ||
    customTypes.includes(t)
  )

  // Row key is either "asset-{id}" or "liab-{id}"
  const isExpanded = (key) => {
    // If the magic __all__ sentinel is present, all rows are expanded
    if (expandedRows.has('__all__')) return true
    return expandedRows.has(key)
  }

  const toggleRow = (key) => {
    setExpandedRows(prev => {
      // On first toggle, materialise all keys explicitly
      if (prev.has('__all__')) {
        const allKeys = new Set()
        for (const a of assets)      allKeys.add(`asset-${a.id}`)
        for (const l of liabilities) allKeys.add(`liab-${l.id}`)
        allKeys.delete(key) // collapse the toggled one
        return allKeys
      }
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // ── Modal handlers ──────────────────────────────────────────────────────────

  // onAdd is called from footer + buttons with (type, 'asset' | 'liability')
  const handleAdd = (type, kind) => {
    if (kind === 'asset') {
      setDefaultAssetType(type)
      setEditingAsset(null)
      setShowAssetModal(true)
    } else {
      setDefaultLiabType(type)
      setEditingLiability(null)
      setShowLiabilityModal(true)
    }
  }

  const handleAddType = (name) => {
    if (!customTypes.includes(name) && !DEFAULT_ASSET_TYPES.includes(name))
      setCustomTypes(t => [...t, name])
    setAddingType(false)
  }

  const handleSaveAsset = async (form) => {
    try {
      if (editingAsset) await updateAsset.mutateAsync({ id: editingAsset.id, data: form })
      else               await createAsset.mutateAsync(form)
      if (!editingAsset) setCustomTypes(t => t.filter(x => x !== form.type))
      setShowAssetModal(false); setEditingAsset(null); setDefaultAssetType(null)
    } catch (e) { console.error(e) }
  }

  const handleDeleteAsset = async (id) => {
    const linked = linkedLiabMap[id]?.length || 0
    const msg = linked
      ? `Delete this asset? Its ${linked} linked liabilit${linked > 1 ? 'ies' : 'y'} will be unlinked.`
      : 'Delete this asset? Its snapshot history will be removed.'
    if (!window.confirm(msg)) return
    await deleteAsset.mutateAsync(id)
  }

  const handleSaveLiability = async (form) => {
    try {
      if (editingLiability) await updateLiability.mutateAsync({ id: editingLiability.id, data: form })
      else                   await createLiability.mutateAsync(form)
      setShowLiabilityModal(false); setEditingLiability(null); setDefaultLiabType(null)
    } catch (e) { console.error(e) }
  }

  const handleDeleteLiability = async (id) => {
    if (!window.confirm('Delete this liability? Its balance history will be removed.')) return
    await deleteLiability.mutateAsync(id)
  }

  const openEditAsset     = (a) => { setEditingAsset(a);     setDefaultAssetType(null); setShowAssetModal(true) }
  const openEditLiability = (l) => { setEditingLiability(l); setDefaultLiabType(null);  setShowLiabilityModal(true) }

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Assets &amp; Liabilities</h1>
        </div>
        <AddDropdown
          onAddAsset={() => handleAdd(visibleTypes[0] || DEFAULT_ASSET_TYPES[0], 'asset')}
          onAddLiability={() => { setDefaultLiabType(null); setEditingLiability(null); setShowLiabilityModal(true) }}
          onAddType={() => setAddingType(true)}
        />
      </div>

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.75rem' }}>
        <div className="card metric-card">
          <div className="metric-label">Total Equity</div>
          <div className="metric-value" style={{ color: totalEquity >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {totalEquity < 0 ? '-' : ''}{formatCurrency(Math.abs(totalEquity))}
          </div>
          <div className="metric-sub">assets − liabilities</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Total Assets</div>
          <div className="metric-value">{formatCurrency(totalAssets)}</div>
          <div className="metric-sub">{assets.length} asset{assets.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Total Liabilities</div>
          <div className="metric-value down">-{formatCurrency(totalLiabilities)}</div>
          <div className="metric-sub">{liabilities.length} liabilit{liabilities.length !== 1 ? 'ies' : 'y'}</div>
        </div>
      </div>

      {addingType && <AddTypeInput onAdd={handleAddType} onCancel={() => setAddingType(false)} />}

      {visibleTypes.length === 0 && !addingType ? (
        <div className="card">
          <p className="muted" style={{ fontSize: '13px' }}>
            No assets or liabilities yet. Use "+ Add" to get started.
          </p>
        </div>
      ) : (
        visibleTypes.map(type => (
          <AssetTypeSection
            key={type}
            type={type}
            assets={assetsByType[type] || []}
            linkedLiabMap={linkedLiabMap}
            standaloneLiabs={standLiabsByType[type] || []}
            expandedRows={{ has: isExpanded }}
            onToggle={toggleRow}
            onEditAsset={openEditAsset}
            onDeleteAsset={handleDeleteAsset}
            onEditLiability={openEditLiability}
            onDeleteLiability={handleDeleteLiability}
            onAdd={handleAdd}
          />
        ))
      )}

      {/* Modals */}
      {showAssetModal && (
        <AssetModal
          initial={editingAsset}
          defaultType={defaultAssetType}
          allTypes={allAssetTypes.length > 0 ? allAssetTypes : DEFAULT_ASSET_TYPES}
          onClose={() => { setShowAssetModal(false); setEditingAsset(null); setDefaultAssetType(null) }}
          onSave={handleSaveAsset}
          loading={createAsset.isPending || updateAsset.isPending}
        />
      )}
      {showLiabilityModal && (
        <LiabilityModal
          initial={editingLiability}
          defaultType={defaultLiabType}
          assets={assets}
          categories={[]}
          onClose={() => { setShowLiabilityModal(false); setEditingLiability(null); setDefaultLiabType(null) }}
          onSave={handleSaveLiability}
          loading={createLiability.isPending || updateLiability.isPending}
        />
      )}
    </div>
  )
}