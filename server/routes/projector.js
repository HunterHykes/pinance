// routes/projector.js
const express     = require('express')
const db          = require('../db')
const requireAuth = require('../middleware/auth')
const router      = express.Router()

router.use(requireAuth)

// ── Helpers ───────────────────────────────────────────────────────────────────

function addMonths(yyyymm, n) {
  const [y, m] = yyyymm.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return d.toISOString().slice(0, 7)
}

function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

// Bills helper — same logic as server/bills.js chargeOccursInMonth
function chargeOccursInMonth(anchorDate, frequency, targetMonth) {
  const anchor = new Date(anchorDate + 'T00:00:00')
  const [ty, tm] = targetMonth.split('-').map(Number)
  switch (frequency) {
    case 'monthly': return true
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

// Income helper — same logic as server/income.js incomeOccursInMonth
function incomeOccursInMonth(anchorDate, frequency, customDays, targetMonth) {
  if (!anchorDate) return false
  const anchor = new Date(anchorDate + 'T00:00:00')
  const [ty, tm] = targetMonth.split('-').map(Number)
  switch (frequency) {
    case 'monthly':
    case 'twice_monthly':
    case 'weekly':       return true
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
    default: return false
  }
}

function occurrencesPerMonth(frequency, customDays) {
  switch (frequency) {
    case 'monthly':       return 1
    case 'twice_monthly': return 2
    case 'weekly':        return 4.33
    case 'biweekly':      return 2.17
    case 'quarterly':     return 1
    case 'semi_annual':   return 1
    case 'annual':        return 1
    case 'custom_days':
      return customDays
        ? customDays.split(',').filter(d => d.trim()).length
        : 1
    default: return 1
  }
}

// ── Rate helpers ──────────────────────────────────────────────────────────────
// growth_rate and apr inputs are annual percentages (e.g. 7 = 7%).
// monthlyFromAnnual converts to the monthly multiplier using compound interest:
//   (1 + annual/100)^(1/12) - 1
// This means a 7% annual input yields exactly 7% annual compounded monthly.
// For APR on credit cards/loans we use simple division (r/12) per convention.

function monthlyGrowthRate(annualPct) {
  if (!annualPct) return 0
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1
}

function monthlyAPR(annualPct) {
  if (!annualPct) return 0
  return annualPct / 100 / 12
}

// ── GET /api/projector/bounds ─────────────────────────────────────────────────
// Returns the earliest month with real data (transactions or snapshots).

router.get('/bounds', (req, res) => {
  const userId = req.session.userId
  const row = db.prepare(`
    SELECT MIN(d) as earliest FROM (
      SELECT MIN(date) as d FROM transactions     WHERE user_id = ? AND pending = 0
      UNION ALL
      SELECT MIN(date) as d FROM balance_snapshots WHERE user_id = ?
      UNION ALL
      SELECT MIN(date) as d FROM asset_snapshots   WHERE user_id = ?
    )
  `).get(userId, userId, userId)
  const earliest = row?.earliest ? row.earliest.slice(0, 7) : null
  res.json({ earliest })
})

// ── GET /api/projector/inputs ─────────────────────────────────────────────────

router.get('/inputs', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM projector_inputs WHERE user_id = ?'
  ).all(req.session.userId)

  // Return as a map: { "account:5": { growth_rate, apr, ... }, "asset:2": { ... } }
  const map = {}
  for (const row of rows) {
    map[`${row.entity_type}:${row.entity_id}`] = {
      growth_rate:     row.growth_rate,
      apr:             row.apr,
      cc_payment_mode: row.cc_payment_mode,
      cc_min_payment:  row.cc_min_payment,
    }
  }
  res.json(map)
})

// ── PUT /api/projector/inputs/:type/:id ───────────────────────────────────────

