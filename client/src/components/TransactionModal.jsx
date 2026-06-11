import { useState } from 'react'
import { Scissors } from 'lucide-react'
import TreeSelect from './TreeSelect'
import { CurrencyInput, DateInput } from './FormControls'
import { formatCurrency } from '../utils'
import { saveCategoryMap } from '../api'

const defaultForm = {
  description: '',
  amount:      '',
  date:        new Date().toISOString().split('T')[0],
  category:    '',
  account_id:  '',
  notes:       '',
  type:        'expense',
}

// Column layout: Amount | Fill | Category | Notes | Actions
const SPLIT_COLS = '130px 28px minmax(0,1fr) minmax(0,1fr) 28px'

// ── SplitEditor ───────────────────────────────────────────────────────────────

function SplitEditor({ totalAmount, categories, onSave, onRemoveSplits, onCancel, existingSplits }) {
  const [rows, setRows] = useState(() =>
    existingSplits?.length
      ? existingSplits.map(s => ({ amount: Math.abs(s.amount).toFixed(2), category: s.category, notes: s.notes || '' }))
      : [
          { amount: '', category: '', notes: '' },
          { amount: '', category: '', notes: '' },
        ]
  )
  const [error, setError] = useState(null)

  const total     = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const remaining = Math.abs(totalAmount) - total
  const isValid   = Math.abs(remaining) < 0.01 && rows.every(r => r.amount && r.category)

  const setRow    = (i, field, value) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  const addRow    = () => setRows(r => [...r, { amount: '', category: '', notes: '' }])
  const removeRow = (i) => setRows(r => r.filter((_, idx) => idx !== i))

  const fillRemaining = (i) => {
    const others = rows.reduce((s, r, idx) => idx !== i ? s + (parseFloat(r.amount) || 0) : s, 0)
    const rem = (Math.abs(totalAmount) - others).toFixed(2)
    if (parseFloat(rem) > 0) setRow(i, 'amount', rem)
  }

  const handleSave = () => {
    if (!isValid) { setError('Splits must sum to the total and each must have a category.'); return }
    onSave(rows.map(r => ({ ...r, amount: parseFloat(r.amount) })))
  }

  const remainingColor = Math.abs(remaining) < 0.01
    ? 'var(--green)'
    : remaining < 0 ? 'var(--red)' : 'var(--text)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Table */}
      <div className="card" style={{ padding: 0, '--dt-cols': SPLIT_COLS }}>

        {/* Header — position:relative cancels sticky inside modal */}
        <div className="acct-tbl-header" style={{ position: 'relative', top: 'unset', padding: '6px 0.75rem' }}>
          {['Amount','','Category','Notes',''].map((label, i) => (
            <div key={i} style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-tertiary)' }}>
              {label}
            </div>
          ))}
        </div>

        {/* Rows */}
        {rows.map((row, i) => (
          <div key={i} className="acct-tbl-row" style={{ padding: '5px 0.75rem', alignItems: 'center' }}>
            {/* Amount */}
            <CurrencyInput
              value={row.amount}
              onChange={v => setRow(i, 'amount', v)}
              placeholder="0.00"
            />
            {/* Fill button */}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => fillRemaining(i)}
              title="Fill remaining"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px', fontSize: '13px' }}
            >↓</button>
            {/* Category */}
            <TreeSelect
              value={row.category}
              onChange={v => setRow(i, 'category', v)}
              categories={categories}
              placeholder="Category"
              selectableParents={true}
            />
            {/* Notes */}
            <input
              type="text"
              value={row.notes}
              onChange={e => setRow(i, 'notes', e.target.value)}
              placeholder="Notes"
              style={{ fontSize: '12px' }}
            />
            {/* Delete */}
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={rows.length <= 2}
              title="Remove row"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', padding: '8px 0', fontSize: '18px', lineHeight: 1, color: rows.length <= 2 ? 'var(--text-tertiary)' : 'var(--red)', background: 'none', border: 'none', cursor: rows.length <= 2 ? 'default' : 'pointer', borderRadius: 'var(--radius-sm)', transition: 'opacity 0.1s' }}
              onMouseEnter={e => { if (rows.length > 2) e.currentTarget.style.opacity = '0.7' }}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >−</button>
          </div>
        ))}

        {/* Footer */}
        <div className="tbl-footer-row" style={{ padding: '5px 0.75rem', fontSize: '11px' }}>
          {/* Total inline: value + label */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            <span className="footer-value" style={{ fontSize: '12px' }}>{formatCurrency(total)}</span>
            <span className="footer-label" style={{ fontSize: '10px' }}>total</span>
          </div>
          {/* Fill col — empty */}
          <div />
          {/* Remaining inline: value + label */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            <span className="footer-value" style={{ fontSize: '12px', color: remainingColor }}>
              {Math.abs(remaining) < 0.01 ? '✓ Balanced' : formatCurrency(Math.abs(remaining))}
            </span>
            {Math.abs(remaining) >= 0.01 && <span className="footer-label" style={{ fontSize: '10px' }}>remaining</span>}
          </div>
          {/* Notes col — empty */}
          <div />
          {/* Add button */}
          <button
            type="button"
            onClick={addRow}
            title="Add row"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', padding: '8px 0', fontSize: '18px', lineHeight: 1, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)', transition: 'opacity 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >+</button>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
        {existingSplits?.length > 0 && (
          <button type="button" className="btn-danger" onClick={onRemoveSplits} style={{ fontSize: '12px' }}>
            Remove splits
          </button>
        )}
        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={!isValid}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ── TransactionModal ──────────────────────────────────────────────────────────

export default function TransactionModal({ initial, accounts, categories, onClose, onSave, onSaveSplits, onRemoveSplits, loading }) {
  const [form, setForm]                     = useState(() => initial ? initial : { ...defaultForm })
  const [saveAsMapping, setSaveAsMapping]   = useState(false)
  const [activeTab, setActiveTab]           = useState(initial?.defaultTab || 'details')
  const [existingSplits, setExistingSplits] = useState(initial?.splits || [])
  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))
  const isSplit = existingSplits.length > 0

  // Fields sourced from Plaid that shouldn't be edited
  const isPlaid         = initial?.source === 'plaid'
  const categoryChanged = initial && form.category !== initial.category
  const showMappingOpt  = isPlaid && !!initial?.plaid_category && categoryChanged

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amount = parseFloat(form.amount)
    onSave({
      ...form,
      amount:     form.type === 'expense' ? -Math.abs(amount) : Math.abs(amount),
      account_id: form.account_id || null,
    })
    if (saveAsMapping && initial?.plaid_category && form.category) {
      try {
        await saveCategoryMap({ plaid_category: initial.plaid_category, budget_category: form.category })
      } catch (err) {
        console.error('Failed to save mapping:', err)
      }
    }
  }

  // Shared style for read-only Plaid fields
  const plaidFieldStyle = {
    fontSize: '13px', padding: '8px 11px',
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-tertiary)',
    height: '34px', display: 'flex', alignItems: 'center',
    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
    cursor: 'default', userSelect: 'none',
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: activeTab === 'splits' ? '680px' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <h3 className="modal-title" style={{ margin: 0 }}>
            {initial ? 'Edit Transaction' : 'Add Transaction'}
          </h3>
          {initial && (
            <div className="budget-view-toggle">
              <button className={`budget-view-btn${activeTab === 'details' ? ' active' : ''}`} type="button" onClick={() => setActiveTab('details')}>Details</button>
              <button className={`budget-view-btn${activeTab === 'splits' ? ' active' : ''}`} type="button" onClick={() => setActiveTab('splits')} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Scissors size={11} />
                {isSplit ? 'Splits' : 'Split'}
              </button>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: activeTab === 'details' ? 'flex' : 'none', flexDirection: 'column', gap: '12px' }}>
          {/* Row 1: Date | Vendor */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group">
              <label>Date</label>
              {isPlaid
                ? <div style={plaidFieldStyle}>{form.date}</div>
                : <DateInput value={form.date} onChange={v => set('date', v)} required />
              }
            </div>
            <div className="form-group">
              <label>Vendor</label>
              {isPlaid
                ? <div style={plaidFieldStyle}>{form.description}</div>
                : <input type="text" value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Whole Foods" required />
              }
            </div>
          </div>
          {/* Row 2: Type | Amount */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group">
              <label>Type</label>
              {isPlaid
                ? <div style={{ textTransform: 'capitalize', ...plaidFieldStyle }}>{form.type}</div>
                : <select value={form.type} onChange={e => set('type', e.target.value)}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                  </select>
              }
            </div>
            <div className="form-group">
              <label>Amount</label>
              {isPlaid
                ? <div style={plaidFieldStyle}>{formatCurrency(Math.abs(parseFloat(form.amount) || 0))}</div>
                : <CurrencyInput value={form.amount} onChange={v => set('amount', v)} placeholder="0.00" required />
              }
            </div>
          </div>
          {/* Plaid category — always read-only when present */}
          {initial?.plaid_category && (
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                Plaid category
                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 400 }}>read-only</span>
              </label>
              <div style={plaidFieldStyle}>{initial.plaid_category}</div>
            </div>
          )}
          <div className="form-group">
            <label>Category</label>
            <TreeSelect value={form.category} onChange={v => set('category', v)} categories={categories} />
          </div>
          {showMappingOpt && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '2px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={saveAsMapping} onChange={e => setSaveAsMapping(e.target.checked)} style={{ marginTop: '3px', flexShrink: 0, width: 'auto' }} />
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Update mapping for{' '}
                <span style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: '3px', border: '1px solid var(--border)', wordBreak: 'break-all' }}>{initial.plaid_category}</span>
                {' → '}
                <span style={{ color: 'var(--text)', background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: '3px', border: '1px solid var(--border)' }}>{form.category}</span>
              </span>
            </label>
          )}
          <div className="form-group">
            <label>Account (optional)</label>
            <select value={form.account_id} onChange={e => set('account_id', e.target.value)}>
              <option value="">No account</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Notes (optional)</label>
            <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any extra details..." />
          </div>
          <div className="modal-btns">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>

        {activeTab === 'splits' && initial && (
          <SplitEditor
            totalAmount={form.type === 'expense' ? -Math.abs(parseFloat(form.amount) || 0) : Math.abs(parseFloat(form.amount) || 0)}
            categories={categories}
            existingSplits={existingSplits}
            onSave={splits => { onSaveSplits(initial.id, splits); onClose() }}
            onCancel={onClose}
            onRemoveSplits={() => { onRemoveSplits(initial.id); onClose() }}
          />
        )}
      </div>
    </div>
  )
}