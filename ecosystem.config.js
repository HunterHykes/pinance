const fs   = require('fs')
const path = require('path')

// Manually parse .env file
const envFile = path.join(__dirname, '.env')
const env     = {}
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=')
    if (key && rest.length) env[key.trim()] = rest.join('=').trim()
  })
}

module.exports = {
  apps: [{
    name:   'finance-server',
    script: './server/index.js',
    cwd:    '/home/hunter/finance',
    env: {
      NODE_ENV:        env.NODE_ENV,
      PORT:            env.PORT,
      SESSION_SECRET:  env.SESSION_SECRET,
      CLIENT_ORIGIN:   env.CLIENT_ORIGIN,
      PLAID_CLIENT_ID: env.PLAID_CLIENT_ID,
      PLAID_SECRET:    env.PLAID_SECRET,
    }
  }]
}