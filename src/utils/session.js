// src/utils/session.js
// Sesje po stronie serwera: do ciasteczka trafia losowy identyfikator, a w bazie leży tylko jego skrót SHA-256.
// Wyciek bazy nie daje więc działających sesji, a wylogowanie, zmiana roli czy usunięcie konta działają od razu.
import crypto from 'node:crypto';
import { db } from '../config/database.js';

export const SESSION_COOKIE = 'session_id';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
`);

const hashId = (id) => crypto.createHash('sha256').update(id).digest('hex');
const nowSeconds = () => Math.floor(Date.now() / 1000);

export function createSession(userId) {
  const id = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowSeconds());
  db.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashId(id), userId, nowSeconds() + SESSION_TTL_SECONDS);
  return id;
}

// Rola jest czytana z bazy przy każdym żądaniu, więc jej zmiana działa natychmiast.
export function getSessionUser(id) {
  if (!id || typeof id !== 'string' || id.length > 128) return null;
  const row = db.prepare(`
    SELECT users.id, users.username, users.role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.id_hash = ? AND sessions.expires_at > ?
  `).get(hashId(id), nowSeconds());
  return row ? { id: row.id, username: row.username, role: row.role } : null;
}

export function destroySession(id) {
  if (id && typeof id === 'string') db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hashId(id));
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of (header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* zepsute ciasteczko pomijamy */ }
  }
  return cookies;
}

// Secure włączamy zmienną COOKIE_SECURE=true (za HTTPS); przez zwykłe HTTP przeglądarka by go odrzuciła.
function cookieFlags() {
  return `HttpOnly; Path=/; SameSite=Strict${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
}
export const sessionCookie = (id) => `${SESSION_COOKIE}=${id}; Max-Age=${SESSION_TTL_SECONDS}; ${cookieFlags()}`;
export const clearedSessionCookie = () => `${SESSION_COOKIE}=; Max-Age=0; ${cookieFlags()}`;

export function getSessionUserFromRequest(req) {
  return getSessionUser(parseCookies(req.headers['cookie'])[SESSION_COOKIE]);
}
