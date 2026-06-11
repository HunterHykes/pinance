import { useState } from 'react'
import TreeSelect from './TreeSelect'
import ColorPicker from './ColorPicker'
import { CurrencyInput } from './FormControls'

const defaultForm = {
  category:      '',
  monthly_limit: '0',
  parent_id:     null,
  color:         null,
}

const headerStyle = {
  fontSize: '11px', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '.06em',
  color: 'var(--text-tertiary)',
}

// ── CategoryModal ─────────────────────────────────────────────────────────────

export default function CategoryModal({ initial, categories, onClose, onSave, loading, title }) {
  const [form, setForm] = useState(initial || defaultForm)
  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  function getDescendantIds(id, allCats) {
    const ids = new Set([id])
    const queue = [id]
    while (queue.length) {
      const current = queue.shift()
      allCats.filter(c => c.parent_id === current).forEach(c => { ids.add(c.id); queue.push(c.id) })
    }
    return ids
  }

  const hasChildren      = initial ? categories.some(c => c.parent_id === initial.id) : false
  const isBill           = !!initial?.is_bill
  const isIncome         = !!initial?.is_income
  const amountReadOnly   = hasChildren || isBill || isIncome
  const amountNote       = isBill ? 'From Bills' : isIncome ? 'From Income' : 'From subcategories'

  const excluded        = initial ? getDescendantIds(initial.id, categories) : new Set()
  const parentCategories = categories.filter(c => !excluded.has(c.id))
  const parentName      = form.parent_id ? (categories.find(c => c.id === form.parent_id)?.category ?? '') : ''

  const handleParentChange = (selectedName) => {
    if (!selectedName) { set('parent_id', null) } else {
      const match = parentCategories.find(c => c.category === selectedName)
      set('parent_id', match ? match.id : null)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({
      ...form,
      monthly_limit: amountReadOnly ? form.monthly_limit : (parseFloat(form.monthly_limit) || 0),
      parent_id: form.parent_id ?? null,
    })
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '680px' }}>
        <h3 className="modal-title">{title}</h3>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Category table: Color | Name | Parent Category | Budgeted Amount */}
          <div className="card" style={{ padding: 0, '--dt-cols': '36px 1fr 1fr 120px' }}>
            {/* Header */}
            <div className="acct-tbl-header" style={{ position: 'relative', top: 'unset', padding: '6px 0.75rem' }}>
              {['Color', 'Name', 'Parent Category', 'Budgeted Amount'].map((h, i) => (
                <div key={i} style={headerStyle}>{h}</div>
              ))}
            </div>

            {/* Row */}
            <div className="acct-tbl-row" style={{ padding: '8px 0.75rem', alignItems: 'center' }}>
              {/* Color */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ColorPicker value={form.color} onChange={v => set('color', v)} hideLabel />
              </div>
              {/* Name */}
              <input
                type="text"
                value={form.category}
                onChange={e => set('category', e.target.value)}
                placeholder="e.g. Electricity"
                required
              />
              {/* Parent Category */}
              <TreeSelect
                value={parentName}
                onChange={handleParentChange}
                categories={parentCategories}
                placeholder="None (top-level)"
                selectableParents={true}
                excludedValue={initial?.category ?? null}
              />
              {/* Budgeted Amount */}
              {amountReadOnly ? (
                <div style={{
                  fontSize: '12px', color: 'var(--text-tertiary)',
                  padding: '7px 11px', background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {amountNote}
                </div>
              ) : (
                <CurrencyInput
                  value={form.monthly_limit}
                  onChange={v => set('monthly_limit', v)}
                  placeholder="0.00"
                />
              )}
            </div>
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