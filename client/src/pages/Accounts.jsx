import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { Pencil, Trash2, RefreshCw, Building2, AlertTriangle, MoreVertical, ChevronRight, ExternalLink, EyeOff } from 'lucide-react'
import DataTable, { buildGridTemplate, TableFooterRow } from '../components/DataTable'
import { usePlaidLink } from 'react-plaid-link'
import { useAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount } from '../hooks/useAccounts'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getLinkToken, exchangeToken, syncPlaid, getPlaidItems, disconnectPlaidItem } from '../api'
import { formatCurrency } from '../utils'
import { useAccountPrefs, useSaveAccountPref, useInstitutionPrefs, useSaveInstitutionPref, useAccountSnapshots, useSaveAccountSnapshot, useDeleteAccountSnapshot } from '../hooks/useAccountPrefs'
import ColorPicker from '../components/ColorPicker'
import { CurrencyInput } from '../components/FormControls'
const ACCOUNT_TYPES = ['Checking', 'Savings', 'Investment', 'Retirement', 'Credit card', 'Other']

// Default colors per account type — used when no custom color is set
const ACCOUNT_COLORS = {
  'Checking':    '#3b82f6',
  'Savings':     '#22c55e',
  'Investment':  '#8b5cf6',
  'Retirement':  '#06b6d4',
  'Credit card': '#ef4444',
  'Loan':        '#f97316',
  'Other':       '#888888',
}

const defaultForm = {
  name:        '',
  type:        'Checking',
  subtype:     '',
  institution: '',
  balance:     '',
}

// ── Account edit modal (prefs: display name, color, URL, hidden) ──────────────
// Used for both Plaid and manual accounts. Manual accounts also show
// balance/type/institution fields and historical snapshot entry.

function AccountEditModal({ account, pref = {}, onClose, onSavePref, onSaveAccount, onSaveSnapshot, onDeleteSnapshot, loading }) {
  const [displayName, setDisplayName] = useState(pref.display_name || '')
  const [isHidden,    setIsHidden]    = useState(!!pref.is_hidden)

  // Manual account fields
  const [name,        setName]        = useState(account.name)
  const [type,        setType]        = useState(account.type)
  const [institution, setInstitution] = useState(account.institution || '')
  const [balance,     setBalance]     = useState(String(account.balance))

  // Historical snapshot entry
  const [snapDate,    setSnapDate]    = useState('')
  const [snapBalance, setSnapBalance] = useState('')
  const [snapSaving,  setSnapSaving]  = useState(false)

  const { data: snapshots = [] } = useAccountSnapshots(account.id)

  const handleSubmit = async (e) => {
    e.preventDefault()
    await onSavePref({
      line_style:   pref.line_style || 'solid',
      display_name: displayName.trim() || null,
      is_hidden:    isHidden,
    })
    if (!!account.is_manual) {
      await onSaveAccount({ name, type, institution, balance: parseFloat(balance) })
    }
    onClose()
  }

  const handleAddSnapshot = async () => {
    if (!snapDate || snapBalance === '') return
    setSnapSaving(true)
    try {
      await onSaveSnapshot({ accountId: account.id, date: snapDate, balance: parseFloat(snapBalance) })
      setSnapDate('')
      setSnapBalance('')
    } finally { setSnapSaving(false) }
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '500px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <h3 className="modal-title" style={{ flexShrink: 0 }}>
          Edit account
          <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: '10px' }}>
            {!!account.is_manual ? 'Manual' : 'Plaid'}
          </span>
        </h3>

        <div style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'none' }}>
          <form id="acct-edit-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

            <div className="modal-section-header">Display</div>
            <div className="modal-section">
              <div className="form-group">
                <label>Display name <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional — overrides Plaid name)</span></label>
                <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                  placeholder={account.name} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                <input type="checkbox" checked={isHidden} onChange={e => setIsHidden(e.target.checked)}
                  style={{ width: 'auto', accentColor: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Hide from charts</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '1px' }}>
                    Excludes this account from the net worth chart
                  </div>
                </div>
              </label>
            </div>

            {!!account.is_manual && (
              <>
                <div className="modal-section-header">Account details</div>
                <div className="modal-section">
                  <div className="form-group">
                    <label>Account name</label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)} required />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group">
                      <label>Type</label>
                      <select value={type} onChange={e => setType(e.target.value)}>
                        {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Current balance ($)</label>
                      <CurrencyInput value={balance} onChange={setBalance} required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Institution <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span></label>
                    <input type="text" value={institution} onChange={e => setInstitution(e.target.value)} />
                  </div>
                </div>

                <div className="modal-section-header">Balance history</div>
                <div className="modal-section">
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Add past balances to populate the net worth chart retroactively.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'end', marginBottom: '12px' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '11px' }}>Date</label>
                      <input type="date" value={snapDate} onChange={e => setSnapDate(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '11px' }}>Balance ($)</label>
                      <CurrencyInput value={snapBalance} onChange={setSnapBalance} placeholder="0.00" />
                    </div>
                    <button type="button" className="btn-primary" style={{ fontSize: '12px', padding: '7px 12px' }}
                      onClick={handleAddSnapshot} disabled={!snapDate || snapBalance === '' || snapSaving}>
                      {snapSaving ? '...' : 'Add'}
                    </button>
                  </div>
                  {snapshots.length > 0 ? (
                    <div style={{ maxHeight: '160px', overflowY: 'auto', scrollbarWidth: 'none' }}>
                      {snapshots.map(s => (
                        <div key={s.date} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: '12px' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{s.date}</span>
                          <span style={{ fontWeight: 500 }}>{formatCurrency(s.balance)}</span>
                          <button type="button" className="btn-danger" style={{ fontSize: '11px', padding: '2px 6px' }}
                            onClick={() => onDeleteSnapshot({ accountId: account.id, date: s.date })}>×</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ fontSize: '12px' }}>No historical entries yet.</p>
                  )}
                </div>
              </>
            )}
          </form>
        </div>

        <div className="modal-btns" style={{ flexShrink: 0, paddingTop: '14px', borderTop: '1px solid var(--border)', marginTop: '4px' }}>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="acct-edit-form" className="btn-primary" disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Institution edit modal ────────────────────────────────────────────────────

