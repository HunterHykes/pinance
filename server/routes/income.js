const express     = require('express')
const db          = require('../db')
const requireAuth = require('../middleware/auth')
const {
  createIncomeCategories,
  seedIncomeLeafIntoMonth,
  occurrencesPerMonth,
  onIncomeCreated,
  onIncomeStopped,
  onIncomeAmountChanged,
  deleteIncomeCategories,
  onIncomeCreatedScoped,
  onIncomeStoppedScoped,
} = require('../income')
const router = express.Router()

router.use(requireAuth)

// ── GET /api/income ───────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const userId = req.session.userId

  const sources = db.prepare(`
    SELECT i.*,
      a.name  AS account_name,
      pc.category AS parent_category_name,
      tc.category AS category_name
    FROM income_sources i
    LEFT JOIN accounts a ON a.id = i.account_id
    LEFT JOIN budget_categories pc ON pc.id = i.parent_category_id
    LEFT JOIN budget_categories tc ON tc.income_id = i.id
                                   AND tc.user_id = i.user_id
                                   AND tc.parent_id IS i.parent_category_id
    WHERE i.user_id = ?
    ORDER BY i.status ASC, i.name ASC
  `).all(userId)

  const getSchedules = db.prepare(`
    SELECT s.*, bc.category AS category_name, a.name AS account_name
    FROM income_schedules s
    LEFT JOIN budget_categories bc ON bc.id = s.budget_category_id
    LEFT JOIN accounts a ON a.id = s.account_id
    WHERE s.income_id = ?
    ORDER BY s.effective_from DESC
  `)

  res.json(sources.map(src => ({
    ...src,
    // Prefer the linked category name as the authoritative display name
    name:      src.category_name || src.name,
    schedules: getSchedules.all(src.id).map(s => ({
      ...s,
      // Prefer the linked category name as the authoritative schedule label
      label: s.category_name || s.label,
    })),
  })))
})

