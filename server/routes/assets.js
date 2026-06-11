const express     = require('express')
const db          = require('../db')
const requireAuth = require('../middleware/auth')
const router      = express.Router()

router.use(requireAuth)

// ── Helpers ───────────────────────────────────────────────────────────────────

function snapshotAssetToday(userId, assetId, value) {
  const today = new Date().toISOString().slice(0, 10)
  db.prepare(`
    INSERT INTO asset_snapshots (user_id, asset_id, date, value)
    VALUES (@user_id, @asset_id, @date, @value)
    ON CONFLICT(user_id, asset_id, date) DO UPDATE SET value = excluded.value
  `).run({ user_id: userId, asset_id: assetId, date: today, value })
}

// ── GET /api/assets ───────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const assets = db.prepare(
    'SELECT * FROM assets WHERE user_id = ? ORDER BY type, name'
  ).all(req.session.userId)
  res.json(assets)
})

// ── POST /api/assets ──────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { name, type, value, notes } = req.body
  if (!name || !type || value === undefined) {
    return res.status(400).json({ error: 'name, type, and value are required' })
  }
  const userId = req.session.userId
  try {
    const result = db.prepare(`
      INSERT INTO assets (user_id, name, type, value, notes)
      VALUES (@user_id, @name, @type, @value, @notes)
    `).run({
      user_id: userId,
      name,
      type,
      value:   parseFloat(value),
      notes:   notes || null,
    })
    const assetId = result.lastInsertRowid
    snapshotAssetToday(userId, assetId, parseFloat(value))
    res.json({ id: assetId, name, type, value: parseFloat(value) })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── PUT /api/assets/:id ───────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const { name, type, value, notes } = req.body
  const userId  = req.session.userId
  const assetId = req.params.id

  const asset = db.prepare(
    'SELECT id FROM assets WHERE id = ? AND user_id = ?'
  ).get(assetId, userId)
  if (!asset) return res.status(404).json({ error: 'Asset not found' })

  db.prepare(`
    UPDATE assets SET name = @name, type = @type, value = @value, notes = @notes
    WHERE id = @id AND user_id = @user_id
  `).run({
    name,
    type,
    value:   parseFloat(value),
    notes:   notes || null,
    id:      assetId,
    user_id: userId,
  })

  // Snapshot today's value on every update
  snapshotAssetToday(userId, assetId, parseFloat(value))

  res.json({ message: 'Updated' })
})

// ── DELETE /api/assets/:id ────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const userId  = req.session.userId
  const assetId = req.params.id

  const asset = db.prepare(
    'SELECT id FROM assets WHERE id = ? AND user_id = ?'
  ).get(assetId, userId)
  if (!asset) return res.status(404).json({ error: 'Asset not found' })

  // Cascades to asset_snapshots via FK ON DELETE CASCADE
  db.prepare('DELETE FROM assets WHERE id = ? AND user_id = ?').run(assetId, userId)
  res.json({ message: 'Deleted' })
})

module.exports = router