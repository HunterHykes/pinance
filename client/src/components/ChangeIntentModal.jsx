import { useState } from 'react'

const ALL_FREQUENCIES = [
  { value: 'weekly',        label: 'Weekly' },
  { value: 'biweekly',      label: 'Every two weeks' },
  { value: 'twice_monthly', label: 'Twice a month' },
  { value: 'monthly',       label: 'Monthly' },
  { value: 'quarterly',     label: 'Quarterly' },
  { value: 'semi_annual',   label: 'Semi-Annual' },
  { value: 'annual',        label: 'Annual' },
  { value: 'custom_days',   label: 'Custom days' },
]

function freqLabel(f) {
  return ALL_FREQUENCIES.find(x => x.value === f)?.label || f
}

export default function ChangeIntentModal({ row, original, rowIndex, totalDirty, onResolve }) {
  const today        = new Date().toISOString().slice(0, 10)
  const currentMonth = new Date().toISOString().slice(0, 7)
  const [intent,        setIntent]        = useState('forward')
  const [effectiveFrom, setEffectiveFrom] = useState(today)
  const [targetMonth,   setTargetMonth]   = useState(currentMonth)
  const [applyToAll,    setApplyToAll]    = useState(false)

  const diffs = []
  if ((row.label || '') !== (original.label || ''))
    diffs.push({ label: 'Label', from: original.label || '—', to: row.label || '—' })
  if (String(row.amount) !== String(original.amount))
    diffs.push({ label: 'Amount', from: `$${parseFloat(original.amount).toFixed(2)}`, to: `$${parseFloat(row.amount).toFixed(2)}` })
  if (row.frequency !== original.frequency)
    diffs.push({ label: 'Frequency', from: freqLabel(original.frequency), to: freqLabel(row.frequency) })
  if (row.anchor_date !== original.anchor_date)
    diffs.push({ label: 'Started on', from: original.anchor_date, to: row.anchor_date })
  if ((row.account_id || null) !== (original.account_id || null))
    diffs.push({ label: 'Account', from: original.account_name || '—', to: row.account_name || '—' })

  const handleConfirm = () => {
    onResolve({
      intent,
      effective_from: intent === 'forward' ? effectiveFrom : null,
      target_month:   intent === 'one_time' ? targetMonth : null,
      applyToAll,
    })
  }

  return (
    <div className="modal-bg">
      <div className="modal" style={{ maxWidth: '460px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Apply change — {row.label}</h3>
          {totalDirty > 1 && (
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, flexShrink: 0, marginLeft: '12px', marginTop: '3px' }}>
              {rowIndex + 1} of {totalDirty}
            </span>
          )}
        </div>

        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: '16px' }}>
          {diffs.length === 0 ? (
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>No changes detected</span>
          ) : diffs.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginBottom: i < diffs.length - 1 ? '4px' : 0 }}>
              <span style={{ color: 'var(--text-tertiary)', width: '70px', flexShrink: 0 }}>{d.label}</span>
              <span style={{ color: 'var(--red)', textDecoration: 'line-through' }}>{d.from}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>→</span>
              <span style={{ color: 'var(--green)' }}>{d.to}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>

          <label style={{ display: 'flex', gap: '10px', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: `1px solid ${intent === 'correction' ? 'var(--accent)' : 'var(--border)'}`, background: intent === 'correction' ? 'rgba(59,130,246,0.06)' : 'transparent', cursor: 'pointer' }}>
            <input type="radio" name="intent" value="correction" checked={intent === 'correction'} onChange={() => setIntent('correction')} style={{ marginTop: '2px', flexShrink: 0, width: 'auto' }} />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>Fix a mistake</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>Update the record everywhere — as if this value was always correct. Past budget months will be re-seeded.</div>
            </div>
          </label>

          <label style={{ display: 'flex', gap: '10px', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: `1px solid ${intent === 'forward' ? 'var(--accent)' : 'var(--border)'}`, background: intent === 'forward' ? 'rgba(59,130,246,0.06)' : 'transparent', cursor: 'pointer' }}>
            <input type="radio" name="intent" value="forward" checked={intent === 'forward'} onChange={() => setIntent('forward')} style={{ marginTop: '2px', flexShrink: 0, width: 'auto' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>Change going forward</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5, marginBottom: '8px' }}>Keep history intact. Closes the current record and starts a new one from the date below.</div>
              {intent === 'forward' && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '11px' }}>Effective from</label>
                  <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={{ maxWidth: '160px' }} />
                </div>
              )}
            </div>
          </label>

          <label style={{ display: 'flex', gap: '10px', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: `1px solid ${intent === 'one_time' ? 'var(--accent)' : 'var(--border)'}`, background: intent === 'one_time' ? 'rgba(59,130,246,0.06)' : 'transparent', cursor: 'pointer' }}>
            <input type="radio" name="intent" value="one_time" checked={intent === 'one_time'} onChange={() => setIntent('one_time')} style={{ marginTop: '2px', flexShrink: 0, width: 'auto' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>One-time override</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5, marginBottom: '8px' }}>Adjust a single month's budget without changing the ongoing rule. Useful for bonuses, partial payments, or promotional pricing.</div>
              {intent === 'one_time' && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '11px' }}>Target month</label>
                  <input type="month" value={targetMonth} onChange={e => setTargetMonth(e.target.value)} style={{ maxWidth: '160px' }} />
                </div>
              )}
            </div>
          </label>
        </div>

        {totalDirty > 1 && rowIndex < totalDirty - 1 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={applyToAll} onChange={e => setApplyToAll(e.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />
            Apply this choice to all {totalDirty - rowIndex - 1} remaining row{totalDirty - rowIndex - 1 !== 1 ? 's' : ''}
          </label>
        )}

        <div className="modal-btns">
          <button type="button" className="btn-ghost" onClick={() => onResolve(null)}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleConfirm}>
            {rowIndex === totalDirty - 1 || applyToAll ? 'Confirm' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}