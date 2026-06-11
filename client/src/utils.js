// Format a number as currency
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style:    'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

// Format a date string for display
export function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
  })
}

// Get current month as YYYY-MM
export function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

// Build a flat category list into a nested tree
export function buildCategoryTree(rows) {
  const map  = {}
  const tree = []
  rows.forEach(r => map[r.id] = { ...r, children: [] })
  rows.forEach(r => {
    if (r.parent_id && map[r.parent_id]) {
      map[r.parent_id].children.push(map[r.id])
    } else {
      tree.push(map[r.id])
    }
  })
  return tree
}

// Sum spent amounts recursively.
// A parent's total = its own direct spend + all descendants' spend.
export function sumSpent(node) {
  const ownSpent      = node.spent || 0
  const childrenSpent = node.children && node.children.length > 0
    ? node.children.reduce((sum, child) => sum + sumSpent(child), 0)
    : 0
  return ownSpent + childrenSpent
}

// Sum monthly_limit recursively.
// A parent's effective limit = sum of all leaf descendants' limits.
// This means parent limits are always derived, never manually set.
export function sumLimit(node) {
  if (!node.children || node.children.length === 0) return node.monthly_limit || 0
  return node.children.reduce((sum, child) => sum + sumLimit(child), 0)
}

// Determine bar color based on spend percentage
export function spendColor(spent, limit) {
  if (limit === 0) return 'var(--accent)'
  const pct = spent / limit
  if (pct >= 1)   return 'var(--red)'
  if (pct >= 0.85) return 'var(--amber)'
  return 'var(--green)'
}

export function resolveColor(category, allCategories) {
  if (!category) return 'var(--accent)'
  if (category.color) return category.color
  if (category.parent_id) {
    const parent = allCategories.find(c => c.id === category.parent_id)
    if (parent) return resolveColor(parent, allCategories)
  }
  return 'var(--accent)'
}

// Build flat alphabetized tree for dropdowns
// Returns array of { id, label, depth, category, parent_id }
export function buildCategoryOptions(rows) {
  const map     = {}
  const roots   = []
  rows.forEach(r => map[r.id] = { ...r, children: [] })
  rows.forEach(r => {
    if (r.parent_id && map[r.parent_id]) {
      map[r.parent_id].children.push(map[r.id])
    } else {
      roots.push(map[r.id])
    }
  })
  // Sort roots and children alphabetically
  roots.sort((a, b) => a.category.localeCompare(b.category))
  roots.forEach(r => r.children.sort((a, b) => a.category.localeCompare(b.category)))

  // Flatten into option list with depth markers
  const options = []
  function flatten(node, depth) {
    options.push({ id: node.id, label: node.category, depth, color: node.color, parent_id: node.parent_id })
    node.children.forEach(child => flatten(child, depth + 1))
  }
  roots.forEach(r => flatten(r, 0))
  return options
}