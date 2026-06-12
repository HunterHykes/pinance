import { useState, useRef, useEffect } from 'react'
import { Trash2, RefreshCw, MoreVertical, AlertTriangle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useBudget } from '../hooks/useBudget'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import {
  getCategoryMap, getPlaidCategories,
  saveCategoryMap, applyCategoryMap, deleteCategoryMap,
  loadDefaultTemplate, deleteUserAccount, purgeUserData,
  getPlaidSettings, savePlaidSettings, getPlaidCostEstimate, getPlaidUsage,
  getPlaidItems, syncPlaid,
} from '../api'
import TreeSelect from '../components/TreeSelect'
import { resolveColor } from '../utils'
import { useInstitutionPrefs, useSaveInstitutionPref } from '../hooks/useAccountPrefs'
import api from '../api'

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useCategoryMap() {
  return useQuery({ queryKey: ['category-map'], queryFn: () => getCategoryMap().then(r => r.data) })
}
function usePlaidCategories() {
  return useQuery({ queryKey: ['plaid-categories'], queryFn: () => getPlaidCategories().then(r => r.data) })
}
function useSaveCategoryMap() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: saveCategoryMap, onSuccess: () => qc.invalidateQueries({ queryKey: ['category-map'] }) })
}
function useApplyCategoryMap() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: applyCategoryMap, onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }) })
}
function useDeleteCategoryMap() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: deleteCategoryMap, onSuccess: () => qc.invalidateQueries({ queryKey: ['category-map'] }) })
}
function useLoadDefaultTemplate() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: loadDefaultTemplate, onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-template'] }) })
}
function usePlaidSettingsQuery() {
  return useQuery({ queryKey: ['plaid-settings'], queryFn: () => getPlaidSettings().then(r => r.data) })
}
function useSavePlaidSettings() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: savePlaidSettings, onSuccess: () => qc.invalidateQueries({ queryKey: ['plaid-settings'] }) })
}
function usePlaidUsage(month) {
  return useQuery({ queryKey: ['plaid-usage', month], queryFn: () => getPlaidUsage(month).then(r => r.data) })
}

// ── Password confirmation modal ───────────────────────────────────────────────

