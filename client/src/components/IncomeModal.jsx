import { useState, useMemo } from 'react'
import { TrendingUp, Scissors } from 'lucide-react'
import TreeSelect from './TreeSelect'
import ColorPicker from './ColorPicker'
import ChangeIntentModal from './ChangeIntentModal'
import { CurrencyInput, DateInput } from './FormControls'
import { formatCurrency } from '../utils'

const FREQUENCIES = [
  { value: 'weekly',        label: 'Weekly'        },
  { value: 'biweekly',      label: 'Bi-weekly'     },
  { value: 'twice_monthly', label: 'Twice monthly' },
  { value: 'monthly',       label: 'Monthly'       },
  { value: 'custom_days',   label: 'Custom days'   },
]

function freqLabel(f) { return FREQUENCIES.find(x => x.value === f)?.label || f }

function occurrencesPerMonth(frequency, customDays) {
  switch (frequency) {
    case 'weekly':        return 52 / 12
    case 'biweekly':      return 26 / 12
    case 'twice_monthly': return 2
    case 'monthly':       return 1
    default:              return 1
  }
}

function scheduleMonthly(s) {
  return (parseFloat(s.amount) || 0) * occurrencesPerMonth(s.frequency, s.custom_days)
}

function deriveAnchorDate(frequency, startedOn) { return startedOn || new Date().toISOString().slice(0, 10) }

const defaultSchedule = (startedOn) => ({
  label: '', amount: '', frequency: 'biweekly',
  anchor_date:    startedOn || new Date().toISOString().slice(0, 10),
  effective_from: startedOn || new Date().toISOString().slice(0, 10),
  custom_days: null,
})

// Schedule table column layout
// Amount | Account | Label | Started On | Frequency | −/+
const SCHED_COLS = 'minmax(120px,130px) minmax(130px,1fr) minmax(130px,2fr) minmax(130px,160px) minmax(140px,160px) 28px'
const SCHED_HDRS = ['Amount', 'Account', 'Label', 'Started On', 'Frequency', '']

const headerStyle = {
  fontSize: '11px', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '.06em',
  color: 'var(--text-tertiary)',
}

// ── ScheduleRow ───────────────────────────────────────────────────────────────

