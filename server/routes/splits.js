const express     = require('express');
const db          = require('../db');
const requireAuth = require('../middleware/auth');
const router      = express.Router();

router.use(requireAuth);

// GET /splits/:transactionId — get splits for a transaction
router.get('/:transactionId', (req, res) => {
  const splits = db.prepare(`
    SELECT * FROM transaction_splits
    WHERE transaction_id = ? AND user_id = ?
    ORDER BY id ASC
  `).all(req.params.transactionId, req.session.userId);
  res.json(splits);
});

// POST /splits/:transactionId — save splits for a transaction
// Replaces all existing splits atomically
router.post('/:transactionId', (req, res) => {
  const { splits } = req.body;
  const userId = req.session.userId;
  const txnId  = req.params.transactionId;

  if (!Array.isArray(splits) || splits.length === 0) {
    return res.status(400).json({ error: 'splits array required' });
  }

  // Verify transaction belongs to user
  const txn = db.prepare(
    'SELECT * FROM transactions WHERE id = ? AND user_id = ?'
  ).get(txnId, userId);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });

  // Validate splits sum matches transaction amount
  const total    = splits.reduce((s, sp) => s + Math.abs(parseFloat(sp.amount)), 0);
  const txnAbs   = Math.abs(txn.amount);
  if (Math.abs(total - txnAbs) > 0.01) {
    return res.status(400).json({
      error: `Splits total $${total.toFixed(2)} does not match transaction amount $${txnAbs.toFixed(2)}`
    });
  }

  db.transaction(() => {
    // Remove existing splits
    db.prepare(
      'DELETE FROM transaction_splits WHERE transaction_id = ? AND user_id = ?'
    ).run(txnId, userId);

    // Insert new splits
    const insert = db.prepare(`
      INSERT INTO transaction_splits (user_id, transaction_id, amount, category, notes)
      VALUES (@user_id, @transaction_id, @amount, @category, @notes)
    `);
    for (const sp of splits) {
      insert.run({
        user_id:        userId,
        transaction_id: txnId,
        amount:         -Math.abs(parseFloat(sp.amount)),
        category:       sp.category,
        notes:          sp.notes || null,
      });
    }

    // Mark parent as split
    db.prepare(
      'UPDATE transactions SET is_split = 1 WHERE id = ? AND user_id = ?'
    ).run(txnId, userId);
  })();

  res.json({ message: 'Splits saved' });
});

// DELETE /splits/:transactionId — remove all splits, restore transaction
router.delete('/:transactionId', (req, res) => {
  const userId = req.session.userId;
  const txnId  = req.params.transactionId;

  db.transaction(() => {
    db.prepare(
      'DELETE FROM transaction_splits WHERE transaction_id = ? AND user_id = ?'
    ).run(txnId, userId);
    db.prepare(
      'UPDATE transactions SET is_split = 0 WHERE id = ? AND user_id = ?'
    ).run(txnId, userId);
  })();

  res.json({ message: 'Splits removed' });
});

module.exports = router;