router.put('/inputs/:type/:id', (req, res) => {
  const userId     = req.session.userId
  const entityType = req.params.type   // 'account' | 'asset' | 'liability'
  const entityId   = parseInt(req.params.id)
  const { growth_rate, apr, cc_payment_mode, cc_min_payment } = req.body

  db.prepare(`
    INSERT INTO projector_inputs
      (user_id, entity_type, entity_id, growth_rate, apr, cc_payment_mode, cc_min_payment)
    VALUES
      (@user_id, @entity_type, @entity_id, @growth_rate, @apr, @cc_payment_mode, @cc_min_payment)
    ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET
      growth_rate     = excluded.growth_rate,
      apr             = excluded.apr,
      cc_payment_mode = excluded.cc_payment_mode,
      cc_min_payment  = excluded.cc_min_payment
  `).run({
    user_id:         userId,
    entity_type:     entityType,
    entity_id:       entityId,
    growth_rate:     growth_rate     ?? null,
    apr:             apr             ?? null,
    cc_payment_mode: cc_payment_mode ?? null,
    cc_min_payment:  cc_min_payment  ?? null,
  })

  res.json({ message: 'Saved' })
})

// ── GET /api/projector?from=YYYY-MM&to=YYYY-MM ────────────────────────────────
//
// Returns:
//   { months, series: [{ id, name, type, seriesType, data[] }], netWorth[] }
//
// History portion: forward-filled from balance_snapshots / asset_snapshots /
//   liability_snapshots, same logic as networth route.
// Projection portion: walks month by month applying growth/APR/cash-flow rules.