function ScheduleRow({ schedule, index, isSingle, name, onChange, onRemove, canRemove, started_on, accounts, allSchedules }) {
  const [showHist, setShowHist] = useState(false)
  const isExisting = !!schedule.id
  const isDirty    = isExisting && schedule._dirty
  const set = (field, val) => onChange(index, { ...schedule, [field]: val })

  const needsCustomDays = schedule.frequency === 'custom_days' || schedule.frequency === 'twice_monthly'

  const itemHist = useMemo(() =>
    (!schedule.budget_category_id || !allSchedules) ? [] :
    allSchedules.filter(s => s.budget_category_id === schedule.budget_category_id),
    [schedule.budget_category_id, allSchedules]
  )

  const handleFreqChange = (freq) => {
    onChange(index, { ...schedule, frequency: freq, anchor_date: deriveAnchorDate(freq, started_on) })
  }

  return (
    <>
      <div
        className="acct-tbl-row"
        style={{ padding: '5px 0.75rem', alignItems: 'center', background: isDirty ? 'rgba(59,130,246,0.04)' : undefined }}
      >
        {/* Amount */}
        <CurrencyInput value={schedule.amount} onChange={v => set('amount', v)} placeholder="0.00" required />
        {/* Account */}
        <select value={schedule.account_id || ''} onChange={e => set('account_id', e.target.value || null)} style={{ fontSize: '13px' }}>
          <option value="">—</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {/* Label — grayed when single (pulled from source name) */}
        {isSingle ? (
          <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', padding: '0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name || '—'}
          </div>
        ) : (
          <input
            type="text"
            value={schedule.label}
            onChange={e => set('label', e.target.value)}
            placeholder="Label"
            required
            style={{ fontSize: '13px' }}
          />
        )}
        {/* Started On */}
        <DateInput value={schedule.anchor_date || started_on || ''} onChange={v => set('anchor_date', v)} />
        {/* Frequency */}
        <select value={schedule.frequency} onChange={e => handleFreqChange(e.target.value)} style={{ fontSize: '13px' }}>
          {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
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
      {/* Custom days sub-row */}
      {needsCustomDays && (
        <div style={{ padding: '4px 0.75rem 8px', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>
            {schedule.frequency === 'twice_monthly' ? 'Pay days:' : 'Days of month:'}
          </span>
          <input type="text"
            value={schedule.frequency === 'twice_monthly' ? (schedule.custom_days || '1,15') : (schedule.custom_days || '')}
            onChange={e => set('custom_days', e.target.value)}
            placeholder="e.g. 1, 15"
            style={{ width: '120px', fontSize: '13px' }}
          />
        </div>
      )}
      {/* History sub-rows */}
      {showHist && itemHist.length > 0 && (
        <div style={{ padding: '4px 0.75rem 8px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          {[...itemHist].sort((a, b) => b.effective_from.localeCompare(a.effective_from)).map(s => (
            <div key={s.id} className="sub-history-row">
              <span style={{ color: s.effective_to ? 'var(--text-tertiary)' : 'var(--text)' }}>
                {s.label} — {formatCurrency(s.amount)} / {freqLabel(s.frequency)}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                {new Date(s.effective_from + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {s.effective_to ? ` → ${new Date(s.effective_to + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ' → present'}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── IncomeModal ───────────────────────────────────────────────────────────────

export default function IncomeModal({ initial, categories, accounts, onClose, onSave, loading }) {
  const [name,        setName]        = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || initial?.notes || '')
  const [parentCatId, setParentCatId] = useState(initial?.parent_category_id || null)
  const [color,       setColor]       = useState(initial?.color || null)
  const [status,      setStatus]      = useState(initial?.status || 'active')
  const [startedOn,   setStartedOn]   = useState(initial?.started_on || new Date().toISOString().slice(0, 10))

  const initialSchedules = initial?.schedules?.filter(s => !s.effective_to) || []
  const [activeTab, setActiveTab] = useState(initialSchedules.length > 1 ? 'split' : 'details')
  const isSplit = activeTab === 'split'

  const [schedules, setSchedules] = useState(() =>
    initialSchedules.length > 0
      ? initialSchedules.map(s => ({ ...s, amount: String(s.amount), _original: { ...s, amount: String(s.amount) } }))
      : [defaultSchedule(initial?.started_on)]
  )

  const firstSched = initialSchedules[0]
  const [singleSched, setSingleSched] = useState(() => ({
    ...(firstSched
      ? { ...firstSched, amount: String(firstSched.amount), _original: { ...firstSched, amount: String(firstSched.amount) } }
      : defaultSchedule(initial?.started_on)),
  }))

  const [intentQueue,     setIntentQueue]   = useState(null)
  const [intentIndex,     setIntentIndex]   = useState(0)
  const [resolvedIntents, setResolved]      = useState([])
  const [pendingForm,     setPendingForm]   = useState(null)

  const parentCats    = categories.filter(c => !c.is_subscription && !c.is_income)
  const parentCatName = parentCats.find(c => c.id === parentCatId)?.category || ''
  const handleParentChange = (n) => { const cat = parentCats.find(c => c.category === n); setParentCatId(cat?.id || null) }

  // Live conflict: any existing category whose name matches, excluding own categories
  const nameConflict = (!initial && !isSplit)
    ? categories.find(c =>
        c.category.trim().toLowerCase() === name.trim().toLowerCase() &&
        c.income_id !== (initial?.id ?? -1)
      ) ?? null
    : null

  const handleStartedOnChange = (newDate) => {
    setStartedOn(newDate)
    setSingleSched(s => ({ ...s, anchor_date: s.anchor_date === startedOn ? newDate : s.anchor_date, effective_from: s.effective_from === startedOn ? newDate : s.effective_from }))
    setSchedules(ss => ss.map(s => ({ ...s, anchor_date: s.anchor_date === startedOn ? deriveAnchorDate(s.frequency, newDate) : s.anchor_date, effective_from: s.effective_from === startedOn ? newDate : s.effective_from })))
  }

  const updateSingle = (i, val) => {
    const updated = { ...val }
    if (singleSched._original) {
      const o = singleSched._original
      updated._dirty = String(updated.amount) !== String(o.amount) || updated.frequency !== o.frequency || updated.anchor_date !== o.anchor_date || (updated.account_id || null) !== (o.account_id || null) || (updated.label || '') !== (o.label || '')
    }
    setSingleSched(updated)
  }

  const updateSchedule = (i, val) => setSchedules(ss => ss.map((s, idx) => {
    if (idx !== i) return s
    const updated = { ...val }
    if (s._original) { const o = s._original; updated._dirty = String(updated.amount) !== String(o.amount) || updated.frequency !== o.frequency || updated.anchor_date !== o.anchor_date || (updated.account_id || null) !== (o.account_id || null) || (updated.label || '') !== (o.label || '') }
    return updated
  }))
  const removeSchedule = (i) => setSchedules(ss => ss.filter((_, idx) => idx !== i))
  const addSchedule    = ()  => setSchedules(ss => [...ss, defaultSchedule(startedOn)])

  const handleTabChange = (tab) => {
    if (tab === 'split' && activeTab === 'details') {
      setSchedules(ss => ss.length === 1
        ? [{ ...ss[0], ...singleSched, label: singleSched.label || (name.trim() || 'Income') }]
        : ss)
    }
    if (tab === 'details' && activeTab === 'split' && schedules.length > 0) {
      setSingleSched(s => ({ ...s, amount: schedules[0].amount, frequency: schedules[0].frequency, anchor_date: schedules[0].anchor_date }))
    }
    setActiveTab(tab)
  }

  const dirtyCount  = schedules.filter(s => s.id && s._dirty).length
  const allSchedules = initial?.schedules || []
  const monthlyTotal = isSplit
    ? schedules.reduce((sum, s) => sum + scheduleMonthly(s), 0)
    : scheduleMonthly(singleSched)
  const annualTotal  = monthlyTotal * 12

  const [mergePending, setMergePending] = useState(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    let finalSchedules
    if (!isSplit) {
      const eid = initialSchedules[0]?.id
      const ss  = singleSched
      finalSchedules = [{ ...(eid ? { id: eid } : {}), label: name.trim() || 'Income', amount: parseFloat(ss.amount), frequency: ss.frequency, anchor_date: ss.anchor_date || startedOn, effective_from: initialSchedules[0]?.effective_from || startedOn, account_id: ss.account_id || null, custom_days: ss.custom_days || null, _original: ss._original, _dirty: ss._dirty }]
    } else {
      finalSchedules = schedules.map(s => ({ ...s, id: s.id || undefined, amount: parseFloat(s.amount), anchor_date: s.anchor_date || startedOn, effective_from: s.effective_from || startedOn, custom_days: s.custom_days || null }))
    }
    const formData = { name, description, parent_category_id: parentCatId || null, color: color || null, account_id: null, status, started_on: startedOn, notes: description, schedules: finalSchedules }

    // Client-side conflict check: only for new single-schedule sources
    if (!initial && finalSchedules.length === 1 && nameConflict) {
      setMergePending({ formData, conflict: nameConflict })
      return
    }

    const dirty = finalSchedules.filter(s => s.id && s._dirty)
    if (dirty.length > 0) { setPendingForm(formData); setIntentQueue(dirty); setIntentIndex(0); setResolved([]) }
    else onSave(formData)
  }

  const handleIntentResolve = (resolution) => {
    if (!resolution) { setIntentQueue(null); return }
    const cur = intentQueue[intentIndex]
    const newResolved = [...resolvedIntents, { schedule_id: cur.id, ...resolution }]
    setResolved(newResolved)
    const remaining = intentQueue.length - intentIndex - 1
    if (resolution.applyToAll && remaining > 0) {
      const rest = intentQueue.slice(intentIndex + 1).map(r => ({ schedule_id: r.id, intent: resolution.intent, effective_from: resolution.effective_from, target_month: resolution.target_month, applyToAll: false }))
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
        <div className="modal" style={{ maxWidth: '860px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', flexShrink: 0 }}>
            <h3 className="modal-title" style={{ margin: 0 }}>{initial ? 'Edit Income' : 'Add Income'}</h3>
            <div className="budget-view-toggle">
              <button className={`budget-view-btn${!isSplit ? ' active' : ''}`} type="button" onClick={() => handleTabChange('details')}>Details</button>
              <button className={`budget-view-btn${isSplit ? ' active' : ''}`} type="button" onClick={() => handleTabChange('split')} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Scissors size={11} />{schedules.length > 1 ? `Split (${schedules.length})` : 'Split'}
              </button>
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'none' }}>
            <form id="income-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

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
                    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Salary — Acme Corp" required />
                    <TreeSelect value={parentCatName} onChange={handleParentChange} categories={parentCats} placeholder="Income (default)" selectableParents={true} allowClear={true} />
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
                {isSplit ? 'Pay Schedules' : 'Income Details'}
              </div>
              <div className="modal-section">
                {/* Status + Started On */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Status</label>
                    <select value={status} onChange={e => setStatus(e.target.value)}>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="stopped">Stopped</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Started on</label>
                    <DateInput value={startedOn} onChange={handleStartedOnChange} required />
                  </div>
                </div>

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
                    <ScheduleRow
                      schedule={singleSched}
                      index={0}
                      isSingle={true}
                      name={name}
                      onChange={updateSingle}
                      onRemove={() => {}}
                      canRemove={false}
                      started_on={startedOn}
                      accounts={accounts}
                      allSchedules={allSchedules}
                    />
                  ) : (
                    schedules.map((s, i) => (
                      <ScheduleRow
                        key={i}
                        schedule={s}
                        index={i}
                        isSingle={false}
                        name={name}
                        onChange={updateSchedule}
                        onRemove={removeSchedule}
                        canRemove={schedules.length > 1}
                        started_on={startedOn}
                        accounts={accounts}
                        allSchedules={allSchedules}
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
                    {isSplit ? (
                      <button type="button" onClick={addSchedule} title="Add schedule"
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
                    {dirtyCount} existing row{dirtyCount !== 1 ? 's' : ''} modified — save to apply amount change intent.
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
            <button type="submit" form="income-form" className="btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
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
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Link this income source to "{mergePending.conflict.category}" — no duplicate created</span>
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