// src/test/session.test.js
// Sesje: unit (baza izolowana przez DB_DIR) oraz przepływ przez prawdziwy serwer HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { isCrossSiteRequest } from '../utils/csrf.js';

const unitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-session-unit-'));
process.env.DB_DIR = unitDir;
const { db } = await import('../config/database.js');
await import('../models/db.operations.js');
const session = await import('../utils/session.js');

db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('ola', 'x', 'badacz')").run();
const userId = db.prepare("SELECT id FROM users WHERE username = 'ola'").get().id;

test('Session - id from cookie resolves to the user, and the database stores only a hash', () => {
  const id = session.createSession(userId);
  assert.deepEqual(session.getSessionUser(id), { id: userId, username: 'ola', role: 'badacz' });
  const stored = db.prepare('SELECT id_hash FROM sessions').all().map((r) => r.id_hash);
  assert.ok(!stored.includes(id), 'raw session id must not be stored');
});

test('Session - unknown, empty and oversized ids are rejected', () => {
  assert.equal(session.getSessionUser('nie-ma-takiej'), null);
  assert.equal(session.getSessionUser(''), null);
  assert.equal(session.getSessionUser('a'.repeat(500)), null);
});

test('Session - destroy invalidates immediately', () => {
  const id = session.createSession(userId);
  session.destroySession(id);
  assert.equal(session.getSessionUser(id), null);
});

test('Session - expired session is rejected', () => {
  const id = session.createSession(userId);
  db.prepare('UPDATE sessions SET expires_at = 1').run();
  assert.equal(session.getSessionUser(id), null);
});

test('Session - role change takes effect without logging in again', () => {
  const id = session.createSession(userId);
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(userId);
  assert.equal(session.getSessionUser(id).role, 'admin');
  db.prepare("UPDATE users SET role = 'badacz' WHERE id = ?").run(userId);
});

test('Session - deleted user loses the session', () => {
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('tymczasowy', 'x', 'badacz')").run();
  const tempId = db.prepare("SELECT id FROM users WHERE username = 'tymczasowy'").get().id;
  const id = session.createSession(tempId);
  db.prepare('DELETE FROM users WHERE id = ?').run(tempId);
  assert.equal(session.getSessionUser(id), null);
});

test('Session - cookie is HttpOnly and SameSite=Strict; Secure only when enabled', () => {
  assert.match(session.sessionCookie('abc'), /HttpOnly/);
  assert.match(session.sessionCookie('abc'), /SameSite=Strict/);
  assert.ok(!/Secure/.test(session.sessionCookie('abc')));
  process.env.COOKIE_SECURE = 'true';
  assert.match(session.sessionCookie('abc'), /; Secure/);
  delete process.env.COOKIE_SECURE;
});

test('Session - malformed cookie header does not throw', () => {
  assert.deepEqual(session.parseCookies('%E0%A4%A; session_id=ok'), { session_id: 'ok' });
});

test('CSRF - cross-site and foreign-origin writes are blocked, same-origin and non-browser are allowed', () => {
  const post = (headers) => isCrossSiteRequest({ method: 'POST', headers: { host: 'lab.local', ...headers } });
  assert.equal(post({ 'sec-fetch-site': 'cross-site' }), true);
  assert.equal(post({ 'sec-fetch-site': 'same-site' }), true);
  assert.equal(post({ 'sec-fetch-site': 'same-origin' }), false);
  assert.equal(post({ origin: 'https://evil.example' }), true);
  assert.equal(post({ origin: 'null' }), true);
  assert.equal(post({ origin: 'http://lab.local' }), false);
  assert.equal(post({}), false);
  assert.equal(isCrossSiteRequest({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }), false);
});

test('HTTP flow - login sets a session cookie, dashboard works, logout kills the session (real process)', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-session-http-'));
  const env = { ...process.env, DB_DIR: dbDir, SEED_DEFAULT_PASSWORD: 'test-haslo-123', LOG_LEVEL: 'error' };
  const seeded = spawnSync(process.execPath, ['src/seed.js'], { env, cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);

  const port = 3600 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, ['src/http_server.js'], { env: { ...env, PORT: String(port), LOG_LEVEL: 'info' }, cwd: process.cwd() });
  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  const base = `http://127.0.0.1:${port}`;
  const noFollow = { redirect: 'manual' };

  try {
    const deadline = Date.now() + 10_000;
    while (!output.includes('server.listening')) {
      if (Date.now() > deadline) throw new Error('server did not start: ' + output);
      await new Promise((r) => setTimeout(r, 50));
    }

    const anonymous = await fetch(`${base}/dashboard`, noFollow);
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), '/login');

    const bad = await fetch(`${base}/login`, { ...noFollow, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=szef_admin&password=zle' });
    assert.ok(!bad.headers.get('set-cookie'));

    const login = await fetch(`${base}/login`, { ...noFollow, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=szef_admin&password=test-haslo-123' });
    assert.equal(login.headers.get('location'), '/dashboard');
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /^session_id=[\w-]{40,}; Max-Age=28800; HttpOnly/);
    const cookie = setCookie.split(';')[0];

    const dashboard = await fetch(`${base}/dashboard`, { ...noFollow, headers: { cookie } });
    assert.equal(dashboard.status, 200);

    const forged = await fetch(`${base}/dashboard`, { ...noFollow, headers: { cookie: 'session_id=podrobione' } });
    assert.equal(forged.status, 302);

    const forgedPost = await fetch(`${base}/logout`, { ...noFollow, method: 'POST', headers: { cookie, origin: 'https://evil.example' } });
    assert.equal(forgedPost.status, 403);
    const stillIn = await fetch(`${base}/dashboard`, { ...noFollow, headers: { cookie } });
    assert.equal(stillIn.status, 200, 'blocked CSRF must not log the user out');

    const logout = await fetch(`${base}/logout`, { ...noFollow, method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 302);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

    const afterLogout = await fetch(`${base}/dashboard`, { ...noFollow, headers: { cookie } });
    assert.equal(afterLogout.status, 302, 'old cookie must stop working after logout');
  } finally {
    child.kill();
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});

test.after(() => fs.rmSync(unitDir, { recursive: true, force: true }));
