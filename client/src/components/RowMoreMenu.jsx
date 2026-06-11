import { useState, useRef, useEffect } from 'react'
import { MoreVertical } from 'lucide-react'

// Generic more-menu for table rows.
// items: [{ label, onClick, danger? }]
// Only rendered items are shown — pass null/undefined to exclude.

export default function RowMoreMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const visible = items.filter(Boolean)
  if (visible.length === 0) return null

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
      <button
        className="btn-ghost"
        style={{ padding: '4px 6px' }}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        title="More options"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="txn-filter-dropdown" style={{ left: 'auto', right: 0 }}>
          {visible.map((item, i) => (
            <div
              key={i}
              className="txn-filter-option"
              style={item.danger ? { color: 'var(--red)' } : {}}
              onClick={e => { e.stopPropagation(); setOpen(false); item.onClick() }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}