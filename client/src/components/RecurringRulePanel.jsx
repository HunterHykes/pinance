import { useState } from 'react'
import { Plus } from 'lucide-react'
import { formatCurrency } from '../utils'

// Shared panel for inline editing of recurring schedule / charge rules.
// Used by both Income (inline expand) and Subscriptions (inline expand) as well as their modals.
//
// When onSave is provided, renders a footer row with annual total + Save / Cancel buttons.
// When omitted (modal use), the caller supplies its own save button.

function RecurringRulePanel({
  children,         // rendered rule rows (ScheduleRuleRow / ChargeRuleRow instances)
  columns,          // CSS grid-template-columns for rows and headers
  headers,          // array of column header label strings
  onAdd,            // () => void — add a new rule row
  addLabel,         // e.g. "Add schedule" or "Add rule"
  helperText,       // shown bottom-left when no dirty rows
  dirtyCount,       // number of existing dirty rows
  allRules,         // full rule array (including past) — for parent history section
  renderHistoryRow, // (rule) => ReactNode — renders one row in history
  annualTotal,      // if provided, renders annual total + Save/Cancel bar
  onSave,           // () => void — only used when annualTotal is set
  onCancel,         // () => void — only used when annualTotal is set
  saving,           // boolean
}) {
  const [showHistory, setShowHistory] = useState(false)

  return (
    <div>
      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: columns,
        gap: '6px',
        padding: '0 0 4px',
        borderBottom: '1px solid var(--border)',
        marginBottom: '2px',
      }}>
        {headers.map((h, i) => (
          <span key={i} style={{
            fontSize: '11px', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            {h}
          </span>
        ))}
      </div>

      {/* Rule rows — caller provides these as children */}
      {children}

      {/* Footer: Add button aligned right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
        <p style={{
          fontSize: '11px',
          color: dirtyCount > 0 ? 'var(--accent)' : 'var(--text-tertiary)',
          margin: 0,
        }}>
          {dirtyCount > 0
            ? `${dirtyCount} existing row${dirtyCount !== 1 ? 's' : ''} modified — save to apply.`
            : helperText}
        </p>
        <button
          type="button"
          className="btn-ghost"
          style={{ fontSize: '12px', padding: '4px 10px', flexShrink: 0, marginLeft: '12px' }}
          onClick={onAdd}
        >
          <Plus size={12} style={{ display: 'inline', marginRight: '4px' }} />
          {addLabel}
        </button>
      </div>

      {/* Inline-only: annual total + Save / Cancel (no extra borders) */}
      {onSave !== undefined && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: '10px',
        }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Annual: <strong>{formatCurrency(annualTotal ?? 0)}</strong>
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: '12px', padding: '4px 8px' }}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ fontSize: '12px', padding: '4px 14px' }}
              onClick={onSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Parent history */}
      {allRules && renderHistoryRow && (
        <div style={{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: '11px', padding: '2px 8px' }}
            onClick={() => setShowHistory(h => !h)}
          >
            {showHistory ? '▼' : '▶'} History
          </button>
          {showHistory && (
            <div style={{ marginTop: '6px' }}>
              {[...allRules]
                .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
                .map(renderHistoryRow)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default RecurringRulePanel