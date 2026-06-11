const express  = require('express');
const bcrypt   = require('bcryptjs');
const db       = require('../db');
const { seedTemplateForUser } = require('../default-template');
const requireAuth = require('../middleware/auth');
const router   = express.Router();

// ── Helper: verify password for current session user ─────────────────────────
async function verifyPassword(userId, password) {
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId)
  if (!user) return false
  return bcrypt.compare(password, user.password_hash)
}

// ── Register ──────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const hash   = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    const newUserId = result.lastInsertRowid
    req.session.userId   = newUserId;
    req.session.username = username;
    try { seedTemplateForUser(newUserId) } catch (e) { console.error('Template seed failed:', e.message) }
    res.json({ message: 'Account created', username });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.userId   = user.id;
    req.session.username = user.username;
    res.json({ message: 'Logged in', username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

// ── Session check ─────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (req.session.userId) {
    return res.json({ userId: req.session.userId, username: req.session.username });
  }
  res.status(401).json({ error: 'Not logged in' });
});

// ── Shared data-wipe helper ───────────────────────────────────────────────────
// Clears all user data within an existing SQLite transaction.
// Must be called inside db.transaction() — does NOT open its own transaction.
//
// Root cause of the original 500: budget_categories was deleted while several
// tables still held non-cascade FK references to it:
//   bills.parent_category_id → budget_categories(id)   [no cascade]
//   income_sources.parent_category_id → budget_categories(id)  [no cascade]
//   bill_charges.budget_category_id → budget_categories(id) [no cascade]
//   income_schedules.budget_category_id → budget_categories(id) [no cascade]
// Additionally, income_sources / income_schedules / bill_charges /
// asset_snapshots were missing from the purge entirely.
//
// Fix: nullify all non-cascade back-references first, then delete in safe order.

function wipeUserData(userId) {
  // ── Step 1: Nullify non-cascade FK references ─────────────────────────────
  // Break circular refs: bills ↔ budget_categories and
  // income_sources ↔ budget_categories
  db.prepare('UPDATE bills  SET parent_category_id = NULL WHERE user_id = ?').run(userId)
  db.prepare('UPDATE income_sources SET parent_category_id = NULL WHERE user_id = ?').run(userId)

  // Nullify non-cascade refs on bill_charges
  db.prepare(`
    UPDATE bill_charges SET budget_category_id = NULL
    WHERE bill_id IN (SELECT id FROM bills WHERE user_id = ?)
  `).run(userId)
  db.prepare(`
    UPDATE bill_charges SET account_id = NULL
    WHERE bill_id IN (SELECT id FROM bills WHERE user_id = ?)
  `).run(userId)

  // Nullify non-cascade refs on income_schedules
  db.prepare(`
    UPDATE income_schedules SET budget_category_id = NULL
    WHERE income_id IN (SELECT id FROM income_sources WHERE user_id = ?)
  `).run(userId)
  db.prepare(`
    UPDATE income_schedules SET account_id = NULL
    WHERE income_id IN (SELECT id FROM income_sources WHERE user_id = ?)
  `).run(userId)

  // Nullify non-cascade account refs on bills and income_sources themselves
  db.prepare('UPDATE bills  SET account_id = NULL WHERE user_id = ?').run(userId)
  db.prepare('UPDATE income_sources SET account_id = NULL WHERE user_id = ?').run(userId)

  // ── Step 2: Delete in safe dependency order ───────────────────────────────
  // Income: schedules first (or let ON DELETE CASCADE handle it from income_sources)
  db.prepare(`
    DELETE FROM income_schedules
    WHERE income_id IN (SELECT id FROM income_sources WHERE user_id = ?)
  `).run(userId)
  db.prepare('DELETE FROM income_sources WHERE user_id = ?').run(userId)

  // Subscriptions: charges first (or let ON DELETE CASCADE handle it from bills)
  db.prepare(`
    DELETE FROM bill_charges
    WHERE bill_id IN (SELECT id FROM bills WHERE user_id = ?)
  `).run(userId)
  db.prepare('DELETE FROM bills WHERE user_id = ?').run(userId)

  // Budget (limits and template cascade-delete when categories are deleted,
  // but delete explicitly to keep the intent clear)
  db.prepare('DELETE FROM budget_limits    WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM budget_template  WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM budget_categories WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM budget_months    WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM category_map     WHERE user_id = ?').run(userId)

  // Transactions (splits cascade from transactions via ON DELETE CASCADE)
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId)

  // Plaid
  db.prepare('DELETE FROM plaid_items    WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM plaid_settings WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM plaid_usage    WHERE user_id = ?').run(userId)

  // Snapshots
  db.prepare('DELETE FROM balance_snapshots WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM snapshot_backfill  WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM asset_snapshots    WHERE user_id = ?').run(userId)

  // Accounts and assets (asset_snapshots cascade from assets via ON DELETE CASCADE)
  db.prepare('DELETE FROM accounts           WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM assets             WHERE user_id = ?').run(userId)

  // Liabilities (liability_snapshots cascade via ON DELETE CASCADE)
  db.prepare('DELETE FROM liabilities WHERE user_id = ?').run(userId)

  // Preferences
  db.prepare('DELETE FROM account_preferences      WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM institution_preferences  WHERE user_id = ?').run(userId)
}

// ── Purge data — wipe everything except user row + password ──────────────────
router.delete('/data', requireAuth, async (req, res) => {
  const userId       = req.session.userId
  const { password } = req.body

  if (!password) return res.status(400).json({ error: 'Password required' })
  const valid = await verifyPassword(userId, password)
  if (!valid) return res.status(401).json({ error: 'Incorrect password' })

  try {
    db.transaction(() => {
      wipeUserData(userId)
      // Re-seed default template so user has a clean starting state
      seedTemplateForUser(userId)
    })()
    res.json({ message: 'Data purged' })
  } catch (err) {
    console.error('Purge error:', err.message)
    res.status(500).json({ error: 'Failed to purge data' })
  }
})

// ── Delete account ────────────────────────────────────────────────────────────
router.delete('/account', requireAuth, async (req, res) => {
  const userId       = req.session.userId
  const { password } = req.body

  if (!password) return res.status(400).json({ error: 'Password required' })
  const valid = await verifyPassword(userId, password)
  if (!valid) return res.status(401).json({ error: 'Incorrect password' })

  try {
    db.transaction(() => {
      wipeUserData(userId)
      db.prepare('DELETE FROM users WHERE id = ?').run(userId)
    })()
    req.session.destroy(() => {
      res.clearCookie('connect.sid')
      res.json({ message: 'Account deleted' })
    })
  } catch (err) {
    console.error('Delete account error:', err.message)
    res.status(500).json({ error: 'Failed to delete account' })
  }
})

module.exports = router;