const SYNC_FREQUENCIES = [
  { value: 'daily',        label: 'Daily'       },
  { value: 'twice_weekly', label: 'Twice weekly' },
  { value: 'weekly',       label: 'Weekly'       },
  { value: 'biweekly',     label: 'Bi-weekly'    },
  { value: 'monthly',      label: 'Monthly'      },
  { value: 'never',        label: 'Never'        },
]

function InstitutionEditModal({ institution, instPref = {}, accounts = [], onClose, onSave, loading }) {
  const [color,         setColor]         = useState(instPref.color          || null)
  const [url,           setUrl]           = useState(instPref.url            || '')
  const [syncFrequency, setSyncFrequency] = useState(instPref.sync_frequency || null)
  const [pendingFreq,   setPendingFreq]   = useState(undefined) // tracks unsaved selection

  const handleFreqSelect = (freq) => {
    setPendingFreq(freq)
    setSyncFrequency(freq)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    await onSave({
      color:          color          || null,
      url:            url.trim()     || null,
      sync_frequency: syncFrequency  || null,
    })
    onClose()
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '460px' }}>
        <h3 className="modal-title">{institution}</h3>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          <div className="form-group">
            <label>Color</label>
            <ColorPicker value={color} onChange={setColor} />
            {!color && (
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Defaults to type color —</span>
                <span style={{ display: 'flex', gap: '4px' }}>
                  {[...new Set(accounts.map(a => a.type))].map(t => (
                    <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: ACCOUNT_COLORS[t] || '#888', display: 'inline-block' }} />
                      {t}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Bank URL <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span></label>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://www.usaa.com" />
          </div>

          <div className="form-group">
            <label>
              Sync frequency
              <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: '6px' }}>
                (overrides global setting)
              </span>
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
              <button
                type="button"
                className={!syncFrequency ? 'btn-range-active' : 'btn-range'}
                onClick={() => handleFreqSelect(null)}
              >
                Global
              </button>
              {SYNC_FREQUENCIES.map(f => (
                <button
                  type="button"
                  key={f.value}
                  className={syncFrequency === f.value ? 'btn-range-active' : 'btn-range'}
                  onClick={() => handleFreqSelect(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {!syncFrequency && (
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px' }}>
                Using the global schedule set in Settings
              </div>
            )}
          </div>

          <div className="modal-btns">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


// ── Plaid hooks ───────────────────────────────────────────────────────────────

function usePlaidItems() {
  return useQuery({
    queryKey: ['plaid-items'],
    queryFn:  () => getPlaidItems().then(res => res.data),
  })
}

function useSyncPlaid() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: syncPlaid,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['plaid-items'] })
      queryClient.invalidateQueries({ queryKey: ['plaid-usage'] })
    },
  })
}

// ── Sync confirmation modal ───────────────────────────────────────────────────

function SyncConfirmModal({ item, onConfirm, onCancel, syncing }) {
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: '380px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <AlertTriangle size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          <h3 className="modal-title" style={{ margin: 0 }}>Sync now?</h3>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Manually syncing <strong style={{ color: 'var(--text)' }}>{item.institution || 'this institution'}</strong> will
          fetch current balances and new transactions. This incurs a Plaid API charge.
        </p>
        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '6px' }}>
          Estimated cost: <strong style={{ color: 'var(--text-secondary)' }}>~$0.22</strong> per institution
          ($0.12 refresh + $0.10 balance)
        </p>
        <div className="modal-btns">
          <button className="btn-ghost" onClick={onCancel} disabled={syncing}>Cancel</button>
          <button className="btn-primary" onClick={onConfirm} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync now'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Account dropdown (Connect via Plaid or add manually) ─────────────────

function AddAccountDropdown({ onAddManual }) {
  const queryClient                   = useQueryClient()
  const [open, setOpen]               = useState(false)
  const [linkToken, setLinkToken]     = useState(null)
  const [fetching, setFetching]       = useState(false)
  const [error, setError]             = useState(null)
  const [autoOpened, setAutoOpened]   = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const onPlaidSuccess = useCallback(async (publicToken, metadata) => {
    try {
      await exchangeToken({
        public_token:     publicToken,
        institution_name: metadata?.institution?.name || null,
      })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['plaid-items'] })
    } catch (err) {
      console.error('Token exchange failed', err)
    }
  }, [queryClient])

  const { open: openPlaid, ready } = usePlaidLink({
    token:     linkToken,
    onSuccess: onPlaidSuccess,
    onExit:    () => setLinkToken(null),
  })

  if (linkToken && ready && !autoOpened) {
    setAutoOpened(true)
    openPlaid()
  }

  const handleConnectAccount = async () => {
    setOpen(false)
    if (linkToken && ready) { openPlaid(); return }
    setFetching(true)
    setError(null)
    try {
      const res = await getLinkToken()
      setLinkToken(res.data.link_token)
    } catch (err) {
      setError('Failed to start Plaid Link')
      console.error(err)
    } finally {
      setFetching(false)
    }
  }

  const handleAddManual = () => {
    setOpen(false)
    onAddManual()
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn-primary" onClick={() => setOpen(o => !o)} disabled={fetching}>
        {fetching ? 'Connecting...' : '+ Add Account'}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none"
          style={{ marginLeft: '6px', opacity: 0.8 }}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="txn-filter-dropdown" style={{ left: 'auto', right: 0 }}>
          <div className="txn-filter-option" onClick={handleConnectAccount}>Connect Account</div>
          <div className="txn-filter-option" onClick={handleAddManual}>Add Manually</div>
        </div>
      )}
      {error && (
        <span style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          fontSize: '11px', color: 'var(--red)', whiteSpace: 'nowrap' }}>
          {error}
        </span>
      )}
    </div>
  )
}

