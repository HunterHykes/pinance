import { useState, useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import TreeSelect from './TreeSelect'
import { formatCurrency } from '../utils'
import { CurrencyInput, DateInput } from './FormControls'

const LIABILITY_TYPES = ['Mortgage', 'Auto Loan', 'Student Loan', 'Personal Loan', 'Line of Credit', 'Other']

// ── Unified LiabilityModal ────────────────────────────────────────────────────
// Used by both Assets.jsx and Liabilities.jsx.
// Props:
//   initial      — existing liability object (null for create)
//   defaultType  — pre-select type on create (from Assets page)
//   assets       — array of asset objects for the linked asset dropdown
//   categories   — budget category rows for transaction matching dropdown
//   onClose      — close handler
//   onSave       — save handler
//   loading      — mutation pending flag

export default function LiabilityModal({ initial, defaultType, assets = [], categories = [], onClose, onSave, loading }) {
  const [form, setForm] = useState(() => {
    if (initial) {
      return {
        ...initial,
        balance:            String(initial.balance ?? ''),
        interest_rate:      initial.interest_rate != null ? (initial.interest_rate * 100).toFixed(3) : '',
        asset_id:           initial.asset_id    || '',
        category_id:        initial.category_id || '',
        original_principal: initial.original_principal != null ? String(initial.original_principal) : '',
        loan_term_months:   initial.loan_term_months   != null ? String(initial.loan_term_months)   : '',
        monthly_payment:    initial.monthly_payment    != null ? String(initial.monthly_payment)    : '',
        origination_date:   initial.origination_date   || '',
        notes:              initial.notes || '',
      }
    }
    return {
      name: '', type: defaultType || 'Mortgage', balance: '',
      asset_id: '', category_id: '',
      original_principal: '', interest_rate: '', loan_term_months: '',
      origination_date: '', monthly_payment: '', notes: '',
    }
  })

  const [showTerms, setShowTerms] = useState(!!(initial?.original_principal || initial?.interest_rate))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const suggestedPayment = useMemo(() => {
    const P = parseFloat(form.original_principal)
    const r = parseFloat(form.interest_rate) / 100 / 12
    const n = parseInt(form.loan_term_months)
    if (!P || !n || isNaN(P) || isNaN(n)) return null
    if (!r || isNaN(r)) return (P / n).toFixed(2)
    return (P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)).toFixed(2)
  }, [form.original_principal, form.interest_rate, form.loan_term_months])

  const selectedCategoryName = useMemo(() => {
    if (!form.category_id || !categories) return ''
    const cat = categories.find(c => c.id === parseInt(form.category_id))
    return cat?.category || ''
  }, [form.category_id, categories])

  const handleCategoryChange = (name) => {
    if (!name) { set('category_id', ''); return }
    const cat = categories?.find(c => c.category === name)
    if (cat) set('category_id', cat.id)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({
      ...form,
      balance:            parseFloat(form.balance),
      asset_id:           form.asset_id           ? parseInt(form.asset_id)           : null,
      category_id:        form.category_id        ? parseInt(form.category_id)        : null,
      interest_rate:      form.interest_rate      ? parseFloat(form.interest_rate) / 100 : null,
      original_principal: form.original_principal ? parseFloat(form.original_principal)  : null,
      loan_term_months:   form.loan_term_months   ? parseInt(form.loan_term_months)       : null,
      monthly_payment:    form.monthly_payment    ? parseFloat(form.monthly_payment)      : null,
      origination_date:   form.origination_date   || null,
    })
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '520px' }}>
        <h3 className="modal-title">{initial ? 'Edit liability' : 'Add liability'}</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Name + Type + Balance */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group" style={{ gridColumn: '1 / 3' }}>
              <label>Liability name</label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="e.g. Primary mortgage" required autoFocus />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}>
                {LIABILITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Current balance ($)</label>
              {initial ? (
                <div style={{ fontSize: '13px', padding: '8px 11px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)' }}>
                  {formatCurrency(parseFloat(form.balance) || 0)}
                </div>
              ) : (
                <CurrencyInput value={form.balance} onChange={v => set('balance', v)}
                  placeholder="0.00" required />
              )}
            </div>
          </div>

          {/* Linked asset + Transaction category side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group">
              <label>Linked asset <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span></label>
              <select value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>
                <option value="">None</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Transaction category <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span></label>
              <TreeSelect
                value={selectedCategoryName}
                onChange={handleCategoryChange}
                categories={categories || []}
                placeholder="— None —"
                selectableParents={true}
                allowClear={true}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '3px' }}>
                Transactions here are matched as payments.
              </span>
            </div>
          </div>

          {/* Loan terms (collapsible) */}
          <div>
            <button type="button" className="btn-ghost"
              style={{ fontSize: '12px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
              onClick={() => setShowTerms(t => !t)}>
              <ChevronRight size={12} style={{ transform: showTerms ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }} />
              Loan terms {showTerms ? '' : '(APR, amortization)'}
            </button>
            {showTerms && (
              <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                <div className="form-group">
                  <label>Original principal ($)</label>
                  <CurrencyInput value={form.original_principal} onChange={v => set('original_principal', v)} placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label>Interest rate (APR %)</label>
                  <input type="number" value={form.interest_rate} onChange={e => set('interest_rate', e.target.value)} placeholder="e.g. 6.5" step="0.001" min="0" max="100" className="no-spinner" />
                </div>
                <div className="form-group">
                  <label>Loan term (months)</label>
                  <input type="number" value={form.loan_term_months} onChange={e => set('loan_term_months', e.target.value)} placeholder="360 = 30 yr" min="1" className="no-spinner" />
                </div>
                <div className="form-group">
                  <label>Origination date</label>
                  <DateInput value={form.origination_date} onChange={v => set('origination_date', v)} />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / 3' }}>
                  <label>
                    Monthly payment ($)
                    {suggestedPayment && !form.monthly_payment && (
                      <span style={{ fontSize: '11px', color: 'var(--accent)', marginLeft: '8px', cursor: 'pointer' }}
                        onClick={() => set('monthly_payment', suggestedPayment)}>
                        ← calculated: ${suggestedPayment}
                      </span>
                    )}
                  </label>
                  <CurrencyInput value={form.monthly_payment} onChange={v => set('monthly_payment', v)}
                    placeholder={suggestedPayment ? `Calculated: $${suggestedPayment}` : 'Optional'} />
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Notes <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span></label>
            <input type="text" value={form.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Any extra details..." />
          </div>

          <div className="modal-btns">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}