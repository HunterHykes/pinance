const express     = require('express');
const db          = require('../db');
const requireAuth = require('../middleware/auth');
const router      = express.Router();

router.use(requireAuth);

// GET /category-map — all mappings for this user
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM category_map WHERE user_id = ? ORDER BY plaid_category'
  ).all(req.session.userId);
  res.json(rows);
});

// GET /category-map/plaid-categories — unique plaid categories seen in transactions
// Returns rows sorted so detailed subcategories appear after their parent primary
router.get('/plaid-categories', (req, res) => {
  const rows = db.prepare(`
    SELECT
      plaid_category,
      COUNT(*) AS transaction_count
    FROM transactions
    WHERE user_id = ?
      AND plaid_category IS NOT NULL
      AND plaid_category != ''
    GROUP BY plaid_category
    ORDER BY plaid_category ASC
  `).all(req.session.userId);
  res.json(rows);
});

// POST /category-map — save a mapping
router.post('/', (req, res) => {
  const { plaid_category, budget_category } = req.body;
  if (!plaid_category || !budget_category) {
    return res.status(400).json({ error: 'plaid_category and budget_category required' });
  }
  db.prepare(`
    INSERT INTO category_map (user_id, plaid_category, budget_category)
    VALUES (@user_id, @plaid_category, @budget_category)
    ON CONFLICT(user_id, plaid_category) DO UPDATE SET
      budget_category = excluded.budget_category
  `).run({
    user_id: req.session.userId,
    plaid_category,
    budget_category,
  });
  res.json({ message: 'Saved' });
});

// POST /category-map/apply — apply a mapping retroactively to existing transactions
router.post('/apply', (req, res) => {
  const { plaid_category, budget_category } = req.body;
  if (!plaid_category || !budget_category) {
    return res.status(400).json({ error: 'plaid_category and budget_category required' });
  }
  const result = db.prepare(`
    UPDATE transactions
    SET category = ?
    WHERE user_id = ?
      AND source = 'plaid'
      AND COALESCE(plaid_category, category) = ?
  `).run(budget_category, req.session.userId, plaid_category);
  res.json({ message: 'Applied', updated: result.changes });
});

// DELETE /category-map/:id
router.delete('/:id', (req, res) => {
  db.prepare(
    'DELETE FROM category_map WHERE id = ? AND user_id = ?'
  ).run(req.params.id, req.session.userId);
  res.json({ message: 'Deleted' });
});

module.exports = router;