//require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config({ path: '/etc/pinance/.env' })
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path    = require('path');

const app = express();

app.set('trust proxy', 1)  // ← add here

// ── Security & parsing middleware ────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "https://cdn.plaid.com", "https://static.cloudflareinsights.com"],
      frameSrc:   ["'self'", "https://cdn.plaid.com"],
      connectSrc: ["'self'", "https://*.plaid.com"],
      imgSrc:     ["'self'", "data:", "https://*.plaid.com"],
    },
  },
}));
app.use(express.json());
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      process.env.CLIENT_ORIGIN,
      'http://localhost:5173',
    ]
    if (!origin || allowed.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
}))

// ── Session ──────────────────────────────────────────────────────────────────
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, '../data')
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}))

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/accounts',      require('./routes/accounts'));
app.use('/api/transactions',  require('./routes/transactions'));
app.use('/api/budget',        require('./routes/budget'));
app.use('/api/plaid',         require('./routes/plaid'));
app.use('/api/category-map',  require('./routes/categorymap'));
app.use('/api/splits',        require('./routes/splits'));
app.use('/api/networth',      require('./routes/networth'));
app.use('/api/account-prefs',   require('./routes/account-prefs'));
app.use('/api/bills',           require('./routes/bills'));
app.use('/api/income',          require('./routes/income'));
app.use('/api/assets',          require('./routes/assets'));
app.use('/api/liabilities',     require('./routes/liabilities'));
app.use('/api/projector',       require('./routes/projector'));

// ── Serve React build in production ─────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  //app.get('*', (_, res) => { //dev
  app.get('/{*path}', (_, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});