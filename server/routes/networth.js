const express     = require('express')
const db          = require('../db')
const requireAuth = require('../middleware/auth')
const router      = express.Router()

router.use(requireAuth)

// ── Helpers ───────────────────────────────────────────────────────────────────

// Return an array of date strings at the requested interval between start and end
function buildDateSeries(startDate, endDate, interval) {
  const dates = []
  const d     = new Date(startDate)
  const end   = new Date(endDate)

  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10))
    if (interval === 'day')   d.setDate(d.getDate() + 1)
    if (interval === 'week')  d.setDate(d.getDate() + 7)
    if (interval === 'month') d.setMonth(d.getMonth() + 1)
  }
  // Always include the end date
  const last = end.toISOString().slice(0, 10)
  if (dates[dates.length - 1] !== last) dates.push(last)
  return dates
}

// Given a range string, return { startDate, endDate, interval }
function resolveRange(range) {
  const today   = new Date()
  const endDate = today.toISOString().slice(0, 10)
  let startDate, interval

  switch (range) {
    case '1W':
      startDate = new Date(today); startDate.setDate(today.getDate() - 7)
      interval  = 'day'; break
    case '1M':
      startDate = new Date(today); startDate.setMonth(today.getMonth() - 1)
      interval  = 'day'; break
    case '3M':
      startDate = new Date(today); startDate.setMonth(today.getMonth() - 3)
      interval  = 'day'; break
    case '6M':
      startDate = new Date(today); startDate.setMonth(today.getMonth() - 6)
      interval  = 'week'; break
    case '1Y':
      startDate = new Date(today); startDate.setFullYear(today.getFullYear() - 1)
      interval  = 'week'; break
    case '5Y':
      startDate = new Date(today); startDate.setFullYear(today.getFullYear() - 5)
      interval  = 'month'; break
    case '10Y':
      startDate = new Date(today); startDate.setFullYear(today.getFullYear() - 10)
      interval  = 'month'; break
    case 'ALL':
    default: {
      const earliest = db.prepare(
        'SELECT MIN(date) as d FROM balance_snapshots WHERE user_id = ?'
      ).get(require('../middleware/auth') /* placeholder */ )
      // startDate resolved per-request below
      startDate = null
      interval  = 'month'; break
    }
  }

  return {
    startDate: startDate ? startDate.toISOString().slice(0, 10) : null,
    endDate,
    interval,
  }
}

// ── GET /api/networth?range=1M ────────────────────────────────────────────────

