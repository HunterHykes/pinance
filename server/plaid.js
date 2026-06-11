const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');
const crypto = require('crypto');
const db = require('./db');
const { snapshotToday, backfillSnapshots } = require('./snapshots');

// ── Pricing constants (per Plaid contract) ────────────────────────────────────
const PRICING = {
  transactions_refresh: 0.12,   // per successful sync call
  balance:              0.10,   // per accountsBalanceGet call
  // transactions_subscription: $0.30/account/month — tracked separately
}

// ── Plaid client ──────────────────────────────────────────────────────────────
const plaid = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET':    process.env.PLAID_SECRET,
    },
  },
}));

// ── Usage tracking ────────────────────────────────────────────────────────────

function recordUsage(userId, callType, callCount = 1) {
  const month = new Date().toISOString().slice(0, 7)
  const cost  = (PRICING[callType] || 0) * callCount

  db.prepare(`
    INSERT INTO plaid_usage (user_id, month, call_type, call_count, estimated_cost, updated_at)
    VALUES (@user_id, @month, @call_type, @call_count, @cost, datetime('now'))
    ON CONFLICT(user_id, month, call_type) DO UPDATE SET
      call_count     = call_count + excluded.call_count,
      estimated_cost = estimated_cost + excluded.estimated_cost,
      updated_at     = excluded.updated_at
  `).run({ user_id: userId, month, call_type: callType, call_count: callCount, cost })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dedupKey(accountId, date, amount, name) {
  const raw = [accountId, date, Number(amount).toFixed(2),
               name.toLowerCase().trim().replace(/\s+/g, ' ')].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function normalizeType(type, subtype) {
  if (type === 'depository' && subtype === 'checking') return 'Checking';
  if (type === 'depository' && subtype === 'savings')  return 'Savings';
  if (type === 'investment')  return 'Investment';
  if (type === 'credit')      return 'Credit card';
  if (type === 'loan')        return 'Loan';
  return 'Other';
}

function normalizeCategory(primary, detailed) {
  if (!primary) return 'Other'
  const p = primary.toLowerCase()
  if (p.includes('transfer') || p.includes('payment')) return 'Transfer'
  if (detailed) {
    const d = detailed.toLowerCase()
    if (d.includes('transfer') || d.includes('payment')) return 'Transfer'
    if (detailed.startsWith(primary)) return detailed
    return `${primary}_${detailed}`
  }
  return primary
}

// ── Core sync — transactions only (used by cron) ──────────────────────────────

async function syncItemTransactions(item) {
  const mappings = db.prepare(
    'SELECT plaid_category, budget_category FROM category_map WHERE user_id = ?'
  ).all(item.user_id).reduce((map, row) => {
    map[row.plaid_category] = row.budget_category
    return map
  }, {})

  function applyMapping(plaidCat) {
    return mappings[plaidCat] || plaidCat
  }

  const insertTxn = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, plaid_id, dedup_key, account_id, amount, date, description,
       category, plaid_category, source, pending)
    VALUES
      (@user_id, @plaid_id, @dedup_key, @account_id, @amount, @date, @description,
       @category, @plaid_category, 'plaid', @pending)
  `);

  const updateTxn = db.prepare(`
    UPDATE transactions SET
      plaid_id    = @plaid_id,
      pending     = @pending,
      description = @description
    WHERE dedup_key = @dedup_key AND user_id = @user_id
  `);

  const removeTxn = db.prepare(
    `DELETE FROM transactions WHERE plaid_id = ? AND user_id = ?`
  );

  let cursor  = item.cursor || null;
  let hasMore = true;

  while (hasMore) {
    const res = await plaid.transactionsSync({
      access_token: item.access_token,
      cursor,
    });
    const { added, modified, removed, next_cursor, has_more } = res.data;
    const acctRow = db.prepare(
      'SELECT id FROM accounts WHERE plaid_id = ? AND user_id = ?'
    );

    for (const t of added) {
      const acct = acctRow.get(t.account_id, item.user_id);
      if (!acct) continue;
      const key    = dedupKey(acct.id, t.date, t.amount, t.name);
      const rawCat = normalizeCategory(
        t.personal_finance_category?.primary ?? t.category?.[0],
        t.personal_finance_category?.detailed ?? null
      );
      insertTxn.run({
        user_id:        item.user_id,
        plaid_id:       t.transaction_id,
        dedup_key:      key,
        account_id:     acct.id,
        amount:         -t.amount,
        date:           t.date,
        description:    t.name,
        plaid_category: rawCat,
        category:       applyMapping(rawCat),
        pending:        t.pending ? 1 : 0,
      });
    }

    for (const t of modified) {
      const acct = acctRow.get(t.account_id, item.user_id);
      if (!acct) continue;
      const key = dedupKey(acct.id, t.date, t.amount, t.name);
      updateTxn.run({
        plaid_id:    t.transaction_id,
        pending:     t.pending ? 1 : 0,
        description: t.name,
        dedup_key:   key,
        user_id:     item.user_id,
      });
    }

    for (const t of removed) {
      removeTxn.run(t.transaction_id, item.user_id);
    }

    cursor  = next_cursor;
    hasMore = has_more;
  }

  // Record usage for this sync call
  recordUsage(item.user_id, 'transactions_refresh', 1)

  db.prepare(
    `UPDATE plaid_items SET cursor = ?, last_synced = datetime('now') WHERE item_id = ?`
  ).run(cursor, item.item_id);
}

// ── Balance fetch — updates account balances (used by manual sync only) ───────

async function syncItemBalances(item) {
  const acctRes = await plaid.accountsBalanceGet({ access_token: item.access_token });

  const upsertAcct = db.prepare(`
    INSERT INTO accounts
      (user_id, plaid_id, name, type, subtype, institution, balance, last_synced)
    VALUES
      (@user_id, @plaid_id, @name, @type, @subtype, @institution, @balance, datetime('now'))
    ON CONFLICT(user_id, plaid_id) DO UPDATE SET
      balance     = excluded.balance,
      last_synced = excluded.last_synced
  `);

  for (const a of acctRes.data.accounts) {
    upsertAcct.run({
      user_id:     item.user_id,
      plaid_id:    a.account_id,
      name:        a.name,
      type:        normalizeType(a.type, a.subtype),
      subtype:     a.subtype,
      institution: item.institution,
      balance:     a.balances.current,
    });
  }

  // Record usage for balance call
  recordUsage(item.user_id, 'balance', 1)
}

// ── Full sync — transactions + balances (manual "Sync now") ───────────────────

async function syncItem(item, { includeBalance = true } = {}) {
  if (includeBalance) {
    await syncItemBalances(item)
  }
  await syncItemTransactions(item)

  try {
    backfillSnapshots(item.user_id)
    snapshotToday(item.user_id)
  } catch (err) {
    console.error('[snapshots] Error during sync:', err.message)
  }
}

// ── Cron sync — transactions only, no balance call ────────────────────────────

async function syncAll() {
  const items = db.prepare('SELECT * FROM plaid_items').all();
  for (const item of items) {
    await syncItem(item, { includeBalance: false }).catch(err => {
      console.error(`Sync failed for item ${item.item_id}:`, err.message);
    });
  }
}

async function syncUser(userId, { includeBalance = true, syncType = 'manual' } = {}) {
  const items = db.prepare(
    'SELECT * FROM plaid_items WHERE user_id = ?'
  ).all(userId);
  for (const item of items) {
    await syncItem(item, { includeBalance }).catch(err => {
      console.error(`Sync failed for item ${item.item_id}:`, err.message);
    });
  }
  recordSyncType(userId, syncType)
}

// ── Schedule helpers ──────────────────────────────────────────────────────────

const FREQUENCY_HOURS = {
  daily:        24,
  twice_weekly: 84,   // ~3.5 days
  weekly:       168,  // 7 days
  biweekly:     336,  // 14 days
  monthly:      720,  // 30 days
}

// Per-item sync decision. Checks the institution's frequency override first,
// falls back to the user's global frequency setting.
// Returns false immediately if the effective frequency is 'never'.
function shouldSyncItem(item, globalFrequency) {
  const instPref = db.prepare(
    `SELECT sync_frequency FROM institution_preferences WHERE user_id = ? AND institution = ?`
  ).get(item.user_id, item.institution)

  const frequency = instPref?.sync_frequency || globalFrequency || 'weekly'
  if (frequency === 'never') return false

  const intervalHours = FREQUENCY_HOURS[frequency] || 168

  if (!item.last_synced) return true  // never synced — run it

  const lastSynced = new Date(item.last_synced + ' UTC')
  const hoursSince = (Date.now() - lastSynced.getTime()) / (1000 * 60 * 60)
  return hoursSince >= intervalHours
}

// Legacy user-level check: returns true if ANY item for the user is due.
// Kept for any external callers that still use it.
function shouldSync(userId) {
  const settings = db.prepare(
    `SELECT sync_frequency FROM plaid_settings WHERE user_id = ?`
  ).get(userId)
  const globalFrequency = settings?.sync_frequency || 'weekly'

  const items = db.prepare(
    `SELECT * FROM plaid_items WHERE user_id = ?`
  ).all(userId)

  return items.some(item => shouldSyncItem(item, globalFrequency))
}

function recordHeartbeat(userId) {
  db.prepare(`
    INSERT INTO plaid_settings (user_id, last_heartbeat, updated_at)
    VALUES (@user_id, datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      last_heartbeat = datetime('now'),
      updated_at     = datetime('now')
  `).run({ user_id: userId })
}

function recordSyncType(userId, type) {
  // type: 'manual' | 'scheduled'
  db.prepare(`
    INSERT INTO plaid_settings (user_id, last_sync_type, updated_at)
    VALUES (@user_id, @type, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      last_sync_type = excluded.last_sync_type,
      updated_at     = excluded.updated_at
  `).run({ user_id: userId, type })
}

module.exports = {
  plaid,
  syncAll,
  syncItem,
  syncUser,
  shouldSync,
  shouldSyncItem,
  recordHeartbeat,
  recordSyncType,
  recordUsage,
  FREQUENCY_HOURS,
  PRICING,
};