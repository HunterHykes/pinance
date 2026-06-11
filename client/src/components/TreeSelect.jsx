import { useState, useRef, useEffect } from 'react'
import { buildCategoryTree } from '../utils'

function TreeOption({ node, depth, onSelect, selectedValue, expandedNodes, toggleExpanded, selectableParents, excludedValue }) {
  const hasChildren = node.children && node.children.length > 0
  const isExpanded  = expandedNodes.has(node.id)
  const isSelected  = selectedValue === node.category
  const isExcluded  = excludedValue  === node.category
  const canSelect   = !isExcluded && (!hasChildren || selectableParents)
  const dotColor    = node.color || null

  return (
    <>
      <div
        className={[
          'tree-option',
          isSelected  ? 'tree-option--selected'  : '',
          isExcluded  ? 'tree-option--excluded'   : '',
          hasChildren ? 'tree-option--parent'     : 'tree-option--leaf',
          hasChildren && canSelect ? 'tree-option--selectable' : '',
        ].join(' ')}
        style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
      >
        {/* Merged color dot + expand toggle */}
        {dotColor ? (
          <button
            type="button"
            className={'tree-dot-btn' + (hasChildren ? ' tree-dot-btn--expandable' : '')}
            style={{ background: dotColor }}
            onClick={e => { e.stopPropagation(); if (hasChildren) toggleExpanded(node.id) }}
            tabIndex={-1}
          >
            {hasChildren && (
              <svg
                className={'dot-chevron' + (isExpanded ? ' dot-chevron--open' : '')}
                width="7" height="7" viewBox="0 0 8 8" fill="none"
              >
                <path d="M1.5 3L4 5.5L6.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        ) : hasChildren ? (
          <button
            type="button"
            className="tree-expand-btn"
            onClick={e => { e.stopPropagation(); toggleExpanded(node.id) }}
          >
            <svg width="8" height="5" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"
              style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', display: 'block' }}>
              <path d="M1 1l4 4 4-4" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ) : (
          <span className="tree-expand-spacer" />
        )}

        <div
          className={"tree-option-inner" + (canSelect ? '' : ' tree-option-inner--disabled')}
          onClick={() => { if (canSelect) onSelect(node.category) }}
        >
          <span className="tree-option-label">{node.category}</span>
          {hasChildren && (
            <span className="tree-parent-hint">
              {node.children.length} sub
            </span>
          )}
        </div>
      </div>

      {hasChildren && isExpanded &&
        node.children.map(child => (
          <TreeOption
            key={child.id}
            node={child}
            depth={depth + 1}
            onSelect={onSelect}
            selectedValue={selectedValue}
            expandedNodes={expandedNodes}
            toggleExpanded={toggleExpanded}
            selectableParents={selectableParents}
            excludedValue={excludedValue}
          />
        ))
      }
    </>
  )
}

export default function TreeSelect({ value, onChange, categories, placeholder = 'Select category', selectableParents = false, excludedValue = null, allowClear = false, onCreateCategory = null }) {
  const [open, setOpen]       = useState(false)
  const [dropUp, setDropUp]   = useState(false)
  const [search, setSearch]   = useState('')
  const searchRef             = useRef(null)
  const [expandedNodes, setExpanded] = useState(() => {
    const set = new Set()
    categories.forEach(c => { if (!c.parent_id) set.add(c.id) })
    return set
  })
  const ref = useRef(null)

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSearch('') }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleExpanded = (id) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleSelect = (cat) => {
    onChange(cat)
    setOpen(false)
    setSearch('')
  }

  const tree = buildCategoryTree(categories)
  tree.sort((a, b) => a.category.localeCompare(b.category))
  tree.forEach(node => {
    if (node.children) {
      node.children.sort((a, b) => a.category.localeCompare(b.category))
    }
  })

  // Filter tree nodes by search query
  const searchLower = search.toLowerCase()
  function nodeMatchesSearch(node) {
    if (node.category.toLowerCase().includes(searchLower)) return true
    if (node.children) return node.children.some(c => nodeMatchesSearch(c))
    return false
  }
  function filterTree(nodes) {
    return nodes.reduce((acc, node) => {
      if (node.category.toLowerCase().includes(searchLower)) {
        acc.push(node)
      } else if (node.children?.some(c => nodeMatchesSearch(c))) {
        acc.push({ ...node, children: filterTree(node.children) })
      }
      return acc
    }, [])
  }
  const visibleTree = search ? filterTree(tree) : tree

  return (
    <div className="tree-select" ref={ref}>
      <button
        type="button"
        className="tree-select-trigger"
        onClick={() => {
        if (!open && ref.current) {
          const rect = ref.current.getBoundingClientRect()
          const spaceBelow = window.innerHeight - rect.bottom
          setDropUp(spaceBelow < 320)
        }
        setOpen(o => !o)
        if (!open) setTimeout(() => searchRef.current?.focus(), 50)
      }}
      >
        <span className={value ? '' : 'muted'}>{value || placeholder}</span>
        <span className="tree-select-arrow">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'block' }}>
            <path d="M1 1l4 4 4-4" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </button>

      {open && (
        <div className="tree-select-dropdown" style={dropUp ? { bottom: 'calc(100% + 4px)', top: 'auto' } : {}}>
          <div className="tree-search-wrap" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              ref={searchRef}
              type="text"
              className="tree-search-input"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
            {search && (
              <button type="button" tabIndex={-1}
                onClick={e => { e.stopPropagation(); setSearch('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                  color: 'var(--text-tertiary)', fontSize: '15px', lineHeight: 1, flexShrink: 0 }}>
                ×
              </button>
            )}
          </div>
          {allowClear && !search && (
            <div
              className={`tree-option tree-option--leaf${!value ? ' tree-option--selected' : ''}`}
              style={{ paddingLeft: '0.75rem', cursor: 'pointer' }}
              onClick={() => { onChange(''); setOpen(false); setSearch('') }}
            >
              <div className="tree-option-inner">
                <span className="tree-option-label" style={{ color: 'var(--text-secondary)' }}>All categories</span>
              </div>
            </div>
          )}
          {visibleTree.map(node => (
            <TreeOption
              key={node.id}
              node={node}
              depth={0}
              onSelect={handleSelect}
              selectedValue={value}
              expandedNodes={search ? new Set(categories.map(c => c.id)) : expandedNodes}
              toggleExpanded={toggleExpanded}
              selectableParents={selectableParents}
              excludedValue={excludedValue}
            />
          ))}
          {onCreateCategory && (
            <div
              className="tree-option tree-option--leaf tree-new-category"
              onClick={() => { setOpen(false); setSearch(''); onCreateCategory() }}
            >
              <div className="tree-option-inner">
                <span className="tree-option-label" style={{ color: 'var(--accent)' }}>+ New category</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}