router.get('/', (req, res) => {
  const userId = req.session.userId
  const range  = req.query.range || '1M'

  // Resolve date range
  const today   = new Date()
  const endDate = today.toISOString().slice(0, 10)
  let startDate, interval

  switch (range) {
    case '1W':
      { const d = new Date(today); d.setDate(d.getDate() - 7)
        startDate = d.toISOString().slice(0, 10); interval = 'day'; break }
    case '1M':
      { const d = new Date(today); d.setMonth(d.getMonth() - 1)
        startDate = d.toISOString().slice(0, 10); interval = 'day'; break }
    case '3M':
      { const d = new Date(today); d.setMonth(d.getMonth() - 3)
        startDate = d.toISOString().slice(0, 10); interval = 'day'; break }
    case '6M':
      { const d = new Date(today); d.setMonth(d.getMonth() - 6)
        startDate = d.toISOString().slice(0, 10); interval = 'week'; break }
    case '1Y':
      { const d = new Date(today); d.setFullYear(d.getFullYear() - 1)
        startDate = d.toISOString().slice(0, 10); interval = 'week'; break }
    case '5Y':
      { const d = new Date(today); d.setFullYear(d.getFullYear() - 5)
        startDate = d.toISOString().slice(0, 10); interval = 'month'; break }
    case '10Y':
      { const d = new Date(today); d.setFullYear(d.getFullYear() - 10)
        startDate = d.toISOString().slice(0, 10); interval = 'month'; break }
    case 'ALL':
    default: {
      const earliest = db.prepare(`
        SELECT MIN(d) as d FROM (
          SELECT MIN(date) as d FROM balance_snapshots WHERE user_id = ?
          UNION ALL
          SELECT MIN(date) as d FROM asset_snapshots WHERE user_id = ?
        )
      `).get(userId, userId)
      startDate = earliest?.d || endDate
      interval  = 'month'; break
    }
  }

  // Load all accounts, assets, and liabilities for this user
  const accounts    = db.prepare('SELECT id, name, type FROM accounts    WHERE user_id = ?').all(userId)
  const assets      = db.prepare('SELECT id, name, type FROM assets      WHERE user_id = ?').all(userId)
  const liabilities = db.prepare('SELECT id, name, type FROM liabilities WHERE user_id = ?').all(userId)

  if (accounts.length === 0 && assets.length === 0 && liabilities.length === 0) {
    return res.json({ dates: [], series: [], netWorth: [] })
  }

  // Load all snapshots in range
  const snapshots = db.prepare(`
    SELECT account_id, NULL as asset_id, NULL as liability_id, date, balance as value
    FROM balance_snapshots
    WHERE user_id = ? AND date >= ? AND date <= ?
    UNION ALL
    SELECT NULL, asset_id, NULL, date, value
    FROM asset_snapshots
    WHERE user_id = ? AND date >= ? AND date <= ?
    UNION ALL
    SELECT NULL, NULL, liability_id, date, -balance as value
    FROM liability_snapshots
    WHERE user_id = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `).all(userId, startDate, endDate, userId, startDate, endDate, userId, startDate, endDate)

  const acctSnaps      = snapshots.filter(s => s.account_id    != null)
  const assetSnaps     = snapshots.filter(s => s.asset_id      != null)
  const liabSnaps      = snapshots.filter(s => s.liability_id  != null)

  const acctLookup = {}
  for (const acct of accounts) acctLookup[acct.id] = {}
  for (const snap of acctSnaps) {
    if (acctLookup[snap.account_id]) acctLookup[snap.account_id][snap.date] = snap.value
  }

  const assetLookup = {}
  for (const asset of assets) assetLookup[asset.id] = {}
  for (const snap of assetSnaps) {
    if (assetLookup[snap.asset_id]) assetLookup[snap.asset_id][snap.date] = snap.value
  }

  // Liability lookup — values already negated in SQL for correct net worth math
  const liabLookup = {}
  for (const liab of liabilities) liabLookup[liab.id] = {}
  for (const snap of liabSnaps) {
    if (liabLookup[snap.liability_id]) liabLookup[snap.liability_id][snap.date] = snap.value
  }

  // Build date series at the correct interval
  const dates = buildDateSeries(startDate, endDate, interval)

  // Forward-fill helper — given a lookup map and all snaps for one entity,
  // return the value at each date point.
  function fillSeries(byDate, allSnapsForEntity) {
    const data = []
    let lastKnown = null
    for (const date of dates) {
      if (byDate[date] !== undefined) {
        lastKnown = byDate[date]
      } else {
        const prior = allSnapsForEntity.filter(s => s.date <= date)
        if (prior.length > 0) lastKnown = prior[prior.length - 1].value
      }
      data.push(lastKnown)
    }
    return data
  }

  const accountSeries = accounts.map(acct => ({
    account_id: acct.id,
    name:       acct.name,
    type:       acct.type,
    seriesType: 'account',
    data: fillSeries(acctLookup[acct.id], acctSnaps.filter(s => s.account_id === acct.id)),
  }))

  const assetSeries = assets.map(asset => ({
    asset_id:   asset.id,
    name:       asset.name,
    type:       asset.type,
    seriesType: 'asset',
    data: fillSeries(assetLookup[asset.id], assetSnaps.filter(s => s.asset_id === asset.id)),
  }))

  // Liability series — stored as negative values so net worth sum is automatic
  const liabilitySeries = liabilities.map(liab => ({
    liability_id: liab.id,
    name:         liab.name,
    type:         liab.type,
    seriesType:   'liability',
    data: fillSeries(liabLookup[liab.id], liabSnaps.filter(s => s.liability_id === liab.id)),
  }))

  const series = [...accountSeries, ...assetSeries, ...liabilitySeries]

  // Net worth = sum of all accounts + all assets at each date point
  const netWorth = dates.map((_, i) =>
    series.reduce((sum, s) => sum + (s.data[i] ?? 0), 0)
  )

  res.json({ dates, series, netWorth })
})

module.exports = router