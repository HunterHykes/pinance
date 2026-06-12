// scheduleUtils.js — shared schedule parsing, occurrence logic, and display

// ── Schedule → display label ──────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const WEEKDAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const NTH_LABELS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: 'Last' }

function ordinal(n) {
  if (n === 0) return 'last day'
  const s = ['th','st','nd','rd']
  const v = n % 100
  return n + (s[(v-20)%10] || s[v] || s[0])
}

export function scheduleLabel(schedule) {
  if (!schedule) return '—'
  switch (schedule.type) {
    case 'monthly':
      return `Monthly, ${ordinal(schedule.day)}`
    case 'twice_monthly': {
      const [a, b] = schedule.days || [1, 15]
      return `Monthly, ${ordinal(a)} & ${ordinal(b)}`
    }
    case 'quarterly':
      return `Quarterly, ${ordinal(schedule.day)}`
    case 'semi_annual':
      return `Semi-annual, ${ordinal(schedule.day)}`
    case 'annual':
      return `Annual, ${MONTH_NAMES[(schedule.month ?? 1) - 1]} ${ordinal(schedule.day)}`
    case 'weekly':
      return `Weekly, ${WEEKDAY_NAMES[schedule.weekday ?? 1]}s`
    case 'biweekly':
      return `Every 2 weeks, ${WEEKDAY_NAMES[schedule.weekday ?? 1]}s`
    case 'custom_days': {
      const days = (schedule.days || []).map(ordinal).join(', ')
      return `Monthly, ${days}`
    }
    case 'nth_weekday': {
      const day  = WEEKDAY_NAMES[schedule.weekday ?? 0]
      const nths = (schedule.weeks || [1]).map(n => NTH_LABELS[n] || `${n}th`).join(' & ')
      return `Monthly, ${nths} ${day}`
    }
    default:
      return schedule.type || '—'
  }
}

// ── Occurrence logic ──────────────────────────────────────────────────────────

// Returns the actual day a monthly-type schedule fires in a given YYYY-MM.
// day=0 → last day of month.
function resolveDay(day, year, month) {
  if (day === 0) return new Date(year, month, 0).getDate() // last day
  return Math.min(day, new Date(year, month, 0).getDate()) // clamp to month length
}

export function occursInMonth(schedule, anchorDate, targetMonth) {
  if (!schedule) return legacyOccursInMonth(anchorDate, null, null, targetMonth)
  const [ty, tm] = targetMonth.split('-').map(Number)

  switch (schedule.type) {
    case 'monthly':
    case 'twice_monthly':
    case 'custom_days':
      return true

    case 'quarterly': {
      if (!anchorDate) return false
      const anchor = new Date(anchorDate + 'T00:00:00')
      const am = anchor.getFullYear() * 12 + anchor.getMonth()
      const bm = ty * 12 + (tm - 1)
      return bm >= am && (bm - am) % 3 === 0
    }
    case 'semi_annual': {
      if (!anchorDate) return false
      const anchor = new Date(anchorDate + 'T00:00:00')
      const am = anchor.getFullYear() * 12 + anchor.getMonth()
      const bm = ty * 12 + (tm - 1)
      return bm >= am && (bm - am) % 6 === 0
    }
    case 'annual':
      return (schedule.month ?? 1) === tm && ty >= (anchorDate ? new Date(anchorDate + 'T00:00:00').getFullYear() : ty)

    case 'weekly':
      return true

    case 'biweekly': {
      if (!anchorDate) return false
      const anchor = new Date(anchorDate + 'T00:00:00')
      const start  = new Date(`${targetMonth}-01T00:00:00`)
      const end    = new Date(ty, tm, 0)
      let d = new Date(anchor)
      while (d > start) d.setDate(d.getDate() - 14)
      while (d < start) d.setDate(d.getDate() + 14)
      return d <= end
    }

    case 'nth_weekday': {
      // true if any of the specified nth occurrences of the weekday exist in targetMonth
      const [ty2, tm2] = targetMonth.split('-').map(Number)
      const weekday = schedule.weekday ?? 0
      const weeks   = schedule.weeks  || [1]
      // Find all occurrences of weekday in the month
      const occurrences = []
      const lastDay = new Date(ty2, tm2, 0).getDate()
      for (let d = 1; d <= lastDay; d++) {
        if (new Date(ty2, tm2 - 1, d).getDay() === weekday) occurrences.push(d)
      }
      // week 5 = last occurrence
      return weeks.some(n => n === 5 ? occurrences.length > 0 : occurrences[n - 1] !== undefined)
    }

    default:
      return false
  }
}
export function occurrencesPerMonth(schedule) {
  if (!schedule) return 1
  switch (schedule.type) {
    case 'monthly':      return 1
    case 'twice_monthly':return 2
    case 'custom_days':  return (schedule.days || []).length || 1
    case 'quarterly':    return 1 / 3
    case 'semi_annual':  return 1 / 6
    case 'annual':       return 1 / 12
    case 'weekly':       return 52 / 12
    case 'biweekly':     return 26 / 12
    case 'nth_weekday':  return (schedule.weeks || [1]).length
    default:             return 1
  }
}

// ── Legacy fallback (for rows without schedule column) ────────────────────────

export function legacyOccursInMonth(anchorDate, frequency, customDays, targetMonth) {
  if (!anchorDate || !frequency) return false
  const anchor = new Date(anchorDate + 'T00:00:00')
  const [ty, tm] = targetMonth.split('-').map(Number)
  switch (frequency) {
    case 'monthly':
    case 'twice_monthly':
    case 'weekly':
      return true
    case 'biweekly': {
      const start = new Date(`${targetMonth}-01T00:00:00`)
      const end   = new Date(ty, tm, 0)
      let d = new Date(anchor)
      while (d > start) d.setDate(d.getDate() - 14)
      while (d < start) d.setDate(d.getDate() + 14)
      return d <= end
    }
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
    case 'custom_days':
      return !!(customDays && customDays.trim().length > 0)
    default:
      return false
  }
}

export function legacyOccurrencesPerMonth(frequency, customDays) {
  switch (frequency) {
    case 'monthly':      return 1
    case 'twice_monthly':return 2
    case 'weekly':       return 52 / 12
    case 'biweekly':     return 26 / 12
    case 'quarterly':    return 1 / 3
    case 'semi_annual':  return 1 / 6
    case 'annual':       return 1 / 12
    case 'custom_days':  return customDays ? customDays.split(',').filter(d => d.trim()).length : 1
    default:             return 1
  }
}