const express     = require('express');
const db          = require('../db');
const requireAuth = require('../middleware/auth');
const { seedTemplateForUser } = require('../default-template')
const { seedBillsIntoMonth } = require('../bills');
const { seedIncomeIntoMonth }        = require('../income');
const router      = express.Router();

router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedMonthFromTemplate(userId, month) {
  const templateRows = db.prepare(
    'SELECT budget_id, monthly_limit FROM budget_template WHERE user_id = ?'
  ).all(userId)

  if (templateRows.length === 0) return

  const insert = db.prepare(`
    INSERT OR IGNORE INTO budget_limits (user_id, budget_id, month, monthly_limit)
    VALUES (@user_id, @budget_id, @month, @monthly_limit)
  `)

  db.transaction(() => {
    for (const row of templateRows) {
      insert.run({ user_id: userId, budget_id: row.budget_id, month, monthly_limit: row.monthly_limit })
    }
    db.prepare(`
      INSERT INTO budget_months (user_id, month, seeded)
      VALUES (?, ?, 1)
      ON CONFLICT(user_id, month) DO UPDATE SET seeded = 1
    `).run(userId, month)
  })()

  // Layer subscription charges on top of template limits
  try { seedBillsIntoMonth(userId, month) }
  catch (e) { console.error('Subscription seed error:', e.message) }

  try { seedIncomeIntoMonth(userId, month) }
  catch (e) { console.error('Income seed error:', e.message) }
}

// ── GET /budget ───────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const month  = req.query.month || new Date().toISOString().slice(0, 7)
  const userId = req.session.userId

  const monthRecord = db.prepare(
    'SELECT seeded FROM budget_months WHERE user_id = ? AND month = ?'
  ).get(userId, month)

  if (!monthRecord) {
    const hasCategories = db.prepare(
      'SELECT COUNT(*) as cnt FROM budget_categories WHERE user_id = ?'
    ).get(userId).cnt > 0

    if (hasCategories) {
      seedMonthFromTemplate(userId, month)
    } else {
      db.prepare(`
        INSERT OR IGNORE INTO budget_months (user_id, month, seeded) VALUES (?, ?, 0)
      `).run(userId, month)
    }
  }

  const rows = db.prepare(`
    SELECT
      bc.id,
      bc.parent_id,
      bc.category,
      bc.color,
      bc.sort_order,
      bc.is_bill,
      bc.bill_id,
      bc.is_income,
      bc.income_id,
      CASE WHEN EXISTS (
        SELECT 1 FROM bill_charges sc
        WHERE sc.budget_category_id = bc.id AND sc.effective_to IS NULL
      ) THEN 1 ELSE 0 END AS managed_by_bill,
      CASE WHEN EXISTS (
        SELECT 1 FROM income_schedules ins
        WHERE ins.budget_category_id = bc.id AND ins.effective_to IS NULL
      ) THEN 1 ELSE 0 END AS managed_by_income,
      COALESCE(bl.monthly_limit, 0) AS monthly_limit,
      COALESCE(
        -- Non-split transactions
        SUM(CASE
          WHEN t.amount < 0 AND (t.is_split = 0 OR t.is_split IS NULL)
          THEN ABS(t.amount) ELSE 0
        END)
        -- Plus split children
        + (
          SELECT COALESCE(SUM(ABS(sp.amount)), 0)
          FROM transaction_splits sp
          JOIN transactions pt
            ON pt.id      = sp.transaction_id
            AND pt.user_id = bc.user_id
            AND pt.date   LIKE ?
            AND pt.pending = 0
          WHERE sp.category = bc.category
            AND sp.user_id  = bc.user_id
        ), 0
      ) AS spent
    FROM budget_categories bc
    LEFT JOIN budget_limits bl
      ON  bl.budget_id = bc.id
      AND bl.user_id   = bc.user_id
      AND bl.month     = ?
    LEFT JOIN transactions t
      ON  t.category = bc.category
      AND t.user_id  = bc.user_id
      AND t.date     LIKE ?
      AND t.pending  = 0
    WHERE bc.user_id = ?
    GROUP BY bc.id
    ORDER BY bc.sort_order ASC, bc.parent_id NULLS FIRST, bc.category
  `).all(`${month}%`, month, `${month}%`, userId)

  res.json(rows)
})

