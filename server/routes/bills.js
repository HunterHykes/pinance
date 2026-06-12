const express = require('express')
const db      = require('../db')
const requireAuth = require('../middleware/auth')
const {
  createBillCategories,
  onBillCreated,
  onBillCancelled,
  onPriceChanged,
  deleteBillCategories,
  onBillCreatedScoped,
  onBillCancelledScoped,
} = require('../bills')
const router = express.Router()

router.use(requireAuth)

// ── GET /api/bills ────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const userId = req.session.userId

  const subs = db.prepare(`
    SELECT s.*,
      a.name  AS account_name,
      pc.category AS parent_category_name,
      tc.category AS category_name
    FROM bills s
    LEFT JOIN accounts a ON a.id = s.account_id
    LEFT JOIN budget_categories pc ON pc.id = s.parent_category_id
    LEFT JOIN budget_categories tc ON tc.bill_id = s.id
                                   AND tc.user_id = s.user_id
                                   AND tc.parent_id IS s.parent_category_id
    WHERE s.user_id = ?
    ORDER BY s.status ASC, s.name ASC
  `).all(userId)

  const getCharges = db.prepare(`
    SELECT sc.*, bc.category AS category_name, a.name AS account_name
    FROM bill_charges sc
    LEFT JOIN budget_categories bc ON bc.id = sc.budget_category_id
    LEFT JOIN accounts a ON a.id = sc.account_id
    WHERE sc.bill_id = ?
    ORDER BY sc.effective_from DESC
  `)

  res.json(subs.map(sub => ({
    ...sub,
    // Prefer the linked category name as the authoritative display name
    name:    sub.category_name || sub.name,
    charges: getCharges.all(sub.id).map(c => ({
      ...c,
      // Prefer the linked category name as the authoritative charge label
      label: c.category_name || c.label,
    })),
  })))
})

// ── POST /api/bills ───────────────────────────────────────────────────