// ── POST /api/income ──────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const userId = req.session.userId
  const { name, description, parent_category_id, account_id,
          color, status, started_on, notes, schedules,
          merge_category_id } = req.body

  if (!name || !started_on)
    return res.status(400).json({ error: 'name and started_on are required' })
  if (!schedules?.length)
    return res.status(400).json({ error: 'At least one schedule is required' })

  // Default parent to "Income" category if not specified
  let resolvedParentId = parent_category_id || null
  if (!resolvedParentId) {
    const incomeCat = db.prepare(
      "SELECT id FROM budget_categories WHERE user_id = ? AND category = 'Income' AND parent_id IS NULL"
    ).get(userId)
    if (incomeCat) resolvedParentId = incomeCat.id
  }

  if (resolvedParentId) {
    const cat = db.prepare(
      'SELECT id FROM budget_categories WHERE id = ? AND user_id = ?'
    ).get(resolvedParentId, userId)
    if (!cat) return res.status(400).json({ error: 'Parent category not found' })
  }

  db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO income_sources
        (user_id, name, description, parent_category_id, account_id,
         color, status, started_on, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, name, description || null, resolvedParentId,
           account_id || null, color || null, status || 'active',
           started_on, notes || null)

    incomeId = result.lastInsertRowid

    const insertSchedule = db.prepare(`
      INSERT INTO income_schedules
        (income_id, user_id, label, amount, frequency, custom_days, anchor_date, effective_from, account_id, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const s of schedules) {
      const scheduleAccountId = s.account_id || account_id || null
      insertSchedule.run(incomeId, userId, s.label, parseFloat(s.amount),
        s.frequency, s.custom_days || null,
        s.anchor_date || started_on, s.effective_from || started_on,
        scheduleAccountId, s.schedule ? JSON.stringify(s.schedule) : null)
    }
  })()

  const income      = db.prepare('SELECT * FROM income_sources WHERE id = ?').get(incomeId)
  const dbSchedules = db.prepare('SELECT * FROM income_schedules WHERE income_id = ?').all(incomeId)

  try {
    db.transaction(() => {
      if (merge_category_id && dbSchedules.length === 1) {
        // Merge: point the existing category at this income source
        db.prepare(`
          UPDATE budget_categories
          SET income_id = ?, is_income = 1, color = COALESCE(?, color), category = ?
          WHERE id = ? AND user_id = ?
        `).run(incomeId, color || null, name, merge_category_id, userId)

        db.prepare('UPDATE income_schedules SET budget_category_id = ? WHERE id = ?')
          .run(merge_category_id, dbSchedules[0].id)

        const monthlyAmt = dbSchedules[0].amount * occurrencesPerMonth(dbSchedules[0].frequency, dbSchedules[0].custom_days)
        db.prepare(`
          INSERT INTO budget_template (user_id, budget_id, monthly_limit)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
        `).run(userId, merge_category_id, monthlyAmt)
      } else {
        createIncomeCategories(userId, income, dbSchedules, resolvedParentId)
      }
    })()
  } catch (err) {
    console.error('Income category creation error:', err.message)
    return res.status(500).json({ error: 'Failed to create income categories' })
  }

  const finalSchedules = db.prepare('SELECT * FROM income_schedules WHERE income_id = ?').all(incomeId)

  try { onIncomeCreated(userId, income, finalSchedules) }
  catch (e) { console.error('Income seeding error:', e.message) }

  res.json({ id: incomeId, message: 'Created' })
})

// ── PUT /api/income/:id ───────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const userId   = req.session.userId
  const incomeId = req.params.id
  const { name, description, account_id, parent_category_id, status, notes, scope,
          color,
          schedules: incomingSchedules } = req.body

  const existing = db.prepare(
    'SELECT * FROM income_sources WHERE id = ? AND user_id = ?'
  ).get(incomeId, userId)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  // Capture active schedule IDs before any mutations (used to detect deletions)
  const currentActiveScheduleIds = new Set(
    db.prepare('SELECT id FROM income_schedules WHERE income_id = ? AND effective_to IS NULL')
      .all(incomeId).map(r => r.id)
  )

  const wasStopped = existing.status === 'stopped'
  const nowStopped = status === 'stopped'

  db.prepare(`
    UPDATE income_sources SET
      name = ?, description = ?, account_id = ?, parent_category_id = ?,
      color = ?,
      status = ?,
      stopped_on = CASE WHEN ? = 'stopped' AND stopped_on IS NULL
                   THEN date('now') ELSE stopped_on END,
      notes = ?
    WHERE id = ? AND user_id = ?
  `).run(name, description || null, account_id || null, parent_category_id || null,
         color || null,
         status, status, notes || null, incomeId, userId)

  // Sync color to linked budget_categories
  db.prepare(`UPDATE budget_categories SET color = ? WHERE income_id = ? AND user_id = ?`)
    .run(color || null, incomeId, userId)

  const income = db.prepare('SELECT * FROM income_sources WHERE id = ?').get(incomeId)

  // ── Process intent-based changes for dirty existing rows ────────────────────
  const intents = req.body._intents || []
  for (const intent of intents) {
    const oldSchedule = db.prepare(
      'SELECT * FROM income_schedules WHERE id = ? AND income_id = ?'
    ).get(intent.schedule_id, incomeId)
    if (!oldSchedule) continue

    // Find the corresponding updated values from incomingSchedules
    const updated = (incomingSchedules || []).find(s => s.id === intent.schedule_id)
    if (!updated) continue

    if (intent.intent === 'correction') {
      // UPDATE in place — rewrite history (including label)
      db.prepare(`
        UPDATE income_schedules SET label = ?, amount = ?, frequency = ?, anchor_date = ?, account_id = ?, schedule = ?
        WHERE id = ?
      `).run(updated.label || oldSchedule.label, parseFloat(updated.amount), updated.frequency,
             updated.anchor_date || oldSchedule.anchor_date,
             updated.account_id || null,
             updated.schedule ? JSON.stringify(updated.schedule) : (oldSchedule.schedule || null),
             oldSchedule.id)
      // Also sync the linked budget_category name if label changed
      if (updated.label && updated.label !== oldSchedule.label && oldSchedule.budget_category_id) {
        db.prepare('UPDATE budget_categories SET category = ? WHERE id = ? AND user_id = ?')
          .run(updated.label, oldSchedule.budget_category_id, userId)
      }
      // Re-seed all seeded months for this category
      try {
        const updatedSchedule = db.prepare('SELECT * FROM income_schedules WHERE id = ?').get(oldSchedule.id)
        if (updatedSchedule?.budget_category_id) {
          const seededMonths = db.prepare(
            'SELECT month FROM budget_months WHERE user_id = ? AND seeded = 1 ORDER BY month ASC'
          ).all(userId)
          
          db.transaction(() => {
            for (const { month } of seededMonths) {
              seedIncomeLeafIntoMonth(userId, updatedSchedule.budget_category_id, updatedSchedule, month)
            }
          })()
        }
      } catch (e) { console.error('Correction re-seed error:', e.message) }
    } else if (intent.intent === 'forward') {
      // Close old, open new from effective_from (carry updated label)
      const effectiveFrom = intent.effective_from
      db.prepare('UPDATE income_schedules SET effective_to = ? WHERE id = ?')
        .run(effectiveFrom, oldSchedule.id)
      db.prepare(`
        INSERT INTO income_schedules
          (income_id, user_id, label, amount, frequency, custom_days, anchor_date,
           effective_from, budget_category_id, account_id, schedule)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(incomeId, userId, updated.label || oldSchedule.label, parseFloat(updated.amount),
             updated.frequency || oldSchedule.frequency,
             oldSchedule.custom_days, updated.anchor_date || oldSchedule.anchor_date,
             effectiveFrom, oldSchedule.budget_category_id, updated.account_id || null,
             updated.schedule ? JSON.stringify(updated.schedule) : (oldSchedule.schedule || null))
      // Sync budget_category name if label changed
      if (updated.label && updated.label !== oldSchedule.label && oldSchedule.budget_category_id) {
        db.prepare('UPDATE budget_categories SET category = ? WHERE id = ? AND user_id = ?')
          .run(updated.label, oldSchedule.budget_category_id, userId)
      }
    } else if (intent.intent === 'one_time') {
      // Update budget_limits for a single month only
      const month = intent.target_month
      if (oldSchedule.budget_category_id && month) {
        
        const monthlyAmt = parseFloat(updated.amount) *
          occurrencesPerMonth(updated.frequency || oldSchedule.frequency, oldSchedule.custom_days)
        db.prepare(`
          INSERT INTO budget_limits (user_id, budget_id, month, monthly_limit)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, budget_id, month) DO UPDATE SET monthly_limit = excluded.monthly_limit
        `).run(userId, oldSchedule.budget_category_id, month, monthlyAmt)
      }
    }
  }

  // ── Insert any new schedules (rows without an id from the client) ───────────
  const newSchedules = (incomingSchedules || []).filter(s => !s.id)
  if (newSchedules.length > 0) {
    const insertSchedule = db.prepare(`
      INSERT INTO income_schedules
        (income_id, user_id, label, amount, frequency, custom_days, anchor_date, effective_from, account_id, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    db.transaction(() => {
      for (const s of newSchedules) {
        insertSchedule.run(incomeId, userId, s.label, parseFloat(s.amount),
          s.frequency, s.custom_days || null,
          s.anchor_date || income.started_on,
          s.effective_from || income.started_on,
          s.account_id || null,
          s.schedule ? JSON.stringify(s.schedule) : null)
      }
    })()

    // Create budget categories for the newly inserted schedules
    const unlinked = db.prepare(
      'SELECT * FROM income_schedules WHERE income_id = ? AND effective_to IS NULL AND budget_category_id IS NULL'
    ).all(incomeId)
    if (unlinked.length > 0) {
      try {
        db.transaction(() => {
          createIncomeCategories(userId, income, unlinked, income.parent_category_id)
        })()
        const seeded = db.prepare(
          'SELECT * FROM income_schedules WHERE income_id = ? AND effective_to IS NULL'
        ).all(incomeId).filter(s => unlinked.find(u => u.id === s.id))
        onIncomeCreated(userId, income, seeded)
      } catch (e) { console.error('New schedule category error:', e.message) }
    }
  }

  // ── End-date schedules removed by the client ────────────────────────────────
  const incomingExistingIds = new Set(
    (incomingSchedules || []).filter(s => s.id).map(s => Number(s.id))
  )
  const today = new Date().toISOString().slice(0, 10)
  const currentMonth = today.slice(0, 7)
  for (const schedId of currentActiveScheduleIds) {
    if (!incomingExistingIds.has(schedId)) {
      db.prepare('UPDATE income_schedules SET effective_to = ? WHERE id = ?').run(today, schedId)
      const sched = db.prepare('SELECT * FROM income_schedules WHERE id = ?').get(schedId)
      if (sched?.budget_category_id) {
        db.prepare('UPDATE budget_limits SET monthly_limit = 0 WHERE user_id = ? AND budget_id = ? AND month >= ?')
          .run(userId, sched.budget_category_id, currentMonth)
        db.prepare('UPDATE budget_template SET monthly_limit = 0 WHERE user_id = ? AND budget_id = ?')
          .run(userId, sched.budget_category_id)
      }
    }
  }

  // ── Sync name/color to linked budget categories ─────────────────────────────
  try {
    db.prepare(`
      UPDATE budget_categories SET category = ?, color = ?
      WHERE income_id = ? AND user_id = ? AND parent_id IS ?
    `).run(name, income.color, incomeId, userId, income.parent_category_id)
    db.prepare('UPDATE budget_categories SET color = ? WHERE income_id = ? AND user_id = ?')
      .run(income.color, incomeId, userId)
  } catch (e) { console.error('Income category sync error:', e.message) }

  const scopeMonth  = new Date().toISOString().slice(0, 7)
  const monthFilter = scope === 'this_month' ? 'AND month = ?' : 'AND month >= ?'

  // Reparent if parent category changed
  try {
    const oldCat = existing.parent_category_id ?? null
    const newCat = parent_category_id ?? null
    if (String(oldCat) !== String(newCat)) {
      db.prepare(`
        UPDATE budget_categories SET parent_id = ?
        WHERE income_id = ? AND user_id = ? AND parent_id IS ?
      `).run(newCat, incomeId, userId, oldCat)
    }
  } catch (e) { console.error('Income reparent error:', e.message) }

  const schedules = db.prepare(
    'SELECT * FROM income_schedules WHERE income_id = ? AND effective_to IS NULL'
  ).all(incomeId)

  if (!wasStopped && nowStopped) {
    try { onIncomeStoppedScoped(userId, income, monthFilter, scopeMonth) }
    catch (e) { console.error('Income stop error:', e.message) }
  } else if (!nowStopped) {
    try { onIncomeCreatedScoped(userId, income, schedules, monthFilter, scopeMonth) }
    catch (e) { console.error('Income update seeding error:', e.message) }
  }

  res.json({ message: 'Updated' })
})

// ── DELETE /api/income/:id ────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const userId   = req.session.userId
  const incomeId = req.params.id

  const income = db.prepare(
    'SELECT * FROM income_sources WHERE id = ? AND user_id = ?'
  ).get(incomeId, userId)
  if (!income) return res.status(404).json({ error: 'Not found' })

  try { onIncomeStopped(userId, income) }
  catch (e) { console.error('Income delete seeding error:', e.message) }

  try { deleteIncomeCategories(userId, incomeId) }
  catch (e) { console.error('Income category delete error:', e.message) }

  db.prepare('DELETE FROM income_sources WHERE id = ? AND user_id = ?').run(incomeId, userId)
  res.json({ message: 'Deleted' })
})

// ── POST /api/income/:id/amount-change ────────────────────────────────────────

router.post('/:id/amount-change', (req, res) => {
  const userId   = req.session.userId
  const incomeId = req.params.id
  const { schedule_id, new_amount, new_frequency, new_account_id, effective_from } = req.body

  if (!schedule_id || !new_amount || !effective_from)
    return res.status(400).json({ error: 'schedule_id, new_amount, effective_from required' })

  const income = db.prepare(
    'SELECT * FROM income_sources WHERE id = ? AND user_id = ?'
  ).get(incomeId, userId)
  if (!income) return res.status(404).json({ error: 'Not found' })

  const oldSchedule = db.prepare(
    'SELECT * FROM income_schedules WHERE id = ? AND income_id = ?'
  ).get(schedule_id, incomeId)
  if (!oldSchedule) return res.status(404).json({ error: 'Schedule not found' })

  let newScheduleId
  db.transaction(() => {
    db.prepare('UPDATE income_schedules SET effective_to = ? WHERE id = ?')
      .run(effective_from, schedule_id)

    const r = db.prepare(`
      INSERT INTO income_schedules
        (income_id, user_id, label, amount, frequency, custom_days, anchor_date,
         effective_from, budget_category_id, account_id, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(incomeId, userId, oldSchedule.label, parseFloat(new_amount),
           new_frequency || oldSchedule.frequency,
           oldSchedule.custom_days, oldSchedule.anchor_date,
           effective_from, oldSchedule.budget_category_id,
           new_account_id !== undefined ? (new_account_id || null) : oldSchedule.account_id,
           oldSchedule.schedule || null)
    newScheduleId = r.lastInsertRowid
  })()

  const newSchedule = db.prepare('SELECT * FROM income_schedules WHERE id = ?').get(newScheduleId)

  try { onIncomeAmountChanged(userId, income, newSchedule) }
  catch (e) { console.error('Income amount change error:', e.message) }

  res.json({ message: 'Updated', new_schedule_id: newScheduleId })
})

module.exports = router