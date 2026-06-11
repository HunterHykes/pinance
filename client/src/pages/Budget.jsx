import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { GripVertical } from 'lucide-react'
import RowMoreMenu from '../components/RowMoreMenu'
import {
  useBudget,
  useSaveBudgetCategory,
  useUpdateBudgetCategory,
  useDeleteBudgetCategory,
  useBudgetTemplate,
  useSaveBudgetTemplate,
  useUpdateBudgetTemplate,
  useDeleteBudgetTemplate,
  useSyncTemplateFromCurrent,
  useReorderBudget,
  useReorderBudgetTemplate,
} from '../hooks/useBudget'
import { useBills, useUpdateBill } from '../hooks/useBills'
import { useIncomeSources, useUpdateIncomeSource } from '../hooks/useIncome'
import { formatCurrency, currentMonth, buildCategoryTree, sumSpent, sumLimit, resolveColor } from '../utils'
import TreeSelect from '../components/TreeSelect'
import ColorPicker from '../components/ColorPicker'
import ChangeIntentModal from '../components/ChangeIntentModal'
import { MonthPicker } from '../components/DateRangePicker'

// ── Bill helpers (client-side) ───────────────────────────────────────

function chargeOccursInMonth(anchorDate, frequency, targetMonth) {
  const anchor = new Date(anchorDate + 'T00:00:00')
  const [ty, tm] = targetMonth.split('-').map(Number)
  switch (frequency) {
    case 'monthly':     return true
    case 'quarterly': {
      const am = anchor.getFullYear() * 12 + anchor.getMonth()
      const bm = ty * 12 + (tm - 1)
      return bm >= am && (bm - am) % 3 === 0
    }
    case 'semi_annual': {
      const am = anchor.getFullYear() * 12 + anchor.getMonth()
      const bm = ty * 12 + (tm - 1)
      return bm >= am && (bm - am) % 6 === 0
    }
    case 'annual':
      return anchor.getMonth() === (tm - 1) && ty >= anchor.getFullYear()
    default: return false
  }
}

function nextOccurrenceMonth(anchorDate, frequency, fromMonth) {
  if (frequency === 'monthly') return null
  for (let i = 1; i <= 24; i++) {
    const d = new Date(fromMonth + '-01')
    d.setMonth(d.getMonth() + i)
    const m = d.toISOString().slice(0, 7)
    if (chargeOccursInMonth(anchorDate, frequency, m)) return m
  }
  return null
}

const defaultForm = {
  category:      '',
  monthly_limit: '',
  parent_id:     null,
  color:         null,
}

// ── Shared category modal ─────────────────────────────────────────────────────

