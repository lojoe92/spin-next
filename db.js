/**
 * Spin Next database layer — sql.js (pure WASM SQLite, no native deps).
 * Users + a per-user state blob (ratings, skipped, history, prefs as JSON).
 * Auth tables are near-identical to family-tree so the two apps share a mental model.
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Keep the runtime SQLite file in server-data/ so it never collides with the
// build inputs under data/ (albums.json, tags.json etc.).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'server-data', 'spin.db');

let _db = null;

async function getDb() {
  if (_db) return _db;
  const SQL = await initSqlJs();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  _db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  initSchema(_db);
  return _db;
}

function persist(db) {
  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initSchema(db) {
  db.run(`PRAGMA foreign_keys = ON;`);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS spin_state (
      user_id INTEGER PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      token_hash TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS open_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL DEFAULT 'user',
      token_hash TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_for_email TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Default admin if no users exist
  const rows = db.exec('SELECT COUNT(*) AS c FROM users');
  const count = rows[0]?.values[0][0] || 0;
  if (count === 0) {
    const defaultPassword = process.env.ADMIN_PASSWORD || 'change-me-please';
    const username = process.env.ADMIN_USERNAME || 'admin';
    const email = process.env.ADMIN_EMAIL || null;
    const hash = bcrypt.hashSync(defaultPassword, 10);
    db.run('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, hash, 'admin']);
    persist(db);
    console.log(`Default admin created: username="${username}", password="${defaultPassword}"`);
    console.log('Change via Settings → Change Password, or set ADMIN_PASSWORD env var.');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function queryAll(db, sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}
function queryOne(db, sql, params = []) { return queryAll(db, sql, params)[0] || null; }

// ── Users ──────────────────────────────────────────────────────────────────

function getUserByUsername(db, username) {
  return queryOne(db, 'SELECT * FROM users WHERE username = ?', [username]);
}
function getUserByEmail(db, email) {
  return queryOne(db, 'SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
}
function getUserById(db, id) {
  return queryOne(db, 'SELECT * FROM users WHERE id = ?', [id]);
}
function getAllUsers(db) {
  return queryAll(db, 'SELECT id, username, email, role, created_at FROM users ORDER BY id');
}
function createUser(db, username, passwordHash, role, email) {
  db.run('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [username, email || null, passwordHash, role || 'user']);
  persist(db);
  return queryOne(db, 'SELECT id, username, email, role FROM users WHERE username = ?', [username]);
}
function updateUser(db, id, { passwordHash, role, email }) {
  if (passwordHash !== undefined) db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  if (role !== undefined)         db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  if (email !== undefined)        db.run('UPDATE users SET email = ? WHERE id = ?', [email || null, id]);
  persist(db);
}
function updatePassword(db, userId, newHash) {
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
  persist(db);
}
function deleteUser(db, id) {
  db.run('DELETE FROM spin_state WHERE user_id = ?', [id]);
  db.run('DELETE FROM users WHERE id = ?', [id]);
  persist(db);
}

// ── Per-user state blob ────────────────────────────────────────────────────

function getState(db, userId) {
  const row = queryOne(db, 'SELECT data FROM spin_state WHERE user_id = ?', [userId]);
  if (!row) return {};
  try { return JSON.parse(row.data); } catch { return {}; }
}
function setState(db, userId, obj) {
  const json = JSON.stringify(obj || {});
  db.run(
    `INSERT INTO spin_state (user_id, data, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    [userId, json]
  );
  persist(db);
}

// ── Invitations (email-based) ──────────────────────────────────────────────

function createInvitation(db, { email, role, tokenHash, invitedBy, expiresAt }) {
  db.run(
    `INSERT INTO invitations (email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [email.toLowerCase(), role, tokenHash, invitedBy, expiresAt]
  );
  persist(db);
  return queryOne(db, 'SELECT * FROM invitations WHERE token_hash = ?', [tokenHash]);
}
function getInvitationByTokenHash(db, hash) {
  return queryOne(db, 'SELECT * FROM invitations WHERE token_hash = ?', [hash]);
}
function getPendingInvitationByEmail(db, email) {
  return queryOne(db,
    `SELECT * FROM invitations WHERE LOWER(email) = LOWER(?) AND accepted_at IS NULL AND expires_at > datetime('now')`,
    [email]);
}
function getAllPendingInvitations(db) {
  return queryAll(db,
    `SELECT id, email, role, invited_by, expires_at, created_at FROM invitations
     WHERE accepted_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC`);
}
function markInvitationAccepted(db, id) {
  db.run(`UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?`, [id]);
  persist(db);
}
function deleteInvitation(db, id) {
  db.run('DELETE FROM invitations WHERE id = ?', [id]);
  persist(db);
}

// ── Open invitations (shareable links) ────────────────────────────────────

function createOpenInvitation(db, { role, tokenHash, invitedBy, expiresAt }) {
  db.run(
    `INSERT INTO open_invitations (role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?)`,
    [role, tokenHash, invitedBy, expiresAt]
  );
  persist(db);
  return queryOne(db, 'SELECT * FROM open_invitations WHERE token_hash = ?', [tokenHash]);
}
function getOpenInvitationByTokenHash(db, hash) {
  return queryOne(db, 'SELECT * FROM open_invitations WHERE token_hash = ?', [hash]);
}
function getActiveOpenInvitations(db) {
  return queryAll(db,
    `SELECT id, role, invited_by, expires_at, created_at FROM open_invitations
     WHERE used_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC`);
}
function markOpenInvitationUsed(db, id, email) {
  db.run(`UPDATE open_invitations SET used_at = datetime('now'), used_for_email = ? WHERE id = ?`, [email, id]);
  persist(db);
}
function deleteOpenInvitation(db, id) {
  db.run('DELETE FROM open_invitations WHERE id = ?', [id]);
  persist(db);
}

// ── Password resets ────────────────────────────────────────────────────────

function createPasswordReset(db, { userId, tokenHash, expiresAt }) {
  db.run(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]);
  persist(db);
  return queryOne(db, 'SELECT * FROM password_resets WHERE token_hash = ?', [tokenHash]);
}
function getPasswordResetByTokenHash(db, hash) {
  return queryOne(db,
    `SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`,
    [hash]);
}
function markResetUsed(db, id) {
  db.run(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`, [id]);
  persist(db);
}

module.exports = {
  getDb,
  getUserByUsername, getUserByEmail, getUserById, getAllUsers,
  createUser, updateUser, updatePassword, deleteUser,
  getState, setState,
  createInvitation, getInvitationByTokenHash, getPendingInvitationByEmail,
  getAllPendingInvitations, markInvitationAccepted, deleteInvitation,
  createOpenInvitation, getOpenInvitationByTokenHash, getActiveOpenInvitations,
  markOpenInvitationUsed, deleteOpenInvitation,
  createPasswordReset, getPasswordResetByTokenHash, markResetUsed,
};
