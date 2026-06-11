const express     = require('express')
const db          = require('../db')
const requireAuth = require('../middleware/auth')
const router      = express.Router()

router.use(requireAuth)

// ── Snapshot helper ───────────────────────────────────────────────────────────

function snapshotLiabilityToday(userId, liabilityId, balance) {
  const today = new Date().toISOString().slice(0, 10)
  db.prepare(`
    INSERT INTO liability_snapshots (user_id, liability_id, date, balance)
    VALUES (@user_id, @liability_id, @date, @balance)
    ON CONFLICT(user_id, liability_id, date) DO UPDATE SET balance = excluded.balance
  `).run({ user_id: userId, liability_id: liabilityId, date: today, balance })
}

// ── Amortization walk ─────────────────────────────────────────────────────────
// Given loan terms and a list of actual payment transactions (sorted ascending
// by date), walks the amortization schedule month by month.
//
// For months where an actual transaction exists, uses that payment amount.
// For future months, uses the scheduled monthly payment.
//
// Returns an array of payment objects:
//   { date, amount, principal, interest, balance, is_actual, description }
//
// The walk correctly handles:
//   - Extra principal payments (balance drops faster, future interest shrinks)
//   - Partial payments (balance drops less, future interest grows)
//   - Projected future payments from current real balance

function buildAmortizationSchedule(liability, transactions) {
  const {
    original_principal: P,
    interest_rate:      annualRate,
    loan_term_months:   n,
    origination_date,
    monthly_payment:    storedPayment,
  } = liability

  if (!P || !annualRate || !n || !origination_date) return null

  const r = annualRate / 12
  // Scheduled payment (use stored if available, otherwise calculate)
  const scheduledPayment = storedPayment ||
    (r > 0 ? P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : P / n)

  // Build a map of actual payments by year-month for quick lookup
  // If multiple transactions hit in one month, sum them
  const actualByMonth = {}
  for (const txn of transactions) {
    const ym = txn.date.slice(0, 7)
    if (!actualByMonth[ym]) actualByMonth[ym] = { amount: 0, descriptions: [], dates: [] }
    // Transactions use positive = credit to account; a payment toward a liability
    // reduces the balance so we treat the absolute value as the payment amount
    actualByMonth[ym].amount += Math.abs(txn.amount)
    actualByMonth[ym].descriptions.push(txn.description)
    actualByMonth[ym].dates.push(txn.date)
  }

  const today = new Date().toISOString().slice(0, 7) // YYYY-MM

  const schedule = []
  let balance = P

  // Walk each payment period from origination
  for (let i = 0; i < n; i++) {
    if (balance <= 0.005) break

    // Calculate the month for this payment (1-indexed: payment 1 is one month after origination)
    const payDate = new Date(origination_date + 'T00:00:00')
    payDate.setMonth(payDate.getMonth() + i + 1)
    const ym    = payDate.toISOString().slice(0, 7)
    const dateStr = payDate.toISOString().slice(0, 10)

    // Interest for this period is always on the current running balance
    const interestCharge = balance * r

    const isActual = !!actualByMonth[ym]
    const isFuture = ym > today

    // Scheduled payment split (always based on current running balance for the
    // theoretical path — we track a parallel theoretical balance for this)
    const scheduledPrincipal = Math.max(0, scheduledPayment - interestCharge)
    const scheduledInterest  = Math.min(scheduledPayment, interestCharge)

    let paymentAmount
    if (isActual) {
      paymentAmount = actualByMonth[ym].amount
    } else if (isFuture) {
      paymentAmount = scheduledPayment
    } else {
      // Past month with no matched transaction — show as scheduled (missed/unlinked)
      paymentAmount = scheduledPayment
    }

    // Clamp final payment to remaining balance + interest
    const totalDue = balance + interestCharge
    if (paymentAmount > totalDue + 0.005) paymentAmount = totalDue

    const principalPortion = Math.max(0, paymentAmount - interestCharge)
    const interestPortion  = Math.min(paymentAmount, interestCharge)
    // Extra principal = how much more principal was paid vs scheduled this period
    const extraPrincipal   = isActual && !isFuture
      ? Math.max(0, principalPortion - scheduledPrincipal)
      : 0
    balance = Math.max(0, balance - principalPortion)

    schedule.push({
      date:                isActual ? (actualByMonth[ym].dates[0] || dateStr) : dateStr,
      month:               ym,
      amount:              parseFloat(paymentAmount.toFixed(2)),
      principal:           parseFloat(principalPortion.toFixed(2)),
      interest:            parseFloat(interestPortion.toFixed(2)),
      scheduled_principal: parseFloat(scheduledPrincipal.toFixed(2)),
      scheduled_interest:  parseFloat(scheduledInterest.toFixed(2)),
      extra_principal:     parseFloat(extraPrincipal.toFixed(2)),
      balance:             parseFloat(balance.toFixed(2)),
      is_actual:           isActual && !isFuture,
      is_future:           isFuture,
      is_missed:           !isActual && !isFuture && ym >= origination_date.slice(0, 7),
      description:         isActual ? actualByMonth[ym].descriptions.join(', ') : null,
    })
  }

  return schedule
}

