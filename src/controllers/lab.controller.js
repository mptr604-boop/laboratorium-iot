// src/controllers/lab.controller.js
// Kontroler operacyjny LIMS: SQLite WAL, dokumentowy zapis NoSQL i telemetria

import crypto from 'node:crypto';
import { parseMultipartFormData } from '../utils/uploader.js';
import { dbOperations } from '../models/db.operations.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { createSession, destroySession, sessionCookie, clearedSessionCookie, parseCookies, SESSION_COOKIE } from '../utils/session.js';
import { checkRoleAndPermissions } from '../middlewares/auth.middleware.js';
import { redisLikeCache } from '../utils/cache.js';
import { parseLegacyDeviceOutput } from '../utils/parser.js';
import { anomalyMonitor } from '../utils/anomalyMonitor.js';
import { createLogger, fingerprint } from '../utils/logger.js';

const log = createLogger('lab');
async function parseRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  const contentType = (req.headers['content-type'] || req.headers['Content-Type'] || '').toLowerCase();
  
  if (contentType.includes('application/x-www-form-urlencoded') || (rawBody.includes('=') && !rawBody.startsWith('{'))) {
    const params = new URLSearchParams(rawBody);
    const data = {};
    for (const [key, value] of params.entries()) data[key.trim()] = value.trim();
    return data;
  }
  try {
    const parsed = JSON.parse(rawBody || '{}');
    const dataJSON = {};
    for (const k in parsed) {
      dataJSON[k.trim()] = typeof parsed[k] === 'string' ? parsed[k].trim() : parsed[k];
    }
    return dataJSON;
  } catch { return {}; }
}

