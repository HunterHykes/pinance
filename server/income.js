const db = require('./db')

// ── Frequency helpers ─────────────────────────────────────────────────────────

function incomeOccursInMonth(anchorDate, frequency, customDays, targetMonth) {
  const anchor = new Date(anchorDate + 'T00:00:00')
  const [ty, tm] = targetMonth.split('-').map(Number)

  switch (frequency) {
    case 'monthly':     return true
    case 'twice_monthly': return true
    case 'weekly':      return true
    case 'biweekly': {
      const start   = new Date(`${targetMonth}-01T00:00:00`)
      const end     = new Date(ty, tm, 0)
      const anchor0 = new Date(anchorDate + 'T00:00:00')
      let d = new Date(anchor0)
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
    case 'custom_days':   return customDays
        ? customDays.split(',').filter(d => d.trim()).length
        : 1
    default: return 1
  }
}

function monthlyEquivalentIncome(schedules) {
  return schedules
    .filter(s => !s.effective_to)
    .reduce((sum, s) => sum + s.amount * occurrencesPerMonth(s.frequency, s.custom_days), 0)
}

// ── Create budget categories for an income source ─────────────────────────────

function createIncomeCategories(userId, income, schedules, parentCategoryId) {
  const mappings = []

  const maxSort = db.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) as m FROM budget_categories
    WHERE user_id = ? AND parent_id ${parentCategoryId ? '= ?' : 'IS NULL'}
  `).get(userId, ...(parentCategoryId ? [parentCategoryId] : [])).m

  let sortOrder = maxSort + 1

  const existingGroup = db.prepare(`
    SELECT bc.id FROM budget_categories bc
    WHERE bc.user_id = ? AND bc.income_id = ? AND bc.parent_id IS ?
      AND NOT EXISTS (
        SELECT 1 FROM income_schedules s
        WHERE s.budget_category_id = bc.id AND s.income_id = ?
      )
  `).get(userId, income.id, parentCategoryId || null, income.id)

  let groupCatId
  if (existingGroup) {
    groupCatId = existingGroup.id
    db.prepare('UPDATE budget_categories SET category = ?, color = ?, parent_id = ? WHERE id = ?')
      .run(income.name, income.color || null, parentCategoryId || null, existingGroup.id)
  } else {
    let groupName = income.name
    const conflict = db.prepare(
      'SELECT id FROM budget_categories WHERE user_id = ? AND category = ? AND (income_id IS NULL OR income_id != ?)'
    ).get(userId, income.name, income.id)
    if (conflict) {
      let suffix = 2
      while (db.prepare(
        'SELECT id FROM budget_categories WHERE user_id = ? AND category = ?'
      ).get(userId, `${income.name} (${suffix})`)) {
        suffix++
      }
      groupName = `${income.name} (${suffix})`
    }

    const r = db.prepare(`
      INSERT INTO budget_categories
        (user_id, parent_id, category, color, sort_order, is_income, income_id)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(userId, parentCategoryId || null, groupName, income.color || null, sortOrder++, income.id)
    groupCatId = r.lastInsertRowid
  }
  if (!groupCatId) throw new Error(`Failed to create group category for income "${income.name}"`)

  for (const schedule of schedules) {
    const leafName = schedule.label

    const existingLeaf = schedule.budget_category_id
      ? db.prepare('SELECT id FROM budget_categories WHERE id = ?').get(schedule.budget_category_id)
      : null

    let leafId
    if (existingLeaf) {
      leafId = existingLeaf.id
      let safeLeafName = leafName
      const collision = db.prepare(
        'SELECT id FROM budget_categories WHERE user_id = ? AND category = ? AND id != ?'
      ).get(userId, safeLeafName, leafId)
      if (collision) {
        let suffix = 2
        while (db.prepare(
          'SELECT id FROM budget_categories WHERE user_id = ? AND category = ?'
        ).get(userId, `${leafName} (${suffix})`)) {
          suffix++
        }
        safeLeafName = `${leafName} (${suffix})`
      }
      db.prepare('UPDATE budget_categories SET category = ?, color = ?, parent_id = ? WHERE id = ?')
        .run(safeLeafName, income.color || null, groupCatId, leafId)
    } else {
      let insertName = leafName
      const nameConflict = db.prepare(
        'SELECT id FROM budget_categories WHERE user_id = ? AND category = ?'
      ).get(userId, insertName)
      if (nameConflict) {
        let suffix = 2
        while (db.prepare(
          'SELECT id FROM budget_categories WHERE user_id = ? AND category = ?'
        ).get(userId, `${leafName} (${suffix})`)) {
          suffix++
        }
        insertName = `${leafName} (${suffix})`
      }

      const r = db.prepare(`
        INSERT INTO budget_categories
          (user_id, parent_id, category, color, sort_order, is_income, income_id)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(userId, groupCatId, insertName, income.color || null, sortOrder++, income.id)
      leafId = r.lastInsertRowid
    }

    const leafCat = db.prepare('SELECT id FROM budget_categories WHERE id = ?').get(leafId)
    if (!leafCat) throw new Error(`Failed to create leaf category "${leafName}"`)

    db.prepare('UPDATE income_schedules SET budget_category_id = ? WHERE id = ?')
      .run(leafCat.id, schedule.id)

    const monthlyAmt = schedule.amount * occurrencesPerMonth(schedule.frequency, schedule.custom_days)
    db.prepare(`
      INSERT INTO budget_template (user_id, budget_id, monthly_limit)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
    `).run(userId, leafCat.id, monthlyAmt)

    mappings.push({ schedule_id: schedule.id, budget_category_id: leafCat.id })
  }

  return mappings
}

// ── Seed a leaf category into an already-seeded month ─────────────────────────

function seedIncomeLeafIntoMonth(userId, catId, schedule, month) {
  if (!incomeOccursInMonth(schedule.anchor_date, schedule.frequency, schedule.custom_days, month)) return
  const monthlyAmt = schedule.amount * occurrencesPerMonth(schedule.frequency, schedule.custom_days)
  db.prepare(`
    INSERT INTO budget_limits (user_id, budget_id, month, monthly_limit)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, budget_id, month) DO UPDATE SET monthly_limit = excluded.monthly_limit
  `).run(userId, catId, month, monthlyAmt)
}

// ── Zero out future months ────────────────────────────────────────────────────

function zeroIncomeLeafInFutureMonths(userId, catId) {
  const today = new Date().toISOString().slice(0, 7)
  db.prepare(`
    UPDATE budget_limits SET monthly_limit = 0
    WHERE user_id = ? AND budget_id = ? AND month >= ?
  `).run(userId, catId, today)
}

// ── On income source created ───────────────────────────────────────────────────

function onIncomeCreated(userId, income, schedules) {
  const startMonth = income.started_on.slice(0, 7)
  const seededMonths = db.prepare(`
    SELECT month FROM budget_months
    WHERE user_id = ? AND seeded = 1 AND month >= ?
    ORDER BY month ASC
  `).all(userId, startMonth)

  db.transaction(() => {
    for (const schedule of schedules) {
      if (!schedule.budget_category_id) continue
      for (const { month } of seededMonths) {
        seedIncomeLeafIntoMonth(userId, schedule.budget_category_id, schedule, month)
      }
    }
  })()
}

// ── On income stopped ─────────────────────────────────────────────────────────

function onIncomeStopped(userId, income) {
  const schedules = db.prepare(`
    SELECT * FROM income_schedules WHERE income_id = ? AND effective_to IS NULL
  `).all(income.id)

  db.transaction(() => {
    for (const schedule of schedules) {
      if (schedule.budget_category_id) {
        zeroIncomeLeafInFutureMonths(userId, schedule.budget_category_id)
      }
    }
  })()
}

// ── On amount changed ─────────────────────────────────────────────────────────

function onIncomeAmountChanged(userId, income, newSchedule) {
  if (!newSchedule.budget_category_id) return
  const today = new Date().toISOString().slice(0, 7)
  const monthlyAmt = newSchedule.amount * occurrencesPerMonth(newSchedule.frequency, newSchedule.custom_days)

  db.prepare(`
    INSERT INTO budget_template (user_id, budget_id, monthly_limit)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
  `).run(userId, newSchedule.budget_category_id, monthlyAmt)

  const futureSeedMonths = db.prepare(`
    SELECT month FROM budget_months
    WHERE user_id = ? AND seeded = 1 AND month >= ?
    ORDER BY month ASC
  `).all(userId, today)

  db.transaction(() => {
    for (const { month } of futureSeedMonths) {
      seedIncomeLeafIntoMonth(userId, newSchedule.budget_category_id, newSchedule, month)
    }
  })()
}

// ── Seed income into a newly-seeded month ─────────────────────────────────────

function seedIncomeIntoMonth(userId, month) {
  const schedules = db.prepare(`
    SELECT s.* FROM income_schedules s
    JOIN income_sources i ON i.id = s.income_id
    WHERE i.user_id = ? AND i.status != 'stopped'
      AND i.started_on <= ?
      AND s.effective_to IS NULL
      AND s.budget_category_id IS NOT NULL
  `).all(userId, month + '-31')

  for (const schedule of schedules) {
    seedIncomeLeafIntoMonth(userId, schedule.budget_category_id, schedule, month)
  }
}

// ── Delete income categories ──────────────────────────────────────────────────

function deleteIncomeCategories(userId, incomeId) {
  db.prepare('UPDATE income_schedules SET budget_category_id = NULL WHERE income_id = ?').run(incomeId)

  const catIds = db.prepare(
    'SELECT id FROM budget_categories WHERE income_id = ? AND user_id = ?'
  ).all(incomeId, userId).map(r => r.id)

  for (const catId of catIds) {
    db.prepare('UPDATE income_sources SET parent_category_id = NULL WHERE parent_category_id = ? AND user_id = ?')
      .run(catId, userId)
  }

  db.prepare('DELETE FROM budget_categories WHERE income_id = ? AND user_id = ?').run(incomeId, userId)
}

// ── Scoped seeding ────────────────────────────────────────────────────────────

function onIncomeCreatedScoped(userId, income, schedules, monthFilter, scopeMonth) {
  const seededMonths = db.prepare(`
    SELECT month FROM budget_months
    WHERE user_id = ? AND seeded = 1 ${monthFilter}
    ORDER BY month ASC
  `).all(userId, scopeMonth)

  db.transaction(() => {
    for (const schedule of schedules) {
      if (!schedule.budget_category_id) continue
      const monthlyAmt = schedule.amount * occurrencesPerMonth(schedule.frequency, schedule.custom_days)
      db.prepare(`
        INSERT INTO budget_template (user_id, budget_id, monthly_limit)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
      `).run(userId, schedule.budget_category_id, monthlyAmt)
      for (const { month } of seededMonths) {
        seedIncomeLeafIntoMonth(userId, schedule.budget_category_id, schedule, month)
      }
    }
  })()
}

function onIncomeStoppedScoped(userId, income, monthFilter, scopeMonth) {
  const schedules = db.prepare(
    'SELECT * FROM income_schedules WHERE income_id = ? AND effective_to IS NULL'
  ).all(income.id)

  const seededMonths = db.prepare(`
    SELECT month FROM budget_months
    WHERE user_id = ? AND seeded = 1 ${monthFilter}
    ORDER BY month ASC
  `).all(userId, scopeMonth)

  db.transaction(() => {
    for (const schedule of schedules) {
      if (!schedule.budget_category_id) continue
      for (const { month } of seededMonths) {
        db.prepare('UPDATE budget_limits SET monthly_limit = 0 WHERE user_id = ? AND budget_id = ? AND month = ?')
          .run(userId, schedule.budget_category_id, month)
      }
    }
  })()
}

module.exports = {
  incomeOccursInMonth,
  occurrencesPerMonth,
  monthlyEquivalentIncome,
  createIncomeCategories,
  seedIncomeLeafIntoMonth,
  onIncomeCreated,
  onIncomeStopped,
  onIncomeAmountChanged,
  seedIncomeIntoMonth,
  deleteIncomeCategories,
  onIncomeCreatedScoped,
  onIncomeStoppedScoped,
}