router.post('/', (req, res) => {
  const userId = req.session.userId
  const { name, description, parent_category_id, account_id,
          color, status, pause_until, started_on, notes, charges,
          merge_category_id } = req.body

  if (!name || !started_on)
    return res.status(400).json({ error: 'name and started_on are required' })
  if (!charges?.length)
    return res.status(400).json({ error: 'At least one charge rule is required' })

  // Verify parent category belongs to user if provided
  if (parent_category_id) {
    const cat = db.prepare(
      'SELECT id FROM budget_categories WHERE id = ? AND user_id = ? AND is_bill = 0'
    ).get(parent_category_id, userId)
    if (!cat) return res.status(400).json({ error: 'Parent category not found' })
  }

  let subId
  db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO bills
        (user_id, name, description, parent_category_id, account_id,
         color, status, pause_until, started_on, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, name, description || null, parent_category_id || null,
           account_id || null, color || null, status || 'active',
           pause_until || null, started_on, notes || null)

    subId = result.lastInsertRowid

    // Insert charge rules (without budget_category_id yet)
    const insertCharge = db.prepare(`
      INSERT INTO bill_charges
        (bill_id, user_id, label, amount, frequency, anchor_date, effective_from, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const c of charges) {
      insertCharge.run(subId, userId, c.label, parseFloat(c.amount), c.frequency,
                       c.anchor_date || started_on, c.effective_from || started_on,
                       c.schedule ? JSON.stringify(c.schedule) : null)
    }
  })()

  // Now create budget categories (outside transaction so IDs are committed)
  const sub       = db.prepare('SELECT * FROM bills WHERE id = ?').get(subId)
  const dbCharges = db.prepare('SELECT * FROM bill_charges WHERE bill_id = ?').all(subId)

  try {
    db.transaction(() => {
      if (merge_category_id && dbCharges.length === 1) {
        // Merge: point the existing category at this bill and link the charge to it
        db.prepare(`
          UPDATE budget_categories
          SET bill_id = ?, is_bill = 1, color = COALESCE(?, color), category = ?
          WHERE id = ? AND user_id = ?
        `).run(subId, color || null, name, merge_category_id, userId)

        db.prepare('UPDATE bill_charges SET budget_category_id = ? WHERE id = ?')
          .run(merge_category_id, dbCharges[0].id)

        // Sync template amount
        db.prepare(`
          INSERT INTO budget_template (user_id, budget_id, monthly_limit)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, budget_id) DO UPDATE SET monthly_limit = excluded.monthly_limit
        `).run(userId, merge_category_id, dbCharges[0].amount)
      } else {
        createBillCategories(userId, sub, dbCharges, parent_category_id || null)
      }
    })()
  } catch (err) {
    console.error('Category creation error:', err.message)
    return res.status(500).json({ error: 'Failed to create bill categories' })
  }

  // Reload charges with budget_category_id populated
  const finalCharges = db.prepare(
    'SELECT * FROM bill_charges WHERE bill_id = ?'
  ).all(subId)

  try { onBillCreated(userId, sub, finalCharges) }
  catch (e) { console.error('Bill seeding error:', e.message) }

  res.json({ id: subId, message: 'Created' })
})

// ── PUT /api/bills/:id ────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const userId = req.session.userId
  const subId  = req.params.id
  const { name, description, account_id, parent_category_id, status, pause_until, notes, scope,
          color,
          charges: incomingCharges } = req.body

  const existing = db.prepare(
    'SELECT * FROM bills WHERE id = ? AND user_id = ?'
  ).get(subId, userId)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  // Capture active charge IDs before any mutations (used to detect deletions)
  const currentActiveChargeIds = new Set(
    db.prepare('SELECT id FROM bill_charges WHERE bill_id = ? AND effective_to IS NULL')
      .all(subId).map(r => r.id)
  )

  const wasCancelled = existing.status === 'cancelled'
  const nowCancelled = status === 'cancelled'

  db.prepare(`
    UPDATE bills SET
      name = ?, description = ?, account_id = ?, parent_category_id = ?,
      color = ?,
      status = ?, pause_until = ?,
      cancelled_on = CASE WHEN ? = 'cancelled' AND cancelled_on IS NULL
                    THEN date('now') ELSE cancelled_on END,
      notes = ?
    WHERE id = ? AND user_id = ?
  `).run(name, description || null, account_id || null, parent_category_id || null,
         color || null,
         status, pause_until || null, status, notes || null, subId, userId)

  // Sync color to linked budget_categories
  db.prepare(`UPDATE budget_categories SET color = ? WHERE bill_id = ? AND user_id = ?`)
    .run(color || null, subId, userId)

  const sub = db.prepare('SELECT * FROM bills WHERE id = ?').get(subId)

  // ── Process intent-based changes for dirty existing charges ─────────────────
  const intents = req.body._intents || []
  for (const intent of intents) {
    const oldCharge = db.prepare(
      'SELECT * FROM bill_charges WHERE id = ? AND bill_id = ?'
    ).get(intent.charge_id, subId)
    if (!oldCharge) continue

    const updated = (incomingCharges || []).find(c => c.id === intent.charge_id)
    if (!updated) continue

    if (intent.intent === 'correction') {
      db.prepare(`
        UPDATE bill_charges SET label = ?, amount = ?, frequency = ?, anchor_date = ?, account_id = ?, schedule = ?
        WHERE id = ?
      `).run(updated.label || oldCharge.label, parseFloat(updated.amount), updated.frequency,
             updated.anchor_date || oldCharge.anchor_date,
             updated.account_id || null,
             updated.schedule ? JSON.stringify(updated.schedule) : (oldCharge.schedule || null),
             oldCharge.id)
      // Sync label change to linked budget category name
      if (updated.label && updated.label !== oldCharge.label && oldCharge.budget_category_id) {
        try {
          db.prepare('UPDATE budget_categories SET category = ? WHERE id = ? AND user_id = ?')
            .run(updated.label, oldCharge.budget_category_id, userId)
        } catch (e) { console.error('Charge label sync error:', e.message) }
      }
      // Re-seed all seeded months
      try {
        if (oldCharge.budget_category_id) {
          const { seedLeafIntoMonth } = require('../bills')
          const seededMonths = db.prepare(
            'SELECT month FROM budget_months WHERE user_id = ? AND seeded = 1 ORDER BY month ASC'
          ).all(userId)
          const updatedCharge = db.prepare('SELECT * FROM bill_charges WHERE id = ?').get(oldCharge.id)
          db.transaction(() => {
            for (const { month } of seededMonths) {
              seedLeafIntoMonth(userId, updatedCharge.budget_category_id, updatedCharge, month)
            }
          })()
        }
      } catch (e) { console.error('Bill correction re-seed error:', e.message) }
    } else if (intent.intent === 'forward') {
      const effectiveFrom = intent.effective_from
      db.prepare('UPDATE bill_charges SET effective_to = ? WHERE id = ?')
        .run(effectiveFrom, oldCharge.id)
      db.prepare(`
        INSERT INTO bill_charges
          (bill_id, user_id, label, amount, frequency, anchor_date,
           effective_from, budget_category_id, account_id, schedule)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(subId, userId, updated.label || oldCharge.label, parseFloat(updated.amount),
             updated.frequency || oldCharge.frequency,
             updated.anchor_date || oldCharge.anchor_date,
             effectiveFrom, oldCharge.budget_category_id, updated.account_id || null,
             updated.schedule ? JSON.stringify(updated.schedule) : (oldCharge.schedule || null))
      // Sync label change to linked budget category name
      if (updated.label && updated.label !== oldCharge.label && oldCharge.budget_category_id) {
        try {
          db.prepare('UPDATE budget_categories SET category = ? WHERE id = ? AND user_id = ?')
            .run(updated.label, oldCharge.budget_category_id, userId)
        } catch (e) { console.error('Charge label sync error:', e.message) }
      }
    } else if (intent.intent === 'one_time') {
      const month = intent.target_month
      if (oldCharge.budget_category_id && month) {
        db.prepare(`
          INSERT INTO budget_limits (user_id, budget_id, month, monthly_limit)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, budget_id, month) DO UPDATE SET monthly_limit = excluded.monthly_limit
        `).run(userId, oldCharge.budget_category_id, month, parseFloat(updated.amount))
      }
    }
  }

  // ── Insert any new charges (rows without an id from the client) ─────────────
  const newCharges = (incomingCharges || []).filter(c => !c.id)
  if (newCharges.length > 0) {
    const insertCharge = db.prepare(`
      INSERT INTO bill_charges
        (bill_id, user_id, label, amount, frequency, anchor_date, effective_from, account_id, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    db.transaction(() => {
      for (const c of newCharges) {
        insertCharge.run(subId, userId, c.label, parseFloat(c.amount),
          c.frequency,
          c.anchor_date || sub.started_on,
          c.effective_from || sub.started_on,
          c.account_id || null,
          c.schedule ? JSON.stringify(c.schedule) : null)
      }
    })()

    // Create budget categories for newly inserted charges
    const unlinked = db.prepare(
      'SELECT * FROM bill_charges WHERE bill_id = ? AND effective_to IS NULL AND budget_category_id IS NULL'
    ).all(subId)
    if (unlinked.length > 0) {
      try {
        db.transaction(() => {
          createBillCategories(userId, sub, unlinked, sub.parent_category_id)
        })()
        const seeded = db.prepare(
          'SELECT * FROM bill_charges WHERE bill_id = ? AND effective_to IS NULL'
        ).all(subId).filter(c => unlinked.find(u => u.id === c.id))
        onBillCreated(userId, sub, seeded)
      } catch (e) { console.error('New charge category error:', e.message) }
    }
  }

  // ── End-date charges removed by the client ──────────────────────────────────
  const incomingExistingChargeIds = new Set(
    (incomingCharges || []).filter(c => c.id).map(c => Number(c.id))
  )
  const todaySub = new Date().toISOString().slice(0, 10)
  const currentMonthSub = todaySub.slice(0, 7)
  for (const chargeId of currentActiveChargeIds) {
    if (!incomingExistingChargeIds.has(chargeId)) {
      db.prepare('UPDATE bill_charges SET effective_to = ? WHERE id = ?').run(todaySub, chargeId)
      const charge = db.prepare('SELECT * FROM bill_charges WHERE id = ?').get(chargeId)
      if (charge?.budget_category_id) {
        db.prepare('UPDATE budget_limits SET monthly_limit = 0 WHERE user_id = ? AND budget_id = ? AND month >= ?')
          .run(userId, charge.budget_category_id, currentMonthSub)
        db.prepare('UPDATE budget_template SET monthly_limit = 0 WHERE user_id = ? AND budget_id = ?')
          .run(userId, charge.budget_category_id)
      }
    }
  }

  // Sync name and color to linked budget_categories
  try {
    db.prepare(`
      UPDATE budget_categories
      SET category = ?, color = ?
      WHERE bill_id = ? AND user_id = ? AND parent_id IS ?
    `).run(name, sub.color, subId, userId, sub.parent_category_id)
    db.prepare(`
      UPDATE budget_categories SET color = ?
      WHERE bill_id = ? AND user_id = ?
    `).run(sub.color, subId, userId)
  } catch (e) { console.error('Bill category sync error:', e.message) }

  const scopeMonth = new Date().toISOString().slice(0, 7)
  const monthFilter = scope === 'this_month' ? 'AND month = ?' : 'AND month >= ?'

  try {
    const oldCat = existing.parent_category_id ?? null
    const newCat = parent_category_id ?? null
    const categoryChanged = String(oldCat) !== String(newCat)
    if (categoryChanged) {
      db.prepare(`
        UPDATE budget_categories
        SET parent_id = ?
        WHERE bill_id = ? AND user_id = ?
          AND parent_id IS ?
      `).run(newCat, subId, userId, oldCat)
    }
  } catch (e) { console.error('Bill reparent error:', e.message) }

  const charges = db.prepare(
    'SELECT * FROM bill_charges WHERE bill_id = ? AND effective_to IS NULL'
  ).all(subId)

  if (!wasCancelled && nowCancelled) {
    try { onBillCancelledScoped(userId, sub, monthFilter, scopeMonth) }
    catch (e) { console.error('Cancellation error:', e.message) }
  } else if (!nowCancelled) {
    try { onBillCreatedScoped(userId, sub, charges, monthFilter, scopeMonth) }
    catch (e) { console.error('Update seeding error:', e.message) }
  }

  res.json({ message: 'Updated' })
})

// ── DELETE /api/bills/:id ────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const userId = req.session.userId
  const subId  = req.params.id

  const sub = db.prepare(
    'SELECT * FROM bills WHERE id = ? AND user_id = ?'
  ).get(subId, userId)
  if (!sub) return res.status(404).json({ error: 'Not found' })

  // Zero future months before deleting
  try { onBillCancelled(userId, sub) }
  catch (e) { console.error('Delete seeding error:', e.message) }

  // Delete auto-created categories (cascades to budget_limits via FK)
  try { deleteBillCategories(userId, subId) }
  catch (e) { console.error('Category delete error:', e.message) }

  db.prepare('DELETE FROM bills WHERE id = ? AND user_id = ?').run(subId, userId)
  res.json({ message: 'Deleted' })
})

// ── POST /api/bills/:id/price-change ─────────────────────────────────

router.post('/:id/price-change', (req, res) => {
  const userId = req.session.userId
  const subId  = req.params.id
  const { charge_id, new_amount, effective_from } = req.body

  if (!charge_id || !new_amount || !effective_from)
    return res.status(400).json({ error: 'charge_id, new_amount, effective_from required' })

  const sub = db.prepare(
    'SELECT * FROM bills WHERE id = ? AND user_id = ?'
  ).get(subId, userId)
  if (!sub) return res.status(404).json({ error: 'Not found' })

  const oldCharge = db.prepare(
    'SELECT * FROM bill_charges WHERE id = ? AND bill_id = ?'
  ).get(charge_id, subId)
  if (!oldCharge) return res.status(404).json({ error: 'Charge not found' })

  let newChargeId
  db.transaction(() => {
    // Close old charge
    db.prepare(
      'UPDATE bill_charges SET effective_to = ? WHERE id = ?'
    ).run(effective_from, charge_id)

    // Open new charge, inheriting the same budget_category_id
    const r = db.prepare(`
      INSERT INTO bill_charges
        (bill_id, user_id, label, amount, frequency, anchor_date,
         effective_from, budget_category_id, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(subId, userId, oldCharge.label, parseFloat(new_amount),
           oldCharge.frequency, oldCharge.anchor_date, effective_from,
           oldCharge.budget_category_id, oldCharge.schedule || null)
    newChargeId = r.lastInsertRowid
  })()

  const newCharge = db.prepare(
    'SELECT * FROM bill_charges WHERE id = ?'
  ).get(newChargeId)

  try { onPriceChanged(userId, sub, newCharge) }
  catch (e) { console.error('Price change error:', e.message) }

  res.json({ message: 'Price updated', new_charge_id: newChargeId })
})

module.exports = router