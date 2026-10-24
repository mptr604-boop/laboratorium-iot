// src/routes/app.router.js
// Centralny router HTTP: widoki SSR, formularze i akcje REST API
import fs from 'node:fs';
import path from 'node:path';
import { labController } from '../controllers/lab.controller.js';
import { viewController } from '../controllers/view.controller.js';
import { createLogger } from '../utils/logger.js';
import { getSessionUserFromRequest } from '../utils/session.js';

const log = createLogger('router');
/**
 * Główny router HTTP
 * @param {import('node:http').IncomingMessage} req 
 * @param {import('node:http').ServerResponse} res 
 */
export async function handleRouting(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const sendJSON = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  // --- 1. TRASY WIDOKÓW SSR (GET) ---
  
  // Przekierowanie ścieżki głównej
  if (req.method === 'GET' && url.pathname === '/') {
    const targetRoute = getSessionUserFromRequest(req) ? '/dashboard' : '/login';
    res.writeHead(302, { 'Location': targetRoute });
    return res.end();
  }
  
  // GET /login (widok logowania)
  if (req.method === 'GET' && url.pathname === '/login') {
    const filePath = path.join(process.cwd(), 'src', 'views', 'login.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // GET /register (widok rejestracji personelu)
  if (req.method === 'GET' && url.pathname === '/register') {
    const filePath = path.join(process.cwd(), 'src', 'views', 'register.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // GET /dashboard (główny dashboard laboratorium)
  if (req.method === 'GET' && url.pathname === '/dashboard') {
    return viewController.renderDashboard(req, res);
  }
  
  // GET /measurements/details (audyt i szczegóły pomiaru)
  if (req.method === 'GET' && url.pathname === '/measurements/details') {
    return viewController.renderDetails(req, res);
  }

  // --- 2. TRASY OPERACYJNE (POST / REST API) ---
  
  // POST /login (obsługa sesji)
  if (req.method === 'POST' && url.pathname === '/login') {
    return await labController.login(req, res);
  }

  // POST /logout
  if (req.method === 'POST' && url.pathname === '/logout') {
    return labController.logout(req, res);
  }

  // POST /register (rejestracja personelu przez admina)
  if (req.method === 'POST' && url.pathname === '/register') {
    return await labController.register(req, res);
  }

  // POST /api/measurements/create (zapis nowego pomiaru)
  if (req.method === 'POST' && url.pathname === '/api/measurements/create') {
    return await labController.createMeasurement(req, res);
  }

  // POST /api/measurements/delete (usunięcie rekordu, RBAC)
  if (req.method === 'POST' && url.pathname === '/api/measurements/delete') {
    return await labController.deleteMeasurement(req, res);
  }
  
  // POST /api/measurements/comment (notatki audytowe inżyniera)
  if (req.method === 'POST' && url.pathname === '/api/measurements/comment') {
    return await labController.addComment(req, res);
  }

  // --- ZASOBY STATYCZNE PWA ---
  
  // GET /manifest.json
  if (req.method === 'GET' && url.pathname === '/manifest.json') {
    const filePath = path.join(process.cwd(), 'src', 'views', 'manifest.json');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // GET /sw.js
  if (req.method === 'GET' && url.pathname === '/sw.js') {
    const filePath = path.join(process.cwd(), 'src', 'views', 'sw.js');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // POST /api/infrastructure/ack (zamknięcie alertu)
  if (req.method === 'POST' && url.pathname === '/api/infrastructure/ack') {
    return await labController.ackInfrastructureAlert(req, res);
  }

  // --- WYZWALACZ TESTU DIAGNOSTYCZNEGO ---
  if (req.method === 'GET' && url.pathname === '/api/test-crash') {
    log.debug('diagnostic.crash_trigger');
    const { dbDetective } = await import('../utils/detective.js');
    dbDetective.getUserByUsername(undefined);
    dbDetective.getUserByUsername(undefined);
    dbDetective.getUserByUsername(undefined);
    res.writeHead(302, { 'Location': '/dashboard' });
    return res.end();
  }

  return sendJSON(404, { error: 'Endpoint not found' });
}

