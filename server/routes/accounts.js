const express     = require('express');
const db          = require('../db');
const requireAuth = require('../middleware/auth');
const router      = express.Router();

router.use(requireAuth);

// GET - only return this user's accounts, with prefs merged in
router.get('/', (req, res) => {
  const accounts = db.prepare(`
    SELECT a.*,
      COALESCE(p.display_name, a.name) AS display_name,
      p.line_style,
      p.is_hidden,
      ip.color
    FROM accounts a
    LEFT JOIN account_preferences p
      ON p.account_id = a.id AND p.user_id = a.user_id
    LEFT JOIN institution_preferences ip
      ON ip.institution = a.institution AND ip.user_id = a.user_id
    WHERE a.user_id = ?
    ORDER BY a.type, a.name
  `).all(req.session.userId);
  res.json(accounts);
});

// POST - stamp new accounts with this user's ID
router.post('/', (req, res) => {
  const { name, type, subtype, institution, balance } = req.body;
  if (!name || !type || balance === undefined) {
    return res.status(400).json({ error: 'name, type, and balance are required' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO accounts (user_id, name, type, subtype, institution, balance, is_manual)
      VALUES (@user_id, @name, @type, @subtype, @institution, @balance, 1)
    `).run({
      user_id:     req.session.userId,
      name,
      type,
      subtype:     subtype || null,
      institution: institution || null,
      balance:     parseFloat(balance),
    });
    res.json({ id: result.lastInsertRowid, name, type, balance: parseFloat(balance) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update manual account balance 
router.put('/:id', (req, res) => {
  const { balance, name, institution } = req.body;
  db.prepare(`
    UPDATE accounts SET balance = @balance, name = @name, institution = @institution
    WHERE id = @id AND user_id = @user_id AND is_manual = 1
  `).run({
    balance:     parseFloat(balance),
    name,
    institution,
    id:          req.params.id,
    user_id:     req.session.userId,
  });
  res.json({ message: 'Updated' });
});

// DELETE - only delete if it belongs to this user
// Body params:
//   action           — 'move_to_account' | 'delete_transactions' | omit (nullify, preserves orphaned txns)
//   target_account_id — required when action = 'move_to_account'
router.delete('/:id', (req, res) => {
  const id     = req.params.id;
  const userId = req.session.userId;
  const { action, target_account_id } = req.body || {};

  const account = db.prepare(
    'SELECT id FROM accounts WHERE id = ? AND user_id = ? AND is_manual = 1'
  ).get(id, userId);
  if (!account) return res.status(404).json({ error: 'Not found' });

  try {
    db.transaction(() => {
      if (action === 'move_to_account' && target_account_id) {
        const target = db.prepare(
          'SELECT id FROM accounts WHERE id = ? AND user_id = ?'
        ).get(target_account_id, userId);
        if (!target) throw new Error('Target account not found');
        // Move transactions; record original account if not already set
        db.prepare(`
          UPDATE transactions
          SET account_id = @target,
              original_account_id = COALESCE(original_account_id, account_id)
          WHERE account_id = @src AND user_id = @uid
        `).run({ target: target_account_id, src: id, uid: userId });
      } else if (action === 'delete_transactions') {
        db.prepare('DELETE FROM transactions WHERE account_id = ? AND user_id = ?').run(id, userId);
      }
      // Nullify any remaining FK references on this account before deleting it
      db.prepare('UPDATE transactions         SET account_id = NULL WHERE account_id = ? AND user_id = ?').run(id, userId);
      db.prepare('UPDATE bill_charges SET account_id = NULL WHERE account_id = ?').run(id);
      db.prepare('UPDATE income_schedules     SET account_id = NULL WHERE account_id = ?').run(id);
      db.prepare('UPDATE bills        SET account_id = NULL WHERE account_id = ?').run(id);
      db.prepare('UPDATE income_sources       SET account_id = NULL WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ? AND is_manual = 1').run(id, userId);
    })();
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Account delete error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to delete account' });
  }
});

module.exports = router;