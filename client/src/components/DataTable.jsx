// DataTable.jsx — shared table shell used by Accounts (and extensible to other pages).
//
// Column definition shape:
//   { key, label, width, minWidth?, sortable?, filter?, align?, actions? }
//
// The component sets --dt-cols on the container so every .acct-tbl-row child
// (and .acct-group-row, etc.) inherits the grid template automatically.
//
// NEW: accepts a `footer` prop (ReactNode) rendered at the bottom of the card.
// Use <TableFooterRow> for a standard totals footer.

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'

// ── Grid template builder ─────────────────────────────────────────────────────

export function buildGridTemplate(columns) {
  return columns.map(c => {
    if (c.actions) return '36px'
    const isFr = String(c.width).includes('fr')
    const min  = c.minWidth ?? (isFr ? '0' : 'min-content')
    return `minmax(${min}, ${c.width})`
  }).join(' ')
}

// ── Sort icon ─────────────────────────────────────────────────────────────────

function SortIcon({ col, sortCol, sortDir }) {
  if (col !== sortCol) return <ChevronsUpDown size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
  return sortDir === 'asc'
    ? <ChevronUp   size={10} style={{ flexShrink: 0 }} />
    : <ChevronDown size={10} style={{ flexShrink: 0 }} />
}

// ── Checkbox filter dropdown (portal) ─────────────────────────────────────────

