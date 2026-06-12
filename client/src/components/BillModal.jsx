import { useState, useMemo } from 'react'
import { TrendingUp, Scissors } from 'lucide-react'
import TreeSelect from './TreeSelect'
import ColorPicker from './ColorPicker'
import ChangeIntentModal from './ChangeIntentModal'
import { CurrencyInput, DateInput } from './FormControls'
import { formatCurrency } from '../utils'
import { scheduleLabel, occursInMonth, occurrencesPerMonth } from '../scheduleUtils'
import FrequencyPicker, { defaultSchedule } from './FrequencyPicker'

const FREQUENCIES = [
  { value: 'monthly',     label: 'Monthly'     },
  { value: 'quarterly',   label: 'Quarterly'   },
  { value: 'semi_annual', label: 'Semi-annual' },
  { value: 'annual',      label: 'Annual'      },
]

function freqLabel(f) { return FREQUENCIES.find(x => x.value === f)?.label || f }

function chargeMonthly(c) {
  switch (c.frequency) {
    case 'monthly':     return c.amount
    case 'quarterly':   return c.amount / 3
    case 'semi_annual': return c.amount / 6
    case 'annual':      return c.amount / 12
    default:            return c.amount
  }
}

const defaultCharge = (startedOn) => ({
  label: '', amount: '', frequency: 'monthly',
  schedule: defaultSchedule('monthly'),
  anchor_date:    startedOn || new Date().toISOString().slice(0, 10),
  effective_from: startedOn || new Date().toISOString().slice(0, 10),
})

// Schedule table column layout
// Amount | Account | Label | Started On | Frequency | −/+
const SCHED_COLS = 'minmax(120px,130px) minmax(130px,1fr) minmax(130px,1.5fr) minmax(130px,155px) minmax(180px,1fr) 28px'
const SCHED_HDRS = ['Amount', 'Account', 'Label', 'Started On', 'Frequency', '']

const headerStyle = {
  fontSize: '11px', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '.06em',
  color: 'var(--text-tertiary)',
}

// ── ChargeRow ─────────────────────────────────────────────────────────────────

