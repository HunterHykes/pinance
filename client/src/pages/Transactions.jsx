import { useState, useMemo, useRef, useEffect } from 'react'
import { PageDateRangeTrigger } from '../components/DateRangePicker'
import { Scissors, ChevronDown, ChevronRight } from 'lucide-react'
import {
  useTransactions,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction
} from '../hooks/useTransactions'
import { useAccounts } from '../hooks/useAccounts'
import { useBudget } from '../hooks/useBudget'
import { formatCurrency, formatDate, currentMonth, resolveColor } from '../utils'
import { getSplits, saveSplits, deleteSplits } from '../api'
import { useQueryClient } from '@tanstack/react-query'
import TreeSelect from '../components/TreeSelect'
import { ColumnFilterDropdown } from '../components/DataTable'
import RowMoreMenu from '../components/RowMoreMenu'
import { CurrencyInput } from '../components/FormControls'
import TransactionModal from '../components/TransactionModal'
const TXN_COLS = 'minmax(52px,64px) minmax(0,1fr) minmax(120px,180px) minmax(100px,160px) minmax(60px,140px) minmax(160px,220px)'

function TxnRow({ txn, allCategories, accountsById, onEdit, onDelete, showSplitContext = false }) {
  const [expanded, setExpanded] = useState(false)
  const isSplitChild = !!txn.is_split_child
  const isIncome     = txn.amount > 0
  const isSplit      = !!txn.is_split && !isSplitChild
  const category     = allCategories.find(c => c.category === txn.category)
  const color        = resolveColor(category, allCategories)

  const accountName    = txn.account_id ? (accountsById[txn.account_id]?.name || '') : ''
  const manualCategory = txn.category && txn.category !== txn.plaid_category ? txn.category : null

  return (
    <>
      <div className="acct-tbl-row">
        <div className="txn-date-col">{formatDate(txn.date)}</div>

        <div className="txn-row-left">
          <div
            className="budget-color-dot"
            style={{ background: color, flexShrink: 0, cursor: isSplit ? 'pointer' : 'default' }}
            onClick={() => isSplit && setExpanded(e => !e)}
          >
            {isSplit && (expanded
              ? <ChevronDown size={8} style={{ display: 'block', color: 'white' }} />
              : <ChevronRight size={8} style={{ display: 'block', color: 'white' }} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="txn-name">{txn.description}</div>
            {txn.plaid_category && <div className="txn-meta">{txn.plaid_category}</div>}
            {!!txn.pending && <div className="txn-meta">Pending</div>}
            {showSplitContext && <div className="txn-meta">{txn.parent_description}</div>}
          </div>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden' }}>
          {manualCategory || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
        </div>

        <div className="txn-account-col">{accountName}</div>

        <span className="txn-notes-col" title={txn.notes || ''}>{txn.notes || ''}</span>

        <div className="txn-row-right">
          {(isSplit || showSplitContext) && (
            <span className={showSplitContext ? 'badge-split-child' : 'badge-split'} onClick={isSplit ? () => setExpanded(e => !e) : undefined} style={isSplit ? { cursor: 'pointer' } : {}}>
              <Scissors size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '2px' }} />
              Split
            </span>
          )}
          <div className={`txn-amount ${isIncome ? 'up' : 'down'}`}>
            {`${isIncome ? '+' : '-'}${formatCurrency(Math.abs(txn.amount))}`}
          </div>
          <RowMoreMenu items={[
            { label: 'Edit', onClick: () => isSplitChild ? onEdit(txn.parent_txn, 'splits') : onEdit(txn) },
            txn.source === 'manual' && !isSplit && { label: 'Delete', danger: true, onClick: () => onDelete(txn.id) },
          ]} />
        </div>
      </div>

      {isSplit && expanded && txn.splits?.map((sp, i) => {
        const spCat   = allCategories.find(c => c.category === sp.category)
        const spColor = resolveColor(spCat, allCategories)
        return (
          <div key={i} className="acct-tbl-row acct-tbl-row--child">
            <div className="txn-date-col" />
            <div className="txn-row-left">
              <div className="budget-color-dot" style={{ background: spColor, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div className="txn-name">{txn.description}</div>
                {sp.notes && <div className="txn-meta">{sp.notes}</div>}
              </div>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden' }}>{sp.category}</div>
            <div className="txn-account-col" />
            <div className="txn-notes-col" />
            <div className="txn-row-right">
              <div className="txn-amount down">-{formatCurrency(Math.abs(sp.amount))}</div>
              <RowMoreMenu items={[
                { label: 'Edit splits', onClick: () => onEdit(txn, 'splits') },
              ]} />
            </div>
          </div>
        )
      })}
    </>
  )
}

function Transactions() {
  document.title = 'Pinance | Transactions'
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10) })
  const [dateTo,   setDateTo]   = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10) })
  const [showModal, setShowModal]   = useState(false)
  const [editing, setEditing]       = useState(null)
  const [filterCat,  setFilterCat]  = useState('')
  const [amountMin, setAmountMin]   = useState('')
  const [amountMax, setAmountMax]   = useState('')
  const [sortOrder, setSortOrder]       = useState('desc')
  const [dateSortOrder, setDateSortOrder] = useState('desc')
  const [openFilter, setOpenFilter] = useState(null)

  const toggleFilter = (name) => setOpenFilter(f => f === name ? null : name)
  const headerRef = useRef(null)
  useEffect(() => {
    const handler = (e) => { if (headerRef.current && !headerRef.current.contains(e.target)) setOpenFilter(null) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const { data: allTransactions = [], isLoading } = useTransactions({ date_from: dateFrom, date_to: dateTo })
  const { data: accounts = [] } = useAccounts()
  const { data: budget   = [] } = useBudget()

  const [filterAcct, setFilterAcct] = useState(new Set())

  const accountsById = useMemo(() =>
    accounts.reduce((acc, a) => { acc[a.id] = a; return acc }, {}),
  [accounts])

  const acctNames = useMemo(() => accounts.map(a => a.name), [accounts])

  const matchSet = useMemo(() => {
    const set = new Set()
    if (!filterCat) return set
    function collect(catName) {
      set.add(catName)
      budget.filter(c => budget.find(p => p.id === c.parent_id)?.category === catName)
            .forEach(child => collect(child.category))
    }
    collect(filterCat)
    return set
  }, [filterCat, budget])

  const filteredTransactions = useMemo(() => {
    if (!filterCat) return allTransactions
    const result = []
    for (const t of allTransactions) {
      if (!t.is_split) {
        if (matchSet.has(t.category)) result.push(t)
      } else {
        const matchingSplits = (t.splits || []).filter(sp => matchSet.has(sp.category))
        for (const sp of matchingSplits) {
          result.push({ ...sp, id: `split-${sp.id}`, parent_id: t.id, parent_txn: t, date: t.date, description: t.description, plaid_category: t.plaid_category, source: t.source, pending: t.pending, is_split_child: true })
        }
      }
    }
    return result
  }, [allTransactions, filterCat, matchSet])

  const transactions = useMemo(() => {
    let result = filteredTransactions
    if (filterAcct.size === 1 && filterAcct.has('__none__')) {
      result = []
    } else if (filterAcct.size > 0) {
      result = result.filter(t => { const acct = accountsById[t.account_id]; return acct && filterAcct.has(acct.name) })
    }
    if (amountMin !== '') result = result.filter(t => Math.abs(t.amount) >= parseFloat(amountMin))
    if (amountMax !== '') result = result.filter(t => Math.abs(t.amount) <= parseFloat(amountMax))
    return [...result].sort((a, b) => {
      const dateCmp = dateSortOrder === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
      if (dateCmp !== 0) return dateCmp
      return sortOrder === 'asc' ? Math.abs(a.amount) - Math.abs(b.amount) : Math.abs(b.amount) - Math.abs(a.amount)
    })
  }, [filteredTransactions, filterAcct, accountsById, amountMin, amountMax, sortOrder, dateSortOrder])

  const createTransaction = useCreateTransaction()
  const updateTransaction = useUpdateTransaction()
  const deleteTransaction = useDeleteTransaction()
  const queryClient       = useQueryClient()

  const acctBtnRef = useRef(null)
  const [acctFilterOpen, setAcctFilterOpen] = useState(false)

  const handleAcctToggle = (name) => {
    setFilterAcct(prev => {
      let next
      if (prev.size === 0) {
        next = new Set(acctNames.filter(n => n !== name))
        if (next.size === 0) next = new Set(['__none__'])
      } else {
        next = new Set(prev)
        if (next.has(name)) next.delete(name); else next.add(name)
        if (next.size === 0) next = new Set(['__none__'])
      }
      if (acctNames.length > 0 && acctNames.every(n => next.has(n))) next = new Set()
      return next
    })
  }

  const handleAcctSelectAll = () => {
    setFilterAcct(prev => prev.size === 0 ? new Set(['__none__']) : new Set())
  }

  const isAcctFiltered = filterAcct.size > 0

  const totalIn  = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalOut = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const net      = totalIn - totalOut

  const handleSave = async (form) => {
    try {
      if (editing) await updateTransaction.mutateAsync({ id: editing.id, data: form })
      else         await createTransaction.mutateAsync(form)
      setShowModal(false); setEditing(null)
    } catch (err) { console.error(err) }
  }

  const handleSaveSplits = async (txnId, splits) => {
    await saveSplits(txnId, { splits })
    queryClient.invalidateQueries({ queryKey: ['transactions'] })
    queryClient.invalidateQueries({ queryKey: ['budget'] })
  }

  const handleRemoveSplits = async (txnId) => {
    await deleteSplits(txnId)
    queryClient.invalidateQueries({ queryKey: ['transactions'] })
    queryClient.invalidateQueries({ queryKey: ['budget'] })
  }

  const handleEdit = async (txn, defaultTab = 'details') => {
    let splits = []
    if (txn.is_split) {
      try { splits = (await getSplits(txn.id)).data } catch (_) {}
    }
    setEditing({ ...txn, amount: Math.abs(txn.amount), type: txn.amount > 0 ? 'income' : 'expense', plaid_category: txn.plaid_category || '', splits, defaultTab })
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this transaction?')) return
    await deleteTransaction.mutateAsync(id)
  }

  if (isLoading) return <div className="loading">Loading transactions...</div>

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <PageDateRangeTrigger
            from={dateFrom} to={dateTo}
            onChange={({ from, to }) => {
              if (from !== undefined) setDateFrom(from || '')
              if (to !== undefined) setDateTo(to || '')
            }}
          />
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Add transaction</button>
      </div>

      <div className="grid-4" style={{ marginBottom: '1.75rem' }}>
        <div className="card metric-card"><div className="metric-label">Money In</div><div className="metric-value up">{formatCurrency(totalIn)}</div></div>
        <div className="card metric-card"><div className="metric-label">Money Out</div><div className="metric-value down">{formatCurrency(totalOut)}</div></div>
        <div className="card metric-card"><div className="metric-label">Net</div><div className={`metric-value ${net >= 0 ? 'up' : 'down'}`}>{formatCurrency(net)}</div></div>
        <div className="card metric-card"><div className="metric-label">Transactions</div><div className="metric-value">{transactions.length}</div></div>
      </div>

      <div className="card" style={{ padding: 0, '--dt-cols': TXN_COLS }}>
        <div className="acct-tbl-header" ref={headerRef}>

          <div className="txn-filter-cell">
            <button className="txn-col-header-btn" onClick={() => toggleFilter('date')}>
              <span className="col-header-label">Date</span>
              <svg className="txn-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {openFilter === 'date' && (
              <div className="txn-filter-dropdown" style={{ minWidth: '180px', padding: '10px 12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Sort</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {[['desc', '↓', 'Newer to Older'], ['asc', '↑', 'Older to Newer']].map(([dir, arrow, label]) => (
                    <button key={dir} className={dateSortOrder === dir ? 'btn-range-active' : 'btn-range'}
                      onClick={() => { setDateSortOrder(dir); setOpenFilter(null) }}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', textAlign: 'left' }}>
                      <span style={{ fontWeight: 700, width: '12px', flexShrink: 0 }}>{arrow}</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <span className="col-header-label">Vendor</span>

          <div className="txn-filter-cell">
            <TreeSelect value={filterCat} onChange={v => setFilterCat(v)} categories={budget} placeholder="Category" selectableParents={true} allowClear={true} />
          </div>

          <div className="txn-filter-cell">
            <button ref={acctBtnRef} className={`acct-sort-col${isAcctFiltered ? ' acct-sort-col--filtered' : ''}`} onClick={() => setAcctFilterOpen(o => !o)}>
              <span>Account</span>
              <ChevronDown size={9} style={{ opacity: isAcctFiltered ? 1 : 0.5, flexShrink: 0 }} />
            </button>
            {acctFilterOpen && (
              <ColumnFilterDropdown
                anchorRef={acctBtnRef} col="account" values={acctNames} selected={filterAcct}
                sortCol={null} sortDir={null} onSortAsc={() => {}} onSortDesc={() => {}}
                onToggle={handleAcctToggle} onSelectAll={handleAcctSelectAll} onClose={() => setAcctFilterOpen(false)}
              />
            )}
          </div>

          <span className="col-header-label">Notes</span>

          <div className="txn-filter-cell" style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: '40px' }}>
            <button className="txn-col-header-btn" onClick={() => toggleFilter('amount')}>
              <span className="col-header-label">Amount</span>
              <svg className="txn-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {openFilter === 'amount' && (
              <div className="txn-filter-dropdown" style={{ minWidth: '200px', padding: '10px 12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Sort</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                  {[['desc', '↓', 'Larger to Smaller'], ['asc', '↑', 'Smaller to Larger']].map(([dir, arrow, label]) => (
                    <button key={dir} className={sortOrder === dir ? 'btn-range-active' : 'btn-range'}
                      onClick={() => setSortOrder(dir)}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', textAlign: 'left' }}>
                      <span style={{ fontWeight: 700, width: '12px', flexShrink: 0 }}>{arrow}</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Amount range</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input type="number" value={amountMin} onChange={e => setAmountMin(e.target.value)} placeholder="Min" className="filter-input" style={{ width: '80px' }} min="0" step="0.01" />
                  <span style={{ color: 'var(--text-tertiary)' }}>–</span>
                  <input type="number" value={amountMax} onChange={e => setAmountMax(e.target.value)} placeholder="Max" className="filter-input" style={{ width: '80px' }} min="0" step="0.01" />
                </div>
                {(amountMin || amountMax) && (
                  <button className="btn-ghost" style={{ fontSize: '11px', marginTop: '8px', width: '100%' }} onClick={() => { setAmountMin(''); setAmountMax('') }}>Clear range</button>
                )}
              </div>
            )}
          </div>
        </div>

        {transactions.length === 0 ? (
          <p className="muted" style={{ fontSize: '13px', padding: '1.25rem 1.5rem' }}>No transactions found.</p>
        ) : (
          transactions.map(txn => (
            <TxnRow key={txn.id} txn={txn} allCategories={budget} accountsById={accountsById} onEdit={handleEdit} onDelete={handleDelete} showSplitContext={!!txn.is_split_child} />
          ))
        )}
      </div>

      {showModal && (
        <TransactionModal
          initial={editing} accounts={accounts} categories={budget}
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSave={handleSave} onSaveSplits={handleSaveSplits} onRemoveSplits={handleRemoveSplits}
          loading={createTransaction.isPending || updateTransaction.isPending}
        />
      )}
    </div>
  )
}

export default Transactions