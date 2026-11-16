'use strict';
// CampusVend database layer — uses Node's built-in SQLite (no npm install needed).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'campusvend.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',          -- admin | restocker
  pin_hash TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL,
  rows INTEGER NOT NULL DEFAULT 6, cols INTEGER NOT NULL DEFAULT 8,
  cooled INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'auto',           -- auto | on | sleep | maintenance
  sleep_message TEXT NOT NULL DEFAULT 'This machine is resting. Please come back later.',
  lights_mode TEXT NOT NULL DEFAULT 'auto',    -- auto | on | off
  open_time TEXT NOT NULL DEFAULT '00:00', close_time TEXT NOT NULL DEFAULT '00:00',
  last_seen INTEGER, temp_c REAL, door_open INTEGER DEFAULT 0, fw TEXT, controller_ok INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
  price REAL NOT NULL, cost REAL NOT NULL DEFAULT 0, emoji TEXT NOT NULL DEFAULT '🍫',
  supplier TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY, machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  code TEXT NOT NULL, row INTEGER NOT NULL, col INTEGER NOT NULL,
  product_id INTEGER REFERENCES products(id), capacity INTEGER NOT NULL DEFAULT 10,
  qty INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, fault INTEGER NOT NULL DEFAULT 0,
  UNIQUE(machine_id, code)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, machine_id INTEGER NOT NULL, slot_id INTEGER, slot_code TEXT,
  product_id INTEGER, product_name TEXT, category TEXT,
  amount REAL NOT NULL, cost REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL,                        -- upi | card
  status TEXT NOT NULL,                        -- pending|vending|completed|refund_due|refunded|expired|cancelled
  provider TEXT, provider_ref TEXT, payment_id TEXT, refund_ref TEXT, note TEXT,
  created_at INTEGER NOT NULL, paid_at INTEGER, completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS orders_time ON orders(created_at);
CREATE INDEX IF NOT EXISTS orders_machine ON orders(machine_id, created_at);
CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY, machine_id INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',       -- queued | sent | done | failed
  result TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY, machine_id INTEGER, type TEXT NOT NULL, severity TEXT NOT NULL,
  message TEXT NOT NULL, created_at INTEGER NOT NULL, resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS restock_log (
  id INTEGER PRIMARY KEY, machine_id INTEGER NOT NULL, slot_code TEXT NOT NULL, product_name TEXT,
  username TEXT NOT NULL, qty_before INTEGER NOT NULL, qty_after INTEGER NOT NULL, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const stmts = new Map();
const prep = (sql) => { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); stmts.set(sql, s); } return s; };
const all = (sql, ...p) => prep(sql).all(...p);
const one = (sql, ...p) => prep(sql).get(...p);
const run = (sql, ...p) => prep(sql).run(...p);
const now = () => Date.now();

function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(String(secret), salt, 32).toString('hex');
}
function verifySecret(secret, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const got = crypto.scryptSync(String(secret), Buffer.from(salt, 'hex'), 32);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newKey = () => crypto.randomBytes(24).toString('base64url');

const DEFAULT_SETTINGS = {
  telegram_token: '', telegram_chat_id: '', webhook_url: '',
  temp_max_c: '14', low_stock_pct: '25', campus_name: 'VIT Vellore',
};
function getSetting(key) {
  const r = one('SELECT value FROM settings WHERE key=?', key);
  return r ? r.value : (DEFAULT_SETTINGS[key] ?? '');
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
}

// Creates slot grid A1..F8 for a machine.
function createSlots(machineId, rows, cols, capacity = 10) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    run('INSERT OR IGNORE INTO slots(machine_id,code,row,col,capacity) VALUES(?,?,?,?,?)',
      machineId, String.fromCharCode(65 + r) + (c + 1), r, c, capacity);
  }
}

// First run: create the admin account with a random password, saved to a local file (never a default password).
function ensureAdmin() {
  if (one('SELECT id FROM users LIMIT 1')) return;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  run('INSERT INTO users(username,pass_hash,role,created_at) VALUES(?,?,?,?)', 'admin', hashSecret(password), 'admin', now());
  if (!process.env.ADMIN_PASSWORD) {
    const f = path.join(DATA_DIR, 'initial-admin-password.txt');
    fs.writeFileSync(f, `username: admin\npassword: ${password}\n\nChange it in Admin Portal > Settings > Users, then delete this file.\n`, { mode: 0o600 });
    console.log(`[setup] Admin account created. Login details saved in ${f}`);
  }
}

module.exports = { db, all, one, run, now, hashSecret, verifySecret, sha256, newKey, getSetting, setSetting, DEFAULT_SETTINGS, createSlots, ensureAdmin, DATA_DIR };
