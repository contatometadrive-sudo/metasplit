const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'splittrack.db');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    utmify_dashboard_id TEXT DEFAULT '',
    utmify_dashboard_name TEXT DEFAULT '',
    domain_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS destinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    src TEXT NOT NULL,
    weight REAL NOT NULL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    destination_id INTEGER REFERENCES destinations(id),
    params TEXT DEFAULT '{}',
    ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    referrer TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    destination_id INTEGER REFERENCES destinations(id) ON DELETE SET NULL,
    external_id TEXT DEFAULT '',
    event TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'unknown',
    amount REAL NOT NULL DEFAULT 0,
    src TEXT NOT NULL DEFAULT '',
    product_name TEXT DEFAULT '',
    customer_email TEXT DEFAULT '',
    raw_payload TEXT DEFAULT '{}',
    sale_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Drop-in replacement for better-sqlite3's db.transaction()
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  };
}

module.exports = { db, transaction };
