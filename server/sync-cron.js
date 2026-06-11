// sync-cron.js — heartbeat cron, checks schedule before syncing
// Cron: 0 * * * * (every hour)
// Update crontab: sudo crontab -u pinance-service -e

require('dotenv').config({ path: '/etc/pinance/.env' })

const db = require('./db')
const { syncItem, shouldSyncItem, recordHeartbeat, recordSyncType } = require('./plaid')

async function run() {
  const now = new Date().toISOString()
  console.log(`[${now}] Heartbeat`)

  // Get all users who have plaid items
  const users = db.prepare(
    `SELECT DISTINCT user_id FROM plaid_items`
  ).all()

  if (users.length === 0) {
    console.log(`[${now}] No users with connected items — exiting`)
    process.exit(0)
  }

  for (const { user_id } of users) {
    // Always record the heartbeat so Settings can display it
    recordHeartbeat(user_id)

    // Resolve this user's global frequency setting once
    const settings = db.prepare(
      `SELECT sync_frequency FROM plaid_settings WHERE user_id = ?`
    ).get(user_id)
    const globalFrequency = settings?.sync_frequency || 'weekly'

    // Fetch all items for this user and evaluate each independently
    const items = db.prepare(
      `SELECT * FROM plaid_items WHERE user_id = ?`
    ).all(user_id)

    let anySynced = false

    for (const item of items) {
      const label = item.institution || item.item_id

      if (!shouldSyncItem(item, globalFrequency)) {
        console.log(`[${now}] User ${user_id} / ${label} — not due, skipping`)
        continue
      }

      console.log(`[${now}] User ${user_id} / ${label} — syncing...`)
      try {
        // Cron sync: transactions only, no balance call
        await syncItem(item, { includeBalance: false })
        console.log(`[${now}] User ${user_id} / ${label} — sync complete`)
        anySynced = true
      } catch (err) {
        console.error(`[${now}] User ${user_id} / ${label} — sync failed:`, err.message)
      }
    }

    if (anySynced) {
      recordSyncType(user_id, 'scheduled')
    }
  }

  process.exit(0)
}

run()