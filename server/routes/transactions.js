const express     = require('express');
const crypto      = require('crypto');
const db          = require('../db');
const requireAuth = require('../middleware/auth');
const router      = express.Router();

router.use(requireAuth);

// Get transactions — supports ?month=YYYY-MM, ?date_from=YYYY-MM-DD, ?date_to=YYYY-MM-DD, ?account_id=N
router.get('/', (req, res) => {
  const { month, date_from, date_to, account_id } = req.query;
  const userId = req.session.userId;

  let query    = 'SELECT * FROM transactions WHERE user_id = ?';
  const params = [userId];
  if (date_from && date_to) {
    query += ' AND date >= ? AND date <= ?';
    params.push(date_from, date_to);
  } else if (month) {
    query += ' AND date LIKE ?';
    params.push(`${month}%`);
  }
  if (account_id) {
    query += ' AND account_id = ?';
    params.push(account_id);
  }
  query += ' ORDER BY date DESC LIMIT 2000';
  const transactions = db.prepare(query).all(...params);

  // Attach splits to split transactions
  const getSplits = db.prepare(
    'SELECT * FROM transaction_splits WHERE transaction_id = ? AND user_id = ? ORDER BY id ASC'
  );
  const result = transactions.map(t => ({
    ...t,
    splits: t.is_split ? getSplits.all(t.id, userId) : [],
  }));

  res.json(result);
});

// Add manual transaction 
router.post('/', (req, res) => {
  const { account_id, amount, date, description, category, notes, type } = req.body;
  if (!description || amount === undefined || !date) {
    return res.status(400).json({ error: 'description, amount, and date are required' });
  }
  const dedup = crypto.createHash('sha256')
    .update([
        req.session.userId,
        account_id,
        date,
        Number(amount).toFixed(2),
        description.toLowerCase().trim()
    ].join('|'))
    .digest('hex').slice(0, 16);
  try {
    const result = db.prepare(`
      INSERT INTO transactions
          (user_id, dedup_key, account_id, amount, date, description, category, notes, source, pending)
      VALUES
          (@user_id, @dedup_key, @account_id, @amount, @date, @description, @category, @notes, 'manual', 0)
      `).run({
        user_id:    req.session.userId,
        dedup_key:  dedup,
        account_id: account_id || null,
        amount, date, description,
        category:   category || 'Other',
        notes:      notes || null
      });
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Duplicate transaction' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Update transaction
// All transactions: notes + category always writable
// Manual transactions only: amount, date, description also writable
router.put('/:id', (req, res) => {
  const { notes, category, amount, date, description, type } = req.body;
  const userId = req.session.userId;
  const id     = req.params.id;

  const txn = db.prepare(
    'SELECT id, source FROM transactions WHERE id = ? AND user_id = ?'
  ).get(id, userId);
  if (!txn) return res.status(404).json({ error: 'Not found' });

  if (txn.source === 'manual' && amount !== undefined && date && description) {
    // Client pre-signs the amount (negative = expense, positive = income),
    // matching the same convention used in the POST handler.
    db.prepare(`
      UPDATE transactions
      SET notes = @notes, category = @category,
          amount = @amount, date = @date, description = @description
      WHERE id = @id AND user_id = @user_id
    `).run({ notes, category, amount: parseFloat(amount), date, description, id, user_id: userId });
  } else {
    db.prepare(`
      UPDATE transactions SET notes = @notes, category = @category
      WHERE id = @id AND user_id = @user_id
    `).run({ notes, category, id, user_id: userId });
  }

  res.json({ message: 'Updated' });
});

// Delete manual transaction 
router.delete('/:id', (req, res) => {
  db.prepare(
    "DELETE FROM transactions WHERE id = ? AND user_id = ? AND source = 'manual'"
  ).run(req.params.id, req.session.userId);
  res.json({ message: 'Deleted' });
});

module.exports = router;