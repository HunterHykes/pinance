const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, '../data/finance.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    plaid_id    TEXT,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    subtype     TEXT,
    institution TEXT,
    balance     REAL DEFAULT 0,
    currency    TEXT DEFAULT 'USD',
    last_synced DATETIME,
    is_manual   INTEGER DEFAULT 0,
    UNIQUE(user_id, plaid_id)
  );

  -- Global category tree — shared across all months
  CREATE TABLE IF NOT EXISTS budget_categories (
    id                    INTEGER PRIMARY KEY,
    user_id               INTEGER NOT NULL REFERENCES users(id),
    parent_id             INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL,
    category              TEXT NOT NULL,
    color                 TEXT,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT DEFAULT (datetime('now')),
    is_bill               INTEGER DEFAULT 0,
    bill_id               INTEGER REFERENCES bills(id) ON DELETE CASCADE,
    is_income             INTEGER DEFAULT 0,
    income_id             INTEGER REFERENCES income_sources(id) ON DELETE CASCADE,
    UNIQUE(user_id, category)
  );

  -- Default limits per category — seeds new months
  CREATE TABLE IF NOT EXISTS budget_template (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    budget_id     INTEGER NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
    monthly_limit REAL NOT NULL DEFAULT 0,
    UNIQUE(user_id, budget_id)
  );

  -- Explicit per-month limits — written once on first visit, never retroactively changed
  CREATE TABLE IF NOT EXISTS budget_limits (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    budget_id     INTEGER NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
    month         TEXT NOT NULL,
    monthly_limit REAL NOT NULL DEFAULT 0,
    UNIQUE(user_id, budget_id, month)
  );

  -- Tracks which months have been seeded
  CREATE TABLE IF NOT EXISTS budget_months (
    id      INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    month   TEXT NOT NULL,
    seeded  INTEGER DEFAULT 0,
    UNIQUE(user_id, month)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    plaid_id       TEXT,
    dedup_key      TEXT NOT NULL,
    account_id     INTEGER REFERENCES accounts(id),
    amount         REAL NOT NULL,
    date           TEXT NOT NULL,
    description    TEXT NOT NULL,
    category       TEXT,
    plaid_category TEXT,
    source         TEXT DEFAULT 'plaid',
    notes          TEXT,
    pending        INTEGER DEFAULT 0,
    created_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, dedup_key)
  );

  CREATE TABLE IF NOT EXISTS plaid_items (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    access_token TEXT NOT NULL,
    item_id      TEXT UNIQUE NOT NULL,
    institution  TEXT,
    cursor       TEXT,
    last_synced  DATETIME
  );

  CREATE TABLE IF NOT EXISTS transaction_splits (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    amount         REAL NOT NULL,
    category       TEXT NOT NULL,
    notes          TEXT,
    created_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS category_map (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    plaid_category  TEXT NOT NULL,
    budget_category TEXT NOT NULL,
    UNIQUE(user_id, plaid_category)
  );

  -- Daily balance snapshots per account — source of truth for net worth chart.
  -- account_id OR asset_id (future): one must be non-null.
  CREATE TABLE IF NOT EXISTS balance_snapshots (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    asset_id   INTEGER,
    date       TEXT NOT NULL,
    balance    REAL NOT NULL,
    UNIQUE(user_id, account_id, date)
  );

  -- Tracks one-time backfill completion per user
  CREATE TABLE IF NOT EXISTS snapshot_backfill (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) UNIQUE,
    completed_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Bills ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS bills (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id),
    name               TEXT NOT NULL,
    description        TEXT,
    parent_category_id INTEGER REFERENCES budget_categories(id),  -- where to nest (optional)
    account_id         INTEGER REFERENCES accounts(id),
    color              TEXT,
    status             TEXT NOT NULL DEFAULT 'active', -- active | paused | cancelled
    pause_until        TEXT,
    started_on         TEXT NOT NULL,
    cancelled_on       TEXT,
    notes              TEXT,
    created_at         TEXT DEFAULT (datetime('now'))
  );

  -- Each bill can have multiple charge rules (e.g. monthly dues + semi-annual fee)
  -- Price changes are tracked by closing old rows (effective_to) and adding new ones (effective_from)
  CREATE TABLE IF NOT EXISTS bill_charges (
    id             INTEGER PRIMARY KEY,
    bill_id        INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    label          TEXT NOT NULL,        -- "Monthly dues", "Annual fee", etc.
    amount         REAL NOT NULL,
    frequency      TEXT NOT NULL,        -- monthly | quarterly | semi_annual | annual
    anchor_date    TEXT NOT NULL,        -- reference date for calculating occurrences
    effective_from TEXT NOT NULL,        -- when this price took effect
    effective_to   TEXT,                  -- null = current; set on price change
    account_id     INTEGER REFERENCES accounts(id)
  );