export const labController = {
  // POST /login
  login: async (req, res) => {
    try {
      const body = await parseRequestBody(req);
      const user = dbOperations.getUserByUsername(body.username);
      if (!user) {
        // Nieznany użytkownik: wpisana wartość może być błędnie wpisanym hasłem, więc logujemy tylko jej hash.
        log.warn('login.failed', { reason: 'unknown_user', username_hash: fingerprint(body.username) });
        res.writeHead(302, { 'Location': '/login?error=' + encodeURIComponent('Nieprawidłowy login lub hasło') });
        return res.end();
      }
      const check = verifyPassword(body.password || '', user.password_hash);
      if (check.ok) {
        // Stary hash (SHA-256 bez soli) podmieniamy na scrypt przy pierwszym udanym logowaniu.
        if (check.needsRehash) dbOperations.updateUserPasswordHash(user.id, hashPassword(body.password));
        const sessionId = createSession(user.id);
        log.info('login.succeeded', { user_id: user.id, role: user.role });
        res.writeHead(302, {
          'Set-Cookie': sessionCookie(sessionId),
          'Location': '/dashboard'
        });
        return res.end();
      }
      log.warn('login.failed', { reason: 'wrong_password', user_id: user.id });
      res.writeHead(302, { 'Location': '/login?error=' + encodeURIComponent('Nieprawidłowy login lub hasło') });
      return res.end();
    } catch (err) {
      log.error('login.error', { err });
      res.writeHead(302, { 'Location': '/login?error=' + encodeURIComponent('Błąd serwera') });
      return res.end();
    }
  },

  // POST /logout: unieważnia sesję na serwerze (ciasteczka HttpOnly nie da się skasować z JS)
  logout: (req, res) => {
    destroySession(parseCookies(req.headers['cookie'])[SESSION_COOKIE]);
    res.writeHead(302, { 'Set-Cookie': clearedSessionCookie(), 'Location': '/login' });
    return res.end();
  },

  // POST /register
  register: async (req, res) => {
    const currentUser = checkRoleAndPermissions(req, ['admin']);
    if (!currentUser) {
      res.writeHead(302, { 'Location': '/dashboard?error=' + encodeURIComponent('Brak uprawnień.') });
      return res.end();
    }
    try {
      const body = await parseRequestBody(req);
      if (!body.username || !body.password || !body.role) {
        res.writeHead(302, { 'Location': '/register?error=' + encodeURIComponent('Wszystkie pola wymagane') });
        return res.end();
      }
      const newPasswordHash = hashPassword(body.password);
      dbOperations.createUser(body.username, newPasswordHash, body.role);
      res.writeHead(302, { 'Location': '/register?success=' + encodeURIComponent('Zarejestrowano ' + body.username) });
      return res.end();
    } catch {
      res.writeHead(302, { 'Location': '/register?error=' + encodeURIComponent('Nazwa zajęta!') });
      return res.end();
    }
  },

  // POST /api/measurements/create (odporny na awarie zapis pomiaru z telemetrią IoT)
  createMeasurement: async (req, res) => {
    const currentUser = checkRoleAndPermissions(req, ['admin', 'badacz_super', 'senior_researcher', 'badacz', 'researcher']);
    if (!currentUser) {
      res.writeHead(302, { 'Location': '/dashboard?error=' + encodeURIComponent('Brak uprawnień.') });
      return res.end();
    }
    try {
      let deviceId, rawText, attachmentData = null;
      const contentType = (req.headers['content-type'] || '').toLowerCase();

      if (contentType.includes('multipart/form-data')) {
        const multipartData = await parseMultipartFormData(req);
        deviceId = parseInt(multipartData.fields.deviceId, 10);
        rawText = multipartData.fields.rawText || '';
        attachmentData = multipartData.file;
      } else {
        const body = await parseRequestBody(req);
        deviceId = parseInt(body.deviceId, 10);
        rawText = body.rawText || '';
      }

      if (!rawText.trim()) {
        res.writeHead(302, { 'Location': '/dashboard?error=' + encodeURIComponent('Tekst pusty.') });
        return res.end();
      }

      const cleanText = rawText.replace(/\\n/g, '\n');
      let density = 0, temperature = 0, fuelStatus = 'PARSER_ERROR', isHardwareFault = false;
      
      try {
        const parsed = parseLegacyDeviceOutput(cleanText);
        if (parsed.density === 'ERR' || parsed.fuelStatus === 'DEVICE_FAULT') {
          isHardwareFault = true;
          fuelStatus = 'DEVICE_FAULT';
        } else {
          density = parseFloat(parsed.density);
          temperature = parseFloat(parsed.temperature);
          fuelStatus = parsed.fuelStatus;
        }
      } catch { 
        isHardwareFault = true;
        fuelStatus = 'DEVICE_FAULT';
      }

      if (isHardwareFault) {
        anomalyMonitor.registerIncident('ERR_CODE_HARDWARE_FAILURE', `Aparat ID [${deviceId}]`);
      }

      const nosqlDocument = { 
        raw_text: cleanText, 
        parsed_density: isHardwareFault ? 'ERR' : density, 
        parsed_temperature: isHardwareFault ? 'ERR' : temperature, 
        fuel_status: fuelStatus,
        comments: [],
        file_attachment: attachmentData
      };

      dbOperations.saveMeasurement(deviceId, currentUser.id, nosqlDocument);
      redisLikeCache.invalidate('view_dashboard_%');
      
      res.writeHead(302, { 'Location': '/dashboard' });
      return res.end();
    } catch (err) {
      log.error('measurement.create_failed', { err });
      res.writeHead(302, { 'Location': '/dashboard?error=' + encodeURIComponent('Błąd zapisu badania.') });
      return res.end();
    }
  },

  // POST /api/measurements/delete (wymusza reguły: własny a cudzy rekord)
  deleteMeasurement: async (req, res) => {
    const currentUser = checkRoleAndPermissions(req, ['admin', 'badacz_super', 'senior_researcher', 'badacz', 'researcher']);
    if (!currentUser) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Brak uprawnień.');
    }
    try {
      const body = await parseRequestBody(req);
      const measurementId = parseInt(body.id, 10);
      const measurement = dbOperations.getMeasurementById(measurementId);
      if (!measurement) {
        res.writeHead(302, { 'Location': '/dashboard?error=' + encodeURIComponent('Nie znaleziono badania') });
        return res.end();
      }
      const isJunior = currentUser.role === 'badacz' || currentUser.role === 'researcher';
      if (isJunior && measurement.user_id !== currentUser.id) {
        res.writeHead(302, { 'Location': '/dashboard?error=' + encodeURIComponent('Możesz usuwać tylko własne badania!') });
        return res.end();
      }
      dbOperations.deleteMeasurement(measurementId);
      redisLikeCache.invalidate('view_dashboard_%');
      redisLikeCache.invalidate(`view_details_m${measurementId}_%`);
      res.writeHead(302, { 'Location': '/dashboard' });
      return res.end();
    } catch {
      res.writeHead(302, { 'Location': '/dashboard?error=' + encodeURIComponent('Błąd usuwania') });
      return res.end();
    }
  },

  // POST /api/measurements/comment (asynchroniczne notatki audytowe inżyniera)
  addComment: async (req, res) => {
    const currentUser = checkRoleAndPermissions(req, ['admin', 'badacz_super', 'senior_researcher', 'badacz', 'researcher', 'przegladajacy', 'auditor', 'viewer']);
    if (!currentUser) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ blad: 'Brak aktywnej sesji.' }));
    }
    try {
      const body = await parseRequestBody(req);
      const measurementId = parseInt(body.id, 10);
      if (!body.text || !body.text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ blad: 'Komentarz pusty.' }));
      }
      const commentObj = { user: currentUser.username, text: body.text.trim(), date: new Date().toISOString() };
      const result = dbOperations.addCommentToMeasurement(measurementId, commentObj);
      if (!result) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ blad: 'Brak pomiaru.' }));
      }
      redisLikeCache.invalidate('view_dashboard_%');
      redisLikeCache.invalidate(`view_details_m${measurementId}_%`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'sukces', autor: currentUser.username }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ blad: 'Błąd zapisu.' }));
    }
  },

  // POST /api/infrastructure/ack (potwierdzenie i zamknięcie krytycznego alertu)
  ackInfrastructureAlert: async (req, res) => {
    const currentUser = checkRoleAndPermissions(req, ['admin', 'badacz_super', 'senior_researcher']);
    if (!currentUser) {
      res.writeHead(302, { 'Location': '/dashboard?error=' + encodeURIComponent('Brak praw do kasowania alertów.') });
      return res.end();
    }
    try {
      const body = await parseRequestBody(req);
      if (body.id) {
        anomalyMonitor.clearAlert(body.id);
        redisLikeCache.invalidate('view_dashboard_%');
      }
      res.writeHead(302, { 'Location': '/dashboard' });
      return res.end();
    } catch {
      res.writeHead(302, { 'Location': '/dashboard?error=' + encodeURIComponent('Błąd przetwarzania alertu.') });
      return res.end();
    }
  }
};