// ── POST /budget — add/update category + this month's limit ──────────────────

router.post('/', (req, res) => {
  const { category, monthly_limit, parent_id, color } = req.body
  if (!category) return res.status(400).json({ error: 'category required' })
  const userId = req.session.userId
  const month  = req.body.month || new Date().toISOString().slice(0, 7)

  try {
    db.prepare(`
      INSERT INTO budget_categories (user_id, parent_id, category, color)
      VALUES (@user_id, @parent_id, @category, @color)
      ON CONFLICT(user_id, category) DO UPDATE SET
        parent_id = excluded.parent_id,
        color     = excluded.color
    `).run({ user_id: userId, parent_id: parent_id || null, category, color: color || null })

    const cat = db.prepare(
      'SELECT id FROM budget_categories WHERE user_id = ? AND category = ?'
    ).get(userId, category)

    if (cat && monthly_limit !== undefined) {
      db.prepare(`
        INSERT INTO budget_limits (user_id, budget_id, month, monthly_limit)
        VALUES (@user_id, @budget_id, @month, @monthly_limit)
        ON CONFLICT(user_id, budget_id, month) DO UPDATE SET monthly_limit = excluded.monthly_limit
      `).run({ user_id: userId, budget_id: cat.id, month, monthly_limit })

      db.prepare(`
        INSERT INTO budget_template (user_id, budget_id, monthly_limit)
        VALUES (@user_id, @budget_id, @monthly_limit)
        ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
      `).run({ user_id: userId, budget_id: cat.id, monthly_limit })
    }

    res.json({ message: 'Saved' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── PUT /budget/reorder ───────────────────────────────────────────────────────

router.put('/reorder', (req, res) => {
  const { items } = req.body
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' })
  const update = db.prepare(
    'UPDATE budget_categories SET sort_order = ? WHERE id = ? AND user_id = ?'
  )
  db.transaction(() => {
    for (const { id, sort_order } of items) update.run(sort_order, id, req.session.userId)
  })()
  res.json({ message: 'Reordered' })
})

// ── PUT /budget/:id — update category metadata + this month's limit ───────────

router.put('/:id', (req, res) => {
  const { category, monthly_limit, parent_id, color } = req.body
  const userId = req.session.userId
  const month  = req.body.month || new Date().toISOString().slice(0, 7)
  const catId  = req.params.id

  // Fetch the category to check if it's subscription-owned
  const cat = db.prepare('SELECT * FROM budget_categories WHERE id = ? AND user_id = ?').get(catId, userId)
  if (!cat) return res.status(404).json({ error: 'Not found' })

  db.prepare(`
    UPDATE budget_categories
    SET category = @category, parent_id = @parent_id, color = @color
    WHERE id = @id AND user_id = @user_id
  `).run({ category, parent_id: parent_id || null, color: color || null, id: catId, user_id: userId })

  if (monthly_limit !== undefined) {
    // Update budget_limits for this month
    db.prepare(`
      INSERT INTO budget_limits (user_id, budget_id, month, monthly_limit)
      VALUES (@user_id, @budget_id, @month, @monthly_limit)
      ON CONFLICT(user_id, budget_id, month) DO UPDATE SET monthly_limit = excluded.monthly_limit
    `).run({ user_id: userId, budget_id: catId, month, monthly_limit })

    // For subscription categories, also sync to template (subscription is master)
    if (cat.is_bill) {
      db.prepare(`
        INSERT INTO budget_template (user_id, budget_id, monthly_limit)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
      `).run(userId, catId, monthly_limit)
    }
  }

  res.json({ message: 'Updated' })
})

// ── DELETE /budget/:id ────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM budget_categories WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.userId)
  res.json({ message: 'Deleted' })
})

// ── GET /budget/template ──────────────────────────────────────────────────────

router.get('/template', (req, res) => {
  const rows = db.prepare(`
    SELECT
      bc.id, bc.parent_id, bc.category, bc.color, bc.sort_order,
      bc.is_bill, bc.bill_id,
      bc.is_income, bc.income_id,
      CASE WHEN EXISTS (
        SELECT 1 FROM bill_charges sc
        WHERE sc.budget_category_id = bc.id AND sc.effective_to IS NULL
      ) THEN 1 ELSE 0 END AS managed_by_bill,
      CASE WHEN EXISTS (
        SELECT 1 FROM income_schedules ins
        WHERE ins.budget_category_id = bc.id AND ins.effective_to IS NULL
      ) THEN 1 ELSE 0 END AS managed_by_income,
      COALESCE(bt.monthly_limit, 0) AS monthly_limit
    FROM budget_categories bc
    LEFT JOIN budget_template bt
      ON bt.budget_id = bc.id AND bt.user_id = bc.user_id
    WHERE bc.user_id = ?
    ORDER BY bc.sort_order ASC, bc.parent_id NULLS FIRST, bc.category
  `).all(req.session.userId)
  res.json(rows)
})

// ── PUT /budget/template/reorder ─────────────────────────────────────────────

router.put('/template/reorder', (req, res) => {
  const { items } = req.body
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' })
  const update = db.prepare(
    'UPDATE budget_categories SET sort_order = ? WHERE id = ? AND user_id = ?'
  )
  db.transaction(() => {
    for (const { id, sort_order } of items) update.run(sort_order, id, req.session.userId)
  })()
  res.json({ message: 'Reordered' })
})

// ── PUT /budget/template/:id — update default limit ───────────────────────────

router.put('/template/:id', (req, res) => {
  const { monthly_limit, category, parent_id, color } = req.body
  const userId = req.session.userId
  const catId  = req.params.id

  const cat = db.prepare('SELECT * FROM budget_categories WHERE id = ? AND user_id = ?').get(catId, userId)
  if (!cat) return res.status(404).json({ error: 'Not found' })

  db.prepare(`
    UPDATE budget_categories
    SET category = @category, parent_id = @parent_id, color = @color
    WHERE id = @id AND user_id = @user_id
  `).run({ category, parent_id: parent_id || null, color: color || null, id: catId, user_id: userId })

  if (monthly_limit !== undefined && !cat.is_bill) {
    db.prepare(`
      INSERT INTO budget_template (user_id, budget_id, monthly_limit)
      VALUES (@user_id, @budget_id, @monthly_limit)
      ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
    `).run({ user_id: userId, budget_id: catId, monthly_limit })
  }

  res.json({ message: 'Updated' })
})

// ── POST /budget/template/sync-from-current ───────────────────────────────────

router.post('/template/sync-from-current', (req, res) => {
  const month  = req.body.month || new Date().toISOString().slice(0, 7)
  const userId = req.session.userId

  const limits = db.prepare(
    'SELECT budget_id, monthly_limit FROM budget_limits WHERE user_id = ? AND month = ?'
  ).all(userId, month)

  if (limits.length === 0) return res.status(400).json({ error: 'No limits found for this month' })

  const upsert = db.prepare(`
    INSERT INTO budget_template (user_id, budget_id, monthly_limit)
    VALUES (@user_id, @budget_id, @monthly_limit)
    ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
  `)

  db.transaction(() => {
    for (const { budget_id, monthly_limit } of limits) {
      upsert.run({ user_id: userId, budget_id, monthly_limit })
    }
  })()

  res.json({ message: 'Template updated from current month' })
})

// ── POST /budget/template/load-defaults ──────────────────────────────────────

router.post('/template/load-defaults', (req, res) => {
  try {
    seedTemplateForUser(req.session.userId)
    res.json({ message: 'Default template loaded' })
  } catch (err) {
    console.error('Load defaults error:', err.message)
    res.status(500).json({ error: 'Failed to load defaults' })
  }
})

module.exports = router