const db = require('./db')

// ── Upsert today's balance for every account belonging to a user ──────────────
// Called after every Plaid sync and on manual account updates.

function snapshotToday(userId) {
  const today    = new Date().toISOString().slice(0, 10)
  const accounts = db.prepare(
    'SELECT id, balance FROM accounts WHERE user_id = ?'
  ).all(userId)

  const upsert = db.prepare(`
    INSERT INTO balance_snapshots (user_id, account_id, date, balance)
    VALUES (@user_id, @account_id, @date, @balance)
    ON CONFLICT(user_id, account_id, date) DO UPDATE SET balance = excluded.balance
  `)

  db.transaction(() => {
    for (const acct of accounts) {
      upsert.run({ user_id: userId, account_id: acct.id, date: today, balance: acct.balance })
    }
  })()
}

// ── One-time historical backfill ──────────────────────────────────────────────
// Reconstructs daily balances by working backwards from current balance
// using transaction history: balance(date) = current - sum(txns after date).
// Only runs once per user; safe to call multiple times.

function backfillSnapshots(userId) {
  // Skip if already done
  const done = db.prepare(
    'SELECT id FROM snapshot_backfill WHERE user_id = ?'
  ).get(userId)
  if (done) return

  const accounts = db.prepare(
    'SELECT id, balance FROM accounts WHERE user_id = ?'
  ).all(userId)

  if (accounts.length === 0) return

  // Find earliest transaction date across all accounts for this user
  const earliest = db.prepare(`
    SELECT MIN(date) as min_date FROM transactions
    WHERE user_id = ? AND pending = 0
  `).get(userId)

  if (!earliest?.min_date) {
    // No transactions — just snapshot today and mark done
    snapshotToday(userId)
    db.prepare('INSERT OR IGNORE INTO snapshot_backfill (user_id) VALUES (?)').run(userId)
    return
  }

  const upsert = db.prepare(`
    INSERT OR IGNORE INTO balance_snapshots (user_id, account_id, date, balance)
    VALUES (@user_id, @account_id, @date, @balance)
  `)

  // For each account, compute balance at each date from earliest → today
  db.transaction(() => {
    for (const acct of accounts) {
      // All non-pending transactions for this account, sorted newest first
      const txns = db.prepare(`
        SELECT date, amount FROM transactions
        WHERE account_id = ? AND user_id = ? AND pending = 0
        ORDER BY date DESC
      `).all(acct.id, userId)

      // Walk dates from today back to earliest
      const today     = new Date().toISOString().slice(0, 10)
      const startDate = earliest.min_date
      let   runningBalance = acct.balance
      let   txnIdx         = 0

      // Collect all dates we need (today → startDate)
      const dates = []
      const d = new Date(today)
      const s = new Date(startDate)
      while (d >= s) {
        dates.push(d.toISOString().slice(0, 10))
        d.setDate(d.getDate() - 1)
      }

      // For each date, snapshot the balance, then subtract txns ON that date
      // to get the balance at the start of the previous day
      for (const date of dates) {
        upsert.run({ user_id: userId, account_id: acct.id, date, balance: runningBalance })

        // Subtract all transactions that occurred ON this date
        while (txnIdx < txns.length && txns[txnIdx].date === date) {
          runningBalance -= txns[txnIdx].amount
          txnIdx++
        }
      }
    }

    db.prepare('INSERT OR IGNORE INTO snapshot_backfill (user_id) VALUES (?)').run(userId)
  })()

  console.log(`[snapshots] Backfill complete for user ${userId}`)
}

module.exports = { snapshotToday, backfillSnapshots }