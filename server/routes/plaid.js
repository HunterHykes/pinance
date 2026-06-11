// routes/plaid.js — Plaid Link, sync, settings, and usage

const express     = require('express');
const db          = require('../db');
const requireAuth = require('../middleware/auth');
const { plaid, syncAll, syncItem, syncUser, FREQUENCY_HOURS, PRICING } = require('../plaid');
const router      = express.Router();

router.use(requireAuth);

// ── Pricing & frequency constants ─────────────────────────────────────────────

const FREQUENCIES = [
  { value: 'daily',        label: 'Daily',        hours: 24  },
  { value: 'twice_weekly', label: 'Twice weekly',  hours: 84  },
  { value: 'weekly',       label: 'Weekly',        hours: 168 },
  { value: 'biweekly',     label: 'Bi-weekly',     hours: 336 },
  { value: 'monthly',      label: 'Monthly',       hours: 720 },
]

// Estimate monthly cost for a given frequency
// Costs: $0.12/refresh call + $0.30/account/month (subscription, fixed)
function estimateMonthlyCost(userId, frequencyValue) {
  const freq = FREQUENCIES.find(f => f.value === frequencyValue)
  if (!freq) return null

  const accountCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM accounts WHERE user_id = ? AND plaid_id IS NOT NULL`
  ).get(userId)?.cnt || 0

  const syncsPerMonth     = Math.round((30 * 24) / freq.hours)
  const itemCount         = db.prepare(
    `SELECT COUNT(*) as cnt FROM plaid_items WHERE user_id = ?`
  ).get(userId)?.cnt || 0

  // Each sync call = one transactions/refresh charge per item
  const refreshCost       = syncsPerMonth * itemCount * PRICING.transactions_refresh
  // Account subscription is fixed regardless of sync frequency
  const subscriptionCost  = accountCount * 0.30

  return {
    syncs_per_month:    syncsPerMonth,
    account_count:      accountCount,
    item_count:         itemCount,
    refresh_cost:       parseFloat(refreshCost.toFixed(2)),
    subscription_cost:  parseFloat(subscriptionCost.toFixed(2)),
    total:              parseFloat((refreshCost + subscriptionCost).toFixed(2)),
  }
}

// ── Create link token ─────────────────────────────────────────────────────────

router.post('/link/token', async (req, res) => {
  try {
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: String(req.session.userId) },
      client_name: 'Pinance',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
      redirect_uri: 'https://pinance.hykes.net/accounts',
    });
    res.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error('Link token error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create link token' });
  }
});

// ── Exchange public token ─────────────────────────────────────────────────────

router.post('/exchange', async (req, res) => {
  const { public_token, institution_name } = req.body;
  try {
    const response = await plaid.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = response.data;
    db.prepare(`
      INSERT OR IGNORE INTO plaid_items (user_id, access_token, item_id, institution)
      VALUES (?, ?, ?, ?)
    `).run(req.session.userId, access_token, item_id, institution_name || null);
    const item = db.prepare('SELECT * FROM plaid_items WHERE item_id = ?').get(item_id);

    // Initial sync is best-effort — some OAuth institutions (e.g. Capital One)
    // return PRODUCT_NOT_READY immediately after exchange. The item is saved;
    // the user can manually sync once data is ready.
    try {
      await syncItem(item, { includeBalance: true });
    } catch (syncErr) {
      console.error('Initial sync skipped (will retry on manual sync):', syncErr.message);
    }

    res.json({ message: 'Bank connected' });
  } catch (err) {
    console.error('Exchange error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to connect bank' });
  }
});

// ── Manual sync — includes balance fetch ─────────────────────────────────────

router.post('/sync', async (req, res) => {
  try {
    await syncUser(req.session.userId, { includeBalance: true });
    res.json({ message: 'Sync complete', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Sync error:', err.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ── List connected institutions ───────────────────────────────────────────────

router.get('/items', (req, res) => {
  const items = db.prepare(
    'SELECT id, institution, last_synced FROM plaid_items WHERE user_id = ?'
  ).all(req.session.userId);
  res.json(items);
});

// ── GET /api/plaid/settings ───────────────────────────────────────────────────

router.get('/settings', (req, res) => {
  const userId = req.session.userId

  const settings = db.prepare(
    `SELECT sync_frequency, last_heartbeat, last_sync_type FROM plaid_settings WHERE user_id = ?`
  ).get(userId) || { sync_frequency: 'weekly', last_heartbeat: null, last_sync_type: null }

  const lastSync = db.prepare(
    `SELECT MAX(last_synced) as last FROM plaid_items WHERE user_id = ?`
  ).get(userId)?.last || null

  const costEstimate = estimateMonthlyCost(userId, settings.sync_frequency)

  res.json({
    sync_frequency:  settings.sync_frequency,
    last_heartbeat:  settings.last_heartbeat,
    last_sync:       lastSync,
    last_sync_type:  settings.last_sync_type,
    frequencies:     FREQUENCIES,
    cost_estimate:   costEstimate,
  })
})

// ── PUT /api/plaid/settings ───────────────────────────────────────────────────

router.put('/settings', async (req, res) => {
  const { sync_frequency, password } = req.body
  const userId = req.session.userId

  if (!FREQUENCIES.find(f => f.value === sync_frequency)) {
    return res.status(400).json({ error: 'Invalid frequency' })
  }

  // Require password confirmation for schedule changes
  if (!password) return res.status(400).json({ error: 'Password required' })
  const bcrypt = require('bcryptjs')
  const user   = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId)
  const valid  = await bcrypt.compare(password, user?.password_hash || '')
  if (!valid) return res.status(401).json({ error: 'Incorrect password' })

  db.prepare(`
    INSERT INTO plaid_settings (user_id, sync_frequency, updated_at)
    VALUES (@user_id, @sync_frequency, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      sync_frequency = excluded.sync_frequency,
      updated_at     = excluded.updated_at
  `).run({ user_id: userId, sync_frequency })

  const costEstimate = estimateMonthlyCost(userId, sync_frequency)
  res.json({ message: 'Saved', cost_estimate: costEstimate })
})

// ── GET /api/plaid/settings/estimate?frequency=weekly ────────────────────────
// Live cost estimate while the user is picking a frequency (before saving)

router.get('/settings/estimate', (req, res) => {
  const { frequency } = req.query
  if (!frequency) return res.status(400).json({ error: 'frequency required' })
  const estimate = estimateMonthlyCost(req.session.userId, frequency)
  if (!estimate) return res.status(400).json({ error: 'Invalid frequency' })
  res.json(estimate)
})

// ── GET /api/plaid/usage ──────────────────────────────────────────────────────

router.get('/usage', (req, res) => {
  const userId = req.session.userId
  const month  = req.query.month || new Date().toISOString().slice(0, 7)

  const rows = db.prepare(
    `SELECT call_type, call_count, estimated_cost FROM plaid_usage
     WHERE user_id = ? AND month = ?`
  ).all(userId, month)

  // Also get account subscription cost (fixed, not per-call)
  const accountCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM accounts WHERE user_id = ? AND plaid_id IS NOT NULL`
  ).get(userId)?.cnt || 0

  const subscriptionCost = accountCount * 0.30
  const callTotal        = rows.reduce((s, r) => s + r.estimated_cost, 0)

  res.json({
    month,
    rows,
    account_count:     accountCount,
    subscription_cost: parseFloat(subscriptionCost.toFixed(2)),
    call_total:        parseFloat(callTotal.toFixed(2)),
    total:             parseFloat((callTotal + subscriptionCost).toFixed(2)),
  })
})