// ── GET /api/liabilities ──────────────────────────────────────────────────────

// ── Compute current balance from matched transactions ────────────────────────
// Lightweight version of the amortization walk — returns the balance after the
// last actual matched payment, or liability.balance if no loan terms / no matches.

function computeCurrentBalance(userId, liability) {
  const { id, balance, original_principal: P, interest_rate: annualRate,
          loan_term_months: n, origination_date, monthly_payment: storedPayment,
          category_id } = liability

  if (!P || !annualRate || !n || !origination_date || !category_id) return balance

  const cat = db.prepare(
    'SELECT category FROM budget_categories WHERE id = ? AND user_id = ?'
  ).get(category_id, userId)
  if (!cat) return balance

  const transactions = db.prepare(`
    SELECT date, amount FROM transactions
    WHERE user_id = ? AND category = ? AND date >= ? AND pending = 0
    ORDER BY date ASC
  `).all(userId, cat.category, origination_date)

  if (transactions.length === 0) return balance

  const r   = annualRate / 12
  const pmt = storedPayment ||
    (r > 0 ? P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : P / n)

  // Build actual-by-month map
  const actualByMonth = {}
  for (const txn of transactions) {
    const ym = txn.date.slice(0, 7)
    actualByMonth[ym] = (actualByMonth[ym] || 0) + Math.abs(txn.amount)
  }

  const today = new Date().toISOString().slice(0, 7)
  let runningBalance = P
  let lastActualBalance = null

  for (let i = 0; i < n && runningBalance > 0.005; i++) {
    const d = new Date(origination_date + 'T00:00:00')
    d.setMonth(d.getMonth() + i + 1)
    const ym = d.toISOString().slice(0, 7)
    if (ym > today) break

    const interestCharge = runningBalance * r
    const paymentAmount  = actualByMonth[ym]
    if (!paymentAmount) continue  // no transaction this month — skip

    const totalDue = runningBalance + interestCharge
    const capped   = paymentAmount > totalDue + 0.005 ? totalDue : paymentAmount
    const principal = Math.max(0, capped - interestCharge)
    runningBalance  = Math.max(0, runningBalance - principal)
    lastActualBalance = runningBalance
  }

  return lastActualBalance !== null
    ? parseFloat(lastActualBalance.toFixed(2))
    : balance
}

router.get('/', (req, res) => {
  const userId      = req.session.userId
  const liabilities = db.prepare(
    'SELECT * FROM liabilities WHERE user_id = ? ORDER BY type, name'
  ).all(userId)

  // Augment each liability with current_balance derived from matched transactions
  const result = liabilities.map(liab => ({
    ...liab,
    current_balance: computeCurrentBalance(userId, liab),
  }))

  res.json(result)
})

// ── GET /api/liabilities/:id/schedule ────────────────────────────────────────
// Returns the full amortization schedule — past (actual + missed) + future
// (projected). Requires loan terms on the liability and a linked category_id.