router.get('/', (req, res) => {
  const userId = req.session.userId
  const { from, to } = req.query

  if (!from || !to) return res.status(400).json({ error: 'from and to are required' })

  const today = new Date().toISOString().slice(0, 7)

  // ── Load entities ─────────────────────────────────────────────────────────
  const accounts    = db.prepare('SELECT * FROM accounts    WHERE user_id = ?').all(userId)
  const assets      = db.prepare('SELECT * FROM assets      WHERE user_id = ?').all(userId)
  const liabilities = db.prepare('SELECT * FROM liabilities WHERE user_id = ?').all(userId)

  // ── Load projector inputs ─────────────────────────────────────────────────
  const inputRows = db.prepare('SELECT * FROM projector_inputs WHERE user_id = ?').all(userId)
  const inputs = {}
  for (const row of inputRows) {
    inputs[`${row.entity_type}:${row.entity_id}`] = row
  }
  const inp = (type, id) => inputs[`${type}:${id}`] || {}

  // ── Load historical snapshots — fetch all history up to today ────────────
  const acctSnaps = db.prepare(`
    SELECT account_id, date, balance FROM balance_snapshots
    WHERE user_id = ? AND date <= ?
    ORDER BY date ASC
  `).all(userId, today + '-31')

  const assetSnaps = db.prepare(`
    SELECT asset_id, date, value FROM asset_snapshots
    WHERE user_id = ? AND date <= ?
    ORDER BY date ASC
  `).all(userId, today + '-31')

  const liabSnaps = db.prepare(`
    SELECT liability_id, date, balance FROM liability_snapshots
    WHERE user_id = ? AND date <= ?
    ORDER BY date ASC
  `).all(userId, today + '-31')

  // ── Load active bills and income schedules ────────────────────────────────
  const billCharges = db.prepare(`
    SELECT bc.*, b.account_id AS bill_account_id, b.status AS bill_status
    FROM bill_charges bc
    JOIN bills b ON b.id = bc.bill_id
    WHERE b.user_id = ? AND b.status = 'active' AND bc.effective_to IS NULL
  `).all(userId)

  const incomeSchedules = db.prepare(`
    SELECT s.*, i.account_id AS income_account_id, i.status AS income_status
    FROM income_schedules s
    JOIN income_sources i ON i.id = s.income_id
    WHERE i.user_id = ? AND i.status = 'active' AND s.effective_to IS NULL
  `).all(userId)

  // ── Build month series ────────────────────────────────────────────────────
  const months = []
  let cur = from
  while (cur <= to) {
    months.push(cur)
    cur = addMonths(cur, 1)
  }

  // ── Build per-entity snap maps ────────────────────────────────────────────
  const acctSnapByMonth  = {}
  const assetSnapByMonth = {}
  const liabSnapByMonth  = {}

  for (const s of acctSnaps) {
    const ym = s.date.slice(0, 7)
    if (!acctSnapByMonth[s.account_id]) acctSnapByMonth[s.account_id] = {}
    acctSnapByMonth[s.account_id][ym] = s.balance
  }
  for (const s of assetSnaps) {
    const ym = s.date.slice(0, 7)
    if (!assetSnapByMonth[s.asset_id]) assetSnapByMonth[s.asset_id] = {}
    assetSnapByMonth[s.asset_id][ym] = s.value
  }
  for (const s of liabSnaps) {
    const ym = s.date.slice(0, 7)
    if (!liabSnapByMonth[s.liability_id]) liabSnapByMonth[s.liability_id] = {}
    liabSnapByMonth[s.liability_id][ym] = s.balance
  }

  // ── Cash flow per account per month ───────────────────────────────────────
  // For each future month, accumulate income credits and bill debits
  // keyed by account_id (null = unassigned virtual account)

  // Identify which checking/savings accounts exist for unassigned fallback
  const checkingAccounts = accounts.filter(a =>
    ['Checking', 'Savings'].includes(a.type)
  )
  const fallbackAccountId = checkingAccounts[0]?.id ?? null

  function cashFlowForMonth(month, accountId) {
    let flow = 0

    // Income credited to this account
    for (const s of incomeSchedules) {
      const effectiveAccountId = s.account_id ?? s.income_account_id ?? fallbackAccountId
      if (effectiveAccountId !== accountId) continue
      if (!incomeOccursInMonth(s.anchor_date, s.frequency, s.custom_days, month)) continue
      flow += s.amount * occurrencesPerMonth(s.frequency, s.custom_days)
    }

    // Bills debited from this account
    for (const c of billCharges) {
      const effectiveAccountId = c.account_id ?? c.bill_account_id ?? fallbackAccountId
      if (effectiveAccountId !== accountId) continue
      if (!chargeOccursInMonth(c.anchor_date, c.frequency, month)) continue
      switch (c.frequency) {
        case 'monthly':     flow -= c.amount; break
        case 'quarterly':   flow -= c.amount; break
        case 'semi_annual': flow -= c.amount; break
        case 'annual':      flow -= c.amount; break
        default:            flow -= c.amount
      }
    }

    return flow
  }

  // Unassigned cash flow (bills/income with no account mapping)
  function unassignedCashFlowForMonth(month) {
    let flow = 0
    for (const s of incomeSchedules) {
      const effectiveAccountId = s.account_id ?? s.income_account_id ?? null
      if (effectiveAccountId !== null) continue
      if (!incomeOccursInMonth(s.anchor_date, s.frequency, s.custom_days, month)) continue
      flow += s.amount * occurrencesPerMonth(s.frequency, s.custom_days)
    }
    for (const c of billCharges) {
      const effectiveAccountId = c.account_id ?? c.bill_account_id ?? null
      if (effectiveAccountId !== null) continue
      if (!chargeOccursInMonth(c.anchor_date, c.frequency, month)) continue
      flow -= c.amount
    }
    return flow
  }

  // ── Build projection for each account ────────────────────────────────────
  const series = []
  let hasUnassigned = false

  for (const acct of accounts) {
    const snapByMonth = acctSnapByMonth[acct.id] || {}
    const input       = inp('account', acct.id)

    // Seed from the earliest available snapshot or fall back to current balance
    const snapMonths    = Object.keys(snapByMonth).sort()
    const lastHistSnap  = snapMonths.filter(m => m <= today).pop()
    let projBal = lastHistSnap != null ? snapByMonth[lastHistSnap] : acct.balance

    const data = []
    // Seed lastFilled: find most recent snap at or before the start of our range,
    // or fall back to current balance so history is never all-null
    let lastFilled = acct.balance
    const priorSnap = snapMonths.filter(m => m <= (months[0] || today)).pop()
    if (priorSnap) lastFilled = snapByMonth[priorSnap]

    for (const month of months) {
      const isHistory = month <= today
      if (isHistory) {
        if (snapByMonth[month] !== undefined) lastFilled = snapByMonth[month]
        data.push(parseFloat(lastFilled.toFixed(2)))
      } else {
        // Projection
        if (acct.type === 'Credit card') {
          const apr        = monthlyAPR(input.apr || 0)
          const mode       = input.cc_payment_mode || 'full'
          const minPayment = input.cc_min_payment || 0
          const balance    = projBal ?? 0
          const interest   = balance * apr
          projBal = balance + interest
          if (mode === 'full')          projBal = 0
          else if (mode === 'minimum')  projBal = Math.min(0, projBal + Math.max(minPayment || 25, Math.abs(projBal) * 0.02))
          else if (mode === 'fixed')    projBal = Math.min(0, projBal + (minPayment || 0))
        } else {
          const monthlyReturn = monthlyGrowthRate(input.growth_rate || 0)
          const cashFlow      = cashFlowForMonth(month, acct.id)
          projBal = (projBal ?? 0) * (1 + monthlyReturn) + cashFlow
        }
        data.push(parseFloat(projBal.toFixed(2)))
      }
    }

    const isFallback = acct.id === fallbackAccountId && fallbackAccountId !== null

    series.push({
      id:         acct.id,
      name:       acct.name,
      type:       acct.type,
      seriesType: 'account',
      isFallback,
      data,
    })
  }

  // ── Virtual unassigned account ────────────────────────────────────────────
  const hasUnassignedFlow = months.some(m => m > today && unassignedCashFlowForMonth(m) !== 0)
  if (hasUnassignedFlow && fallbackAccountId === null) {
    let virtualBal = 0
    const data = months.map(month => {
      if (month <= today) return null
      virtualBal += unassignedCashFlowForMonth(month)
      return parseFloat(virtualBal.toFixed(2))
    })
    series.push({
      id:         'virtual',
      name:       'Unassigned',
      type:       'Virtual',
      seriesType: 'virtual',
      data,
    })
  }

  // ── Assets + linked liabilities → equity series ───────────────────────────
  // For assets with linked liabilities, emit one equity series (asset - liab).
  // For standalone assets, emit the asset value directly.
  // Linked liabilities are consumed into equity and not emitted separately.
  const linkedLiabIds = new Set(liabilities.filter(l => l.asset_id).map(l => l.id))

  for (const asset of assets) {
    const snapByMonth   = assetSnapByMonth[asset.id] || {}
    const input         = inp('asset', asset.id)
    const snapMonths    = Object.keys(snapByMonth).sort()
    const lastHistSnap  = snapMonths.filter(m => m <= today).pop()
    let projVal = lastHistSnap != null ? snapByMonth[lastHistSnap] : asset.value

    let lastFilled = asset.value
    const priorSnap = snapMonths.filter(m => m <= (months[0] || today)).pop()
    if (priorSnap) lastFilled = snapByMonth[priorSnap]

    // Linked liabilities for this asset
    const linkedLiabs = liabilities.filter(l => l.asset_id === asset.id)

    // Build per-linked-liability snap state
    const liabState = linkedLiabs.map(liab => {
      const lSnaps     = liabSnapByMonth[liab.id] || {}
      const lMonths    = Object.keys(lSnaps).sort()
      const lastLSnap  = lMonths.filter(m => m <= today).pop()
      const hasTerms   = liab.original_principal && liab.interest_rate && liab.loan_term_months
      const r          = hasTerms ? liab.interest_rate / 12 : 0
      const pmt        = hasTerms
        ? (liab.monthly_payment || (r > 0
            ? liab.original_principal * r * Math.pow(1+r, liab.loan_term_months)
              / (Math.pow(1+r, liab.loan_term_months) - 1)
            : liab.original_principal / liab.loan_term_months))
        : 0
      let projBal  = lastLSnap != null ? lSnaps[lastLSnap] : liab.balance
      let lastLFill = liab.balance
      const lPrior = lMonths.filter(m => m <= (months[0] || today)).pop()
      if (lPrior) lastLFill = lSnaps[lPrior]
      const liabInput = inp('liability', liab.id)
      return { liab, lSnaps, lMonths, hasTerms, r, pmt, projBal, lastLFill, liabInput }
    })

    const data = []
    for (const month of months) {
      const isHistory = month <= today

      // Asset value for this month
      if (isHistory) {
        if (snapByMonth[month] !== undefined) lastFilled = snapByMonth[month]
      } else {
        const monthlyGrowth = monthlyGrowthRate(input.growth_rate || 0)
        projVal = (projVal ?? 0) * (1 + monthlyGrowth)
      }
      const assetVal = isHistory ? lastFilled : projVal

      // Sum of linked liability balances for this month
      let totalLiab = 0
      for (const ls of liabState) {
        const { lSnaps } = ls
        if (isHistory) {
          if (lSnaps[month] !== undefined) ls.lastLFill = lSnaps[month]
          totalLiab += ls.lastLFill
        } else {
          if (ls.hasTerms && ls.projBal > 0.005) {
            const interest  = ls.projBal * ls.r
            const principal = Math.max(0, Math.min(ls.pmt - interest, ls.projBal))
            ls.projBal      = Math.max(0, ls.projBal - principal)
          } else if (!ls.hasTerms && ls.liabInput.apr) {
            const apr      = monthlyAPR(ls.liabInput.apr)
            ls.projBal    += ls.projBal * apr
            const mode     = ls.liabInput.cc_payment_mode || 'full'
            const minPmt   = ls.liabInput.cc_min_payment  || 0
            if (mode === 'full')         ls.projBal = 0
            else if (mode === 'minimum') ls.projBal = Math.max(0, ls.projBal - Math.max(minPmt, ls.projBal * 0.02))
            else if (mode === 'fixed')   ls.projBal = Math.max(0, ls.projBal - minPmt)
          }
          totalLiab += ls.projBal
        }
      }

      // Equity = asset value − total linked liability balance
      const equity = assetVal - totalLiab
      data.push(parseFloat(equity.toFixed(2)))
    }

    series.push({
      id:          asset.id,
      name:        linkedLiabs.length > 0 ? `${asset.name} (equity)` : asset.name,
      type:        asset.type,
      seriesType:  linkedLiabs.length > 0 ? 'equity' : 'asset',
      linkedLiabIds: linkedLiabs.map(l => l.id),
      data,
    })
  }

  // ── Standalone liabilities (not linked to any asset) ─────────────────────
  for (const liab of liabilities) {
    if (linkedLiabIds.has(liab.id)) continue  // already consumed into equity series

    const snapByMonth   = liabSnapByMonth[liab.id] || {}
    const input         = inp('liability', liab.id)
    const snapMonths    = Object.keys(snapByMonth).sort()
    const lastHistSnap  = snapMonths.filter(m => m <= today).pop()
    let projBal = lastHistSnap != null ? snapByMonth[lastHistSnap] : liab.balance

    const hasTerms = liab.original_principal && liab.interest_rate && liab.loan_term_months
    const r   = hasTerms ? liab.interest_rate / 12 : 0
    const pmt = hasTerms
      ? (liab.monthly_payment || (r > 0
          ? liab.original_principal * r * Math.pow(1+r, liab.loan_term_months)
            / (Math.pow(1+r, liab.loan_term_months) - 1)
          : liab.original_principal / liab.loan_term_months))
      : 0

    let lastFilled = liab.balance
    const priorSnap = snapMonths.filter(m => m <= (months[0] || today)).pop()
    if (priorSnap) lastFilled = snapByMonth[priorSnap]

    const data = []
    for (const month of months) {
      const isHistory = month <= today
      if (isHistory) {
        if (snapByMonth[month] !== undefined) lastFilled = snapByMonth[month]
        data.push(parseFloat((-lastFilled).toFixed(2)))
      } else {
        if (hasTerms && projBal > 0.005) {
          const interest  = projBal * r
          const principal = Math.max(0, Math.min(pmt - interest, projBal))
          projBal = Math.max(0, projBal - principal)
        } else if (!hasTerms && input.apr) {
          const apr      = monthlyAPR(input.apr)
          const interest = projBal * apr
          projBal       += interest
          const mode     = input.cc_payment_mode || 'full'
          const minPmt   = input.cc_min_payment  || 0
          if (mode === 'full')         projBal = 0
          else if (mode === 'minimum') projBal = Math.max(0, projBal - Math.max(minPmt, projBal * 0.02))
          else if (mode === 'fixed')   projBal = Math.max(0, projBal - minPmt)
        }
        data.push(projBal > 0.005 ? parseFloat((-projBal).toFixed(2)) : 0)
      }
    }

    series.push({
      id:         liab.id,
      name:       liab.name,
      type:       liab.type,
      seriesType: 'liability',
      data,
    })
  }

  // ── Net worth per month ───────────────────────────────────────────────────
  const netWorth = months.map((_, i) =>
    series.reduce((sum, s) => {
      const v = s.data[i]
      return v != null ? sum + v : sum
    }, 0)
  )

  res.json({ months, series, netWorth })
})

module.exports = router