// ── DELETE /api/plaid/items/:id — disconnect an institution ───────────────────
// Body params:
//   action           — 'keep_manual' (default) | 'delete_transactions' | 'move_to_account'
//   target_account_id — required when action = 'move_to_account'

router.delete('/items/:id', async (req, res) => {
  const userId = req.session.userId
  const { action = 'keep_manual', target_account_id } = req.body || {}
  const item = db.prepare('SELECT * FROM plaid_items WHERE id = ? AND user_id = ?')
                 .get(req.params.id, userId)
  if (!item) return res.status(404).json({ error: 'Not found' })

  // Revoke access token on Plaid's side (best-effort — continue even if this fails)
  try { await plaid.itemRemove({ access_token: item.access_token }) }
  catch (e) { console.error('Plaid itemRemove error:', e.message) }

  // IDs of all Plaid accounts being disconnected from this institution
  const plaidAccounts = db.prepare(
    'SELECT id FROM accounts WHERE user_id = ? AND institution = ? AND plaid_id IS NOT NULL'
  ).all(userId, item.institution)
  const plaidAccountIds = plaidAccounts.map(a => a.id)

  db.transaction(() => {
    if (action === 'move_to_account' && target_account_id) {
      const target = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(target_account_id, userId)
      if (!target) throw new Error('Target account not found')
      for (const acctId of plaidAccountIds) {
        db.prepare(`
          UPDATE transactions
          SET account_id = @target,
              original_account_id = COALESCE(original_account_id, account_id)
          WHERE account_id = @src AND user_id = @uid
        `).run({ target: target_account_id, src: acctId, uid: userId })
      }
    } else if (action === 'delete_transactions') {
      for (const acctId of plaidAccountIds) {
        db.prepare('DELETE FROM transactions WHERE account_id = ? AND user_id = ?').run(acctId, userId)
      }
    }
    // Convert all Plaid accounts to manual regardless of transaction action
    db.prepare(`
      UPDATE accounts SET plaid_id = NULL, is_manual = 1
      WHERE user_id = ? AND institution = ? AND plaid_id IS NOT NULL
    `).run(userId, item.institution)

    db.prepare('DELETE FROM plaid_items WHERE id = ? AND user_id = ?').run(req.params.id, userId)
  })()

  res.json({ message: 'Disconnected' })
})

module.exports = router;