router.get('/:id/schedule', (req, res) => {
  const userId      = req.session.userId
  const liabilityId = req.params.id

  const liability = db.prepare(
    'SELECT * FROM liabilities WHERE id = ? AND user_id = ?'
  ).get(liabilityId, userId)
  if (!liability) return res.status(404).json({ error: 'Not found' })

  // Require loan terms for amortization
  const { original_principal, interest_rate, loan_term_months, origination_date } = liability
  if (!original_principal || !interest_rate || !loan_term_months || !origination_date) {
    return res.status(400).json({ error: 'Liability is missing loan terms (principal, rate, term, origination date)' })
  }

  // Fetch matched transactions via linked category
  let transactions = []
  if (liability.category_id) {
    // Get the category name so we can match transactions by category string
    const cat = db.prepare(
      'SELECT category FROM budget_categories WHERE id = ? AND user_id = ?'
    ).get(liability.category_id, userId)

    if (cat) {
      transactions = db.prepare(`
        SELECT id, date, amount, description, category
        FROM transactions
        WHERE user_id = ?
          AND category = ?
          AND date >= ?
          AND pending = 0
        ORDER BY date ASC
      `).all(userId, cat.category, origination_date)
    }
  }

  const schedule = buildAmortizationSchedule(liability, transactions)
  if (!schedule) return res.status(400).json({ error: 'Could not build schedule' })

  // Compute summary stats
  const pastPayments  = schedule.filter(p => p.is_actual)
  const totalPaid     = pastPayments.reduce((s, p) => s + p.amount, 0)
  const principalPaid = pastPayments.reduce((s, p) => s + p.principal, 0)
  const interestPaid  = pastPayments.reduce((s, p) => s + p.interest, 0)

  // Current balance is the balance after the last actual payment (or original if none)
  const lastActual    = [...pastPayments].pop()
  const currentBalance = lastActual ? lastActual.balance : original_principal

  // Total projected interest remaining (sum of future interest charges)
  const futurePayments      = schedule.filter(p => p.is_future)
  const interestRemaining   = futurePayments.reduce((s, p) => s + p.interest, 0)
  const totalInterest       = schedule.reduce((s, p) => s + p.interest, 0)

  // Projected payoff date = date of last scheduled payment
  const lastPayment   = schedule[schedule.length - 1]
  const payoffDate    = lastPayment?.date || null

  // Months remaining from today
  const today         = new Date().toISOString().slice(0, 7)
  const monthsRemaining = schedule.filter(p => p.month > today).length

  // ── Persist computed balance back to DB ──────────────────────────────────
  // The authoritative current balance is derived from matched transactions.
  // Write it back so liabilities.balance stays up to date without requiring
  // a manual PUT, and snapshot it for the net worth chart.
  const persistedBalance = parseFloat(currentBalance.toFixed(2))
  db.prepare(
    'UPDATE liabilities SET balance = ? WHERE id = ? AND user_id = ?'
  ).run(persistedBalance, liabilityId, userId)
  snapshotLiabilityToday(userId, liabilityId, persistedBalance)

  res.json({
    schedule,
    summary: {
      original_principal,
      current_balance:    persistedBalance,
      principal_paid:     parseFloat(principalPaid.toFixed(2)),
      interest_paid:      parseFloat(interestPaid.toFixed(2)),
      total_paid:         parseFloat(totalPaid.toFixed(2)),
      interest_remaining: parseFloat(interestRemaining.toFixed(2)),
      total_interest:     parseFloat(totalInterest.toFixed(2)),
      payoff_date:        payoffDate,
      months_remaining:   monthsRemaining,
      payment_count:      pastPayments.length,
      scheduled_payment:  parseFloat((liability.monthly_payment ||
        (interest_rate / 12 > 0
          ? original_principal * (interest_rate / 12) * Math.pow(1 + interest_rate / 12, loan_term_months) /
            (Math.pow(1 + interest_rate / 12, loan_term_months) - 1)
          : original_principal / loan_term_months)
      ).toFixed(2)),
    },
  })
})

