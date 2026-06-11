const db = require('./db')

const DEFAULT_TEMPLATE = [
  { category: 'Income',   color: '#22c55e', monthly_limit: 0, children: [] },
  { category: 'Expenses', color: '#f97316', monthly_limit: 0, children: [
    { category: 'Housing', monthly_limit: 0, children: [
      { category: 'Rent' },        { category: 'Electricity' },
      { category: 'Natural Gas' }, { category: 'Water' },
      { category: 'Trash' },       { category: 'Internet' },
    ]},
    { category: 'Transportation', monthly_limit: 0, children: [
      { category: 'Gasoline' },    { category: 'Maintenance' },
      { category: 'Tolls' },       { category: 'Fines' },
    ]},
    { category: 'Food', monthly_limit: 0, children: [
      { category: 'Groceries' },   { category: 'Restaurants' },
      { category: 'Fast Food' },
    ]},
    { category: 'Personal', monthly_limit: 0, children: [
      { category: 'Pet Care' },    { category: 'Phone' },
      { category: 'Clothing' },    { category: 'Cosmetics' },
      { category: 'Home Improvement' },
    ]},
    { category: 'Insurance', monthly_limit: 0, children: [
      { category: 'Health Insurance' },         { category: 'Life Insurance' },
      { category: 'Auto Insurance' },           { category: 'Renter Insurance' },
      { category: 'Identity Theft Insurance' },
    ]},
    { category: 'Health', monthly_limit: 0, children: [
      { category: 'Doctor Visits' }, { category: 'Medicine' },
      { category: 'Supplements' },
    ]},
    { category: 'Lifestyle', monthly_limit: 0, children: [
      { category: 'Alcohol' },       { category: 'Entertainment' },
      { category: 'Golf' },          { category: 'Electronics' },
      { category: 'Subscriptions' }, { category: 'Fun Money' },
      { category: 'Video Games' },   { category: 'Gifts' },
      { category: 'Vacation' },      { category: 'Firearms' },
      { category: 'Miscellaneous' }, { category: 'Other' },
    ]},
    { category: 'Transfers', monthly_limit: 0, children: [
      { category: 'Investment Transfer' }, { category: 'Checking Transfer' },
      { category: 'Savings Transfer' },    { category: 'Cash Transfer' },
    ]},
    { category: 'Giving', monthly_limit: 0, children: [
      { category: 'Church' }, { category: 'Charity' },
    ]},
  ]},
]

const insertCat = db.prepare(`
  INSERT OR IGNORE INTO budget_categories (user_id, parent_id, category, color, sort_order)
  VALUES (@user_id, @parent_id, @category, @color, @sort_order)
`)

const insertLimit = db.prepare(`
  INSERT OR IGNORE INTO budget_template (user_id, budget_id, monthly_limit)
  VALUES (@user_id, @budget_id, @monthly_limit)
`)

const lookupCat = db.prepare(
  'SELECT id FROM budget_categories WHERE user_id = ? AND category = ?'
)

function seedTemplateForUser(userId) {
  let sortOrder = 0
  db.transaction(() => {
    function insertNode(node, parentId) {
      insertCat.run({
        user_id:    userId,
        parent_id:  parentId,
        category:   node.category,
        color:      node.color || null,
        sort_order: sortOrder++,
      })
      const row = lookupCat.get(userId, node.category)
      if (!row) return
      insertLimit.run({
        user_id:       userId,
        budget_id:     row.id,
        monthly_limit: node.monthly_limit || 0,
      })
      if (node.children) {
        node.children.forEach(child => insertNode(child, row.id))
      }
    }
    DEFAULT_TEMPLATE.forEach(root => insertNode(root, null))
  })()
}

module.exports = { seedTemplateForUser }