`);

// ── Income sources ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS income_sources (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id),
    name               TEXT NOT NULL,
    description        TEXT,
    parent_category_id INTEGER REFERENCES budget_categories(id),
    account_id         INTEGER REFERENCES accounts(id),
    color              TEXT,
    status             TEXT NOT NULL DEFAULT 'active',  -- active | paused | stopped
    started_on         TEXT NOT NULL,
    stopped_on         TEXT,
    notes              TEXT,
    created_at         TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS income_schedules (
    id                 INTEGER PRIMARY KEY,
    income_id          INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
    user_id            INTEGER NOT NULL REFERENCES users(id),
    label              TEXT NOT NULL,
    amount             REAL NOT NULL,
    frequency          TEXT NOT NULL,
    custom_days        TEXT,
    anchor_date        TEXT NOT NULL,
    effective_from     TEXT NOT NULL,
    effective_to       TEXT,
    budget_category_id INTEGER REFERENCES budget_categories(id),
    account_id         INTEGER REFERENCES accounts(id)
  );
`);

// ── Plaid settings & usage tracking ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS plaid_settings (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) UNIQUE,
    sync_frequency TEXT NOT NULL DEFAULT 'weekly',
    last_heartbeat TEXT,
    last_sync_type TEXT,
    updated_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plaid_usage (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    month          TEXT NOT NULL,
    call_type      TEXT NOT NULL,
    call_count     INTEGER NOT NULL DEFAULT 0,
    estimated_cost REAL NOT NULL DEFAULT 0,
    updated_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, month, call_type)
  );
`);

// ── Migrations ────────────────────────────────────────────────────────────────
const migrations = [
  `ALTER TABLE transactions ADD COLUMN plaid_category TEXT`,
  `ALTER TABLE transactions ADD COLUMN is_split INTEGER DEFAULT 0`,
  `ALTER TABLE budget_categories ADD COLUMN is_bill INTEGER DEFAULT 0`,
  `ALTER TABLE bills ADD COLUMN parent_category_id INTEGER REFERENCES budget_categories(id)`,
  `ALTER TABLE bills ADD COLUMN color TEXT`,
  `ALTER TABLE budget_categories ADD COLUMN bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE`,
  `ALTER TABLE bill_charges ADD COLUMN budget_category_id INTEGER REFERENCES budget_categories(id)`,
  `ALTER TABLE bill_charges ADD COLUMN account_id INTEGER REFERENCES accounts(id)`,
  `ALTER TABLE bill_charges ADD COLUMN schedule TEXT`,
  `ALTER TABLE bills ADD COLUMN bill_type TEXT NOT NULL DEFAULT 'bill'`,
  `CREATE TABLE IF NOT EXISTS account_preferences (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    display_name TEXT,
    line_style   TEXT DEFAULT 'solid',
    is_hidden    INTEGER DEFAULT 0,
    UNIQUE(user_id, account_id)
  )`,
  `CREATE TABLE IF NOT EXISTS institution_preferences (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    institution    TEXT NOT NULL,
    color          TEXT,
    url            TEXT,
    sync_frequency TEXT,
    UNIQUE(user_id, institution)
  )`,
  `CREATE TABLE IF NOT EXISTS plaid_settings (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) UNIQUE,
    sync_frequency TEXT NOT NULL DEFAULT 'weekly',
    last_heartbeat TEXT,
    last_sync_type TEXT,
    updated_at     TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS plaid_usage (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    month          TEXT NOT NULL,
    call_type      TEXT NOT NULL,
    call_count     INTEGER NOT NULL DEFAULT 0,
    estimated_cost REAL NOT NULL DEFAULT 0,
    updated_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, month, call_type)
  )`,
  `ALTER TABLE plaid_settings ADD COLUMN last_sync_type TEXT`,
  `ALTER TABLE budget_categories ADD COLUMN is_income INTEGER DEFAULT 0`,
  `ALTER TABLE budget_categories ADD COLUMN income_id INTEGER REFERENCES income_sources(id) ON DELETE CASCADE`,
  `CREATE TABLE IF NOT EXISTS income_sources (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id),
    name               TEXT NOT NULL,
    description        TEXT,
    parent_category_id INTEGER REFERENCES budget_categories(id),
    account_id         INTEGER REFERENCES accounts(id),
    color              TEXT,
    status             TEXT NOT NULL DEFAULT 'active',
    started_on         TEXT NOT NULL,
    stopped_on         TEXT,
    notes              TEXT,
    created_at         TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS income_schedules (
    id                 INTEGER PRIMARY KEY,
    income_id          INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
    user_id            INTEGER NOT NULL REFERENCES users(id),
    label              TEXT NOT NULL,
    amount             REAL NOT NULL,
    frequency          TEXT NOT NULL,
    custom_days        TEXT,
    anchor_date        TEXT NOT NULL,
    effective_from     TEXT NOT NULL,
    effective_to       TEXT,
    budget_category_id INTEGER REFERENCES budget_categories(id),
    account_id         INTEGER REFERENCES accounts(id)
  )`,
  `ALTER TABLE income_schedules ADD COLUMN account_id INTEGER REFERENCES accounts(id)`,
  `ALTER TABLE income_schedules ADD COLUMN schedule TEXT`,
  // original_account_id: set at merge time via COALESCE — intentionally no FK so the
  // reference survives account deletion, preserving the historical audit trail.
  `ALTER TABLE transactions ADD COLUMN original_account_id INTEGER`,
  // ── Rename migrations already applied manually on Pi ──────────────────────
  // ── Liabilities ───────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS liabilities (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    type               TEXT NOT NULL DEFAULT 'Other',
    balance            REAL NOT NULL DEFAULT 0,
    asset_id           INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    plaid_account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    original_principal REAL,
    interest_rate      REAL,
    loan_term_months   INTEGER,
    origination_date   TEXT,
    monthly_payment    REAL,
    notes              TEXT,
    created_at         TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS liability_snapshots (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liability_id INTEGER NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    balance      REAL NOT NULL DEFAULT 0,
    UNIQUE(user_id, liability_id, date)
  )`,
  // ── Liabilities: category tracking ───────────────────────────────────────
  `ALTER TABLE liabilities ADD COLUMN category_id INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL`,
  `CREATE TABLE IF NOT EXISTS projector_inputs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type      TEXT NOT NULL,
    entity_id        INTEGER NOT NULL,
    growth_rate      REAL,
    apr              REAL,
    cc_payment_mode  TEXT,
    cc_min_payment   REAL,
    rate_period      TEXT DEFAULT 'annual',
    compounding      TEXT DEFAULT 'compound',
    UNIQUE(user_id, entity_type, entity_id)
  )`,
  `ALTER TABLE projector_inputs ADD COLUMN rate_period TEXT DEFAULT 'annual'`,
  `ALTER TABLE projector_inputs ADD COLUMN compounding TEXT DEFAULT 'compound'`,
];
for (const sql of migrations) {
  try { db.exec(sql) } catch (_) { /* already exists, skip */ }
}