// ── POST /api/liabilities ─────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const {
    name, type, balance, asset_id, plaid_account_id,
    original_principal, interest_rate, loan_term_months,
    origination_date, monthly_payment, notes, category_id,
  } = req.body
  if (!name || !type || balance === undefined) {
    return res.status(400).json({ error: 'name, type, and balance are required' })
  }
  const userId = req.session.userId
  try {
    const result = db.prepare(`
      INSERT INTO liabilities
        (user_id, name, type, balance, asset_id, plaid_account_id,
         original_principal, interest_rate, loan_term_months,
         origination_date, monthly_payment, notes, category_id)
      VALUES
        (@user_id, @name, @type, @balance, @asset_id, @plaid_account_id,
         @original_principal, @interest_rate, @loan_term_months,
         @origination_date, @monthly_payment, @notes, @category_id)
    `).run({
      user_id:            userId,
      name,
      type,
      balance:            parseFloat(balance),
      asset_id:           asset_id           || null,
      plaid_account_id:   plaid_account_id   || null,
      original_principal: original_principal ? parseFloat(original_principal) : null,
      interest_rate:      interest_rate      ? parseFloat(interest_rate)      : null,
      loan_term_months:   loan_term_months   ? parseInt(loan_term_months)     : null,
      origination_date:   origination_date   || null,
      monthly_payment:    monthly_payment    ? parseFloat(monthly_payment)    : null,
      notes:              notes              || null,
      category_id:        category_id        ? parseInt(category_id)          : null,
    })
    const id = result.lastInsertRowid
    snapshotLiabilityToday(userId, id, parseFloat(balance))
    res.json({ id, name, type, balance: parseFloat(balance) })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── PUT /api/liabilities/:id ──────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const {
    name, type, balance, asset_id, plaid_account_id,
    original_principal, interest_rate, loan_term_months,
    origination_date, monthly_payment, notes, category_id,
  } = req.body
  const userId      = req.session.userId
  const liabilityId = req.params.id

  const existing = db.prepare(
    'SELECT id FROM liabilities WHERE id = ? AND user_id = ?'
  ).get(liabilityId, userId)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  db.prepare(`
    UPDATE liabilities SET
      name               = @name,
      type               = @type,
      balance            = @balance,
      asset_id           = @asset_id,
      plaid_account_id   = @plaid_account_id,
      original_principal = @original_principal,
      interest_rate      = @interest_rate,
      loan_term_months   = @loan_term_months,
      origination_date   = @origination_date,
      monthly_payment    = @monthly_payment,
      notes              = @notes,
      category_id        = @category_id
    WHERE id = @id AND user_id = @user_id
  `).run({
    name,
    type,
    balance:            parseFloat(balance),
    asset_id:           asset_id           || null,
    plaid_account_id:   plaid_account_id   || null,
    original_principal: original_principal ? parseFloat(original_principal) : null,
    interest_rate:      interest_rate      ? parseFloat(interest_rate)      : null,
    loan_term_months:   loan_term_months   ? parseInt(loan_term_months)     : null,
    origination_date:   origination_date   || null,
    monthly_payment:    monthly_payment    ? parseFloat(monthly_payment)    : null,
    notes:              notes              || null,
    category_id:        category_id        ? parseInt(category_id)          : null,
    id:                 liabilityId,
    user_id:            userId,
  })

  snapshotLiabilityToday(userId, liabilityId, parseFloat(balance))
  res.json({ message: 'Updated' })
})

// ── DELETE /api/liabilities/:id ───────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const userId      = req.session.userId
  const liabilityId = req.params.id

  const existing = db.prepare(
    'SELECT id FROM liabilities WHERE id = ? AND user_id = ?'
  ).get(liabilityId, userId)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  db.prepare('DELETE FROM liabilities WHERE id = ? AND user_id = ?').run(liabilityId, userId)
  res.json({ message: 'Deleted' })
})

module.exports = router