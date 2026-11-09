/**
 * Spin Next backend — Node/Express.
 * Serves the existing static frontend (docs/) and adds a user-scoped state blob
 * endpoint + the same auth/invite/password-reset surface as the family-tree app.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const db_module = require('./db');
const emailHelper = require('./email');

const app = express();
const PORT = process.env.PORT || 3003;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-to-a-random-secret';

app.use(express.json({ limit: '2mb' }));

// Serve the login/invite/reset HTML pages first (public)
app.use(express.static(path.join(__dirname, 'public')));

// ── Token helpers ─────────────────────────────────────────────────────────
function makeToken() { return crypto.randomBytes(32).toString('base64url'); }
function hashToken(t) { return crypto.createHash('sha256').update(t).digest('hex'); }
function isoFromNow(ms) { return new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19); }

// ── Auth middleware ───────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── Auth routes ───────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username/email and password required' });
  const db = await db_module.getDb();
  const user = String(username).includes('@')
    ? db_module.getUserByEmail(db, username)
    : db_module.getUserByUsername(db, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role || 'user' },
    JWT_SECRET, { expiresIn: '30d' }
  );
  res.json({ token, username: user.username, role: user.role || 'user' });
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const db = await db_module.getDb();
  const user = db_module.getUserById(db, req.user.userId);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db_module.updatePassword(db, user.id, bcrypt.hashSync(newPassword, 10));
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const db = await db_module.getDb();
  const user = db_module.getUserById(db, req.user.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
});

// ── Per-user state (the ratings/notes/prefs blob) ─────────────────────────

app.get('/api/state', requireAuth, async (req, res) => {
  const db = await db_module.getDb();
  res.json(db_module.getState(db, req.user.userId));
});

app.put('/api/state', requireAuth, async (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object') return res.status(400).json({ error: 'Body must be an object' });
  const db = await db_module.getDb();
  db_module.setState(db, req.user.userId, body);
  res.json({ ok: true });
});

// ── User management (admin) ───────────────────────────────────────────────

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const db = await db_module.getDb();
  res.json(db_module.getAllUsers(db));
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, email, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  const validRoles = ['admin', 'user'];
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const db = await db_module.getDb();
  if (db_module.getUserByUsername(db, username)) return res.status(409).json({ error: 'Username already taken' });
  if (email && db_module.getUserByEmail(db, email)) return res.status(409).json({ error: 'Email already registered' });
  const user = db_module.createUser(db, username, bcrypt.hashSync(password, 10), role || 'user', email || null);
  res.status(201).json(user);
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { password, role, email } = req.body || {};
  if (!password && role === undefined && email === undefined) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  const validRoles = ['admin', 'user'];
  if (role !== undefined && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  const db = await db_module.getDb();
  if (email) {
    const existing = db_module.getUserByEmail(db, email);
    if (existing && String(existing.id) !== String(req.params.id)) return res.status(409).json({ error: 'Email already in use' });
  }
  const updates = {};
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    updates.passwordHash = bcrypt.hashSync(password, 10);
  }
  if (role !== undefined)  updates.role = role;
  if (email !== undefined) updates.email = email;
  db_module.updateUser(db, req.params.id, updates);
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  if (String(req.user.userId) === String(req.params.id)) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  const db = await db_module.getDb();
  db_module.deleteUser(db, req.params.id);
  res.json({ ok: true });
});

// ── Invitations (email-based) ─────────────────────────────────────────────

app.post('/api/invitations', requireAuth, requireAdmin, async (req, res) => {
  if (!emailHelper.isConfigured()) return res.status(503).json({ error: 'Email not configured' });
  const { email, role } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
  const validRoles = ['admin', 'user'];
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const db = await db_module.getDb();
  if (db_module.getUserByEmail(db, email)) return res.status(409).json({ error: 'A user with that email already exists' });
  if (db_module.getPendingInvitationByEmail(db, email)) return res.status(409).json({ error: 'Invitation already pending' });

  const token = makeToken();
  const invite = db_module.createInvitation(db, {
    email, role: role || 'user',
    tokenHash: hashToken(token),
    invitedBy: req.user.username,
    expiresAt: isoFromNow(7 * 24 * 60 * 60 * 1000),
  });

  try {
    await emailHelper.sendInvitation({ to: email, inviterName: req.user.username, role: role || 'user', token });
  } catch (err) {
    db_module.deleteInvitation(db, invite.id);
    return res.status(502).json({ error: 'Failed to send email: ' + err.message });
  }
  res.status(201).json({ id: invite.id, email: invite.email, role: invite.role });
});

app.get('/api/invitations', requireAuth, requireAdmin, async (req, res) => {
  const db = await db_module.getDb();
  res.json(db_module.getAllPendingInvitations(db));
});

app.delete('/api/invitations/:id', requireAuth, requireAdmin, async (req, res) => {
  const db = await db_module.getDb();
  db_module.deleteInvitation(db, req.params.id);
  res.json({ ok: true });
});

app.get('/api/invitations/verify/:token', async (req, res) => {
  const db = await db_module.getDb();
  const invite = db_module.getInvitationByTokenHash(db, hashToken(req.params.token));
  if (!invite || invite.accepted_at) return res.status(404).json({ error: 'Invitation not found or already used' });
  if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'Invitation has expired' });
  res.json({ email: invite.email, role: invite.role, invited_by: invite.invited_by });
});

app.post('/api/invitations/accept', async (req, res) => {
  const { token, username, password } = req.body || {};
  if (!token || !username || !password) return res.status(400).json({ error: 'token, username, password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const db = await db_module.getDb();
  const invite = db_module.getInvitationByTokenHash(db, hashToken(token));
  if (!invite || invite.accepted_at) return res.status(404).json({ error: 'Invitation not found or already used' });
  if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'Invitation has expired' });
  if (db_module.getUserByUsername(db, username)) return res.status(409).json({ error: 'Username already taken' });
  if (db_module.getUserByEmail(db, invite.email)) return res.status(409).json({ error: 'Email already registered' });

  const user = db_module.createUser(db, username, bcrypt.hashSync(password, 10), invite.role, invite.email);
  db_module.markInvitationAccepted(db, invite.id);
  const jwtToken = jwt.sign({ userId: user.id, username: user.username, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token: jwtToken, username: user.username, role: user.role || 'user' });
});

// ── Open invitations (shareable setup links) ──────────────────────────────

app.post('/api/open-invitations', requireAuth, requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  const validRoles = ['admin', 'user'];
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const db = await db_module.getDb();
  const token = makeToken();
  const open = db_module.createOpenInvitation(db, {
    role: role || 'user',
    tokenHash: hashToken(token),
    invitedBy: req.user.username,
    expiresAt: isoFromNow(7 * 24 * 60 * 60 * 1000),
  });
  const baseUrl = (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.status(201).json({
    id: open.id, role: open.role, expires_at: open.expires_at,
    link: `${baseUrl}/claim-invite.html?token=${token}`,
  });
});

app.get('/api/open-invitations', requireAuth, requireAdmin, async (req, res) => {
  const db = await db_module.getDb();
  res.json(db_module.getActiveOpenInvitations(db));
});

app.delete('/api/open-invitations/:id', requireAuth, requireAdmin, async (req, res) => {
  const db = await db_module.getDb();
  db_module.deleteOpenInvitation(db, req.params.id);
  res.json({ ok: true });
});

app.get('/api/open-invitations/verify/:token', async (req, res) => {
  const db = await db_module.getDb();
  const open = db_module.getOpenInvitationByTokenHash(db, hashToken(req.params.token));
  if (!open || open.used_at) return res.status(404).json({ error: 'Setup link not found or already used' });
  if (new Date(open.expires_at) < new Date()) return res.status(410).json({ error: 'Setup link has expired' });
  res.json({ role: open.role, invited_by: open.invited_by });
});

app.post('/api/open-invitations/claim', async (req, res) => {
  if (!emailHelper.isConfigured()) return res.status(503).json({ error: 'Email not configured' });
  const { token, email } = req.body || {};
  if (!token || !email) return res.status(400).json({ error: 'Token and email required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });

  const db = await db_module.getDb();
  const open = db_module.getOpenInvitationByTokenHash(db, hashToken(token));
  if (!open || open.used_at) return res.status(404).json({ error: 'Setup link not found or already used' });
  if (new Date(open.expires_at) < new Date()) return res.status(410).json({ error: 'Setup link has expired' });
  if (db_module.getUserByEmail(db, email)) return res.status(409).json({ error: 'A user with that email already exists' });
  if (db_module.getPendingInvitationByEmail(db, email)) return res.status(409).json({ error: 'An invitation is already pending for that email' });

  const inviteToken = makeToken();
  const invite = db_module.createInvitation(db, {
    email,
    role: open.role,
    tokenHash: hashToken(inviteToken),
    invitedBy: open.invited_by,
    expiresAt: isoFromNow(7 * 24 * 60 * 60 * 1000),
  });

  try {
    await emailHelper.sendInvitation({ to: email, inviterName: open.invited_by, role: open.role, token: inviteToken });
  } catch (err) {
    db_module.deleteInvitation(db, invite.id);
    return res.status(502).json({ error: 'Could not send setup email: ' + err.message });
  }
  db_module.markOpenInvitationUsed(db, open.id, email);
  res.json({ ok: true, message: `Setup email sent to ${email}` });
});

// ── Password reset ────────────────────────────────────────────────────────

app.post('/api/password-reset/request', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  const db = await db_module.getDb();
  const user = db_module.getUserByEmail(db, email);
  if (user && emailHelper.isConfigured()) {
    const token = makeToken();
    db_module.createPasswordReset(db, {
      userId: user.id, tokenHash: hashToken(token),
      expiresAt: isoFromNow(60 * 60 * 1000),
    });
    try { await emailHelper.sendPasswordReset({ to: user.email, username: user.username, token }); }
    catch (err) { console.error('Reset email failed:', err.message); }
  }
  res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
});

app.get('/api/password-reset/verify/:token', async (req, res) => {
  const db = await db_module.getDb();
  const row = db_module.getPasswordResetByTokenHash(db, hashToken(req.params.token));
  if (!row) return res.status(404).json({ error: 'Reset link is invalid or has expired' });
  const user = db_module.getUserById(db, row.user_id);
  res.json({ ok: true, username: user ? user.username : null });
});

app.post('/api/password-reset/confirm', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'token and newPassword required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const db = await db_module.getDb();
  const row = db_module.getPasswordResetByTokenHash(db, hashToken(token));
  if (!row) return res.status(404).json({ error: 'Reset link is invalid or has expired' });
  db_module.updatePassword(db, row.user_id, bcrypt.hashSync(newPassword, 10));
  db_module.markResetUsed(db, row.id);
  res.json({ ok: true });
});

// ── Static frontend (docs/ — the existing Spin Next app) ──────────────────
// Served AFTER public/ so /login.html etc. win when there's a conflict.
app.use(express.static(path.join(__dirname, 'docs')));

// SPA fallback: let the frontend route anything we didn't handle
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────

db_module.getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n💿 Spin Next running at http://localhost:${PORT}\n`);
  });
});