function CategoryModal({ initial, categories, onClose, onSave, loading, title }) {
  const [form, setForm] = useState(initial || defaultForm)
  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({ ...form, monthly_limit: isBill ? form.monthly_limit : parseFloat(form.monthly_limit), parent_id: form.parent_id ?? null })
  }

  function getDescendantIds(id, allCats) {
    const ids = new Set([id])
    const queue = [id]
    while (queue.length) {
      const current = queue.shift()
      allCats.filter(c => c.parent_id === current).forEach(c => { ids.add(c.id); queue.push(c.id) })
    }
    return ids
  }

  const hasChildren       = initial ? categories.some(c => c.parent_id === initial.id) : false
  const isBill            = !!initial?.is_bill
  const excluded          = initial ? getDescendantIds(initial.id, categories) : new Set()
  const parentCategories  = categories.filter(c => !excluded.has(c.id))
  const parentName        = form.parent_id ? (categories.find(c => c.id === form.parent_id)?.category ?? '') : ''
  const handleParentChange = (selectedName) => {
    if (!selectedName) { set('parent_id', null) } else {
      const match = parentCategories.find(c => c.category === selectedName)
      set('parent_id', match ? match.id : null)
    }
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">{title}</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="form-group">
            <label>Category name</label>
            <input type="text" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Electricity" required />
          </div>
          <div className="form-group">
            <label>Monthly limit ($)</label>
            {(!hasChildren && !isBill) ? (
              <input type="number" value={form.monthly_limit} onChange={e => set('monthly_limit', e.target.value)} placeholder="0.00" step="0.01" min="0" required />
            ) : (
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', padding: '8px 11px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                {isBill ? 'Auto-calculated from Bills' : 'Auto-calculated from subcategories'}
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Parent category (optional)</label>
            <TreeSelect value={parentName} onChange={handleParentChange} categories={parentCategories} placeholder="None (top-level)" selectableParents={true} excludedValue={initial?.category ?? null} />
          </div>
          <div className="form-group">
            <label>Color</label>
            <ColorPicker value={form.color} onChange={v => set('color', v)} />
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


// ── Bar helpers ───────────────────────────────────────────────────────────────

function lerpColor(a, b, t) {
  const ah=a.replace('#',''), bh=b.replace('#','')
  const ar=parseInt(ah.slice(0,2),16), ag=parseInt(ah.slice(2,4),16), ab=parseInt(ah.slice(4,6),16)
  const br=parseInt(bh.slice(0,2),16), bg=parseInt(bh.slice(2,4),16), bb=parseInt(bh.slice(4,6),16)
  const r=Math.round(ar+(br-ar)*t), g=Math.round(ag+(bg-ag)*t), b2=Math.round(ab+(bb-ab)*t)
  return '#'+[r,g,b2].map(v=>v.toString(16).padStart(2,'0')).join('')
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return `${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)}`
}

// ── Shared drag row wrapper ───────────────────────────────────────────────────

function DragHandle() {
  return (
    <span className="drag-handle" title="Drag to reorder">
      <GripVertical size={14} />
    </span>
  )
}

// ── Budget row (monthly view) ─────────────────────────────────────────────────

function SubBadge() {
  const navigate = useNavigate()
  return (
    <span
      className="sub-badge"
      style={{ fontSize: '9px', padding: '2px 7px', cursor: 'pointer', background: 'rgba(150,150,150,0.15)', color: 'var(--text-secondary)' }}
      onClick={e => { e.stopPropagation(); navigate('/bills') }}
      title="Go to Bills"
    >
      Bill
    </span>
  )
}

function IncomeBadge() {
  const navigate = useNavigate()
  return (
    <span
      className="sub-badge"
      style={{ fontSize: '9px', padding: '2px 7px', cursor: 'pointer', background: 'rgba(34,197,94,0.12)', color: 'var(--green)' }}
      onClick={e => { e.stopPropagation(); navigate('/income') }}
      title="Go to Income"
    >
      Income
    </span>
  )
}

function BudgetRow({ node, allCategories, depth = 0, onEdit, onDelete, barColor = null, dragState, onDragStart, onDragEnter, onDragEnd, subByCatId = {}, incomeByCatId = {}, month = '', inlineEdit = null, onInlineEditStart, onInlineEditChange, onInlineEditCommit }) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren  = node.children && node.children.length > 0
  const displaySpent = hasChildren ? sumSpent(node) : node.spent
  const limit        = hasChildren ? sumLimit(node) : node.monthly_limit
  const pct          = limit > 0 ? Math.min(displaySpent / limit, 1) * 100 : 0
  const rawPct       = limit > 0 ? (displaySpent / limit) * 100 : 0
  const remaining    = limit - displaySpent
  const over         = displaySpent > limit && limit > 0
  const unallocated  = displaySpent > 0 && limit === 0
  const freshNode    = allCategories.find(c => c.id === node.id) || node
  const color        = resolveColor(freshNode, allCategories)
  const resolvedBarColor = freshNode.color ? color : (barColor || color)
  const isHex        = resolvedBarColor.startsWith('#')
  const trackBg      = isHex ? `rgba(${hexToRgb(resolvedBarColor)}, 0.2)` : 'var(--bg-secondary)'
  const fillColor    = over ? '#ef4444' : resolvedBarColor
  const labelColor = (() => {
    if (over || unallocated || rawPct >= 100) return '#ef4444'
    if (rawPct >= 90) return lerpColor('#f97316', '#ef4444', (rawPct - 90) / 10)
    if (rawPct >= 75) return lerpColor('#eab308', '#f97316', (rawPct - 75) / 15)
    return 'var(--text-secondary)'
  })()

  const isDragging    = dragState?.draggingId === node.id
  const isOver        = dragState?.overId     === node.id
  const subEntry      = subByCatId[node.id]
  const incEntry      = incomeByCatId[node.id]
  const isSub         = !!node.managed_by_bill  || !!node.is_bill   || !!node.bill_id
  const isIncome      = !!node.managed_by_income || !!node.is_income || !!node.income_id
  const isRecurring   = isSub || isIncome
  const isDueThisMonth = subEntry && chargeOccursInMonth(subEntry.charge.anchor_date, subEntry.charge.frequency, month)
  const nextDue        = subEntry && !isDueThisMonth
    ? nextOccurrenceMonth(subEntry.charge.anchor_date, subEntry.charge.frequency, month)
    : null
  const isEditingThis  = inlineEdit?.nodeId === node.id
  const canInlineEdit  = isRecurring && !hasChildren

  return (
    <>
      <div
        className={[
          'budget-row-full',
          isDragging ? 'row-dragging' : '',
          isOver && !isDragging ? 'row-drag-over' : '',
        ].join(' ')}
        style={{ paddingLeft: `${1.5 + depth * 1.5}rem` }}
        draggable
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(node.id) }}
        onDragEnter={e => { e.preventDefault(); onDragEnter(node.id) }}
        onDragOver={e => e.preventDefault()}
        onDragEnd={onDragEnd}
      >
        <div className="budget-row-left">
          <DragHandle />
          <button
            className={'budget-dot-btn' + (hasChildren ? ' budget-dot-btn--expandable' : '')}
            style={{ background: color }}
            onClick={() => hasChildren && setExpanded(e => !e)}
            aria-label={hasChildren ? (expanded ? 'Collapse' : 'Expand') : undefined}
          >
            {hasChildren && (
              <svg className={'dot-chevron' + (expanded ? ' dot-chevron--open' : '')} width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1.5 3L4 5.5L6.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="budget-cat-name">{node.category}</span>
              {isSub && <SubBadge />}
              {isIncome && <IncomeBadge />}
              {nextDue && (
                <span className="sub-badge" style={{ fontSize: '9px', padding: '1px 5px', background: 'rgba(136,136,136,0.15)', color: 'var(--text-tertiary)' }}>
                  due {nextDue.split('-')[1]}-{nextDue.split('-')[0]}
                </span>
              )}
            </div>
            {hasChildren && <div className="budget-cat-sub">{node.children.length} subcategor{node.children.length !== 1 ? 'ies' : 'y'}</div>}
          </div>
        </div>

        <div className="budget-row-right">
          <div className="budget-bar-wrap">
            <div className="budget-bar-labels">
              <span className="budget-bar-pct-secondary">{formatCurrency(displaySpent)}</span>
              {isEditingThis ? (
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={inlineEdit.value}
                  onChange={e => onInlineEditChange(e.target.value)}
                  onBlur={() => onInlineEditCommit()}
                  onKeyDown={e => { if (e.key === 'Enter') onInlineEditCommit(); if (e.key === 'Escape') onInlineEditCommit(true) }}
                  autoFocus
                  style={{ width: '80px', fontSize: '12px', textAlign: 'right', padding: '1px 4px' }}
                />
              ) : (
                <span
                  className="budget-bar-pct-secondary"
                  style={canInlineEdit ? { cursor: 'pointer', borderBottom: '1px dashed var(--border)' } : {}}
                  onClick={canInlineEdit ? () => onInlineEditStart(node, subEntry, incEntry) : undefined}
                  title={canInlineEdit ? 'Click to adjust' : undefined}
                >
                  {formatCurrency(limit)}
                </span>
              )}
            </div>
            <div className="bar-track" style={{ background: trackBg }} title={`${Math.round(pct)}%`}>
              <div className="bar-fill" style={{ width: `${pct}%`, background: fillColor }} />
            </div>
          </div>
          <div className="budget-remaining-col">
            <span style={{ color: labelColor, fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap' }}>
              {limit === 0 && displaySpent > 0
                ? `-${formatCurrency(displaySpent)}`
                : over
                  ? `-${formatCurrency(Math.abs(remaining))}`
                  : formatCurrency(remaining)
              }
            </span>
          </div>
          <RowMoreMenu items={[
            { label: 'Edit', onClick: () => onEdit(node) },
            !isRecurring && { label: 'Delete', danger: true, onClick: () => onDelete(node.id) },
          ]} />
        </div>
      </div>

      {hasChildren && expanded && node.children.map(child => (
        <BudgetRow key={child.id} node={child} allCategories={allCategories} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} barColor={resolvedBarColor} dragState={dragState} onDragStart={onDragStart} onDragEnter={onDragEnter} onDragEnd={onDragEnd} subByCatId={subByCatId} incomeByCatId={incomeByCatId} month={month} inlineEdit={inlineEdit} onInlineEditStart={onInlineEditStart} onInlineEditChange={onInlineEditChange} onInlineEditCommit={onInlineEditCommit} />
      ))}
    </>
  )
}

// ── Template row ──────────────────────────────────────────────────────────────

function TemplateRow({ node, allCategories, depth = 0, onEdit, onDelete, dragState, onDragStart, onDragEnter, onDragEnd, subByCatId = {}, month = '' }) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children && node.children.length > 0
  const freshNode   = allCategories.find(c => c.id === node.id) || node
  const color       = resolveColor(freshNode, allCategories)
  const isDragging  = dragState?.draggingId === node.id
  const isOver      = dragState?.overId     === node.id
  const isSub       = !!node.managed_by_bill  || !!node.is_bill   || !!node.bill_id
  const isIncome    = !!node.managed_by_income || !!node.is_income || !!node.income_id
  const isRecurring = isSub || isIncome

  return (
    <>
      <div
        className={[
          'budget-row-full',
          isDragging ? 'row-dragging' : '',
          isOver && !isDragging ? 'row-drag-over' : '',
        ].join(' ')}
        style={{ paddingLeft: `${1.5 + depth * 1.5}rem` }}
        draggable
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(node.id) }}
        onDragEnter={e => { e.preventDefault(); onDragEnter(node.id) }}
        onDragOver={e => e.preventDefault()}
        onDragEnd={onDragEnd}
      >
        <div className="budget-row-left">
          <DragHandle />
          <button
            className={'budget-dot-btn' + (hasChildren ? ' budget-dot-btn--expandable' : '')}
            style={{ background: color }}
            onClick={() => hasChildren && setExpanded(e => !e)}
            aria-label={hasChildren ? (expanded ? 'Collapse' : 'Expand') : undefined}
          >
            {hasChildren && (
              <svg className={'dot-chevron' + (expanded ? ' dot-chevron--open' : '')} width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1.5 3L4 5.5L6.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="budget-cat-name">{node.category}</span>
              {isSub && <SubBadge />}
              {isIncome && <IncomeBadge />}
            </div>
            {hasChildren && <div className="budget-cat-sub">{node.children.length} subcategor{node.children.length !== 1 ? 'ies' : 'y'}</div>}
          </div>
        </div>
        <div className="budget-row-right">
          <div className="budget-bar-wrap">
            <div className="budget-bar-labels">
              <span className="budget-bar-pct-secondary muted">—</span>
              <span className="budget-bar-pct-secondary">{formatCurrency(node.monthly_limit)}</span>
            </div>
            <div className="bar-track" style={{ background: 'var(--bg-secondary)' }}>
              <div className="bar-fill" style={{ width: '0%', background: color }} />
            </div>
          </div>
          <div className="budget-remaining-col">
            <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {formatCurrency(node.monthly_limit)}
            </span>
          </div>
          <RowMoreMenu items={[
            { label: 'Edit', onClick: () => onEdit(node) },
            !isRecurring && { label: 'Delete', danger: true, onClick: () => onDelete(node.id) },
          ]} />
        </div>
      </div>

      {hasChildren && expanded && node.children.map(child => (
        <TemplateRow key={child.id} node={child} allCategories={allCategories} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} dragState={dragState} onDragStart={onDragStart} onDragEnter={onDragEnter} onDragEnd={onDragEnd} subByCatId={subByCatId} month={month} />
      ))}
    </>
  )
}

// ── Main Budget page ──────────────────────────────────────────────────────────

function Budget() {
  document.title = 'Pinance | Budget'
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState(() =>
    searchParams.get('view') === 'template' ? 'template' : 'monthly'
  )

  useEffect(() => {
    const urlView = searchParams.get('view') === 'template' ? 'template' : 'monthly'
    setView(urlView)
  }, [searchParams])

  const handleSetView = (v) => {
    setView(v)
    if (v === 'template') setSearchParams({ view: 'template' })
    else setSearchParams({})
  }
  const [month, setMonth]         = useState(currentMonth())
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing]     = useState(null)

  const { data: budget = [], isLoading: loadingBudget } = useBudget({ month })
  const { data: bills = [] } = useBills()
  const { data: incomeSources = [] } = useIncomeSources()
  const saveBudgetCategory   = useSaveBudgetCategory()
  const updateBudgetCategory = useUpdateBudgetCategory()
  const deleteCategory       = useDeleteBudgetCategory()
  const reorderBudget        = useReorderBudget()
  const updateBill           = useUpdateBill()
  const updateIncome         = useUpdateIncomeSource()

  const { data: template = [], isLoading: loadingTemplate } = useBudgetTemplate()
  const saveTmpl        = useSaveBudgetTemplate()
  const updateTmpl      = useUpdateBudgetTemplate()
  const deleteTmpl      = useDeleteBudgetTemplate()
  const syncFromCurrent = useSyncTemplateFromCurrent()
  const reorderTemplate = useReorderBudgetTemplate()

  const [dragState, setDragState] = useState({ draggingId: null, overId: null })
  const dragRef = useRef({ draggingId: null, overId: null })

  const subByCatId = useMemo(() => {
    const map = {}
    for (const sub of bills) {
      for (const charge of sub.charges || []) {
        if (charge.budget_category_id && !charge.effective_to) {
          map[charge.budget_category_id] = { sub, charge }
        }
      }
    }
    return map
  }, [bills])

  const incomeByCatId = useMemo(() => {
    const map = {}
    for (const src of incomeSources) {
      for (const schedule of src.schedules || []) {
        if (schedule.budget_category_id && !schedule.effective_to) {
          map[schedule.budget_category_id] = { src, schedule }
        }
      }
    }
    return map
  }, [incomeSources])

  const [inlineEdit,   setInlineEdit]   = useState(null)
  const [intentTarget, setIntentTarget] = useState(null)

  const isTemplate = view === 'template'
  const categories = isTemplate ? template : budget
  const isLoading  = isTemplate ? loadingTemplate : loadingBudget
  const tree       = buildCategoryTree(categories)

  const totalLimit = tree.reduce((s, node) => s + sumLimit(node), 0)
  const totalSpent = tree.reduce((s, node) => s + sumSpent(node), 0)
  const remaining  = totalLimit - totalSpent

  const handleSave = async (form) => {
    try {
      const formWithMonth = { ...form, month }
      if (isTemplate) {
        if (editing) await updateTmpl.mutateAsync({ id: editing.id, data: formWithMonth })
        else         await saveTmpl.mutateAsync(formWithMonth)
      } else {
        if (editing) await updateBudgetCategory.mutateAsync({ id: editing.id, data: formWithMonth })
        else         await saveBudgetCategory.mutateAsync(formWithMonth)
      }
      setShowModal(false)
      setEditing(null)
    } catch (err) {
      console.error(err)
    }
  }

  const handleEdit = (node) => {
    setEditing({ ...node, monthly_limit: node.monthly_limit, parent_id: node.parent_id || null })
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    const node = categories.find(c => c.id === id)
    if (node?.managed_by_bill || node?.managed_by_income || node?.is_bill || node?.is_income || node?.bill_id || node?.income_id) return
    if (!window.confirm('Delete this category? Subcategories will become top-level.')) return
    if (isTemplate) await deleteTmpl.mutateAsync(id)
    else            await deleteCategory.mutateAsync(id)
  }

  const handleDragStart = (id) => { dragRef.current = { draggingId: id, overId: id }; setDragState({ draggingId: id, overId: id }) }
  const handleDragEnter = (id) => { dragRef.current.overId = id; setDragState(s => ({ ...s, overId: id })) }

  const handleDragEnd = async () => {
    const draggingId = dragRef.current.draggingId
    const overId     = dragRef.current.overId
    setDragState({ draggingId: null, overId: null })
    if (!draggingId || !overId || draggingId === overId) return
    const allRows  = isTemplate ? template : budget
    const dragNode = allRows.find(r => r.id === draggingId)
    const overNode = allRows.find(r => r.id === overId)
    if (!dragNode || !overNode) return
    if (dragNode.parent_id !== overNode.parent_id) return
    const siblings  = allRows.filter(r => r.parent_id === dragNode.parent_id)
    const without   = siblings.filter(r => r.id !== draggingId)
    const targetIdx = without.findIndex(r => r.id === overId)
    without.splice(targetIdx, 0, dragNode)
    const items = without.map((r, i) => ({ id: r.id, sort_order: i }))
    try {
      if (isTemplate) await reorderTemplate.mutateAsync({ items })
      else            await reorderBudget.mutateAsync({ items })
    } catch (err) {
      console.error('Reorder failed', err)
    }
  }

  const handleSyncFromCurrent = async () => {
    const msg = isTemplate
      ? `Overwrite the template with ${month}'s budget categories and limits?`
      : `Save ${month}'s budget to the template? This will overwrite the existing template.`
    if (!window.confirm(msg)) return
    await syncFromCurrent.mutateAsync({ month })
  }

  const handleClose = () => { setShowModal(false); setEditing(null) }

  const handleInlineEditStart = (node, subEntry, incEntry) => {
    setInlineEdit({
      nodeId:        node.id,
      originalValue: String(node.monthly_limit),
      value:         String(node.monthly_limit),
      subEntry,
      incEntry,
    })
  }

  const handleInlineEditChange = (val) => {
    setInlineEdit(e => e ? { ...e, value: val } : e)
  }

  const handleInlineEditCommit = (cancel = false) => {
    if (!inlineEdit) return
    const { nodeId, originalValue, value, subEntry, incEntry } = inlineEdit
    setInlineEdit(null)
    if (cancel || value === originalValue || isNaN(parseFloat(value))) return
    setIntentTarget({ nodeId, subEntry, incEntry, newValue: value })
  }

  const handleIntentResolve = async (resolution) => {
    if (!resolution || !intentTarget) { setIntentTarget(null); return }
    const { subEntry, incEntry, newValue } = intentTarget
    setIntentTarget(null)
    try {
      if (subEntry) {
        const { sub, charge } = subEntry
        await updateBill.mutateAsync({
          id: sub.id,
          data: {
            name:               sub.name,
            description:        sub.description || sub.notes || '',
            parent_category_id: sub.parent_category_id,
            color:              sub.color,
            account_id:         sub.account_id,
            status:             sub.status,
            pause_until:        sub.pause_until,
            started_on:         sub.started_on,
            notes:              sub.notes || '',
            charges: sub.charges.filter(c => !c.effective_to).map(c => ({
              id:             c.id,
              label:          c.label,
              amount:         c.id === charge.id ? parseFloat(newValue) : c.amount,
              frequency:      c.frequency,
              anchor_date:    c.anchor_date,
              effective_from: c.effective_from,
              account_id:     c.account_id || null,
            })),
            _intents: [{ charge_id: charge.id, ...resolution }],
          },
        })
      } else if (incEntry) {
        const { src, schedule } = incEntry
        await updateIncome.mutateAsync({
          id: src.id,
          data: {
            name:               src.name,
            description:        src.description || src.notes || '',
            parent_category_id: src.parent_category_id,
            color:              src.color,
            account_id:         src.account_id,
            status:             src.status,
            started_on:         src.started_on,
            notes:              src.notes || '',
            schedules: src.schedules.filter(s => !s.effective_to).map(s => ({
              id:             s.id,
              label:          s.label,
              amount:         s.id === schedule.id ? parseFloat(newValue) : s.amount,
              frequency:      s.frequency,
              anchor_date:    s.anchor_date,
              effective_from: s.effective_from,
              account_id:     s.account_id || null,
              custom_days:    s.custom_days || null,
            })),
            _intents: [{ schedule_id: schedule.id, ...resolution }],
          },
        })
      }
    } catch (err) { console.error(err) }
  }

  if (isLoading) return <div className="loading">Loading budget...</div>

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Budget</h1>
          <MonthPicker value={month} onChange={setMonth} />
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="budget-view-toggle">
            <button className={`budget-view-btn${!isTemplate ? ' active' : ''}`} onClick={() => handleSetView('monthly')}>Monthly</button>
            <button className={`budget-view-btn${isTemplate  ? ' active' : ''}`} onClick={() => handleSetView('template')}>Template</button>
          </div>
          <button className="btn-ghost" onClick={handleSyncFromCurrent} disabled={syncFromCurrent.isPending} title={isTemplate ? `Overwrite template with ${month}` : `Save ${month} to template`}>
            {isTemplate ? `↓ Sync from ${month}` : `↑ Sync to template`}
          </button>
          <button className="btn-primary" onClick={() => setShowModal(true)}>+ Add category</button>
        </div>
      </div>

      {!isTemplate && (
        <div className="grid-4" style={{ marginBottom: '1.75rem' }}>
          <div className="card metric-card"><div className="metric-label">Total Budget</div><div className="metric-value">{formatCurrency(totalLimit)}</div></div>
          <div className="card metric-card"><div className="metric-label">Total Spent</div><div className="metric-value">{formatCurrency(totalSpent)}</div></div>
          <div className="card metric-card">
            <div className="metric-label">Remaining</div>
            <div className={`metric-value ${remaining >= 0 ? 'up' : 'down'}`}>{formatCurrency(Math.abs(remaining))}</div>
            <div className={`metric-sub ${remaining >= 0 ? 'up' : 'down'}`}>{remaining >= 0 ? 'under budget' : 'over budget'}</div>
          </div>
          <div className="card metric-card"><div className="metric-label">Categories</div><div className="metric-value">{budget.length}</div></div>
        </div>
      )}

      {isTemplate && (
        <div className="card" style={{ marginBottom: '1.75rem', minHeight: '6.8rem', display: 'flex', alignItems: 'center' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            The template defines default categories and limits applied to each new month. Changes here do not affect existing monthly budgets.
            Use <strong style={{ color: 'var(--text)' }}>↓ Sync from {month}</strong> to overwrite the template with the current month's setup.
          </p>
        </div>
      )}

      {categories.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ fontSize: '13px' }}>
            {isTemplate ? 'No template categories yet. Add one to get started.' : 'No budget categories yet. Add one to get started.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="budget-col-headers">
            <span className="col-header-label" style={{ flex: 1 }}>Category</span>
            <div className="budget-row-right">
              <div className="budget-bar-wrap">
                <div className="budget-bar-labels">
                  <span className="col-header-label">{isTemplate ? 'Default' : 'Actual'}</span>
                  <span className="col-header-label">Budgeted</span>
                </div>
              </div>
              <div className="budget-remaining-col col-header-label">Remaining</div>
              <div style={{ visibility: 'hidden', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                <button className="btn-ghost" style={{ padding: '4px 6px' }}><span style={{ width: '14px', display: 'block' }} /></button>
              </div>
            </div>
          </div>
          {tree.map(node =>
            isTemplate ? (
              <TemplateRow key={node.id} node={node} allCategories={categories} onEdit={handleEdit} onDelete={handleDelete} dragState={dragState} onDragStart={handleDragStart} onDragEnter={handleDragEnter} onDragEnd={handleDragEnd} subByCatId={subByCatId} month={month} />
            ) : (
              <BudgetRow key={node.id} node={node} allCategories={categories} onEdit={handleEdit} onDelete={handleDelete} dragState={dragState} onDragStart={handleDragStart} onDragEnter={handleDragEnter} onDragEnd={handleDragEnd} subByCatId={subByCatId} incomeByCatId={incomeByCatId} month={month} inlineEdit={inlineEdit} onInlineEditStart={handleInlineEditStart} onInlineEditChange={handleInlineEditChange} onInlineEditCommit={handleInlineEditCommit} />
            )
          )}
        </div>
      )}

      {showModal && (
        <CategoryModal
          initial={editing}
          categories={categories}
          onClose={handleClose}
          onSave={handleSave}
          loading={saveBudgetCategory.isPending || updateBudgetCategory.isPending || saveTmpl.isPending || updateTmpl.isPending}
          title={editing ? `Edit ${isTemplate ? 'template' : 'category'}` : `Add ${isTemplate ? 'template' : 'category'}`}
        />
      )}

      {intentTarget && (
        <ChangeIntentModal
          row={{
            label:       intentTarget.subEntry?.charge?.label || intentTarget.incEntry?.schedule?.label || 'Amount',
            amount:      intentTarget.newValue,
            frequency:   intentTarget.subEntry?.charge?.frequency || intentTarget.incEntry?.schedule?.frequency,
            anchor_date: intentTarget.subEntry?.charge?.anchor_date || intentTarget.incEntry?.schedule?.anchor_date,
            account_id:  intentTarget.subEntry?.charge?.account_id || intentTarget.incEntry?.schedule?.account_id,
          }}
          original={{
            label:       intentTarget.subEntry?.charge?.label || intentTarget.incEntry?.schedule?.label || 'Amount',
            amount:      intentTarget.subEntry?.charge?.amount || intentTarget.incEntry?.schedule?.amount,
            frequency:   intentTarget.subEntry?.charge?.frequency || intentTarget.incEntry?.schedule?.frequency,
            anchor_date: intentTarget.subEntry?.charge?.anchor_date || intentTarget.incEntry?.schedule?.anchor_date,
            account_id:  intentTarget.subEntry?.charge?.account_id || intentTarget.incEntry?.schedule?.account_id,
          }}
          rowIndex={0}
          totalDirty={1}
          onResolve={handleIntentResolve}
        />
      )}
    </div>
  )
}

export default Budget