export function ColumnFilterDropdown({
  anchorRef, col, values, selected, sortCol, sortDir,
  onSortAsc, onSortDesc, onToggle, onSelectAll, onClose,
}) {
  const [pos,    setPos]    = useState(null)
  const [search, setSearch] = useState('')
  const dropRef   = useRef(null)
  const listRef   = useRef(null)
  const searchRef = useRef(null)
  const noneSelected = selected.size === 1 && selected.has('__none__')
  const allSelected  = selected.size === 0

  const dropWidth = Math.max(180, ...values.map(v => Math.ceil((v || '—').length * 7) + 44))

  useLayoutEffect(() => {
    if (!anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - dropWidth - 8) })
  }, [anchorRef, dropWidth])

  useEffect(() => {
    const h = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
          !anchorRef.current?.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [anchorRef, onClose])

  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      const list = listRef.current
      if (list && (list === e.target || list.contains(e.target))) list.scrollTop += e.deltaY
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [pos])

  useEffect(() => { setTimeout(() => searchRef.current?.focus(), 40) }, [])

  if (!pos) return null

  const searchLower = search.toLowerCase()
  const filtered    = search ? values.filter(v => (v || '—').toLowerCase().includes(searchLower)) : values

  const rowBase = {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '6px 12px', fontSize: '13px', cursor: 'pointer',
    borderBottom: '1px solid var(--border)', userSelect: 'none',
  }

  return createPortal(
    <div ref={dropRef} style={{
      position: 'fixed', top: pos.top, left: pos.left, width: dropWidth,
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      zIndex: 9999, overflow: 'hidden',
    }}>
      <div style={{ borderBottom: '1px solid var(--border)', padding: '4px 0' }}>
        <div style={{ padding: '4px 12px 2px', fontSize: '10px', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-tertiary)' }}>
          Sort
        </div>
        {[['asc', '↑ A → Z', sortCol === col && sortDir === 'asc'],
          ['desc', '↓ Z → A', sortCol === col && sortDir === 'desc']
        ].map(([dir, label, active]) => (
          <div key={dir} onClick={dir === 'asc' ? onSortAsc : onSortDesc}
            style={{ ...rowBase, borderBottom: 'none', padding: '4px 12px',
              color: active ? 'var(--accent)' : 'var(--text)', fontWeight: active ? 500 : 400 }}>
            {label}
          </div>
        ))}
      </div>
      <div className="tree-search-wrap" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <input ref={searchRef} type="text" className="tree-search-input"
          placeholder="Search..." value={search}
          onChange={e => setSearch(e.target.value)}
          onClick={e => e.stopPropagation()} />
        {search && (
          <button type="button" tabIndex={-1}
            onClick={e => { e.stopPropagation(); setSearch('') }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
              color: 'var(--text-tertiary)', fontSize: '15px', lineHeight: 1, flexShrink: 0 }}>
            ×
          </button>
        )}
      </div>
      <div ref={listRef} style={{ maxHeight: 240, overflowY: 'auto', scrollbarWidth: 'none' }}>
        {!search && (
          <div onClick={onSelectAll}
            style={{ ...rowBase, background: 'transparent', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={allSelected} onChange={() => {}}
              onClick={e => { e.stopPropagation(); onSelectAll() }}
              style={{ width: 'auto', cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontStyle: 'italic' }}>Select All</span>
          </div>
        )}
        {filtered.map(v => (
          <div key={v} onClick={() => onToggle(v)}
            style={{ ...rowBase, background: 'transparent', color: 'var(--text)' }}>
            <input type="checkbox"
              checked={!noneSelected && (allSelected || selected.has(v))}
              onChange={() => {}}
              onClick={e => { e.stopPropagation(); onToggle(v) }}
              style={{ width: 'auto', cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }} />
            <span>{v || '—'}</span>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
            No matches
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ── Filterable column header ───────────────────────────────────────────────────

function FilterColHeader({ colKey, label, sortCol, sortDir, isActive, filter, values, onSort, onFilterToggle, onFilterSelectAll }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  return (
    <div>
      <button ref={btnRef}
        className={`acct-sort-col${sortCol === colKey ? ' acct-sort-col--active' : ''}${isActive ? ' acct-sort-col--filtered' : ''}`}
        onClick={() => setOpen(o => !o)}>
        <span>{label}</span>
        <ChevronDown size={9} style={{ opacity: isActive ? 1 : 0.5, flexShrink: 0 }} />
      </button>
      {open && (
        <ColumnFilterDropdown
          anchorRef={btnRef} col={colKey}
          values={values} selected={filter}
          sortCol={sortCol} sortDir={sortDir}
          onSortAsc={() => { onSort(colKey, 'asc'); setOpen(false) }}
          onSortDesc={() => { onSort(colKey, 'desc'); setOpen(false) }}
          onToggle={v => onFilterToggle(colKey, v)}
          onSelectAll={() => onFilterSelectAll(colKey)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

// ── DataTableHeader ───────────────────────────────────────────────────────────

function DataTableHeader({ columns, sortCol, sortDir, onSort, filters, onFilterToggle, onFilterSelectAll, uniqueValues, stickyTop }) {
  return (
    <div className="acct-tbl-header" style={{ top: stickyTop }}>
      {columns.map((col, i) => {
        if (col.actions) return <div key={`_actions_${i}`} />

        if (col.filter === 'checkbox') {
          return (
            <FilterColHeader
              key={col.key}
              colKey={col.key}
              label={col.label}
              sortCol={sortCol} sortDir={sortDir}
              isActive={(filters?.[col.key]?.size ?? 0) > 0}
              filter={filters?.[col.key] || new Set()}
              values={uniqueValues?.[col.key] || []}
              onSort={onSort}
              onFilterToggle={onFilterToggle}
              onFilterSelectAll={onFilterSelectAll}
            />
          )
        }

        if (col.sortable) {
          const right = col.align === 'right'
          return (
            <button key={col.key}
              className={`acct-sort-col${sortCol === col.key ? ' acct-sort-col--active' : ''}`}
              style={right ? { justifyContent: 'flex-end', width: '100%' } : {}}
              onClick={() => onSort(col.key)}>
              {right && <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />}
              <span>{col.label}</span>
              {!right && <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />}
            </button>
          )
        }

        if (!col.label) return <div key={col.key || `_spacer_${i}`} />

        return (
          <span key={col.key || `_col_${i}`} className="acct-sort-col"
            style={{ cursor: 'default', pointerEvents: 'none',
              ...(col.align === 'right' ? { justifyContent: 'flex-end' } : {}) }}>
            {col.label}
          </span>
        )
      })}
    </div>
  )
}

// ── TableFooterRow ────────────────────────────────────────────────────────────
// Convenience component for rendering a totals footer inside a DataTable.
//
// Usage:
//   <DataTable columns={COLS} ... footer={
//     <TableFooterRow columns={COLS} cells={[null, 'Total', null, <span>$1,234</span>]} />
//   }>
//
// `cells` array maps 1:1 to columns. Pass null for empty cells.

export function TableFooterRow({ columns, cells = [] }) {
  return (
    <div className="tbl-footer-row" style={{ gridTemplateColumns: 'var(--dt-cols)' }}>
      {columns.map((col, i) => {
        const cell = cells[i] ?? null
        const right = col.align === 'right' || col.actions
        return (
          <div key={col.key || `_f_${i}`} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: right ? 'flex-end' : 'flex-start',
          }}>
            {cell}
          </div>
        )
      })}
    </div>
  )
}

// ── DataTable ─────────────────────────────────────────────────────────────────
// Card shell + sticky header + optional footer.

export default function DataTable({
  columns,
  sortCol, sortDir, onSort,
  filters, onFilterToggle, onFilterSelectAll, uniqueValues,
  children,
  footer,        // NEW: ReactNode rendered after children, inside the card
  stickyTop = 52,
}) {
  const gridTemplate = buildGridTemplate(columns)
  return (
    <div className="card" style={{ padding: 0, '--dt-cols': gridTemplate }}>
      <DataTableHeader
        columns={columns}
        sortCol={sortCol} sortDir={sortDir} onSort={onSort}
        filters={filters}
        onFilterToggle={onFilterToggle}
        onFilterSelectAll={onFilterSelectAll}
        uniqueValues={uniqueValues}
        stickyTop={stickyTop}
      />
      {children}
      {footer && footer}
    </div>
  )
}