// ── Account preferences — new columns (idempotent) ───────────────────────────
;[
  `ALTER TABLE account_preferences ADD COLUMN display_name TEXT`,
  `ALTER TABLE account_preferences ADD COLUMN is_hidden    INTEGER DEFAULT 0`,
].forEach(sql => { try { db.exec(sql) } catch (_) {} })

// Drop color and url from account_preferences if they exist (moved to institution_preferences)
;['color', 'url'].forEach(col => {
  try {
    // SQLite doesn't support DROP COLUMN directly before 3.35 — recreate if needed
    // On Pi (SQLite 3.46) DROP COLUMN is supported
    db.exec(`ALTER TABLE account_preferences DROP COLUMN ${col}`)
  } catch (_) {}
})

// ── Data migration: restructure single-schedule income sources ────────────────
// Ensures every income source has a group budget_category parent with schedule
// leaf categories nested under it (mirrors subscription structure).
// Safe to run on every startup — skips sources that already have the group.
try {
  db.transaction(() => {
    const incomeSources = db.prepare('SELECT * FROM income_sources').all()
    for (const income of incomeSources) {
      const activeSchedules = db.prepare(
        'SELECT * FROM income_schedules WHERE income_id = ? AND effective_to IS NULL AND budget_category_id IS NOT NULL'
      ).all(income.id)
      if (activeSchedules.length !== 1) continue  // skip 0 or multi (already correct)

      const schedule = activeSchedules[0]
      const leafCat  = db.prepare('SELECT * FROM budget_categories WHERE id = ?').get(schedule.budget_category_id)
      if (!leafCat) continue

      // Check if a group already exists: a budget_category for this income_id
      // that has NO schedule pointing to it
      const groupAlreadyExists = db.prepare(`
        SELECT id FROM budget_categories
        WHERE income_id = ? AND user_id = ?
          AND id NOT IN (
            SELECT COALESCE(budget_category_id, 0)
            FROM income_schedules WHERE income_id = ? AND budget_category_id IS NOT NULL
          )
      `).get(income.id, income.user_id, income.id)
      if (groupAlreadyExists) continue  // already structured correctly

      // Create group category in the same position as the leaf
      let groupName = income.name
      const nameConflict = db.prepare(
        'SELECT id FROM budget_categories WHERE user_id = ? AND category = ? AND id != ?'
      ).get(income.user_id, groupName, leafCat.id)
      if (nameConflict) groupName = `${income.name} (income)`

      const { lastInsertRowid: groupId } = db.prepare(`
        INSERT INTO budget_categories (user_id, parent_id, category, color, sort_order, is_income, income_id)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(income.user_id, leafCat.parent_id, groupName, income.color || null, leafCat.sort_order, income.id)

      // Rename leaf to schedule label and reparent under the new group
      let leafName = schedule.label || income.name
      if (leafName === groupName) leafName = `${leafName} (schedule)`
      const leafNameConflict = db.prepare(
        'SELECT id FROM budget_categories WHERE user_id = ? AND category = ? AND id != ?'
      ).get(income.user_id, leafName, leafCat.id)
      if (leafNameConflict) leafName = `${schedule.label} (${schedule.id})`

      db.prepare('UPDATE budget_categories SET category = ?, parent_id = ?, sort_order = 0 WHERE id = ?')
        .run(leafName, groupId, leafCat.id)
    }
  })()
} catch (e) {
  console.error('Income category migration error:', e.message)
}

module.exports = db;