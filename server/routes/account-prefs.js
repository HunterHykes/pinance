const express     = require('express')
const db          = require('../db')
const requireAuth = require('../middleware/auth')
const router      = express.Router()

router.use(requireAuth)

// ── Account preferences (display name, line style, hidden) ───────────────────

router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT account_id, display_name, line_style, is_hidden FROM account_preferences WHERE user_id = ?'
  ).all(req.session.userId)
  const prefs = {}
  for (const row of rows) {
    prefs[row.account_id] = {
      display_name: row.display_name || null,
      line_style:   row.line_style   || 'solid',
      is_hidden:    !!row.is_hidden,
    }
  }
  res.json(prefs)
})

router.put('/:accountId', (req, res) => {
  const { display_name, line_style, is_hidden } = req.body
  const userId    = req.session.userId
  const accountId = req.params.accountId

  const acct = db.prepare(
    'SELECT id FROM accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, userId)
  if (!acct) return res.status(404).json({ error: 'Account not found' })

  db.prepare(`
    INSERT INTO account_preferences (user_id, account_id, display_name, line_style, is_hidden)
    VALUES (@user_id, @account_id, @display_name, @line_style, @is_hidden)
    ON CONFLICT(user_id, account_id) DO UPDATE SET
      display_name = excluded.display_name,
      line_style   = excluded.line_style,
      is_hidden    = excluded.is_hidden
  `).run({
    user_id:      userId,
    account_id:   accountId,
    display_name: display_name || null,
    line_style:   line_style   || 'solid',
    is_hidden:    is_hidden    ? 1 : 0,
  })

  res.json({ message: 'Saved' })
})

// ── Institution preferences (color, url, sync_frequency) ─────────────────────

router.get('/institution', (req, res) => {
  const rows = db.prepare(
    'SELECT institution, color, url, sync_frequency FROM institution_preferences WHERE user_id = ?'
  ).all(req.session.userId)
  const prefs = {}
  for (const row of rows) {
    prefs[row.institution] = {
      color:          row.color          || null,
      url:            row.url            || null,
      sync_frequency: row.sync_frequency || null,
    }
  }
  res.json(prefs)
})

router.put('/institution/:institution', (req, res) => {
  const { color, url, sync_frequency } = req.body
  const userId      = req.session.userId
  const institution = req.params.institution

  db.prepare(`
    INSERT INTO institution_preferences (user_id, institution, color, url, sync_frequency)
    VALUES (@user_id, @institution, @color, @url, @sync_frequency)
    ON CONFLICT(user_id, institution) DO UPDATE SET
      color          = excluded.color,
      url            = excluded.url,
      sync_frequency = excluded.sync_frequency
  `).run({
    user_id:        userId,
    institution,
    color:          color          || null,
    url:            url            || null,
    sync_frequency: sync_frequency || null,
  })

  res.json({ message: 'Saved' })
})

// ── Balance snapshots ─────────────────────────────────────────────────────────

router.get('/:accountId/snapshots', (req, res) => {
  const userId    = req.session.userId
  const accountId = req.params.accountId

  const acct = db.prepare(
    'SELECT id FROM accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, userId)
  if (!acct) return res.status(404).json({ error: 'Account not found' })

  const rows = db.prepare(`
    SELECT date, balance FROM balance_snapshots
    WHERE user_id = ? AND account_id = ?
    ORDER BY date DESC LIMIT 365
  `).all(userId, accountId)
  res.json(rows)
})

router.put('/:accountId/snapshots', (req, res) => {
  const { date, balance } = req.body
  const userId    = req.session.userId
  const accountId = req.params.accountId

  if (!date || balance === undefined)
    return res.status(400).json({ error: 'date and balance required' })

  const acct = db.prepare(
    'SELECT id FROM accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, userId)
  if (!acct) return res.status(404).json({ error: 'Account not found' })

  db.prepare(`
    INSERT INTO balance_snapshots (user_id, account_id, date, balance)
    VALUES (@user_id, @account_id, @date, @balance)
    ON CONFLICT(user_id, account_id, date) DO UPDATE SET balance = excluded.balance
  `).run({ user_id: userId, account_id: accountId, date, balance: parseFloat(balance) })

  res.json({ message: 'Saved' })
})

router.delete('/:accountId/snapshots/:date', (req, res) => {
  db.prepare(`
    DELETE FROM balance_snapshots
    WHERE user_id = ? AND account_id = ? AND date = ?
  `).run(req.session.userId, req.params.accountId, req.params.date)
  res.json({ message: 'Deleted' })
})

module.exports = router