function PasswordConfirmModal({ title, description, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!password) { setError('Password is required.'); return }
    setLoading(true)
    setError(null)
    try {
      await onConfirm(password)
    } catch (err) {
      setError(err?.response?.data?.error || 'Incorrect password.')
      setLoading(false)
    }
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: '380px' }}>
        <h3 className="modal-title">{title}</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '16px' }}>
          {description}
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="form-group">
            <label>Enter your password to confirm</label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null) }}
              placeholder="Password"
              autoFocus
              autoComplete="current-password"
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <div className="modal-btns">
            <button type="button" className="btn-ghost" onClick={onCancel} disabled={loading}>Cancel</button>
            <button
              type="submit"
              className={danger ? 'btn-danger' : 'btn-primary'}
              disabled={loading || !password}
              style={danger ? { background: 'var(--red)', color: '#fff' } : {}}
            >
              {loading ? 'Verifying...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Category mapping row ──────────────────────────────────────────────────────

function MappingRow({ plaidCat, txCount, existingMapping, budgetCategories, onSave, onApply, onDelete, isDetailed = false }) {
  const [selected,    setSelected]    = useState(existingMapping?.budget_category || '')
  const [applyRetro,  setApplyRetro]  = useState(false)
  const [applying,    setApplying]    = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)

  const isDirty    = selected !== (existingMapping?.budget_category || '')
  const selectedCat = budgetCategories.find(c => c.category === selected)
  const dotColor   = selectedCat ? resolveColor(selectedCat, budgetCategories) : 'var(--border)'

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await onSave({ plaid_category: plaidCat, budget_category: selected })
      if (applyRetro) {
        setApplying(true)
        await onApply({ plaid_category: plaidCat, budget_category: selected })
        setApplying(false)
      }
      setApplyRetro(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  const displayCat = isDetailed ? plaidCat.split('_').slice(-2).join('_') : plaidCat

  return (
    <div className="budget-row-full" style={{ paddingLeft: isDetailed ? '3rem' : '1.5rem' }}>
      <div className="budget-row-left">
        <div className="budget-dot-btn" style={{ background: dotColor, cursor: 'default', flexShrink: 0 }} />
        <div>
          <div className="budget-cat-name mapping-plaid-name">{displayCat}</div>
          {txCount > 0 && <div className="budget-cat-sub">{txCount} transaction{txCount !== 1 ? 's' : ''}</div>}
        </div>
      </div>
      <div className="budget-row-right" style={{ gap: '10px' }}>
        <div style={{ width: '20px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {existingMapping && (
            <button className="btn-icon-remove" onClick={() => onDelete(existingMapping.id)} title="Remove mapping">
              <span style={{ fontSize: '16px', lineHeight: 1 }}>−</span>
            </button>
          )}
        </div>
        <div style={{ minWidth: '280px' }}>
          <TreeSelect value={selected} onChange={setSelected} categories={budgetCategories} placeholder="Select category" selectableParents={true} />
        </div>
        <label className="mapping-retro-label">
          <input type="checkbox" checked={applyRetro} onChange={e => setApplyRetro(e.target.checked)} disabled={!selected} />
          Apply retroactively
        </label>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={!selected || saving || applying || (!isDirty && !saved)}
          style={{ whiteSpace: 'nowrap', width: '80px', transition: 'background 0.4s', ...(saved ? { background: 'var(--green)' } : {}) }}
        >
          {applying ? 'Applying...' : saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Sync schedule ─────────────────────────────────────────────────────────────

const FREQ_LABELS = {
  daily:        'Daily',
  twice_weekly: 'Twice weekly',
  weekly:       'Weekly',
  biweekly:     'Bi-weekly',
  monthly:      'Monthly',
  never:        'Never',
}

// ── Shared frequency picker ──────────────────────────────────────────────────
// Used by both the global SyncSettings and per-institution settings.
// `value` is the currently active frequency string.
// `pending` is the locally-selected-but-unsaved value (null = none pending).
// `onSelect` is called with the new frequency string.
// `globalLabel` — when set, prepends a "Global (X)" button representing
//   "use global setting" (for per-institution use only).

function FrequencyPicker({ value, pending, onSelect, frequencies, globalLabel = null }) {
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {globalLabel && (
        <button
          className={(!pending && !value) ? 'btn-range-active' : 'btn-range'}
          style={value && !pending ? { opacity: 0.55 } : {}}
          onClick={() => onSelect(null)}
          title="Use the global sync schedule"
        >
          {globalLabel}
        </button>
      )}
      {frequencies.map(f => {
        const isCurrent  = f.value === (value || '')
        const isSelected = pending !== undefined
          ? (pending ? f.value === pending : isCurrent)
          : isCurrent
        return (
          <button
            key={f.value}
            className={isSelected ? 'btn-range-active' : 'btn-range'}
            style={isCurrent && pending ? { background: 'transparent', color: 'var(--accent)', borderColor: 'var(--accent)', opacity: 0.55 } : {}}
            onClick={() => onSelect(f.value)}
          >
            {f.label}
          </button>
        )
      })}
    </div>
  )
}

function fmtDateTime(iso) {
  if (!iso) return 'Never'
  return new Date(iso.includes('T') ? iso : iso + ' UTC').toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ── Unified sync table ────────────────────────────────────────────────────────
// One card, one table. Global row at top, one row per institution below.
// Footer shows heartbeat. Password gate on global changes only.

const ALL_FREQS = Object.entries(FREQ_LABELS).map(([value, label]) => ({ value, label }))

function SyncTable() {
  const { data: settings, isLoading: loadingSettings } = usePlaidSettingsQuery()
  const { data: instPrefs = {} }  = useInstitutionPrefs()
  const { data: items = [] } = useQuery({
    queryKey: ['plaid-items'],
    queryFn:  () => getPlaidItems().then(r => r.data),
  })
  const saveSettings = useSavePlaidSettings()
  const saveInstPref = useSaveInstitutionPref()

  // Per-row pending state: key = 'global' | institution name
  const [pending,         setPending]         = useState({})
  const [showPassConfirm, setShowPassConfirm] = useState(false)
  const [loadingEst,      setLoadingEst]      = useState(false)
  const [costEst,         setCostEst]         = useState(null)
  const [syncingKey,      setSyncingKey]      = useState(null)
  const [menuOpen,        setMenuOpen]        = useState(null)
  const [syncConfirm,     setSyncConfirm]     = useState(null) // { key, label, cost }
  const menuRef = useRef(null)
  const qc      = useQueryClient()

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  if (loadingSettings) {
    return (
      <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
        <div style={{ height: '13px', width: '200px', background: 'var(--border)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
    )
  }

  const globalFreq = settings?.sync_frequency || 'weekly'
  const lastSync   = settings?.last_sync       || null
  const lastSyncType = settings?.last_sync_type || null
  const heartbeat  = settings?.last_heartbeat  || null

  const hasPending = Object.keys(pending).length > 0

  const handleSelect = async (key, freq) => {
    // Deselect if clicking the already-active value
    const current = key === 'global' ? globalFreq : (instPrefs[key]?.sync_frequency || null)
    if (freq === current || (freq === null && !current)) {
      setPending(p => { const n = { ...p }; delete n[key]; return n })
      return
    }
    setPending(p => ({ ...p, [key]: freq }))

    // Load cost estimate for global changes
    if (key === 'global' && freq !== 'never' && freq !== null) {
      setLoadingEst(true)
      try {
        const [cur, next] = await Promise.all([
          getPlaidCostEstimate(globalFreq).then(r => r.data),
          getPlaidCostEstimate(freq).then(r => r.data),
        ])
        setCostEst({ current: cur, next })
      } catch (_) {}
      setLoadingEst(false)
    } else {
      setCostEst(null)
    }
  }

  const handleCancel = (key) => {
    setPending(p => { const n = { ...p }; delete n[key]; return n })
    if (key === 'global') setCostEst(null)
  }

  const handleSave = (key) => {
    if (key === 'global') {
      setShowPassConfirm(true)
    } else {
      commitInstSave(key)
    }
  }

  const commitInstSave = async (key) => {
    await saveInstPref.mutateAsync({
      institution: key,
      data: { ...instPrefs[key], sync_frequency: pending[key] },
    })
    setPending(p => { const n = { ...p }; delete n[key]; return n })
  }

  const commitGlobalSave = async (password) => {
    await saveSettings.mutateAsync({ sync_frequency: pending['global'], password })
    setShowPassConfirm(false)
    setPending(p => { const n = { ...p }; delete n['global']; return n })
    setCostEst(null)
  }

  const fmtSync = (isoStr) => {
    if (!isoStr) return <span style={{ color: 'var(--text-tertiary)' }}>Never</span>
    return <span>{fmtDateTime(isoStr)}</span>
  }

  // Cost diff line for global row
  const costLine = () => {
    const pFreq = pending['global']
    if (!pFreq || pFreq === 'never') return pFreq === 'never'
      ? <span style={{ color: 'var(--amber)', fontSize: '11px' }}>Automatic sync disabled — manual only</span>
      : null
    if (loadingEst) return (
      <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> calculating...
      </span>
    )
    if (!costEst) return null
    const diff = costEst.next.total - costEst.current.total
    const diffColor = diff > 0 ? 'var(--amber)' : diff < 0 ? 'var(--green)' : 'var(--text-tertiary)'
    return (
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
        Est. <strong style={{ color: costEst.next.total > 10 ? 'var(--amber)' : 'var(--green)' }}>
          ${costEst.next.total.toFixed(2)}/mo
        </strong>
        {' '}
        <span style={{ color: diffColor }}>
          ({diff === 0 ? 'no change' : `${diff > 0 ? '+' : '−'}$${Math.abs(diff).toFixed(2)}`})
        </span>
      </span>
    )
  }

  const COST_PER_INST = 0.22 // $0.12 refresh + $0.10 balance

  const handleSyncNow = (key) => {
    setMenuOpen(null)
    if (key === 'global') {
      const totalCost = (items.length * COST_PER_INST).toFixed(2)
      setSyncConfirm({
        key,
        label: 'all institutions',
        count: items.length,
        cost:  totalCost,
        isAll: true,
      })
    } else {
      setSyncConfirm({
        key,
        label: key,
        count: 1,
        cost:  COST_PER_INST.toFixed(2),
        isAll: false,
      })
    }
  }

  const commitSync = async () => {
    const key = syncConfirm?.key
    setSyncConfirm(null)
    setSyncingKey(key)
    try {
      await syncPlaid()
      qc.invalidateQueries({ queryKey: ['plaid-items'] })
      qc.invalidateQueries({ queryKey: ['plaid-settings'] })
    } catch (_) {}
    setSyncingKey(null)
  }

  // All rows: global + one per institution
  const rows = [
    {
      key:         'global',
      label:       'Default',
      current:     globalFreq,
      lastSync,
      lastSyncType,
      isGlobal:    true,
      color:       null,
    },
    ...items.map(item => {
      const inst  = item.institution || 'Unknown'
      const pref  = instPrefs[inst]  || {}
      return {
        key:         inst,
        label:       inst,
        current:     pref.sync_frequency || null,
        lastSync:    item.last_synced    || null,
        lastSyncType: null,
        isGlobal:    false,
        color:       pref.color || null,
        itemId:      item.id,
      }
    }),
  ]

  // cols: institution | last sync | default | schedule | actions
  const COLS = '1fr minmax(160px, max-content) 80px 2fr 36px'

  return (
    <>
      <div className="card" style={{ padding: 0, '--dt-cols': COLS }}>

        {/* Header */}
        <div className="acct-tbl-header">
          <span className="col-header-label">Institution</span>
          <span className="col-header-label">Last sync</span>
          <div />
          <span className="col-header-label">Schedule</span>
          <div />
        </div>

        {/* Rows */}
        {rows.map((row, i) => {
          const rowPending   = pending[row.key]
          const isDirty      = rowPending !== undefined
          const override     = row.current     // institution's own setting (null = use global)
          const effectiveFreq = row.isGlobal
            ? globalFreq
            : (override || globalFreq)
          const isMenuOpen   = menuOpen === row.key
          const isSyncing    = syncingKey === row.key

          return (
            <div key={row.key} className="acct-tbl-row"
              style={{
                gridTemplateColumns: COLS,
                borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
                background: row.isGlobal ? 'var(--bg-group)' : undefined,
              }}>

              {/* Institution name + color dot */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {!row.isGlobal && (
                  <span style={{
                    width: 9, height: 9, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                    background: row.color || 'var(--text-tertiary)',
                  }} />
                )}
                <span style={{ fontSize: '13px', fontWeight: row.isGlobal ? 600 : 500 }}>{row.label}</span>
              </div>

              {/* Last sync */}
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {fmtSync(row.lastSync, row.lastSyncType)}
                {row.isGlobal && isDirty && (
                  <div style={{ marginTop: '4px' }}>{costLine()}</div>
                )}
              </div>

              {/* Default pill — institution rows only, own column so schedule pills align */}
              <div>
                {!row.isGlobal && (
                  <button
                    className={(!override && !isDirty) || (isDirty && rowPending === null) ? 'btn-range-active' : 'btn-range'}
                    onClick={() => handleSelect(row.key, null)}
                    title={`Use default (${FREQ_LABELS[globalFreq]})`}
                  >
                    Default
                  </button>
                )}
              </div>

              {/* Schedule pills + save/cancel */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {ALL_FREQS.map(f => {
                    const activeCurrent = row.isGlobal ? globalFreq : (override || '')
                    const isCurrent     = f.value === activeCurrent
                    const isSelected    = isDirty ? f.value === rowPending : isCurrent
                    return (
                      <button
                        key={f.value}
                        className={isSelected ? 'btn-range-active' : 'btn-range'}
                        style={isCurrent && isDirty ? { background: 'transparent', color: 'var(--accent)', borderColor: 'var(--accent)', opacity: 0.55 } : {}}
                        onClick={() => handleSelect(row.key, f.value)}
                      >
                        {f.label}
                      </button>
                    )
                  })}
                </div>
                {isDirty && (
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button className="btn-ghost" style={{ fontSize: '12px', padding: '3px 10px' }}
                      onClick={() => handleCancel(row.key)}>Cancel</button>
                    <button className="btn-primary" style={{ fontSize: '12px', padding: '3px 12px' }}
                      onClick={() => handleSave(row.key)}
                      disabled={saveSettings.isPending || saveInstPref.isPending}>
                      Save
                    </button>
                  </div>
                )}
              </div>

              {/* Actions menu — rightmost column */}
              <div style={{ position: 'relative', justifySelf: 'end' }}
                   ref={isMenuOpen ? menuRef : null}>
                <button className="btn-ghost" style={{ padding: '3px 5px' }}
                  onClick={() => setMenuOpen(isMenuOpen ? null : row.key)}>
                  <MoreVertical size={14} />
                </button>
                {isMenuOpen && (
                  <div className="txn-filter-dropdown" style={{ right: 0, left: 'auto', minWidth: '130px' }}>
                    {row.isGlobal ? (
                      <div className={`txn-filter-option${isSyncing ? ' disabled' : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
                        onClick={() => !isSyncing && handleSyncNow('global')}>
                        <RefreshCw size={12} className={isSyncing ? 'spin' : ''} />
                        {isSyncing ? 'Syncing...' : 'Sync all'}
                      </div>
                    ) : (
                      <div className={`txn-filter-option${isSyncing ? ' disabled' : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
                        onClick={() => !isSyncing && handleSyncNow(row.key)}>
                        <RefreshCw size={12} className={isSyncing ? 'spin' : ''} />
                        {isSyncing ? 'Syncing...' : 'Sync now'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Footer — heartbeat */}
        <div className="tbl-footer-row" style={{ gridTemplateColumns: COLS }}>
          <span className="footer-label">Heartbeat</span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', gridColumn: '2 / 6' }}>
            {fmtDateTime(heartbeat)}
          </span>
        </div>
      </div>

      {syncConfirm && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setSyncConfirm(null)}>
          <div className="modal" style={{ maxWidth: '380px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <AlertTriangle size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
              <h3 className="modal-title" style={{ margin: 0 }}>
                {syncConfirm.isAll ? 'Sync all?' : 'Sync now?'}
              </h3>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {syncConfirm.isAll
                ? <>Manually syncing <strong style={{ color: 'var(--text)' }}>all {syncConfirm.count} institution{syncConfirm.count !== 1 ? 's' : ''}</strong> will fetch current balances and new transactions. This incurs a Plaid API charge per institution.</>
                : <>Manually syncing <strong style={{ color: 'var(--text)' }}>{syncConfirm.label}</strong> will fetch current balances and new transactions. This incurs a Plaid API charge.</>
              }
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '6px' }}>
              Estimated cost:{' '}
              <strong style={{ color: 'var(--text-secondary)' }}>~${syncConfirm.cost}</strong>
              {syncConfirm.isAll
                ? <> ({syncConfirm.count} × $0.22 per institution)</>
                : <> ($0.12 refresh + $0.10 balance)</>
              }
            </p>
            <div className="modal-btns">
              <button className="btn-ghost" onClick={() => setSyncConfirm(null)}
                disabled={!!syncingKey}>Cancel</button>
              <button className="btn-primary" onClick={commitSync}
                disabled={!!syncingKey}>
                {syncingKey ? 'Syncing...' : syncConfirm.isAll ? 'Sync all' : 'Sync now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPassConfirm && (
        <PasswordConfirmModal
          title="Confirm schedule change"
          description={`Changing default sync frequency to ${FREQ_LABELS[pending['global']]}. This affects estimated Plaid costs. Enter your password to confirm.`}
          confirmLabel="Save schedule"
          onConfirm={commitGlobalSave}
          onCancel={() => setShowPassConfirm(false)}
        />
      )}
    </>
  )
}

// ── Plaid usage ───────────────────────────────────────────────────────────────

function UsageSection() {
  const month = new Date().toISOString().slice(0, 7)
  const { data: usage, isLoading } = usePlaidUsage(month)

  const CALL_LABELS = {
    transactions_refresh: 'Transaction refreshes',
    balance:              'Balance checks',
  }

  if (isLoading || !usage) return null

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
        Usage — {new Date(month + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {usage.rows.length === 0 && usage.account_count === 0 ? (
          <p className="muted" style={{ fontSize: '13px', padding: '1rem 1.5rem' }}>No usage recorded this month.</p>
        ) : (
          <>
            <div className="account-row-full">
              <div className="account-row-left">
                <div>
                  <div className="account-name">Account subscriptions</div>
                  <div className="account-sub">{usage.account_count} connected account{usage.account_count !== 1 ? 's' : ''} × $0.30/mo</div>
                </div>
              </div>
              <div className="account-row-right">
                <div style={{ fontSize: '13px', fontWeight: 600 }}>${usage.subscription_cost.toFixed(2)}</div>
              </div>
            </div>
            {usage.rows.map(row => (
              <div key={row.call_type} className="account-row-full">
                <div className="account-row-left">
                  <div>
                    <div className="account-name">{CALL_LABELS[row.call_type] || row.call_type}</div>
                    <div className="account-sub">{row.call_count} call{row.call_count !== 1 ? 's' : ''}</div>
                  </div>
                </div>
                <div className="account-row-right">
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>${row.estimated_cost.toFixed(2)}</div>
                </div>
              </div>
            ))}
            <div className="account-row-full" style={{ background: 'var(--bg-secondary)' }}>
              <div className="account-row-left">
                <div className="account-name" style={{ fontWeight: 600 }}>Estimated total</div>
              </div>
              <div className="account-row-right">
                <div style={{ fontSize: '14px', fontWeight: 700, color: usage.total > 10 ? 'var(--amber)' : 'var(--text)' }}>
                  ${usage.total.toFixed(2)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Plaid tab ─────────────────────────────────────────────────────────────────

function PlaidTab() {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: '10px' }}>Sync schedule & usage</div>
      <SyncTable />
      <UsageSection />
    </div>
  )
}

// ── Budget tab ────────────────────────────────────────────────────────────────

function BudgetTab() {
  const { data: plaidCats = [], isLoading: loadingCats } = usePlaidCategories()
  const { data: mappings  = [], isLoading: loadingMaps } = useCategoryMap()
  const { data: budget    = [] }                         = useBudget({})

  const [rowsOpen, setRowsOpen] = useState(false)

  const saveMap      = useSaveCategoryMap()
  const applyMap     = useApplyCategoryMap()
  const deleteMap    = useDeleteCategoryMap()
  const loadDefaults = useLoadDefaultTemplate()

  const mappingIndex = mappings.reduce((acc, m) => { acc[m.plaid_category] = m; return acc }, {})

  if (loadingCats || loadingMaps) return <div className="loading" style={{ height: '120px' }}>Loading...</div>

  return (
    <div>
      {/* Default template */}
      <div className="section-label" style={{ marginBottom: '10px' }}>Budget template</div>
      <div className="card" style={{ marginBottom: '1.75rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '16px', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '13px', fontWeight: 500 }}>Load default categories</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Populates your budget template with a standard set of categories. Existing categories are preserved.
          </div>
        </div>
        <button
          className="btn-ghost"
          onClick={() => { if (!window.confirm('Load default budget categories? Existing categories will be kept.')) return; loadDefaults.mutate() }}
          disabled={loadDefaults.isPending}
        >
          {loadDefaults.isPending ? 'Loading...' : '↓ Load defaults'}
        </button>
      </div>

      {/* Category mappings */}
      <div className="section-label" style={{ marginBottom: '10px' }}>Plaid category mappings</div>
      <div className="card" style={{ padding: '0' }}>
        <div style={{ padding: '1rem 1.5rem', borderBottom: rowsOpen ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {plaidCats.length > 0 && (
            <button
              className="budget-dot-btn budget-dot-btn--expandable"
              style={{ background: 'var(--text-tertiary)', flexShrink: 0 }}
              onClick={() => setRowsOpen(o => !o)}
            >
              <svg className={'dot-chevron' + (rowsOpen ? ' dot-chevron--open' : '')} width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1.5 3L4 5.5L6.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, flex: 1 }}>
            Map Plaid's transaction categories to your budget categories. New synced transactions will use these mappings automatically.
            Use "Apply retroactively" to update existing transactions when saving a rule.
          </p>
        </div>
        {rowsOpen && (
          plaidCats.length === 0 ? (
            <p className="muted" style={{ fontSize: '13px', padding: '1.25rem 1.5rem' }}>
              No Plaid transactions synced yet. Connect a bank account to get started.
            </p>
          ) : (
            plaidCats.map(({ plaid_category, transaction_count }) => {
              const isDetailed = plaidCats.some(
                other => other.plaid_category !== plaid_category &&
                         plaid_category.startsWith(other.plaid_category + '_')
              )
              return (
                <MappingRow
                  key={plaid_category}
                  plaidCat={plaid_category}
                  txCount={transaction_count}
                  existingMapping={mappingIndex[plaid_category] || null}
                  budgetCategories={budget}
                  onSave={saveMap.mutateAsync}
                  onApply={applyMap.mutateAsync}
                  onDelete={deleteMap.mutateAsync}
                  isDetailed={isDetailed}
                />
              )
            })
          )
        )}
      </div>
    </div>
  )
}

// ── Account tab ───────────────────────────────────────────────────────────────

function AccountTab() {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()

  // ── Purge state ──────────────────────────────────────────────────────────
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false)
  const [purgeLoading,     setPurgeLoading]     = useState(false)
  const [purgeError,       setPurgeError]       = useState(null)
  const [purgeDone,        setPurgeDone]        = useState(false)
  const qc = useQueryClient()

  const handlePurge = async (password) => {
    setPurgeLoading(true)
    setPurgeError(null)
    try {
      await purgeUserData({ password })
      setShowPurgeConfirm(false)
      setPurgeDone(true)
      // Invalidate everything
      qc.clear()
    } catch (err) {
      throw err  // let PasswordConfirmModal handle the error display
    } finally {
      setPurgeLoading(false)
    }
  }

  // ── Delete state ─────────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleDelete = async (password) => {
    await deleteUserAccount({ password })
    logout()
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

      {/* Purge data */}
      <div>
        <div className="section-label" style={{ marginBottom: '10px' }}>Data management</div>
        <div className="card">
          {purgeDone ? (
            <div style={{ fontSize: '13px', color: 'var(--green)' }}>
              ✓ Data purged successfully. Your account is reset to its default state.
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>Purge data</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', maxWidth: '480px' }}>
                  Removes all accounts, transactions, budgets, mappings, and Plaid connections. Your username and password are retained.
                  Useful for resetting to a clean state during development.
                </div>
              </div>
              <button className="btn-danger" onClick={() => setShowPurgeConfirm(true)}>
                Purge data
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Delete account */}
      <div>
        <div className="section-label" style={{ marginBottom: '10px', color: 'var(--red)' }}>Danger zone</div>
        <div className="card" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500 }}>Delete account</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Permanently deletes your account and all data. This cannot be undone.
              </div>
            </div>
            <button className="btn-danger" onClick={() => setShowDeleteConfirm(true)}>
              Delete account
            </button>
          </div>
        </div>
      </div>

      {showPurgeConfirm && (
        <PasswordConfirmModal
          title="Purge all data?"
          description="This will permanently remove all accounts, transactions, budgets, category mappings, and Plaid connections. Your username and password will be kept. This cannot be undone."
          confirmLabel="Purge data"
          danger
          onConfirm={handlePurge}
          onCancel={() => setShowPurgeConfirm(false)}
        />
      )}

      {showDeleteConfirm && (
        <PasswordConfirmModal
          title="Delete account?"
          description="This will permanently delete your account and all associated data. You will be logged out and cannot recover this account."
          confirmLabel="Delete account"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}

// ── Vertical tab sidebar ──────────────────────────────────────────────────────

const TABS = [
  { id: 'budget',  label: 'Budget'  },
  { id: 'plaid',   label: 'Plaid'   },
  { id: 'account', label: 'Account' },
]

// ── Main Settings page ────────────────────────────────────────────────────────

function Settings() {
  document.title = 'Pinance | Settings'
  const [activeTab, setActiveTab] = useState('budget')

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Manage preferences and account data</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '1.5rem', alignItems: 'start' }}>

        {/* Vertical tab sidebar */}
        <div className="card" style={{ padding: '6px' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                fontFamily: 'inherit',
                fontSize: '13px',
                fontWeight: activeTab === tab.id ? 600 : 400,
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                cursor: 'pointer',
                background: activeTab === tab.id ? 'var(--bg-secondary)' : 'transparent',
                color: activeTab === tab.id ? 'var(--text)' : 'var(--text-secondary)',
                transition: 'background 0.12s, color 0.12s',
                marginBottom: '2px',
              }}
              onMouseEnter={e => { if (activeTab !== tab.id) { e.currentTarget.style.background = 'var(--bg-secondary)'; e.currentTarget.style.color = 'var(--text)' } }}
              onMouseLeave={e => { if (activeTab !== tab.id) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === 'plaid'   && <PlaidTab   />}
          {activeTab === 'budget'  && <BudgetTab  />}
          {activeTab === 'account' && <AccountTab />}
        </div>
      </div>
    </div>
  )
}

export default Settings