// ── Connected institutions section ────────────────────────────────────────────

function PlaidItemRow({ item, onSync, onDisconnect, syncing, accounts = [], balance = 0 }) {
  const [showConfirm, setShowConfirm]           = useState(false)
  const [showDisconnect, setShowDisconnect]      = useState(false)
  const { open: menuOpen, setOpen: setMenuOpen, toggle: toggleMenu, btnRef: menuRef, dropRef: menuDropRef, pos: menuPos } = useFixedMenu()

  const lastSynced = item.last_synced
    ? new Date(item.last_synced).toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : 'Never'

  const isLiability = balance < 0
  return (
    <>
      <div className="acct-tbl-row acct-group-row">
        {/* Cols 1-3: institution name + subtext */}
        <div style={{ gridColumn: '1 / 4', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.institution || 'Unknown institution'}
            </div>
            <div className="account-sub">Last synced: {lastSynced}</div>
          </div>
        </div>
        {/* Col 4 (source): Plaid badge */}
        <div>
          <span className="badge-synced">Plaid</span>
        </div>
        {/* Col 5 (balance) */}
        <div className={`account-bal${isLiability ? ' down' : ''}`} style={{ textAlign: 'right' }}>
          {isLiability ? '-' : ''}{formatCurrency(Math.abs(balance))}
        </div>
        {/* Col 6 (actions) */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
          <button ref={menuRef} className="btn-ghost" style={{ padding: '4px 6px' }}
            onClick={toggleMenu} title="More options">
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div ref={menuDropRef} className="txn-filter-dropdown"
              style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, left: 'auto' }}>
              <div className={`txn-filter-option${syncing ? ' disabled' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
                onClick={() => { if (!syncing) { setMenuOpen(false); setShowConfirm(true) } }}>
                <RefreshCw size={12} className={syncing ? 'spin' : ''} />
                {syncing ? 'Syncing...' : 'Sync now'}
              </div>
              <div className="txn-filter-option" style={{ color: 'var(--red)' }}
                onClick={() => { setMenuOpen(false); setShowDisconnect(true) }}>
                Disconnect from Plaid
              </div>
            </div>
          )}
        </div>
      </div>
      {showConfirm && (
        <SyncConfirmModal
          item={item}
          onConfirm={() => { setShowConfirm(false); onSync(item.id) }}
          onCancel={() => setShowConfirm(false)}
          syncing={syncing}
        />
      )}
      {showDisconnect && (
        <DisconnectConfirmModal
          name={item.institution}
          accounts={accounts}
          onConfirm={(opts) => { setShowDisconnect(false); onDisconnect(item.id, opts) }}
          onCancel={() => setShowDisconnect(false)}
        />
      )}
    </>
  )
}

// ── Account modal ─────────────────────────────────────────────────────────────

function AccountModal({ initial, onClose, onSave, loading }) {
  const [form, setForm] = useState(initial || defaultForm)
  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({ ...form, balance: parseFloat(form.balance) })
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">{initial ? 'Edit account' : 'Add account'}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Account name</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Chase Checking" required />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select value={form.type} onChange={e => set('type', e.target.value)}>
              {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Institution (optional)</label>
            <input type="text" value={form.institution} onChange={e => set('institution', e.target.value)} placeholder="e.g. Chase" />
          </div>
          <div className="form-group">
            <label>Current balance ($)</label>
            <CurrencyInput value={form.balance} onChange={v => set('balance', v)} placeholder="0.00" required />
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

// ── Disconnect confirmation modal ─────────────────────────────────────────────

function DisconnectConfirmModal({ name, accounts = [], onConfirm, onCancel }) {
  const [action,   setAction]   = useState('keep_manual')
  const [targetId, setTargetId] = useState('')

  const otherAccounts = accounts.filter(a => a.institution !== name)

  const radioStyle = (val) => ({
    display: 'flex', gap: '10px', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
    border: `1px solid ${action === val ? 'var(--accent)' : 'var(--border)'}`,
    background: action === val ? 'rgba(59,130,246,0.06)' : 'transparent',
    cursor: 'pointer', marginBottom: '6px',
  })

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: '460px' }}>
        <h3 className="modal-title">Disconnect {name || 'institution'}?</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
          Plaid syncing will stop. Choose what to do with the associated transactions:
        </p>

        <div style={{ marginBottom: '16px' }}>
          <label style={radioStyle('keep_manual')}>
            <input type="radio" name="dc_action" value="keep_manual" checked={action === 'keep_manual'}
              onChange={() => setAction('keep_manual')} style={{ marginTop: '2px', flexShrink: 0, width: 'auto' }} />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>Keep as manual accounts</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                Each connected account converts to a manual account. All transactions and history are preserved.
              </div>
            </div>
          </label>

          <label style={radioStyle('move_to_account')}>
            <input type="radio" name="dc_action" value="move_to_account" checked={action === 'move_to_account'}
              onChange={() => setAction('move_to_account')} style={{ marginTop: '2px', flexShrink: 0, width: 'auto' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>Move transactions to another account</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5, marginBottom: action === 'move_to_account' ? '8px' : 0 }}>
                Consolidate all transactions from this institution into a single existing account.
              </div>
              {action === 'move_to_account' && (
                <div className="form-group" style={{ margin: 0 }}>
                  <select value={targetId} onChange={e => setTargetId(e.target.value)} style={{ fontSize: '12px' }}>
                    <option value="">Select target account…</option>
                    {otherAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}{a.institution ? ` — ${a.institution}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </label>

          <label style={radioStyle('delete_transactions')}>
            <input type="radio" name="dc_action" value="delete_transactions" checked={action === 'delete_transactions'}
              onChange={() => setAction('delete_transactions')} style={{ marginTop: '2px', flexShrink: 0, width: 'auto' }} />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px', color: 'var(--red)' }}>Delete all transactions</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                Permanently removes all transactions from this institution. This cannot be undone.
              </div>
            </div>
          </label>
        </div>

        <div className="modal-btns">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-danger"
            style={{ background: 'var(--red)', color: '#fff', border: 'none' }}
            disabled={action === 'move_to_account' && !targetId}
            onClick={() => onConfirm({ action, target_account_id: targetId || undefined })}>
            Disconnect
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delete account modal ───────────────────────────────────────────────────────

function DeleteAccountModal({ account, accounts = [], onConfirm, onCancel }) {
  const [action,   setAction]   = useState('move_to_account')
  const [targetId, setTargetId] = useState('')

  const otherAccounts = accounts.filter(a => a.id !== account.id)

  const radioStyle = (val) => ({
    display: 'flex', gap: '10px', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
    border: `1px solid ${action === val ? 'var(--accent)' : 'var(--border)'}`,
    background: action === val ? 'rgba(59,130,246,0.06)' : 'transparent',
    cursor: 'pointer', marginBottom: '6px',
  })

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: '460px' }}>
        <h3 className="modal-title">Delete "{account.name}"?</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
          This account has transactions. Choose what to do with them:
        </p>

        <div style={{ marginBottom: '16px' }}>
          <label style={radioStyle('move_to_account')}>
            <input type="radio" name="del_action" value="move_to_account" checked={action === 'move_to_account'}
              onChange={() => setAction('move_to_account')} style={{ marginTop: '2px', flexShrink: 0, width: 'auto' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>Move transactions to another account</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5, marginBottom: action === 'move_to_account' ? '8px' : 0 }}>
                Transactions are reassigned to the selected account. The original source is recorded for reference.
              </div>
              {action === 'move_to_account' && (
                <div className="form-group" style={{ margin: 0 }}>
                  <select value={targetId} onChange={e => setTargetId(e.target.value)} style={{ fontSize: '12px' }}>
                    <option value="">Select target account…</option>
                    {otherAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}{a.institution ? ` — ${a.institution}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </label>

          <label style={radioStyle('delete_transactions')}>
            <input type="radio" name="del_action" value="delete_transactions" checked={action === 'delete_transactions'}
              onChange={() => setAction('delete_transactions')} style={{ marginTop: '2px', flexShrink: 0, width: 'auto' }} />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px', color: 'var(--red)' }}>Delete all transactions</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                Permanently removes all transactions from this account. This cannot be undone.
              </div>
            </div>
          </label>
        </div>

        <div className="modal-btns">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-danger"
            style={{ background: 'var(--red)', color: '#fff', border: 'none' }}
            disabled={action === 'move_to_account' && !targetId}
            onClick={() => onConfirm({ action, target_account_id: targetId || undefined })}>
            Delete Account
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Account more menu ─────────────────────────────────────────────────────────

function AccountMoreMenu({ account, onEdit, onDelete }) {
  const { open, setOpen, toggle, btnRef, dropRef, pos } = useFixedMenu()

  return (
    <div style={{ flexShrink: 0 }}>
      <button ref={btnRef} className="btn-ghost" style={{ padding: '4px 6px' }}
        onClick={toggle} title="More options">
        <MoreVertical size={14} />
      </button>
      {open && (
        <div ref={dropRef} className="txn-filter-dropdown"
          style={{ position: 'fixed', top: pos.top, right: pos.right, left: 'auto' }}>
          <div className="txn-filter-option"
            onClick={() => { setOpen(false); onEdit(account) }}>
            Edit
          </div>
          {!!account.is_manual && (
            <div className="txn-filter-option" style={{ color: 'var(--red)' }}
              onClick={() => { setOpen(false); onDelete(account.id) }}>
              Delete
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Account data row ──────────────────────────────────────────────────────────

function AccountDataRow({ account, prefs = {}, instPrefs = {}, onEdit, onDelete, isChild = false, hideInstitution = false }) {
  const instPref   = instPrefs[account.institution] || {}
  const instColor  = instPref.color || ACCOUNT_COLORS[account.type] || '#888'
  const instUrl    = instPref.url   || null
  const isLiability = account.balance < 0
  const pref         = prefs[account.id] || {}
  const displayName  = pref.display_name || account.name
  const isHidden     = !!pref.is_hidden

  return (
    <div className="acct-tbl-row"
      style={{
        ...(isChild ? { background: 'var(--bg-secondary)' } : {}),
        ...(isHidden ? { opacity: 0.45 } : {}),
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0,
        paddingLeft: isChild ? '20px' : 0, overflow: 'hidden' }}>
        {/* Color dot — from institution pref or type default */}
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: instColor || '#888',
          flexShrink: 0, display: 'inline-block',
        }} />
        <span className="account-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName}
        </span>
        {isHidden && (
          <EyeOff size={11} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} title="Hidden from charts" />
        )}
      </div>
      {!hideInstitution && (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {account.institution || '—'}
        </div>
      )}
      <div><span className="account-type-badge">{account.type}</span></div>
      <div>
        {account.is_manual
          ? <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 500 }}>Manual</span>
          : <span className="badge-synced">Plaid</span>
        }
      </div>
      <div className={`account-bal${isLiability ? ' down' : ''}`} style={{ textAlign: 'right' }}>
        {isLiability ? '-' : ''}{formatCurrency(Math.abs(account.balance))}
      </div>
      <AccountMoreMenu account={account} onEdit={onEdit} onDelete={onDelete} />
    </div>
  )
}

// ── Type group header — same grid as data rows ────────────────────────────────

function TypeGroupHeader({ label, count, balance, expanded, onToggle }) {
  const isLiability = balance < 0
  return (
    <div className="acct-tbl-row acct-group-row" style={{ padding: '5px 1.5rem' }} onClick={onToggle}>
      <div style={{ gridColumn: '1 / 5', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ChevronRight size={13} style={{
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform .15s',
          color: 'var(--text-tertiary)', flexShrink: 0,
        }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '13px', lineHeight: 1.3 }}>{label}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.2, marginTop: '2px' }}>
            {count} account{count !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
      <div className={`account-bal${isLiability ? ' down' : ''}`} style={{ textAlign: 'right' }}>
        {isLiability ? '-' : ''}{formatCurrency(Math.abs(balance))}
      </div>
      <div />
    </div>
  )
}

// ── Fixed-position menu hook ──────────────────────────────────────────────────
// Renders the dropdown via position:fixed so it escapes overflow:hidden parents.

function useFixedMenu() {
  const [open, setOpen]   = useState(false)
  const [pos,  setPos]    = useState({ top: 0, right: 0 })
  const btnRef            = useRef(null)
  const dropRef           = useRef(null)

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!btnRef.current?.contains(e.target) && !dropRef.current?.contains(e.target))
        setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return { open, setOpen, toggle, btnRef, dropRef, pos }
}

// ── Institution group header — same grid as data rows ────────────────────────

function InstitutionGroupHeader({
  item, label, count, balance, expanded, onToggle, onSync, onDisconnect, syncing,
  hideInstitution = false, accounts = [], instPref = {}, onEditInstitution,
}) {
  const [showSync,       setShowSync]       = useState(false)
  const [showDisconnect, setShowDisconnect] = useState(false)
  const { open: menuOpen, setOpen: setMenuOpen, toggle: toggleMenu, btnRef: menuRef, dropRef: menuDropRef, pos: menuPos } = useFixedMenu()
  const color = instPref.color || 'var(--text-tertiary)'

  const lastSynced = item?.last_synced
    ? new Date(item.last_synced).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : item ? 'Never' : null

  const isLiability = balance < 0

  const url   = instPref.url   || null

  return (
    <>
      <div className="acct-tbl-row acct-group-row"
           style={{ padding: '5px 1.5rem' }}
           onClick={onToggle}>
        {/* Name + subtext — spans cols 1-2 in institution view, 1-5 in type view */}
        <div style={{ gridColumn: hideInstitution ? '1 / 3' : '1 / 5', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Stacked dot-chevron button — mirrors Bills/Income pattern */}
          <button
            className={'budget-dot-btn budget-dot-btn--expandable'}
            style={{ background: color || 'var(--text-tertiary)', flexShrink: 0 }}
            onClick={e => { e.stopPropagation(); onToggle() }}
          >
            <svg className={'dot-chevron' + (expanded ? ' dot-chevron--open' : '')}
              width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1.5 3L4 5.5L6.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px', lineHeight: 1.3 }}>{label}</span>
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ color: 'var(--text-tertiary)', lineHeight: 0, flexShrink: 0 }}
                  title={url}>
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
            {(count > 0 || lastSynced) && (
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.2, marginTop: '2px' }}>
                {[
                  count > 0 && `${count} account${count !== 1 ? 's' : ''}`,
                  lastSynced && `synced ${lastSynced}`,
                ].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        </div>
        {/* Source badge — col 3 in institution view only */}
        {hideInstitution && (
          <div onClick={e => e.stopPropagation()}>
            {item
              ? <span className="badge-synced">Plaid</span>
              : <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 500 }}>Manual</span>
            }
          </div>
        )}
        {/* Balance — col 4 in institution view, col 5 in type view */}
        <div className={`account-bal${isLiability ? ' down' : ''}`} style={{ textAlign: 'right' }}
             onClick={e => e.stopPropagation()}>
          {count > 0 ? (isLiability ? '-' : '') + formatCurrency(Math.abs(balance)) : '—'}
        </div>
        {/* Three-dot — col 6, aligns with child rows; Sync is inside the menu */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
          <button ref={menuRef} className="btn-ghost" style={{ padding: '4px 6px' }}
            onClick={toggleMenu}>
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div ref={menuDropRef} className="txn-filter-dropdown"
              style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, left: 'auto' }}>
              {onEditInstitution && (
                <div className="txn-filter-option"
                  onClick={() => { setMenuOpen(false); onEditInstitution() }}>
                  Edit institution
                </div>
              )}
              {item && <>
                <div className={`txn-filter-option${syncing ? ' disabled' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
                  onClick={() => { if (!syncing) { setMenuOpen(false); setShowSync(true) } }}>
                  <RefreshCw size={12} className={syncing ? 'spin' : ''} />
                  {syncing ? 'Syncing...' : 'Sync now'}
                </div>
                <div className="txn-filter-option" style={{ color: 'var(--red)' }}
                  onClick={() => { setMenuOpen(false); setShowDisconnect(true) }}>
                  Disconnect from Plaid
                </div>
              </>}
            </div>
          )}
        </div>
      </div>
      {showSync && item && (
        <SyncConfirmModal
          item={item}
          onConfirm={() => { setShowSync(false); onSync(item.id) }}
          onCancel={() => setShowSync(false)}
          syncing={syncing}
        />
      )}
      {showDisconnect && item && (
        <DisconnectConfirmModal
          name={item.institution}
          accounts={accounts}
          onConfirm={(opts) => { setShowDisconnect(false); onDisconnect(item.id, opts) }}
          onCancel={() => setShowDisconnect(false)}
        />
      )}
    </>
  )
}

// ── Type order ────────────────────────────────────────────────────────────────

const TYPE_ORDER = ['Checking', 'Savings', 'Investment', 'Retirement', 'Credit card', 'Loan', 'Other']

// ── Main Accounts page ────────────────────────────────────────────────────────

// ── Column configs for DataTable ─────────────────────────────────────────────

const INSTITUTION_COLS = [
  { key: 'name',    label: 'Account', width: '1fr' },
  { key: 'type',    label: 'Type',    width: '110px', filter: 'checkbox' },
  { key: 'source',  label: 'Source',  width: '80px',  filter: 'checkbox' },
  { key: 'balance', label: 'Balance', width: '110px', sortable: true, align: 'right' },
  { actions: true },
]

const TYPE_COLS = [
  { key: 'name',        label: 'Account',     width: '1fr' },
  { key: 'institution', label: 'Institution', width: '0.6fr', filter: 'checkbox' },
  { key: 'type',        label: 'Type',         width: '110px', filter: 'checkbox' },
  { key: 'source',      label: 'Source',       width: '80px',  filter: 'checkbox' },
  { key: 'balance',     label: 'Balance',      width: '110px', sortable: true, align: 'right' },
  { actions: true },
]

// Same grid widths as TYPE_COLS but institution + type are silent spacers —
// PlaidItemRow spans those columns so they need no header labels.
const PLAID_ITEM_COLS = TYPE_COLS.map(col =>
  (col.key === 'institution' || col.key === 'type')
    ? { key: col.key, width: col.width }
    : col
)

function Accounts() {
  document.title = 'Pinance | Accounts'
  const [showModal,    setShowModal]    = useState(false)
  const [editing,      setEditing]      = useState(null)  // account being edited
  const [showEditPref,  setShowEditPref]  = useState(false)
  const [editingAcct,   setEditingAcct]   = useState(null)
  const [showEditInst,  setShowEditInst]  = useState(false)
  const [editingInst,   setEditingInst]   = useState(null)  // institution name string
  const [syncingId,    setSyncingId]    = useState(null)
  const [collapsed,    setCollapsed]    = useState(new Set())

  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('pinance_accounts_view') || 'institution' }
    catch { return 'institution' }
  })
  const [sortCol, setSortCol] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [filters, setFilters] = useState({ institution: new Set(), type: new Set(), source: new Set() })

  const { data: accounts = [], isLoading } = useAccounts()
  const { data: plaidItems = [] }          = usePlaidItems()
  const { data: prefs = {} }               = useAccountPrefs()
  const { data: instPrefs = {} }           = useInstitutionPrefs()
  const createAccount   = useCreateAccount()
  const updateAccount   = useUpdateAccount()
  const deleteAccount   = useDeleteAccount()
  const syncMutation    = useSyncPlaid()
  const savePref        = useSaveAccountPref()
  const saveInstPref    = useSaveInstitutionPref()
  const saveSnapshot    = useSaveAccountSnapshot()
  const deleteSnapshot  = useDeleteAccountSnapshot()
  const queryClient     = useQueryClient()

  const disconnectMutation = useMutation({
    mutationFn: ({ itemId, opts }) => disconnectPlaidItem(itemId, opts),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['plaid-items'] })
    },
  })

  const handleViewMode = (mode) => {
    setViewMode(mode)
    try { localStorage.setItem('pinance_accounts_view', mode) } catch {}
  }

  // Accepts optional explicit direction for filter popover sort buttons
  const handleSort = (col, dir = null) => {
    if (dir !== null) { setSortCol(col); setSortDir(dir) }
    else if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const handleFilterToggle = (col, value) => {
    setFilters(prev => {
      const current = prev[col]
      let next
      if (current.size === 0) {
        // Currently "show all" — expand to all values then remove the clicked one,
        // so it reads as "deselect this item from an all-checked state"
        next = new Set((uniqueValues[col] || []).filter(v => v !== value))
        // If that leaves nothing (only one value existed), use sentinel to show nothing
        if (next.size === 0) next = new Set(['__none__'])
      } else {
        next = new Set(current)
        if (next.has(value)) next.delete(value); else next.add(value)
      }
      // If every known value is now checked, collapse back to the empty-set shorthand
      const all = uniqueValues[col] || []
      if (all.length > 0 && all.every(v => next.has(v))) next = new Set()
      return { ...prev, [col]: next }
    })
  }
  const handleFilterSelectAll = (col) => {
    setFilters(prev => {
      // If anything is filtered (some unchecked), restore show-all.
      // If already showing all, select none via a sentinel that matches nothing.
      if (prev[col].size === 0) return { ...prev, [col]: new Set(['__none__']) }
      return { ...prev, [col]: new Set() }
    })
  }

  const toggleGroup = (key) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const isExpanded = (key) => !collapsed.has(key)

  const uniqueValues = useMemo(() => ({
    institution: [...new Set(accounts.map(a => a.institution || '—'))].sort(),
    type:        [...new Set(accounts.map(a => a.type))].sort(),
    source:      [...new Set(accounts.map(a => a.is_manual ? 'Manual' : 'Plaid'))].sort(),
  }), [accounts])

  const sortedAccounts = useMemo(() => [...accounts].sort((a, b) => {
    let cmp
    switch (sortCol) {
      case 'institution': cmp = (a.institution || '').localeCompare(b.institution || ''); break
      case 'type':        cmp = a.type.localeCompare(b.type);                             break
      case 'source':      cmp = (a.is_manual ? 1 : 0) - (b.is_manual ? 1 : 0);           break
      case 'balance':     cmp = a.balance - b.balance;                                    break
      default:            cmp = a.name.localeCompare(b.name)
    }
    return sortDir === 'asc' ? cmp : -cmp
  }), [accounts, sortCol, sortDir])

  const filteredAccounts = useMemo(() => sortedAccounts.filter(a => {
    if (filters.institution.size > 0 && !filters.institution.has(a.institution || '—')) return false
    if (filters.type.size > 0        && !filters.type.has(a.type))                      return false
    if (filters.source.size > 0      && !filters.source.has(a.is_manual ? 'Manual' : 'Plaid')) return false
    return true
  }), [sortedAccounts, filters])

  const institutionGroups = useMemo(() => {
    const byItem = {}, manual = [], orphaned = []
    for (const a of filteredAccounts) {
      if (a.is_manual) { manual.push(a); continue }
      const item = plaidItems.find(i => i.institution === a.institution)
      if (item) { if (!byItem[item.id]) byItem[item.id] = []; byItem[item.id].push(a) }
      else orphaned.push(a)
    }
    return [
      ...plaidItems.map(item => ({ key: `plaid-${item.id}`, item, label: item.institution || 'Unknown', accounts: byItem[item.id] || [] })),
      ...(orphaned.length ? [{ key: 'orphaned', item: null, label: 'Other (Plaid)', accounts: orphaned }] : []),
      ...(manual.length   ? [{ key: 'manual',   item: null, label: 'Manual Accounts', accounts: manual }] : []),
    ]
  }, [filteredAccounts, plaidItems])

  const typeGroups = useMemo(() => {
    const map = {}
    for (const a of filteredAccounts) {
      const t = TYPE_ORDER.includes(a.type) ? a.type : 'Other'
      if (!map[t]) map[t] = []
      map[t].push(a)
    }
    return TYPE_ORDER.filter(t => map[t]).map(t => ({ key: t, label: t, accounts: map[t] }))
  }, [filteredAccounts])

  const netWorth = accounts.reduce((s, a) => s + a.balance, 0)
  const assets   = accounts.filter(a => a.balance > 0).reduce((s, a) => s + a.balance, 0)
  const liab     = accounts.filter(a => a.balance < 0).reduce((s, a) => s + a.balance, 0)

  const handleSave = async (form) => {
    try {
      if (editing) await updateAccount.mutateAsync({ id: editing.id, data: form })
      else         await createAccount.mutateAsync(form)
      setShowModal(false); setEditing(null)
    } catch (err) { console.error(err) }
  }

  // Opens the unified edit/prefs modal for any account
  const handleEdit = (account) => { setEditingAcct(account); setShowEditPref(true) }
  // Opens the legacy create modal for new manual accounts only
  const handleNewManual = () => { setEditing(null); setShowModal(true) }
  const [pendingDelete, setPendingDelete] = useState(null)

  const handleDelete = (id) => {
    const account = accounts.find(a => a.id === id)
    if (account) setPendingDelete(account)
  }
  const handleDeleteConfirm = async ({ action, target_account_id }) => {
    await deleteAccount.mutateAsync({ id: pendingDelete.id, data: { action, target_account_id } })
    setPendingDelete(null)
  }
  const handleClose    = () => { setShowModal(false); setEditing(null) }
  const handleClosePref = () => { setShowEditPref(false); setEditingAcct(null) }

  const handleDisconnect = async (account, opts = {}) => {
    const item = plaidItems.find(i => i.institution === account.institution)
    if (!item) return
    try { await disconnectMutation.mutateAsync({ itemId: item.id, opts }) }
    catch (err) { console.error('Disconnect error:', err) }
  }
  const handleDisconnectItem = async (itemId, opts = {}) => {
    try { await disconnectMutation.mutateAsync({ itemId, opts }) }
    catch (err) { console.error('Disconnect error:', err) }
  }
  const handleSync = async (itemId) => {
    setSyncingId(itemId)
    try { await syncMutation.mutateAsync() }
    catch (err) { console.error(err) }
    finally { setSyncingId(null) }
  }

  const handleSavePref = async (prefData) => {
    if (!editingAcct) return
    await savePref.mutateAsync({ id: editingAcct.id, data: prefData })
  }

  const handleEditInstitution = (institution) => {
    setEditingInst(institution)
    setShowEditInst(true)
  }

  const handleSaveInstPref = async (data) => {
    if (!editingInst) return
    await saveInstPref.mutateAsync({ institution: editingInst, data })
  }

  const handleSaveAcctDetails = async (form) => {
    if (!editingAcct) return
    await updateAccount.mutateAsync({ id: editingAcct.id, data: form })
  }

  if (isLoading) return <div className="loading">Loading accounts...</div>

  const empty = accounts.length === 0 && plaidItems.length === 0

  const rowProps = { onEdit: handleEdit, onDelete: handleDelete, prefs, instPrefs }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Accounts</h1>
          {/* <p className="page-sub">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</p> */}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="acct-view-toggle">
            <button className={viewMode === 'institution' ? 'active' : ''}
              onClick={() => handleViewMode('institution')}>By Institution</button>
            <button className={viewMode === 'type' ? 'active' : ''}
              onClick={() => handleViewMode('type')}>By Type</button>
          </div>
          <AddAccountDropdown onAddManual={handleNewManual} />
        </div>
      </div>

      {/* Summary */}
      <div className="grid-4" style={{ marginBottom: '1.75rem' }}>
        <div className="card metric-card">
          <div className="metric-label">Net Worth</div>
          <div className="metric-value">{formatCurrency(netWorth)}</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Total Assets</div>
          <div className="metric-value">{formatCurrency(assets)}</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Total Liabilities</div>
          <div className="metric-value down">{formatCurrency(Math.abs(liab))}</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label">Accounts</div>
          <div className="metric-value">{accounts.length}</div>
        </div>
      </div>

      {/* ── By Institution ─────────────────────────────────────────────────── */}
      {viewMode === 'institution' && (
        empty ? (
          <div className="card">
            <p className="muted" style={{ fontSize: '13px' }}>
              No accounts yet. Connect a bank or add one manually.
            </p>
          </div>
        ) : (
          <DataTable columns={INSTITUTION_COLS}
            sortCol={sortCol} sortDir={sortDir} onSort={handleSort}
            filters={filters} onFilterToggle={handleFilterToggle}
            onFilterSelectAll={handleFilterSelectAll} uniqueValues={uniqueValues}
            footer={
              <TableFooterRow columns={INSTITUTION_COLS} cells={[
                <span className="footer-label">Total</span>,
                null,
                null,
                <span className="footer-value" style={{ color: netWorth >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {formatCurrency(netWorth)}
                </span>,
                null,
              ]} />
            }>
            {institutionGroups.flatMap(group => [
              <InstitutionGroupHeader
                key={`hdr-${group.key}`}
                item={group.item}
                label={group.label}
                count={group.accounts.length}
                balance={group.accounts.reduce((s, a) => s + a.balance, 0)}
                expanded={isExpanded(group.key)}
                onToggle={() => toggleGroup(group.key)}
                onDisconnect={handleDisconnectItem}
                syncing={group.item ? syncingId === group.item.id : false}
                hideInstitution accounts={accounts}
                instPref={instPrefs[group.label] || {}}
                onEditInstitution={group.item ? () => handleEditInstitution(group.label) : null}
              />,
              ...(isExpanded(group.key)
                ? group.accounts.map(a => <AccountDataRow key={a.id} account={a} {...rowProps} isChild hideInstitution />)
                : []),
            ])}
          </DataTable>
        )
      )}

      {/* ── By Type ────────────────────────────────────────────────────────── */}
      {viewMode === 'type' && (
        <>
          {plaidItems.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <DataTable columns={PLAID_ITEM_COLS}
                sortCol={sortCol} sortDir={sortDir} onSort={handleSort}
                filters={filters} onFilterToggle={handleFilterToggle}
                onFilterSelectAll={handleFilterSelectAll} uniqueValues={uniqueValues}>
                {plaidItems.map(item => (
                  <PlaidItemRow key={item.id} item={item}
                    onSync={handleSync} onDisconnect={handleDisconnectItem}
                    syncing={syncingId === item.id} accounts={accounts}
                    balance={accounts.filter(a => a.institution === item.institution).reduce((s, a) => s + a.balance, 0)} />
                ))}
              </DataTable>
            </div>
          )}
          {accounts.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ fontSize: '13px' }}>
                No accounts yet. Connect a bank or add one manually.
              </p>
            </div>
          ) : (
            <DataTable columns={TYPE_COLS}
              sortCol={sortCol} sortDir={sortDir} onSort={handleSort}
              filters={filters} onFilterToggle={handleFilterToggle}
              onFilterSelectAll={handleFilterSelectAll} uniqueValues={uniqueValues}
              footer={
                <TableFooterRow columns={TYPE_COLS} cells={[
                  <span className="footer-label">Total</span>,
                  null,
                  null,
                  null,
                  <span className="footer-value" style={{ color: netWorth >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {formatCurrency(netWorth)}
                  </span>,
                  null,
                ]} />
              }>
              {typeGroups.flatMap(group => [
                <TypeGroupHeader
                  key={`hdr-${group.key}`}
                  label={group.label}
                  count={group.accounts.length}
                  balance={group.accounts.reduce((s, a) => s + a.balance, 0)}
                  expanded={isExpanded(group.key)}
                  onToggle={() => toggleGroup(group.key)}
                />,
                ...(isExpanded(group.key)
                  ? group.accounts.map(a => <AccountDataRow key={a.id} account={a} {...rowProps} isChild />)
                  : []),
              ])}
            </DataTable>
          )}
        </>
      )}

      {showModal && (
        <AccountModal
          initial={editing}
          onClose={handleClose}
          onSave={handleSave}
          loading={createAccount.isPending || updateAccount.isPending}
        />
      )}
      {pendingDelete && (
        <DeleteAccountModal
          account={pendingDelete}
          accounts={accounts}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {showEditInst && editingInst && (
        <InstitutionEditModal
          institution={editingInst}
          instPref={instPrefs[editingInst] || {}}
          accounts={accounts.filter(a => a.institution === editingInst)}
          onClose={() => { setShowEditInst(false); setEditingInst(null) }}
          onSave={handleSaveInstPref}
          loading={saveInstPref.isPending}
        />
      )}

      {showEditPref && editingAcct && (
        <AccountEditModal
          account={editingAcct}
          pref={prefs[editingAcct.id] || {}}
          onClose={handleClosePref}
          onSavePref={handleSavePref}
          onSaveAccount={handleSaveAcctDetails}
          onSaveSnapshot={saveSnapshot.mutateAsync}
          onDeleteSnapshot={deleteSnapshot.mutateAsync}
          loading={savePref.isPending || updateAccount.isPending}
        />
      )}
    </div>
  )
}

export default Accounts