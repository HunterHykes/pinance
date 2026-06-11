const db = require('./db')

// ── Frequency helpers ─────────────────────────────────────────────────────────

function chargeOccursInMonth(anchorDate, frequency, targetMonth) {
  const anchor = new Date(anchorDate + 'T00:00:00')
  const [ty, tm] = targetMonth.split('-').map(Number)
  switch (frequency) {
    case 'monthly': return true
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
    default: return false
  }
}

// ── Auto-create budget categories for a bill ──────────────────────────────────
// Returns array of { charge_id, budget_category_id } mappings

function createBillCategories(userId, sub, charges, parentCategoryId) {
  const mappings       = []
  const multipleCharges = charges.length > 1

  const maxSort = db.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) as m FROM budget_categories
    WHERE user_id = ? AND parent_id ${parentCategoryId ? '= ?' : 'IS NULL'}
  `).get(userId, ...(parentCategoryId ? [parentCategoryId] : [])).m

  let sortOrder = maxSort + 1
  let groupCatId = parentCategoryId

  if (multipleCharges) {
    const existing = db.prepare(
      'SELECT id FROM budget_categories WHERE user_id = ? AND bill_id = ? AND parent_id IS ?'
    ).get(userId, sub.id, parentCategoryId || null)

    if (existing) {
      groupCatId = existing.id
      db.prepare('UPDATE budget_categories SET category = ?, color = ?, parent_id = ? WHERE id = ?')
        .run(sub.name, sub.color || null, parentCategoryId || null, existing.id)
    } else {
      let groupName = sub.name
      const conflict = db.prepare(
        'SELECT id FROM budget_categories WHERE user_id = ? AND category = ? AND (bill_id IS NULL OR bill_id != ?)'
      ).get(userId, sub.name, sub.id)
      if (conflict) groupName = `${sub.name} (bill)`

      const r = db.prepare(`
        INSERT INTO budget_categories
          (user_id, parent_id, category, color, sort_order, is_bill, bill_id)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(userId, parentCategoryId || null, groupName, sub.color || null, sortOrder++, sub.id)
      groupCatId = r.lastInsertRowid
    }

    if (!groupCatId) throw new Error(`Failed to create group category for bill "${sub.name}"`)
  }

  for (const charge of charges) {
    const leafName = multipleCharges ? charge.label : sub.name

    const existingLeaf = charge.budget_category_id
      ? db.prepare('SELECT id FROM budget_categories WHERE id = ?').get(charge.budget_category_id)
      : null

    let leafId
    if (existingLeaf) {
      leafId = existingLeaf.id
      db.prepare('UPDATE budget_categories SET category = ?, color = ?, parent_id = ? WHERE id = ?')
        .run(leafName, sub.color || null, groupCatId || null, leafId)
    } else {
      let insertName = leafName
      const nameConflict = db.prepare(
        'SELECT id FROM budget_categories WHERE user_id = ? AND category = ? AND (bill_id IS NULL OR bill_id != ?)'
      ).get(userId, leafName, sub.id)
      if (nameConflict) insertName = `${leafName} (${sub.id})`

      const r = db.prepare(`
        INSERT INTO budget_categories
          (user_id, parent_id, category, color, sort_order, is_bill, bill_id)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(userId, groupCatId || null, insertName, sub.color || null, sortOrder++, sub.id)
      leafId = r.lastInsertRowid
    }

    const leafCat = db.prepare('SELECT id FROM budget_categories WHERE id = ?').get(leafId)
    if (!leafCat) throw new Error(`Failed to create leaf category "${leafName}"`)

    db.prepare('UPDATE bill_charges SET budget_category_id = ? WHERE id = ?')
      .run(leafCat.id, charge.id)

    db.prepare(`
      INSERT INTO budget_template (user_id, budget_id, monthly_limit)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
    `).run(userId, leafCat.id, charge.amount)

    mappings.push({ charge_id: charge.id, budget_category_id: leafCat.id })
  }

  return mappings
}

// ── Seed a leaf category's limit into one already-seeded month ────────────────

function seedLeafIntoMonth(userId, catId, charge, month) {
  if (!chargeOccursInMonth(charge.anchor_date, charge.frequency, month)) return

  db.prepare(`
    INSERT INTO budget_limits (user_id, budget_id, month, monthly_limit)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, budget_id, month) DO UPDATE SET monthly_limit = excluded.monthly_limit
  `).run(userId, catId, month, charge.amount)
}

// ── Zero out a leaf category's limit in future seeded months ─────────────────

function zeroLeafInFutureMonths(userId, catId) {
  const today = new Date().toISOString().slice(0, 7)
  db.prepare(`
    UPDATE budget_limits SET monthly_limit = 0
    WHERE user_id = ? AND budget_id = ? AND month >= ?
  `).run(userId, catId, today)
}

// ── On bill creation: seed into existing seeded months ────────────────────────

function onBillCreated(userId, sub, charges) {
  const startMonth = sub.started_on.slice(0, 7)
  const seededMonths = db.prepare(`
    SELECT month FROM budget_months
    WHERE user_id = ? AND seeded = 1 AND month >= ?
    ORDER BY month ASC
  `).all(userId, startMonth)

  db.transaction(() => {
    for (const charge of charges) {
      if (!charge.budget_category_id) continue
      for (const { month } of seededMonths) {
        seedLeafIntoMonth(userId, charge.budget_category_id, charge, month)
      }
    }
  })()
}

// ── On cancellation: zero future months ──────────────────────────────────────

function onBillCancelled(userId, sub) {
  const charges = db.prepare(`
    SELECT * FROM bill_charges
    WHERE bill_id = ? AND effective_to IS NULL
  `).all(sub.id)

  db.transaction(() => {
    for (const charge of charges) {
      if (charge.budget_category_id) {
        zeroLeafInFutureMonths(userId, charge.budget_category_id)
      }
    }
  })()
}

// ── On price change: update template + re-seed future months ─────────────────

function onPriceChanged(userId, sub, newCharge) {
  if (!newCharge.budget_category_id) return
  const today = new Date().toISOString().slice(0, 7)

  db.prepare(`
    INSERT INTO budget_template (user_id, budget_id, monthly_limit)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
  `).run(userId, newCharge.budget_category_id, newCharge.amount)

  const futureSeedMonths = db.prepare(`
    SELECT month FROM budget_months
    WHERE user_id = ? AND seeded = 1 AND month >= ?
    ORDER BY month ASC
  `).all(userId, today)

  db.transaction(() => {
    for (const { month } of futureSeedMonths) {
      seedLeafIntoMonth(userId, newCharge.budget_category_id, newCharge, month)
    }
  })()
}

// ── Seed bills into a newly seeded month ──────────────────────────────────────

function seedBillsIntoMonth(userId, month) {
  const charges = db.prepare(`
    SELECT sc.* FROM bill_charges sc
    JOIN bills s ON s.id = sc.bill_id
    WHERE s.user_id = ? AND s.status != 'cancelled'
      AND s.started_on <= ?
      AND sc.effective_to IS NULL
      AND sc.budget_category_id IS NOT NULL
  `).all(userId, month + '-31')

  for (const charge of charges) {
    seedLeafIntoMonth(userId, charge.budget_category_id, charge, month)
  }
}

// ── Delete bill categories ────────────────────────────────────────────────────

function deleteBillCategories(userId, subId) {
  db.prepare(`
    UPDATE bill_charges SET budget_category_id = NULL
    WHERE bill_id = ?
  `).run(subId)

  const catIds = db.prepare(
    'SELECT id FROM budget_categories WHERE bill_id = ? AND user_id = ?'
  ).all(subId, userId).map(r => r.id)

  for (const catId of catIds) {
    db.prepare('UPDATE bills SET parent_category_id = NULL WHERE parent_category_id = ? AND user_id = ?')
      .run(catId, userId)
  }

  db.prepare('DELETE FROM budget_categories WHERE bill_id = ? AND user_id = ?')
    .run(subId, userId)
}

// ── Scoped seeding (for budget-scope modal) ───────────────────────────────────

function onBillCreatedScoped(userId, sub, charges, monthFilter, scopeMonth) {
  const seededMonths = db.prepare(`
    SELECT month FROM budget_months
    WHERE user_id = ? AND seeded = 1 ${monthFilter}
    ORDER BY month ASC
  `).all(userId, scopeMonth)

  db.transaction(() => {
    for (const charge of charges) {
      if (!charge.budget_category_id) continue
      db.prepare(`
        INSERT INTO budget_template (user_id, budget_id, monthly_limit)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
      `).run(userId, charge.budget_category_id, charge.amount)
      for (const { month } of seededMonths) {
        seedLeafIntoMonth(userId, charge.budget_category_id, charge, month)
      }
    }
  })()
}

function onBillCancelledScoped(userId, sub, monthFilter, scopeMonth) {
  const charges = db.prepare(`
    SELECT * FROM bill_charges WHERE bill_id = ? AND effective_to IS NULL
  `).all(sub.id)

  const seededMonths = db.prepare(`
    SELECT month FROM budget_months
    WHERE user_id = ? AND seeded = 1 ${monthFilter}
    ORDER BY month ASC
  `).all(userId, scopeMonth)

  db.transaction(() => {
    for (const charge of charges) {
      if (!charge.budget_category_id) continue
      for (const { month } of seededMonths) {
        db.prepare(`
          UPDATE budget_limits SET monthly_limit = 0
          WHERE user_id = ? AND budget_id = ? AND month = ?
        `).run(userId, charge.budget_category_id, month)
      }
    }
  })()
}

module.exports = {
  chargeOccursInMonth,
  createBillCategories,
  seedLeafIntoMonth,
  onBillCreated,
  onBillCancelled,
  onPriceChanged,
  seedBillsIntoMonth,
  deleteBillCategories,
  onBillCreatedScoped,
  onBillCancelledScoped,
}