function ChargeRow({ charge, index, isSingle, name, onChange, onRemove, canRemove, started_on, accounts, allCharges }) {
  const [showHist, setShowHist] = useState(false)
  const isExisting = !!charge.id
  const isDirty    = isExisting && charge._dirty
  const set = (field, val) => onChange(index, { ...charge, [field]: val })

  const itemHist = useMemo(() =>
    (!charge.budget_category_id || !allCharges) ? [] :
    allCharges.filter(c => c.budget_category_id === charge.budget_category_id),
    [charge.budget_category_id, allCharges]
  )

  const labelTrimmed = charge.label?.trim() || ''

  return (
    <>
      <div
        className="acct-tbl-row"
        style={{ padding: '5px 0.75rem', alignItems: 'center', background: isDirty ? 'rgba(59,130,246,0.04)' : undefined }}
      >
        {/* Amount */}
        <CurrencyInput value={charge.amount} onChange={v => set('amount', v)} placeholder="0.00" required />
        {/* Account */}
        <select value={charge.account_id || ''} onChange={e => set('account_id', e.target.value || null)} style={{ fontSize: '13px' }}>
          <option value="">—</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {/* Label — grayed when single (pulled from bill name) */}
        {isSingle ? (
          <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', padding: '0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name || '—'}
          </div>
        ) : (
          <input
            type="text"
            value={charge.label}
            onChange={e => set('label', e.target.value)}
            placeholder="Label"
            required
            style={{ fontSize: '13px' }}
          />
        )}
        {/* Started On */}
        <DateInput value={charge.anchor_date || started_on || ''} onChange={v => set('anchor_date', v)} />
        {/* Frequency */}
        <FrequencyPicker
          value={charge.schedule || defaultSchedule(charge.frequency || 'monthly')}
          onChange={s => onChange(index, { ...charge, schedule: s, frequency: s.type })}
          mode="bills"
        />
        {/* −/history */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isExisting && itemHist.length > 1 ? (
            <button type="button" className={`btn-trend${showHist ? ' btn-trend--active' : ''}`}
              onClick={() => setShowHist(h => !h)} title="History">
              <TrendingUp size={12} />
            </button>
          ) : canRemove ? (
            <button type="button"
              onClick={() => onRemove(index)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', padding: '8px 0', fontSize: '18px', lineHeight: 1, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)', transition: 'opacity 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              −
            </button>
          ) : null}
        </div>
      </div>
      {showHist && itemHist.length > 0 && (
        <div style={{ padding: '4px 0.75rem 8px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          {[...itemHist].sort((a, b) => b.effective_from.localeCompare(a.effective_from)).map(c => (
            <div key={c.id} className="sub-history-row">
              <span style={{ color: c.effective_to ? 'var(--text-tertiary)' : 'var(--text)' }}>
                {c.label} — {formatCurrency(c.amount)} / {freqLabel(c.frequency)}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                {new Date(c.effective_from + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {c.effective_to ? ` → ${new Date(c.effective_to + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ' → present'}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── BillModal ─────────────────────────────────────────────────────────────────

export default function BillModal({ initial, categories, accounts, onClose, onSave, loading }) {
  const [name,        setName]        = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || initial?.notes || '')
  const [parentCatId, setParentCatId] = useState(initial?.parent_category_id || null)
  const [color,       setColor]       = useState(initial?.color || null)
  const [accountId,   setAccountId]   = useState(initial?.account_id || '')
  const [status,      setStatus]      = useState(initial?.status || 'active')
  const [billType,    setBillType]    = useState(initial?.bill_type || 'bill')
  const [pauseUntil,  setPauseUntil]  = useState(initial?.pause_until || '')
  const [startedOn,   setStartedOn]   = useState(initial?.started_on || new Date().toISOString().slice(0, 10))

  const initialCharges = initial?.charges?.filter(c => !c.effective_to) || []
  const [activeTab, setActiveTab] = useState(initialCharges.length > 1 ? 'split' : 'details')
  const isSplit = activeTab === 'split'

  const [charges, setCharges] = useState(() =>
    initialCharges.length > 0
      ? initialCharges.map(c => ({ ...c, amount: String(c.amount), _original: { ...c, amount: String(c.amount) } }))
      : [defaultCharge(initial?.started_on)]
  )

  const firstCharge = initialCharges[0]
  const [singleCharge, setSingleCharge] = useState(() => ({
    ...(firstCharge
      ? { ...firstCharge, amount: String(firstCharge.amount), _original: { ...firstCharge, amount: String(firstCharge.amount) } }
      : defaultCharge(initial?.started_on)),
  }))

  const [intentQueue,       setIntentQueue]   = useState(null)
  const [intentIndex,       setIntentIndex]   = useState(0)
  const [resolvedIntents,   setResolved]      = useState([])
  const [pendingForm,       setPendingForm]   = useState(null)

  const parentCats    = categories.filter(c => !c.is_bill)
  const parentCatName = parentCats.find(c => c.id === parentCatId)?.category || ''
  const handleParentChange = (n) => { const cat = parentCats.find(c => c.category === n); setParentCatId(cat?.id || null) }

  // Live conflict: any existing category whose name matches what the user typed,
  // excluding the current bill's own categories and only relevant for new single-charge bills.
  const nameConflict = (!initial && !isSplit)
    ? categories.find(c =>
        c.category.trim().toLowerCase() === name.trim().toLowerCase() &&
        c.bill_id !== (initial?.id ?? -1)
      ) ?? null
    : null

  const handleStartedOnChange = (newDate) => {
    setStartedOn(newDate)
    setSingleCharge(c => ({ ...c, anchor_date: c.anchor_date === startedOn ? newDate : c.anchor_date, effective_from: c.effective_from === startedOn ? newDate : c.effective_from }))
    setCharges(cs => cs.map(c => ({ ...c, anchor_date: c.anchor_date === startedOn ? newDate : c.anchor_date, effective_from: c.effective_from === startedOn ? newDate : c.effective_from })))
  }

  const updateSingle = (i, val) => {
    const updated = { ...val }
    if (singleCharge._original) {
      const o = singleCharge._original
      updated._dirty = String(updated.amount) !== String(o.amount) || updated.frequency !== o.frequency || updated.anchor_date !== o.anchor_date || (updated.account_id || null) !== (o.account_id || null)
    }
    setSingleCharge(updated)
  }

  const updateCharge = (i, val) => setCharges(cs => cs.map((c, idx) => {
    if (idx !== i) return c
    const updated = { ...val }
    if (c._original) { const o = c._original; updated._dirty = String(updated.amount) !== String(o.amount) || updated.frequency !== o.frequency || updated.anchor_date !== o.anchor_date || (updated.account_id || null) !== (o.account_id || null) || (updated.label || '') !== (o.label || '') }
    return updated
  }))
  const removeCharge = (i) => setCharges(cs => cs.filter((_, idx) => idx !== i))
  const addCharge    = ()  => setCharges(cs => [...cs, { ...defaultCharge(startedOn), account_id: accountId || null }])

  const handleTabChange = (tab) => {
    if (tab === 'split' && activeTab === 'details') {
      setCharges(cs => cs.length === 1
        ? [{ ...cs[0], ...singleCharge, label: singleCharge.label || (name.trim() || 'Charge') }]
        : cs)
    }
    if (tab === 'details' && activeTab === 'split' && charges.length > 0) {
      setSingleCharge(c => ({ ...c, amount: charges[0].amount, frequency: charges[0].frequency, anchor_date: charges[0].anchor_date }))
    }
    setActiveTab(tab)
  }

  const dirtyCount   = charges.filter(c => c.id && c._dirty).length
  const allCharges   = initial?.charges || []
  const monthlyTotal = isSplit
    ? charges.reduce((s, c) => s + chargeMonthly({ ...c, amount: parseFloat(c.amount) || 0 }), 0)
    : chargeMonthly({ ...singleCharge, amount: parseFloat(singleCharge.amount) || 0 })
  const annualTotal  = monthlyTotal * 12

  const [mergePending, setMergePending] = useState(null) // { formData, conflict }

  const handleSubmit = (e) => {
    e.preventDefault()
    let finalCharges
    if (!isSplit) {
      const eid = initialCharges[0]?.id
      const sc  = singleCharge
      finalCharges = [{ ...(eid ? { id: eid } : {}), label: name.trim() || 'Payment', amount: parseFloat(sc.amount), frequency: sc.frequency, anchor_date: sc.anchor_date || startedOn, effective_from: initialCharges[0]?.effective_from || startedOn, account_id: sc.account_id || null, _original: sc._original, _dirty: sc._dirty }]
    } else {
      finalCharges = charges.map(c => ({ ...c, id: c.id || undefined, amount: parseFloat(c.amount), anchor_date: c.anchor_date || startedOn, effective_from: c.effective_from || startedOn }))
    }
    const formData = { name, description, parent_category_id: parentCatId || null, color: color || null, account_id: accountId || null, status, pause_until: status === 'paused' ? pauseUntil || null : null, started_on: startedOn, notes: description, bill_type: billType, charges: finalCharges }

    // Client-side conflict check: only for new single-charge bills
    if (!initial && finalCharges.length === 1 && nameConflict) {
      setMergePending({ formData, conflict: nameConflict })
      return
    }

    const dirty = finalCharges.filter(c => c.id && c._dirty)
    if (dirty.length > 0) { setPendingForm(formData); setIntentQueue(dirty); setIntentIndex(0); setResolved([]) }
    else onSave(formData)
  }

  const handleIntentResolve = (resolution) => {
    if (!resolution) { setIntentQueue(null); return }
    const cur = intentQueue[intentIndex]
    const newResolved = [...resolvedIntents, { charge_id: cur.id, ...resolution }]
    setResolved(newResolved)
    const remaining = intentQueue.length - intentIndex - 1
    if (resolution.applyToAll && remaining > 0) {
      const rest = intentQueue.slice(intentIndex + 1).map(r => ({ charge_id: r.id, intent: resolution.intent, effective_from: resolution.effective_from, target_month: resolution.target_month, applyToAll: false }))
      setIntentQueue(null); onSave({ ...pendingForm, _intents: [...newResolved, ...rest] })
    } else if (intentIndex < intentQueue.length - 1) {
      setIntentIndex(i => i + 1)
    } else {
      setIntentQueue(null); onSave({ ...pendingForm, _intents: newResolved })
    }
  }

  return (
    <>
      <div className="modal-bg" onClick={e => e.target === e.currentTarget && !intentQueue && onClose()}>
        <div className="modal" style={{ maxWidth: '960px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', flexShrink: 0 }}>
            <h3 className="modal-title" style={{ margin: 0 }}>{initial ? 'Edit Bill' : 'Add Bill'}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div className="budget-view-toggle">
                <button className={`budget-view-btn${billType === 'bill' ? ' active' : ''}`} type="button" onClick={() => setBillType('bill')}>Bill</button>
                <button className={`budget-view-btn${billType === 'subscription' ? ' active' : ''}`} type="button" onClick={() => setBillType('subscription')}>Subscription</button>
              </div>
              <div className="budget-view-toggle">
                <button className={`budget-view-btn${!isSplit ? ' active' : ''}`} type="button" onClick={() => handleTabChange('details')}>Details</button>
                <button className={`budget-view-btn${isSplit ? ' active' : ''}`} type="button" onClick={() => handleTabChange('split')} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Scissors size={11} />{charges.length > 1 ? `Split (${charges.length})` : 'Split'}
                </button>
              </div>
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'none' }}>
            <form id="bill-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

              {/* ── Category table: Color | Name | Parent ── */}
              <div className="modal-section-header">Category</div>
              <div className="modal-section">
                <div className="card" style={{ padding: 0, '--dt-cols': '36px 1fr 1fr' }}>
                  <div className="acct-tbl-header" style={{ position: 'relative', top: 'unset', padding: '6px 0.75rem' }}>
                    {['Color', 'Name', 'Parent Category'].map((h, i) => (
                      <div key={i} style={headerStyle}>{h}</div>
                    ))}
                  </div>
                  <div className="acct-tbl-row" style={{ padding: '8px 0.75rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ColorPicker value={color} onChange={setColor} hideLabel />
                    </div>
                    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Netflix" required />
                    <TreeSelect value={parentCatName} onChange={handleParentChange} categories={parentCats} placeholder="None (top-level)" selectableParents={true} allowClear={true} />
                  </div>
                </div>
              </div>
              {nameConflict && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 'var(--radius-sm)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--accent)', flexShrink: 0 }}>ⓘ</span>
                  A category named <strong style={{ color: 'var(--text)', margin: '0 3px' }}>{nameConflict.category}</strong> already exists — you'll be asked to merge or create new on save.
                </div>
              )}

              {/* ── Schedule table ── */}
              <div className="modal-section-header">
                {isSplit ? 'Charge Rules' : 'Bill Details'}
              </div>
              <div className="modal-section">
                {/* Status + Started On row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Status</label>
                    <select value={status} onChange={e => setStatus(e.target.value)}>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Started on</label>
                    <DateInput value={startedOn} onChange={handleStartedOnChange} required />
                  </div>
                </div>
                {status === 'paused' && (
                  <div className="form-group" style={{ margin: 0, maxWidth: '50%', paddingRight: '6px' }}>
                    <label>Pause until</label>
                    <DateInput value={pauseUntil} onChange={setPauseUntil} />
                  </div>
                )}

                {/* Schedule table */}
                <div className="card" style={{ padding: 0, '--dt-cols': SCHED_COLS }}>
                  {/* Header */}
                  <div className="acct-tbl-header" style={{ position: 'relative', top: 'unset', padding: '6px 0.75rem' }}>
                    {SCHED_HDRS.map((h, i) => (
                      <div key={i} style={headerStyle}>{h}</div>
                    ))}
                  </div>

                  {/* Rows */}
                  {!isSplit ? (
                    <ChargeRow
                      charge={singleCharge}
                      index={0}
                      isSingle={true}
                      name={name}
                      onChange={updateSingle}
                      onRemove={() => {}}
                      canRemove={false}
                      started_on={startedOn}
                      accounts={accounts}
                      allCharges={allCharges}
                    />
                  ) : (
                    charges.map((c, i) => (
                      <ChargeRow
                        key={i}
                        charge={c}
                        index={i}
                        isSingle={false}
                        name={name}
                        onChange={updateCharge}
                        onRemove={removeCharge}
                        canRemove={charges.length > 1}
                        started_on={startedOn}
                        accounts={accounts}
                        allCharges={allCharges}
                      />
                    ))
                  )}

                  {/* Footer */}
                  <div className="tbl-footer-row" style={{ padding: '5px 0.75rem', fontSize: '11px' }}>
                    {/* Monthly — Amount col */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span className="footer-value" style={{ fontSize: '12px' }}>{formatCurrency(monthlyTotal)}</span>
                      <span className="footer-label" style={{ fontSize: '10px' }}>/ mo</span>
                    </div>
                    {/* Annual — Account col */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span className="footer-value" style={{ fontSize: '12px' }}>{formatCurrency(annualTotal)}</span>
                      <span className="footer-label" style={{ fontSize: '10px' }}>/ yr</span>
                    </div>
                    {/* Label, Started On, Frequency — empty */}
                    <div /><div /><div />
                    {/* + only in split mode */}
                    {isSplit ? (
                      <button type="button" onClick={addCharge} title="Add rule"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', padding: '8px 0', fontSize: '18px', lineHeight: 1, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)', transition: 'opacity 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                        +
                      </button>
                    ) : <div />}
                  </div>
                </div>

                {dirtyCount > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--accent)' }}>
                    {dirtyCount} existing row{dirtyCount !== 1 ? 's' : ''} modified — save to apply price change intent.
                  </div>
                )}

                {/* Description */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Description <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span></label>
                  <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description or notes" />
                </div>
              </div>
            </form>
          </div>

          <div className="modal-btns" style={{ flexShrink: 0, paddingTop: '14px', borderTop: '1px solid var(--border)', marginTop: '4px' }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" form="bill-form" className="btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </div>

      {mergePending && (
        <div className="modal-bg">
          <div className="modal" style={{ maxWidth: '420px' }}>
            <h3 className="modal-title">Category name conflict</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              A budget category named <strong>"{mergePending.conflict.category}"</strong> already exists. What would you like to do?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button className="btn-ghost" style={{ textAlign: 'left', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '3px' }}
                onClick={() => { const fd = mergePending.formData; setMergePending(null); onSave({ ...fd, merge_category_id: mergePending.conflict.id }) }}>
                <span style={{ fontWeight: 600, fontSize: '13px' }}>Merge with existing category</span>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Link this bill to "{mergePending.conflict.category}" — no duplicate created</span>
              </button>
              <button className="btn-ghost" style={{ textAlign: 'left', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '3px' }}
                onClick={() => { const fd = mergePending.formData; setMergePending(null); onSave(fd) }}>
                <span style={{ fontWeight: 600, fontSize: '13px' }}>Create a new category</span>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Adds a separate "{mergePending.conflict.category} (2)" category</span>
              </button>
            </div>
            <div className="modal-btns" style={{ marginTop: '16px' }}>
              <button className="btn-ghost" onClick={() => setMergePending(null)}>Back</button>
            </div>
          </div>
        </div>
      )}

      {intentQueue && intentQueue[intentIndex] && (
        <ChangeIntentModal
          row={intentQueue[intentIndex]}
          original={intentQueue[intentIndex]._original}
          rowIndex={intentIndex}
          totalDirty={intentQueue.length}
          onResolve={handleIntentResolve}
        />
      )}
    </>
  )
}